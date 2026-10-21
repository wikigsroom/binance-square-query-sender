# 13 · 批量导入账号仅填写 API Key

日期：2026-10-22。状态：已部署并完成生产界面与接口验证。

## 操作方式

进入 [账号与计划](https://bn.sid.mom/accounts)，点击「批量导入」。每行粘贴一个币安广场 API Key，再点击「开始导入」。无需账号名称、UID、标签或备注；单次最多1000个。

系统忽略空行、清除首尾空白，自动生成形如“广场账号 A13C5E79”的本地名称，后续可以修改。自动名称不是从币安读取的平台昵称。

导入结果按原始粘贴行号显示成功、重复或错误，附成功账号名称或错误说明。重复 Key 不会重复创建账号，某行错误不阻止其他有效行导入。提交完成后清空输入区，报告不回显原始 Key。

导入成功表示已保存凭据，不表示远端认证已验证。新账号自动计划默认暂停，预设绑定仍在账号管理中设置；导入不会发帖。

## 根因与修改

原界面按“名称,API Key,UID”解析每行，后端 `createAccount` 同时要求名称，所以只填写 Key 无法导入。现在界面按单列 Key 构造请求，后端批量入口为未提供名称或名称为空的记录生成本地名称；单账号创建与其他资料管理保持原有行为。

`POST /api/v1/accounts/import` 最小请求：

```json
{"accounts":[{"apiKey":"YOUR_SQUARE_API_KEY"}]}
```

接口仍接受可选 `name`、`uid`、`tags` 和 `notes`，兼容已有调用。返回每条的 `line`、`status`、成功账号的 `accountId`/`name`，或错误的 `code`/`message`。空批次或超过1000条返回 `INVALID_IMPORT`；重复凭据返回该行 `DUPLICATE_CREDENTIAL`。不会通过实际发布来测试导入凭据。

## 验证与部署

- 后端构建通过，53/53项测试通过，覆盖仅 Key 导入、自动命名、空名称、既有资料兼容、同批与既有重复、错误隔离、幂等重放及默认暂停。
- 前端构建通过；原有11项浏览器检查通过，新增导入检查在修正测试对排版空白的匹配后复测通过。验证了请求只含 Key、空行与首尾空白、原始行号、结果分类、导入后列表及移动布局。
- 生产通过 HTTPS 实际登录，验证窗口仅有一个输入区，Key 单字段请求能到达凭据校验，格式错误不会再误报缺少名称。生产验证使用特意无效的短值，未创建测试账号，未调用模型或发布。
- 服务 `square-platform.service` 运行正常，API 仍监听39410；部署版本 `/opt/square-platform/releases/20261022-key-import`，升级前备份 `/opt/square-platform/backups/20261022-key-import`。
- 保留现有数据库、两条模型连接、全局暂停、发布传输开关及前端 API 配置。升级不覆盖既有账号资料。

证据：[生产浏览器验证](account-import-upgrade/browser-verification.json)、[检查汇总](account-import-upgrade/check-results.json)、[桌面界面](account-import-upgrade/production-import.png)、[移动界面](account-import-upgrade/production-import-mobile.png)。本次启动的浏览器及临时开发服务已在验证后关闭。

代码位于 `app/square-dashboard/src/pages/accounts.tsx` 与 `app/square-service/src/control.ts`。原生升级使用 `app/deployment/scripts/upgrade-release.sh`，从服务器上传目录的 `upgrade-manifest.json` 读取版本与校验摘要；具备部署互斥、活动任务检查、备份和切换失败回退，不覆盖既有版本目录。
