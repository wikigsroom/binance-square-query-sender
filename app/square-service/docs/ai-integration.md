# AI 接入配置 / AI integration

在 Dashboard → **系统设置 → AI 接入** 管理。所有服务请求由后端执行，浏览器只提交配置；显示名称与实际模型 ID 分开保存。内容生成、修复和校对均沿用明确批准的模型，不能用本地模板替代最终正文。

Configure providers in **Settings → AI integration**. The service makes provider requests; the browser only submits configuration. Display names are separate from actual upstream model IDs. Writing, repairs and review use approved AI models; there is no local final-text fallback.

## 连接与协议 / Connections and protocols

| 选择 / Selection | 实际文字接口 / Text endpoint | 认证 / Authentication | 图片 / Images |
| --- | --- | --- | --- |
| OpenAI Chat Completions | `{baseUrl}/chat/completions` | Bearer | `{baseUrl}/images/generations` |
| OpenAI Responses | `{baseUrl}/responses` | Bearer | `{baseUrl}/images/generations` |
| Anthropic Messages | `{baseUrl}/messages` | `x-api-key` + `anthropic-version: 2023-06-01` | 不支持 / unavailable |

服务商卡片提供 OpenAI、Anthropic、自定义三种起点，协议与基础地址仍可按实际网关修改。OpenAI、Anthropic 默认填入各自官方 `/v1` 地址；自定义网关可填写自己的 `/v1` 或其他 API 根路径。不要再附加 `chat/completions`、`responses`、`messages` 或查询参数。

Provider profiles offer OpenAI, Anthropic and custom starting points. The selected protocol and base URL are persisted and actually used. Use the upstream API root, including its version path where needed, without a method suffix or query string.

高级设置可选并发上限、超时秒数、内网服务访问和图片产物下载域名。Key 可在编辑页单独替换；编辑字段与 Key 替换在同一事务保存，失败回滚。修改地址、协议、内网访问或 Key 后，旧检查结果失效。查询只返回掩码，不回显完整 Key。

Advanced settings cover connection concurrency, timeout, private-network access and allowed image download hosts. Editing configuration and rotating its key is atomic. Endpoint, protocol, private-network or key changes invalidate prior probe results. Queries only return a credential mask.

## 模型发现、登记与默认 / Discovery, registration and defaults

1. 保存连接，进入“检查并选模型”，点击“读取可用模型”。只请求 `GET {baseUrl}/models`，显示时间、耗时、模型数量及错误。单次最多展示500条，分页或更多结果明确标记为部分列表。
2. 从列表登记，或手动填写实际模型 ID。不要把显示名称当成 API 模型 ID。可以填写自有服务实际提供的 `gpt-6-luna` 等 ID；平台不会静默替换为其他模型。
3. 文字与图片分别登记。图片必须明确声明 GPT Image 2，且连接支持 Images 接口。模型发现不会猜测或认证模型能力，同连接、用途、实际 ID 的重复登记会被拒绝。
4. 批准模型，并在“默认 AI 模型”选择默认文字、图片模型。撤销批准或停用连接后，默认配置会显示不可用，不能创建依赖它的新任务。
5. 内容预设 → 模型与质量 / 配图规则，可选择固定连接与模型，或“跟随系统默认”。图库 → 新建 GPT Image 2 任务也支持默认图片模型。

Save a connection, read its model catalog, register the exact ID for a text or GPT Image 2 purpose, approve it and select defaults. Catalog discovery is read-only and does not establish generation capability. Manual IDs remain supported when the list is unavailable. A disabled connection or revoked model cannot be selected for new dependent jobs.

**默认配置的作用时点**：任务创建时解析 `@default`，任务保存实际模型 ID、连接 ID、选择方式和默认设置版本。修改默认模型只影响随后创建的任务，不能重选已排队任务；固定模型的预设不受默认配置改动影响。发布预设版本仍保持不可变。

**When defaults apply:** job creation resolves `@default` and stores the actual model, connection, selection mode and defaults version. Later changes affect new jobs, not queued jobs or presets pinned to an explicit model. Published preset versions remain immutable.

## 旧配置兼容 / Existing configurations

