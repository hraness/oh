#!/usr/bin/env python3
"""Close successful v6 batches or separately accept the initial zero-native failure.

Prepare final audit inputs only at all 360 cases; generation evidence stays frozen.

This existing-study custody tool never invokes models, auditors, or the store.
Its sole subprocess is one bounded /bin/ps snapshot, after pinned input validation.
Code relocation does not relocate or rewrite the frozen absolute-path evidence.
Semantic response replay remains the separately approved final auditor's job.
"""
import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess

import gateway_context as gc
from prepare_gateway_v5_final_audit import (Reads, Rejected, need, exact, equal, integer,
    digest, canonical, decode, timestamp, parse_pin, directory, ensure_absent, exclusive_outputs, M, HEX, RUN_ID, JOB_FILES)

CARRY, CAP = 18_268_639, 40_000_000
POLICY = '22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1'
OLD_HEAD = '7e5cdcfc9ef211d3108bc1bf26279e071d3fbecb'
OLD_SOURCE = '896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433'
OLD_LEDGER = ('37f8a79e8dc7bd64ebccfadf9ecd5e232462c3cd6182c678b02344c017e16a80', 1133712, 17459430)
TERMINAL = '80927985272587b8f59baa170613cb429887a0e41d8d2360cbbd3da3ec68a259'
TRANSPORT = 'oh.memory-gateway-transport.v3'
STORE = 'oh.memory-gateway-store.v6'
ACCEPTANCE = 'oh.gateway-v6-batch-acceptance.v1'
RECOVERY_ACCEPTANCE = 'oh.gateway-v6-batch-acceptance.v2'
PRE_NATIVE_ACCEPTANCE = 'oh.gateway-v6-pre-native-failure-acceptance.v1'
INVENTORY = 'oh.gateway-final-inventory.v6'
GLOBAL_PRIOR, GLOBAL_MAXIMUM = 25_744_095, 11_804_182
GLOBAL_BOUND = {'remainingReaders': 28, 'readerMicros': 170570, 'knownCompletedReaders': 331, 'knownTerminalReaders': 1,
    'knownPhysicalJudgeRequests': 205, 'knownJudgeMicros': 2566092, 'unknownJudgeMaximumRequests': 28,
    'unknownJudgeMaximumEachMicros': 323840, 'unknownJudgeMicros': 9067520, 'totalMicros': GLOBAL_MAXIMUM,
    'totalSha256': 'bb3bec2510cb6eb532e1812a66fde32e90afe9b342b09fe07f368fa631a71968'}


def js_hash(value):
    # Used only for fixed integer/string/list/record preimages, not arbitrary JS floats.
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())


def sha(value):
    need(type(value) is str and HEX.fullmatch(value), 'sha256'); return value


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def serialize(value):
    return (json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + '\n').encode()


def output_paths(work, number):
    return {'acceptance': work / f'gateway-v6-batch-{number:03}-acceptance.json',
            'inventory': work / f'gateway-v6-batch-{number:03}-closed-inventory.json'}


def pre_native_paths(work):
    return {'acceptance': work / 'gateway-v6-launch-001-pre-native-acceptance.json',
            'inventory': work / 'gateway-v6-launch-001-zero-native-inventory.json'}


def final_paths(work):
    return {'supervisorClosure': work / 'gateway-v6-final-supervisor-closure.json',
            'configuration': work / 'gateway-v6-final-audit-config.json',
            'receipt': work / 'gateway-v6-final-audit-preparation.json'}


def source_identity(reads, runtime, expected_source, expected_head):
    paths = ['package.json', 'bun.lock', 'tsconfig.json', 'tsconfig.scripts.json', 'scripts/benchmark-memory.ts']
    dirs = {}
    def visit(folder, depth):
        need(depth <= 16, 'source-depth'); dirs[str(folder)] = directory(folder)
        for path in sorted(folder.iterdir()):
            mode = path.lstat().st_mode; need(not stat.S_ISLNK(mode), 'source-symlink')
            if stat.S_ISDIR(mode): visit(path, depth + 1)
            elif stat.S_ISREG(mode) and path.suffix == '.ts': paths.append(str(path.relative_to(runtime)))
            need(len(paths) <= 512, 'source-count')
    directory(runtime)
    for name in ['src', 'scripts/benchmarks']: visit(runtime / name, 0)
    files = [{'path': p, 'sha256': reads.pin(runtime / p, 8 * M)['sha256']} for p in sorted(paths)]
    need(js_hash(files) == expected_source, 'frozen-source-hash')
    head = reads.read(runtime / '.git/HEAD', 4096).decode().strip()
    if head.startswith('ref: '):
        ref = head[5:]; need(re.fullmatch(r'refs/heads/[a-zA-Z0-9_./-]+', ref) and '..' not in ref, 'git-head-ref')
        path = runtime / '.git' / ref
        if path.exists(): head = reads.read(path, 4096).decode().strip()
        else:
            matches = [line.split(' ')[0] for line in reads.read(runtime / '.git/packed-refs', M).decode().splitlines() if line.endswith(' ' + ref)]
            need(len(matches) == 1, 'packed-head'); head = matches[0]
    need(re.fullmatch(r'[a-f0-9]{40}', head) and head == expected_head, 'frozen-git-head')
    for path, sig in dirs.items(): equal(directory(Path(path)), sig, 'source-directory-changed')
    return files


def inventory_shape(value, freeze_sha):
    exact(value, ['schema', 'freezeSha256', 'files'], 'inventory-shape')
    need(value['schema'] == INVENTORY and value['freezeSha256'] == freeze_sha, 'inventory-identity')
    files = value['files']; need(type(files) is list and 0 < len(files) <= 65536, 'inventory-count')
    previous, total = '', 0
    for item in files:
        exact(item, ['path', 'bytes', 'sha256'], 'inventory-entry')
        p = item['path']; need(type(p) is str and len(p) <= 1024 and '\\' not in p and '\0' not in p and all(x not in ['', '.', '..'] for x in p.split('/')) and previous < p, 'inventory-order')
        sha(item['sha256']); total += integer(item['bytes'], 0, 128 * M); previous = p
    need(total <= 1024 * M, 'inventory-total-size'); return files


def study_inventory(reads, study, freeze_sha):
    files, dirs = [], {}
    def visit(folder, depth):
        need(depth <= 2 and (depth != 1 or folder == study / 'jobs'), 'study-directory-shape')
        dirs[str(folder)] = directory(folder, private=True); paths = sorted(folder.iterdir())
        if depth == 2:
            sha(folder.name); equal([p.name for p in paths], JOB_FILES, 'six-job-files')
        for path in paths:
            need(path.name != 'active.lock' and not path.is_symlink(), 'study-lock-or-symlink')
            if stat.S_ISDIR(path.lstat().st_mode): visit(path, depth + 1)
            else:
                item = reads.read(path, 128 * M, private=True, retain=False)
                files.append({'path': str(path.relative_to(study)), 'bytes': item['bytes'], 'sha256': item['sha256']})
            need(len(files) <= 65536, 'study-file-count')
    visit(study, 0); files.sort(key=lambda f: f['path'])
    inventory_shape({'schema': INVENTORY, 'freezeSha256': freeze_sha, 'files': files}, freeze_sha)
    return files, dirs


def registry(context, number, pre_native_failure=False):
    expected = {f'gateway-study-v6-batch-{i:03}': 'directory' for i in range(1, number + 1)}
    expected.update({f'gateway-study-v6-batch-{i:03}-launch-config.json': 'file' for i in range(1, number + 1)})
    actual = {}; dirs = {}
    for path in context.work.iterdir():
        if path.name.startswith('gateway-study-v6-batch-'):
            mode = path.lstat().st_mode; need(not stat.S_ISLNK(mode), 'producer-registry-symlink')
            kind = 'directory' if stat.S_ISDIR(mode) else 'file' if stat.S_ISREG(mode) else 'other'
            actual[path.name] = kind
            if kind == 'directory': dirs[str(path)] = directory(path, private=True)
    equal(actual, expected, 'complete-numbered-producer-set')
    # Every previous acceptance and inventory must be accounted for by the pinned chain.
    expected_receipts = {p.name for i in range(2 if pre_native_failure else 1, number) for p in output_paths(context.work, i).values()}
    observed = {p.name for p in context.work.iterdir() if re.match(r'gateway-v6-batch-.*-(?:acceptance|closed-inventory)\.json$', p.name)}
    equal(sorted(observed), sorted(expected_receipts), 'complete-numbered-receipt-set')
    recovery_receipts = {p.name for p in context.work.iterdir() if re.match(r'gateway-v6-launch-.*-(?:pre-native-acceptance|zero-native-inventory)\.json$', p.name)}
    equal(sorted(recovery_receipts), sorted(p.name for p in pre_native_paths(context.work).values()) if pre_native_failure else [], 'complete-pre-native-receipt-set')
    return dirs


def ledger_events(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 8 * M and raw.endswith(b'\n'), 'ledger-complete-lines')
    events, pending, seen, exposure = [], {}, set(), 0
    for line in raw.splitlines():
        e = decode(line); exact(e, ['v', 'id', 'kind', 'micros'], 'ledger-event-shape')
        need(type(e['v']) is int and e['v'] == 1, 'ledger-version'); sha(e['id']); amount = integer(e['micros'], 0, CAP)
        if e['kind'] == 'reserved':
            need(e['id'] not in seen, 'duplicate-ledger-reservation'); seen.add(e['id']); pending[e['id']] = amount; exposure += amount
        else:
            need(e['kind'] == 'settled' and e['id'] in pending and amount <= pending[e['id']], 'ledger-settlement')
            exposure += amount - pending.pop(e['id'])
        need(exposure + CARRY <= CAP, 'combined-ledger-prefix-cap'); events.append(e)
    need(not pending, 'unsettled-closed-ledger'); return events, exposure


def validate_waves(events, jobs):
    pending, settling, phase = set(), False, None
    for e in events:
        if e['kind'] == 'reserved':
            need(not settling and len(pending) < 4, 'wave-admission-order')
            current = jobs[e['id']]['phase']; need(phase is None or current == phase, 'wave-phase-overlap')
            phase = current; pending.add(e['id'])
        else:
            need(e['id'] in pending, 'wave-settlement-order'); settling = True; pending.remove(e['id'])
            if not pending: settling, phase = False, None
    need(not pending, 'unclosed-wave')


