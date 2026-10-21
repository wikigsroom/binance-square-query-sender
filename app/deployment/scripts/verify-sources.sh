set -eu
python3 -u - <<'PY'
from pathlib import Path
import concurrent.futures,http.client,json,time,urllib.parse
credentials=json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
def call(method,path,body=None,headers=None):
 c=http.client.HTTPConnection('127.0.0.1',39410,timeout=85)
 h={'Origin':'https://bn.sid.mom','Content-Type':'application/json'}|(headers or {})
 c.request(method,'/api/v1'+path,json.dumps(body) if body is not None else None,h)
 r=c.getresponse();data=json.loads(r.read());res=(r.status,dict(r.getheaders()),data);c.close();return res
login=call('POST','/auth/login',{'username':credentials['adminUsername'],'password':credentials['adminPassword']})
assert login[0]==200,'Production login failed'
h={'Cookie':login[1]['set-cookie'].split(';',1)[0],'X-CSRF-Token':login[2]['data']['csrf']}
try:
 bulk=call('POST','/data-sources/probe-all',{},h)
 assert bulk[0]==200,bulk[2]
 print(json.dumps({'bulk':bulk[2]['data']},ensure_ascii=False),flush=True)
 assert all(s['ok'] for s in bulk[2]['data']),'One or more live sources failed'
 checks=[]
 for sourceId in ['source_binance','source_jinse','source_blockbeats']:
  result=call('GET',f'/data-sources/{sourceId}/content',headers=h)
  assert result[0]==200,result[2]
  d=result[2]['data']
  if sourceId=='source_binance':
   assert d['symbolsCount']>100 and len(d['topGainers'])==5 and len(d['topLosers'])==5
   assert all(r['changePercent']>0 for r in d['topGainers']) and all(r['changePercent']<0 for r in d['topLosers'])
   checks.append({'sourceId':sourceId,'count':d['symbolsCount'],'url':d['url'],'window':d['window'],'cached':d['cached'],'checkedAt':d['fetchedAt']})
  else:
   assert d['items'] and all(len(a['body'])>=30 and a['publishedAt'] and a['publishedDate'] and a['url'] and a['evidenceUrl'] for a in d['items'])
   checks.append({'sourceId':sourceId,'count':d['total'],'scannedCount':d['scannedCount'],'transport':d['transport'],'cached':d['cached'],'checkedAt':d['fetchedAt'],'fallbackErrors':d['failures'],'sampleEvidenceUrl':d['items'][0]['evidenceUrl']})
   filtered=call('GET',f'/data-sources/{sourceId}/content?tokens=BTC,ETH,SOL&hours=24',headers=h)
   assert filtered[0]==200
   assert all(set(a['relatedTokens']) & {'BTC','ETH','SOL'} for a in filtered[2]['data']['items'])
   checks[-1]['filteredCount']=filtered[2]['data']['total']
 health=call('GET','/health',headers=h)
 assert health[0]==200 and health[2]['data']['databaseMode']=='postgresql'
 runtime=call('GET','/runtime',headers=h)
 report={'release':'20261022-sources','checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'login':'passed','sources':checks,'database':'postgresql','globallyPaused':runtime[2]['data']['paused'],'publishTransportEnabled':health[2]['data']['publishTransportEnabled'],'realModelCallsForVerification':0,'publicationsForVerification':0,'status':'passed'}
 Path('/opt/square-platform/deploy/sources-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False),flush=True)
finally:
 call('POST','/auth/logout',{},h)
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/sources-verification.json /home/ubuntu/square-platform-upload/sources-verification.json
systemctl show square-platform.service -p ActiveState -p SubState -p NRestarts -p MemoryCurrent
