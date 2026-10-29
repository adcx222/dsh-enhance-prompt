# Changelog

本文件记录 `dsh-enhance-prompt` 的对外变更。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