def request_metadata(request, phase):
    exact(request, ['protocol', 'phase', 'endpoint', 'body', 'requestSha256', 'inputBytes', 'maximumOutput', 'timeoutMs', 'model'], 'request-shape')
    need(phase in ['reader', 'judge'] and request['phase'] == phase and request['protocol'] == TRANSPORT, 'new-request-phase')
    model = 'openai/gpt-4.1-mini' if phase == 'reader' else 'openai/gpt-4o'
    body = request['body']; exact(body, ['model', 'messages', 'temperature', 'store', 'max_tokens', 'providerOptions'], 'request-body-shape')
    messages = body['messages']; need(type(messages) is list and len(messages) == 2, 'request-messages')
    for role, message in zip(['system', 'user'], messages):
        exact(message, ['role', 'content'], 'message-shape')
        need(message['role'] == role and type(message['content']) is str and len(message['content']) > 0
             and not re.search(r'[\ud800-\udfff]', message['content']), 'opaque-message-bound')
    expected_body = {'model': model, 'messages': messages, 'temperature': 0, 'store': False, 'max_tokens': 512,
                     'providerOptions': {'gateway': {'only': ['openai'], 'order': ['openai']}}}
    equal(body, expected_body, 'fixed-request-body')
    # Native JSON.stringify preserves the role/content insertion order of each message.
    input_bytes = len(json.dumps(messages, ensure_ascii=False, separators=(',', ':')).encode())
    preimage = {'protocol': TRANSPORT, 'phase': phase, 'endpoint': 'https://ai-gateway.vercel.sh/v1/chat/completions', 'body': body}
    equal(request, {**preimage, 'requestSha256': js_hash(preimage), 'inputBytes': input_bytes, 'maximumOutput': 512, 'timeoutMs': 120000, 'model': model}, 'fixed-request-metadata')
    need(input_bytes + 2560 <= (1047576 if phase == 'reader' else 128000), 'request-context-bound')
    price = (0.4, 0.1, 1.6) if phase == 'reader' else (2.5, 1.25, 10)
    return math.ceil((input_bytes + 2048) * price[0] + 512 * price[2]), price


def compatible_model(value, requested):
    if type(value) is not str: return False
    value = value.removeprefix('openai/'); family = requested.removeprefix('openai/')
    if value == family: return True
    if not value.startswith(family + '-'): return False
    suffix = value[len(family) + 1:]
    if not re.fullmatch(r'\d{4}-\d\d-\d\d', suffix): return False
    try: return dt.date.fromisoformat(suffix).isoformat() == suffix
    except ValueError: return False


def job_metadata(reads, study, freeze_sha, key, reserve, settle):
    folder = study / 'jobs' / key
    load = lambda name: reads.json(folder / name, 8 * M, private=True)
    p = load('pending.json'); exact(p, ['protocol', 'freezeSha256', 'jobKey', 'phase', 'ordinal', 'originalParentOrdinal', 'originalJobKey', 'request'], 'pending-shape')
    need(p['protocol'] == STORE and p['freezeSha256'] == freeze_sha and p['jobKey'] == key
         and p['originalParentOrdinal'] is None and p['originalJobKey'] is None, 'pending-identity')
    ordinal = integer(p['ordinal'], 0, 359); amount, price = request_metadata(p['request'], p['phase'])
    equal(load('reserved.json'), reserve, 'reserved-file-ledger'); equal(load('settled.json'), settle, 'settled-file-ledger')
    need(reserve['micros'] == amount, 'native-reservation-amount')
    body = reads.read(folder / 'response.body', M, private=True, retain=False)
    meta = load('response.json'); equal(meta, {'requestSha256': p['request']['requestSha256'], 'httpStatus': 200, 'bodyComplete': True,
        'receivedBytes': body['bytes'], 'transportError': None, 'body': {'bytes': body['bytes'], 'sha256': body['sha256']}}, 'raw-capture-metadata')
    need(body['bytes'] > 0, 'empty-raw-capture')
    wrapper = load('result.json'); exact(wrapper, ['protocol', 'freezeSha256', 'jobKey', 'result'], 'result-wrapper-shape')
    need(wrapper['protocol'] == STORE and wrapper['freezeSha256'] == freeze_sha and wrapper['jobKey'] == key, 'result-wrapper-identity')
    r = wrapper['result']; need(type(r) is dict, 'result-record')
    terminal = r.get('kind') == 'terminal-reader-failure'
    fields = ['kind', 'finishReason', 'requestSha256', 'rawSha256', 'rawBytes', 'usage', 'identity']
    exact(r, fields + (['reason', 'policySha256'] if terminal else ['prediction']), 'result-shape')
    need(r['requestSha256'] == p['request']['requestSha256'] and r['rawSha256'] == body['sha256'] and r['rawBytes'] == body['bytes'], 'result-raw-identity')
    if terminal:
        need(p['phase'] == 'reader' and r['reason'] == 'output-token-limit' and r['finishReason'] == 'length' and r['policySha256'] == POLICY, 'terminal-reader-policy')
    else: need(r['kind'] == 'completed' and r['finishReason'] == 'stop', 'result-not-completed')
    # Never access the ordinary prediction value or parse the raw body.
    u = r['usage']; exact(u, ['inputTokens', 'cachedInputTokens', 'outputTokens', 'tokenRateMicros', 'gatewayReportedMicros', 'micros', 'costBasis', 'billedUsd'], 'usage-shape')
    input_tokens = integer(u['inputTokens'], 0, p['request']['inputBytes'] + 2048)
    cached = integer(u['cachedInputTokens'], 0, input_tokens); output = integer(u['outputTokens'], 0, 512)
    token_rate = math.ceil((input_tokens - cached) * price[0] + cached * price[1] + output * price[2])
    reported = u['gatewayReportedMicros']; need(reported is None or type(reported) is int and 0 <= reported <= amount, 'reported-cost')
    need(u['tokenRateMicros'] == token_rate and u['micros'] == max(token_rate, reported or 0) == settle['micros']
         and u['billedUsd'] is None and u['costBasis'] == ('maximum-token-rate-and-gateway-reported' if reported is not None else 'token-rate-estimate'), 'settled-usage')
    need(not terminal or output == 512, 'terminal-reader-exact-limit')
    identity = r['identity']; need(type(identity) is dict and identity.get('requestedModel') == p['request']['model']
         and compatible_model(identity.get('reportedModel'), p['request']['model']) and identity.get('finalProvider') == 'openai'
         and identity.get('snapshotPinned') is False and identity.get('physicalAttemptCount') is None, 'result-routing-identity')
    return {'key': key, 'phase': p['phase'], 'ordinal': ordinal, 'requestSha256': p['request']['requestSha256'], 'terminalReaderFailure': terminal}


def validate_job_order(jobs, imported_keys, expected_reader_hash):
    need(not set(imported_keys).intersection(j['key'] for j in jobs), 'imported-job-regenerated')
    readers = [j for j in jobs if j['phase'] == 'reader']; judges = [j for j in jobs if j['phase'] == 'judge']
    equal(jobs, readers + judges, 'new-phase-order')
    need(len(readers) <= 28 and [j['ordinal'] for j in readers] == list(range(332, 332 + len(readers))), 'remaining-reader-prefix')
    need(not judges or len(readers) == 28, 'judge-before-complete-readers')
    ordinals = [j['ordinal'] for j in judges]; need(ordinals == sorted(set(ordinals)) and len(judges) <= 359, 'sparse-judge-owner-order')
    if len(readers) == 28:
        need(js_hash([{k: j[k] for k in ['key', 'ordinal', 'requestSha256']} for j in readers]) == expected_reader_hash, 'fixed-reader-plan')
    return readers, judges


def qualified(value, context, start):
    exact(value, ['method', 'project', 'scope', 'environment', 'issuer', 'subject', 'audience', 'expiresAt', 'signatureVerifiedLocally'], 'qualified-shape')
    expected = {'method': 'project-oidc', 'project': context.project, 'scope': context.scope, 'environment': 'development'}
    equal({k: value[k] for k in expected}, expected, 'qualified-auth')
    need(value['issuer'] in ['https://oidc.vercel.com', f'https://oidc.vercel.com/{context.scope}']
         and value['subject'] == f'owner:{context.scope}:project:{context.project}:environment:development'
         and value['audience'] == f'https://vercel.com/{context.scope}' and value['signatureVerifiedLocally'] is False, 'qualified-route')
    expiry = value['expiresAt']; need(type(expiry) in [int, float] and math.isfinite(expiry) and expiry >= start.timestamp() + 310, 'qualified-expiry')


def producer_metadata(status, exit_code):
    exact(status, ['state', 'supervisorPid', 'supervisorStart', 'bootIdentity', 'commandSha256', 'configSha256', 'startedAt', 'childPid', 'childPgid', 'childStart', 'exitCode', 'groupGone', 'finishedAt'], 'supervisor-status-shape')
    supervisor, child, group = [integer(status[k], 1) for k in ['supervisorPid', 'childPid', 'childPgid']]
    need(supervisor != child == group and status['state'] == 'exited' and type(status['exitCode']) is int and status['exitCode'] == exit_code and status['groupGone'] is True, 'producer-not-closed')
    for field in ['supervisorStart', 'bootIdentity']:
        need(type(status[field]) is str and 0 < len(status[field]) <= 512 and '\0' not in status[field], 'producer-identity')
    need(status['childStart'] is None or type(status['childStart']) is str and 0 < len(status['childStart']) <= 512 and '\0' not in status['childStart'], 'child-identity')
    began, ended = timestamp(status['startedAt'], True), timestamp(status['finishedAt'], True); need(began <= ended, 'producer-time-order')
    identity = {k: status[k] for k in ['supervisorPid', 'supervisorStart', 'bootIdentity', 'childPid', 'childPgid', 'childStart']}
    return {'identity': digest(canonical(identity)), 'began': began, 'ended': ended, 'pids': [supervisor, child], 'pgid': group}


