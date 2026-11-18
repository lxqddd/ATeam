# 产品总览：愿景、用户与价值主张

| 项目 | 内容 |
|---|---|
| 文档编号 | PRD-00 |
| 产品 | ATeam |
| 文档状态 | 草案 v0.2，以 M0 代码库为基线 |
| 更新日期 | 2026-11-17 |
| 适用范围 | 产品、设计、工程、决策评审 |
| 需求 ID 前缀 | PROD-xxx（产品级需求）、US-PROD-xx（本章用户故事）；模块级需求见各模块文档 |

## 本章导读

本章是 ATeam 产品需求文档的总纲，回答四个问题：ATeam 为什么存在、为谁而做、提供什么独特价值、依据什么原则演进。阅读本章后，读者应当能够用一句话解释 ATeam，判断一个需求是否属于产品范围，并理解 M0 到 M4 各里程碑之间的逻辑关系。本章给出字段、状态、API 与交互的产品级摘要，具体字段、接口与交互细节以 `prd/modules/` 下的模块文档为准；里程碑的验收脚本与演示流程由 `prd/milestones/` 下的文档负责，跨里程碑的范围、发布门禁与依赖关系由 `prd/01-scope-and-roadmap.md` 负责。

本章中的「当前已实现」均以仓库代码为准，截至 M0 骨架；「计划中」均属于 M1-M4，不代表已经可用。任何模块文档如果与本文件的产品原则、目标用户或非目标冲突，以本文件为准；模块文档可以在本文件基础上细化，但不能削弱本地优先、人工在回路、证据化完成定义等底线约束。

## 1. 产品愿景与一句话定义

### 1.1 一句话定义

ATeam 是一个本地优先、开源的多 Agent 开发驾驶舱：开发者在自己的机器上，用可复用的 Agent 配置并行执行真实开发任务，通过隔离工作区、证据化交付和人工评审，把 Agent 的产出安全地合入代码库。

这句话包含五个不可拆分的要素：

1. **本地优先**：默认在开发者自己的电脑上运行，代码、任务、运行记录默认不离开本机。
2. **开源**：核心实现以 Apache-2.0 发布，Runtime 适配器接口对社区开放；插件 API 在 M4 提供，但仅覆盖非 Runtime 的扩展点，第三方 Agent Runtime 适配器仍需在核心注册表登记。
3. **多 Agent**：不是让一个 Agent 做更多事，而是让多个 Agent 在结构化协作下同时推进不同任务。
4. **开发驾驶舱**：产品负责调度、上下文、隔离、观测、评审与治理，不负责模型训练、模型托管或模型转售。
5. **真实开发任务**：面向代码仓库中的实际改动，而不是演示、问答或纯文本生成。

### 1.2 愿景陈述

ATeam 的长期愿景是：**让每一位开发者都拥有一支可控、可审计、可复用的 Agent 团队。**

「可控」意味着 Agent 不能绕过人工审批去执行合并、推送、部署、删除等高风险动作；「可审计」意味着每一次 Run 都有上下文、事件、产物和评审记录，能够回答「谁在什么时候用什么配置做了什么，结果如何」；「可复用」意味着 Agent 的指令、权限、Runtime 配置和角色模板可以沉淀下来，跨任务、跨成员、跨机器复用，而不是每次重新写一段提示词。

这个愿景有意与「全自动 AI 员工」保持距离。ATeam 不承诺无人值守地交付软件，而是把开发者从上下文搬运、工作区协调、日志翻找和低价值验证中解放出来，让人的判断力集中在真正需要判断的地方：范围取舍、方案选择、风险评估和最终合入。

### 1.3 定位：驾驶舱，而不是引擎或工厂

用交通系统做类比，ATeam 的定位是「驾驶舱」：

- **引擎**是模型与编码 Agent CLI。模型能力、推理质量、计费由 Runtime 及其提供方决定，ATeam 不复制、不转售、不托管模型。
- **工厂**是云端批量执行平台。它追求集中调度、统一算力和多租户隔离，但要求代码离开本机，信任成本高。
- **驾驶舱**负责仪表、航线、隔离舱、检查单和人工确认。它不制造动力，但让动力被安全、清晰、可重复地使用。

因此，ATeam 的核心资产不是模型，而是围绕任务执行形成的协作语义：Task 作为上下文容器，Agent 作为持久工作配置，Run 作为一次可追溯执行，Workspace 作为隔离边界，Artifact 与 Evidence 作为完成凭据，Human Review 与 Approval Gate 作为治理节点。

### 1.4 长期成功图景

三年维度上，如果产品成功，应当出现以下可观察的状态：

- 一名独立开发者在同一块看板上管理 5 个左右的 Agent，每个 Agent 在独立 worktree 中工作，开发者用 diff、测试结果和截图完成评审，再决定合并。
- 一个 5 人左右的产品团队共享 Task、Agent 模板和执行机器，任务通过依赖 DAG 与交付物契约交接，成员可以在收件箱中集中处理待审批与待评审事项。
- 社区贡献者可以在 M0-M1 通过实现 Runtime 适配器接口并在核心注册表登记，接入新的编码 Agent CLI；M4 提供插件 API 后，非 Runtime 扩展可不修改核心代码加载，但第三方 Agent Runtime 适配器不在插件 API 范围。角色 Agent 配置可在 M2 通过模板分享。
- 团队能够用审计记录回答合规问题：某次生产部署由谁批准、依据哪次 Run 的证据、当时 Agent 拥有哪些权限。
- 开发者不再把「同时开多个 Agent」视为高风险的手工操作，而是视为一种有边界、有证据、有退路的日常开发方式。

这些图景是方向性描述，不是承诺的具体功能清单；对应的可度量目标见第 12 章。

## 2. 要解决的问题

### 2.1 断层：个人 AI native，协作不 native

单个开发者使用 Claude Code、Codex 等编码 Agent 时，工作流已经相对顺畅：人写清楚任务，Agent 在终端里读代码、改文件、跑测试，人看 diff 后决定是否保留。这个闭环的关键是「一个人、一个会话、一个工作目录」，人天然承担了调度器和审核者。

当 Agent 数量从 1 增加到 3-5 个，问题不再是「Agent 会不会写代码」，而是「人如何同时管理多个执行中的工作」：

- 任务背景散落在聊天记录、临时提示词和个人记忆里，换一个 Agent 就要重新交代一遍。
- 多个 Agent 如果共享同一个工作目录，会互相覆盖文件、切换分支、污染未提交改动。
- 每个 Agent 的执行过程只在各自的终端滚动，失败原因难以复盘，也无法统一回答「现在有几个任务在跑、卡在哪一步」。
- Agent 说「已完成」并不等于可合并，人仍要重新跑测试、重新看 diff、重新确认边界。
- 合并、推送、部署等不可逆动作缺少审批与留痕，团队不敢把更多任务交给 Agent。
- 多角色协作如果采用「多个 Agent 在同一个会话里自由聊天」，结果不确定、责任不清晰、过程不可复现。

这就是本产品要解决的断层：**个人使用 AI 已经 native，多 Agent 与团队协作仍然停留在手工拼接阶段。** ATeam 要提供的不是更强的模型，而是让多个 Agent 的执行变得可调度、可隔离、可观察、可评审、可治理的协作层。

### 2.2 问题清单

| 编号 | 问题 | 典型表现 | 直接后果 | ATeam 的应对 | 里程碑 |
|---|---|---|---|---|---|
| P1 | 上下文不可复用 | 每个任务重新写提示词，验收标准只存在于人的脑中 | 返工、误解、Agent 产出漂移 | Task 作为上下文容器，Agent 作为持久配置；M0 Run 记录 taskId/agentId 与事件，M1 增加配置与提示词快照 | M0 部分，M1 完整 |
| P2 | 工作区互相干扰 | 多个 Agent 在同一 checkout 改文件、切分支 | 改动丢失、冲突难解、无法并行 | 每次 Run 使用独立 Run Workspace；M1 起使用 git worktree 与独立分支 | M1 |
| P3 | 执行过程黑盒 | 日志只在终端，失败后无法定位阶段 | 排障靠猜，无法度量 | Run 状态机、RunEvent 事件流、WebSocket 实时推送 | M0 |
| P4 | 完成缺少证据 | Agent 自述完成，人重新验证 | 评审成本高，信任难建立 | Artifact（M1）与 Evidence（M2）模型，证据化 DoD，评审界面聚合 diff 与测试结果 | M1 Artifact，M2 Evidence |
| P5 | 高风险动作无治理 | Agent 直接合并、推送或部署 | 事故、合规风险、团队不敢放权 | 风险分级审批门；合并审批记录在 M1，推送、部署、删除与通用审批门在 M2 | M1 合并，M2 扩展 |
| P6 | 多角色协作靠自由聊天 | 多个 Agent 在同一会话互相打断、重复劳动 | 不可复现、责任不清、成本失控 | 任务依赖 DAG、交付物契约、角色模板、审批门 | M2 |
| P7 | 配置无法沉淀 | 每个成员各自维护一套提示词和权限 | 团队水平不一致，新人上手慢 | Agent 模板、技能、共享 Agent、收件箱 | M2-M3 |
| P8 | 可观测性割裂 | 任务看板、终端日志、git 状态各看一处 | 无法形成统一工作视图 | 单一事实来源：SQLite + HTTP/WS API + 驾驶舱 UI | M0 基础，M1-M2 扩展 |

### 2.3 不解决会怎样

一个具体的失败路径：开发者同时启动 4 个 Agent 处理 4 个任务，其中两个任务都涉及同一个路由文件。第一个 Agent 改完后未提交，第二个 Agent 在同一目录继续修改并覆盖了前者的改动；第三个 Agent 运行失败，但终端窗口已经关闭，只剩一句「exit code 1」；第四个 Agent 声称完成，开发者直接合并，结果测试在 CI 才失败。最终，开发者需要花比自己做更多的时间去复原现场、判断哪些改动来自哪个 Agent、重新验证哪些结论可靠。结论往往是「多 Agent 不靠谱，还是自己写吧」。

ATeam 的产品价值就是阻断这条失败路径：M1 起，每个 Run 有独立工作区与分支，事件流可回放，完成必须附证据，合并必须经人批准。即使 Agent 仍然会犯错，错误也应当是局部的、可定位的、可回滚的，而不是相互污染、无法追溯的。

### 2.4 问题边界

以下问题不属于 ATeam 的责任范围，产品不应当试图解决：

- **模型能力不足**：Agent 是否能理解复杂代码、是否会产生幻觉，由 Runtime 与模型决定；ATeam 通过可替换 Runtime 让用户选择，但不训练模型。
- **模型成本与配额**：调用费用由用户与 Runtime 提供方结算；ATeam 只提供用量观测的扩展空间，不做转售。
- **代码托管与 CI 执行**：ATeam 集成 git 与代码托管平台的评审流程，但不替代代码托管、流水线或制品仓库。
- **通用项目管理**：ATeam 的 Task 服务于 Agent 执行与评审，不追求成为完整的敏捷管理套件。
- **终端仿真与 IDE 能力**：ATeam 展示 Run 日志与 diff，但不试图替代开发者的编辑器。

## 3. 为什么是现在

### 3.1 编码 Agent CLI 已成为可用的本地执行层

Claude Code、Codex 等编码 Agent CLI 已经证明：在真实仓库中读代码、改文件、运行命令、迭代修复是可行的。它们以本地进程方式运行，天然适配开发者的机器、凭据与工具链。ATeam 不需要从零构建 Agent，只需要把「启动哪个 CLI、给它什么上下文、在哪个目录运行、如何收集事件」抽象成 Runtime 适配器。执行层的成熟，是多 Agent 驾驶舱成立的前提。

### 3.2 执行成本结构与本地硬件的变化

本地执行意味着边际成本透明：用户使用自己的订阅或 API Key，按自己的用量付费，ATeam 不承担模型成本，也不需要加价转售。与此同时，开发者的个人电脑已经足以同时运行多个 Agent 进程、一个本地 Go 服务、一个 SQLite 数据库和一个桌面 WebView。把调度放在本地，不再需要昂贵的云端沙箱即可获得可用的并行度。

