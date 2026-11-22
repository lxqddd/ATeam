# ATeam Agent 对齐 OpenCode TODO List

> 对比基准：OpenCode `dev` 分支文档（2026-11-21）与 ATeam `master` 当前实现。
> 范围：Agent 核心能力（会话、工具、权限、上下文、扩展），不包含主题、打包、TUI 等。
> 标记：`[x]` 已完成，`[ ]` 待办。优先级：**P0** 必须、**P1** 重要、**P2** 后续。

## 已对齐

- [x] 会话创建、重命名、删除与持久化
- [x] 流式 text / reasoning / tool 事件
- [x] 多供应商配置、模型列表获取、默认模型与会话级模型切换
- [x] 推理强度与会话级权限模式（只读 / 逐项确认 / 自动改文件 / 自动）
- [x] 基础工具：read / list / grep / write / edit / shell
- [x] 工具审批卡、停止、重试、token 用量展示
- [x] Agent 独立 utility process、工作区路径限制、API Key 安全存储
- [x] 上下文窗口管理、自动 / 手动压缩与超长重试（基础版）
- [x] 项目规则加载：全局 → Git 项目根 → 工作区，`AGENTS.md` / `CLAUDE.md`（基础版）
- [x] 持久化权限规则：通配符匹配、allow / ask / deny、shell 扫描与规则管理
- [x] 文件快照与 undo / redo：文件与对话一起回滚，撤销的 prompt 回到输入框
- [x] LSP 诊断与自动格式化：内置语言服务器、诊断注入、格式化器发现与执行

## P0：可靠性、安全与编辑质量

### P0-1 上下文窗口管理与自动压缩

**现状**：每轮把完整历史重新提交（[message-history.ts](../apps/desktop/src/main/agent/message-history.ts)）；模型只有 id/name，没有上下文窗口等元数据（[model-types.ts](../packages/shared/src/model-types.ts)）；长会话最终会触发供应商 context overflow。

**OpenCode 参考**：自动 / 手动 / 后台压缩，保留最近一段对话，按模型窗口留 buffer，超长错误自动压缩后重试一次。

**进度（2026-11-22）**：已实现自动预检压缩、强制手动压缩、超长错误重试一次、压缩边界与摘要展示、上下文占用显示、后台预生成摘要和模型上下文窗口配置；上下文估算优先使用供应商返回的真实 usage（取最后一步，并在压缩后忽略旧用量），图片按固定 token 估算；Anthropic 模型可开启供应商侧压缩（`compact_20260112`），超长错误恢复改为强制压缩。

- [x] 为模型增加 `contextWindow` 元数据，并在模型表单与存储中维护
- [x] 补充 `maxOutputTokens`、推理能力等模型元数据（与 P1-7 一起做）
- [x] 发送前估算输入 token（ASCII 与中文分别估算），按模型窗口与预留 buffer 判断是否需要压缩
- [x] 实现摘要压缩：保留最近 N tokens，把更早的轮次替换为一条压缩摘要消息
- [x] 原始消息继续持久化，压缩只影响发给模型的历史
- [x] 增加手动“压缩上下文”入口与压缩中状态；短历史也支持强制压缩
- [x] 捕获 context-too-long 类错误，自动压缩后重试一次，第二次失败如实报错
- [x] 在消息列表标记压缩边界，并可展开查看摘要
- [x] 展示上下文占用
- [x] 后台预生成摘要，达到阈值时复用
- [x] provider 原生压缩（Anthropic `compact_20260112`，按模型开关）
- [x] 用真实用量替代启发式估算（以上一条 assistant 消息的供应商 usage 为锚点，缺失时回退启发式）
- [x] 测试压缩阈值、摘要消息构建、超长重试、重启后恢复

**验收**：超过模型上下文窗口的会话仍可继续；压缩后原始消息仍能在 UI 查看；不会无限重试。

### P0-2 项目规则 AGENTS.md

**现状**：system prompt 完全硬编码（[runtime.ts:742](../apps/desktop/src/main/agent/runtime/agent-runtime.ts:742)），不读取仓库的构建命令、测试要求或代码约定。