def supervisor(reads, context, runtime, study, freeze_sha, number, maximum, start, end, previous_end):
    folder = context.work / f'gateway-study-v6-batch-{number:03}'
    cp, sp = reads.pin(folder / 'config.json', 128 * 1024, private=True), reads.pin(folder / 'status.json', 128 * 1024, private=True)
    config, status = decode(reads.pinned(cp)), decode(reads.pinned(sp))
    argv = [str(context.vercel), 'env', 'run', '--project', context.project, '--scope', context.scope, '--environment', 'development', '--', str(context.bun),
            str(runtime / 'scripts/benchmarks/gateway-study-v6.ts'), 'run', '--directory', str(study), '--freeze-sha256', freeze_sha, '--max-new-calls', str(maximum)]
    equal(config, {'argv': argv, 'cwd': str(runtime), 'jobDir': str(folder), 'requireAbsent': config.get('requireAbsent')}, 'supervisor-config-shape')
    locks = list(map(str, [*context.locks, study / 'active.lock']))
    equal(sorted(config['requireAbsent']), sorted(locks), 'exact-producer-locks')
    need(digest(canonical(config)) == cp['sha256'], 'canonical-producer-config')
    launch = reads.read(context.work / f'gateway-study-v6-batch-{number:03}-launch-config.json', 128 * 1024, private=True)
    need(digest(launch) == cp['sha256'], 'retained-launch-config')
    p = producer_metadata(status, 0)
    need(status['commandSha256'] == digest(canonical(argv)) and status['configSha256'] == cp['sha256'], 'producer-command-binding')
    need(previous_end <= p['began'] <= start <= end < p['ended'] + dt.timedelta(seconds=1), 'overlapping-producer-custody')
    return p, cp, sp


def batch_metadata(closed, admission, freeze, freeze_sha, number, previous_keys, previous_exposure, admitted, study):
    exact(closed, ['protocol', 'runId', 'freezeSha256', 'sourceSha256', 'sourceGitHead', 'importedStudySha256', 'policySha256', 'priorAmendmentExposureMicros', 'importedJobKeysSha256',
        'start', 'end', 'admission', 'maximumNewCalls', 'concurrency', 'newTransportInvocations', 'admittedKeys', 'initialJobKeys', 'finalJobKeys', 'failed', 'interrupted', 'stopReason',
        'storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose', 'qualified', 'ledger', 'comparisonArtifact', 'result'], 'native-closure-shape')
    run = closed['runId']; need(type(run) is str and RUN_ID.fullmatch(run), 'native-run-id')
    maximum = 32 if number == 1 else 256; count = integer(closed['newTransportInvocations'], 1, maximum)
    identity = {'runId': run, 'freezeSha256': freeze_sha, 'sourceSha256': freeze['sourceSha256'], 'sourceGitHead': freeze['sourceGitHead'],
        'importedStudySha256': freeze['importedStudy']['sha256'], 'policySha256': POLICY, 'priorAmendmentExposureMicros': CARRY,
        'importedJobKeysSha256': freeze['study']['importedJobKeysSha256']}
    equal({k: closed[k] for k in identity}, identity, 'native-frozen-identity')
    need(closed['protocol'] == 'oh.memory-gateway-batch.v6' and closed['maximumNewCalls'] == maximum and closed['concurrency'] == 4
         and closed['failed'] is False and closed['interrupted'] is False and all(closed[k] is True for k in
         ['storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose']), 'native-close-not-successful')
    need(len(admitted) == count and len(set(admitted)) == count and not set(admitted).intersection(previous_keys), 'native-new-keys')
    equal(closed['admittedKeys'], admitted, 'admitted-ledger-order'); equal(closed['initialJobKeys'], sorted(previous_keys), 'opening-key-set')
    equal(closed['finalJobKeys'], sorted(previous_keys + admitted), 'closing-key-set')
    equal(admission, {'protocol': 'oh.memory-gateway-batch-admission.v6', **identity, 'start': closed['start'], 'maximumNewCalls': maximum,
          'concurrency': 4, 'openingLedgerExposureMicros': previous_exposure, 'initialJobKeysSha256': js_hash(sorted(previous_keys)), 'qualified': closed['qualified']}, 'native-admission')
    start, end = timestamp(closed['start']), timestamp(closed['end']); need(timestamp(freeze['createdAt']) <= start <= end, 'native-time-order')
    parse_pin(closed['admission']); need(closed['admission']['path'] == str(study / f'batch-{run}-started.json'), 'native-admission-path')
    return run, maximum, count, start, end


def result_frontier(result, stop_reason, comparison, jobs, count, maximum, run, study):
    readers = [j for j in jobs if j['phase'] == 'reader']; judges = [j for j in jobs if j['phase'] == 'judge']
    need(type(result) is dict, 'result-frontier-record'); completed = result.get('status') == 'completed'
    if completed:
        failures = 1 + sum(j['terminalReaderFailure'] for j in readers)
        equal(result, {'status': 'completed', 'phase': 'judge', 'resolved': 360, 'required': 360, 'modelJudgedCases': 360 - failures,
              'policyScoredReaderFailures': failures, 'physicalJudgeRequests': len(judges)}, 'complete-360-frontier')
        need(len(readers) == 28 and len(judges) > 0 and stop_reason is None, 'final-stop-or-phase')
        parse_pin(comparison); need(comparison['path'] == str(study / f'comparison-{run}.json'), 'final-comparison-path')
    else:
        need(result.get('status') == 'paused' and count == maximum and stop_reason == 'call-limit' and comparison is None, 'paused-call-limit-only')
        if len(readers) < 28:
            equal(result, {'status': 'paused', 'phase': 'reader', 'resolved': 332 + len(readers), 'required': 360, 'importedReaders': 332}, 'paused-reader-frontier')
        else:
            exact(result, ['status', 'phase', 'resolved', 'required'], 'paused-judge-shape')
            need(result['phase'] == 'judge' and result['resolved'] == len(judges) < integer(result['required'], 1, 359), 'paused-sparse-judge-frontier')
    return completed


def validate_comparison(value, freeze, freeze_sha, jobs, result):
    exact(value, ['protocol', 'freezeSha256', 'study', 'procedure', 'originalStudiesStatus', 'importedGatewayV5Status', 'importedV5', 'extraction', 'readers', 'scoredCases', 'physicalJudgeResults', 'assessment'], 'comparison-shape')
    need(value['protocol'] == 'oh.memory-gateway-study.v6' and value['freezeSha256'] == freeze_sha
         and value['originalStudiesStatus'] == 'incomplete' and value['importedGatewayV5Status'] == 'blocked', 'comparison-identity')
    equal(value['study'], freeze['study'], 'comparison-study'); equal(value['procedure'], freeze['procedure'], 'comparison-procedure')
    equal(value['importedV5'], freeze['study']['importedV5'], 'comparison-import')
    extraction = value['extraction']; exact(extraction, ['imported', 'priorGateway', 'priorContinuation', 'rows'], 'comparison-extraction')
    need(type(extraction['rows']) is list and len(extraction['rows']) == 4732, 'complete-extraction-count')
    failed = set()
    for name in ['readers', 'scoredCases']:
        rows = value[name]; need(type(rows) is list and len(rows) == 360, 'complete-case-matrix')
        current = set()
        for ordinal, row in enumerate(rows):
            need(type(row) is dict and type(row.get('ordinal')) is int and row['ordinal'] == ordinal and row.get('status') in ['completed', 'terminal-reader-failure'], 'case-order-status')
            if row['status'] == 'terminal-reader-failure': current.add(ordinal)
        if name == 'readers': failed = current
        else: equal(sorted(current), sorted(failed), 'policy-case-coverage')
    expected_failed = {331} | {j['ordinal'] for j in jobs if j['terminalReaderFailure']}
    equal(sorted(failed), sorted(expected_failed), 'terminal-reader-case-coverage')
    owners = value['physicalJudgeResults']; judges = [j for j in jobs if j['phase'] == 'judge']
    need(type(owners) is list and len(owners) == result['physicalJudgeRequests'] == len(judges), 'physical-judge-count')
    for row, job in zip(owners, judges):
        need(type(row) is dict and row.get('jobKey') == job['key'] and row.get('requestSha256') == job['requestSha256'], 'physical-judge-owner')
    # Assessment, predictions, correctness, token F1, and extraction payloads are opaque.


def prior_acceptances(reads, work, number, previous_sha, import_pin, freeze_pin, source_sha, failure_pin=None):
    first = 2 if failure_pin else 1
    need((number == first and previous_sha is None) or (number > first and previous_sha is not None), 'previous-acceptance-required-only-after-first')
    result, current = [], None if previous_sha is None else {'path': str(output_paths(work, number - 1)['acceptance']), 'sha256': sha(previous_sha)}
    for i in range(number - 1, first - 1, -1):
        need(current is not None and current['path'] == str(output_paths(work, i)['acceptance']), 'acceptance-chain-path')
        value = decode(reads.pinned(current, 2 * M))
        need(value.get('schema') == (RECOVERY_ACCEPTANCE if failure_pin else ACCEPTANCE) and type(value.get('number')) is int and value['number'] == i, 'acceptance-chain-identity')
        equal(value['importPreparation'], import_pin, 'acceptance-import-preparation'); equal(value['freeze'], freeze_pin, 'acceptance-freeze')
        need(value['sourceSha256'] == source_sha and value['policySha256'] == POLICY, 'acceptance-source-policy')
        if failure_pin:
            equal(value.get('preNativeFailureAcceptance'), failure_pin, 'acceptance-failure-root')
            need(type(value.get('nativeBatchNumber')) is int and value['nativeBatchNumber'] == i - 1, 'acceptance-native-number')
        result.append((current, value)); current = value['previousAcceptance']
        if current is not None: parse_pin(current)
    need(current is None, 'acceptance-chain-genesis'); return list(reversed(result))


def process_absence(raw, producers, work):
    need(type(raw) is str and 0 < len(raw) <= 16 * M, 'process-inventory-bound')
    pids = {pid for p in producers for pid in p['pids']}; groups = {p['pgid'] for p in producers}; seen = set()
    for line in raw.splitlines():
        fields = line.strip().split(None, 3); need(len(fields) == 4 and all(s.isdecimal() for s in fields[:3]), 'process-inventory-line')
        pid, parent, group = map(int, fields[:3]); need(pid > 0 and pid not in seen, 'process-inventory-pid'); seen.add(pid)
        need(pid not in pids and group not in groups, 'producer-still-live'); command = fields[3]
        runner = re.search(r'(?:gateway-study-v\d+|claude-study(?:-v\d+)?|benchmark-memory)\.ts(?:\s|$)', command)
        supervisor = 'benchmark-supervisor.py' in command and re.search(r'(?:gateway-study-v\d+-batch-|claude-subscription)', command)
        runtime = str(work) in command and re.search(r'(?:gateway-study-v\d+-candidate|claude-subscription[^ /]*-candidate)', command)
        need(not runner and not supervisor and not runtime, 'undeclared-scoped-producer')
    need(seen, 'empty-process-inventory'); return len(seen)


