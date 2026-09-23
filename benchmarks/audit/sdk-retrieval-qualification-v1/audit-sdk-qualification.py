"""Independent, stdlib-only SDK study audit. Never sends requests or writes inputs.

Run only after native/provider children are collected and SQLite is closed.
The manifest pins prepared, launch, result, database and task-budget receipts.
Output is aggregate-only; source text, answers, IDs and paths are never emitted.
This is a separate implementation of arithmetic/custody, not third-party review.
"""
from __future__ import annotations
import argparse
import collections
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import sqlite3
import stat
import sys

PEOPLE = ['2684282b-1e09-42a8-9425-533e2a95901d', '11ccc069-2a93-4e9d-af03-cdacb0b8d568']
DISPOSITIONS = ['completed', 'truncated', 'refused', 'failed', 'unresolved', 'unattempted']
JS_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def need(condition, reason):
    if not condition:
        raise ValueError('SDK independent audit: ' + reason)


def canonical(value):
    # All hashed numeric preimages here contain integers or exactly represented
    # protocol settings (0.1). Native float scores are compared, not re-hashed.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        while chunk := handle.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def read_pin(pin, maximum=64 * 1024 * 1024, private=False, decode=True):
    need(isinstance(pin, dict) and set(pin) == {'path', 'sha256'}, 'pin schema')
    need(isinstance(pin['sha256'], str) and re.fullmatch('[a-f0-9]{64}', pin['sha256']), 'pin digest shape')
    path = pathlib.Path(pin['path'])
    before = path.lstat()
    need(path.is_absolute() and path.resolve() == path and stat.S_ISREG(before.st_mode)
         and before.st_nlink == 1 and 0 < before.st_size <= maximum, 'pinned file custody')
    need(not private or before.st_mode & 0o077 == 0, 'private file permissions')
    raw = path.read_bytes()
    after = path.lstat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
         == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'file changed while reading')
    need(len(raw) <= maximum and sha(raw) == pin['sha256'], 'pinned bytes differ')
    return json.loads(raw) if decode else raw


