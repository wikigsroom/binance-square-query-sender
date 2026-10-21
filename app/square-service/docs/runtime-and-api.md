# 运行与 API / Runtime and API

本文件描述本次实现，完整需求基线由项目主目录 `docs/00`—`08` 管理。API 根路径 `/api/v1`；数据默认存 UTC，界面显示 Asia/Taipei。

This document describes the implementation. The parent project's requirements remain the product baseline. API prefix: `/api/v1`; persisted timestamps are UTC, with Asia/Taipei presentation.

## 进程 / Processes

| 模式 / Mode | API | Worker | 数据 / Storage |
| --- | --- | --- | --- |
| PGlite 开发 / development | `npm run dev` | API 内 / integrated | 一个进程独占 / one owning process |
| PostgreSQL 单进程 / integrated | `npm start` | `RUN_WORKER=true` | 原生 PG + 受管图片目录 / native PG + media directory |
| PostgreSQL 分离 / separate | `RUN_WORKER=false npm start`（环境变量在 `.env` 配置 / set in `.env`） | `npm run worker` | 相同 DB、主密钥、媒体 / shared DB, master key, media |
| 隔离样本 / fixture | `npm run workbench`，4321 | 样本进程内 / integrated | 临时独立数据 / isolated temporary data |

`npm run build` 把 SQL 复制到构建产物中；`npm start` 不依赖 TypeScript 运行器。独立 Worker 的开发入口使用 tsx。启动前 schema 自动建立，当前版本包含一个可重复执行的初始迁移；后续结构升级应增加版本化迁移，不直接覆盖已发布环境。

The build copies SQL into the output. The production API starts without the TypeScript runner; the worker development entry uses tsx. Schema initialization is idempotent. This release retains the initial schema migration; AI default configuration is bootstrapped idempotently. Future schema changes need explicitly versioned upgrade migrations.

## 请求约定 / Request conventions

登录 `POST /auth/login` 接收 `{username,password}`，必须带与 `PUBLIC_ORIGIN` 相同的 Origin。成功设置 HttpOnly `square_session` Cookie，响应中给出 CSRF。其余接口需要会话；写接口另带 `X-CSRF-Token`。创建任务/账号/模型连接等幂等操作带至少 8 字符 `Idempotency-Key`，不同参数不能复用同键。配置更新提交资源当前 `expectedVersion`，冲突返回 409。

Login takes `{username,password}` and the configured Origin, sets an HttpOnly session cookie and returns CSRF. Other endpoints require the session; mutations also require `X-CSRF-Token`. Idempotent creation/actions require an `Idempotency-Key` of at least eight characters. Reusing it with different parameters is rejected. Configuration mutations use the current resource `expectedVersion`; conflicts return 409.

```json
{"data":{"id":"resource-id","version":1},"meta":{"requestId":"req-id"}}
```

```json
{"error":{"code":"CONFIG_VERSION_CONFLICT","message":"配置已改变，请刷新后重试。","retryable":false,"details":{}},"meta":{"requestId":"req-id"}}
```

异步任务返回 202；UI 读取任务状态。不存在任意正文直接发布的 API。上传接口采用 multipart，文件字段 `file`，元数据字段 `metadata`（JSON）。实际传输由源代码 `server.ts` 中各路由定义；鉴权后的 `/openapi.json` 是自动生成的路由与会话清单，不是完整请求字段 JSON Schema。

Async task creation returns 202; poll the task resource. There is no arbitrary-text publish endpoint. Upload uses multipart `file` and JSON `metadata`. `server.ts` is the authoritative route implementation. Authenticated `/openapi.json` provides an automatically generated route/session inventory, not a complete request-schema specification.

## 资源目录 / Resource groups

以下均省略 `/api/v1`。All paths below omit `/api/v1`.