### 3.3 代码数据边界成为采用前提

代码是最敏感的开发资产之一。云端 Agent 平台通常要求上传仓库或授予仓库访问权限，这对个人开发者、外包团队和受合规约束的组织都是实际门槛。本地优先提供了不同的信任模型：代码默认不离开本机，网络只用于模型调用；团队模式也优先支持自托管与远程 Runner，而不是强制多租户 SaaS。数据边界不是营销口号，而是能否被采用的前提条件。

### 3.4 工程基础设施已经就绪

多 Agent 协作需要的隔离、评审与回滚原语，git 已经提供：worktree 提供并行工作目录，branch 提供改动边界，diff 提供评审对象，commit 与 merge 提供回滚与合入语义。ATeam 不需要发明新的版本控制，只需要正确地编排这些原语。桌面侧，Wails v3 让 Go 服务与原生 WebView 组合成单机应用；前端侧，Vue 3、TypeScript、Vite、Pinia 与 UnoCSS 足以构建复杂的驾驶舱界面；存储侧，SQLite 适合单机与小队场景。技术栈的成熟让团队可以把精力放在协作语义，而不是基础设施。

### 3.5 使用习惯正在迁移

开发者已经习惯把任务委托给单个 Agent，并在终端里审阅它的改动。下一步自然是「同时委托多个任务」。当前的瓶颈不是模型智商，而是协调成本：上下文交接、工作区隔离、执行观测、评审证据与高风险治理。谁先把这些协调成本降到可接受，谁就定义了多 Agent 开发的默认工作方式。

### 3.6 时机窗口与反证

这个窗口并非无限。编码 Agent CLI 提供方可能自行增加多任务编排能力；云端平台可能以更低的信任门槛渗透；通用工作流工具也可能把 Agent 执行纳入既有编排。ATeam 的防御不是「模型更强」，而是三点组合：本地数据边界、开放的 Runtime 适配器生态、围绕角色 Agent 的交付物契约与证据模型。这三点都要求深度的产品语义，而不是简单的 API 调用。

如果未来出现以下反证，产品方向需要重新评估：编码 Agent CLI 普遍提供稳定的多任务协作协议，且用户不介意把调度交给 CLI；或者本地执行成本优势消失，用户普遍接受云端沙箱；或者开发者对多 Agent 并行没有真实需求，单 Agent 串行已足够。这些反证应当在 M1-M2 的用户研究中持续验证，而不是等到 M4。

## 4. 目标用户与画像

### 4.1 用户分层

**核心用户 A：独立开发者 / 一人公司。** 他们同时推进 3-5 个任务，既是产品经理也是工程师，时间碎片化，最在意「不用等我串行处理」。他们通常熟悉终端，愿意自己配置 Runtime 与 Key，对数据边界敏感，对价格敏感，偏好开源与可自托管。

**核心用户 B：2-10 人小团队。** 他们有共享的任务池、代码仓库和发布流程，已经开始使用编码 Agent，但协作仍靠口头同步与手工交接。他们需要共享 Agent 配置、任务分派、评审记录和基本审计，但不希望引入重型项目管理平台。他们关心「团队水平拉齐」与「Agent 产出可追责」。

**决策与治理角色 C：平台 / DevOps 负责人。** 他们不一定每天使用看板，但决定团队能否采用。他们关心权限边界、命令与路径限制、审计记录、远程 Runner、机器注册、密钥管理，以及生产部署的人工控制。他们是 M2-M3 的主要买单者与阻力来源。

**次要用户 D：技术负责人 / 评审者。** 他们主要使用评审队列与证据视图，判断 Agent 的产出是否可以合入。他们的效率直接决定人工介入成本，是评审体验的主要设计对象。

**次要用户 E：开源贡献者 / 扩展开发者。** 他们通过 Runtime 适配器、模板、插件 API 参与生态建设，是 M4 之后的增长杠杆；第三方 Agent Runtime 适配器仍走核心注册表。

### 4.2 用户画像

| 画像 | 典型环境 | 当前做法 | 核心痛点 | 采用触发点 | 成功定义 |
|---|---|---|---|---|---|
| 独立开发者 A | macOS 笔记本，1-2 个仓库，已有 Claude Code 或 Codex 订阅 | 开多个终端，手工切换目录与分支，用聊天记录保存上下文 | 并行即混乱，评审与验证时间被压缩 | 一次配置后能同时跑 3 个任务，且不互相踩踏 | 每周有多个 Run 被自己接受并合入，返工减少 |
| 小团队 B | 2-10 人，共享 git 仓库，成员各自有 Runtime 账号 | 口头分派任务，Agent 配置各自维护，评审靠 PR | 配置不一致，交接丢上下文，无法追责 | 共享 Agent 与任务池能直接复用，评审有证据 | 团队评审通过率稳定，新成员一周内可上手 |
| 平台负责人 C | 管理若干开发机或远程 Runner，关注合规 | 禁止或限制 Agent 直接操作生产，靠人工流程兜底 | 高风险动作不可控，缺少审计 | 审批门、权限策略、审计日志可配置 | 高风险动作 100% 留痕，无越权执行 |
| 评审者 D | 技术负责人，时间碎片化 | 在 diff、终端日志、聊天记录之间来回切换 | 评审材料分散，难以判断是否完成 | 一个界面看到 diff、测试、截图与 Agent 摘要 | 单次评审时间下降，误合减少 |
| 贡献者 E | 开源开发者，熟悉 Go 或 TypeScript | 为不同 CLI 写脚本胶水 | 缺少稳定扩展点，重复适配 | Runtime 适配器接口与插件文档清晰 | 通过适配器接口与注册表接入新 Runtime；M4 插件化只覆盖非 Runtime 扩展 |

### 4.3 关键场景叙事

**场景一：独立开发者的一天（M1 起）。** 早上，开发者打开 ATeam 看板，看到三个待执行任务：修复登录跳转、补充账单页空状态、升级依赖。他为三个任务分别选择前端 Agent、UI Design Agent 与 DevOps Agent，启动三个并行 Run。每个 Run 在独立 worktree 中工作，事件流实时显示进度。中午，两个 Run 完成并附带 diff 与测试结果，另一个因缺少环境变量失败。开发者先处理失败 Run，修正配置后重跑；然后逐个评审成功的 Run，接受其中一个、对另一个留下修改意见。整个过程没有手工切换目录，也没有在聊天记录里翻找上下文。

**场景二：小团队交付一个功能（M2）。** 团队要为「邀请成员」功能拆解任务：UI Design 产出交互稿与组件规范，Frontend 与 Backend 分别实现，最后由 DevOps 给出 staging 部署计划。任务之间存在依赖：前端与后端都依赖 UI 契约，集成任务依赖前后端完成。ATeam 用任务 DAG 表达依赖，用交付物契约规定每一环的产出格式与验收标准；上游交付物未通过验收时，下游不启动。所有角色 Agent 的产出进入评审队列，技术负责人批准后才进入合并与 staging。生产部署仍由人工执行。

**场景三：平台负责人的治理（M3）。** 平台负责人注册团队机器与远程 Runner，配置哪些 Agent 可以访问哪些路径、可以执行哪些命令，把合并、推送、部署、删除标记为高风险动作。任何高风险动作都会生成审批请求，进入负责人或值班人的收件箱；批准与拒绝都记录操作者、时间、理由与关联 Run。季度审计时，他可以导出某段时间内所有高风险动作及其证据链。

**场景四：新成员上手（M2）。** 新成员加入团队后，从模板创建一个功能任务集，直接复用团队共享的 UI、Frontend、Backend、DevOps Agent 配置与交付物契约模板。他不需要从头理解每个 Agent 的提示词，只需要补充任务特有的背景与验收标准。第一周内，他就能独立完成一次从 Task 到 Review 的闭环。

### 4.4 反画像

以下人群不是初期目标用户，产品不应为其做妥协性设计：

- **追求完全无人值守交付的团队**：ATeam 坚持人工评审门与高风险审批，不承诺无人化。
- **需要 20 个以上开箱即用集成的组织**：初期只聚焦 git、代码托管与 Runtime 适配，集成广度后置。
- **非技术管理者或移动端用户**：驾驶舱面向能理解仓库、分支、diff 与测试的开发者。
- **需要模型托管或转售的分销商**：ATeam 不提供模型托管，不做模型转售。
- **需要多租户 SaaS 与强合规认证的大型企业**：M3 的团队模式优先自托管与远程 Runner，不定位为多租户 SaaS。

## 5. Jobs-to-be-Done

### 5.1 核心 JTBD

用户「雇用」ATeam 不是为了看一个更漂亮的看板，而是为了完成以下工作。每条 JTBD 都对应可观察的成功信号，便于后续用户研究与指标设计。

| 编号 | 情境 | 用户想完成的工作 | 当前替代方案 | ATeam 的支撑 | 成功信号 |
|---|---|---|---|---|---|
| JTBD-01 | 手上有多个互不依赖的任务 | 让多个 Agent 同时推进，缩短等待时间 | 开多个终端，手工切换 | 并行 Run、调度队列、看板状态、独立 Workspace | 同时运行的任务数上升，端到端交付时间下降 |
| JTBD-02 | 把任务交给 Agent | 一次定义背景、约束与验收标准，后续可复用 | 每次重写提示词，复制聊天记录 | Task 上下文容器、Agent 持久配置、模板 | 单个任务的上下文准备时间下降，返工减少 |
| JTBD-03 | 多个 Agent 同时改代码 | 让它们互不踩踏，且改动边界清晰 | 手工复制仓库或频繁切分支 | 每 Run 独立 worktree 与分支，Workspace 隔离 | 并行期间无跨 Run 文件污染，冲突可定位 |
| JTBD-04 | Agent 声称完成 | 快速获得 diff、测试、截图等证据并判断能否合入 | 手工跑测试、翻终端、比对文件 | Artifact/Evidence、证据化 DoD、评审视图 | 单次评审时间下降，误合率下降 |
| JTBD-05 | Agent 想执行高风险动作 | 在不可逆动作前被明确询问，并留下记录 | 依赖口头约定与人工盯守 | 风险分级、Approval Gate、审计记录 | 高风险动作审批覆盖率 100%，越权为 0 |
| JTBD-06 | 一个功能需要多角色协作 | 按依赖与交付物契约推进，而不是自由聊天 | 人工拆任务、口头交接、反复对齐 | 任务 DAG、交付物契约、角色模板；Crew 在 M2.2 后置 | 上游交付物一次验收通过率上升，跨角色返工下降 |
| JTBD-07 | 团队扩大、成员增多 | 共享 Agent、模板与机器，同时不泄露代码 | 各自维护配置，靠文档同步 | 共享 Agent、模板、远程 Runner、权限 | 新成员上手时间下降，配置漂移减少 |
| JTBD-08 | Run 失败或卡住 | 快速定位是任务描述、环境、权限还是 Runtime 的问题 | 翻日志、猜原因、重跑 | RunEvent 事件流、错误分类、取消与超时 | 失败平均定位时间下降，重复失败减少 |
| JTBD-09 | 需求尚未成形，需要先与不同角色讨论 | 把多个角色 Agent 组成小组，在一个会话中得到合适角色的意见，并把结论转成任务 | 在多个聊天窗口间复制粘贴，结论散落 | Agent Team、小组会话、自动路由与 `@` 定向、一键转任务（M2.3） | 任务创建前的澄清轮次下降，讨论到执行的追溯率上升 |
| JTBD-10 | 同时管理多个 Agent | 一眼判断每个 Agent 是否在工作、刚完成了什么，并查看其工作上下文与过程 | 逐个打开 Run 列表或 Task 详情，靠记忆判断 | Agent 工作状态看板、Agent 工作页、工作上下文与完成过程（M2.4） | 判断 Agent 状态的时间下降，复盘单个 Agent 工作的步骤减少 |

### 5.2 情感与社会性 Job

除了功能性任务，用户还有两层隐性诉求：

