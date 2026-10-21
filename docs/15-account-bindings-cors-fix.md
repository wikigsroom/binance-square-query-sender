# 15 · 账号预设保存的跨域修复

日期：2026-10-22（Asia/Taipei）。修复版本：`20261022-cors-put`。

## 问题与原因

前端在 `https://bn.sid.mom`，API 在 `https://bn-api.sid.mom`。账号预设权重保存使用 `PUT /api/v1/accounts/:id/preset-bindings`，浏览器发送带 Cookie、JSON 与 CSRF 头的跨域请求前，会先发送 `OPTIONS` 预检。

原后端只允许 `GET, HEAD, POST, PATCH, DELETE`，漏掉了已经存在的 `PUT` 接口。线上直连后端复现返回 HTTP 403、`ORIGIN_REJECTED`，实际 `PUT` 因而没有发出。账号随机周期保存 `PUT /api/v1/accounts/:id/schedule` 受到同样影响。

## 修改

后端增加 `PUT`，并让请求方法检查与 `Access-Control-Allow-Methods` 响应头共用一份列表：`GET, HEAD, POST, PUT, PATCH, DELETE`。继续限定前端 Origin、允许的请求头、Cookie 会话和 CSRF；不使用通配符跨域配置。

浏览器控制台的 Cloudflare Insights 提示是外部统计脚本受 `script-src 'self'` 限制的结果，与保存绑定的预检失败不同。本次保留既有脚本来源限制。

## 验证

- 修复前：新增回归检查稳定复现 `403 !== 204`；线上后端也返回相同错误。
- 修复后：后端构建与54项测试全部通过。新增检查覆盖预设权重保存与回读、周期保存、过期版本冲突，以及未登录、缺少 CSRF、错误 Origin 和不允许的请求头拒绝。
- 本地隔离浏览器：2项跨域检查通过，其中一项实际点击保存权重，关闭账号再打开确认持久化，并恢复原权重。
- 生产验证：检查两个 `PUT` 接口的预检、实际跨域鉴权请求与版本冲突响应，保持既有账号配置、周期和全局暂停状态。具体结果以报告为准。

本次不触发内容生成或币安广场发布。生产写路径核验使用必定过期的版本号，在变更任何绑定前返回冲突；真实保存和持久化已在隔离数据中验证。

## 产物

- [修复前线上响应](cors-put-fix/before.json)
- [生产接口核验](cors-put-fix/server-verification.json)
- [生产浏览器核验](cors-put-fix/browser-verification.json)
- [部署产物清单](cors-put-fix/release.json)
- [检查与代码版本](cors-put-fix/checks.json)

最终结果：上述生产接口和生产浏览器核验均通过；预检已由 403 改为 204。两个子域间的实际浏览器 PUT 可以读取服务端 JSON 响应，未出现 CORS 失败。全局保持暂停，发布传输保持关闭。

部署沿用原生 Node.js、PostgreSQL 与 systemd 升级流程，备份专用数据库及配置，保留既有前端运行配置。没有使用 Docker 或 WSL。浏览器核验后关闭本轮浏览器；本地开发服务在验证后停止。
