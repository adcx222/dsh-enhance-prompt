# dsh-enhance-prompt

[![npm](https://img.shields.io/npm/v/@geed239%2Fdsh-enhance-prompt)](https://www.npmjs.com/package/@geed239/dsh-enhance-prompt)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.2.0--rc.2%20–%200.3.0-2ea44f)](https://github.com/deepseek-ai)

给 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai) 输入框加一个 ✨ 按钮：把随手写的草稿，一键改写成结构清晰、约束明确的提示词。

> DSH Desktop / dsh web 的插件，`dsh.bundle` 形态，可直接用 `dsh plugin add` 或插件市场安装。
>
> 兼容 DSH `>=0.2.0-rc.2 <0.3.0`。

---

## 它解决什么问题

你写下的往往不是提示词，而是一句念头——「帮我写个脚本批量重命名文件」「这个报错怎么修」。模型拿到这句话，只能自己猜你要什么系统、什么规则、什么边界，猜错就得来回好几轮。

这个插件在发送之前插一步：读你输入框里的草稿，交给 LLM 做**一次单轮改写**，把意图展开成可执行的约束，然后写回输入框。你可以先看一眼，不满意就改，满意再发。

它**只改写，不执行**——不回答问题、不调用工具、不建会话、不写历史。改写发生在你自己的模型路由上，用的是 DSH 原生的 `ctx.llm.stream()`。

## 效果

输入（13 字）：

```
帮我写个脚本批量重命名文件
```

点击 ✨ 后（203 字）：

```
请帮我写一个用于批量重命名文件的脚本。为准确实现，请先向我确认：使用的操作系统和可运行的脚本环境；
目标文件夹路径及是否处理子文件夹；要匹配的文件类型或文件名规则；具体重命名规则（如查找替换、
添加前后缀、顺序编号、日期、大小写转换等）；是否保留扩展名；重名冲突如何处理；是否需要预览、
确认、备份或撤销。请根据确认结果提供完整脚本、使用说明和示例，并默认先执行预览模式，列出将要
改名的文件及前后名称，避免误改。
```

## 特性

- **挂在官方槽位**：纯图标按钮（28×28）注册到宿主的 `conversation.input.right`，与麦克风同一行、模型选择器左侧，位置由宿主 flex 布局管理；窄屏时整行自动换行，不会盖住模型管理或发送按钮
- **移动端可点**：视觉尺寸 28×28，命中区上下各扩 8px（28×44），不侵占左右邻居；`touch-action: manipulation` 去掉双击缩放延迟
- **单轮、无工具**：走 `ctx.llm.stream()`，`tools` 天然为空，安全边界由 API 本身保证
- **不污染历史**：不建会话、不写对话记录，只是一次文本改写
- **跟随语言**：中文进中文出，英文进英文出，不做语言标签
- **写回走官方入口**：优先用 composer 的 `inputActions.setDraft`（Lexical 编辑器）；拿不到时退回编辑命令，再失败复制到剪贴板，不直接改 `contenteditable`
- **不覆盖新输入**：请求期间草稿有改动时只复制结果，不覆盖你刚输入的内容或文件引用
- **消耗可见**：右键按钮看累计输入/输出 token、调用次数、失败次数
- **模型可配**：默认跟随当前会话的模型选择，也可以在配置里写死
- **DSH Go 原生界面也有入口**：带 `dshGo` 清单，在装了 dsh-go 桥接的主机上，App 原生聊天界面输入框上方的胶囊行会多一个「增强提示词」；点一下读当前草稿 → 增强 → 插回输入框（不发送）。网页版与原生界面两套入口互不影响

## 安装

### 通过插件市场

DSH 里打开 **设置 → 插件市场**，搜索 `dsh-enhance-prompt`，点安装。

> npm 包名是 `@geed239/dsh-enhance-prompt`，仓库名沿用 `dsh-enhance-prompt`，两者不同属正常。

### 命令行安装（直接从 GitHub）

市场收录之前，或者想跟 `main` 分支上的最新代码，可以直接用 GitHub 源安装：

```sh
dsh plugin --profile web add github:adcx222/dsh-enhance-prompt
```

### 手动安装

1. 把仓库克隆或解压到 `%APPDATA%\dsh-desktop\harness\plugins\dsh-enhance-prompt`
2. 在 `profiles/web/package.json` 的 `dependencies` 里加：

   ```json
   "@geed239/dsh-enhance-prompt": "link:../../plugins/dsh-enhance-prompt"
   ```

3. 在同一个文件的 `dsh.profile.bundles` 数组里加 `"@geed239/dsh-enhance-prompt"`
4. 运行 `harness\.desktop-bin\pnpm.cmd install`
5. 重启 DSH

卸载反向操作：从 `dsh.profile.bundles` 和 `dependencies` 里移除，跑一次 `pnpm install`，重启，删目录。

## 配置

配置写在 `cordis.patch.yml` 的 `config` 下：

```yaml
- insert:
    - id: enhance-prompt
      name: '@geed239/dsh-enhance-prompt'
      config:
        provider: ''
        model: ''
        maxTokens: 8192
        timeoutMs: 60000
        maxInputChars: 5000
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | 空 | 模型 provider；留空则跟随当前会话的模型选择 |
| `model` | 空 | 模型名；留空同上 |
| `maxTokens` | `8192` | 单次改写输出上限；推理型模型的思考过程也占输出额度，太小会拿不到正文 |
| `timeoutMs` | `60000` | 请求超时 |
| `maxInputChars` | `5000` | 草稿长度上限，超过直接拒绝，不浪费一次调用 |

`provider` / `model` 的解析顺序是：请求体 → 当前会话选择 → 配置。两者都解析不出来时接口返回 `code: no_model`，不会带着空模型名去请求。

## 工作原理

```
浏览器端 lib/client.js                宿主端 lib/index.js
─────────────────────                ────────────────────
注册 slot conversation.input.right
   ↓  （宿主渲染 ✨ 按钮，与模型选择器同排）
   ↓  点击
读草稿（composer projection，含 @ 文件引用）
   ↓
POST /enhance-prompt  ───────────────▶  校验长度 / 解析 provider+model
{ text }                                    ↓
                                       ctx.llm.stream() 单轮，无工具
                                            ↓
                                       拼装 text block，去掉包裹引号
                                            ↓
                                       记 token 账 → stats.json
   ◀──────────────────────────────────  { success, text, tokens }
   ↓
inputActions.setDraft 写回（Lexical）
```

按钮优先走官方槽位 `conversation.input.right`（list 槽位，注册项带 `id: "enhance-prompt"`、`order: 10`）。只有在宿主没有 `slots` 服务、拿不到 `react`、或槽位注册抛错（老版本宿主）时，才在 1.5 秒后退回旧的 DOM 方案：找到 composer 卡片，在发送/停止按钮左侧 `insertAdjacentElement` 插一个按钮。两条路径共用同一套读草稿 / 请求 / 写回逻辑。

宿主端注册的是 `webServer` 上的精确路由 `POST /enhance-prompt`，同时 `GET` 返回累计统计。路由通过 `ctx.effect` 跟随插件生命周期注册/释放，live reload 时会等旧路由释放后再重试注册，避免 `duplicate exact route` 把接口卡死。

## 提示词设计

改写用的系统提示词刻意做窄：

```
- Do not answer the request; only rewrite it.
- Do not invent technologies, tools, or facts.
- Reply in the input's language, with no labels.
- Chinese output: 200-350 characters. English: 300-450 characters.
- Output only the rewritten prompt.
```

窄是有原因的：一旦允许它「顺手回答」，它就会开始编造你没提过的技术栈和事实，改写结果反而比原稿更偏。字数区间是为了让输出足够具体、又不至于膨胀成一篇需求文档。

## 已知限制

- **槽位优先，DOM 兜底**：正常情况按钮由宿主槽位渲染（`conversation.input.right`），位置随宿主布局走；只有老宿主没有 `slots` 服务时才退回 DOM 插入（依赖 composer 结构定位：编辑器 + 发送按钮 + file input），那时上游改版可能让选择器失配，按钮不出现（不会报错）。
- **移动端布局**：窄屏（≤560px 容器）时宿主把整行工具栏折行，按钮随行移动，不会与模型管理、麦克风或发送按钮重叠；已用无头 Chrome 在 390×844 / 360×844 / 320×844（DSH Go 网页模式常见宽度）实测，命中测试 `elementFromPoint` 均命中按钮自身。
- **DSH Go 原生界面**：插件的 `dshGo` 清单声明了一个 `composer.actions` 胶囊（id `enhance`，`wants: ["draft"]`），宿主端用 `ctx.inject(['dshGo'])` 注册处理。三条边界要知道：
  - 只有**装了 dsh-go 桥接**的主机才有原生插槽。手机本机引擎自带桥接；SSH 主机目前装不了（dsh-go 官方文档写明「第二期」）；经 DSH Remote 中转不显示。
  - 原生协议没有「整体替换输入框」的效果，只有 `insert`（插到光标处，最多 2000 字）。所以原生胶囊是**插入**增强结果，原草稿要你自己删；想要替换语义就用网页版的 ✨。
  - 关掉这个胶囊：插件配置里 `nativeCapsule: false`（只影响原生界面，网页版不受影响）。
- **写回优先走官方 InputActions**：`inputActions.setDraft` 是 Lexical 的整段替换入口；拿不到该服务时才退回 `execCommand('selectAll')`，不再直接写 `textContent`，避免编辑器状态与 DOM 脱节导致输入框/文件引用异常。
- **增强期间不覆盖新输入**：请求进行中如果你继续打字或加文件，结果只复制到剪贴板，不覆盖当前草稿。
- **统计是本地文件**：`stats.json` 写在插件目录下，不参与云端计量，口径只覆盖本插件的增强调用。
- **一次一段**：只处理输入框当前草稿，不处理选中片段。
- **数据流向**：点击按钮时，当前草稿内容会随这一次改写请求发送到你选择（或配置）的模型，和你在同一个会话里正常提问时的数据边界一致；插件本身不上传、不落盘草稿，只把 token 用量写进本地 `stats.json`。

## 开发

仓库没有构建步骤，`lib/` 下的文件就是产物：

- `lib/index.js` — 宿主端（ESM，依赖 `@deepseek-ai/dsh-llm` 的 `BlockAssembler` / `createUserMessage`）
- `lib/client.js` — 浏览器端（`window.__ModuleLoader__.load` 模块包装）
- `cordis.patch.yml` — bundle patch，注册插件条目

改完重启 DSH 或等 HMR 重新组合即可。

### 依赖边界（重要）

`@deepseek-ai/*` 是 DSH 宿主自带的公共包，本插件只在 `peerDependencies` 里声明可接受范围，**不写进 `dependencies`，也不要在插件目录里 `npm install` 它们**：

- 宿主的模块回退解析（`resources/host-module-fallback.mjs`）会在插件目录解析失败时，改用 DSH 安装目录里的同一份包。所以插件目录里**不应该**有 `node_modules`。
- 一旦插件目录里出现自己的 `node_modules/@deepseek-ai/*`，Node 会优先用本地副本，同一进程里就有了两份 `dsh-llm` / `cordis` / `schemastery`。`cordis` 的 Context / Service 身份与宿主不一致时，服务注入会失效或行为异常；`dsh-llm` 的消息、chunk 类跨副本也可能出现身份校验问题。
- 只写 `peerDependencies` 还有一个好处：插件永远跟随宿主的那一份版本，DSH 升级后不会出现插件跑旧版、宿主跑新版的分叉。

需要 TypeScript 类型或本地调试时，把版本写进 `devDependencies` 并临时安装；调完请删掉 `node_modules`，不要让它留在运行目录里生效。

## License

[MIT](LICENSE)