- **安心感**：Agent 可以犯错，但错误不应造成不可逆损失。隔离工作区、证据、审批门共同提供「可以放心让它试」的心理安全感。
- **掌控感**：开发者需要知道当前有哪些 Run 在跑、各自处于什么状态、下一步需要自己做什么，而不是被多个黑盒进程牵着走。
- **团队信任**：团队需要一套共同语言来判断 Agent 产出是否可信，证据与审计记录让「我觉得可以」变成「有依据可以」。

产品设计如果只优化吞吐量而忽略这三层诉求，会导致用户虽然跑得更快，却不敢把更多任务交给 Agent，最终回到单 Agent 模式。

### 5.3 JTBD 优先级

M0-M1 优先满足 JTBD-01、JTBD-02、JTBD-03、JTBD-04、JTBD-08，即「一个人能安全地并行并把结果接下来」。M1 先交付 JTBD-05 的合并审批，M2 扩展为完整高风险治理；M2 优先满足 JTBD-06，即「多角色协作」，其中 Crew 在 M2.2 后置；M2.3 满足 JTBD-09，即「执行前的跨角色讨论」，它不替代 JTBD-06 的结构化协作，而是为其提供任务成形前的讨论层；M2.4 满足 JTBD-10，即「多个 Agent 的状态观察与工作复盘」。M3 优先满足 JTBD-07，即「团队规模化」。优先级依据是：没有隔离与证据，并行越多风险越大；没有角色契约，多 Agent 协作会退化为自由聊天；没有团队共享，产品停留在个人工具。

## 6. 核心价值主张

### 6.1 价值主张陈述

面向需要同时推进多个开发任务的独立开发者与 2-10 人小团队，ATeam 是一个本地优先、开源的多 Agent 开发驾驶舱。它把任务上下文、Agent 配置、隔离工作区、执行事件、交付证据与人工评审组织成一条可追溯的闭环，让多个 Agent 的产出可以被安全地接受、拒绝或合并。与通用项目管理工具相比，ATeam 真正执行任务；与云端 Agent 平台相比，ATeam 让代码默认留在本机；与单 Agent CLI 相比，ATeam 增加了并行调度、隔离、证据与治理。

### 6.2 五大价值支柱

| 价值支柱 | 对用户的意义 | 产品体现 | 当前状态（M0） | 验证方式 |
|---|---|---|---|---|
| 本地优先 | 代码与运行数据默认不出本机，信任成本低 | Go 服务、SQLite、本地 Workspace、本地 WebView | 已实现：本地服务 + SQLite + 本地工作区 | 断网时 mock Run 可完成；网络仅用于模型调用 |
| BYO Runtime 与 Key | 用户自主选择模型与编码 CLI，成本透明，不被绑定 | Runtime Adapter 接口、Agent.runtime 字段、mock/claude 适配器 | 部分实现：接口与 mock、最小 claude 适配器已存在；未知 runtime 静默回退 mock，流式与权限待 M1 | 新增适配器不改领域模型与 HTTP handler；未知 Runtime 返回校验错误 |
| 开源可扩展 | 可审计、可自托管、可贡献适配器与模板 | Apache-2.0、模块化 Go 包、共享 TypeScript 类型 | 部分实现：仓库开源、接口分层；新增适配器仍需在核心注册表登记，尚无扩展文档与示例 | M0 新增适配器只改适配器与注册行；M4 插件 API 后不修改核心 |
| 角色 Agent 与契约协作 | 多角色按依赖与交付物交接，结果可复现 | Task DAG、交付物契约、角色模板、审批门；Crew 在 M2.2 后置 | 计划中：M2.1；M0 仅有 AssigneeType 与 ParentID 字段 | 上游交付物未验收时下游不启动；契约校验可测试 |
| 证据化评审与人工在回路 | Agent 提议、人决定，高风险动作有审批与留痕 | Artifact、Evidence（M2）、DoD、Review、Approval Gate、审计 | 部分实现：Run 事件与摘要已有；Artifact 与 Review 计划 M1，Evidence 与审批计划 M2 | 完成 Run 必须附证据；合并/部署无审批则被阻止 |

M0 的扩展边界需要单独说明：`internal/runtime/runtime.go` 的 `NewRegistry` 直接注册 mock 与 claude，新增适配器必须实现 `Adapter` 接口并在该注册表登记，但不需要修改 Task、Agent、Run 的领域字段或 HTTP handler。做到「不修改核心代码即可加载」属于 M4 插件 API 的目标，不应在 M0-M2 的对外说明中提前承诺。

### 6.3 问题与价值映射

| 问题 | 主要支撑价值 | 次要支撑价值 |
|---|---|---|
| P1 上下文不可复用 | Task 上下文容器 | Agent 持久配置、模板 |
| P2 工作区互相干扰 | Workspace 隔离 | 独立分支、Run 归属 |
| P3 执行过程黑盒 | Run 事件流与可观测性 | WebSocket 实时推送、驾驶舱 UI |
| P4 完成缺少证据 | 证据化评审 | Artifact/Evidence、DoD |
| P5 高风险动作无治理 | 人工在回路与审批门 | 审计、权限策略 |
| P6 多角色协作靠自由聊天 | 角色 Agent 与契约协作 | DAG、交付物契约、Crew（M2.2） |
| P7 配置无法沉淀 | 开源可扩展与模板 | 共享 Agent、技能、收件箱 |
| P8 可观测性割裂 | 单一事实来源 | SQLite、HTTP/WS API、统一 UI |

### 6.4 价值边界：ATeam 不是什么

- **不是模型提供方**：不训练、不托管、不转售模型；模型能力与费用由 Runtime 及其提供方决定。
- **不是云端 IDE**：不提供浏览器内的完整开发环境，不做远程代码编辑器的替代品。
- **不是自主 AI 员工**：不承诺无人值守交付；Agent 提议，人决定。
- **不是通用项目管理套件克隆**：Task 的存在目的是承载 Agent 执行的上下文与证据，而不是覆盖所有项目管理场景。
- **不是 CI/CD 系统**：ATeam 在合并前组织 Agent 工作与评审，合并后的构建、测试与部署仍由既有流水线负责。

## 7. 与相邻产品形态的差异

### 7.1 差异化维度

| 维度 | 通用 AI 项目管理 / 看板 | 云端 Agent 平台 | 单 Agent CLI | 通用工作流自动化 | ATeam |
|---|---|---|---|---|---|
| 主要职责 | 管理工作项与协作流程 | 在云端沙箱中运行 Agent | 在本地终端执行单次任务 | 按触发器执行脚本或 Agent 调用 | 本地多 Agent 执行与治理驾驶舱 |
| 执行位置 | 通常不执行 | 云端 | 本地 | 本地或云端 | 本地优先，团队模式可选远程 Runner |
| 代码数据边界 | 数据在 SaaS | 代码需上传或授权访问 | 代码留在本机 | 取决于工具 | 默认不出本机 |
| 多任务并行 | 有看板，无执行隔离 | 有，但由平台调度 | 手工开多个终端 | 可编排，但缺少任务语义 | 原生并行 Run + 独立 Run Workspace |
| 上下文模型 | 工作项字段 | 平台会话 | 单次提示词 | 变量与脚本 | Task + Agent + Run 三层持久上下文 |
| 评审与证据 | 流程记录 | 平台日志 | 终端输出 | 执行日志 | Artifact/Evidence + 人工评审门 |
| 高风险治理 | 流程审批，未必连接执行 | 平台权限 | 依赖用户自律 | 依赖脚本 | 风险分级审批 + 审计 |
| 计费与绑定 | 订阅制 | 平台加价或额度 | 用户自付模型费用 | 工具订阅 | BYO Runtime/Key，不转售模型 |
| 扩展方式 | 插件与集成 | 平台内应用 | 脚本 | 连接器 | Runtime 适配器、模板、插件 API |

### 7.2 不与模型质量竞争

ATeam 不试图证明「我们的 Agent 更聪明」。模型质量由 Runtime 与模型提供方决定，且会持续变化。ATeam 的差异化在于：无论用户选择哪个 Runtime，都能获得一致的 Task 语义、隔离策略、事件模型、证据规范与审批流程。换句话说，ATeam 把「换模型」变成低成本的配置变化，而不是工作流的推倒重来。

### 7.3 差异化护城河

1. **本地信任模型**：代码默认不出本机，团队模式也优先自托管。这是云端平台难以完全复制的前提条件。
2. **开放适配器生态**：Runtime 适配器接口让新 CLI 可以按统一的事件、取消与错误契约接入；M0-M1 需要在核心注册表登记，M4 插件 API 让非 Runtime 扩展可由社区独立分发，但第三方 Agent Runtime 适配器仍需在核心注册表登记，不通过插件加载。
3. **证据化完成定义**：把「完成」从 Agent 的自述变成可验证的产物与测试证据，形成评审共识。
4. **角色交付物契约**：用 DAG 与契约替代自由聊天，使多 Agent 协作可复现、可审计、可优化。
5. **渐进式采用路径**：从单人本地闭环到团队治理，再到自动化与分发，用户可以在任一阶段获得独立价值。

## 8. 产品原则

产品原则用于裁决需求争议。当两个需求冲突时，优先级更高的原则胜出；当原则与短期增长冲突时，原则上不应妥协，除非有明确的高层决策记录。

### 8.1 任务为中心

Task 是唯一的上下文容器与工作单元。Run 必须归属于 Task，Artifact 与 Evidence 必须归属于 Run，评审与审批必须能追溯到 Task。产品不鼓励「无任务的自由聊天」作为主工作流，因为那会重新引入上下文丢失与不可追溯的问题。

**意味着**：看板、任务详情、评审队列都以 Task 为组织单位。
**不意味着**：Task 需要覆盖完整项目管理能力；子任务、依赖、标签只需服务于执行与评审。

### 8.2 人工在回路

Agent 提议，人决定。所有高风险动作必须经过人工审批，所有合并必须经过人工评审。人工在回路不是过渡方案，而是产品的长期设计选择。

风险分级建议：

| 风险等级 | 典型动作 | 默认策略 | 里程碑 |
|---|---|---|---|
| 低 | 读取文件、运行只读命令、生成摘要 | 允许，记录事件 | M0 |
| 中 | 在 Run Workspace 内修改文件、运行测试 | M1：隔离工作区，但无路径/命令策略；M2 起受 allowedPaths/allowedCommands 约束 | M1 隔离，M2 策略 |
| 高 | 合并、推送、部署、删除分支或数据 | 必须人工审批，记录操作者、时间、理由；合并审批记录 M1，推送/部署/删除 M2 | M1 合并，M2 扩展 |
| 极高 | 生产部署、跨仓库操作 | 默认禁止自动执行，仅生成计划，由人工执行 | M2 起，长期保持 |

### 8.3 证据优先

「完成」不由 Agent 自述决定，而由证据决定。一次 Run 至少应提供：改动 diff、测试或检查结果、执行摘要；涉及界面时提供截图；无法运行测试时必须说明原因。证据缺失时，评审应默认拒绝或要求补充。

**意味着**：Run 的完成状态与证据完整性绑定；评审界面以证据为中心。
**不意味着**：证据必须完美；证据是让人快速判断的材料，而不是替代人的判断。

### 8.4 渐进式采用

产品必须允许用户从最小闭环开始，逐步增加复杂度：

1. 单人、单任务、mock Runtime，验证概念。
2. 单人、真实 Runtime、隔离 worktree、diff 评审，形成日常闭环。
3. 多角色 Agent、任务 DAG、审批门，形成小团队协作。
4. 团队模式、远程 Runner、共享 Agent、审计。
5. 自动化、通知、打包、插件与生态。

每一阶段都必须可独立使用，不能要求用户先完成下一阶段的配置才能获得价值。

### 8.5 可替换 Runtime

Runtime 通过 Adapter 接口接入，领域模型不依赖任何具体 CLI。新增 Runtime 不应修改 Task、Agent、Run 的核心字段与 HTTP handler；Runtime 特有参数应封装在适配器配置中。M0 新增适配器仍需实现 `Adapter` 接口并在 `internal/runtime/runtime.go` 的 Registry 中登记；M4 插件 API 只为非 Runtime 扩展提供不修改核心的加载机制，不提供第三方 Agent Runtime 适配器。mock Runtime 必须长期保留，用于开发、测试与演示。

