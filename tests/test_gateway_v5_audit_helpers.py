"""Synthetic validation only: process calls are mocked and all study fixtures are temporary."""
import copy
from contextlib import contextmanager, ExitStack
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sys
REPOSITORY = Path(__file__).resolve().parents[1]
HELPERS = REPOSITORY / 'scripts/benchmark-audit'
sys.path.insert(0, str(HELPERS))
import prepare_gateway_v5_final_audit as m
import close_gateway_v5_batch as closer
import gateway_context as context_module

def context_document(work='/synthetic/artifacts', repository='/synthetic/repository'):
    return {'schema': 'oh.gateway-audit-context.v1', 'workDirectory': work, 'repositoryDirectory': repository,
            'tools': {'python': '/synthetic/bin/python3', 'bun': '/synthetic/bin/bun', 'vercel': '/synthetic/bin/vercel', 'ps': '/bin/ps'},
            'auth': {'method': 'project-oidc', 'project': 'example-project', 'scope': 'example-owner', 'environment': 'development'}}

m.configure(context_module.parse_context(context_document()))
H = lambda x: m.digest(x.encode())
T = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
iso = lambda n: (T + dt.timedelta(seconds=n)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
enc = lambda x: (json.dumps(x) + '\n').encode()


@contextmanager
def binding_fixture():
    """A complete synthetic first launch, pinned through the same production validators."""
    with tempfile.TemporaryDirectory() as temporary, ExitStack() as patches:
        root = Path(temporary).resolve(); work, repo = root / 'artifacts', root / 'repo'
        work.mkdir(mode=0o700); repo.mkdir(mode=0o700)
        def put(path, value):
            raw = value if type(value) is bytes else enc(value)
            path.write_bytes(raw); path.chmod(0o600)
            return {'path': str(path), 'sha256': m.digest(raw)}
        context_path = root / 'context.json'
        put(context_path, context_document(str(work), str(repo)))
        context = context_module.load_context(context_path)
        context.study.mkdir(mode=0o700)
        first_job = work / 'gateway-study-v5-batch-001'; first_job.mkdir(mode=0o700)
        authority = put(work / 'authority.json', {'schema': 'oh.gateway-v3-authority.v1', 'project': context.project, 'scope': context.scope, 'environment': 'development'})
        auth = context_document()['auth']
        freeze = put(context.study / 'freeze.json', {'protocol': 'oh.memory-gateway-freeze.v5', 'authority': authority, 'procedure': {'auth': auth}})
        argv = [str(context.vercel), 'env', 'run', '--project', context.project, '--scope', context.scope, '--environment', 'development', '--', str(context.bun),
                str(context.runtime / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(context.study), '--freeze-sha256', freeze['sha256'], '--max-new-calls', '32']
        configuration = put(first_job / 'config.json', m.canonical({'argv': argv, 'cwd': str(context.runtime), 'jobDir': str(first_job), 'requireAbsent': list(map(str, context.locks))}))
        prepared = put(work / 'gateway-v5-runtime-preparation.json', {'runtime': str(context.runtime), 'gitHead': m.HEAD, 'modelCalls': 0, 'result': {'freezeSha256': freeze['sha256']}, 'sourceSha256': m.SOURCE})
        for name, pin in [('STUDY_FREEZE_SHA256', freeze), ('STUDY_AUTHORITY_SHA256', authority), ('FIRST_CONFIGURATION_SHA256', configuration)]:
            patches.enter_context(patch.object(context_module, name, pin['sha256']))
        patches.enter_context(patch.object(closer, 'PREPARATION_SHA256', prepared['sha256']))
        patches.enter_context(patch.object(m, 'PREPARATION', prepared['sha256']))
        patches.enter_context(patch.object(m, 'FREEZE', freeze['sha256']))
        yield context, {'freeze': freeze, 'authority': authority, 'firstConfiguration': configuration}, put


def fixture():
    run = '00000000-0000-4000-8000-000000000001'
    keys = [H(f'key-{i}') for i in range(4)]
    pin = lambda name: {'path': str(m.STUDY / name), 'sha256': H(name)}
    qualified = {'method': 'project-oidc', 'project': m.PROJECT, 'scope': m.SCOPE, 'environment': 'development', 'issuer': f'https://oidc.vercel.com/{m.SCOPE}',
                 'subject': f'owner:{m.SCOPE}:project:{m.PROJECT}:environment:development', 'audience': f'https://vercel.com/{m.SCOPE}', 'expiresAt': T.timestamp() + 9999, 'signatureVerifiedLocally': False}
    a = {'protocol': 'oh.memory-gateway-batch-admission.v5', 'runId': run, 'freezeSha256': m.FREEZE, 'sourceSha256': m.SOURCE, 'importedStudySha256': m.CLAUDE,
         'priorGatewayStudySha256': m.PRIOR_GATEWAY, 'priorContinuationStudySha256': m.PRIOR_CONTINUATION, 'priorGatewayExposureMicros': m.CARRY,
         'start': iso(10), 'maximumNewCalls': 4, 'concurrency': 4, 'openingLedgerExposureMicros': 0, 'initialJobKeysSha256': m.digest(m.canonical([])), 'qualified': qualified}
    b = {'protocol': 'oh.memory-gateway-batch.v5', 'runId': run, 'freezeSha256': m.FREEZE, 'sourceSha256': m.SOURCE, 'importedStudySha256': m.CLAUDE,
         'priorGatewayStudySha256': m.PRIOR_GATEWAY, 'priorContinuationStudySha256': m.PRIOR_CONTINUATION, 'start': iso(10), 'end': iso(20), 'admission': pin(f'batch-{run}-started.json'),
         'maximumNewCalls': 4, 'concurrency': 4, 'newTransportInvocations': 4, 'admittedKeys': keys, 'initialJobKeys': [], 'finalJobKeys': sorted(keys), 'failed': False, 'interrupted': False,
         'storeClosed': True, 'sourceVerifiedAtClose': True, 'importVerifiedAtClose': True, 'originalLedgerVerifiedAtClose': True, 'priorGatewayVerifiedAtClose': True, 'priorContinuationVerifiedAtClose': True,
         'stopReason': None, 'qualified': qualified, 'ledger': {}, 'comparisonArtifact': pin(f'comparison-{run}.json'), 'result': {'status': 'completed', 'phase': 'judge', 'resolved': 360, 'required': 360}}
    r = {'schema': 'oh.gateway-v5-batch-acceptance.v1', 'recordedAt': iso(22), 'number': 1, 'runId': run, 'admission': b['admission'], 'closure': pin(f'batch-{run}.json'),
         'configuration': {'path': str(m.WORK / 'gateway-study-v5-batch-001/config.json'), 'sha256': H('config')}, 'supervisorStatus': {'path': str(m.WORK / 'gateway-study-v5-batch-001/status.json'), 'sha256': H('status')},
         'groupGone': True, 'freshOsProcessMatches': 0, 'newTransportInvocations': 4, 'totalNewJobCount': 4, 'result': b['result'], 'ledgerExposureMicros': 4, 'priorGatewayExposureMicros': m.CARRY,
         'totalAmendmentExposureMicros': m.CARRY + 4, 'inventory': pin('inventory.json'), 'allOriginalLedgersUnchanged': True, 'priorInventoryUnchanged': True, 'correctnessInspected': False, 'modelCallsByVerifier': 0}
    job = m.WORK / 'gateway-study-v5-batch-001'
    argv = [m.VERCEL, 'env', 'run', '--project', m.PROJECT, '--scope', m.SCOPE, '--environment', 'development', '--', m.BUN,
            str(m.RUNTIME / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(m.STUDY), '--freeze-sha256', m.FREEZE, '--max-new-calls', '4']
    c = {'argv': argv, 'cwd': str(m.RUNTIME), 'jobDir': str(job), 'requireAbsent': list(map(str, m.LOCKS))}
    config_pin = {'path': str(job / 'config.json'), 'sha256': m.digest(m.canonical(c))}
    status_pin = {'path': str(job / 'status.json'), 'sha256': H('status')}
    s = {'state': 'exited', 'supervisorPid': 101, 'supervisorStart': 'start-101', 'bootIdentity': 'boot-1', 'commandSha256': m.digest(m.canonical(argv)), 'configSha256': config_pin['sha256'],
         'startedAt': iso(9).replace('.000Z', 'Z'), 'childPid': 102, 'childPgid': 102, 'childStart': 'start-102', 'exitCode': 0, 'groupGone': True, 'finishedAt': iso(21).replace('.000Z', 'Z')}
    return r, a, b, c, s, config_pin, status_pin


class CollectorTests(unittest.TestCase):
    def test_complete_batch_and_supervisor_are_bound(self):
        r, a, b, c, s, cp, sp = fixture()
        result = m.validate_batch(r, a, b, 1, True, [], 0, T)
        self.assertEqual(result['finalKeys'], b['finalJobKeys'])
        producer = m.validate_supervisor(c, s, cp, sp, 1, 4, result['start'], result['end'], T)
        self.assertEqual(producer['pids'], [101, 102])
        self.assertEqual(producer['pgid'], 102)

    def test_final_requires_complete360_without_semantic_scores(self):
        for change in [{'resolved': 359}, {'required': 359}, {'status': 'paused'}, {'phase': 'reader'}]:
            r, a, b, *_ = fixture(); b['result'] = {**b['result'], **change}; r['result'] = b['result']
            with self.subTest(change=change), self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, True, [], 0, T)
        r, a, b, *_ = fixture(); b['comparisonArtifact']['path'] = str(m.STUDY / 'comparison-other.json')
        with self.assertRaisesRegex(m.Rejected, 'comparison-path'): m.validate_batch(r, a, b, 1, True, [], 0, T)

    def test_old_batches_must_pause_only_at_calllimit(self):
        r, a, b, *_ = fixture(); b['result'] = {'status': 'paused', 'phase': 'extract', 'resolved': 4, 'required': 4732}; r['result'] = b['result']; b['comparisonArtifact'] = None; b['stopReason'] = 'call-limit'
        self.assertEqual(m.validate_batch(r, a, b, 1, False, [], 0, T)['count'], 4)
        for reason in ['budget', 'interrupted', None]:
            b['stopReason'] = reason
            with self.subTest(reason=reason), self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, False, [], 0, T)

    def test_ancestry_carry_and_key_history_cannot_be_substituted(self):
        for field in ['sourceSha256', 'freezeSha256', 'importedStudySha256', 'priorGatewayStudySha256', 'priorContinuationStudySha256']:
            r, a, b, *_ = fixture(); b[field] = H('changed'); a[field] = b[field]
            with self.subTest(field=field), self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, True, [], 0, T)
        for patch in [{'priorGatewayExposureMicros': 0}, {'openingLedgerExposureMicros': 1}, {'initialJobKeysSha256': H('changed')}]:
            r, a, b, *_ = fixture(); a.update(patch)
            with self.subTest(patch=patch), self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, True, [], 0, T)
        r, a, b, *_ = fixture()
        with self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, True, [b['admittedKeys'][0]], 0, T)
        b['finalJobKeys'] = b['finalJobKeys'][:-1]
        with self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, True, [], 0, T)

    def test_closed_flags_must_be_boolean_and_full(self):
        for field in ['storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose', 'priorGatewayVerifiedAtClose', 'priorContinuationVerifiedAtClose']:
            for bad in [False, 1, 'true']:
                r, a, b, *_ = fixture(); b[field] = bad
                with self.subTest(field=field, bad=bad), self.assertRaises(m.Rejected): m.validate_batch(r, a, b, 1, True, [], 0, T)

    def test_supervisor_command_lifetime_and_process_binding(self):
        for change in ['scope', 'exit', 'group', 'lock', 'overlap', 'late-start', 'wrong-status-path']:
            _, _, _, c, s, cp, sp = fixture(); previous_end = T
            if change == 'scope': c['argv'][4] = 'other'
            if change == 'exit': s['exitCode'] = 1
            if change == 'group': s['groupGone'] = False
            if change == 'lock': c['requireAbsent'].pop()
            if change == 'overlap': previous_end = T + dt.timedelta(seconds=10)
            if change == 'late-start': s['startedAt'] = iso(11).replace('.000Z', 'Z')
            if change == 'wrong-status-path': sp['path'] = str(m.WORK / 'other-status.json')
            with self.subTest(change=change), self.assertRaises(m.Rejected): m.validate_supervisor(c, s, cp, sp, 1, 4, T + dt.timedelta(seconds=10), T + dt.timedelta(seconds=20), previous_end)

    def test_ledger_preserves_full_carry_at_every_prefix(self):
        reserve = {'v': 1, 'id': H('job'), 'kind': 'reserved', 'micros': m.CAP - m.CARRY}
        settle = {**reserve, 'kind': 'settled', 'micros': 1}
        self.assertEqual(m.ledger_events(enc(reserve) + enc(settle))[1], 1)
        for events in [[{**reserve, 'micros': reserve['micros'] + 1}, settle], [reserve], [reserve, reserve, settle], [settle], [reserve, {**settle, 'micros': reserve['micros'] + 1}]]:
            with self.subTest(events=events), self.assertRaises(m.Rejected): m.ledger_events(b''.join(map(enc, events)))
        with self.assertRaises(m.Rejected): m.ledger_events((enc(reserve) + enc(settle))[:-1])

    def test_inventory_requires_sorted_unique_safe_paths(self):
        inv = {'schema': 'oh.gateway-final-inventory.v5', 'freezeSha256': m.FREEZE, 'files': [{'path': 'freeze.json', 'sha256': H('freeze'), 'bytes': 1}, {'path': 'ledger.jsonl', 'sha256': H('ledger'), 'bytes': 2}]}
        self.assertEqual(m.inventory_shape(inv), inv['files'])
        for change in ['duplicate', 'reversed', 'escape', 'absolute', 'negative', 'extra']:
            v = copy.deepcopy(inv)
            if change == 'duplicate': v['files'][1] = v['files'][0]
            if change == 'reversed': v['files'].reverse()
            if change == 'escape': v['files'][0]['path'] = '../outside'
            if change == 'absolute': v['files'][0]['path'] = '/outside'
            if change == 'negative': v['files'][0]['bytes'] = -1
            if change == 'extra': v['files'][0]['extra'] = True
            with self.subTest(change=change), self.assertRaises(m.Rejected): m.inventory_shape(v)

    def test_retained_launch_configs_are_required_and_types_or_extra_producers_rejected(self):
        entries = [(f'gateway-study-v5-batch-{i:03}', 'directory') for i in [1, 2]] + [(f'gateway-study-v5-batch-{i:03}-launch-config.json', 'file') for i in [1, 2]]
        m.validate_numbered_producer_entries(entries, 2)
        for invalid in [entries[:-1], entries + [('gateway-study-v5-batch-003', 'directory')],
                        entries + [('gateway-study-v5-batch-002-unexpected.json', 'file')], entries + [entries[0]],
                        [(name, 'special' if n == 0 else kind) for n, (name, kind) in enumerate(entries)],
                        [(name, 'directory' if name.endswith('.json') else kind) for name, kind in entries]]:
            with self.subTest(entries=invalid), self.assertRaises(m.Rejected): m.validate_numbered_producer_entries(invalid, 2)
        with tempfile.TemporaryDirectory() as root:
            path = Path(root).resolve() / 'launch-config.json'; path.write_bytes(b'canonical config'); path.chmod(0o600)
            reads = m.Reads(); config_pin = {'path': str(path), 'sha256': H('canonical config')}
            self.assertEqual(reads.pinned(config_pin, 1024, private=True), b'canonical config')
            with self.assertRaisesRegex(m.Rejected, 'pinned-file-changed'):
                m.Reads().pinned({**config_pin, 'sha256': H('different supervisor config')}, 1024, private=True)

    def test_process_inventory_detects_known_pids_groups_and_undeclared_producers(self):
        p = [{'pids': [101, 102], 'pgid': 102}]
        self.assertEqual(m.validate_process_absence('1 0 1 /sbin/launchd\n99 1 99 /bin/other\n', p), 2)
        for line in ['101 1 50 innocent', '200 1 102 innocent', '200 1 200 bun /other/gateway-study-v5.ts run',
                     f'200 1 200 python {m.WORK}/benchmark-supervisor.py run {m.WORK}/gateway-study-v5-batch-999',
                     f'200 1 200 bun {m.RUNTIME}/unknown.ts', 'bad', '']:
            with self.subTest(line=line), self.assertRaises(m.Rejected): m.validate_process_absence(line, p)

    def test_comparison_checks_count_identity_not_correctness(self):
        freeze = {'study': {'fixed': True}, 'procedure': {'profile': 'synthetic'}}
        value = {'protocol': 'oh.memory-gateway-study.v5', 'freezeSha256': m.FREEZE, **freeze, 'originalStudiesStatus': 'incomplete',
                 'extraction': {'imported': {}, 'priorGateway': {}, 'priorContinuation': {}, 'rows': [{}] * 4732},
                 'readers': [{'status': 'completed', 'ordinal': i, 'prediction': 'SYNTHETIC_SENTINEL'} for i in range(360)],
                 'judgments': [{'status': 'completed', 'ordinal': i, 'correct': object()} for i in range(360)], 'physicalJudgeResults': [{}], 'assessment': object()}
        self.assertEqual(m.validate_comparison_shape(value, freeze), 1)
        for field in ['readers', 'judgments']:
            other = dict(value); other[field] = value[field][:-1]
            with self.subTest(field=field), self.assertRaises(m.Rejected): m.validate_comparison_shape(other, freeze)
        value['judgments'][359]['ordinal'] = 0
        with self.assertRaises(m.Rejected): m.validate_comparison_shape(value, freeze)

    def test_stable_reads_refuse_replaced_or_symlinked_evidence(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root).resolve(); path = root / 'file'; path.write_bytes(b'original'); path.chmod(0o600)
            reads = m.Reads(); self.assertEqual(reads.read(path, 32, private=True), b'original')
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(m.Rejected, 'observed-file-changed'): reads.recheck()
            path.unlink(); path.symlink_to(root / 'missing')
            with self.assertRaises(OSError): m.Reads().read(path, 32)

    def test_readback_rejects_file_mode_or_inode_substitution(self):
        for mutation in ['mode', 'inode']:
            with tempfile.TemporaryDirectory() as root:
                root = Path(root).resolve(); path = root / 'file'; path.write_bytes(b'unchanged'); path.chmod(0o600)
                reads = m.Reads(); reads.read(path, 32, private=True)
                if mutation == 'mode': path.chmod(0o644)
                else:
                    replacement = root / 'replacement'; replacement.write_bytes(b'unchanged'); replacement.chmod(0o600); replacement.replace(path)
                with self.subTest(mutation=mutation), self.assertRaisesRegex(m.Rejected, 'custody-changed'): reads.recheck()

    def test_exclusive_outputs_never_overwrite_or_follow_occupied_paths(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root).resolve(); a, b = root / 'a', root / 'b'
            b.write_bytes(b'preserve')
            with self.assertRaises(m.Rejected): m.exclusive_outputs({a: b'new', b: b'replace'})
            self.assertFalse(a.exists()); self.assertEqual(b.read_bytes(), b'preserve')
            b.unlink(); b.symlink_to(a)
            with self.assertRaises(m.Rejected): m.exclusive_outputs({a: b'new', b: b'replace'})
            self.assertFalse(a.exists()); b.unlink()
            result = m.exclusive_outputs({a: b'first', b: b'second'})
            self.assertEqual(result[str(a)]['sha256'], H('first')); self.assertEqual(a.stat().st_mode & 0o777, 0o600)

    def test_decode_rejects_duplicate_keys_nonfinite_and_comparison_equality_handles_js_numbers(self):
        for raw in [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}']:
            with self.assertRaises(m.Rejected): m.decode(raw)
        m.equal({'usd': 1.0}, {'usd': 1}, 'number-equality')
        with self.assertRaises(m.Rejected): m.integer(True)


