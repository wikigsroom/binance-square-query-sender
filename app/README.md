# Binance Square 自动发布器

> **早期独立程序 / Legacy standalone runner**：本页不是当前 Dashboard 平台启动指南。当前平台见 [根 README](../README.md)，长度、账号独立周期、预设权重和发送优先由平台配置控制。不要与平台 Worker 对同一账号同时运行；下文保留早期每 15 分钟一轮的说明。

这个程序把实时币安现货涨跌榜、可读取的区块律动公开新闻和项目内容规则投喂给远程 `gpt-6-luna`，由模型从零生成每个账户独立的中文正文，再复用项目已有的上传、发布和公开核验脚本。程序不会把模型密钥或 Binance 账户密钥写入源码、批次文案、新闻记录或日志；模型不可用时会停止本轮，不会改用本地生成器。

程序从 `C:\dev\sandbox\binance square` 作为项目根目录运行。它会读取项目现有的 `keys.txt`，每个非空去重账户每轮一篇；图片从项目 `imagegen` 随机选择。默认启动后立即执行一轮，之后每15分钟执行一轮。锁文件和运行状态位于 `app`，防止同一轮重叠。

## 配置

在 PowerShell 中设置进程环境变量。真实密钥只放在环境变量中，不要写入 `.env.example`、源码、调度配置或命令行参数：

```powershell
Set-Location 'C:\dev\sandbox\binance square'
$env:LUNA_API_KEY = '<用户提供的远程 API key>'
$env:LUNA_API_BASE_URL = 'http://43.165.167.179:18241'
$env:LUNA_MODEL = 'gpt-6-luna'
$env:LUNA_REASONING_EFFORT = 'max'
```

可选变量：`POST_INTERVAL_MINUTES`（默认15）、`RUN_ON_START`（默认true）、`NEWS_MAX_LINKS`（默认36）、`LLM_TIMEOUT_MS`（默认120000）、`DRY_RUN`（默认false）。`LOCAL_CONTENT` 已禁用；没有 `LUNA_API_KEY` 或远程模型请求失败时，本轮直接停止，不生成或发送替代文案。

## 运行

持续定时运行：

```powershell
node app/src/index.mjs
# 或双击/命令行运行
app/run.cmd
```

只执行一轮、适合检查配置和流程：

```powershell
node app/src/index.mjs --once
```

源码检查：

```powershell
npm --prefix app run check
```

设置 `DRY_RUN=true` 时会刷新行情、检索新闻、调用远程模型、生成批次并完成发布前预检，但不会调用发布提交。真实发布会保存每轮的 `news.json`、`drafts.json`、`posts.json`、`report.json` 和 `report.md` 到对应 `batches/<batchId>`，并在 `app/state/last-run.json` 留下不含密钥的摘要。

程序遇到模型返回不合规正文时只进行一次定向修复；仍不合规就停止本轮，不发送未经本地事实校验的内容。网络超时或发布结果不确定时沿用项目发布脚本的状态记录和核验逻辑，不盲目重复提交。
