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

## P0：可靠性、安全与编辑质量

### P0-1 上下文窗口管理与自动压缩

**现状**：每轮把完整历史重新提交（[message-history.ts](../apps/desktop/src/main/agent/message-history.ts)）；模型只有 id/name，没有上下文窗口等元数据（[model-types.ts](../packages/shared/src/model-types.ts)）；长会话最终会触发供应商 context overflow。

**OpenCode 参考**：自动 / 手动 / 后台压缩，保留最近一段对话，按模型窗口留 buffer，超长错误自动压缩后重试一次。

**进度（2026-11-21）**：已实现自动预检压缩、强制手动压缩、超长错误重试一次、压缩边界与摘要展示、上下文占用显示、后台预生成摘要和模型上下文窗口配置；provider 原生压缩和真实 tokenizer 仍待补充。

- [x] 为模型增加 `contextWindow` 元数据，并在模型表单与存储中维护
- [ ] 补充 `maxOutputTokens`、推理能力等模型元数据（与 P1-7 一起做）
- [x] 发送前估算输入 token（ASCII 与中文分别估算），按模型窗口与预留 buffer 判断是否需要压缩
- [x] 实现摘要压缩：保留最近 N tokens，把更早的轮次替换为一条压缩摘要消息
- [x] 原始消息继续持久化，压缩只影响发给模型的历史
- [x] 增加手动“压缩上下文”入口与压缩中状态；短历史也支持强制压缩
- [x] 捕获 context-too-long 类错误，自动压缩后重试一次，第二次失败如实报错
- [x] 在消息列表标记压缩边界，并可展开查看摘要
- [x] 展示上下文占用
- [x] 后台预生成摘要，达到阈值时复用
- [ ] provider 原生压缩
- [ ] 用模型 tokenizer 或真实用量替代启发式估算（与 P1-7 一起做）
- [x] 测试压缩阈值、摘要消息构建、超长重试、重启后恢复

**验收**：超过模型上下文窗口的会话仍可继续；压缩后原始消息仍能在 UI 查看；不会无限重试。

### P0-2 项目规则 AGENTS.md

**现状**：system prompt 完全硬编码（[runtime.ts:742](../apps/desktop/src/main/agent/runtime.ts:742)），不读取仓库的构建命令、测试要求或代码约定。

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

**现状**：会话级 mode + 内存中的 `allowed` 集合（[runtime.ts:145](../apps/desktop/src/main/agent/runtime.ts:145)、[runtime.ts:432](../apps/desktop/src/main/agent/runtime.ts:432)）；没有通配符、路径或命令级规则，重启后“始终允许”丢失。

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
- [ ] MCP / Web / Skill / 子代理权限 action（随 P1-1/P1-2/P1-3）
- [x] 测试规则优先级、通配符匹配、持久化恢复、命令扫描

**验收**：用户可以对“某个目录的写操作”或“某类命令”设置永久允许/拒绝；重启后规则仍然有效。

### P0-5 工具集补齐

**进度（2026-11-21）**：已增加 glob、patch 多文件编辑、后台 shell 与完成通知、shell 输出流式回传、大输出落盘、grep literal / caseSensitive / limit，以及工作区外路径的 `external_directory` 审批。剩余：按模型暴露 apply_patch、glob 超时、ripgrep 加速、read 图片/PDF。

- [x] 增加 `glob` 工具：`**/*.ts` 模式、hidden、limit（超时待补）
- [x] 增加 `patch` / `apply_patch` 多文件工具：新增、更新、删除文件
- [ ] 对支持的模型优先暴露 patch，其余模型继续使用 edit / write
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

- [ ] 增加 LSP 客户端管理：按项目与语言启动、复用、关闭
- [ ] 读取 / 写入 / 编辑后请求 diagnostics，并注入工具结果或下一轮上下文
- [ ] 先实现 diagnostics，后续再补 hover / definition 等查询
- [ ] 自动识别并执行 prettier、biome、gofmt 等格式化器
- [ ] 设置页提供开关与状态显示
- [ ] 测试诊断注入、格式化器发现、格式化失败不影响主流程

**验收**：Agent 修改 TypeScript 文件后能看到类型错误；文件写入后按项目配置自动格式化。

## P1：日常编码效率

### P1-1 MCP（Model Context Protocol）

- [ ] 增加 MCP 配置存储与设置页
- [ ] 支持本地（stdio）与远程（HTTP）MCP server
- [ ] 支持 OAuth 与自定义 headers
- [ ] 把 MCP 工具注册进工具列表，并纳入权限规则
- [ ] 支持 MCP resources / prompts
- [ ] 断线重连与连接状态展示
- [ ] 测试配置校验、工具注册、权限匹配、断线恢复

### P1-2 子代理与自定义 Agent

- [ ] 内置 primary agents：build、plan
- [ ] 内置 subagents：general、explore
- [ ] 支持 Markdown / JSON 自定义 Agent：system prompt、model、permissions、steps
- [ ] 增加 `subagent` 工具：子会话、后台运行、完成后回报
- [ ] 支持继续同一个子会话
- [ ] 会话头部增加 Agent 选择器
- [ ] 测试 Agent 解析、子会话创建、后台回报、嵌套深度限制

