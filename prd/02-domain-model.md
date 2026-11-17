# 领域模型与状态机

## 本章导读

本章是 ATeam 产品需求文档的领域语义基线。它回答四个问题：系统里有哪些核心实体；每个实体由谁创建、归谁所有、如何结束；Task、Run、Review、Approval、Crew 等对象允许哪些状态变化；不同里程碑如何在不破坏既有数据的前提下扩展模型。

阅读建议：产品与设计读者先读第 2、4、5 章，建立实体与状态的全景；工程读者重点读第 3、6、7、8 章，那里定义了字段、约束、ID、时间与事件；需要排期的读者可直接看第 14 章的里程碑矩阵与 M0 现状盘点。

本章使用统一标记：【M0 已实现】表示当前仓库代码已经具备该行为；【M0 部分】表示代码已有字段或骨架但语义不完整；【M1 计划】【M2 计划】【M3 计划】【M4 计划】表示尚未实现，仅在对应里程碑交付。任何未标注里程碑的字段或规则，默认属于 M1 计划。M0 的真实行为以仓库代码为准，本章不会把计划写成已实现。

### 文档优先级（全套 PRD 的唯一裁决顺序）

为避免多份文档各自自称最终权威，全套 PRD 采用以下唯一优先级：

1. 产品原则与产品级需求（`00-product-overview.md`）
2. 范围、安全不变量与发布门禁（`01-scope-and-roadmap.md`）
3. 领域语义（本章）
4. 模块细节（`modules/*.md`）
5. 里程碑执行与排期（`milestones/*.md`）

同一层级内，较新且明确标注「取代」「回写」的条款优先；低层文档不得覆盖高层约束。本章仅在**领域语义**范围内权威：实体名称、字段含义、状态取值、归属关系与不变量以本章为准；界面布局、HTTP handler 实现、具体 DDL、Runtime 命令细节由模块文档承载。发生冲突时按上述顺序裁决，并由较低层文档回写修正。

### 本版口径裁定：Workspace 与 Project

本章统一采用以下命名，后续全部实体、字段、表名、API 路径与迁移策略均以此为准：

- **Workspace（项目，`workspaceId`）**：产品级归属边界，绑定一个本地 git 仓库与其默认分支。M1 引入 `workspaces` 表；Task 与 Run 带 `workspaceId`；M3 支持多个 Workspace 与成员权限。界面文案称「项目」。
- **Run Workspace（运行工作区）**：某次 Run 的隔离执行环境。M0 为普通目录，M1 起为 git worktree 与独立分支；它不是聚合根，元数据记录在 Run 的 `workspaceState`、`branch`、`worktree`、`baseCommit`、`headCommit` 字段上。
- **Project / `projectId`（历史称谓）**：仅作为 API 输入别名保留（M1-M2 接受 `projectId` 并归一化为 `workspaceId`），不得出现在表名、字段名或事件规范载荷中。`/api/v1/projects` 是 `/api/v1/workspaces` 的兼容别名，返回同一资源。

唯一数据模型为：表 `workspaces`、字段 `workspace_id`、默认 Workspace 固定 ID `default`；其余实体主键使用 24 位小写 hex。第 2.3 节给出完整字段映射，第 15 章给出跨文档同步清单。

---

## 1. 目的、范围与非目标

### 1.1 目的与范围

本章覆盖 ATeam 本地优先多 Agent 开发驾驶舱的全部领域对象，包括：

- 产品级归属边界：Workspace。
- 任务与协作：Task、TaskDependency、Crew、CrewMember、CrewStep。
- 执行配置：Agent、AgentVersion、Skill、Deliverable（TaskContractVersion 旧名）。
- 一次执行及其隔离环境：Run、RunEvent、Run Workspace（Workspace）。
- 交付与证据：Artifact、Evidence。
- 人工把关：Review、ReviewComment、ReviewRun、MergeRecord、Approval。
- 分布式执行资源：Machine、Runner。

范围包含：字段定义、职责边界、生命周期、归属与删除规则、状态机、关键不变量、ID 与时间策略、领域事件、功能需求编号、异常边界、领域级安全约束、指标、依赖风险、里程碑映射。范围不包含：具体界面布局、具体 HTTP handler 实现、完整 SQL DDL、运行时适配器的命令细节，这些分别由模块文档与架构设计承载。

### 1.2 非目标

以下内容不属于本章，也不属于近期里程碑：

- 不做通用工作流引擎。Task、Run、Review、Approval、Crew 的状态集合是产品内置的固定集合，不支持用户自定义状态机。
- 不做完整事件溯源（Event Sourcing）。事件用于通知、审计和调试，聚合根当前状态仍以关系表为准。
- 不做跨 Workspace 的任务依赖或 Agent 共享。M3 之前所有实体严格限定在单一 Workspace 内；M3 的共享仍受成员权限约束。
- 不做多 Agent 在同一会话中自由聊天的协作模型。角色 Agent 的协作必须经过任务 DAG、交付物契约、证据与人工评审。
- 不做模型托管、模型转售或密钥代管。Runtime 与模型密钥均由用户自带（BYO Runtime/Key）。
- 不在 M1/M2 引入多租户 SaaS 模型。M3 的团队模式仍以单组织、多成员、可多 Workspace 为边界。
- 不在本章重复定义性能、安全与 UI 的阈值。相关条目引用 `modules/non-functional-requirements.md`、`modules/security-and-permissions.md` 与 `modules/ui-ux.md` 的权威编号。

### 1.3 读者与用法

| 读者 | 关注重点 | 使用方式 |
|---|---|---|
| 产品经理 | 实体职责、状态流转、异常边界、里程碑 | 用第 2、4、5 章对齐需求，用第 9 章编写验收用例 |
| 后端工程师 | 字段、约束、不变量、事件、迁移 | 用第 3、6、7、8 章设计与实现 |
| 前端工程师 | 状态展示、允许的操作、乐观更新边界 | 用第 4 章决定按钮可用性，用第 8 章决定刷新策略 |
| 设计师 | 看板列、状态语义、空态与阻塞提示 | 用第 4 章与第 11 章设计交互 |
| 决策者 | 范围、风险、演进成本 | 用第 13、14 章评估投入与取舍 |

### 1.4 术语约定

| 术语 | 含义 |
|---|---|
| Workspace | 产品级项目，绑定一个本地 git 仓库与默认分支，是 Task、Run 等实体的归属边界；字段为 `workspaceId`。`projectId` 仅为 M1-M2 的输入别名 |
| Run Workspace | 某次 Run 的隔离执行环境，M0 为普通目录，M1 起为 git worktree 与分支 |
| Task | 上下文容器，描述要做什么、验收标准是什么、由谁负责 |
| Agent | 可复用的工作配置，包含 instructions、runtime、model、权限与超时 |
| AgentVersion | Agent 在某一时刻的不可变快照，Run 创建时固定引用 |
| Run | Agent 针对 Task 的一次执行，拥有独立 Run Workspace 与事件流 |
| Artifact | Run 产出的不可变交付物，如 diff、测试报告、截图、日志 |
| Evidence | 将 Artifact 绑定到 Task 交付物契约条目的证据记录（M2） |
| Review | 人类对一次或多次 Run 交付物的评审 |
| MergeRecord | M1 的一次合并尝试与结果的审计记录，不是审批实体 |
| Approval | 针对某个具体高风险动作的一次性人工审批（M2） |
| Deliverable | 交付物契约及其冻结版本（M2）；旧概念名 TaskContractVersion，数据层统一为 `deliverables` + `contract_versions` |
| Crew | 任务级的角色编排方案，M2 后段交付，不等于自由聊天 |
| Machine | 物理或虚拟执行机器 |
| Runner | 运行在 Machine 上、代表某个 Workspace 接收 Run 的执行代理 |

---

## 2. 领域模型总览

### 2.1 设计原则

**原则一：Workspace 是唯一产品级归属边界。** Task、Run 以及由它们派生的 Artifact、Review、MergeRecord 必须能追溯到某个 Workspace；Task 与 Run 在 M1 起带 `workspaceId`。Agent 在 M1-M2 是安装级共享配置，M3 起纳入 Workspace/团队归属。M0 还没有 `workspaces` 表，但所有数据事实上属于一个隐式默认 Workspace；M1 引入显式字段并回填；M3 才允许一个安装实例拥有多个 Workspace。

**原则二：Task 是上下文容器，不是一次执行。** Task 保存目标、描述、验收标准、交付物契约、依赖关系与状态；一次 Task 可以被多次 Run 尝试，也可以被多个角色 Agent 分阶段完成。把「任务」和「执行」混在一起，会导致重试、评审和并行协作全部失去落点。

**原则三：Agent 是持久配置，AgentVersion 是不可变快照。** 用户随时可以修改 Agent 的 instructions、model 或权限，但已经开始的 Run 必须继续使用创建时的配置。否则同一份证据无法复现，也无法解释某次 Run 为什么越权。

**原则四：Run 必须同时关联 Task 与 Agent，且三者不得跨 Workspace。** 没有 Task 的 Run 是孤立进程，没有 Agent 的 Run 无法解释配置来源。Task 与 Run 在 M1 起必须带 `workspaceId`；Agent 在 M1-M2 是安装级可复用配置，M3 起增加 `workspaceId` 与可见性。

**原则五：隔离优先于便利。** 每个 Run 使用独立 Run Workspace；M0 只是目录隔离，M1 升级为 git worktree 与独立分支。任何跨 Run 的文件共享都必须显式声明，不能默认发生。

**原则六：人工评审是完成定义的一部分。** Agent 执行成功只代表 Run completed，不代表 Task done。只有证据齐备、人类评审通过，Task 才能进入 done；合并、推送、部署、删除等高风险动作必须经过人工确认；M1 使用 Review + MergeRecord 的轻量确认，M2 起升级为 Approval。

**原则七：追加事件，而不是覆盖历史。** RunEvent 与领域事件只追加不修改；实体当前状态可以更新，但每次关键变化都要留下事件。M0 已持久化 RunEvent，Task/Agent 事件仍只走 WebSocket，M1 起补齐可检索的事件记录。

**原则八：先并行任务，后同任务 Crew。** 产品优先让一个开发者同时推进多个 Task，每个 Task 一个活跃 Run；同一 Task 内的多角色 Crew 与队长模式后置，避免过早引入复杂的会话编排。

### 2.2 实体关系

```text
Workspace（项目）
  ├── Task 1 ─── * Run
  │      │            ├── 1 Run Workspace (worktree / branch)
  │      │            ├── * RunEvent
  │      │            └── * Artifact ─── * Evidence
  │      ├── * TaskDependency (Task 自关联 DAG)
  │      ├── 0..1 Deliverable (M2，契约与版本)
  │      ├── * Review ─── * ReviewComment
  │      │      └── 0..* ReviewRun (M2；M1 为 Review.runId)
  │      └── 0..1 Crew ─── * CrewMember
  │                    └── * CrewStep (M2 后段)
  ├── * Approval (M2)
  ├── * MergeRecord (M1，合并审计)
  ├── * Skill
  └── * Runner ─── 1 Machine (M3)

Agent 1 ─── * AgentVersion（M1-M2 安装级；M3 起可归属 Workspace）
Agent ─── * AgentSkill ─── Skill
```

关系说明：

- Workspace 对 Task、Run、Review、MergeRecord、Approval、Skill、Crew、Runner 均为一对多；Artifact、Evidence 通过 Run/Task 归属 Workspace。
- Task 对 Run 为一对多；一个 Task 可以重试多次，M1 同一时刻最多一个活跃 Run。
- Run 对 Artifact、RunEvent 为一对多；Artifact 不可脱离 Run 存在。
- Review 与 Run 为多对多（M2 起一次评审可聚合多个角色 Run，通过 ReviewRun 关联）；M1 简化为一次 Review 绑定一个 Run。
- TaskDependency 是 Task 的自关联，只表达完成先后，不表达父子层级；父子层级用 `parentId`。
- Crew 是 Task 级编排方案，成员引用 Agent 与角色，不拥有独立会话。
- Runner 属于 Machine，同时绑定 Workspace；M0 只有隐式本地 Runner。
- `EvidenceItem` 是旧稿名称，统一改称 Evidence；`environment` 不是实体，部署环境通过 Approval 的 `actionParams.environment` 表达。

### 2.3 Workspace 与 Run Workspace 两级语义

「Workspace」在 ATeam 中指产品级实体，与「Run Workspace」严格区分：

**Workspace（项目，`workspaceId`）**：顶层归属边界，绑定一个本地 git 仓库路径与默认分支。Task、Run 必须带 `workspaceId`；Artifact、Review、MergeRecord、Approval、Skill、Crew 通过父实体归属 Workspace。它回答「这些数据属于哪个项目」。M0 尚未建表，所有数据属于隐式默认 Workspace（固定 ID 为 `default`）；M1 建表并回填；M3 支持多个 Workspace 与成员权限。

**Run Workspace（运行工作区）**：某次 Run 的隔离执行环境。M0 由 `internal/workspace.Manager` 在 `{dataDir}/workspaces/runs/{runId}` 下创建普通目录；M1 升级为基于 Workspace 仓库的 git worktree，默认位于 `~/.ateam/worktrees/{repoSlug}/{runId}`，并创建独立分支。它回答「这次执行在哪里改代码」。它不是聚合根，生命周期跟随 Run，元数据记录在 Run 的 `workspaceState`、`branch`、`worktree`、`baseCommit`、`headCommit` 字段上；M2 如需租约或清理队列，可增加 `run_workspaces` 附属表，但不得把 Run Workspace 当作产品级归属实体。

**跨文档映射**：

| 旧表述 | 本版统一表述 | 说明 |
|---|---|---|
| 旧稿 Project / `projectId`（产品级） | Workspace / `workspaceId` | 顶层归属边界；`projectId` 仅作 M1-M2 API 输入别名 |
| 旧稿产品级 `projects` 表 | `workspaces` 表 | 不建 `projects` 表 |
| `tasks.project_id` | `tasks.workspace_id` | M1 迁移 |
| `runs.project_id` | `runs.workspace_id` | M1 迁移 |
| 默认 Workspace 的 `000000000000000000000001` | `default` | 固定短 ID，其余实体仍为 24 位 hex |
| Workspace（执行环境） | Run Workspace | 仅指 per-Run 隔离环境 |
| M1 旧稿 `localPath` | `Workspace.repoPath` | 字段别名，迁移时统一 |
| M1 旧稿 `baseBranch` | `Workspace.defaultBranch` | 字段别名，迁移时统一 |
| M1 旧稿 `verifyCommand` | `Workspace.verificationCommands[0]` | 支持多命令 |
| task-management 的 `workspaceId` M3 | `workspaceId` M1 | 以 M1 里程碑与本章为准 |
| agent-system 无项目字段 | M1-M2 安装级共享；M3 增加 `workspaceId` 与 `visibility` | 明确为有意设计，不是遗漏 |

界面把 Workspace 称为「项目」，把 Run Workspace 称为「运行工作区」或「工作区」，并在首次出现时给出解释。除该 UI 文案与 API 输入别名外，不得再用「Project」指代产品级实体。

### 2.4 实体实现状态总表

| 实体 | M0 状态 | M0 载体 | 首个计划里程碑 |
|---|---|---|---|
| Workspace | 隐式存在 | 无表，仅配置中的 dataDir | M1 |
| Task | 已实现 | `tasks` 表、`domain.Task` | M0 |
| TaskDependency | 未实现 | 无 | M2 |
| Agent | 已实现 | `agents` 表、`domain.Agent` | M0 |
| AgentVersion | 未实现 | 无，Run 不固定版本 | M1 |
| Run | 已实现 | `runs` 表、`domain.Run` | M0 |
| RunEvent | 已实现 | `run_events` 表、`domain.RunEvent` | M0 |
| Run Workspace | 部分实现 | 每次 Run 一个普通目录 | M1 升级 worktree |
| Artifact | 未实现 | 无 | M1 |
| Evidence | 未实现 | 无 | M2（M1 的 DoD 基于 Artifact 与人工例外） |
| Review | 未实现 | 无 | M1 |
| ReviewComment | 未实现 | 无 | M1 |
| ReviewRun | 未实现 | 无 | M2 |
| MergeRecord | 未实现 | 无 | M1 |
| Approval | 未实现 | 无 | M2 |
| Deliverable（TaskContractVersion 旧名） | 未实现 | 无 | M2 |
| Skill | 未实现 | 无 | M2 |
| Crew | 未实现 | 无 | M2 后段 |
| CrewMember / CrewStep | 未实现 | 无 | M2 后段 |
| Machine | 隐式本地机 | 无 | M3 |
| Runner | 隐式本地执行 | 调度器内 worker | M3 |

---

## 3. 核心实体定义

### 3.1 Workspace（项目）

**职责**：定义项目边界、仓库位置、默认分支、验证命令与执行策略。它是所有权限检查、数据隔离与归档操作的顶层单位。M0 没有这个实体，但所有数据事实上已经处在一个隐式默认 Workspace 中。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 自动生成；默认 Workspace 固定 `default` | 主键 | M1 |
| name | string | 是 | 仓库目录名 | 显示名，1-80 字符 | M1 |
| repoPath | string | 是 | 用户选择 | 本地 git 仓库绝对路径，规范化后存储 | M1 |
| defaultBranch | string | 是 | `main` | 新 Run 的基线分支 | M1 |
| remote | string | 否 | `origin` | M1 仅支持一个 remote | M1 |
| worktreeRoot | string | 否 | `~/.ateam/worktrees` | Run Workspace 根目录 | M1 |
| verificationCommands | string[] | 否 | `[]` | 系统复跑验证命令；M1 取第一条作为 `verifyCommand` | M1 |
| protectedBranches | string[] | 否 | `["main","master"]` | 禁止直接推送、必须走合并门的分支 | M1 |
| taskPrefix | string | 是 | `AT` | 人类可读任务编号前缀，2-6 个大写字母 | M2 |
| settings | JSON | 否 | `{}` | 并发上限、默认 runtime、审批 TTL、保留策略、分支模板 | M1 |
| status | enum | 是 | `active` | `active`、`archived` | M1 |
| createdBy | string | 否 | 空 | 创建者；M3 起必填 | M3 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M1 |
| updatedAt | timestamp | 是 | 创建/更新时 | UTC 毫秒 | M1 |
| archivedAt | timestamp | 否 | 空 | 归档时间 | M1 |

**生命周期**：创建时校验 `repoPath` 存在、为绝对路径且是 git 工作树根目录；`active` 期间可创建 Task、Agent、Run；归档后只读，不能创建新 Task 或 Run，历史数据保留；彻底删除 Workspace 属于高风险动作，M3 起必须走 Approval，并按保留策略处理 Artifact 与事件。

**归属与删除**：Workspace 是根实体，无上级归属。M1 单 Workspace 模式下禁止删除默认 Workspace；M3 多 Workspace 模式下，只有 owner 可归档，删除需要二次确认与 Approval 记录。`repoPath` 在 M1 创建后不可原地修改；如需迁移仓库位置，M3 提供显式重新绑定流程（DM-PROJ-005），要求没有活跃 Run、重新校验分支，并记录审计事件。M1 仅允许在无活跃 Run 时修改 `defaultBranch`、`remote`、`worktreeRoot`、`verificationCommands` 与 `settings`。

### 3.2 Task

**职责**：Task 是上下文容器，承载目标、背景、验收标准、交付物契约、优先级、负责人和状态。它不是一次执行，也不是一段聊天记录。Agent 通过 Run 读取 Task 的上下文；Review 以 Task 为单位判断是否完成。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M0 |
| workspaceId | string | 是 | 默认 Workspace `default` | 归属 Workspace | M1 |
| key | string | 否 | 自动生成 | 人类可读编号，如 `AT-42`，同 Workspace 唯一 | M3（评估） |
| title | string | 是 | 无 | M0 仅校验 trim 后非空，无长度上限；1-200 字符是 M1 目标 | M0 非空；M1 长度 |
| description | string | 否 | 空字符串 | Markdown 上下文；M0 无长度限制，M1 起 64 KiB 上限 | M0 基础；M1 限制 |
| status | enum | 是 | `backlog` | 见 4.2 状态机 | M0 |
| priority | integer | 是 | `0` | 0 无、1 低、2 中、3 高、4 紧急；M0 接受任意整数，M1 校验 0-4 | M0 字段；M1 校验 |
| assigneeType | enum | 是 | 空字符串 | `''`、`human`、`agent`、`crew` | M0 |
| assigneeId | string | 否 | 空字符串 | 对应 Human、Agent 或 Crew 的 ID | M0 |
| parentId | string | 否 | 空字符串 | 父 Task，表达子任务层级，不表达依赖；M0 无校验 | M0 字段；M1 校验 |
| labels | string[] | 是 | `[]` | 自由标签；M0 无任何校验；M1 起单标签最长 32 字符、最多 20 个 | M0 字段；M1 校验 |
| acceptanceCriteria | object[] | 否 | `[]` | 验收标准 checklist，每项含 `text`、`done`、`doneBy`、`doneAt` | M1 |
| blockedReason | string | 否 | 空 | 进入 blocked 的必填原因；M0 无此字段 | M1 |
| deliverableContract | JSON | 否 | 空 | 交付物契约，见 5.2；旧名 `contract` 废弃 | M2 |
| currentContractVersionId | string | 否 | 空 | 当前生效的契约版本（Deliverable 的 `contract_versions` 行） | M2 |
| revision | integer | 是 | `1` | 乐观锁版本号，每次更新加一；模块文档旧名 `version` 指同一字段 | M1 |
| createdBy | string | 否 | 空 | 创建者；M0 无身份系统，M3 起必填 | M3 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M0 |
| updatedAt | timestamp | 是 | 创建/更新时 | UTC 毫秒 | M0 |
| archivedAt | timestamp | 否 | 空 | 归档时间 | M1 |

