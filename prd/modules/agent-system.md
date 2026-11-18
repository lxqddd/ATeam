# 模块：Agent 体系

**模块代号**：AGENT
**覆盖里程碑**：M0（基础能力已实现）、M1–M4（计划）
**关联核心对象**：Task、Run、Workspace、Runtime、Skill、Agent Template

## 本章导读

Agent 是 ATeam 核心闭环中回答「怎么工作」的持久化配置。它把一个可复用的工作方式——职责、指令、默认 Runtime 与模型、运行参数、允许路径与命令、绑定的技能——固化成一个可命名、可版本化、可复用、可审计的对象。Task 回答「做什么」，Agent 回答「按什么方式做」，Run 是两者结合后的一次执行，Run Workspace 是这次执行所在的隔离代码环境，Runtime 是真正调用 Claude Code、Codex 或 mock 的执行器。把这几件事拆开，是 ATeam 与「在一个会话里堆多个 Agent 自由聊天」的根本区别。

本章定义 Agent 的产品语义、类型与模板、全部配置项、指令编写规范、技能绑定、版本、克隆、模板、运行设置、权限与生命周期，并给出可测试的功能需求（编号前缀 AGENT-）与里程碑映射。读者应先理解一个判断：Agent 不是模型，也不是机器，更不是一次执行。Agent 配置的是「工作方式」，模型和 Runtime 是它调用的资源，机器是未来的执行位置（M3 Remote Runner），Run 才是具体的执行实例。

文中所有能力都标注了状态：**已实现（M0）** 表示当前仓库代码中可验证的行为；**部分实现（M0）** 表示字段或基础行为已存在，但缺少校验、生效逻辑或完整语义；**计划（M1–M4）** 表示尚未实现。如果文档描述与仓库代码冲突，以仓库代码为准，并应同步修订本章。

本稿于 2026-11-17 按评审意见修订：修正跨文档路径与权威关系、超时失败语义、空允许路径语义、`workspaceId`/`role`/`permissionMode` 配置、RunConfigSnapshot、技能生命周期与里程碑映射；已裁决事项与待回写清单见 §19。

## 1. 目的与范围

### 1.1 目的

本章要解决四个问题。

第一，给 Agent 一个稳定、可解释的产品定义，避免团队把 Agent、Runtime、模型、机器、Run 混为一谈。清晰的概念边界直接决定数据模型、API 形态和用户心智是否正确。

第二，规定 Agent 的配置项、默认值、校验规则和生效点，让「创建一个 Agent」从随意填表单变成可预测的配置行为。配置项不是装饰性的元数据，每一项都必须说明它在哪一步生效、由谁执行、失败时如何反馈。

第三，规定角色 Agent 的协作方式。UI Design、Frontend、Backend、DevOps 这些角色不是四个聊天机器人，而是通过 Task DAG、交付物契约、审批门和证据化完成定义（DoD）协作的四个工作配置。Agent 体系必须为这种契约式协作提供足够的配置能力。

第四，为技能、版本、克隆、模板市场和团队共享预留一条可演进的产品路径。M0 只做最小 CRUD，但数据模型和交互必须为 M1 的 Run 配置快照、M2 的角色模板/技能/AgentVersion、M3 的团队可见性、M4 的模板市场留出扩展位，而不是届时推倒重来。

### 1.2 范围

本章覆盖以下内容：

- Agent 的产品定义、概念边界与生命周期。
- Agent 类型与内置角色模板：通用、UI Design、Frontend、Backend、DevOps。
- Agent 配置项：名称、描述、指令、role、Runtime、模型、工作区模式、Runtime 权限模式、并发、超时、允许路径、允许命令、权限信封（环境变量、凭据引用、网络访问意图）、可见性，以及计划中的版本、技能、模板来源等字段。
- 指令编写规范：职责、边界、检查、汇报、禁止动作、人工确认点。
- 技能（Skill）：SKILL.md 格式、绑定、版本、导入、冲突与安全。
- Agent 版本、克隆、内置模板与模板市场。
- 运行设置：并发、超时、排队、工作时间（可选）。
- 权限、可见性、删除与归档。
- Agent 相关的 UI 交互、数据模型、API、事件、异常边界、指标、依赖与风险。
- Agent 能力在 M0–M4 的里程碑映射。

### 1.3 非目标

以下内容明确不属于本章范围，也不应被误读为 Agent 能力的隐含承诺：

- 不提供模型托管或推理服务。ATeam 不转售模型，模型调用发生在用户自己的 Runtime 和 Key 之下。
- 不做机器管理。机器注册、远程 Runner、跨机器调度属于 M3，Agent 本身不绑定任何机器。
- 不做「多个 Agent 在同一会话内自由聊天」的群聊式编排。角色协作必须走 Task DAG 与交付物契约。
- 不做通用低代码工作流引擎。Agent 的配置面向软件开发任务，不追求任意业务流程建模。
- 不在任何里程碑做生产环境部署自动化。M2 只允许 DevOps Agent 生成 staging 部署计划并执行 staging；生产部署始终由人工执行，Agent 只能产出计划与检查清单。
- 不做第三方模型的统一网关、计费、配额管理。
- Task DAG、交付物契约、审批门的完整定义属于 `collaboration-and-review.md`；Run 状态机、事件流、worktree 与分支细节属于 `runtime-and-workspace.md`。本章只定义 Agent 侧的配置与约束，并说明它们如何被这些模块消费。
- 不定义模板市场的商业规则与内容审核流程，只定义 M4 的导入安全边界。

### 1.4 概念边界

| 概念 | 回答的问题 | 生命周期 | 是否持久 | 示例 |
| --- | --- | --- | --- | --- |
| Agent | 按什么方式工作 | 长期，多次复用 | 是 | Frontend Agent：实现 UI、只改前端路径、必须跑构建 |
| Runtime | 用什么执行器跑 | 随应用安装与配置 | 是 | claude、codex、mock |
| Model | 调用哪个模型 | Runtime 参数 | 否，随 Run 快照 | 由 Runtime 支持的模型标识 |
| Task | 做什么，上下文是什么 | 从创建到验收 | 是 | 「为登录页补充错误提示」 |
| Run | 这一次执行发生了什么 | 单次，可追溯 | 是 | run_01：由 Frontend Agent 执行，失败于超时 |
| Workspace（产品工作区） | 这批数据属于哪个项目 | 长期 | 是 | 绑定一个本地 git 仓库路径与默认分支；Agent、Task、Run 都带 `workspaceId` |
| Run Workspace（Run 工作区） | 这一次执行在哪份代码副本上 | 单次 Run | 是 | 独立 worktree 与分支，或 M2 的 directory 模式目录 |
| Skill | 可复用的操作知识与检查清单 | 长期，可版本化 | 是 | 表单可访问性检查技能 |
| Machine / Runner | 在哪台机器上执行 | M3 引入 | 是 | 团队共享的构建机 |

四个容易混淆的点需要特别强调：

1. Agent 不是模型。Agent 可以指定默认模型偏好，但模型只是 Runtime 的参数；同一个 Agent 在不同 Run 中可以使用不同模型，且模型变化必须记录在 Run 快照中。
2. Agent 不是机器。Agent 不绑定本机路径、主机名或凭据。M0 的 Run 都在本地执行；M3 的 Agent 可以在任意已注册 Runner 上执行，但 Agent 配置本身不感知机器。
3. Agent 不是 Run。Agent 的编辑不会改写历史 Run 的行为。每次 Run 必须绑定当时的 Agent 配置快照；这是可复现与审计的基础（M1 落地）。
4. **Workspace 不是 Run Workspace**。产品级 Workspace 是数据归属与唯一性边界（一个本地仓库项目）；Run Workspace 是一次 Run 的执行副本（worktree 或目录）。本章说「同一工作区唯一」时指产品级 Workspace；说「允许路径相对于工作区根」时指 Run Workspace。两者在 API 与数据模型中分别使用 `workspaceId` 与 `worktree`/目录字段，不能混用。

术语映射说明：产品级归属实体在全套 PRD 中统一为 **Workspace**（`workspaceId`，表 `workspaces`，默认 ID `default`）；`Project`/`projectId` 是历史称谓与 M1-M2 请求输入别名，不再作为第二套实体。`prd/milestones/M1-local-loop.md` 的 `localPath`/`baseBranch`/`verifyCommand` 分别映射为 Workspace 的 `repoPath`/`defaultBranch`/`verificationCommands[0]`。M1 建表与迁移必须只保留一个实体，不能出现 Agent 属于 Workspace 而 Run 属于 Project 的两套归属。

## 2. 角色与场景

### 2.1 用户角色

| 角色 | 主要诉求 | Agent 相关行为 | 权限范围 |
| --- | --- | --- | --- |
| 独立开发者 | 同时跑 3–5 个 Agent，减少上下文切换 | 创建、克隆、快速调整 Agent，查看每个 Agent 的成功率与超时率 | 本地全部 Agent 的读、写、删除（M0–M2） |
| 小团队成员 | 共享任务、Agent 与机器，减少重复配置 | 使用团队共享 Agent，复制到自己的空间做微调，查看 Run 证据 | 团队可见 Agent 只读，个人 Agent 读写（M3） |
| 团队管理员 | 治理 Agent 质量与权限边界 | 维护共享 Agent、审批高风险动作、审计变更 | 团队 Agent 的创建、编辑、归档、审计（M3） |
| 评审人 | 只关心本次 Run 是否符合预期 | 查看 Run 绑定的 Agent 配置快照、指令摘要、权限与证据 | 只读（M1 起在 Run 详情中呈现） |

独立开发者与评审人不是互斥身份。ATeam 是本地优先产品，M0–M2 的默认假设是「本机用户即管理员」；团队角色模型从 M3 开始生效。

### 2.2 典型场景

**场景 A：独立开发者的并行工作台。** 开发者早上创建三个 Agent：一个 Frontend Agent 负责登录页改版，一个 Backend Agent 负责新增认证接口，一个 DevOps Agent 负责更新 staging 部署脚本。三个 Task 分别指向对应 Agent，启动三个 Run。开发者不需要反复粘贴「你是前端工程师，请只改 apps/web」这类提示词，因为工作方式已经固化在 Agent 中。中午他查看三个 Run 的证据，合并其中一个，取消另一个，调整第三个的指令后重跑。

**场景 B：小团队的共享配置。** 团队约定所有 Backend Agent 必须运行 `go test ./...` 并在汇报中包含失败用例。管理员把这份配置做成团队可见的 Agent 模板。新成员加入后直接使用共享 Agent 启动 Run，不需要重新理解团队规范。成员若要做实验，可以克隆一份到个人空间修改，不影响共享版本。

**场景 C：角色化流水线。** 一个「支付设置页」需求被拆成四个 Task 组成的 DAG：UI Design 产出设计说明与组件清单；Frontend 依据交付物契约实现页面；Backend 提供设置读写接口；DevOps 更新 staging 环境变量。每个 Task 只依赖上游交付物，Agent 之间不直接对话。任何跨角色的判断都由交付物契约与人工审批完成。

**场景 D：受控试验。** 开发者想尝试一个更激进的指令风格，但不确定效果。他克隆现有 Agent，修改指令，绑定到一个小型 Task 上运行，对比证据后再决定是否替换主 Agent。克隆与版本历史让试验可回滚。

### 2.3 当前实现与差距（M0）

M0 的目标是跑通 Task/Agent/Run 的最小闭环，Agent 能力只覆盖「持久化配置 + 被调度器读取」。以下为仓库代码可验证的现状，后续里程碑不得把这些计划外推为已实现。

| 能力 | M0 现状 | 证据与边界 | 目标里程碑 |
| --- | --- | --- | --- |
| Agent CRUD | 已实现 | `internal/api/handlers.go` 提供 list/create/get/patch/delete；`internal/store/sqlite.go` 持久化到 `agents` 表；WebSocket 广播 `agent.created`、`agent.updated`、`agent.deleted` | M0 |
| 数据结构 | 已实现 | `internal/domain/domain.go` 的 `Agent` 含 Name、Description、Instructions、Runtime、Model、WorkspaceMode、MaxConcurrency、TimeoutMinutes、AllowedPaths、AllowedCommands 与时间戳 | M0 |
| 默认值 | 已实现 | 创建时 Runtime 为空填 `mock`，WorkspaceMode 为空填 `worktree`，MaxConcurrency 不超过 0 填 1，TimeoutMinutes 不超过 0 填 60；允许路径与命令为空时写空数组 | M0 |
| 校验 | 仅名称非空 | 创建与 PATCH 只校验名称非空；Runtime、Model、WorkspaceMode、并发、超时、路径、命令均无枚举、范围或格式校验 | M1 |
| UI | 列表 + 创建弹窗 | `AgentsView.vue` 展示卡片与创建表单；表单只有 allowedPaths 输入，没有 allowedCommands、WorkspaceMode、Runtime 权限模式输入；卡片展示 Runtime、并发、超时与 workspaceMode，不展示 allowedPaths 与 allowedCommands；没有编辑、删除、详情入口；Pinia store 的 `remove` 尚未在页面使用 | M1 基础编辑表单（次要项）；M2 完整管理 UI |
| 指令注入 | 已实现 | `scheduler.buildPrompt` 将任务元信息、任务描述、Agent 指令与通用规则拼成提示词交给 Runtime | M0 |
| Runtime 选择 | 部分实现 | registry 只有 `mock` 与 `claude`；`claude` 适配器仅执行 `claude -p` 并传入提示词；未知 Runtime 会静默回退到 `mock` | M1 |
| 模型传递 | 未生效 | `Model` 字段被持久化，但没有传给任何 Runtime 适配器 | M1 |
| 超时 | 部分实现 | Scheduler 在 Run 进入 running 后用 `TimeoutMinutes` 创建 context 超时；排队与准备时间不计入；超时后 Adapter 返回错误，Run 以 `failed` 结束，但没有 `errorCode=timeout` 分类与 `run.timeout` 事件；手动取消则存在另一条状态回写路径（见 8.2） | M1 |
| Runtime 权限模式 | 未实现 | Agent 没有权限模式字段；claude adapter 只执行 `claude -p`，不传权限参数 | M1 |
| 并发 | 未生效 | `MaxConcurrency` 被持久化但不参与调度；调度器使用全局 worker 池（默认 2）与内存队列（容量 256） | M2 |
| 工作区模式 | 未生效 | `WorkspaceMode` 被持久化，但 `workspace.Manager` 忽略该参数，始终在 workspace 根下创建 `runs/{runId}` 普通目录，没有 worktree 与分支 | M1 |
| 允许路径/命令 | 仅存储 | 两个字段被持久化；allowedPaths 在创建弹窗有逗号分隔输入，allowedCommands 没有任何 UI，卡片也不展示两者；运行时不做任何拦截或校验 | M2 |
| 配置快照 | 未实现 | `runs` 只记录 `agent_id`，没有配置快照、提示词哈希、Runtime 版本与权限模式；历史 Run 无法复现当时的 Agent 配置 | M1 |
| 版本/克隆/模板/技能/可见性/归档 | 未实现 | 数据表与 API 均无对应字段或资源；其中归档从 M1 起交付（M2.1 恢复窗口），版本历史、克隆与完整管理 UI 按 17 节裁决放在 M2，团队可见性在 M3，模板市场在 M4 | M1–M4 |
| 删除语义 | 硬删除 | `DELETE /api/agents/{id}` 直接删除记录；不检查是否存在关联 Run；历史 Run 的 `agentId` 会悬空；M1 起改为确认 + 阻止 + 归档，M2.1 起 30 天恢复窗口 | M1/M2.1 |

## 3. 用户故事

### US-AGENT-01 创建通用 Agent 并启动第一次 Run（M0 创建与启动；M1 详情）

- **Given** 用户已打开 ATeam，尚未创建任何 Agent
- **When** 用户在 Agents 页面点击「New agent」，填写名称、指令、Runtime、超时并保存
- **Then** 系统创建 Agent 并在列表中展示；用户可以在 Task 详情中选择该 Agent 启动 Run
- **验收补充**：刷新页面后 Agent 仍存在；M0 的 Run 详情只展示 Run 自身字段，Agent 名称与指令摘要随 Run 详情在 M1 补齐。

### US-AGENT-02 用角色模板快速创建 Frontend Agent（M2）

- **Given** 用户需要实现一个前端页面，不熟悉指令编写规范
- **When** 用户在模板列表选择「Frontend」，填写项目变量并实例化
- **Then** 系统生成一个可编辑的 Frontend Agent，预置职责、边界、检查命令、汇报格式、禁止动作与人工确认点
- **验收补充**：模板生成的 Agent 可以修改并保存；内置模板本身不被修改；实例化后能看到权限摘要。

### US-AGENT-03 克隆并微调（M2）

- **Given** 用户已有 Backend Agent，并希望试验另一套指令风格
- **When** 用户对 Agent 执行 Clone
- **Then** 系统生成名称为「原名称 (copy)」的新 Agent，复制配置与技能绑定，版本从 1 开始，不与原 Agent 共享后续修改
- **验收补充**：克隆不复制历史 Run；原 Agent 的配置与版本不变。

### US-AGENT-04 修改指令不影响历史 Run（M1）

- **Given** 某个 Agent 已被三次 Run 使用
- **When** 用户修改该 Agent 的指令并保存
- **Then** 新配置生效于之后创建的 Run；历史 Run 详情仍展示当时的配置快照、指令摘要与配置哈希
- **验收补充**：历史 Run 的提示词快照可查看，不能被新配置覆盖；排队中的 Run 也使用创建时的快照。

### US-AGENT-05 绑定技能（M2）

- **Given** 用户导入了一个「表单校验」技能，版本为 1.0.0
- **When** 用户把该技能绑定到 Frontend Agent，并保存
- **Then** 后续 Run 的提示词按固定顺序包含技能内容；Run 证据记录技能名称、版本与哈希
- **验收补充**：技能版本不存在时，启动 Run 被阻止并提示缺少的版本。

### US-AGENT-06 限制写入路径与命令（M2）

- **Given** 团队要求 Frontend Agent 只能改前端目录，且只能运行构建与测试命令
- **When** 用户配置允许路径为前端目录前缀，允许命令为构建/测试命令，并启动 Run
- **Then** 运行时对越界写入进行拦截或标记；越界命令被拒绝并产生事件
- **验收补充**：Run 结束后检查变更文件列表，超出允许路径的变更会使 Run 进入需要人工复核的状态。

