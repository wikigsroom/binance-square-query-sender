set -eu
python3 -u - <<'PY'
import http.client, json
from pathlib import Path
credentials=json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
def call(method,path,body=None,headers=None):
    client=http.client.HTTPConnection('127.0.0.1',39410,timeout=20)
    client.request(method,'/api/v1'+path,json.dumps(body) if body is not None else None,{'Origin':'https://bn.sid.mom','Content-Type':'application/json'}|(headers or {}))
    response=client.getresponse(); result=(response.status,dict(response.getheaders()),json.loads(response.read()));client.close();return result
login=call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
assert login[0]==200, 'Login failed'
headers={'Cookie':login[1]['set-cookie'].split(';',1)[0],'X-CSRF-Token':login[2]['data']['csrf']}
report={}
try:
    for name,route,fields in [
        ('models','/models?limit=100',['id','name','type','externalId','connectionId','family','enabled','approved','allowedParameters','defaultParameters']),
        ('connections','/model-connections?limit=100',['id','name','enabled','protocol','baseUrl','credentialHealth']),
        ('sources','/data-sources?limit=100',['id','name','type','enabled','maxAgeSeconds']),
        ('presets','/presets?limit=100',['id','name','enabled','version','publishedVersionId','publishedNumber']),
        ('assets','/assets?limit=100',['id','collection','style','aspectRatio','enabled']),
        ('accounts','/accounts?limit=100',['id','name','status']),
    ]:
        response=call('GET',route,headers=headers)
        assert response[0]==200, name+' read failed'
        report[name]=[{field:row.get(field) for field in fields} for row in response[2]['data']]
    response=call('GET','/ai/settings',headers=headers)
    assert response[0]==200
    report['aiSettings']=response[2]['data']
    response=call('GET','/runtime',headers=headers)
    report['globallyPaused']=response[2]['data']['paused']
    destination=Path('/opt/square-platform/deploy/preset-resources.json')
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False),flush=True)
finally:
    call('POST','/auth/logout',{},headers)
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/preset-resources.json /home/ubuntu/square-platform-upload/preset-resources.json