**OpenCode 参考**：全局、项目根、当前目录向上的 `AGENTS.md` 自动合并，`CLAUDE.md` 作为回退，支持配置额外 instructions。

**进度（2026-11-21）**：已按 OpenCode 对齐为“全局 → 工作区 → 上层目录 → 项目根”的最近优先顺序；无 Git 时向 home 方向发现；读取文件或目录时按需加载更深层 `AGENTS.md`；支持设置页配置额外 instructions 与远程 URL。

- [x] 支持全局指令文件（应用配置目录下的 `AGENTS.md`）
- [x] 从工作区向上发现项目 `AGENTS.md` 并注入 system prompt
- [x] 支持 `CLAUDE.md` 回退，且同一目录 `AGENTS.md` 优先
- [x] 合并顺序与 OpenCode 对齐：全局 → 工作区 → 上层 → 项目根，冲突不做自动解析
- [x] 无 Git 时向 home 方向发现；读取更深层目录时按需加载该目录的 `AGENTS.md`
- [x] 在设置页展示当前加载的规则文件
- [x] 支持配置额外 instructions（相对 / 绝对 / ~/ / glob）与远程 URL
- [x] 测试发现顺序、去重、缺失回退、内容拼接

**验收**：新建会话后，Agent 能遵守仓库 `AGENTS.md` 中的构建、测试和风格要求。

### P0-3 文件快照与撤销 / 重做

**现状**：只持久化消息，没有文件快照，Agent 改错文件后无法回滚。

**OpenCode 参考**：每个模型步骤前后做文件快照，`/undo` `/redo` 同时回滚对话与文件，并可回滚到任意消息。

**进度（2026-11-21）**：已按 OpenCode 对齐为每个模型步骤快照、只恢复本轮归属文件、可回滚到任意 assistant 轮次、Git ignore 与未跟踪文件 2 MiB 限制、会话删除时清理快照；增加快照开关、消息级回退按钮和撤销/重做快捷键。撤销采用立即生效 + redo，OpenCode 为暂存回滚，用户可见流程一致。

- [x] 每个模型步骤前后对工作区文件做快照（外部 blob 存储，不污染用户仓库）
- [x] 记录步骤内改动的文件列表，并关联到 assistant 消息
- [x] 增加 undo / redo 的 IPC、头部按钮、消息级回退和快捷键
- [x] undo 时只恢复归属该轮的文件，并回滚对话、把 prompt 放回输入框
- [x] 支持回滚到任意 assistant 轮次
- [x] 会话运行中禁止回滚
- [x] 不依赖 Git；Git 仓库中遵循 ignore 规则并限制未跟踪文件大小
- [x] 会话删除时清理快照与不再被引用的 blob
- [x] 快照功能开关（Agent 设置页）
- [x] 测试快照捕获、文件恢复、新建文件删除、运行中拒绝

**验收**：误改或误删的文件可以通过 undo 恢复；redo 能取消尚未提交的回滚。

### P0-4 细粒度且可持久化的权限规则

**现状**：会话级 mode + 内存中的 `allowed` 集合（[runtime.ts:145](../apps/desktop/src/main/agent/runtime/agent-runtime.ts:145)、[runtime.ts:432](../apps/desktop/src/main/agent/runtime/agent-runtime.ts:432)）；没有通配符、路径或命令级规则，重启后“始终允许”丢失。

**OpenCode 参考**：有序的 allow / ask / deny 规则，支持通配符、持久化审批、按 agent 配置、shell 命令扫描和 external_directory 边界。

**进度（2026-11-21）**：已按 OpenCode 对齐规则“后匹配优先”、shell ` *` 后缀匹配、Windows 大小写、外部目录默认允许、危险命令交给规则决定、引号感知的命令分段，并为 read / list / glob / grep 增加权限 action。按 agent、URL、MCP、Skill 等规则随对应功能补充。