### US-AGENT-07 配置并发与超时（M1 超时 / M2 并发）

- **Given** 用户有多个待执行 Task，希望同一 Agent 最多同时跑两个
- **When** 用户设置 MaxConcurrency 为 2、TimeoutMinutes 为 30，并启动四个 Run
- **Then** 调度器最多并行执行两个 Run，其余进入队列；M1 中每个 Run 运行达到 30 分钟即被终止，Run 以 `failed` 结束、`errorCode=timeout`，并记录 `run.timeout` 事件；M2 起 Agent 级并发才真正生效
- **验收补充**：队列等待时间不计入 Run 运行时长；超时后证据与日志保留；超时不得标记为 `cancelled` 或 `completed`。

### US-AGENT-08 归档而不是删除（M1）

- **Given** 一个 Agent 已被多个 Run 使用，用户不再需要它
- **When** 用户选择 Archive
- **Then** Agent 从可选列表消失，历史 Run 仍可查看其版本与配置；用户可恢复
- **验收补充**：归档 Agent 不能启动新 Run；恢复后重新可选。

### US-AGENT-09 团队共享 Agent（M3）

- **Given** 团队成员需要统一 Backend 工作方式
- **When** 管理员把 Agent 可见性设置为 Team 并保存
- **Then** 同团队成员可见该 Agent 并可基于其启动 Run，但不能修改；只有所有者与管理员可编辑
- **验收补充**：其他团队不可见；变更写入审计日志。

### US-AGENT-10 导入模板包（M4）

- **Given** 用户从外部获得一个 Agent 模板包
- **When** 用户导入该包
- **Then** 系统展示模板声明的 Runtime 要求、路径与命令权限、包含的技能与版本，要求用户确认后才创建 Agent
- **验收补充**：模板包含密钥、越界路径或未声明命令时导入失败并给出原因。

### US-AGENT-11 启动 Run 前的资格检查（M1 阻断条件 / M2 排队）

- **Given** 用户尝试用某个 Agent 启动 Run
- **When** 该 Agent 已归档、Runtime 不可用、权限配置非法或技能版本缺失
- **Then** 系统阻止启动并展示具体原因；若只是并发已满，则允许加入队列并展示队列位置（M2）
- **验收补充**：在 Agent 选择列表中，不可用 Agent 显示阻塞原因，而不是静默失败；排队不是失败，不能被显示为错误终态。

### US-AGENT-12 高风险动作人工审批（M2）

- **Given** DevOps Agent 完成 staging 部署计划
- **When** 计划包含推送、合并或部署动作
- **Then** 系统暂停执行并要求人工审批；生产环境动作永远不由 Agent 执行
- **验收补充**：审批记录包含操作人、时间、动作和 Run 证据。

### US-AGENT-13 角色流水线按 DAG 协作（M2）

- **Given** 一个需求被拆成 Design、Frontend、Backend、DevOps 四个 Task
- **When** 上游 Task 完成并提交交付物
- **Then** 下游 Task 校验交付物契约后由对应 Agent 启动 Run；缺少交付物时阻塞而不是猜测
- **验收补充**：任何角色 Agent 都不能跳过契约直接修改下游文件。

### US-AGENT-14 审计 Agent 变更（M3）

- **Given** 团队共享 Agent 被修改
- **When** 管理员查看审计日志
- **Then** 可以看到修改人、时间、版本差异、权限变化与受影响的后续 Run
- **验收补充**：权限被拒绝的事件同样记录。

### US-AGENT-15 查看 Agent 状态与工作过程（M2.4）

- **Given** Agent 看板上有多个 Agent，部分正在运行、部分已结束、部分空闲
- **When** 用户查看看板
- **Then** 每个 Agent 显示空闲、工作中、已完成或失败待处理状态；工作中显示当前任务与阶段，已完成显示完成时间
- **And** 用户点击工作中或已完成的 Agent，进入该 Agent 的工作页，看到当前/最近 Run 的工作上下文与完成任务的过程
- **And** 空闲 Agent 进入工作页时显示明确的空态，不伪造上下文

### US-AGENT-16 编辑/删除 Agent 并测试模型连接（M2.1）

- **Given** Agents 看板已有 Agent
- **When** 用户点击编辑并保存，或点击删除并确认
- **Then** 编辑复用同一表单并预填当前配置，保存后卡片更新；删除前二次确认，存在活跃 Run 时拒绝并提示先取消
- **And** 在创建/编辑表单中选择 Runtime 与模型后，用户可以点击「测试连接」；系统发送一次最小只读请求并显示成功耗时或失败原因
- **And** 测试连接不创建 Run、不产生 Artifact、不写仓库

## 4. Agent 概念模型

### 4.1 定义

Agent 是一个持久化的、可命名的工作配置，包含四类信息：

1. **身份与说明**：名称、描述、role、类型来源（`roleTemplateId` 或自定义）、可见性与所有者（M3）。
2. **工作方式**：指令文本、绑定的技能与版本（M2）、指令组装规则。
3. **执行偏好**：Runtime、模型、工作区模式、并发、超时、排队行为。
4. **边界与治理**：允许路径、允许命令、Runtime 权限模式、环境变量白名单、凭据引用、网络访问意图、人工确认点、禁止动作、版本与归档状态。

Agent 的设计遵循五条原则：

- **可复用**：一个 Agent 可被多个 Task 与 Run 引用；复用是默认行为，克隆是例外。
- **不可变快照**：Run 创建（入队）时绑定当时的 Agent 配置快照；编辑 Agent 不影响历史与已排队 Run。
- **职责单一**：一个 Agent 应对应一种清晰的工作角色或工作方式；不鼓励「万能 Agent」。
- **权限最小化**：只给完成职责所需的路径与命令；空允许路径表示不可写任何路径，而不是无限授权（语义见 4.5 与 9.4）。
- **契约优先**：角色之间通过交付物契约协作，不通过自由对话协商。

### 4.2 Agent 角色、类型与内置模板

Agent 有两个相关但不同的分类维度：

- **role（角色）**：协作语义分类，取值为 `general`、`ui_design`、`frontend`、`backend`、`devops`、`custom`。它用于任务 DAG 的依赖校验、同角色默认绑定与默认门禁选择（COLLAB-003），也是 UI 筛选与模板匹配的依据。role 本身不授予任何路径或命令权限；真正的执行边界始终由权限信封（允许路径、允许命令、环境变量白名单、凭据引用、Runtime 权限模式、网络访问意图）决定。
- **roleTemplateId（角色模板来源）**：记录这个 Agent 从哪个内置模板或导入模板实例化而来，用于来源追踪、模板升级提示与版本对比，不参与权限判断。数据库列为 `role_template_id`；旧稿的 `templateKey` 是同一字段的弃用别名。实例化时同时记录 `roleTemplateVersion`（`role_template_version`）与 `templateSnapshot`（`template_snapshot`）。

因此，「Frontend Agent」表示 role 为 `frontend`、通常由 Frontend 模板实例化、并配置了前端路径与命令权限的工作配置；它不是硬编码权限角色，也不意味着模板升级会自动改写已有 Agent。用户可以创建不属于任何模板的 `custom` Agent；M2 的既有数据在迁移时默认标记为 `general`，避免把历史 Agent 误认为具备某个角色的默认门禁。

| 模板 | role 值 | 核心职责 | 典型输入 | 典型输出（证据） | 默认权限边界 | 默认 Runtime | 里程碑 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| General 通用 | `general` | 处理未分类的小型开发任务 | Task 描述与上下文 | diff、检查结果、变更摘要 | 由用户显式配置；未配置时不可写任何路径 | mock（M0 默认），实际使用建议 claude | M0 概念存在，M2 提供模板 |
| UI Design | `ui_design` | 产出设计说明、组件清单、设计 token 与可访问性要求 | 需求、现有组件与样式、品牌约束 | 设计文档、token 变更、截图证据 | 设计与样式目录可写，业务代码只读 | claude | M2 |
| Frontend | `frontend` | 按交付物契约实现界面与交互 | 设计说明、组件契约、API 契约 | 前端代码 diff、构建与测试结果、截图 | 前端与共享 UI 包可写，后端只读 | claude | M2 |
| Backend | `backend` | 实现接口、领域逻辑与数据迁移 | API 契约、数据模型、验收标准 | Go 代码 diff、单元测试、迁移脚本 | 后端与迁移目录可写，前端只读 | claude | M2 |
| DevOps | `devops` | 维护构建、CI、部署脚本与环境说明 | 部署目标、环境约束、变更说明 | 配置 diff、部署计划、staging 验证记录 | CI 与脚本目录可写，生产凭据不可用 | claude | M2 |
| Custom 自定义（非内置模板） | `custom` | 用户自定义职责 | 由用户定义 | 由用户定义 | 默认最小权限，无门禁豁免 | 用户选择 | M2 |

各角色模板的默认边界建议如下，实例化后允许调整，但生产环境相关限制不可放宽：

- **General**：不预设写入授权，未配置 `allowedPaths` 时不可写任何路径；必须包含检查与汇报段落；合并、推送、部署仍需人工审批。
- **UI Design**：禁止修改业务逻辑与后端；截图与设计文档必须作为证据提交；涉及新增依赖时请求人工确认。
- **Frontend**：默认允许 `apps/web/`、`packages/ui/`、`packages/shared/`；默认命令为构建、类型检查、测试与 lint；禁止修改 `internal/` 与数据库迁移。
- **Backend**：默认允许 `internal/`、`cmd/`、迁移目录；默认命令为构建、测试与静态检查；修改共享 API 类型时必须请求确认。
- **DevOps**：默认允许 CI 配置、`scripts/`、部署与运行手册目录；默认命令限定为只读检查与 staging 部署命令；生产部署只产出计划，由人工执行。

角色模板必须携带「禁止动作」和「人工确认点」两段内容，这是模板质量的最低要求。模板不是权限的替代品，真正的拦截由 M2 的权限执行层完成。

### 4.3 角色协作：DAG + 契约，不是自由聊天

角色 Agent 的协作模型如下：

```text
需求
  → Task A（UI Design）──交付物：设计说明、组件清单、token
  → Task B（Frontend）──依赖 A 的交付物，产出前端 diff 与截图
  → Task C（Backend）──依赖 A 的 API 契约，产出接口与测试
  → Task D（DevOps）──依赖 B、C 的构建产物，产出 staging 部署计划
  → 人工评审门 → 合并
```

规则如下：

1. 每个 Task 只能有一个负责 Agent；同一父任务下的多 Agent 协作通过 Crew 的子任务 DAG 实现（M2 后段），且仍以契约与审批为前提。
2. 下游 Task 启动前必须校验上游交付物是否满足契约；缺失或格式不符时阻塞，不允许 Agent 自行猜测。
3. Agent 之间的信息传递只通过交付物、Task 上下文与证据，不允许在同一个会话中互相注入自由文本。
4. 跨角色判断（例如「这个 API 契约是否可接受」）由人工确认点或评审人完成，不交给 Agent 互评。
5. 每个角色的输出必须可验证：diff、测试结果、截图、部署计划或设计文档至少有一项作为证据。

### 4.4 配置项总表

| 配置项 | 类型 | 默认值 | 约束 | 生效点 | 状态与里程碑 |
| --- | --- | --- | --- | --- | --- |
| id | string | 系统生成 | 不可变 | 全局引用 | 已实现（M0） |
| workspaceId | string | `default` | 必须引用存在的产品级 Workspace；创建后不可改；跨 Workspace 引用返回 409 | 归属、唯一性范围与权限判断 | 计划（M1；M0 为隐式默认 Workspace） |
| name | string | 无 | 1–80 字符，同一产品级 Workspace 内活跃 Agent 不区分大小写唯一（M1）；归档后名称可复用 | 展示与引用 | 已实现（M0 仅非空校验） |
| description | string | 空 | 不超过 280 字符（M1） | 列表与选择器 | 已实现（M0 无长度校验） |
| instructions | text | 空 | 不超过 64KB；M1 起估算 token 并提示 | 提示词组装 | 已实现（M0） |
| role | enum | `general` | `general`、`ui_design`、`frontend`、`backend`、`devops`、`custom`；用于依赖校验与默认门禁；不直接授予权限 | 任务 DAG、模板匹配、UI 筛选 | 计划（M2；旧数据迁移默认 `general`） |
| runtime | string | `mock` | 必须是已注册适配器：`mock`、`claude`，后续 `codex`（M2） | Run 启动时选择适配器 | 部分实现（M0 未知值静默回退 mock） |
| model | string | 空 | 为空表示使用 Runtime 默认模型；非空时必须是所选 Runtime 当前模型目录中的 `id`；目录来自 Runtime 探测与本地模型配置；切换 Runtime 时若原模型不在新目录中必须重置或拒绝保存 | 传给 Runtime | M0 仅存储；M2.1 下拉选择与校验 |
| workspaceMode | string | `worktree` | `worktree`（M1）；`directory`（M2 直接目录模式，必须显式确认并警示，不等同隔离） | Run 工作区准备 | 未生效（M0 字段仅存储） |
| permissionMode（Runtime 权限模式） | enum | `controlled_edit` | `read_only`、`controlled_edit`、`full_access`；`full_access` 必须显式开启并在 UI 警示；写入 Run 事件与快照 | Runtime 权限参数与快照 | 计划（M1） |
| maxConcurrency | int | 1 | 1–16；M1 只受全局并发约束，M2 起按 Agent 生效 | 调度器准入 | 未生效（M0 字段仅存储） |
| timeoutMinutes | int | 60 | 1–1440；PATCH 为 0 也不得关闭超时（M1） | Runtime 执行超时 | 部分实现（M0 有超时但无分类） |
| allowedPaths | string[] | 空数组 | 仓库相对 POSIX 路径前缀；禁止绝对路径、盘符与 `..`；**空数组表示不可写任何路径** | 写入拦截与变更审计（M2） | 仅存储（M0） |
| allowedCommands | string[] | 空数组 | 可执行名或「可执行名 + 子命令前缀」；禁止 shell 元字符；**空数组表示不额外授权任何命令** | 命令拦截（M2） | 仅存储（M0） |
| envAllowlist | string[] | 空数组 | 环境变量白名单；敏感名称默认不继承；只允许字面量名称，不允许模式 | 子进程环境（M2） | 未实现（M2） |
| credentialRefs | string[] | 空数组 | 只存操作系统钥匙串中的引用 ID，不存明文；引用可跨 Agent 复用但必须显式授权并审计 | Runtime 启动前注入（M2） | 未实现（M2） |
| networkAccess | enum | `none` | `none`、`allowlist`、`unrestricted`；记录网络访问意图，执行能力取决于 Runtime 声明 | 权限信封与 UI 展示（M2） | 未实现（M2） |
| currentVersionId | string | 空 | 指向 AgentVersion；M2 起由保存流程维护 | 版本解析与 UI | 未实现（M2） |
| revision | int | 1 | 乐观并发控制；每次成功写入加 1 | PATCH 前置条件 | 计划（M1） |
| skillBindings | array | 空 | 技能名 + 固定版本 + 启用状态；顺序固定（M2） | 提示词组装 | 未实现（M2） |
| roleTemplateId / roleTemplateVersion | string | 空 | 角色模板标识及版本（M2/M4）；与 role 独立；`templateKey`/`templateVersion` 为弃用别名 | 来源追踪与升级提示 | 未实现（M2/M4） |
| templateSnapshot | object | 空 | 实例化时的模板完整内容快照；模板升级不回溯 | 版本对比与可复现 | 未实现（M2） |
| status / archivedAt | enum / timestamp | `active` / 空 | `active`、`archived`；归档后不可用于新 Run，历史与快照保留 | 生命周期 | 未实现（M1） |
| visibility | string | `private` | `private`、`team`（M3）；模板包另有导出范围（M4） | 列表过滤与权限 | 未实现（M3） |
| ownerId / teamId / createdBy | string | 空 | 团队模式下由服务端写入（M3） | 权限判断与审计 | 未实现（M3） |
| createdAt / updatedAt | timestamp | 系统时间 | UTC；更新时刷新 | 排序与审计 | 已实现（M0） |

### 4.5 校验与默认值规则

M1 起，保存 Agent 时按字段所属里程碑统一执行校验；M0 仅执行名称非空检查。M1 只校验 M1 已存在的字段，M2 字段在引入时再启用对应规则。校验失败必须返回字段级错误，不得部分写入。