def old_source_identity(reads, runtime, freeze, preparation):
    # V5 did not put sourceGitHead in freeze.json. Its pinned preparation did.
    need(freeze.get('protocol') == 'oh.memory-gateway-freeze.v5' and freeze.get('sourceSha256') == OLD_SOURCE, 'old-frozen-profile')
    prepared = preparation['source']
    need(prepared['gitHead'] == OLD_HEAD and prepared['sourceSha256'] == OLD_SOURCE and prepared['bun'] == '1.3.14'
         and prepared['dirty'] is False, 'old-prepared-source')
    files = source_identity(reads, runtime, OLD_SOURCE, OLD_HEAD)
    equal(prepared['files'], files, 'old-frozen-source-files')
    return files


def projected_evidence_pins(evidence, ledger_anchors):
    need(type(evidence) is list and len(evidence) <= 4096, 'import-evidence-pins')
    projected = []
    for item in evidence:
        need(type(item) is dict, 'evidence-pin-record')
        if set(item) != {'path', 'sha256'}:
            exact(item, ['path', 'sha256', 'bytes', 'exposureMicros'], 'extended-ledger-pin-shape')
            need(item in ledger_anchors, 'extended-ledger-pin-anchor')
        projected.append(parse_pin({k: item[k] for k in ['path', 'sha256']}))
    need(len({p['path'] for p in projected}) == len(projected), 'duplicate-evidence-path')
    return projected


def foundations(reads, context, freeze_sha, source_sha, import_preparation_sha, require_store=True):
    gc.verify_context(context)
    old_freeze_pin = {'path': str(context.study / 'freeze.json'), 'sha256': gc.STUDY_FREEZE_SHA256}
    binding = gc.validate_study_binding(context, old_freeze_pin)
    runtime, study = context.work / 'gateway-study-v6-candidate', context.work / 'gateway-study-v6'
    freeze_pin = {'path': str(study / 'freeze.json'), 'sha256': sha(freeze_sha)}
    freeze = decode(reads.pinned(freeze_pin, 8 * M, private=True))
    exact(freeze, ['protocol', 'createdAt', 'sourceSha256', 'sourceGitHead', 'importedStudy', 'authority', 'originalLedger', 'inputs', 'policySha256', 'priorAmendmentExposureMicros', 'procedure', 'study'], 'freeze-shape')
    need(freeze['protocol'] == 'oh.memory-gateway-freeze.v6' and freeze['sourceSha256'] == sha(source_sha)
         and freeze['policySha256'] == POLICY and freeze['priorAmendmentExposureMicros'] == CARRY, 'fixed-v6-freeze')
    timestamp(freeze['createdAt']); equal(freeze['authority'], binding['authority'], 'immutable-authority')
    old_freeze = decode(reads.pinned(old_freeze_pin, 8 * M)); equal(freeze['originalLedger'], old_freeze['originalLedger'], 'immutable-original-ledger')
    auth = {'method': 'project-oidc', 'project': context.project, 'scope': context.scope, 'environment': 'development'}
    procedure = freeze['procedure']; equal(procedure['auth'], auth, 'frozen-auth')
    need(procedure['profile'] == 'oh.memory-gateway-study.v6' and procedure['readerFailure']['policySha256'] == POLICY
         and procedure['readerFailure']['carryMicros'] == CARRY and js_hash(procedure['readerFailure']['policy']) == POLICY, 'frozen-reader-policy')
    identity = freeze['study']
    for field, expected in {'selectedFamilies': 120, 'extractionParents': 8413, 'importedExtractionCount': 4732, 'importedReaderCount': 332, 'remainingFirstReaderCalls': 28, 'readerCases': 360}.items():
        need(type(identity[field]) is int and identity[field] == expected, 'fixed-study-counts')
    source_files = source_identity(reads, runtime, source_sha, freeze['sourceGitHead'])
    preparation = reads.json(study / 'preparation.json', 8 * M, private=True)
    exact(preparation, ['source', 'noModelCalls', 'importedV5', 'importedEvidencePins', 'originalLedger', 'policySha256', 'maximumTotalAmendmentExposureMicros', 'priorAmendmentExposureMicros'], 'preparation-shape')
    source = preparation['source']; need(source['sourceSha256'] == source_sha and source['gitHead'] == freeze['sourceGitHead'] and source['bun'] == '1.3.14'
         and source['dirty'] is False and preparation['noModelCalls'] is True and preparation['policySha256'] == POLICY
         and preparation['maximumTotalAmendmentExposureMicros'] == CAP and preparation['priorAmendmentExposureMicros'] == CARRY, 'clean-frozen-preparation')
    equal(source['files'], source_files, 'prepared-source-files'); equal(preparation['originalLedger'], freeze['originalLedger'], 'prepared-original-ledger')
    summary = identity['importedV5']; equal(preparation['importedV5'], summary, 'prepared-import-summary')
    import_pin = {'path': str(context.work / 'gateway-v6-import-preparation.json'), 'sha256': sha(import_preparation_sha)}
    collector = decode(reads.pinned(import_pin, 8 * M))
    need(collector['schema'] == 'oh.gateway-v6-import-preparation.v1' and collector['sourceSha256'] == OLD_SOURCE
         and collector['policySha256'] == POLICY and collector['producerCount'] == 21 and collector['successfulAcceptances'] == 20
         and collector['newJobs'] == 5064 and collector['extractionJobs'] == 4732 and collector['attemptedReaderJobs'] == 332 and collector['completedJobs'] == 5063
         and collector['terminalReaderJobKey'] == TERMINAL and collector['priorGatewayExposureMicros'] == 809209 and collector['totalCarriedExposureMicros'] == CARRY
         and all(collector[k] == 0 and type(collector[k]) is int for k in ['modelCalls', 'auditorCalls', 'studyWrites'])
         and collector['correctnessInspected'] is False and collector['responseTextInspected'] is False, 'fixed-import-preparation')
    equal(freeze['importedStudy'], collector['manifest'], 'collector-manifest-pin')
    need(freeze['importedStudy']['path'] == str(context.work / 'gateway-study-v6-import-manifest.json'), 'manifest-fixed-path')
    manifest = decode(reads.pinned(collector['manifest'], 8 * M))
    exact(manifest, ['schema', 'createdAt', 'studyDirectory', 'sourceDirectory', 'freeze', 'inventory', 'supervisorClosure', 'jobs', 'terminalReaderJobKey', 'policySha256', 'qualification'], 'import-manifest-shape')
    need(manifest['schema'] == 'oh.gateway-study-import.v6' and manifest['sourceDirectory'] == str(context.runtime) and manifest['studyDirectory'] == str(context.study)
         and manifest['policySha256'] == POLICY and manifest['terminalReaderJobKey'] == TERMINAL, 'import-manifest-identity')
    equal(manifest['freeze'], old_freeze_pin, 'import-frozen-v5'); equal(manifest['inventory'], collector['inventory'], 'collector-inventory-pin')
    equal(manifest['supervisorClosure'], collector['supervisorClosure'], 'collector-closure-pin')
    need(timestamp(manifest['createdAt']) == timestamp(collector['recordedAt']) <= timestamp(freeze['createdAt']), 'import-preparation-time')
    imported = manifest['jobs']; need(type(imported) is list and len(imported) == 5064, 'imported-job-count')
    for i, j in enumerate(imported):
        exact(j, ['key', 'phase', 'ordinal', 'requestSha256'], 'imported-job-shape'); sha(j['key']); sha(j['requestSha256']); integer(j['ordinal'])
        need(j['phase'] == ('extract' if i < 4732 else 'reader') and (i < 4732 or j['ordinal'] == i - 4732), 'imported-job-order')
    keys = sorted(j['key'] for j in imported); need(len(set(keys)) == 5064 and imported[-1]['key'] == TERMINAL and js_hash(keys) == identity['importedJobKeysSha256'], 'imported-job-key-set')
    for field, expected in {'manifestSha256': collector['manifest']['sha256'], 'freezeSha256': old_freeze_pin['sha256'], 'sourceSha256': OLD_SOURCE,
        'importedTransportInvocations': 5064, 'importedExtractionCount': 4732, 'importedReaderCount': 332, 'terminalReaderFailureCount': 1,
        'externalExposureMicros': CARRY, 'nativeLedgerExposureMicros': OLD_LEDGER[2], 'ancestryExposureMicros': 809209, 'policySha256': POLICY}.items():
        equal(summary[field], expected, 'fixed-import-summary')
    old_ledgers = [
        {'path': str(context.work / 'gateway-study-v3/ledger.jsonl'), 'sha256': '7f3830a8b69276f22614b896b01bd3534fc76ef6669b293de4e0b3ac3ec97996', 'bytes': 452},
        {'path': str(context.work / 'gateway-study-v4/ledger.jsonl'), 'sha256': '426f0ab07b34613a7265f1ef600bdc477cd169f23b92e5941108cc0142e1415b', 'bytes': 41101},
        {'path': str(context.repository / '.cache/benchmarks/openai-pilot-budget.jsonl'), 'sha256': 'c972b7e8643db61aa5a3d2b50df9aa095834be1f5b43ec680aacf5d0507f559b', 'bytes': 925682},
        {'path': str(context.study / 'ledger.jsonl'), 'sha256': OLD_LEDGER[0], 'bytes': OLD_LEDGER[1]},
    ]
    for expected in old_ledgers:
        equal(reads.read(Path(expected['path']), 8 * M, retain=False), expected, 'immutable-old-ledger')
    equal(collector['ledger'], {**old_ledgers[-1], 'exposureMicros': OLD_LEDGER[2]}, 'collector-old-ledger')
    equal(summary['ledger'], collector['ledger'], 'summary-old-ledger')
    equal(freeze['originalLedger'], {**old_ledgers[2], 'exposureMicros': 21655385}, 'original-budget-anchor')
    evidence = preparation['importedEvidencePins']
    projected = projected_evidence_pins(evidence, [freeze['originalLedger'], summary['ledger']])
    need(js_hash(evidence) == identity['importedEvidencePinsSha256'], 'imported-evidence-hash')
    for required in [collector['manifest'], collector['inventory'], collector['supervisorClosure'], old_freeze_pin, freeze['authority']]:
        need(required in projected, 'missing-import-evidence-pin')
    for pin in projected: reads.pinned(pin, 128 * M, retain=False)
    owner = decode(reads.pinned(collector['supervisorClosure'], 8 * M))
    exact(owner, ['schema', 'freezeSha256', 'inventorySha256', 'verification', 'allProducersClosed', 'runs', 'acceptances'], 'import-owner-shape')
    need(owner['schema'] == 'oh.gateway-import-supervisor-closure.v6' and owner['freezeSha256'] == old_freeze_pin['sha256']
         and owner['inventorySha256'] == collector['inventory']['sha256'] and owner['verification'] == 'owner-verified-complete-producer-inventory'
         and owner['allProducersClosed'] is True and len(owner['runs']) == 21 and len(owner['acceptances']) == 20, 'import-owner-closure')
    old_inventory = decode(reads.pinned(collector['inventory'], 16 * M))
    need(old_inventory['schema'] == 'oh.gateway-import-inventory.v6' and old_inventory['freezeSha256'] == old_freeze_pin['sha256']
         and len(old_inventory['files']) == collector['studyFiles'], 'import-closed-inventory')
    old_index = {f['path']: f for f in old_inventory['files']}; need(len(old_index) == len(old_inventory['files']), 'import-inventory-duplicates')
    old_expected = ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl']
    for r in owner['runs']:
        old_expected += [f'batch-{r["runId"]}.json', f'batch-{r["runId"]}-started.json']
    for j in imported:
        old_expected += [f'jobs/{j["key"]}/{name}' for name in JOB_FILES if j['key'] != TERMINAL or name not in ['result.json', 'settled.json']]
    equal([f['path'] for f in old_inventory['files']], sorted(old_expected), 'exact-old-closed-inventory')
    for name in ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl']:
        observed = reads.read(context.study / name, 8 * M, retain=False)
        equal(old_index[name], {'path': name, 'bytes': observed['bytes'], 'sha256': observed['sha256']}, 'old-foundation-inventory')
    old_preparation = reads.json(context.study / 'preparation.json', 8 * M)
    old_source_identity(reads, context.runtime, old_freeze, old_preparation)
    producers = []
    for i, row in enumerate(owner['runs']):
        exact(row, ['runId', 'admissionSha256', 'closureSha256', 'configuration', 'supervisorStatus', 'groupGone', 'runnerExitCode', 'newTransportInvocations'], 'old-owner-run-shape')
        need(row['groupGone'] is True and row['runnerExitCode'] == (1 if i == 20 else 0) and row['newTransportInvocations'] == (32 if i == 0 else 168 if i == 20 else 256), 'old-owner-run-count')
        for name, suffix in [('admissionSha256', '-started.json'), ('closureSha256', '.json')]:
            pin = {'path': str(context.study / f'batch-{row["runId"]}{suffix}'), 'sha256': sha(row[name])}; reads.pinned(pin, M, retain=False)
        config = decode(reads.pinned(row['configuration'], 128 * 1024)); status = decode(reads.pinned(row['supervisorStatus'], 128 * 1024))
        need(status['commandSha256'] == digest(canonical(config['argv'])) and status['configSha256'] == row['configuration']['sha256'], 'old-producer-command')
        producers.append(producer_metadata(status, row['runnerExitCode']))
    for pin in owner['acceptances']: reads.pinned(pin, 2 * M, retain=False)
    validate_process_proof(collector['processInventory'], context, producers[-1]['ended'], collector['recordedAt'])
    # Ancestor supervisor pins are already authenticated by the imported evidence hash.
    known = {p['identity'] for p in producers}
    for pin in projected:
        if Path(pin['path']).name == 'status.json':
            status = decode(reads.pinned(pin, 128 * 1024)); p = producer_metadata(status, status['exitCode'])
            if p['identity'] not in known: producers.append(p); known.add(p['identity'])
    if require_store:
        equal(reads.json(study / 'store.json', 2048, private=True), {'protocol': STORE, 'freezeSha256': freeze_sha}, 'store-header')
    return {'runtime': runtime, 'study': study, 'freeze': freeze, 'freezePin': freeze_pin, 'importPreparation': import_pin,
            'importedKeys': keys, 'sourceFiles': source_files, 'oldLedgers': old_ledgers, 'oldProducers': producers, 'binding': binding}