**生命周期**：创建后默认 `backlog`；被人工或规则移入 `todo` 后具备执行资格；创建 Run 后进入 `in_progress`；Run 完成且证据齐备后进入 `in_review`；Review 通过且必要的高风险动作完成后进入 `done`。任何非终态都可被人工取消进入 `cancelled`；遇到外部阻塞进入 `blocked`。`done` 与 `cancelled` 是正常终态，但允许有审计记录的重开。

**归属与删除**：Task 必须属于一个 Workspace，父 Task 必须属于同一 Workspace。M0 的删除是硬删除，且不检查是否存在 Run；M1 起，删除前必须没有活跃 Run、没有未关闭 Review，否则返回 409 并建议归档。归档 Task 保留全部 Run、Artifact 与事件，只是默认列表不再展示。

**子任务与依赖的区别**：`parentId` 表示「这个任务属于哪个更大的任务」，用于拆解与展示；TaskDependency 表示「这个任务必须等另一个任务完成」，用于调度。两者不能混用，父子关系不隐含依赖，依赖也不改变父子树。

### 3.3 TaskDependency

**职责**：表达任务之间的完成先后关系，是角色 Agent 协作的调度基础。M2 先支持 `finish_to_start`：上游 Task 进入 done 后，下游才具备执行资格。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M2 |
| workspaceId | string | 是 | 无 | 两条 Task 必须同属该 Workspace | M2 |
| taskId | string | 是 | 无 | 下游 Task | M2 |
| dependsOnTaskId | string | 是 | 无 | 上游 Task | M2 |
| type | enum | 是 | `finish_to_start` | M2 仅此一种；`artifact_ready` 与 `approval` 为预留，不在 M2 实现 | M2 |
| requiredArtifactKinds | string[] | 否 | `[]` | 上游必须产出的 Artifact 类型；为空表示只看 Task done | M2 |
| createdBy | string | 否 | 空 | 创建者 | M2 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M2 |

**约束**：`taskId` 与 `dependsOnTaskId` 不得相同；同一对 Task 只能有一条依赖；任何时候不允许出现环；两端 Task 必须属于同一 Workspace。删除依赖只删除边，不自动回退已经解锁的下游状态，是否重新阻塞由人工决定并记录事件。

**生命周期**：创建依赖时执行环检测；上游 Task 进入 done 时，系统检查下游的所有 `finish_to_start` 依赖是否都满足；全部满足则下游从 `blocked` 自动转为 `todo`，并发送 `task.unblocked` 事件。上游被取消时，下游保持 blocked 并记录原因，不自动开始。

### 3.4 Agent

**职责**：Agent 是可复用的工作配置，描述「用哪个 Runtime、什么模型、什么 instructions、多大的并发与超时、允许碰哪些路径与命令」。它不是一次执行，也不是模型本身。用户可以为 UI Design、Frontend、Backend、DevOps 分别建立 Agent，也可以建立一个通用 Agent。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M0 |
| workspaceId | string | 否 | 空 | M1-M2 为安装级共享，允许为空；M3 起团队 Agent 必填 | M3 |
| name | string | 是 | 无 | M0 仅校验 trim 后非空，无长度上限；1-80 字符是 M1 目标 | M0 非空；M1 长度 |
| description | string | 否 | 空 | 用途说明；M1 起最长 280 字符 | M0 字段；M1 限制 |
| instructions | string | 否 | 空 | Markdown 工作指令，进入 Run prompt；M1 起最长 64 KiB | M0 |
| role | enum | 是 | `general` | `general`、`ui_design`、`frontend`、`backend`、`devops`、`custom` | M2 |
| runtime | string | 是 | `mock` | `mock`、`claude`、`codex`（M2）；M0 未注册值回退 mock | M0 字段；M1 校验 |
| model | string | 否 | 空 | Runtime 可识别的模型标识；M0 不传给适配器 | M0 字段；M1 生效 |
| workspaceMode | enum | 是 | `worktree` | `worktree`、`directory`；M0 存而不用 | M0 字段；M1 worktree |
| maxConcurrency | integer | 是 | `1` | 该 Agent 同时活跃 Run 上限；M0 不强制执行 | M0 字段；M2 执行 |
| timeoutMinutes | integer | 是 | `60` | 单次 Run 超时；M0 由调度器执行，M1 起 1-1440 校验 | M0 |
| allowedPaths | string[] | 是 | `[]` | 允许修改的路径，相对仓库根；M2 起空表示不可写任何路径（默认拒绝） | M0 存储，M2 执行 |
| allowedCommands | string[] | 是 | `[]` | 允许执行的命令模式；M2 起空表示仅只读检查 | M0 存储，M2 执行 |
| status | enum | 是 | `active` | `active`、`archived` | M2 |
| currentVersionId | string | 否 | 空 | 当前发布版本 | M1 |
| visibility | enum | 是 | `private` | `private`、`team`，M3 生效 | M3 |
| createdBy | string | 否 | 空 | 创建者 | M3 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M0 |
| updatedAt | timestamp | 是 | 创建/更新时 | UTC 毫秒 | M0 |
| archivedAt | timestamp | 否 | 空 | 归档时间 | M2 |

**生命周期**：创建时补默认值；被 Task 选中后用于创建 Run；归档后不能创建新 Run，但历史 Run 仍引用其旧版本；M2 起，角色模板可以实例化为 Agent，但实例与模板解耦，后续模板升级不自动改动已有 Agent。

**归属与删除**：Agent 在 M1-M2 是安装级可复用配置，不强制 `workspaceId`；M3 起，团队共享 Agent 必须带 `workspaceId` 与 `visibility`，只有 owner 或具备 `agent:write` 权限的成员可以编辑，且必须留下审计事件。M0 允许硬删除且不检查引用，可能留下指向不存在 Agent 的 Run；M1 起，删除前必须没有活跃 Run 或未关闭 Review，否则返回 409；通过校验后执行归档（写 `archivedAt`），M2.1 起提供 30 天恢复窗口，不提供硬删除。

**M0 行为说明**：当前 `internal/scheduler/scheduler.go` 只使用 `runtime`、`timeoutMinutes` 与 `instructions`；`model`、`maxConcurrency`、`allowedPaths`、`allowedCommands`、`workspaceMode` 均未实际生效。`runtime` 未注册时回退到 mock。这是 M0 的已知简化，M1 起逐步落地版本固定与权限执行。

### 3.5 AgentVersion

**职责**：保存 Agent 在某一时刻的完整执行配置，保证 Run 可复现、可解释、可审计。Agent 是可编辑的当前态，AgentVersion 是不可变历史。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M1 |
| agentId | string | 是 | 无 | 所属 Agent | M1 |
| versionNumber | integer | 是 | 从 1 递增 | 同一 Agent 内单调递增 | M1 |
| snapshot | JSON | 是 | 无 | instructions、runtime、model、workspaceMode、timeout、权限、技能版本的完整快照 | M1 |
| contentHash | string | 是 | 计算得出 | 快照规范化后的 SHA-256，用于比对与审批绑定 | M1 |
| changeNote | string | 否 | 空 | 变更说明 | M1 |
| createdBy | string | 否 | 空 | 创建者；M0/M1 本地可为空 | M3 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M1 |

**生命周期**：M1 采用自动快照：任何会改变执行语义的 Agent 更新（instructions、runtime、model、权限、超时、技能）都会生成新版本；纯展示字段如 description 可不生成。Run 创建时固定 `agentVersionId`，之后 Agent 继续编辑不影响该 Run。M2 增加草稿/发布体验，只有已发布版本可被新 Run 选用；M1 的自动快照在数据层仍保留为已发布版本。

**归属与删除**：AgentVersion 属于 Agent，随 Agent 归档保留，不单独删除。历史 Run 必须始终能解析到当时的 AgentVersion；M3 若做数据清理，只能清理从未被 Run 引用的草稿版本。

### 3.6 Run

**职责**：Run 是 Agent 针对 Task 的一次执行。它拥有独立 Run Workspace、独立事件流、独立产物与独立的成功/失败结论。Run completed 只表示执行结束，不表示任务被接受。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M0 |
| workspaceId | string | 是 | 默认 Workspace `default` | 归属 Workspace，必须与 Task 一致 | M1 |
| taskId | string | 是 | 无 | 必须指向同 Workspace 的 Task | M0 |
| agentId | string | 是 | 无 | 必须指向可用 Agent；M3 起必须同 Workspace | M0 |
| agentVersionId | string | 否 | 空 | 创建时固定的 Agent 快照 | M1 |
| contractVersionId | string | 否 | 空 | 创建时固定的契约版本（Deliverable 的 `contract_versions` 行） | M2 |
| crewId | string | 否 | 空 | 所属 Crew，普通并行任务为空 | M2 |
| crewStepId | string | 否 | 空 | 所属 CrewStep，见 3.13 | M2 |
| attempt | integer | 是 | `1` | 同一 Task 的第几次尝试 | M1 |
| status | enum | 是 | `queued` | 见 4.3 状态机 | M0 |
| trigger | enum | 是 | `manual` | `manual`、`retry`、`schedule`、`webhook`、`dependency`、`crew` | M0 字符串，M1 枚举 |
| workspaceState | enum | 是 | `provisioning` | `provisioning`、`active`、`review`、`archived`、`removed`；M0 无此字段 | M1 |
| branch | string | 否 | 空 | Run 分支名，M1 起必填 | M0 字段，M1 使用 |
| worktree | string | 否 | 空 | Run Workspace 路径 | M0 |
| baseCommit | string | 否 | 空 | 基线 commit SHA | M1 |
| headCommit | string | 否 | 空 | 结束时 HEAD commit SHA | M1 |
| runtimeSessionId | string | 否 | 空 | Runtime 会话或进程标识 | M1 |
| runnerId | string | 否 | 空 | 执行该 Run 的 Runner | M3 |
| summary | string | 否 | 空 | 运行摘要，面向人类 | M0 |
| errorCode | string | 否 | 空 | 结构化错误码，见下表 | M1 |
| failureDetail | string | 否 | 空 | errorCode 的子分类 | M1 |
| error | string | 否 | 空 | 错误详情；M0 无截断，M1 起截断到 8 KiB | M0 字段；M1 限制 |
| metrics | JSON | 否 | `{}` | 耗时、token、工具调用次数等 | M2 |
| createdBy | string | 否 | 空 | 触发者 | M3 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M0 |
| queuedAt | timestamp | 否 | 创建时 | 进入队列时间 | M1 |
| startedAt | timestamp | 否 | 空 | 进入 running 时间 | M0 |
| endedAt | timestamp | 否 | 空 | 进入终态时间 | M0 |
| lastEventAt | timestamp | 否 | 空 | 最后一条事件时间 | M1 |
| cancelRequestedAt | timestamp | 否 | 空 | 取消请求时间 | M1 |

**错误码约定（全库唯一）**：`errorCode` 使用小写 snake_case，`failureDetail` 是其子分类；模块文档与 API 文档只能引用本表，不得新增同义顶层码。

| errorCode | 含义 | failureDetail | 可重试 |
|---|---|---|---|
| `runtime_error` | Runtime 或 Adapter 异常 | `runtime_missing`、`runtime_auth`、`runtime_unavailable`、`invalid_agent_config`、`adapter_crash`、`nonzero_exit`、`evidence_missing` | 视 detail 而定 |
| `timeout` | 超过 `timeoutMinutes` | `timeout` | 人工优先 |
| `workspace_error` | worktree/目录/仓库准备失败 | `workspace_provision_failed`、`git_error`、`submodule_unsupported`、`sparse_checkout_unsupported` | 视 detail 而定 |
| `permission_denied` | 路径或命令越权 | `path_denied`、`command_denied` | 否 |
| `invalid_task_state` | Task 不可执行或状态非法 | `task_not_executable` | 否 |
| `interrupted` | 执行被中断 | `app_restart`、`runner_lost`、`lease_expired` | 人工重试 |
| `internal_error` | 调度器、存储或证据写入内部错误 | `scheduler_internal`、`queue_rejected`、`artifact_write_failed` | 视情况 |
| `checks_failed` | 验证命令（测试/构建/lint）返回非零，但 Runtime 正常退出 | `test_failed`、`build_failed`、`lint_failed` | 人工判断 |
| `cancelled_by_user` | 用户取消（伴随 `cancelled` 状态） | `user_cancel` | 人工重试 |

旧写法 `invalid_agent`、`SERVER_RESTART`、`RUN_INTERRUPTED`、`runner_lost`（作为顶层码）均为历史别名：分别映射为 `runtime_error/invalid_agent_config`、`interrupted/app_restart`、`interrupted/app_restart`、`interrupted/runner_lost`。`checks_failed` 是独立顶层码，不再折叠为 `runtime_error/nonzero_exit`：它表示「Runtime 正常结束、验证命令未通过」，Run 状态为 `failed`，任务保持 `in_review` 或回到 `in_progress`，不自动 `done`；与 `04-acceptance-and-test-plan.md` §4.2 步骤 6「不得因检查失败自动判 Run 失败并直接完成」并不矛盾——Run 失败与任务完成是两层语义，任务层由 DoD 与人工确认决定。`runtime-and-workspace.md` 中的 `runtime_error/scheduler_internal` 归入 `internal_error/scheduler_internal`。`api-and-data.md` 的 `RUNTIME_NOT_FOUND`、`RUNTIME_EXIT_NONZERO`、`RUNTIME_TIMEOUT`、`RUNTIME_CANCELLED`、`WORKSPACE_PREPARE_FAILED`、`POLICY_DENIED`、`SERVER_RESTART`、`QUEUE_REJECTED`、`ARTIFACT_WRITE_FAILED`、`INTERNAL` 依次映射为 `runtime_error/runtime_missing`、`runtime_error/nonzero_exit`、`timeout/timeout`、`cancelled_by_user/user_cancel`、`workspace_error/workspace_provision_failed`、`permission_denied`（按 `path_denied`/`command_denied` 细分）、`interrupted/app_restart`、`internal_error/queue_rejected`、`internal_error/artifact_write_failed`、`internal_error/scheduler_internal`。`api-and-data.md`、`non-functional-requirements.md` 与 `runtime-and-workspace.md` 已按本表回写，不保留第二套枚举。

**生命周期**：创建后进入 `queued`；调度器领取后 `preparing`，准备 Run Workspace 与 Runtime；就绪后 `running`；Runtime 正常退出为 `completed`，异常、超时或权限拒绝为 `failed`，人工取消为 `cancelled`。终态不可修改；重试必须创建新 Run，`attempt` 加一，不能复用旧 Run。

**归属与删除**：Run 必须属于 Workspace，且 Task 必须同属该 Workspace；M3 起 Agent 也必须同属该 Workspace。Run 永不硬删除，作为审计与复现依据保留；Workspace 彻底删除时才按保留策略处理。

### 3.7 RunEvent

**职责**：记录 Run 执行过程中的日志、工具调用、文件变更、测试结果、产物与状态提示，是可观测性的最小单位。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M0 |
| runId | string | 是 | 无 | 所属 Run | M0 |
| seq | integer | 是 | 从 1 递增 | 同一 Run 内单调递增 | M0 |
| type | enum | 是 | `log` | `log`、`summary`、`status`、`tool_call`、`tool_result`、`file_change`、`test_result`、`artifact`、`error`、`permission_request`（M2） | M0 自由字符串，M1 枚举 |
| level | enum | 是 | `info` | `debug`、`info`、`warn`、`error` | M1 |
| source | enum | 是 | `system` | `stdout`、`stderr`、`system`、`adapter` | M1 |
| message | string | 否 | 空 | 人类可读文本；M0 无限制，M1 起单条超过 64 KiB 截断并标记 `truncated=true` | M0 字段；M1 限制 |
| payload | JSON | 否 | `{}` | 结构化数据 | M0 |
| truncated | boolean | 是 | `false` | 是否因超长被截断 | M1 |
| createdAt | timestamp | 是 | 记录时 | UTC 毫秒 | M0 |

**生命周期**：只追加，不修改，不删除；同一 Run 内 `seq` 严格递增且连续。M0 由调度器在内存中从 1 计数并发 `run.event` WebSocket 通知，同时写入 `run_events` 表，但没有 `(run_id, seq)` 唯一约束；M1 增加唯一约束，并支持按 `seqAfter` 分页拉取。M2 起对 message 与 payload 做密钥脱敏与大小截断。

### 3.8 运行工作区（Run Workspace）

**职责**：为每次 Run 提供隔离的文件系统与 git 状态，避免多个 Agent 同时修改同一工作树。M0 只是按 Run 创建目录，M1 才真正使用 git worktree。

**派生字段与记录**

| 项目 | 说明 | 里程碑 |
|---|---|---|
| workspaceState | `provisioning`、`active`、`review`、`archived`、`removed` | M1 |
| 路径 | M0 `{dataDir}/workspaces/runs/{runId}`；M1 `~/.ateam/worktrees/{repoSlug}/{runId}` | M0 目录，M1 worktree |
| 分支 | `ateam/{taskShort}/{slug}-{runShort}`；taskShort 取 Task ID 前 8 位，runShort 取 Run ID 前 6 位，slug 由标题生成、最长 32 字符；slug 为空时 `ateam/{taskShort}/{runShort}` | M1 |
| baseCommit | Run 创建时解析的基线 commit；M0 无 | M1 |
| headCommit | Run 结束时该分支 HEAD；M0 无 | M1 |
| lease | 同一 worktree 同时只允许一个 Run 使用；M0 无租约 | M1 逻辑租约，M3 持久化租约 |
| 清理 | 未合并且有改动的 worktree 不得自动删除；已合并或已放弃的默认保留 30 天，可配置；Artifact、Evidence 与 RunEvent 默认保留 90 天 | M1 |

**状态机**：

| 编号 | 从 | 到 | 触发者 | 守卫条件 | 副作用 |
|---|---|---|---|---|---|
| W-01 | （无） | provisioning | 调度器 | Run 进入 preparing | 创建目录或 worktree 占位 |
| W-02 | provisioning | active | 调度器 | fetch、worktree、分支创建成功 | 写入 worktree、branch、baseCommit |
| W-03 | provisioning | removed | 调度器 | 准备失败或取消 | 清理残留，Run 记录 `workspace_error` |
| W-04 | active | review | 调度器 | Run 进入终态 | 保留 worktree 供评审 |
| W-05 | review | archived | 系统或人类 | 评审完成、已合并或已放弃 | 进入保留期，等待 `run.workspace.cleaned` |
| W-06 | archived | removed | 系统或人类 | 保留期到期或显式删除 | 删除 worktree，保留路径与时间审计 |
| W-07 | provisioning/active/review | removed | 人类 | 显式确认，未合并改动需二次确认 | 记录操作者与原因 |

**冲突与失败**：合并冲突不改变 `workspaceState`，worktree 保持 `review`；冲突结果写入 MergeRecord，由人工解决或新建 Run。准备失败时 `workspaceState` 进入 `removed` 并保留错误现场摘要，不得把失败 worktree 标记为 `archived`。

**约束**：路径必须规范化并校验位于 Workspace 的 worktreeRoot 内，禁止 `..` 逃逸；分支名不得覆盖用户分支；worktree 准备失败时 Run 进入 `failed`，错误码为 `workspace_error`，不得继续启动 Runtime。M0 的 `workspace.Prepare` 忽略 `workspaceMode`，永远返回普通目录，这是 M0 的已知限制。

### 3.9 Artifact 与 Evidence

#### 3.9.1 Artifact（M1）