1. **Workspace 归属**：`workspaceId` 必填并引用存在的产品级 Workspace；创建后不可修改；其创建的 Run 必须属于同一 Workspace，跨 Workspace 使用返回 409。M0 的所有数据归属隐式 `default` Workspace，M1 回填。
2. **名称**：去除首尾空白后长度 1–80；同一产品级 Workspace 内活跃 Agent 不区分大小写唯一；归档后名称可复用；PATCH 传空字符串返回 400。
3. **描述**：允许为空，最长 280 字符。
4. **指令**：允许为空但给出警告，因为空指令意味着 Agent 没有职责与边界；最长 64KB。
5. **角色**：只接受 `general`、`ui_design`、`frontend`、`backend`、`devops`、`custom`；旧数据迁移时默认 `general`。角色只影响依赖校验与默认门禁，不改变权限信封。
6. **Runtime**：必须属于已注册适配器集合；未注册值返回 400，不允许静默回退。
7. **模型**：可空；非空时必须是所选 Runtime 当前模型目录中的 `id`，否则返回 `400 MODEL_NOT_AVAILABLE` 并在 details 中列出可选模型。模型目录由 Runtime 探测结果、Claude Code 本地配置（`modelPicker.options` 与 `ANTHROPIC_*_MODEL`，只读模型键，不读取 token）与 ATeam 本地模型配置合并去重；目录为空时只允许空模型（Runtime 默认）。只有 `supported=true` 的 Runtime 可用于创建 Agent；仅检测到 CLI 但无执行适配器的 Runtime 显示「暂不支持执行」。切换 Runtime 时，若已有模型不在新目录中，UI 必须重置为空或阻止保存并提示。模型不作为权限或隔离依据。已有 Agent 的模型在目录变化后变为不可用时，服务端不得自动改写其配置；Agent 列表与编辑器标记 `unavailable`，启动 Run 前阻止并提示重新选择（模型目录不可探测时除外，由 Adapter 返回运行错误）。
8. **工作区模式**：M1 只接受 `worktree`；M2 增加 `directory`（直接目录模式），必须显式确认并提示「不具备 worktree 隔离」；两者不能与 `shared` 之类未定义值混用。
9. **Runtime 权限模式**：只接受 `read_only`、`controlled_edit`、`full_access`；默认 `controlled_edit`；`full_access` 必须在 UI 中显式开启并展示风险警示，保存与每次生效都要写入事件与 Run 快照。
10. **并发**：整数 1–16；创建时缺失或小于 1 使用 1；PATCH 不允许小于 1。
11. **超时**：整数 1–1440；创建时缺失或小于 1 使用 60；PATCH 不允许小于 1；0 不能表示关闭超时。
12. **允许路径**：统一转换为 POSIX 风格仓库相对路径；拒绝绝对路径、盘符、`..` 段与空字符串；使用前缀匹配（M4 再评估 glob）。**空数组表示不可写任何路径**，UI 必须显示「不可写任何路径」，不允许把它解释为整个工作区；若产品决定允许「显式确认后的整个工作区」，必须使用独立字段或显式确认标记，不能复用空数组。
13. **允许命令**：拒绝包含 `;`、`|`、`&`、`>`、`<`、反引号、`$(` 的条目；每条最多 200 字符；按 argv 匹配，默认不经过 shell。**空数组表示不额外授权任何命令**，Runtime 只能使用其内置只读能力；任何显式命令都必须先加入白名单。
14. **环境变量白名单**：只允许字面量变量名，不接受 `*` 或模式；除 `PATH` 等 Runtime 必需变量外，名称包含 `TOKEN`、`SECRET`、`KEY`、`PASSWORD` 的变量默认不继承，需要显式确认。
15. **凭据引用**：只接受操作系统钥匙串中的引用 ID；拒绝明文与疑似密钥字符串；同一引用跨 Agent 使用必须显式授权并记录审计。
16. **网络访问意图**：只接受 `none`、`allowlist`、`unrestricted`；默认 `none`；`unrestricted` 必须在 UI 中警示，并说明实际执行取决于 Runtime 能力。
17. **技能绑定**：技能必须存在且版本可解析；绑定顺序参与提示词组装；不得重复绑定同名技能；技能的 `requiredCommands` 必须是 Agent 允许命令的子集。
18. **可见性**：本地模式只允许 `private`；M3 团队模式允许 `team`，且必须由服务端写入团队标识。

默认值只在创建时补齐；PATCH 不重新应用默认值，避免用户以为「改回空值会恢复默认」。所有默认值与空数组语义应在 API、UI 文案与验收测试中一致展示；任何放宽权限的修改都需要二次确认（SEC-015）。

### 4.6 Agent 工作状态与工作台（M2.4）

Agent 有两个互不替代的状态维度：

- **生命周期状态**（`status`）：`active` / `archived`，是持久化配置，决定 Agent 能否用于新 Run；
- **工作状态**（`workStatus`）：`idle` / `working` / `completed` / `failed`，是**服务端派生的只读状态**，不写入 Agent 配置，也不接受客户端 PATCH。

工作状态的判定（以服务端时间为准）：

| 状态 | 判定规则 | 看板语义 |
| --- | --- | --- |
| `working` 工作中 | 存在至少一个 `queued`、`preparing` 或 `running` 的 Run | 显示当前阶段、当前任务与已运行时长；有多条活跃 Run 时显示数量 |
| `completed` 已完成 | 无活跃 Run；最近一次 Run 为 `completed`，且 `endedAt` 在最近 24 小时内 | 显示完成时间与对应任务，可直接进入工作页复盘 |
| `failed` 失败待处理 | 无活跃 Run；最近一次 Run 为 `failed`（含 `timeout`）或 `cancelled`，且 `endedAt` 在最近 24 小时内 | 显示失败分类与对应任务，提供重试或查看 Run |
| `idle` 空闲 | 其余情况：从未运行，或最近一次 Run 已结束超过 24 小时 | 显示「空闲」；可查看历史工作 |

规则：

1. 生命周期为 `archived` 时，看板默认显示「已归档」并覆盖工作状态；归档不改变历史工作记录。
2. 同一 Agent 有多条活跃 Run 时，`workStatus=working`；工作页按 `startedAt` 排序列出全部活跃 Run。
3. 24 小时是 M2.4 的固定**状态展示窗口**（不是 §8.4 的工作时间调度窗口）；是否允许用户配置列入开放问题，首版不提供设置项。
4. `workStatus` 只由 Run 生命周期驱动；Agent 配置编辑、指令修改、技能绑定不改变工作状态。
5. 服务端在 `GET /api/v1/agents/{id}/work` 返回状态与判定依据；前端不得自行用本地时间重算，以免多端不一致。
6. 看板状态必须与 Run 列表一致：任一页面显示 `working` 时，Run 列表必须存在对应活跃 Run。

**Agent 工作页**（路由 `/agents/{id}/work`）是 Agent 视角的工作复盘入口，不等于 Run 详情页：

- **当前工作**：活跃 Run 的阶段、任务、开始时间、工作区与分支、最近事件摘要；支持取消跳转；
- **工作上下文**：所选 Run 的 Task 上下文、AgentVersion / RunConfigSnapshot（指令（脱敏，可折叠）、角色、Runtime、模型、权限模式与权限信封、提示词哈希）、Workspace 与 base/head commit、上游契约与证据引用（M2 起）；
- **完成过程**：该 Run 的结构化时间线（生命周期、工具调用、文件变更、测试、Artifact、评审与合并），可按类型过滤并跳转 Run 详情；
- **历史工作**：该 Agent 最近的 Run 列表（默认 20 条），显示状态、任务、耗时、用量与评审/合并结果；
- **空态**：空闲 Agent 显示「尚无工作记录」与「查看可执行任务」入口，不显示伪造的上下文。

工作页只读展示 Agent 的执行上下文，不提供修改 Agent 配置或直接启动 Run 的入口；编辑与启动仍走既有入口。

## 5. 指令编写规范

### 5.1 六段式结构

Agent 的指令不是一段自由散文，而是有明确结构的「工作合同」。推荐并且在内置模板中强制使用六段式：

| 段落 | 要回答的问题 | 写作要求 | 缺失的后果 |
| --- | --- | --- | --- |
| 职责 Responsibilities | 这个 Agent 负责什么 | 用动词开头，列出 3–6 项可验证职责 | Agent 容易越界或遗漏核心工作 |
| 边界 Boundaries | 哪些文件、模块、动作不归它管 | 明确路径、模块与技术栈边界 | 跨模块修改，评审成本上升 |
| 检查 Checks | 完成前必须运行哪些验证 | 给出可执行命令与通过标准 | 交付物无法自证质量 |
| 汇报 Reporting | 结束时如何汇报 | 固定字段：变更摘要、验证结果、未完成项、风险、下一步 | 人工评审需要重新翻日志 |
| 禁止动作 Forbidden | 哪些动作绝对不允许 | 明确禁止推送、合并、部署、删除数据、读取密钥等 | 高风险动作被误执行 |
| 人工确认点 Human confirmation | 何时必须停下来问人 | 列出触发条件：新增依赖、改契约、改权限、跨角色文件 | Agent 自行做高风险决策 |

指令中的示例：

```markdown
## 职责
- 按 Task 的交付物契约实现前端页面与交互。
- 补齐组件测试，并在汇报中给出构建与测试结果。

## 边界
- 只修改 apps/web/、packages/ui/、packages/shared/。
- 不修改 internal/、数据库迁移与部署配置。

## 检查
- 运行 pnpm --filter web build、pnpm --filter web test、pnpm --filter web lint。
- 任一步失败时先修复；无法修复时在汇报中说明失败命令与错误摘要。

## 汇报
- 变更摘要：按文件列出改动目的。
- 验证结果：命令、结果、失败原因。
- 未完成项与风险：明确说明阻塞点与建议。

## 禁止动作
- 不推送、不合并、不部署。
- 不读取或写入任何密钥与凭据。
- 不修改允许路径之外的任何文件。

## 人工确认点
- 需要新增依赖时暂停并请求确认。
- 需要修改共享 API 类型或跨角色契约时暂停并请求确认。
```

### 5.2 角色指令差异

- **UI Design**：强调产出结构与约束，而不是直接改业务代码；检查项以文档完整性与截图证据为主；人工确认点是「是否引入新设计 token 或新组件」。
- **Frontend**：检查项必须包含构建、类型检查与测试；边界必须列出可写的包；人工确认点是「新增依赖、修改共享类型、跨包重构」。
- **Backend**：检查项必须包含单元测试与静态检查；涉及迁移时必须说明回滚方案；人工确认点是「修改 API 契约、修改数据模型、删除数据」。
- **DevOps**：检查项必须包含配置语法检查与 staging 验证；边界必须明确生产凭据不可用；人工确认点是「任何写操作、任何部署动作、任何生产相关配置」。

### 5.3 反模式

以下写法应在模板评审与技能导入时被提示：

- **万能型指令**：「你是一个资深全栈工程师，尽量把任务做好」——没有边界，没有检查，没有汇报格式。
- **自由聊天型指令**：「与其他 Agent 讨论后决定方案」——违反契约式协作原则。
- **权限扩张型指令**：「如果必要可以修改任何文件」——与允许路径冲突。
- **跳过验证型指令**：「时间紧就不用跑测试」——破坏证据化 DoD。
- **密钥内联**：把 API Key、Token、私有地址直接写进指令；这类内容禁止保存与导出。
- **超长背景**：把整份项目文档粘进指令，导致提示词预算被背景耗尽；应改用技能或 Task 上下文。
- **模糊汇报**：「完成后告诉我」——无法形成可审计的 Run 摘要。

### 5.4 提示词组装与优先级

M0 的实际组装顺序由 `scheduler.buildPrompt` 决定：任务元信息与描述 → Agent 指令 → 六条通用规则。它没有显式的层级隔离，也没有把任务描述标记为不可信内容。

M1 起，提示词按以下优先级组装，后者不得覆盖前者的禁止性约束：

1. **平台策略**（不可覆盖）：Run 工作区边界、人工审批、禁止泄露密钥、禁止越权。
2. **Agent 指令**（绑定快照中的版本）：职责、边界、检查、汇报、禁止动作、人工确认点。
3. **交付物契约**（M2）：上游要求、验收标准、必须提交的证据。
4. **技能内容**（M2）：按绑定顺序拼接，带技能名与版本标记。
5. **Task 上下文**：标题、描述、评论、附件摘要；必须用明确分隔标记为「不可信数据」。
6. **Run 工作区上下文**：分支、工作目录、变更文件、可用命令。

其中第 5 层是提示词注入的主要风险面：任务描述可能包含「忽略之前的指令」之类的内容。平台必须声明任务内容只能作为需求数据，不能授予权限、不能改变审批规则；Runtime 侧的权限执行不依赖模型是否遵守指令。

## 6. 技能（Skill）

### 6.1 定义与 SKILL.md 格式

技能是可复用的操作知识包，回答「这类工作具体怎么做」。它与 Agent 指令的区别是：Agent 指令定义职责与边界，技能定义可复用的步骤、检查清单与常见反例。一个 Agent 可以绑定多个技能，一个技能可以被多个 Agent 复用。

M2 的技能以本地目录中的 `SKILL.md` 为唯一事实来源，格式如下：

```markdown
---
name: frontend-form-patterns
version: 1.0.0
description: 表单校验、错误提示与可访问性检查流程
compatibleRuntimes:
  - claude
  - codex
requiredCommands:
  - pnpm --filter web test
---

## 适用场景
- 新增或修改表单字段、校验规则、错误提示。

## 步骤
1. 先阅读现有表单组件与校验工具，复用已有模式。
2. 为每个字段定义校验规则与错误文案。
3. 补充组件测试，覆盖空值、非法值与边界值。

## 检查清单
- 所有输入都有可访问的 label。
- 错误提示与字段通过 aria 属性关联。
- 测试覆盖成功与失败路径。

## 反例
- 在组件内硬编码与设计系统冲突的颜色或间距。
```

字段要求：

- `name`：小写字母、数字与连字符，同一产品级 Workspace 内唯一。
- `version`：语义化版本；同一版本内容不可变。
- `description`：一句话说明用途。
- `compatibleRuntimes`：声明可用 Runtime；不兼容时绑定给出警告，Run 时阻止。
- `requiredCommands`：技能需要的命令；必须是 Agent 允许命令的子集，否则绑定失败。

### 6.2 绑定、版本与导入

- **绑定**：Agent 保存时写入技能名与版本的有序列表；顺序影响提示词拼接。默认按添加顺序，允许上移/下移。
- **版本**：技能的每个版本有独立内容与哈希；编辑技能必须创建新版本，不能就地修改已发布版本。Run 创建时解析并锁定版本，写入 RunConfigSnapshot 或 AgentVersion 快照。
- **导入**：M2 仅支持从本地目录导入。导入流程为：读取 SKILL.md → 解析 frontmatter → 校验字段与路径 → 计算哈希 → 写入技能库 → 展示权限与命令摘要要求确认。导入过程不执行技能中的任何脚本。
- **存储**：技能库位于用户数据目录下的 `skills/{name}/{version}/SKILL.md`，元数据入库；导出时不包含用户私有文件。
- **启停**：绑定可以单独启用或停用；停用只影响后续 Run 的提示词组装与技能校验，不影响历史 Run 的提示词与证据（AC-AGENT-07）。启停是绑定级状态，保存在 `agent_skills.enabled`；api-and-data 的 M2 详细表已定义该列。
- **解绑**：允许随时解除绑定；解绑只影响后续 Run；若仍有排队的 Run，排队 Run 使用创建时的快照，不因解绑而改变。
- **删除保护**：被任一 Agent 绑定或被任一 Run 快照引用的技能版本不能直接硬删除；必须先解除所有绑定，或先归档相关 Agent，删除请求返回 409 并列出引用方。
- **归档技能**：归档后不允许新增绑定，但已有绑定继续可用；历史 Run 与快照不受影响。这与 `02-domain-model.md` 的 Skill 生命周期一致。

### 6.3 冲突、预算与安全

- **同名冲突**：同名技能不同来源时，以「名称 + 来源标识」区分；不允许两个不同来源的同名技能同时绑定到同一 Agent。
- **内容冲突**：两个技能给出相反步骤时，保存阶段提示冲突段落；由用户决定顺序或拆分技能。产品不自动做语义合并。
- **提示词预算**：绑定总长度超过预算（M2 建议 8K token 估算值）时给出警告；超过硬上限（M2 建议 16K）时阻止保存，并提示拆分技能。
- **权限不扩张**：技能不能声明或修改 Agent 的允许路径与允许命令；技能声明的命令必须是 Agent 允许命令的子集。
- **敏感信息**：技能导入时扫描常见密钥模式；命中时拒绝导入并指出位置。技能导出默认移除本地绝对路径与用户数据。
- **来源可信**：M2 只支持本地导入，不自动从网络拉取技能；M4 的市场导入必须展示来源、版本、权限与哈希。

### 6.4 M0 现状与迁移

M0 没有技能实体。用户只能在 `instructions` 中写「先阅读某某文档、按某某步骤执行」，没有结构、没有版本、无法复用、无法校验。M2 引入技能后，允许把现有指令中的步骤性内容迁移为技能，但必须保留原 Agent 的版本快照，避免历史 Run 失去可解释性。迁移是手动行为，不做自动文本切分。

## 7. 版本、克隆与模板

### 7.1 版本与快照

- M0 没有版本字段；保存即覆盖。这使「上周的 Run 用了什么配置」不可回答。
- M1 采用**双轨快照**：`agent_versions` 保存 Agent 级的不可变版本行（每次改变执行语义的编辑生成 `version_number` 单调递增的新行），`run_config_snapshots` 保存 Run 级的不可变执行快照（创建时写入，含完整配置 JSON、配置哈希、提示词哈希、Runtime 版本、生效权限模式、权限信封与当时的 `revision`，并引用 `agent_version_id`）。两者职责不同：前者回答「Agent 历史上长什么样」，后者回答「这一次 Run 实际用了什么」。M1-local-loop 与 `02-domain-model.md` §14 均要求 M1 创建两张表；执行期只读快照，不得在 Run 结束后补写（RUN-012、AC-AGENT-08）。
- M2 起在 `agent_versions` 之上增加版本管理体验：版本对比、`changeNote`、`currentVersionId` 作为默认执行版本；版本行本身在 M1 已存在。
- 版本只增不减；不支持删除版本。归档 Agent 时保留全部版本；硬删除只允许在无 Run 引用或显式清理时发生。
- 版本对比（M2）：展示配置差异，重点高亮 role、Runtime、模型、权限模式、超时、并发、路径、命令、技能与指令的变化。

### 7.2 克隆（M2）

克隆用于试验与复用，不用于复制历史。规则：

- 新 Agent 的 id、workspaceId、创建时间、更新时间均为新值；名称在原名称后加「 (copy)」，冲突时追加序号。
- 复制全部配置字段、权限信封与技能绑定；版本从 `versionNumber=1` 开始并生成一条初始 AgentVersion 记录。
- 不复制 Run、证据、统计与归档状态。
- 克隆后的 Agent 与原 Agent 完全独立；后续修改互不影响。
- 克隆操作写入事件与审计（M3），便于追踪模板扩散。

### 7.3 内置模板（M2）

内置模板是随应用发布的、不可就地编辑的 Agent 预设。模板本身有 `roleTemplateId`（旧名 `templateKey`）、名称、描述、版本、指令正文、默认配置、默认技能与权限摘要。实例化时：

1. 用户选择模板。
2. 系统展示职责、默认 Runtime、路径与命令权限、技能与限制。
3. 用户填写模板变量；变量只能来自模板声明的 `templateVariables` schema，schema 随模板版本发布，字段为 `name`、`type`、`required`、`source`、`default`、`validation`。变量来源只允许两类：产品级 Workspace 配置中的受控字段，或用户在实例化表单中显式输入且通过校验的值；不允许模板读取任意本机路径、环境变量或凭据。
4. 系统创建可编辑的 Agent，记录 `roleTemplateId`、`roleTemplateVersion` 与 `templateSnapshot`；模板本身的修改只随应用升级发生。
5. 模板升级不自动改写已实例化的 Agent；用户在版本对比中看到可用升级并自行合并。

M2 内置模板变量 schema（`templateSchemaVersion: 1`）至少包含：