- [x] 把权限模型扩展为 `action + resource + effect` 规则，支持通配符
- [x] 规则按“后匹配优先”组合；多资源操作任一 deny 即拒绝
- [x] 支持按路径、shell 命令等资源进行匹配（URL 资源待 P1-3）
- [x] shell ` *` 后缀匹配无参数命令，Windows 下大小写不敏感
- [x] “始终允许”持久化到磁盘，重启后继续生效
- [x] 支持全局 / 会话级规则覆盖；按 agent 覆盖待 P1-2
- [x] 外部目录默认允许；危险命令不再强制弹窗，由规则与模式决定
- [x] 增加 read / list / glob / grep 权限 action
- [x] 提供规则管理 UI（查看、添加、撤销已保存规则）
- [x] Web / Skill / 子代理权限 action（`webfetch` / `websearch` / `skill` / `subagent`）
- [x] 测试规则优先级、通配符匹配、持久化恢复、命令扫描

**验收**：用户可以对“某个目录的写操作”或“某类命令”设置永久允许/拒绝；重启后规则仍然有效。

### P0-5 工具集补齐

**进度（2026-11-21）**：已增加 glob、patch 多文件编辑、后台 shell 与完成通知、shell 输出流式回传、大输出落盘、grep literal / caseSensitive / limit，以及工作区外路径的 `external_directory` 审批。剩余：无。glob 增加 10 秒遍历超时；grep 在安装 ripgrep 时自动使用 rg（缺失或失败回退 JS 遍历）；read 支持图片（作为图像内容返回）与 PDF（抽取文本）。

- [x] 增加 `glob` 工具：`**/*.ts` 模式、hidden、limit（超时待补）
- [x] 增加 `patch` / `apply_patch` 多文件工具：新增、更新、删除文件
- [x] 对支持的模型优先暴露 patch，其余模型继续使用 edit / write（模型能力 `applyPatch`）
- [x] shell 支持 `background`，完成后向会话发送通知
- [x] shell 输出流式回传 UI
- [x] 大输出写入受管文件，模型上下文只保留截断视图
- [x] grep 增加 literal / caseSensitive / limit 参数（ripgrep 加速待评估）
- [x] 工作区外文件访问：external_directory 审批后允许
- [x] 测试 glob 匹配、patch 多文件、后台任务通知、输出截断与落盘

**验收**：可以按模式找文件、一次修改多个文件；dev server 等长命令不阻塞对话；完整输出可追溯。

### P0-6 LSP 诊断与自动格式化

**现状**：没有 LSP 与格式化集成，Agent 改完代码看不到类型错误，也不会自动格式化。

**OpenCode 参考**：内置多语言 LSP，编辑后注入诊断；识别项目格式化器并在写入后自动执行。

**进度（2026-11-21）**：已实现内置语言服务器表（TypeScript / Go / Python / Rust / C/C++）、按工作区复用与关闭的 LSP 客户端、read / write / edit / patch 后注入诊断、基于项目配置发现的 prettier / biome / gofmt / rustfmt / ruff 自动格式化，以及设置页开关与检测状态。格式化失败只作为提示，不影响工具结果；语言服务器不可用时静默跳过。剩余：无。新增 `lsp_hover` / `lsp_definition` 查询工具；设置页可为扩展名指定格式化器或关闭格式化。

- [x] 增加 LSP 客户端管理：按项目与语言启动、复用、关闭
- [x] 读取 / 写入 / 编辑后请求 diagnostics，并注入工具结果
- [x] 先实现 diagnostics，后续再补 hover / definition 等查询
- [x] 自动识别并执行 prettier、biome、gofmt、rustfmt、ruff
- [x] 设置页提供开关与检测状态显示
- [x] 测试诊断注入、格式化器发现、格式化失败不影响主流程

**验收**：Agent 修改 TypeScript 文件后能看到类型错误；文件写入后按项目配置自动格式化。

## P1：日常编码效率

### P1-1 MCP（Model Context Protocol）

**进度（2026-11-21）**：已实现 MCP 服务器配置存储与设置页（新增 / 编辑 / 启停 / 删除 / 状态探测）、本地 stdio 与远程 Streamable HTTP 传输、自定义 headers、工具自动注册为 `mcp_<server>_<tool>` 并纳入 `mcp` 权限动作、工具列表变更刷新、失败隔离与下次运行重连、连接状态与工具 / prompts / resources 数量展示。剩余：无。OAuth 已实现授权发现（RFC 9728 / RFC 8414）、动态客户端注册、PKCE S256、浏览器回调、加密 token 存储与自动刷新；MCP prompts 作为斜杠命令展开，resources 通过 `mcp_resource` 工具读取。

