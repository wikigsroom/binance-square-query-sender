# 远程部署辅助文件

用于将独立的 `square-service` 和 `square-dashboard` 部署到 Ubuntu 原生 Node.js、PostgreSQL、Nginx 和 systemd，不使用容器或虚拟化环境。

实际部署地址、状态、验证结果和维护命令见 [远程部署记录](../../docs/11-remote-deployment.md)。`bn-api-proxy.conf.example` 供使用者手动配置 API 域名；本次没有修改该域名的站点。

2026-10-22 来源升级及已完成的生产网页登录验证见 [素材与新闻来源升级](../../docs/12-sources-and-market-upgrade.md)。当前版本 `20261022-sources` 已部署，API 代理已由使用者完成。

后续版本 `20261022-key-import` 已部署，见 [仅 Key 批量导入账号](../../docs/13-key-only-account-import.md)。

10 种配套新生图的内容预设已通过现有 API 导入，无需重新部署服务，见 [预设库说明](../../docs/14-ten-content-presets.md)。`scripts/import-content-presets.sh` 创建和发布预设配置；`verify-content-presets.mjs` 核验生产页面并关闭浏览器。

当前版本 `20261022-cors-put` 已部署，修复账号预设绑定和周期保存的 PUT 预检，见 [账号保存跨域修复](../../docs/15-account-bindings-cors-fix.md)。`scripts/verify-bindings-cors.sh` 和 `verify-bindings-cors.mjs` 分别核验原生 API 与实际生产浏览器的跨域请求，不修改账号配置。

随后已按用户要求开启全部7个账号的自动发布，复用样例的8个等权预设与20—40分钟随机周期，见 [当前运行状态](../../docs/16-auto-publishing-enabled.md)。全局已恢复，服务器实际发布传输已启用；此前验证报告中的暂停状态仅是当时的历史记录。`scripts/enable-auto-publishing.sh` 为本次配置操作，不能当作定时任务重复执行；`verify-auto-publishing.mjs` 读取页面与账号状态并关闭本轮浏览器。

此前版本 `20261022-publish-first` 已部署。用户要求内容校验不阻止发布，现已启用全局 `contentValidationMode=publish_first`，见 [排查与发送优先说明](../../docs/17-publication-validation-and-priority.md)。`scripts/inspect-publication-validation.sh` 只读获取具体失败、模型输出、逐轮校验与远端回执；`scripts/enable-publish-first.sh` 设置运行模式，并逐账号恢复最近一个未提交的内容校验失败任务；`verify-publication-validation.mjs --publish-first` 核验生产运行界面并关闭浏览器。

此前生图策略版本为 `20261022-industry-memes`，所有新生图只允许各行各业的 meme 梗图。`scripts/update-meme-image-policy.sh` 只更新十份预设的图片部分并保留正文和账号设置；`scripts/verify-meme-image-policy.sh` 核验线上策略、版本和服务，不请求付费模型，见[生图策略记录](../../docs/19-industry-meme-image-policy.md)。

最新生产版本为 `20261023-text-image-isolation`，隔离文字与图片模型的配置，防止梗图脚本进入文章。`scripts/verify-writing-image-isolation.sh` 只读重建问题任务的写作请求并检查线上版本、历史上下文与后续调用，不请求付费模型，详见[排查与修复记录](../../docs/20-writing-image-context-isolation.md)。

- `ssh_remote.py`：原生 SSH/SFTP，连接配置从被忽略的 `.private/ssh.json` 读取。
- `package_release.py`：只打包后端生产构建、迁移文件、锁文件和前端静态构建。
- `scripts/inspect-*.sh`：只读检查服务器和既有运行环境。
- `scripts/prepare-directories.sh`、`install-release.sh`：首次安装专用用户、独立数据库、生产配置和服务；已有资源时停止，不能用于覆盖或日常升级。
- `scripts/deploy-frontend.sh`：备份并安装首次前端文件和 SPA 配置。
- `scripts/verify-server.sh`：使用私有初始化记录验证真实生产登录、数据库、会话和静态站点，输出不含凭据的结果。
- `scripts/restart-service.sh`：仅重启本应用并等待存活检查。
- `scripts/upgrade-sources.sh`：本次来源升级使用的原生部署脚本，检查活动任务、备份专用数据库和配置、保留前端运行配置并切换版本，失败时回退；拒绝覆盖已存在的版本目录。
- `scripts/upgrade-release.sh`：后续版本的原生升级入口，读取服务器上传目录的 `upgrade-manifest.json`，校验版本与产物摘要；保留既有运行配置并执行备份和回退保护。
- `scripts/verify-sources.sh`：生产登录后读取三家来源并核对正文、行情、筛选和证据；不调用模型或发布帖子。
- `square-platform.service`：已部署的服务单元。

`.private/`、`artifacts/`、日志和 Python 缓存均由本目录 `.gitignore` 排除。不要把初始化凭据复制进源代码、部署说明或发布产物。生产运行配置位于服务器的 `/etc/square-platform/square.env`。
