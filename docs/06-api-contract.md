# 06 · Dashboard 与后端 API 契约草案

接口前缀 `/api/v1`。以下为拟实现的内部管理接口，不代表币安广场对外 API，也不意味着这些路由已经存在。

## 通用约定

- ID 使用不携带 Key 或账号顺序的稳定标识；时间统一 ISO 8601 UTC，界面默认以 Asia/Taipei 展示。
- 同站点管理员会话认证；写请求具有相应的会话/跨站请求保护。后台工作进程使用独立内部身份。
- 列表采用 `cursor`、`limit`，上限由服务端限制；同一排序以 ID 作第二排序键。
- 异步生成、发布、核验返回 `202` 与任务 ID；客户端通过任务详情或事件流读取进度。
- 手动执行和外部副作用请求要求 `Idempotency-Key`；同键同参数返回同一任务，不同参数返回冲突。
- 更新预设、账号绑定和调度携带 `expectedVersion`；版本不符返回409，避免覆盖并发修改。
- Key 只通过新增/轮换接口写入；响应、列表、导出和普通日志不含完整 Key。

成功结构：

```json
{
  "data": { "id": "job_example", "status": "queued" },
  "meta": { "requestId": "req_example" }
}
```

列表结构：

```json
{
  "data": [],
  "meta": { "requestId": "req_example", "nextCursor": null, "hasMore": false }
}
```

错误结构：

```json
{
  "error": {
    "code": "AI_PROVENANCE_REQUIRED",
    "message": "当前发送文字没有对应的 AI 成稿记录。",
    "stage": "publish_gate",
    "resourceId": "job_example",
    "retryable": false,
    "details": { "requiredAction": "regenerate_text" }
  },
  "meta": { "requestId": "req_example" }
}
```

外部服务原始错误保存在去除敏感字段后的任务事件中，可通过详情查询；不为了友好文案而丢弃原始错误码。

## 认证、总览和运行控制

| 方法与路径 | 行为 |
| --- | --- |
| `POST /auth/login` | 建立管理员会话 |
| `POST /auth/logout` | 注销会话 |
| `GET /auth/me` | 当前管理员与权限 |
| `GET /overview` | 账号、任务、发布/核验统计和下一次计划 |
| `GET /health` | API、数据库、调度/工作心跳与存储状态；敏感连接细节需登录 |
| `GET /runtime` | 全局暂停、并发、当前活动任务和控制版本 |
| `PATCH /runtime` | 全局暂停/恢复与运行设置，带版本校验和审计 |

## 账号、凭据与预设绑定

| 方法与路径 | 行为 |
| --- | --- |
| `GET /accounts` | 按名称、UID、标签、凭据健康、调度状态查询 |
| `POST /accounts` | 创建账号并写入初始 Key；默认暂停 |
| `GET /accounts/{id}` | 账号详情、掩码、计划、绑定和最近任务 |
| `PATCH /accounts/{id}` | 修改账号名称、标签、状态等信息 |
| `POST /accounts/import` | 每条仅需 `apiKey`；自动生成名称，逐条报告成功、重复与错误；不自动启用 |
| `POST /accounts/{id}/credentials/rotate` | 轮换广场 Key，保留账号与历史 |
| `POST /accounts/{id}/credentials/verify` | 若有已验证只读能力则检查；否则返回不支持，不能测试发帖 |
| `GET /accounts/{id}/preset-bindings` | 绑定预设、权重、有效概率和排除原因 |
| `PUT /accounts/{id}/preset-bindings` | 原子替换绑定集合，检查有效权重和版本 |
| `POST /accounts/{id}/archive` | 归档并暂停，保留历史 |

绑定请求示例：

```json
{
  "expectedVersion": 4,
  "bindings": [
    { "presetId": "preset_market", "weight": 7, "enabled": true },
    { "presetId": "preset_news", "weight": 3, "enabled": true }
  ]
}
```

轮换凭据的响应返回凭据版本、掩码与验证状态，不回显新 Key。

