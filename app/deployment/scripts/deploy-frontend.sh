set -eu
python3 - <<'PY'
from pathlib import Path
import json, shutil, subprocess, tarfile, os
root=Path('/opt/square-platform')
manifest=json.loads((root/'deploy/manifest.json').read_text())
release=root/'releases'/manifest['release']
site=Path('/www/wwwroot/bn.sid.mom')
config=Path('/www/server/panel/vhost/nginx/bn.sid.mom.conf')
rewrite=Path('/www/server/panel/vhost/rewrite/bn.sid.mom.conf')
extension=Path('/www/server/panel/vhost/nginx/extension/bn.sid.mom/square-platform.conf')
backup=root/'backups'/manifest['release']
backup.mkdir(exist_ok=True)
with tarfile.open(backup/'frontend-before.tar.gz','w:gz') as t:
 for f in site.iterdir(): t.add(f,arcname=f.name)
shutil.copy2(config,backup/'bn.sid.mom.conf')
shutil.copy2(rewrite,backup/'bn.sid.mom.rewrite.conf')
assert not extension.exists(),'Square frontend extension already exists'
shutil.copytree(release/'frontend',site,dirs_exist_ok=True)
for file in (release/'frontend').rglob('*'):
 target=site/file.relative_to(release/'frontend')
 shutil.chown(target,user='www',group='www')
 target.chmod(0o755 if target.is_dir() else 0o644)
rewrite.write_text('location / {\n    try_files $uri $uri/ /index.html;\n}\n')
extension.parent.mkdir(exist_ok=True)
extension.write_text('''# Square Desk static frontend; API domain proxy is configured separately.
client_max_body_size 32m;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://bn-api.sid.mom data: blob:; connect-src 'self' https://bn-api.sid.mom; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
location = /app-config.js {
    add_header Cache-Control "no-store" always;
    expires off;
}
location = /index.html {
    add_header Cache-Control "no-cache" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://bn-api.sid.mom data: blob:; connect-src 'self' https://bn-api.sid.mom; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
}
if ($http_x_forwarded_proto = "http") { return 301 https://bn.sid.mom$request_uri; }
''')
test=subprocess.run(['/www/server/nginx/sbin/nginx','-t'],capture_output=True,text=True)
if test.returncode:
 shutil.copy2(backup/'bn.sid.mom.rewrite.conf',rewrite)
 extension.unlink()
 raise RuntimeError('Nginx validation failed; configuration restored. '+test.stderr)
subprocess.run(['/www/server/nginx/sbin/nginx','-s','reload'],check=True)
print(json.dumps({'frontend':str(site),'origin':manifest['frontendOrigin'],'apiOrigin':manifest['apiOrigin'],'backup':str(backup),'nginx':'validated and reloaded','apiVhostModified':False}),flush=True)
PY