**职责**：Artifact 是 Run 产出的不可变交付物；M1 的完成判定直接基于 Artifact 类型与人工例外，不依赖 Evidence 表。没有 Artifact，评审只能看 Agent 的自述。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M1 |
| workspaceId | string | 是 | 无 | 归属 Workspace，必须与 Run 一致 | M1 |
| taskId | string | 是 | 无 | 冗余记录，便于按任务查询 | M1 |
| runId | string | 是 | 无 | 必须关联 Run | M1 |
| type | enum | 是 | 无 | `diff`、`test_report`、`log_bundle`、`note`、`file`（M1）；`screenshot`、`deploy_plan`、`ui_review`（M2）；`other` | M1/M2 |
| title | string | 是 | 无 | 展示名，1-200 字符 | M1 |
| contentType | string | 是 | 无 | MIME 类型 | M1 |
| size | integer | 是 | 无 | 字节数 | M1 |
| sha256 | string | 是 | 无 | 内容校验和 | M1 |
| storagePath | string | 是 | 无 | 相对 Artifact 根目录的路径，禁止逃逸 | M1 |
| origin | enum | 是 | `system` | `system`、`agent`、`human` | M1 |
| truncated | boolean | 是 | `false` | 是否因超长截断 | M1 |
| supersedesId | string | 否 | 空 | 被本 Artifact 替代的旧 Artifact | M1 |
| redactionState | enum | 是 | `none` | `none`、`pending`、`redacted` | M2 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M1 |

**生命周期与归属**：Artifact 只能由 Run 的系统采集、Adapter 事件或人工上传创建，创建后内容不可变；修正创建新 Artifact 并用 `supersedesId` 指向旧记录。Artifact 属于 Run，Task/Workspace 为冗余归属字段，必须与 Run 一致。Run 删除不级联删除 Artifact；Workspace 删除时按 90 天保留策略处理。`storagePath` 必须位于 `~/.ateam/artifacts/{runId}/` 下，拒绝绝对路径、`..` 与符号链接逃逸。

**容量**：单个 Artifact 默认硬上限 50 MiB，超限拒绝入库并产生告警事件；文本类证据（diff、日志、测试输出）单条超过 10 MB 时截断并标记 `truncated=true`，完整内容保留为 `log_bundle` 或外部引用。两个数值分别对应 50 MiB 单文件上限与 10 MB 文本截断阈值，不矛盾。

#### 3.9.2 Evidence（M2）

**职责**：Evidence 把 Artifact 绑定到 Task 交付物契约的某个条目，并记录人工或系统的验证结论。M1 不建 Evidence 表；M1 的 DoD 直接检查 Artifact 类型与人工例外理由。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M2 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M2 |
| taskId | string | 是 | 无 | 所属 Task | M2 |
| runId | string | 是 | 无 | 产出该证据的 Run | M2 |
| artifactId | string | 否 | 空 | 对应 Artifact；waived 或 manual_approval 时可为空 | M2 |
| criterionKey | string | 否 | 空 | 交付物契约中的条目键，如 `unit_tests` | M2 |
| type | enum | 是 | 无 | `unit_test`、`integration_test`、`lint`、`typecheck`、`build`、`screenshot_review`、`manual_approval`、`deployment_plan`、`api_contract`、`other` | M2 |
| status | enum | 是 | `missing` | `passed`、`failed`、`missing`、`waived`；表示 DoD 判定结果 | M2 |
| validity | enum | 是 | `valid` | `valid`、`unverified`、`invalid`；表示证据完整性校验结果，与 status 正交 | M2 |
| summary | string | 否 | 空 | 结果摘要或豁免理由 | M2 |
| sourceCommand | string | 否 | 空 | 产生证据的命令 | M2 |
| commit | string | 否 | 空 | 证据对应的 commit | M2 |
| capturedAt | timestamp | 否 | 空 | 采集时间 | M2 |
| verifiedBy | string | 否 | 空 | 验证者；人类评审者或系统 | M2 |
| verifiedAt | timestamp | 否 | 空 | 验证时间 | M2 |
| supersedesId | string | 否 | 空 | 被替代的旧 Evidence | M2 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M2 |

**生命周期与归属**：Evidence 由系统采集或人类评审创建，创建后不可编辑；修正必须创建新记录并通过 `supersedesId` 指向旧记录。`missing` 是 DoD 评估生成的占位状态，表示契约条目尚无对应 Artifact，不要求存在 Artifact；`validity` 表示证据本身是否可信（如命令与 RunEvent 不一致时为 `unverified`）。`collaboration-and-review.md` 旧字段 `evidence.status(valid/unverified/invalid)` 对应本表的 `validity`，不得再占用 `status`。API 层的旧取值按以下唯一映射归一化：`present → missing`、`verified → passed`、`rejected → failed`；`api-and-data.md` 必须同时暴露 `status` 与 `validity`，不得只保留旧三值。Evidence 属于 Run 与 Task，只能引用同 Task、同 Run 的 Artifact；Review approve 前，所有契约要求条目的 Evidence 必须为 `passed` 或 `waived`，且 `validity` 不得为 `invalid`。被 Review、MergeRecord 或 Approval 引用的 Evidence 不得物理删除，只能归档。

### 3.10 Review、ReviewComment 与 ReviewRun

**职责**：Review 是人类对 Run 交付物的正式评审，是 Task 进入 done 的必经门。M1 评审单次 Run 的 diff 与 Artifact；M2 可聚合多个角色 Run 的交付物，按契约逐项验收。ReviewComment 是评审意见，区分阻塞与非阻塞。ReviewRun 是 M2 的评审与 Run 关联表；M1 直接用 `Review.runId`。

**Review 字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M1 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M1 |
| taskId | string | 是 | 无 | 所属 Task | M1 |
| runId | string | 否 | 空 | M1 绑定的单个 Run；M2 改用 ReviewRun，本字段可空 | M1 |
| status | enum | 是 | `pending` | 见 4.5 状态机 | M1 |
| requestedBy | string | 否 | 空 | 发起人；系统自动发起时为空 | M1 |
| reviewerId | string | 否 | 空 | 领取评审的人类 | M1 |
| decisionNote | string | 否 | 空 | 通过或拒绝理由 | M1 |
| evidenceSnapshotHash | string | 否 | 空 | 评审时 Artifact/Evidence 集合的哈希，防止评审后替换证据 | M1 |
| requiresMerge | boolean | 是 | `true` | 通过后是否还需要合并确认 | M1 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M1 |
| startedAt | timestamp | 否 | 空 | 进入 in_review 时间 | M1 |
| decidedAt | timestamp | 否 | 空 | 决策时间 | M1 |
| supersededBy | string | 否 | 空 | 被哪个新 Review 取代 | M1 |

**ReviewComment 字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M1 |
| reviewId | string | 是 | 无 | 所属 Review | M1 |
| artifactId | string | 否 | 空 | 关联 Artifact | M1 |
| filePath | string | 否 | 空 | 关联文件 | M1 |
| line | integer | 否 | 空 | 行号 | M1 |
| severity | enum | 是 | `info` | `blocking`、`non_blocking`、`info` | M1 |
| body | string | 是 | 无 | 评论内容，非空 | M1 |
| resolvedAt | timestamp | 否 | 空 | 阻塞意见解决时间 | M1 |
| createdBy | string | 否 | 空 | 评论者 | M1 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M1 |

**ReviewRun 字段（M2）**：`id`、`reviewId`、`runId`、`createdAt`；对 `(reviewId, runId)` 唯一。M2 的一次 Review 至少关联一个 Run；M1 的 Review 通过 `runId` 绑定单个 Run。

**生命周期与归属**：Review 由系统在 Run 完成且证据齐备时自动创建，或由人类手动发起；属于 Task，M1 绑定一个 Run，M2 通过 ReviewRun 绑定多个 Run。只有人类可以做出 `approved` 或 `changes_requested`；Approve 前必须满足证据完整、无未解决 blocking comment、diff 可读且无冲突标记。Review 是终态或可被新 Review 取代；Review 通过不等于合并通过，M1 仍需 MergeRecord 记录人工合并，M2 起需要 Approval。

**ReviewComment 生命周期**：评论只追加，不物理删除；可以编辑正文并保留编辑记录（M2），阻塞评论通过 `resolvedAt` 标记解决。评论随 Review 保留，Workspace 删除时按审计保留策略处理。

### 3.11 Approval（M2）

**职责**：Approval 是对某个具体高风险动作的一次性人工授权。它绑定的不是「某个任务」或「某个 Agent」，而是「对某个目标、在某个版本上、执行某个动作」这一精确组合。M1 **不引入 Approval 实体**；M1 的合并使用 Review + MergeRecord + 显式确认。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M2 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M2 |
| actionType | enum | 是 | 无 | 以 `api-and-data.md` §5.9 的权威枚举为准：`merge`、`push`、`deploy_staging`、`deploy_prod`、`delete_task`、`delete_agent`、`delete_workspace`、`permission_escalation`、`command_allowlist_change`、`high_risk_command`、`contract_break`、`design_review`、`api_contract_review`、`crew_plan`、`scope_change`、`destructive_operation`、`organization_delete`、`owner_transfer`、`runner_revoke`、`secret_rotate`；本章不另立子集 | M2 |
| targetType | enum | 是 | 无 | `run`、`task`、`agent`、`workspace`、`machine`、`runner`；环境不是实体，放在 `actionParams.environment` | M2 |
| targetId | string | 是 | 无 | 目标实体 ID | M2 |
| actionParams | JSON | 否 | `{}` | 动作参数：commit、diff 哈希、环境、命令、资源快照等 | M2 |
| evidenceSnapshotHash | string | 是 | 无 | 审批时的证据集合哈希，决定只能基于该快照 | M2 |
| actionFingerprint | string | 是 | 计算得出 | `actionType + targetId + actionParams` 规范化后的 SHA-256 | M2 |
| summary | string | 是 | 无 | 人类可读动作摘要，展示给审批者 | M2 |
| riskLevel | enum | 是 | `high` | `low`、`medium`、`high` | M2 |
| requestedBy | string | 否 | 空 | 请求者 | M2 |
| status | enum | 是 | `pending` | `pending`、`approved`、`rejected`、`expired`、`cancelled`、`consumed`；见 4.6；`requested` 是 `pending` 的别名，`revoked` 是 `cancelled` 的别名 | M2 |
| decidedBy | string | 否 | 空 | 审批人 | M2 |
| decidedAt | timestamp | 否 | 空 | 决策时间 | M2 |
| reason | string | 否 | 空 | 通过或拒绝理由 | M2 |
| expiresAt | timestamp | 是 | 创建时计算 | 过期时间 | M2 |
| consumedAt | timestamp | 否 | 空 | 被消费时间 | M2 |
| consumedBy | string | 否 | 空 | 消费执行者 | M2 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M2 |

**约束**：指纹必须覆盖动作类型、目标 ID、commit SHA、diff 哈希、环境、命令或参数；目标内容变化导致指纹不匹配时，审批自动失效并返回 412；Approval 只能消费一次；Agent 身份不得创建或批准 Approval；`deploy_prod` 只生成审批记录与人工检查单，实际生产部署由人类在 ATeam 之外完成，ATeam 不自动执行。`targetType=environment` 不是合法值，旧稿中的该取值删除。

### 3.12 Skill

**职责**：Skill 是可复用的本地能力包，提供指令、检查清单或脚本入口，供 Agent 引用。M2 的 Skill 是本地文件与版本化配置，不做在线市场、不自动下载、不携带未审批的可执行二进制。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M2 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M2 |
| name | string | 是 | 无 | 展示名，1-80 字符 | M2 |
| slug | string | 是 | 无 | 同 Workspace 唯一，小写 kebab-case | M2 |
| version | string | 是 | `1.0.0` | 语义化版本 | M2 |
| description | string | 否 | 空 | 用途说明 | M2 |
| sourcePath | string | 是 | 无 | 本地目录或文件路径，必须在 Workspace 允许根内 | M2 |
| entryInstructions | string | 否 | 空 | 注入 Agent 的指令片段 | M2 |
| compatibleRoles | string[] | 否 | `[]` | 适用角色；空表示不限 | M2 |
| status | enum | 是 | `active` | `active`、`archived` | M2 |
| createdBy | string | 否 | 空 | 创建者 | M2 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M2 |
| updatedAt | timestamp | 是 | 更新时 | UTC 毫秒 | M2 |

**归属与生命周期**：Skill 属于 Workspace；Agent 通过 AgentSkill 关联并固定版本；Skill 更新不改变历史 Run 与已固定版本的 AgentVersion；归档 Skill 后不能新增引用，但已有引用继续可用。脚本类 Skill 必须显式列入 `allowedCommands` 并经过审批，不能因为被 Skill 引用就自动获得执行权限。

### 3.13 Crew、CrewMember 与 CrewStep

**职责**：Crew 是任务级的角色编排方案，用于同一个 Task 内协调 UI Design、Frontend、Backend、DevOps 等多个角色。Crew 不是多 Agent 共享会话，而是把角色拆成子 Task 与 Run，用 DAG、交付物契约与审批门连接。该实体在 M2 后段交付，且默认关闭，属于「先并行任务，后 Crew」策略的第二步。

**Crew 字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M2 后段 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M2 后段 |
| taskId | string | 是 | 无 | 父 Task，Crew 不跨任务 | M2 后段 |
| name | string | 是 | 无 | 编排名称 | M2 后段 |
| leadAgentId | string | 是 | 无 | 队长 Agent | M2 后段 |
| strategy | enum | 是 | `dag` | `dag`；`captain` 为后续实验能力 | M2 后段 |
| status | enum | 是 | `draft` | `draft`、`planning`、`plan_review`、`executing`、`aggregating`、`review`、`done`、`paused`、`blocked`、`cancelled`；见 4.8 | M2 后段 |
| budget | JSON | 否 | `{}` | 最大 Run 数、最大时长、最大重试次数 | M2 后段 |
| planContractId | string | 否 | 空 | Crew 计划对应的契约/审批对象 | M2 后段 |
| createdBy | string | 否 | 空 | 创建者 | M2 后段 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M2 后段 |
| startedAt | timestamp | 否 | 空 | 开始执行时间 | M2 后段 |
| endedAt | timestamp | 否 | 空 | 终态时间 | M2 后段 |

**CrewMember 字段**：`id`、`crewId`、`role`（`ui_design`、`frontend`、`backend`、`devops`、`custom`）、`agentId`、`agentVersionId`（可空）、`order`（同角色多实例序号）、`required`（失败是否阻塞整个 Crew）。成员必须同 Workspace 且引用固定 AgentVersion。

**CrewStep 字段（M2 后段）**：`id`、`crewId`、`stepKey`（同 Crew 唯一）、`role`、`taskId`（可空，关联子 Task）、`dependsOnStepIds`（string[]）、`order`、`status`（`pending`、`ready`、`running`、`done`、`failed`、`skipped`）、`createdAt`。CrewStep 是计划中的编排节点，不替代 Task；执行仍落到子 Task 与普通 Run。Run 的 `crewStepId` 引用本实体。

**约束**：Crew 与成员、步骤必须同 Workspace；每个成员通过创建子 Task 或明确关联的 Run 执行，不允许绕过 Review；队长只能编排与分派，不能代替人类审批，也不能自行合并；任一必需角色在重试上限后仍失败时 Crew 进入 `blocked`；预算耗尽进入 `paused`；队长 Run 失败进入 `blocked`。M2 的 DevOps 角色只能执行 staging 部署与生成生产部署计划，生产执行必须人工完成。

### 3.14 Machine 与 Runner

**职责**：Machine 表示一台执行机器；Runner 是运行在 Machine 上、代表某个 Workspace 接收 Run 的代理。M0 只有隐式本地执行：调度器在应用进程内起 worker，没有 Machine/Runner 记录。M3 引入远程 Runner，支持 2-10 人团队共享机器。

**Machine 字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M3 |
| name | string | 是 | 无 | 团队内唯一展示名 | M3 |
| os | string | 是 | 自动上报 | `darwin`、`linux`、`windows` | M3 |
| arch | string | 是 | 自动上报 | `arm64`、`amd64` | M3 |
| hostnameHash | string | 是 | 自动计算 | 主机名哈希，避免暴露原始主机名 | M3 |
| status | enum | 是 | `pending` | `pending`、`online`、`offline`、`draining`、`disabled` | M3 |
| labels | string[] | 否 | `[]` | 调度标签，如 `gpu`、`fast` | M3 |
| capabilities | JSON | 否 | `{}` | 可用 Runtime、版本、并发能力 | M3 |
| tokenHash | string | 是 | 无 | 注册令牌哈希，不存明文 | M3 |
| lastSeenAt | timestamp | 否 | 空 | 最近心跳 | M3 |
| registeredAt | timestamp | 是 | 注册时 | UTC 毫秒 | M3 |
| revokedAt | timestamp | 否 | 空 | 被停用（revoke）的时间；状态值为 `disabled` | M3 |

**Runner 字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M3 |
| machineId | string | 是 | 无 | 所属 Machine | M3 |
| workspaceId | string | 是 | 无 | 服务的 Workspace | M3 |
| mode | enum | 是 | `local` | `local`、`remote` | M3 |
| status | enum | 是 | `idle` | `idle`、`busy`、`draining`、`offline`、`disabled` | M3 |
| concurrency | integer | 是 | `1` | 可同时执行的 Run 数 | M3 |
| activeRunCount | integer | 是 | `0` | 当前活跃 Run 数 | M3 |
| version | string | 是 | 无 | Runner 版本 | M3 |
| protocolVersion | string | 是 | 无 | Runner 协议版本 | M3 |
| lastHeartbeatAt | timestamp | 否 | 空 | 最近心跳 | M3 |
| registeredAt | timestamp | 是 | 注册时 | UTC 毫秒 | M3 |

**生命周期与约束**：Machine 注册需要一次性 token，服务端只存哈希；`disabled`（对应动作 revoke）后拒绝心跳与新 Run。Runner 绑定 Workspace，只接收匹配 Runtime 与能力的 Run。心跳默认每 15 秒一次，连续 45 秒缺失判定 `offline`；租约 90 秒未续期视为过期。其上活跃 Run 置为 `failed`，`errorCode=interrupted`，`failureDetail=runner_lost` 或 `lease_expired`，不自动改派到其他机器，避免重复副作用。模型密钥只保存在 Runner 所在机器，不通过 ATeam 服务端传输或持久化。旧稿的 `revoked` 状态统一改为 `disabled`，`revoke` 保留为动作与事件名；旧稿的 `runner_lost` 顶层错误码统一改为 `interrupted/runner_lost`。

### 3.15 MergeRecord（M1，合并记录）

**职责**：MergeRecord 记录一次人工发起的合并尝试及其结果。M1 不引入完整 Approval Gate，合并门由 Review approved + 显式确认 + `expectedHeadCommit` 校验承担；MergeRecord 是这次合并的审计记录，不是授权本身。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M1 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M1 |
| taskId | string | 是 | 无 | 所属 Task | M1 |
| runId | string | 是 | 无 | 被合并的 Run | M1 |
| reviewId | string | 是 | 无 | 作为合并前置的 Review | M1 |
| approvalId | string | 否 | 空 | M2 起关联 Approval；M1 为空 | M2 |
| targetBranch | string | 是 | 无 | 目标分支 | M1 |
| sourceBranch | string | 是 | 无 | 源分支 | M1 |
| strategy | enum | 是 | `squash` | `squash`、`merge`、`rebase`；禁止 force merge | M1 |
| expectedHeadCommit | string | 是 | 无 | 请求时的源分支 head | M1 |
| commit | string | 否 | 空 | 合并产生的目标分支 commit | M1 |
| operator | string | 是 | 无 | 执行合并的人类 | M1 |
| result | enum | 是 | `pending` | `pending`、`merged`、`conflicted`、`failed`、`invalidated` | M1 |
| conflictFiles | string[] | 否 | `[]` | 冲突文件列表 | M1 |
| evidenceSnapshotHash | string | 是 | 无 | 合并时证据集合的哈希 | M1 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M1 |

**生命周期与归属**：MergeRecord 由人工合并请求创建，`result` 从 `pending` 进入终值；终值不可修改。一个 Run 可以有多条合并尝试记录，但最多一条 `result=merged`。Review 与 MergeRecord 的关系是「评审结论 + 合并结果」，不是审批；M2 起 Approval 成为合并前置授权，MergeRecord 继续记录执行结果并通过可空 `approvalId` 关联。M1 的历史 MergeRecord 不回填为 Approval，也不伪造审批记录。

**M1 合并门**：Review 状态为 `approved`；请求携带 `reviewId`、`expectedHeadCommit`、`targetBranch`、`strategy` 与显式 `confirm=true`；服务端校验证据快照哈希、目标工作区干净、目标分支 head 未偏离。`expectedHeadCommit` 或证据快照不匹配返回 412（`STALE_HEAD` / `STALE_EVIDENCE`），Review 状态或目标分支非法返回 409；任一不满足都不写 MergeRecord 的 `merged` 结果。合并策略只允许 `squash`、`merge`、`rebase`。

### 3.16 Deliverable（M2，交付物契约与冻结版本）

**职责**：保存 Task 交付物契约及其冻结版本，供下游任务、Run 与评审引用。唯一实体为 Deliverable（表 `deliverables`），历史版本在 `contract_versions`；旧概念名 TaskContractVersion 只是任务级冻结指针的称谓，不再单独建表。没有版本化，「历史 Run 固定引用当时契约版本」无法落地。