### P1-3 Web 工具

- [ ] 增加 `webfetch`：URL、format（markdown/text/html）、超时与输出限制
- [ ] 增加 `websearch`：搜索 provider 配置与结果格式化
- [ ] 为两个工具增加独立权限 action
- [ ] 设置页展示搜索 provider 状态
- [ ] 测试 HTML 转 markdown、错误处理、权限控制

### P1-4 附件与 @ 文件引用

- [ ] 输入框支持选择文件、拖拽与粘贴
- [ ] 支持文本、图片、PDF；文本直接注入，图片/PDF 作为模型输入
- [ ] 支持 `@` 文件搜索与引用
- [ ] 图片尺寸与大小限制、自动缩放
- [ ] 扩展消息 parts 与持久化格式
- [ ] 测试附件解析、大小限制、引用补全、历史回放

### P1-5 自定义命令与 Skills

- [ ] 支持 `.opencode/commands` 风格的 Markdown / JSON 命令
- [ ] 输入框 `/` 命令菜单与参数替换
- [ ] 支持 `.opencode/skills` 与 `.claude/skills` 发现
- [ ] 增加 `skill` 工具与权限控制
- [ ] 测试命令参数、Skills 发现、按需加载

### P1-6 Todo / 计划工具

- [ ] 增加 `todowrite` / `todoread` 工具
- [ ] 消息流或侧栏展示当前任务列表与进度
- [ ] 权限控制与持久化
- [ ] 测试任务增删改查、历史恢复

### P1-7 模型目录与能力元数据

- [ ] 接入 Models.dev 或等价模型目录，支持一键导入供应商与模型
- [ ] 支持 OAuth / API Key 两种认证方式
- [ ] 模型元数据：上下文窗口、最大输出、推理能力、成本
- [ ] 模型 variants（不同推理配置）
- [ ] 根据能力启用或隐藏推理强度选项
- [ ] 测试目录同步、能力映射、变体选择

### P1-8 会话体验补齐

- [ ] 会话分叉（fork）
- [ ] 会话搜索
- [ ] 上下文占用条
- [ ] 成本统计
- [ ] LLM 生成会话标题（当前取首条消息）
- [ ] 测试分叉、搜索、成本计算

### P1-9 Question 工具

- [ ] 增加 `question` 工具：单选、多选、自由输入
- [ ] 输入框上方或消息流内展示提问卡
- [ ] 取消与超时处理
- [ ] 权限控制
- [ ] 测试单选、多选、自由输入、取消

## P2：平台与生态

- [ ] Code Mode / `execute`：用 JavaScript 批量编排工具调用，减少中间结果进入上下文
- [ ] 并行工具编排与结果聚合
- [ ] Git worktree 管理：创建、列出、删除，并支持会话迁移
- [ ] 桌面浏览器自动化
- [ ] Headless CLI
- [ ] Server API / SDK
- [ ] ACP / 编辑器集成
- [ ] GitHub Action
- [ ] SQLite / 事件溯源会话存储
- [ ] References（命名外部资料）与组织级 Policies

## 建议实施顺序

1. ~~P0-1 上下文压缩~~ → 已完成基础版；剩余模型能力元数据并入 P1-7，上下文占用条并入 P1-8
2. ~~P0-2 项目规则~~、~~P0-4 权限规则~~ → 已完成；下一步 P0-3 / P0-6
3. ~~P0-3 快照 / undo~~ → 已完成；下一步 P0-6 LSP / 格式化
4. ~~P0-5 工具集补齐~~ → 已完成基础版；下一步 P0-6 LSP / 格式化
5. P1-1 MCP + P1-2 子代理
6. P1-3 / P1-4 / P1-5 / P1-6 / P1-9 按产品优先级穿插

## 关键依赖

- 模型能力元数据是上下文压缩、推理强度显隐、模型变体的共同基础。
- 权限规则系统是 MCP、子代理、Web 工具、Skills 等新工具统一审批的基础。
- 文件快照是 undo / redo、回滚到消息、以及后续 worktree 场景的基础。
- 工具输出落盘是后台 shell、MCP 大结果、Web 抓取大页面的共同基础设施。

## 参考

- ATeam：[runtime.ts](../apps/desktop/src/main/agent/runtime.ts)、[tools.ts](../apps/desktop/src/main/agent/tools.ts)、[message-history.ts](../apps/desktop/src/main/agent/message-history.ts)、[sessions-store.ts](../apps/desktop/src/main/agent/sessions-store.ts)、[model-types.ts](../packages/shared/src/model-types.ts)、[Composer.tsx](../apps/desktop/src/renderer/src/components/chat/Composer.tsx)
- OpenCode 文档：Tools、Agents、Permissions、Instructions、Compaction、Snapshots、MCP Servers、Skills、Commands、Attachments、Formatters、LSP
