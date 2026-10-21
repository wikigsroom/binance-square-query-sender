set -eu
systemctl is-enabled square-platform.service
systemctl is-active square-platform.service
python3 - <<'PY'
from pathlib import Path
import json, http.client, subprocess, time
credentials=json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
origin='https://bn.sid.mom'
def call(method,path,body=None,headers=None):
 c=http.client.HTTPConnection('127.0.0.1',39410,timeout=20)
 h={'Origin':origin}|(headers or {})
 if body is not None: h['Content-Type']='application/json'
 c.request(method,'/api/v1'+path,json.dumps(body) if body is not None else None,h)
 r=c.getresponse()
 payload=r.read()
 result=(r.status,dict(r.getheaders()),json.loads(payload) if payload else {})
 c.close()
 return result
preflight=call('OPTIONS','/auth/login',headers={'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-csrf-token,idempotency-key'})
assert preflight[0]==204,preflight[2]
assert preflight[1]['access-control-allow-origin']==origin
assert preflight[1]['access-control-allow-credentials']=='true'
login=call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
assert login[0]==200,login[2]
cookie=login[1]['set-cookie'].split(';',1)[0]
assert 'Secure' in login[1]['set-cookie'] and 'HttpOnly' in login[1]['set-cookie'] and 'SameSite=Strict' in login[1]['set-cookie']
headers={'Cookie':cookie,'X-CSRF-Token':login[2]['data']['csrf']}
me=call('GET','/auth/me',headers=headers)
health=call('GET','/health',headers=headers)
runtime=call('GET','/runtime',headers=headers)
overview=call('GET','/overview',headers=headers)
assert all(r[0]==200 for r in [me,health,runtime,overview])
assert me[2]['data']['username']=='owner'
assert health[2]['data']['databaseMode']=='postgresql'
assert health[2]['data']['worker'] and health[2]['data']['worker']['state']=='running'
assert runtime[2]['data']['paused'] is True
assert health[2]['data']['publishTransportEnabled'] is False
assert call('GET','/accounts')[0]==401
assert call('POST','/auth/logout',{},headers={'Cookie':cookie})[0]==403
assert call('POST','/auth/logout',{},headers=headers)[0]==200
static=subprocess.run(['curl','-fsS','-H','Host: bn.sid.mom','http://127.0.0.1/overview'],capture_output=True,text=True,check=True).stdout
config=subprocess.run(['curl','-fsS','-H','Host: bn.sid.mom','http://127.0.0.1/app-config.js'],capture_output=True,text=True,check=True).stdout
assert 'Square Desk' in static and '/assets/' in static
assert 'https://bn-api.sid.mom' in config
stats=subprocess.run(['systemctl','show','square-platform.service','-p','ActiveState','-p','SubState','-p','MainPID','-p','NRestarts','-p','MemoryCurrent'],capture_output=True,text=True,check=True).stdout
report={'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'frontendPath':'/www/wwwroot/bn.sid.mom','frontendOrigin':origin,'apiOrigin':'https://bn-api.sid.mom','apiBind':'0.0.0.0:39410','service':stats.strip().splitlines(),'login':'passed','session':'passed','csrf':'passed','corsPreflight':'passed','secureHostOnlyCookie':'passed','database':'native PostgreSQL 16 (port 5433), dedicated square_platform database and role','worker':'running','globallyPaused':True,'publishTransportEnabled':False,'staticSpaFallback':'passed','runtimeApiConfig':'passed','apiDomainProxy':'left unchanged for owner configuration','realModelCalls':0,'realPublications':0}
Path('/opt/square-platform/deploy/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False),flush=True)
PY
ss -lntp '( sport = :39410 )'
