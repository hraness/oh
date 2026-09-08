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

    def batch(self, number, count, final=False, start=None):
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
        maximum = 32 if number == 1 else 256
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

    def invoke(self, number, previous=None, now=None):
        with ExitStack() as s:
            s.enter_context(patch.object(m, 'foundations', return_value=self.data))
            s.enter_context(patch.object(m.gc, 'verify_context'))
            s.enter_context(patch.object(m.gc, 'validate_study_binding'))
            s.enter_context(patch.object(m, 'source_identity', return_value=[]))
            s.enter_context(patch.object(m, 'now_iso', return_value=now or iso(number * 100 + 12)))
            ps = s.enter_context(patch.object(m.subprocess, 'run', return_value=type('Snapshot', (), {'stdout': '1 0 1 /sbin/launchd\n'})()))
            result = m.close_batch(self.context, number, self.fs, self.ss, self.ips, previous)
            self.assert_ps(ps)
            return result

    @staticmethod
    def assert_ps(ps):
        ps.assert_called_once_with(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], stdout=m.subprocess.PIPE, stderr=m.subprocess.PIPE, text=True, check=True, timeout=15)


class ClosureTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        return Fixture(Path(temporary.name).resolve())

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
