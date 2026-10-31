# Changelog

本文件记录 `dsh-enhance-prompt` 的对外变更。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.2.0 — 2026-10-31

### 修复

- **移动端（DSH Go 网页模式）按钮与「管理模型」重叠、点不到**：按钮不再用 `insertAdjacentElement` 抢发送按钮左侧的位置，改为注册宿主官方槽位 `conversation.input.right`（list 槽位，`id: "enhance-prompt"`、`order: 10`）。位置变成「模型选择器左侧、与麦克风同一行」，由宿主的 flex 布局统一排布，窄屏折行时随行移动，不会再压住模型管理入口。
- 槽位注册失败时自动降级：宿主没有 `slots` 服务、`require('react')` 不可用、或注册抛错（老版本宿主）时，1.5 秒后退回原来的 DOM 方案，按钮仍然可用。
- 依赖边界：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery` 从 `dependencies` 移出，只保留在 `peerDependencies`（范围与 DSH 宿主一致）。插件目录内自带的 `node_modules` 副本已移除，运行期改用宿主提供的同一份包，避免同一进程里出现两份框架包（`cordis` 的 Context / Service 身份分叉、`dsh-llm` 版本分叉）。此前 `dependencies` 里钉的是 `dsh-llm@0.2.1-rc.5`、`schemastery@3.18.5`，而 DSH 0.2.0-rc.2 宿主自带的是 `0.2.0-rc.2` / `3.18.4`，两者并存。

### 新增

- **DSH Go 原生界面入口**：`package.json` 加 `dshGo` 清单（v1、`wants: ["draft"]`、`composer.actions` 里一个 `id: "enhance"` 的「增强提示词」胶囊），宿主端用 `ctx.inject(['dshGo'])` 注册处理：读当前草稿 → 走同一套 `enhanceOnce` 单轮改写 → 以延后效果（`pending` + 60 s）把结果 `insert` 回输入框。
  - 没有 dsh-go 桥接的主机（SSH 主机现在还装不了桥接、DSH Remote 中转）上，`ctx.inject(['dshGo'])` 的回调不执行，插件与网页版行为完全不变——这就是回退路径。
  - 新增配置 `nativeCapsule`（默认 `true`）：关掉只影响原生胶囊，网页版 ✨ 不受影响。
  - 限制：原生协议没有「替换输入框」效果，只能 `insert`（≤2000 字），所以原生胶囊是插入而不是替换。
- 宿主端把改写逻辑抽成 `enhanceOnce(ctx, cfg, text, { signal, timeoutMs, provider, model })`，HTTP 路由与原生胶囊共用；胶囊的 `signal` 会传递给 `ctx.llm.stream()`，用户取消/超时会中止模型调用。
- 手机命中区：按钮视觉仍是 28×28，用 `::after` 把命中区上下各扩 8px（28×44），左右不扩张，避免抢相邻按钮的点击；`touch-action: manipulation` 去掉移动端双击缩放延迟。
- 槽位模式与 DOM 模式共用同一套读草稿 / 请求 / 写回逻辑，行为（含「草稿被改动就只复制不覆盖」）保持一致。

### 验证

- 无头 Chrome（CDP，`Emulation.setDeviceMetricsOverride`）在 390×844、360×844、320×844 三档宽度实测：按钮出现在 trailing 行内、与模型选择器间距 8–12px、`elementFromPoint` 命中按钮自身；模拟点击后拦截 `/enhance-prompt` 返回假结果，输入框内容被正确替换。
- 注意：输入卡片左侧仍被会话侧栏占位（hero 状态下卡片起点 x=72），DSH Go 手机布局把侧栏收进页头后空间更宽。

## 0.1.0 — 2026-10-28

首个公开发布。

### 新增

- 输入框工具栏 ✨ 按钮：把当前草稿交给 LLM 做**一次单轮改写**，写回输入框，发送前可自行修改。
- 宿主机端精确路由 `POST /enhance-prompt`（`GET` 返回累计统计），通过 `ctx.effect` 跟随插件生命周期注册与释放；live reload 时等旧路由释放后再重试注册，避免 `duplicate exact route`。
- 改写走 DSH 原生 `ctx.llm.stream()`：`tools` 天然为空，不建会话、不写历史。
- 写回优先走 composer 的 `inputActions.setDraft`（Lexical 整段替换），失败时退回编辑命令，再失败复制到剪贴板；不直接改 `contenteditable`。
- 请求期间草稿若被改动，只复制结果，不覆盖新输入或文件引用。
- 草稿长度上限 `maxInputChars`（默认 5000），超限直接拒绝，不浪费一次调用。
- provider / model 解析顺序：请求体 → 当前会话选择 → 插件配置；解析不出来返回 `code: no_model`。
- 右键按钮查看累计输入/输出 token、调用次数、失败次数（本地 `stats.json`）。
- 跟随语言：中文进中文出，英文进英文出。

### 已知限制

- 按钮依赖 composer 的 DOM 结构定位，上游改版可能导致按钮不出现（不报错）。
- 只处理当前草稿，不支持选中片段。
- 统计为本地文件口径，不参与云端计量。
