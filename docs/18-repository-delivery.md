# 18 · 统一仓库与双语产品文档 / Monorepo delivery

日期 / Date：2026-10-22（Asia/Taipei）。目标 / Remote：`git@github.com:wikigsroom/binance-square-query-sender.git`。

## 整理范围 / Scope

平台前端、后端、SQL、完整需求、内容规范、本地技能、十种预设、原生部署和检查工具统一纳入根仓库。所有组件源码直接受版本控制，不使用子模块或 Git 链接。两个原组件仓库的 Git 元数据在本机忽略的 `.private/git-history/` 留存，工作文件没有删除；GitHub 上以统一仓库的首个快照交付，不声称合并了旧提交历史。

The root repository contains both applications, SQL, requirements, writing constraints, local skill, preset pack, deployment/inspection tooling and earlier CLI code. Original component Git metadata is preserved privately on this machine. The published monorepo begins with an integrated source snapshot rather than imported component commit histories.

## 文档 / Documentation

- [中文完整 README](../README.md) 与 [English README](../README.en.md)：产品模块、架构、AI 请求协议、生成证据、图片来源、独立调度、新闻逻辑、十种预设、校验模式、数据与 API、安装、部署、运维、测试和边界。
- 四类 Mermaid：整体架构、发布流水线、调度时序、业务实体关系。另有 [三张独立 SVG](product/README.md)。
- [20 张真实产品及模块截图](product/README.md)，包括浅色、深色、账号、权重、导入、预设、配图、帖子、图库、任务、AI、新闻、运行控制和移动端。
- [AGENTS.md](../AGENTS.md)：原生执行、路径、浏览器清理、正文必须 AI 成稿、图片来源、未知提交防重、当前校验模式和凭据边界。
- 原有 00–17 文档作为完整历史保留；最新状态入口已更新，旧阶段的统计和截图明确视为历史记录。

## 本轮验证 / Verification

| 检查 / Check | 结果 / Result |
| --- | --- |
| Backend TypeScript and production build | Passed |
| Dashboard TypeScript and production build | Passed |
| Backend integration/regression tests | 61 passed |
| Earlier batch/skill tests | 9 passed |
| Dashboard Playwright tests | 13 passed; isolated native workbench |
| Production screenshots | 20 captured; authenticated read-only navigation |
| Capture mutation guard | No non-authentication API writes; runtime switches unchanged |
| Browser/process cleanup | Capture browser closed; managed test workbenches stopped |
| Repository boundary/link/credential check | Passed against the complete Git index; no credential findings, broken local links or nested Git links |
| Original component files | All 66 backend and 56 dashboard previously tracked files retained |
| Preset pack schema | All 10 presets passed the actual backend rule parser |

合计 **83 项自动化测试**。本轮不调用付费模型、不发布新帖子、不改变生产配置；线上原有 Worker 正常运行，截图中的计数可能随时间变化。测试中模型/来源响应为本地夹具，不能作为新的真实生成或发布证据。

83 automated tests passed in total. No new paid generation or publication was requested by this documentation task. Existing production workers continued normally. Browser integration tests used isolated local fixtures, distinct from the production screenshots.

本轮结构化摘要见 [verification.json](product/verification.json)；截图时间和逐页清单见 [capture-manifest.json](product/capture-manifest.json)。

## 仓库边界 / Repository boundaries

跟踪：源码、锁文件、配置示例、测试、约束/设计/运维文档、已审查的历史验收摘要、产品截图及图示。

排除：真实 `.env`、API Key、管理员及数据库密码、`.private/`、原组件 Git 元数据、数据库、运行批次、完整生产诊断和操作输出、个人原图图库、依赖、构建、缓存、浏览器配置与旧发布归档。

Detailed diagnostic JSON and recovery-operation dumps remain local because they contain complete production prompts, news bodies and operational state. Their public summary is retained in [17](17-publication-validation-and-priority.md). The repository does not contain recoverable production credentials or private database/image backups.

根 `.gitignore` 定义排除范围；`app/repository/verify-repository.mjs` 检查暂存文件、Git 链接、运行数据路径、凭据形状及本机已知凭据、文档链接和完整截图清单。若检测异常，只输出文件及原因，不输出凭据匹配值。

```bash
npm run check:platform
npm run build:platform
npm test
npm run test:dashboard
git add .
npm run verify:repository
git diff --cached --check
```

CI uses native Ubuntu and Node, installs Chromium for isolated browser checks, and never connects to production or uses paid models. Repository verification is a useful delivery check, not a substitute for reviewing future changes.

## 重建图册 / Rebuild the gallery

```bash
# Requires private local administrator configuration; production reads only.
npm run capture:product
python -B app/repository/build-product-docs.py
```

`capture-product.mjs` 保存时间、主题、视口、路由、只读检查及浏览器关闭结果。使用新的截图时，重新生成图册，并人工查看桌面、详情和移动端图，确认不是登录失败页、未加载占位或错误界面。