| 变量 | 类型 | 必填 | 来源 | 默认值 | 校验规则 |
| --- | --- | --- | --- | --- | --- |
| `frontendDir` | path | 是 | Workspace 配置 | `apps/web` | 仓库相对路径；必须存在且为目录；禁止绝对路径与 `..` |
| `backendDir` | path | 是 | Workspace 配置 | `internal` | 同上 |
| `sharedUiDir` | path | 否 | Workspace 配置 | `packages/ui` | 同上；目录不存在时实例化仅警告 |
| `designDir` | path | 否 | Workspace 配置 | `design/` | 同上 |
| `migrationsDir` | path | 否 | Workspace 配置 | 空 | 必须在仓库内；为空时 Backend 模板的迁移检查项跳过并提示 |
| `buildCommand` | command | 否 | Workspace 配置 | `pnpm build` | 必须是 argv 形式；必须通过允许命令校验 |
| `testCommand` | command | 是 | Workspace 配置（`verifyCommand`） | `pnpm test` | 同上；必须是允许命令的子集 |
| `typecheckCommand` | command | 否 | Workspace 配置 | `pnpm typecheck` | 同上 |
| `deployDir` | path | 否 | Workspace 配置 | `scripts/deploy/` | 仓库相对路径；禁止指向生产配置目录 |
| `stagingCommand` | command | 否 | 用户显式输入 | 空 | 只允许 DevOps 模板使用；必须标注为 staging，且不得包含生产凭据或 prod 目标 |

变量解析失败、必填变量缺失或类型不匹配时，实例化必须失败并列出具体变量与期望来源；不允许用空字符串静默替代（AGENT-045）。

内置模板的最低内容要求：六段式指令齐全、默认允许路径与命令非空（General 除外）、至少绑定一个检查型技能（M2 后）、明确人工确认点。

### 7.4 模板市场（M4）

M4 提供模板包的导出、导入与市场浏览。模板包是本产品自有的开放格式，包含：

- manifest：名称、版本、作者、兼容的应用版本、所需 Runtime、权限摘要、包含的技能及版本、内容哈希。
- Agent 配置：指令、默认运行参数、路径与命令。
- 技能文件：随包携带或声明依赖。
- 签名（可选但推荐）：作者签名与校验方式。

导入规则：

- 导入前必须展示权限差异与技能列表，用户确认后才落库。
- 包中包含密钥、绝对路径、越界命令或未声明依赖时拒绝导入。
- 导入的 Agent 默认不可运行，必须由用户确认 Runtime 与权限后才能启动 Run。
- 市场只做分发与展示，不在应用内自动执行模板脚本。

### 7.5 与 Run 的复现关系

一次 Run 可复现的最小条件：Agent 配置快照（M2 起为 AgentVersion）+ 技能版本集合 + Runtime 标识与版本 + 模型标识 + Workspace 基准提交 + 提示词哈希 + 生效权限模式。M1 记录 RunConfigSnapshot（完整配置 JSON、配置哈希、提示词哈希、Runtime 版本、权限模式与权限信封）；M2 增加 AgentVersion 与技能版本；M3 增加机器与 Runner 信息；M4 增加模板来源。任何缺失都会降低审计可信度，因此这些字段是 Run 证据的一部分，而不是可选的调试信息。

## 8. 运行设置：并发、超时、排队、工作时间

### 8.1 并发

- `maxConcurrency` 定义同一 Agent 同时处于运行态的最大 Run 数。默认 1，上限 16。
- 全局并发由应用配置的 worker 数约束（M0 默认 2）。Agent 并发不能突破全局上限；实际并行数为两者较小值。
- M0 仅存储该字段，不参与调度。M1 只落实全局并发与排队；M2 的调度器在准入时计算「该 Agent 活跃 Run 数」，达到上限则进入队列（AGENT-017/018 为 M2）。`runtime-and-workspace.md` 的 RUN-025 标注为 M1/M3，本章按验收口径解释为「M1 全局并发、M3 机器级并发」，Agent 级并发以 AC-AGENT-04/AC-RUN-07 的 M2 为准；该口径需在 runtime 文档与验收计划中统一措辞。
- 启动资格必须拆成两类：**阻断条件**（Agent 已归档、Runtime 不可用、权限配置非法、技能版本缺失）直接阻止启动；**排队条件**（并发已满）允许创建 Run 并进入 queued。AGENT-049 只检查阻断条件，不把「并发有空位」作为必须通过的条件。
- 并发统计只计算 `preparing`、`running` 状态；排队不计入。取消与失败立即释放名额。
- 并发限制是资源保护，不是权限边界；不应被用来表达优先级。

### 8.2 超时

- `timeoutMinutes` 定义单次 Run 的 Runtime 执行超时，默认 60，范围 1–1440。
- M0 的现状必须分两部分理解。**超时**：Run 进入 `running` 后创建 context 超时，仅覆盖 Runtime 调用；排队与准备时间不计入；超时后适配器返回 `context.DeadlineExceeded`，`scheduler.execute` 把它写入 `failed`，但 `runs` 没有 `errorCode` 字段，也没有 `run.timeout` 事件，UI 只能看到笼统的失败。**取消**：`handlers.cancelRun` 会立即把 Run 写成 `cancelled`，而调度器随后仍可能把状态回写为 `preparing`、`running`、`completed` 或 `failed`；`runtime-and-workspace.md` §11.5 已把这一回写竞态列为 M0 已知缺陷。因此 M0 并非「取消与超时完全没有区分」，真正的缺口是超时缺少结构化失败分类与事件、取消缺少终态守卫。
- M1 的目标行为：超时产生 `run.timeout` 事件，Run 以 **`failed`** 结束并写入 `errorCode=timeout`（`failureDetail=timeout`），记录超时阈值与实际耗时；保留部分日志与证据；界面展示「超时」而不是笼统的失败；超时时间从 `running` 开始计算，排队与准备时间单独统计。**不得把超时标记为 `cancelled` 或 `completed`**；这与 `runtime-and-workspace.md` 的 US-RUN-07/RUN-005、`M1-local-loop.md` 的 RUN-006 与 `04-acceptance-and-test-plan.md` 的 AC-RUN-05 一致。术语说明：`M1-local-loop.md` 使用 `failureCode`，`02-domain-model.md` 与 `runtime-and-workspace.md` 使用 `errorCode` + `failureDetail`；本章与验收计划统一使用 `errorCode=timeout`，里程碑文档应回写术语。
- 取消与超时必须走不同的状态路径：取消由用户发起，经调度器确认实际停止后写 `cancelled`；超时由系统计时触发，写 `failed` + `errorCode=timeout`。所有终态写入必须带前置状态校验（RUN-004/RUN-005），取消后不得被调度器回写为其他状态。
- 超时不会自动重试；重试是用户的显式动作，并生成新的 Run。
- 超时时间的修改只影响之后创建的 Run；已创建或排队的 Run 使用创建时的快照。

### 8.3 排队与优先级

- M0 使用内存队列，容量 256；入队最多等待 5 秒，队列满时仅记录警告，Run 停留在 `queued`，没有用户可见的失败原因；应用重启后队列丢失，`queued` 与 `running` 的 Run 不会自动恢复。
- M1 的目标：启动时恢复队列状态，未开始的 Run 重新入队，失去执行进程的 `running` Run 标记为失败并记录恢复事件。
- M2 的目标：持久化队列、容量上限与背压、按 Task 优先级排序、按 Agent 并发与全局并发双重准入、队列位置与预计等待时间可见。
- 优先级来源是 Task 的 priority 字段；同优先级按创建时间先进先出。用户不能通过修改 Agent 配置绕过队列。
- 队列中的 Run 可以被取消；取消后释放排队名额，不产生执行日志。

### 8.4 工作时间（可选）

工作时间窗口是可选功能，计划在 M4 与自动化一起提供。规则建议：

- 按本地机器时区解释；支持跨午夜窗口（例如 22:00–06:00）。
- 只影响队列准入：窗口外不启动新 Run，但不会终止运行中的 Run。
- 窗口内积压的 Run 在窗口开启后按优先级与创建时间依次启动。
- 团队模式下由团队配置统一时区，避免成员机器时区不一致。
- 工作时间不是权限控制；用户始终可以手动启动 Run（可在设置中关闭该例外）。

### 8.5 设置快照与生效边界

Agent 的运行设置必须在 **Run 创建（进入 queued）时** 快照，而不是执行开始或结束时。这样排队期间修改 Agent 不会改变已排队 Run 的提示词、权限与超时（AC-AGENT-08）。执行路径只读取快照，不读取 Agent 当前配置；Run 结束后也不得补写快照（RUN-012）。

M1 的 RunConfigSnapshot 至少包含：Agent id 与 revision、workspaceId、完整配置 JSON（instructions、runtime、model、workspaceMode、maxConcurrency、timeoutMinutes、allowedPaths、allowedCommands）、Runtime 权限模式、权限信封（环境变量白名单、凭据引用、网络访问意图）、技能版本集合（M2 起非空）、Runtime 版本、配置哈希、提示词哈希、创建时间。Run 详情展示快照，而不是实时读取 Agent 当前配置，否则历史记录会随编辑漂移。

必须有一条端到端验收：创建 Run（进入 queued）→ 修改 Agent 的 instructions、allowedPaths、timeoutMinutes 与权限模式 → 让 Run 开始执行 → 断言 Run 使用修改前的快照，且 Agent 的新配置只影响之后创建的 Run。

## 9. 权限、可见性与生命周期

### 9.1 本地模式的信任模型

M0–M2 是本地单用户模式：应用默认监听 `127.0.0.1`，本机用户即管理员，没有登录、角色与多租户隔离。Agent 的允许路径与允许命令是「安全护栏」，用于降低 Agent 误操作的概率，而不是防御恶意本机用户。产品文案不得把 M2 的路径限制宣传为强沙箱。

同时必须诚实说明执行侧的边界：Runtime 是外部 CLI，ATeam 不能保证拦截它执行的每一个系统调用；M2 的权限执行采用多层防线：Runtime 自身的权限参数、启动前的 Run 工作区校验、运行中的命令拦截（仅在适配器声明支持时）、运行后的变更文件审计。能力矩阵与降级规则见 14.2：支持实时拦截的 Runtime 必须拒绝越界动作；不支持的 Runtime 只能在运行后标记并使 Run 进入人工复核。任何情况下都不得把「配置了允许路径」宣传为操作系统级沙箱。

### 9.2 团队模式（M3）

M3 引入登录、团队、角色与共享 Agent：

- 角色：管理员、维护者、成员、只读访客。管理员可管理团队 Agent 与权限；维护者可编辑被授权的共享 Agent；成员可使用共享 Agent 并管理自己的私有 Agent；只读访客只能查看。
- 可见性：`private`（仅创建者）、`team`（团队成员可见，默认只读）。不支持「公开到互联网」的 Agent；模板包导出属于 M4 的独立能力。
- 所有权：Agent 有 owner；团队 Agent 有 teamId。所有权转移必须由管理员执行并写入审计。
- 编辑冲突：团队模式必须使用 `revision` 做乐观并发控制；保存时 revision 不匹配返回 409，要求刷新后合并。
- 机器与 Runner 权限与 Agent 权限分离：可见某个 Agent 不代表可以在任意 Runner 上执行；执行位置由 M3 的 Runner 授权决定。

### 9.3 删除与归档

- M0：`DELETE /api/agents/{id}` 为硬删除，不检查关联 Run。删除后历史 Run 的 `agentId` 悬空，无法从 Run 跳回 Agent，也无法还原配置。
- M1 起提供归档：`DELETE` 为确认 + 阻止 + 归档，存在活跃 Run 或未关闭 Review 时返回 409；归档 Agent 不出现在新建 Run 的候选列表，但历史 Run、版本与证据完整保留。M2.1 起提供 30 天恢复窗口；引用检查与归档语义按 17 节裁决执行。
- 删除只允许在「无任何 Run 引用」或用户显式执行「清除配置并保留 Run 快照」时发生。后者需要输入 Agent 名称确认，且保留版本快照的只读副本。
- **活跃 Run 的定义是 `preparing` 或 `running`**。存在活跃 Run 时禁止删除或归档，返回 409 并提示先取消或等待结束。`queued` 的 Run 不算活跃：归档时由系统取消这些 Run，记录取消原因 `agent_archived`，并提示用户；这一语义与 AGENT-055 一致。
- 删除技能、模板、Agent 之间的引用必须先解除绑定；系统不得产生悬空引用。

### 9.4 高风险动作与人工审批

以下动作无论 Agent 指令怎么写，都必须人工审批或由人工执行：

| 动作 | M0 行为 | M1 目标 | M2 目标 | M3 目标 |
| --- | --- | --- | --- | --- |
| 写 Run 工作区文件 | 提示词约束 | worktree 内允许 | 受允许路径约束 | 受路径与 Runner 策略约束 |
| 运行构建与测试 | 提示词约束 | 允许 | 受允许命令约束 | 受 Runner 策略约束 |
| 创建提交 | 不强制 | 允许在 Run 分支 | 允许 | 允许并审计 |
| 推送分支 | 提示词禁止 | 不适用（M1 不实现 push） | 人工审批 | 人工审批 + 权限 |
| 合并 | 提示词禁止 | 人工执行 | 人工审批门 | 人工审批门 + 审计 |
| 部署 staging | 提示词禁止 | 不适用 | Agent 可产出计划，执行需审批 | 审批 + Runner 策略 |
| 部署生产 | 提示词禁止 | 人工执行 | 人工执行，Agent 只产出计划 | 人工执行 |
| 删除分支/Run 工作区/Agent | 无保护 | 人工确认 | 人工确认 + 引用检查 | 人工确认 + 审计 |
| 读取密钥 | 提示词禁止 | 不注入密钥 | 不注入密钥 + 扫描 | 密钥由 Runner 托管 |

「删除」在本表中指删除分支、产品 Workspace、Agent、技能、数据等资源；Run 工作区内的普通代码文件增删属于开发行为，受允许路径与评审约束，不逐次审批。

#### 9.4.1 生产动作的识别与硬拦截（M2）

AGENT-061 要可测试，必须先定义「生产动作」。M2 采用以下口径：

- **环境分类**：Workspace 配置把执行目标分为 `dev`、`staging`、`prod`。Agent 的 `networkAccess` 与 `credentialRefs` 只能指向 `dev` 或 `staging` 范围；`prod` 目标没有任何 Agent 可用的凭据与命令路径。
- **生产部署命令**：任何显式指向 prod 的部署、发布、回滚、扩缩容与迁移命令，例如 `deploy --env prod`、`kubectl --context prod ...`、`helm upgrade --namespace prod ...`、`terraform apply -var environment=prod`、`serverless deploy --stage prod`、针对生产数据库的迁移命令。判定依据是 argv 中的环境/上下文/命名空间/workspace 参数与 Workspace 的环境定义，而不是自然语言指令。
- **生产凭据**：生产云账号、生产 API Key、生产数据库口令与生产证书。它们不得出现在 `credentialRefs`、环境变量白名单、Agent 指令或技能中；凭据存储按环境分区，调度器在启动前拒绝引用 prod 范围的凭据。
- **生产配置路径**：`infra/prod/**`、`deploy/prod/**`、`.env.production` 等由 Workspace 标记为 prod 的路径。Agent 默认不可写，且 `allowedPaths` 中的任何条目都不得命中 prod 路径；命中时保存阶段返回 400。
- **生产数据与网络**：生产数据库连接、生产 DNS/证书变更、生产 feature flag 写入。它们既不在允许命令内，也不在允许路径内，不能通过通用 shell 或包装脚本绕过。

**识别与拦截规则**：

1. 保存 Agent 时，`allowedCommands`、`allowedPaths`、`credentialRefs` 与 `networkAccess` 先做静态校验，命中 prod 范围直接拒绝。
2. Run 启动前再次校验权限信封；启动后对每次工具调用/命令按 argv 与目标路径匹配，默认不经过 shell，包装脚本本身也必须在白名单内。
3. 任何生产动作命中都写 `permission_denied` 事件，`failureDetail=prod_action_denied`，并记录命令、参数、目标环境与来源；Run 按策略进入 `failed` 或继续，但动作本身必须被阻止。
4. **生产动作没有「审批后由 Agent 执行」的路径**。审批门只覆盖 staging 与合并等允许动作；生产部署由人工在 ATeam 之外执行，Agent 只能产出计划、检查清单与回滚说明。
5. 负向验收至少覆盖：`deploy --env prod`、`kubectl --context prod apply`、读取 prod 配置路径、通过 `bash -c` 或脚本包装执行 prod 命令；全部必须被拒绝并产生事件，且不得产生任何生产副作用。

staging 审批的绑定对象是：`run_id` + 动作类型 + 目标环境 `staging` + 计划 Artifact 哈希 + 有效期。审批只对该 Run 的该计划有效，不可复用到其他 Run 或其他环境；计划内容变化后必须重新审批。

### 9.5 敏感信息

- 模型 API Key 与 Runtime 凭据永远不存入 Agent 记录；由 Runtime 环境或应用凭据存储管理。
- Agent 指令、技能与模板在保存和导出时扫描常见密钥模式；命中时阻止保存并要求移除。
- Agent 导出包默认移除本地绝对路径、用户名、主机名与运行日志。
- 团队模式下，包含敏感信息的 Agent 可见性默认 `private`，共享前必须通过扫描。

## 10. 功能需求

状态说明：**已实现（M0）** 表示当前代码可验证；**部分实现（M0）** 表示有字段或基础行为但语义不完整；**计划（Mx）** 表示尚未实现。每条需求均应可通过 API、UI 或行为测试验证。

编号约定：本章的 `AGENT-xxx` 是模块级 FR 编号，`prd/04-acceptance-and-test-plan.md` 与 `prd/milestones/M2-role-agents.md` 按此编号引用。`prd/milestones/M1-local-loop.md` 中的 `AGENT-001` 至 `AGENT-004` 是**里程碑本地需求**，与本章同名编号含义不同；引用时应写作 `M1-AGENT-001` 等前缀。两套编号的对应关系见 §18.4；建议里程碑文档回写时统一加 `M1-` 前缀，避免验收引用歧义。

