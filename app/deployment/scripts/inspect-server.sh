set -eu
python3 - <<'PY'
import json, os, pathlib, subprocess
checks = {
 'identity':['id'],
 'os':['cat','/etc/os-release'],
 'resources':['free','-m'],
 'disk':['df','-h','/','/www'],
 'versions':['sh','-c','command -v node npm nginx psql systemctl; node --version 2>/dev/null; npm --version 2>/dev/null; psql --version 2>/dev/null'],
 'listeners':['ss','-lntp'],
 'services':['systemctl','list-units','--type=service','--state=running','--no-pager'],
 'firewall':['sh','-c','command -v ufw >/dev/null && ufw status verbose || true'],
 'sitepaths':['sh','-c',"ls -ld /www/wwwroot/bn.sid.mom /www/wwwroot/bn-api.sid.mom /www/server/nginx/sbin/nginx /www/server/panel/vhost/nginx /etc/nginx/sites-enabled /opt/square-platform 2>/dev/null || true"],
 'dns':['getent','ahostsv4','bn.sid.mom','bn-api.sid.mom'],
}
for name, command in checks.items():
 r=subprocess.run(command,capture_output=True,text=True)
 print(json.dumps({'check':name,'status':r.returncode,'output':r.stdout[:16000],'error':r.stderr[:1500]},ensure_ascii=False),flush=True)
for folder in ['/www/server/panel/vhost/nginx','/etc/nginx/sites-enabled']:
 p=pathlib.Path(folder)
 if p.exists():
  for f in p.glob('*bn*'):
   if f.is_file():
    print(json.dumps({'nginxSite':str(f),'config':f.read_text()[:18000]},ensure_ascii=False))
p=pathlib.Path('/www/wwwroot/bn.sid.mom')
if p.exists():
 print(json.dumps({'frontendExisting':[{'name':f.name,'directory':f.is_dir()} for f in list(p.iterdir())[:35]]}))
PY
