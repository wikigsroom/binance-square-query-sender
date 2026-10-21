"""Regenerate editable SVG logic illustrations. Run from the project root."""
from pathlib import Path
from html import escape
import shutil
import json

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "app/square-service/docs"
DASHBOARD = ROOT / "app/square-dashboard/docs"
OUT = ROOT / "docs/development"

def text(x, y, value, size=15, fill="#181a20", weight=400):
    return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{weight}">{escape(value)}</text>'

def box(x, y, w, h, title, lines, amber=False):
    fill, stroke = ("#fff9df", "#f0b90b") if amber else ("#ffffff", "#eaecef")
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}"/>'
    s += text(x + 18, y + 30, title, 17, weight=650)
    for i, line in enumerate(lines):
        s += text(x + 18, y + 56 + i * 22, line, 13, "#626c7a")
    return s

def arrow(d, amber=False):
    return f'<path d="{d}" fill="none" stroke="{"#b88700" if amber else "#848e9c"}" stroke-width="2" marker-end="url(#arrow)"/>'

def svg(title, subtitle, w, h, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(subtitle)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#848e9c"/></marker></defs>
<rect width="100%" height="100%" rx="18" fill="#fafafa"/>
<g font-family="Segoe UI, Arial, sans-serif">{text(35,46,title,25,weight=650)}{text(35,75,subtitle,14,"#626c7a")}{body}{text(35,h-22,"Square Platform | Implementation logic | 2026-10-20",12,"#626c7a")}</g></svg>'''

flow = ""
flow += box(35,110,320,108,"1  Account-owned schedule",["Persist anchor, sampled seconds and due time", "Manual requests enter the same pipeline"])
flow += box(415,110,320,108,"2  Weighted preset selection",["Only eligible published versions", "Freeze rules, AI models and selection"])
flow += box(795,110,330,108,"3  Read verified sources",["Rolling 24h market; readable article bodies", "Store dates, facts, hashes and expiry"])
flow += arrow("M355 164 H415") + arrow("M735 164 H795") + arrow("M960 218 V263 H195 V300")
flow += box(35,300,320,128,"4  Approved AI final text",["Full rendered prompt + model response", "Rules and optional AI review", "Bounded model-only repair"])
flow += box(415,300,320,128,"5  Managed image",["Existing library or GPT Image 2", "Persist bytes, hash and provenance", "Enforce requested aspect ratio"])
flow += box(795,300,330,128,"6  Final gate + intent",["Pause / account / lease / approved model", "Content, asset and source evidence", "Commit intent before the HTTP submission"],True)
flow += arrow("M355 364 H415") + arrow("M735 364 H795")
flow += arrow("M960 428 V480 H310 V520") + arrow("M960 480 H960 V520",True)
flow += box(35,520,510,117,"Confirmed publication",["Store receipt; sample next account time independently", "Public verification runs separately; never causes resend"])
flow += box(615,520,510,117,"Unknown submission result",["Keep original intent and isolate this account", "Read-only reconciliation; never blind resubmission"],True)
flow += text(35,680,"Global pause blocks new submission; one active publication pipeline per account.",14)
flow += text(35,706,"External exactly-once delivery is not assumed. Unknown outcomes remain explicit.",14)
publication = svg("Publication pipeline", "Account-specific schedules, immutable AI evidence and explicit outcome handling",1160,760,flow)

ui = ""
ui += box(35,115,300,126,"Browser dashboard",["Accounts / weights / schedules", "Presets / images / searchable posts", "Tasks / actual prompts / AI integration"])
ui += box(400,115,300,126,"Authenticated management API",["Same-origin session and CSRF", "Versioned config; idempotent actions", "Masked credential responses"])
ui += box(765,115,300,126,"Persistent service state",["Native PostgreSQL for remote operation", "Encrypted credentials and immutable evidence", "Managed image storage"])
ui += arrow("M335 179 H400") + arrow("M700 179 H765")
ui += box(400,325,300,126,"Worker",["Independent account due times", "AI / source / media / final gate", "Receipts and asynchronous verification"],True)
ui += box(765,325,300,126,"External adapters",["Chat / Responses / Messages", "GPT Image 2 / market / readable news", "Square upload / publish / public detail"])
ui += arrow("M915 241 V277 H550 V325") + arrow("M700 388 H765")
ui += arrow("M550 325 V294 H855 V241")
ui += text(35,491,"UI polls the API; workers persist results. Closing the browser does not stop schedules.",14)
dashboard = svg("Dashboard and backend", "Remote-server product boundary; native services without Docker or WSL",1100,550,ui)

for directory in (SERVICE / "diagrams", DASHBOARD / "diagrams", OUT / "diagrams"):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "publication-flow.svg").write_text(publication,encoding="utf-8")
    (directory / "dashboard-flow.svg").write_text(dashboard,encoding="utf-8")

for destination in (SERVICE / "screenshots", OUT / "screenshots"):
    destination.mkdir(parents=True,exist_ok=True)
    captures=json.loads((DASHBOARD / 'screenshots/capture.json').read_text(encoding='utf-8'))
    for name in [*captures['screenshots'],'capture.json']:
        shutil.copy2(DASHBOARD / "screenshots" / name,destination / name)
print("Generated logic diagrams and copied documented running screenshots.")

for destination in (SERVICE / "checks", OUT / "checks"):
    destination.mkdir(parents=True,exist_ok=True)
    for file in (DASHBOARD / "checks").glob("*.json"):
        shutil.copy2(file,destination / file.name)
