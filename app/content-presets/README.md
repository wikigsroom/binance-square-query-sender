# 10 种内容与图库预设

**2026-10-23：十种预设全部只用已有图库，不调用生图。** 优先随机匹配本预设的集合、标签、风格、比例及复用窗口；没有匹配时随机选择其他可用图库图片。保留的生成提示词不执行。另行请求的手动生图仍须遵守[行业梗图策略](../../docs/19-industry-meme-image-policy.md)。

此目录维护平台的可移植预设配置，不包含发布正文、API Key 或自动运行计划。完整方向、篇幅、新闻策略和已完成的生产核验见 [14 · 预设库说明](../../docs/14-ten-content-presets.md)。

## 配置来源

- `build-pack.mjs`：10 份人工编写的内容方向与独立生图要求，输出 `presets.json`。这些是给模型的要求，实际发送正文仍必须由批准模型成稿。
- `presets.json`：可移植配置包；全部使用 `image.mode = library`、`image.fallback = any_library`。文字由指定 AI 模型生成；配图不发起图片模型调用。
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
```

导入器先检查全部条目的来源、批准模型、允许参数及既有同名记录，再逐项创建并发布规则版本。相同内容可复用；同名但内容已修改时停止，不覆盖用户配置。执行中逐项记录远程报告，出现超时或不确定状态时先查询报告和预设列表，不能盲目重发创建请求。

导入只操作预设；不会绑定账号、改变随机计划、解除暂停、生成图片或触发实际发帖。已存在预设的图库模式升级使用下列专用脚本，逐项备份、比较版本、发布规则并回读；保留尚未发布的其他草稿改动：

```powershell
python -B app/deployment/ssh_remote.py run app/deployment/scripts/use-library-only-presets.sh --sudo
```

脚本覆盖全部现有预设。若切换期间出现沿用旧生图规则、尚未产生提交意图的活动发布任务，脚本取消该任务，由原随机计划安排下一次执行。已经提交或结果未知的任务不重发；失败父任务遗留的图片排队记录不会自动执行。结构化核验摘要见[图库模式报告](../../docs/content-presets/library-only-report.json)。

可选 `node app/deployment/verify-content-presets.mjs` 只读取生产页面、拍摄截图并检查配置，结束时关闭其启动的浏览器。历史导入报告和截图注明当时状态；本次图库模式切换采用 API 回读核验，没有重新拍摄。运行环境使用 Windows 原生 Node.js、Python 与服务器原生服务，不使用 Docker 或 WSL。