**验收**：在设置页添加一个本地或远程 MCP server 后，对话中可以使用它提供的工具，并按权限规则审批。

- [x] 增加 MCP 配置存储与设置页
- [x] 支持本地（stdio）与远程（HTTP）MCP server
- [x] 支持自定义 headers
- [x] 支持 OAuth（授权发现、浏览器回调与 token 存储）
- [x] 把 MCP 工具注册进工具列表，并纳入权限规则
- [x] 连接后读取并展示 MCP prompts / resources 数量
- [x] prompts 作为命令、resources 提供给 Agent 读取（随 P1-5）
- [x] 断线重连与连接状态展示
- [x] 测试配置校验、工具注册、权限匹配、传输与分页、失败恢复

### P1-2 子代理与自定义 Agent

**进度（2026-11-21）**：已实现内置 build / plan 主 Agent 与 general / explore 子 Agent；支持 Markdown（`~/.config/ATeam/agent/agents`、`.opencode/agent`、`.opencode/agents`）与 `agents.json` 自定义 Agent（description、mode、model、tools、permission、steps、prompt）；会话级 Agent 选择器（输入框上方）与持久化；`subagent` 工具创建隐藏子会话、同步执行并回报结果、支持继续同一子会话、子会话权限上抛到父会话并携带子 Agent 的权限规则、禁止嵌套、删除父会话时级联清理。剩余：无（后台子代理与温度采样已补齐）。

**验收**：选择 plan 后 Agent 只能读不能改；可以让子代理在独立上下文中探索代码并把结论带回主对话；自定义 Agent 的权限规则可以收紧或放宽全局策略。

- [x] 内置 primary agents：build、plan
- [x] 内置 subagents：general、explore
- [x] 支持 Markdown / JSON 自定义 Agent：system prompt、model、tools、steps
- [x] 按 Agent 的权限规则（`permission: action|resource|effect` 列表）
- [x] 按 Agent 的采样参数（temperature 等）
- [x] 增加 `subagent` 工具：子会话、执行完成后回报
- [x] 支持继续同一个子会话
- [x] 子代理后台运行与完成通知
- [x] 会话输入框上方增加 Agent 选择器（原计划为头部）
- [x] 测试 Agent 解析、权限规则、工具过滤、子会话创建、继续、权限上抛、嵌套深度限制、级联删除

### P1-3 Web 工具

**进度（2026-11-21）**：已实现 `webfetch`（http(s) 校验、30s 超时、5 MB 截断、HTML→Markdown / 纯文本 / 原始 HTML、错误与重定向 URL 回显）与 `websearch`（Tavily / Exa / Brave，密钥加密存储，设置页配置与状态）；两者都有独立权限 action，默认允许、可通过规则改为询问或拒绝。剩余：无。另增加 Serper 搜索 provider、webfetch 私网地址拦截（含 DNS 解析与重定向校验）与 5 分钟页面缓存。

**验收**：Agent 能抓取网页并读取正文，能用配置的搜索服务返回结果；两者都可以被权限规则限制。

- [x] 增加 `webfetch`：URL、format（markdown/text/html）、超时与输出限制
- [x] 增加 `websearch`：搜索 provider 配置与结果格式化
- [x] 为两个工具增加独立权限 action
- [x] 设置页展示搜索 provider 状态
- [x] 更多搜索 provider 与私有地址访问策略
- [x] 测试 HTML 转 markdown、错误处理、超时、权限控制

### P1-4 附件与 @ 文件引用

**进度（2026-11-21）**：已实现输入框附件（选择、拖拽、粘贴）、文本 / 图片 / PDF 支持（文本注入为 text part，PDF 优先抽取文本，抽取失败回退为多模态输入）、大小与类型校验、图片超过 1568px 自动缩放、图片附件缩略图预览、消息附件持久化与历史回放、删除会话时清理附件、以及 `@` 文件搜索与引用插入。

**验收**：可以拖入或粘贴图片、文本文件作为上下文；输入 `@` 能搜索并引用工作区文件。

