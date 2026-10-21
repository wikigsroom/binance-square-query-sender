"""Build portable SVG diagrams and the bilingual gallery from the capture manifest."""
from pathlib import Path
from html import escape
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/product"
OUT.mkdir(parents=True, exist_ok=True)


def box(x, y, title, lines, accent=False, width=310):
    body = f'<rect x="{x}" y="{y}" width="{width}" height="112" rx="12" fill="{"#fff7d7" if accent else "white"}" stroke="{"#d2a400" if accent else "#d8e0e8"}"/>'
    body += f'<text x="{x+16}" y="{y+29}" class="title">{escape(title)}</text>'
    for i, line in enumerate(lines):
        body += f'<text x="{x+16}" y="{y+54+i*21}" class="line">{escape(line)}</text>'
    return body


def arrow(d):
    return f'<path d="{d}" fill="none" stroke="#8191a1" stroke-width="2" marker-end="url(#arrow)"/>'


def save(name, title, subtitle, body, height=630):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="{height}" viewBox="0 0 1180 {height}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(subtitle)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8191a1"/></marker></defs>
<style>text{{font-family:Segoe UI,Arial,sans-serif;fill:#182638}}.title{{font-size:17px;font-weight:600}}.line{{font-size:13px;fill:#506175}}</style>
<rect width="1180" height="{height}" rx="18" fill="#f5f7fa"/>
<text x="40" y="45" font-size="25" font-weight="700">{escape(title)}</text><text x="40" y="74" class="line">{escape(subtitle)}</text>
{body}<text x="40" y="{height-20}" class="line">Square Desk | Implemented behavior | 2026-10-22 | Native services, no Docker / WSL</text></svg>'''
    ET.fromstring(svg)
    (OUT / name).write_text(svg, encoding="utf-8")


body = box(40, 125, "Browser dashboard", ["Accounts, schedules, presets and posts", "Static React UI / HTTPS / light and dark"])
body += box(435, 125, "Management API", ["Fastify /api/v1, session and CSRF", "Exact-origin CORS, versioned updates"], True)
body += box(830, 125, "Persistent state", ["Native PostgreSQL, SQL / JSONB", "Encrypted credentials, evidence, intents"])
body += arrow("M350 181 H435") + arrow("M745 181 H830")
body += box(435, 320, "Scheduler and worker", ["Independent account timers and weights", "Leases, fences, capacity and pipeline"], True)
body += box(40, 320, "Sources and approved AI", ["Binance / Jinse / BlockBeats", "Text models and GPT Image 2 generation"])
body += box(830, 320, "Square and managed media", ["Image bytes, hashes and provenance", "Upload, publish receipt, public verification"])
body += arrow("M590 237 V320") + arrow("M745 376 H830") + arrow("M435 376 H350")
body += arrow("M985 237 V276 H685 V320")
body += '<text x="40" y="490" class="title">The browser observes. The server schedules and publishes.</text>'
body += '<text x="40" y="520" class="line">The API and worker may share one process. Separate workers require PostgreSQL; PGlite is development only.</text>'
body += '<text x="40" y="545" class="line">Receipts confirm submission; public verification independently checks body, token tags and image.</text>'
save("architecture.svg", "Platform architecture", "Static dashboard, durable scheduling and auditable external adapters", body)

body = box(40, 125, "1. Select and freeze", ["Account due time and weighted preset", "Immutable rules, selected models and inputs"])
body += box(435, 125, "2. Read and draft", ["Persist source snapshots", "Approved AI finalizes the complete body"])
body += box(830, 125, "3. Validate by runtime mode", ["Strict: rules, optional review and repair", "Publish first: content warnings"], True)
body += arrow("M350 181 H435") + arrow("M745 181 H830") + arrow("M985 237 V276 H195 V320")
body += box(40, 320, "4. Prepare image", ["Library or approved GPT Image 2", "Ingest and validate actual bytes / provenance"])
body += box(435, 320, "5. Final gate and intent", ["Account, pause, lease and AI integrity", "Commit intent before sending"], True)
body += box(830, 320, "6. Submit once", ["Confirmed: save ID and next due time", "Unknown: retain intent, never blind resend"])
body += arrow("M350 376 H435") + arrow("M745 376 H830")
body += '<text x="40" y="492" class="title">Preview stops before upload. Public verification does not trigger resubmission.</text>'
body += '<text x="40" y="523" class="line">Publish first still requires nonempty bounded text, authentic AI evidence, valid media, account state and duplicate prevention.</text>'
body += '<text x="40" y="548" class="line">Uncertain delivery is an explicit state; only read-only reconciliation may associate the original remote submission.</text>'
save("publication-flow.svg", "AI publication pipeline", "Model-authored content, runtime validation policy and explicit delivery outcomes", body)

body = box(40, 125, "Per-account time", ["min / max inclusive integer seconds", "anchor + sampled delay = nextDueAt"])
body += box(435, 125, "Weighted eligibility", ["Published and available presets only", "Probability = weight / eligible weight sum"])
body += box(830, 125, "One active pipeline", ["Persist selected version and lease fence", "Independent job / text / image capacity"], True)
body += arrow("M350 181 H435") + arrow("M745 181 H830")
body += box(435, 320, "Confirmed publication", ["Update lastPublishedAt", "Sample and persist the next account time"])
body += arrow("M985 237 V376 H745") + arrow("M435 376 H195 V237")
body += '<text x="40" y="492" class="title">Refreshes do not resample. Restart reads durable state. Closing the UI does not stop the worker.</text>'
body += '<text x="40" y="523" class="line">An uncertain submission isolates that account. Resume and resample are explicit audited operations.</text>'
save("scheduling.svg", "Independent randomized scheduling", "Each account owns its time interval, preset probabilities and durable execution state", body)

manifest = json.loads((OUT / "capture-manifest.json").read_text(encoding="utf-8"))
assert manifest["passed"] and manifest["readOnly"] and manifest["browserClosed"]
lines = [
    "# 产品截图与技术图册 / Product and architecture gallery", "",
    "[中文平台 README](../../README.md) · [English platform README](../../README.en.md) · [捕获清单 / Capture manifest](capture-manifest.json)", "",
    "以下 20 张图片来自 2026-10-22（Asia/Taipei）实际线上管理台，不是设计稿或测试夹具。Capture used authenticated, read-only production navigation; counters may change between pages because background publishing continued.", "",
    "凭据展示区域及密码输入框已遮挡。没有触发预览、发帖、核验、改权重或计划；脚本拦截除登录/注销以外的 API 写操作，并检查运行开关未变。The capture browser was closed in `finally`; no unused tabs were left running.", "",
    "截图不含实际认证值。可见账号后缀、任务标识、统计、原文和回执属于当时真实产品状态。A confirmed receipt and public verification are distinct; the screenshots preserve both labels.", "",
    "## 技术图 / Technical diagrams", "",
    "![Platform architecture](architecture.svg)", "", "![AI publication pipeline](publication-flow.svg)", "", "![Independent scheduling](scheduling.svg)", "",
    "这三张 SVG 可直接查看或下载，源文件由 `app/repository/build-product-docs.py` 生成；中英文 README 另含可编辑 Mermaid 架构、流程、时序与实体关系图。", "",
    "## 模块目录 / Module index", "", "| # | 页面 / Module | 图片 / Image |", "| --- | --- | --- |",
]
for i, shot in enumerate(manifest["screenshots"], 1):
    lines.append(f'| {i:02} | {shot["caption"]} | [PNG](screenshots/{shot["file"]}) |')
for i, shot in enumerate(manifest["screenshots"], 1):
    lines += ["", f'## {i:02} · {shot["caption"]}', "", f'路由 / Route: `{shot["path"]}` · {shot["viewport"]["width"]} × {shot["viewport"]["height"]} viewport · {shot["theme"]}', "", f'![{shot["caption"]}](screenshots/{shot["file"]})']
(OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(json.dumps({"svgDiagrams": 3, "screenshots": len(manifest["screenshots"]), "gallery": "docs/product/README.md"}))