### 8.6 显式协作而非自由聊天

多 Agent 的**执行协作**通过任务依赖 DAG、交付物契约、审批门与证据交接完成，而不是让多个 Agent 在同一会话中自由对话。自由聊天适合探索，不适合可复现的交付。显式协作的代价是前期建模成本，收益是确定性、可审计性与可优化性。

M2.3 增加的是**人类发起、只读、可追溯的讨论层**（Agent Team 会话）：用户可以把多个角色 Agent 组成小组，由系统按消息内容路由或由用户 `@` 定向；讨论中的 Agent 不得写仓库、不得创建 Run、不得修改 Task，Agent 与 Agent 之间也不得自动对话。讨论结果必须通过「一键转任务」进入 Task → Run → 证据 → 评审 → 合并链路。该讨论层不削弱本原则对执行层的约束。

### 8.7 本地优先与最小数据暴露

默认不把代码、任务内容、Run 日志上传到任何服务器。网络请求仅用于模型调用、用户显式配置的集成与可选的遥测。团队模式的数据共享必须显式配置，并提供自托管路径。任何默认开启的数据外发都属于产品缺陷。

### 8.8 单一事实来源

Task、Agent、Run、RunEvent 的状态以 SQLite 与 HTTP/WS API 为准，UI 只是客户端。CLI、桌面壳与 Web 界面共享同一套核心逻辑，不允许在 UI 中维护无法被 API 解释的隐藏状态。事件推送用于实时性，但最终状态必须可从存储中重建。

### 8.9 开源与原创

核心以 Apache-2.0 开源，贡献者需遵循 DCO 与 clean-room 要求：不复制任何第三方产品的代码、文档、截图、图标、文案或品牌资产。扩展点通过接口与文档开放；M0 的新增 Runtime 仍需在核心注册表登记，M1 补齐扩展文档与示例，M4 插件 API 只为非 Runtime 扩展提供不修改核心的加载机制。开源不仅是许可证选择，也是建立信任与生态的方式。

## 9. 核心闭环与概念模型

### 9.1 核心闭环

```text
Task（上下文容器）
  → Agent（可复用工作配置）
  → Run（一次执行）
  → Run Workspace（隔离工作区）
  → Runtime（Claude Code / Codex / mock）
  → Artifact / Evidence（diff、测试、截图）
  → Human Review（人工评审）
  → Merge（合入）
```

闭环中的反馈路径同样重要，但每条路径的可用时间不同：

- 运行失败（M0）：M0 只保证失败事件可查、Task 保持可操作；M1 起按失败分类把 Task 退回 todo/in_progress 或标记 blocked，并把失败原因写入事件流。
- 评审拒绝（M1）：产生修改意见，触发新的 Run，而不是直接覆盖原 Run 记录。
- 合并完成（M1）：Task 进入 Done，证据与评审记录保留，供后续审计。
- 高风险动作被拒绝（M1 仅合并，M2 扩展）：记录拒绝理由、操作者与时间，Agent 不得绕过审批继续尝试；需要重新申请或修改方案。

### 9.2 概念词典

| 概念 | 定义 | 关键字段（M0 或计划） | 当前状态 |
|---|---|---|---|
| Task | 上下文容器与工作单元 | title、description、status、priority、assigneeType、assigneeId、parentId、labels | 已实现 CRUD 与五列看板（blocked/cancelled 暂无列） |
| Agent | 可复用的工作配置 | name、instructions、runtime、model、workspaceMode、maxConcurrency、timeoutMinutes、allowedPaths、allowedCommands | 已实现 CRUD；权限与并发字段尚未强制执行 |
| Run | 一次执行记录 | taskId、agentId、status、trigger、branch、worktree、summary、error、startedAt、endedAt；无配置/提示词快照字段 | 已实现创建、调度、事件与取消接口；取消可靠性、超时分类与状态回写竞态见 §14.2.1；配置快照 M1 |
| RunEvent | Run 的时序事件 | runId、seq、type、message、payload、createdAt | 已实现追加、查询与 WebSocket 广播；并发 emit 下顺序不保证，M1 修复 |
| Workspace | 产品级归属实体（UI 文案称「项目」），绑定仓库与执行设置 | id、name、repoPath、defaultBranch、settings、status；默认 ID `default` | 计划 M1；`projectId` 仅为输入别名 |
| Run Workspace | 每次 Run 的隔离执行目录 | 每个 Run 一个目录；M1 起为 git worktree + 分支 | M0 为每 Run 独立空目录 |
| Runtime | 执行编码 Agent 的适配器 | name、Run 接口、事件回调 | 已实现 mock 与最小 claude |
| Artifact | Agent 产出的文件或对象 | 类型、路径、大小、关联 Run | 计划 M1 |
| Evidence | 可验证的完成凭据 | 类型、status、validity、关联 Run/Task/Artifact | 计划 M2（M1 的 DoD 基于 Artifact 与人工例外） |
| Review | 人工评审决策 | 评审人、结论、意见、时间 | 计划 M1 |
| Approval Gate | 高风险动作审批节点 | 动作类型、风险等级、申请人、审批人、结论、理由 | 合并审批记录 M1；通用 Approval Gate 计划 M2 |
| Crew | 一个任务下的多角色 Agent 组合 | 角色、成员、队长、任务范围 | 计划 M2.2，后置于并行任务 |
| Inbox | 需要人处理的事项队列 | 评审、审批、失败、提及 | 计划 M2.1 |
| Template | 可复用的任务或 Agent 配置模板 | 模板类型、内容、版本 | 计划 M2.1 |

### 9.3 状态机概览

Task 状态包括 backlog、todo、in_progress、in_review、done、blocked、cancelled。M0 中只有 todo、in_progress、in_review 可启动 Run；状态流转由 API 校验合法性，但尚未强制限制所有业务转换。M0 看板只有 backlog、todo、in_progress、in_review、done 五列，blocked 与 cancelled 不可见（TASK-031，计划 M1 修复）。M1 起，Run 与评审结果将驱动 Task 状态自动流转，减少手工同步。

Run 状态包括 queued、preparing、running、completed、failed、cancelled。M0 的实际状态转移如下：

| 当前状态 | 可进入 | 触发条件 |
|---|---|---|
| queued | preparing | worker 取出 Run，且加载 Task/Agent、Task 可执行性校验通过 |
| queued | failed | 加载 Task/Agent 失败，或 Task 不处于可执行状态 |
| preparing | running | Workspace 准备成功，Adapter 即将启动 |
| preparing | failed | Workspace 准备失败（目录创建失败、磁盘或权限问题） |
| running | completed | Adapter 正常退出 |
| running | failed | Adapter 返回错误、超时或调度器内部错误 |
| queued / preparing / running | cancelled | 用户取消；M0 可靠性存在缺陷，见下段 |
| completed / failed / cancelled | — | 终态，不可回退；重试由用户创建新的 Run（M1 提供 retry） |

M0 的取消与超时只完成了基础机制，不满足产品承诺：queued 状态的 Run 被取消后仍留在队列中，可能被 worker 取出执行并覆盖状态；运行中取消时 API 先把数据库状态写为 cancelled，调度器结束后又写回 failed 或 completed，存在状态回写竞态；超时统一归为 failed，没有 timeout 分类。M1 的要求是：queued 取消永不执行；running 取消在宽限期后终止进程组，且终态不被后续事件覆盖；超时以独立错误码表达并保留现场。对应模块需求为 `runtime-and-workspace.md` 的 RUN-004、RUN-005、RUN-085、RUN-086，验收细节见 `prd/milestones/M1-local-loop.md`。

Run 失败、取消或超时后，Task 的下一步必须可解释。M0 只更新 Run，不联动 Task，Task 保持当前状态并可由用户再次启动 Run；M1 起，失败或超时把 Task 退回 todo/in_progress 或按依赖标记 blocked，用户取消则保持 in_progress 并提示可重试；重试总是创建新 Run，旧 Run 作为历史保留。评审拒绝与合并完成对 Task 状态的联动同样从 M1 开始，M0 不具备这些能力。

详细的状态转换表与边界条件由 `prd/modules/task-management.md` 与 `prd/modules/runtime-and-workspace.md` 定义。

### 9.4 数据与 API 影响（总览）

- 所有产品能力必须能通过领域模型、REST API 与 WebSocket 事件表达，不允许只存在于 UI 的临时状态。
- ID 全局唯一且稳定；时间戳统一使用 UTC；状态枚举由服务端校验，非法值返回明确错误。
- M0 已有接口包括健康检查、Task CRUD、Agent CRUD、Run 列表/读取、按 Task 创建 Run、RunEvent 查询、Run 取消与 WebSocket 事件流。
- M1 起新增 Artifact、Review、Workspace 元数据等资源；M2 新增 Evidence、DAG、交付物契约、审批门、Inbox，M2.2 新增 Crew；M3 新增用户、团队、机器、远程 Runner 与审计。新增应为增量接口，破坏性变更需要版本化。
- 事件类型在 M0 包括 task.created/updated/deleted、agent.created/updated/deleted、run.queued/updated、run.event，以及调度过程中的 run.preparing/run.running；M1-M2 将扩展 artifact.*、review.*、approval.*，命名与负载规范由 `prd/modules/api-and-data.md` 统一。
- M0 的本地 API 暴露面是「默认只绑定 127.0.0.1」而不是「已具备本地安全基线」：CORS 反射任意 Origin，WebSocket 的 CheckOrigin 恒为 true；通过 `--addr` 暴露到局域网时没有认证保护。M1 必须改为 Origin 允许列表与 WebSocket 来源校验；桌面壳会话令牌（SEC-003）从 M2.1 起交付。
- M0 列表接口没有分页与过滤；WebSocket 没有事件重放与断线续传；删除 Task/Agent 为硬删除且不检查活跃 Run。这些是已登记的 M0 缺口，不是可依赖的长期契约。

### 9.5 关键边界行为（产品级摘要）

以下行为在模块文档中有完整定义，这里只固定产品口径：

- **权限不足与越权（M2.1）**：越界路径、未授权命令与越权高风险动作由服务端拒绝，产生结构化 `permission_denied` 事件，包含动作、目标与修复建议；Run 按 Agent 策略失败或继续，UI 必须显示被拒原因，并提供「申请审批」或「修改配置」入口。Agent 不能自行扩大权限，也不能自我批准。对应 SEC-010、SEC-011、SEC-018 与 AGENT-021、AGENT-022。
- **删除语义（M1 基础，M2.1 恢复窗口）**：存在活跃或排队 Run 的 Task/Agent 不允许直接删除，返回冲突并提示先取消或完成；M1 的删除是确认 + 阻止 + 归档，不提供硬删除；M2.1 起归档进入 30 天恢复窗口，物理清理仅在无引用且过期后执行。对应 TASK-012、TASK-117 与 SEC-023/028。
- **空状态（M0 部分）**：看板列、任务列表、Agent 列表与 Run 事件为空时必须有说明与下一步操作，不能只显示空白；M1 补齐空状态与错误状态的可操作引导（US-UI-14）。
- **WebSocket 断线（M0 仅重连拉取）**：M0 前端断线后重连并重新拉取列表，断线期间的事件不会补齐；M1 起事件带游标，支持按 `since` 重放，重放失败时回退全量刷新（API-1007、01-scope NFR-010）。

## 10. 产品级功能需求

以下 PROD 需求是跨模块的底线约束，模块文档不得削弱。每条需求都必须可测试；里程碑标注表示最早承诺的交付阶段。