- [x] 输入框支持选择文件、拖拽与粘贴
- [x] 支持文本、图片、PDF；文本直接注入，图片/PDF 作为模型输入
- [x] 支持 `@` 文件搜索与引用
- [x] 图片尺寸与大小限制、自动缩放
- [x] 扩展消息 parts 与持久化格式
- [x] 附件缩略图与 PDF 文本抽取
- [x] 测试附件解析、大小限制、引用补全、历史回放

### P1-5 自定义命令与 Skills

**进度（2026-11-21）**：已实现自定义命令发现（用户目录、`.opencode/command(s)`、`.claude/commands` 的 Markdown 与 `commands.json`）与 `$ARGUMENTS` / `$1..$9` 展开；输入框 `/` 菜单可搜索并插入命令，发送时自动展开。Skills 从用户目录、`.opencode/skill(s)`、`.claude/skills` 发现，启动时加载并把名称与描述注入 system prompt，`skill` 工具按需加载全文并纳入 `skill` 权限动作。剩余：无（命令可绑定 Agent / 模型，模板支持 `!` 包裹的 shell 片段，Skill 会附带资源文件清单）。

**验收**：输入 `/` 能选择自定义命令并按参数展开；Agent 能根据技能描述调用 `skill` 工具加载完整说明。

- [x] 支持 `.opencode/commands` 风格的 Markdown / JSON 命令
- [x] 输入框 `/` 命令菜单与参数替换
- [x] 支持 `.opencode/skills` 与 `.claude/skills` 发现
- [x] 增加 `skill` 工具与权限控制
- [x] 命令绑定 Agent / 模型与 shell 片段
- [x] 测试命令参数、Skills 发现、按需加载

### P1-6 Todo / 计划工具

**进度（2026-11-21）**：已实现 `todowrite` / `todoread`（整表替换、状态与优先级、会话持久化），输入框上方的任务面板展示进度与状态，plan 模式也可用；与 OpenCode 一致，todo 工具不单独做权限审批。剩余：无。任务状态由模型通过 todo 工具维护，与 OpenCode 一致，不做自动推进。

**验收**：多步骤任务会在会话中留下可勾选的任务清单，重启后仍可查看。

- [x] 增加 `todowrite` / `todoread` 工具
- [x] 输入框上方任务面板展示当前任务列表与进度
- [x] 权限控制与持久化（沿用会话权限模型；todo 工具本身不单独审批）
- [x] 测试任务增删改查、历史恢复

### P1-7 模型目录与能力元数据

**进度（2026-11-21）**：接入 models.dev 目录（24 小时磁盘缓存、离线回退到缓存）；模型表单与供应商表单支持“从目录填充”；模型新增最大输出、推理、附件能力与输入/输出价格元数据，运行时使用最大输出并计算每条消息成本，推理与附件控件按模型能力显隐。剩余：无。供应商支持 API Key 与通用 OAuth 2.0 两种认证方式（授权码 + PKCE、加密 token、自动刷新、设置页授权 / 退出）；ChatGPT / Copilot 等供应商专属 OAuth 流程未内置。模型变体可在模型表单中定义并在输入框选择，变体参与推理强度、温度与最大输出；创建供应商时可勾选并导入其模型。

**验收**：添加模型时可以从目录带出上下文、能力与价格；不具备推理或附件能力的模型会隐藏对应控件。

- [x] 接入 models.dev 模型目录，支持从目录填充供应商与模型
- [x] 一键创建供应商并导入全部模型
- [x] 支持 OAuth / API Key 两种认证方式（OpenAI 与 OpenAI 兼容供应商）
- [x] 模型元数据：上下文窗口、最大输出、推理能力、成本
- [x] 模型 variants（不同推理配置）
- [x] 根据能力启用或隐藏推理强度与附件入口
- [x] 测试目录解析与缓存、能力映射、成本计算

### P1-8 会话体验补齐

**进度（2026-11-21）**：已实现会话分叉（整段会话或从任意 assistant 消息）、按标题与消息内容搜索、首轮结束后 LLM 生成会话标题、消息成本与会话总成本、上下文占用进度条。分叉会复制所选消息及模型 / 权限 / Agent 设置，并重置任务列表与压缩状态。

