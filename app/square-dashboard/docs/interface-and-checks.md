# 界面与开发检查 / Interface and development checks

产品为远程运行的单所有者 Dashboard，使用 React 客户端和独立持久后端。界面不承担发布计时器：关掉浏览器不会改变账号下一次时间。

This is a single-owner browser dashboard backed by a separate persistent service. Closing the browser does not change account schedules; timers are not browser state.

## 交互与状态 / Interaction and state

全局运行控制在所有页面可见。账号列表区分账号状态、计划状态、阻塞、下一次到期和凭据健康；详情按独立计划、预设权重、基本信息和历史组织。预设编辑把草稿保存与版本发布分开，展示历史差异和引用账号。高影响状态变更和故障不只靠颜色呈现。

Global runtime control stays visible across pages. Account detail separates scheduling, weighted bindings, profile and history. Preset drafts and published versions have separate actions, with differences and affected accounts. Significant status changes and failures are expressed in text as well as color.

同一查询后台刷新时保留最近成功数据并展示刷新错误；变更查询条件时清除旧条件结果，并取消过时请求。搜索输入防抖，修改失败保留表单。后端配置版本冲突要求刷新，而不是静默覆盖。原始提示词和错误按调用分开显示；同一任务有写作、修复、校对等多条调用时全部可查。

Background refreshes retain successful data while surfacing refresh errors; changed queries clear obsolete results and cancel stale requests. Search input is debounced. Failed mutations keep form input. Version conflicts require refresh instead of silent overwrite. Actual prompts and errors are grouped by call, including writing, repair and review attempts.

## 检查 / Checks

2026-10-20 开发检查 / development results:

| 范围 / Scope | 结果 / Result |
| --- | --- |
| TypeScript + Vite production build | Passed |
| 账号录入、暂停计划、权重页 / Account creation, paused schedule, weights | Passed |
| 中文搜索、来源与完整 prompt / Search, provenance and rendered prompt | Passed |
| 预设、图库、模型资源 / Presets, library and model resources | Passed |
| 390px 导航、页面无横向溢出 / Mobile navigation, no document overflow | Passed |
| 模型发现、登记、默认配置与持久化 / Discovery, registration, defaults and persistence | Passed |
| 服务商协议与明暗主题 / Provider protocols and persistent themes | Passed |
| 375px 抽屉焦点、Escape 和 AI 设置 / Mobile focus, Escape and AI setup | Passed |
| 连接新增、编辑、Key 原子替换 / Connection creation, edit and atomic key rotation | Passed |
| 浏览器流程合计 / Browser flows | **8 passed, 0 failed** |
| 7页 × 4屏宽 × 2主题 / Pages × widths × themes | **56** combinations, 0 page errors, 0 document overflow, 0 tested contrast issues |

自动界面检查记录见 [ui-audit.json](checks/ui-audit.json)，由 `node scripts/audit-ui.mjs` 生成；检查375、768、1024、1440px，两种主题及可计算的文本颜色/背景对比，不代替人工完整可访问性审计。

The audit script tests four widths, both themes and computable text/background contrast. It does not replace a full human accessibility audit.

测试依赖正在运行的隔离 Workbench。`npm run workbench` 不会在正常开发中替换真实后端，只有显式使用该入口时开发代理才指向 4321。常规 `npm run dev` 默认 4310。

Tests require the isolated workbench to be running. Its launcher explicitly targets port 4321; it does not replace the normal backend. Regular `npm run dev` still defaults to port 4310.

## 视觉与 AI 接入 / Visuals and AI setup

黑灰、白与黄色构成统一工作台，明暗模式保留业务红绿和文字状态。移动抽屉约束焦点、支持 Escape 并恢复触发按钮焦点；背景不参与交互。保存和检查有内联结果与可关闭反馈。设置新增 AI 接入闭环：服务商 → 实际协议与地址 → 模型发现/手动登记 → 批准 → 默认模型 → 预设固定或跟随默认。详细流程见 [AI 接入说明](ai-integration.md)。

The shared neutral/yellow workspace supports both themes, explicit status text, focus-managed mobile navigation and mutation feedback. The AI workflow connects provider configuration, actual transport, discovery/manual registration, approval, defaults and preset model selection.

## 截图 / Screenshots

`scripts/capture.mjs` 登录真实运行 UI、导航各页、展开权重和提示词、采集桌面及移动截图，共15张。它不拦截请求或替换页面。后端用显式 fixture 数据，故截图中的帖子仅为预览，真实发送关闭。采集时间/视口/页面错误由 `screenshots/capture.json` 记录。

The capture script logs into the running UI, navigates resources, opens bindings/prompts and captures desktop/mobile views. It does not intercept requests or replace the page. The backend explicitly uses fixtures; displayed posts are previews and real submission is off. Capture time, viewports and errors are recorded in `capture.json`.

这些是开发截图，不是生产运行、真实 AI 质量或正式验收的证据。浏览器测试与采集均在结束后关闭上下文和浏览器。

These are development screenshots, not evidence of production operation, real AI quality or formal acceptance. Test/capture cleanup closes browser contexts and browsers.
