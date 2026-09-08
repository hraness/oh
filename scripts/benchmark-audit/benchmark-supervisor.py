#!/usr/bin/env python3
"""Local supervisor that launches a single caller-reviewed, pre-authorized
benchmark command exactly once and tracks its lifecycle in a job directory."""

import hashlib
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time

MAX_CONFIG_BYTES = 128 * 1024
MAX_ARGV_BYTES = 64 * 1024
REQUIRED_KEYS = {"cwd", "argv", "jobDir", "requireAbsent"}

PS_ARGV0 = "/bin/ps"
SYSCTL_ARGV = ["/usr/sbin/sysctl", "-n", "kern.boottime"]


class ConfigError(ValueError):
    pass


def _no_nul(s):
    if "\x00" in s:
        raise ConfigError("NUL byte not allowed")


def _read_bounded_nofollow(path, max_bytes):
    flags = os.O_RDONLY | os.O_NOFOLLOW
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    fd = os.open(path, flags)
    try:
        file_stat = os.fstat(fd)
        if not stat.S_ISREG(file_stat.st_mode):
            raise ConfigError("config path must be a regular file")
        data = os.read(fd, max_bytes + 1)
        if len(data) > max_bytes:
            raise ConfigError("config file too large")
        return data
    finally:
        os.close(fd)


def check_required_absent(paths):
    for p in paths:
        try:
            os.lstat(p)
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise ConfigError("cannot check required-absent path") from exc
        raise ConfigError("required-absent path exists")


def validate_config(raw_bytes, existing_job_dir=None):
    if len(raw_bytes) > MAX_CONFIG_BYTES:
        raise ConfigError("config too large")
    if b"\x00" in raw_bytes:
        raise ConfigError("NUL byte in config")
    try:
        cfg = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConfigError("invalid json") from exc
    if not isinstance(cfg, dict) or set(cfg.keys()) != REQUIRED_KEYS:
        raise ConfigError("config must have exactly the required keys")

    cwd = cfg["cwd"]
    argv = cfg["argv"]
    job_dir = cfg["jobDir"]
    require_absent = cfg["requireAbsent"]

    if not isinstance(cwd, str) or not cwd:
        raise ConfigError("cwd must be a non-empty string")
    _no_nul(cwd)
    if not os.path.isabs(cwd):
        raise ConfigError("cwd must be absolute")

    if not isinstance(argv, list) or not argv:
        raise ConfigError("argv must be a non-empty list")
    total = 0
    for a in argv:
        if not isinstance(a, str):
            raise ConfigError("argv entries must be strings")
        _no_nul(a)
        total += len(a.encode("utf-8"))
    if total > MAX_ARGV_BYTES:
        raise ConfigError("argv too large")
    if not os.path.isabs(argv[0]):
        raise ConfigError("argv[0] must be an absolute path")

    if not isinstance(job_dir, str) or not job_dir:
        raise ConfigError("jobDir must be a non-empty string")
    _no_nul(job_dir)
    if not os.path.isabs(job_dir):
        raise ConfigError("jobDir must be absolute")

    if not isinstance(require_absent, list):
        raise ConfigError("requireAbsent must be a list")
    for p in require_absent:
        if not isinstance(p, str) or not p:
            raise ConfigError("requireAbsent entries must be non-empty strings")
        _no_nul(p)
        if not os.path.isabs(p):
            raise ConfigError("requireAbsent entries must be absolute")

    if not os.path.isdir(cwd):
        raise ConfigError("cwd does not exist")

    if existing_job_dir is not None:
        if job_dir != existing_job_dir:
            raise ConfigError("jobDir does not match expected job directory")
        try:
            job_dir_stat = os.lstat(job_dir)
        except OSError as exc:
            raise ConfigError("jobDir does not exist") from exc
        if stat.S_ISLNK(job_dir_stat.st_mode) or not stat.S_ISDIR(job_dir_stat.st_mode):
            raise ConfigError("jobDir must be an existing real directory")
    elif os.path.lexists(job_dir):
        raise ConfigError("jobDir already exists")

    check_required_absent(require_absent)
    return cfg


def _canonical_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write_exclusive(path, data_bytes):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        os.chmod(path, 0o600)
    except Exception:
        os.close(fd)
        raise
    with os.fdopen(fd, "wb") as f:
        f.write(data_bytes)
        f.flush()
        os.fsync(f.fileno())