**字段**

| 字段 | 类型 | 必填 | 默认 | 说明 | 里程碑 |
|---|---|---|---|---|---|
| id | string(24 hex) | 是 | 服务端生成 | 主键 | M2 |
| workspaceId | string | 是 | 无 | 归属 Workspace | M2 |
| taskId | string | 是 | 无 | 所属 Task | M2 |
| revision | integer | 是 | 从 1 递增 | 同一 Task 内单调递增 | M2 |
| contract | JSON | 是 | 无 | `requiredEvidence`、`interfaces`、`acceptanceChecks`、`handoffNotes` | M2 |
| contentHash | string | 是 | 计算得出 | 契约规范化后的 SHA-256 | M2 |
| status | enum | 是 | `draft` | `draft`、`frozen`、`superseded`、`withdrawn` | M2 |
| frozenAt | timestamp | 否 | 空 | 冻结时间 | M2 |
| supersedesId | string | 否 | 空 | 被替代的旧版本 | M2 |
| createdBy | string | 否 | 空 | 创建者 | M2 |
| createdAt | timestamp | 是 | 创建时 | UTC 毫秒 | M2 |

**生命周期与归属**：M2 起，角色任务的契约变更必须创建新版本；冻结后不可原地修改。Run 创建时若 Task 有冻结契约，则固定 `contractVersionId`（指向 `contract_versions` 的版本）；历史 Run 永远解析到该版本，不随 Task 当前契约漂移。Task 的 `deliverableContract` 是当前版本的投影，`currentContractVersionId` 指向当前冻结版本。M1 不建此表，契约只作为评审附件。

---

## 4. 状态机

### 4.1 状态机建模约定

**显式状态**：所有状态都是有限枚举，存入数据库字符串列，不使用布尔字段拼装隐式状态。UI 只展示枚举内的状态，不推断「伪状态」。

**受控转换**：M1 起，状态变更必须经过领域服务或 API 的转换守卫；任何直接写库绕过守卫的行为都视为缺陷。M0 的 PATCH 接口可以自由设置 Task 状态，这是已知简化。

**转换记录**：每次成功转换都产生领域事件，至少包含实体 ID、原状态、新状态、操作者、时间与原因。M0 只对 Task 发出通用的 `task.updated`，M1 增加 `task.status_changed`。

**终态不可变**：Run 的 `completed`、`failed`、`cancelled`，Review 的 `changes_requested`、`superseded`、`cancelled`，Approval 的 `rejected`、`expired`、`cancelled`、`consumed`，Crew 的 `done`、`cancelled` 都是终态，不允许再转换。需要重做时创建新实体，而不是复活旧实体。

**乐观并发**：M1 起 Task、Agent、Review 带 `revision` 或状态前置条件；M2 起 Approval 带 `revision` 或状态前置条件。并发更新返回 409，由客户端刷新后重试。M0 没有并发控制，后写覆盖先写。

### 4.2 Task 状态机

**状态定义**

| 状态 | 含义 | 可创建 Run（M1 起） | 可编辑 | 终态 |
|---|---|---|---|---|
| backlog | 已记录，尚未准备就绪 | 否 | 是 | 否 |
| todo | 已就绪，可被 Agent 领取 | 是 | 是 | 否 |
| in_progress | 有执行发生或人类正在处理 | 是 | 是 | 否 |
| in_review | 等待人类评审 | 否（M0 例外，见下） | 是 | 否 |
| done | 已验收 | 否 | 仅重开前 | 是 |
| blocked | 被依赖或外部因素阻塞 | 否 | 是 | 否 |
| cancelled | 已放弃 | 否 | 仅恢复前 | 是 |

**M0 例外**：M0 的 `TaskStatus.Executable()` 把 `in_review` 视为可执行，这是既有实现；M1 起收紧为不可创建新 Run，评审中的补充执行必须先 `changes_requested` 回到 `in_progress`。M2 的返工允许从 `in_review` 创建新 Run，但必须先创建新 Review 或记录「取代旧评审」的原因，旧 Review 置为 `superseded`。

**转换表**

| 编号 | 从 | 到 | 触发者 | 守卫条件 | 副作用 | 里程碑 |
|---|---|---|---|---|---|---|
| T-01 | backlog | todo | 人类或系统规则 | title 非空；M2 角色任务必须有交付物契约 | 记录 `task.status_changed` | M1 |
| T-02 | todo | in_progress | 系统（创建 Run）或人类 | 无其他活跃 Run；Agent 可用 | 设置 assignee；创建 Run | M0 部分 |
| T-03 | in_progress | in_review | 系统（Run 完成且有证据）或人类 | 至少一个 completed Run；证据齐备 | 创建或复用 Review | M1 |
| T-04 | in_review | done | 人类（Review approve） | Review approved；若 requiresMerge 则合并已完成 | 记录验收时间 | M1 |
| T-05 | in_review | in_progress | 人类（changes_requested） | 存在 blocking 意见或拒绝理由 | 允许新 Run | M1 |
| T-06 | in_progress | todo | 人类（重新排队） | 无活跃 Run | 清除当前执行上下文 | M1 |
| T-07 | 任意非终态 | blocked | 人类或系统（不可恢复失败/依赖未满足） | 必须提供 blockedReason | 记录原因；停止派发 | M1（依赖型由 M2 自动触发） |
| T-08 | blocked | todo | 人类或系统 | 阻塞原因已解除 | 清除 blockedReason；记录事件 | M1 |
| T-09 | blocked | in_progress | 人类 | 原先已开始且原因解除 | 恢复执行上下文 | M1 |
| T-10 | 任意非终态 | cancelled | 人类 | 无活跃 Run，或先取消 Run | 记录取消原因 | M1 |
| T-11 | done | todo | 人类（重开） | 提供重开原因；M2 起要求权限 | 记录审计事件 | M2 |
| T-12 | cancelled | backlog | 人类（恢复） | 提供恢复原因 | 记录审计事件 | M2 |
| T-13 | in_progress | blocked | 系统（Run 以不可重试错误失败） | errorCode 属于 `permission_denied`、`invalid_task_state` 或不可重试的 `workspace_error` | 写入 blockedReason；保留 Run | M1 |
| T-14 | in_progress | in_progress | 系统（Run 失败或取消） | 失败可重试或用户取消 | 记录原因；不改变状态，允许重试 | M1 |

**说明**：M0 只实现了 T-02 的一半：创建 Run 时若 Task 为 `todo`，改为 `in_progress`；如果 Task 已是 `in_progress` 或 `in_review`，保持不变。M0 没有 T-03 的自动评审流，Run completed 后 Task 仍停留在 `in_progress`，需要人工通过 PATCH 改状态。M0 的 PATCH 可以执行任意状态跳转，不校验转换表，这是 M1 首要修复的领域缺口。

**状态展示语义**：`blocked` 不是错误，而是可解释的等待；界面必须显示阻塞原因与阻塞来源（依赖、人工、外部）。`in_review` 不表示「Agent 还在跑」，而表示「人类需要做决定」。`done` 不应在证据缺失时出现。

### 4.3 Run 状态机

**状态定义**

| 状态 | 含义 | 是否活跃 | 终态 |
|---|---|---|---|
| queued | 已创建，等待调度 | 是 | 否 |
| preparing | 正在准备 Run Workspace、版本快照与 Runtime | 是 | 否 |
| running | Runtime 正在执行 | 是 | 否 |
| completed | Runtime 正常结束 | 否 | 是 |
| failed | 准备失败、Runtime 异常、超时、越权或中断 | 否 | 是 |
| cancelled | 人工取消且已实际停止 | 否 | 是 |

**转换表**

| 编号 | 从 | 到 | 触发者 | 守卫条件 | 副作用 | 里程碑 |
|---|---|---|---|---|---|---|
| R-01 | queued | preparing | 调度器 | Task 可执行；Agent 活跃且版本已固定；并发未超限 | 设置 startedAt；准备 worktree | M0 部分 |
| R-02 | preparing | running | 调度器 | worktree 就绪；Runtime 已启动 | 设置 running 时间 | M0 |
| R-02b | preparing | running | 调度器 | 同上；M1 额外要求 | 记录 `runtimeSessionId` 与生效的 Runtime 版本 | M1 |
| R-03 | preparing | failed | 调度器 | 目录/worktree、分支或 Runtime 启动失败 | 设置 errorCode、failureDetail、endedAt | M0 基础，M1 分类 |
| R-04 | running | completed | 调度器 | Runtime 退出码为 0 且事件流正常关闭 | 设置 summary；M0 不生成 diff Artifact | M0 |
| R-04b | running | completed | 调度器 | 同上；M1 增加证据采集 | 采集 diff、changed files、测试输出并生成 Artifact；证据缺失按 DoD 降级 | M1 |
| R-05 | running | failed | 调度器 | 非零退出、超时、崩溃、越权或中断 | 记录 errorCode；保留诊断信息 | M0 基础，M1 分类 |
| R-06 | queued | cancelled | 人类或系统 | 条件更新成功，且调度器确认不会领取 | 设置 endedAt；记录 cancelRequestedAt | M0 有缺陷，M1 修复 |
| R-07 | preparing | cancelled | 人类 | 中断准备流程 | 清理未完成的 worktree 与分支 | M0 有缺陷，M1 修复 |
| R-08 | running | cancelled | 人类 | 先优雅终止，宽限期后强制终止 | 记录 cancelRequestedAt、endedAt；取消优先 | M0 部分，M1 修复 |
| R-09 | 终态 | 任意 | 禁止 | 无 | 重试创建新 Run | M1 |
| R-10 | queued | failed | 系统 | 启动前发现 Task/Agent 已删除或状态非法 | 记录 errorCode | M1 |
| R-11 | queued/preparing | cancelled | 人类 | 取消令牌或状态守卫确认 | 不产生 Runtime 进程 | M1 |
| R-12 | running | cancelled | 人类 | 进程组已终止 | 统一写 cancelled，不被 adapter 错误覆盖 | M1 |

**超时语义**：`timeoutMinutes` 到期属于执行失败，Run 进入 `failed`，`errorCode` 为 `timeout`，而不是 `cancelled`。人工取消才是 `cancelled`。两者在界面与统计上必须区分。

**M0 关键缺陷（按代码事实）**：`internal/api/handlers.go` 的 `cancelRun` 先调用 `scheduler.Cancel(run.ID)`，随后无条件把 `run.Status` 写为 `cancelled` 并保存。`scheduler.Cancel` 只查找运行中 Run 注册的 cancel 函数；queued 与 preparing 阶段的 Run 没有注册项，返回 false，但 API 不检查返回值。`scheduler.execute` 领取 Run 后不检查当前状态，因此存在两个竞态：排队中的 Run 被取消后仍可能被 worker 执行并覆盖状态；执行中的 Run 在取消后可能被 Runtime 的完成回调覆盖为 `completed` 或 `failed`。M1 修复点为「取消请求持久化 + 调度器消费取消令牌 + 状态条件更新」，而不是仅在 API 层改顺序。

### 4.4 Task 与 Run 的联动

**创建联动**：M1 起，只有 `todo`、`in_progress` 的 Task 可以创建 Run；`in_review` 需先 `changes_requested` 回到 `in_progress`；`backlog`、`blocked`、`done`、`cancelled` 创建 Run 返回 409。M0 的 `TaskStatus.Executable()` 还把 `in_review` 视为可执行，这是兼容行为，M1 收紧。M1 起额外要求同一 Task 没有其他活跃 Run。

**状态联动**：M1 规则如下。创建 Run 成功时，Task 从 `todo` 进入 `in_progress` 并记录 assignee；Run 进入 `completed` 且证据齐备时，系统可自动创建 `pending` Review，并把 Task 从 `in_progress` 转为 `in_review`；Review `changes_requested` 时，Task 回到 `in_progress`；Review `approved` 且不需要合并时，Task 进入 `done`；需要合并时，Task 保持 `in_review`，直到 MergeRecord 记录合并成功（M2 起为 Approval 被消费且合并成功）。

**失败与取消联动（M1）**：Run 失败或取消**会**按原因联动 Task，而不是永远保持 `in_progress`：

- 可重试失败（如 `runtime_error/runtime_unavailable`）或用户主动取消：Task 保持 `in_progress`，记录失败原因，允许直接重试；用户取消默认不自动置 `blocked`。
- 不可重试失败（`permission_denied`、`invalid_task_state` 或不可恢复的 `workspace_error`）：Task 进入 `blocked`，`blockedReason` 写入原因，等待人工处理（T-13）。
- 超时属于失败，按 `timeout` 是否可重试判断；默认回到 `in_progress` 并提示重试。
- 任何情况下都不得把 Run 的终态直接映射为 Task 的 `cancelled`；Task 的取消必须由人类显式操作。

**多 Run 规则**：M1 同一 Task 同时最多一个活跃 Run。用户可以在 Run 终态后重试，生成 `attempt` 递增的新 Run。M2 的 Crew 通过子 Task 组织多角色并行，每个子 Task 仍默认单活跃 Run；父 Task 不因子任务并行而违反单活跃 Run 约束。普通任务若显式设置 `parallelRunPolicy=multiple`，按 `collaboration-and-review.md` §6.3 执行，并必须在界面上提示多分支、多证据与逐个合并的风险。

### 4.5 Review 状态机（M1/M2）

**状态定义**

| 状态 | 含义 | 终态 |
|---|---|---|
| pending | 已发起，等待评审者领取 | 否 |
| in_review | 评审者已领取并查看 | 否 |
| approved | 评审通过 | 可被新 Run 置为 superseded |
| changes_requested | 要求修改 | 是 |
| superseded | 被更新的 Review 取代 | 是 |
| cancelled | 人工关闭 | 是 |

**转换表**

| 编号 | 从 | 到 | 触发者 | 守卫条件 | 副作用 | 里程碑 |
|---|---|---|---|---|---|---|
| V-01 | pending | in_review | 人类评审者 | 评审者具备评审权限 | 记录 startedAt | M1 |
| V-02 | pending 或 in_review | approved | 人类评审者 | 证据完整；无未解决 blocking 意见；评审者非执行 Agent | 记录 decidedAt；Task 进入 done 或等待合并 | M1 |
| V-03 | pending 或 in_review | changes_requested | 人类评审者 | 至少一条 blocking comment 或拒绝理由 | Task 回到 in_progress | M1 |
| V-04 | pending 或 in_review | superseded | 系统 | 同 Task 出现新 Run 或新 Review | 旧 Review 只读 | M1 |
| V-05 | pending 或 in_review | cancelled | 人类 | 提供原因 | 关闭评审 | M1 |
| V-06 | approved | superseded | 系统 | 同 Task 创建新 Run | 合并确认失效；Task 回到 in_progress | M1 |

**M1 与 M2 的差异**：M1 一次 Review 只绑定一个 Run，面向 diff 评审，`evidenceSnapshotHash` 在 M1 记录（REVIEW-001 已要求）；M2 一次 Review 可绑定多个角色 Run（ReviewRun），按交付物契约逐项确认。任何证据在评审后被替换，都会导致哈希不匹配并要求重新评审。

### 4.6 Approval 状态机（M2）

**状态定义**

| 状态 | 含义 | 终态 |
|---|---|---|
| pending | 等待人类审批 | 否 |
| approved | 已批准，尚未消费 | 否 |
| rejected | 已拒绝 | 是 |
| expired | 超时失效 | 是 |
| cancelled | 请求者撤回或被系统关闭；`revoked` 为别名 | 是 |
| consumed | 已用于执行对应动作 | 是 |

**转换表**

| 编号 | 从 | 到 | 触发者 | 守卫条件 | 副作用 | 里程碑 |
|---|---|---|---|---|---|---|
| A-01 | pending | approved | 人类审批者 | 具备审批权限；非 Agent 身份 | 记录 decidedBy、decidedAt | M2 |
| A-02 | pending | rejected | 人类审批者 | 提供拒绝理由 | 通知请求者 | M2 |
| A-03 | pending | expired | 系统 | 超过 `expiresAt` | 记录过期事件 | M2 |
| A-04 | pending | cancelled | 请求者或系统 | 动作不再需要 | 关闭审批 | M2 |
| A-05 | approved | consumed | 系统 | 指纹匹配且动作原子执行 | 记录 consumedAt、consumedBy | M2 |
| A-06 | approved | expired | 系统 | 批准后超过消费窗口未使用 | 记录过期事件 | M2 |
| A-07 | approved | cancelled | 请求者或管理员 | 动作取消 | 关闭审批；动作不得执行 | M2 |

**状态别名**：本章以 `pending` 为规范状态值，`requested` 是其在安全模块与 API 中的别名；以 `cancelled` 为规范状态值，`revoked` 是其在协作模块中的别名。同一数据库列只能存规范值，API 输入接受别名并归一化，事件与查询输出规范值。M3 还会扩展 `owner_transfer`、`runner_revoke`、`secret_rotate`、`organization_delete` 等动作类型，但仍使用同一状态机。

**绑定与失效**：审批的 `actionFingerprint` 必须覆盖动作类型、目标实体、commit SHA、diff 哈希、环境、部署目标、命令参数。任何一项变化都会导致指纹不匹配，接口返回 412，审批保持原状态但不可消费。合并审批默认有效期 24 小时；staging 4 小时；生产部署计划 30 分钟且不允许「不自动过期」例外；具体阈值以 `security-and-permissions.md` 为准，本章不重复维护第二套数值。

**职责分离**：M2 本地单用户模式允许同一自然人请求并批准，但界面必须二次确认并留痕，且不允许批量批准；M3 团队模式默认要求请求者与审批者不同，只有 owner 可在审计记录下覆盖。

### 4.7 状态机的 M0 实现对照

| 能力 | M0 实际行为（代码事实） | 缺口 | 计划修复 |
|---|---|---|---|
| Task 状态枚举 | 7 种状态均可创建与 PATCH | 无转换守卫，任意跳转 | M1 引入转换表与 409 |
| Task 执行资格 | `todo`、`in_progress`、`in_review` 可创建 Run | `in_review` 允许新 Run 可能造成评审漂移 | M1 收紧为仅 todo/in_progress |
| Task 完成 | 人工 PATCH 到 done，无证据要求 | 可无评审直接完成 | M1 要求 approved Review |
| Run 转换 | 调度器直接写状态，无中央守卫 | 终态可被覆盖 | M1 状态守卫与条件更新 |
| Run 超时 | `context.WithTimeout`，超时记为 failed | 无结构化 errorCode | M1 增加 errorCode=failureDetail |
| Run 取消 | API 先调用 `scheduler.Cancel`，随后无条件写 cancelled | queued/preparing 无取消句柄，Cancel 返回 false 仍写终态；worker 不检查状态 | M1 持久化取消请求、调度器消费取消令牌、条件更新 |
| Review | 无 | 无评审门 | M1 |
| MergeRecord | 无 | 合并无审计记录 | M1 |
| Approval | 无 | M1 不引入 | M2 |
| 重启恢复 | 非终态 Run 留在数据库，不会被恢复 | 卡在 running/preparing | M1 启动时标记 interrupted |

### 4.8 Crew 状态机（M2 后段）

**状态定义与允许动作**

| 状态 | 含义 | 允许动作 | 终态 |
|---|---|---|---|
| draft | 已创建，成员可编辑 | 编辑成员、指派队长 | 否 |
| planning | 队长正在产出计划 | 生成子任务、依赖、契约清单、预算 | 否 |
| plan_review | 计划已提交，等待 `crew_plan` 审批 | 审批通过或拒绝 | 否 |
| executing | 计划已批准，成员按 DAG 执行 | 派发成员 Run、监控阻塞 | 否 |
| aggregating | 所有子任务完成，队长汇总 | 生成汇总报告与证据索引 | 否 |
| review | 汇总已提交，等待人工评审与合并门 | 人工评审、合并 | 否 |
| done | 编排与验收完成 | 只读 | 是 |
| paused | 人工暂停或预算耗尽 | 恢复或取消 | 否 |
| blocked | 死锁、队长失败或关键成员失败 | 人工介入、替换队长、改范围 | 否 |
| cancelled | 人工取消 | 只读 | 是 |

**转换表**

