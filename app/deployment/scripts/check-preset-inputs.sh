set -eu
python3 -u - <<'PY'
import http.client, json, urllib.parse
from pathlib import Path
credentials=json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
def call(method,path,body=None,headers=None):
    client=http.client.HTTPConnection('127.0.0.1',39410,timeout=55)
    client.request(method,'/api/v1'+path,json.dumps(body) if body is not None else None,{'Origin':'https://bn.sid.mom','Content-Type':'application/json'}|(headers or {}))
    response=client.getresponse(); result=(response.status,dict(response.getheaders()),json.loads(response.read()));client.close();return result
login=call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
assert login[0]==200
headers={'Cookie':login[1]['set-cookie'].split(';',1)[0],'X-CSRF-Token':login[2]['data']['csrf']}
try:
    resources=json.loads(Path('/opt/square-platform/deploy/preset-resources.json').read_text())
    checks=[]
    for connection in resources['connections']:
        response=call('POST',f"/model-connections/{connection['id']}/probe",{},headers)
        data=response[2].get('data',{})
        checks.append({'connectionId':connection['id'],'name':connection['name'],'httpStatus':response[0],'status':data.get('status'),'modelIds':[m.get('id') for m in data.get('models',[])],'error':response[2].get('error')})
    tokens=['DOGE','SHIB','PEPE','BTC','ETH','SOL','AAVE','UNI','RAY','JUP','TAO','RENDER','FET','IMX','GALA','AXS']
    response=call('GET','/data-sources/source_binance/content?'+urllib.parse.urlencode({'tokens':','.join(tokens)}),headers=headers)
    assert response[0]==200, 'Current spot market unavailable'
    items=response[2]['data']['items']
    report={'modelConnections':checks,'marketTokens':[row['token'] for row in items],'missingMarketTokens':list(set(tokens)-{row['token'] for row in items}),'marketFetchedAt':response[2]['data']['fetchedAt']}
    Path('/opt/square-platform/deploy/preset-input-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))
finally:
    call('POST','/auth/logout',{},headers)
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/preset-input-check.json /home/ubuntu/square-platform-upload/preset-input-check.json