| 资源 / Resource | 路径 / Paths |
| --- | --- |
| 登录与身份 / Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/password` |
| 运行 / Runtime | `GET /health`, `GET /overview`, `GET/PATCH /runtime` |
| 账号 / Accounts | `GET/POST /accounts`, `POST /accounts/import`, `GET/PATCH /accounts/:id`, `POST /accounts/:id/archive` |
| 凭据 / Credentials | `POST /accounts/:id/credentials/rotate`, `POST .../verify` |
| 预设权重 / Bindings | `GET/PUT /accounts/:id/preset-bindings` |
| 调度 / Schedules | `GET /schedules`, `GET/PUT /accounts/:id/schedule`, `POST .../pause`, `.../resume`, `.../resample` |
| 手动任务 / Manual | `POST /accounts/:id/publications` |
| 预设 / Presets | `GET/POST /presets`, `GET /presets/example-rules`, `GET/PATCH /presets/:id`, `POST .../clone`, `.../publish-version`, `.../preview`, `GET .../versions`, `.../versions/:version` |
| 图库 / Assets | `GET /assets`, `POST /assets/upload`, `POST /assets/import`, `GET/PATCH /assets/:id`, `GET .../content` |
| 生图 / Images | `GET/POST /image-jobs`, `GET /image-jobs/:id` |
| 发布任务 / Jobs | `GET /publication-jobs`, `GET /publication-jobs/:id`, `GET .../events`, `POST .../cancel`, `.../retry`, `.../ai-revisions`, `.../reconcile` |
| 调用 / AI evidence | `GET /generation-runs/:id` |
| 帖子 / Posts | `GET /posts`, `GET /posts/:id`, `POST .../verify` |
| 连接 / Connections | `GET/POST /model-connections`, `PATCH /model-connections/:id`, `POST .../credentials/rotate`, `.../probe` |
| AI 接入 / AI integration | `GET /ai/catalog`, `GET/PATCH /ai/settings`；[接入说明](ai-integration.md) |
| 模型 / Models | `GET/POST /models`, `PATCH /models/:id` |
| 来源 / Sources | `GET/POST /data-sources`, `PATCH /data-sources/:id`, `POST .../probe` |
| 审计 / Audit | `GET /audit-events`, `GET /openapi.json` |

## 关键配置示例 / Configuration examples

账号权重 / Account bindings:

```json
{"expectedVersion":1,"bindings":[{"presetId":"preset-A","enabled":true,"weight":5},{"presetId":"preset-B","enabled":true,"weight":3}]}
```

独立计划 / Independent schedule:

```json
{"expectedVersion":1,"enabled":false,"minIntervalSeconds":600,"maxIntervalSeconds":1800}
```

文字连接登记实际 `baseUrl`（含兼容协议所需的 `/v1` 前缀时一并填写）、`apiKey`、`name`、`concurrency`。模型登记 `connectionId`、`externalId`、`type:"text"`、`approved:true`、`allowedParameters` 与 `defaultParameters`。图片模型需 `type:"image", family:"gpt-image-2"`。服务地址默认必须 HTTPS 和公共地址；可信内网网关需要明确设置 `allowPrivateNetwork`。远端图片下载只允许连接登记的 `assetHosts`。

Register the provider `baseUrl` including its `/v1` prefix where required, key, name and concurrency. Register a model using its connection, actual external ID, type, approval, parameter allowlist and defaults. Images require `type:"image", family:"gpt-image-2"`. Public services require HTTPS/public addresses by default. Trusted private gateways require explicit private-network permission. Image download hosts must be configured on the connection.

预设完整规则见 `src/rules.ts`。`sourceRules` 区分必需和可选；`semanticReview` 默认 true；`repairAttempts` 为 0—3。图片策略为 library/generate/library_or_generate，生图参数在 `image.parameters`，不支持参数会阻塞。请求的比例按真实字节检查，允许 1% 的舍入偏差。显式 `any_library` 回退允许跨图片筛选范围取图，默认关闭。

Full preset rules are in `src/rules.ts`. Source rules distinguish required and optional; semantic review defaults on, with 0–3 model repairs. Image mode is library/generate/library_or_generate, with configured parameters. Unsupported parameters block the task. Requested aspect ratios are checked against actual bytes with 1% rounding tolerance. Explicit `any_library` fallback permits relaxation of image filters and is off by default.

## 帖子搜索 / Post search

`q` 为区分大小写的中文/文字子串。不同字段 AND，同字段逗号分隔值 OR。支持 `accountIds`、`accountTags`、`tokens`、`presetId`、`presetVersionId`、`modelId`、`connectionId`、`sourceId`、`publishStatus`、`verificationStatus`、`remotePostId`、`dateField`（createdAt/publishedAt）、`from`、`to`、`limit`、`cursor`。每页最多 100 条；按创建时间和 ID 降序稳定分页。没有已发布帖子但存在成稿的任务以 `draft_` 记录显示，包括预览与失败；不会伪造回执。

`q` is a case-sensitive substring. Fields combine with AND; comma-separated values within a supported multi-value field combine with OR. The listed query fields support account/tokens/preset/model/source/time/status filtering. Page size is at most 100, ordered by creation timestamp and ID. Tasks with a current generated version and no publication appear as `draft_` records; previews and failures do not receive fabricated publication receipts.

## 故障定位 / Troubleshooting

| 现象 / Symptom | 原因与处理 / Cause and action |
| --- | --- |
| 401/403 | 检查登录、Origin、Cookie 与 CSRF / Check login, exact origin, cookie and CSRF |
| `NO_ELIGIBLE_PRESET` | 发布有效预设、批准模型、设置正权重 / Publish an eligible preset, approve a model, set positive weights |
| `TEXT_VALIDATION_FAILED` | 查看校验和完整原始模型输出；修改预设或 AI 修改，不拼接正文 / Inspect validation and model output; revise rules or request AI revision |
| `FACTS_STALE` | 来源过期；重新取材并由 AI 重写 / Refresh facts and regenerate through AI |
| `ASSET_UNAVAILABLE` | 筛选、复用或预留条件无图 / No eligible image outside reuse/reservation constraints |
| `PUBLISH_TRANSPORT_DISABLED` | 环境仍关闭发布；预览仍可用 / Publication transport is disabled; previews remain available |
| `ACCOUNT_CREDENTIAL_INVALID` | 明确拒绝；轮换正确凭据，不重试原提交 / Explicit rejection; rotate credentials, do not replay the submission |
| `PUBLISH_RESULT_UNKNOWN` | 查询原帖并对账；保留账号阻塞 / Inspect and reconcile the original result; keep isolation until matched |
| `MODEL_CAPACITY_WAIT` | 等待原任务有限退避，不建重复任务 / Wait for bounded backoff on the same task |

上传大小上限 30MB、输入像素上限 5000 万；请求超时/响应大小有限。错误保留去敏原始响应和 requestId，不记录 Authorization/Key。DNS 地址检查不等同于完整网络沙箱；生产环境仍应通过服务器网络策略限制出站。

Uploads are limited to 30MB and 50 million input pixels. Requests have bounded time/size. Errors retain redacted raw responses and request IDs. DNS/address checks are not a complete network sandbox; target-server egress policy remains part of deployment.


AI 接入支持 Chat Completions、Responses、Anthropic Messages，以及在创建任务时固定默认模型。配置步骤、实际端点、参数与证据说明见 [AI 接入配置](ai-integration.md)。

AI integration supports Chat Completions, Responses and Anthropic Messages, with defaults resolved and frozen when jobs are created. See [AI integration](ai-integration.md).