| ID | 需求 | 验收标准 | 里程碑 |
|---|---|---|---|
| PROD-001 | 本地默认可运行 | 断网环境下，用户可完成 Task/Agent CRUD，并使用 mock Runtime 完成一次 Run；数据仅写入本地 SQLite 与本地工作区 | M0 已实现 |
| PROD-002 | BYO Runtime | Agent 可选择 mock 或 claude；新增 Runtime 通过 Adapter 接口接入，不修改领域模型与 HTTP handler；未知 Runtime 必须被拒绝，不得静默回退 | M0：接口与 mock、最小 claude 已存在；未知 runtime 回退 mock 是缺陷。M1：创建/更新 Agent 时按 Registry 校验，未知值返回 400；启动 Run 前复检 |
| PROD-003 | Task 作为上下文容器 | 每次 Run 必须关联唯一 Task；组合后的提示词包含 Task 标题、描述、状态、优先级与 Agent instructions；M0 不持久化提示词 | M0 已实现（提示词不落库） |
| PROD-004 | Agent 可复用 | 同一 Agent 可在多个 Task 上创建多次 Run；Agent 编辑不得改变历史 Run 已记录的执行语义 | M0：同一 Agent 多次 Run 可用；编辑 Agent 会影响历史 Run 的解读。M1：Run 保存配置与提示词快照，历史 Run 以快照为准 |
| PROD-005 | 工作区隔离 | 同一仓库上并发的两个 Run 不共享工作目录；一个 Run 的文件改动不出现在另一个 Run 的工作区 | M1 |
| PROD-006 | 可观测性 | 每个 Run 产生有序事件，包含类型、消息、序号与时间；同一 Run 内 seq 严格递增且唯一；本地 WebSocket 推送延迟 p95 不超过 2 秒 | M0：事件持久化与推送已有，但 claude adapter 的 stdout/stderr 并发 emit 未串行化，seq 可能重复或乱序，且无断线重放。M1：严格有序、可重放并验证延迟目标 |
| PROD-007 | 证据化完成 | completed 状态的 Run 至少关联 diff 与测试结果之一；无测试时必须记录原因 | M1 |
| PROD-008 | 人工评审门 | 任何 Run 不得自动合并；合并必须由人工在评审界面明确批准，并产生审批记录（关联 Run、diff/head SHA、目标分支、操作者、时间） | M1 |
| PROD-009 | 高风险审批 | 合并、推送、部署、删除必须产生审批记录，包含申请人、审批人、动作、理由与时间；未批准时动作被阻止 | M1：合并审批记录；M2：推送、部署、删除与通用 Approval Gate |
| PROD-010 | 结构化多角色协作 | 角色 Agent 通过任务 DAG 与交付物契约协作；上游未验收时下游任务不得启动 | M2.1 |
| PROD-011 | 渐进式采用 | 每个里程碑可独立使用；M1 用户无需配置团队、权限或远程 Runner 即可完成本地闭环 | M0-M4 |
| PROD-012 | 可扩展性 | 新增 Runtime 适配器或模板不需要修改核心领域模型；扩展点有文档与示例；M4 插件 API 仅覆盖非 Runtime 扩展，不提供第三方 Agent Runtime 适配器 | M0：接口存在，新增适配器仍需在核心注册表登记，无扩展文档。M1：适配器文档与示例。M2：模板扩展文档。M4：插件 API 支持非 Runtime 扩展的不修改核心加载 |
| PROD-013 | 数据主权 | 默认不上传代码、任务内容与 Run 日志；任何外发功能必须显式配置并说明用途 | M0 已实现 |
| PROD-014 | 开源与原创 | 核心以 Apache-2.0 发布；仓库不包含第三方产品的代码、文档、截图、图标或品牌资产 | M0 已实现 |
| PROD-015 | 取消与超时 | 运行中的 Run 可被取消并在有限时间内停止；Agent.timeoutMinutes 大于 0 时超时后 Run 以 timeout 分类结束并保留现场 | M1（M0 部分实现：运行中 context 取消与超时存在；排队取消失效、状态回写竞态、超时统一 failed，见 §14.2.1） |
| PROD-016 | 可移植性 | macOS 为首要平台；Windows 与 Linux 的打包在 M4 提供；Web UI 在浏览器中可独立使用 | M0 Web UI 可用，M4 打包与跨平台 |
| PROD-017 | 删除保护 | 删除 Task/Agent 前检查活跃与排队 Run，存在时阻止并提示先取消或完成；M1 的删除是确认 + 阻止 + 归档；M2.1 起进入 30 天恢复窗口；删除 Workspace 需要 Approval（M3） | M1 归档保护；M2.1 恢复窗口；M3 Workspace 删除审批 |
| PROD-018 | 权限不足与越权可观测 | 越界路径、未授权命令与越权高风险动作被服务端拒绝，产生 permission_denied 事件；Run 按策略失败或继续，UI 给出原因与申请审批入口；Agent 不得自行扩大权限 | M2.1 |
| PROD-019 | 本地接口安全基线 | 默认只绑定 127.0.0.1；CORS 使用允许列表；WebSocket 校验 Origin；桌面壳使用会话令牌；非本地访问必须显式配置并启用认证 | M1 Origin/Host/CORS 收紧；M2.1 会话令牌（SEC-003） |
| PROD-020 | Agent Team 讨论层 | 用户可创建 Agent 小组并在小组会话中讨论；用户消息自动路由到小组内合适 Agent，`@` 可覆盖；每条用户消息的路由决策持久化且可解释；会话 Agent 只读运行，不写仓库、不创建 Run/Artifact、不修改 Task；Agent 消息不触发其他 Agent；任意消息可幂等转为 Task 并保留来源追溯 | M2.3 |
| PROD-021 | Agent 状态与工作台 | Agent 看板显示派生工作状态（空闲、工作中、已完成、失败待处理），状态与 Run 列表一致；点击工作中或已完成的 Agent 进入工作页，查看所选 Run 的 Task 上下文、配置快照摘要、Workspace/commit 与完成过程时间线；工作页只读且不暴露明文密钥、凭据值或完整拼装 prompt | M2.4 |
| PROD-022 | Runtime 模型选择 | Agent 创建/编辑时模型为下拉选择，选项来自所选 Runtime 的本地模型目录（Runtime 探测 + 本地配置）；空值表示 Runtime 默认；非空模型必须是目录中的 ID，未知模型返回 400 `MODEL_NOT_AVAILABLE`；切换 Runtime 时重新校验；目录为空时只允许默认模型并提供本地配置入口 | M2.1（Agent 编辑器子项） |

PROD-009 的拆分与 `prd/01-scope-and-roadmap.md` 的 US-005（M1 合并，M2 扩展）一致：M1 的合并必须产生人工评审/审批记录，绑定 Run、diff/head SHA、目标分支、操作者与时间；M2 再扩展到推送、部署、删除与通用 Approval Gate。

### 10.1 PROD 到模块需求的追踪矩阵

PROD 需求不单独存在，必须由模块级功能需求承接。下表给出主追踪关系；一个 PROD 可以由多条模块需求共同满足，模块文档应在对应需求行反向引用 PROD 编号。

| PROD | 主要模块需求 | 负责模块文档 |
|---|---|---|
| PROD-001 | TASK-001、TASK-003、TASK-004、AGENT-001、AGENT-007、RUN-020、RUN-091、API-1001 | task-management、agent-system、runtime-and-workspace、api-and-data |
| PROD-002 | AGENT-011、RUN-001、RUN-002、RUN-003、RUN-012、RUN-013 | agent-system、runtime-and-workspace |
| PROD-003 | TASK-021、TASK-022、TASK-023、AGENT-024、AGENT-025 | task-management、agent-system |
| PROD-004 | AGENT-004、AGENT-010、RUN-083；配置快照见 Q4 | agent-system、runtime-and-workspace |
| PROD-005 | RUN-040、RUN-041、RUN-044、RUN-045、SEC-016 | runtime-and-workspace、security-and-permissions |
| PROD-006 | RUN-006、RUN-007、RUN-008、RUN-009、RUN-081、API-1007、API-1008 | runtime-and-workspace、api-and-data |
| PROD-007 | RUN-060 至 RUN-068、TASK-025 | runtime-and-workspace、task-management |
| PROD-008 | RUN-048、SEC-020、SEC-026、TASK-025 | runtime-and-workspace、security-and-permissions、task-management |
| PROD-009 | SEC-020、SEC-021、SEC-022、SEC-025、SEC-026、RUN-055、RUN-103 | security-and-permissions、runtime-and-workspace |
| PROD-010 | COLLAB-001 至 COLLAB-028、TASK-011、TASK-027 | collaboration-and-review、task-management |
| PROD-011 | SCOPE-002、SCOPE-011、MILE-001 | 01-scope-and-roadmap |
| PROD-012 | RUN-001、RUN-016、AGENT-011；插件 API 见 M4 里程碑 | runtime-and-workspace、agent-system、M4-automation-and-packaging |
| PROD-013 | SCOPE-010、NFR-NET-*；SEC-002 至 SEC-005 提供来源与访问边界 | security-and-permissions、01-scope-and-roadmap、non-functional-requirements |
| PROD-014 | SCOPE-001、SEC-009（01-scope 发布标准） | 01-scope-and-roadmap |
| PROD-015 | RUN-004、RUN-005、RUN-085、RUN-086、RUN-087、AGENT-015 | runtime-and-workspace、agent-system |
| PROD-016 | NFR-PKG-*、NFR-PORT-*；M4 打包退出标准 | non-functional-requirements、M4-automation-and-packaging |
| PROD-017 | TASK-012、SEC-023 | task-management、security-and-permissions |
| PROD-018 | SEC-010、SEC-011、SEC-018、AGENT-021、AGENT-022 | security-and-permissions、agent-system |
| PROD-019 | SEC-001、SEC-002、SEC-003、SEC-004、NFR-NET-* | security-and-permissions、non-functional-requirements |
| PROD-020 | AGTEAM-001、AGTEAM-002、CONV-001 至 CONV-006、ROUTE-001 至 ROUTE-004；API-1400 至 API-1415 | agent-teams-and-conversations、api-and-data、ui-ux、security-and-permissions |
| PROD-021 | AGENT-074 至 AGENT-078、UI-153 至 UI-160、API-1416 至 API-1425 | agent-system、ui-ux、api-and-data、02-domain-model |
| PROD-022 | AGENT-079 至 AGENT-082、UI-161 至 UI-164、API-1426 至 API-1429 | agent-system、ui-ux、api-and-data、runtime-and-workspace |

截至本次修订，部分模块文档尚未在需求行反向引用 PROD 编号；这属于跨文档追踪债务，应在各模块下一次修订时补齐，并在 `prd/04-acceptance-and-test-plan.md` 的追踪链检查中核对，而不是在本章重复模块细节。

## 11. 用户故事（Given/When/Then）

**US-PROD-01 首个 Run（独立开发者，M0）**
Given 用户已安装并启动 ATeam，且已创建一个 mock Agent；
When 用户创建任务并点击 Run；
Then 系统创建 Run，状态依次经过 queued、preparing、running、completed，任务详情页显示事件日志与摘要。

**US-PROD-02 并行隔离（独立开发者，M1）**
Given 同一仓库上有两个可执行任务，且用户为它们选择了不同 Agent；
When 用户先后启动两个 Run；
Then 每个 Run 获得独立的 worktree 与分支，两个 Run 的文件改动互不可见，任一 Run 失败不影响另一个 Run 的工作区。

**US-PROD-03 上下文交接（M0 基础，M1 完整）**
Given 一个包含验收标准与边界说明的 Task，以及一个包含 instructions 的 Agent；
When Run 启动；
Then M0：组合提示词包含 Task 标题、描述、状态、优先级与 Agent instructions，Run 记录 taskId、agentId 与事件；M1：Run 额外保存本次使用的配置与提示词快照，之后编辑 Agent 不影响历史 Run 的解读。

**US-PROD-04 证据评审（评审者，M1）**
Given 一个 completed 的 Run；
When 评审者打开评审视图；
Then 可以看到 diff、测试结果或未运行测试的原因、Run 摘要与事件时间线，并可选择接受、拒绝或要求修改，决策被持久化。