### 10.1 Agent 基础管理

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-001 | 创建 Agent 时名称去除首尾空白后不得为空；为空或纯空白返回 400 且不落库 | P0 | 已实现（M0） | M0 |
| AGENT-002 | 列表接口返回全部 Agent，按创建时间倒序；M1 起默认排除已归档，除非显式传 `status=archived`；空列表返回空数组而不是 null | P1 | 已实现（M0） | M0 |
| AGENT-003 | 读取不存在的 Agent 返回 404 与 `{"error": "..."}`；不得返回空对象 | P0 | 已实现（M0） | M0 |
| AGENT-004 | PATCH 只更新请求中出现的字段；未出现的字段保持原值；成功后刷新 updatedAt | P0 | 已实现（M0） | M0 |
| AGENT-005 | PATCH 名称传空字符串或纯空白返回 400，且不产生部分更新 | P0 | 已实现（M0） | M0 |
| AGENT-006 | 删除存在的 Agent 返回 204；删除不存在返回 404；当前实现为硬删除 | P1 | 已实现（M0） | M0 |
| AGENT-007 | 创建时应用默认值：Runtime 为 mock、WorkspaceMode 为 worktree、MaxConcurrency 为 1、TimeoutMinutes 为 60；空数组字段写为空数组 | P1 | 已实现（M0） | M0 |
| AGENT-008 | 创建、更新、删除成功后分别广播 agent.created、agent.updated、agent.deleted；事件 payload 含 Agent 或 id | P2 | 已实现（M0） | M0 |
| AGENT-009 | 名称长度 1–80、同一产品级 Workspace 内活跃 Agent 不区分大小写唯一；重复返回 409 并指出冲突名称；归档后名称可复用 | P1 | 计划 | M1 |
| AGENT-010 | 保存时携带 `revision`；与当前值不匹配返回 409，响应包含当前 revision 与最近修改时间 | P2 | 计划 | M1 |

### 10.2 配置校验与执行语义

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-011 | Runtime 必须属于已注册适配器集合（当前 mock、claude）；非法值返回 400；运行时不静默回退 mock | P0 | 部分实现（M0，未知值回退 mock） | M1 |
| AGENT-012 | 非空 Model 在 Run 时传给 Runtime 适配器；适配器不支持的模型返回可读错误并结束 Run | P1 | 计划 | M1 |
| AGENT-013 | WorkspaceMode 只接受 worktree；非法值返回 400；worktree 模式实际创建隔离工作树并由 Run 记录；M2 增加 directory 且必须显式确认 | P0 | 计划 | M1 |
| AGENT-014 | TimeoutMinutes 创建或更新时必须在 1–1440；越界返回 400；0 不能关闭超时 | P1 | 部分实现（M0 无校验） | M1 |
| AGENT-015 | 超时后 Run 写入 `errorCode=timeout` 与 `failureDetail=timeout`，并产生 `run.timeout` 事件（含阈值与实际耗时）；Run 状态为 `failed`，不得为 `cancelled` 或 `completed`；部分日志保留 | P1 | 部分实现（M0 有超时无分类） | M1 |
| AGENT-016 | MaxConcurrency 创建或更新时必须在 1–16；越界返回 400 | P1 | 计划 | M1 |
| AGENT-017 | 调度器保证同一 Agent 活跃 Run 数不超过 MaxConcurrency；超出的 Run 进入队列并展示位置 | P0 | 计划 | M2 |
| AGENT-018 | 队列持久化；队列满返回可读错误或阻塞准入并展示原因，不允许 Run 无提示地永久停留在 queued | P1 | 计划 | M2 |
| AGENT-019 | AllowedPaths 保存时规范化为仓库相对 POSIX 前缀；拒绝绝对路径、`..`、空项；非法返回 400；空数组按 AGENT-023 的拒绝语义处理 | P1 | 计划 | M1 |
| AGENT-020 | AllowedCommands 保存时拒绝 shell 元字符与超长条目；非法返回 400；空数组按 AGENT-023 的拒绝语义处理 | P1 | 计划 | M1 |
| AGENT-021 | 对声明支持路径策略的 Runtime：启动前与运行中拒绝越界写入并产生事件；对不支持实时拦截的 Runtime：Run 结束后按变更清单审计，越界变更使 Run 进入人工复核。两种路径都必须有测试，不得承诺所有 Runtime 都能实时拦截 | P0 | 计划 | M2 |
| AGENT-022 | 对声明支持命令策略的 Runtime：拒绝允许命令之外的命令并产生事件；对不支持的 Runtime：记录命令日志并事后标记，Run 进入人工复核。拒绝/标记事件进入 Run 事件流与证据 | P0 | 计划 | M2 |
| AGENT-023 | **空 AllowedPaths 表示不可写任何路径；空 AllowedCommands 表示不额外授权任何命令**。该语义必须在 API、UI 与文档中一致说明；不得解释为整个工作区或继承 Runtime 默认策略 | P1 | 计划 | M2 |
| AGENT-062 | Agent 支持 `permissionMode`：`read_only`、`controlled_edit`、`full_access`；默认 `controlled_edit`；`full_access` 必须显式开启并显示风险警示；生效模式写入 Run 事件与 RunConfigSnapshot | P0 | 计划 | M1 |
| AGENT-063 | Agent 的 `workspaceId` 必填并引用存在的产品级 Workspace；创建的 Run 必须同 Workspace；跨 Workspace 使用返回 409；名称唯一性按 Workspace 隔离 | P0 | 计划 | M1 |
| AGENT-064 | Agent 支持 `role` 枚举（general/ui_design/frontend/backend/devops/custom）；非法值返回 400；旧数据迁移默认 `general`；role 用于依赖校验与默认门禁，不直接改变权限信封 | P0 | 计划 | M2 |
| AGENT-069 | Runtime adapter 必须声明能力矩阵：权限模式传递、路径策略、命令策略、优雅取消、流式事件、会话恢复；UI 显示隔离等级；能力不支持时不得静默声称已拦截 | P0 | 计划 | M2 |
| AGENT-072 | 负向验收：`allowedPaths` 为空时，Agent 尝试写入任意路径必须被拒绝或标记为越界并进入人工复核；不得出现默认允许的路径 | P1 | 计划 | M2 |
| AGENT-073 | 权限信封字段 `envAllowlist`、`credentialRefs`、`networkAccess` 可保存、校验并写入 RunConfigSnapshot；明文密钥与 prod 范围引用被拒绝 | P0 | 计划 | M2 |
| AGENT-079 | Agent 的 `model` 只接受空值或所选 Runtime 模型目录中的 `id`；未知模型返回 `400 MODEL_NOT_AVAILABLE` 并列出可选模型 | P0 | 计划 | M2.1 |
| AGENT-080 | 切换 Runtime 时重新解析模型目录；原模型不在新目录中时拒绝保存并返回字段级错误，或由 UI 重置为默认后保存 | P0 | 计划 | M2.1 |
| AGENT-081 | Runtime 模型目录为空时只允许空模型（Runtime 默认）；UI 不得回退为自由文本输入，必须提供本地模型配置入口 | P1 | 计划 | M2.1 |
| AGENT-082 | 模型目录由 Runtime 探测、Claude 本地配置与 ATeam 本地配置合并去重；探测失败时返回可用性警告与 `modelsError`，不得把旧缓存当作实时结果；只有 `supported=true` 的 Runtime 可创建 Agent | P1 | 计划 | M2.1 |
| AGENT-083 | Agent 看板支持编辑与删除；编辑预填当前配置，保存走 PATCH 并重新校验 runtime/model；删除前二次确认，存在活跃 Run 时返回 409，删除后历史 Run 记录保留 | P0 | 计划 | M2.1 |
| AGENT-084 | 提供模型连通性测试：`POST /runtimes/{name}/test` 使用所选 Runtime/模型发送一次最小只读请求，返回 `ok`、`latencyMs`、`message` 或 `error`；不创建 Run/Artifact、不写仓库；失败是测试结果而非 5xx | P0 | 计划 | M2.1 |

### 10.3 指令与提示词

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-024 | Agent 指令写入提示词并传给 Runtime；Run 事件中可看到启动日志包含 Agent 名称与 Runtime 名称 | P0 | 已实现（M0） | M0 |
| AGENT-025 | 提示词按平台策略、Agent 指令、交付物契约、技能、任务上下文、Run 工作区上下文的顺序组装；M1 至少实现平台策略、Agent 指令、任务上下文与 Run 工作区上下文，M2 加入契约与技能；任务内容被标记为不可信数据，不能覆盖禁止性约束 | P0 | 计划 | M1 |
| AGENT-026 | 指令超过 64KB 拒绝保存；超过预算阈值时保存成功但提示 token 估算与拆分建议 | P2 | 计划 | M1 |
| AGENT-027 | 指令编辑器提供六段式骨架与各段说明；空指令保存时提示缺少职责与边界 | P2 | 计划 | M1 |
| AGENT-028 | 五个内置模板各自包含完整的六段式默认指令，实例化后指令可编辑 | P1 | 计划 | M2 |
| AGENT-029 | 保存、技能导入与模板导入时扫描密钥模式；命中则阻止并指出命中位置 | P1 | 计划 | M2 |
| AGENT-030 | Run 记录本次使用的 Agent 配置快照、配置哈希与提示词哈希；Run 详情可查看指令摘要 | P1 | 计划 | M1 |
| AGENT-031 | Run 详情展示本次提示词的各来源（Agent、技能、契约、任务）及版本标记 | P2 | 计划 | M2 |

### 10.4 技能

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-032 | 解析 SKILL.md 的 name、version、description、compatibleRuntimes、requiredCommands；缺失或非法字段导入失败并给出字段级错误 | P1 | 计划 | M2 |
| AGENT-033 | Agent 可绑定有序技能列表；绑定时校验技能存在、版本可解析、Runtime 兼容、命令为允许命令子集 | P1 | 计划 | M2 |
| AGENT-034 | 支持从本地目录导入技能；导入过程不执行任何脚本；导入后计算内容哈希 | P1 | 计划 | M2 |
| AGENT-035 | 已发布技能版本不可修改；编辑必须生成新版本；历史绑定保持原版本 | P1 | 计划 | M2 |
| AGENT-036 | 同一 Agent 不得绑定不同来源的同名技能；冲突时保存失败并指出冲突来源 | P2 | 计划 | M2 |
| AGENT-037 | 技能按绑定顺序确定性拼接；提示词预算超限时警告，超过硬上限时阻止保存 | P2 | 计划 | M2 |
| AGENT-038 | Run 创建时解析全部技能版本；任一缺失则阻止创建并列出缺失项 | P0 | 计划 | M2 |
| AGENT-039 | Run 证据记录每个技能的 name、version 与哈希；历史 Run 可追溯 | P1 | 计划 | M2 |
| AGENT-066 | 技能绑定支持启用与停用；停用只影响之后创建的 Run，不影响历史 Run 的提示词与证据（AC-AGENT-07） | P1 | 计划 | M2 |
| AGENT-067 | 支持解除技能绑定；删除仍被任何 Agent 绑定或被 Run 快照引用的技能版本返回 409 并列出引用方；解绑只影响后续 Run | P1 | 计划 | M2 |
| AGENT-068 | 归档技能后禁止新增绑定，已有绑定继续可用；历史 Run 与快照不受影响 | P1 | 计划 | M2 |

### 10.5 版本、克隆与模板

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-040 | 每次改变执行语义的成功保存生成不可变 AgentVersion，`versionNumber` 从 1 单调递增，Agent 的 `currentVersionId` 指向最新版本；版本记录含完整快照、contentHash、changeNote、修改人与时间 | P0 | 计划 | M2 |
| AGENT-041 | Run 创建时绑定配置快照（M1 为 RunConfigSnapshot，M2 起可关联 agentVersionId）；后续编辑不改变该 Run 的记录 | P0 | 计划 | M1 |
| AGENT-042 | 支持查看版本列表与两版本差异；差异覆盖配置、权限与技能；版本内容只读 | P2 | 计划 | M2 |
| AGENT-043 | 支持克隆 Agent；复制配置与技能绑定，versionNumber 重置为 1，名称为「原名称 (copy)」，不复制 Run 与统计 | P1 | 计划 | M2 |
| AGENT-044 | 内置模板可实例化为可编辑 Agent，记录 roleTemplateId、roleTemplateVersion、templateSnapshot 与 role；内置模板本身不可修改 | P1 | 计划 | M2 |
| AGENT-045 | 模板实例化只接受版本化 `templateVariables` schema 中的变量；缺失、类型不符或校验失败时阻止实例化并指出变量与期望来源 | P2 | 计划 | M2 |
| AGENT-046 | 支持导出 Agent 包（配置、技能依赖、manifest、哈希）；导出前扫描敏感信息 | P2 | 计划 | M4 |
| AGENT-047 | 导入 Agent 包前展示权限差异与技能清单；用户确认后落库；包含密钥、越界路径或未声明命令时拒绝导入 | P2 | 计划 | M4 |
| AGENT-071 | 模板 manifest 必须声明 `templateSchemaVersion` 与完整变量 schema（name/type/required/source/default/validation）；未声明或版本不支持的模板拒绝导入 | P2 | 计划 | M2 |

### 10.6 运行设置

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-048 | Run 创建（入队）时快照 Agent 设置；排队期间与执行期间修改 Agent 都不影响该 Run；Run 详情展示快照 | P0 | 计划 | M1 |
| AGENT-049 | 启动前检查阻断条件：Agent 未归档、Runtime 可用、权限配置合法、技能可解析（M2）、Task 可执行；失败时阻止启动并给出具体原因。并发已满不是阻断条件，而是进入队列（M2） | P0 | 计划 | M1 |
| AGENT-050 | 队列按 Task priority 排序；同优先级按创建时间先进先出；优先级修改影响尚未启动的 Run | P2 | 计划 | M2 |
| AGENT-051 | 工作时间窗口可选启用；按本地时区解释；支持跨午夜；只影响队列准入，不终止运行中的 Run | P2 | 计划 | M4 |
| AGENT-052 | 超时或取消后保留已产生的日志与证据；超时事件（failed + timeout）与手动取消事件（cancelled）必须可区分；取消后状态不被调度器回写覆盖 | P1 | 计划 | M1 |
| AGENT-053 | Runtime 健康检查可查询：CLI 是否存在、版本是否满足最低要求；Agent 列表对不可用 Runtime 显示阻塞提示 | P1 | 计划 | M1 |
| AGENT-065 | RunConfigSnapshot 至少持久化 config JSON、configHash、promptHash、runtimeVersion、permissionMode、permissionEnvelope、agentRevision 与 createdAt；执行期间只读，结束后不得补写 | P0 | 计划 | M1 |

### 10.7 权限与生命周期

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-054 | 默认提供归档；归档 Agent 不可用于新 Run，历史 Run 与版本可查；M2.1 起支持 30 天恢复 | P1 | 计划 | M1/M2.1 |
| AGENT-055 | 存在活跃 Run（preparing 或 running）或未关闭 Review 时归档或删除被拒绝并返回 409；queued 的 Run 在归档时由系统取消并记录原因 `agent_archived` | P1 | 计划 | M1 |
| AGENT-056 | 归档 Agent 不出现在启动 Run 的候选列表；直接调用 API 启动返回 409 并说明已归档 | P1 | 计划 | M1 |
| AGENT-057 | 恢复归档 Agent 后重新可选；版本与技能绑定保持归档前状态 | P2 | 计划 | M2.1 |
| AGENT-058 | 可见性支持 private 与 team；private 仅创建者可见；team 对团队成员可见且默认只读 | P1 | 计划 | M3 |
| AGENT-059 | 团队角色控制编辑、归档、删除、转移所有权；无权限操作返回 403 并记录审计 | P1 | 计划 | M3 |
| AGENT-060 | Agent 创建、编辑、归档、恢复、删除、权限拒绝写入审计日志，包含操作人、时间、版本与差异摘要 | P1 | 计划 | M3 |
| AGENT-061 | 生产动作按 9.4.1 的清单硬性禁止：prod 命令、prod 凭据、prod 配置路径与 prod 数据/网络写入均不可由 Agent 执行；命中时产生 `permission_denied`（`prod_action_denied`）事件且无副作用；staging 执行需要人工审批，审批绑定 Run、动作、目标环境与计划哈希 | P0 | 计划 | M2 |
| AGENT-070 | 负向验收覆盖 `deploy --env prod`、`kubectl --context prod apply`、prod 配置路径读取、`bash -c` 包装 prod 命令；全部被拒绝并产生事件；通过通用 shell 或技能脚本绕过同样被拦截 | P0 | 计划 | M2 |

### 10.8 Agent 工作状态与工作台（M2.4）

| 编号 | 需求（可测试） | 优先级 | 当前状态 | 里程碑 |
| --- | --- | --- | --- | --- |
| AGENT-074 | Agent 暴露派生 `workStatus`：idle/working/completed/failed；判定规则见 §4.6；`workStatus` 只读且不接受 PATCH | P0 | 计划 | M2.4 |
| AGENT-075 | `GET /agents/{id}/work` 返回 workStatus、判定依据、活跃 Run、最近 Run 与最近 20 条 Run 摘要；数据与 Run 列表一致 | P0 | 计划 | M2.4 |
| AGENT-076 | 工作页展示所选 Run 的 Task 上下文、AgentVersion/RunConfigSnapshot（含脱敏后的 instructions）、Workspace/base/head commit 与权限模式；不返回明文密钥与完整拼装 prompt | P0 | 计划 | M2.4 |
| AGENT-077 | 工作页展示所选 Run 的结构化时间线（生命周期、工具、文件变更、测试、Artifact、评审/合并），支持过滤与跳转 Run 详情 | P0 | 计划 | M2.4 |
| AGENT-078 | 归档 Agent 在看板显示「已归档」并覆盖工作状态；工作页保留历史只读；空闲 Agent 工作页显示空态 | P1 | 计划 | M2.4 |

## 11. 交互与规则

### 11.1 列表页

M0 的 Agents 页面包含标题「Agents」、说明「Reusable work profiles for tasks」、右上角「New agent」按钮、空态提示与卡片网格。卡片展示名称、描述、Runtime 徽标、指令前三行预览，以及 concurrency、timeout 与 workspaceMode 的文本。空态文案提示用户可以创建 UI design、frontend、backend 或 DevOps 角色 Agent。视觉与布局细节以 `prd/modules/ui-ux.md` §5.5 为准，本节只定义行为规则。

M2 起的列表增强如下；M1 不新增专用 Agent 管理页，仅保留 M0 列表与基础编辑入口（次要项）。

