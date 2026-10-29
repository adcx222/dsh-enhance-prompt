# 发布流程（维护者）

本文件记录把插件发到 npm、更新 GitHub、以及进 DSH 插件市场需要做的事。**面向维护者，不面向用户。**

## 身份

| 项 | 值 |
|---|---|
| npm 包名 | `@adcx222/dsh-enhance-prompt`（作用域包，`publishConfig.access = public`） |
| GitHub 仓库 | `adcx222/dsh-enhance-prompt`（仓库名不带作用域） |
| 市场收录 | `awesome-dsh-plugin/awesome-dsh-plugin` 仓库开 PR |

> 为什么不叫 `dsh-enhance-prompt`：npm 上该名已被 `devilzyl` 于 2026-10-23 发布的 1.0.0 占用，
> 且功能高度重叠。作用域包避开了重名，同时保留原来的模块语义。

## 一次发版

```sh
# 1. 版本号（市场按 npm 版本判断更新，必须 bump）
npm version patch          # 或 minor / major

# 2. 确认打进去的文件（应只有 LICENSE/README/cordis.patch.yml/lib/package.json）
npm pack --dry-run

# 3. 发布
npm publish                # 已登录时；未登录先 npm login

# 4. 推代码与 tag
git push && git push --tags

# 5. GitHub Release（可选，能给市场提供更快的预构建 tarball）
gh release create v$(node -p "require('./package.json').version") --generate-notes
```

## 进市场收录（只需做一次）

市场本体是 `dshmarket`，它**不做收录**；目录来自 `awesome-dsh-plugin` 仓库。

1. fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 按仓库里的条目模板加一条（下面是草稿，**字段名以该仓库模板为准**）
3. 开 PR，等约一天自动同步到市场与站点

条目草稿：

```yaml
name: dsh-enhance-prompt
repository: https://github.com/adcx222/dsh-enhance-prompt
npm: "@adcx222/dsh-enhance-prompt"
description_zh: 输入框一键把草稿改写成结构清晰、约束明确的提示词
description_en: One click in the composer rewrites a rough draft into a structured, constraint-explicit prompt.
tags: [prompt, prompt-engineering, composer, llm]
terminal: false
screenshots:
  - assets/composer-button.png
  - assets/before-after.png
  - assets/stats-panel.png
```

PR 正文（中英双语）：

```markdown
## 这是什么

`@adcx222/dsh-enhance-prompt` —— 在 composer 工具栏加一个 ✨ 按钮，把当前草稿交给 LLM 做**一次单轮改写**，写回输入框。

**What it is** — a composer toolbar button that rewrites the current draft into a clearer, more specific prompt with one single-turn LLM call, then writes it back for you to review before sending.

## 关键技术点

- 走 DSH 原生 `ctx.llm.stream()`，`tools` 天然为空；不建会话、不写对话历史
- 宿主端精确路由 `POST /enhance-prompt`，通过 `ctx.effect` 跟随生命周期注册/释放
- 写回优先 `inputActions.setDraft`（Lexical），失败退回编辑命令，再失败复制到剪贴板
- 请求期间草稿若被改动，只复制结果，不覆盖新输入
- 无构建步骤，`lib/` 即产物

## 兼容与隐私

- `engines.dsh: >=0.2.0-rc.2 <0.3.0`（`engines` 与 `dsh.engines` 两处都声明）
- 草稿只随这一次改写请求发往用户自己选择的模型，插件不上传、不落盘草稿

## 检查清单

- [ ] `npm pack --dry-run` 输出只有 6 个文件，无 `*.bak-*`、无 `stats.json`
- [ ] 安装在干净 profile 上能出现按钮，改写与写回正常
- [ ] README 的截图链接可访问
```

## 收录后验证

1. `设置 → 插件市场` 搜 `enhance-prompt`
2. 卡片有截图、engines 显示兼容
3. 一键安装 → 重启 → 输入框出现 ✨
4. 卸载后无残留

## 已知坑

- **`files` 字段**：不要写 `"lib"`，目录里存在 `*.bak-*` 备份，会把备份打进包；用显式文件列表。
- **patch 的 `name` 必须是模块解析名**：改了包名就必须同步改 `cordis.patch.yml` 里的 `name`，否则装了起不来。
- **本地开发安装同源**：profile 的 `dependencies` 键与 `dsh.profile.bundles` 条目都要用带作用域的名字，改完跑一次 `pnpm install`。
- **不要 PR 到 `dsh-market/dsh-market`**：那只是市场本体，条目 PR 会被要求转走。
