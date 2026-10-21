set -eu
python3 - <<'PY'
from pathlib import Path
import json, hashlib, os, pwd, shutil, subprocess, tarfile

root=Path('/opt/square-platform')
upload=Path('/home/ubuntu/square-platform-upload')
manifest=json.loads((upload/'manifest.json').read_text())
archive=upload/manifest['file']
assert hashlib.sha256(archive.read_bytes()).hexdigest()==manifest['sha256'], 'Release checksum mismatch'
release=root/'releases'/manifest['release']
assert not release.exists(), 'Release directory already exists; inspect it before continuing'
release.mkdir()
with tarfile.open(archive) as t:
 t.extractall(release,filter='data')
credentials=json.loads((upload/'bootstrap.json').read_text())
private=root/'deploy/bootstrap.json'
shutil.copy2(upload/'bootstrap.json',private)
private.chmod(0o600)
user=pwd.getpwnam('square-platform')
for folder in [release/'service']:
 for base,dirs,files in os.walk(folder):
  os.chown(base,user.pw_uid,user.pw_gid)
  for name in files: os.chown(Path(base)/name,user.pw_uid,user.pw_gid)

sql=f"""CREATE ROLE square_platform LOGIN PASSWORD '{credentials['databasePassword']}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20;
CREATE DATABASE square_platform OWNER square_platform;
REVOKE ALL ON DATABASE square_platform FROM PUBLIC;
"""
probe=subprocess.run(['runuser','-u','postgres','--','psql','-p','5433','-Atqc',"SELECT count(*) FROM pg_roles WHERE rolname='square_platform'; SELECT count(*) FROM pg_database WHERE datname='square_platform';"],check=True,capture_output=True,text=True)
assert probe.stdout.strip()=='0\n0', 'Database or role already exists; not changing existing resources'
created=subprocess.run(['runuser','-u','postgres','--','psql','-p','5433','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
if created.returncode:
 raise RuntimeError('Database initialization failed: '+created.stderr.replace(credentials['databasePassword'],'[redacted]'))

env={
 'NODE_ENV':'production', 'HOST':'0.0.0.0','PORT':str(manifest['apiPort']),
 'PUBLIC_ORIGIN':manifest['frontendOrigin'],
 'DATA_DIR':'/opt/square-platform/data',
 'DATABASE_URL':f"postgresql://square_platform:{credentials['databasePassword']}@127.0.0.1:5433/square_platform",
 'ENCRYPTION_KEY':credentials['encryptionKey'],
 'COOKIE_SECURE':'true','RUN_WORKER':'true','SQUARE_PUBLISH_ENABLED':'false',
 'OUTBOUND_PROXY_URL':'','IMPORT_ROOTS':'','WEB_DIR':'',
}
environment=Path('/etc/square-platform/square.env')
assert not environment.exists(), 'Environment already exists; refusing to overwrite it'
environment.write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
environment.chmod(0o600)
print('Installing production dependencies for',manifest['release'],flush=True)
subprocess.run(['runuser','-u','square-platform','--','/usr/local/bin/npm','ci','--omit=dev','--no-audit','--no-fund','--cache','/opt/square-platform/npm-cache'],cwd=release/'service',check=True)
init_env=os.environ|env|{'ADMIN_USERNAME':credentials['adminUsername'],'ADMIN_PASSWORD':credentials['adminPassword']}
subprocess.run(['runuser','-u','square-platform','--','/usr/local/bin/node','dist/scripts/init.js'],cwd=release/'service',env=init_env,check=True)
(release/'frontend/app-config.js').write_text('window.__SQUARE_CONFIG__ = '+json.dumps({'apiOrigin':manifest['apiOrigin']})+';\n')
(root/'current').symlink_to(release,target_is_directory=True)
shutil.copy2(upload/'manifest.json',root/'deploy/manifest.json')
shutil.copy2(upload/'square-platform.service','/etc/systemd/system/square-platform.service')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','square-platform.service'],check=True)
print(json.dumps({'release':manifest['release'],'apiPort':manifest['apiPort'],'database':'native PostgreSQL 16 / square_platform','service':'square-platform.service','adminInitialized':True,'publishingEnabled':False}),flush=True)
PY
