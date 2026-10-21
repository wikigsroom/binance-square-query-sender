# Square Service

**Current monorepo entry (2026-10-22):** [complete English guide](../../README.en.md), [中文](../../README.md), [actual product screenshots](../../docs/product/README.md). The backend passes 61 tests and production uses `publish_first`, retaining content findings as warnings. Older behavior, test totals and deployment limits below are historical; follow the root guide and [latest change record](../../docs/17-publication-validation-and-priority.md).

**v0.2.0** · Binance-inspired light/dark workspace and configurable AI providers, protocols and defaults. See [AI integration](docs/ai-integration.md).
Backend for a single owner's multiple Binance Square accounts: authenticated management API, independent randomized schedules, AI content production, managed images, publication receipts and public verification. The companion UI is the separate `square-dashboard` repository.

[中文说明](README.md) · [Runtime and API](docs/runtime-and-api.md) · [Development evidence](docs/development-checks.md)

**2026-10-22 bulk import update:** Each imported account requires only `apiKey`; names are generated and other metadata is optional. Row failures remain isolated and new schedules stay paused. The build and all 53 backend tests pass; the deployed API is verified. See the parent project's `docs/13-key-only-account-import.md`.

**2026-10-22 source update:** Added complete Jinse flashes and BlockBeats official RSS/channel/article readers with actual transport, dates and evidence. Fixed oversized Binance exchange metadata responses, added the official market-data fallback, persisted read status/cache and searchable source previews. The build and all 52 backend tests pass; production reads are verified. See the parent project's `docs/12-sources-and-market-upgrade.md`. Earlier counts and deployment boundaries below are historical records.

**2026-10-22 deployment update:** Exact-origin CORS preflights and credentialed requests support a separate frontend hostname while retaining Origin, session and CSRF checks. The build and 44 backend tests pass. Actual deployment status and the owner-managed API proxy are recorded in the parent project's `docs/11-remote-deployment.md`; the original v0.2.0 evidence below describes the earlier development stage.

## Features

| Area | Implemented behavior |
| --- | --- |
| Accounts | Stable IDs, tags, imports, disable/archive, key rotation and duplicate detection; AES-256-GCM encrypted credentials with masked responses |
| Presets | Structured drafts and immutable published versions; multiple weighted bindings per account with recorded candidates, probabilities and selected version |
| Scheduling | Persisted per-account bounds, sampled delay, anchor and next due time; uniform integer seconds with inclusive bounds |
| AI integration | Custom/OpenAI/Anthropic profiles, actual Chat/Responses/Messages transports, read-only discovery, approved exact model IDs and frozen defaults |
| Text | Complete final text from an explicitly approved model; actual request URL, connection/credential versions, rendered messages, parameters, model identifiers, output and hashes retained; no local text fallback |
| Quality | Character/tag/market/evidence/banned-word checks, structural similarity and optional AI review enabled by default; bounded model-only repair |
| Images | Uploaded/imported library files or approved GPT Image 2 generation, stored and checked before publishing; provenance, byte hash and requested aspect ratio checks |
| Sources | Binance spot rolling 24-hour snapshots with official fallback; recent Jinse and BlockBeats flashes with actual transport, Beijing dates and evidence; persisted status/cache and material search; optional unavailable news is omitted with a recorded reason |
| Publication | Per-account exclusion, persisted leases/fences, final control gate and submission intent; ambiguous outcomes isolate the account without automatic resubmission |
| Archive | Chinese substring and combined filters with stable cursor pagination; links to tasks, actual prompts, source snapshots, media, validations and receipts |

![Publication logic](docs/diagrams/publication-flow.svg)

```mermaid
flowchart LR
  D[Account due / manual request] --> W[Weighted selection; freeze published version]
  W --> F[Source snapshots]
  F --> A[Approved model writes final text]
  A --> V[Rules and optional AI review]
  V -->|Bounded repair| A
  V -->|Pass| M[Library or stored GPT Image 2 output]
  M --> G[Final gate and persisted intent]
  G --> P[Square submission]
  P -->|Confirmed| N[Receipt and independent next schedule]
  N --> R[Asynchronous public verification]
  P -->|Ambiguous| Q[Isolate and reconcile original result]
```

## Requirements and layout

Use **Node.js 22.14+**, npm and native PostgreSQL for remote operation. Single-process development can use embedded PGlite. No Docker or WSL is required. `package-lock.json` pins the installed dependency graph.

`src/` contains the API, domain logic, scheduler, pipeline and adapters; `database/` holds SQL constraints and indexes; `scripts/` holds initialization, build, offline migration and the workbench; `tests/` holds regression checks. `data/` is private runtime storage excluded from Git. Diagrams and real UI screenshots are in `docs/`.

## Local development

Run inside this repository:

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the generated value as `ENCRYPTION_KEY` and choose an `ADMIN_PASSWORD` of at least 12 characters in `.env`. Keep real secrets out of source control and documentation. An empty `DATABASE_URL` selects PGlite in `data/`.

