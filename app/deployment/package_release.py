"""Package only native production runtime files; never include local credentials/data."""
import hashlib
import argparse
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "app/deployment"
OUT = DEPLOY / "artifacts"
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--release", default="20261022-split-origin")
args = parser.parse_args()
release = args.release
if not release or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in release):
    raise SystemExit("Release must contain only lowercase letters, digits and hyphens")
backend = ROOT / "app/square-service"
frontend = ROOT / "app/square-dashboard"


def add_tree(archive, source, target):
    if source.is_file():
        archive.add(source, arcname=target, recursive=False)
    else:
        for file in sorted(source.rglob("*")):
            if file.is_file():
                archive.add(file, arcname=str(Path(target) / file.relative_to(source)).replace("\\", "/"), recursive=False)


package = OUT / (release + ".tar.gz")
with tarfile.open(package, "w:gz") as archive:
    for name in ["package.json", "package-lock.json"]:
        add_tree(archive, backend / name, "service/" + name)
    for name in ["src", "database"]:
        add_tree(archive, backend / "dist" / name, "service/dist/" + name)
    add_tree(archive, backend / "dist/scripts/init.js", "service/dist/scripts/init.js")
    add_tree(archive, frontend / "dist", "frontend")
manifest = {
    "release": release,
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "file": package.name,
    "bytes": package.stat().st_size,
    "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
    "frontendOrigin": "https://bn.sid.mom",
    "apiOrigin": "https://bn-api.sid.mom",
    "apiPort": 39410,
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest))
