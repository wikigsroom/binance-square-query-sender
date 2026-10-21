set -eu
python3 - <<'PY'
import concurrent.futures, json, re, urllib.request, urllib.error
from pathlib import Path
out=Path('/home/ubuntu/square-platform-upload/source-inspection')
out.mkdir(exist_ok=True)
targets={
 'jinse':'https://www.jinse2.com/lives',
 'blockbeats':'https://www.theblockbeats.info/newsflash',
 'binance':'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
 'binance_data':'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT',
 'binance_exchange':'https://api.binance.com/api/v3/exchangeInfo',
 'binance_exchange_compact':'https://data-api.binance.vision/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false',
 'blockbeats_public':'https://api.theblockbeats.news/v1/open-api/open-flash?size=30&page=1&lang=cn',
 'blockbeats_info_api':'https://api.theblockbeats.info/v1/open-api/open-flash?size=30&page=1&lang=cn',
 'blockbeats_news':'https://www.theblockbeats.news/newsflash',
 'blockbeats_mobile':'https://m.theblockbeats.info/newsflash',
}
def read(item):
 key,url=item
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json'})
  with urllib.request.urlopen(req,timeout=20) as r:
   body=r.read(6*1024*1024)
   (out/(key+'.txt')).write_bytes(body)
   text=body.decode('utf-8','replace')
   return {'key':key,'url':url,'finalUrl':r.url,'status':r.status,'bytes':len(body),'scripts':re.findall(r'<script[^>]+src=["\']([^"\']+)',text)[:20], 'head':text[:120]}
 except urllib.error.HTTPError as e:return {'key':key,'url':url,'error':str(e),'head':e.read(180).decode('utf-8','replace')}
 except Exception as e:return {'key':key,'url':url,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for row in pool.map(read,targets.items()):print(json.dumps(row,ensure_ascii=False))
PY
