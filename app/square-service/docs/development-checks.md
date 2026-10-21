# 开发检查 / Development checks

日期 / Date: 2026-10-20。此记录是开发证据，不是正式业务验收，也不是远程部署记录。

This records development evidence, not formal business acceptance or a remote deployment.

| 命令 / Command | 结果 / Result |
| --- | --- |
| `npm run build` | TypeScript 与 SQL 构建通过 / TypeScript and SQL packaging passed |
| `npm test` | 43 passed, 0 failed |
| 前端 `npm run build` / frontend build | TypeScript 与 Vite 构建通过 / TypeScript and Vite passed |
| 前端 `npm test` / frontend browser checks | 8 passed, 0 failed |

本轮新增三种文字协议的真实回环请求/响应、写作与校对、参数保护、不完整输出拒绝、模型发现、连接原子轮换、默认模型与版本冻结、默认生图和总览 SQL 全量统计检查。前端56组页面/屏宽/主题组合检查未见整页溢出、页面错误或受测文本对比度问题，明细见 [ui-audit.json](checks/ui-audit.json)。15张最终截图覆盖明暗主题、AI接入、模型发现及移动布局；自动检查不等同完整可访问性审计。

New checks cover three real loopback wire protocols, writing/review, parameter protection, incomplete outputs, discovery, atomic rotation, frozen defaults, default image jobs and full SQL overview counts. The 56 viewport/theme combinations report no page errors, document overflow or tested contrast issues; see the audit JSON. Fifteen screenshots cover both themes, AI setup, discovery and mobile layouts. This is not a complete accessibility audit.

后端检查使用 PGlite、回环 HTTP 来源/模型夹具和可观察的广场适配器替身，实际跑 API、加解密、SQL、内容校验和任务状态机。包括：鉴权/CSRF/Origin、凭据去重轮换、独立随机计划、权重/版本锁定、账号互斥/幂等、重启跳过错过计划、事实过期、新闻进度、模板相似度、模型失败无回退、AI 校对拒绝、图片来源/摘要/比例、暂停与轮换最终闸门、过期执行代次、明确拒绝、结果不明隔离与只读对账、账号故障隔离、持久化重开。

Backend tests execute the real API, encryption, SQL, validation and state machine against PGlite, loopback source/model fixtures and an observable Square adapter double. They cover auth/CSRF/origin, rotation/deduplication, per-account schedules, weighted immutable presets, exclusion/idempotency, missed-plan recovery, stale facts, news progress, similarity, no model fallback, review refusal, asset provenance/hash/aspect ratio, final pause/rotation gates, lease fencing, rejection/unknown/reconciliation, failure isolation and file-backed persistence.

截图从实际运行的 UI/API 采集；样本明确标记 fixture，真实发布关闭。截图原始采集清单见 `screenshots/capture.json`。没有进行真实模型计费请求、真实发帖或真实凭据导入。浏览器关闭由采集脚本 finally 和 Playwright context 生命周期完成。

Screenshots were captured from the running UI/API, with explicitly labeled fixture data and real publishing disabled. See `screenshots/capture.json`. No billable provider request, real post or real credential import was used. Browser cleanup runs through the capture script's finally block and Playwright context lifecycle.

未验证 / Not verified here: 原生 PostgreSQL 多进程竞争与压力、目标服务器环境、真实服务端模型/图片协议与限流、广场当前权限/字段/图片 URL 行为、备份恢复和正式验收。对应测试替身通过只能证明本实现按预期处理这些响应，不证明外部服务已兼容。

Native PostgreSQL multi-process/load behavior, the target server, actual provider/image protocols and limits, current Square permissions/fields/media behavior, backup recovery and formal acceptance remain outside these checks. Passing adapter fixtures establishes application behavior for those responses, not external compatibility.