def pct(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def distribution(values):
    return {'count': len(values), 'mean': sum(values) / len(values) if values else None,
            'p50': pct(values, .5), 'p95': pct(values, .95), 'maximum': max(values) if values else None}


def trim(text):
    return text.strip(JS_WHITESPACE)


def timestamp(value):
    need(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?', value), 'source timestamp grammar')
    return datetime.datetime.fromisoformat(value.rstrip('Z'))


def native_status(envelope):
    need(isinstance(envelope.get('choices'), list) and len(envelope['choices']) == 1, 'one native choice')
    choice = envelope['choices'][0]
    message = choice['message']
    need(message.get('role') == 'assistant' and choice.get('index', 0) == 0, 'native message role/index')
    content = message.get('content')
    need(content is None or isinstance(content, str), 'native text content')
    partial = trim(content) if isinstance(content, str) else None
    finish = choice.get('finish_reason')
    tools = message.get('tool_calls') is not None or message.get('function_call') is not None
    refusal = message.get('refusal')
    refused = finish == 'content_filter' or isinstance(refusal, str) and bool(refusal)
    disposition = ('failed' if tools else 'truncated' if finish == 'length' else 'refused' if refused
                   else 'completed' if finish == 'stop' and partial else 'failed')
    return disposition, partial if disposition == 'completed' else None


def native_usage_identity(envelope, request, stored):
    message = envelope['choices'][0]['message']
    copies = [part[k] for part in [envelope, message] for k in ['providerMetadata', 'provider_metadata'] if k in part]
    need(copies and all(part == copies[0] for part in copies), 'native routing metadata')
    gateway = copies[0]['gateway']
    route = gateway['routing']
    need(route['finalProvider'] == 'openai' and route['originalModelId'] == 'openai/gpt-4o-mini'
         and route['canonicalSlug'] == 'openai/gpt-4o-mini', 'native model route')
    need(re.fullmatch(r'(?:openai/)?gpt-4o-mini(?:-\d{4}-\d{2}-\d{2})?', envelope['model']), 'native model identity')
    usage = envelope['usage']
    inp, out = usage['prompt_tokens'], usage['completion_tokens']
    cached = (usage.get('prompt_tokens_details') or {}).get('cached_tokens', 0)
    reasoning = (usage.get('completion_tokens_details') or {}).get('reasoning_tokens', 0)
    need(all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in [inp, out, cached, reasoning])
         and cached <= inp <= request['inputUpperBound'] and reasoning <= out <= 512
         and usage['total_tokens'] == inp + out, 'native token accounting')
    token_cost = ((inp - cached) * 150 + cached * 75 + out * 600 + 999) // 1000
    cost = gateway.get('cost')
    if isinstance(cost, str):
        need(re.fullmatch(r'(?:0|[1-9]\d{0,8})(?:\.\d{1,12})?', cost), 'native cost decimal')
        whole, _, fraction = cost.partition('.')
        pico = int(whole) * 10**12 + int(fraction.ljust(12, '0'))
        gateway_cost = (pico + 999999) // 1000000
    else:
        need(cost is None or isinstance(cost, (float, int)) and math.isfinite(cost) and cost >= 0, 'native cost')
        gateway_cost = None if cost is None else math.ceil(cost * 1000000)
    expected = {'inputTokens': inp, 'cachedInputTokens': cached, 'outputTokens': out, 'reasoningTokens': reasoning,
                'tokenRateMicros': token_cost, 'gatewayReportedMicros': gateway_cost, 'micros': max(token_cost, gateway_cost or 0)}
    need(expected == stored['usage'] and expected['micros'] <= request['reservationMicros'], 'native settled cost')
    identity = stored['identity']
    need(identity['requestedModel'] == 'openai/gpt-4o-mini' and identity['reportedModel'] == envelope['model']
         and identity['finalProvider'] == 'openai' and identity['snapshotPinned'] is False
         and identity['qualification'] == 'gateway-alias'
         and identity['resolvedProviderApiModelId'] == route.get('resolvedProviderApiModelId'), 'native settled identity')
    return expected, identity


def messages(question, context):
    name = question['personName']
    choices = '\n'.join(c['id'] + '. ' + c['text'] for c in question['choices'])
    return [{'role': 'user', 'content':
             f'You are playing the role of {name}, answering some questions on his behalf. Your answers must be strictly based on the provided reference memories (from {name} himself/herself). Respond with only the option ID (e.g., A, B, C, D).\n\n'
             f'Memories:\n{context}\n\nQuestion: {question["question"]}\n\nOptions:\n{choices}\n\nCorrect Option ID:'}]


def cell_summary(cells, arms):
    return [{'armId': arm, 'cases': len(selected := [c for c in cells if c['arm'] == arm]),
             'correct': sum(c['score'] for c in selected),
             'accuracy': sum(c['score'] for c in selected) / len(selected),
             'dispositions': {state: sum(c['state'] == state for c in selected) for state in DISPOSITIONS}}
            for arm in arms]


def paired_summary(pairs):
    base = sum(p['baseline'] for p in pairs) / len(pairs)
    candidate = sum(p['candidate'] for p in pairs) / len(pairs)
    return {'questions': len(pairs), 'baseline': base, 'candidate': candidate, 'delta': candidate - base,
            'wins': sum(p['candidate'] > p['baseline'] for p in pairs),
            'losses': sum(p['candidate'] < p['baseline'] for p in pairs),
            'ties': sum(p['candidate'] == p['baseline'] for p in pairs)}


def descriptive_uncertainty(pairs, seed_hex):
    # Fix observed personas and paired questions. This is descriptive, added after
    # protocol freeze but before opening answers, and never changes the gate.
    groups = [[p['candidate'] - p['baseline'] for p in pairs if p['person'] == person] for person in PEOPLE]
    state = int(seed_hex[:16], 16)
    sampled = []
    for _ in range(10000):
        total = 0
        for group in groups:
            for _ in group:
                state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
                index = ((state >> 16) * len(group)) // (1 << 48)
                total += group[index]
        sampled.append(total / len(pairs))
    return {'method': '10,000 deterministic paired-question bootstrap draws within each fixed persona; LCG64',
            'seedSha256': seed_hex, 'lower95': pct(sampled, .025), 'upper95': pct(sampled, .975),
            'independentPersonas': 2, 'exposedDevelopmentPersonas': 2,
            'qualification': 'Post-protocol descriptive interval conditional on these two exposed personas. It treats questions as exchangeable within persona; dependencies can make it optimistic. Not a population confidence interval, clean-holdout test, or gate input.'}


def authenticate_native_interpretation(packet, prepared, frozen, owner, dispatch):
    pin = packet['nativeInterpretationPin']
    interpretation = read_pin(pin, 64 * 1024, True)
    review = read_pin(packet['reviewPin'], 64 * 1024, True)
    need(review['nativeInterpretationPin'] == pin and review['approved'] is True,
         'reviewed native interpretation pin')
    need(interpretation['protocol'] == 'oh.sdk-retrieval-native-interpretation.v1'
         and interpretation['kind'] == 'pre-paid-protocol-clarification'
         and interpretation['originalProtocolPin'] == prepared['protocolPin'] == frozen['protocolPin']
         and interpretation['stderrSha256'] == owner['stderrSha256']
         and interpretation['handledInitializationDiagnostics'] == 1
         and interpretation['decisionBeforePaid'] is True and interpretation['decisionBeforeAnswerScoring'] is True
         and interpretation['nativeErrorsMeans'] == 'reranker-execution-or-cleanup-failures'
         and interpretation['rerankerErrorsAllowed'] == interpretation['fallbackDiagnosticsAllowed']
         == interpretation['cleanupWarningsAllowed'] == 0
         and interpretation['literalZeroErrorLogPolicyWouldFail'] is True
         and interpretation['numericalQualityGatesChanged'] is False
         and interpretation['originalProtocolWordingClarified'] is True,
         'explicit pre-paid initialization interpretation')
    source_review = interpretation['sourceReviewPin']
    need(pathlib.Path(source_review['path']).name == 'metal-probe-source-review.md', 'source review role')
    read_pin(source_review, 64 * 1024, decode=False)
    read_pin(interpretation['originalProtocolPin'], 64 * 1024, decode=False)
    intent = read_pin(dispatch['intentPin'], 64 * 1024, True)
    recorded = datetime.datetime.fromisoformat(interpretation['recordedAt'].replace('Z', '+00:00'))
    started = datetime.datetime.fromisoformat(intent['startedAt'].replace('Z', '+00:00'))
    need(recorded.tzinfo is not None and started.tzinfo is not None and recorded < started
         and intent['packetPin'] == dispatch['packetPin'], 'interpretation predates paid dispatch')
    return pin, interpretation


def audit(manifest):
    need(manifest['protocol'] == 'oh.sdk-retrieval-independent-audit-input.v1', 'manifest protocol')
    prepared = read_pin(manifest['preparedPin'], 512 * 1024, True)
    need(prepared['protocol'] == 'oh.sdk-retrieval-qualification-paid-prepared.v1'
         and prepared['scoresComputed'] is False, 'paid preparation')
    frozen = read_pin(prepared['freezePin'], 512 * 1024, True)
    capture = read_pin(prepared['capturePin'], private=True)
    owner = read_pin(prepared['ownerPin'], 16 * 1024, True)
    need(capture['freezePin'] == prepared['freezePin'] == owner['freezePin']
         and owner['capturePin'] == prepared['capturePin'] and owner['exitCode'] == 0
         and owner['ownedChildCollected'] is True and owner['nativeCleanupWarnings'] == 0
         and owner['nativeErrors'] == 0 and owner['deadlineSeconds'] == 3600
         and capture['completed'] == 146 and capture['failed'] == 0 and capture['cleanupCompleted'] is True
         and capture['scoresComputed'] is False and capture['providerCalls'] == 0, 'native closure prerequisite')
    launch = read_pin(manifest['launchPin'], 64 * 1024, True)
    budget = read_pin(manifest['taskBudgetPin'], 512 * 1024, True)
    dispatch = read_pin(manifest['dispatchOutcomePin'], 64 * 1024, True)
    packet = read_pin(dispatch['packetPin'], 64 * 1024, True)
    interpretation_pin, interpretation = authenticate_native_interpretation(packet, prepared, frozen, owner, dispatch)
    # Scorer and provider outcomes remain unopened until native closure AND the
    # independently reviewed pre-paid interpretation are authenticated above.
    source = read_pin(prepared['sourcePin'], private=True)
    scorer = read_pin(prepared['scorerPin'], 8 * 1024 * 1024, True)
    plan = read_pin(prepared['planPin'], 128 * 1024 * 1024, True)
    campaign = read_pin(prepared['campaignPin'], 512 * 1024, True)
    result = read_pin(manifest['resultPin'], 2 * 1024 * 1024, True)
    need(budget['protocol'] == 'oh.sdk-retrieval-task-allocation.v1' and budget['additionalBudgetMicros'] == 25000000
         and budget['priorTaskExposureMicros'] == 12876502 and budget['priorGlobalExposureMicros'] == 261835515
         and budget['selectedComparisons'] == ['semantic', 'hybrid'] and budget['selectionBeforeAnswerScoring'] is True
         and budget['maximumPhysicalCalls'] == 1752 and len(budget['campaigns']) == 2
         and packet['taskAllocationPin'] == manifest['taskBudgetPin'] and packet['checkpoint'] == launch['checkpoint'], 'root task allocation identity')
    allocated = next(c for c in budget['campaigns'] if c['comparison'] == prepared['comparison'])
    selected = next(c for c in packet['comparisons'] if c['comparison'] == prepared['comparison'])
    need(allocated['path'] == prepared['campaignPin']['path'] and allocated['sha256'] == prepared['campaignPin']['sha256']
         and allocated['maximumAdditionalMicros'] == 12500000 and selected['preparedPin'] == manifest['preparedPin']
         and selected['launchPin'] == manifest['launchPin'], 'selected task allocation and dispatch packet')
    need(dispatch['protocol'] == 'oh.sdk-retrieval-paid-dispatch-outcome.v1' and dispatch['comparison'] == prepared['comparison']
         and dispatch['codeFrozen'] is True and dispatch['accountingVerified'] is True and dispatch['storeClosed'] is True
         and dispatch['withinTaskBudget'] is True and dispatch['qualityScoresComputed'] is False
         and dispatch['accounting']['databasePin'] == manifest['databasePin'], 'immutable dispatch closure')
    inputs = read_pin(frozen['inputsPin'], private=True)
    arms = ['sdk-' + prepared['comparison'], 'sdk-default-rerank']
    need(prepared['comparison'] in ['semantic', 'hybrid'] and source['arms'] == plan['arms'] == arms
         and plan['repeats'] == 3 and len(source['questions']) == 146 and len(plan['cases']) == 876
         and prepared['codePins'] == frozen['codePins'] and prepared['protocolPin'] == frozen['protocolPin'], 'fixed scope')
    for role in ['planPin', 'sourcePin', 'scorerPin', 'campaignPin', 'promptPin']:
        need(launch[role] == prepared[role], 'launch pin roles')
        if role != 'planPin':
            need(plan[role] == prepared[role], 'plan pin roles')
    need(launch['approved'] is True and launch['scope'] == 'reader-only'
         and campaign['campaignId'] == f'oh-sdk-retrieval-{prepared["comparison"]}-20260923-v1'
         and campaign['additionalBudgetMicros'] <= launch['maximumNewSpendMicros'] <= 12500000
         and campaign['maximumCalls'] <= launch['maximumPhysicalCalls'] <= 876, 'launch identity and cap')
    need(plan['sourceSha256'] == scorer['sourceSha256'] == sha(canonical(source))
         and plan['campaignSha256'] == sha(canonical(campaign)) and result['planSha256'] == sha(canonical(plan)), 'canonical source/plan bindings')
    questions = {q['id']: q for q in source['questions']}
    gold = {g['questionId']: g for g in scorer['rows']}
    ranks = {r['questionId']: r for r in capture['rows']}
    need(len(questions) == len(gold) == len(ranks) == 146 and set(questions) == set(gold) == set(ranks), 'complete question coverage')
    need([sum(q['groupId'] == p for q in questions.values()) for p in PEOPLE] == [114, 32], 'fixed persona counts')
    memories = {p['memory']['personId']: {t['id']: t for t in p['memory']['traces']} for p in inputs['personas']}
    keyed_traces = {p['memory']['personId']: {f'edition:trace-{i:05}': t for i, t in enumerate(p['memory']['traces'])}
                    for p in inputs['personas']}
    input_queries = {q['id']: q for p in inputs['personas'] for q in p['queries']}
    recall_pairs, contexts = [], collections.defaultdict(list)
    for qid, question in questions.items():
        row, labels = ranks[qid], gold[qid]
        need(row['personId'] == labels['personId'] == question['groupId'] and row['querySha256'] == sha(question['question'])
             and row['questionDate'] == question['questionDate'] and row['diagnostics'] == []
             and row['defaultMode'] == 'rerank', 'native question identity')
        need(labels['correctChoiceId'] in [c['id'] for c in question['choices']], 'gold option identity')
        input_query = input_queries[qid]
        cutoff = timestamp(question['questionDate'])
        eligible = [t['id'] for t in memories[question['groupId']].values() if timestamp(t['date']) <= cutoff]
        need(input_query['query'] == question['question'] and input_query['eligibleTraceIds'] == eligible
             and row['eligibleRecords'] == len(eligible), 'source cutoff precedes limits')
        pool = row['pool']
        score_rows = row['nativeScores']
        keys = [p['key'] for p in pool]
        need(0 < len(keys) <= 60 and len(keys) == len(set(keys)) and len(score_rows) == len(keys)
             and set(s['key'] for s in score_rows) == set(keys), 'complete native score pool')
        for item in pool:
            trace = keyed_traces[question['groupId']][item['key']]
            need(trace['id'] in eligible, 'future document in native pool')
            doc = f'# {item["key"]}\n\nkind: edition\n\n{canonical(trace)}\n'
            need(item['documentSha256'] == sha(doc) and item['documentBytes'] == len(doc.encode()), 'actual SDK recordDocument bytes')
        need(all(s['v'] == 1 and isinstance(s['score'], (int, float)) and math.isfinite(s['score']) for s in score_rows), 'finite native scores')
        expected_rank = [keyed_traces[question['groupId']][s['key']]['id']
                         for s in sorted(score_rows, key=lambda s: (-s['score'], s['key']))[:10]]
        need(next(a['traceIds'] for a in row['arms'] if a['armId'] == 'sdk-default-rerank') == expected_rank,
             'native scores to default SDK rank')
        if prepared['comparison'] == 'semantic':
            semantic_rank = [keyed_traces[question['groupId']][s['key']]['id'] for s in input_query['semanticCapture'][:10]]
            need(next(a['traceIds'] for a in row['arms'] if a['armId'] == 'sdk-semantic') == semantic_rank, 'historical semantic control rank')
        evidence = set(item for group in labels['evidenceGroups'] for item in group)
        scores = []
        for arm in arms:
            rank = next(a for a in row['arms'] if a['armId'] == arm)
            context = next(c['text'] for c in question['contexts'] if c['armId'] == arm)
            ids = rank['traceIds']
            need(len(ids) <= 10 and len(ids) == len(set(ids)), 'native ranking bound')
            traces = memories[question['groupId']]
            expected = '\n\n'.join(f'---- idx {i + 1} ----\n{trim(traces[tid]["content"])}' for i, tid in enumerate(ids))
            need(context == expected == rank['context'] and sha(context) == rank['contextSha256']
                 and len(context.encode()) == rank['contextBytes'] <= 96 * 1024, 'whole source context custody')
            contexts[arm].append(len(context.encode()))
            scores.append(len(evidence.intersection(ids)) / len(evidence) if evidence else None)
        if all(s is not None for s in scores):
            recall_pairs.append({'person': question['groupId'], 'baseline': scores[0], 'candidate': scores[1]})
    jobs = {j['key']: j for j in plan['jobs']}
    outcomes = {o['jobKey']: o for o in result['outcomes']}
    need(len(jobs) == len(plan['jobs']) == len(outcomes) == len(result['outcomes']) <= 876 and set(jobs) == set(outcomes), 'physical coverage')
    need(plan['maximumPhysicalCalls'] == len(jobs)
         and plan['maximumReservationMicros'] == sum(j['request']['reservationMicros'] for j in jobs.values())
         <= campaign['additionalBudgetMicros'], 'plan reservation')
    physical = {}
    for key, job in jobs.items():
        request = job['request']
        need(key == f'{request["requestSha256"]}:{job["repeat"]}' and job['repeat'] in [0, 1, 2]
             and request['requestSha256'] == sha(canonical({k: v for k, v in request.items() if k != 'requestSha256'})), 'request digest')
        need(request['profileId'] == 'gpt4o-mini-clonemem-choice-v1-reader'
             and request['body']['model'] == 'openai/gpt-4o-mini' and request['body']['temperature'] == .1
             and request['body']['max_tokens'] == 512 and request['body']['stream'] is False
             and request['body']['store'] is False, 'fixed reader treatment')
        db_key = sha(canonical({'campaignId': campaign['campaignId'], 'profileSha256': request['profileSha256'],
                                'requestSha256': request['requestSha256'], 'repeat': job['repeat']}))
        physical[db_key] = key
    database_path = pathlib.Path(manifest['databasePin']['path'])
    need(database_path == pathlib.Path(campaign['storeDirectory']) / 'campaign.sqlite', 'native database role')
    for name in ['active.lock', 'campaign.sqlite-wal', 'campaign.sqlite-shm', 'campaign.sqlite-journal']:
        need(not (database_path.parent / name).exists(), 'native database must be closed')
    before = database_path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_mode & 0o077 == 0
         and database_path.resolve() == database_path and before.st_size <= 4 * 1024**3
         and digest(database_path) == manifest['databasePin']['sha256'], 'database pin custody')
    conn = sqlite3.connect(database_path.as_uri() + '?mode=ro&immutable=1', uri=True)
    conn.execute('PRAGMA query_only=ON')
    conn.row_factory = sqlite3.Row
    stored, usage_total, identities = {}, collections.Counter(), collections.Counter()
    try:
        need(conn.execute("select count(*) from sqlite_master where type in ('view','trigger')").fetchone()[0] == 0, 'native schema')
        need([tuple(r) for r in conn.execute('select key,value from metadata')] ==
             [('identity', sha(canonical({'protocol': 'oh.memory.evolution-store.v1', 'campaign': campaign})))], 'native campaign identity')
        need(conn.execute('select count(*) from jobs').fetchone()[0] <= len(jobs), 'database row bound')
        for row in conn.execute('select key,repeat,request,reservation,charge,status,raw,raw_sha,raw_meta,result from jobs'):
            need(row['key'] in physical, 'unplanned native job')
            key = physical[row['key']]
            job, outcome = jobs[key], outcomes[key]
            need(key not in stored and json.loads(row['request']) == job['request'] and row['repeat'] == job['repeat']
                 and row['reservation'] == job['request']['reservationMicros'], 'native request custody')
            answer, measured_usage, identity = None, None, None
            status = row['status']
            need(status in ['reserved', 'captured', 'settled'], 'native status')
            if status == 'reserved':
                need(row['raw'] is None and row['raw_sha'] is None and row['raw_meta'] is None
                     and row['result'] is None and outcome['disposition'] == 'unresolved'
                     and outcome['serviceMs'] is None, 'reserved state')
            else:
                # The transport retains up to 2 MiB even for an unverifiable
                # response. Settled model parsing has the stricter 1 MiB bound.
                need(isinstance(row['raw'], bytes) and len(row['raw']) <= 2 * 1024 * 1024
                     and sha(row['raw']) == row['raw_sha'], 'raw response custody')
                need(isinstance(row['raw_meta'], str) and len(row['raw_meta'].encode()) <= 1024, 'transport metadata bound')
                meta = json.loads(row['raw_meta'])
                received, http, elapsed = meta['receivedBytes'], meta['httpStatus'], meta.get('serviceMs')
                need(set(meta) in [{'httpStatus', 'complete', 'receivedBytes', 'error'},
                                   {'httpStatus', 'complete', 'receivedBytes', 'error', 'serviceMs'}]
                     and isinstance(meta['complete'], bool) and isinstance(received, int) and not isinstance(received, bool)
                     and len(row['raw']) <= received <= 2**53-1
                     and meta['error'] in [None, 'network', 'body-read', 'response-bound']
                     and (http is None or isinstance(http, int) and not isinstance(http, bool) and 100 <= http <= 599)
                     and (elapsed is None or isinstance(elapsed, (float, int)) and math.isfinite(elapsed) and 0 <= elapsed <= 86400000)
                     and (not meta['complete'] or meta['error'] is None and received == len(row['raw']))
                     and outcome['serviceMs'] == elapsed, 'transport custody')
                if status == 'settled':
                    need(0 < len(row['raw']) <= 1024 * 1024 and received == len(row['raw'])
                         and meta['complete'] is True and meta['httpStatus'] == 200 and meta['error'] is None, 'settled native transport')
                    envelope, native = json.loads(row['raw']), json.loads(row['result'])
                    disposition, answer = native_status(envelope)
                    need(native['status'] == outcome['disposition'] == disposition and native['answer'] == answer
                         and native['rawSha256'] == outcome['rawSha256'] == row['raw_sha']
                         and native['requestSha256'] == job['request']['requestSha256']
                         and native['profileSha256'] == job['request']['profileSha256']
                         and outcome['answerSha256'] == (sha(answer) if answer is not None else None), 'native answer/status custody')
                    measured_usage, identity = native_usage_identity(envelope, job['request'], native)
                    need(row['charge'] == outcome['chargeMicros'] == measured_usage['micros'], 'settled exposure')
                    for field in ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'micros']:
                        usage_total[field] += measured_usage[field]
                    identities[canonical(identity)] += 1
                else:
                    need(row['result'] is None and outcome['disposition'] == 'unresolved', 'captured unresolved state')
            if status != 'settled':
                need(answer is None and outcome['answerSha256'] is None and row['charge'] == row['reservation'] == outcome['chargeMicros'], 'unresolved full exposure')
            stored[key] = {'answer': answer, 'charge': row['charge'], 'status': status, 'usage': measured_usage}
    finally:
        conn.close()
    after = database_path.lstat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
         and digest(database_path) == manifest['databasePin']['sha256'], 'database unchanged')
    for key in jobs:
        if key not in stored:
            need(outcomes[key] == {'jobKey': key, 'disposition': 'unattempted', 'answerSha256': None,
                                  'rawSha256': None, 'chargeMicros': 0, 'serviceMs': None}, 'unattempted custody')
    exposure = sum(s['charge'] for s in stored.values())
    confirmed = sum(s['charge'] for s in stored.values() if s['status'] == 'settled')
    need(result['ledger'] == {'calls': len(stored), 'exposureMicros': exposure, 'confirmedMicros': confirmed,
         'unresolvedMicros': exposure - confirmed, 'additionalBudgetMicros': campaign['additionalBudgetMicros'],
         'maximumCalls': campaign['maximumCalls'], 'historicalExposureMicros': campaign['historicalExposureMicros'],
         'combinedExposureMicros': campaign['historicalExposureMicros'] + exposure}, 'complete ledger arithmetic')
    cells, seen = [], set()
    for case in plan['cases']:
        key, qid, arm, repeat = case['jobKey'], case['questionId'], case['armId'], case['repeat']
        identity = (qid, arm, repeat)
        need(identity not in seen and qid in questions and arm in arms and repeat in [0, 1, 2], 'logical matrix identity')
        seen.add(identity)
        question, job, outcome = questions[qid], jobs[key], outcomes[key]
        context = next(c['text'] for c in question['contexts'] if c['armId'] == arm)
        need(case['groupId'] == question['groupId'] and repeat == job['repeat']
             and case['contextSha256'] == sha(context) and job['request']['body']['messages'] == messages(question, context), 'reader request rendering')
        answer = stored.get(key, {}).get('answer')
        need(outcome['disposition'] in DISPOSITIONS, 'logical disposition')
        score = int(answer is not None and len(answer.encode()) <= 16384
                    and trim(answer).upper() == trim(gold[qid]['correctChoiceId']).upper())
        need(outcome['disposition'] == 'completed' or score == 0, 'failure zero')
        cells.append({'question': qid, 'person': question['groupId'], 'arm': arm, 'repeat': repeat,
                      'score': score, 'state': outcome['disposition']})
    need(len(seen) == 146 * 2 * 3 and set(c['jobKey'] for c in plan['cases']) == set(jobs), 'full logical matrix')
    pairs = [{'person': q['groupId'], 'baseline': sum(c['score'] for c in cells if c['question'] == qid and c['arm'] == arms[0]) / 3,
              'candidate': sum(c['score'] for c in cells if c['question'] == qid and c['arm'] == arms[1]) / 3}
             for qid, q in questions.items()]
    reader, recall = paired_summary(pairs), paired_summary(recall_pairs) if recall_pairs else None
    by_persona = []
    for index, person in enumerate(PEOPLE):
        pp = [p for p in pairs if p['person'] == person]
        rp = [p for p in recall_pairs if p['person'] == person]
        by_persona.append({'persona': f'persona-{index+1:02}', 'reader': paired_summary(pp),
                          'recallAt10': paired_summary(rp) if rp else None,
                          'arms': cell_summary([c for c in cells if c['person'] == person], arms)})
    native_times = [r['rerankMs'] for r in capture['rows']]
    need(all(isinstance(t, (float, int)) and math.isfinite(t) and t >= 0 for t in native_times), 'finite native timings')
    need(capture['timings']['p50Ms'] == pct(native_times, .5) and capture['timings']['p95Ms'] == pct(native_times, .95)
         and capture['timings']['warmP95Ms'] == pct(native_times[1:], .95), 'native timing arithmetic')
    need(capture['totalPairs'] == sum(len(r['pool']) for r in capture['rows'])
         and capture['maximumPool'] == max(len(r['pool']) for r in capture['rows'])
         and capture['maximumDocumentBytes'] == max(p['documentBytes'] for r in capture['rows'] for p in r['pool']), 'native pool aggregate arithmetic')
    failed = sum(c['state'] != 'completed' for c in cells)
    complete = result['halt'] == 'none' and failed == 0 and exposure == confirmed
    conditions = {'all876LogicalCasesCompleted': complete,
                  'answerGainAtLeast3PercentagePoints': reader['delta'] >= .03 - 1e-12,
                  'answerGainNonnegativeInBothPersonas': all(p['reader']['delta'] >= -1e-12 for p in by_persona),
                  'all146RecallQuestionsEvaluable': len(recall_pairs) == 146,
                  'overallRecallAt10Improves': recall is not None and recall['delta'] > 1e-12,
                  'recallAt10NonnegativeInBothPersonas': all(p['recallAt10'] is not None and p['recallAt10']['delta'] >= -1e-12 for p in by_persona),
                  'nativeWarmP95Within30Seconds': pct(native_times[1:], .95) <= 30000,
                  'nativeCaptureAndResourcesClosed': True}
    accounting = dispatch['accounting']
    need(accounting['calls'] == len(stored) and accounting['exposureMicros'] == exposure
         and accounting['confirmedMicros'] == confirmed and accounting['unresolvedMicros'] == exposure - confirmed
         and accounting['storeClosed'] is True, 'dispatch accounting reconciles to immutable SQLite')
    additional = dispatch['additionalTaskExposureMicros']
    need(isinstance(additional, int) and not isinstance(additional, bool), 'dispatch cumulative exposure')
    prior_additional = additional - exposure
    need(isinstance(prior_additional, int) and 0 <= prior_additional <= 25000000
         and prior_additional + exposure <= 25000000 and (prepared['comparison'] != 'semantic' or prior_additional == 0)
         and dispatch['priorTaskExposureMicros'] == 12876502 and dispatch['totalTaskExposureMicros'] == 12876502 + additional
         and dispatch['priorGlobalExposureMicros'] == 261835515 and dispatch['totalGlobalExposureMicros'] == 261835515 + additional
         and len(stored) <= dispatch['additionalTaskCalls'] <= 1752, 'root cumulative accounting arithmetic')
    if 'priorAdditionalExposureMicros' in manifest:
        need(manifest['priorAdditionalExposureMicros'] == prior_additional, 'caller prior exposure differs from dispatch receipt')
    report = {'protocol': 'oh.sdk-retrieval-qualification-independent-report.v1', 'comparison': prepared['comparison'],
        'benchmarkCheckpoint': launch['checkpoint'], 'auditorSha256': digest(pathlib.Path(__file__).resolve()),
        'pins': {**{name: manifest[name]['sha256'] for name in ['preparedPin', 'launchPin', 'resultPin', 'databasePin', 'taskBudgetPin', 'dispatchOutcomePin']},
                 **{name: prepared[name]['sha256'] for name in ['freezePin', 'capturePin', 'ownerPin', 'sourcePin', 'scorerPin', 'planPin', 'protocolPin']},
                 'nativeInterpretationPin': interpretation_pin['sha256'],
                 'nativeSourceReviewPin': interpretation['sourceReviewPin']['sha256']},
        'questions': 146, 'personas': 2, 'repeats': 3, 'logicalCases': 876, 'physicalJobs': len(jobs),
        'matrixComplete': complete, 'failedLogicalCases': failed, 'halt': result['halt'], 'databaseUnchanged': True,
        'reader': {'arms': cell_summary(cells, arms), 'pairedQuestions': reader, 'byPersona': by_persona,
                   'byRepeat': [{'repeat': r, 'arms': cell_summary([c for c in cells if c['repeat'] == r], arms)} for r in [0, 1, 2]],
                   'descriptiveUncertainty': descriptive_uncertainty(pairs, prepared['freezePin']['sha256'])},
        'retrieval': {'k': 10, 'evaluableQuestions': len(recall_pairs), 'missingEvidenceQuestions': 146 - len(recall_pairs),
                      'pairedQuestions': recall},
        'contexts': [{'armId': arm, 'bytes': distribution(contexts[arm])} for arm in arms],
        'native': {'complete': 146, 'failed': 0, 'calls': capture['nativeCalls'], 'elapsedMs': capture['elapsedMs'],
                   'firstQueryMs': native_times[0], 'rerankerMs': distribution(native_times),
                   'warmRerankerMs': distribution(native_times[1:]), 'totalPairs': capture['totalPairs'],
                   'maximumPool': capture['maximumPool'], 'maximumDocumentBytes': capture['maximumDocumentBytes'],
                   'initializationInterpretation': {'kind': interpretation['kind'], 'recordedAt': interpretation['recordedAt'],
                       'handledCapabilityProbeFailures': 1, 'rerankerExecutionOrCleanupFailures': 0,
                       'stderrSha256': interpretation['stderrSha256'], 'literalZeroErrorLogPolicyWouldFail': True,
                       'numericalQualityGatesChanged': False,
                       'qualification': 'One error-level Metal initialization diagnostic was classified, from pinned source before paid dispatch and answer scoring, as a handled optional f16/bf16 capability-probe failure. The line does not identify which probe failed or its compiler cause. This is a disclosed interpretation/deviation from ambiguous frozen native-error wording, not unchanged zero-error-log admission.'},
                   'sdkRouteMs': [{'armId': arm, **distribution([next(a['searchMs'] for a in r['arms'] if a['armId'] == arm) for r in capture['rows']])} for arm in arms],
                   'qualification': 'Native QMD inference plus actual SDK route; authenticated historical semantic results are replayed, so this excludes live semantic inference latency.'},
        'costs': {'physicalCalls': len(stored), 'exposureMicros': exposure, 'confirmedMicros': confirmed,
                  'unresolvedMicros': exposure - confirmed, 'campaignCapMicros': campaign['additionalBudgetMicros'],
                  'priorTaskMicros': 12876502, 'priorAdditionalExposureMicros': prior_additional,
                  'additionalExposureMicros': prior_additional + exposure,
                  'totalTaskExposureMicros': 12876502 + prior_additional + exposure,
                  'remainingAdditionalMicros': 25000000 - prior_additional - exposure,
                  'qualification': 'Current exposure independently reconciled to immutable SQLite. Cumulative exposure and fixed campaign allocation are authenticated against the root dispatch and task-budget receipts; the prior sibling ledger is separately audited in its own report.'},
        'usage': {**dict(usage_total), 'modelIdentities': [{'identity': json.loads(k), 'calls': n} for k, n in sorted(identities.items())]},
        'decision': {'primary': prepared['comparison'] == 'semantic', 'conditions': conditions,
                     'passesPrimaryDevelopmentGate': all(conditions.values()) if prepared['comparison'] == 'semantic' else None,
                     'passesLiteralZeroNativeErrorLogAdmission': False,
                     'qualification': 'The original numerical quality thresholds are evaluated under the recorded pre-paid native-initialization interpretation. It is not unchanged zero-error-log admission. Secondary comparison is descriptive and cannot rescue a failed primary.'},
        'qualifications': ['Two previously exposed development personas. No clean holdout or external framework comparison.',
                           'Default production SDK uses recordDocument; whole original traces go to the unchanged reader.',
                           'Gateway GPT-4o mini alias, temperature 0.1, 512 output tokens, exact option-ID scoring; no model judge.',
                           'Ordinary hybrid differs in lexical query normalization; it is not a same-pool reranker ablation.',
                           'All planned cells stay in denominators; failed, unresolved and unattempted cells score zero.',
                           'Before paid calls, one handled initialization capability-probe error was classified separately from reranker execution and cleanup failures. Original protocol and stderr are preserved; literal zero-native-error-log admission would fail.',
                           'No SOTA, general population or Letta/Supermemory/Mem0 superiority claim.']}
    # No data-dependent fields enter the report except aggregate numbers, closed
    # model identity values and hashes. Never serialize private observations.
    encoded = canonical(report)
    need(not any(person in encoded for person in PEOPLE) and '/Users/' not in encoded, 'aggregate output privacy')
    return report