批量导入最小请求为 `{"accounts":[{"apiKey":"YOUR_SQUARE_API_KEY"}]}`，每批1—1000条。`name`、`uid`、`tags`、`notes` 均可省略；兼容已有接口调用中提供的可选资料。单条失败不回滚其他成功条目，成功项返回自动生成的 `name` 与 `accountId`，结果不包含原始 Key。UI 忽略空行，报告将接口中按有效条目计数的 `line` 映射回原始粘贴行号。

## 调度

| 方法与路径 | 行为 |
| --- | --- |
| `GET /schedules` | 跨账号计划与实际下次到期时间 |
| `GET /accounts/{id}/schedule` | 规则、抽样、起点、阻塞及版本 |
| `PUT /accounts/{id}/schedule` | 保存随机间隔规则，默认不重排已有一次时间 |
| `POST /accounts/{id}/schedule/pause` | 暂停该账号自动发送，提升控制版本 |
| `POST /accounts/{id}/schedule/resume` | 解除可解除的暂停，从恢复时间重抽第一轮 |
| `POST /accounts/{id}/schedule/resample` | 在无活动发布任务时重排下一次 |
| `POST /accounts/{id}/publications` | 创建手动的一次发布任务；默认按绑定权重选预设 |

规则示例：

```json
{
  "expectedVersion": 2,
  "enabled": true,
  "minIntervalSeconds": 1200,
  "maxIntervalSeconds": 2400
}
```

该示例表示20—40分钟，不是默认平台间隔。返回应包括 `nextDueAt`、`sampledDelaySeconds`、`anchorAt`、`version` 和已应用/保持本次到期时间的说明。

立即执行为异步请求；已有活动任务时返回该任务或明确409冲突，不创建同账号并行任务。仅暂停自动计划且账号仍可用时，可以显式立即执行；停用、归档或存在发布阻塞时不可提交。手动执行不会把原本暂停的自动计划开启。

## 预设与预览

| 方法与路径 | 行为 |
| --- | --- |
| `GET /presets` / `POST /presets` | 查询与新建 |
| `GET /presets/{id}` / `PATCH /presets/{id}` | 详情与修改草稿 |
| `POST /presets/{id}/clone` | 复制规则，新建独立预设 |
| `POST /presets/{id}/publish-version` | 校验并生成不可变的已发布版本 |
| `GET /presets/{id}/versions` | 版本历史与变更摘要 |
| `GET /presets/{id}/versions/{version}` | 精确版本内容 |
| `POST /presets/{id}/preview` | 创建不发布的预览任务，可选择是否创建新图 |
| `POST /publication-jobs/{id}/ai-revisions` | 根据修改要求创建新的 AI 内容版本 |

预览响应指向独立任务，不能以一个 `send=true` 参数将原预览接口改成无校验发送。正式发送创建发布任务并重新检查事实时效与全部关口。

## 图库与生图

| 方法与路径 | 行为 |
| --- | --- |
| `GET /assets` | 按来源、集合、标签、风格、比例、使用时间查询 |
| `POST /assets/upload` | 接收已有图片，校验后登记图库来源 |
| `POST /assets/import` | 从部署时指定的服务器受管目录迁入已有图片；不接受任意服务器路径 |
| `GET /assets/{id}` | 元数据、来源、内容摘要和使用记录 |
| `GET /assets/{id}/content` | 经权限校验的图片读取 |
| `PATCH /assets/{id}` | 更新标签、集合或启停，不改写原始来源 |
| `POST /image-jobs` | 使用批准的 GPT Image 2 连接创建生图任务 |
| `GET /image-jobs` / `GET /image-jobs/{id}` | 生图排队、进度、错误和图库产物 |

生图请求示例：

```json
{
  "modelId": "model_gpt_image_2",
  "prompt": "管理员填写的图片生成要求",
  "presetVersionId": "preset_image_v1",
  "requestedAspectRatio": "1:1",
  "count": 1
}
```

实际允许参数由已验证的模型能力决定。`model_gpt_image_2` 是内部引用示例，不冒充外部实际 API 模型 ID。