| 规则 | 关联 FR / UI | 里程碑 |
| --- | --- | --- |
| 搜索：按名称与描述过滤，大小写不敏感，输入即过滤 | UI-058 至 UI-060；无独立 FR | M2 |
| 筛选：按 Runtime、role、模板键、归档状态过滤；默认只显示活跃 Agent | AGENT-002、AGENT-064、AGENT-054 | M2 |
| 排序：最近更新、名称、最近使用、Run 成功率 | UI-072 | M2 |
| 卡片操作：编辑、克隆、归档、删除（按权限显示） | UI-061、UI-063、AGENT-043、AGENT-054 | M2 |
| 状态标记：Runtime 不可用、配置不完整、并发已满、已归档 | AGENT-053、AGENT-056 | M1 标记 Runtime 不可用；其余 M2 |
| 工作状态：卡片显示空闲、工作中、已完成、失败待处理；工作中显示当前任务与阶段，已完成显示完成时间 | AGENT-074、AGENT-075、UI-153 | M2.4 |
| 点击行为：点击卡片正文进入 `/agents/{id}/work` 工作页；编辑配置使用独立入口，不进入工作页 | AGENT-075、UI-154 | M2.4 |
| 分组与筛选：可按工作状态分组或筛选；默认按「工作中 → 已完成 → 空闲」排序 | AGENT-074、UI-153 | M2.4 |
| 列表分页或虚拟滚动：本地 Agent 数量超过 100 时启用 | `prd/modules/non-functional-requirements.md` | M2 |

### 11.2 创建与编辑

M0 的创建弹窗包含名称、描述、指令、Runtime、模型、最大并发、超时与允许路径（逗号分隔）。表单不含 WorkspaceMode 与 AllowedCommands；没有编辑入口；前端只校验名称非空。

M1 起的基础表单规则如下；M1 只复用创建弹窗做基础编辑（次要项），完整的编辑器分区与视觉规范见 `ui-ux.md` §5.6。

| 规则 | 关联 FR / UI | 里程碑 |
| --- | --- | --- |
| 分组展示：基本信息、指令、运行设置、权限边界；M2 增加技能面板与 role；M3 增加可见性与所有权 | UI-060、UI-066、AGENT-064 | M1 基础分组；M2 完整 |
| 校验时机：字段失焦时做格式校验，提交时做完整校验；服务端错误按 field 映射到具体输入框 | AGENT-009 至 AGENT-020 | M1 |
| Runtime 下拉只展示已注册适配器；每个选项展示可用状态；不可用选项允许查看但不可选 | AGENT-011、AGENT-053、UI-071 | M1 |
| 模型使用下拉选择，选项来自所选 Runtime 的模型目录；首项为「默认（由 Runtime 决定）」（空值），其余按来源分组；不提供自由文本输入；目录为空时只显示默认项与「去设置添加模型」入口 | AGENT-079 至 AGENT-082、UI-161 至 UI-164 | M2.1 |
| 选择 Runtime 与模型后提供「测试连接」，显示进行中、成功耗时或失败原因；切换模型/ Runtime 后清空上次结果；测试不创建 Run、不写仓库 | AGENT-084、UI-167 | M2.1 |
| 卡片提供编辑与删除入口；编辑预填当前配置，删除需二次确认；有活跃 Run 时删除返回 409 并提示先取消 | AGENT-083、UI-165、UI-166 | M2.1 |
| 切换 Runtime 时刷新模型目录；原模型不在新目录中时重置为默认并提示，或阻止保存；模型目录探测失败时显示警告与重试，不静默使用旧列表 | AGENT-080、AGENT-082、UI-163 | M2.1 |
| Runtime 权限模式选择：只读、受控编辑、完全授权；默认受控编辑；选择完全授权时显示风险警示并要求二次确认 | AGENT-062 | M1 |
| 允许路径使用多行编辑器或路径选择器，逐条添加；**必须展示「空表示不可写任何路径」**，不得显示「空表示整个工作区」 | AGENT-023、AGENT-072、UI-067 | M1 输入与文案；M2 影响预览 |
| 允许命令使用标签编辑器，逐条添加；**必须展示「空表示不额外授权任何命令」**；高风险命令红色标识、默认不勾选 | AGENT-023、UI-068 | M1 输入与文案；M2 风险分级 |
| 放宽权限（新增路径、命令或切到完全授权）保存前显示影响预览并二次确认 | SEC-015、UI-069 | M2 |
| 指令编辑器提供六段式骨架、字符与 token 估算、全屏编辑、Markdown 预览 | AGENT-026、AGENT-027、UI-064 | M1 骨架与估算；M2 预览 |
| 未保存离开时提示确认；保存成功后展示 revision（M1）与版本号（M2） | AGENT-010、AGENT-040 | M1 revision；M2 版本 |
| 克隆时预填原 Agent 配置，名称自动加 (copy)，保存前可修改 | AGENT-043、UI-063 | M2 |

### 11.3 详情页（M2）

M0 没有 Agent 详情页；M1 不新增详情页，编辑通过弹窗与 API 完成。M2 提供详情页，标签页与行为如下（视觉布局见 `ui-ux.md`）：

| 标签页 | 内容与行为 | 关联 FR / UI | 里程碑 |
| --- | --- | --- | --- |
| 概览 | 名称、描述、role、模板来源、当前版本、Runtime 与模型、权限模式、运行统计、最近 Run | AGENT-040、AGENT-064、UI-072 | M2 |
| 指令 | 当前版本指令、六段式完成度提示、Markdown 预览 | AGENT-027、UI-064 | M2 |
| 版本 | 版本列表、两版本差异、版本绑定的 Run | AGENT-040、AGENT-042 | M2 |
| 技能 | 绑定列表、顺序调整、启用/停用、可用技能库 | AGENT-033、AGENT-066、UI-066 | M2 |
| 权限 | 允许路径、允许命令、权限模式、环境变量白名单、凭据引用、网络访问意图、人工确认点摘要、最近越界事件 | AGENT-023、AGENT-062、AGENT-073、UI-067 至 UI-069 | M2 |
| Run | 该 Agent 的 Run 列表与成功率，口径与 Runs 页面一致 | UI-072 | M2 |

### 11.4 删除与归档（M1/M2.1）

| 规则 | 关联 FR / UI | 里程碑 |
| --- | --- | --- |
| M0 只有 API 删除，没有 UI 入口；删除立即生效且不可恢复 | AGENT-006 | M0 |
| 默认操作为「归档」，文案说明「归档后不可用于新 Run，历史记录保留；M2.1 起 30 天内可恢复」 | AGENT-054、UI-062 | M1/M2.1 |
| 删除入口不提供硬删除；M1 的 DELETE 即归档，M2.1 起进入 30 天恢复窗口 | AGENT-054、AGENT-055 | M1/M2.1 |
| 存在活跃 Run（preparing/running）或未关闭 Review 时归档与删除都禁用，并提示先取消或等待结束；queued Run 在归档时由系统取消并记录原因 | AGENT-055 | M1 |

### 11.5 从 Task 选择 Agent 启动 Run

M0：Task 详情通过 `POST /api/tasks/{id}/runs` 传入 agentId 启动 Run；没有资格预检查；Agent 删除后启动会返回 404；任务状态不可执行时返回 409。

M1 起的规则：

| 规则 | 关联 FR / UI | 里程碑 |
| --- | --- | --- |
| Agent 选择器展示可用 Agent，置灰阻断项并给出原因：Runtime 未安装、权限配置非法、技能缺失（M2）、已归档、无权限 | AGENT-049、AGENT-053、AGENT-056 | M1 除技能外；M2 补齐技能 |
| 并发已满不是阻断项：允许「加入队列」，展示队列位置或预计等待；UI 不得把它显示为失败 | AGENT-017、AGENT-018 | M2 |
| 启动前展示本次将使用的 Runtime、模型、权限模式、超时、允许路径摘要与人工确认点 | AGENT-048、AGENT-062 | M1 |
| 启动成功后跳转 Run 详情；失败时保留表单状态并展示可操作的错误 | UI-056 | M1 |

### 11.6 反馈、空态与错误

| 规则 | 关联 FR / UI | 里程碑 |
| --- | --- | --- |
| 加载中：骨架卡片，不显示空白页面；超过 300 毫秒才显示加载态 | UI-079 | M1 |
| 空态：区分「尚未创建 Agent」与「筛选后无结果」，后者提供清除筛选 | UI-058、UI-078 | M0 基础；M2 筛选后空态 |
| 错误：网络错误、校验错误、权限错误、冲突错误分别使用不同文案；错误信息包含下一步动作 | AGENT-011 至 AGENT-020、UI-056 | M1 |
| 破坏性操作：归档与删除使用确认对话框；删除要求输入名称；归档可撤销（M2.1 恢复窗口），硬删除不可撤销 | AGENT-054、AGENT-055、UI-062 | M1/M2.1 |

### 11.7 文案与可访问性

| 规则 | 关联 UI / NFR | 里程碑 |
| --- | --- | --- |
| 不使用「AI 员工」「数字员工」等拟人化表述；统一使用 Agent 与角色名称 | UI 文案规范 | M0 |
| 中英文术语混排时，Agent、Runtime、Run、Workspace、Skill 保留英文；界面文案跟随应用语言设置 | UI 文案规范 | M0 |
| 表单控件具备 label 与错误关联；键盘可完成创建、保存与取消；颜色不是唯一的状态表达方式 | `prd/modules/non-functional-requirements.md` 可访问性条目 | M1 |

## 12. 数据与 API 影响

### 12.1 当前数据模型

M0 的 `agents` 表字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | 随机十六进制 ID |
| name | TEXT NOT NULL | 名称 |
| description | TEXT NOT NULL DEFAULT '' | 描述 |
| instructions | TEXT NOT NULL DEFAULT '' | 指令 |
| runtime | TEXT NOT NULL DEFAULT 'mock' | Runtime 标识 |
| model | TEXT NOT NULL DEFAULT '' | 模型偏好 |
| workspace_mode | TEXT NOT NULL DEFAULT 'worktree' | Run 工作区模式 |
| max_concurrency | INTEGER NOT NULL DEFAULT 1 | 并发上限 |
| timeout_minutes | INTEGER NOT NULL DEFAULT 60 | 超时分钟 |
| allowed_paths | TEXT NOT NULL DEFAULT '[]' | JSON 数组字符串 |
| allowed_commands | TEXT NOT NULL DEFAULT '[]' | JSON 数组字符串 |
| created_at | INTEGER NOT NULL | 毫秒时间戳 |
| updated_at | INTEGER NOT NULL | 毫秒时间戳 |

`agents` 表没有 `workspace_id`、`revision`、`role`、`permission_mode`、`current_version_id`、`status` 等字段；`runs` 表与 Agent 相关的字段当前只有 `agent_id`，没有 Agent 配置快照、配置哈希、提示词哈希、Runtime 版本与权限模式，因此无法复现历史配置。`DELETE` 是物理删除，没有外键约束与级联规则。

### 12.2 计划中的数据模型

M1 新增：

- `agents` 增加 `workspace_id`（TEXT NOT NULL DEFAULT `default`）、`revision`（INTEGER NOT NULL DEFAULT 1）、`permission_mode`（TEXT NOT NULL DEFAULT `controlled_edit`）；M1 建立 `(workspace_id, lower(name))` 唯一索引，M2 增加 `status` 后改为 `WHERE status='active'` 的部分唯一索引（归档后名称可复用）。
- `run_config_snapshots`：`id`、`run_id`（唯一）、`workspace_id`、`agent_id`、`agent_revision`、`config_json`、`config_hash`、`prompt_hash`、`runtime_version`、`permission_mode`、`permission_envelope_json`、`created_at`。该表只追加，Run 结束后不得补写或修改（RUN-012、AGENT-065）。
- `runs` 增加 `config_snapshot_id`、`error_code`、`failure_detail`。这三个字段的完整语义归 `runtime-and-workspace.md` 与 `02-domain-model.md` §3.6；本章只为超时与快照需求列出它们，避免两套错误码。

M2 新增：

- `agents` 增加 `role`（TEXT NOT NULL DEFAULT `general`；旧数据迁移为 `general`）、`status`（TEXT NOT NULL DEFAULT `active`）、`archived_at`、`current_version_id`、`role_template_id`、`role_template_version`、`template_snapshot`、`env_allowlist_json`、`credential_refs_json`、`network_access`。
- `agent_versions`：`id`、`workspace_id`、`agent_id`、`version_number`、`snapshot_json`、`content_hash`、`change_note`、`created_by`、`created_at`；对 `(agent_id, version_number)` 唯一。字段命名与 `02-domain-model.md` §3.5 的 AgentVersion 对齐（API 层使用 `versionNumber`、`contentHash`、`changeNote`）。
- `agent_templates`：`id`、`key`、`version`、`builtin`、`manifest_json`、`template_schema_version`、`created_at`；模板版本不可变，被引用时不可删除。

**skills、skill_versions 与 agent_skills 的表结构不在本章重复定义**，统一由 `prd/modules/api-and-data.md` 维护。以其 M2 详细表为准：`skills(id, workspace_id, name, slug, description, status, created_at, updated_at)`、`skill_versions(id, skill_id, version, content_hash, manifest, instructions, source_path, created_at)`、`agent_skills(agent_id, skill_id, skill_version_id, enabled, binding_order, created_at)`。该文档前部的早期摘要（`skills` 直接带 `version`、`agent_skills` 用 `skill_version`）与详细表不一致，应在 api-and-data 内部收敛为详细表定义。本章只补充 Agent 侧语义：绑定必须外键指向具体 `skill_version_id`；`enabled` 控制启停；`binding_order` 决定提示词顺序；解绑与删除保护按 6.2 执行。

M3 新增：

- `agents` 增加 `visibility`、`owner_id`、`team_id`、`created_by`。
- `audit_events`：记录 Agent 变更与权限拒绝。
- Postgres 版本保持相同语义；SQLite 继续服务本地模式。

所有迁移必须向后兼容：新字段带默认值，旧记录在读取时补齐；不允许在迁移中删除历史字段而不保留快照。数据库列使用 snake_case，API 与领域对象使用 camelCase，二者在仓储层映射，不得混用。

### 12.3 当前 API

| 方法 | 路径 | 行为 | 状态码 |
| --- | --- | --- | --- |
| GET | `/api/agents` | 返回全部 Agent，创建时间倒序 | 200 |
| POST | `/api/agents` | 创建 Agent；仅名称非空校验；应用默认值；广播 agent.created | 201 / 400 |
| GET | `/api/agents/{id}` | 读取单个 Agent | 200 / 404 |
| PATCH | `/api/agents/{id}` | 部分更新；名称非空校验；广播 agent.updated | 200 / 400 / 404 |
| DELETE | `/api/agents/{id}` | 硬删除；广播 agent.deleted | 204 / 404 |

API 请求体字段与 `Agent` 结构一致；`allowedPaths` 与 `allowedCommands` 为字符串数组；未知字段被忽略；请求体上限 1MB。

### 12.4 计划中的 API

| 方法 | 路径 | 用途 | 里程碑 |
| --- | --- | --- | --- |
| GET | `/api/agents?status=active&runtime=claude&role=frontend&q=front` | 过滤与搜索；status 另支持 archived | M2 |
| POST | `/api/agents/{id}/clone` | 克隆 Agent | M2 |
| GET | `/api/agents/{id}/versions` | 版本列表 | M2 |
| GET | `/api/agents/{id}/versions/{versionNumber}` | 版本详情 | M2 |
| GET | `/api/agents/{id}/versions/{a}/diff/{b}` | 版本差异 | M2 |
| POST | `/api/agents/{id}/archive` | 归档 | M1 |
| POST | `/api/agents/{id}/restore` | 恢复 | M2 |
| DELETE | `/api/agents/{id}?mode=purge&confirm={name}` | 显式清除配置 | M2 |
| GET | `/api/skills` | 技能列表 | M2 |
| POST | `/api/skills/import` | 导入本地技能 | M2 |
| GET | `/api/agents/{id}/skills` | 绑定列表 | M2 |
| PUT | `/api/agents/{id}/skills` | 更新绑定与顺序 | M2 |
| PATCH | `/api/agents/{id}/skills/{skillId}` | 启用或停用绑定 | M2 |
| GET | `/api/agent-templates` | 内置模板列表 | M2 |
| POST | `/api/agent-templates/{key}/instantiate` | 实例化模板 | M2 |
| GET | `/api/agents/{id}/export` | 导出 Agent 包 | M4 |
| POST | `/api/agents/import` | 导入 Agent 包 | M4 |

新增接口必须沿用现有风格：JSON 请求与响应、`{"error": "..."}` 基础错误格式；M1 起可附加 `code` 与 `field` 顶层字段，保持旧客户端可读。表中路径以 M0 的 `/api` 前缀示意；`prd/modules/api-and-data.md` 规定 M1 起新增 `/api/v1` 并在 M1 保留 `/api` 别名，具体版本前缀与迁移窗口以该文档为准，本章不重复定义。

### 12.5 实时事件

M0 已实现：`agent.created`、`agent.updated`、`agent.deleted`。Run 相关事件由 `runtime-and-workspace.md` 定义。

计划新增：

- `agent.archived`、`agent.restored`（M2）。
- `agent.version.created`（M2，生成 AgentVersion 时）。
- `agent.skill.bound`、`agent.skill.unbound`、`agent.skill.enabled`、`agent.skill.disabled`、`agent.skill.delete_blocked`（M2）。
- `agent.template.instantiated`（M2）。
- `agent.permission.denied`（M2，配合 Run 事件流；生产动作拒绝使用同一事件并带 `failureDetail=prod_action_denied`）。

事件 payload 至少包含 Agent id 与 `revision`；M2 起额外包含 `versionNumber`。权限拒绝事件额外包含动作、目标路径或命令、Run id。

### 12.6 错误语义

| 状态码 | 场景 | 响应要求 |
| --- | --- | --- |
| 400 | 名称为空、字段格式非法、枚举非法、范围越界 | 错误消息指出字段；M1 起带 code 与 field |
| 403 | 团队模式无权限 | 说明所需角色；不泄露不可见 Agent 的存在 |
| 404 | Agent 不存在 | 统一消息，不区分「不存在」与「不可见」 |
| 409 | 名称冲突、revision 冲突、跨 Workspace 引用或使用、活跃 Run 阻止归档/删除、已归档启动 Run、技能版本缺失或被绑定 | 说明冲突对象与解决建议；跨 Workspace 不得泄露对方资源内容 |
| 204 | 删除成功 | 无响应体 |

### 12.7 迁移与兼容