**验收**：可以从任意一轮分叉出新会话；能搜索历史消息；首轮对话后标题由模型生成；头部显示成本与上下文占用。

- [x] 会话分叉（fork）
- [x] 会话搜索
- [x] 上下文占用条
- [x] 成本统计（每条消息 + 会话合计）
- [x] LLM 生成会话标题（当前取首条消息的回退保留）
- [x] 测试分叉、搜索、标题生成、成本与上下文展示

### P1-9 Question 工具

**进度（2026-11-21）**：已实现 `question` 工具（单选、多选、自由输入）、输入框上方的问答卡片、10 分钟超时与运行停止时的取消；答案回传给工具结果。子代理发起的提问会路由到父会话展示，回答后继续子代理执行。

**验收**：Agent 在执行中需要用户决策时会弹出结构化问答卡片，回答后继续执行。

- [x] 增加 `question` 工具：单选、多选、自由输入
- [x] 输入框上方展示提问卡
- [x] 取消与超时处理
- [x] 权限控制（与 OpenCode 一致不单独审批）
- [x] 子代理提问上抛到父会话
- [x] 测试单选、多选、自由输入、取消、超时

## P2：平台与生态

- [ ] Code Mode / `execute`：用 JavaScript 批量编排工具调用，减少中间结果进入上下文
- [ ] 并行工具编排与结果聚合
- [ ] Git worktree 管理：创建、列出、删除，并支持会话迁移
- [ ] 桌面浏览器自动化
- [x] Headless CLI（`pnpm cli -- ...`：prompt、工作区、模型、权限模式、会话续跑与 JSON 事件）
- [x] Server API / SDK（`pnpm serve`：REST + SSE、Bearer token、会话/消息/权限/提问接口与 `AteamClient` SDK）
- [ ] ACP / 编辑器集成
- [ ] GitHub Action
- [ ] SQLite / 事件溯源会话存储
- [x] References（命名外部资料：本地目录 / Git 仓库、描述注入、外部目录自动放行、设置页编辑）
- [x] 组织级 Policies（`agent/policy.json` 或 `ATEAM_POLICY_FILE`，权限规则最后生效）

## 建议实施顺序

1. ~~P0-1 上下文压缩~~ → 已完成基础版；剩余模型能力元数据并入 P1-7，上下文占用条并入 P1-8
2. ~~P0-2 项目规则~~、~~P0-4 权限规则~~ → 已完成
3. ~~P0-3 快照 / undo~~ → 已完成
4. ~~P0-5 工具集补齐~~、~~P0-6 LSP / 格式化~~ → 已完成基础版
5. ~~P1-1 MCP~~、~~P1-2 子代理~~ → 已完成（含 MCP OAuth 与后台子代理）
6. ~~P1-3 Web 工具~~ → 已完成基础版
7. ~~P1-4 ~ P1-6、P1-9~~ → 已完成基础版
8. ~~P1-7 模型目录与能力元数据~~、~~P1-8 会话体验~~ → 已完成基础版；P1 剩余项见各模块遗留，汇总见功能文档

## 关键依赖

- 模型能力元数据是上下文压缩、推理强度显隐、模型变体的共同基础。
- 权限规则系统是 MCP、子代理、Web 工具、Skills 等新工具统一审批的基础。
- 文件快照是 undo / redo、回滚到消息、以及后续 worktree 场景的基础。
- 工具输出落盘是后台 shell、MCP 大结果、Web 抓取大页面的共同基础设施。

## 参考

- ATeam：[runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)、[tools.ts](../apps/desktop/src/main/agent/tools.ts)、[message-history.ts](../apps/desktop/src/main/agent/message-history.ts)、[sessions-store.ts](../apps/desktop/src/main/agent/sessions/sessions-store.ts)、[model-types.ts](../packages/shared/src/model-types.ts)、[Composer.tsx](../apps/desktop/src/renderer/src/components/chat/Composer.tsx)
- OpenCode 文档：Tools、Agents、Permissions、Instructions、Compaction、Snapshots、MCP Servers、Skills、Commands、Attachments、Formatters、LSP