| 编号 | 从 | 到 | 触发者 | 守卫条件 | 副作用 |
|---|---|---|---|---|---|
| C-01 | draft | planning | 人类 | 已指派队长与至少一个成员 | 创建队长 Run 或规划任务 |
| C-02 | planning | plan_review | 队长或系统 | 计划字段完整（子任务、角色、依赖、契约、预算） | 创建 `crew_plan` 审批 |
| C-03 | plan_review | executing | 人类审批者 | `crew_plan` approved | 开始派发成员 Run |
| C-04 | plan_review | planning | 人类审批者 | 拒绝并填写原因 | 队长可修订后重新提交 |
| C-05 | executing | aggregating | 系统 | 所有子任务进入 done | 队长开始汇总 |
| C-06 | executing | paused | 人类或系统 | 人工暂停或预算耗尽 | 停止派发新 Run，保留在途 Run |
| C-07 | executing | blocked | 系统 | 死锁、队长 Run 失败、必需成员重试超限 | 创建升级收件箱条目 |
| C-08 | aggregating | review | 队长或系统 | 汇总报告与证据索引完整 | 请求人工评审与合并门 |
| C-09 | review | executing | 人类 | 评审要求修改 | 重新进入执行，保留历史证据 |
| C-10 | review | done | 人类 | 人工验收与合并门完成 | 记录完成时间；父 Task 仍需自身门禁 |
| C-11 | paused | planning/executing/review | 人类 | 暂停原因解除 | 回到暂停前状态 |
| C-12 | blocked | planning/executing | 人类 | 阻塞原因解除或已改范围 | 记录处理结论 |
| C-13 | 任意非终态 | cancelled | 人类 | 二次确认 | 停止派发；已完成证据保留 |

**失败升级规则**：预算耗尽 → `paused`；队长失败 → `blocked`；必需成员在重试上限后仍失败 → `blocked`；所有剩余子任务阻塞且无活动 Run → `blocked`（死锁）。`done` 只表示 Crew 编排完成，不自动把父 Task 置为 `done`；父 Task 仍需满足自身的 Review、证据与合并门。

---

## 5. 角色 Agent 协作规则

### 5.1 任务 DAG

角色 Agent 的协作不通过共享会话完成，而通过任务 DAG 完成。一个需求可以拆成多个 Task 节点，节点之间用 TaskDependency 表达先后关系。例如：UI Design 产出设计规范与截图，Frontend 依赖 UI Design 完成并消费设计产物，Backend 提供 API 契约，DevOps 依赖前后端可构建产物生成 staging 部署与生产部署计划。

DAG 规则：上游 Task 进入 done 后，下游才可能解锁；解锁条件是所有 `finish_to_start` 依赖都满足；若依赖声明了 `requiredArtifactKinds`，则上游还必须存在对应类型的 Artifact 或 Evidence（M2）；上游被取消时下游保持 blocked，不得自动开始；任何环都会被拒绝；DAG 允许并行分支，这正是 ATeam 优先支持的「并行任务」。

### 5.2 交付物契约

交付物契约是 Task 上的结构化字段 `deliverableContract`（旧名 `contract` 废弃），M2 起对角色任务必填。它至少包含：

| 契约部分 | 内容 | 示例 |
|---|---|---|
| requiredEvidence | 必需的证据条目 | `unit_tests`、`api_contract`、`screenshots`、`deployment_plan` |
| interfaces | 与其他角色的接口约定 | OpenAPI 路径、组件 props、数据库迁移文件 |
| acceptanceChecks | 可执行的验收检查 | `pnpm test`、`go test ./...`、`curl /health` |
| handoffNotes | 交接说明 | 已知限制、后续任务注意事项 |

契约是评审的依据，也是下游任务的输入。Frontend 不能只凭 UI Design 的自然语言描述开始，必须消费设计产物与接口契约；Backend 变更 API 时必须更新契约并触发下游重新评审。

**契约版本**：M2 起，契约变更必须在 Deliverable 下创建新的 `contract_versions` 版本，冻结后不可原地修改；Task 的 `deliverableContract` 是当前版本投影，`currentContractVersionId` 指向冻结版本。Run 创建时固定 `contractVersionId`，历史 Run 永远解析到当时版本；契约版本在 M2 落地，M1 不声称支持。没有冻结契约的历史 Run，不得声称「固定了契约版本」。

**与模块文档的关系**：唯一契约实体为 Deliverable（表 `deliverables`），版本历史在 `contract_versions`；`collaboration-and-review.md` 的五类交付物契约（design_spec、api_contract、build、test_report、deploy_plan）是该实体的类型。Task 的 `deliverableContract` 是当前版本的投影，`currentContractVersionId` 指向当前冻结版本；`Task.contract` 是弃用别名。TaskContractVersion 是任务级冻结指针的旧概念名，数据层不再单独建表；两者不得各自维护一套冻结规则。

### 5.3 证据化完成定义（DoD）

Task 的完成定义不是「Agent 说完成了」，而是以下条件同时满足：

1. 至少一个 Run 进入 `completed`，且该 Run 绑定了当时的 AgentVersion。
2. M1：代码变更类 Run 至少包含 `diff` Artifact，以及 `test_report` 或人工记录的「不适用测试」例外理由；文档类包含 `diff` 即可。M2：契约中每个 `requiredEvidence` 条目都有对应 Evidence，且状态为 `passed` 或 `waived`。
3. M2：所有 `acceptanceChecks` 都有最近一次执行结果，失败项必须被明确豁免并记录理由。
4. 没有未解决的 blocking ReviewComment。
5. 需要合并的变更已有有效 Review approved；M1 还需 MergeRecord 记录合并成功，M2 起还需 Approval 被消费且合并成功。
6. 需要部署的变更只完成 staging 与部署计划；生产部署由人类在系统外执行并回填结果。

缺少任何一项，Review 不得 approve，Task 不得 done。系统可以在界面上提示缺失项，但不能用「警告后继续」绕过。M1 的 DoD 判定基于 Artifact 与人工例外，不要求 Evidence 表；M2 才引入 Evidence 与契约逐项验证。

### 5.4 审批门与 DevOps 边界

**M1**：不引入完整 Approval Gate。合并必须由人显式确认：Review approved、`expectedHeadCommit` 匹配、目标分支与工作区校验通过、请求带 `confirm=true`，执行结果写入 MergeRecord。M1 的删除保护通过 409 与二次确认实现，不生成 Approval。

**M2 起**：以下动作必须经过 Approval：合并到默认分支、推送到远端、部署到 staging、删除 Workspace/Task/Agent、权限升级、修改命令允许列表、破坏性契约变更。生产部署 `deploy_prod` 只生成审批记录与人工检查单，ATeam 不提供自动执行入口；人类必须在 ATeam 之外执行，并把结果作为 Artifact 或 Evidence 回填。M1 的历史 MergeRecord 不迁移为 Approval；M2 的合并可以同时保留 Approval（授权）与 MergeRecord（执行结果），通过可空 `approvalId` 关联。

DevOps Agent 在 M2 的权限边界：可以修改 CI 配置、Dockerfile、部署清单，可以触发 staging 部署（需 Approval），可以生成生产部署计划与回滚方案；不得直接执行生产部署、不得持有生产密钥、不得修改生产环境的命令白名单。所有高风险动作的 Approval 都必须绑定具体 commit、环境与参数，不能是「blanket 批准」。

### 5.5 Crew 的定位

Crew 是把上述 DAG、契约、证据与审批门封装成任务级模板的编排层。它不创建共享聊天室，不让多个 Agent 在同一会话里互相对话；它为每个角色创建子 Task 或关联 Run，由 DAG 决定顺序，由契约决定交接内容，由 Review 决定是否通过。队长模式（captain）属于后续实验能力，即使启用，队长也只能编排、分派与汇总，不能代替人类评审或审批。

---

## 6. 关键不变量

以下不变量是领域模型的硬约束。M0 由于缺少外键与领域服务，多数只能靠调用方自觉；M1 起必须由数据库约束、API 校验或领域服务强制执行。任何不变量被违反都应视为缺陷，而不是「脏数据可接受」。

| 编号 | 不变量 | 说明 | 强制执行点 | 里程碑 |
|---|---|---|---|---|
| INV-001 | Task 必须属于一个 Workspace | 不允许无归属任务 | DB 非空 + API 校验 | M1 |
| INV-002 | Run 的 Task 必须与 Run 同 Workspace；M3 起 Agent 也必须同 Workspace | M1-M2 Agent 可为安装级共享，但 Run 的 Task 与 Run 自身必须同 Workspace | 服务层校验 + 复合约束 | M1 基础，M3 完整 |
| INV-003 | Run 必须同时关联 Task 与 Agent | 缺一不可 | DB 非空 + 外键 | M0 字段，M1 约束 |
| INV-004 | Artifact、Review、MergeRecord 的 Workspace/Task/Run 必须一致 | 禁止跨 Workspace 组合 | 服务层校验 | M1 |
| INV-005 | Artifact 必须关联 Run | 禁止孤立产物 | DB 外键 | M1 |
| INV-006 | Evidence 必须引用同 Task、同 Run 的 Artifact | 证据不可跨任务 | 服务层校验 | M2 |
| INV-007 | Review 必须绑定具体 Run（M1）或 Run 集合（M2） | 禁止无来源评审 | `reviews.run_id` 或 ReviewRun + 服务层校验 | M1 |
| INV-008 | MergeRecord 必须绑定 approved Review 与具体 commit | 合并必须有评审与执行记录 | 服务层校验 | M1 |
| INV-009 | Approval 必须绑定具体动作与目标版本 | 禁止泛化批准 | 指纹校验 + 412 | M2 |
| INV-010 | Approval 只能消费一次 | 防止重放 | 原子更新 consumedAt | M2 |
| INV-011 | TaskDependency 两端必须同 Workspace，禁止自依赖与环 | 保证 DAG 可调度 | 服务层环检测 + DB 唯一约束 | M2 |
| INV-012 | 同一 Task 同时最多一个活跃 Run；Crew 子任务是独立 Task，各自遵守该约束 | 防止并发写同一上下文 | 部分唯一索引或服务层锁 | M1 |
| INV-013 | Run 终态不可变 | 防止状态回退与覆盖 | 条件更新 + 409 | M1 |
| INV-014 | RunEvent 只追加，`(runId, seq)` 唯一且连续 | 保证事件顺序 | DB 唯一约束 | M1 |
| INV-015 | Agent 更新不改变已有 Run 的 AgentVersion | 保证可复现 | Run 固定版本 ID | M1 |
| INV-016 | 高风险动作必须有有效人工确认；M1 为 Review + MergeRecord，M2 起为 Approval；执行者非 Agent | 保证人类把关 | API 403 + 服务层 | M1 合并，M2 扩展 |
| INV-017 | Run Workspace 路径不得逃逸 Workspace.worktreeRoot | 防止路径穿越 | 路径规范化校验 | M1 |
| INV-018 | Artifact 内容不可变 | 防止评审后替换 | 只写一次 + sha256 校验 | M1 |
| INV-019 | 父子 Task 必须同 Workspace，且不得形成祖先环 | 保证层级合法 | 服务层校验 | M1 |
| INV-020 | 删除 Task/Agent 前不得有活跃 Run 或未关闭 Review | 防止运行中失去归属 | 服务层校验 + 409 | M1 |
| INV-021 | Crew 成员、步骤必须同 Workspace，且引用固定 AgentVersion | 保证角色可复现 | 服务层校验 | M2 后段 |
| INV-022 | Runner 只能执行匹配 Workspace、Runtime 与能力的 Run | 防止错误派发 | 调度器校验 | M3 |
| INV-023 | Review 的 evidenceSnapshotHash 在评审后不得被替换 | 保证评审依据稳定 | 哈希校验 | M1 |
| INV-024 | Run Workspace 状态只能按 3.8 的转换表变化 | 防止跳过清理或复活 | 领域服务 | M1 |
| INV-025 | 一个 ReviewRun 对 `(reviewId, runId)` 唯一 | 防止重复聚合 | DB 唯一约束 | M2 |
| INV-026 | Run 的 contractVersionId 必须指向创建时冻结的契约版本 | 保证契约可复现 | 服务层校验 | M2 |
| INV-027 | Crew 状态只能按 4.8 的转换表变化，`done` 不自动完成父 Task | 防止编排越权 | 领域服务 | M2 后段 |
| INV-028 | 只有人类可以创建 Review 决策、MergeRecord 与 Approval 决策；Agent 身份不得批准 | 保证人工在回路 | API 403 | M1/M2 |

---

## 7. 标识、时间与删除策略

### 7.1 ID 策略

M0 的 `domain.NewID()` 使用 12 个随机字节并编码为 24 位小写十六进制字符串；随机源失败时退化为时间戳字符串的十六进制编码。该策略足够本地唯一，且不携带语义。本章决定继续沿用「不透明 ID」原则：

- 所有实体主键使用服务端生成的 24 位小写 hex；客户端不能指定 ID，导入场景除外。
- 默认 Workspace 的固定 ID 为 `default`，是唯一允许的短字符串主键；其余实体一律使用 24 位小写 hex。
- ID 不包含类型前缀、时间或自增语义，避免迁移与合并时暴露信息。
- 人类可读编号单独放在 Task 的 `key` 字段（M3 评估），格式为 `{taskPrefix}-{number}`，例如 `AT-42`；同 Workspace 内唯一且不复用。
- 数据库外键统一使用字符串类型，M3 迁移到 Postgres 时保持同值，不做重新编号。
- ID 一旦分配永不修改、永不复用；删除后的 ID 也不得重新出现。
- M0 的随机失败退化路径会产生长度不稳定的字符串；M1 移除该退化逻辑，改为返回错误，不引入标准 UUID 作为第二套 ID 方案。

### 7.2 时间戳

- 所有时间使用 UTC；存储为 Unix 毫秒整数，API 序列化为 RFC 3339 字符串。
- `createdAt` 与 `updatedAt` 为必填；`updatedAt` 在每次持久化更新时刷新。
- 可选时间字段（`startedAt`、`endedAt`、`decidedAt` 等）在 SQLite 中用 `0` 表示空，API 输出为 `null` 或缺省。
- 持续时长应基于 `startedAt` 与 `endedAt` 计算，不要依赖客户端时钟。
- M0 依赖本机时钟；M3 远程 Runner 场景以服务端接收心跳时间为准，并要求 Runner 上报时钟偏移；偏移超过 2 秒时在事件中标记，不阻塞执行。
- 所有超出合理范围的时间（例如 1970 年之前或未来 10 年之后）在 API 层拒绝，防止脏数据。

### 7.3 软删除与归档

M0 的 Task 与 Agent 使用硬删除，且没有外键保护，删除后 Run 仍保留 `taskId`/`agentId` 字符串，形成悬空引用。这是不可接受的长期策略。分阶段统一如下：

- **M1**：`DELETE` 的语义是「确认 + 阻止 + 归档」。删除前必须没有活跃 Run、没有未关闭 Review，否则返回 409 并提示归档；通过校验后执行归档（写 `archivedAt`），不提供硬删除。
- **M2.1**：增加软删除与恢复窗口。软删除复用同一个 `archivedAt` 字段（不新增 `deletedAt` 列，避免双字段双写），默认保留 30 天，可在保留期内恢复；超过 30 天且无引用时才可物理清理。
- 硬删除只允许在没有 Run、没有 Artifact、没有 Review、没有 Approval 引用时执行；否则返回 409。
- Run、RunEvent、Artifact、Evidence、Review、ReviewComment、MergeRecord、Approval 永不硬删除，作为审计与复现依据保留。
- 删除 Workspace 属于高风险动作，M3 起必须走 Approval；删除时按保留策略处理 Artifact 与事件，默认保留 90 天后再清理。
- 所有归档与删除都产生领域事件，记录操作者、时间与原因；M1 起的归档/软删除统一为 `task.archived` / `agent.archived`，恢复为 `task.restored` / `agent.restored`；`task.deleted` / `agent.deleted` 仅保留为 M0 硬删除的历史事件名，同一动作不得同时使用两个事件名。

### 7.4 并发控制

M0 的 SQLite 连接设置为单连接（`SetMaxOpenConns(1)`），写操作天然串行，但读-改-写流程仍可能丢失更新。M1 起：

- Task、Agent、Review 增加 `revision` 整数字段（M1）；Approval 增加 `revision`（M2）。更新请求携带期望版本，不匹配返回 409。模块文档中的 `version` 是同一字段的旧名，统一改为 `revision`。
- Run 状态更新使用条件更新（`WHERE id = ? AND status IN (...)`），受影响行数为 0 时视为冲突；M0 的 `UpdateRun` 是无条件更新，M1 必须修改。
- Approval 消费使用原子条件更新，避免两个并发动作同时消费同一审批。
- RunEvent 的 seq 由服务端在事务内分配，`(run_id, seq)` 唯一约束兜底。
- 前端遇到 409 时刷新实体后重试，不盲目覆盖。

---

## 8. 事件与领域事件

### 8.1 事件分层与命名

ATeam 有两类事件：

**运行事件（RunEvent）**：属于单个 Run 的细粒度执行日志，持久化在 `run_events` 表，按 `seq` 排序，用于实时日志面板与事后诊断。

**领域事件（Domain Event）**：实体状态变化的通知，用于驱动 UI 刷新、审计、通知与后续自动化。命名统一为 `aggregate.past_tense`，即「实体名.过去式动词」，例如 `task.created`、`review.approved`。M0 的领域事件只通过 WebSocket 广播，不持久化；M2 起增加本地 `domain_events` 表，M3 起接入审计与远程通知。

WebSocket 信封格式为 `{ type, data, at }`，其中 `type` 是事件名，`data` 是实体快照或最小引用，`at` 是 UTC 时间。M1 起增加 `eventId`、`workspaceId`、`actor` 与 `correlationId`。

### 8.2 M0 事件目录

| 事件 | 触发点 | 载荷 | 持久化 | 说明 |
|---|---|---|---|---|
| task.created | `POST /api/tasks` 成功后 | 完整 Task | 否 | UI 收到后刷新任务列表 |
| task.updated | `PATCH /api/tasks/{id}` 成功后 | 完整 Task | 否 | 包括状态、assignee 变更 |
| task.deleted | `DELETE /api/tasks/{id}` 成功后 | `{ id }` | 否 | 硬删除后广播 |
| agent.created | `POST /api/agents` 成功后 | 完整 Agent | 否 | — |
| agent.updated | `PATCH /api/agents/{id}` 成功后 | 完整 Agent | 否 | — |
| agent.deleted | `DELETE /api/agents/{id}` 成功后 | `{ id }` | 否 | — |
| run.queued | 创建 Run 成功后 | 完整 Run | 否 | 随后异步入队 |
| run.preparing | 调度器进入 preparing | 完整 Run | 否 | 由 scheduler 发出 |
| run.running | 调度器进入 running | 完整 Run | 否 | 由 scheduler 发出 |
| run.updated | Run 终态或取消时 | 完整 Run | 否 | M0 通用事件，未区分 completed/failed |
| run.event | Runtime 每条输出 | 完整 RunEvent | 是 | 同时写入 `run_events` |
| run.cancelled（缺失） | — | — | — | M0 用 run.updated 代替 |

M0 的 WebSocket Hub 是尽力而为：客户端断线后不补发，前端在收到任何 `task.*`、`agent.*`、`run.*` 事件后直接全量刷新对应列表；断线 2 秒后重连，但断线期间的事件丢失，只能靠重连后的全量拉取恢复。M1 应改为增量同步或至少提供 `updatedSince`/`afterSeq` 查询。

### 8.3 规划事件目录