def accepted_document(number, recorded_at, data, entry, inventory_pin, previous_pin, process_proof, failure_pin=None):
    value = {'schema': ACCEPTANCE, 'recordedAt': recorded_at, 'number': number, 'runId': entry['runId'],
        'freeze': data['freezePin'], 'sourceSha256': data['freeze']['sourceSha256'], 'policySha256': POLICY,
        'importPreparation': data['importPreparation'], 'previousAcceptance': previous_pin,
        'admission': entry['admission'], 'closure': entry['closure'], 'configuration': entry['configuration'], 'supervisorStatus': entry['supervisorStatus'],
        'groupGone': True, 'freshOsProcessMatches': 0, 'processInventory': process_proof,
        'newTransportInvocations': entry['count'], 'totalNewJobCount': len(entry['jobs']), 'result': entry['batch']['result'],
        'ledgerExposureMicros': entry['exposure'], 'priorAmendmentExposureMicros': CARRY, 'totalAmendmentExposureMicros': CARRY + entry['exposure'],
        'inventory': inventory_pin, 'oldLedgers': data['oldLedgers'], 'jobManifestSha256': js_hash(entry['jobs']),
        'allOriginalLedgersUnchanged': True, 'priorInventoryUnchanged': True, 'correctnessInspected': False, 'responseTextInspected': False,
        'modelCallsByVerifier': 0, 'auditorCallsByVerifier': 0, 'studyWrites': 0, 'semanticAuditStatus': 'pending'}
    if failure_pin:
        value.update({'schema': RECOVERY_ACCEPTANCE, 'nativeBatchNumber': number - 1, 'preNativeFailureAcceptance': failure_pin,
                      'globalTaskAccounting': global_accounting(data, entry['exposure'])})
    return value


def verify_previous_inventory(reads, inventory_pin, expected_files, current_files, ledger_prefix, freeze_sha):
    files = inventory_shape(decode(reads.pinned(inventory_pin, 16 * M)), freeze_sha)
    equal([f['path'] for f in files], sorted(expected_files), 'previous-complete-file-set')
    for f in files:
        expected = {'path': 'ledger.jsonl', 'bytes': len(ledger_prefix), 'sha256': digest(ledger_prefix)} if f['path'] == 'ledger.jsonl' else current_files[f['path']]
        equal(f, expected, 'previous-inventory-prefix-changed')


def global_ledger_events(raw):
    """Native ledger grammar, allowing historical unresolved reservations without releasing them."""
    need(type(raw) is bytes and len(raw) <= 32 * M and (not raw or raw.endswith(b'\n')), 'global-ledger-lines')
    events, pending, seen = [], {}, set()
    for line in raw.splitlines():
        e = decode(line); exact(e, ['v', 'id', 'kind', 'micros'], 'global-ledger-event')
        need(type(e['v']) is int and e['v'] == 1, 'global-ledger-version'); sha(e['id']); integer(e['micros'], 0, CAP)
        if e['kind'] == 'reserved':
            need(e['id'] not in seen, 'global-duplicate-reservation'); seen.add(e['id']); pending[e['id']] = e['micros']
        else:
            need(e['kind'] == 'settled' and e['id'] in pending and e['micros'] <= pending.pop(e['id']), 'global-ledger-settlement')
        events.append(e)
    return events


def global_absence(paths):
    for path in paths:
        need(path.parent.resolve() == path.parent, 'global-absent-parent-alias')
    ensure_absent(paths)


def verify_global_budget(reads, context, data, reservation_pin, native=False):
    need(reservation_pin['path'] == str(context.work / 'gateway-v6-global-budget-reservation.json'), 'global-reservation-path')
    r = decode(reads.pinned(reservation_pin, 128 * 1024, private=True))
    exact(r, ['protocol', 'recordedAt', 'freeze', 'sourceSha256', 'sourceGitHead', 'budgetInput', 'priorExposureMicros', 'maximumNewExposureMicros', 'capMicros', 'bound'], 'global-reservation-shape')
    need(r['protocol'] == 'oh.gateway-v6-global-budget-reservation.v1' and r['sourceSha256'] == data['freeze']['sourceSha256']
         and r['sourceGitHead'] == data['freeze']['sourceGitHead'], 'global-reservation-source')
    equal(r['freeze'], data['freezePin'], 'global-reservation-freeze')
    equal({k: r[k] for k in ['priorExposureMicros', 'maximumNewExposureMicros', 'capMicros']},
          {'priorExposureMicros': GLOBAL_PRIOR, 'maximumNewExposureMicros': GLOBAL_MAXIMUM, 'capMicros': CAP}, 'global-reservation-limits')
    equal(r['bound'], GLOBAL_BOUND, 'global-reservation-bound')
    recorded = timestamp(r['recordedAt']); need(timestamp(data['freeze']['createdAt']) <= recorded, 'global-reservation-time')
    budget_pin = parse_pin(r['budgetInput']); descriptor = decode(reads.pinned(budget_pin, M, private=True))
    exact(descriptor, ['authority', 'ledgers', 'expectedExposureMicros', 'absentLedgerPaths'], 'global-budget-descriptor')
    need(type(descriptor['expectedExposureMicros']) is int and descriptor['expectedExposureMicros'] == GLOBAL_PRIOR, 'global-descriptor-exposure')
    authority_pin = parse_pin(descriptor['authority'])
    authority_raw = reads.pinned(authority_pin, M, private=True)
    frozen_authority = parse_pin(data['freeze']['authority'])
    need(authority_pin['sha256'] == frozen_authority['sha256'] and authority_raw == reads.pinned(frozen_authority, M, private=True), 'global-authority-binding')
    authority = decode(authority_raw)
    need(authority.get('schema') == 'oh.gateway-v3-authority.v1' and authority.get('maximumNewExposureMicros') == CAP, 'global-authority-cap')
    equal(authority['originalLedger'], data['freeze']['originalLedger'], 'global-original-authority')
    original = data['freeze']['originalLedger']
    ledgers, absent = descriptor['ledgers'], descriptor['absentLedgerPaths']
    need(type(ledgers) is list and 1 <= len(ledgers) <= 16 and type(absent) is list and 1 <= len(absent) <= 16, 'global-descriptor-count')
    paths = [authority_pin['path']]; total_bytes = 0
    for ledger in ledgers:
        exact(ledger, ['path', 'sha256', 'bytes'], 'global-ledger-pin')
        parse_pin({k: ledger[k] for k in ['path', 'sha256']}); total_bytes += integer(ledger['bytes'], 0, 32 * M)
        need(ledger['path'] != original['path'] and ledger['sha256'] != original['sha256'], 'global-original-ledger-separate')
        paths.append(ledger['path'])
    for value in absent:
        parse_pin({'path': value, 'sha256': '0' * 64}); paths.append(value)
    need(total_bytes <= 32 * M and len(set(paths)) == len(paths), 'global-descriptor-roles')
    need(original['path'] not in paths and budget_pin['path'] not in paths and reservation_pin['path'] not in paths, 'global-descriptor-role-overlap')
    target = str(data['study'] / 'ledger.jsonl'); need(target in absent, 'global-native-absence-required')
    remaining_absent = [Path(p) for p in absent if not (native and p == target)]
    global_absence(remaining_absent)
    for expected in [data['oldLedgers'][0], data['oldLedgers'][1], data['oldLedgers'][3]]:
        need(expected in ledgers, 'global-historical-ledger-anchor')
    exposure, seen = 0, set()
    for ledger in ledgers:
        raw = reads.pinned({k: ledger[k] for k in ['path', 'sha256']}, 32 * M, private=True)
        need(len(raw) == ledger['bytes'], 'global-ledger-bytes'); pending = {}
        for event in global_ledger_events(raw):
            if event['kind'] == 'reserved':
                need(event['id'] not in seen, 'global-cross-ledger-id'); seen.add(event['id']); pending[event['id']] = event['micros']; exposure += event['micros']
            else: exposure -= pending.pop(event['id']) - event['micros']
            need(0 <= exposure <= CAP, 'global-historical-prefix-cap')
    need(exposure == GLOBAL_PRIOR, 'global-recomputed-exposure')
    return {'reservation': reservation_pin, 'recordedAt': recorded, 'priorIds': seen, 'absentPaths': remaining_absent}