class ContextTests(unittest.TestCase):
    def test_explicit_context_derives_paths_tools_and_authority(self):
        value = context_document(); c = context_module.parse_context(value)
        self.assertEqual(c.runtime, Path(value['workDirectory']) / 'gateway-study-v5-candidate')
        self.assertEqual(c.study, Path(value['workDirectory']) / 'gateway-study-v5')
        self.assertEqual(str(c.ps), value['tools']['ps']); self.assertEqual(c.project, 'example-project')
        self.assertEqual(len(c.locks), 6)
        value['auth']['project'] = 'changed'
        self.assertEqual(c.project, 'example-project')
        with self.assertRaises(Exception): c.project = 'mutable'

    def test_context_rejects_unknown_fields_unsafe_paths_and_authority_overrides(self):
        for change in ['extra', 'schema', 'relative', 'alias', 'null', 'tool', 'same-basename-ps', 'scope', 'auth', 'environment', 'same-directory']:
            value = context_document()
            if change == 'extra': value['allowRetry'] = True
            if change == 'schema': value['schema'] = 'other'
            if change == 'relative': value['workDirectory'] = 'relative'
            if change == 'alias': value['repositoryDirectory'] = '/synthetic/../other'
            if change == 'null': value['tools']['ps'] = None
            if change == 'tool': value['tools']['ps'] = '/bin/sh'
            if change == 'same-basename-ps': value['tools']['ps'] = '/untrusted/bin/ps'
            if change == 'scope': value['auth']['scope'] = 'owner --escape'
            if change == 'auth': value['auth']['method'] = 'personal-key'
            if change == 'environment': value['auth']['environment'] = 'production'
            if change == 'same-directory': value['repositoryDirectory'] = value['workDirectory']
            with self.subTest(change=change), self.assertRaises(context_module.ContextError): context_module.parse_context(value)

    def test_context_file_is_bounded_unique_and_immutable(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root).resolve(); path = root / 'context.json'; raw = enc(context_document())
            path.write_bytes(raw); c = context_module.load_context(path); context_module.verify_context(c)
            self.assertEqual(c.document_sha256, m.digest(raw))
            path.write_bytes(enc({**context_document(), 'extra': True}))
            with self.assertRaises(context_module.ContextError): context_module.verify_context(c)
            for raw in [b'{"schema":"a","schema":"b"}', b'{"schema":NaN}', b' ' * 65537]:
                path.write_bytes(raw)
                with self.subTest(raw=raw[:40]), self.assertRaises(context_module.ContextError): context_module.load_context(path)
            path.unlink(); path.symlink_to(root / 'missing')
            with self.assertRaises(OSError): context_module.load_context(path)

    def test_unloaded_context_cannot_run_operational_helpers(self):
        context = context_module.parse_context(context_document())
        with self.assertRaises(context_module.ContextError): closer.close_batch(context, 1)
        previous = m.CONTEXT
        try:
            m.configure(context)
            with self.assertRaises(context_module.ContextError): m.prepare(1, H('final'))
        finally: m.configure(previous)

    def test_binding_authenticates_the_full_synthetic_first_capture(self):
        with binding_fixture() as (context, pins, _):
            self.assertEqual(context_module.validate_study_binding(context, pins['freeze']), pins)
            from dataclasses import replace
            with self.assertRaisesRegex(context_module.ContextError, 'admitted document'):
                context_module.validate_study_binding(replace(context, ps=Path('/untrusted/ps')), pins['freeze'])

    def test_binding_rejects_auth_tools_and_paths_not_in_immutable_evidence(self):
        for field in ['project', 'scope', 'bun', 'vercel', 'repository']:
            with self.subTest(field=field), binding_fixture() as (context, pins, put):
                document = json.loads(context.document_path.read_bytes())
                if field in ['project', 'scope']: document['auth'][field] = 'different-authority'
                elif field == 'repository': document['repositoryDirectory'] += '-different'
                else: document['tools'][field] = '/different/bin/' + field
                put(context.document_path, document); other = context_module.load_context(context.document_path)
                with self.assertRaises(context_module.ContextError): context_module.validate_study_binding(other, pins['freeze'])

    def test_binding_rejects_rewritten_pinned_authority_freeze_and_first_launch(self):
        for name in ['authority', 'freeze', 'firstConfiguration']:
            with self.subTest(name=name), binding_fixture() as (context, pins, put):
                path = Path(pins[name]['path']); put(path, path.read_bytes() + b' ')
                with self.assertRaisesRegex(context_module.ContextError, 'evidence changed'):
                    context_module.validate_study_binding(context, pins['freeze'])
        with binding_fixture() as (context, pins, _):
            with self.assertRaises(context_module.ContextError):
                context_module.validate_study_binding(context, {**pins['freeze'], 'sha256': H('substitute')})

    def test_both_operational_entries_reject_binding_before_any_process_or_output(self):
        for field in ['project', 'scope', 'bun', 'vercel']:
            with self.subTest(field=field), binding_fixture() as (context, pins, put):
                document = json.loads(context.document_path.read_bytes())
                if field in ['project', 'scope']: document['auth'][field] = 'different-authority'
                else: document['tools'][field] = '/different/bin/' + field
                put(context.document_path, document); other = context_module.load_context(context.document_path)
                with patch.object(closer.subprocess, 'run', side_effect=AssertionError('process must not be reached')) as process:
                    with self.assertRaises(context_module.ContextError): closer.close_batch(other, 1)
                    process.assert_not_called()
                previous = m.CONTEXT
                try:
                    m.configure(other)
                    # Only unrelated packet/source prerequisites are stubbed; the actual pinned binding reads execute.
                    with patch.object(m, 'verify_auditor_packet', return_value={}), patch.object(m, 'source_identity', return_value=[]), patch.object(m.subprocess, 'run', side_effect=AssertionError('process must not be reached')) as process:
                        with self.assertRaises(context_module.ContextError): m.prepare(1, H('final'))
                        process.assert_not_called()
                    self.assertTrue(all(not p.exists() for p in m.OUTPUTS.values()))
                finally: m.configure(previous)
                self.assertEqual(list(other.work.glob('gateway-v5-batch-*-acceptance.json')), [])

    def test_port_keeps_fixed_accepted_packet_and_public_provenance(self):
        self.assertEqual(m.SOURCE, '896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433')
        self.assertEqual(m.CARRY, 809209); self.assertEqual(m.CAP, 40000000)
        self.assertEqual(m.CLOSER, '6960dce9186eff90c225991d42d541f1c39d297083f0fbf5a0e8ba3b2fdc7fb0')
        self.assertEqual(m.AUDITOR_ACCEPTANCE, 'b5adcbbea11c6a181337c25ac9c6d77734b60aa8359f2ca143c243af6d7b3af3')
        for module in [m, closer, context_module]:
            source = Path(module.__file__).read_text()
            self.assertNotIn('/Users/', source)


