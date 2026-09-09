"""Finite synthetic custody histories. OS inventory is mocked; no provider or real study use."""
import copy
from contextlib import ExitStack
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

# The installed repository module is the validation target.
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'scripts/benchmark-audit'))
import close_gateway_v6_batch as m
import gateway_context as gc

H = lambda s: m.digest(s.encode())
T = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
iso = lambda n: (T + dt.timedelta(seconds=n)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
seconds = lambda n: iso(n).replace('.000Z', 'Z')


def context_document(work, repo):
    return {'schema': 'oh.gateway-audit-context.v1', 'workDirectory': str(work), 'repositoryDirectory': str(repo),
            'tools': {'python': '/synthetic/bin/python3', 'bun': '/synthetic/bin/bun', 'vercel': '/synthetic/bin/vercel', 'ps': '/bin/ps'},
            'auth': {'method': 'project-oidc', 'project': 'fixture-project', 'scope': 'fixture-owner', 'environment': 'development'}}


def request(phase, label):
    model = 'openai/gpt-4.1-mini' if phase == 'reader' else 'openai/gpt-4o'
    messages = [{'role': 'system', 'content': 'Synthetic system'}, {'role': 'user', 'content': f'Synthetic opaque café {label}'}]
    body = {'model': model, 'messages': messages, 'temperature': 0, 'store': False, 'max_tokens': 512,
            'providerOptions': {'gateway': {'only': ['openai'], 'order': ['openai']}}}
    pre = {'protocol': m.TRANSPORT, 'phase': phase, 'endpoint': 'https://ai-gateway.vercel.sh/v1/chat/completions', 'body': body}
    return {**pre, 'requestSha256': m.js_hash(pre), 'inputBytes': len(json.dumps(messages, ensure_ascii=False, separators=(',', ':')).encode()),
            'maximumOutput': 512, 'timeoutMs': 120000, 'model': model}


class Fixture:
    def __init__(self, root):
        self.root = root; self.work = root / 'work'; self.repo = root / 'repo'
        for p in [self.work, self.repo]: p.mkdir(mode=0o700)
        self.context = gc.parse_context(context_document(self.work, self.repo)); self.study = self.work / 'gateway-study-v6'
        self.runtime = self.work / 'gateway-study-v6-candidate'
        for p in [self.study, self.study / 'jobs', self.runtime]: p.mkdir(mode=0o700)
        self.fs, self.ss, self.ips = H('freeze'), H('source'), H('import-preparation')
        self.jobs = []; self.requests = {}
        for i in range(28): self.add_job('reader', 332 + i, terminal=i == 1)
        for i in [0, 3, 9, 11, 20, 30, 50, 359]: self.add_job('judge', i)
        self.freeze = {'sourceSha256': self.ss, 'sourceGitHead': 'a' * 40, 'createdAt': iso(0),
            'importedStudy': {'path': str(self.work / 'manifest.json'), 'sha256': H('manifest')},
            'study': {'importedJobKeysSha256': H('5064'), 'newReaderOrderSha256': m.js_hash([{k: j[k] for k in ['key', 'ordinal', 'requestSha256']} for j in self.jobs[:28]]), 'importedV5': {}},
            'procedure': {'profile': 'oh.memory-gateway-study.v6'}}
        self.data = {'runtime': self.runtime, 'study': self.study, 'freeze': self.freeze,
            'freezePin': {'path': str(self.study / 'freeze.json'), 'sha256': self.fs}, 'importPreparation': {'path': str(self.work / 'gateway-v6-import-preparation.json'), 'sha256': self.ips},
            'importedKeys': [H('old-key')], 'sourceFiles': [], 'oldLedgers': [], 'oldProducers': [],
            'binding': {'freeze': {'path': str(self.context.study / 'freeze.json'), 'sha256': H('old-freeze')}}}
        for name in ['freeze.json', 'preparation.json', 'store.json']: self.put(self.study / name, {'synthetic': name})
        self.events = []; self.frontier = 0; self.exposure = 0

    def put(self, path, value):
        raw = value if type(value) is bytes else m.serialize(value)
        path.write_bytes(raw); path.chmod(0o600)
        return {'path': str(path), 'sha256': m.digest(raw)}

    def add_job(self, phase, ordinal, terminal=False):
        key = H(f'{phase}-{ordinal}'); req = request(phase, str(ordinal)); self.requests[key] = req
        self.jobs.append({'key': key, 'phase': phase, 'ordinal': ordinal, 'requestSha256': req['requestSha256'], 'terminalReaderFailure': terminal})

    def native_job(self, j):
        key = j['key']; folder = self.study / 'jobs' / key; folder.mkdir(mode=0o700)
        req = self.requests[key]; amount, prices = m.request_metadata(req, j['phase'])
        reserved = {'v': 1, 'id': key, 'kind': 'reserved', 'micros': amount}
        tokens = 512 if j['terminalReaderFailure'] else 10; cost = __import__('math').ceil(10 * prices[0] + tokens * prices[2])
        settled = {'v': 1, 'id': key, 'kind': 'settled', 'micros': cost}
        raw = b'{"opaqueSyntheticCapture":true}'
        result = {'kind': 'terminal-reader-failure' if j['terminalReaderFailure'] else 'completed', 'finishReason': 'length' if j['terminalReaderFailure'] else 'stop',
            'requestSha256': req['requestSha256'], 'rawSha256': m.digest(raw), 'rawBytes': len(raw),
            'usage': {'inputTokens': 10, 'cachedInputTokens': 0, 'outputTokens': tokens, 'tokenRateMicros': cost, 'gatewayReportedMicros': None,
                      'micros': cost, 'costBasis': 'token-rate-estimate', 'billedUsd': None},
            'identity': {'requestedModel': req['model'], 'reportedModel': req['model'], 'resolvedProviderApiModelId': None, 'resolvedSnapshot': None,
                         'snapshotPinned': False, 'finalProvider': 'openai', 'reportedModelAttemptCount': 1, 'reportedProviderAttemptCount': 1, 'physicalAttemptCount': None}}
        if j['terminalReaderFailure']: result.update({'reason': 'output-token-limit', 'policySha256': m.POLICY})
        else: result['prediction'] = {'deliberatelyOpaqueValue': 'Custody must not inspect this synthetic value'}
        self.put(folder / 'pending.json', {'protocol': m.STORE, 'freezeSha256': self.fs, 'jobKey': key, 'phase': j['phase'], 'ordinal': j['ordinal'], 'originalParentOrdinal': None, 'originalJobKey': None, 'request': req})
        self.put(folder / 'reserved.json', reserved); self.put(folder / 'settled.json', settled)
        self.put(folder / 'response.body', raw)
        self.put(folder / 'response.json', {'requestSha256': req['requestSha256'], 'httpStatus': 200, 'bodyComplete': True, 'receivedBytes': len(raw), 'transportError': None, 'body': {'bytes': len(raw), 'sha256': m.digest(raw)}})
        self.put(folder / 'result.json', {'protocol': m.STORE, 'freezeSha256': self.fs, 'jobKey': key, 'result': result})
        return reserved, settled

    def batch(self, number, count, final=False, start=None, native_number=None):
        start = start if start is not None else number * 100
        run = f'00000000-0000-4000-8000-{number:012}'
        before, before_exposure = self.frontier, self.exposure; selected = self.jobs[before:before + count]
        wave = []
        for j in selected:
            if wave and (len(wave) == 4 or wave[-1][0]['phase'] != j['phase']):
                self.events.extend(r for _, r, _ in wave); self.events.extend(s for _, _, s in reversed(wave)); wave = []
            r, s = self.native_job(j); wave.append((j, r, s))
        if wave:
            self.events.extend(r for _, r, _ in wave); self.events.extend(s for _, _, s in reversed(wave))
        raw = b''.join(m.canonical(e) + b'\n' for e in self.events); self.put(self.study / 'ledger.jsonl', raw)
        self.frontier += count; self.exposure = sum(e['micros'] for e in self.events if e['kind'] == 'settled')
        q = {'method': 'project-oidc', 'project': self.context.project, 'scope': self.context.scope, 'environment': 'development',
             'issuer': f'https://oidc.vercel.com/{self.context.scope}', 'subject': f'owner:{self.context.scope}:project:{self.context.project}:environment:development',
             'audience': f'https://vercel.com/{self.context.scope}', 'expiresAt': T.timestamp() + start + 1000, 'signatureVerifiedLocally': False}
        maximum = 32 if (native_number or number) == 1 else 256
        identity = {'runId': run, 'freezeSha256': self.fs, 'sourceSha256': self.ss, 'sourceGitHead': self.freeze['sourceGitHead'],
            'importedStudySha256': self.freeze['importedStudy']['sha256'], 'policySha256': m.POLICY, 'priorAmendmentExposureMicros': m.CARRY,
            'importedJobKeysSha256': self.freeze['study']['importedJobKeysSha256']}
        admission = {'protocol': 'oh.memory-gateway-batch-admission.v6', **identity, 'start': iso(start), 'maximumNewCalls': maximum,
            'concurrency': 4, 'openingLedgerExposureMicros': before_exposure, 'initialJobKeysSha256': m.js_hash(sorted(j['key'] for j in self.jobs[:before])), 'qualified': q}
        admission_pin = self.put(self.study / f'batch-{run}-started.json', admission)
        result = {'status': 'completed', 'phase': 'judge', 'resolved': 360, 'required': 360, 'modelJudgedCases': 358, 'policyScoredReaderFailures': 2, 'physicalJudgeRequests': 8} if final else {'status': 'paused', 'phase': 'judge', 'resolved': 4, 'required': 8}
        comparison = self.put(self.study / f'comparison-{run}.json', self.comparison()) if final else None
        batch = {'protocol': 'oh.memory-gateway-batch.v6', **identity, 'start': iso(start), 'end': iso(start + 10), 'admission': admission_pin, 'maximumNewCalls': maximum,
            'concurrency': 4, 'newTransportInvocations': count, 'admittedKeys': [j['key'] for j in selected],
            'initialJobKeys': sorted(j['key'] for j in self.jobs[:before]), 'finalJobKeys': sorted(j['key'] for j in self.jobs[:self.frontier]),
            'failed': False, 'interrupted': False, 'stopReason': None if final else 'call-limit', 'storeClosed': True, 'sourceVerifiedAtClose': True, 'importVerifiedAtClose': True,
            'originalLedgerVerifiedAtClose': True, 'qualified': q,
            'ledger': {'path': str(self.study / 'ledger.jsonl'), 'bytes': len(raw), 'sha256': m.digest(raw), 'exposureMicros': self.exposure,
                'priorAmendmentExposureMicros': m.CARRY, 'totalAmendmentExposureMicros': m.CARRY + self.exposure,
                'budget': {'capUsd': 40, 'maxCalls': maximum, 'reservedCalls': count, 'historicalExposureUsd': 21.655385,
                    'priorAmendmentExposureUsd': (m.CARRY + before_exposure) / 1e6, 'accountedUsd': (m.CARRY + self.exposure) / 1e6,
                    'confirmedThisRunUsd': (self.exposure - before_exposure) / 1e6, 'unresolvedThisRunUsd': 0, 'billedUsd': None}},
            'comparisonArtifact': comparison, 'result': result}
        closure = self.put(self.study / f'batch-{run}.json', batch)
        folder = self.work / f'gateway-study-v6-batch-{number:03}'; folder.mkdir(mode=0o700)
        argv = [str(self.context.vercel), 'env', 'run', '--project', self.context.project, '--scope', self.context.scope, '--environment', 'development', '--', str(self.context.bun),
            str(self.runtime / 'scripts/benchmarks/gateway-study-v6.ts'), 'run', '--directory', str(self.study), '--freeze-sha256', self.fs, '--max-new-calls', str(maximum)]
        config = {'argv': argv, 'cwd': str(self.runtime), 'jobDir': str(folder), 'requireAbsent': list(map(str, [*self.context.locks, self.study / 'active.lock']))}
        cp = self.put(folder / 'config.json', m.canonical(config)); self.put(self.work / f'gateway-study-v6-batch-{number:03}-launch-config.json', m.canonical(config))
        status = {'state': 'exited', 'supervisorPid': number * 100 + 1, 'supervisorStart': f'super-{number}', 'bootIdentity': 'fixture-boot', 'commandSha256': m.digest(m.canonical(argv)),
            'configSha256': cp['sha256'], 'startedAt': seconds(start - 1), 'childPid': number * 100 + 2, 'childPgid': number * 100 + 2,
            'childStart': f'child-{number}', 'exitCode': 0, 'groupGone': True, 'finishedAt': seconds(start + 11)}
        self.put(folder / 'status.json', status)
        return batch, closure

    def comparison(self):
        readers = [{'ordinal': i, 'status': 'terminal-reader-failure' if i in [331, 333] else 'completed', 'prediction': {'opaque': True}, 'tokenF1': {'opaque': True}} for i in range(360)]
        cases = [{'ordinal': i, 'status': r['status'], 'correct': {'opaque': True}} for i, r in enumerate(readers)]
        return {'protocol': 'oh.memory-gateway-study.v6', 'freezeSha256': self.fs, 'study': self.freeze['study'], 'procedure': self.freeze['procedure'],
            'originalStudiesStatus': 'incomplete', 'importedGatewayV5Status': 'blocked', 'importedV5': {},
            'extraction': {'imported': {}, 'priorGateway': {}, 'priorContinuation': {}, 'rows': [{}] * 4732}, 'readers': readers, 'scoredCases': cases,
            'physicalJudgeResults': [{'jobKey': j['key'], 'requestSha256': j['requestSha256'], 'correct': {'opaque': True}, 'response': {'opaque': True}} for j in self.jobs[28:]],
            'assessment': {'opaque': True}}

    def invoke(self, number, previous=None, now=None, failure=None, diagnosis=None, snapshot=None):
        with ExitStack() as s:
            s.enter_context(patch.object(m, 'foundations', return_value=self.data))
            s.enter_context(patch.object(m.gc, 'verify_context'))
            s.enter_context(patch.object(m.gc, 'validate_study_binding'))
            s.enter_context(patch.object(m, 'source_identity', return_value=[]))
            s.enter_context(patch.object(m, 'now_iso', return_value=now or iso(number * 100 + 12)))
            ps = s.enter_context(patch.object(m.subprocess, 'run', return_value=type('Snapshot', (), {'stdout': snapshot or '1 0 1 /sbin/launchd\n'})()))
            result = m.accept_pre_native_failure(self.context, number, self.fs, self.ss, self.ips, diagnosis, self.global_reservation['sha256']) if diagnosis else m.close_batch(self.context, number, self.fs, self.ss, self.ips, previous, failure)
            self.assert_ps(ps)
            return result

    def failed_initial_launcher(self):
        (self.study / 'jobs').rmdir(); (self.study / 'store.json').unlink()
        self.fs = m.digest((self.study / 'freeze.json').read_bytes()); self.data['freezePin']['sha256'] = self.fs
        folder = self.work / 'gateway-study-v6-batch-001'; folder.mkdir(mode=0o700)
        argv = [str(self.context.vercel), 'env', 'run', '--project', self.context.project, '--scope', self.context.scope, '--environment', 'development', '--', str(self.context.bun),
            str(self.runtime / 'scripts/benchmarks/gateway-study-v6.ts'), 'run', '--directory', str(self.study), '--freeze-sha256', self.fs, '--max-new-calls', '32']
        config = {'argv': argv, 'cwd': str(self.runtime), 'jobDir': str(folder), 'requireAbsent': list(map(str, [*self.context.locks, self.study / 'active.lock']))}
        cp = self.put(folder / 'config.json', m.canonical(config)); self.put(self.work / 'gateway-study-v6-batch-001-launch-config.json', m.canonical(config))
        status = {'state': 'exited', 'supervisorPid': 101, 'supervisorStart': 'failed-super-1', 'bootIdentity': 'fixture-boot', 'commandSha256': m.digest(m.canonical(argv)),
            'configSha256': cp['sha256'], 'startedAt': seconds(99), 'childPid': 102, 'childPgid': 102,
            'childStart': 'failed-child-1', 'exitCode': 1, 'groupGone': True, 'finishedAt': seconds(110)}
        sp = self.put(folder / 'status.json', status)
        lp = self.put(folder / 'log', b'Vercel CLI 58.4.0 (Node.js 24.20.0)\nError: You do not have access to the specified account\nLearn More: https://err.sh/vercel/scope-not-accessible\n')
        extended = lambda pin: {**pin, 'bytes': Path(pin['path']).stat().st_size}
        diagnosis = {'schema': 'oh.gateway-v6-pre-native-launch-failure.v1', 'recordedAt': (T + dt.timedelta(seconds=111)).isoformat(timespec='microseconds'),
            'status': 'vercel-scope-inaccessible-before-native-runner', 'supervisorStatus': extended(sp), 'log': extended(lp), 'configuration': extended(cp),
            'diagnostic': 'Vercel CLI 58.4.0: You do not have access to the specified account; scope-not-accessible',
            'nativeStudyFiles': ['freeze.json', 'preparation.json'], 'nativeAdmissions': 0, 'v6JobRequests': 0, 'v6LedgerExists': False, 'modelCalls': 0,
            'totalAmendmentExposureMicros': m.CARRY, 'automaticRetryPermitted': False,
            'qualification': 'Supervisor metadata and absence of all native run artifacts; fresh OS closure proof remains required before any recovery dispatch.'}
        pin = self.put(self.work / 'gateway-v6-pre-native-launch-failure.json', diagnosis)
        self.make_global_budget()
        return pin

    def make_global_budget(self):
        self.global_ledgers = []
        amounts = [1_000_000, 2_000_000, m.CARRY - 3_000_000, m.GLOBAL_PRIOR - m.CARRY]
        folders = ['gateway-study-v3', 'gateway-study-v4', 'gateway-study-v5', 'synthetic-lab']
        for i, (folder, amount) in enumerate(zip(folders, amounts)):
            parent = self.work / folder; parent.mkdir(mode=0o700)
            reserved = {'v': 1, 'id': H(f'prior-global-{i}'), 'kind': 'reserved', 'micros': amount if i == 2 else amount + 1000}
            events = [reserved] if i == 2 else [reserved, {**reserved, 'kind': 'settled', 'micros': amount}]
            path = parent / 'ledger.jsonl'; pin = self.put(path, b''.join(m.canonical(e) + b'\n' for e in events))
            self.global_ledgers.append({**pin, 'bytes': path.stat().st_size})
        original_path = self.work / 'original-pilot.jsonl'; original_pin = self.put(original_path, b'original opaque pilot ledger\n')
        original = {**original_pin, 'bytes': original_path.stat().st_size, 'exposureMicros': 21_655_385}
        self.data['oldLedgers'] = [*self.global_ledgers[:2], {k: original[k] for k in ['path', 'sha256', 'bytes']}, self.global_ledgers[2]]
        authority = {'schema': 'oh.gateway-v3-authority.v1', 'maximumNewExposureMicros': m.CAP, 'originalLedger': original}
        self.freeze['authority'] = self.put(self.work / 'frozen-authority.json', authority)
        self.freeze['originalLedger'] = original
        authority_pin = self.put(self.work / 'copied-authority.json', authority)
        self.global_descriptor = {'authority': authority_pin, 'ledgers': self.global_ledgers,
            'expectedExposureMicros': m.GLOBAL_PRIOR, 'absentLedgerPaths': [str(self.study / 'ledger.jsonl')]}
        descriptor_pin = self.put(self.work / 'synthetic-global-budget-input.json', self.global_descriptor)
        self.global_value = {'protocol': 'oh.gateway-v6-global-budget-reservation.v1', 'recordedAt': iso(111), 'freeze': self.data['freezePin'],
            'sourceSha256': self.ss, 'sourceGitHead': self.freeze['sourceGitHead'], 'budgetInput': descriptor_pin,
            'priorExposureMicros': m.GLOBAL_PRIOR, 'maximumNewExposureMicros': m.GLOBAL_MAXIMUM, 'capMicros': m.CAP, 'bound': dict(m.GLOBAL_BOUND)}
        self.global_reservation = self.put(self.work / 'gateway-v6-global-budget-reservation.json', self.global_value)

    def reseal_global_budget(self):
        self.global_value['budgetInput'] = self.put(self.work / 'synthetic-global-budget-input.json', self.global_descriptor)
        self.global_reservation = self.put(self.work / 'gateway-v6-global-budget-reservation.json', self.global_value)

    def start_native(self):
        (self.study / 'jobs').mkdir(mode=0o700); self.put(self.study / 'store.json', {'protocol': m.STORE, 'freezeSha256': self.fs})

    @staticmethod
    def assert_ps(ps):
        ps.assert_called_once_with(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], stdout=m.subprocess.PIPE, stderr=m.subprocess.PIPE, text=True, check=True, timeout=15)


class ClosureTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        return Fixture(Path(temporary.name).resolve())

    def test_zero_native_failure_then_physical_two_and_three_complete(self):
        f = self.fixture(); diagnosis = f.failed_initial_launcher()
        original = {str(p): p.read_bytes() for p in [*f.study.iterdir(), *[p for p in (f.work / 'gateway-study-v6-batch-001').iterdir()], Path(diagnosis['path'])]}
        failure = f.invoke(1, diagnosis=diagnosis['sha256'])
        self.assertEqual(failure['nativeAdmissions'], 0); self.assertEqual(failure['totalAmendmentExposureMicros'], m.CARRY)
        accepted_failure = m.decode(Path(failure['acceptance']['path']).read_bytes())
        self.assertEqual(accepted_failure['producer']['supervisorPid'], 101)
        self.assertEqual(accepted_failure['sourceGitHead'], f.freeze['sourceGitHead'])
        self.assertFalse(m.output_paths(f.work, 1)['acceptance'].exists())
        self.assertEqual([r['path'] for r in m.decode(Path(failure['inventory']['path']).read_bytes())['files']], ['freeze.json', 'preparation.json'])
        f.start_native(); first_batch, _ = f.batch(2, 32, native_number=1)
        first = f.invoke(2, failure=failure['acceptance']['sha256'])
        self.assertEqual(first_batch['maximumNewCalls'], 32)
        first_accepted = m.decode(Path(first['acceptance']['path']).read_bytes())
        self.assertEqual(first_accepted['schema'], m.RECOVERY_ACCEPTANCE)
        self.assertEqual(first_accepted['nativeBatchNumber'], 1); self.assertIsNone(first_accepted['previousAcceptance'])
        self.assertEqual(first_accepted['preNativeFailureAcceptance'], failure['acceptance'])
        self.assertEqual(first_accepted['globalTaskAccounting'], {'reservation': f.global_reservation, 'priorExposureMicros': m.GLOBAL_PRIOR,
            'nativeExposureMicros': f.exposure, 'totalExposureMicros': m.GLOBAL_PRIOR + f.exposure})
        second_batch, _ = f.batch(3, 4, final=True, native_number=2)
        second = f.invoke(3, first['acceptance']['sha256'], failure=failure['acceptance']['sha256'])
        self.assertEqual(second_batch['maximumNewCalls'], 256); self.assertEqual(second['nativeBatchNumber'], 2)
        self.assertTrue(second['finalAuditInputsPrepared'])
        closure = m.decode(Path(second['supervisorClosure']['path']).read_bytes())
        self.assertEqual(closure['schema'], 'oh.gateway-final-supervisor-closure.v6.1')
        self.assertEqual(closure['preNativeFailures'], [failure['acceptance']]); self.assertEqual(len(closure['runs']), 2)
        self.assertEqual([Path(r['configuration']['path']).parent.name for r in closure['runs']], ['gateway-study-v6-batch-002', 'gateway-study-v6-batch-003'])
        self.assertTrue(all(r['runnerExitCode'] == 0 for r in closure['runs']))
        receipt = m.decode(Path(second['finalPreparation']['path']).read_bytes())
        self.assertEqual(receipt['launcherAttempts'], 3); self.assertEqual(receipt['nativeBatchCount'], 2)
        self.assertEqual(receipt['globalTaskAccounting']['totalExposureMicros'], m.GLOBAL_PRIOR + f.exposure)
        self.assertEqual(set(m.decode(Path(second['configuration']['path']).read_bytes())), {'runtimeRoot', 'expectedSourceSha256', 'studyDirectory', 'freeze', 'finalBatch', 'comparison', 'inventory', 'supervisorClosure'})
        for path, raw in original.items(): self.assertEqual(Path(path).read_bytes(), raw)
        for p in m.pre_native_paths(f.work).values(): self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def test_pre_native_rejects_any_native_artifact_before_process(self):
        for artifact in ['ledger.jsonl', 'store.json', 'jobs', 'active.lock', 'batch-00000000-0000-4000-8000-000000000001-started.json']:
            with self.subTest(artifact=artifact):
                f = self.fixture(); diagnosis = f.failed_initial_launcher(); path = f.study / artifact
                if artifact == 'jobs': path.mkdir(mode=0o700)
                else: f.put(path, b'')
                with patch.object(m, 'fresh_process_proof') as ps, self.assertRaises(m.Rejected): f.invoke(1, diagnosis=diagnosis['sha256'])
                ps.assert_not_called(); self.assertFalse(m.pre_native_paths(f.work)['acceptance'].exists())

    def test_pre_native_pins_route_exit_and_log_are_strict(self):
        for changed in ['configuration', 'supervisorStatus', 'log', 'diagnosis', 'route', 'cap', 'locks', 'retained', 'exit', 'group', 'diagnosis-carry', 'diagnosis-bytes']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher(); diagnosis = m.decode(Path(dp['path']).read_bytes()); folder = f.work / 'gateway-study-v6-batch-001'
                if changed in ['configuration', 'supervisorStatus', 'log']: f.put(Path(diagnosis[changed]['path']), b'changed')
                elif changed == 'diagnosis': f.put(Path(dp['path']), {**diagnosis, 'extra': True})
                elif changed == 'retained': f.put(f.work / 'gateway-study-v6-batch-001-launch-config.json', b'changed')
                else:
                    if changed in ['route', 'cap', 'locks']:
                        p = folder / 'config.json'; value = m.decode(p.read_bytes())
                        if changed == 'route': value['argv'][value['argv'].index('--scope') + 1] = 'other-scope'
                        elif changed == 'cap': value['argv'][-1] = '256'
                        else: value['requireAbsent'].pop()
                        pin = f.put(p, m.canonical(value)); f.put(f.work / 'gateway-study-v6-batch-001-launch-config.json', m.canonical(value)); diagnosis['configuration'] = {**pin, 'bytes': p.stat().st_size}
                        status_path = folder / 'status.json'; status = m.decode(status_path.read_bytes()); status.update({'commandSha256': m.digest(m.canonical(value['argv'])), 'configSha256': pin['sha256']})
                        pin = f.put(status_path, status); diagnosis['supervisorStatus'] = {**pin, 'bytes': status_path.stat().st_size}
                    elif changed in ['exit', 'group']:
                        p = folder / 'status.json'; value = m.decode(p.read_bytes()); value['exitCode' if changed == 'exit' else 'groupGone'] = 0 if changed == 'exit' else False
                        pin = f.put(p, value); diagnosis['supervisorStatus'] = {**pin, 'bytes': p.stat().st_size}
                    elif changed == 'diagnosis-carry': diagnosis['totalAmendmentExposureMicros'] -= 1
                    elif changed == 'diagnosis-bytes': diagnosis['log']['bytes'] -= 1
                    dp = f.put(Path(dp['path']), diagnosis)
                with patch.object(m, 'fresh_process_proof') as ps, self.assertRaises(m.Rejected): f.invoke(1, diagnosis=dp['sha256'])
                ps.assert_not_called()

    def test_pre_native_initial_only_and_complete_registry(self):
        for changed in ['number', 'extra-launch', 'extra-config', 'ordinary-receipt', 'other-failure', 'extra-producer-file']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher()
                if changed == 'extra-launch': (f.work / 'gateway-study-v6-batch-002').mkdir(mode=0o700)
                if changed == 'extra-config': f.put(f.work / 'gateway-study-v6-batch-002-launch-config.json', {})
                if changed == 'ordinary-receipt': f.put(m.output_paths(f.work, 1)['acceptance'], {})
                if changed == 'other-failure': f.put(f.work / 'gateway-v6-launch-002-pre-native-acceptance.json', {})
                if changed == 'extra-producer-file': f.put(f.work / 'gateway-study-v6-batch-001/extra', b'')
                with self.assertRaises(m.Rejected): f.invoke(2 if changed == 'number' else 1, diagnosis=dp['sha256'])

    def test_pre_native_live_producers_and_freshness_rejected(self):
        for snapshot in ['101 1 101 synthetic\n', '102 1 102 synthetic\n', '777 1 102 synthetic\n', '777 1 777 bun gateway-study-v6.ts run\n']:
            f = self.fixture(); dp = f.failed_initial_launcher()
            with self.subTest(snapshot=snapshot), self.assertRaises(m.Rejected): f.invoke(1, diagnosis=dp['sha256'], snapshot=snapshot)
        f = self.fixture(); dp = f.failed_initial_launcher()
        stale = {'argv': ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], 'checkedAt': iso(111), 'sha256': H('snapshot'), 'rows': 1, 'matchedProducers': 0}
        with patch.object(m, 'fresh_process_proof', return_value=stale), self.assertRaisesRegex(m.Rejected, 'process-proof-stale'):
            f.invoke(1, diagnosis=dp['sha256'], now=iso(200))
        self.assertFalse(m.pre_native_paths(f.work)['acceptance'].exists())

    def test_pre_native_symlink_and_occupied_output_preserve_evidence(self):
        for changed in ['foundation-link', 'status-link', 'output']:
            f = self.fixture(); dp = f.failed_initial_launcher()
            if changed == 'foundation-link':
                path = f.study / 'preparation.json'; path.unlink(); path.symlink_to(f.study / 'freeze.json')
            elif changed == 'status-link':
                path = f.work / 'gateway-study-v6-batch-001/status.json'; raw = path.read_bytes(); f.put(f.work / 'status-copy.json', raw); path.unlink(); path.symlink_to(f.work / 'status-copy.json')
            else: f.put(m.pre_native_paths(f.work)['acceptance'], b'occupied')
            with self.subTest(changed=changed), self.assertRaises((m.Rejected, OSError)): f.invoke(1, diagnosis=dp['sha256'])
            if changed == 'output': self.assertEqual(m.pre_native_paths(f.work)['acceptance'].read_bytes(), b'occupied')

    def test_recovery_rejects_missing_changed_or_resealed_failure_and_caps(self):
        for changed in ['missing-root', 'changed-root', 'native-number', 'wrong-cap', 'missing-prefix', 'reseeded-first-success', 'before-acceptance', 'foundation']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher(); failure = f.invoke(1, diagnosis=dp['sha256'])
                f.start_native(); f.batch(2, 32, native_number=None if changed == 'wrong-cap' else 1, start=111 if changed == 'before-acceptance' else None)
                failure_sha = failure['acceptance']['sha256']; previous = None
                if changed == 'missing-root': failure_sha = None; previous = H('invented')
                if changed == 'changed-root': f.put(Path(failure['acceptance']['path']), {})
                if changed == 'native-number':
                    p = Path(failure['acceptance']['path']); value = m.decode(p.read_bytes()); value['launchNumber'] = 2; failure_sha = f.put(p, value)['sha256']
                if changed == 'missing-prefix': (f.work / 'gateway-study-v6-batch-001-launch-config.json').unlink()
                if changed == 'reseeded-first-success': previous = H('extra')
                if changed == 'foundation': f.put(f.study / 'preparation.json', {'changed': True})
                with self.assertRaises((m.Rejected, FileNotFoundError)): f.invoke(2, previous, failure=failure_sha)

    def test_recovery_recursive_success_chain_binds_same_failure_root(self):
        f = self.fixture(); dp = f.failed_initial_launcher(); failure = f.invoke(1, diagnosis=dp['sha256']); f.start_native()
        f.batch(2, 32, native_number=1); first = f.invoke(2, failure=failure['acceptance']['sha256'])
        f.batch(3, 4, final=True, native_number=2)
        path = Path(first['acceptance']['path']); value = m.decode(path.read_bytes()); value['preNativeFailureAcceptance']['sha256'] = H('other-failure')
        resealed = f.put(path, value)
        with self.assertRaisesRegex(m.Rejected, 'acceptance-failure-root'): f.invoke(3, resealed['sha256'], failure=failure['acceptance']['sha256'])

    def test_recovery_retains_native_failure_admission_and_later_cap_rejection(self):
        for changed in ['failed', 'interrupted', 'missing-admission', 'later-cap', 'skipped-chain']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher(); failure = f.invoke(1, diagnosis=dp['sha256']); f.start_native()
                f.batch(2, 32, native_number=1); first = f.invoke(2, failure=failure['acceptance']['sha256'])
                b, pin = f.batch(3, 4, final=True, native_number=1 if changed == 'later-cap' else 2)
                if changed in ['failed', 'interrupted']: b[changed] = True; f.put(Path(pin['path']), b)
                if changed == 'missing-admission': Path(b['admission']['path']).unlink()
                previous = first['acceptance']['sha256']
                if changed == 'skipped-chain':
                    p = Path(first['acceptance']['path']); accepted = m.decode(p.read_bytes()); accepted['previousAcceptance'] = failure['acceptance']; previous = f.put(p, accepted)['sha256']
                with self.assertRaises((m.Rejected, FileNotFoundError)): f.invoke(3, previous, failure=failure['acceptance']['sha256'])

    def test_failure_prefix_authentication_precedes_native_result_reads(self):
        f = self.fixture(); dp = f.failed_initial_launcher(); failure = f.invoke(1, diagnosis=dp['sha256']); f.start_native(); f.batch(2, 32, native_number=1)
        f.put(f.work / 'gateway-study-v6-batch-001/log', b'changed')
        with patch.object(m, 'job_metadata') as jobs, patch.object(m, 'fresh_process_proof') as ps, self.assertRaisesRegex(m.Rejected, 'pinned-file-changed'):
            f.invoke(2, failure=failure['acceptance']['sha256'])
        jobs.assert_not_called(); ps.assert_not_called()

    def test_pre_native_rechecks_directory_after_mocked_snapshot(self):
        f = self.fixture(); dp = f.failed_initial_launcher()
        proof = {'argv': ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], 'checkedAt': iso(112), 'sha256': H('snapshot'), 'rows': 1, 'matchedProducers': 0}
        def mutate(*_):
            (f.study / 'jobs').mkdir(mode=0o700)
            return proof
        with patch.object(m, 'fresh_process_proof', side_effect=mutate), self.assertRaisesRegex(m.Rejected, 'custody-directory-changed'):
            f.invoke(1, diagnosis=dp['sha256'])
        self.assertFalse(m.pre_native_paths(f.work)['acceptance'].exists())

    def test_global_reservation_ancestry_replays_unresolved_and_distinct_authority_copy(self):
        f = self.fixture(); dp = f.failed_initial_launcher()
        self.assertNotEqual(f.freeze['authority']['path'], f.global_descriptor['authority']['path'])
        self.assertEqual(f.freeze['authority']['sha256'], f.global_descriptor['authority']['sha256'])
        failure = f.invoke(1, diagnosis=dp['sha256'])
        value = m.decode(Path(failure['acceptance']['path']).read_bytes())
        self.assertEqual(value['globalBudgetReservation'], f.global_reservation)
        self.assertEqual(len(m.global_ledger_events(Path(f.global_ledgers[2]['path']).read_bytes())), 1)
        checked = m.verify_global_budget(m.Reads(), f.context, f.data, f.global_reservation)
        self.assertEqual(len(checked['priorIds']), 4)

    def test_global_reservation_changed_bounds_authority_and_missing_anchor_rejected(self):
        for changed in ['prior', 'maximum', 'bound', 'source', 'freeze', 'extra-field', 'missing-anchor', 'authority', 'original-pilot', 'missing-native-absence', 'duplicate-path', 'future']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher()
                if changed == 'prior': f.global_value['priorExposureMicros'] -= 1
                if changed == 'maximum': f.global_value['maximumNewExposureMicros'] += 1
                if changed == 'bound': f.global_value['bound']['knownPhysicalJudgeRequests'] -= 1
                if changed == 'source': f.global_value['sourceSha256'] = H('changed')
                if changed == 'freeze': f.global_value['freeze'] = {**f.global_value['freeze'], 'sha256': H('changed')}
                if changed == 'extra-field': f.global_value['extra'] = True
                if changed == 'missing-anchor': f.global_descriptor['ledgers'].pop(0)
                if changed == 'authority': f.global_descriptor['authority'] = f.put(f.work / 'different-authority.json', {'different': True})
                if changed == 'original-pilot': f.global_descriptor['ledgers'].append(f.data['oldLedgers'][2])
                if changed == 'missing-native-absence': f.global_descriptor['absentLedgerPaths'] = [str(f.work / 'different-absent.jsonl')]
                if changed == 'duplicate-path': f.global_descriptor['absentLedgerPaths'].append(f.global_descriptor['ledgers'][0]['path'])
                if changed == 'future': f.global_value['recordedAt'] = iso(200)
                f.reseal_global_budget()
                with self.assertRaises(m.Rejected): f.invoke(1, diagnosis=dp['sha256'])
                self.assertFalse(m.pre_native_paths(f.work)['acceptance'].exists())

    def test_global_historical_prefix_duplicate_ids_and_partial_lines_rejected(self):
        for changed in ['prefix', 'duplicate-id', 'partial-line', 'negative', 'duplicate-json', 'settlement-over-reservation', 'exposure']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher(); path = Path(f.global_ledgers[-1]['path'])
                events = m.global_ledger_events(path.read_bytes())
                if changed == 'prefix': events[0]['micros'] = m.CAP - m.CARRY + 1
                if changed == 'duplicate-id':
                    for e in events: e['id'] = H('prior-global-0')
                if changed == 'negative': events[0]['micros'] = -1
                if changed == 'settlement-over-reservation': events[1]['micros'] = events[0]['micros'] + 1
                if changed == 'exposure': events[1]['micros'] -= 1
                raw = b''.join(m.canonical(e) + b'\n' for e in events)
                if changed == 'partial-line': raw = raw[:-1]
                if changed == 'duplicate-json': raw = raw.replace(b'"v":1', b'"v":1,"v":1')
                pin = f.put(path, raw); f.global_descriptor['ledgers'][-1] = {**pin, 'bytes': len(raw)}; f.reseal_global_budget()
                with patch.object(m, 'fresh_process_proof') as ps, self.assertRaises(m.Rejected): f.invoke(1, diagnosis=dp['sha256'])
                ps.assert_not_called()

    def test_global_native_prefix_bound_and_prior_id_collision_rejected(self):
        budget = {'priorIds': {H('prior')}}
        for changed in ['prior-id', 'bound', 'global-cap']:
            amount = m.GLOBAL_MAXIMUM + 1 if changed == 'bound' else m.CAP - m.GLOBAL_PRIOR + 1 if changed == 'global-cap' else 1
            event = {'v': 1, 'id': H('prior' if changed == 'prior-id' else 'new'), 'kind': 'reserved', 'micros': amount}
            with self.subTest(changed=changed), self.assertRaises(m.Rejected): m.verify_global_native([event, {**event, 'kind': 'settled', 'micros': 0}], budget)
        event = {'v': 1, 'id': H('new'), 'kind': 'reserved', 'micros': m.GLOBAL_MAXIMUM}
        self.assertEqual(m.verify_global_native([event, {**event, 'kind': 'settled', 'micros': 17}], budget), 17)

    def test_global_recovery_checks_unchanged_ancestry_and_other_absences(self):
        for changed in ['prior-ledger', 'reservation', 'other-absence', 'missing-budget-pin']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher(); other = f.work / 'other-absent-ledger.jsonl'
                f.global_descriptor['absentLedgerPaths'].append(str(other)); f.reseal_global_budget()
                failure = f.invoke(1, diagnosis=dp['sha256']); f.start_native(); f.batch(2, 32, native_number=1)
                if changed == 'prior-ledger': f.put(Path(f.global_ledgers[-1]['path']), b'changed\n')
                if changed == 'reservation': f.put(Path(f.global_reservation['path']), {})
                if changed == 'other-absence': f.put(other, b'')
                if changed == 'missing-budget-pin':
                    path = Path(failure['acceptance']['path']); value = m.decode(path.read_bytes()); del value['globalBudgetReservation']; failure['acceptance'] = f.put(path, value)
                with patch.object(m, 'job_metadata') as jobs, self.assertRaises((m.Rejected, KeyError)):
                    f.invoke(2, failure=failure['acceptance']['sha256'])
                jobs.assert_not_called()

    def test_global_ancestry_and_absences_rechecked_after_process_snapshot(self):
        for changed in ['ledger', 'absent']:
            with self.subTest(changed=changed):
                f = self.fixture(); dp = f.failed_initial_launcher(); other = f.work / 'other-absent-ledger.jsonl'
                f.global_descriptor['absentLedgerPaths'].append(str(other)); f.reseal_global_budget()
                proof = {'argv': ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], 'checkedAt': iso(112), 'sha256': H('snapshot'), 'rows': 1, 'matchedProducers': 0}
                def mutate(*_):
                    f.put(Path(f.global_ledgers[-1]['path']) if changed == 'ledger' else other, b'changed\n')
                    return proof
                with patch.object(m, 'fresh_process_proof', side_effect=mutate), self.assertRaises(m.Rejected): f.invoke(1, diagnosis=dp['sha256'])
                self.assertFalse(m.pre_native_paths(f.work)['acceptance'].exists())

    def test_paused_then_complete_history_and_exact_final_config(self):
        f = self.fixture(); f.batch(1, 32)
        first = f.invoke(1)
        self.assertFalse(first['finalAuditInputsPrepared']); self.assertFalse(any(p.exists() for p in m.final_paths(f.work).values()))
        first_raw = Path(first['acceptance']['path']).read_bytes(); initial_ledger = (f.study / 'ledger.jsonl').read_bytes()
        f.batch(2, 4, final=True); second = f.invoke(2, first['acceptance']['sha256'])
        self.assertTrue(second['finalAuditInputsPrepared']); self.assertEqual(second['totalNewJobCount'], 36)
        self.assertEqual(Path(first['acceptance']['path']).read_bytes(), first_raw)
        self.assertTrue((f.study / 'ledger.jsonl').read_bytes().startswith(initial_ledger))
        config = m.decode(Path(second['configuration']['path']).read_bytes())
        self.assertEqual(set(config), {'runtimeRoot', 'expectedSourceSha256', 'studyDirectory', 'freeze', 'finalBatch', 'comparison', 'inventory', 'supervisorClosure'})
        closure = m.decode(Path(second['supervisorClosure']['path']).read_bytes())
        self.assertEqual(len(closure['runs']), 2); self.assertTrue(all(r['runnerExitCode'] == 0 for r in closure['runs']))
        accepted = m.decode(Path(second['acceptance']['path']).read_bytes())
        self.assertEqual(accepted['previousAcceptance'], first['acceptance'])
        self.assertEqual(accepted['importPreparation'], f.data['importPreparation'])
        self.assertEqual(accepted['totalAmendmentExposureMicros'], m.CARRY + f.exposure)
        for p in [*m.output_paths(f.work, 1).values(), *m.output_paths(f.work, 2).values(), *m.final_paths(f.work).values()]:
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def test_missing_admission_prevents_os_query_and_output(self):
        f = self.fixture(); b, _ = f.batch(1, 32); Path(b['admission']['path']).unlink()
        with patch.object(m.subprocess, 'run') as ps, self.assertRaises(FileNotFoundError): f.invoke(1)
        ps.assert_not_called(); self.assertFalse(m.output_paths(f.work, 1)['acceptance'].exists())

    def test_imported_key_cannot_be_dispatched(self):
        f = self.fixture(); f.batch(1, 32); f.data['importedKeys'] = [f.jobs[0]['key']]
        with self.assertRaisesRegex(m.Rejected, 'imported-job-regenerated'): f.invoke(1)

    def test_occupied_receipt_is_never_overwritten(self):
        f = self.fixture(); f.batch(1, 32); target = m.output_paths(f.work, 1)['acceptance']; target.write_bytes(b'occupied')
        with self.assertRaisesRegex(m.Rejected, 'occupied-output'): f.invoke(1)
        self.assertEqual(target.read_bytes(), b'occupied')

    def test_unexplained_file_and_changed_previous_inventory_rejected(self):
        for mode in ['extra', 'old-raw']:
            with self.subTest(mode=mode):
                f = self.fixture(); f.batch(1, 32); first = f.invoke(1); f.batch(2, 4, final=True)
                if mode == 'extra': f.put(f.study / 'unexpected.json', {})
                else: f.put(f.study / 'jobs' / f.jobs[0]['key'] / 'response.body', b'changed')
                with self.assertRaises(m.Rejected): f.invoke(2, first['acceptance']['sha256'])

    def test_resealing_prior_acceptance_cannot_bypass_anchor(self):
        f = self.fixture(); f.batch(1, 32); first = f.invoke(1); f.batch(2, 4, final=True)
        p = Path(first['acceptance']['path']); value = m.decode(p.read_bytes()); value['number'] = 99; f.put(p, value)
        with self.assertRaisesRegex(m.Rejected, 'pinned-file-changed'): f.invoke(2, first['acceptance']['sha256'])

    def test_acceptance_must_precede_next_producer(self):
        f = self.fixture(); f.batch(1, 32); first = f.invoke(1, now=iso(210)); f.batch(2, 4, final=True)
        with self.assertRaisesRegex(m.Rejected, 'overlapping-producer-custody'): f.invoke(2, first['acceptance']['sha256'])

    def test_judge_owner_total_cannot_change_across_accepted_batches(self):
        f = self.fixture(); batch, pin = f.batch(1, 32)
        batch['result']['required'] = 9; f.put(Path(pin['path']), batch)
        first = f.invoke(1); f.batch(2, 4, final=True)
        with self.assertRaisesRegex(m.Rejected, 'judge-owner-total-changed'): f.invoke(2, first['acceptance']['sha256'])

    def test_missing_previous_anchor_and_extra_genesis_anchor(self):
        f = self.fixture()
        for number, previous in [(1, H('extra')), (2, None)]:
            with self.subTest(number=number), self.assertRaisesRegex(m.Rejected, 'previous-acceptance-required'): f.invoke(number, previous)

    def test_bad_native_flags_carry_and_frontiers_rejected(self):
        for mutate in ['closed', 'carry', 'call-limit', 'reader-order', 'missing-sibling']:
            with self.subTest(mutate=mutate):
                f = self.fixture(); b, pin = f.batch(1, 32)
                if mutate == 'closed': b['storeClosed'] = False
                if mutate == 'carry': b['ledger']['totalAmendmentExposureMicros'] -= m.CARRY
                if mutate == 'call-limit': b['stopReason'] = 'budget'
                if mutate == 'missing-sibling': b['admittedKeys'].pop()
                if mutate == 'reader-order':
                    path = f.study / 'jobs' / f.jobs[0]['key'] / 'pending.json'; p = m.decode(path.read_bytes()); p['ordinal'] += 1; f.put(path, p)
                f.put(Path(pin['path']), b)
                with self.assertRaises(m.Rejected): f.invoke(1)

    def test_supervisor_scope_and_retained_config_are_exact(self):
        for mutate in ['scope', 'retained', 'exit', 'group']:
            with self.subTest(mutate=mutate):
                f = self.fixture(); f.batch(1, 32); folder = f.work / 'gateway-study-v6-batch-001'
                if mutate in ['scope', 'retained']:
                    path = folder / 'config.json' if mutate == 'scope' else f.work / 'gateway-study-v6-batch-001-launch-config.json'
                    c = m.decode(path.read_bytes()); c['argv'][4] = 'wrong-project'; f.put(path, m.canonical(c))
                else:
                    p = folder / 'status.json'; s = m.decode(p.read_bytes()); s['exitCode' if mutate == 'exit' else 'groupGone'] = 1 if mutate == 'exit' else False; f.put(p, s)
                with self.assertRaises(m.Rejected): f.invoke(1)

    def test_every_combined_ledger_prefix_is_bounded(self):
        a, b = H('a'), H('b')
        events = [{'v': 1, 'id': a, 'kind': 'reserved', 'micros': 20_000_000}, {'v': 1, 'id': b, 'kind': 'reserved', 'micros': 20_000_000},
                  {'v': 1, 'id': a, 'kind': 'settled', 'micros': 0}, {'v': 1, 'id': b, 'kind': 'settled', 'micros': 0}]
        with self.assertRaisesRegex(m.Rejected, 'combined-ledger-prefix-cap'): m.ledger_events(b''.join(m.canonical(e) + b'\n' for e in events))
        for bad in [events[:1], [events[2]], [events[0], events[0]]]:
            with self.assertRaises(m.Rejected): m.ledger_events(b''.join(m.canonical(e) + b'\n' for e in bad))

    def test_wave_phase_and_admission_bounds(self):
        keys = [H(str(i)) for i in range(5)]; jobs = {k: {'phase': 'reader'} for k in keys}
        reserves = [{'id': k, 'kind': 'reserved'} for k in keys]; settles = [{'id': k, 'kind': 'settled'} for k in keys]
        m.validate_waves(reserves[:4] + list(reversed(settles[:4])), jobs)
        for bad in [reserves + settles, [reserves[0], reserves[1], settles[0], reserves[2], settles[1], settles[2]]]:
            with self.assertRaises(m.Rejected): m.validate_waves(bad, jobs)
        jobs[keys[1]]['phase'] = 'judge'
        with self.assertRaisesRegex(m.Rejected, 'wave-phase'): m.validate_waves(reserves[:2] + settles[:2], jobs)

    def test_process_proof_rejects_live_ids_unknown_producers_and_staleness(self):
        producers = [{'pids': [101, 102], 'pgid': 102}]
        self.assertEqual(m.process_absence('1 0 1 /sbin/launchd\n', producers, Path('/synthetic')), 1)
        for raw in ['101 1 101 /bin/true\n', '9 1 102 /bin/true\n', '9 1 9 bun /x/gateway-study-v6.ts run\n',
                    '9 1 9 python benchmark-supervisor.py gateway-study-v5-batch-021/config.json\n', '1 0 1 x\n1 0 1 y\n']:
            with self.subTest(raw=raw), self.assertRaises(m.Rejected): m.process_absence(raw, producers, Path('/synthetic'))
        proof = {'argv': ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], 'checkedAt': iso(10), 'sha256': H('ps'), 'rows': 1, 'matchedProducers': 0}
        with self.assertRaisesRegex(m.Rejected, 'process-proof-stale'): m.validate_process_proof(proof, None, T, iso(71))

    def test_final_matrix_requires360_and_preserves_opaque_scores(self):
        f = self.fixture(); value = f.comparison(); result = {'physicalJudgeRequests': 8}
        value['assessment'] = object(); value['readers'][0]['prediction'] = object(); value['scoredCases'][0]['correct'] = object()
        m.validate_comparison(value, f.freeze, f.fs, f.jobs, result)
        for name in ['readers', 'scoredCases', 'physicalJudgeResults']:
            bad = f.comparison(); bad[name].pop()
            with self.subTest(name=name), self.assertRaises(m.Rejected): m.validate_comparison(bad, f.freeze, f.fs, f.jobs, result)
        bad = f.comparison(); bad['scoredCases'][333]['status'] = 'completed'
        with self.assertRaisesRegex(m.Rejected, 'policy-case-coverage'): m.validate_comparison(bad, f.freeze, f.fs, f.jobs, result)

    def test_extended_ledger_pins_keep_full_hash_and_project_safe_reads(self):
        ledger = {'path': '/synthetic/ledger.jsonl', 'sha256': H('ledger'), 'bytes': 123, 'exposureMicros': 6938}
        normal = {'path': '/synthetic/freeze.json', 'sha256': H('freeze')}; pins = [normal, ledger]
        original = copy.deepcopy(pins); projected = m.projected_evidence_pins(pins, [ledger])
        self.assertEqual(pins, original); self.assertNotEqual(m.js_hash(projected), m.js_hash(pins))
        self.assertEqual(projected[1], {k: ledger[k] for k in ['path', 'sha256']})
        for patch_value in [{'bytes': 124}, {'exposureMicros': 0}, {'extra': True}]:
            bad = {**ledger, **patch_value}
            with self.subTest(change=patch_value), self.assertRaises(m.Rejected): m.projected_evidence_pins([normal, bad], [ledger])

    def test_request_no_fallback_and_exact_limit(self):
        req = request('reader', 'x'); m.request_metadata(req, 'reader')
        for field, value in [('maximumOutput', 1024), ('timeoutMs', 1), ('endpoint', 'https://other.invalid')]:
            bad = copy.deepcopy(req); bad[field] = value
            with self.subTest(field=field), self.assertRaises(m.Rejected): m.request_metadata(bad, 'reader')
        bad = copy.deepcopy(req); bad['body']['providerOptions']['gateway']['only'].append('other')
        with self.assertRaises(m.Rejected): m.request_metadata(bad, 'reader')
        self.assertTrue(m.compatible_model('gpt-4.1-mini-2025-04-14', 'openai/gpt-4.1-mini'))
        self.assertFalse(m.compatible_model('gpt-4.1-mini-2025-02-31', 'openai/gpt-4.1-mini'))

    def test_inventory_symlink_and_exclusive_output_transaction(self):
        f = self.fixture(); f.batch(1, 32)
        path = f.study / 'jobs' / f.jobs[0]['key'] / 'response.body'; path.unlink(); path.symlink_to(f.study / 'freeze.json')
        with self.assertRaises(m.Rejected): m.study_inventory(m.Reads(), f.study, f.fs)
        a, b = f.work / 'a.json', f.work / 'b.json'; b.write_bytes(b'existing')
        with self.assertRaises(m.Rejected): m.exclusive_outputs({a: b'new', b: b'new'})
        self.assertFalse(a.exists()); self.assertEqual(b.read_bytes(), b'existing')

    def test_actual_v5_freeze_shape_has_no_head_and_source_is_read_without_git_process(self):
        f = self.fixture(); runtime = f.runtime
        for name in ['src', 'scripts', 'scripts/benchmarks', '.git']: (runtime / name).mkdir(mode=0o700)
        names = ['package.json', 'bun.lock', 'tsconfig.json', 'tsconfig.scripts.json', 'scripts/benchmark-memory.ts', 'src/synthetic.ts', 'scripts/benchmarks/synthetic.ts']
        files = []
        for name in sorted(names):
            pin = f.put(runtime / name, b'synthetic-source\n'); files.append({'path': name, 'sha256': pin['sha256']})
        f.put(runtime / '.git/HEAD', (m.OLD_HEAD + '\n').encode()); source_sha = m.js_hash(files)
        pin = {'path': '/synthetic/pin.json', 'sha256': H('pin')}
        freeze = {'protocol': 'oh.memory-gateway-freeze.v5', 'createdAt': iso(0), 'sourceSha256': source_sha,
                  'importedStudy': pin, 'priorGatewayStudy': pin, 'priorContinuationStudy': pin, 'authority': pin,
                  'originalLedger': {}, 'inputs': {}, 'procedure': {}, 'study': {}}
        prepared = {'source': {'gitHead': m.OLD_HEAD, 'sourceSha256': source_sha, 'bun': '1.3.14', 'dirty': False, 'files': files}}
        self.assertNotIn('sourceGitHead', freeze)
        with patch.object(m, 'OLD_SOURCE', source_sha), patch.object(m.subprocess, 'run') as ps:
            self.assertEqual(m.old_source_identity(m.Reads(), runtime, freeze, prepared), files); ps.assert_not_called()
            prepared['source']['gitHead'] = '0' * 40
            with self.assertRaisesRegex(m.Rejected, 'old-prepared-source'): m.old_source_identity(m.Reads(), runtime, freeze, prepared)
            prepared['source']['gitHead'] = m.OLD_HEAD
            f.put(runtime / 'src/synthetic.ts', b'changed')
            with self.assertRaisesRegex(m.Rejected, 'frozen-source-hash'): m.old_source_identity(m.Reads(), runtime, freeze, prepared)

    def test_recursive_receipt_chain_cannot_skip_genesis_or_change_import(self):
        f = self.fixture(); f.batch(1, 32); first = f.invoke(1)
        p = Path(first['acceptance']['path']); value = m.decode(p.read_bytes())
        value['previousAcceptance'] = first['acceptance']; changed = f.put(p, value)
        with self.assertRaisesRegex(m.Rejected, 'acceptance-chain-genesis'):
            m.prior_acceptances(m.Reads(), f.work, 2, changed['sha256'], f.data['importPreparation'], f.data['freezePin'], f.ss)
        value['previousAcceptance'] = None; value['importPreparation'] = {'path': '/synthetic/other.json', 'sha256': H('other')}; changed = f.put(p, value)
        with self.assertRaisesRegex(m.Rejected, 'acceptance-import-preparation'):
            m.prior_acceptances(m.Reads(), f.work, 2, changed['sha256'], f.data['importPreparation'], f.data['freezePin'], f.ss)

    def test_foundations_authenticates_actual_v5_shapes_and_extended_pins_together(self):
        f = self.fixture(); c = f.context; blobs, facts = {}, {}
        def put(path, value):
            raw = m.serialize(value); p = str(path); blobs[p] = raw
            facts[p] = {'path': p, 'sha256': m.digest(raw), 'bytes': len(raw)}
            return {'path': p, 'sha256': facts[p]['sha256']}
        class VirtualReads:
            # Synthetic stable-read facts replace filesystem custody, not shape/pin logic.
            def read(self, path, maximum=8 * m.M, private=False, retain=True):
                p = str(path); return blobs[p] if retain else facts[p]
            def pinned(self, pin, maximum=8 * m.M, private=False, retain=True):
                m.parse_pin(pin)
                m.need(facts[pin['path']]['sha256'] == pin['sha256'], 'synthetic-pin-mismatch')
                return blobs.get(pin['path'], b'opaque-ledger') if retain else facts[pin['path']]
            def json(self, path, maximum=8 * m.M, private=False): return m.decode(blobs[str(path)])
        ledger_values = [
            (f.work / 'gateway-study-v3/ledger.jsonl', '7f3830a8b69276f22614b896b01bd3534fc76ef6669b293de4e0b3ac3ec97996', 452),
            (f.work / 'gateway-study-v4/ledger.jsonl', '426f0ab07b34613a7265f1ef600bdc477cd169f23b92e5941108cc0142e1415b', 41101),
            (f.repo / '.cache/benchmarks/openai-pilot-budget.jsonl', 'c972b7e8643db61aa5a3d2b50df9aa095834be1f5b43ec680aacf5d0507f559b', 925682),
            (c.study / 'ledger.jsonl', m.OLD_LEDGER[0], m.OLD_LEDGER[1])]
        ledgers = [{'path': str(p), 'sha256': sha, 'bytes': size} for p, sha, size in ledger_values]
        facts.update({v['path']: v for v in ledgers}); original = {**ledgers[2], 'exposureMicros': 21655385}; native = {**ledgers[3], 'exposureMicros': m.OLD_LEDGER[2]}
        authority = put(f.work / 'authority.json', {'synthetic': 'authority'})
        prior = [put(f.work / f'ancestry-{i}.json', {'synthetic': i}) for i in range(3)]
        old_freeze = {'protocol': 'oh.memory-gateway-freeze.v5', 'createdAt': iso(0), 'sourceSha256': m.OLD_SOURCE,
            'importedStudy': prior[0], 'priorGatewayStudy': prior[1], 'priorContinuationStudy': prior[2], 'authority': authority,
            'originalLedger': original, 'inputs': {}, 'procedure': {'auth': context_document(f.work, f.repo)['auth']}, 'study': {}}
        self.assertNotIn('sourceGitHead', old_freeze)
        old_freeze_pin = put(c.study / 'freeze.json', old_freeze)
        old_prepared = {'source': {'gitHead': m.OLD_HEAD, 'sourceSha256': m.OLD_SOURCE, 'bun': '1.3.14', 'dirty': False, 'files': []},
            'noModelCalls': True, 'imported': {}, 'priorGateway': {}, 'priorContinuation': {}, 'originalLedger': original, 'maximumTotalAmendmentExposureMicros': m.CAP}
        put(c.study / 'preparation.json', old_prepared); put(c.study / 'store.json', {'protocol': 'oh.memory-gateway-store.v5', 'freezeSha256': old_freeze_pin['sha256']})
        runs, acceptance_pins = [], []
        for i in range(21):
            run = f'00000000-0000-4000-8000-{i + 100:012}'; folder = f.work / f'gateway-study-v5-batch-{i + 1:03}'
            config = {'argv': ['synthetic-producer', str(i)]}; config_pin = put(folder / 'config.json', config)
            status = {'state': 'exited', 'supervisorPid': 1000 + i * 2, 'supervisorStart': f'super-{i}', 'bootIdentity': 'boot', 'commandSha256': m.digest(m.canonical(config['argv'])),
                'configSha256': config_pin['sha256'], 'startedAt': seconds(i * 10), 'childPid': 1001 + i * 2, 'childPgid': 1001 + i * 2, 'childStart': f'child-{i}',
                'exitCode': 1 if i == 20 else 0, 'groupGone': True, 'finishedAt': seconds(i * 10 + 5)}
            status_pin = put(folder / 'status.json', status)
            admission = put(c.study / f'batch-{run}-started.json', {'synthetic': 'admission', 'run': run})
            closure = put(c.study / f'batch-{run}.json', {'synthetic': 'closure', 'run': run})
            runs.append({'runId': run, 'admissionSha256': admission['sha256'], 'closureSha256': closure['sha256'], 'configuration': config_pin,
                'supervisorStatus': status_pin, 'groupGone': True, 'runnerExitCode': status['exitCode'], 'newTransportInvocations': 32 if i == 0 else 168 if i == 20 else 256})
            if i < 20: acceptance_pins.append(put(f.work / f'gateway-v5-batch-{i + 1:03}-acceptance.json', {'synthetic': i}))
        imported = [{'key': H(f'old-{i}'), 'phase': 'extract' if i < 4732 else 'reader', 'ordinal': i if i < 4732 else i - 4732, 'requestSha256': H(f'request-{i}')} for i in range(5064)]
        imported[-1]['key'] = m.TERMINAL
        old_files = []
        for name in ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl']:
            old_files.append({**facts[str(c.study / name)], 'path': name})
        for r in runs:
            for suffix in ['.json', '-started.json']:
                name = f'batch-{r["runId"]}{suffix}'; old_files.append({**facts[str(c.study / name)], 'path': name})
        for j in imported:
            for name in m.JOB_FILES:
                if j['key'] == m.TERMINAL and name in ['result.json', 'settled.json']: continue
                old_files.append({'path': f'jobs/{j["key"]}/{name}', 'bytes': 1, 'sha256': H('synthetic-only')})
        old_files.sort(key=lambda v: v['path'])
        inv_pin = put(f.work / 'gateway-v6-import-closed-inventory.json', {'schema': 'oh.gateway-import-inventory.v6', 'freezeSha256': old_freeze_pin['sha256'], 'files': old_files})
        owner_pin = put(f.work / 'gateway-v6-import-supervisor-closure.json', {'schema': 'oh.gateway-import-supervisor-closure.v6', 'freezeSha256': old_freeze_pin['sha256'],
            'inventorySha256': inv_pin['sha256'], 'verification': 'owner-verified-complete-producer-inventory', 'allProducersClosed': True, 'runs': runs, 'acceptances': acceptance_pins})
        policy = {'profile': 'synthetic-reader-policy'}; policy_sha = m.js_hash(policy)
        manifest_pin = put(f.work / 'gateway-study-v6-import-manifest.json', {'schema': 'oh.gateway-study-import.v6', 'createdAt': iso(210), 'studyDirectory': str(c.study), 'sourceDirectory': str(c.runtime),
            'freeze': old_freeze_pin, 'inventory': inv_pin, 'supervisorClosure': owner_pin, 'jobs': imported, 'terminalReaderJobKey': m.TERMINAL, 'policySha256': policy_sha, 'qualification': 'synthetic'})
        collector = {'schema': 'oh.gateway-v6-import-preparation.v1', 'recordedAt': iso(210), 'sourceSha256': m.OLD_SOURCE, 'policySha256': policy_sha,
            'producerCount': 21, 'successfulAcceptances': 20, 'newJobs': 5064, 'extractionJobs': 4732, 'attemptedReaderJobs': 332, 'completedJobs': 5063, 'studyFiles': len(old_files),
            'terminalReaderJobKey': m.TERMINAL, 'priorGatewayExposureMicros': 809209, 'totalCarriedExposureMicros': m.CARRY,
            'modelCalls': 0, 'auditorCalls': 0, 'studyWrites': 0, 'correctnessInspected': False, 'responseTextInspected': False,
            'manifest': manifest_pin, 'inventory': inv_pin, 'supervisorClosure': owner_pin, 'ledger': native,
            'processInventory': {'argv': ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], 'checkedAt': iso(210), 'sha256': H('ps'), 'rows': 1, 'matchedProducers': 0}}
        import_pin = put(f.work / 'gateway-v6-import-preparation.json', collector)
        evidence = [manifest_pin, old_freeze_pin, inv_pin, owner_pin, authority, *prior, original, *acceptance_pins, native]
        summary = {'manifestSha256': manifest_pin['sha256'], 'freezeSha256': old_freeze_pin['sha256'], 'sourceSha256': m.OLD_SOURCE, 'importedTransportInvocations': 5064,
            'importedExtractionCount': 4732, 'importedReaderCount': 332, 'terminalReaderFailureCount': 1, 'externalExposureMicros': m.CARRY,
            'nativeLedgerExposureMicros': m.OLD_LEDGER[2], 'ancestryExposureMicros': 809209, 'policySha256': policy_sha, 'ledger': native}
        identity = {'selectedFamilies': 120, 'extractionParents': 8413, 'importedExtractionCount': 4732, 'importedReaderCount': 332, 'remainingFirstReaderCalls': 28, 'readerCases': 360,
            'importedV5': summary, 'importedJobKeysSha256': m.js_hash(sorted(j['key'] for j in imported)), 'importedEvidencePinsSha256': m.js_hash(evidence)}
        freeze = {'protocol': 'oh.memory-gateway-freeze.v6', 'createdAt': iso(220), 'sourceSha256': f.ss, 'sourceGitHead': 'a' * 40,
            'importedStudy': manifest_pin, 'authority': authority, 'originalLedger': original, 'inputs': {}, 'policySha256': policy_sha, 'priorAmendmentExposureMicros': m.CARRY,
            'procedure': {'auth': context_document(f.work, f.repo)['auth'], 'profile': 'oh.memory-gateway-study.v6', 'readerFailure': {'policySha256': policy_sha, 'policy': policy, 'carryMicros': m.CARRY}}, 'study': identity}
        freeze_pin = put(f.study / 'freeze.json', freeze)
        prepared = {'source': {'sourceSha256': f.ss, 'gitHead': 'a' * 40, 'bun': '1.3.14', 'dirty': False, 'files': []}, 'noModelCalls': True,
            'importedV5': summary, 'importedEvidencePins': evidence, 'originalLedger': original, 'policySha256': policy_sha,
            'maximumTotalAmendmentExposureMicros': m.CAP, 'priorAmendmentExposureMicros': m.CARRY}
        put(f.study / 'preparation.json', prepared); put(f.study / 'store.json', {'protocol': m.STORE, 'freezeSha256': freeze_pin['sha256']})
        with ExitStack() as stack:
            stack.enter_context(patch.object(gc, 'STUDY_FREEZE_SHA256', old_freeze_pin['sha256']))
            stack.enter_context(patch.object(gc, 'verify_context'))
            stack.enter_context(patch.object(gc, 'validate_study_binding', return_value={'freeze': old_freeze_pin, 'authority': authority}))
            stack.enter_context(patch.object(m, 'POLICY', policy_sha))
            source = stack.enter_context(patch.object(m, 'source_identity', return_value=[]))
            ps = stack.enter_context(patch.object(m.subprocess, 'run'))
            checked = m.foundations(VirtualReads(), c, freeze_pin['sha256'], f.ss, import_pin['sha256'])
            saved_store = blobs.pop(str(f.study / 'store.json'))
            self.assertEqual(m.foundations(VirtualReads(), c, freeze_pin['sha256'], f.ss, import_pin['sha256'], require_store=False), checked)
            with self.assertRaises(KeyError): m.foundations(VirtualReads(), c, freeze_pin['sha256'], f.ss, import_pin['sha256'])
            blobs[str(f.study / 'store.json')] = saved_store
            self.assertEqual(len(checked['importedKeys']), 5064); self.assertEqual(len(checked['oldProducers']), 21)
            self.assertEqual(checked['importPreparation'], import_pin)
            self.assertEqual(source.call_args_list[-1].args[-1], m.OLD_HEAD); ps.assert_not_called()
            bad = copy.deepcopy(prepared); bad['importedEvidencePins'][-1] = {**bad['importedEvidencePins'][-1], 'exposureMicros': m.OLD_LEDGER[2] - 1}
            put(f.study / 'preparation.json', bad)
            with self.assertRaisesRegex(m.Rejected, 'extended-ledger-pin-anchor'):
                m.foundations(VirtualReads(), c, freeze_pin['sha256'], f.ss, import_pin['sha256'])

    def test_foundation_rejection_occurs_before_process_or_output(self):
        f = self.fixture()
        with patch.object(m, 'foundations', side_effect=m.Rejected('fixed-import-preparation')), patch.object(m.subprocess, 'run') as ps:
            with self.assertRaisesRegex(m.Rejected, 'fixed-import-preparation'): m.close_batch(f.context, 1, f.fs, f.ss, f.ips)
            ps.assert_not_called()
        self.assertFalse(m.output_paths(f.work, 1)['acceptance'].exists())


if __name__ == '__main__':
    unittest.main()
