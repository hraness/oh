#!/usr/bin/env python3
"""Prepare closed-study audit inputs. Never run the auditor, model, or store.

Production entry requires an explicit SHA for the final numbered acceptance.
Requires --context with explicit machine paths and authority. The accepted original
packet is still required; this port does not rebase any frozen evidence.
Only the root-owned future invocation may perform one read-only ps inventory.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

from gateway_context import GatewayContext, ContextError, load_context, verify_context, validate_study_binding

CONTEXT = None
WORK = REPO = RUNTIME = STUDY = None
BUN = VERCEL = PS = PROJECT = SCOPE = None
SOURCE = '896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433'
HEAD = '7e5cdcfc9ef211d3108bc1bf26279e071d3fbecb'
FREEZE = '92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a'
CLAUDE = '737cc332334d684c81bba60f7c47fc38caefd8739817983a4655e84d1cfa65c4'
PRIOR_GATEWAY = 'e7657389e60a7136694a609cbe6db19cc1f5db84d2136ab84d0d41f78644a589'
PRIOR_CONTINUATION = 'a34af0222ca0857956b7cc42efeb5261a68b1b0a57826c0cfbfe3fdfad630939'
CARRY, CAP, M = 809209, 40000000, 1024 * 1024
PREPARATION = 'ea13440e8c405e288c1e7bfaea7a0c1d78aba755cf6e1dcbfa42601db1c03e71'
AUDITOR_ACCEPTANCE = 'b5adcbbea11c6a181337c25ac9c6d77734b60aa8359f2ca143c243af6d7b3af3'
AUDITOR_REVIEW = 'fec53a5191c4ebf55015acf2e04f3b484f462764e9bfd5268f748fd0c1c3e49b'
AUDITOR_VALIDATION = 'd9b5127f8aef0bfe66c6ec27d54af10a4436a40e9fffd695623bb28fb0412fc3'
CLOSER = '6960dce9186eff90c225991d42d541f1c39d297083f0fbf5a0e8ba3b2fdc7fb0'
CLOSER_REVIEW = 'a448d1530f44f142b18bc5941db73a54848785e35f4ec926601104e88cfa5ae8'
HEX = re.compile(r'[a-f0-9]{64}\Z')
RUN_ID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z')
JOB_FILES = ['pending.json', 'reserved.json', 'response.body', 'response.json', 'result.json', 'settled.json']
OUTPUTS = {}
LOCKS = []
OLD_LEDGERS = []


def configure(context):
    """Bind explicit context once per CLI invocation; no evidence is relocated."""
    global CONTEXT, WORK, REPO, RUNTIME, STUDY, BUN, VERCEL, PS, PROJECT, SCOPE, OUTPUTS, LOCKS, OLD_LEDGERS
    if not isinstance(context, GatewayContext):
        raise ContextError("expected parsed Gateway context")
    CONTEXT = context
    WORK, REPO, RUNTIME, STUDY = context.work, context.repository, context.runtime, context.study
    BUN, VERCEL, PS = str(context.bun), str(context.vercel), str(context.ps)
    PROJECT, SCOPE = context.project, context.scope
    OUTPUTS = {name: WORK / file for name, file in {
        'inventory': 'gateway-v5-final-closed-inventory.json',
        'supervisorClosure': 'gateway-v5-final-supervisor-closure.json',
        'configuration': 'gateway-v5-final-audit-config.json',
        'receipt': 'gateway-v5-final-audit-preparation.json',
    }.items()}
    LOCKS = [WORK / folder / 'active.lock' for folder in [
        'claude-subscription-study-v1', 'claude-subscription-study-v2', 'gateway-study-v3', 'gateway-study-v4', 'gateway-study-v5'
    ]] + [REPO / '.cache/benchmarks/openai-pilot.lock']
    OLD_LEDGERS = [
        (WORK / 'gateway-study-v3/ledger.jsonl', '7f3830a8b69276f22614b896b01bd3534fc76ef6669b293de4e0b3ac3ec97996'),
        (WORK / 'gateway-study-v4/ledger.jsonl', '426f0ab07b34613a7265f1ef600bdc477cd169f23b92e5941108cc0142e1415b'),
        (REPO / '.cache/benchmarks/openai-pilot-budget.jsonl', 'c972b7e8643db61aa5a3d2b50df9aa095834be1f5b43ec680aacf5d0507f559b'),
    ]


class Rejected(ValueError):
    pass


def need(value, reason):
    if not value:
        raise Rejected(reason)


def exact(value, keys, reason='object-shape'):
    need(type(value) is dict and set(value) == set(keys), reason)


def integer(value, minimum=0, maximum=2**53 - 1):
    need(type(value) is int and minimum <= value <= maximum, 'integer-bound')
    return value


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    def normalize(item):
        if type(item) is float:
            need(math.isfinite(item), 'nonfinite-number')
            return int(item) if item.is_integer() else item
        if type(item) is dict:
            return {key: normalize(v) for key, v in item.items()}
        if type(item) in [list, tuple]:
            return [normalize(v) for v in item]
        return item
    return json.dumps(normalize(value), sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def equal(left, right, reason):
    need(canonical(left) == canonical(right), reason)


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'duplicate-json-key')
            result[key] = value
        return result
    def invalid(_):
        raise Rejected('nonfinite-json')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)


def timestamp(value, seconds=False):
    pattern = r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ' if seconds else r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z'
    need(type(value) is str and re.fullmatch(pattern, value), 'timestamp-format')
    try:
        date = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise Rejected('timestamp-date') from error
    need(date.isoformat(timespec='seconds' if seconds else 'milliseconds').replace('+00:00', 'Z') == value, 'timestamp-canonical')
    return date


def absolute(value):
    need(type(value) is str and len(value) <= 4096 and '\0' not in value, 'absolute-path')
    path = Path(value)
    need(path.is_absolute() and str(path) == value and os.path.normpath(value) == value, 'absolute-path')
    return path


def parse_pin(value):
    exact(value, ['path', 'sha256'], 'pin-shape')
    absolute(value['path'])
    need(type(value['sha256']) is str and HEX.fullmatch(value['sha256']), 'pin-digest')
    return value


def directory(path, private=False):
    need(path.resolve() == path, 'directory-alias')
    s = path.lstat()
    need(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid == os.getuid(), 'directory-custody')
    if private:
        need(stat.S_IMODE(s.st_mode) == 0o700, 'directory-private-mode')
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_mtime_ns, s.st_ctime_ns)


class Reads:
    """Stable no-follow reads; each observed artifact is revalidated before output."""
    def __init__(self):
        self.observed = {}
        self.identities = {}

    def read(self, path, maximum=8 * M, private=False, retain=True):
        path = absolute(str(path))
        need(path.parent.resolve() == path.parent, 'file-parent-alias')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            initial = os.fstat(fd)
            need(stat.S_ISREG(initial.st_mode) and initial.st_nlink == 1 and initial.st_uid == os.getuid() and initial.st_size <= maximum, 'file-custody')
            if private:
                need(stat.S_IMODE(initial.st_mode) == 0o600, 'private-file-mode')
            hasher, chunks, size = hashlib.sha256(), [], 0
            while True:
                chunk = os.read(fd, min(M, maximum + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                need(size <= maximum, 'file-size-limit')
                hasher.update(chunk)
                if retain:
                    chunks.append(chunk)
            need(size == initial.st_size, 'file-short-or-grown')
            signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_nlink, s.st_uid, s.st_mtime_ns, s.st_ctime_ns)
            need(signature(os.fstat(fd)) == signature(initial) == signature(path.lstat()), 'file-changed-during-read')
            item = {'path': str(path), 'bytes': size, 'sha256': hasher.hexdigest()}
            previous = self.observed.get(str(path))
            if previous is not None:
                equal(previous, item, 'observed-file-changed')
            previous_identity = self.identities.get(str(path))
            if previous_identity is not None:
                need(previous_identity == signature(initial), 'observed-file-custody-changed')
            self.identities[str(path)] = signature(initial)
            self.observed[str(path)] = item
            return b''.join(chunks) if retain else item
        finally:
            os.close(fd)

    def pinned(self, value, maximum=8 * M, private=False, retain=True):
        p = parse_pin(value)
        result = self.read(Path(p['path']), maximum, private, retain)
        need(self.observed[p['path']]['sha256'] == p['sha256'], 'pinned-file-changed')
        return result

    def json(self, path, maximum=8 * M, private=False):
        return decode(self.read(path, maximum, private))

    def pin(self, path, maximum=128 * M, private=False):
        item = self.read(path, maximum, private, retain=False)
        return {'path': item['path'], 'sha256': item['sha256']}

    def recheck(self):
        for item in list(self.observed.values()):
            self.read(Path(item['path']), max(item['bytes'], 1), retain=False)


def ensure_absent(paths):
    for path in paths:
        need(not os.path.lexists(path), 'occupied-output-or-lock')


def source_identity(reads):
    directory(RUNTIME)
    paths = ['package.json', 'bun.lock', 'tsconfig.json', 'tsconfig.scripts.json', 'scripts/benchmark-memory.ts']
    def walk(folder, depth):
        need(depth <= 16, 'source-depth')
        directory(folder)
        for path in sorted(folder.iterdir()):
            s = path.lstat()
            need(not stat.S_ISLNK(s.st_mode), 'source-symlink')
            if stat.S_ISDIR(s.st_mode):
                walk(path, depth + 1)
            elif stat.S_ISREG(s.st_mode) and path.suffix == '.ts':
                paths.append(str(path.relative_to(RUNTIME)))
            need(len(paths) <= 512, 'source-file-count')
    for base in ['src', 'scripts/benchmarks']:
        walk(RUNTIME / base, 0)
    files = [{'path': path, 'sha256': reads.pin(RUNTIME / path, 8 * M)['sha256']} for path in sorted(paths)]
    need(len(files) == 115 and digest(canonical(files)) == SOURCE, 'fixed-source-identity')
    head = reads.read(RUNTIME / '.git/HEAD', 4096).decode().strip()
    if head.startswith('ref: '):
        ref = head[5:]
        need(re.fullmatch(r'refs/heads/[a-zA-Z0-9_./-]+', ref) and '..' not in ref, 'git-head-ref')
        ref_path = RUNTIME / '.git' / ref
        if ref_path.exists():
            head = reads.read(ref_path, 4096).decode().strip()
        else:
            lines = reads.read(RUNTIME / '.git/packed-refs', M).decode().splitlines()
            matches = [line.split(' ')[0] for line in lines if line.endswith(' ' + ref)]
            need(len(matches) == 1, 'packed-head-ref')
            head = matches[0]
    need(head == HEAD, 'fixed-git-head')
    return files


def inventory_shape(value, freeze_sha=FREEZE):
    exact(value, ['schema', 'freezeSha256', 'files'], 'inventory-shape')
    need(value['schema'] == 'oh.gateway-final-inventory.v5' and value['freezeSha256'] == freeze_sha, 'inventory-identity')
    files = value['files']
    need(type(files) is list and 0 < len(files) <= 65536, 'inventory-count')
    previous, total = '', 0
    for item in files:
        exact(item, ['path', 'bytes', 'sha256'], 'inventory-file-shape')
        p = item['path']
        need(type(p) is str and 0 < len(p) <= 1024 and not p.startswith('/') and '\\' not in p and '\0' not in p and all(s not in ['', '.', '..'] for s in p.split('/')) and previous < p, 'inventory-file-order')
        need(type(item['sha256']) is str and HEX.fullmatch(item['sha256']), 'inventory-file-hash')
        total += integer(item['bytes'], 0, 128 * M)
        previous = p
    need(total <= 8 * 1024 * M, 'inventory-total-bound')
    return files


def study_inventory(reads):
    files, directories = [], {}
    def visit(root, depth):
        need(depth <= 2, 'study-directory-depth')
        directories[str(root)] = directory(root, private=True)
        names = sorted(root.iterdir())
        if depth == 1:
            need(root == STUDY / 'jobs', 'unexpected-study-directory')
        if depth == 2:
            need(HEX.fullmatch(root.name), 'job-directory-key')
            equal([p.name for p in names], JOB_FILES, 'six-job-files')
        for path in names:
            need(path.name != 'active.lock', 'study-active-lock')
            s = path.lstat()
            need(not stat.S_ISLNK(s.st_mode), 'study-symlink')
            if stat.S_ISDIR(s.st_mode):
                visit(path, depth + 1)
            else:
                item = reads.read(path, 128 * M, private=True, retain=False)
                files.append({'path': str(path.relative_to(STUDY)), 'bytes': item['bytes'], 'sha256': item['sha256']})
            need(len(files) <= 65536, 'study-file-count')
    visit(STUDY, 0)
    files.sort(key=lambda f: f['path'])
    inventory_shape({'schema': 'oh.gateway-final-inventory.v5', 'freezeSha256': FREEZE, 'files': files})
    for path, signature in directories.items():
        equal(directory(Path(path), private=True), signature, 'study-directory-changed')
    return files, directories


def ledger_events(raw):
    need(len(raw) <= 8 * M and raw.endswith(b'\n'), 'ledger-complete-lines')
    events, pending, seen, settled, exposure = [], {}, set(), set(), 0
    for line in raw.splitlines():
        event = decode(line)
        exact(event, ['v', 'id', 'kind', 'micros'], 'ledger-event-shape')
        need(type(event['v']) is int and event['v'] == 1 and type(event['id']) is str and HEX.fullmatch(event['id']), 'ledger-event-identity')
        amount = integer(event['micros'], 0, CAP)
        if event['kind'] == 'reserved':
            need(event['id'] not in seen, 'duplicate-ledger-reservation')
            seen.add(event['id']); pending[event['id']] = amount; exposure += amount
        else:
            need(event['kind'] == 'settled' and event['id'] in pending and event['id'] not in settled and amount <= pending[event['id']], 'ledger-settlement')
            exposure += amount - pending.pop(event['id']); settled.add(event['id'])
        need(exposure + CARRY <= CAP, 'combined-ledger-prefix-cap')
        events.append(event)
    need(not pending and seen == settled, 'unsettled-final-ledger')
    return events, exposure


def qualified(value, start):
    exact(value, ['method', 'project', 'scope', 'environment', 'issuer', 'subject', 'audience', 'expiresAt', 'signatureVerifiedLocally'], 'qualified-shape')
    need(value['method'] == 'project-oidc' and value['project'] == PROJECT and value['scope'] == SCOPE and value['environment'] == 'development'
         and value['issuer'] in ['https://oidc.vercel.com', f'https://oidc.vercel.com/{SCOPE}'] and value['subject'] == f'owner:{SCOPE}:project:{PROJECT}:environment:development'
         and value['audience'] == f'https://vercel.com/{SCOPE}' and value['signatureVerifiedLocally'] is False, 'qualified-scope')
    expiry = value['expiresAt']
    need(type(expiry) in [int, float] and math.isfinite(expiry) and expiry >= start.timestamp() + 310, 'qualified-expiry')


def validate_supervisor(config, status, config_pin, status_pin, number, maximum, start, end, previous_end):
    exact(config, ['argv', 'cwd', 'jobDir', 'requireAbsent'], 'supervisor-config-shape')
    job = WORK / f'gateway-study-v5-batch-{number:03}'
    argv = [VERCEL, 'env', 'run', '--project', PROJECT, '--scope', SCOPE, '--environment', 'development', '--', BUN,
            str(RUNTIME / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(STUDY), '--freeze-sha256', FREEZE, '--max-new-calls', str(maximum)]
    equal(config['argv'], argv, 'exact-supervisor-argv')
    need(config['cwd'] == str(RUNTIME) and config['jobDir'] == str(job), 'supervisor-paths')
    need(config_pin == {'path': str(job / 'config.json'), 'sha256': digest(canonical(config))} and status_pin['path'] == str(job / 'status.json'), 'supervisor-pin-path')
    need(type(config['requireAbsent']) is list and len(config['requireAbsent']) == len(set(config['requireAbsent'])), 'supervisor-lock-list')
    equal(sorted(config['requireAbsent']), sorted(map(str, LOCKS)), 'supervisor-lock-set')
    exact(status, ['state', 'supervisorPid', 'supervisorStart', 'bootIdentity', 'commandSha256', 'configSha256', 'startedAt', 'childPid', 'childPgid', 'childStart', 'exitCode', 'groupGone', 'finishedAt'], 'supervisor-status-shape')
    supervisor, child, group = [integer(status[k], 1) for k in ['supervisorPid', 'childPid', 'childPgid']]
    need(child == group and supervisor != child and status['state'] == 'exited' and type(status['exitCode']) is int and status['exitCode'] == 0 and status['groupGone'] is True, 'supervisor-not-closed')
    for field in ['supervisorStart', 'bootIdentity']:
        need(type(status[field]) is str and 0 < len(status[field]) <= 512 and '\0' not in status[field], 'supervisor-process-identity')
    need(status['childStart'] is None or type(status['childStart']) is str and 0 < len(status['childStart']) <= 512 and '\0' not in status['childStart'], 'child-process-identity')
    need(status['commandSha256'] == digest(canonical(argv)) and status['configSha256'] == config_pin['sha256'], 'supervisor-command-binding')
    began, ended = timestamp(status['startedAt'], True), timestamp(status['finishedAt'], True)
    need(previous_end <= began <= start <= end < ended + dt.timedelta(seconds=1), 'overlapping-producer-custody')
    identity = {k: status[k] for k in ['supervisorPid', 'supervisorStart', 'bootIdentity', 'childPid', 'childPgid', 'childStart']}
    return {'identity': digest(canonical(identity)), 'ended': ended, 'pids': [supervisor, child], 'pgid': group}


def validate_batch(acceptance, admission, closed, number, is_final, previous_keys, previous_exposure, freeze_created):
    exact(acceptance, ['schema', 'recordedAt', 'number', 'runId', 'admission', 'closure', 'configuration', 'supervisorStatus', 'groupGone', 'freshOsProcessMatches', 'newTransportInvocations', 'totalNewJobCount', 'result', 'ledgerExposureMicros', 'priorGatewayExposureMicros', 'totalAmendmentExposureMicros', 'inventory', 'allOriginalLedgersUnchanged', 'priorInventoryUnchanged', 'correctnessInspected', 'modelCallsByVerifier'], 'acceptance-shape')
    need(acceptance['schema'] == 'oh.gateway-v5-batch-acceptance.v1' and type(acceptance['number']) is int and acceptance['number'] == number
         and acceptance['groupGone'] is True and acceptance['freshOsProcessMatches'] == 0 and acceptance['allOriginalLedgersUnchanged'] is True and acceptance['priorInventoryUnchanged'] is True
         and acceptance['correctnessInspected'] is False and acceptance['modelCallsByVerifier'] == 0, 'acceptance-policy')
    run = acceptance['runId']; need(type(run) is str and RUN_ID.fullmatch(run), 'run-id')
    exact(closed, ['protocol', 'runId', 'freezeSha256', 'sourceSha256', 'importedStudySha256', 'start', 'end', 'admission', 'maximumNewCalls', 'concurrency', 'newTransportInvocations', 'admittedKeys', 'initialJobKeys', 'finalJobKeys', 'failed', 'storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose', 'priorGatewayVerifiedAtClose', 'priorGatewayStudySha256', 'priorContinuationVerifiedAtClose', 'priorContinuationStudySha256', 'interrupted', 'stopReason', 'qualified', 'ledger', 'comparisonArtifact', 'result'], 'native-closure-shape')
    maximum, count = integer(closed['maximumNewCalls'], 1, 256), integer(closed['newTransportInvocations'], 1, 256)
    need(count <= maximum and closed['concurrency'] == 4 and closed['protocol'] == 'oh.memory-gateway-batch.v5' and closed['runId'] == run, 'native-closure-bounds')
    need(closed['sourceSha256'] == SOURCE and closed['freezeSha256'] == FREEZE and closed['importedStudySha256'] == CLAUDE and closed['priorGatewayStudySha256'] == PRIOR_GATEWAY and closed['priorContinuationStudySha256'] == PRIOR_CONTINUATION, 'native-fixed-identities')
    need(closed['failed'] is False and closed['interrupted'] is False and all(closed[k] is True for k in ['storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose', 'priorGatewayVerifiedAtClose', 'priorContinuationVerifiedAtClose']), 'native-close-failed')
    start, end = timestamp(closed['start']), timestamp(closed['end'])
    need(freeze_created <= start <= end, 'native-time-window')
    qualified(closed['qualified'], start)
    keys = closed['admittedKeys']
    need(type(keys) is list and len(keys) == count and all(type(k) is str and HEX.fullmatch(k) for k in keys) and len(set(keys)) == count and not set(keys).intersection(previous_keys), 'native-key-reuse')
    equal(closed['initialJobKeys'], sorted(previous_keys), 'native-opening-key-set')
    final_keys = sorted(previous_keys + keys)
    equal(closed['finalJobKeys'], final_keys, 'native-closing-key-set')
    equal(admission, {'protocol': 'oh.memory-gateway-batch-admission.v5', 'runId': run, 'freezeSha256': FREEZE, 'sourceSha256': SOURCE, 'importedStudySha256': CLAUDE,
          'priorGatewayStudySha256': PRIOR_GATEWAY, 'priorContinuationStudySha256': PRIOR_CONTINUATION, 'priorGatewayExposureMicros': CARRY, 'start': closed['start'], 'maximumNewCalls': maximum, 'concurrency': 4,
          'openingLedgerExposureMicros': previous_exposure, 'initialJobKeysSha256': digest(canonical(sorted(previous_keys))), 'qualified': closed['qualified']}, 'native-admission-exact')
    equal(closed['admission'], acceptance['admission'], 'native-admission-pin')
    for field, expected in [('newTransportInvocations', count), ('totalNewJobCount', len(final_keys)), ('result', closed['result']), ('priorGatewayExposureMicros', CARRY)]:
        equal(acceptance[field], expected, 'acceptance-native-metadata')
    if is_final:
        equal(closed['result'], {'status': 'completed', 'phase': 'judge', 'resolved': 360, 'required': 360}, 'complete-360-required')
        need(closed['stopReason'] is None, 'final-stop-reason')
        parse_pin(closed['comparisonArtifact'])
        need(closed['comparisonArtifact']['path'] == str(STUDY / f'comparison-{run}.json'), 'final-comparison-path')
    else:
        result = closed['result']; need(type(result) is dict and result.get('status') == 'paused' and result.get('phase') in ['extract', 'reader', 'judge'], 'earlier-comparison-status')
        need(closed['comparisonArtifact'] is None and closed['stopReason'] == 'call-limit' and count == maximum, 'earlier-not-call-limit')
        need(integer(result['resolved']) < integer(result['required'], 1), 'paused-complete-frontier')
    return {'runId': run, 'start': start, 'end': end, 'count': count, 'maximum': maximum, 'admittedKeys': keys, 'finalKeys': final_keys}


def validate_comparison_shape(value, freeze):
    exact(value, ['protocol', 'freezeSha256', 'study', 'procedure', 'originalStudiesStatus', 'extraction', 'readers', 'judgments', 'physicalJudgeResults', 'assessment'], 'comparison-shape')
    need(value['protocol'] == 'oh.memory-gateway-study.v5' and value['freezeSha256'] == FREEZE and value['originalStudiesStatus'] == 'incomplete', 'comparison-identity')
    equal(value['study'], freeze['study'], 'comparison-study'); equal(value['procedure'], freeze['procedure'], 'comparison-procedure')
    extraction = value['extraction']; exact(extraction, ['imported', 'priorGateway', 'priorContinuation', 'rows'], 'comparison-extraction-shape')
    need(type(extraction['rows']) is list and len(extraction['rows']) == 4732, 'complete-extraction-count')
    for field in ['readers', 'judgments']:
        rows = value[field]; need(type(rows) is list and len(rows) == 360, 'complete-matrix-count')
        for ordinal, row in enumerate(rows):
            need(type(row) is dict and row.get('status') == 'completed' and type(row.get('ordinal')) is int and row['ordinal'] == ordinal, 'complete-matrix-positions')
    owners = value['physicalJudgeResults']; need(type(owners) is list and 1 <= len(owners) <= 360, 'physical-judge-count')
    # Deliberately never read predictions, correctness, scores, confidence bounds or assessment values.
    return len(owners)


def validate_numbered_producer_entries(entries, number):
    """The root retains one launch config alongside each numbered producer directory."""
    integer(number, 1, 64)
    expected = {}
    for i in range(1, number + 1):
        expected[f'gateway-study-v5-batch-{i:03}'] = 'directory'
        expected[f'gateway-study-v5-batch-{i:03}-launch-config.json'] = 'file'
    observed = {}
    for name, kind in entries:
        need(type(name) is str and name not in observed, 'duplicate-numbered-producer-entry')
        observed[name] = kind
    equal(observed, expected, 'complete-numbered-producer-set')


def validate_process_absence(raw, producers):
    need(type(raw) is str and 0 < len(raw) <= 16 * M, 'process-inventory-bound')
    forbidden_pids = {pid for p in producers for pid in p['pids']}
    forbidden_groups = {p['pgid'] for p in producers}
    seen, count = set(), 0
    for line in raw.splitlines():
        fields = line.strip().split(None, 3)
        need(len(fields) == 4 and all(x.isdecimal() for x in fields[:3]), 'process-inventory-line')
        pid, parent, group = map(int, fields[:3]); need(pid > 0 and pid not in seen, 'process-inventory-pid'); seen.add(pid); count += 1
        need(pid not in forbidden_pids and group not in forbidden_groups, 'producer-still-live')
        command = fields[3]
        scoped_runner = re.search(r'(?:gateway-study-v[345]|claude-study(?:-v2)?)\.ts(?:\s|$)', command)
        scoped_supervisor = 'benchmark-supervisor.py' in command and any(s in command for s in ['gateway-study-v3-batch-', 'gateway-study-v4-batch-', 'gateway-study-v5-batch-', 'claude-subscription'])
        scoped_runtime = any(str(WORK / name) in command for name in ['gateway-study-v3-candidate', 'gateway-study-v4-candidate', 'gateway-study-v5-candidate', 'claude-subscription-candidate', 'claude-subscription-v2-candidate'])
        need(not scoped_runner and not scoped_supervisor and not scoped_runtime, 'undeclared-scoped-producer')
    need(count > 0, 'empty-process-inventory')
    return count


def verify_auditor_packet(reads):
    acceptance_pin = {'path': str(WORK / 'gateway-v5-final-auditor-acceptance.json'), 'sha256': AUDITOR_ACCEPTANCE}
    acceptance = decode(reads.pinned(acceptance_pin, M))
    need(acceptance['schema'] == 'oh.gateway-v5-final-auditor-acceptance.v1' and acceptance['status'] == 'accepted-implementation-and-independent-review' and acceptance['runtimeSourceSha256'] == SOURCE, 'auditor-not-accepted')
    expected_validation = {'path': str(WORK / 'gateway-v5-final-auditor-validation.json'), 'sha256': AUDITOR_VALIDATION}
    expected_review = {'path': str(WORK / 'gateway-v5-final-auditor-independent-review.json'), 'sha256': AUDITOR_REVIEW}
    equal(acceptance['validation'], expected_validation, 'auditor-validation-pin'); equal(acceptance['independentReview'], expected_review, 'auditor-review-pin')
    validation, review = decode(reads.pinned(expected_validation, M)), decode(reads.pinned(expected_review, M))
    need(review['status'] == 'accepted' and not review['materialFindings'] and validation['failures'] == 0 and validation['strictTypingExitCode'] == 0 and validation['runtimeSourceSha256'] == SOURCE, 'auditor-validation-failed')
    equal(acceptance['packet'], validation['packet'], 'auditor-validation-packet'); equal(acceptance['packet'], review['packet'], 'auditor-review-packet')
    paths = [parse_pin(p)['path'] for p in acceptance['packet']]; need(len(paths) == len(set(paths)) == 10, 'auditor-packet-count')
    for p in acceptance['packet']:
        reads.pinned(p, 16 * M, retain=False)
    reads.pinned({'path': str(WORK / 'close-gateway-v5-batch.py'), 'sha256': CLOSER}, M, retain=False)
    closer_review = decode(reads.pinned({'path': str(WORK / 'gateway-v5-closure-helper-independent-review.json'), 'sha256': CLOSER_REVIEW}, M))
    need(closer_review['status'] == 'accepted-operational-source-review' and closer_review['helper']['sha256'] == CLOSER, 'closer-review-binding')
    return acceptance_pin


def exclusive_outputs(documents):
    """Claim every fixed output first, then write; never overwrite occupied evidence."""
    ensure_absent(documents)
    opened = []
    try:
        for path, raw in documents.items():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            opened.append((path, fd, os.fstat(fd), raw))
        for path, fd, identity, raw in opened:
            offset = 0
            while offset < len(raw):
                count = os.write(fd, raw[offset:]); need(count > 0, 'output-short-write'); offset += count
            os.fsync(fd)
            now = path.lstat()
            need(now.st_dev == identity.st_dev and now.st_ino == identity.st_ino and stat.S_IMODE(now.st_mode) == 0o600 and now.st_nlink == 1, 'output-identity-changed')
    finally:
        for _, fd, _, _ in opened:
            os.close(fd)
    # Partial exclusive outputs remain for diagnosis if an I/O failure occurred; never overwrite/retry.
    return {str(path): {'path': str(path), 'sha256': digest(raw)} for path, raw in documents.items()}


def prepare(number, acceptance_sha):
    need(CONTEXT is not None, 'explicit-context-required')
    verify_context(CONTEXT)
    integer(number, 1, 64); need(type(acceptance_sha) is str and HEX.fullmatch(acceptance_sha), 'final-acceptance-sha')
    directory(WORK); ensure_absent(list(OUTPUTS.values()) + LOCKS)
    reads = Reads(); auditor_acceptance = verify_auditor_packet(reads)
    prepared = decode(reads.pinned({'path': str(WORK / 'gateway-v5-runtime-preparation.json'), 'sha256': PREPARATION}, M))
    need(prepared['runtime'] == str(RUNTIME) and prepared['gitHead'] == HEAD and prepared['sourceSha256'] == SOURCE and prepared['result']['freezeSha256'] == FREEZE and prepared['modelCalls'] == 0, 'fixed-runtime-preparation')
    source_files = source_identity(reads)
    freeze_pin = {'path': str(STUDY / 'freeze.json'), 'sha256': FREEZE}
    validate_study_binding(CONTEXT, freeze_pin)
    freeze = decode(reads.pinned(freeze_pin, 8 * M, private=True)); freeze_created = timestamp(freeze['createdAt'])
    need(freeze['protocol'] == 'oh.memory-gateway-freeze.v5' and freeze['sourceSha256'] == SOURCE and freeze['importedStudy']['sha256'] == CLAUDE and freeze['priorGatewayStudy']['sha256'] == PRIOR_GATEWAY and freeze['priorContinuationStudy']['sha256'] == PRIOR_CONTINUATION, 'fixed-freeze')
    for field in ['importedStudy', 'priorGatewayStudy', 'priorContinuationStudy', 'authority']:
        reads.pinned(freeze[field], 8 * M, retain=False)
    preparation = reads.json(STUDY / 'preparation.json', 8 * M, private=True)
    need(preparation['noModelCalls'] is True and preparation['source']['dirty'] is False and preparation['source']['gitHead'] == HEAD and preparation['source']['sourceSha256'] == SOURCE and preparation['source']['bun'] == '1.3.14' and preparation['maximumTotalAmendmentExposureMicros'] == CAP, 'clean-preparation')
    equal(preparation['source']['files'], source_files, 'clean-source-files')
    for field in ['imported', 'priorGateway', 'priorContinuation']:
        equal(preparation[field], freeze['study'][field], 'prepared-ancestry')
    equal(preparation['originalLedger'], freeze['originalLedger'], 'prepared-original-ledger')
    equal(reads.json(STUDY / 'store.json', 4096, private=True), {'protocol': 'oh.memory-gateway-store.v5', 'freezeSha256': FREEZE}, 'store-header')
    final_acceptance_pin = {'path': str(WORK / f'gateway-v5-batch-{number:03}-acceptance.json'), 'sha256': acceptance_sha}
    final_acceptance = decode(reads.pinned(final_acceptance_pin, M, private=True))
    equal(final_acceptance['result'], {'status': 'completed', 'phase': 'judge', 'resolved': 360, 'required': 360}, 'final-acceptance-incomplete')
    producer_entries = []
    for path in WORK.iterdir():
        if path.name.startswith('gateway-study-v5-batch-'):
            mode = path.lstat().st_mode
            kind = 'directory' if stat.S_ISDIR(mode) else 'file' if stat.S_ISREG(mode) else 'special'
            producer_entries.append((path.name, kind))
    validate_numbered_producer_entries(producer_entries, number)
    for suffix in ['acceptance.json', 'closed-inventory.json']:
        equal(sorted(p.name for p in WORK.glob(f'gateway-v5-batch-*-{suffix}')), sorted(f'gateway-v5-batch-{i:03}-{suffix}' for i in range(1, number + 1)), 'complete-numbered-acceptance-set')
    files, dir_signatures = study_inventory(reads)
    ledger_raw = reads.read(STUDY / 'ledger.jsonl', 8 * M, private=True); events, final_exposure = ledger_events(ledger_raw)
    all_keys, runs, producers, accept_pins, known_pins, batch_files, previous_inventory = [], [], [], [], set(), [], None
    previous_exposure, previous_bytes, previous_event_count, previous_end = 0, 0, 0, freeze_created
    for i in range(1, number + 1):
        ap = WORK / f'gateway-v5-batch-{i:03}-acceptance.json'; accept_pin = final_acceptance_pin if i == number else reads.pin(ap, M, private=True)
        acceptance = decode(reads.pinned(accept_pin, M, private=True)); accept_pins.append(accept_pin)
        parse_pin(acceptance['admission']); parse_pin(acceptance['closure']); run = acceptance['runId']
        need(type(run) is str and RUN_ID.fullmatch(run), 'native-run-id')
        for name, suffix in [('admission', '-started.json'), ('closure', '.json')]:
            need(acceptance[name]['path'] == str(STUDY / f'batch-{run}{suffix}'), 'native-batch-pin-path')
            batch_files.append(f'batch-{run}{suffix}')
        admission = decode(reads.pinned(acceptance['admission'], 32768, private=True)); closed = decode(reads.pinned(acceptance['closure'], M, private=True))
        checked = validate_batch(acceptance, admission, closed, i, i == number, all_keys, previous_exposure, freeze_created)
        job = WORK / f'gateway-study-v5-batch-{i:03}'; directory(job, private=True)
        config = decode(reads.pinned(acceptance['configuration'], 128 * 1024, private=True)); status = decode(reads.pinned(acceptance['supervisorStatus'], 128 * 1024, private=True))
        reads.pinned({'path': str(WORK / f'gateway-study-v5-batch-{i:03}-launch-config.json'), 'sha256': acceptance['configuration']['sha256']}, 128 * 1024, private=True, retain=False)
        producer = validate_supervisor(config, status, acceptance['configuration'], acceptance['supervisorStatus'], i, checked['maximum'], checked['start'], checked['end'], previous_end)
        for value in [producer['identity']] + [v for p in [acceptance['configuration'], acceptance['supervisorStatus']] for v in p.values()]:
            need(value not in known_pins, 'reused-producer-evidence'); known_pins.add(value)
        previous_end = producer['ended']; producers.append(producer)
        accepted_at = dt.datetime.fromisoformat(acceptance['recordedAt']); need(accepted_at.tzinfo is not None and accepted_at >= previous_end, 'acceptance-before-exit')
        inv_pin = parse_pin(acceptance['inventory']); need(inv_pin['path'] == str(WORK / f'gateway-v5-batch-{i:03}-closed-inventory.json'), 'numbered-inventory-path')
        accepted_files = inventory_shape(decode(reads.pinned(inv_pin, 16 * M, private=True)))
        expected_at_i = ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl'] + batch_files + [f'jobs/{key}/{name}' for key in checked['finalKeys'] for name in JOB_FILES]
        if i == number:
            expected_at_i.append(f'comparison-{run}.json')
        equal([f['path'] for f in accepted_files], sorted(expected_at_i), 'accepted-exact-file-set')
        final_index = {f['path']: f for f in files}
        for item in accepted_files:
            if item['path'] == 'ledger.jsonl':
                need(item['bytes'] <= len(ledger_raw) and digest(ledger_raw[:item['bytes']]) == item['sha256'], 'accepted-ledger-prefix')
            else:
                equal(final_index.get(item['path']), item, 'accepted-file-changed')
        if previous_inventory is not None:
            current_index = {f['path']: f for f in accepted_files}
            for item in previous_inventory:
                if item['path'] != 'ledger.jsonl':
                    equal(current_index.get(item['path']), item, 'inventory-history-changed')
        previous_inventory = accepted_files
        l = closed['ledger']; exact(l, ['path', 'bytes', 'sha256', 'exposureMicros', 'priorGatewayExposureMicros', 'totalAmendmentExposureMicros', 'budget'], 'native-ledger-shape')
        length = integer(l['bytes'], previous_bytes + 1, len(ledger_raw)); prefix = ledger_raw[:length]
        need(l['path'] == str(STUDY / 'ledger.jsonl') and digest(prefix) == l['sha256'], 'native-ledger-prefix')
        prefix_events, exposure = ledger_events(prefix)
        reserved = [e['id'] for e in prefix_events if e['kind'] == 'reserved']
        equal(reserved, all_keys + checked['admittedKeys'], 'admitted-ledger-order')
        need(len(prefix_events) == len(checked['finalKeys']) * 2, 'native-ledger-coverage')
        confirmed = sum(e['micros'] for e in prefix_events[previous_event_count:] if e['kind'] == 'settled')
        equal(l['budget'], {'capUsd': 40, 'maxCalls': checked['maximum'], 'reservedCalls': checked['count'], 'historicalExposureUsd': 21.655385,
              'priorAmendmentExposureUsd': (CARRY + previous_exposure) / 1e6, 'accountedUsd': (CARRY + exposure) / 1e6,
              'confirmedThisRunUsd': confirmed / 1e6, 'unresolvedThisRunUsd': 0, 'billedUsd': None}, 'native-budget-summary')
        need(l['exposureMicros'] == acceptance['ledgerExposureMicros'] == exposure and l['priorGatewayExposureMicros'] == CARRY
             and l['totalAmendmentExposureMicros'] == acceptance['totalAmendmentExposureMicros'] == CARRY + exposure, 'native-budget-carry')
        all_keys.extend(checked['admittedKeys']); previous_exposure, previous_bytes, previous_event_count = exposure, length, len(prefix_events)
        runs.append({'runId': run, 'admissionSha256': acceptance['admission']['sha256'], 'closureSha256': acceptance['closure']['sha256'], 'configuration': acceptance['configuration'],
                     'supervisorStatus': acceptance['supervisorStatus'], 'groupGone': True, 'runnerExitCode': 0, 'newTransportInvocations': checked['count']})
    need(len({run['runId'] for run in runs}) == number and previous_bytes == len(ledger_raw), 'complete-native-history')
    equal(files, previous_inventory, 'latest-accepted-inventory-identical')
    need(len(events) == len(all_keys) * 2 and final_exposure == previous_exposure, 'complete-final-ledger')
    final_batch = final_acceptance['closure']; final_closed = decode(reads.pinned(final_batch, M, private=True)); comparison_pin = parse_pin(final_closed['comparisonArtifact'])
    comparison = decode(reads.pinned(comparison_pin, 128 * M, private=True)); judge_count = validate_comparison_shape(comparison, freeze)
    need(len(all_keys) == 4732 + 360 + judge_count, 'complete-new-job-count')
    del comparison
    old_ledger_pins = [{'path': str(path), 'sha256': expected} for path, expected in OLD_LEDGERS]
    for p in old_ledger_pins:
        reads.pinned(p, 8 * M, retain=False)
    ensure_absent(LOCKS)
    # The sole process launch in this program. No shell, model, auditor or Git command.
    snapshot = subprocess.run([PS, '-axo', 'pid=,ppid=,pgid=,command='], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, timeout=15)
    process_count = validate_process_absence(snapshot.stdout, producers)
    process_digest = digest(snapshot.stdout.encode()); del snapshot
    process_checked_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    reads.recheck(); verify_context(CONTEXT); validate_study_binding(CONTEXT, freeze_pin); ensure_absent(list(OUTPUTS.values()) + LOCKS)
    for path, signature in dir_signatures.items():
        equal(directory(Path(path), private=True), signature, 'final-study-directory-changed')
    equal(source_identity(reads), source_files, 'final-source-unchanged')
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    need(timestamp(now) - timestamp(process_checked_at) <= dt.timedelta(seconds=60), 'process-proof-stale')
    inventory = {'schema': 'oh.gateway-final-inventory.v5', 'freezeSha256': FREEZE, 'files': files}
    serialize = lambda value: (json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + '\n').encode()
    inv_raw = serialize(inventory); inv_pin = {'path': str(OUTPUTS['inventory']), 'sha256': digest(inv_raw)}
    closure = {'schema': 'oh.gateway-final-supervisor-closure.v5', 'createdAt': now, 'freezeSha256': FREEZE, 'inventorySha256': inv_pin['sha256'], 'finalBatchSha256': final_batch['sha256'],
               'verification': 'owner-verified-complete-producer-inventory', 'allProducersClosed': True, 'runs': runs}
    closure_raw = serialize(closure); closure_pin = {'path': str(OUTPUTS['supervisorClosure']), 'sha256': digest(closure_raw)}
    configuration = {'runtimeRoot': str(RUNTIME), 'expectedSourceSha256': SOURCE, 'studyDirectory': str(STUDY), 'freeze': freeze_pin, 'finalBatch': final_batch,
                     'comparison': comparison_pin, 'inventory': inv_pin, 'supervisorClosure': closure_pin}
    cfg_raw = serialize(configuration); cfg_pin = {'path': str(OUTPUTS['configuration']), 'sha256': digest(cfg_raw)}
    receipt = {'schema': 'oh.gateway-v5-final-audit-preparation.v1', 'recordedAt': now, 'sourceSha256': SOURCE, 'finalAcceptance': final_acceptance_pin,
               'auditorAcceptance': auditor_acceptance, 'numberedAcceptances': accept_pins, 'producerCount': len(runs), 'studyFiles': len(files), 'newJobs': len(all_keys), 'readerCases': 360, 'judgmentCases': 360,
               'priorGatewayExposureMicros': CARRY, 'newLedgerExposureMicros': final_exposure, 'totalAmendmentExposureMicros': CARRY + final_exposure,
               'oldLedgers': old_ledger_pins, 'processInventory': {'argv': [PS, '-axo', 'pid=,ppid=,pgid=,command='], 'checkedAt': process_checked_at, 'sha256': process_digest, 'rows': process_count, 'matchedProducers': 0},
               'inventory': inv_pin, 'supervisorClosure': closure_pin, 'configuration': cfg_pin, 'modelCalls': 0, 'auditorCalls': 0, 'studyWrites': 0, 'correctnessInspected': False,
               'qualification': 'Owner custody and complete-shape preparation only; the separately accepted final auditor must reconstruct and accept all benchmark results.'}
    receipt_raw = serialize(receipt)
    exclusive_outputs({OUTPUTS['inventory']: inv_raw, OUTPUTS['supervisorClosure']: closure_raw, OUTPUTS['configuration']: cfg_raw, OUTPUTS['receipt']: receipt_raw})
    return {'receipt': {'path': str(OUTPUTS['receipt']), 'sha256': digest(receipt_raw)}, 'inventory': inv_pin, 'supervisorClosure': closure_pin, 'configuration': cfg_pin,
            'producerCount': len(runs), 'studyFiles': len(files), 'newJobs': len(all_keys), 'comparisonCases': 360, 'modelCalls': 0, 'auditorCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True, help='Absolute machine context JSON; frozen evidence must retain its recorded paths.')
    parser.add_argument('--final-batch', type=int, required=True)
    parser.add_argument('--final-acceptance-sha256', required=True)
    args = parser.parse_args()
    try:
        configure(load_context(args.context))
        print(json.dumps(prepare(args.final_batch, args.final_acceptance_sha256)))
    except Exception as error:
        reason = str(error) if isinstance(error, (Rejected, ContextError)) else 'input-or-io-rejection'
        print(json.dumps({'schema': 'oh.gateway-v5-final-audit-preparation.v1', 'status': 'rejected', 'reason': reason, 'modelCalls': 0, 'auditorCalls': 0, 'semanticTextPrinted': False}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
