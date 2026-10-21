set -eu
python3 - <<'PY'
import urllib.request,json
from pathlib import Path
url='https://t.me/s/theblockbeats'
try:
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=15) as r:
  b=r.read(2*1024*1024)
  Path('/home/ubuntu/square-platform-upload/source-inspection/blockbeats_telegram.txt').write_bytes(b)
  print(json.dumps({'status':r.status,'bytes':len(b),'messageCount':b.count(b'tgme_widget_message_text')}))
except Exception as e:print(json.dumps({'error':str(e)}))
PY
