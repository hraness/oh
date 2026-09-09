#!/usr/bin/env python3
"""Collect closed v5 failure custody for a separately frozen v6 import.

Only an independently reviewed, root-owned invocation may run this collector.
It performs one bounded read-only process inventory and exclusively creates four
fixed outputs. It never calls a model, closes a batch, settles a reservation,
reads a response body's semantic text, or changes the v5 study. The v6 importer
must independently replay every pinned response before accepting the manifest.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

import prepare_gateway_v5_final_audit as v5
from gateway_context import ContextError, load_context, verify_context, validate_study_binding

Rejected, Reads = v5.Rejected, v5.Reads
need, exact, equal, integer = v5.need, v5.exact, v5.equal, v5.integer
digest, canonical, decode, directory = v5.digest, v5.canonical, v5.decode, v5.directory
M, HEX = v5.M, v5.HEX
PRODUCERS, ACCEPTED, EXTRACTIONS, READERS, JOBS = 21, 20, 4732, 332, 5064
LEDGER_BYTES = 1133712
LEDGER_SHA = '37f8a79e8dc7bd64ebccfadf9ecd5e232462c3cd6182c678b02344c017e16a80'
EXPOSURE, CARRY = 17459430, 18268639
TERMINAL = '80927985272587b8f59baa170613cb429887a0e41d8d2360cbbd3da3ec68a259'
POLICY = '22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1'
DIAGNOSIS = '2ca74a9cd9996f32dc75374ce088d960450187a3cc7ab63940fb2f13ca7701ff'
QUALIFICATION = ('Every closed Gateway v5 first response is retained once; the exact reader output-limit failure becomes an explicit v6 terminal failure without accepted partial text, retry, or old-ledger settlement. '
                 'The original v5 study remains incomplete and its full immutable exposure, including earlier ancestry and unresolved reservations, is carried once.')
TERMINAL_FILES = ['pending.json', 'reserved.json', 'response.body', 'response.json']
OUTPUTS = {}


def configure(context):
    v5.configure(context)
    global OUTPUTS
    OUTPUTS = {name: context.work / filename for name, filename in {
        'manifest': 'gateway-study-v6-import-manifest.json',
        'inventory': 'gateway-v6-import-closed-inventory.json',
        'supervisorClosure': 'gateway-v6-import-supervisor-closure.json',
        'receipt': 'gateway-v6-import-preparation.json',
    }.items()}


def locks():
    # Retained v5 launch configurations still have their exact original lock set.
    return v5.LOCKS + [v5.WORK / 'gateway-study-v6/active.lock']


def ledger_events(raw, terminal_key=TERMINAL):
    """Retain exactly one unresolved reservation, at its original full exposure."""
    need(0 < len(raw) <= 8 * M and raw.endswith(b'\n'), 'ledger-complete-lines')
    events, pending, seen, exposure = [], {}, set(), 0
    for line in raw.splitlines():
        event = decode(line)
        exact(event, ['v', 'id', 'kind', 'micros'], 'ledger-event-shape')
        need(type(event['v']) is int and event['v'] == 1 and type(event['id']) is str and HEX.fullmatch(event['id']), 'ledger-event-identity')
        amount = integer(event['micros'], 0, v5.CAP)
        if event['kind'] == 'reserved':
            need(event['id'] not in seen, 'duplicate-ledger-reservation')
            seen.add(event['id']); pending[event['id']] = amount; exposure += amount
        else:
            need(event['kind'] == 'settled' and event['id'] in pending and amount <= pending[event['id']], 'ledger-settlement')
            exposure += amount - pending.pop(event['id'])
        need(exposure + v5.CARRY <= v5.CAP, 'combined-ledger-prefix-cap')
        events.append(event)
    equal(sorted(pending), [] if terminal_key is None else [terminal_key], 'exact-unresolved-reader')
    return events, exposure, pending


def study_inventory(reads):
    """Hash all bytes without retaining or decoding response bodies or results."""
    files, directories = [], {}
    def visit(root, depth):
        need(depth <= 2, 'study-directory-depth')
        directories[str(root)] = directory(root, private=True)
        names = sorted(root.iterdir())
        if depth == 1:
            need(root == v5.STUDY / 'jobs', 'unexpected-study-directory')
        if depth == 2:
            need(HEX.fullmatch(root.name), 'job-directory-key')
            equal([p.name for p in names], TERMINAL_FILES if root.name == TERMINAL else v5.JOB_FILES, 'exact-job-files')
        for path in names:
            need(path.name != 'active.lock', 'study-active-lock')
            mode = path.lstat().st_mode
            need(not stat.S_ISLNK(mode), 'study-symlink')
            if stat.S_ISDIR(mode):
                visit(path, depth + 1)
            else:
                item = reads.read(path, M if path.name == 'response.body' else 128 * M, private=True, retain=False)
                files.append({**item, 'path': str(path.relative_to(v5.STUDY))})
            need(len(files) <= 65536, 'study-file-count')
    visit(v5.STUDY, 0)
    files.sort(key=lambda f: f['path'])
    v5.inventory_shape({'schema': 'oh.gateway-final-inventory.v5', 'freezeSha256': v5.FREEZE, 'files': files})
    for path, signature in directories.items():
        equal(directory(Path(path), private=True), signature, 'study-directory-changed')
    return files, directories


def job_bindings(reads, files, events):
    """Project original reservation order and nonsemantic pending-job metadata."""
    index = {item['path']: item for item in files}
    by_key = {}
    for event in events:
        by_key.setdefault(event['id'], []).append(event)
    jobs = []
    for event in events:
        if event['kind'] != 'reserved':
            continue
        key = event['id']; root = v5.STUDY / 'jobs' / key
        pending = reads.json(root / 'pending.json', 8 * M, private=True)
        exact(pending, ['protocol', 'freezeSha256', 'jobKey', 'phase', 'ordinal', 'originalParentOrdinal', 'originalJobKey', 'request'], 'pending-shape')
        need(pending['protocol'] == 'oh.memory-gateway-store.v5' and pending['freezeSha256'] == v5.FREEZE and pending['jobKey'] == key, 'pending-binding')
        ordinal = integer(pending['ordinal'])
        phase = pending['phase']; expected = 'extract' if len(jobs) < EXTRACTIONS else 'reader'
        need(phase == expected and type(pending['request']) is dict, 'native-phase-prefix')
        request_sha = pending['request'].get('requestSha256')
        need(type(request_sha) is str and HEX.fullmatch(request_sha), 'pending-request-digest')
        if phase == 'reader':
            need(ordinal == len(jobs) - EXTRACTIONS and pending['originalParentOrdinal'] is None and pending['originalJobKey'] is None, 'native-reader-ordinal')
        else:
            need(pending['originalParentOrdinal'] == ordinal and type(pending['originalJobKey']) is str and HEX.fullmatch(pending['originalJobKey']), 'native-extraction-parent')
            need(not jobs or ordinal > jobs[-1]['ordinal'], 'native-extraction-order')
        equal(reads.json(root / 'reserved.json', 4096, private=True), event, 'reserved-file-ledger-binding')
        metadata = reads.json(root / 'response.json', 8192, private=True)
        exact(metadata, ['requestSha256', 'httpStatus', 'bodyComplete', 'receivedBytes', 'transportError', 'body'], 'response-metadata-shape')
        body = index.get(f'jobs/{key}/response.body'); need(body is not None, 'missing-response-body')
        equal(metadata['body'], {'bytes': body['bytes'], 'sha256': body['sha256']}, 'response-body-pin')
        need(metadata['requestSha256'] == request_sha and metadata['httpStatus'] == 200 and metadata['bodyComplete'] is True
             and metadata['receivedBytes'] == body['bytes'] and metadata['transportError'] is None, 'response-transport-metadata')
        if key == TERMINAL:
            need(phase == 'reader' and len(by_key[key]) == 1, 'terminal-reader-unsettled')
        else:
            need(len(by_key[key]) == 2 and by_key[key][1]['kind'] == 'settled', 'completed-job-ledger')
            equal(reads.json(root / 'settled.json', 4096, private=True), by_key[key][1], 'settled-file-ledger-binding')
        jobs.append({'key': key, 'phase': phase, 'ordinal': ordinal, 'requestSha256': request_sha})
    need(len(jobs) == JOBS and len({j['key'] for j in jobs}) == JOBS and sum(j['phase'] == 'reader' for j in jobs) == READERS, 'complete-attempted-jobs')
    need(TERMINAL in [j['key'] for j in jobs[-4:]], 'terminal-last-wave')
    return jobs


def failed_batch(admission, closed, previous_keys, previous_exposure, freeze_created):
    exact(closed, ['protocol', 'runId', 'freezeSha256', 'sourceSha256', 'importedStudySha256', 'start', 'end', 'admission', 'maximumNewCalls', 'concurrency',
        'newTransportInvocations', 'admittedKeys', 'initialJobKeys', 'finalJobKeys', 'failed', 'storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose',
        'originalLedgerVerifiedAtClose', 'priorGatewayVerifiedAtClose', 'priorGatewayStudySha256', 'priorContinuationVerifiedAtClose', 'priorContinuationStudySha256',
        'interrupted', 'stopReason', 'qualified', 'ledger', 'comparisonArtifact', 'result'], 'failed-native-closure-shape')
    run = closed['runId']; need(type(run) is str and v5.RUN_ID.fullmatch(run), 'failed-native-run-id')
    need(closed['protocol'] == 'oh.memory-gateway-batch.v5' and closed['sourceSha256'] == v5.SOURCE and closed['freezeSha256'] == v5.FREEZE
         and closed['importedStudySha256'] == v5.CLAUDE and closed['priorGatewayStudySha256'] == v5.PRIOR_GATEWAY
         and closed['priorContinuationStudySha256'] == v5.PRIOR_CONTINUATION, 'failed-fixed-identities')
    need(closed['maximumNewCalls'] == 256 and closed['newTransportInvocations'] == 168 and closed['concurrency'] == 4
         and closed['failed'] is True and closed['interrupted'] is False and closed['stopReason'] is None and closed['comparisonArtifact'] is None
         and all(closed[k] is True for k in ['storeClosed', 'sourceVerifiedAtClose', 'importVerifiedAtClose', 'originalLedgerVerifiedAtClose', 'priorGatewayVerifiedAtClose', 'priorContinuationVerifiedAtClose']), 'failed-native-custody')
    equal(closed['result'], {'status': 'blocked', 'phase': 'reader', 'reason': 'Preserved first-response evidence requires review; no retry.'}, 'failed-native-result')
    start, end = v5.timestamp(closed['start']), v5.timestamp(closed['end'])
    need(freeze_created <= start <= end, 'failed-time-window'); v5.qualified(closed['qualified'], start)
    keys = closed['admittedKeys']
    need(type(keys) is list and len(keys) == 168 and len(set(keys)) == 168 and all(type(k) is str and HEX.fullmatch(k) for k in keys)
         and not set(keys).intersection(previous_keys) and TERMINAL in keys[-4:], 'failed-admitted-keys')
    equal(closed['initialJobKeys'], sorted(previous_keys), 'failed-opening-keys')
    equal(closed['finalJobKeys'], sorted(previous_keys + keys), 'failed-closing-keys')
    equal(admission, {'protocol': 'oh.memory-gateway-batch-admission.v5', 'runId': run, 'freezeSha256': v5.FREEZE, 'sourceSha256': v5.SOURCE,
        'importedStudySha256': v5.CLAUDE, 'priorGatewayStudySha256': v5.PRIOR_GATEWAY, 'priorContinuationStudySha256': v5.PRIOR_CONTINUATION,
        'priorGatewayExposureMicros': v5.CARRY, 'start': closed['start'], 'maximumNewCalls': 256, 'concurrency': 4,
        'openingLedgerExposureMicros': previous_exposure, 'initialJobKeysSha256': digest(canonical(sorted(previous_keys))), 'qualified': closed['qualified']}, 'failed-admission-exact')
    return {'runId': run, 'start': start, 'end': end, 'count': 168, 'maximum': 256, 'admittedKeys': keys, 'finalKeys': sorted(previous_keys + keys)}


def failed_supervisor(config, status, cp, sp, start, end, previous_end):
    """Validate producer 21 directly as failed; never synthesize successful closure."""
    job = v5.WORK / 'gateway-study-v5-batch-021'
    exact(config, ['argv', 'cwd', 'jobDir', 'requireAbsent'], 'failed-supervisor-config-shape')
    argv = [v5.VERCEL, 'env', 'run', '--project', v5.PROJECT, '--scope', v5.SCOPE, '--environment', 'development', '--', v5.BUN,
            str(v5.RUNTIME / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(v5.STUDY), '--freeze-sha256', v5.FREEZE, '--max-new-calls', '256']
    equal(config, {'argv': argv, 'cwd': str(v5.RUNTIME), 'jobDir': str(job), 'requireAbsent': config['requireAbsent']}, 'failed-supervisor-command')
    need(type(config['requireAbsent']) is list and len(config['requireAbsent']) == len(set(config['requireAbsent'])), 'failed-supervisor-locks')
    equal(sorted(config['requireAbsent']), sorted(map(str, v5.LOCKS)), 'failed-supervisor-lock-set')
    equal(cp, {'path': str(job / 'config.json'), 'sha256': digest(canonical(config))}, 'failed-supervisor-config-pin')
    need(sp['path'] == str(job / 'status.json'), 'failed-supervisor-status-pin')
    exact(status, ['state', 'supervisorPid', 'supervisorStart', 'bootIdentity', 'commandSha256', 'configSha256', 'startedAt', 'childPid', 'childPgid', 'childStart', 'exitCode', 'groupGone', 'finishedAt'], 'failed-supervisor-status-shape')
    need(status['state'] == 'exited' and type(status['exitCode']) is int and status['exitCode'] == 1 and status['groupGone'] is True
         and status['supervisorPid'] == 33939 and status['childPid'] == status['childPgid'] == 33942, 'failed-supervisor-not-closed')
    for field in ['supervisorStart', 'bootIdentity']:
        need(type(status[field]) is str and 0 < len(status[field]) <= 512 and '\0' not in status[field], 'failed-supervisor-identity')
    need(status['childStart'] is None or type(status['childStart']) is str and 0 < len(status['childStart']) <= 512 and '\0' not in status['childStart'], 'failed-child-identity')
    need(status['commandSha256'] == digest(canonical(argv)) and status['configSha256'] == cp['sha256'], 'failed-supervisor-command-pin')
    began, ended = v5.timestamp(status['startedAt'], True), v5.timestamp(status['finishedAt'], True)
    need(previous_end <= began <= start <= end < ended + dt.timedelta(seconds=1), 'failed-supervisor-time-window')
    identity = {k: status[k] for k in ['supervisorPid', 'supervisorStart', 'bootIdentity', 'childPid', 'childPgid', 'childStart']}
    return {'identity': digest(canonical(identity)), 'ended': ended, 'pids': [33939, 33942], 'pgid': 33942}


def validate_process_absence(raw, producers):
    count = v5.validate_process_absence(raw, producers)
    for line in raw.splitlines():
        command = line.strip().split(None, 3)[3]
        runner = re.search(r'(?:gateway-study-v\d+|claude-study(?:-v\d+)?|benchmark-memory)\.ts(?:\s|$)', command)
        supervisor = 'benchmark-supervisor.py' in command and re.search(r'(?:gateway-study-v\d+-batch-|claude-subscription)', command)
        runtime = str(v5.WORK) in command and re.search(r'(?:gateway-study-v\d+-candidate|claude-subscription[^ /]*-candidate)', command)
        need(not runner and not supervisor and not runtime, 'undeclared-scoped-producer')
    return count


def verify_numbered_entries():
    entries = []
    for path in v5.WORK.iterdir():
        if path.name.startswith('gateway-study-v5-batch-'):
            mode = path.lstat().st_mode
            entries.append((path.name, 'directory' if stat.S_ISDIR(mode) else 'file' if stat.S_ISREG(mode) else 'special'))
    v5.validate_numbered_producer_entries(entries, PRODUCERS)
    for suffix in ['acceptance.json', 'closed-inventory.json']:
        equal(sorted(p.name for p in v5.WORK.glob(f'gateway-v5-batch-*-{suffix}')),
              [f'gateway-v5-batch-{i:03}-{suffix}' for i in range(1, ACCEPTED + 1)], 'only-successful-numbered-acceptances')


def prepare():
    need(v5.CONTEXT is not None, 'explicit-context-required'); verify_context(v5.CONTEXT)
    directory(v5.WORK); v5.ensure_absent(list(OUTPUTS.values()) + locks())
    reads = Reads(); auditor_acceptance = v5.verify_auditor_packet(reads)
    diagnosis_pin = {'path': str(v5.WORK / 'gateway-v5-reader-failure-diagnosis.json'), 'sha256': DIAGNOSIS}
    reads.pinned(diagnosis_pin, M, retain=False)  # Historical pin only, never process proof.
    prepared = decode(reads.pinned({'path': str(v5.WORK / 'gateway-v5-runtime-preparation.json'), 'sha256': v5.PREPARATION}, M))
    need(prepared['runtime'] == str(v5.RUNTIME) and prepared['gitHead'] == v5.HEAD and prepared['sourceSha256'] == v5.SOURCE
         and prepared['result']['freezeSha256'] == v5.FREEZE and prepared['modelCalls'] == 0, 'fixed-runtime-preparation')
    source_files = v5.source_identity(reads)
    freeze_pin = {'path': str(v5.STUDY / 'freeze.json'), 'sha256': v5.FREEZE}
    validate_study_binding(v5.CONTEXT, freeze_pin)
    freeze = decode(reads.pinned(freeze_pin, 8 * M, private=True)); freeze_created = v5.timestamp(freeze['createdAt'])
    need(freeze['protocol'] == 'oh.memory-gateway-freeze.v5' and freeze['sourceSha256'] == v5.SOURCE and freeze['importedStudy']['sha256'] == v5.CLAUDE
         and freeze['priorGatewayStudy']['sha256'] == v5.PRIOR_GATEWAY and freeze['priorContinuationStudy']['sha256'] == v5.PRIOR_CONTINUATION, 'fixed-freeze')
    for field in ['importedStudy', 'priorGatewayStudy', 'priorContinuationStudy', 'authority']:
        reads.pinned(freeze[field], 8 * M, retain=False)
    preparation = reads.json(v5.STUDY / 'preparation.json', 8 * M, private=True)
    need(preparation['noModelCalls'] is True and preparation['source']['dirty'] is False and preparation['source']['gitHead'] == v5.HEAD
         and preparation['source']['sourceSha256'] == v5.SOURCE and preparation['source']['bun'] == '1.3.14'
         and preparation['maximumTotalAmendmentExposureMicros'] == v5.CAP, 'clean-preparation')
    equal(preparation['source']['files'], source_files, 'clean-source-files')
    for field, target in [('imported', 'imported'), ('priorGateway', 'priorGateway'), ('priorContinuation', 'priorContinuation')]:
        equal(preparation[field], freeze['study'][target], 'prepared-ancestry')
    equal(preparation['originalLedger'], freeze['originalLedger'], 'prepared-original-ledger')
    equal(reads.json(v5.STUDY / 'store.json', 4096, private=True), {'protocol': 'oh.memory-gateway-store.v5', 'freezeSha256': v5.FREEZE}, 'store-header')
    verify_numbered_entries()
    files, dir_signatures = study_inventory(reads); final_index = {f['path']: f for f in files}
    ledger_raw = reads.read(v5.STUDY / 'ledger.jsonl', 8 * M, private=True)
    need(len(ledger_raw) == LEDGER_BYTES and digest(ledger_raw) == LEDGER_SHA, 'fixed-failed-ledger')
    events, exposure, unresolved = ledger_events(ledger_raw)
    need(len(events) == JOBS * 2 - 1 and exposure == EXPOSURE and v5.CARRY + exposure == CARRY, 'fixed-failed-exposure')
    jobs = job_bindings(reads, files, events)
    all_keys, runs, producers, accept_pins, batch_files, known_pins = [], [], [], [], [], set()
    previous_exposure = previous_bytes = previous_event_count = 0
    previous_end, previous_inventory = freeze_created, None
    for i in range(1, PRODUCERS + 1):
        terminal = i == PRODUCERS
        if terminal:
            remaining = [f['path'] for f in files if re.fullmatch(r'batch-[a-f0-9-]+\.json', f['path']) and f['path'] not in batch_files]
            need(len(remaining) == 1, 'unique-failed-native-batch')
            closed_pin = reads.pin(v5.STUDY / remaining[0], M, private=True)
            closed = decode(reads.pinned(closed_pin, M, private=True)); run = closed['runId']
            admission_pin = v5.parse_pin(closed['admission'])
            cp = reads.pin(v5.WORK / f'gateway-study-v5-batch-{i:03}/config.json', 128 * 1024, private=True)
            sp = reads.pin(v5.WORK / f'gateway-study-v5-batch-{i:03}/status.json', 128 * 1024, private=True)
        else:
            ap = reads.pin(v5.WORK / f'gateway-v5-batch-{i:03}-acceptance.json', M, private=True)
            acceptance = decode(reads.pinned(ap, M, private=True)); accept_pins.append(ap); run = acceptance['runId']
            closed_pin, admission_pin = v5.parse_pin(acceptance['closure']), v5.parse_pin(acceptance['admission'])
            closed = decode(reads.pinned(closed_pin, M, private=True))
            cp, sp = v5.parse_pin(acceptance['configuration']), v5.parse_pin(acceptance['supervisorStatus'])
        need(type(run) is str and v5.RUN_ID.fullmatch(run), 'native-run-id')
        for pin, suffix in [(admission_pin, '-started.json'), (closed_pin, '.json')]:
            need(pin['path'] == str(v5.STUDY / f'batch-{run}{suffix}'), 'native-batch-pin-path'); batch_files.append(f'batch-{run}{suffix}')
        admission = decode(reads.pinned(admission_pin, 32768, private=True))
        checked = failed_batch(admission, closed, all_keys, previous_exposure, freeze_created) if terminal else v5.validate_batch(acceptance, admission, closed, i, False, all_keys, previous_exposure, freeze_created)
        need(checked['count'] == (168 if terminal else 32 if i == 1 else 256) and checked['maximum'] == (32 if i == 1 else 256), 'fixed-batch-counts')
        directory(v5.WORK / f'gateway-study-v5-batch-{i:03}', private=True)
        config = decode(reads.pinned(cp, 128 * 1024, private=True)); status = decode(reads.pinned(sp, 128 * 1024, private=True))
        reads.pinned({'path': str(v5.WORK / f'gateway-study-v5-batch-{i:03}-launch-config.json'), 'sha256': cp['sha256']}, 128 * 1024, private=True, retain=False)
        producer = failed_supervisor(config, status, cp, sp, checked['start'], checked['end'], previous_end) if terminal else v5.validate_supervisor(config, status, cp, sp, i, checked['maximum'], checked['start'], checked['end'], previous_end)
        for value in [producer['identity']] + [v for p in [cp, sp] for v in p.values()]:
            need(value not in known_pins, 'reused-producer-evidence'); known_pins.add(value)
        previous_end = producer['ended']; producers.append(producer)
        l = closed['ledger']; exact(l, ['path', 'bytes', 'sha256', 'exposureMicros', 'priorGatewayExposureMicros', 'totalAmendmentExposureMicros', 'budget'], 'native-ledger-shape')
        length = integer(l['bytes'], previous_bytes + 1, len(ledger_raw)); prefix = ledger_raw[:length]
        prefix_events, current, pending = ledger_events(prefix, TERMINAL if terminal else None)
        equal([e['id'] for e in prefix_events if e['kind'] == 'reserved'], all_keys + checked['admittedKeys'], 'admitted-ledger-order')
        need(l['path'] == str(v5.STUDY / 'ledger.jsonl') and digest(prefix) == l['sha256'] and len(prefix_events) == len(checked['finalKeys']) * 2 - int(terminal), 'native-ledger-prefix')
        confirmed = sum(e['micros'] for e in prefix_events[previous_event_count:] if e['kind'] == 'settled')
        equal(l['budget'], {'capUsd': 40, 'maxCalls': checked['maximum'], 'reservedCalls': checked['count'], 'historicalExposureUsd': 21.655385,
            'priorAmendmentExposureUsd': (v5.CARRY + previous_exposure) / 1e6, 'accountedUsd': (v5.CARRY + current) / 1e6,
            'confirmedThisRunUsd': confirmed / 1e6, 'unresolvedThisRunUsd': sum(pending.values()) / 1e6, 'billedUsd': None}, 'native-budget-summary')
        need(l['exposureMicros'] == current and l['priorGatewayExposureMicros'] == v5.CARRY and l['totalAmendmentExposureMicros'] == v5.CARRY + current, 'native-budget-carry')
        if not terminal:
            accepted_at = dt.datetime.fromisoformat(acceptance['recordedAt'])
            need(accepted_at.tzinfo is not None and accepted_at >= previous_end, 'acceptance-before-exit')
            need(acceptance['ledgerExposureMicros'] == current and acceptance['totalAmendmentExposureMicros'] == v5.CARRY + current, 'accepted-budget-carry')
            inv_pin = v5.parse_pin(acceptance['inventory'])
            need(inv_pin['path'] == str(v5.WORK / f'gateway-v5-batch-{i:03}-closed-inventory.json'), 'numbered-inventory-path')
            accepted_files = v5.inventory_shape(decode(reads.pinned(inv_pin, 16 * M, private=True)))
            expected_at_i = ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl'] + batch_files + [f'jobs/{key}/{name}' for key in checked['finalKeys'] for name in v5.JOB_FILES]
            equal([f['path'] for f in accepted_files], sorted(expected_at_i), 'accepted-exact-file-set')
            for item in accepted_files:
                if item['path'] == 'ledger.jsonl':
                    equal(item, {'path': 'ledger.jsonl', 'bytes': length, 'sha256': digest(prefix)}, 'accepted-ledger-prefix')
                else:
                    equal(final_index.get(item['path']), item, 'accepted-file-changed')
            if previous_inventory is not None:
                accepted_index = {f['path']: f for f in accepted_files}
                for item in previous_inventory:
                    if item['path'] != 'ledger.jsonl':
                        equal(accepted_index.get(item['path']), item, 'inventory-history-changed')
            previous_inventory = accepted_files
        all_keys.extend(checked['admittedKeys']); previous_exposure, previous_bytes, previous_event_count = current, length, len(prefix_events)
        runs.append({'runId': run, 'admissionSha256': admission_pin['sha256'], 'closureSha256': closed_pin['sha256'], 'configuration': cp,
            'supervisorStatus': sp, 'groupGone': True, 'runnerExitCode': 1 if terminal else 0, 'newTransportInvocations': checked['count']})
    need(len({r['runId'] for r in runs}) == PRODUCERS and previous_bytes == len(ledger_raw) and previous_exposure == exposure, 'complete-native-history')
    equal(all_keys, [j['key'] for j in jobs], 'complete-original-reservation-order')
    expected_files = ['freeze.json', 'preparation.json', 'store.json', 'ledger.jsonl'] + batch_files + [f'jobs/{j["key"]}/{name}' for j in jobs for name in (TERMINAL_FILES if j['key'] == TERMINAL else v5.JOB_FILES)]
    equal([f['path'] for f in files], sorted(expected_files), 'complete-closed-file-set')
    old_ledgers = [{'path': str(path), 'sha256': sha} for path, sha in v5.OLD_LEDGERS]
    for pin in old_ledgers:
        reads.pinned(pin, 8 * M, retain=False)
    v5.ensure_absent(locks())
    # Sole process launch. Production invocation belongs to the reviewed root owner.
    argv = [v5.PS, '-axo', 'pid=,ppid=,pgid=,command=']
    snapshot = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, timeout=15)
    process_count = validate_process_absence(snapshot.stdout, producers); process_sha = digest(snapshot.stdout.encode()); del snapshot
    checked_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    reads.recheck(); verify_context(v5.CONTEXT); validate_study_binding(v5.CONTEXT, freeze_pin)
    verify_numbered_entries(); v5.ensure_absent(list(OUTPUTS.values()) + locks())
    for path, signature in dir_signatures.items():
        equal(directory(Path(path), private=True), signature, 'final-study-directory-changed')
    equal(v5.source_identity(reads), source_files, 'final-source-unchanged')
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    need(previous_end <= v5.timestamp(checked_at) <= v5.timestamp(now) and v5.timestamp(now) - v5.timestamp(checked_at) <= dt.timedelta(seconds=60), 'process-proof-stale')
    return write_documents(now, files, runs, accept_pins, jobs, {
        'diagnosis': diagnosis_pin, 'auditorAcceptance': auditor_acceptance, 'oldLedgers': old_ledgers,
        'processInventory': {'argv': argv, 'checkedAt': checked_at, 'sha256': process_sha, 'rows': process_count, 'matchedProducers': 0},
        'unresolvedReservationMicros': unresolved[TERMINAL]})


def write_documents(now, files, runs, acceptances, jobs, evidence):
    """Serialize exactly the importer contract and a separate owner receipt."""
    serialize = lambda value: (json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + '\n').encode()
    inventory = {'schema': 'oh.gateway-import-inventory.v6', 'freezeSha256': v5.FREEZE, 'files': files}
    inv_raw = serialize(inventory); inv_pin = {'path': str(OUTPUTS['inventory']), 'sha256': digest(inv_raw)}
    closure = {'schema': 'oh.gateway-import-supervisor-closure.v6', 'freezeSha256': v5.FREEZE, 'inventorySha256': inv_pin['sha256'],
        'verification': 'owner-verified-complete-producer-inventory', 'allProducersClosed': True, 'runs': runs, 'acceptances': acceptances}
    closure_raw = serialize(closure); closure_pin = {'path': str(OUTPUTS['supervisorClosure']), 'sha256': digest(closure_raw)}
    manifest = {'schema': 'oh.gateway-study-import.v6', 'createdAt': now, 'studyDirectory': str(v5.STUDY), 'sourceDirectory': str(v5.RUNTIME),
        'freeze': {'path': str(v5.STUDY / 'freeze.json'), 'sha256': v5.FREEZE}, 'inventory': inv_pin, 'supervisorClosure': closure_pin,
        'jobs': jobs, 'terminalReaderJobKey': TERMINAL, 'policySha256': POLICY, 'qualification': QUALIFICATION}
    manifest_raw = serialize(manifest); manifest_pin = {'path': str(OUTPUTS['manifest']), 'sha256': digest(manifest_raw)}
    receipt = {'schema': 'oh.gateway-v6-import-preparation.v1', 'recordedAt': now, 'sourceSha256': v5.SOURCE, 'policySha256': POLICY,
        'producerCount': PRODUCERS, 'successfulAcceptances': ACCEPTED, 'studyFiles': len(files), 'newJobs': JOBS,
        'extractionJobs': EXTRACTIONS, 'attemptedReaderJobs': READERS, 'completedJobs': JOBS - 1, 'terminalReaderJobKey': TERMINAL,
        'ledger': {'path': str(v5.STUDY / 'ledger.jsonl'), 'bytes': LEDGER_BYTES, 'sha256': LEDGER_SHA, 'exposureMicros': EXPOSURE},
        'priorGatewayExposureMicros': v5.CARRY, 'totalCarriedExposureMicros': CARRY, **evidence,
        'inventory': inv_pin, 'supervisorClosure': closure_pin, 'manifest': manifest_pin,
        'modelCalls': 0, 'auditorCalls': 0, 'studyWrites': 0, 'correctnessInspected': False, 'responseTextInspected': False,
        'qualification': 'Fresh owner custody and inventory only; the v6 importer must replay every original response and native job before accepting this manifest. Historical diagnosis is not fresh process proof.'}
    receipt_raw = serialize(receipt)
    v5.exclusive_outputs({OUTPUTS['inventory']: inv_raw, OUTPUTS['supervisorClosure']: closure_raw, OUTPUTS['manifest']: manifest_raw, OUTPUTS['receipt']: receipt_raw})
    return {'receipt': {'path': str(OUTPUTS['receipt']), 'sha256': digest(receipt_raw)}, 'manifest': manifest_pin, 'inventory': inv_pin,
        'supervisorClosure': closure_pin, 'producerCount': PRODUCERS, 'newJobs': JOBS, 'modelCalls': 0, 'studyWrites': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True, help='Explicit machine context; existing evidence cannot be relocated.')
    args = parser.parse_args()
    try:
        configure(load_context(args.context)); print(json.dumps(prepare()))
    except Exception as error:
        reason = str(error) if isinstance(error, (Rejected, ContextError)) else 'input-or-io-rejection'
        print(json.dumps({'schema': 'oh.gateway-v6-import-preparation.v1', 'status': 'rejected', 'reason': reason,
            'modelCalls': 0, 'studyWrites': 0, 'semanticTextPrinted': False}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