class ClosurePortTests(unittest.TestCase):
    def test_configured_closure_reuses_checked_ps_only_and_preserves_study_bytes(self):
        from types import SimpleNamespace
        with binding_fixture() as (context, pins, put):
            work, repo, study = context.work, context.repository, context.study
            job = work / 'gateway-study-v5-batch-001'; (study / 'jobs').mkdir(mode=0o700)
            frozen = pins['freeze']
            run = '00000000-0000-4000-8000-000000000001'; keys = sorted(H(f'closure-job-{i}') for i in range(32))
            events = [{'v': 1, 'id': key, 'kind': 'reserved', 'micros': 10} for key in keys] + [{'v': 1, 'id': key, 'kind': 'settled', 'micros': 1} for key in keys]
            ledger_raw = b''.join(map(enc, events)); ledger = put(study / 'ledger.jsonl', ledger_raw)
            for key in keys:
                directory = study / 'jobs' / key; directory.mkdir(mode=0o700)
                for filename in m.JOB_FILES: put(directory / filename, {'synthetic': True})
            admission = {'protocol': 'oh.memory-gateway-batch-admission.v5', 'runId': run, 'start': iso(10), 'sourceSha256': m.SOURCE, 'freezeSha256': frozen['sha256'],
                         'importedStudySha256': m.CLAUDE, 'priorGatewayStudySha256': m.PRIOR_GATEWAY, 'priorContinuationStudySha256': m.PRIOR_CONTINUATION,
                         'maximumNewCalls': 32, 'concurrency': 4, 'priorGatewayExposureMicros': m.CARRY}
            admission_pin = put(study / f'batch-{run}-started.json', admission)
            closed = {**admission, 'protocol': 'oh.memory-gateway-batch.v5', 'end': iso(20), 'admission': admission_pin, 'newTransportInvocations': 32,
                      'admittedKeys': keys, 'initialJobKeys': [], 'finalJobKeys': keys, 'failed': False, 'interrupted': False,
                      **{field: True for field in ['storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose', 'priorGatewayVerifiedAtClose', 'priorContinuationVerifiedAtClose']},
                      'result': {'status': 'paused', 'phase': 'extract', 'resolved': 32, 'required': 4732},
                      'ledger': {**ledger, 'bytes': len(ledger_raw), 'exposureMicros': 32, 'totalAmendmentExposureMicros': m.CARRY + 32, 'priorGatewayExposureMicros': m.CARRY}}
            put(study / f'batch-{run}.json', closed)
            argv = [str(context.vercel), 'env', 'run', '--project', context.project, '--scope', context.scope, '--environment', 'development', '--', str(context.bun),
                    str(context.runtime / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(study), '--freeze-sha256', frozen['sha256'], '--max-new-calls', '32']
            config = {'argv': argv, 'cwd': str(context.runtime), 'jobDir': str(job), 'requireAbsent': list(map(str, context.locks))}
            config_pin = put(job / 'config.json', m.canonical(config))
            put(job / 'status.json', {'state': 'exited', 'groupGone': True, 'exitCode': 0, 'supervisorPid': 500, 'childPid': 501, 'childPgid': 501,
                                    'configSha256': config_pin['sha256'], 'commandSha256': m.digest(m.canonical(argv)), 'startedAt': iso(9), 'finishedAt': iso(21)})
            old_hashes = {}
            for name, parent, filename in [('gateway-study-v3', work / 'gateway-study-v3', 'ledger.jsonl'), ('gateway-study-v4', work / 'gateway-study-v4', 'ledger.jsonl'), ('api', repo / '.cache/benchmarks', 'openai-pilot-budget.jsonl')]:
                parent.mkdir(parents=True); old_hashes[name] = put(parent / filename, b'synthetic immutable ledger')['sha256']
            before = {str(p): p.read_bytes() for p in study.rglob('*') if p.is_file()}
            with patch.object(closer, 'OLD_LEDGER_HASHES', old_hashes), patch.object(closer.subprocess, 'run', return_value=SimpleNamespace(stdout='1 1\n')) as process:
                result = closer.close_batch(context, 1)
                process.assert_called_once_with([str(context.ps), '-axo', 'pid=,pgid='], capture_output=True, text=True, check=True)
                self.assertEqual(result['newCalls'], 32); self.assertEqual(result['totalNewJobs'], 32)
                receipt_path = Path(result['receipt']['path']); receipt_before = receipt_path.read_bytes()
                with self.assertRaises(FileExistsError): closer.close_batch(context, 1)
                self.assertEqual(receipt_path.read_bytes(), receipt_before)
            self.assertEqual({str(p): p.read_bytes() for p in study.rglob('*') if p.is_file()}, before)
            self.assertEqual(Path(result['inventory']['path']).stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    with patch.object(m.subprocess, 'run', side_effect=AssertionError('No process launch allowed in synthetic tests')):
        unittest.main()