## 帖子、执行与核验

| 方法与路径 | 行为 |
| --- | --- |
| `GET /posts` | 按正文、账号、代币、预设、版本、模型、来源、时间、发布/核验状态查询 |
| `GET /posts/{id}` | 最终内容、图片、来源、生成与提交记录、链接和核验 |
| `POST /posts/{id}/verify` | 新建只读核验任务，不发送 |
| `GET /publication-jobs` / `GET /publication-jobs/{id}` | 执行列表与阶段、配置快照、当前能力 |
| `GET /publication-jobs/{id}/events` | 分页时间线和去除敏感字段的原始错误 |
| `POST /publication-jobs/{id}/cancel` | 取消尚可停止的阶段；已提交则返回真实在途状态 |
| `POST /publication-jobs/{id}/retry` | 仅对后端判定可安全恢复的步骤重试，复用任务 |
| `GET /generation-runs/{id}` | 实际模型、提示词、参数、输入事实、输出版本与请求标识 |

`GET /posts` 查询参数：`q`、`accountIds`、`tokens`、`presetId`、`presetVersionId`、`modelId`、`sourceId`、`publishStatus`、`verificationStatus`、`dateField`、`from`、`to`、`remotePostId`、`cursor`、`limit`。

为覆盖未成功发送的内容，帖子列表应可联查相应任务和当前内容版本；早于文字产出的失败任务在任务中心显示，不虚构为空正文的远端帖子。

## 模型连接与数据源

| 方法与路径 | 行为 |
| --- | --- |
| `GET /model-connections` / `POST /model-connections` | 查询和建立连接，凭据为写入字段 |
| `PATCH /model-connections/{id}` | 修改端点、状态、并发和支持参数 |
| `POST /model-connections/{id}/credentials/rotate` | 轮换模型服务凭据 |
| `POST /model-connections/{id}/probe` | 检查连接与模型能力，明确是否包含会计费的生成检查 |
| `GET /models` / `POST /models` | 查询/登记批准模型及 text/image 类型 |
| `GET /data-sources` / `POST /data-sources` | 查询/配置允许的数据源及必需字段 |
| `PATCH /data-sources/{id}` | 修改读取参数和启用状态 |
| `POST /data-sources/{id}/probe` | 只读取来源并报告事实结构、日期与错误 |

## 错误类别

| 错误码 | 业务含义 |
| --- | --- |
| `INVALID_INTERVAL_RANGE` | 随机间隔非法 |
| `NO_ELIGIBLE_PRESET` | 无启用且兼容的正权重预设 |
| `ACCOUNT_BUSY` / `CONFIG_VERSION_CONFLICT` | 同账号已有活动任务/配置已改变 |
| `ACCOUNT_CREDENTIAL_INVALID` | 广场认证明确异常 |
| `TEXT_MODEL_UNAVAILABLE` / `TEXT_VALIDATION_FAILED` | 模型不可用/文字不符合规则 |
| `AI_PROVENANCE_REQUIRED` / `CONTENT_HASH_MISMATCH` | 无成稿证据/最终内容被改动 |
| `ASSET_PROVENANCE_INVALID` / `ASSET_UNAVAILABLE` | 图片来源或实体不合法 |
| `REQUIRED_SOURCE_UNAVAILABLE` / `FACTS_STALE` | 必需数据不可用/过期 |
| `GLOBAL_PAUSED` / `ACCOUNT_PAUSED` / `STALE_LEASE` | 发布控制或租约不允许提交 |
| `PUBLISH_RESULT_UNKNOWN` | 请求可能已生效，禁止直接重发 |
| `REMOTE_RATE_LIMITED` / `REMOTE_REJECTED` | 远端限流/明确拒绝，保留原始码与消息 |

HTTP 400/422 用于输入或规则错误，401/403 用于认证权限，409 用于版本和执行冲突，429/502/503 用于适用的容量或服务不可用反馈；业务恢复判断始终同时看结构化错误与步骤状态。