| 事件 | 触发条件 | 主要载荷 | 里程碑 |
|---|---|---|---|
| project.created | 创建 Workspace | Workspace 快照 | M1 |
| project.updated | 更新 Workspace 设置 | Workspace 快照 | M1 |
| project.archived | 归档 Workspace | `{ id, archivedAt }` | M1 |
| task.status_changed | Task 任意受控转换 | `{ id, from, to, actor, reason }` | M1 |
| task.assigned | assignee 变化 | `{ id, assigneeType, assigneeId }` | M1 |
| task.archived | 归档 Task | `{ id, archivedAt }` | M1 |
| task.blocked | 进入 blocked | `{ id, reason, source }` | M1 |
| task.unblocked | 阻塞解除或依赖满足 | `{ id, satisfiedDependencies }` | M1 人工；M2 依赖自动 |
| task.reopened | done/cancelled 重开 | `{ id, from, reason }` | M2 |
| task.dependency.added | 添加 TaskDependency | 依赖快照 | M2 |
| task.dependency.removed | 删除 TaskDependency | `{ id }` | M2 |
| agent.version_created | 生成 AgentVersion | 版本摘要与 contentHash | M1 |
| agent.archived | 归档 Agent | `{ id, archivedAt }` | M2 |
| run.completed | Run 正常结束 | Run 快照与 summary | M1 |
| run.failed | Run 失败 | Run 快照、errorCode、failureDetail | M1 |
| run.cancelled | 人工取消 | Run 快照、取消者 | M1 |
| run.cancel_requested | 取消请求发出 | `{ id, requestedAt }` | M1 |
| run.timeout | 超时 | `{ id, timeoutMinutes }` | M1 |
| run.workspace.provisioning | Run Workspace 开始准备 | `{ runId, baseBranch }` | M1 |
| run.workspace.ready | Run Workspace 就绪 | `{ runId, branch, baseCommit }` | M1 |
| run.workspace.failed | Run Workspace 准备失败 | `{ runId, errorCode, failureDetail }` | M1 |
| run.workspace.cleaned | Run Workspace 清理 | `{ runId, path }` | M1 |
| artifact.created | 产物入库 | Artifact 元数据 | M1 |
| evidence.added | 证据绑定契约条目 | `{ evidenceId, criterionKey }` | M2 |
| evidence.verified | 评审者确认证据 | `{ evidenceId, verifiedBy }` | M2 |
| review.requested | 创建 Review | Review 快照 | M1 |
| review.approved | Review 通过 | `{ id, taskId, decidedBy }` | M1 |
| review.changes_requested | 要求修改 | `{ id, reason }` | M1 |
| review.superseded | 被新 Review 取代 | `{ id, supersededBy }` | M1 |
| merge.started | 开始合并 | `{ runId, targetBranch, expectedHeadCommit }` | M1 |
| merge.completed | 合并成功 | `{ taskId, runId, commit, mergeRecordId }` | M1 |
| merge.conflicted | 合并冲突 | `{ runId, conflictFiles }` | M1 |
| approval.requested | 创建 Approval | 摘要、指纹、风险级别 | M2 |
| approval.decided | 通过或拒绝 | `{ id, status, decidedBy }` | M2 |
| approval.expired | 超时失效 | `{ id, expiresAt }` | M2 |
| approval.consumed | 动作执行并消费 | `{ id, actionType, targetId }` | M2 |
| crew.created | 创建 Crew | Crew 快照 | M2 后段 |
| crew.plan_submitted | 计划提交 | `{ id, taskId }` | M2 后段 |
| crew.updated | Crew 状态变化 | Crew 快照 | M2 后段 |
| skill.created | 创建 Skill | Skill 快照 | M2 |
| skill.updated | 更新 Skill | Skill 快照、新版本 | M2 |
| runner.registered | Runner 注册 | Runner 与 Machine 摘要 | M3 |
| machine.registered | Machine 注册 | Machine 摘要 | M3 |
| machine.status_changed | Machine 状态变化 | `{ machineId, from, to }` | M3 |
| machine.revoked | Machine 停用 | `{ machineId }` | M3 |
| runner.heartbeat | 心跳 | `{ runnerId, activeRunCount }` | M3 |
| runner.offline | 心跳超时 | `{ runnerId, lastHeartbeatAt }` | M3 |
| runner.revoked | 停用 Runner | `{ runnerId }` | M3 |

### 8.4 顺序、重放与可靠性

- 同一 Run 内事件按 `seq` 严格递增且连续；跨实体不保证全局顺序，UI 不应依赖全局有序。
- M0 的 WebSocket 只保证「连接期间尽量送达」，不保证至少一次，也不支持重放。M1 提供 REST 增量查询（按 `updatedSince` 或 Run 的 `seqAfter`）作为补偿。
- M1 起，领域事件可带 `correlationId`，把「创建 Run」「准备 worktree」「生成 Artifact」「创建 Review」串成一条链路，便于排障。
- M2 增加 `domain_events` 表，追加写入，保留默认 90 天；不得用事件表替代实体当前状态，事件只用于审计与回放。
- M3 的远程 Runner 与团队模式要求事件在服务端落库后再推送，避免「界面显示成功但数据未保存」。

---

## 9. 功能需求

需求编号用于验收与测试用例映射。本章使用**唯一前缀 `DM-`**（Domain Model），与模块文档的 `TASK-`、`RUN-`、`AGENT-`、`COLLAB-`、`SEC-`、`NFR-` 等编号空间隔离，避免同名前缀语义冲突。优先级：P0 表示里程碑内必须完成，P1 表示应当完成，P2 表示可延后。每条需求只描述一个可测试行为、一个里程碑；M0 现状记录与 M1 目标拆成不同条目。

### 9.1 Workspace 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-PROJ-001 | 首次启动或首次访问时，系统自动创建一个默认 Workspace，ID 固定为 `default`，并将 M0 遗留的 Task、Agent、Run 全部回填到该 Workspace（Agent 可保持 `workspaceId` 为空）。 | P0 | M1 |
| DM-PROJ-002 | Task 与 Run 的 `workspaceId` 必填，且 Run 的 `workspaceId` 必须等于其 Task 的 `workspaceId`；跨 Workspace 引用返回 409。 | P0 | M1 |
| DM-PROJ-003 | Workspace 的 `repoPath` 必须是已存在的 git 仓库根目录；保存前规范化路径并拒绝符号链接逃逸。 | P0 | M1 |
| DM-PROJ-004 | 修改 `defaultBranch`、`remote`、`worktreeRoot`、`verificationCommands` 或 `settings` 前，必须没有活跃 Run；违反时返回 409 并列出活跃 Run。`repoPath` 不在 M1 可修改字段内。 | P0 | M1 |
| DM-PROJ-005 | 重新绑定 `repoPath` 是 M3 的显式迁移流程：要求没有活跃 Run、重新校验仓库与分支、生成 Approval 记录与审计事件；M1 不提供原地修改。 | P0 | M3 |
| DM-PROJ-006 | 归档 Workspace 后，不能创建新 Task、Agent 或 Run；历史数据只读可查；归档动作产生 `project.archived` 事件。 | P0 | M1 |
| DM-PROJ-007 | 多 Workspace 模式下，用户只能看到自己有权访问的 Workspace；不可见资源的越权访问返回 404（与不存在一致），可见但角色权限不足返回 403。 | P0 | M3 |
| DM-PROJ-008 | 删除 Workspace 必须经过 Approval，且在删除前导出或保留审计摘要。 | P0 | M3 |

### 9.2 Task 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-TASK-001 | 创建 Task 必须提供非空 `title`；`status` 默认 `backlog`，`priority` 默认 0，`labels` 默认空数组。M0 只校验 trim 后非空，不校验长度。 | P0 | M0 |
| DM-TASK-002 | Task 只接受 7 种状态值；非法值返回 400。M0 的 PATCH 允许任意合法状态跳转，这是现状记录，不是目标行为。 | P0 | M0 |
| DM-TASK-003 | M1 起，状态变更只允许 4.2 转换表列出的转换；非法转换返回 409，并在响应中返回当前状态与允许的目标状态。 | P0 | M1 |
| DM-TASK-004 | Task 进入 `done` 必须来自 `in_review`，且对应 Review 为 `approved`；直接 PATCH 为 `done` 返回 409。 | P0 | M1 |
| DM-TASK-005 | Task 进入 `blocked` 必须提供非空 `blockedReason`；未提供返回 400；解除阻塞时清空原因。 | P0 | M1 |
| DM-TASK-006 | `blocked`、`backlog`、`done`、`cancelled` 不能创建 Run；`in_review` 在 M1 起也不能创建新 Run；违反返回 409。 | P0 | M0 基础；M1 完整 |
| DM-TASK-007 | 创建 Run 成功时，若 Task 为 `todo`，自动转为 `in_progress` 并写入 assignee；若已是 `in_progress`，保持不变。 | P0 | M0 |
| DM-TASK-008 | 角色 Task 在 M2 必须声明交付物契约，否则不能进入 `todo`；契约至少包含一个 `requiredEvidence` 条目。 | P0 | M2 |
| DM-TASK-009 | 子 Task 的 `parentId` 必须指向同 Workspace 的 Task，且不能形成祖先环。 | P1 | M1 |
| DM-TASK-010 | 删除 Task 前必须没有活跃 Run 和未关闭 Review；违反返回 409，并提示使用归档。 | P0 | M1 |
| DM-TASK-011 | 同一 Workspace 内 Task 的 `key` 唯一、递增、不复用；删除或归档不释放编号。该能力在 M3 评估，不作为 M1/M2 承诺。 | P1 | M3 |
| DM-TASK-012 | Task 归档后默认列表不返回，可通过 `includeArchived=true` 查询；归档不影响历史 Run 与 Artifact。 | P0 | M1 |
| DM-TASK-013 | Task 必须支持 `acceptanceCriteria` 数组，每项含文本、完成状态、完成人与完成时间；详情页可勾选并持久化。 | P1 | M1 |
| DM-TASK-014 | `title` 长度 1-200、`labels` 单标签 32 字符且最多 20 个、`priority` 0-4、`description` 64 KiB 上限由服务端校验；这些是 M1 目标，不是 M0 现状。 | P1 | M1 |
| DM-TASK-015 | Run 失败或取消后，系统按 4.4 联动 Task：可重试失败或用户取消保持 `in_progress`；不可重试失败进入 `blocked` 并写入 `blockedReason`。 | P0 | M1 |

### 9.3 TaskDependency 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-DEP-001 | 添加依赖时，上下游 Task 必须同 Workspace；自依赖返回 400；重复依赖返回 409。 | P0 | M2 |
| DM-DEP-002 | 添加依赖时执行环检测；任何会形成环的请求返回 409，且不写入任何边。 | P0 | M2 |
| DM-DEP-003 | 上游 Task 进入 `done` 后，系统检查下游依赖；全部满足时下游自动从 `blocked` 转为 `todo`，并发出 `task.unblocked`。 | P0 | M2 |
| DM-DEP-004 | 上游 Task 进入 `cancelled` 时，下游保持 `blocked`，`blockedReason` 指明上游已取消；不得自动开始。 | P0 | M2 |
| DM-DEP-005 | 依赖声明 `requiredArtifactKinds` 时，上游必须存在对应 Artifact 或 passed/waived Evidence，否则下游不解锁。 | P1 | M2 |
| DM-DEP-006 | 删除依赖只删除边，不自动回退下游状态；删除动作产生 `task.dependency.removed` 事件。 | P1 | M2 |
| DM-DEP-007 | 单 Workspace 的依赖图默认上限 500 个节点、深度 20；超限返回 409 并提示拆分。 | P2 | M2 |

### 9.4 Agent 与 AgentVersion 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-AGENT-001 | 创建 Agent 必须提供非空 `name`；未提供 runtime 时默认 `mock`，workspaceMode 默认 `worktree`，maxConcurrency 默认 1，timeout 默认 60 分钟。M0 只校验名称非空。 | P0 | M0 |
| DM-AGENT-002 | M0 的未注册 runtime 在运行时回退到 mock；这是已知缺陷，记录为现状，不作为目标行为。 | — | M0 |
| DM-AGENT-003 | M1 起，创建或更新 Agent 时未注册的 runtime 返回 400；启动 Run 前复检；任何路径都不得静默回退 mock。 | P0 | M1 |
| DM-AGENT-004 | 任何改变执行语义的 Agent 更新都必须生成新的 AgentVersion；Run 创建时固定 `agentVersionId`。 | P0 | M1 |
| DM-AGENT-005 | 修改 Agent 不得影响已创建的 Run；活跃 Run 继续使用旧版本，新 Run 使用最新版本。 | P0 | M1 |
| DM-AGENT-006 | `allowedPaths` 与 `allowedCommands` 在 M2 必须于 Runtime 启动前与工具调用时双重校验；越界产生 `permission_denied` 并使 Run 失败或进入人工复核。 | P0 | M2 |
| DM-AGENT-007 | Agent 存在活跃 Run 时删除被拒绝并返回 409；归档能力在 M2 提供，M1 先以删除保护替代。 | P0 | M1 删除保护；M2 归档 |
| DM-AGENT-008 | 角色模板实例化后与模板解耦；模板升级不自动修改已创建 Agent。 | P1 | M2 |
| DM-AGENT-009 | 团队模式下，编辑共享 Agent 需要 `agent:write` 权限，并产生审计事件。 | P0 | M3 |
| DM-AGENT-010 | `maxConcurrency` 在 M2 起必须生效；超过上限的 Run 保持 `queued`，不得直接拒绝或静默并行。 | P1 | M2 |
| DM-AGENT-011 | Agent 名称 1-80 字符、description 280 字符、instructions 64 KiB、timeout 1-1440、maxConcurrency 1-16 由 M1 服务端校验；这些不是 M0 已实现行为。 | P1 | M1 |

### 9.5 Run、RunEvent 与 Run Workspace 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-RUN-001 | 创建 Run 必须提供有效 `taskId` 与 `agentId`；Task 不可执行或 Agent 不存在时返回 409/404。 | P0 | M0 |
| DM-RUN-002 | 创建 Run 后状态为 `queued`；调度器领取后依次进入 `preparing`、`running`，并记录 `startedAt`。 | P0 | M0 |
| DM-RUN-003 | Runtime 正常退出时 Run 进入 `completed`；非零退出、异常或超时进入 `failed`；人工取消进入 `cancelled`。 | P0 | M0 |
| DM-RUN-004 | Run 超时由 `timeoutMinutes` 控制；超时进入 `failed`，`errorCode` 为 `timeout`，不是 `cancelled`。 | P0 | M0 基础；M1 分类 |
| DM-RUN-005 | 取消接口对终态 Run 幂等返回当前状态；对非终态 Run 先持久化取消请求，再由调度器确认停止并条件写入 `cancelled`。 | P0 | M1 |
| DM-RUN-006 | 同一 Task 同时最多一个活跃 Run；重复创建返回 409，并返回现有活跃 Run。 | P0 | M1 |
| DM-RUN-007 | M1 起每次 Run 必须在独立 git worktree 中执行，记录 `branch`、`baseCommit`、`headCommit` 与 `workspaceState`；分支命名遵循 `ateam/{taskShort}/{slug}-{runShort}`。 | P0 | M1 |
| DM-RUN-008 | Run 进入终态后不可再变更；任何更新返回 409；重试创建新 Run，`attempt` 递增。 | P0 | M1 |
| DM-RUN-009 | 应用重启时，`preparing` 或 `running` 的 Run 在启动后 10 秒内标记为 `failed`，`errorCode` 为 `interrupted`、`failureDetail` 为 `app_restart`，并提示重试。 | P0 | M1 |
| DM-RUN-010 | 每个 Run 的 RunEvent `seq` 从 1 开始，`(runId, seq)` 唯一且连续；API 按 `seq` 升序返回。 | P0 | M1 |
| DM-RUN-011 | M3 起 Run 必须记录 `runnerId`；远程 Runner 失联超过宽限期，活跃 Run 标记 `failed`，`errorCode` 为 `interrupted`、`failureDetail` 为 `runner_lost`，不自动改派。 | P0 | M3 |
| DM-RUN-012 | 定时或 Webhook 触发的 Run 必须记录 `trigger` 与去重键，避免同一事件重复执行。 | P1 | M4 |
| DM-RUN-013 | Run Workspace 必须记录 `workspaceState`，并按 3.8 转换表推进；Run 详情与 `GET /api/v1/runs/{id}/workspace` 暴露状态、路径、分支与 base commit。 | P0 | M1 |
| DM-RUN-014 | 已合并或已放弃的 Run Workspace 默认保留 30 天，可配置；未合并且有改动的 worktree 不得自动删除；Artifact、Evidence 与 RunEvent 默认保留 90 天。 | P1 | M1 |
| DM-RUN-015 | Run 结束时必须采集 diff、changed files 与测试输出或人工例外；证据缺失时不得把 Task 置为 done。 | P0 | M1 |
| DM-RUN-016 | Run 失败或取消后 Task 的联动按 DM-TASK-015 执行；Run 不得直接把 Task 置为 `cancelled`。 | P0 | M1 |

### 9.6 Artifact 与 Evidence 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-ART-001 | 每个 Artifact 必须关联已存在的 Run、Task 与 Workspace；缺失或跨 Workspace 返回 400/409。 | P0 | M1 |
| DM-ART-002 | diff Artifact 必须由系统基于 `baseCommit` 与 `headCommit` 生成，不能只依赖 Agent 自述。 | P0 | M1 |
| DM-ART-003 | Artifact 内容不可变；同一路径重跑生成新 Artifact；读取时校验 `sha256`，不匹配返回 500 并告警。 | P0 | M1 |
| DM-ART-004 | Artifact 的 `storagePath` 必须位于 Artifact 根目录内；包含 `..`、绝对路径或符号链接逃逸时拒绝。 | P0 | M1 |
| DM-ART-005 | 单个 Artifact 默认上限 50 MiB；超限拒绝入库并产生 `artifact.rejected` 事件；文本类证据单条超过 10 MB 时截断并标记 `truncated=true`。 | P1 | M1 |
| DM-ART-006 | M2 起 requiredEvidence 的每个条目必须有 passed 或 waived Evidence；缺失时 Review 不得 approve。 | P0 | M2 |
| DM-ART-007 | 截图、日志等 Artifact 在用于评审前必须完成脱敏扫描；`redactionState` 非 `none` 时不得标记为 verified。 | P0 | M2 |
| DM-ART-008 | Evidence 只能在同 Task、同 Run 的 Artifact 上创建；跨任务引用返回 409；Evidence 不可编辑，只能 supersede。 | P0 | M2 |
| DM-ART-009 | M1 的 DoD 检查基于 Artifact 类型与人工例外，不要求 Evidence 表；M1 不得声称已具备契约逐项证据。 | P0 | M1 |

### 9.7 Review、MergeRecord 与 Approval 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-REV-001 | Run `completed` 且证据齐备时，系统可自动创建 `pending` Review，也可由人类手动发起；Review 必须绑定具体 Run，并记录 `evidenceSnapshotHash`。 | P0 | M1 |
| DM-REV-002 | 同一 Task 同时最多一个 open Review（`pending` 或 `in_review`）；新 Review 创建时旧 Review 置为 `superseded`。 | P0 | M1 |
| DM-REV-003 | 只有人类可以执行 `approved` 或 `changes_requested`；Agent 身份调用返回 403。 | P0 | M1 |
| DM-REV-004 | Approve 前必须满足：所需 Artifact 齐全（M1）或所有 required Evidence 为 passed/waived（M2）、无未解决 blocking comment、diff 可读、无冲突标记。 | P0 | M1 基础；M2 完整 |
| DM-REV-005 | Review approve 后，若 `requiresMerge` 为真，Task 保持 `in_review`，直到 MergeRecord 记录合并成功（M2 起还需 Approval 被消费且合并成功）；否则 Task 直接进入 `done`。 | P0 | M1 基础；M2 完整 |
| DM-REV-006 | `changes_requested` 必须至少包含一条 blocking comment 或非空拒绝理由，并自动把 Task 转为 `in_progress`。 | P0 | M1 |
| DM-REV-007 | M2 的 Review 可聚合多个角色 Run（ReviewRun）；每个契约条目必须映射到至少一个 Evidence。 | P1 | M2 |
| DM-MRG-001 | M1 合并必须由人类发起，请求携带 `reviewId`、`expectedHeadCommit`、`targetBranch`、`strategy` 与 `confirm=true`；服务端校验 Review approved、证据快照、目标分支与干净工作区。 | P0 | M1 |
| DM-MRG-002 | 每次合并尝试都必须写入 MergeRecord，记录操作者、时间、目标/源分支、策略、commit、结果与冲突文件；`merged` 记录不可修改。 | P0 | M1 |
| DM-MRG-003 | `expectedHeadCommit` 或证据快照变化时，合并返回 412，原 Review 的合并资格失效，必须重新评审；不得静默 rebase 或覆盖。 | P0 | M1 |
| DM-MRG-004 | MergeRecord 与 Approval 的映射：M1 只有 MergeRecord；M2 起 Approval 是授权、MergeRecord 是执行结果，通过可空 `approvalId` 关联，历史记录不回填。 | P0 | M1/M2 |
| DM-APPR-001 | M2 起，合并、推送、staging 部署、删除、权限升级与命令白名单变更必须创建 Approval，绑定目标、commit/环境/参数与证据快照；没有有效 Approval 的动作返回 403。 | P0 | M2 |
| DM-APPR-002 | Approval 只能消费一次；`consumed` 后再次使用返回 409。 | P0 | M2 |
| DM-APPR-003 | 目标 commit、diff 或参数变化导致指纹不匹配时返回 412，审批不可消费。 | P0 | M2 |
| DM-APPR-004 | M2 起 Approval 覆盖 merge、push、deploy_staging、delete、permission_escalation、command_allowlist_change、high_risk_command、contract_break、crew_plan 等类型；`deploy_prod` 只记录人工检查单。 | P0 | M2 |
| DM-APPR-005 | Agent 不得创建、批准或消费 Approval；违反返回 403。 | P0 | M2 |
| DM-APPR-006 | 超过 `expiresAt` 的 pending Approval 自动置为 `expired`；批准后超过消费窗口未使用也自动过期。 | P0 | M2 |
| DM-APPR-007 | M3 团队模式默认要求请求者与审批者不同；owner 覆盖时必须记录审计原因。 | P0 | M3 |

### 9.8 Skill、Crew 与 Runner 需求