def self_test():
    need(pct([5, 1, 3, 2, 4], .5) == 3 and pct([5, 1, 3, 2, 4], .95) == 5, 'quantile self-test')
    fixture = {'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': ' A\n'}}]}
    need(native_status(fixture) == ('completed', 'A'), 'completed self-test')
    fixture['choices'][0]['finish_reason'] = 'length'
    need(native_status(fixture) == ('truncated', None), 'truncated failure self-test')
    fixture['choices'][0]['finish_reason'] = 'stop'
    fixture['choices'][0]['message']['tool_calls'] = []
    need(native_status(fixture) == ('failed', None), 'unexpected tool self-test')
    p = paired_summary([{'baseline': 0, 'candidate': 1}, {'baseline': 1, 'candidate': 0}, {'baseline': .5, 'candidate': .5}])
    need(p['delta'] == 0 and p['wins'] == p['losses'] == p['ties'] == 1, 'paired arithmetic self-test')
    pairs = [{'person': person, 'baseline': 0, 'candidate': 1} for person in PEOPLE]
    ci = descriptive_uncertainty(pairs, '0' * 64)
    need(ci['lower95'] == ci['upper95'] == 1, 'paired bootstrap self-test')
    print('SDK independent audit self-test: passed; no dataset, scorer, native runtime or provider files opened.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--manifest')
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.self_test:
        need(not args.manifest and not args.output, 'self-test only')
        return self_test()
    need(args.manifest and args.manifest_sha256 and args.output, 'explicit pinned manifest and new output required')
    manifest = read_pin({'path': str(pathlib.Path(args.manifest).absolute()), 'sha256': args.manifest_sha256}, 64 * 1024, True)
    report = audit(manifest)
    raw = (canonical(report) + '\n').encode()
    need(len(raw) <= 512 * 1024, 'report bound')
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({'reportSha256': sha(raw), 'comparison': report['comparison'],
                      'matrixComplete': report['matrixComplete'], 'readerDelta': report['reader']['pairedQuestions']['delta'],
                      'exposureMicros': report['costs']['exposureMicros'], 'providerCallsMadeByAudit': 0}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        # Avoid printing raw provider content or private path-bearing tracebacks.
        message = str(error) if isinstance(error, ValueError) and str(error).startswith('SDK independent audit:') else type(error).__name__
        print(message, file=sys.stderr)
        sys.exit(1)
