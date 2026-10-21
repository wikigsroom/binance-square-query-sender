set -eu
python3 - <<'PY'
from pathlib import Path
import http.client, json
credentials=json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
def call(method,path,body=None,headers=None):
 c=http.client.HTTPConnection('127.0.0.1',39410,timeout=65)
 h={'Origin':'https://bn.sid.mom','Content-Type':'application/json'}|(headers or {})
 c.request(method,'/api/v1'+path,json.dumps(body) if body is not None else None,h)
 r=c.getresponse();data=json.loads(r.read());res=(r.status,dict(r.getheaders()),data);c.close();return res
login=call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
assert login[0]==200
h={'Cookie':login[1]['set-cookie'].split(';',1)[0],'X-CSRF-Token':login[2]['data']['csrf']}
sources=call('GET','/data-sources?limit=100',headers=h)[2]['data']
for s in sources:
 print(json.dumps({'source':{k:s.get(k) for k in ['id','type','name','url','allowedHosts','enabled']}},ensure_ascii=False))
 if s['type']=='binance_market':
  result=call('POST','/data-sources/'+s['id']+'/probe',{},h)
  print(json.dumps({'probeStatus':result[0],'error':result[2].get('error'),'rows':len(result[2].get('data',{}).get('topGainers',[]))},ensure_ascii=False))
call('POST','/auth/logout',{},h)
PY