| 编号 | 需求 | 优先级 | 里程碑 |
|---|---|---|---|
| DM-SKILL-001 | Skill 必须属于一个 Workspace；`slug` 同 Workspace 唯一；`sourcePath` 必须在允许根目录内。 | P0 | M2 |
| DM-SKILL-002 | Agent 引用 Skill 必须固定版本；Skill 更新不改变历史 Run 与已固定的 AgentVersion。 | P0 | M2 |
| DM-SKILL-003 | Skill 不得自动下载或携带未审批的可执行二进制；脚本必须显式列入 `allowedCommands` 并经过审批。 | P0 | M2 |
| DM-CREW-001 | Crew 必须绑定一个 Task 与 Workspace；成员角色限定为 ui_design、frontend、backend、devops、custom。 | P1 | M2 后段 |
| DM-CREW-002 | Crew 通过子 Task 或关联 Run 执行，不得创建共享聊天会话；所有交付物必须经过 Review。 | P1 | M2 后段 |
| DM-CREW-003 | 队长只能编排与汇总，不得代替人类 Review、Approval 或合并。 | P1 | M2 后段 |
| DM-CREW-004 | 队长失败 → `blocked`；预算耗尽 → `paused`；必需成员重试超限 → `blocked`；所有非终态可被人类取消；Crew `done` 不自动完成父 Task。 | P1 | M2 后段 |
| DM-CREW-005 | Crew 状态必须按 4.8 的转换表变化，并记录触发者、时间与原因。 | P1 | M2 后段 |
| DM-RUNNER-001 | Machine 注册使用一次性 token，服务端只存哈希；`disabled` 后拒绝心跳与新 Run。 | P0 | M3 |
| DM-RUNNER-002 | Runner 必须绑定 Machine 与 Workspace，声明并发与 Runtime 能力；调度器只派发匹配的 Run。 | P0 | M3 |
| DM-RUNNER-003 | Runner 心跳每 15 秒一次；45 秒缺失判定 `offline`；租约 90 秒未续期失效；其上活跃 Run 标记 `failed` + `interrupted/runner_lost`，不得自动改派。 | P0 | M3 |
| DM-RUNNER-004 | 模型密钥只保存在 Runner 本机，不通过 ATeam 服务端传输或持久化。 | P0 | M3 |

### 9.9 数据与 API 影响

**M0 API 映射**：当前接口以 `/api/tasks`、`/api/agents`、`/api/runs` 为核心，没有 Workspace 段、没有分页、没有 Artifact/Review/Merge 端点。M1 保持现有 M0 路径在兼容期可用，默认作用于默认 Workspace；响应体增加 `workspaceId`。M1 新增接口统一使用 `/api/v1` 前缀；M0 路径不再新增能力，M3 评估旧路径退役。

| 阶段 | 新增或变化 | 兼容策略 |
|---|---|---|
| M1 | Task/Run 响应增加 `workspaceId`、`revision`；新增 `/api/v1/workspaces`（`/api/v1/projects` 为兼容别名）、`/api/v1/runs/{id}/workspace`、`/api/v1/runs/{id}/artifacts`、`/api/v1/runs/{id}/reviews`、`/api/v1/runs/{id}/merge` | 旧字段保留；旧客户端忽略新字段；M0 路径继续作用于默认 Workspace |
| M2 | 新增 `/api/v1/runs/{id}/evidence`（M2）、`/api/v1/approvals`、协作与契约端点 | 证据与审批从 M2 起；别名仍指同一 handler |
| M1 | 列表接口增加 `limit`、`cursor`、`updatedSince`；默认 limit 50，最大 200 | 不传分页参数时返回旧行为的前 200 条并标记 `hasMore` |
| M2 | 新增 `/api/v1/evidence`、`/api/v1/approvals`、`/api/v1/task-dependencies`、`/api/v1/agents/{id}/versions`、`/api/v1/skills`、`/api/v1/crews`、`/api/v1/deliverables` | 旧接口不变；新功能独立路径 |
| M3 | 新增 `/api/v1/workspaces/{id}/members`、`/api/v1/machines`、`/api/v1/runners`、登录与权限 | 旧路径在默认 Workspace 下保留一个版本周期 |
| M4 | 新增自动化触发与 Webhook 管理接口 | 不影响既有实体路径 |

**错误语义**：400 表示请求体或字段不合法；403 表示权限不足或 Agent 越权；404 表示实体不存在；409 表示状态冲突、唯一性冲突或活跃引用冲突；412 表示审批指纹、MergeRecord 前置条件或 `expectedHeadCommit` 不匹配；422 保留给语义校验失败（例如证据缺失但请求格式正确）。错误响应统一为 `{ error, code?, details? }`，M0 只有 `error` 字符串，M1 起增加稳定的 `code`。

**M1 合并不走 `/api/approvals`**：M1 只有 `POST /api/v1/runs/{id}/merge` 与 MergeRecord；`/api/v1/approvals` 从 M2 起提供。任何 M1 文档不得声称已有 Approval 实体。

### 9.10 领域级安全与 NFR 约束

本章只保留与领域模型直接相关的约束；性能、网络、UI 与完整安全策略引用对应模块的权威编号，本章不重复维护第二套阈值。

| 编号 | 约束 | 说明 | 权威来源 |
|---|---|---|---|
| DM-SEC-001 | 路径边界 | Run Workspace 与 Artifact 存储路径必须规范化，拒绝 `..`、绝对路径与符号链接逃逸 | 本章 INV-017/018；实现细节见 `security-and-permissions.md` §6.2 |
| DM-SEC-002 | 人类决策 | Review 决策、MergeRecord 执行与 Approval 决策只能由人类身份发起；Agent 身份返回 403 | 本章 INV-028；`security-and-permissions.md` §5.2、SEC-020 |
| DM-SEC-003 | 敏感信息 | 密钥、Token、私钥不得写入实体字段、RunEvent、Artifact 或 Evidence；命中时脱敏并标记 | `security-and-permissions.md` SEC-003；`non-functional-requirements.md` NFR-OBS-004 |
| DM-SEC-004 | 本地暴露 | 默认只监听 127.0.0.1；CORS 与 WebSocket Origin 校验按 M1 安全基线执行 | `security-and-permissions.md` SEC-001、SEC-002、SEC-004 |
| DM-NFR-001 | 存储一致性 | SQLite 启用 WAL、busy_timeout 与单写连接；外键、唯一约束与条件更新必须覆盖本章不变量 | `non-functional-requirements.md` NFR-REL-* |
| DM-NFR-002 | 迁移原子性 | M1 迁移在事务中执行，失败整体回滚；迁移前备份 SQLite 文件；`schema_migrations` 记录校验和 | `non-functional-requirements.md` NFR-REL-* |
| DM-NFR-003 | 事件完整性 | RunEvent 只追加、seq 连续且唯一；单条超过 64 KiB 截断并标记，不阻塞执行 | 本章 3.7；`runtime-and-workspace.md` RUN-006/008 |
| DM-NFR-004 | 时间与时钟 | 所有时间 UTC；M3 心跳与租约以服务端时间为准；客户端时钟只用于显示 | 本章 7.2；`non-functional-requirements.md` NFR-OBS-* |

**明确不在本章重复的条目**：`GET /api/tasks` 延迟、看板首屏、事件推送延迟、CORS、登录、打包、遥测等阈值，分别以 `01-scope-and-roadmap.md` §6.3 与 `modules/non-functional-requirements.md` 的 `NFR-PERF-*`、`NFR-REL-*`、`NFR-OBS-*`、`NFR-NET-*` 为权威，以 `modules/security-and-permissions.md` 的 `SEC-*` 为安全权威。本章任何旧稿中的 `NFR-001`、`SEC-002`（CORS）等编号均已删除，不再作为定义。

---

## 10. 用户故事与场景

### 10.1 角色与场景

| 角色 | 典型场景 | 关键诉求 |
|---|---|---|
| 独立开发者 | 同时跑 3-5 个 Agent，分别处理前端、后端、测试、文档 | 快速创建 Task、看清每个 Run 的状态、不互相踩文件 |
| 2-10 人小团队 | 共享任务、Agent 与执行机器 | 知道谁在做什么、审批可追溯、机器不冲突 |
| UI Design Agent | 产出设计规范、组件说明、截图 | 交付物可被前端消费，评审有证据 |
| Frontend Agent | 依据设计规范与 API 契约实现界面 | 上游产物明确，变更可验证 |
| Backend Agent | 提供 API、数据模型、迁移 | 契约稳定，测试可执行 |
| DevOps Agent | 生成 Dockerfile、CI、staging 部署与生产计划 | staging 可自动，生产必须人工 |
| 人类评审者 | 审 diff、看测试、确认证据 | 一眼看出缺什么，能明确要求修改 |
| 团队管理员 | 管理成员、机器、共享 Agent | 权限清晰、审计完整 |

### 10.2 用户故事（Given/When/Then）

**故事一：任务从想法进入执行**

Given 开发者已有一个 Workspace 和至少一个 Agent  
When 开发者创建标题为「实现登录页」的 Task，并把它从 backlog 移到 todo  
Then Task 状态为 `todo`，出现在看板的 Todo 列，且可以被选择创建 Run。

**故事二：不可执行的任务不能启动**

Given 一个 Task 处于 `blocked` 状态，且 `blockedReason` 为「等待 API 契约」  
When 开发者尝试为它创建 Run  
Then API 返回 409，错误信息包含当前状态与阻塞原因，界面禁用启动按钮。

**故事三：Run 生命周期可见**

Given 一个 `todo` Task 与一个活跃 Agent  
When 开发者启动 Run  
Then 系统创建 `queued` Run，把 Task 转为 `in_progress`，Run 依次进入 `preparing`、`running`，事件面板持续显示日志，终态为 `completed` 或 `failed`。

**故事四：超时与取消可区分**

Given 一个 `timeoutMinutes` 为 30 的 Agent  
When Run 执行超过 30 分钟  
Then Run 进入 `failed`，`errorCode` 为 `timeout`，界面显示「执行超时」，而不是「已取消」。

**故事五：取消不再复活**

Given 一个 `queued` Run  
When 开发者点击取消  
Then 取消请求被持久化，调度器不会再启动它；Run 进入 `cancelled`；若已进入 `running`，Run 在宽限期内停止 Runtime 后进入 `cancelled`，且不会被后续完成回调覆盖。

**故事六：证据不足不能通过评审**

Given 一个 `completed` Run，Task 要求 `diff` 与 `test_report`  
When 评审者打开 Review，只有 `diff` Artifact，测试证据缺失  
Then Approve 按钮禁用，界面列出缺失项；评审者只能要求修改或补充证据。

**故事七：评审通过但合并仍需人工确认**

Given Review 已 `approved`，`requiresMerge` 为真  
When 开发者点击合并  
Then 系统要求显式确认并校验 `expectedHeadCommit`；没有确认时返回 409，commit 或证据快照变化时返回 412；合并成功后写入 MergeRecord。

**故事八：角色 DAG 解锁**

Given Backend Task 依赖 UI Design Task，且 UI Design 尚未完成  
When 开发者尝试启动 Backend Task  
Then Backend 保持 `blocked`，不可创建 Run；当 UI Design Task 进入 done 且其设计产物已作为 Evidence 验证后，Backend 自动转为 `todo`。

**故事九：Agent 更新不影响进行中的 Run**

Given 一个正在运行的 Run 使用 AgentVersion v3  
When 开发者修改 Agent 的 instructions 与 model，生成 v4  
Then 当前 Run 继续使用 v3，事件与结果可复现；新创建的 Run 使用 v4。

**故事十：删除被拒绝**

Given 一个 Agent 仍有活跃 Run  
When 开发者删除该 Agent  
Then API 返回 409，提示先取消或等待 Run 结束；开发者可以选择归档 Agent（M2 起归档可用）。

**故事十一：DevOps 的边界**

Given DevOps Agent 已生成 staging 部署计划  
When 它请求部署到 staging  
Then M2 系统创建 `deploy_staging` Approval，批准后执行；当它请求部署到生产  
Then 系统只生成 `deploy_prod` 审批记录与人工检查单，不提供自动执行入口，生产部署由人类在 ATeam 外完成。

**故事十二：团队职责分离**

Given 团队成员 A 发起了合并 Approval  
When 团队成员 A 尝试批准自己的请求，且组织未开启 owner 覆盖  
Then 系统返回 403；团队成员 B 具备审批权限时可以批准，并记录审计事件。

---

## 11. 交互、异常与边界

### 11.1 关键交互规则

- M0 看板只有 backlog、todo、in_progress、in_review、done 五列，`blocked` 与 `cancelled` 没有列，任务只能在 API 或状态徽章中看到。M1 起扩展为七种状态可见：五个主列加一个可折叠的「Blocked / Cancelled」辅助区；「看板列与 Task 状态一一对应」是 M1 目标，不是 M0 现状。
- 启动 Run 的按钮只在 Task 状态为 `todo` 或 `in_progress`、且没有活跃 Run 时可用；M1 起同时要求 Agent 活跃、版本存在；`in_review` 在 M1 不提供启动入口。
- Run 终态后，详情页展示摘要、错误码、Artifact 列表与事件日志；失败与取消使用不同颜色与文案。
- Review 页面必须先展示证据完整度与阻塞意见，再展示 diff；缺失证据时不允许滚动到底部直接批准。
- Merge 页面必须展示目标分支、源分支、`expectedHeadCommit`、diff 摘要、证据清单与风险提示；确认按钮默认焦点在取消，必须显式勾选「我理解该操作会修改目标分支」。
- M2 的 Approval 页面额外展示动作指纹摘要、目标 commit、风险级别与过期时间；批准按钮需要二次确认。
- 归档动作在列表中默认隐藏已归档项，提供开关；删除动作必须提示影响范围与不可恢复性。

### 11.2 空状态、加载与失败

空状态必须与「加载中」和「加载失败」区分，不能只显示空白，也不能用示例数据冒充真实数据。

| 场景 | 展示内容 | 主行动 | 失败时 |
|---|---|---|---|
| 无 Workspace | 说明 Workspace 绑定本地仓库后才能创建 Task 与 Run | 「绑定本地仓库」 | 显示失败原因与重试；不伪造默认仓库 |
| 无 Task | 说明 Task 是上下文容器，Run 如何工作 | 「新建第一个任务」 | 保留创建入口，显示加载失败横幅 |
| 无 Agent | 说明 Agent 是可复用工作配置 | 「创建 Agent」或「从模板创建」 | 显示 Runtime 探测失败原因 |
| 无 Run | 「还没有运行记录」 | 「从 Task 启动 Run」 | 显示加载失败与重试，不显示虚假耗时 |
| 无 Artifact | 「该 Run 尚未产生证据」并解释 DoD 要求 | 「查看 Run 日志」 | 标注「证据加载失败」，不显示空表格 |
| 无 Review | 「Run 完成后将生成评审」 | 「查看 Run 详情」 | 保留任务信息，评审区显示重试 |
| 无 Approval（M2） | 「没有待审批事项」 | 「返回任务」 | 显示收件箱加载失败，不丢失已选筛选 |
| 筛选/搜索无结果 | 显示当前条件与命中为空 | 「清除筛选」 | — |
| 归档列表为空 | 「没有已归档项目」 | 「返回默认视图」 | — |

加载规则：看板与详情页先显示骨架屏，避免先闪空状态；超过 300 毫秒才显示骨架，短请求不闪烁；加载失败保留旧数据并提供重试，不清空用户输入。

### 11.3 异常与边界

| 场景 | 期望行为 | 处理方式 | 里程碑 |
|---|---|---|---|
| 创建 Run 时 Task 已被删除 | 返回 404，不创建 Run | 外键与事务校验 | M1 |
| Run 排队后 Agent 被删除 | Run 启动前失败，`errorCode` 为 `runtime_error`、`failureDetail` 为 `invalid_agent_config` | 调度前重新加载并校验 | M1 |
| Task 在 Run 执行中被删除 | Run 继续执行并保留历史，UI 标注 Task 已删除；删除应被前置拒绝 | 删除前检查活跃 Run | M1 |
| 重复点击启动 Run | 只创建一个活跃 Run，其余返回 409 并返回现有 Run | 唯一约束或幂等键 | M1 |
| 取消与完成并发 | 以先通过状态守卫写入的合法终态为准；另一个记录 `cancel_lost_race` | 条件更新 | M1 |
| 两个评审者同时 approve | 只有一个成功，另一个提示已被处理 | 状态条件更新 | M1 |
| 合并前 commit 变化 | 返回 412，合并不可执行 | `expectedHeadCommit` 与证据快照校验 | M1 |
| 依赖形成环 | 拒绝添加，返回 409，不写入任何边 | 环检测 | M2 |
| 上游取消导致下游永久阻塞 | 下游保持 blocked，显示原因，允许人工改依赖或取消 | 事件与界面提示 | M2 |
| 磁盘空间不足导致 worktree 准备失败 | Run 进入 failed，`errorCode` 为 `workspace_error`、`failureDetail` 为 `workspace_provision_failed`，保留其他 Run | 预检查与错误捕获 | M1 |
| Artifact 路径穿越 | 拒绝入库并记录安全事件 | 路径规范化 | M1 |
| 事件在断线期间丢失 | 重连后全量或增量刷新，不依赖丢失的事件 | 前端刷新策略 | M0 全量，M1 增量 |
| SQLite 写锁等待超时 | 返回 503 并提示重试，不丢数据 | busy_timeout 与重试 | M0 |
| 应用重启时 Run 处于 running | 标记 `interrupted/app_restart`，要求人工重试 | 启动恢复扫描 | M1 |
| 远程 Runner 失联 | 活跃 Run 标记 `interrupted/runner_lost`，不自动改派 | 心跳与租约 | M3 |
| 时钟回拨导致 endedAt 早于 startedAt | 拒绝写入，记录告警，使用服务端时间修正 | 时间校验 | M1 |
| 日志包含密钥 | 落库前脱敏，标记 redacted | 模式扫描 | M1 |
| Workspace 的 repoPath 需要迁移 | M1 拒绝原地修改；M3 走重新绑定流程与 Approval | 409 + 迁移入口 | M1/M3 |
| Task 在 in_review 想补跑 | M1 返回 409，要求先 request changes；M2 可创建新 Review 后返工 | 状态守卫 | M1/M2 |

### 11.4 实体级权限矩阵

| 实体 | 创建 | 编辑 | 归档/删除 | 评审/审批 | M1 主体 | M3 主体 |
|---|---|---|---|---|---|---|
| Workspace | 本机用户 | 本机用户（repoPath 除外） | 归档本机；删除 M3 需 Approval | — | 本机用户 | owner 管理，admin 可归档 |
| Task | 本机用户 | 本机用户 | 归档/删除需无活跃 Run | — | 本机用户 | owner/admin/被指派 member |
| Agent | 本机用户 | 本机用户 | 活跃 Run 时拒绝 | — | 本机用户 | owner 或 agent:write |
| AgentVersion | 系统自动 | 不可编辑 | 随 Agent 保留 | — | 系统 | 系统 |
| Run | 人类或系统（有 Task/Agent） | 仅状态守卫推进 | 永不硬删除 | — | 系统 | 系统 + Runner 回报 |
| Artifact | 系统/Agent/人类 | 不可编辑 | 随 Workspace 保留策略 | — | 系统采集为主 | 同左，访问受 Run 权限 |
| Evidence | 系统/人类（M2） | 不可编辑，只能 supersede | 被引用时不得删除 | 人类可验证 | —（M2 起） | reviewer/admin |
| Review / ReviewComment | 系统/人类 | 评论可追加；Review 不可改结论 | 终态保留 | 只有人类可 approve/request changes | 本机用户 | 被指派 reviewer |
| MergeRecord | 系统（人工请求触发） | 不可编辑 | 永久保留 | 人类执行合并 | 本机用户 | 具备 merge 权限者 |
| Approval | 系统/人类请求（M2） | 不可编辑 | 终态保留 | 只有人类可批准，Agent 禁止 | —（M2 起本机用户，显式自批需确认） | owner/admin/reviewer 按矩阵 |
| Crew | 本机用户（M2 后段） | 计划批准前可改 | 取消/归档 | 计划与合并需人工 | —（M2 后段起本机用户） | maintainer 及以上 |
| Machine / Runner | 管理员 | 管理员 | 停用（disabled） | — | 隐式本地 | owner/admin |

**通用规则**：Agent 身份不能创建或批准 Approval，不能执行合并、推送、部署或删除；M1 单用户模式允许同一自然人发起并批准，但必须二次确认与留痕；M3 默认要求请求者与审批者不同，owner 覆盖必须记录原因。

---

## 12. 指标

