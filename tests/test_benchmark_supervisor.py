import contextlib
import hashlib
import importlib.util
import io
import json
import os
import platform
import shutil
import signal
import sys
import tempfile
import time
import unittest
from unittest import mock

MODULE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "scripts", "benchmark-audit", "benchmark-supervisor.py")


def _load_module():
    spec = importlib.util.spec_from_file_location("benchmark_supervisor", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bs = _load_module()

IS_MACOS = platform.system() == "Darwin"


class ConfigValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.job_dir = os.path.join(self.tmp, "job1")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _base_config(self):
        return {
            "cwd": self.tmp,
            "argv": [sys.executable, "-c", "pass"],
            "jobDir": self.job_dir,
            "requireAbsent": [],
        }

    def test_accepts_valid_config(self):
        raw = json.dumps(self._base_config()).encode()
        cfg = bs.validate_config(raw)
        self.assertEqual(cfg["jobDir"], self.job_dir)

    def test_rejects_nul_byte(self):
        cfg = self._base_config()
        cfg["argv"] = [sys.executable, "-c", "pass\x00"]
        raw = json.dumps(cfg).encode()
        with self.assertRaises(bs.ConfigError):
            bs.validate_config(raw)

    def test_rejects_relative_argv0(self):
        cfg = self._base_config()
        cfg["argv"] = ["python3", "-c", "pass"]
        raw = json.dumps(cfg).encode()
        with self.assertRaises(bs.ConfigError):
            bs.validate_config(raw)

    def test_rejects_existing_jobdir_claim(self):
        os.mkdir(self.job_dir)
        raw = json.dumps(self._base_config()).encode()
        with self.assertRaises(bs.ConfigError):
            bs.validate_config(raw)

    def test_rejects_required_path_present(self):
        present = os.path.join(self.tmp, "present.txt")
        with open(present, "w") as f:
            f.write("x")
        cfg = self._base_config()
        cfg["requireAbsent"] = [present]
        raw = json.dumps(cfg).encode()
        with self.assertRaises(bs.ConfigError):
            bs.validate_config(raw)

    def test_rejects_dangling_symlink_required_absent(self):
        target = os.path.join(self.tmp, "missing_target")
        link = os.path.join(self.tmp, "dangling_link")
        os.symlink(target, link)
        cfg = self._base_config()
        cfg["requireAbsent"] = [link]
        raw = json.dumps(cfg).encode()
        with self.assertRaises(bs.ConfigError):
            bs.validate_config(raw)

    def test_rejects_missing_key(self):
        cfg = self._base_config()
        del cfg["requireAbsent"]
        raw = json.dumps(cfg).encode()
        with self.assertRaises(bs.ConfigError):
            bs.validate_config(raw)


@unittest.skipUnless(IS_MACOS, "integration test requires macOS ps/sysctl")
class LaunchIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.job_dir = os.path.join(self.tmp, "job")
        self.marker = os.path.join(self.tmp, "marker.txt")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _config(self, argv, job_dir=None):
        return {
            "cwd": self.tmp,
            "argv": argv,
            "jobDir": job_dir or self.job_dir,
            "requireAbsent": [],
        }

    def _run_launch(self, cfg):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            bs.launch(json.dumps(cfg))
        return json.loads(buf.getvalue().strip())

    def _read_status(self, job_dir):
        status_path = os.path.join(job_dir, "status.json")
        if not os.path.exists(status_path):
            return None
        with open(status_path) as f:
            return json.load(f)

    def _poll_for_state(self, job_dir, states, timeout=5):
        deadline = time.time() + timeout
        status = None
        while time.time() < deadline:
            status = self._read_status(job_dir)
            if status and status.get("state") in states:
                return status
            time.sleep(0.1)
        self.fail("timed out waiting for status state, last seen: %r" % (status,))

    def test_launch_runs_command_and_writes_receipt(self):
        script = (
            "import sys\n"
            "open(sys.argv[1], 'w').write('done')\n"
            "print('MARKER-OK')\n"
        )
        argv = [sys.executable, "-c", script, self.marker]
        cfg = self._config(argv)

        receipt = self._run_launch(cfg)
        self.assertEqual(receipt["jobDir"], self.job_dir)
        self.assertIn("configSha256", receipt)
        self.assertIn("supervisorPid", receipt)

        status = self._poll_for_state(self.job_dir, {"exited", "supervisor-error"})
        self.assertEqual(status["state"], "exited")
        self.assertEqual(status["exitCode"], 0)
        self.assertEqual(status["configSha256"], receipt["configSha256"])

        log_path = os.path.join(self.job_dir, "log")
        with open(log_path) as f:
            log_content = f.read()
        self.assertIn("MARKER-OK", log_content)
        self.assertTrue(os.path.exists(self.marker))

    def test_duplicate_launch_rejected(self):
        argv = [sys.executable, "-c", "pass"]
        cfg = self._config(argv)
        self._run_launch(cfg)
        with self.assertRaises(Exception):
            bs.launch(json.dumps(cfg))
        self._poll_for_state(self.job_dir, {"exited", "supervisor-error"}, timeout=5)

    def test_no_retry_on_nonzero_exit(self):
        argv = [sys.executable, "-c", "import sys; sys.exit(7)"]
        job_dir = os.path.join(self.tmp, "job_fail")
        cfg = self._config(argv, job_dir=job_dir)
        self._run_launch(cfg)

        status = self._poll_for_state(job_dir, {"exited", "supervisor-error"})
        self.assertEqual(status["state"], "exited")
        self.assertEqual(status["exitCode"], 7)

        time.sleep(1)
        status_after = self._read_status(job_dir)
        self.assertEqual(status_after["state"], "exited")
        self.assertEqual(status_after["exitCode"], 7)

    def test_argv_preserved_with_special_characters(self):
        tricky_arg = "hello world $HOME `echo hi` \"quoted\" 'single'\nnewline"
        script = (
            "import sys, json\n"
            "open(sys.argv[1], 'w').write(json.dumps(sys.argv[2]))\n"
        )
        argv = [sys.executable, "-c", script, self.marker, tricky_arg]
        job_dir = os.path.join(self.tmp, "job_argv")
        cfg = self._config(argv, job_dir=job_dir)

        self._run_launch(cfg)
        self._poll_for_state(job_dir, {"exited", "supervisor-error"})

        with open(self.marker) as f:
            received = json.loads(f.read())
        self.assertEqual(received, tricky_arg)

    def test_config_tamper_refused(self):
        argv = [sys.executable, "-c", "pass"]
        job_dir = os.path.join(self.tmp, "job_tamper")
        cfg = self._config(argv, job_dir=job_dir)
        canonical = json.dumps(cfg, sort_keys=True, separators=(",", ":")).encode("utf-8")
        os.mkdir(job_dir, 0o700)
        with open(os.path.join(job_dir, "config.json"), "wb") as f:
            f.write(canonical)

        with self.assertRaises(Exception):
            bs.run_mode(job_dir, "0" * 64)

        self.assertFalse(os.path.exists(os.path.join(job_dir, "status.json")))
        self.assertFalse(os.path.exists(os.path.join(job_dir, "log")))

    def _descendant_command(self):
        pid_path = os.path.join(self.tmp, "descendant.pid")
        descendant = (
            "import os,signal,sys,time\n"
            "signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
            "open(sys.argv[1],'w').write(str(os.getpid()))\n"
            "time.sleep(30)\n"
        )
        leader = (
            "import os,subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]])\n"
            "end=time.monotonic()+3\n"
            "while not os.path.exists(sys.argv[2]) and time.monotonic()<end:\n"
            "    time.sleep(0.01)\n"
            "sys.exit(7)\n"
        )
        return [sys.executable, "-c", leader, descendant, pid_path]

    def _kill_owned_group_if_present(self, job_dir):
        status = self._read_status(job_dir)
        if status and status.get("childPgid"):
            try:
                os.killpg(status["childPgid"], signal.SIGKILL)
            except ProcessLookupError:
                pass

    def test_leader_exit_remains_nonterminal_until_descendant_group_exits(self):
        receipt = self._run_launch(self._config(self._descendant_command()))
        try:
            status = self._poll_for_state(
                self.job_dir, {"leader-exited-descendants-present"})
            self.assertEqual(status["exitCode"], 7)
            self.assertFalse(status["groupGone"])
            self.assertNotIn("finishedAt", status)
            os.killpg(status["childPgid"], 0)

            os.killpg(status["childPgid"], signal.SIGKILL)
            terminal = self._poll_for_state(self.job_dir, {"exited"})
            self.assertEqual(terminal["exitCode"], 7)
            self.assertTrue(terminal["groupGone"])
            self.assertFalse(bs._group_exists(status["childPgid"]))
        finally:
            self._kill_owned_group_if_present(self.job_dir)
            self._poll_for_state(self.job_dir, {"exited", "supervisor-error"})
            try:
                os.waitpid(receipt["supervisorPid"], 0)
            except ChildProcessError:
                pass

    def test_error_cleanup_kills_term_ignoring_descendant_after_leader_exits(self):
        cfg = self._config(self._descendant_command())
        canonical = bs._canonical_bytes(cfg)
        os.mkdir(self.job_dir, 0o700)
        bs._write_exclusive(os.path.join(self.job_dir, "config.json"), canonical)
        original_write = bs._atomic_replace_status
        injected = []

        def fail_after_leader_exit(path, status):
            if status["state"] == "leader-exited-descendants-present":
                injected.append(status["childPgid"])
                raise RuntimeError("injected receipt failure")
            return original_write(path, status)

        try:
            with mock.patch.object(bs, "_atomic_replace_status", fail_after_leader_exit):
                bs.run_mode(self.job_dir, hashlib.sha256(canonical).hexdigest())
            self.assertEqual(len(injected), 1)
            status = self._read_status(self.job_dir)
            self.assertEqual(status["state"], "supervisor-error")
            self.assertEqual(status["exitCode"], 7)
            self.assertTrue(status["groupGone"])
            self.assertFalse(bs._group_exists(injected[0]))
        finally:
            self._kill_owned_group_if_present(self.job_dir)


if __name__ == "__main__":
    unittest.main()
