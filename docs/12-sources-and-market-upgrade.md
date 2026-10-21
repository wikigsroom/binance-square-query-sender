# 12 · 素材、新闻来源与币安现货升级

日期：2026-10-22（Asia/Taipei）。状态：代码、自动检查和生产部署均已完成，已通过实际 HTTPS 登录读取验证。

## 使用入口

打开 [素材与新闻来源](https://bn.sid.mom/settings?section=sources)，可查看币安现货、金色财经、区块律动三个内置来源。页面提供：

- 来源说明、启停、素材时效、最近成功时间、读取条数和具体错误。
- 单来源刷新及“读取全部已启用来源”；一个来源失败不影响其他来源返回结果。
- 新闻标题/正文搜索、币种代码筛选、报道时间范围、正文展开、官网原文和实际读取来源链接。
- 币安现货涨跌幅 Top 5、交易对搜索、最新价、滚动 24 小时涨跌幅与 USDT 成交额。
- 新增来源时自动填充内置模板的官网地址、读取域名与默认时效。

新闻支持 `BTC`、`ETH`、`SOL` 等代码，以及常见中英文名称关联，例如 `ETH` 可以匹配“以太坊”。关联仅用于查找材料，不将板块或市场消息自动认定为某个代币的直接利好。

在「内容预设 → 素材与来源」中选择任务使用的来源、优先级、最大时效和是否必需。新建预设示例包含必需的币安行情及可选的两家新闻；升级不会覆盖已有不可变预设版本。要给已有预设增加金色财经，需编辑草稿并发布新版本。

## 实际读取方式与限制

| 来源 | 实际接入 | 读取内容及边界 |
| --- | --- | --- |
| [金色财经](https://www.jinse2.com/lives) | 网站使用的公开快讯接口 `api.jinse2.com/noah/v2/lives` | 最多三页、每页 20 条，使用 `bottom_id` 翻页；保留完整快讯、标题、报道时间、官网链接及报道引用链接 |
| [区块律动](https://www.theblockbeats.info/newsflash) | 优先官方 RSS；不可用时读取 [律动官方公开频道](https://t.me/s/theblockbeats)；必要时尝试网页及可读原文 | 公开频道最多三页、每页约 20 条；保留官网原文地址和逐条频道证据地址，界面明确显示“律动官方公开频道” |
| 币安现货 | `api.binance.com/api/v3/exchangeInfo` 与 `/api/v3/ticker/24hr` | 交易中的 USDT 现货、有成交、有效且新鲜的数据；官方公开数据域名 `data-api.binance.vision` 为备用 |

这是有界的近期材料读取，**不是全站历史索引或历史回填**。搜索范围在页面中明确显示为“已扫描”条数；选择近 7 天不会自动回填七天历史，且仍受来源配置的最大时效限制。单次读取通常最多 60 条，遇到页面不足、过期材料、无正文/日期或重复链接会更少。新闻正文只保存在受鉴权的来源快照中，不在公开文档中复制全文。

实测律动官网存在 403/超时，旧免费快讯接口及当前官方 RSS 返回空 JSON。空响应会记录 `NEWS_FEED_EMPTY`，不会假装采集成功。当前生产通过官方公开频道取得完整快讯，状态显示“备用来源可用”；官网原文地址不代表已经读到了官网正文。官方 Pro API 需要单独订阅与凭据，本轮未调用或配置该付费接口。

官方参考：[律动 RSS v2](https://github.com/BlockBeatsOfficial/RSS-v2)、[律动 API 文档](https://www.theblockbeats.info/apiDoc)、[币安公开市场数据域名](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)。

## 币安读取失败的根因与修复

升级前生产接口原始错误为 `RESPONSE_TOO_LARGE`，提示“远端响应超过上限”。未经精简的 `exchangeInfo` 超过通用 HTTP 读取器原有 8 MiB 限制。

现在对币安使用 `?permissions=SPOT&showPermissionSets=false`，省去不需要的权限集合，并单独配置交易信息 24 MiB、行情 12 MiB 的上限；其他新闻请求维持较小上限。官方备用域名仍受来源允许域名校验，429 限流不会触发切换域名继续请求。

榜单仅包含 `TRADING`、USDT 报价、允许现货、成交额大于零、涨跌幅有效且 `closeTime` 距当前不超过 15 分钟的交易对。正涨幅和负涨幅分别排序取前五；这是币安现货**滚动 24 小时**统计，不能描述成自然日涨跌幅。固定币种预设可从完整有效市场查找，不再只查榜单前十。

## 时效、缓存与写作证据

- 成功读取共享最多 60 秒缓存；相同来源的进程内并发读取合并，失败后 30 秒退避。缓存与错误保存在 PostgreSQL 的 `source_reads` 中，服务重启后可查。
- 手动刷新发起新读取；来源配置变更使旧缓存失效。失败时保留最后成功时间供诊断，但不把旧正文当作本次成功结果交给写作流程。
- 报道时间同时保存 UTC 时间、北京时间日期及 `Asia/Shanghai` 时区；界面明确显示北京时间，避免凌晨报道被引用成前一天。
- 快讯保留来源简写、标题、正文、官网地址、实际读取地址、读取方式、内容摘要与相关币种，实际用于任务的材料另存为任务快照。
- AI 成稿输入包含真实来源和北京时间报道日期；校验支持“金色财经”“律动”及对应日期，保留引用原句检查。外部正文始终作为资料，不执行其中的指令。
- 新闻无匹配和来源故障分别记录；必需来源不可用阻塞对应任务，可选新闻可以省略并说明原因。没有可靠消息时不补造事实。

## 管理 API 与代码位置

所有新增管理接口沿用登录会话、受限 Origin 和写请求 CSRF 校验：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/data-sources/catalog` | 内置类型、地址、允许域名和默认时效 |
| `GET /api/v1/data-sources` | 来源配置与最后读取状态 |
| `POST /api/v1/data-sources/probe-all` | 独立读取各启用来源，逐项返回成功或具体错误 |
| `POST /api/v1/data-sources/:id/probe` | 强制刷新单来源 |
| `GET /api/v1/data-sources/:id/content?q=&tokens=ETH&hours=24` | 有界材料搜索、筛选、状态和证据 |

后端代码在 `app/square-service/src/source-catalog.ts`、`news-parsers.ts`、`source-readers.ts`、`sources.ts`，前端在 `app/square-dashboard/src/pages/source-settings.tsx`。仅新增 `source_reads` 表，不重置现有数据库。新闻与行情使用公开 HTTP，不携带币安广场或模型凭据。

## 检查结果

| 检查 | 本次结果 |
| --- | --- |
| 后端类型检查、生产构建、完整测试 | 通过；52/52 项测试，包括大响应、备用域名、两家新闻解析、日期、缓存、错误隔离和写作快照 |
| 前端类型检查、生产构建、完整 Chromium 测试 | 通过；11/11 项，包括真实隔离后端下的来源预览、搜索、筛选、批量读取和移动布局 |
| 生产管理员 HTTPS 登录与实际来源读取 | 通过；实测币安 515 个有效交易对，金色与律动分别读取 60 条；数量随实时数据变化 |
| 生产浏览器搜索、ETH 关联筛选及移动布局 | 通过；业务请求无失败，无页面 JavaScript 错误，无整页横向溢出 |
| 业务边界 | 本轮实际模型调用 0 次、广场发布 0 条；发布暂停状态和原有两条 AI 连接保持 |

证据：[服务器验证](source-upgrade/server-verification.json)、[生产浏览器验证](source-upgrade/browser-verification.json)、[检查汇总](source-upgrade/check-results.json)。生产浏览器中有一条非业务 Cloudflare 统计脚本被现有 CSP 拒绝，未放宽站点策略；不影响来源读取。检查结束后已关闭启动的浏览器与临时开发服务。

实际界面：[现货行情](source-upgrade/production-market.png)、[金色快讯](source-upgrade/production-jinse.png)、[律动快讯](source-upgrade/production-blockbeats.png)、[移动端](source-upgrade/production-mobile.png)。

## 生产部署与恢复位置

- 前端继续部署到 `/www/wwwroot/bn.sid.mom`，保留站点的 `app-config.js` 和现有反向代理配置。
- 原生 systemd 服务 `square-platform.service` 继续监听 `0.0.0.0:39410`；当前版本为 `/opt/square-platform/releases/20261022-sources`，通过 `/opt/square-platform/current` 使用。
- 使用者已完成 `https://bn-api.sid.mom` 代理，实际网页登录闭环已验证；11 号文档中的代理待配置记录属于初次部署时的状态。
- 升级前独立数据库、运行配置和旧前端备份位于 `/opt/square-platform/backups/20261022-sources/`。数据库连接、加密主密钥、两条已配置模型连接、全局暂停及发布传输开关均保留。
- 升级脚本为 `app/deployment/scripts/upgrade-sources.sh`，带部署互斥、活动任务检查、备份及切换失败回退；同一版本目录已存在时会拒绝覆盖。它已经执行，不能作为“刷新来源”的日常命令重复运行。

来源状态与本文中的条数是验收时的观察结果；站点、公开接口或频道变更后会保留具体失败原因，由运行状态反映最新可用性。
