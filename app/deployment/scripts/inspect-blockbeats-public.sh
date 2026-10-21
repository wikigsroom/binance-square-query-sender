set -eu
python3 -u - <<'PY'
import concurrent.futures, json, urllib.request, urllib.error
from pathlib import Path
out=Path('/home/ubuntu/square-platform-upload/source-inspection')
targets={
 'blockbeats_rss':'https://www.theblockbeats.info/rss.xml',
 'blockbeats_rss_short':'https://www.theblockbeats.info/rss',
 'blockbeats_bare':'https://theblockbeats.info/newsflash',
 'blockbeats_app':'https://api.theblockbeats.info/v2/flash/index?page=1&size=20',
 'blockbeats_pro':'https://api-pro.theblockbeats.info/v1/newsflash?page=1&size=20&lang=cn',
 'binance_size':'https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false',
}
def read(item):
 key,url=item
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json,application/rss+xml'}),timeout=12) as r:
   body=r.read(32*1024*1024);(out/(key+'.txt')).write_bytes(body)
   return {'key':key,'status':r.status,'bytes':len(body),'head':body[:180].decode('utf-8','replace')}
 except urllib.error.HTTPError as e:return {'key':key,'error':str(e),'head':e.read(180).decode('utf-8','replace')}
 except Exception as e:return {'key':key,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for f in concurrent.futures.as_completed([pool.submit(read,item) for item in targets.items()]):print(json.dumps(f.result(),ensure_ascii=False),flush=True)
PY
