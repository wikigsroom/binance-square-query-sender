# 独立 Git 仓库交付 / Independent repository delivery

> **历史归档 / Historical record**：以下是早期两个独立仓库的本地交付记录，不是当前远端仓库状态。当前所有源码已整理为统一仓库，见 [完整指南](../../../README.md) 和 [18 · 整合记录](../../18-repository-delivery.md)。旧 `.bundle` 二进制仅留本机、不随 GitHub 分发；下方恢复命令只适用于持有本地旧包的情况。

当前版本 / Current version: **0.2.0**。两个完整 Git bundle 包含 main、v0.1.0 与 v0.2.0 标签、源码、锁文件、中英文 README、AI接入说明、两张逻辑图、15张实机截图与开发检查记录。均通过 `git bundle verify`，没有真实凭据、数据库、node_modules 或运行日志。

Both complete bundles contain the source history, release tags, bilingual documentation, AI integration guide, two diagrams, fifteen running UI screenshots and development check records. Git verified both bundles. Real credentials, databases, dependencies and runtime logs are excluded.

| 仓库 / Repository | 提交 / Commit | 包 / Bundle |
| --- | --- | --- |
| square-service | `dba328c` | `square-service-v0.2.0.bundle`（本机归档） |
| square-dashboard | `5605c8b` | `square-dashboard-v0.2.0.bundle`（本机归档） |

完整提交 ID、字节数、SHA-256 和检查摘要见 [manifest.json](manifest.json)。打包时两个工作树干净，均无远端和推送。根目录原项目未整体加入 Git。

See the manifest for full commits, sizes, hashes and check results. Both working trees were clean with no remote or push; the original project root remains outside these repositories.

## 恢复 / Restore

在选定的新开发目录中使用本地源码包：

Clone the local source bundles into a new development location:

```powershell
git clone ./square-service-v0.2.0.bundle square-service
git clone ./square-dashboard-v0.2.0.bundle square-dashboard
```

按各仓库 README 安装依赖、初始化配置并启动。克隆后 origin 指向本地 bundle，不连接 GitHub。源码包不是已部署服务器，不包含运行数据库。

Follow each README for dependencies, configuration and startup. The clone's origin points to its local bundle, with no GitHub connection. Bundles are source deliveries, not deployed servers or database backups.

## 检查 / Checks

后端 **43** 项、浏览器 **8** 项通过，两个生产构建通过。56组页面/屏宽/明暗组合无页面错误、整页溢出或受测文本对比度问题，自动检查不等同完整可访问性审计。15张截图使用明确标记的隔离样本；真实 AI 和发帖请求均为0。

**43 backend** and **8 browser flows** passed, with both production builds. The 56 viewport/theme checks found no page errors, document overflow or tested text contrast issues; this is not a complete accessibility audit. Fifteen screenshots use clearly labeled fixtures, with zero real AI or publication requests.

原生 PostgreSQL 多进程、真实上游模型/广场服务及目标服务器部署仍需目标环境验证。本轮临时开发服务和浏览器已关闭。

Native PostgreSQL multi-process behavior, actual provider/Square compatibility and deployment still require target-environment verification. Temporary development services and browsers were closed.

## 初始版本 / Initial version

v0.1.0 保留：[原清单](manifest-v0.1.0.json)；`square-service-v0.1.0.bundle` 和 `square-dashboard-v0.1.0.bundle` 仅留本机。v0.2.0 本机包包含两次交付的历史和标签。

The initial manifest and bundles remain available. The current bundles include both releases' history and tags.
