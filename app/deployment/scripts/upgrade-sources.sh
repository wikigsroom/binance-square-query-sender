set -eu
python3 -u - <<'PY'
from pathlib import Path
import fcntl, hashlib, http.client, json, os, pwd, shutil, subprocess, tarfile, time
root=Path('/opt/square-platform')
lock=(root/'deploy/upgrade.lock').open('a')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
upload=Path('/home/ubuntu/square-platform-upload')
manifest=json.loads((upload/'sources-manifest.json').read_text())
assert manifest['release']=='20261022-sources', 'Unexpected release'
archive=upload/manifest['file']
assert hashlib.sha256(archive.read_bytes()).hexdigest()==manifest['sha256'], 'Checksum mismatch'
current=root/'current'; old=current.resolve(); release=root/'releases'/manifest['release']
assert current.is_symlink() and old.parent==root/'releases' and old.is_dir()
assert not release.exists(), 'Release already exists; inspect before retrying'
release.mkdir()
with tarfile.open(archive) as t:t.extractall(release,filter='data')
account=pwd.getpwnam('square-platform')
for base,dirs,files in os.walk(release/'service'):
 os.chown(base,account.pw_uid,account.pw_gid)
 for name in files:os.chown(Path(base)/name,account.pw_uid,account.pw_gid)
print('Installing native production dependencies',flush=True)
subprocess.run(['runuser','-u','square-platform','--','/usr/local/bin/npm','ci','--omit=dev','--no-audit','--no-fund','--cache','/opt/square-platform/npm-cache'],cwd=release/'service',check=True)
subprocess.run(['runuser','-u','square-platform','--','/usr/local/bin/node','--input-type=module','-e','import "cheerio"; import sharp from "sharp"; console.log("Native runtime imports verified")'],cwd=release/'service',check=True)
active=subprocess.check_output(['runuser','-u','postgres','--','psql','-X','-p','5433','-d','square_platform','-tAc',"SELECT count(*) FROM jobs WHERE data->>'state' IN ('preparing','generating_text','validating','preparing_media','ready','submitting')"],text=True).strip()
assert active=='0','Jobs are active; leave the current service running and retry after they finish'
backup=root/'backups'/manifest['release'];backup.mkdir(mode=0o700)
with (backup/'database.dump').open('wb') as out:
 subprocess.run(['runuser','-u','postgres','--','pg_dump','-p','5433','-d','square_platform','-Fc'],stdout=out,check=True)
shutil.copy2('/etc/square-platform/square.env',backup/'square.env');(backup/'square.env').chmod(0o600)
site=Path('/www/wwwroot/bn.sid.mom')
shutil.copy2(site/'index.html',backup/'index.html')
with tarfile.open(backup/'frontend.tar.gz','w:gz') as t:
 for f in site.iterdir():t.add(f,arcname=f.name)
(backup/'previous-release.txt').write_text(str(old)+'\n')
switched=False
try:
 subprocess.run(['systemctl','stop','square-platform.service'],check=True)
 current.unlink();current.symlink_to(release,target_is_directory=True);switched=True
 subprocess.run(['systemctl','start','square-platform.service'],check=True)
 healthy=False
 for attempt in range(15):
  try:
   c=http.client.HTTPConnection('127.0.0.1',39410,timeout=2);c.request('GET','/api/v1/auth/me');r=c.getresponse();r.read();healthy=r.status==401;c.close()
   if healthy:break
  except Exception:pass
  time.sleep(1)
 assert healthy,'API did not become ready'
 for file in (release/'frontend').rglob('*'):
  if not file.is_file() or file.name in ['index.html','app-config.js']:continue
  target=site/file.relative_to(release/'frontend');target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(file,target);shutil.chown(target,user='www',group='www');target.chmod(0o644)
 pending=site/'index.html.next';shutil.copy2(release/'frontend/index.html',pending);shutil.chown(pending,user='www',group='www');pending.chmod(0o644);pending.replace(site/'index.html')
 shutil.copy2(upload/'sources-manifest.json',root/'deploy/manifest.json')
 result={'release':manifest['release'],'previous':str(old),'backup':str(backup),'service':'square-platform.service','apiPort':39410,'existingEnvironmentPreserved':True,'apiVhostModified':False,'frontendRuntimeConfigPreserved':True,'databaseMigration':'additive source_reads table'}
 (root/'deploy/sources-upgrade.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result),flush=True)
except Exception:
 if switched:
  current.unlink();current.symlink_to(old,target_is_directory=True)
  shutil.copy2(backup/'index.html',site/'index.html')
  subprocess.run(['systemctl','restart','square-platform.service'],check=False)
 raise
PY