| 指标 | 定义 | 目标 | 里程碑 |
|---|---|---|---|
| 非法状态转换次数 | 被守卫拒绝的转换请求数，按实体统计 | 可观测；不得出现绕过守卫的写入 | M1 |
| 状态机测试覆盖 | 每个允许转换有成功用例，每个禁止转换有失败用例 | 100% | M1 |
| Run 成功率 | completed / 所有终态 Run | 作为基线，不设硬目标；按 Agent 细分 | M1 |
| Run 失败归因完整率 | 带 errorCode 与 failureDetail 的 failed Run / 所有 failed Run | 100% | M1 |
| 证据完整率 | 满足 DoD 的 Review / 所有 Review | 100% | M1 基础，M2 完整 |
| 评审周期 | Review 创建到 decidedAt 的中位时长 | 作为基线，按团队优化 | M1 |
| 合并记录完整率 | 有 MergeRecord 的合并 / 所有合并 | 100% | M1 |
| 审批过期率 | expired Approval / 所有 Approval | 低于 10% | M2 |
| 审批重放拒绝次数 | 因 consumed 或指纹不匹配被拒绝的请求数 | 可观测，异常升高告警 | M2 |
| 孤儿记录数 | 无父实体的 Run/Artifact/Review 数量 | 0 | M1 |
| 迁移成功率 | 成功完成的迁移 / 总迁移 | 100%，失败必须回滚 | M1 |
| 归档恢复率 | 归档后 30 天内被恢复的比例 | 作为产品信号，用于评估删除策略 | M2 |

事件推送延迟、看板加载与并发性能不在本章重复定义，统一引用 `modules/non-functional-requirements.md` 的 `NFR-PERF-*`；本章只保留领域完整性与状态机指标。

---

## 13. 依赖与风险

| 风险 | 影响 | 缓解措施 | 里程碑 |
|---|---|---|---|
| M0 无外键，存在悬空引用 | 删除 Task/Agent 后 Run 指向不存在的实体 | M1 增加外键与删除前检查；迁移前清理孤儿数据 | M1 |
| M0 取消竞态 | 取消的 Run 可能继续执行或状态被覆盖 | M1 状态守卫、取消令牌、条件更新、终态不可变 | M1 |
| SQLite 单写连接 | 高并发 Run 事件写入可能成为瓶颈 | 批量写入、事件分表、必要时 M3 迁移 Postgres | M1/M3 |
| 事件仅 WebSocket 尽力送达 | 断线丢失通知，界面可能短暂不一致 | 前端全量刷新、REST 增量查询、M2 领域事件表 | M1/M2 |
| git worktree 跨平台差异 | Windows 路径、符号链接、文件锁问题 | 路径规范化、平台测试、失败时明确报错并提示 | M1 |
| Agent 权限未执行 | M0 的 allowedPaths/Commands 只是展示 | M2 在 Runtime 与工具层双重校验，默认拒绝 | M2 |
| 角色协作退化为自由聊天 | 上下文失控、责任不清 | 强制 DAG、契约、证据与 Review；Crew 后置 | M2 |
| 审批被泛化或重放 | 高风险动作绕过人工把关 | 动作指纹、单次消费、有效期、非 Agent 身份 | M2 |
| 生产部署误触发 | 严重事故 | ATeam 不提供 prod 自动执行；只生成计划与审批记录 | M2 |
| 敏感信息进入日志 | 密钥泄露 | 脱敏扫描、Artifact 访问控制、保留策略 | M1 |
| Schema 演进破坏数据 | 升级失败或数据丢失 | 只追加迁移、迁移前备份、失败回滚、校验和 | M1 |
| Workspace 与 Run Workspace 语义漂移 | 数据越权或查询错误 | 本章统一 Workspace 与 Run Workspace；测试覆盖跨 Workspace 拒绝 | M1/M3 |
| M1 被误认为已有 Approval | 发布说明与实现不一致 | 本章与 M1 里程碑明确 M1 只有 Review + MergeRecord | M1 |

---

## 14. 里程碑映射

| 实体/能力 | M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| Workspace | 隐式 | 显式表与默认回填 | 设置完善 | 多 Workspace 与权限 | 稳定 |
| Task | CRUD 与状态枚举 | 受控状态机、revision、acceptanceCriteria、归档 | 契约、key 评估、角色模板 | 团队权限 | 自动化触发 |
| TaskDependency | — | — | DAG 与自动解锁 | 团队可见性 | 稳定 |
| Agent | CRUD 与默认值 | 版本固定、删除保护 | 权限执行、角色模板、并发上限、归档 | 共享、workspaceId 与审计 | 插件化 |
| AgentVersion | — | 自动快照 | 草稿/发布体验 | 团队审计 | 稳定 |
| Run | queued 到终态、超时、取消接口 | worktree、分支、状态守卫、attempt、重启恢复 | 并发上限、Crew 关联、契约版本 | 远程 Runner | 定时/Webhook |
| RunEvent | 持久化与 WS | seq 唯一、类型枚举、source、截断、增量拉取 | 指标与事件表 | 远程聚合 | 稳定 |
| Run Workspace | 普通目录 | git worktree、分支、workspaceState、清理 | Crew 并行隔离 | 远程机器路径 | 稳定 |
| Artifact | — | diff、测试、日志、note、file 入库 | 截图、build、deploy_plan、脱敏 | 共享存储 | 稳定 |
| Evidence | — | 不建表，DoD 基于 Artifact 与人工例外 | 契约逐项验证 | 审计 | 稳定 |
| Review | — | 单 Run diff 评审、evidenceSnapshotHash | 多 Run 聚合评审（ReviewRun） | 团队评审流 | 稳定 |
| MergeRecord | — | 合并审计与结果 | 与 Approval 关联 | 团队审计 | 稳定 |
| Approval | — | — | merge、push、staging、delete、权限升级、命令白名单 | 职责分离 | 稳定 |
| Deliverable | — | — | 契约冻结与版本 | 团队模板 | 稳定 |
| Skill | — | — | 本地技能与版本固定 | 团队共享 | 稳定 |
| Crew | — | — | 后段实验（十字段状态机） | 队长模式完善 | 稳定 |
| Machine/Runner | 隐式本地 worker | 本地 Runner 语义 | 本地并发 | 远程注册与调度 | 稳定 |
| 领域事件 | WS 尽力送达 | 稳定命名、增量同步 | 本地事件表 | 审计与远程通知 | 插件订阅 |

**M0 现状盘点（以仓库代码为准）**

- 已实现：Task、Agent、Run、RunEvent 四个领域结构；SQLite 持久化；REST 与 WebSocket；mock 与最小 claude 适配器；Vue 看板；Wails 壳。
- 部分实现：Run Workspace 只有普通目录；run 事件已持久化但无唯一约束；取消接口存在竞态；Task 状态可任意跳转；Agent 名称/标题只校验非空；labels/priority 无范围校验。
- 未实现：Workspace 表、AgentVersion、TaskDependency、Artifact、Evidence、Review、MergeRecord、Approval、Deliverable、Skill、Crew、Machine、Runner、git worktree、远程执行、登录与团队权限。
- 已知技术债：无外键、无分页、无归档、无乐观锁、CORS 反射任意 Origin、Agent 模型/并发/权限字段未生效、Runtime 未知时静默回退 mock、`UpdateRun` 无条件更新。

**迁移策略（M1）**：采用只追加迁移。

1. 新增 `workspaces` 表（id、name、repo_path、default_branch、remote、worktree_root、verification_commands、protected_branches、task_prefix、settings、status、created_at、updated_at、archived_at），插入默认 Workspace `default`。
2. `tasks` 增加 `workspace_id`，默认指向默认 Workspace，回填后改为非空；增加 `acceptance_criteria`、`blocked_reason`、`revision`、`archived_at`。
3. `runs` 增加 `workspace_id`、`workspace_state`、`agent_version_id`、`attempt`、`error_code`、`failure_detail`、`queued_at`、`last_event_at`、`cancel_requested_at`、`base_commit`、`head_commit`、`runtime_session_id`。
4. 新增 `artifacts`、`reviews`、`review_comments`、`merge_records`、`agent_versions`。M1 **不创建** `approvals`、`evidence`、`task_dependencies`、`contract_versions`、`crews` 表。
5. 添加外键、唯一约束与索引；所有迁移在事务中执行，失败整体回滚；迁移前自动备份 SQLite 文件；`schema_migrations` 增加校验和。
6. 旧稿中的产品级 `projects` 表如已存在，按迁移脚本重命名为 `workspaces`；Run Workspace 不建产品级表，元数据保留在 `runs`。M2 如需租约或清理队列，可增加 `run_workspaces` 附属表。

M3 迁移到 Postgres 时保持 ID 值不变，按同一语义重建约束；`agents` 增加 `workspace_id`、`visibility`、`owner_id`，`workspaces` 增加团队归属。

---

## 15. 与其他文档的关系

| 文档 | 负责内容 | 本章如何引用 |
|---|---|---|
| `prd/00-product-overview.md` | 愿景、用户、JTBD、产品原则、PROD 需求、里程碑总表 | 产品原则优先；本章的实体与状态必须支撑 PROD-003 至 PROD-009 |
| `prd/01-scope-and-roadmap.md` | 范围、里程碑路线图、发布标准、安全不变量、跨里程碑数据与 API 约定 | 范围与安全不变量优先于本章；NFR/SEC 阈值以该文档与模块文档为准 |
| `prd/03-user-flows.md` | 单人闭环、角色流水线、Crew、评审与审批、失败恢复、团队模式等端到端流程 | 流程引用本章实体与状态；不另起实体名 |
| `prd/04-acceptance-and-test-plan.md` | 按模块与里程碑的验收标准、测试矩阵、质量门 | 引用模块需求编号；引用本章时必须写 `DM-` 前缀，避免同名前缀冲突 |
| `prd/05-risks-and-open-questions.md` | 风险登记、假设、治理决策与开放问题 | 本章风险与其编号对应；开放问题见第 16 章 |
| `prd/modules/task-management.md` | Task 生命周期、状态、优先级、标签、父子关系、上下文组成 | Task 字段与状态以本章为准；该文档的 `workspaceId` 应改为 M1，`blockedReason` 应改为 M1，`version` 应统一为 `revision`，`contract` 应统一为 `deliverableContract` |
| `prd/modules/agent-system.md` | Agent 配置、instructions、Runtime、模型、并发、超时、路径与命令权限 | Agent 字段与版本以本章为准；该文档可保留模块级 UI 细节；`workspaceId` 在 M3 增加，M1-M2 明确为安装级共享 |
| `prd/modules/runtime-and-workspace.md` | Run 生命周期、调度、Runtime adapter、事件流、取消、超时、worktree、Artifact/Evidence | Run/RunEvent/Run Workspace 语义以本章为准；该文档 §8.7 的「M1 采用产品级 Workspace、不引入 Workspace」应改为「M1 采用 Workspace 表」；心跳与失联处置按本章 3.14 |
| `prd/modules/collaboration-and-review.md` | 任务 DAG、交付物契约、角色模板、审批门、Crew、收件箱、技能与模板、评审 | 契约、Review、Approval、Crew 状态以本章为准；Crew 状态机与其 §7.2 一致；其 §8.2 的 `revoked` 作为本章 `cancelled` 的别名，不另立状态 |
| `prd/modules/security-and-permissions.md` | 权限模型、路径与命令策略、风险分级、审批、审计、密钥管理 | `SEC-*` 是安全权威；本章只引用，不重复定义 CORS、远程模式等 |
| `prd/modules/non-functional-requirements.md` | 性能、可靠性、可移植性、可访问性、可观测性、数据保留、成本 | `NFR-*` 是 NFR 权威；本章不维护第二套阈值 |
| `prd/modules/api-and-data.md` | REST 与 WebSocket 契约、错误模型、事件类型、版本策略、数据模型 | 错误码与实体字段以本章为准；`SERVER_RESTART`、`RUN_INTERRUPTED` 等应映射为 `interrupted/app_restart`；规范路径为 `/api/v1/workspaces`，`/api/v1/projects` 仅为兼容别名 |
| `prd/modules/ui-ux.md` | 看板、任务详情、Run 控制台、评审界面、设置、空状态与错误状态 | UI 行为与空状态以该文档为准；本章 11.2 只给领域级空状态与主行动摘要 |
| `prd/milestones/M0-scaffold.md` | M0 已完成骨架与已知缺口 | 本章 M0 盘点与其一致；发现差异以代码为准并回写两者 |
| `prd/milestones/M1-local-loop.md` | M1 目标、范围、交付物、验收 | M1 使用 Workspace/workspaceId、Review + MergeRecord、无 Approval；本章据此修订 |
| `prd/milestones/M2-role-agents.md` | M2 角色协作、契约、审批、Crew | Approval、Evidence、Deliverable 从 M2 开始；本章与其保持一致 |
| `prd/milestones/M3-team-mode.md` | 团队模式、Postgres、远程 Runner、机器注册 | Machine/Runner 状态与心跳以本章 3.14 为准；`disabled` 替代 `revoked` 状态，`interrupted` 替代顶层 `runner_lost` |
| `prd/milestones/M4-automation-and-packaging.md` | 自动化、通知、打包、插件、遥测 | 只引用本章实体；不新增领域实体 |

**文档地图说明**：仓库当前没有 `prd/01-product-overview.md`、`prd/03-system-architecture.md`，也没有 `prd/modules/task.md`、`agent.md`、`run.md`、`workspace.md`、`artifact-review.md`、`collaboration.md`、`api.md`。本章只引用实际存在的文件；架构内容暂由 `runtime-and-workspace.md` 与 `01-scope-and-roadmap.md` 承担，如后续新建架构文档，再补链接。里程碑矩阵在本章第 14 章，不在第 15 章。

**需求编号映射**：本章使用 `DM-` 前缀，与模块文档隔离。后续模块文档引用本章领域语义时，使用 `DM-` 编号；验收计划 `04` 默认引用模块文档编号，只有明确指向本章时才写「02-domain-model DM-xxx」。不得再把本章的旧 `TASK-001`、`RUN-001`、`SEC-002`、`NFR-001` 当作与模块文档同义的编号引用。

**跨文档同步清单（本章修订后需回写）**：

| 文档 | 需要同步的点 |
|---|---|
| 00-product-overview.md | 采用本章开头的五级文档优先级声明；概念词典中的 Workspace 指产品级实体，Run Workspace 单独定义；Approval Gate 与 Evidence 明确 M2；NFR 引用改为模块编号；文档地图中 02 的需求前缀改为 `DM-` |
| 01-scope-and-roadmap.md | 采用本章开头的五级文档优先级声明；M1 数据变化改为 `workspaces`、`artifacts`、`reviews`、`review_comments`、`merge_records` 与 Run 扩展字段；`evidence` 与 `approvals` 从 M2 起；Run 字段名按本章；NFR-001/003 标注为历史别名 |
| M1-local-loop.md | Workspace 字段名统一为 `repoPath`/`defaultBranch`；新增 API 统一 `/api/v1` 前缀；合并明确为 Review + MergeRecord，不使用 Approval；Run Workspace 默认保留期 30 天 |
| modules/task-management.md | `workspaceId` 从 M1 起必填；`blockedReason` 改为 M1；`version` 改为 `revision`；`contract` 改为 `deliverableContract`；补 `acceptanceCriteria`；删除 M1 硬删除与双事件名 |
| modules/agent-system.md | `name` 1-80 是 M1 目标；明确 M1-M2 无 `workspaceId`，M3 增加；归档 M2 |
| modules/runtime-and-workspace.md | 产品级归属统一为 Workspace；分支格式改为 `ateam/{taskShort}/{slug}-{runShort}`；心跳 15/45/90；失联 `interrupted/runner_lost`；清理保留期 30 天 |
| modules/collaboration-and-review.md | Approval 状态以本章 4.6 统一；Crew 状态机与 4.8 一致；Artifact/Evidence 字段以本章为准；Evidence 的 `status` 用 passed/failed/missing/waived，`validity` 用 valid/unverified/invalid |
| modules/api-and-data.md | 错误码映射；规范路径 `/api/v1/workspaces`（`/api/v1/projects` 别名）；M1 无 `/api/approvals` 与 `/evidence`（M2）；M1 合并接口 |
| modules/non-functional-requirements.md | 旧 `NFR-001` 等别名已映射；本章不再新增 NFR 编号 |
| modules/security-and-permissions.md | Approval 的 `projectId`/`delete_project` 改为 `workspaceId`/`delete_workspace`；`teamWorkspaceId` 属于团队工作区概念，保留并在 M3 定义其与 Workspace 的关系；Approval 状态采用本章 `pending`/`cancelled` 规范值（`requested`/`revoked` 仅作别名）；Machine/Runner 状态 `disabled`；`SEC-*` 编号保持权威 |
| milestones/M2-role-agents.md | Approval/Evidence/Deliverable M2 口径与本章一致；引用本章 `DM-` 编号 |
| milestones/M3-team-mode.md | 心跳 15/45/90；Machine `disabled`；Run `interrupted` |
| 04-acceptance-and-test-plan.md | 引用本章时使用 `DM-` 前缀；更新编号映射表 |

**代码映射**：`internal/domain/domain.go` 是 M0 领域结构的唯一来源；`internal/store/migrations/0001_init.sql` 是当前 schema；`packages/shared/src/index.ts` 是前端类型镜像。任何字段或状态变更必须同时更新这三处与本章，避免文档、后端、前端三方不一致。

---

## 16. 待确认/未文档化

以下问题不影响本章作为基线使用，但需要在对应里程碑启动前明确。每项给出当前建议，默认按建议执行，除非产品负责人另有决定。已在本版裁决的事项不再列为开放问题。

1. **界面命名**：Workspace 统一称「项目」，Run Workspace 称「运行工作区」。需在 M1 设计稿评审时确认中英文混排与首次解释文案。
2. **单 Task 活跃 Run 数量**：M1 严格限制为一个；M2 起按 `collaboration-and-review.md` §6.3 的 `parallelRunPolicy` 执行，默认 `single`，允许任务显式设为 `multiple`；Crew 子任务是独立 Task，不受父任务 `single` 限制。
3. **Run completed 与 Task done 的文案**：建议界面把 Run 的 completed 显示为「执行完成」，把 Task 的 done 显示为「验收通过」，避免用户误以为执行成功即任务完成。
4. **blocked 的原因分类**：当前只有自由文本 `blockedReason`。M2 建议增加原因类型（依赖、外部系统、等待决策、权限、资源），用于统计与自动解锁。
5. **AgentVersion 的生成时机**：M1 自动快照，M2 引入草稿/发布。若团队希望 M1 就有显式发布，需要增加草稿状态与发布权限。
6. **Crew 的里程碑归属**：M2 后段以实验开关交付；若进度紧张可顺延到 M3 前段，不影响 M2.1 主验收。
7. **Artifact 与事件保留期（已裁决）**：Run Workspace 默认保留 30 天；Artifact、Evidence 与 RunEvent 默认保留 90 天；均按 Workspace 配置。本地审计事件默认保留 90 天，团队审计默认保留 180 天。完整保留策略表以 `non-functional-requirements.md` 与 `security-and-permissions.md` 的同一张表为准。
8. **Approval 有效期（已裁决）**：merge 24 小时、staging 4 小时、prod 30 分钟且不允许「不自动过期」；其他类型默认 72 小时。阈值与 `security-and-permissions.md` §5.3 保持一致。
9. **Task key 格式**：建议 `{taskPrefix}-{number}`，前缀 2-6 个大写字母，编号在 Workspace 内递增且不复用；M3 评估是否落地。
10. **领域事件持久化时机**：M2 增加本地 `domain_events` 表，M3 接入审计。若 M1 就需要断线不丢事件，需要提前实现事件表。
11. **M3 Postgres 的 ID 类型**：继续使用 24 位 hex 字符串，不改为 UUID 或自增，以避免迁移期 ID 变化。需在 M3 技术设计时确认索引与存储成本。
12. **Agent maxConcurrency 的语义**：超过上限的 Run 保持 `queued`，而不是直接拒绝。需要确认队列可见性与超时策略。
13. **Evidence 的验证者**：M2 建议由人类评审者标记 `passed` 或 `waived`，系统采集的测试结果可自动标记 `passed`/`failed`；若希望自动验证测试报告，需要定义可信执行环境与签名机制，暂不在 M2 范围。
14. **Workspace 仓库迁移**：`repoPath` 创建后不可原地修改；M3 提供重新绑定流程，要求没有活跃 Run、重新校验分支，并生成 Approval 与审计。具体交互待设计。
15. **契约版本存储（已裁决）**：M2 采用 Deliverable（`deliverables`）+ `contract_versions`；Task 的 `deliverableContract` 只作为当前版本投影，不作为唯一事实来源；`Task.contract` 为弃用别名。JSON payload 与查询方式在 M2 数据模型评审中细化。
16. **Machine/Runner 状态命名（已裁决）**：本章统一状态值 `disabled`、动作/事件 `revoke`；安全模块与 API 文档已按此回写，不再接受 `revoked` 作为状态值。
17. **M1 `in_review` 补跑例外（已裁决）**：M1 不允许从 `in_review` 创建新 Run；M2 的返工仍按 §4.2 的例外执行，必须先创建新 Review 或记录取代原因。
18. **Approval 与 MergeRecord 的长期关系**：M2 起 Approval 授权、MergeRecord 记录执行结果；M4 若做自动合并（仍禁止），必须先修改本章与安全不变量，不得绕过人工确认。
