"""Check documentation links, diagram XML and Git delivery boundaries."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
repositories=[ROOT/"app/square-service",ROOT/"app/square-dashboard"]
errors=[]
count=0
for repo in repositories:
    for name in ("README.md","README.en.md",".gitignore","package-lock.json"):
        if not (repo/name).is_file():errors.append(f"Missing {repo.name}/{name}")
    for file in [*repo.glob("*.md"),*repo.joinpath("docs").rglob("*.md")]:
        for target in re.findall(r'!?\[[^\]]+\]\(([^)]+)\)',file.read_text(encoding="utf-8")):
            if re.match(r'^[a-z]+:',target) or target.startswith('#'):continue
            link=target.split('#')[0].strip('<>')
            if not (file.parent/link).exists():errors.append(f"Broken link: {file.relative_to(ROOT)} -> {target}")
            count+=1
    for file in repo.joinpath("docs/diagrams").glob("*.svg"):ET.parse(file)
    for file in repo.rglob('*'):
        if not file.is_file() or any(p in {'.git','node_modules','dist','data','.npm-cache','test-results','playwright-report','.browsers'} for p in file.relative_to(repo).parts):continue
        if file.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.gif'}:continue
        content=file.read_text(encoding='utf-8',errors='ignore')
        if re.search(r'\bsk-[A-Za-z0-9_-]{24,}',content):errors.append(f"Unexpected credential-shaped value in {file.relative_to(ROOT)}")
        if file.name in {'keys.txt','accounts.json','.env'}:errors.append(f"Unexpected credential/runtime file: {file.relative_to(ROOT)}")
for file in [ROOT/'docs/README.md',ROOT/'docs/09-development-record.md',ROOT/'docs/10-dashboard-and-ai-upgrade.md']:
    for target in re.findall(r'!?\[[^\]]+\]\(([^)]+)\)',file.read_text(encoding="utf-8")):
        if re.match(r'^[a-z]+:',target) or target.startswith('#'):continue
        if not (file.parent/target.split('#')[0]).exists():errors.append(f"Broken root documentation link: {target}")
        count+=1
if errors:raise SystemExit('\n'.join(errors))
print(f'Checked {count} local documentation links, SVG XML and delivery file boundaries.')