- SQLite 迁移采用增量文件，按文件名顺序执行；每个迁移必须可重复执行或具备版本记录。
- 新增字段必须提供默认值；旧 Agent 的 `workspace_id` 默认 `default`、`revision` 默认 1、`permission_mode` 默认 `controlled_edit`；M2 迁移再补 `role=general`、`status=active`、`current_version_id` 并为每个 Agent 生成一条初始 AgentVersion。
- M1 创建 `agent_versions` 与 `run_config_snapshots` 两张表：前者保存 Agent 级不可变版本（每个现有 Agent 生成 `version_number=1` 的初始版本），后者保存 Run 级执行快照并引用 `agent_version_id`。历史可复现性由两者共同保证；任何只建其一的做法都与 `02-domain-model.md` §14 与 M1-local-loop 的迁移清单冲突。
- API 字段只增不减；若必须废弃字段，先保留并标记，至少跨一个里程碑后再移除。
- 事件命名保持 `agent.{动作}` 前缀；新增事件不得复用旧名称表达不同语义。

## 13. 异常与边界

| 场景 | M0 当前行为 | 期望行为（对应里程碑） |
| --- | --- | --- |
| Runtime 未注册 | 静默回退 mock，Run 成功但结果与预期不符 | 保存时 400；历史记录中的非法值在创建 Run 时阻止并提示 |
| claude CLI 不在 PATH | Run 失败，错误写入 Run.error | 保持失败并给出安装指引；Agent 列表标记 Runtime 不可用 |
| 模型不受支持 | Model 被忽略，使用 Runtime 默认 | 适配器返回明确错误；Run 失败并展示支持的模型清单 |
| TimeoutMinutes 为 0 或负数 | 创建时回退 60；PATCH 可写入 0 或负数，调度器不设置超时 | 保存时 400；运行中永不出现无超时 Run |
| MaxConcurrency 为 0 或负数 | 创建时回退 1；PATCH 可写入，调度器不感知 | 保存时 400；调度器以 1 为下限 |
| WorkspaceMode 非法 | 被忽略，使用普通目录 | 保存时 400；M1 仅 worktree 合法，M2 增加 directory 且需显式确认 |
| AllowedPaths 含绝对路径或 `..` | 原样存储 | 保存时 400；规范化后才落库 |
| AllowedCommands 含 shell 元字符 | 原样存储 | 保存时 400；按可执行名与前缀匹配 |
| 名称重复 | 允许，界面出现同名 Agent | 409；UI 提示并建议改名 |
| 并发编辑同一 Agent | 后写覆盖先写 | revision 冲突 409；要求刷新与合并 |
| 指令为空 | 允许保存；提示词缺少职责与边界 | 保存时警告；Run 详情标记配置不完整 |
| 删除仍有排队的 Run 的 Agent | 硬删除；worker 执行到该 Run 时加载 Agent 失败，Run 失败 | 归档优先；存在 preparing/running 返回 409；仅存在 queued 时先取消这些 Run 并记录 `agent_archived`，再归档或删除（AGENT-055） |
| 删除运行中 Run 的 Agent | 硬删除；运行中的 Run 继续使用内存中的配置，历史悬空 | 禁止；先取消 Run 再归档 |
| 队列满 | 入队等待 5 秒后仅记录警告，Run 永久处于 queued | 持久化队列与背压；向用户展示失败原因 |
| 应用重启时存在 queued / running Run | 队列丢失；queued 不再执行，running 永远停留 | 启动恢复：queued 重新入队；running 标记失败并记录恢复事件 |
| 技能版本缺失 | 不适用（M2 前无技能） | Run 创建时阻止；错误列出缺失技能与版本 |
| 技能命令超出允许命令 | 不适用 | 绑定失败；提示哪些命令未被允许 |
| 模板变量缺失 | 不适用 | 实例化失败；指出缺失变量与期望来源 |
| 导入包含密钥的模板 | 不适用 | 拒绝导入并指出命中位置 |
| 工作时间窗口跨越午夜 | 不适用 | 明确按本地时区解释；窗口外的排队 Run 在窗口开始后按优先级启动 |
| 团队协作中 Agent 被归档 | 不适用 | 与 9.3/AGENT-055 一致：存在 preparing/running 的 Run 时返回 409 并要求先取消或等待；仅存在 queued Run 时由系统取消并记录 `agent_archived`，然后归档；历史 Run 与快照保留 |
| 运行中手动取消与自然完成竞态 | API 立即写 cancelled，调度器随后可能回写 failed/completed（`runtime-and-workspace.md` §11.5） | 取消由调度器确认停止后写 cancelled；所有终态写入带前置状态校验；竞态失败方写 `cancel_lost_race` 事件（RUN-004/RUN-005） |
| 无权限访问团队 Agent（403）或不可见 Agent | 不适用（M0–M2 本地单用户） | 403 说明所需角色；不可见 Agent 统一返回 404 以避免枚举；两者都写审计（`security-and-permissions.md`） |
| 远程 Runner 离线或心跳超时 | 不适用（M3） | Run 置为 failed，`errorCode=runner_lost`，保留租约与最后事件；不自动在其他机器重跑，人工决定重试或放弃 |
| 依赖未满足或 DAG 阻塞 | 不适用（M2） | 下游 Task 保持 blocked，Run 不创建或拒绝启动，展示缺失依赖与契约；依赖满足后自动解除（`collaboration-and-review.md`、`task-management.md`） |
| 尝试执行生产动作 | 不适用（M2） | 按 9.4.1 硬拦截，产生 `permission_denied`（`prod_action_denied`）事件，无副作用；不存在「审批后由 Agent 执行生产」的路径 |
| Runtime 不支持路径/命令策略 | 不适用（M2） | adapter 声明能力；UI 显示隔离等级；只在支持时承诺实时拒绝，不支持时运行后审计并进入人工复核（AGENT-021/022/069） |
| allowedPaths 为空时尝试写入 | 不适用（M0–M1 未执行；M2 起） | 拒绝写入或标记越界并使 Run 进入人工复核；不得默认允许整个工作区（AGENT-023/072） |
| 排队期间修改 Agent | M0 无快照，执行时读取最新配置 | 使用 Run 创建时的快照；编辑只影响之后创建的 Run（AC-AGENT-08、AGENT-048） |

## 14. 权限与安全

### 14.1 信任模型

M0–M2：本地单用户，应用与数据都在用户机器上，没有服务端多租户。API 默认监听回环地址，但当前 CORS 实现会反射请求 Origin；在开放网络或团队模式之前必须收紧来源校验（见 `security-and-permissions.md` 与 `api-and-data.md`）。Agent 权限是误操作护栏，不能防御拥有本机账户的恶意用户。

M3：登录、团队、角色与审计生效。所有 Agent 读写都要经过权限检查；团队共享 Agent 默认只读；跨团队访问返回 404 以避免泄露存在性。

### 14.2 执行侧防线

针对「Agent 指令不可信、模型可能不遵守指令」的现实，执行侧必须独立于提示词做多层防护：

1. **Runtime 权限参数**：调用 claude 或 codex 时按其能力传递 `permissionMode`（只读/受控编辑/完全授权）；默认受控编辑，不默认跳过权限检查；完全授权必须由用户显式开启并警示。
2. **Run 工作区隔离**：默认 worktree；Agent 的允许路径相对于该 worktree 根目录解析，禁止逃逸到用户主目录或其他仓库。
3. **命令与路径拦截**：只有 adapter 声明支持时才承诺实时拒绝；不支持的 adapter 必须在运行后审计命令日志与变更文件。能力级别定义如下：
   - **A 级（实时拦截）**：adapter 能在工具调用或命令执行前按权限信封拒绝越界动作，并产生 `permission_denied` 事件。
   - **B 级（事后审计）**：adapter 不能实时拦截，但能记录命令、工具调用与变更文件；Run 结束后系统比对并标记越界，Run 进入人工复核。
   - **C 级（仅提示词）**：既不能拦截也不能可靠记录；只能依赖提示词约束，必须在 UI 中标注「无权限执行能力」，不得对外宣称具备权限信封。
4. **变更审计**：Run 结束后对比基准提交与实际变更；越界路径、越界命令、敏感文件变更使 Run 进入人工复核。
5. **审批门**：推送、合并、部署、删除资源必须由人工确认；DevOps 生产动作按 9.4.1 硬性禁止。
6. **证据留存**：即使 Run 失败或被取消，已产生的日志、diff、命令记录仍保留，供审计。

Runtime 能力矩阵（M1/M2 计划；实现后由 adapter 自描述，UI 显示隔离等级）：

| Runtime | 权限模式传递 | 路径级拦截 | 命令级拦截 | 优雅取消 | 流式事件 | 默认隔离等级 |
| --- | --- | --- | --- | --- | --- | --- |
| mock | 不适用 | 不适用 | 不适用 | 支持 | 支持（固定事件） | 模拟，不计入真实证据 |
| claude（M1） | 支持只读/受控/完全授权 | 否（依赖 worktree 边界） | 否（依赖 CLI 工具权限参数） | 是（10 秒宽限后强杀） | 是（结构化输出） | B 级，M1 起逐步接近 A 级 |
| claude（M2） | 支持 | 依赖 CLI 工具策略 + worktree 边界 | 依赖 CLI 工具策略；不支持时降级 B | 是 | 是 | A 或 B，由能力探测决定 |
| codex（M2） | 计划支持 | 依赖其沙箱能力 | 依赖其沙箱能力 | 计划支持 | 计划支持 | 待能力探测 |

能力声明必须可测试：`adapter.Capabilities()` 返回布尔与枚举；缺失字段按最低能力（C 级）处理，不得默认乐观假设。

### 14.3 高风险动作矩阵

见 9.4 的表。需要再次强调：M0 的高风险动作仅仅写在提示词里，没有系统级拦截；不得在发布说明或营销材料中宣称 M0 具备权限沙箱。M1 起逐步以 Run 工作区与审批门实现最小闭环，M2 起以路径/命令策略与审批门实现角色协作所需的最小权限。

### 14.4 审计

M3 的审计事件至少包括：创建、修改、克隆、归档、恢复、删除、所有权转移、可见性变更、权限拒绝、模板导入、技能导入。每条记录包含操作人、时间、Agent id、版本前后值、差异摘要、来源 IP 或设备标识（在隐私政策允许范围内）。审计日志只追加，不允许普通用户修改。

### 14.5 安全边界声明

- ATeam 不保证外部 Runtime 完全遵守 Agent 指令。
- ATeam 不保证路径与命令限制等同于操作系统级沙箱。
- ATeam 不托管模型密钥；密钥安全由用户与本机环境负责。
- 模板与技能可能包含不可信内容；导入前的扫描与确认是必要步骤，但不能替代人工审查。
- 团队模式下，可见性为 team 的 Agent 内容对团队成员可见，不应在其中保存个人敏感信息。

## 15. 指标

以下指标用于评估 Agent 体系是否真正降低协作成本，而不是只看创建数量。目标值为首版假设，需在 M1 上线后按真实数据校准。

| 指标 | 定义 | 首版目标 | 数据来源 | 里程碑 |
| --- | --- | --- | --- | --- |
| Agent 复用率 | 被两次及以上 Run 使用的 Agent 数 / 活跃 Agent 总数 | 不低于 60% | Agent 与 Run 关联统计 | M1 |
| 配置完整率 | 同时具备指令、有效 Runtime、非空检查项（模板）的 Agent 比例 | 不低于 80% | Agent 配置扫描 | M1 |
| 版本快照覆盖率 | 带 configSnapshotId、配置哈希与提示词哈希的 Run 数 / 总 Run 数 | 100% | run_config_snapshots 与 runs 表 | M1 |
| Run 成功率（按 Agent） | completed 的 Run / 该 Agent 已结束 Run | 按 Agent 分别展示，不设统一目标 | Run 状态 | M1 |
| 超时率 | `failed` 且 `errorCode=timeout` 的 Run / 已结束 Run | 低于 10% | Run 失败分类统计 | M1 |
| 首次 Run 耗时 | Agent 创建到第一次 Run 启动的中位时长 | 低于 10 分钟 | 事件时间戳 | M1 |
| 克隆率 | 发生克隆的 Agent 数 / 活跃 Agent 总数 | 15%–35% 视为健康试验 | 克隆事件 | M2 |
| 模板转化率 | 实例化后 7 天内启动首个 Run 的模板 Agent / 实例化总数 | 不低于 50% | 模板事件与 Run | M2 |
| 权限拒绝率 | 被拒绝的越界动作 / Run 总数 | 作为质量信号，不设越低越好 | 权限事件 | M2 |
| 归档/删除比 | 归档数 / 硬删除数 | 归档应显著高于删除 | 生命周期事件 | M2 |
| 共享 Agent 使用率 | 团队成员使用共享 Agent 的 Run / 团队总 Run | 不低于 40% | M3 审计数据 | M3 |
| 模板导入成功率 | 成功导入并完成确认的包 / 发起导入的包 | 不低于 90% | M4 导入事件 | M4 |

指标使用注意：

- 不用 Agent 创建数作为核心成功指标，因为没有 Run 的 Agent 不代表价值。
- 权限拒绝率上升可能意味着策略过严，也可能意味着 Agent 指令需要改进；应结合人工复核结果分析。
- 超时率应与任务复杂度、模型选择一起分析，不能单独归因于 Agent 配置。

## 16. 依赖与风险

### 16.1 依赖

| 依赖 | 依赖内容 | 影响的 Agent 能力 | 里程碑 |
| --- | --- | --- | --- |
| Runtime 适配器 | 真实 Claude Code 适配器、Codex 适配器、模型参数与健康检查 | Runtime/Model 配置生效、Run 资格检查 | M1 / M2 |
| Run 工作区管理 | Run 工作区（worktree/目录）、分支、基准提交、变更审计 | WorkspaceMode 生效、路径限制 | M1 |
| Run 配置快照 | `run_config_snapshots` 表、提示词哈希、Runtime 版本与权限模式 | 历史 Run 可复现、AC-AGENT-08 | M1 |
| Runtime 能力声明 | `Capabilities()` 能力矩阵、隔离等级展示 | 路径/命令拦截的诚实降级、AGENT-069 | M2 |
| 权限信封执行 | 路径/命令/环境变量/凭据引用/网络访问意图 | allowedPaths/Commands 生效、生产动作硬拦截 | M2 |
| 调度器 | 持久化队列、并发准入、恢复机制 | 并发、排队、优先级 | M1 / M2 |
| Task 与 DAG | 任务依赖、交付物契约、DoD | 角色模板与协作 | M2 |
| 权限与审批 | 路径/命令策略、审批门、审计 | 允许路径/命令、高风险动作 | M2 / M3 |
| 技能存储与解析 | SKILL.md 解析、版本库、导入扫描 | 技能绑定与证据 | M2 |
| 存储层 | SQLite 迁移、Postgres 兼容 | 快照、版本、技能、团队字段 | M1 / M3 |
| UI 组件 | 表单校验、路径选择器、版本对比、技能面板 | 创建/编辑/详情体验 | M1 / M2 |

### 16.2 风险

| 风险 | 表现 | 影响 | 缓解措施 | 里程碑 |
| --- | --- | --- | --- | --- |
| 自由聊天式多 Agent | 产品被理解为多个 Agent 群聊 | 上下文混乱、责任不清、不可审计 | 产品与模板强制 DAG 与契约；界面不提供群聊入口 | M2 |
| 权限名义化 | 配置了路径/命令但运行时不执行 | 越界修改、安全事故、信任受损 | 执行层拦截 + 运行后审计 + 发布说明如实标注 | M2 |
| 指令膨胀 | 一个 Agent 承担过多职责，提示词过长 | 成本上升、行为不稳定 | 六段式模板、指令预算、技能拆分、模板评审 | M1 / M2 |
| 配置碎片化 | 大量近似 Agent，难以治理 | 选择困难、维护成本高 | 复用指标、归档、模板与克隆策略 | M2 |
| 版本与快照缺失 | 历史 Run 无法复现 | 审计失败、问题无法定位 | M1 同时落 AgentVersion 与 RunConfigSnapshot；M2 增加版本对比体验 | M1 |
| 队列与并发失控 | Run 堆积、机器资源耗尽 | 产品不可用 | 全局上限、持久队列、背压、可见队列位置 | M1 / M2 |
| 删除导致历史丢失 | Agent 删除后 Run 悬空 | 审计与回溯困难 | 归档优先、引用检查、快照保留 | M2 |
| 模板/技能供应链 | 导入恶意指令或越权声明 | 数据泄露、越界修改 | 导入扫描、权限差异展示、签名（M4）、不自动执行 | M2 / M4 |
| Runtime 变化 | CLI 参数或模型列表更新 | 适配器失效、Run 失败 | 适配器抽象、健康检查、版本矩阵 | M1 |
| 团队可见性泄露 | 私有 Agent 被错误共享 | 配置与指令泄露 | 默认 private、显式共享、审计、404 防枚举 | M3 |
| Agent 存储密钥 | 用户把 Token 写进指令 | 泄露到日志、导出与模板 | 扫描、禁止导出、凭据独立存储 | M2 |

## 17. 里程碑映射

