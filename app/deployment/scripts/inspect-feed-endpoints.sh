set -eu
python3 - <<'PY'
import concurrent.futures, json, re, urllib.request, urllib.error
from pathlib import Path
out=Path('/home/ubuntu/square-platform-upload/source-inspection')
targets={
 'jinse_api':'https://api.jinse2.com/noah/v2/lives?limit=30&reading=false&source=web&flag=down&id=0&category=0',
 'jinse_detail':'https://www.jinse2.com/lives/537179.html',
 'blockbeats_api_public':'https://api.theblockbeats.news/v1/open-api/open-flash?size=30&page=1&lang=cn',
 'blockbeats_doc':'https://www.theblockbeats.info/apiDoc',
}
def read(item):
 key,url=item
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json'}),timeout=15) as r:
   body=r.read(5*1024*1024);(out/(key+'.txt')).write_bytes(body)
   text=body.decode('utf-8','replace')
   result={'key':key,'status':r.status,'bytes':len(body),'head':text[:110]}
   if 'json' in r.headers.get('Content-Type',''):
    data=json.loads(text);result['sample']=str(data)[:1100]
   else:result['scripts']=re.findall(r'<script[^>]+src=["\']([^"\']+)',text)[:15]
   return result
 except urllib.error.HTTPError as e:return {'key':key,'error':str(e),'head':e.read(200).decode('utf-8','replace')}
 except Exception as e:return {'key':key,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for row in pool.map(read,targets.items()): print(json.dumps(row,ensure_ascii=False),flush=True)
PY
