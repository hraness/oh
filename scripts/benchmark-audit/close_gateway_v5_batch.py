#!/usr/bin/env python3
"""Tracked port of the accepted v5 closure helper. Retain original pinned evidence.

One read-only process inventory; no model/auditor launch or study write.
"""
import argparse
import pathlib
import subprocess
import json
import hashlib
import datetime
import os
import sys
from gateway_context import load_context, verify_context, validate_study_binding

PREPARATION_SHA256 = "ea13440e8c405e288c1e7bfaea7a0c1d78aba755cf6e1dcbfa42601db1c03e71"


OLD_LEDGER_HASHES = {
    'gateway-study-v3': '7f3830a8b69276f22614b896b01bd3534fc76ef6669b293de4e0b3ac3ec97996',
    'gateway-study-v4': '426f0ab07b34613a7265f1ef600bdc477cd169f23b92e5941108cc0142e1415b',
    'api': 'c972b7e8643db61aa5a3d2b50df9aa095834be1f5b43ec680aacf5d0507f559b',
}


def close_batch(context, number):
    if not __debug__:
        raise RuntimeError("Python optimization disables custody assertions")
    verify_context(context)
    w = context.work
    assert type(number) is int and 1 <= number <= 64
    study=context.study;job=w/f'gateway-study-v5-batch-{number:03}'
    assert hashlib.sha256((w/'gateway-v5-runtime-preparation.json').read_bytes()).hexdigest()==PREPARATION_SHA256
    prepared=json.loads((w/'gateway-v5-runtime-preparation.json').read_bytes());expected_freeze=prepared['result']['freezeSha256'];expected_source=prepared['sourceSha256']
    def pin(p):return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    def write(p,d):
     raw=(json.dumps(d,indent=2)+'\n').encode();fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
     with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
     return pin(p)
    freeze=pin(study/'freeze.json');assert freeze['sha256']==expected_freeze
    validate_study_binding(context, freeze)
    s=json.loads((job/'status.json').read_bytes());assert s['state']=='exited' and s['groupGone'] and s['exitCode']==0,s
    proc=subprocess.run([str(context.ps),'-axo','pid=,pgid='],capture_output=True,text=True,check=True)
    rows=[tuple(map(int,line.split())) for line in proc.stdout.splitlines()];assert not [r for r in rows if r[0] in [s['supervisorPid'],s['childPid']] or r[1]==s['childPgid']]
    config=pin(job/'config.json');assert config['sha256']==s['configSha256'];c=json.loads((job/'config.json').read_bytes());max_calls=int(c['argv'][-1]);freeze=pin(study/'freeze.json');assert freeze['sha256']==expected_freeze
    assert set(c)=={'argv','cwd','jobDir','requireAbsent'} and 1<=max_calls<=256
    runtime=context.runtime;expected_argv=[str(context.vercel),'env','run','--project',context.project,'--scope',context.scope,'--environment','development','--',str(context.bun),str(runtime/'scripts/benchmarks/gateway-study-v5.ts'),'run','--directory',str(study),'--freeze-sha256',freeze['sha256'],'--max-new-calls',str(max_calls)]
    assert c['argv']==expected_argv and c['cwd']==str(runtime) and c['jobDir']==str(job)
    assert config['path']==str(job/'config.json') and hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':')).encode()).hexdigest()==config['sha256']
    assert s['commandSha256']==hashlib.sha256(json.dumps(expected_argv,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assert len(c['requireAbsent'])==len(set(c['requireAbsent'])) and set(c['requireAbsent'])==set(map(str,context.locks))
    assert s['childPid']==s['childPgid'] and s['childPid']>0 and s['supervisorPid']>0 and s['supervisorPid']!=s['childPid']
    starts=sorted(study.glob('batch-*-started.json'));assert len(starts)==number
    pairs=[]
    for p in starts:
     a=json.loads(p.read_bytes());bpath=study/f"batch-{a['runId']}.json";assert bpath.exists();b=json.loads(bpath.read_bytes());pairs.append((a,b,p,bpath))
    pairs.sort(key=lambda pair:pair[0]['start']);a,b,ap,bp=pairs[-1]
    for admitted,closed,admitted_path,closed_path in pairs:
     assert admitted['protocol']=='oh.memory-gateway-batch-admission.v5' and closed['protocol']=='oh.memory-gateway-batch.v5'
     assert admitted['runId']==closed['runId'] and admitted_path.name==f"batch-{admitted['runId']}-started.json" and closed_path.name==f"batch-{admitted['runId']}.json"
     for key in ['runId','start','sourceSha256','freezeSha256','importedStudySha256','priorGatewayStudySha256','priorContinuationStudySha256','maximumNewCalls','concurrency']:
      assert admitted[key]==closed[key]
     assert closed['sourceSha256']==expected_source and closed['freezeSha256']==freeze['sha256'] and closed['importedStudySha256']=='737cc332334d684c81bba60f7c47fc38caefd8739817983a4655e84d1cfa65c4'
     assert type(closed['newTransportInvocations']) is int and 0<=closed['newTransportInvocations']<=closed['maximumNewCalls']<=256
     assert closed['concurrency']==4 and len(closed['admittedKeys'])==closed['newTransportInvocations']
     assert len(set(closed['admittedKeys']))==len(closed['admittedKeys']) and not set(closed['initialJobKeys'])&set(closed['admittedKeys'])
     assert sorted(closed['initialJobKeys']+closed['admittedKeys'])==closed['finalJobKeys'] and len(set(closed['finalJobKeys']))==len(closed['finalJobKeys'])
     assert closed['admission']==pin(admitted_path) and closed['failed']==False and closed['interrupted']==False
     assert all(closed[k] for k in ['storeClosed','sourceVerifiedAtClose','importVerifiedAtClose','originalLedgerVerifiedAtClose','priorGatewayVerifiedAtClose','priorContinuationVerifiedAtClose'])

    assert b['newTransportInvocations']<=max_calls and b['maximumNewCalls']==max_calls and b['failed']==False and b['interrupted']==False
    assert all(b[k] for k in ['storeClosed','sourceVerifiedAtClose','importVerifiedAtClose','originalLedgerVerifiedAtClose','priorGatewayVerifiedAtClose','priorContinuationVerifiedAtClose'])
    assert b['admission']==pin(ap) and b['freezeSha256']==freeze['sha256'] and b['sourceSha256']==expected_source
    assert b['priorGatewayStudySha256']=='e7657389e60a7136694a609cbe6db19cc1f5db84d2136ab84d0d41f78644a589'
    assert b['priorContinuationStudySha256']=='a34af0222ca0857956b7cc42efeb5261a68b1b0a57826c0cfbfe3fdfad630939'
    assert a['priorGatewayExposureMicros']==809209 and a['priorGatewayStudySha256']==b['priorGatewayStudySha256']
    timestamp=lambda x:datetime.datetime.fromisoformat(x.replace('Z','+00:00'))
    assert timestamp(s['startedAt'])<=timestamp(a['start'])<=timestamp(b['end']) and timestamp(b['end'])<=timestamp(s['finishedAt'])+datetime.timedelta(seconds=1)
    assert not (study/'active.lock').exists()
    files=[]
    for p in sorted(study.rglob('*')):
     st=p.lstat();assert not p.is_symlink() and st.st_uid==os.getuid()
     if p.is_file():assert st.st_nlink==1 and st.st_mode&0o777==0o600;files.append({'path':str(p.relative_to(study)),'bytes':st.st_size,'sha256':pin(p)['sha256']})
     else:assert p.is_dir() and st.st_mode&0o777==0o700
    keys=sorted(p.name for p in (study/'jobs').iterdir());assert keys==b['finalJobKeys']
    for k in keys:assert sorted(p.name for p in (study/'jobs'/k).iterdir())==['pending.json','reserved.json','response.body','response.json','result.json','settled.json']
    ledger_raw=(study/'ledger.jsonl').read_bytes();assert b['ledger']['sha256']==hashlib.sha256(ledger_raw).hexdigest() and b['ledger']['bytes']==len(ledger_raw)
    assert ledger_raw.endswith(b'\n');events=[json.loads(line) for line in ledger_raw.splitlines()];pending={};seen=set();settled=set();exposure=0
    for e in events:
     assert set(e)=={'v','id','kind','micros'} and e['v']==1 and type(e['micros']) is int and e['micros']>=0
     if e['kind']=='reserved':assert e['id'] not in seen;seen.add(e['id']);pending[e['id']]=e['micros'];exposure+=e['micros']
     else:
      assert e['kind']=='settled' and e['id'] in pending and e['id'] not in settled and e['micros']<=pending[e['id']];exposure-=pending.pop(e['id'])-e['micros'];settled.add(e['id'])
     assert exposure+809209<=40000000
    assert not pending and sorted(seen)==keys and seen==settled and b['ledger']['exposureMicros']==exposure and b['ledger']['totalAmendmentExposureMicros']==exposure+809209 and b['ledger']['priorGatewayExposureMicros']==809209
    for prior in [w/'gateway-study-v3/ledger.jsonl',w/'gateway-study-v4/ledger.jsonl',context.repository/'.cache/benchmarks/openai-pilot-budget.jsonl']:
     expected=OLD_LEDGER_HASHES.get(prior.parent.name, OLD_LEDGER_HASHES['api'])
     assert pin(prior)['sha256']==expected
    if number>1:
     prev_path=w/f'gateway-v5-batch-{number-1:03}-closed-inventory.json'
     previous_acceptance=json.loads((w/f'gateway-v5-batch-{number-1:03}-acceptance.json').read_bytes())
     assert previous_acceptance['schema']=='oh.gateway-v5-batch-acceptance.v1' and previous_acceptance['number']==number-1 and previous_acceptance['inventory']==pin(prev_path)
     prev=json.loads(prev_path.read_bytes());assert set(prev)=={'schema','freezeSha256','files'} and prev['schema']=='oh.gateway-final-inventory.v5' and prev['freezeSha256']==freeze['sha256'] and len(prev['files'])>4
     index={x['path']:x for x in files}
     for f in prev['files']:
      if f['path']=='ledger.jsonl':assert hashlib.sha256(ledger_raw[:f['bytes']]).hexdigest()==f['sha256']
      else:assert index[f['path']]==f
    verify_context(context)
    validate_study_binding(context, freeze)
    inv=write(w/f'gateway-v5-batch-{number:03}-closed-inventory.json',{'schema':'oh.gateway-final-inventory.v5','freezeSha256':freeze['sha256'],'files':files})
    receipt=write(w/f'gateway-v5-batch-{number:03}-acceptance.json',{'schema':'oh.gateway-v5-batch-acceptance.v1','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'number':number,'runId':a['runId'],'admission':pin(ap),'closure':pin(bp),'configuration':config,'supervisorStatus':pin(job/'status.json'),'groupGone':True,'freshOsProcessMatches':0,'newTransportInvocations':b['newTransportInvocations'],'totalNewJobCount':len(keys),'result':b['result'],'ledgerExposureMicros':exposure,'priorGatewayExposureMicros':809209,'totalAmendmentExposureMicros':exposure+809209,'inventory':inv,'allOriginalLedgersUnchanged':True,'priorInventoryUnchanged':True,'correctnessInspected':False,'modelCallsByVerifier':0})
    return {'receipt':receipt,'newCalls':b['newTransportInvocations'],'totalNewJobs':len(keys),'result':b['result'],'totalAmendmentExposureUsd':(exposure+809209)/1e6,'inventory':inv}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True, help='Absolute machine context JSON; retain frozen recorded paths.')
    parser.add_argument('--batch', type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(close_batch(load_context(args.context), args.batch)))
    except Exception:
        print(json.dumps({'schema': 'oh.gateway-v5-batch-acceptance.v1', 'status': 'rejected', 'reason': 'custody-or-io-rejection', 'modelCalls': 0, 'studyWrites': 0}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
