set -eu
python3 -u - <<'PY'
import datetime, hashlib, http.client, json, os, pwd, subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

# Explicit deployment acceptance operation: at most two idempotent preview jobs.
# Uses the configured real text/image models; preview jobs cannot publish posts.
root=Path('/opt/square-platform')
assert (root/'current').resolve().name=='20261023-article-body-guard'
credentials=json.loads((root/'deploy/bootstrap.json').read_text())
headers={'Origin':'https://bn.sid.mom','Content-Type':'application/json'}
path=root/'deploy/article-body-live-previews.json'
report=json.loads(path.read_text()) if path.exists() else {'verificationId':'article-body-guard-20261023','previews':[]}
plan=['Meme 整活｜狗狗与青蛙','GameFi 与应用｜先好玩再谈代币']

def save():
    temporary=path.with_suffix('.next')
    temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(path)

def call(method,route,body=None,idempotency=None):
    request_headers=dict(headers)
    if idempotency:request_headers['Idempotency-Key']=idempotency
    client=http.client.HTTPConnection('127.0.0.1',39410,timeout=30)
    try:
        client.request(method,'/api/v1'+route,json.dumps(body,ensure_ascii=False).encode() if body is not None else None,request_headers)
        response=client.getresponse();payload=json.loads(response.read());response_headers=dict(response.getheaders())
        assert response.status<400, f"HTTP {response.status}: {payload.get('error',{}).get('code','')} {payload.get('error',{}).get('message','')}"
        return payload['data'],response_headers
    finally:client.close()

logged_in=False
try:
    login,response_headers=call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
    headers.update({'Cookie':response_headers['set-cookie'].split(';',1)[0],'X-CSRF-Token':login['csrf']});logged_in=True
    presets=call('GET','/presets?limit=100')[0]
    for index,name in enumerate(plan):
        item=next((entry for entry in report['previews'] if entry['presetName']==name),None)
        if item is None:
            preset=next(preset for preset in presets if preset['name']==name)
            job,_=call('POST',f"/presets/{preset['id']}/preview",{'includeImageGeneration':True},f"{report['verificationId']}:preview:{index}")
            item={'presetName':name,'presetId':preset['id'],'jobId':job['id']}
            report['previews'].append(item);save()
        detail=call('GET',f"/publication-jobs/{item['jobId']}")[0]
        assert detail['kind']=='preview' and not detail['attempts'], 'Preview created a submission intent'
        item.update({'state':detail['state'],'publishAttempts':len(detail['attempts'])})
        item['validationAttempts']=[{'passed':entry['passed'],'errorCodes':[error['code'] for error in entry.get('errors',[])],'articlePolicyVersion':entry.get('articlePolicyVersion')} for entry in detail['validationHistory']]
        if detail.get('content'):
            content=detail['content'];text=content['text']
            runs=[run for run in detail['generationRuns'] if run['type']=='text']
            matched=next(run for run in runs if run['id']==content['generationRunId'])
            payload=json.loads(next(message['content'] for message in matched['messages'] if message['role']=='user'))
            assert matched['promptVersion']=='square-author/1.4.0' and matched['requestedModel']=='gpt-6-luna'
            assert 'image' not in payload['rules']
            assert json.loads(matched['output'])['text'].replace('\r\n','\n').replace('\r','\n')==text
            assert hashlib.sha256(text.encode()).hexdigest()==content['contentHash']
            item.update({'model':matched['requestedModel'],'promptVersion':matched['promptVersion'],'text':text,'characterCount':len(text),'contentHash':content['contentHash'],'matchesAi':True,'receivesImageRules':False,'authorCalls':len(runs),'validationPassed':(detail.get('validation') or {}).get('passed'),'articlePolicyVersion':(detail.get('validation') or {}).get('articlePolicyVersion')})
        if detail['state'] in ['failed','blocked','cancelled','submission_unknown']:
            item['error']=detail.get('error');save();raise RuntimeError(json.dumps(item['error'],ensure_ascii=False))
        if detail['state']!='preview_ready':break
        asset=detail['asset']
        assert asset and asset['provenance']['type']=='gpt_image_2' and asset['imagePolicy']['version']=='industry-meme-v1'
        item.update({'assetId':asset['id'],'imagePolicyVersion':asset['imagePolicy']['version'],'imageModelProvenance':'gpt_image_2'})
        assert item['validationPassed'] and item['articlePolicyVersion']=='article-body-v1'
    code="""import fs from 'node:fs';import {imageBriefInBody} from './dist/src/article-policy.js';const r=JSON.parse(fs.readFileSync(0,'utf8'));for(const p of r.previews){if(p.state==='preview_ready'&&imageBriefInBody(p.text))throw Error('An image script entered a live preview');}console.log('Article boundaries verified');"""
    subprocess.check_output(['runuser','-u','square-platform','--','/usr/local/bin/node','--input-type=module','-e',code],input=json.dumps(report),cwd=root/'current/service',text=True)
    report['checkedAt']=datetime.datetime.now(ZoneInfo('Asia/Taipei')).isoformat()
    report['status']='passed' if len(report['previews'])==len(plan) and all(item['state']=='preview_ready' for item in report['previews']) else 'running'
    report['realPublications']=0
    save()
    destination=Path('/home/ubuntu/square-platform-upload/article-body-live-previews.json')
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');destination.chmod(0o600)
    owner=pwd.getpwnam('ubuntu');os.chown(destination,owner.pw_uid,owner.pw_gid)
    print(json.dumps(report,ensure_ascii=False,indent=2))
finally:
    if logged_in:call('POST','/auth/logout',{})
PY