def verify_global_native(events, budget):
    exposure, pending = 0, {}
    for event in events:
        if event['kind'] == 'reserved':
            need(event['id'] not in budget['priorIds'], 'global-native-historical-id')
            pending[event['id']] = event['micros']; exposure += event['micros']
        else: exposure -= pending.pop(event['id']) - event['micros']
        need(exposure <= GLOBAL_MAXIMUM and GLOBAL_PRIOR + exposure <= CAP, 'global-native-prefix-cap')
    return exposure


def global_accounting(data, native_exposure):
    return {'reservation': data['globalBudget']['reservation'], 'priorExposureMicros': GLOBAL_PRIOR,
            'nativeExposureMicros': native_exposure, 'totalExposureMicros': GLOBAL_PRIOR + native_exposure}


def zero_native_inventory(reads, study, freeze_sha):
    signature = directory(study, private=True)
    paths = sorted(study.iterdir())
    equal([p.name for p in paths], ['freeze.json', 'preparation.json'], 'exact-zero-native-file-set')
    files = []
    for path in paths:
        observed = reads.read(path, 8 * M, private=True, retain=False)
        files.append({'path': path.name, 'bytes': observed['bytes'], 'sha256': observed['sha256']})
    equal(directory(study, private=True), signature, 'zero-native-directory-changed')
    inventory_shape({'schema': INVENTORY, 'freezeSha256': freeze_sha, 'files': files}, freeze_sha)
    need(files[0]['sha256'] == freeze_sha, 'zero-native-freeze-pin')
    return files, {str(study): signature}


def diagnosis_timestamp(value):
    need(type(value) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00', value), 'diagnosis-timestamp-format')
    try: parsed = dt.datetime.fromisoformat(value)
    except ValueError as error: raise Rejected('diagnosis-timestamp-date') from error
    need(parsed.isoformat(timespec='microseconds') == value, 'diagnosis-timestamp-canonical')
    return parsed


def pre_native_evidence(reads, context, data, diagnosis_pin):
    """Authenticate only the first launcher’s qualified failure; never accept a native exit 1."""
    need(diagnosis_pin['path'] == str(context.work / 'gateway-v6-pre-native-launch-failure.json'), 'failure-diagnosis-path')
    diagnosis = decode(reads.pinned(diagnosis_pin, 32768, private=True))
    exact(diagnosis, ['schema', 'recordedAt', 'status', 'supervisorStatus', 'log', 'configuration', 'diagnostic', 'nativeStudyFiles',
        'nativeAdmissions', 'v6JobRequests', 'v6LedgerExists', 'modelCalls', 'totalAmendmentExposureMicros', 'automaticRetryPermitted', 'qualification'], 'failure-diagnosis-shape')
    need(diagnosis['schema'] == 'oh.gateway-v6-pre-native-launch-failure.v1'
         and diagnosis['status'] == 'vercel-scope-inaccessible-before-native-runner'
         and diagnosis['diagnostic'] == 'Vercel CLI 58.4.0: You do not have access to the specified account; scope-not-accessible'
         and diagnosis['qualification'] == 'Supervisor metadata and absence of all native run artifacts; fresh OS closure proof remains required before any recovery dispatch.'
         and diagnosis['v6LedgerExists'] is False and diagnosis['automaticRetryPermitted'] is False, 'failure-diagnosis-qualification')
    equal(diagnosis['nativeStudyFiles'], ['freeze.json', 'preparation.json'], 'failure-diagnosis-foundations')
    for field in ['nativeAdmissions', 'v6JobRequests', 'modelCalls']:
        need(type(diagnosis[field]) is int and diagnosis[field] == 0, 'failure-diagnosis-zero-native')
    need(type(diagnosis['totalAmendmentExposureMicros']) is int and diagnosis['totalAmendmentExposureMicros'] == CARRY, 'failure-diagnosis-carry')
    folder = context.work / 'gateway-study-v6-batch-001'; signature = directory(folder, private=True)
    equal(sorted(p.name for p in folder.iterdir()), ['config.json', 'log', 'status.json'], 'failure-producer-file-set')
    pins, raw = {}, {}
    for name, filename in [('configuration', 'config.json'), ('supervisorStatus', 'status.json'), ('log', 'log')]:
        extended = diagnosis[name]; exact(extended, ['path', 'bytes', 'sha256'], 'failure-diagnosis-extended-pin')
        need(extended['path'] == str(folder / filename), 'failure-producer-path'); integer(extended['bytes'], 1, 128 * 1024)
        pin = parse_pin({k: extended[k] for k in ['path', 'sha256']})
        raw[name] = reads.pinned(pin, 128 * 1024, private=True)
        need(len(raw[name]) == extended['bytes'], 'failure-producer-bytes'); pins[name] = pin
    config, status = decode(raw['configuration']), decode(raw['supervisorStatus'])
    argv = [str(context.vercel), 'env', 'run', '--project', context.project, '--scope', context.scope, '--environment', 'development', '--', str(context.bun),
            str(data['runtime'] / 'scripts/benchmarks/gateway-study-v6.ts'), 'run', '--directory', str(data['study']), '--freeze-sha256', data['freezePin']['sha256'], '--max-new-calls', '32']
    equal(config, {'argv': argv, 'cwd': str(data['runtime']), 'jobDir': str(folder), 'requireAbsent': config.get('requireAbsent')}, 'failure-config-shape')
    equal(sorted(config['requireAbsent']), sorted(map(str, [*context.locks, data['study'] / 'active.lock'])), 'failure-exact-locks')
    need(digest(canonical(config)) == pins['configuration']['sha256'], 'failure-canonical-config')
    retained = reads.pin(context.work / 'gateway-study-v6-batch-001-launch-config.json', 128 * 1024, private=True)
    need(retained['sha256'] == pins['configuration']['sha256'], 'failure-retained-config')
    need(re.fullmatch(rb'Vercel CLI 58\.4\.0 \(Node\.js \d+\.\d+\.\d+\)\nError: You do not have access to the specified account\nLearn More: https://err\.sh/vercel/scope-not-accessible\n', raw['log']), 'failure-scope-log')
    producer = producer_metadata(status, 1)
    need(status['commandSha256'] == digest(canonical(argv)) and status['configSha256'] == pins['configuration']['sha256'], 'failure-command-binding')
    diagnosed = diagnosis_timestamp(diagnosis['recordedAt'])
    need(timestamp(data['freeze']['createdAt']) <= producer['began'] <= producer['ended'] <= diagnosed, 'failure-time-order')
    equal(directory(folder, private=True), signature, 'failure-directory-changed')
    identity = {k: status[k] for k in ['supervisorPid', 'supervisorStart', 'bootIdentity', 'childPid', 'childPgid', 'childStart']}
    return {'diagnosis': diagnosis_pin, **pins, 'retainedLaunchConfiguration': retained, 'producer': identity,
            'metadata': producer, 'diagnosed': diagnosed, 'directory': {str(folder): signature}}


def pre_native_document(recorded, data, evidence, inventory_pin, proof):
    return {'schema': PRE_NATIVE_ACCEPTANCE, 'recordedAt': recorded, 'launchNumber': 1,
        'disposition': 'scope-inaccessible-before-native-runner', 'freeze': data['freezePin'],
        'sourceSha256': data['freeze']['sourceSha256'], 'sourceGitHead': data['freeze']['sourceGitHead'], 'policySha256': POLICY,
        'importPreparation': data['importPreparation'], 'globalBudgetReservation': data['globalBudget']['reservation'], **{k: evidence[k] for k in ['diagnosis', 'configuration', 'retainedLaunchConfiguration', 'supervisorStatus', 'log', 'producer']},
        'zeroNativeInventory': inventory_pin, 'groupGone': True, 'freshOsProcessMatches': 0, 'processInventory': proof,
        'nativeAdmissions': 0, 'newTransportInvocations': 0, 'nativeLedgerExposureMicros': 0,
        'priorAmendmentExposureMicros': CARRY, 'totalAmendmentExposureMicros': CARRY, 'oldLedgers': data['oldLedgers'],
        'allOriginalLedgersUnchanged': True, 'correctnessInspected': False, 'responseTextInspected': False,
        'modelCallsByVerifier': 0, 'auditorCallsByVerifier': 0, 'studyWrites': 0}


def verify_pre_native_failure(reads, context, data, expected_sha):
    targets = pre_native_paths(context.work)
    pin = {'path': str(targets['acceptance']), 'sha256': sha(expected_sha)}
    value = decode(reads.pinned(pin, 2 * M, private=True))
    data['globalBudget'] = verify_global_budget(reads, context, data, parse_pin(value['globalBudgetReservation']), native=True)
    need(data['globalBudget']['recordedAt'] <= timestamp(value['recordedAt']), 'global-reservation-before-acceptance')
    evidence = pre_native_evidence(reads, context, data, parse_pin(value['diagnosis']))
    inventory_pin = parse_pin(value['zeroNativeInventory'])
    need(inventory_pin['path'] == str(targets['inventory']), 'failure-inventory-path')
    files = inventory_shape(decode(reads.pinned(inventory_pin, 32768, private=True)), data['freezePin']['sha256'])
    equal([f['path'] for f in files], ['freeze.json', 'preparation.json'], 'failure-historical-zero-file-set')
    for f in files:
        observed = reads.read(data['study'] / f['path'], 8 * M, private=True, retain=False)
        equal(f, {'path': f['path'], 'bytes': observed['bytes'], 'sha256': observed['sha256']}, 'failure-foundation-changed')
    need(files[0]['sha256'] == data['freezePin']['sha256'], 'failure-historical-freeze-pin')
    proof = value['processInventory']; validate_process_proof(proof, context, evidence['metadata']['ended'], value['recordedAt'])
    need(evidence['diagnosed'] <= timestamp(value['recordedAt']), 'failure-acceptance-before-diagnosis')
    equal(value, pre_native_document(value['recordedAt'], data, evidence, inventory_pin, proof), 'failure-acceptance-document')
    return pin, value, evidence


def fresh_process_proof(producers, work):
    argv = ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command=']
    snapshot = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, timeout=15)
    rows = process_absence(snapshot.stdout, producers, work)
    return {'argv': argv, 'checkedAt': now_iso(), 'sha256': digest(snapshot.stdout.encode()), 'rows': rows, 'matchedProducers': 0}