**US-PROD-05 高风险审批（平台负责人，M1 合并，M2 扩展）**
Given DevOps Agent 完成了 staging 部署计划，并请求执行生产部署；
When 该请求被提交；
Then 系统阻止自动执行；M1 的合并审批在评审界面完成并记录，M2 的高风险审批项进入收件箱；批准与拒绝都记录审批结果、操作者、时间、理由与关联 Run；拒绝后 Agent 不得绕过，需重新申请或修改方案；生产部署仍由人工执行。

**US-PROD-06 角色协作（小团队，M2.1）**
Given 一个功能被拆成 UI Design、Frontend、Backend、Integration 四个任务，并定义了依赖与交付物契约；
When 上游 UI Design 任务完成但交付物未通过契约校验；
Then 下游 Frontend 与 Backend 任务保持等待状态，不启动 Run；只有契约校验通过后才进入可执行队列。

**US-PROD-07 失败恢复（独立开发者，M0）**
Given 一个 Run 因 Runtime CLI 不存在而失败；
When 用户查看 Run 详情；
Then 错误信息明确指出缺失的 CLI，Run 保留失败事件，任务可重新选择 Agent 并创建新的 Run，历史 Run 不被覆盖。

**US-PROD-08 团队共享（小团队，M3）**
Given 团队已注册成员、机器与共享 Agent；
When 成员使用共享 Agent 启动 Run；
Then 系统应用相同的配置与权限策略，并在审计记录中标注操作者、机器与 Agent 版本。

**US-PROD-09 取消（任意用户，M1）**
Given 一个处于 queued、preparing 或 running 的 Run；
When 用户点击取消；
Then queued 的 Run 从待执行集合移除且永不执行；running 的 Run 在宽限期后终止进程组，进入 cancelled，后续事件不再追加；Task 保持可继续操作的状态。M0 只提供取消接口与 context 取消，不满足上述完整语义。

**US-PROD-10 新成员上手（小团队，M2.1）**
Given 团队维护了功能任务模板与角色 Agent 模板；
When 新成员从模板创建一个功能任务集；
Then 系统生成带依赖关系的任务与预配置 Agent，新成员只需补充业务背景即可启动第一个 Run。

**US-PROD-11 权限拒绝（平台负责人，M2.1）**
Given 一个 Frontend Agent 只允许写入 `apps/web`、只允许执行白名单命令；
When 它尝试写入其他路径或执行未授权命令；
Then 服务端拒绝该动作并产生 permission_denied 事件，Run 按 Agent 策略失败或继续，UI 显示被拒原因与申请审批入口；Agent 不能自行扩大权限。

**US-PROD-12 删除保护（独立开发者，M1）**
Given 一个 Task 或 Agent 仍有 queued、preparing 或 running 的 Run；
When 用户请求删除；
Then 系统阻止删除并提示先取消或完成 Run；M2 起删除需要审批并记录影响范围，归档优先于硬删除。

**US-PROD-13 小组讨论与转任务（独立开发者，M2.3）**
Given 用户创建了一个由 Frontend、Backend、DevOps 组成的 Agent 小组，并在小组会话中发送「支付接口的分页参数怎么设计？」；
When 系统完成路由；
Then 消息被交给最合适的 Backend Agent，回复旁显示路由依据，路由决策被持久化；用户可用 `@Frontend` 定向覆盖路由；对任一回复点击「转为任务」后生成带来源字段的 backlog Task，后续执行仍走 Task → Run → 证据 → 评审 → 合并链路；会话中的 Agent 不写仓库、不创建 Run。

**US-PROD-14 Agent 状态看板与工作页（独立开发者，M2.4）**
Given Agents 看板上有多个 Agent，其中一个正在运行、一个刚完成、一个空闲；
When 用户查看看板并点击工作中的 Agent；
Then 看板分别显示「工作中」「已完成」「空闲」；进入 `/agents/{id}/work` 后可以看到当前 Run 的任务、阶段、工作区与最近事件，以及该 Run 的配置快照摘要和完成过程时间线；已完成的 Agent 默认展示刚结束的 Run，空闲 Agent 显示明确空态。

**US-PROD-15 选择本地可用模型（独立开发者，M2.1）**
Given 用户创建 Agent 并选择了一个已安装的 Runtime；
When 用户打开模型下拉；
Then 选项来自该 Runtime 的本地模型目录，首项为「默认（由 Runtime 决定）」；用户不能输入任意模型 ID；若目录为空，只显示默认项与「去设置添加模型」入口；切换 Runtime 后旧模型若不可用会被重置或阻止保存。

## 12. 成功指标

### 12.1 北极星指标

**北极星指标：每周被人工接受并合入的 Run 数（Accepted Runs per Week，ARW）。**

定义：在一个自然周内，评审结论为「接受」且关联合并已完成的 Run 数量，按活跃用户或活跃团队汇总。该指标同时衡量「Agent 是否真的在产出可交付结果」与「人是否真的愿意接受这些结果」，比单纯的 Run 数、任务数或 Token 消耗更接近产品价值。

不把「Run 总数」作为北极星，是因为 Run 可以被人为制造，且失败、取消、重复运行都会抬高数字；不把「节省时间」作为直接指标，是因为本地工具难以无侵入地精确测量，容易产生虚假精度。

### 12.2 指标树

以下目标为初始假设，需在 M1-M2 用真实数据校准；未标注目标值的指标先采集基线，不设硬性承诺。

| 层级 | 指标 | 定义 | 初始目标 | 里程碑 |
|---|---|---|---|---|
| 激活 | 首次操作完成率（允许 mock） | 新安装用户在 30 分钟内完成一次 completed Run 的比例；mock 与真实 Runtime 都计入，用于验证操作链路是否通畅 | ≥ 80% | M1 |
| 激活 | 首次真实 Runtime Run 成功率 | 新安装用户在 30 分钟内完成一次使用非 mock Runtime 的 completed Run 的比例；用于区分「完成演示」与「获得真实价值」 | 采集基线，M2 校准 | M1-M2 |
| 激活 | 首次有效 Run 耗时 | 从首次打开到首次真实 Runtime completed Run 的中位时间 | 采集基线，M2 设定目标 | M1-M2 |
| 使用 | 周活用户 / 团队 | 一周内至少启动 1 个 Run 的用户或团队数 | 采集基线 | M1-M3 |
| 使用 | 人均周 Run 数 | 活跃用户每周创建的 Run 数 | 独立开发者 ≥ 5 | M2 |
| 使用 | 并行度 | 同一用户或团队同时处于 running 的 Run 数中位数 | ≥ 2 | M2 |
| 质量 | Run 成功率 | completed /（completed + failed），不含 cancelled | ≥ 85%（与 `05-risks-and-open-questions.md` 一致） | M1 |
| 质量 | 评审通过率 | accepted / reviewed | 60%-80% | M1 |
| 质量 | 返工率 | 被拒绝或接受后 7 天内再次修改的比例 | ≤ 20% | M1 |
| 质量 | 证据完整率 | 带 diff 与测试结果（或未测试原因）的 completed Run 比例 | ≥ 90% | M1 |
| 协作 | 人工介入率 | 至少发生一次人工操作（取消、重试、补充上下文、审批、评审）的 Run 数 / 总 Run 数；与「人工介入次数」配合使用，避免只看总量不看分布 | 30%-70%（初始假设，过低与过高都需结合返工率解释） | M2 |
| 协作 | 人工介入次数 | 每个 Run 的人工操作次数（取消、重试、补充上下文、审批、评审） | 中位数 ≤ 2 | M2 |
| 协作 | 审批等待时长 | 高风险审批从提交到决策的中位时长 | ≤ 4 小时 | M2 |
| 信任 | 高风险审批覆盖率 | 高风险动作中经过审批的比例 | 100% | M2 |
| 信任 | 未授权高风险动作 | 未经审批被执行的高风险动作数 | 0 | M2 |
| 留存 | 4 周留存 | 首周激活后第 4 周仍有 Run 的用户或团队比例 | ≥ 30%（与 `05-risks-and-open-questions.md` 一致） | M1-M3 |
| 可靠性 | 调度器无崩溃会话比例 | 无进程崩溃的会话占比 | ≥ 99% | M1 |
| 性能 | 本地事件推送延迟 | WebSocket 事件从产生到客户端接收的 p95 | ≤ 2 秒（与 01-scope NFR-003 一致） | M1 |
| 性能 | 看板加载时间 | 500 个 Task 下首屏可交互时间 | < 1.5 秒（与 01-scope NFR-002 一致） | M1 |

### 12.3 反指标

指标必须成对使用，防止局部优化伤害整体价值：

- **Run 数上升但评审通过率下降**：说明 Agent 在制造噪音，应检查任务质量与 Agent 配置，而不是庆祝吞吐量。
- **人工介入率过低（按 §12.2 定义低于 30%，即低于目标区间下限）**：可能是评审被形式化通过，或高风险审批被绕过；必须结合返工率与事故率判断，不能把「人没介入」直接当作自动化成功。
- **合并速度过快但回滚率上升**：说明评审门失效或证据不充分。
- **人均并行度过高但失败率上升**：说明调度或隔离能力不足，应限制并发而非盲目扩张。
- **证据完整率下降**：说明 Agent 或适配器在跳过验证，应立即视为质量事故。

### 12.4 指标采集原则

- 指标优先在本地计算与展示，用户可自行查看，不需要上传代码内容。
- 遥测默认关闭或显式选择加入；上传内容不包含代码、提示词、diff 与日志正文。
- 团队指标在 M3 通过自托管服务汇总，成员可见采集范围。
- 所有目标值标注为「初始目标」，每季度复盘并更新，避免把假设当作承诺。

## 13. 非目标与适用边界

### 13.1 初期非目标

| 非目标 | 原因 | 重新评估触发条件 |
|---|---|---|
| 完整通用项目管理套件克隆 | Task 的存在目的是承载 Agent 执行，不是覆盖全部项目管理 | 用户调研显示 >50% 目标用户在 ATeam 外仍维护一套完整敏捷流程且强烈要求迁移 |
| 20+ 开箱即用集成 | 集成广度会稀释核心闭环，且维护成本高 | 核心闭环稳定，且有明确的前三个高价值集成需求 |
| IM 机器人 | 通知与协作应先在产品内收件箱闭环 | 收件箱上线后，用户明确要求外部消息通道 |
| 技能市场 | 模板与共享 Agent 先满足基本复用 | M4 模板生态形成，出现第三方分发需求 |
| 移动端 | 开发任务与评审需要完整代码上下文，桌面优先 | 桌面端稳定，且用户研究证明移动审批是刚需 |
| 多租户 SaaS | 团队模式优先自托管，避免数据边界复杂度 | 有明确的托管需求与合规方案，且不损害本地优先定位 |
| 模型托管 / 转售 | 与 BYO 模式冲突，且引入成本与合规风险 | 不重新评估；这是长期边界 |
| 全自动无人值守交付 | 与人工在回路原则冲突 | 不重新评估；可通过审批策略放宽，但不取消人工最终决定权 |
| 通用 CI/CD 替代 | 与既有流水线重复，且不是差异化 | 不重新评估；保持集成而非替代 |
| 云端代码托管 | 与 git 托管平台职责重叠 | 不重新评估；通过集成连接 |

### 13.2 适用边界

- **单机与单仓库**：M0-M1 面向单机、单用户、单个仓库的任务执行；多仓库任务与跨仓库依赖不在初期范围。
- **受信任的本地环境**：ATeam 的路径与命令限制是协作层的策略约束，不是针对恶意本地进程的安全沙箱；操作系统级隔离属于后续增强。
- **Agent 产出不保证正确**：产品保证隔离、证据与审批，不保证模型输出的正确性；最终判断由人负责。
- **网络依赖**：mock Runtime 可离线运行；真实 Runtime 需要网络访问模型服务，离线能力取决于 Runtime 本身。
- **平台范围**：macOS 为首要支持平台；Windows 与 Linux 的完整打包与路径语义在 M4 验证，早期不承诺一致体验。
- **规模假设**：M0-M1 以单用户、数十个 Task、少量并发 Run 为设计目标；团队规模与更高并发在 M3 通过 Postgres 与远程 Runner 解决。该假设需在 M2 压测中验证。
- **仓库规模**：worktree 方案对超大仓库的磁盘与初始化成本尚未验证；M1 需要针对 monorepo 做一次专项验证。

