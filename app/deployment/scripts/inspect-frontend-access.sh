set -eu
python3 - <<'PY'
import subprocess,json
for name,cmd in {
 'origin':['curl','-sS','-D','-','-o','/dev/null','--max-time','10','-H','Host: bn.sid.mom','http://127.0.0.1/'],
 'originHttpsForwarded':['curl','-sS','-D','-','-o','/dev/null','--max-time','10','-H','Host: bn.sid.mom','-H','X-Forwarded-Proto: https','http://127.0.0.1/'],
 'public':['curl','-sS','-D','-','-o','/dev/null','--max-time','15','https://bn.sid.mom/'],
 'frontendErrors':['tail','-n','15','/www/wwwlogs/bn.sid.mom.error.log'],
 'frontendAccess':['tail','-n','12','/www/wwwlogs/bn.sid.mom.log'],
}.items():
 r=subprocess.run(cmd,capture_output=True,text=True)
 print(json.dumps({'check':name,'status':r.returncode,'output':r.stdout[:8000],'error':r.stderr[:1800]},ensure_ascii=False),flush=True)
PY
