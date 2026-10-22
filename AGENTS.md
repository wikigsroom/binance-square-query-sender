# Repository working agreements / 仓库协作约束

## Scope / 范围

- The repository root is the project workspace. In the current Windows session it is `C:\dev\sandbox\binance square`. Run commands within this workspace and keep new artifacts here. 新开发代码放在 `app/`，文档及交付图片放在 `docs/`。
- Use native Node.js, Python, PowerShell and native remote Linux services. **Do not invoke Docker, WSL, virtual machines or other local virtualization.** 严禁调用本地 Docker、WSL 等虚拟化环境。
- Close every browser/context/tab launched for a task in `finally`. 不关闭用户原本打开的浏览器；完成操作后释放本轮浏览器资源。

## Product invariants / 产品约束

1. Every published body must be generated or edited by an explicitly approved AI text model. `gpt-6-luna` is the initial configured model. Never substitute handwritten posts, local templates, concatenated paragraphs or a model fallback that was not configured. 模型不可用时保留可诊断失败，不伪造成功。
2. Images must come from the managed local library or an approved GPT Image 2 family generation job. **All newly generated images must be memes/joke images about varied industries, with a clear visual joke or contrast.** This is a global rule for preset, manual and legacy queued generation, not just the Meme writing preset. Do not generate ordinary editorial illustrations, abstract concept art, magazine covers or product posters. Randomize industries, characters and formats; do not limit images to crypto, dogs or frogs. Record provenance, effective prompt, policy version, industry, actual model and file digest. 当前十种预设默认逐篇新生图；只允许各行各业的 meme 梗图（2026-10-22 用户最新要求）。
3. Each account has its own persisted random interval and weighted preset bindings. Preserve account isolation, leases/fencing, immutable task rules and submission intent records. Do not start a legacy timer alongside the platform worker for the same accounts.
4. A confirmed, in-flight or uncertain submission must not be submitted again blindly. Publish receipts and independent public verification are separate states. 不能用一次读取失败推断发帖失败并再次发帖。
5. User requirements and the latest saved runtime settings take precedence over historical examples. Production currently uses `publish_first`: stylistic/factual metadata findings are warnings; body presence, maximum length, AI provenance, media integrity, account/transport state and duplicate prevention remain enforced. New installations default to `strict`.
6. Writing length, selected tokens, sources and style come from the frozen preset version. The earlier 70/200-character, three-token rules apply to the legacy workflow, not every platform preset. 情绪性通过内容表达，不要求正文出现“情绪”等字眼。

## Credentials and operations / 凭据与运维

- Never commit actual API keys, passwords, encryption keys, cookies, databases, live account imports, private prompts or raw production dumps. Runtime credentials belong in environment variables, the encrypted database or ignored `.private/` files. Examples contain placeholders only.
- Use read-only production checks when preparing documentation or screenshots. Do not change schedules, accounts or global publishing settings for documentation. Explicitly authorized operational changes follow the user's scope without redundant confirmations.
- Do not log authentication headers. Keep useful API error codes and redacted original error details. Do not replace a remote failure with an invented success.
- Use native PostgreSQL for production/separate workers. PGlite is the single-process development/test option. Back up the database, managed assets and encryption key together; preserve unrelated server services.

## Verification / 验证

- Run relevant TypeScript checks, builds and regression tests for application changes. Repository-wide commands are documented in the root README.
- Keep Chinese and English READMEs synchronized. Diagrams describe implemented behavior; mark historical design and known limitations explicitly. Product screenshots must identify their environment and capture date.
- Run `npm run verify:repository` against the staged files before committing. The repository must contain actual component source files, not nested Git links or credentials. Do not upload local dependency/build/cache trees.
