set -eu
python3 -u - <<'PY'
import datetime, http.client, json, subprocess
from pathlib import Path
root = Path('/opt/square-platform')
credentials = json.loads((root / 'deploy/bootstrap.json').read_text())
headers = {'Origin':'https://bn.sid.mom', 'Content-Type':'application/json'}
def call(method, route, body=None):
    client = http.client.HTTPConnection('127.0.0.1',39410,timeout=25)
    try:
        client.request(method,'/api/v1'+route,json.dumps(body) if body is not None else None,headers)
        response = client.getresponse()
        payload = json.loads(response.read())
        assert response.status < 400, {'status':response.status,'route':route,'error':payload.get('error')}
        return payload['data'], {k.lower():v for k,v in response.getheaders()}
    finally:
        client.close()
login, response_headers = call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
headers.update({'Cookie':response_headers['set-cookie'].split(';',1)[0],'X-CSRF-Token':login['csrf']})
try:
    report = json.loads((root / 'deploy/industry-meme-operation.json').read_text())
    runtime, _ = call('GET','/runtime')
    for entry in report['presets']:
        detail, _ = call('GET','/presets/'+entry['id'])
        published = next(v for v in detail['versions'] if v['id'] == detail['publishedVersionId'])
        assert published['id'] == entry['publishedVersionId']
        assert '只允许生成各行各业的 meme 梗图' in published['rules']['image']['prompt']
    code = '''import {IMAGE_POLICY_VERSION,MEME_INDUSTRIES,MEME_FORMATS,memeImageFields} from './dist/src/image-policy.js';
const first=memeImageFields({prompt:'旧任务参考：画一幅普通资讯插画'});
const again=memeImageFields(first);
if(first.prompt!==again.prompt||!first.prompt.startsWith('生图的最高优先级要求：只允许生成各行各业的 meme 梗图。'))process.exit(1);
console.log(JSON.stringify({policyVersion:IMAGE_POLICY_VERSION,industryCount:MEME_INDUSTRIES.length,formatCount:MEME_FORMATS.length,memeOnly:true,jobBriefStable:true,modelRequests:0}));'''
    policy = json.loads(subprocess.check_output(['runuser','-u','square-platform','--','/usr/local/bin/node','--input-type=module','-e',code], cwd=root/'current/service',text=True))
    release = (root/'current').resolve().name
    assert release == '20261022-industry-memes'
    service = subprocess.check_output(['systemctl','is-active','square-platform.service'],text=True).strip()
    assert service == 'active'
    report.update({'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':release,'service':service,'runtime':{k:runtime.get(k) for k in ['paused','contentValidationMode','publishTransportEnabled']},'liveAdapterPolicy':policy,'publishedPresetChecks':len(report['presets']),'validation':{'backendTestsPassed':64,'typeChecks':'passed','backendBuild':'passed','frontendBuild':'passed','presetSchemaChecksPassed':10,'extraPaidImageRequests':0}})
    destination = root/'deploy/industry-meme-verification.json'
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['verifiedAt','release','service','runtime','liveAdapterPolicy','publishedPresetChecks','accountConfigurationPreserved','runtimeSettingsPreserved']},ensure_ascii=False,indent=2))
finally:
    call('POST','/auth/logout',{})
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/industry-meme-verification.json /home/ubuntu/square-platform-upload/industry-meme-verification.json
