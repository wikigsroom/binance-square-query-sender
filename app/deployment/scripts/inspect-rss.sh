set -eu
python3 -u - <<'PY'
import concurrent.futures,json,urllib.request,urllib.error
from pathlib import Path
out=Path('/home/ubuntu/square-platform-upload/source-inspection')
urls={'blockbeats_rss_v2':'https://api.theblockbeats.news/v2/rss/newsflash','blockbeats_rss_v1':'https://api.theblockbeats.news/v1/open-api/home-xml','blockbeats_rss_info':'https://api.theblockbeats.info/v2/rss/newsflash'}
def read(item):
 key,url=item
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'SquareDesk/0.3 public-news-reader','language':'cn'})
  with urllib.request.urlopen(req,timeout=12) as r:
   b=r.read(3*1024*1024);(out/(key+'.txt')).write_bytes(b)
   return {'key':key,'status':r.status,'bytes':len(b),'head':b[:180].decode('utf-8','replace')}
 except Exception as e:return {'key':key,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for f in concurrent.futures.as_completed([pool.submit(read,v) for v in urls.items()]):print(json.dumps(f.result(),ensure_ascii=False),flush=True)
PY