### 13.3 重新评估触发条件

产品方向每年至少复盘一次；出现以下信号时提前复盘：

- 三个以上团队明确要求云端同步或托管版本，且愿意接受相应数据边界。
- 主流 Runtime 提供稳定的多 Agent 编排协议，外部驾驶舱的增量价值显著下降。
- Windows 用户占比超过 30%，但 worktree 与进程管理体验无法达标。
- 用户研究显示评审环节成为主要瓶颈，而非 Agent 执行能力。
- 开源社区贡献集中在某个未被规划的方向，且与核心闭环互补。

## 14. 当前状态（M0）与里程碑映射

### 14.1 M0 已实现或部分实现（以仓库代码为准）

| 能力 | 实现情况 | 备注 |
|---|---|---|
| Go 核心与 CLI | 已实现 `ateam serve`、`ateam version`；`runner` 子命令仅提示 M3 预留 | `cmd/ateam/main.go` |
| 本地 HTTP 服务 | 监听 `127.0.0.1:8787`，可配置地址与数据库路径 | 默认配置见 `internal/app/app.go` |
| SQLite 持久化 | 使用 modernc.org/sqlite，内嵌 SQL 迁移与 schema_migrations 记录 | Task、Agent、Run、RunEvent |
| REST API | Task CRUD、Agent CRUD、Run 查询、按 Task 创建 Run、RunEvent 查询、Run 取消接口、健康检查 | 见 `internal/api/api.go`；取消语义缺陷见 §14.2.1 |
| WebSocket | 事件 Hub 广播 task/agent/run 相关事件与 run.event；断线后前端重连并重新拉取列表 | 无事件重放与断线续传 |
| Runtime 适配 | Registry 在核心代码中注册 mock 与 claude；mock 产生确定性步骤事件；claude 适配器执行本地 `claude -p` 并逐行转发 stdout/stderr；未知 Runtime 静默回退 mock | claude 适配器为最小实现；回退行为是缺陷 |
| 调度器 | 进程内队列、可配置 worker 数（默认 2）、按 Agent.timeoutMinutes 设置 context 超时、运行中取消表 | 排队取消、取消状态回写竞态与超时分类未完成，见 §14.2.1 |
| Vue 驾驶舱 | 看板五列（backlog/todo/in_progress/in_review/done）拖拽状态、任务详情启动 Run/查看日志/取消、Agent 页、Run 页、Settings 页 | blocked/cancelled 无列；路由 `/`、`/tasks/:id`、`/agents`、`/runs`、`/settings` |
| Workspace | 每次 Run 在数据目录下创建独立目录 `workspaces/runs/{runID}` | 不是 git worktree，不与仓库关联；WorkspaceMode 只存储不生效 |
| 提示词组合 | 将 Task 标题、描述、状态、优先级与 Agent instructions 组合为提示词，并包含工作区与高风险动作规则 | 规则是提示文本，不是强制策略；Run 不持久化提示词或配置快照 |
| 测试 | `internal/store` 有 Go 测试；TypeScript 类型检查可运行 | API、调度器、Runtime、Workspace 无测试；前端无单元或 E2E |
| Wails 桌面壳 | 启动本地随机端口服务，加载 1440×900 原生窗口 | 打包未实现 |
| 开源与合规 | Apache-2.0、NOTICE、CONTRIBUTING 中的 clean-room 与 DCO 要求 | 原创实现 |

### 14.2 M0 未实现、部分实现或仅有字段与占位

| 能力 | 当前真实状态 | 计划里程碑 |
|---|---|---|
| git worktree 与分支隔离 | 仅创建每 Run 独立目录；Run.branch 与 Run.worktree 字段存在但未与 git 关联 | M1 |
| diff 评审与合并 | 无 diff 生成、无评审界面、无合并动作 | M1 |
| Artifact 与 Evidence | 无数据模型、无存储、无界面 | M1 Artifact；M2 Evidence |
| 真实 Claude Code 流式适配 | 仅按行扫描 stdout/stderr；无结构化事件、无工具调用解析、无模型选择、无权限参数 | M1 |
| Codex Runtime | 无适配器 | M2（模块文档口径）；M1 不作为退出条件 |
| 配置快照 | Run 不保存 Agent 配置快照，Agent 编辑会影响历史 Run 的解读 | M1 |
| 任务依赖 DAG | Task.parentId 字段存在，但无依赖语义、无拓扑调度 | M2.1 |
| 交付物契约 | 无契约定义、无校验、无交接状态 | M2.1 |
| 角色 Agent 模板 | 无 UI Design、Frontend、Backend、DevOps 内置模板 | M2.1 |
| allowedPaths / allowedCommands 强制执行 | 字段可保存，但调度器与 Runtime 不读取、不校验 | M2.1 |
| Agent 级并发限制 | Agent.maxConcurrency 可保存，但调度器只使用全局 worker 数 | M2.1 |
| 审批门 | 仅在提示词中要求不推送、不合并、不部署；无系统级阻止与审批 UI | M1 合并审批记录；M2 推送、部署、删除与通用审批门 |
| Crew / 队长模式 | AssigneeType 包含 crew 常量，但无实现 | M2.2，且后置于并行任务 |
| 收件箱、技能、模板 | 无实现 | M2.1 |
| Postgres、登录、权限、远程 Runner、机器注册、共享 Agent、审计、GitHub PR | 无实现 | M3 |
| 定时 / Webhook 自动化、通知、打包、自动更新、插件 API、遥测、完整文档 | 无实现 | M4 |
| 取消可靠性 | 排队中的 Run 取消后仍可能被 worker 取出执行；运行中取消存在 API 先写 cancelled、调度器再写回 failed/completed 的竞态 | M1 |
| 超时分类 | 超时统一进入 failed，没有 timeout 错误码与独立事件 | M1 |
| 未知 Runtime 校验 | Agent 可保存任意 runtime 字符串；Registry.Get 对未知名称静默回退 mock，UI 可能仍显示原 runtime | M1 |
| 删除保护 | Task/Agent 为硬删除，不检查活跃 Run，可能留下孤立 Run | M1 |
| 列表分页 | 列表接口没有分页与过滤，数据量增大后一次性返回全部记录 | M1 起 |
| WebSocket 重放 | 没有事件重放与断线续传，断线期间事件丢失 | M1 |
| CORS 与 WS Origin | CORS 反射任意 Origin，WebSocket 的 CheckOrigin 恒为 true；默认只绑定 127.0.0.1，无认证 | M1 |
| 看板状态覆盖 | Board 只有五列，blocked 与 cancelled 任务不可见 | M1 |
| 事件顺序保证 | 同一 Run 的 seq 由调度器计数，但 claude adapter 的 stdout/stderr 两个 goroutine 并发 emit，未串行化，seq 可能重复或乱序 | M1 |
| 数据导出 | 没有任务、Run、证据与配置的导出或备份界面 | M1-M2（Q12） |
| 测试覆盖 | 只有 `internal/store` 有 Go 测试；API、调度器、Runtime、Workspace 与前端没有测试 | M1 |

#### 14.2.1 M0 已知缺口清单

M0 缺口的权威清单见 `prd/01-scope-and-roadmap.md` 第 4.2.3 节，共 14 项，覆盖：无 worktree 与分支隔离、WorkspaceMode 不生效、无 diff/证据/审批/合并、排队取消失效、运行中取消不保证终止进程组、CORS 与 WebSocket Origin 无校验、路径与命令权限不执行、parentId 无依赖语义、删除不阻止活跃 Run、列表无分页、WebSocket 无重放、claude 适配器过于最小、测试稀疏、UI 中英文混用。本节表格中的「M1/M2」是该缺口的目标修复里程碑，不是当前能力。任何对外材料都不得把 §14.1 的「已实现」扩展解释为上述缺口已解决。

### 14.3 里程碑一览

| 里程碑 | 目标 | 核心交付 | 退出标准（概要） | 详情文档 |
|---|---|---|---|---|
| M0 | 骨架跑通 | 领域模型、SQLite、REST/WS、mock Runtime、Vue 看板、Wails 壳 | 本地可创建 Task/Agent/Run 并看到事件；结论为「有条件通过」，已知缺口见 §14.2.1 | `prd/milestones/M0-scaffold.md` |
| M1 | 本地闭环 | git worktree、分支、diff 评审、真实 Claude Code 适配、Artifact、取消/超时、本地安全基线、合并 | 单用户可在隔离 worktree 完成一次从 Task 到合并的完整闭环；取消与超时语义达标；Evidence 实体从 M2 起 | `prd/milestones/M1-local-loop.md` |
| M2 | 角色 Agent 协作 | 任务依赖 DAG、交付物契约、四类角色模板、路径/命令权限、审批门、收件箱、技能、模板、并行调度；Crew 在 M2.2 后置 | 多角色按 DAG 与契约完成一次功能交付，高风险动作均有审批（M2.1）；Crew 不阻塞 M2.1 退出 | `prd/milestones/M2-role-agents.md` |
| M2.3 | Agent Team 与会话 | Agent 小组、小组会话、自动路由与 `@` 覆盖、只读讨论、流式回复与停止、一键转任务、会话页 | 一条「组建小组 → 讨论 → 路由 / @ → 转任务 → Run」的本地演示通过，讨论层无仓库副作用，负向用例全部被拒绝 | `prd/milestones/M2.3-agent-teams.md` |
| M2.4 | Agent 状态看板与工作台 | Agent 工作状态、看板状态与筛选、Agent 工作页、工作上下文、完成过程时间线、历史工作、Run 快照查询 | 看板状态与 Run 列表一致；工作中/已完成 Agent 可进入工作页查看上下文与过程；快照脱敏负向用例通过 | `prd/milestones/M2.4-agent-workbench.md` |
| M3 | 团队模式 | Postgres、登录/权限、远程 Runner、机器注册、共享 Agent、审计、GitHub PR | 2-10 人团队可共享任务、Agent 与机器，审计可追溯 | `prd/milestones/M3-team-mode.md` |
| M4 | 自动化与分发 | 定时/Webhook 自动化、通知、DMG/NSIS/AppImage、自动更新、插件 API、遥测、文档 | 可安装分发的桌面应用，自动化与扩展可用 | `prd/milestones/M4-automation-and-packaging.md` |

### 14.4 版本与兼容口径

- M0 是开发者预览骨架，不是生产可用版本；不承诺数据格式与 API 的向后兼容。
- M1 起对核心数据模型与公开 API 采用显式版本策略；破坏性变更需要迁移脚本与发布说明。
- M0 的数据库仅用于开发与演示，不承诺数据保留；升级到 M1 时允许重建数据库，重建前应手动备份 SQLite 文件。任务、Run、证据与配置的正式导出能力属于 M1-M2 计划（Q12），M0 不提供导出界面，因此不得承诺「通过导出迁移 M0 数据」。
- 里程碑之间按顺序交付；M2 依赖 M1 的隔离与证据，M3 依赖 M2 的权限与审批，M4 依赖前三者的稳定性。

## 15. 依赖、约束与风险

### 15.1 关键依赖

- **Runtime CLI**：Claude Code、Codex 等编码 Agent CLI 的安装方式、认证状态、命令参数与输出格式。任何 CLI 行为变化都可能影响适配器；需要有版本探测与清晰的错误提示。
- **git 与代码托管**：worktree、分支、diff、merge 的语义，以及仓库布局、子模块、LFS 等特殊情况的兼容性。
- **本地工具链**：Go 1.27、Node 24、pnpm 11、Wails v3；版本升级可能引入构建与打包问题。
- **存储**：SQLite（modernc.org/sqlite）用于单机与小队；M3 迁移 Postgres 需要数据迁移与兼容层。
- **操作系统能力**：进程管理、文件监听、截图、路径权限；不同平台差异较大。
- **模型与密钥**：用户自带的订阅或 API Key；密钥存储方式（环境变量、系统钥匙串）尚未定稿。
- **开源合规**：Apache-2.0、DCO、clean-room 政策；所有贡献与文档都必须原创。