v0.1连接未保存协议时继续使用 Chat Completions。启动初始化会补充空的 AI 默认配置，不改写已有预设的固定模型，也不自动选择服务商或启用账号。已有数据库结构无需额外迁移；仍按原 README 的备份与原生进程方式升级。

Connections without a persisted protocol retain Chat Completions behavior. Startup adds empty AI defaults without rewriting pinned presets, choosing providers or enabling accounts. No additional schema migration is needed for this release.

## 参数与调用记录 / Parameters and evidence

模型登记支持参数白名单与默认 JSON；预设可以在白名单内覆盖参数。请求正文、模型名、系统消息和传输方式不能被参数覆盖。

- Responses 把兼容输入 `max_tokens` 映射为 `max_output_tokens`，`reasoning_effort` 映射为 `reasoning.effort`；同步请求固定 `stream:false, store:false`。两种输出长度参数不能同时设置。
- Messages 使用顶层 `system`、原生 `messages` 和 `max_tokens`；未指定长度时使用2048。`reasoning_effort` 不会被猜测转换成 Anthropic 推理配置，需按实际模型配置原生参数。
- 具体模型是否接受温度、推理或生图参数，取决于上游模型。允许参数只表示本平台准许提交，不代替上游兼容性检查。无效请求保留错误并阻塞或进入已有的有限重试流程。

Text writing and review share the selected transport. Responses maps the two documented compatibility parameter names; Messages uses its native schema. Per-model parameter support remains an upstream constraint. Partial Responses results or Messages output-length exhaustion are rejected rather than used as final content.

任务 → 实际提示词，可查看逻辑消息、实际请求体（不含认证头）、协议、请求地址、连接/模型/凭据版本、请求与报告模型、输出、用量和错误。图片调用保存 Images 请求体及产物来源。只有 LF 换行规范化，不在模型返回后拼接标签、替换涨跌幅或截断正文。

Task details expose prompts, the actual wire body without authentication headers, protocol, endpoint, versions, requested/reported model IDs, output, usage and errors. Image calls retain the Images body and asset provenance. Final text receives only LF normalization.

## 管理 API / Management API

| 接口 / Endpoint | 用途 / Purpose |
| --- | --- |
| `GET /api/v1/ai/catalog` | 服务商起点、协议与图片支持 / provider profiles and protocol capabilities |
| `GET /api/v1/ai/settings` | 默认配置、版本与当前可用性 / defaults, version and availability |
| `PATCH /api/v1/ai/settings` | `expectedVersion`、`defaultTextModelId`、`defaultImageModelId` |
| `GET/POST /api/v1/model-connections` | 查询或新建连接 / list or create |
| `PATCH /api/v1/model-connections/:id` | 配置与可选 `apiKey` 原子更新 / atomic config and optional key update |
| `POST /api/v1/model-connections/:id/probe` | 只读检查，`billable:false` / read-only probe |
| `GET/POST /api/v1/models` | 查询或登记实际模型 / list or register |
| `PATCH /api/v1/models/:id` | `expectedVersion`、`approved` |

写接口沿用会话、Origin、CSRF，创建接口带幂等键。默认模型 ID 是平台登记模型的 ID；上游模型名保存在该模型的 `externalId`。预设只使用字符串 `@default` 表示跟随默认，默认配置自身不能再指向 `@default`。

Mutations retain session, Origin, CSRF and creation idempotency checks. Defaults reference registered internal model IDs; the upstream name is the model's `externalId`. Only presets/job requests use the `@default` sentinel; defaults cannot reference themselves.

## 验证边界与依据 / Validation and references

本轮通过原生回环 HTTP 夹具验证三种协议的实际请求体、认证方式、生成/校对、身份记录、默认模型冻结与连接轮换；浏览器验证真实 UI/API 配置闭环。没有使用真实账号或计费模型。远程服务的实际模型权限、参数、限流及目标服务器部署仍需在接入时验证。

Native loopback fixtures validate all three wire schemas, authentication, writing/review, provenance, frozen defaults and rotation. Browser checks exercise the actual UI/API. This does not establish compatibility or access on a real provider account or deployment target.

官方依据：[OpenAI 文本生成](https://developers.openai.com/api/docs/guides/text)、[Responses 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Anthropic 模型列表](https://platform.claude.com/docs/en/api/models/list)。