```powershell
npm run init
npm run dev
```

The default API is `127.0.0.1:4310`, with the development UI at `http://localhost:4300`. The initial runtime and new account schedules are paused. `SQUARE_PUBLISH_ENABLED=false` disables actual publication transport. Initialization only creates the first administrator and never overwrites an existing password.

## UI integration and process boundaries

After building the companion dashboard, the API can serve its static bundle from `WEB_DIR=../square-dashboard/dist`. Set `PUBLIC_ORIGIN` to the exact browser origin, then use `npm run build` and `npm start`. This is a run entry point; no remote deployment was performed for this delivery.

A PostgreSQL `DATABASE_URL` permits separate API and worker processes: set `RUN_WORKER=false` on the API, and start `npm run worker` with the same database, encryption key and managed media storage. PGlite requires one owning process and cannot support a second worker. Domain/TLS setup, service supervision, backups and production capacity belong to deployment.

## Configuration and business setup

See [.env.example](.env.example) for environment settings. The API checks Origin on mutations and uses HttpOnly session cookies plus CSRF. Set `COOKIE_SECURE=true` for HTTPS. `OUTBOUND_PROXY_URL` explicitly configures an outbound proxy; legacy publishing credentials are never imported implicitly.

In the dashboard, register a provider connection, explicitly approve actual model IDs, prepare images, publish a preset version, add accounts and bind several positive-weight presets, then configure each account's interval. Text uses an OpenAI-compatible `/chat/completions` endpoint, including a configured `gpt-6-luna` when requested. Image generation uses `/images/generations` and requires a registered GPT Image 2 family model. Base URL, authentication and supported parameters are configurable. A provider-reported model name is evidence of the response, not proof of its internal model weights.

Connection probing only reads `/models`; it does not certify generation support. Square credential verification reports `verification_unsupported` when no verified read-only endpoint exists, rather than publishing a test post. Enabling transport and resuming runtime controls are separate actions.

The three-token/BlockBeats/120–190 preferred/200 maximum preset is an editable example. Fixed-token and topic presets may use different lengths and sources. Platform rules still require AI final text, permitted image provenance, factual boundaries and the banned literal Chinese term `情绪` in outgoing text.

## Scheduling and failure semantics

- Enable/resume samples `now + U(min,max)`; confirmed publication samples `confirmation + U(min,max)`. Public verification runs independently.
- Editing bounds retains the existing sample. Explicit resampling changes it. Missed unclaimed schedules are skipped and resampled individually after downtime.
- Only one active publication pipeline per account. Retries keep the selected preset version. Bounded pre-submission retries are distinct from resending a publication.
- Global pause blocks new real submissions. Pausing only an account's schedule still allows manual publication; disabled, archived, invalid or unknown-result accounts do not.
- `submission_unknown` retains the original intent and blocks that account. Read-only reconciliation accepts an original post ID and requires matching text, tags and uploaded image association, plus author UID when known. It never resubmits. Unmatched results remain blocked.
- `published` means a confirmed platform receipt. `verified` additionally requires matching public text, tags and image association. Uncomparable rewritten media URLs remain `unavailable`. Rate limiting uses Retry-After or a conservative one-hour cooldown.

## Offline migration

```powershell
npm run migrate:legacy -- --source <legacy-project-directory>
# Apply only after reviewing the dry-run report:
npm run migrate:legacy -- --source <legacy-project-directory> --apply
```

The importer reads recognized legacy account/key, `imagegen/` and history files. Reports are stored under `data/migration-reports/`. It starts no worker and makes no publishing/model requests. Imported account schedules are paused. History without AI provenance is `legacy_unverified` and cannot be reused as an approved final post. Existing real keys were not imported during development.

## Development checks and screenshots

```powershell
npm run check
npm run build
npm test
npm run workbench
```

**43 backend regression checks passed.** The workbench uses an isolated database, loopback HTTP fixtures and invented credentials/responses on port `4321`, with real publishing hard-disabled. Sample login `owner / fixture-password-1234` exists only in this fixture. This mode supports UI development and screenshots; it is not a real AI call or production publishing history. Stop it with Ctrl+C.

The following are actual screenshots of the running dashboard and backend with explicitly labeled fixture data, not design mockups.

![Running overview](docs/screenshots/overview.png)
![Rendered prompts and lineage](docs/screenshots/prompt-lineage.png)

## Verification limits and repository delivery

Code, builds, isolated HTTP/database checks and browser development flows are complete. Remote deployment, formal business acceptance, native PostgreSQL multi-process load checks, real billable model calls and real Square publication were not performed. Server OS/scale, actual GPT Image 2 protocol and current Square behavior still require target-environment verification. News extraction and AI review are fallible; missing optional evidence is omitted instead of invented.

Both components are separate local Git repositories. No remote, push or public release was created. Distribution rights remain with the project owner; no open-source license is attached.