### 15.2 约束

- **Clean-room**：不得读取或引用第三方产品的研究资料、文档、UI、品牌资产；仓库中不得提交第三方研究资料，研究结论必须以原创表述重新记录。
- **不转售模型**：ATeam 不代收模型费用，不隐藏模型成本，不提供模型托管。
- **本地优先**：任何默认外发数据的设计都需要重新评审；团队模式必须提供自托管路径。
- **人工评审吞吐**：人是最稀缺资源，评审体验与审批效率直接决定产品上限。
- **团队规模与节奏**：里程碑必须顺序推进，不能同时铺开 M2 与 M3；每个里程碑都要有可演示的闭环。
- **单一代码库**：Go 核心、Vue 前端、Wails 壳、共享包在同一 monorepo 中演进，接口变更需要同步更新类型与客户端。

### 15.3 风险登记

| 风险 | 影响 | 可能性 | 缓解措施 | 预警信号 |
|---|---|---|---|---|
| Runtime CLI 行为变更 | 适配器失效，Run 大面积失败 | 中 | 适配器契约测试、版本探测、mock 回退、清晰错误提示 | 同一 CLI 版本升级后失败率骤升 |
| worktree 在复杂仓库中不可用 | 隔离失败，M1 闭环受阻 | 中 | M1 早期做 monorepo、子模块、LFS 专项验证；记录不支持场景 | 用户报告 worktree 创建失败或磁盘暴涨 |
| 范围蔓延（通用项目管理化、集成膨胀） | 资源分散，核心闭环延迟 | 高 | 严格执行第 13 章非目标；里程碑门禁；需求必须映射 PROD 原则 | 路线图中出现大量非核心集成 |
| Agent 产出质量不稳定导致信任崩塌 | 用户回到单 Agent 或不用 | 高 | 证据化 DoD、小步改动、评审门、风险分级 | 评审拒绝率与回滚率同时上升 |
| 评审成为瓶颈 | 人工介入成本高于收益 | 中 | M2 收件箱、批量评审、风险分层评审、证据摘要 | 审批等待时长持续上升 |
| 权限策略被绕过 | 高风险动作失控 | 中 | 服务端强制而非提示词约束、默认拒绝、审计、命令白名单 | 出现未记录的合并或部署 |
| SQLite 数据损坏或丢失 | 任务与证据丢失 | 低-中 | WAL、定期备份、M1-M2 导出能力、迁移测试 | 启动时迁移失败或数据库锁定 |
| Wails v3 打包与签名问题 | 无法分发桌面应用 | 中 | Web UI 可独立运行；M4 前做打包 spike | 开发壳可用但打包失败 |
| 开源可持续性不足 | 维护停滞，社区流失 | 中 | Apache-2.0、贡献指南、适配器接口稳定、模板生态 | 外部贡献长期为零 |
| 指标与遥测引发隐私质疑 | 用户不信任，采用受阻 | 中 | 本地计算、显式 opt-in、不含代码与日志正文 | 用户反馈担心数据外发 |
| 法律与品牌风险 | 侵权争议，项目受阻 | 低-中 | clean-room 政策、NOTICE、贡献者声明、代码审查 | 贡献中出现可疑复制内容 |

### 15.4 待验证假设

以下内容目前是产品假设，不是事实；应在 M1-M2 通过访谈、埋点（本地、可选）与可用性测试验证：

- 独立开发者确实会同时推进 3 个以上 Agent，而不是偶尔为之。
- 2-10 人团队愿意共享 Agent 配置与执行机器，而不是各自为战。
- 证据化评审能把单次评审时间降低 30% 以上。
- 角色 Agent 与交付物契约能显著提高一次验收通过率。
- 用户愿意为本地优先与开源可扩展牺牲一部分云端便利性。
- worktree 隔离对目标用户的仓库规模足够，不需要更重的沙箱方案。

## 与其他文档的关系

本文件是 PRD 的总纲，其他文档在本文件的约束下展开。文档地图如下：

| 文档 | 负责内容 | 需求 ID 前缀 |
|---|---|---|
| `prd/00-product-overview.md` | 愿景、问题、用户、JTBD、价值主张、原则、指标、非目标、PROD 需求与追踪矩阵、里程碑映射 | PROD-xxx、US-PROD-xx |
| `prd/01-scope-and-roadmap.md` | 产品范围、里程碑路线图、发布标准、范围变更、跨里程碑数据与 API 约定 | SCOPE-xxx、MILE-xxx、REL-xxx、CHG-xxx |
| `prd/02-domain-model.md` | 领域对象、字段、状态机、不变量、标识与删除策略、领域事件 | `DM-TASK`、`DM-AGENT`、`DM-RUN`、`DM-REV`、`DM-ART`、`DM-APPR`、`DM-DEP`、`DM-CREW`、`DM-PROJ` 等领域前缀 |
| `prd/03-user-flows.md` | 单人闭环、角色流水线、Crew、评审与审批、失败恢复、团队模式等端到端流程 | FLOW-*、US-A/B/D/E/F |
| `prd/04-acceptance-and-test-plan.md` | 按模块与里程碑的验收标准、测试矩阵、质量门、验收记录模板 | AC-TASK、AC-AGENT、AC-RUN、AC-COLLAB、AC-SEC、AC-UI、AC-API、AC-NFR |
| `prd/05-risks-and-open-questions.md` | 风险登记、假设、治理决策与开放问题 | RISK-P-xxx、ASM-xxx、OQ-xxx、DEC-xxx、GOV-xxx |
| `prd/modules/task-management.md` | Task 生命周期、状态、优先级、标签、父子关系、上下文组成 | TASK-xxx、US-TASK-xxx |
| `prd/modules/agent-system.md` | Agent 配置、instructions、Runtime 选择、模型、并发、超时、路径与命令权限 | AGENT-xxx、US-AGENT-xx |
| `prd/modules/runtime-and-workspace.md` | Run 生命周期、调度、Runtime 适配器、事件流、取消、超时、worktree、Artifact/Evidence | RUN-xxx、US-RUN-xx |
| `prd/modules/collaboration-and-review.md` | 任务 DAG、交付物契约、角色模板、审批门、Crew、收件箱、技能与模板、评审 | COLLAB-xxx、US-COLLAB-xx |
| `prd/modules/ui-ux.md` | 看板、任务详情、Run 控制台、评审界面、设置、空状态与错误状态 | UI-xxx、US-UI-xx |
| `prd/modules/api-and-data.md` | REST 与 WebSocket 契约、错误模型、事件类型、版本策略、数据模型 | API-xxx、US-API-xx |
| `prd/modules/security-and-permissions.md` | 权限模型、路径与命令策略、风险分级、审批、审计、密钥管理 | SEC-xxx、US-xx（安全模块内，与 US-PROD-xx 不重号） |
| `prd/modules/non-functional-requirements.md` | 性能、可靠性、可移植性、可访问性、可观测性、数据保留、成本 | NFR-PERF/REL/PORT/OBS/NET/RES/COST/PKG-xxx、US-NFR-xx |
| `prd/milestones/M0-scaffold.md` 至 `prd/milestones/M4-automation-and-packaging.md` | 各里程碑目标、范围、用户故事、交付物、验收标准、演示脚本、依赖、风险、退出标准 | 引用模块 ID 与 PROD ID |

关系规则：

1. 本文件定义「为什么做、为谁做、不做什么」；模块文档定义「做什么、怎么交互、边界条件」；里程碑文档定义「何时做、如何验收」；`prd/01-scope-and-roadmap.md` 定义跨里程碑的范围顺序与发布门禁。
2. 模块文档不得削弱 PROD 需求；如果模块实现需要例外，必须在本文件或架构决策记录中说明理由。模块文档应在对应功能需求行反向引用承接的 PROD 编号，追踪矩阵见 §10.1。
3. 里程碑文档不重复展开模块细节，只引用模块文档与需求 ID；验收标准应能直接映射到用户故事与 PROD 需求。
4. 所有文档使用同一套概念词典与状态枚举；发现冲突时，以本文件第 9 章与模块文档中的领域定义为准，并回写修正。
5. 本章用户故事使用 `US-PROD-xx`，避免与 `security-and-permissions.md` 的 `US-xx` 重号；模块用户故事使用带模块前缀的编号（如 `US-TASK-xxx`、`US-RUN-xx`、`US-COLLAB-xx`）。
6. 本文件的变更需要版本号与变更说明；影响需求的变更必须同步检查模块文档与里程碑文档。

## 待确认/未文档化

以下事项是真实存在的开放决策，尚未在代码或文档中定稿；它们不是实现细节的遗漏，而是需要在对应里程碑前明确的产品与架构选择。

| 编号 | 待确认事项 | 当前状态 | 影响 | 最晚决策点 |
|---|---|---|---|---|
| Q1 | Codex Runtime 的接入时间与协议 | 产品简报将 Codex 列为目标 Runtime；`runtime-and-workspace.md` 把 Codex 安排在 M2，M1 不作为退出条件，协议细节仍未定 | 影响 Runtime 适配器抽象与用户选择 | M1 结束前 |
| Q2 | Artifact 的存储介质与保留策略 | 未定；可能为本地文件系统 + SQLite 元数据 | 影响磁盘占用、导出、团队共享 | M1 开发前 |
| Q3 | 密钥存储方式 | 未定；环境变量、系统钥匙串或本地加密文件 | 影响安全模型与用户体验 | M1 开发前 |
| Q4 | 配置快照的粒度 | 未定；需明确 Run 记录哪些 Agent 字段与提示词版本 | 影响可追溯性与数据模型 | M1 |
| Q5 | 合并策略 | 未定；本地 merge、快进、squash 或生成 PR 的优先级 | 影响 M1 评审闭环与 M3 GitHub 集成 | M1 开发前 |
| Q6 | 多仓库任务支持 | 初期假设单仓库；跨仓库依赖未设计 | 影响 Workspace 与 DAG 模型 | M2 规划前 |
| Q7 | 团队身份与权限模型 | 未定；本地账号、OIDC 或混合 | 影响 M3 架构与安全评审 | M3 开发前 |
| Q8 | 远程 Runner 的信任模型 | 未定；机器注册、TLS、密钥轮换、任务分发协议 | 影响 M3 的团队采用 | M3 开发前 |
| Q9 | Windows 与 Linux 的支持深度 | 未定；M4 打包，但 worktree、路径与进程语义需提前验证 | 影响可移植性与测试矩阵 | M1 结束前 |
| Q10 | 插件 API 的边界与沙箱 | 未定；M4 计划，需明确能力、权限与分发方式 | 影响生态与安全 | M4 规划前 |
| Q11 | 遥测范围与默认值 | 未定；原则是默认关闭或显式 opt-in | 影响隐私信任与指标采集 | M2 |
| Q12 | 数据导出与备份格式 | 未定；需支持任务、Run、证据与配置的可迁移导出 | 影响用户锁定与团队迁移 | M1-M2 |
| Q13 | 评审 SLA 与升级策略 | 未定；审批超时后的提醒、转交或阻止策略 | 影响团队治理体验 | M2 |
| Q14 | 每 Agent 并发与资源预算 | 字段已存在但未执行；需定义与全局并发的优先级 | 影响调度公平性与机器负载 | M2 |
| Q15 | 工作区与日志的清理策略 | 未定；保留时长、手动清理、证据引用后的删除规则 | 影响磁盘占用与审计完整性 | M1 |
| Q16 | Agent Team 路由策略 | 自动路由的首版实现（规则优先 + LLM 兜底）、多 Agent 并行回复、路由失败后的交互尚未定稿 | 影响路由准确率、成本与 M2.3 交互 | M2.3 开发前 |
| Q17 | Agent 工作状态窗口 | 「已完成/失败」在无活跃 Run 后保留 24 小时是否合适、是否允许用户配置尚未验证 | 影响看板可读性与工作页默认选中 | M2.4 开发前 |

这些事项将在对应模块文档或架构决策记录中关闭；关闭前，任何实现都应选择可逆方案，避免把未决假设固化到数据模型中。
