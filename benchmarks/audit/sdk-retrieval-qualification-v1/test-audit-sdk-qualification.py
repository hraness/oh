"""Synthetic fixtures only. Never opens task datasets or real provider ledgers."""
import importlib.util
import json
import os
import pathlib
import sqlite3
import tempfile

PATH = pathlib.Path(__file__).with_name('audit-sdk-qualification.py')
spec = importlib.util.spec_from_file_location('auditor', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def fixture(root, unresolved=False):
    def write(name, value):
        p = root / name
        p.parent.mkdir(exist_ok=True, mode=0o700)
        raw = (mod.canonical(value) + '\n').encode()
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(raw)
        return {'path': str(p), 'sha256': mod.sha(raw)}
    arms = ['sdk-semantic', 'sdk-default-rerank']
    questions, ranks, gold, personas = [], [], [], []
    for person_index, count in enumerate([114, 32]):
        person = mod.PEOPLE[person_index]
        traces, queries, person_ranks = [], [], []
        for local in range(count):
            index = len(questions)
            qid = f'fixture-question-{index}'
            ids = [f'fixture-trace-{index}-{i}' for i in [0, 1]]
            contents = [f'Synthetic control trace {index}', f'Synthetic candidate trace {index}']
            traces += [{'id': tid, 'content': text, 'medium': 'fixture', 'date': '2025-01-01T00:00:00'} for tid, text in zip(ids, contents)]
            contexts = [f'---- idx 1 ----\n{contents[0]}', f'---- idx 1 ----\n{contents[1]}\n\n---- idx 2 ----\n{contents[0]}']
            question = {'id': qid, 'groupId': person, 'question': f'Synthetic fixture question {index}',
                        'questionDate': '2026-01-01T00:00:00', 'personName': 'Fixture person',
                        'choices': [{'id': 'A', 'text': 'Synthetic alpha'}, {'id': 'B', 'text': 'Synthetic beta'}],
                        'contexts': [{'armId': arm, 'text': context} for arm, context in zip(arms, contexts)]}
            questions.append(question)
            keys = [f'edition:trace-{2 * local + i:05}' for i in [0, 1]]
            documents = [f'# {key}\n\nkind: edition\n\n{mod.canonical(trace)}\n' for key, trace in zip(keys, traces[-2:])]
            queries.append({'id': qid, 'query': question['question'], 'semanticCapture': [{'key': keys[0]}]})
            rank = {'questionId': qid, 'personId': person, 'questionDate': question['questionDate'],
                          'querySha256': mod.sha(question['question']), 'defaultMode': 'rerank', 'diagnostics': [],
                          'pool': [{'key': key, 'documentSha256': mod.sha(doc), 'documentBytes': len(doc.encode())} for key, doc in zip(keys, documents)],
                          'nativeScores': [{'key': key, 'score': i, 'v': 1} for i, key in enumerate(keys)],
                          'rerankMs': index + 1, 'arms': [{'armId': arm, 'traceIds': tids, 'context': context,
                           'contextSha256': mod.sha(context), 'contextBytes': len(context.encode()), 'searchMs': index + 2}
                           for arm, tids, context in zip(arms, [[ids[0]], [ids[1], ids[0]]], contexts)]}
            ranks.append(rank)
            person_ranks.append(rank)
            gold.append({'questionId': qid, 'personId': person, 'correctChoiceId': 'A', 'evidenceGroups': [[ids[1]]]})
        for query in queries:
            query['eligibleTraceIds'] = [t['id'] for t in traces]
        for rank in person_ranks:
            rank['eligibleRecords'] = len(traces)
        personas.append({'memory': {'personId': person, 'traces': traces}, 'queries': queries})
    inputs_pin = write('inputs.json', {'personas': personas})
    protocol_pin = write('protocol.json', {'synthetic': True})
    freeze = {'codePins': [], 'protocolPin': protocol_pin, 'inputsPin': inputs_pin}
    freeze_pin = write('freeze.json', freeze)
    times = [r['rerankMs'] for r in ranks]
    capture = {'freezePin': freeze_pin, 'completed': 146, 'failed': 0, 'cleanupCompleted': True,
               'scoresComputed': False, 'providerCalls': 0, 'rows': ranks, 'nativeCalls': 146, 'elapsedMs': sum(times),
               'timings': {'p50Ms': mod.pct(times, .5), 'p95Ms': mod.pct(times, .95), 'warmP95Ms': mod.pct(times[1:], .95)},
               'totalPairs': 292, 'maximumPool': 2, 'maximumDocumentBytes': max(p['documentBytes'] for r in ranks for p in r['pool'])}
    capture_pin = write('capture.json', capture)
    stderr_sha = mod.sha('synthetic handled initialization diagnostic\n')
    owner_pin = write('owner.json', {'freezePin': freeze_pin, 'capturePin': capture_pin, 'exitCode': 0,
                  'ownedChildCollected': True, 'nativeCleanupWarnings': 0, 'nativeErrors': 0, 'deadlineSeconds': 3600,
                  'stderrSha256': stderr_sha})
    source_review_pin = write('metal-probe-source-review.md', {'synthetic': True})
    interpretation_pin = write('native-initialization-interpretation.json', {
        'protocol': 'oh.sdk-retrieval-native-interpretation.v1', 'kind': 'pre-paid-protocol-clarification',
        'recordedAt': '2026-09-23T00:00:00+00:00', 'originalProtocolPin': protocol_pin,
        'sourceReviewPin': source_review_pin, 'stderrSha256': stderr_sha, 'handledInitializationDiagnostics': 1,
        'decisionBeforePaid': True, 'decisionBeforeAnswerScoring': True,
        'nativeErrorsMeans': 'reranker-execution-or-cleanup-failures',
        'rerankerErrorsAllowed': 0, 'fallbackDiagnosticsAllowed': 0, 'cleanupWarningsAllowed': 0,
        'literalZeroErrorLogPolicyWouldFail': True, 'numericalQualityGatesChanged': False,
        'originalProtocolWordingClarified': True})
    source = {'arms': arms, 'questions': questions}
    source_pin = write('source.json', source)
    scorer_pin = write('scorer.json', {'sourceSha256': mod.sha(mod.canonical(source)), 'rows': gold})
    store = root / 'store'
    store.mkdir(mode=0o700)
    campaign = {'campaignId': 'oh-sdk-retrieval-semantic-20260923-v1', 'additionalBudgetMicros': 12500000,
                'maximumCalls': 876, 'storeDirectory': str(store), 'historicalExposureMicros': 123456789}
    campaign_pin = write('campaign.json', campaign)
    budget_pin = write('task-budget.json', {'protocol': 'oh.sdk-retrieval-task-allocation.v1', 'additionalBudgetMicros': 25000000,
        'priorTaskExposureMicros': 12876502, 'priorGlobalExposureMicros': 261835515,
        'selectedComparisons': ['semantic', 'hybrid'], 'selectionBeforeAnswerScoring': True, 'maximumPhysicalCalls': 1752,
        'campaigns': [{'comparison': 'semantic', **campaign_pin, 'maximumAdditionalMicros': 12500000},
                      {'comparison': 'hybrid', 'path': str(root/'unused-hybrid.json'), 'sha256': '0'*64, 'maximumAdditionalMicros': 12500000}]})
    prompt_pin = write('prompt.json', {'synthetic': True})
    jobs, cases, envelopes, responses, outcomes = [], [], [], [], []
    for qindex, question in enumerate(questions):
        for repeat in [0, 1, 2]:
            for armindex, arm in enumerate(arms):
                context = question['contexts'][armindex]['text']
                request = {'profileId': 'gpt4o-mini-clonemem-choice-v1-reader', 'profileSha256': 'a' * 64,
                           'body': {'model': 'openai/gpt-4o-mini', 'temperature': .1, 'max_tokens': 512,
                                    'stream': False, 'store': False, 'messages': mod.messages(question, context)},
                           'reservationMicros': 25, 'inputUpperBound': 100, 'maxOutputTokens': 512}
                request['requestSha256'] = mod.sha(mod.canonical(request))
                key = request['requestSha256'] + ':' + str(repeat)
                jobs.append({'key': key, 'repeat': repeat, 'request': request})
                cases.append({'questionId': question['id'], 'groupId': question['groupId'], 'armId': arm,
                              'repeat': repeat, 'contextSha256': mod.sha(context), 'jobKey': key})
                answer = 'A' if qindex % (3 if armindex == 0 else 2) == 0 else 'B'
                identity = {'requestedModel': 'openai/gpt-4o-mini', 'reportedModel': 'gpt-4o-mini',
                            'finalProvider': 'openai', 'snapshotPinned': False, 'qualification': 'gateway-alias',
                            'resolvedProviderApiModelId': None}
                envelope = {'model': 'gpt-4o-mini', 'choices': [{'index': 0, 'finish_reason': 'stop',
                            'message': {'role': 'assistant', 'content': answer}}],
                            'usage': {'prompt_tokens': 10, 'completion_tokens': 1, 'total_tokens': 11},
                            'providerMetadata': {'gateway': {'routing': {'finalProvider': 'openai',
                                'originalModelId': 'openai/gpt-4o-mini', 'canonicalSlug': 'openai/gpt-4o-mini'}}}}
                raw = mod.canonical(envelope).encode()
                response = {'status': 'completed', 'answer': answer, 'rawSha256': mod.sha(raw),
                            'requestSha256': request['requestSha256'], 'profileSha256': request['profileSha256'],
                            'usage': {'inputTokens': 10, 'cachedInputTokens': 0, 'outputTokens': 1, 'reasoningTokens': 0,
                                      'tokenRateMicros': 3, 'gatewayReportedMicros': None, 'micros': 3}, 'identity': identity}
                envelopes.append(raw)
                responses.append(response)
                outcomes.append({'jobKey': key, 'disposition': 'completed', 'answerSha256': mod.sha(answer),
                                 'rawSha256': mod.sha(raw), 'chargeMicros': 3, 'serviceMs': 1})
    plan = {'arms': arms, 'repeats': 3, 'jobs': jobs, 'cases': cases, 'sourcePin': source_pin,
            'scorerPin': scorer_pin, 'campaignPin': campaign_pin, 'promptPin': prompt_pin,
            'sourceSha256': mod.sha(mod.canonical(source)), 'campaignSha256': mod.sha(mod.canonical(campaign)),
            'maximumPhysicalCalls': 876, 'maximumReservationMicros': 876 * 25}
    plan_pin = write('plan.json', plan)
    launch = {'planPin': plan_pin, 'sourcePin': source_pin, 'scorerPin': scorer_pin, 'campaignPin': campaign_pin,
              'promptPin': prompt_pin, 'approved': True, 'scope': 'reader-only', 'maximumNewSpendMicros': 12500000,
              'maximumPhysicalCalls': 876, 'checkpoint': '0' * 40}
    launch_pin = write('launch.json', launch)
    database = store / 'campaign.sqlite'
    conn = sqlite3.connect(database)
    conn.executescript('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE jobs(key TEXT PRIMARY KEY,repeat INTEGER,request TEXT,reservation INTEGER,charge INTEGER,status TEXT,raw BLOB,raw_sha TEXT,raw_meta TEXT,result TEXT);')
    conn.execute('insert into metadata values (?,?)', ('identity', mod.sha(mod.canonical({'protocol': 'oh.memory.evolution-store.v1', 'campaign': campaign}))))
    for index, (job, raw, response) in enumerate(zip(jobs, envelopes, responses)):
        key = mod.sha(mod.canonical({'campaignId': campaign['campaignId'], 'profileSha256': job['request']['profileSha256'],
                                     'requestSha256': job['request']['requestSha256'], 'repeat': job['repeat']}))
        bad = unresolved and index == 0
        overflow = unresolved == 'response-bound' and bad
        if overflow:
            raw = b'x' * (2 * 1024 * 1024)
        conn.execute('insert into jobs values (?,?,?,?,?,?,?,?,?,?)', (key, job['repeat'], mod.canonical(job['request']), 25,
            25 if bad else 3, 'captured' if bad else 'settled', raw, mod.sha(raw),
            mod.canonical({'receivedBytes': len(raw) + (2048 if overflow else 0), 'serviceMs': 1,
                           'complete': not overflow, 'httpStatus': 200, 'error': 'response-bound' if overflow else None}),
            None if bad else mod.canonical(response)))
        if bad:
            outcomes[index].update(disposition='unresolved', answerSha256=None, rawSha256=None, chargeMicros=25)
    conn.commit()
    conn.close()
    os.chmod(database, 0o600)
    exposure = 876 * 3 + (22 if unresolved else 0)
    confirmed = (875 if unresolved else 876) * 3
    result = {'outcomes': outcomes, 'planSha256': mod.sha(mod.canonical(plan)), 'halt': 'reader-failure' if unresolved else 'none',
              'ledger': {'calls': 876, 'exposureMicros': exposure, 'confirmedMicros': confirmed,
                'unresolvedMicros': exposure - confirmed, 'additionalBudgetMicros': 12500000, 'maximumCalls': 876,
                'historicalExposureMicros': campaign['historicalExposureMicros'],
                'combinedExposureMicros': campaign['historicalExposureMicros'] + exposure}}
    result_pin = write('result.json', result)
    prepared = {'protocol': 'oh.sdk-retrieval-qualification-paid-prepared.v1', 'scoresComputed': False,
                'freezePin': freeze_pin, 'capturePin': capture_pin, 'ownerPin': owner_pin, 'sourcePin': source_pin,
                'scorerPin': scorer_pin, 'planPin': plan_pin, 'campaignPin': campaign_pin, 'promptPin': prompt_pin,
                'comparison': 'semantic', 'codePins': [], 'protocolPin': protocol_pin}
    prepared_pin = write('prepared.json', prepared)
    database_pin = {'path': str(database), 'sha256': mod.digest(database)}
    review_pin = write('review.json', {'approved': True, 'nativeInterpretationPin': interpretation_pin})
    packet_pin = write('packet.json', {'protocol': 'oh.sdk-retrieval-paid-launch-packet.v1', 'taskAllocationPin': budget_pin,
        'nativeInterpretationPin': interpretation_pin, 'reviewPin': review_pin,
        'checkpoint': launch['checkpoint'], 'comparisons': [{'comparison': 'semantic', 'preparedPin': prepared_pin, 'launchPin': launch_pin}]})
    intent_pin = write('intent.json', {'packetPin': packet_pin, 'startedAt': '2026-09-23T00:01:00+00:00'})
    dispatch_pin = write('dispatch.outcome.json', {'protocol': 'oh.sdk-retrieval-paid-dispatch-outcome.v1', 'comparison': 'semantic',
        'packetPin': packet_pin, 'intentPin': intent_pin, 'codeFrozen': True, 'accountingVerified': True, 'storeClosed': True,
        'withinTaskBudget': True, 'qualityScoresComputed': False, 'additionalTaskExposureMicros': exposure,
        'additionalTaskCalls': 876, 'priorTaskExposureMicros': 12876502, 'totalTaskExposureMicros': 12876502 + exposure,
        'priorGlobalExposureMicros': 261835515, 'totalGlobalExposureMicros': 261835515 + exposure,
        'accounting': {'databasePin': database_pin, 'calls': 876, 'exposureMicros': exposure,
                       'confirmedMicros': confirmed, 'unresolvedMicros': exposure - confirmed, 'storeClosed': True}})
    return {'protocol': 'oh.sdk-retrieval-independent-audit-input.v1', 'preparedPin': prepared_pin,
            'launchPin': launch_pin, 'resultPin': result_pin, 'databasePin': database_pin,
            'taskBudgetPin': budget_pin, 'dispatchOutcomePin': dispatch_pin, 'priorAdditionalExposureMicros': 0}


with tempfile.TemporaryDirectory(prefix='oh-sdk-audit-synthetic-') as temp:
    root = pathlib.Path(temp).resolve()
    for incomplete in [False, True, 'response-bound']:
        case_root = root / str(incomplete)
        case_root.mkdir(mode=0o700)
        manifest = fixture(case_root, incomplete)
        report = mod.audit(manifest)
        assert report['databaseUnchanged'] is True
        assert report['matrixComplete'] is not bool(incomplete)
        assert report['failedLogicalCases'] == int(bool(incomplete))
        assert report['reader']['arms'][0]['cases'] == report['reader']['arms'][1]['cases'] == 438
        assert report['reader']['arms'][0]['correct'] == 147 - int(bool(incomplete))
        assert report['reader']['arms'][1]['correct'] == 219
        assert report['costs']['exposureMicros'] == 2628 + (22 if incomplete else 0)
        assert report['decision']['passesPrimaryDevelopmentGate'] is not bool(incomplete)
        assert report['retrieval']['pairedQuestions']['delta'] == 1
        assert report['native']['initializationInterpretation']['handledCapabilityProbeFailures'] == 1
        assert report['decision']['passesLiteralZeroNativeErrorLogAdmission'] is False
        # Pin mismatch must fail before opening mutable DB bytes for use.
        bad_manifest = dict(manifest, databasePin=dict(manifest['databasePin'], sha256='f' * 64))
        try:
            mod.audit(bad_manifest)
            raise AssertionError('accepted wrong database pin')
        except ValueError as error:
            assert str(error) == 'SDK independent audit: immutable dispatch closure'
        try:
            mod.audit(dict(manifest, priorAdditionalExposureMicros=1))
            raise AssertionError('accepted invented prior exposure')
        except ValueError as error:
            assert str(error) == 'SDK independent audit: caller prior exposure differs from dispatch receipt'
        prepared = mod.read_pin(manifest['preparedPin'])
        frozen = mod.read_pin(prepared['freezePin'])
        owner = mod.read_pin(prepared['ownerPin'])
        dispatch = mod.read_pin(manifest['dispatchOutcomePin'])
        packet = mod.read_pin(dispatch['packetPin'])
        try:
            mod.authenticate_native_interpretation(packet, prepared, frozen, dict(owner, stderrSha256='f'*64), dispatch)
            raise AssertionError('accepted mismatched native stderr')
        except ValueError as error:
            assert str(error) == 'SDK independent audit: explicit pre-paid initialization interpretation'
    print('Synthetic SDK audit fixtures: full 876-cell matrix, unresolved/2-MiB response-bound zero/failure gate, exact costs/recall, native interpretation binding and wrong-pin rejection passed. No real inputs opened.')