def accept_pre_native_failure(context, number, freeze_sha256, source_sha256, import_preparation_sha256, diagnosis_sha256, global_budget_reservation_sha256):
    need(type(number) is int and number == 1, 'pre-native-only-first-launch')
    for value in [freeze_sha256, source_sha256, import_preparation_sha256, diagnosis_sha256, global_budget_reservation_sha256]: sha(value)
    targets = pre_native_paths(context.work); study = context.work / 'gateway-study-v6'
    locks = [*context.locks, study / 'active.lock']
    ensure_absent([*targets.values(), *final_paths(context.work).values(), *locks])
    reads = Reads(); data = foundations(reads, context, freeze_sha256, source_sha256, import_preparation_sha256, require_store=False)
    data['globalBudget'] = verify_global_budget(reads, context, data, {'path': str(context.work / 'gateway-v6-global-budget-reservation.json'), 'sha256': global_budget_reservation_sha256})
    dirs = registry(context, 1); files, study_dirs = zero_native_inventory(reads, study, freeze_sha256); dirs.update(study_dirs)
    evidence = pre_native_evidence(reads, context, data, {'path': str(context.work / 'gateway-v6-pre-native-launch-failure.json'), 'sha256': diagnosis_sha256})
    dirs.update(evidence['directory'])
    gc.verify_context(context); gc.validate_study_binding(context, data['binding']['freeze']); ensure_absent(locks)
    proof = fresh_process_proof([*data['oldProducers'], evidence['metadata']], context.work)
    reads.recheck(); gc.verify_context(context); gc.validate_study_binding(context, data['binding']['freeze']); registry(context, 1)
    for path, sig in dirs.items(): equal(directory(Path(path), private=True), sig, 'custody-directory-changed')
    equal(source_identity(reads, data['runtime'], source_sha256, data['freeze']['sourceGitHead']), data['sourceFiles'], 'final-source-unchanged')
    ensure_absent([*targets.values(), *final_paths(context.work).values(), *locks])
    global_absence(data['globalBudget']['absentPaths'])
    recorded = now_iso(); validate_process_proof(proof, context, evidence['metadata']['ended'], recorded)
    need(data['globalBudget']['recordedAt'] <= timestamp(recorded), 'global-reservation-before-acceptance')
    need(evidence['diagnosed'] <= timestamp(recorded), 'failure-acceptance-before-diagnosis')
    raw_inventory = serialize({'schema': INVENTORY, 'freezeSha256': freeze_sha256, 'files': files})
    inventory_pin = {'path': str(targets['inventory']), 'sha256': digest(raw_inventory)}
    raw_acceptance = serialize(pre_native_document(recorded, data, evidence, inventory_pin, proof))
    acceptance_pin = {'path': str(targets['acceptance']), 'sha256': digest(raw_acceptance)}
    exclusive_outputs({targets['inventory']: raw_inventory, targets['acceptance']: raw_acceptance})
    return {'schema': PRE_NATIVE_ACCEPTANCE, 'status': 'accepted-zero-native-failure', 'launchNumber': 1,
        'nativeAdmissions': 0, 'newTransportInvocations': 0, 'totalAmendmentExposureMicros': CARRY,
        'acceptance': acceptance_pin, 'inventory': inventory_pin}


def close_batch(context, number, freeze_sha256, source_sha256, import_preparation_sha256, previous_acceptance_sha256=None, pre_native_failure_acceptance_sha256=None):
    integer(number, 1, 64); sha(freeze_sha256); sha(source_sha256); sha(import_preparation_sha256)
    offset = 1 if pre_native_failure_acceptance_sha256 is not None else 0
    native_number = number - offset
    need(native_number >= 1, 'recovery-native-number')
    need((native_number == 1 and previous_acceptance_sha256 is None) or (native_number > 1 and previous_acceptance_sha256 is not None), 'previous-acceptance-required-only-after-first')
    runtime, study = context.work / 'gateway-study-v6-candidate', context.work / 'gateway-study-v6'
    outputs = output_paths(context.work, number); locks = [*context.locks, study / 'active.lock']
    ensure_absent([*outputs.values(), *final_paths(context.work).values(), *locks])
    reads = Reads(); data = foundations(reads, context, freeze_sha256, source_sha256, import_preparation_sha256)
    failure_pin, failure, failure_evidence = None, None, None
    if offset:
        failure_pin, failure, failure_evidence = verify_pre_native_failure(reads, context, data, pre_native_failure_acceptance_sha256)
    dirs = registry(context, number, bool(offset))
    if failure_evidence: dirs.update(failure_evidence['directory'])
    files, study_dirs = study_inventory(reads, study, freeze_sha256); dirs.update(study_dirs)
    current_files = {f['path']: f for f in files}; freeze = data['freeze']
    previous = prior_acceptances(reads, context.work, number, previous_acceptance_sha256, data['importPreparation'], data['freezePin'], source_sha256, failure_pin)
    raw = reads.read(study / 'ledger.jsonl', 8 * M, private=True); events, exposure = ledger_events(raw)
    if failure_pin: need(verify_global_native(events, data['globalBudget']) == exposure, 'global-native-exposure')
    ordered_keys = [e['id'] for e in events if e['kind'] == 'reserved']
    reserve = {e['id']: e for e in events if e['kind'] == 'reserved'}; settle = {e['id']: e for e in events if e['kind'] == 'settled'}
    job_keys = sorted({f['path'].split('/')[1] for f in files if f['path'].startswith('jobs/')})
    equal(sorted(ordered_keys), job_keys, 'complete-ledger-job-set')
    need(not set(data['importedKeys']).intersection(job_keys), 'imported-job-regenerated')
    jobs = [job_metadata(reads, study, freeze_sha256, k, reserve[k], settle[k]) for k in ordered_keys]
    validate_job_order(jobs, data['importedKeys'], freeze['study']['newReaderOrderSha256']); by_key = {j['key']: j for j in jobs}
    closures = [f['path'] for f in files if re.fullmatch(r'batch-[a-f0-9-]+\.json', f['path']) and not f['path'].endswith('-started.json')]
    previous_names = [Path(v['closure']['path']).name for _, v in previous]
    current = sorted(set(closures) - set(previous_names)); need(len(closures) == native_number and len(current) == 1, 'complete-native-producer-set')
    runs, all_producers, proof_ids = [], list(data['oldProducers']), set()
    prior_keys, offset_bytes, offset_events, prior_exposure, frontier = [], 0, 0, 0, 0
    previous_end = timestamp(failure['recordedAt'] if failure else freeze['createdAt']); batch_files = []; judge_required = None
    if failure_evidence:
        all_producers.append(failure_evidence['metadata']); proof_ids.add(failure_evidence['metadata']['identity'])
        for key in ['configuration', 'supervisorStatus']:
            proof_ids.update(failure_evidence[key].values())
    for i, name in enumerate(previous_names + current, 1):
        physical_number = i + offset
        closed_pin = reads.pin(study / name, M, private=True); b = decode(reads.pinned(closed_pin, M))
        admission_pin = parse_pin(b['admission']); a = decode(reads.pinned(admission_pin, 32768, private=True))
        count = integer(b['newTransportInvocations'], 1, 256); frontier += count; need(frontier <= len(jobs), 'extra-batch-invocations')
        admitted = ordered_keys[len(prior_keys):frontier]
        run, maximum, count, start, end = batch_metadata(b, a, freeze, freeze_sha256, i, prior_keys, prior_exposure, admitted, study)
        need(name == f'batch-{run}.json', 'native-closure-path'); qualified(b['qualified'], context, start)
        p, cp, sp = supervisor(reads, context, runtime, study, freeze_sha256, physical_number, maximum, start, end, previous_end)
        for key in [p['identity'], cp['path'], cp['sha256'], sp['path'], sp['sha256']]:
            need(key not in proof_ids, 'reused-producer-proof'); proof_ids.add(key)
        all_producers.append(p); previous_end = p['ended']
        ledger = b['ledger']; exact(ledger, ['path', 'bytes', 'sha256', 'exposureMicros', 'priorAmendmentExposureMicros', 'totalAmendmentExposureMicros', 'budget'], 'native-ledger-shape')
        size = integer(ledger['bytes'], offset_bytes + 1, len(raw)); prefix = raw[:size]
        need(ledger['path'] == str(study / 'ledger.jsonl') and digest(prefix) == ledger['sha256'], 'native-ledger-prefix-pin')
        prefix_events, current_exposure = ledger_events(prefix)
        need(len(prefix_events) == 2 * frontier, 'native-settled-prefix-count')
        equal([e['id'] for e in prefix_events if e['kind'] == 'reserved'], ordered_keys[:frontier], 'native-ledger-prefix-order')
        new_events = prefix_events[offset_events:]; validate_waves(new_events, by_key)
        need(ledger['exposureMicros'] == current_exposure and ledger['priorAmendmentExposureMicros'] == CARRY and ledger['totalAmendmentExposureMicros'] == CARRY + current_exposure, 'native-once-carried-exposure')
        equal(ledger['budget'], {'capUsd': 40, 'maxCalls': maximum, 'reservedCalls': count, 'historicalExposureUsd': 21.655385,
            'priorAmendmentExposureUsd': (CARRY + prior_exposure) / 1e6, 'accountedUsd': (CARRY + current_exposure) / 1e6,
            'confirmedThisRunUsd': sum(e['micros'] for e in new_events if e['kind'] == 'settled') / 1e6, 'unresolvedThisRunUsd': 0, 'billedUsd': None}, 'native-budget-summary')
        completed = result_frontier(b['result'], b['stopReason'], b['comparisonArtifact'], jobs[:frontier], count, maximum, run, study)
        need(not completed or i == native_number, 'completed-study-cannot-continue')
        if b['result']['phase'] == 'judge':
            required = b['result']['physicalJudgeRequests'] if completed else b['result']['required']
            need(judge_required is None or judge_required == required, 'judge-owner-total-changed')
            judge_required = required
        batch_files += [name, f'batch-{run}-started.json']
        expected_files = ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl', *batch_files,
            *[f'jobs/{k}/{filename}' for k in ordered_keys[:frontier] for filename in JOB_FILES]]
        if completed: expected_files.append(f'comparison-{run}.json')
        entry = {'runId': run, 'admission': admission_pin, 'closure': closed_pin, 'configuration': cp, 'supervisorStatus': sp,
                 'count': count, 'jobs': jobs[:frontier], 'exposure': current_exposure, 'batch': b, 'completed': completed}
        if i < native_number:
            previous_pin, accepted = previous[i - 1]; timestamp(accepted['recordedAt'])
            need(p['ended'] <= timestamp(accepted['recordedAt']), 'accepted-custody-time')
            proof = accepted['processInventory']; validate_process_proof(proof, context, p['ended'], accepted['recordedAt'])
            inv_pin = parse_pin(accepted['inventory']); need(inv_pin['path'] == str(output_paths(context.work, physical_number)['inventory']), 'accepted-inventory-path')
            expected_acceptance = accepted_document(physical_number, accepted['recordedAt'], data, entry, inv_pin, previous[i - 2][0] if i > 1 else None, proof, failure_pin)
            equal(accepted, expected_acceptance, 'accepted-native-history')
            verify_previous_inventory(reads, inv_pin, expected_files, current_files, prefix, freeze_sha256)
            previous_end = timestamp(accepted['recordedAt'])
        runs.append(entry); offset_bytes, offset_events, prior_exposure, prior_keys = size, len(prefix_events), current_exposure, ordered_keys[:frontier]
    need(frontier == len(jobs) and offset_bytes == len(raw) and prior_exposure == exposure, 'unclosed-ledger-or-job-suffix')
    equal(sorted(expected_files), sorted(current_files), 'complete-current-file-set')
    final = runs[-1]
    if final['completed']:
        value = decode(reads.pinned(final['batch']['comparisonArtifact'], 128 * M, private=True))
        validate_comparison(value, freeze, freeze_sha256, jobs, final['batch']['result']); del value
    # One read-only OS query, only after all byte, authority, inventory and history checks.
    gc.verify_context(context); gc.validate_study_binding(context, data['binding']['freeze']); ensure_absent(locks)
    proof = fresh_process_proof(all_producers, context.work)
    reads.recheck(); gc.verify_context(context); gc.validate_study_binding(context, data['binding']['freeze'])
    registry(context, number, bool(offset))
    for path, sig in dirs.items(): equal(directory(Path(path), private=True), sig, 'custody-directory-changed')
    equal(source_identity(reads, runtime, source_sha256, freeze['sourceGitHead']), data['sourceFiles'], 'final-source-unchanged')
    ensure_absent([*outputs.values(), *final_paths(context.work).values(), *locks])
    if failure_pin: global_absence(data['globalBudget']['absentPaths'])
    recorded = now_iso(); validate_process_proof(proof, context, previous_end, recorded)
    return write_documents(context.work, number, recorded, data, files, runs, previous[-1][0] if previous else None, proof, failure_pin)