def _atomic_replace_status(status_path, status):
    data = _canonical_bytes(status)
    directory = os.path.dirname(status_path)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".status-", suffix=".tmp")
    try:
        os.chmod(tmp_path, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, status_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _run_fixed_argv(argv, failure_message):
    result = subprocess.run(
        argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True
    )
    if result.returncode != 0:
        raise RuntimeError(failure_message)
    out = result.stdout.decode("utf-8", "replace").strip()
    if not out:
        raise RuntimeError(failure_message)
    return out


def ps_lstart(pid):
    return _run_fixed_argv([PS_ARGV0, "-p", str(pid), "-o", "lstart="],
                            "failed to query process identity")


def sysctl_boottime():
    return _run_fixed_argv(SYSCTL_ARGV, "failed to query boot identity")


def _group_exists(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def _wait_for_group(proc, pgid, timeout=None):
    deadline = None if timeout is None else time.monotonic() + timeout
    while True:
        proc.poll()  # Reap the leader so its zombie cannot keep the group alive.
        if not _group_exists(pgid):
            return True
        if deadline is not None and time.monotonic() >= deadline:
            return False
        time.sleep(0.1)


def launch(config_json_str):
    raw_bytes = config_json_str.encode("utf-8")
    cfg = validate_config(raw_bytes)

    job_dir = cfg["jobDir"]
    canonical = _canonical_bytes(cfg)
    config_sha256 = hashlib.sha256(canonical).hexdigest()

    os.mkdir(job_dir, 0o700)
    os.chmod(job_dir, 0o700)

    config_path = os.path.join(job_dir, "config.json")
    _write_exclusive(config_path, canonical)

    script_path = os.path.abspath(__file__)
    spawn_argv = [sys.executable, script_path, "run", job_dir, config_sha256]

    proc = subprocess.Popen(
        spawn_argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        start_new_session=True,
    )

    result = {
        "supervisorPid": proc.pid,
        "jobDir": job_dir,
        "configSha256": config_sha256,
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


def run_mode(job_dir, expected_config_sha256):
    job_dir = os.path.abspath(job_dir)
    config_path = os.path.join(job_dir, "config.json")
    status_path = os.path.join(job_dir, "status.json")
    log_path = os.path.join(job_dir, "log")

    raw = _read_bounded_nofollow(config_path, MAX_CONFIG_BYTES)
    cfg = validate_config(raw, existing_job_dir=job_dir)

    actual_config_sha256 = hashlib.sha256(_canonical_bytes(cfg)).hexdigest()
    if actual_config_sha256 != expected_config_sha256:
        raise RuntimeError("config hash does not match expected value")

    if os.path.lexists(status_path) or os.path.lexists(log_path):
        raise RuntimeError("job already has status or log")

    log_fd = os.open(log_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.chmod(log_path, 0o600)

    supervisor_pid = os.getpid()
    supervisor_start = ps_lstart(supervisor_pid)
    boot_identity = sysctl_boottime()

    command_sha256 = hashlib.sha256(
        json.dumps(cfg["argv"], separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    config_sha256 = hashlib.sha256(_canonical_bytes(cfg)).hexdigest()

    status = {
        "state": "starting",
        "supervisorPid": supervisor_pid,
        "supervisorStart": supervisor_start,
        "bootIdentity": boot_identity,
        "commandSha256": command_sha256,
        "configSha256": config_sha256,
        "startedAt": _now_iso(),
    }
    _write_exclusive(status_path, _canonical_bytes(status))

    child_pgid_holder = {"pgid": None}
    pending_signal_holder = {"signum": None}

    def _forward(signum, _frame):
        pgid = child_pgid_holder["pgid"]
        if pgid is not None:
            try:
                os.killpg(pgid, signum)
            except ProcessLookupError:
                pass
        else:
            pending_signal_holder["signum"] = signum

    old_handlers = {}
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
        old_handlers[sig] = signal.signal(sig, _forward)

    proc = None
    try:
        if pending_signal_holder["signum"] is not None:
            raise RuntimeError("cancelled before start")

        proc = subprocess.Popen(
            cfg["argv"],
            cwd=cfg["cwd"],
            stdin=subprocess.DEVNULL,
            stdout=log_fd,
            stderr=subprocess.STDOUT,
            close_fds=True,
            process_group=0,
        )
        child_pgid_holder["pgid"] = proc.pid
        if os.getpgid(proc.pid) != proc.pid:
            raise RuntimeError("child did not receive its own process group")
        if pending_signal_holder["signum"] is not None:
            os.killpg(proc.pid, pending_signal_holder["signum"])

        try:
            child_start = ps_lstart(proc.pid)
        except Exception:
            if proc.poll() is None:
                raise
            child_start = None

        status["state"] = "running"
        status["childPid"] = proc.pid
        status["childPgid"] = proc.pid
        status["childStart"] = child_start
        _atomic_replace_status(status_path, status)

        exit_code = proc.wait()

        if _group_exists(proc.pid):
            status["state"] = "leader-exited-descendants-present"
            status["exitCode"] = exit_code
            status["groupGone"] = False
            _atomic_replace_status(status_path, status)
            _wait_for_group(proc, proc.pid)

        try:
            os.fsync(log_fd)
        except OSError:
            pass
        status["state"] = "exited"
        status["exitCode"] = exit_code
        status["groupGone"] = True
        status["finishedAt"] = _now_iso()
        _atomic_replace_status(status_path, status)
    except BaseException:
        group_gone = proc is None
        if proc is not None:
            pgid = child_pgid_holder["pgid"]
            try:
                os.killpg(pgid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            group_gone = _wait_for_group(proc, pgid, timeout=10)
            if not group_gone:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
                group_gone = _wait_for_group(proc, pgid, timeout=10)
        try:
            os.fsync(log_fd)
        except OSError:
            pass
        status["state"] = "supervisor-error" if group_gone else "cleanup-incomplete"
        status["groupGone"] = group_gone
        status["message"] = "supervisor encountered an internal error"
        status["finishedAt"] = _now_iso()
        if proc is not None and proc.returncode is not None:
            status["exitCode"] = proc.returncode
        try:
            _atomic_replace_status(status_path, status)
        except Exception:
            pass
    finally:
        os.close(log_fd)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


def _main():
    if len(sys.argv) < 2:
        print("usage: benchmark-supervisor.py launch CONFIG_PATH | run JOB_DIR EXPECTED_CONFIG_SHA256",
              file=sys.stderr)
        sys.exit(2)

    mode = sys.argv[1]
    if mode == "launch" and len(sys.argv) == 3:
        config_path = sys.argv[2]
        if not os.path.isabs(config_path):
            raise ConfigError("config path must be absolute")
        raw_bytes = _read_bounded_nofollow(config_path, MAX_CONFIG_BYTES)
        launch(raw_bytes.decode("utf-8"))
    elif mode == "run" and len(sys.argv) == 4:
        run_mode(sys.argv[2], sys.argv[3])
    else:
        print("invalid arguments", file=sys.stderr)
        sys.exit(2)


def main():
    try:
        _main()
    except SystemExit:
        raise
    except BaseException:
        print("error: operation failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
