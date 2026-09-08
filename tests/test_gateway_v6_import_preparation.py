"""Synthetic v6 custody tests; never inspect a real process or benchmark artifact."""
import copy
from contextlib import contextmanager, ExitStack
import datetime as dt
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/benchmark-audit'))
import gateway_context
import prepare_gateway_v5_final_audit as v5
import prepare_gateway_v6_import as m

T = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
iso = lambda n: (T + dt.timedelta(seconds=n)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
H = lambda text: m.digest(text.encode())
enc = lambda value: (json.dumps(value) + '\n').encode()


def context(work='/synthetic/work', repo='/synthetic/repository'):
    return gateway_context.parse_context({'schema': 'oh.gateway-audit-context.v1', 'workDirectory': work, 'repositoryDirectory': repo,
        'tools': {'python': '/synthetic/bin/python3', 'bun': '/synthetic/bin/bun', 'vercel': '/synthetic/bin/vercel', 'ps': '/bin/ps'},
        'auth': {'method': 'project-oidc', 'project': 'synthetic-project', 'scope': 'synthetic-owner', 'environment': 'development'}})


def failed_fixture():
    previous = [H('earlier-job')]
    keys = [H(f'new-job-{i}') for i in range(168)]; keys[-4] = m.TERMINAL
    run = '00000000-0000-4000-8000-000000000021'
    qualified = {'method': 'project-oidc', 'project': v5.PROJECT, 'scope': v5.SCOPE, 'environment': 'development',
        'issuer': f'https://oidc.vercel.com/{v5.SCOPE}', 'subject': f'owner:{v5.SCOPE}:project:{v5.PROJECT}:environment:development',
        'audience': f'https://vercel.com/{v5.SCOPE}', 'expiresAt': T.timestamp() + 9999, 'signatureVerifiedLocally': False}
    a = {'protocol': 'oh.memory-gateway-batch-admission.v5', 'runId': run, 'freezeSha256': v5.FREEZE, 'sourceSha256': v5.SOURCE,
        'importedStudySha256': v5.CLAUDE, 'priorGatewayStudySha256': v5.PRIOR_GATEWAY, 'priorContinuationStudySha256': v5.PRIOR_CONTINUATION,
        'priorGatewayExposureMicros': v5.CARRY, 'start': iso(10), 'maximumNewCalls': 256, 'concurrency': 4,
        'openingLedgerExposureMicros': 100, 'initialJobKeysSha256': m.digest(m.canonical(sorted(previous))), 'qualified': qualified}
    b = {'protocol': 'oh.memory-gateway-batch.v5', 'runId': run, 'freezeSha256': v5.FREEZE, 'sourceSha256': v5.SOURCE,
        'importedStudySha256': v5.CLAUDE, 'priorGatewayStudySha256': v5.PRIOR_GATEWAY, 'priorContinuationStudySha256': v5.PRIOR_CONTINUATION,
        'start': iso(10), 'end': iso(20), 'admission': {'path': str(v5.STUDY / f'batch-{run}-started.json'), 'sha256': H('admission')},
        'maximumNewCalls': 256, 'concurrency': 4, 'newTransportInvocations': 168, 'admittedKeys': keys,
        'initialJobKeys': sorted(previous), 'finalJobKeys': sorted(previous + keys), 'failed': True, 'interrupted': False,
        'storeClosed': True, 'sourceVerifiedAtClose': True, 'importVerifiedAtClose': True, 'originalLedgerVerifiedAtClose': True,
        'priorGatewayVerifiedAtClose': True, 'priorContinuationVerifiedAtClose': True, 'stopReason': None, 'qualified': qualified,
        'ledger': {}, 'comparisonArtifact': None, 'result': {'status': 'blocked', 'phase': 'reader', 'reason': 'Preserved first-response evidence requires review; no retry.'}}
    job = v5.WORK / 'gateway-study-v5-batch-021'
    argv = [v5.VERCEL, 'env', 'run', '--project', v5.PROJECT, '--scope', v5.SCOPE, '--environment', 'development', '--', v5.BUN,
        str(v5.RUNTIME / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(v5.STUDY), '--freeze-sha256', v5.FREEZE, '--max-new-calls', '256']
    c = {'argv': argv, 'cwd': str(v5.RUNTIME), 'jobDir': str(job), 'requireAbsent': list(map(str, v5.LOCKS))}
    cp = {'path': str(job / 'config.json'), 'sha256': m.digest(m.canonical(c))}
    sp = {'path': str(job / 'status.json'), 'sha256': H('status')}
    s = {'state': 'exited', 'supervisorPid': 33939, 'supervisorStart': 'synthetic-start-33939', 'bootIdentity': 'synthetic-boot',
        'childPid': 33942, 'childPgid': 33942, 'childStart': 'synthetic-start-33942', 'exitCode': 1, 'groupGone': True,
        'commandSha256': m.digest(m.canonical(argv)), 'configSha256': cp['sha256'], 'startedAt': iso(9).replace('.000Z', 'Z'),
        'finishedAt': iso(21).replace('.000Z', 'Z')}
    return previous, a, b, c, s, cp, sp


class GuardedReads(m.Reads):
    """Fail if collection begins decoding semantic body or result artifacts."""
    def read(self, path, maximum=8 * m.M, private=False, retain=True):
        if Path(path).name in ['response.body', 'result.json'] and retain:
            raise AssertionError('semantic artifact must only be hashed')
        return super().read(path, maximum, private, retain)


def reader_wave(root):
    """Four reserved readers, with one terminal and three completed siblings."""
    keys = [m.TERMINAL, H('reader-1'), H('reader-2'), H('reader-3')]
    reservations = [{'v': 1, 'id': k, 'kind': 'reserved', 'micros': 100} for k in keys]
    settlements = [{**reservations[i], 'kind': 'settled', 'micros': 10 + i} for i in [2, 1, 3]]
    events = reservations + settlements
    def put(path, value):
        raw = value if type(value) is bytes else enc(value)
        path.write_bytes(raw); path.chmod(0o600)
    root.mkdir(mode=0o700); (root / 'jobs').mkdir(mode=0o700)
    for i, key in enumerate(keys):
        job = root / 'jobs' / key; job.mkdir(mode=0o700)
        request_sha = H(f'request-{i}')
        pending = {'protocol': 'oh.memory-gateway-store.v5', 'freezeSha256': v5.FREEZE, 'jobKey': key, 'phase': 'reader', 'ordinal': i,
            'originalParentOrdinal': None, 'originalJobKey': None, 'request': {'requestSha256': request_sha, 'body': {'messages': 'SYNTHETIC_CONTEXT_DO_NOT_PROJECT'}}}
        put(job / 'pending.json', pending); put(job / 'reserved.json', reservations[i])
        body = b'SYNTHETIC_PARTIAL_BODY_DO_NOT_DECODE'
        put(job / 'response.body', body)
        put(job / 'response.json', {'requestSha256': request_sha, 'httpStatus': 200, 'bodyComplete': True, 'receivedBytes': len(body),
            'transportError': None, 'body': {'bytes': len(body), 'sha256': m.digest(body)}})
        if i:
            put(job / 'result.json', b'SYNTHETIC_COMPLETED_RESULT_DO_NOT_DECODE')
            put(job / 'settled.json', next(e for e in settlements if e['id'] == key))
    put(root / 'ledger.jsonl', b''.join(map(enc, events)))
    return keys, events, put


@contextmanager
def complete_collection_fixture(work):
    """Full 21-producer metadata history; all bytes and custody are synthetic.

    The orchestration test uses in-memory immutable reads and the separately tested
    job inventory boundary, while retaining actual native batch, supervisor,
    historical-inventory, ledger-prefix and exclusive-output validators.
    """
    m.configure(context(str(work)))
    docs, source = {}, [{'path': 'synthetic.ts', 'sha256': H('source')}]
    def put(path, value):
        raw = value if type(value) is bytes else enc(value)
        docs[str(path)] = raw
        return {'path': str(path), 'sha256': m.digest(raw)}
    class MemoryReads(m.Reads):
        def read(self, path, maximum=8 * m.M, private=False, retain=True):
            raw = docs[str(path)]; m.need(len(raw) <= maximum, 'synthetic-file-bound')
            item = {'path': str(path), 'bytes': len(raw), 'sha256': m.digest(raw)}
            if str(path) in self.observed:
                m.equal(self.observed[str(path)], item, 'synthetic-observed-change')
            self.observed[str(path)] = item
            return raw if retain else item
    ancestry = {name: {'synthetic': name} for name in ['imported', 'priorGateway', 'priorContinuation']}
    freeze = {'protocol': 'oh.memory-gateway-freeze.v5', 'sourceSha256': v5.SOURCE, 'createdAt': iso(0),
        'importedStudy': put(work / 'claude.json', b'claude'), 'priorGatewayStudy': put(work / 'gateway.json', b'gateway'),
        'priorContinuationStudy': put(work / 'continuation.json', b'continuation'), 'authority': put(work / 'authority.json', b'authority'),
        'study': ancestry, 'originalLedger': {'synthetic': 'original'}}
    freeze_pin = put(v5.STUDY / 'freeze.json', freeze)
    prepared = put(work / 'gateway-v5-runtime-preparation.json', {'runtime': str(v5.RUNTIME), 'gitHead': v5.HEAD, 'sourceSha256': v5.SOURCE,
        'result': {'freezeSha256': freeze_pin['sha256']}, 'modelCalls': 0})
    put(v5.STUDY / 'preparation.json', {'noModelCalls': True, 'source': {'dirty': False, 'gitHead': v5.HEAD, 'sourceSha256': v5.SOURCE,
        'bun': '1.3.14', 'files': source}, 'maximumTotalAmendmentExposureMicros': v5.CAP, **ancestry, 'originalLedger': freeze['originalLedger']})
    put(v5.STUDY / 'store.json', {'protocol': 'oh.memory-gateway-store.v5', 'freezeSha256': freeze_pin['sha256']})
    diagnosis = put(work / 'gateway-v5-reader-failure-diagnosis.json', b'historical diagnosis only')
    old_ledger = put(work / 'synthetic-original-ledger.jsonl', b'immutable ledger')
    jobs = [{'key': H(f'full-job-{i}'), 'phase': 'extract' if i < m.EXTRACTIONS else 'reader',
        'ordinal': i if i < m.EXTRACTIONS else i - m.EXTRACTIONS, 'requestSha256': H(f'full-request-{i}')} for i in range(m.JOBS)]
    jobs[-4]['key'] = m.TERMINAL
    counts, events, prefixes, frontier = [32] + [256] * 19 + [168], [], [], 0
    for count in counts:
        for start in range(frontier, frontier + count, 4):
            wave = jobs[start:start + 4]
            events.extend({'v': 1, 'id': j['key'], 'kind': 'reserved', 'micros': 100} for j in wave)
            events.extend({'v': 1, 'id': j['key'], 'kind': 'settled', 'micros': 1} for j in wave if j['key'] != m.TERMINAL)
        frontier += count; prefixes.append(b''.join(map(enc, events)))
    ledger = put(v5.STUDY / 'ledger.jsonl', prefixes[-1])
    batches, acceptance_data, frontier, previous_exposure = [], [], 0, 0
    with ExitStack() as patches:
        for name, value in [('FREEZE', freeze_pin['sha256']), ('PREPARATION', prepared['sha256']), ('CLAUDE', freeze['importedStudy']['sha256']),
                ('PRIOR_GATEWAY', freeze['priorGatewayStudy']['sha256']), ('PRIOR_CONTINUATION', freeze['priorContinuationStudy']['sha256']),
                ('OLD_LEDGERS', [(Path(old_ledger['path']), old_ledger['sha256'])])]:
            patches.enter_context(patch.object(v5, name, value))
        patches.enter_context(patch.object(v5.inventory_shape, '__defaults__', (freeze_pin['sha256'],)))
        for i, count in enumerate(counts, 1):
            terminal = i == 21; before = frontier; frontier += count
            _, a, b, c, s, _, _ = failed_fixture()
            run = f'00000000-0000-4000-8000-{i:012d}'; start, end = i * 30, i * 30 + 10
            maximum = 32 if i == 1 else 256; initial = sorted(j['key'] for j in jobs[:before])
            admitted = [j['key'] for j in jobs[before:frontier]]; current = frontier - 1 + 100 if terminal else frontier
            a.update(runId=run, start=iso(start), maximumNewCalls=maximum, openingLedgerExposureMicros=previous_exposure, initialJobKeysSha256=m.digest(m.canonical(initial)))
            a['qualified']['expiresAt'] = T.timestamp() + 100000
            ap = put(v5.STUDY / f'batch-{run}-started.json', a)
            result = {'status': 'blocked', 'phase': 'reader', 'reason': 'Preserved first-response evidence requires review; no retry.'} if terminal else {
                'status': 'paused', 'phase': 'extract' if frontier < m.EXTRACTIONS else 'reader',
                'resolved': frontier if frontier < m.EXTRACTIONS else frontier - m.EXTRACTIONS, 'required': m.EXTRACTIONS if frontier < m.EXTRACTIONS else 360}
            l = {'path': str(v5.STUDY / 'ledger.jsonl'), 'bytes': len(prefixes[i - 1]), 'sha256': m.digest(prefixes[i - 1]),
                'exposureMicros': current, 'priorGatewayExposureMicros': v5.CARRY, 'totalAmendmentExposureMicros': v5.CARRY + current,
                'budget': {'capUsd': 40, 'maxCalls': maximum, 'reservedCalls': count, 'historicalExposureUsd': 21.655385,
                    'priorAmendmentExposureUsd': (v5.CARRY + previous_exposure) / 1e6, 'accountedUsd': (v5.CARRY + current) / 1e6,
                    'confirmedThisRunUsd': (count - int(terminal)) / 1e6, 'unresolvedThisRunUsd': 100 / 1e6 if terminal else 0, 'billedUsd': None}}
            b.update(runId=run, start=iso(start), end=iso(end), admission=ap, maximumNewCalls=maximum, newTransportInvocations=count,
                admittedKeys=admitted, initialJobKeys=initial, finalJobKeys=sorted(j['key'] for j in jobs[:frontier]), failed=terminal,
                stopReason=None if terminal else 'call-limit', qualified=a['qualified'], result=result, ledger=l)
            bp = put(v5.STUDY / f'batch-{run}.json', b); batches.extend([f'batch-{run}-started.json', f'batch-{run}.json'])
            jobdir = work / f'gateway-study-v5-batch-{i:03}'; jobdir.mkdir(mode=0o700)
            c['jobDir'] = str(jobdir); c['argv'][-1] = str(maximum)
            cp = put(jobdir / 'config.json', m.canonical(c)); sp_path = jobdir / 'status.json'
            s.update(configSha256=cp['sha256'], commandSha256=m.digest(m.canonical(c['argv'])), startedAt=iso(start - 1).replace('.000Z', 'Z'),
                finishedAt=iso(end + 1).replace('.000Z', 'Z'), exitCode=1 if terminal else 0,
                supervisorPid=33939 if terminal else 100 + i * 2, childPid=33942 if terminal else 101 + i * 2, childPgid=33942 if terminal else 101 + i * 2)
            sp = put(sp_path, s); retained = work / f'gateway-study-v5-batch-{i:03}-launch-config.json'
            put(retained, m.canonical(c)); retained.write_bytes(b'synthetic listing')
            if not terminal:
                acceptance_data.append({'schema': 'oh.gateway-v5-batch-acceptance.v1', 'recordedAt': iso(end + 2), 'number': i, 'runId': run,
                    'admission': ap, 'closure': bp, 'configuration': cp, 'supervisorStatus': sp, 'groupGone': True, 'freshOsProcessMatches': 0,
                    'newTransportInvocations': count, 'totalNewJobCount': frontier, 'result': result, 'ledgerExposureMicros': current,
                    'priorGatewayExposureMicros': v5.CARRY, 'totalAmendmentExposureMicros': v5.CARRY + current,
                    'allOriginalLedgersUnchanged': True, 'priorInventoryUnchanged': True, 'correctnessInspected': False, 'modelCallsByVerifier': 0})
            previous_exposure = current
        paths = ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl'] + batches + [f'jobs/{j["key"]}/{name}' for j in jobs for name in (m.TERMINAL_FILES if j['key'] == m.TERMINAL else v5.JOB_FILES)]
        files = []
        for name in sorted(paths):
            raw = docs.get(str(v5.STUDY / name), name.encode())
            files.append({'path': name, 'bytes': len(raw), 'sha256': m.digest(raw)})
        frontier = 0
        for i, accepted in enumerate(acceptance_data, 1):
            frontier += counts[i - 1]; keys = {j['key'] for j in jobs[:frontier]}; native = set(batches[:i * 2])
            prefix_files = [dict(f) for f in files if f['path'].startswith('jobs/') and f['path'].split('/')[1] in keys
                or f['path'].startswith('batch-') and f['path'] in native or not f['path'].startswith(('jobs/', 'batch-'))]
            for f in prefix_files:
                if f['path'] == 'ledger.jsonl': f.update(bytes=len(prefixes[i - 1]), sha256=m.digest(prefixes[i - 1]))
            invpath = work / f'gateway-v5-batch-{i:03}-closed-inventory.json'
            accepted['inventory'] = put(invpath, {'schema': 'oh.gateway-final-inventory.v5', 'freezeSha256': v5.FREEZE, 'files': prefix_files})
            acceptpath = work / f'gateway-v5-batch-{i:03}-acceptance.json'; put(acceptpath, accepted)
            invpath.write_bytes(b'synthetic listing'); acceptpath.write_bytes(b'synthetic listing')
        for name, value in [('DIAGNOSIS', diagnosis['sha256']), ('LEDGER_BYTES', len(prefixes[-1])), ('LEDGER_SHA', ledger['sha256']),
                ('EXPOSURE', previous_exposure), ('CARRY', v5.CARRY + previous_exposure)]:
            patches.enter_context(patch.object(m, name, value))
        patches.enter_context(patch.object(m, 'Reads', MemoryReads))
        patches.enter_context(patch.object(m, 'verify_context'))
        patches.enter_context(patch.object(m, 'validate_study_binding'))
        patches.enter_context(patch.object(m, 'directory', return_value=('synthetic-custody',)))
        patches.enter_context(patch.object(v5, 'source_identity', return_value=source))
        patches.enter_context(patch.object(v5, 'verify_auditor_packet', return_value={'path': str(work / 'auditor.json'), 'sha256': H('auditor')}))
        patches.enter_context(patch.object(m, 'study_inventory', return_value=(files, {})))
        patches.enter_context(patch.object(m, 'job_bindings', return_value=jobs))
        yield docs, jobs, files


class V6ImportPreparationTests(unittest.TestCase):
    def setUp(self):
        self.previous = {k: getattr(v5, k) for k in ['CONTEXT', 'WORK', 'REPO', 'RUNTIME', 'STUDY', 'BUN', 'VERCEL', 'PS', 'PROJECT', 'SCOPE', 'OUTPUTS', 'LOCKS', 'OLD_LEDGERS']}
        self.previous_outputs = m.OUTPUTS
        m.configure(context())
        self.no_process = patch.object(m.subprocess, 'run', side_effect=AssertionError('real process inventory forbidden in synthetic tests'))
        self.process = self.no_process.start()

    def tearDown(self):
        self.no_process.stop()
        for key, value in self.previous.items():
            setattr(v5, key, value)
        m.OUTPUTS = self.previous_outputs

    def test_unsettled_terminal_preserves_full_reservation_and_other_siblings(self):
        a = {'v': 1, 'id': m.TERMINAL, 'kind': 'reserved', 'micros': 100}
        b = {**a, 'id': H('sibling'), 'micros': 200}
        events = [a, b, {**b, 'kind': 'settled', 'micros': 2}]
        replay, exposure, pending = m.ledger_events(b''.join(map(enc, events)))
        self.assertEqual(replay, events); self.assertEqual(exposure, 102); self.assertEqual(pending, {m.TERMINAL: 100})
        self.assertEqual(m.CARRY, v5.CARRY + m.EXPOSURE)
        self.process.assert_not_called()

    def test_ledger_rejects_settled_failure_second_failure_dropped_sibling_and_cap_overflow(self):
        a = {'v': 1, 'id': m.TERMINAL, 'kind': 'reserved', 'micros': 100}
        b = {**a, 'id': H('sibling')}
        bad = [[a, {**a, 'kind': 'settled', 'micros': 1}], [a, b], [a, a],
            [a, {**b, 'kind': 'settled'}], [{**a, 'micros': v5.CAP - v5.CARRY + 1}],
            [a, b, {**b, 'kind': 'settled', 'micros': 101}], [{**a, 'v': True}]]
        for events in bad:
            with self.subTest(events=events), self.assertRaises(m.Rejected): m.ledger_events(b''.join(map(enc, events)))
        with self.assertRaises(m.Rejected): m.ledger_events(enc(a)[:-1])
        self.assertEqual(m.ledger_events(enc(b) + enc({**b, 'kind': 'settled', 'micros': 2}), None)[1], 2)

    def test_failed_batch_keeps_blocked_reader_and_all_admitted_siblings(self):
        previous, a, b, *_ = failed_fixture()
        checked = m.failed_batch(a, b, previous, 100, T)
        self.assertEqual(checked['count'], 168); self.assertEqual(checked['finalKeys'], sorted(previous + b['admittedKeys']))
        self.assertEqual(len(checked['admittedKeys'][-4:]), 4)
        self.assertTrue(b['failed']); self.assertEqual(b['result']['status'], 'blocked')

    def test_failure_cannot_be_normalized_to_success_or_retried(self):
        mutations = [lambda b: b.update(failed=False), lambda b: b.update(interrupted=True), lambda b: b.update(newTransportInvocations=167),
            lambda b: b.update(maximumNewCalls=168), lambda b: b.update(stopReason='call-limit'),
            lambda b: b.update(result={'status': 'completed', 'phase': 'reader'}), lambda b: b.update(comparisonArtifact={}),
            lambda b: b['admittedKeys'].pop(), lambda b: b['finalJobKeys'].pop(),
            lambda b: b['admittedKeys'].__setitem__(0, b['admittedKeys'][-1]),
            lambda b: b.update(storeClosed=False), lambda b: b.update(priorContinuationVerifiedAtClose=1)]
        for mutate in mutations:
            previous, a, b, *_ = failed_fixture(); mutate(b)
            with self.subTest(mutate=mutate), self.assertRaises(m.Rejected): m.failed_batch(a, b, previous, 100, T)
        previous, a, b, *_ = failed_fixture(); b['admittedKeys'][0], b['admittedKeys'][-4] = b['admittedKeys'][-4], b['admittedKeys'][0]
        with self.assertRaisesRegex(m.Rejected, 'admitted-keys'): m.failed_batch(a, b, previous, 100, T)

    def test_failed_admission_preserves_ancestry_and_opening_exposure(self):
        for field in ['sourceSha256', 'freezeSha256', 'priorGatewayStudySha256', 'priorContinuationStudySha256', 'importedStudySha256']:
            previous, a, b, *_ = failed_fixture(); a[field] = b[field] = H('changed')
            with self.subTest(field=field), self.assertRaises(m.Rejected): m.failed_batch(a, b, previous, 100, T)
        for change in [{'priorGatewayExposureMicros': 0}, {'openingLedgerExposureMicros': 99}, {'initialJobKeysSha256': H('changed')}]:
            previous, a, b, *_ = failed_fixture(); a.update(change)
            with self.subTest(change=change), self.assertRaises(m.Rejected): m.failed_batch(a, b, previous, 100, T)

    def test_failed_supervisor_requires_exact_exit_one_command_ids_and_lifetime(self):
        _, _, _, c, s, cp, sp = failed_fixture()
        proof = m.failed_supervisor(c, s, cp, sp, T + dt.timedelta(seconds=10), T + dt.timedelta(seconds=20), T)
        self.assertEqual(proof['pids'], [33939, 33942]); self.assertEqual(proof['pgid'], 33942)
        for field, value in [('exitCode', 0), ('exitCode', True), ('state', 'running'), ('groupGone', False), ('supervisorPid', 123),
                ('childPid', 123), ('childPgid', 123), ('commandSha256', H('changed')), ('configSha256', H('changed')),
                ('startedAt', '2026-01-01T00:00:11Z'), ('finishedAt', '2026-01-01T00:00:19Z')]:
            _, _, _, c, s, cp, sp = failed_fixture(); s[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(m.Rejected): m.failed_supervisor(c, s, cp, sp, T + dt.timedelta(seconds=10), T + dt.timedelta(seconds=20), T)
        for mutate in [lambda c: c['argv'].__setitem__(4, 'other-project'), lambda c: c['requireAbsent'].pop(),
                lambda c: c.update(cwd='/other'), lambda c: c.update(jobDir='/other')]:
            _, _, _, c, s, cp, sp = failed_fixture(); mutate(c)
            with self.assertRaises(m.Rejected): m.failed_supervisor(c, s, cp, sp, T + dt.timedelta(seconds=10), T + dt.timedelta(seconds=20), T)

    def test_process_snapshot_rejects_named_groups_and_unlisted_old_or_new_producers(self):
        producers = [{'pids': [33939, 33942], 'pgid': 33942}]
        self.assertEqual(m.validate_process_absence('1 0 1 /sbin/launchd\n88 1 88 /bin/unrelated\n', producers), 2)
        for line in ['33939 1 50 unrelated', '33942 1 50 unrelated', '50 1 33942 unrelated',
            '50 1 50 bun /other/gateway-study-v6.ts run', '50 1 50 bun /other/gateway-study-v7.ts run',
            '50 1 50 bun /other/claude-study-v2.ts run', '50 1 50 bun /other/benchmark-memory.ts reader',
            f'50 1 50 python {v5.WORK}/benchmark-supervisor.py run gateway-study-v6-batch-001',
            f'50 1 50 bun {v5.WORK}/gateway-study-v6-candidate/unknown.ts', 'bad', '']:
            with self.subTest(line=line), self.assertRaises(m.Rejected): m.validate_process_absence(line, producers)
        self.process.assert_not_called()

    def test_only_twenty_successful_acceptances_and_twenty_one_retained_launches(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary).resolve(); m.configure(context(str(work)))
            for i in range(1, 22):
                (work / f'gateway-study-v5-batch-{i:03}').mkdir()
                (work / f'gateway-study-v5-batch-{i:03}-launch-config.json').write_bytes(b'{}')
                if i <= 20:
                    for suffix in ['acceptance.json', 'closed-inventory.json']:
                        (work / f'gateway-v5-batch-{i:03}-{suffix}').write_bytes(b'{}')
            m.verify_numbered_entries()
            extra = work / 'gateway-v5-batch-021-acceptance.json'; extra.write_bytes(b'{}')
            with self.assertRaisesRegex(m.Rejected, 'only-successful'): m.verify_numbered_entries()
            extra.unlink(); retained = work / 'gateway-study-v5-batch-021-launch-config.json'; retained.unlink()
            with self.assertRaisesRegex(m.Rejected, 'numbered-producer'): m.verify_numbered_entries()
            retained.symlink_to(work / 'missing')
            with self.assertRaises(m.Rejected): m.verify_numbered_entries()

    def test_inventory_and_manifest_preserve_four_file_failure_and_three_six_file_siblings(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary).resolve(); m.configure(context(str(work)))
            keys, events, _ = reader_wave(v5.STUDY)
            reads = GuardedReads(); files, _ = m.study_inventory(reads)
            with patch.multiple(m, EXTRACTIONS=0, READERS=4, JOBS=4):
                jobs = m.job_bindings(reads, files, events)
            self.assertEqual([j['key'] for j in jobs], keys); self.assertEqual([j['ordinal'] for j in jobs], list(range(4)))
            self.assertEqual(len([f for f in files if f['path'].startswith('jobs/')]), 22)
            self.assertNotIn('SYNTHETIC_', json.dumps(jobs)); reads.recheck()
            self.process.assert_not_called()

    def test_native_order_metadata_and_reservation_bindings_cannot_drift(self):
        for mutation in ['ordinal', 'request', 'body-hash', 'received', 'reserve', 'settle']:
            with tempfile.TemporaryDirectory() as temporary:
                work = Path(temporary).resolve(); m.configure(context(str(work)))
                keys, events, put = reader_wave(v5.STUDY); job = v5.STUDY / 'jobs' / keys[1]
                name = 'pending.json' if mutation in ['ordinal', 'request'] else 'response.json' if mutation in ['body-hash', 'received'] else 'reserved.json' if mutation == 'reserve' else 'settled.json'
                path = job / name; value = json.loads(path.read_bytes())
                if mutation == 'ordinal': value['ordinal'] = 2
                if mutation == 'request': value['request']['requestSha256'] = H('wrong-request')
                if mutation == 'body-hash': value['body']['sha256'] = H('wrong-body')
                if mutation == 'received': value['receivedBytes'] += 1
                if mutation in ['reserve', 'settle']: value['micros'] += 1
                put(path, value); reads = GuardedReads(); files, _ = m.study_inventory(reads)
                with self.subTest(mutation=mutation), patch.multiple(m, EXTRACTIONS=0, READERS=4, JOBS=4), self.assertRaises(m.Rejected):
                    m.job_bindings(reads, files, events)

    def test_inventory_rejects_dropped_sibling_forged_terminal_result_and_unsafe_custody(self):
        for mutation in ['drop-sibling', 'terminal-result', 'symlink', 'mode']:
            with tempfile.TemporaryDirectory() as temporary:
                work = Path(temporary).resolve(); m.configure(context(str(work)))
                keys, _, put = reader_wave(v5.STUDY)
                if mutation == 'drop-sibling': (v5.STUDY / 'jobs' / keys[1] / 'settled.json').unlink()
                if mutation == 'terminal-result': put(v5.STUDY / 'jobs' / keys[0] / 'result.json', {})
                if mutation == 'symlink':
                    path = v5.STUDY / 'jobs' / keys[1] / 'response.body'; path.unlink(); path.symlink_to('/synthetic/missing')
                if mutation == 'mode': (v5.STUDY / 'jobs' / keys[1]).chmod(0o755)
                with self.subTest(mutation=mutation), self.assertRaises(m.Rejected): m.study_inventory(GuardedReads())

    def test_exact_four_output_contract_and_exclusive_write_preserve_existing_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary).resolve(); m.configure(context(str(work)))
            old = work / 'old-ledger.jsonl'; old.write_bytes(b'preserved')
            jobs = [{'key': m.TERMINAL, 'phase': 'reader', 'ordinal': 328, 'requestSha256': H('request')}]
            accepts = [{'path': str(work / f'gateway-v5-batch-{i:03}-acceptance.json'), 'sha256': H(str(i))} for i in range(1, 21)]
            result = m.write_documents(iso(100), [], [], accepts, jobs, {'processInventory': {'matchedProducers': 0}})
            manifest = json.loads(m.OUTPUTS['manifest'].read_bytes()); closure = json.loads(m.OUTPUTS['supervisorClosure'].read_bytes())
            inventory = json.loads(m.OUTPUTS['inventory'].read_bytes()); receipt = json.loads(m.OUTPUTS['receipt'].read_bytes())
            self.assertEqual(set(manifest), {'schema', 'createdAt', 'studyDirectory', 'sourceDirectory', 'freeze', 'inventory', 'supervisorClosure', 'jobs', 'terminalReaderJobKey', 'policySha256', 'qualification'})
            self.assertEqual(manifest['schema'], 'oh.gateway-study-import.v6'); self.assertEqual(manifest['jobs'], jobs)
            self.assertEqual(inventory['schema'], 'oh.gateway-import-inventory.v6')
            self.assertEqual(set(closure), {'schema', 'freezeSha256', 'inventorySha256', 'verification', 'allProducersClosed', 'runs', 'acceptances'})
            self.assertEqual(closure['acceptances'], accepts); self.assertEqual(receipt['totalCarriedExposureMicros'], 18268639)
            self.assertFalse(receipt['responseTextInspected']); self.assertFalse(receipt['correctnessInspected'])
            self.assertEqual(set(p.name for p in m.OUTPUTS.values()), {'gateway-study-v6-import-manifest.json', 'gateway-v6-import-closed-inventory.json', 'gateway-v6-import-supervisor-closure.json', 'gateway-v6-import-preparation.json'})
            for key in ['manifest', 'inventory', 'supervisorClosure', 'receipt']:
                path = m.OUTPUTS[key]; self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(result[key]['sha256'], m.digest(path.read_bytes()))
            before = {p: p.read_bytes() for p in m.OUTPUTS.values()}
            with self.assertRaises(m.Rejected): m.write_documents(iso(101), [], [], [], [], {})
            self.assertEqual({p: p.read_bytes() for p in m.OUTPUTS.values()}, before); self.assertEqual(old.read_bytes(), b'preserved')
            self.process.assert_not_called()

    def test_unloaded_context_and_occupied_output_cannot_reach_process_inventory(self):
        with self.assertRaises(gateway_context.ContextError): m.prepare()
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary).resolve(); m.configure(context(str(work)))
            m.OUTPUTS['manifest'].write_bytes(b'existing')
            with patch.object(m, 'verify_context'), self.assertRaisesRegex(m.Rejected, 'occupied-output'):
                m.prepare()
            self.assertEqual(m.OUTPUTS['manifest'].read_bytes(), b'existing')
        self.process.assert_not_called()

    def test_full_twenty_one_producer_preparation_keeps_twenty_acceptances_and_one_fresh_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary, complete_collection_fixture(Path(temporary).resolve()) as (_, jobs, files):
            self.process.side_effect = None
            self.process.return_value = SimpleNamespace(stdout='1 0 1 /sbin/launchd\n80 1 80 /bin/unrelated\n')
            result = m.prepare()
            self.process.assert_called_once_with(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='],
                stdout=m.subprocess.PIPE, stderr=m.subprocess.PIPE, text=True, check=True, timeout=15)
            closure = json.loads(m.OUTPUTS['supervisorClosure'].read_bytes())
            manifest = json.loads(m.OUTPUTS['manifest'].read_bytes())
            receipt = json.loads(m.OUTPUTS['receipt'].read_bytes())
            self.assertEqual(manifest['jobs'], jobs); self.assertEqual(len(closure['runs']), 21); self.assertEqual(len(closure['acceptances']), 20)
            self.assertEqual([r['runnerExitCode'] for r in closure['runs']], [0] * 20 + [1])
            self.assertEqual(closure['runs'][-1]['newTransportInvocations'], 168)
            self.assertEqual(receipt['studyFiles'], len(files)); self.assertEqual(receipt['unresolvedReservationMicros'], 100)
            self.assertEqual(receipt['processInventory']['matchedProducers'], 0); self.assertEqual(result['modelCalls'], 0)

    def test_changed_accepted_prefix_and_live_final_group_cannot_emit_manifest(self):
        for mutation in ['accepted-inventory', 'live-group']:
            with tempfile.TemporaryDirectory() as temporary, complete_collection_fixture(Path(temporary).resolve()) as (docs, _, _):
                self.process.reset_mock(); self.process.side_effect = None
                self.process.return_value = SimpleNamespace(stdout='80 1 33942 /bin/unrelated\n' if mutation == 'live-group' else '1 0 1 /sbin/launchd\n')
                if mutation == 'accepted-inventory':
                    # Re-pin the altered acceptance and inventory, but the original
                    # bytes must still match the complete current study inventory.
                    acceptance_path = str(v5.WORK / 'gateway-v5-batch-010-acceptance.json')
                    accepted = json.loads(docs[acceptance_path]); invpath = accepted['inventory']['path']
                    inv = json.loads(docs[invpath]); inv['files'][0]['sha256'] = H('changed-original-artifact')
                    docs[invpath] = enc(inv); accepted['inventory']['sha256'] = m.digest(docs[invpath]); docs[acceptance_path] = enc(accepted)
                with self.subTest(mutation=mutation), self.assertRaises(m.Rejected): m.prepare()
                self.assertTrue(all(not path.exists() for path in m.OUTPUTS.values()))
                self.assertEqual(self.process.call_count, int(mutation == 'live-group'))


if __name__ == '__main__':
    unittest.main()