def validate_process_proof(proof, context, producer_end, recorded):
    exact(proof, ['argv', 'checkedAt', 'sha256', 'rows', 'matchedProducers'], 'process-proof-shape')
    equal(proof['argv'], ['/bin/ps', '-axo', 'pid=,ppid=,pgid=,command='], 'fixed-process-query')
    sha(proof['sha256']); integer(proof['rows'], 1); need(type(proof['matchedProducers']) is int and proof['matchedProducers'] == 0, 'process-proof-matches')
    checked, written = timestamp(proof['checkedAt']), timestamp(recorded)
    need(producer_end <= checked <= written and written - checked <= dt.timedelta(seconds=60), 'process-proof-stale')


def write_documents(work, number, recorded, data, files, runs, previous_pin, process_proof, failure_pin=None):
    outputs = output_paths(work, number); final = runs[-1]; documents = {}
    def add(path, value):
        raw = serialize(value); documents[path] = raw; return {'path': str(path), 'sha256': digest(raw)}
    inventory_pin = add(outputs['inventory'], {'schema': INVENTORY, 'freezeSha256': data['freezePin']['sha256'], 'files': files})
    accepted = accepted_document(number, recorded, data, final, inventory_pin, previous_pin, process_proof, failure_pin)
    acceptance_pin = add(outputs['acceptance'], accepted)
    pins = {'acceptance': acceptance_pin, 'inventory': inventory_pin}
    if final['completed']:
        targets = final_paths(work)
        closure_pin = add(targets['supervisorClosure'], {'schema': 'oh.gateway-final-supervisor-closure.v6.1' if failure_pin else 'oh.gateway-final-supervisor-closure.v6', 'createdAt': recorded,
            **({'preNativeFailures': [failure_pin]} if failure_pin else {}),
            'freezeSha256': data['freezePin']['sha256'], 'inventorySha256': inventory_pin['sha256'], 'finalBatchSha256': final['closure']['sha256'],
            'verification': 'owner-verified-complete-producer-inventory', 'allProducersClosed': True,
            'runs': [{'runId': r['runId'], 'admissionSha256': r['admission']['sha256'], 'closureSha256': r['closure']['sha256'],
                      'configuration': r['configuration'], 'supervisorStatus': r['supervisorStatus'], 'groupGone': True,
                      'runnerExitCode': 0, 'newTransportInvocations': r['count']} for r in runs]})
        config_pin = add(targets['configuration'], {'runtimeRoot': str(data['runtime']), 'expectedSourceSha256': data['freeze']['sourceSha256'],
            'studyDirectory': str(data['study']), 'freeze': data['freezePin'], 'finalBatch': final['closure'], 'comparison': final['batch']['comparisonArtifact'],
            'inventory': inventory_pin, 'supervisorClosure': closure_pin})
        receipt_pin = add(targets['receipt'], {'schema': 'oh.gateway-v6-final-audit-preparation.v2' if failure_pin else 'oh.gateway-v6-final-audit-preparation.v1', 'recordedAt': recorded,
            **({'launcherAttempts': number, 'nativeBatchCount': len(runs), 'preNativeFailures': [failure_pin],
                'globalTaskAccounting': global_accounting(data, final['exposure'])} if failure_pin else {}),
            'sourceSha256': data['freeze']['sourceSha256'], 'policySha256': POLICY, 'freeze': data['freezePin'], 'importPreparation': data['importPreparation'],
            'finalAcceptance': acceptance_pin, 'producerCount': number, 'newTransportInvocations': len(final['jobs']),
            'scoredCases': 360, 'oldLedgers': data['oldLedgers'], 'priorAmendmentExposureMicros': CARRY,
            'totalAmendmentExposureMicros': CARRY + final['exposure'], 'processInventory': process_proof,
            'inventory': inventory_pin, 'supervisorClosure': closure_pin, 'configuration': config_pin,
            'modelCalls': 0, 'auditorCalls': 0, 'studyWrites': 0, 'correctnessInspected': False, 'responseTextInspected': False,
            'semanticAuditStatus': 'pending'})
        pins.update({'supervisorClosure': closure_pin, 'configuration': config_pin, 'finalPreparation': receipt_pin})
    exclusive_outputs(documents)
    return {'schema': RECOVERY_ACCEPTANCE if failure_pin else ACCEPTANCE, 'status': 'accepted-custody-semantic-audit-pending',
            **({'nativeBatchNumber': number - 1, 'preNativeFailureAcceptance': failure_pin} if failure_pin else {}), 'number': number,
            'newTransportInvocations': final['count'], 'totalNewJobCount': len(final['jobs']),
            'totalAmendmentExposureMicros': CARRY + final['exposure'], 'finalAuditInputsPrepared': final['completed'], **pins}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True); parser.add_argument('--number', required=True, type=int)
    parser.add_argument('--freeze-sha256', required=True); parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--import-preparation-sha256', required=True); parser.add_argument('--previous-acceptance-sha256')
    parser.add_argument('--accept-pre-native-failure', action='store_true'); parser.add_argument('--diagnosis-sha256')
    parser.add_argument('--pre-native-failure-acceptance-sha256'); parser.add_argument('--global-budget-reservation-sha256')
    args = parser.parse_args()
    try:
        context = gc.load_context(args.context)
        if args.accept_pre_native_failure:
            need(args.diagnosis_sha256 is not None and args.global_budget_reservation_sha256 is not None and args.previous_acceptance_sha256 is None and args.pre_native_failure_acceptance_sha256 is None, 'pre-native-mode-arguments')
            value = accept_pre_native_failure(context, args.number, args.freeze_sha256, args.source_sha256, args.import_preparation_sha256, args.diagnosis_sha256, args.global_budget_reservation_sha256)
        else:
            need(args.diagnosis_sha256 is None and args.global_budget_reservation_sha256 is None, 'diagnosis-and-global-reservation-only-in-pre-native-mode')
            value = close_batch(context, args.number, args.freeze_sha256, args.source_sha256,
                                args.import_preparation_sha256, args.previous_acceptance_sha256, args.pre_native_failure_acceptance_sha256)
        print(json.dumps(value))
    except Exception as error:
        # Never print exception payloads from raw JSON, file contents, or OS output.
        reason = str(error) if isinstance(error, Rejected) else type(error).__name__
        print(json.dumps({'schema': ACCEPTANCE, 'status': 'rejected', 'reason': reason, 'modelCalls': 0, 'auditorCalls': 0, 'studyWrites': 0}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