| 里程碑 | Agent 相关交付 | 退出标准 |
| --- | --- | --- |
| M0（已完成骨架） | Agent CRUD、SQLite 持久化、REST 与 WebSocket、默认值、指令注入提示词、超时基础行为、Vue 列表与创建弹窗、mock 与最小 claude 适配器 | 可通过 UI 创建 Agent；可通过 API 更新与删除；Run 能读取 Agent 指令并执行；重启后数据仍在 |
| M1（本地闭环） | 配置校验（Runtime、workspaceMode、并发、超时、路径/命令语法）、`workspaceId=default`、`revision` 乐观并发、`permissionMode`、RunConfigSnapshot（创建时写入，含 Runtime 版本/权限模式/权限信封/提示词哈希）、编辑不改变历史 Run、Runtime 健康检查与无 mock 回退、超时映射为 failed + `errorCode=timeout`、取消终态守卫（引用 RUN-004/RUN-005）、基础编辑表单（次要项，不进入退出标准） | Agent 保存有完整校验；未知 Runtime 返回 400 且不回退 mock；Run 创建时生成完整快照，排队期间修改 Agent 不改变该 Run；超时 Run 为 failed 且 `errorCode=timeout`；取消后状态不被回写 |
| M2（角色 Agent 协作） | `role` 与旧数据迁移、AgentVersion 表与版本历史/差异、克隆（UI-063）、归档/恢复/删除引用检查（UI-062）、完整 Agent 管理 UI（含 Runtime 模型下拉与本地模型配置）、内置角色模板与版本化变量 schema、技能（解析/导入/绑定/启停/解绑/删除保护/证据）、权限信封执行（路径、命令、环境变量、凭据、网络意图）、每 Agent 并发与持久队列、Runtime 能力矩阵与隔离等级、生产动作硬拦截、审批门与 DevOps Agent staging 限制 | role 可用于依赖校验；版本与技能版本可追溯；空 allowedPaths 时写入被拒绝或标记；不支持实时拦截的 Runtime 明确降级并进入人工复核；生产动作被拒绝并产生事件；归档保留历史；staging 需审批；模型只能从 Runtime 目录选择 |
| M2.4（Agent 状态看板与工作台，附加） | 派生 `workStatus`、`GET /agents/{id}/work`、`GET /runs/{id}/snapshot`、看板状态与筛选、工作页（当前工作、上下文、完成过程、历史工作）、状态与 Run 列表一致性、快照脱敏 | 看板状态与 Run 列表一致；工作中/已完成 Agent 可进入工作页；工作页不暴露明文密钥与完整拼装 prompt；空闲与归档态正确 |
| M3（团队模式） | 登录与角色、Agent 可见性与所有权、共享 Agent、团队审计、Postgres 兼容、Remote Runner 下的 Agent 执行、GitHub PR 相关审批 | 团队成员可见共享 Agent；无权限编辑返回 403 并审计；不可见 Agent 返回 404；审计可查完整变更；远程执行不改变 Agent 配置语义 |
| M4（自动化与分发） | Agent 包导出/导入、模板市场、工作时间窗口、Webhook/定时触发的 Agent 选择、插件 API 中的 Agent 扩展点、通知与打包 | 模板包导入有权限预览与扫描；工作时间窗口按规则生效；自动化触发的 Run 记录 Agent 配置快照与来源 |

### 17.1 M1 范围裁决说明

`prd/milestones/M1-local-loop.md` 明确规定：模块文档与该文件的 M1 范围冲突时，以该文件的范围为准。本章据此做以下裁决，避免实现者同时背两套范围：

1. **M1 保留**：Agent CRUD 与校验、`workspaceId`（默认 `default`）、`revision`、`permissionMode`、RunConfigSnapshot、Runtime 校验与健康检查、超时失败分类、编辑不改变历史 Run。其中 `permissionMode` 与 RunConfigSnapshot 是 M1 里程碑 `M1-AGENT-001` 与 `M1-AGENT-003` 的明确要求，必须进入 M1。
2. **M1 不做**：AgentVersion 表、版本历史与差异 UI、克隆、归档/恢复/删除引用检查、Agent 级并发与持久队列、路径/命令的强制执行。这些按 M2 交付；M1 只做路径/命令的格式校验，不能宣称具备权限信封。
3. **基础编辑表单**作为 M1 次要项保留（复用创建弹窗），用于验证「编辑不影响历史」与日常试用；完整编辑页、详情页与版本 UI 在 M2。若 M1 排期紧张，可只保留 API PATCH，不阻塞 M1 退出。
4. **需要回写的冲突**：`02-domain-model.md` 的 AGENT-004（AgentVersion）与 AGENT-007（归档）当前标 M1，`api-and-data.md` 的 M1 增量也包含 AgentVersion、archive 与 agents 的 status/archived_at/current_version_id，`ui-ux.md` 的 UI-062（删除/归档）标 M1、UI-063（克隆）标 M2；本章按 M1-local-loop 的范围把版本历史、克隆、归档统一放到 M2。范围评审若决定回到 M1，必须同时修改 M1 里程碑的数据模型、退出标准与本节。

### 17.2 M2 内部交付顺序

M2 内部建议按以下顺序交付，避免依赖倒挂：

1. 权限执行与路径/命令审计（先有护栏）。
2. 归档、删除引用检查与版本 UI（先有可追溯）。
3. 角色模板与指令骨架（先有可复用配置）。
4. 技能解析、导入、绑定与证据（先有可复用知识）。
5. Task DAG 与交付物契约集成（先有协作骨架）。
6. Crew/队长模式（在契约与审批稳定之后）。

## 18. 与其他文档的关系

### 18.1 文档权威顺序

本章只定义 Agent 的产品语义、配置、指令、技能、版本、权限边界与生命周期。跨文档引用按以下顺序裁决，避免「以哪份为准」无法回答：

1. `prd/00-product-overview.md`：产品目标、用户与核心闭环；本章不得偏离其定位。
2. `prd/01-scope-and-roadmap.md`：里程碑划分与范围原则；里程碑编号与名称以它为准（M0-scaffold、M1-local-loop、M2-role-agents、M3-team、M4-automation-and-packaging）。
3. `prd/02-domain-model.md`：Agent、AgentVersion、Run、Workspace 等实体字段、状态机与默认值；字段命名与快照语义以它为准。
4. 模块文档：本章与其余模块文档平级，各自拥有自己的主题域；冲突时按主题域归属判断（见 18.2）。
5. `prd/milestones/M1-local-loop.md` 等里程碑文档：决定该里程碑的范围与退出标准；模块文档与 M1 文档的范围冲突时，以 M1 文档为准（其文档优先级条款），超出部分后置。
6. `prd/04-acceptance-and-test-plan.md`：验收口径；模块 FR 变更时必须同步更新验收引用。
7. `prd/05-risks-and-open-questions.md`：风险与开放问题；本章 §19 的待确认项应与其登记保持一致。

安全类冲突按「更保守、更小权限」的一方执行；任何跨文档裁决都必须记录在 §19 的回写清单中，不能只存在于会议纪要。

### 18.2 模块文档（真实路径）

| 文档 | 与本章的关系 | 谁拥有最终口径 |
| --- | --- | --- |
| `prd/modules/task-management.md` | Task 是上下文容器；Task 状态、依赖 DAG、就绪判定与 DoD 在彼处。本章定义 Agent 如何被 Task 选择与约束 | Task 状态与就绪 → task-management.md |
| `prd/modules/runtime-and-workspace.md` | Run 与 Runtime、Run 工作区（worktree/目录）、Artifact/Evidence、取消、超时、失败分类都在此文件（Run 与 Workspace 已合并，没有单独的 Run 或 Workspace 模块文档）。本章的 Runtime、模型、超时、并发、权限模式与快照字段由它消费 | Run 状态机、错误码、取消/超时 → runtime-and-workspace.md |
| `prd/modules/collaboration-and-review.md` | 角色模板、交付物契约、任务 DAG、审批门、Crew/队长模式与收件箱。本章定义 Agent 的 role、模板来源与禁止动作 | role 在依赖校验中的用法 → collaboration-and-review.md（COLLAB-003） |
| `prd/modules/security-and-permissions.md` | 威胁模型、权限信封、审批矩阵、密钥管理、团队角色、403 与审计。本章的权限模式与权限信封字段与它对齐 | 权限信封与审批矩阵 → security-and-permissions.md |
| `prd/modules/api-and-data.md` | 完整 API 约定、错误码、分页、迁移与数据库 schema。`skills`、`skill_versions` 与 `agent_skills` 的表结构由它统一维护，本章只引用字段与补充 Agent 侧语义 | API 与 schema → api-and-data.md |
| `prd/modules/ui-ux.md` | Agents 列表、编辑器、详情页的视觉与交互规范（UI-058 至 UI-072，§5.5、§5.6）。本章只定义行为规则与验收要点 | 视觉与布局 → ui-ux.md |
| `prd/modules/non-functional-requirements.md` | 性能、可靠性、隐私、可访问性指标；本章 §15 的 Agent 指标与其衔接 | 非功能指标 → non-functional-requirements.md |
| `prd/modules/agent-system.md` | 本章自身：Agent 配置、role、指令、技能、版本、并发、权限边界与里程碑映射 | Agent 配置语义 → 本章 |

### 18.3 里程碑文档（真实路径）

| 文档 | 与本章的关系 |
| --- | --- |
| `prd/milestones/M0-scaffold.md` | M0 骨架范围；本章 §2.3 的「已实现」以其与仓库代码为准 |
| `prd/milestones/M1-local-loop.md` | M1 范围与退出标准；其 §7 数据模型只要求 RunConfigSnapshot，其 AGENT-001 至 AGENT-004 是 M1 本地需求。本章 §17.1 按它裁决 M1 范围 |
| `prd/milestones/M2-role-agents.md` | M2 角色协作、技能、模板与权限；其引用的 AGENT-032 至 AGENT-042 等模块 FR 以本章编号为准 |
| `prd/milestones/M3-team-mode.md` | M3 登录、团队、共享 Agent、Runner 与审计 |
| `prd/milestones/M4-automation-and-packaging.md` | M4 自动化、模板市场、打包与插件 |

本章 §17 是 Agent 视角的映射，不替代里程碑文档；里程碑文档的目标、演示脚本与退出标准优先级更高。

### 18.4 编号映射与已废弃路径

`M1-local-loop.md` 的本地需求编号与本章模块编号同名但含义不同，引用时必须加前缀。对应关系如下：

| 里程碑本地编号 | 含义 | 本章对应 FR |
| --- | --- | --- |
| `M1-AGENT-001` | Run 启动时生成 Agent 配置快照（本章按「Run 创建时」落地，见 8.5） | AGENT-030、AGENT-041、AGENT-048、AGENT-065 |
| `M1-AGENT-002` | 创建、更新与启动 Run 时校验 Runtime | AGENT-011、AGENT-053 |
| `M1-AGENT-003` | Agent 支持 Runtime 权限模式字段 | AGENT-062 |
| `M1-AGENT-004` | Agent 编辑不影响历史 Run | AGENT-041、AGENT-048 |

以下路径在早期草稿中出现过，但**当前仓库不存在**，不得再作为引用目标：

- `prd/modules/task-system.md`、`run-and-runtime.md`、`workspace-system.md`、`collaboration.md`、`permissions-security.md`、`observability-evidence.md`、`api-data.md`、`nfr.md`：对应真实文件见 18.2；其中 Run 与 Workspace 合并为 `runtime-and-workspace.md`，证据与可观测性内容也在该文件，没有独立的 `observability-evidence.md`。
- 里程碑文档的旧简写 `m0.md`、`m1.md`、`m2.md`、`m3.md`、`m4.md` 不再使用；真实文件为 `prd/milestones/M0-scaffold.md` 至 `M4-automation-and-packaging.md`，见 18.3。
- 旧规划名 `agent-and-configuration.md` 已废弃：该概念由本章 `prd/modules/agent-system.md` 承担；安全文档已改为引用本章。

## 19. 已裁决、待回写与待确认

### 19.1 已裁决（本稿生效）

以下问题在本稿中已做裁决，不再作为开放问题：

1. **空 allowedPaths 的语义**：安全优先，空数组表示**不可写任何路径**，与 UI-067 一致；空 allowedCommands 表示**不额外授权任何命令**。不再解释为「整个工作区」或「继承 Runtime 默认策略」。验收包含负向测试（AGENT-072）。
2. **超时状态**：超时统一为 `failed` + `errorCode=timeout` + `run.timeout` 事件，不得为 `cancelled` 或 `completed`，与 RUN-005/RUN-006、US-RUN-07、AC-RUN-05 一致。
3. **workspaceMode 枚举**：只使用 `worktree`、`directory`；`shared` 不是合法值。M1 只实现 `worktree`，`directory` 在 M2 作为直接目录模式，必须显式确认并提示不具备隔离。
4. **版本引用字段**：Agent 使用 `currentVersionId` 指向 AgentVersion，使用整数 `revision` 做乐观并发；不再使用 `agents.version` 整数作为版本引用。M1 同时落 AgentVersion 行与 RunConfigSnapshot，Run 固定 `agentVersionId` 与 `configSnapshotId` 两者。
5. **归档与克隆里程碑**：M1 起 Agent 的 `DELETE` 为确认 + 阻止 + 归档；M2.1 起 30 天恢复窗口；克隆放 M2。UI-062 与 02-domain-model AGENT-007 需按此回写。
6. **role 与 roleTemplateId**：role 是独立的协作分类字段，取值为 general/ui_design/frontend/backend/devops/custom；roleTemplateId（旧名 templateKey）只记录来源。role 不直接授予权限，权限仍由权限信封执行。旧数据迁移默认 `general`。
7. **Runtime 权限模式**：作为 M1 的 Agent 配置项 `permissionMode`，默认受控编辑；完全授权必须显式开启并警示。
8. **快照时点**：Run 创建（入队）时快照，执行期只读，结束后不得补写。
9. **活跃 Run 定义**：`preparing` 或 `running` 为活跃；存在活跃 Run 时禁止归档/删除并返回 409；仅存在 `queued` 时由系统取消并记录 `agent_archived`。
10. **生产动作**：任何里程碑都不由 Agent 执行生产部署；按 9.4.1 的命令、凭据、路径与环境清单硬拦截，不存在「审批后由 Agent 执行生产」的路径。
11. **Runtime 能力**：只对声明支持的 Runtime 承诺实时路径/命令拦截；不支持的 Runtime 降级为事后审计并进入人工复核，UI 显示隔离等级（A/B/C 级）。

### 19.2 需要回写的跨文档清单

| 文档 | 需要修改的内容 | 原因 |
| --- | --- | --- |
| `prd/02-domain-model.md` | AGENT-004（AgentVersion）与 AGENT-007（归档）的里程碑；role 枚举补 `custom`；allowedPaths/allowedCommands 的空数组语义；Agent 字段补 `permissionMode`、`envAllowlist`、`credentialRefs`、`networkAccess`、`revision` | 与本章 4.4/4.5 及 M1-local-loop 对齐 |
| `prd/modules/ui-ux.md` | UI-062（删除/归档）从 M1 调整为 M2；UI-061（编辑）保留 M1 但标注为次要项；UI-063（克隆）保持 M2；并发/超时的数值范围（UI 写 1–10 / 1–480，本章与 API 采用 1–16 / 1–1440）；允许命令编辑器 | 避免 UI 与 API 校验及里程碑不一致 |
| `prd/modules/runtime-and-workspace.md` | RUN-025 的里程碑标注（M1/M3）与「Agent 级并发 M2」统一；快照时点写作「Run 创建」而不是「启动」 | 与 AC-AGENT-04/AC-RUN-07 和本章 8.1/8.5 对齐 |
| `prd/milestones/M1-local-loop.md` | 本地需求编号加 `M1-` 前缀；US-M1-09 的「启动时」措辞明确为「创建时」；`failureCode` 术语与领域模型的 `errorCode` + `failureDetail` 统一 | 消除编号、快照时点与失败码术语歧义 |
| `prd/04-acceptance-and-test-plan.md` | §11 第 3 条「空 allowedPaths 冲突」已由本章裁决，可标记解决；补充空路径负向验收、生产动作拒绝、排队期间快照三个用例；AC-AGENT-04/AC-RUN-07 的并发里程碑措辞统一 | 验收需要可判定 |
| `prd/modules/api-and-data.md` | 该文档当前把 `agents` 的 `status`/`archived_at`/`current_version_id` 与 AgentVersion、`/agents/{id}/archive` 放在 M1，需按 M1-local-loop 的裁决调整为 M2（或由范围评审改回 M1）；其 M1 `/api/v1/agents` 的 `role` 过滤也需与 role=M2 对齐；agents 表补 `workspace_id`、`revision`、`permission_mode`、role、`env_allowlist`、`credential_refs`、`network_access` 等字段；文档内部的 skills/agent_skills 早期摘要与 M2 详细表（`skill_versions`、`agent_skills.enabled/binding_order`）冲突，需收敛为详细表定义 | 消除 M1 范围与 schema 双重定义冲突 |
| `prd/modules/security-and-permissions.md` | 将「`agent-and-configuration.md`（规划中）」改为引用 `prd/modules/agent-system.md`；权限模式字段名与本章 `permissionMode` 对齐 | 消除规划文档名与死链 |
| `prd/milestones/M2-role-agents.md` | 确认 AGENT-032 至 AGENT-042 引用的是本章模块编号；role 与模板变量 schema 的字段名 | 防止编号歧义 |

### 19.3 仍待确认

以下问题不阻塞 M0/M1，但必须在对应里程碑前定稿：

1. **模板市场信任策略（M4）**：签名是否强制、是否允许社区上传。默认建议：签名可选但展示来源与哈希，导入必须确认权限差异，不自动执行模板脚本。
2. **工作时间的时区与例外（M4）**：团队统一时区、个人使用本机时区；手动启动是否始终允许。默认建议：默认允许手动启动，管理员可关闭该例外。
3. **Codex 适配器能力与时间点（M2）**：Codex 的权限模式、沙箱与命令控制能否映射到统一权限信封。默认建议：M2 提供能力探测与差异提示，无法等价映射的配置在启动前拒绝。
4. **团队 Agent 所有权转移（M3）**：成员离职或项目交接。默认建议：仅管理员可转移，转移写审计，原所有者保留只读历史。
5. **删除与快照保留期限（M2/M3）**：硬删除后 RunConfigSnapshot 保留多久。默认建议：快照随 Run 生命周期保留；清除 Agent 配置不影响 Run 的只读快照。
6. **数值范围分歧**：`ui-ux.md` 写并发 1–10、超时 1–480，本章与 API 采用 1–16、1–1440。默认建议：以本章/API 为准，UI 仅做输入约束与提示；评审时统一。
7. **M1 是否保留基础编辑表单**：本章把它列为 M1 次要项；若 M1 排期紧张，可只保留 API PATCH。默认建议：保留最简编辑，不阻塞 M1 退出。
8. **AgentVersion 是否提前到 M1**：本章按 M1-local-loop 放在 M2。若团队认为版本历史是审计必需，必须先修改 M1 里程碑的数据模型与退出标准，再回写本章。

### 19.4 已知但尚未产品化的实现细节

以下行为可在代码中验证，但尚未形成完整产品契约，进入对应里程碑前必须补齐并纳入测试：

- CORS 反射任意 Origin、WebSocket 放行任意来源：M1 起收紧，详见 `security-and-permissions.md`。
- 调度器队列满时仅记录警告、Run 永久停留 queued：M1 起恢复队列并给出可读原因，详见 `runtime-and-workspace.md`。
- claude 适配器的退出码映射与取消宽限期：M1 起按 RUN-004/RUN-014 定义。
- 应用重启后 queued/running 的恢复策略：M1 起按 RUN-008 定义。
- 取消与超时的终态写入守卫：M1 起按 RUN-005 与 `runtime-and-workspace.md` §11.5 定义。
