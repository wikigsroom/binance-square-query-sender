# 币安广场发布流程

> 早期根 README 归档；相对运行路径均指项目根目录。当前平台以 [根指南](../../README.md) 为准。旧三币/200 字符/15 分钟要求不覆盖平台预设，不能与平台 Worker 并行发布同一账号。

仓库提供 [settings.example.json](../../settings.example.json)、[accounts.example.json](../../accounts.example.json) 和 [keys.example.txt](../../keys.example.txt)，仅作本地私有配置的结构参考；复制并在忽略文件中填值。实际正文仍由批准模型成稿。个人 `imagegen/` 图片和运行快照不随源码分发，需自行准备。此归档下文的历史已发布记录不是克隆后产生的内容。

所有工作文件和运行目录都在 `C:\dev\sandbox\binance square`，不使用 Docker 或 WSL。发布使用本目录 `vendor/square-post` 内的币安官方脚本。当前没有启动浏览器或创建浏览器标签页。

本次已发布一篇：<https://www.binance.com/zh-CN/square/post/375800607944716>。正文60字符，包含标签与换行，配图从 `imagegen` 的203张 PNG 中随机选择。

`accounts.json` 保存账户名称与发布 Key；`posts.json` 为每个账户保存独立的正文、三个代币标签、图片路径和行情快照路径。后续增加 Key 时在两个文件中分别增加账户和对应帖子，每批每个账户一条，不同账户必须使用不同内容。

从本目录运行：

```powershell
node .\market.mjs
node .\square-batch.mjs
node .\square-batch.mjs --send
```

## 双击启动定时程序

双击项目根目录的 `start-binance-square.bat` 即可启动远程 `gpt-6-luna` 定时发布器。启动器会调用 `app\run-watchdog.ps1`，默认立即执行一轮，之后每15分钟执行一轮；如果已有发布器进程，第二次双击只提示并退出，不会创建重叠轮次。

启动器不会把模型密钥写入 bat、脚本或日志。当前进程没有 `LUNA_API_KEY` 时，窗口会以隐藏输入方式要求输入一次；只在本次进程内使用。也可以先在 Windows 用户环境变量中设置 `LUNA_API_KEY`，之后双击即可直接启动。

第一条更新实时榜单；第二条仅校验和预览；第三条按 `settings.json` 的 `concurrency` 并发发布，默认3个账户。单条发布可增加 `--only 帖子任务ID`。新增帖子请使用新的任务ID。

榜单口径为币安正在交易的现货 USDT 交易对，按滚动24小时涨跌幅排序，排除24小时成交额为零的交易对。每篇必须从涨幅前五与跌幅前五合计选择三个代币，且两榜都有选中代币；正文优先120—190字符，含标签、标点、空白、换行和正文链接总计不超过200个Unicode字符。发布时行情快照不得超过15分钟，正文三币涨跌幅须与本轮快照一致。

后续内容优先结合区块律动近期相关新闻或事件数据，注明来源、日期，保留散户的自然情绪和独立观点。每轮读取原文后在本批 `news.json` 保存事实摘要及来源链接；没有可靠相关新闻时基于行情写。详细取材方法见 `.agents/skills/binance-square-posts/references/news.md`。

图片上传、处理和发布由官方脚本完成。各账户使用独立子进程传入自己的 Key，某账户失败不影响其他账户。`runs` 保存每篇的状态与接口回执，已成功或结果不确定的提交会跳过，避免重复发帖。结果不确定时应先核验线上帖子再决定是否再次发送。

现有代理配置在 `settings.json`，指向 `http://192.168.31.19:7890`；不需要代理时改为 `null`。没有更改系统代理。

读取线上帖子并核验正文、三个代币标签和配图：

```powershell
node .\verify-post.mjs 375800607944716
```

批量流程的本地模拟测试：

```powershell
node --test .\tests\batch.test.mjs
```

模拟测试仅接受 `test-only-` 开头的测试 Key，替换发布脚本为本地模拟，不请求真实发布接口。

后续文案随机性要求保存于 `CONTENT_RULES.md`。读取 `keys.txt` 为每个 Key 建立新批次时，先更新榜单，再运行 `node .\prepare-keys-batch.mjs`；它随机选择代币组合和不同的图片，并将本批账户和行情保存至 `batches`。每篇文案应分别撰写，按规则打散立场、词句、段落和标签位置，保存为本批 `posts.json`。发布时通过 `--accounts` 和 `--posts` 指定本批文件。

`batches/latest.json` 指向最近准备的批次。运行 `node .\verify-batch.mjs` 会读取最新批次，核验成功帖子的正文、三个标签和单张图片，并保存 `report.json` 与 `report.md`。验证不会再次发帖。

官方流程来源：<https://github.com/binance/binance-skills-hub/tree/main/skills/binance/square-post>。本地官方脚本保持原样；代理和回执记录通过 `network.mjs` 加载。
