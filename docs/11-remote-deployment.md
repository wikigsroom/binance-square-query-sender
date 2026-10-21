# 11 · 远程部署记录

后续状态：使用者已完成 API 域名代理，来源升级与最终生产网页登录验收见 [12 · 素材与新闻来源升级](12-sources-and-market-upgrade.md)。本文保留初次部署时的配置与检查结果。

部署日期：2026-10-22（Asia/Taipei）。当前状态：前端静态文件和生产 API 已部署；API 域名的反向代理按使用者要求留待手动配置。

## 运行位置

| 项目 | 实际配置 |
| --- | --- |
| 服务器 | `43.165.167.179`，Ubuntu 24.04 |
| 前端地址 | `https://bn.sid.mom` |
| 前端静态目录 | `/www/wwwroot/bn.sid.mom` |
| API 域名 | `https://bn-api.sid.mom`，反向代理待配置 |
| API 监听 | `0.0.0.0:39410` |
| 同机反向代理目标 | `http://127.0.0.1:39410`，完整保留请求路径 |
| systemd 服务 | `square-platform.service`，已启用开机启动 |
| 服务用户 | `square-platform` |
| 生产版本 | `/opt/square-platform/releases/20261022-split-origin/service` |
| 当前版本链接 | `/opt/square-platform/current` |
| 数据目录 | `/opt/square-platform/data` |
| 运行配置 | `/etc/square-platform/square.env`，root 专用权限 |
| 数据库 | 原生 PostgreSQL 16，端口 `5433`，独立数据库和角色 `square_platform` |
| 部署前备份 | `/opt/square-platform/backups/20261022-split-origin/` |
| 管理员 | `owner`；初始密码单独交付，不写入本文 |

复用服务器已有 Node.js 24.19.0 和 PostgreSQL 服务，未调用 Docker、WSL 或虚拟机。服务器另有其他数据库实例，本次没有修改其配置或重启共享数据库。API 与后台 Worker 由同一个 systemd 进程运行，持久状态存入数据库。

## 待手动配置的 API 代理

在 `bn-api.sid.mom` 的已有站点中配置代理到 `http://127.0.0.1:39410`，保留 `/api/v1/...` 等原始路径。可参考 [Nginx location 示例](../app/deployment/bn-api-proxy.conf.example)。API 域名需通过 HTTPS 访问，不能缓存登录、管理接口或受保护图片，也不应另加通配符 CORS。

前端通过 `/app-config.js` 指向 `https://bn-api.sid.mom`。本次未修改 API 域名的 Nginx 站点；检查时该域名仍返回宝塔默认站点的 HTML 404，因此目前网页会显示无法连接后端。完成代理后，未登录请求 `https://bn-api.sid.mom/api/v1/auth/me` 应返回 JSON 401，随后即可使用管理员账号在前端登录。

前端站点已配置 SPA 路由回退，刷新 `/overview` 等路径可返回入口页面；原静态目录、前端 vhost 和 rewrite 文件已备份。

## 为拆分域名补充的实现

- 后端仅允许配置的前端 Origin 携带 Cookie 跨域请求，并校验预检的方法和请求头；写入接口仍检查 Origin、登录态和 CSRF。
- 前端请求统一使用可配置的 API 地址和 `credentials: include`；受保护图片也使用该 API 地址。
- 生产登录 Cookie 使用 Secure、HttpOnly、SameSite=Strict 和主机作用域。两个子域通过 HTTPS 使用。
- systemd 配置使用独立运行用户、数据写入范围、失败自动重启和资源上限。

## 验证结果与边界

| 检查 | 结果 |
| --- | --- |
| 后端构建与测试 | 构建通过，44 项测试通过 |
| 前端构建与浏览器测试 | 构建通过，9 项测试通过，包含跨域登录与图片 |
| 实际生产管理员登录、会话、注销、CSRF | 通过 |
| 实际生产 CORS 预检和安全 Cookie | 通过 |
| PostgreSQL、Worker、全局暂停状态 | 正常 |
| API 公网高端口 | 可访问；未登录接口返回 JSON 401 |
| systemd 重启及重启后登录 | 通过；未执行服务器整机重启 |
| 前端公网 HTTPS 与 SPA 路由 | 正常，实际浏览器未发现 JS 页面错误 |
| API 域名代理及生产网页登录闭环 | 待使用者配置代理；当前 HTML 404 |

检查结果见 [服务器验证](deployment/server-verification.json)、[公网浏览器检查](deployment/browser-check.json) 和 [部署汇总](deployment/results.json)。浏览器截图为 [配置 API 代理之前的实际页面](deployment/frontend-before-api-proxy.png)。检查后已关闭本次浏览器。

这是新的独立生产数据库，尚未导入历史账号、API Key、帖子、AI 服务商或图库。初始全局发布暂停，`SQUARE_PUBLISH_ENABLED=false`；本次没有真实 AI 计费请求或币安广场发帖。后台 Worker 存活与发布已经开启是两个不同状态。

## 维护

```bash
sudo systemctl status square-platform.service --no-pager
sudo journalctl -u square-platform.service -n 100 --no-pager
sudo systemctl restart square-platform.service
```

后续备份需同时保留独立 PostgreSQL 数据库、`/opt/square-platform/data` 和受保护运行配置中的加密主密钥。仅备份数据库不足以恢复加密凭据。不要重启或删除服务器上的共享 PostgreSQL 实例来处理本应用故障。

部署辅助脚本保存在 `app/deployment/`。首次安装脚本会拒绝覆盖已存在的生产数据库、环境配置和版本目录；它不是可重复执行的日常升级脚本。SSH 配置、数据库密码、加密密钥和管理员初始密码只放在被忽略的私有部署文件中，未写入文档或代码仓库。
