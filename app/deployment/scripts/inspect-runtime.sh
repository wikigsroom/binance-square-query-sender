set -eu
python3 - <<'PY'
import json, pathlib, subprocess
checks={
 'postgresClusters':['pg_lsclusters'],
 'postgresMain':['runuser','-u','postgres','--','psql','-p','5432','-Atqc',"SELECT version(); SELECT datname FROM pg_database WHERE datname='square_platform'; SELECT rolname FROM pg_roles WHERE rolname='square_platform';"],
 'nginxBinary':['readlink','-f','/usr/bin/nginx'],
 'nginxConfig':['sh','-c',"/www/server/nginx/sbin/nginx -t 2>&1; grep -nE 'include|user |worker_processes' /www/server/nginx/conf/nginx.conf"],
 'ownership':['sh','-c',"getent passwd www; getent passwd square-platform || true; stat -c '%U %G %a %n' /www/wwwroot/bn.sid.mom /www/wwwroot/bn-api.sid.mom"],
 'rewrite':['sh','-c',"cat /www/server/panel/vhost/rewrite/bn.sid.mom.conf; find /www/server/panel/vhost/nginx/extension/bn.sid.mom -maxdepth 1 -type f -printf '%f\\n'"],
 'certnames':['sh','-c',"find /www/server/panel/vhost/cert -maxdepth 2 -name fullchain.pem -printf '%h\\n' 2>/dev/null | head -15"],
}
for name,command in checks.items():
 r=subprocess.run(command,capture_output=True,text=True)
 print(json.dumps({'check':name,'status':r.returncode,'output':r.stdout[:10000],'error':r.stderr[:1800]},ensure_ascii=False),flush=True)
PY
