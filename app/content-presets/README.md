# 10 种内容与生图预设

此目录维护平台的可移植预设配置，不包含发布正文、API Key 或自动运行计划。完整方向、篇幅、新闻策略和已完成的生产核验见 [14 · 预设库说明](../../docs/14-ten-content-presets.md)。

## 配置来源

- `build-pack.mjs`：10 份人工编写的内容方向与独立生图要求，输出 `presets.json`。这些是给模型的要求，实际发送正文仍必须由批准模型成稿。
- `presets.json`：可移植配置包；全部使用新生图模式和失败阻塞，文字与图片模型在导入时分别解析为明确 ID。
- `validate-pack.mjs`：使用后端已构建的 `parseRules` 校验配置，并输出 `docs/content-presets/validation.json`。

所有命令从 `C:\dev\sandbox\binance square` 执行：

```powershell
node app/content-presets/build-pack.mjs
node app/content-presets/validate-pack.mjs
```

校验程序依赖已安装依赖、已构建的 `app/square-service/dist/src/rules.js`；后端规则修改后先在其仓库重新构建。

## 导入生产

使用已有项目私有 SSH 与平台登录配置，不在命令参数或配置包中传凭据：

```powershell
python -B app/deployment/ssh_remote.py put app/content-presets/presets.json /home/ubuntu/square-platform-upload/content-presets.json
python -B app/deployment/ssh_remote.py run app/deployment/scripts/import-content-presets.sh --sudo
python -B app/deployment/ssh_remote.py get /home/ubuntu/square-platform-upload/content-presets-import.json docs/content-presets/import-report.json
node app/deployment/verify-content-presets.mjs
```

导入器先检查全部条目的来源、批准模型、允许参数及既有同名记录，再逐项创建并发布规则版本。相同内容可复用；同名但内容已修改时停止，不覆盖用户配置。执行中逐项记录远程报告，出现超时或不确定状态时先查询报告和预设列表，不能盲目重发创建请求。

导入只操作预设；不会绑定账号、改变随机计划、解除暂停、生成图片或触发实际发帖。若想为已存在预设更新方向，应通过 Dashboard 编辑并发布新版本，或设计有明确版本检查的升级流程，而非修改包后覆盖导入。

浏览器核验脚本只读取生产页面、拍摄截图并检查配置，结束时关闭其启动的浏览器。运行环境使用 Windows 原生 Node.js、Python、Chrome 与服务器原生服务，不使用 Docker 或 WSL。
