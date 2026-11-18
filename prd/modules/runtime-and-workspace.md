# 模块：Runtime、机器与工作区

## 本章导读

本章定义 ATeam 中「一次任务如何真正被执行」的产品契约，覆盖 Runtime Adapter、执行机器与 Runner、工作区隔离、Git 集成、Artifact/Evidence，以及 Run 生命周期与安全边界。阅读本章可以回答四个问题：谁执行、在哪里执行、如何证明执行结果、失败与高风险动作如何被治理。

文中统一使用「已实现（M0）」「部分实现（M0）」「计划（M1）」「计划（M2）」「计划（M3）」标注能力状态。除明确标注为已实现的内容外，其余均为产品需求，不得在对外说明中当作现有能力描述。当前仓库的 Go core、SQLite、REST/WS API、mock runtime、Vue 看板与 Wails 壳构成 M0 基线；git worktree、真实 Claude Code 流式适配、远程 Runner、沙箱、打包与团队权限均尚未实现。

**术语约定**：本章严格采用 `02-domain-model.md` §2.3 的两级语义。**Workspace（产品级工作区）** 是绑定本地 git 仓库与默认分支的顶层归属边界，M0 为隐式默认 Workspace，M1 建表；**Run Workspace（运行工作区）** 是某次 Run 的隔离执行环境，M0 为普通目录，M1 起为 git worktree 与独立分支。后文凡指执行目录，一律写「Run Workspace」或「worktree」，不再单独使用「Workspace」指代执行环境。

## 1. 目的与范围

### 1.1 目的

ATeam 的核心闭环是 Task（上下文容器）→ Agent（可复用工作配置）→ Run（一次执行）→ Run Workspace（隔离工作区）→ Runtime（Claude Code、Codex 或 mock）→ Artifact/Evidence（diff、测试、截图）→ Human Review → Merge。本章位于该闭环的执行段，负责把 Task 的上下文和 Agent 的配置转换成一次可观测、可取消、可审计、可评审的运行。

具体目标如下。

1. **统一执行抽象**：用同一个 Runtime Adapter 契约承接不同编码 Agent CLI，使 Task、Agent、Run 的领域模型不依赖某一家工具的私有协议。
2. **隔离与可回溯**：每次 Run 拥有独立工作区与分支，任何修改都不直接落在用户当前分支上，评审者可以精确看到「这次执行改了什么」。
3. **可观测**：Run 的状态、排队原因、事件流、耗时、退出原因、资源使用与失败分类都可查询，而不是只留下一个「成功/失败」。
4. **证据化完成**：完成不等于 Agent 自称完成，而是具备 diff、测试输出、日志、截图等可核验证据，并由人工评审门确认。
5. **安全与治理**：以当前用户身份执行时，明确路径与命令边界；合并、推送、部署、删除等高风险动作必须经过人工审批；团队模式下运行在受控的 Runner 与机器上。

### 1.2 范围

本章覆盖以下产品能力：

- Runtime Adapter 的接口契约、事件模型、能力探测与选择规则；
- mock、Claude Code、Codex 三类 Runtime 的支持范围与差异；
- 本地 Runner 与远程 Runner 的注册、心跳、租约、并发、离线处理；
- 工作区模式：Run Workspace 的目录、git worktree、直接运行，以及后续的 clone 与容器；
- Git 集成：fetch、worktree、branch、diff、commit、merge、push、PR；
- Artifact 与 Evidence 的类型、采集、存储、展示与保留；
- Run 的状态机、排队原因、失败分类、重试、取消、超时与重启恢复；
- 执行身份、允许路径、允许命令、凭据处理、审批门与 Docker 沙箱；
- 与本章相关的数据结构、API、WebSocket 事件、指标与里程碑映射。

### 1.3 当前实现基线（M0）

当前仓库的真实能力如下表所示。产品、设计与测试应以「现状」列为准，避免把路线图能力写入当前版本说明。

| 能力 | 当前实现（M0） | 主要差距 |
| --- | --- | --- |
| Runtime 接口 | `Adapter` 仅包含 `Name()` 与 `Run(ctx, Request, emit)`；事件只有 `log` 与 `summary` | 没有显式 Cancel/Probe/Capabilities 方法，没有结构化事件分类 |
| mock adapter | 已实现，按固定四步、每步约 350 毫秒输出日志与总结 | 不产生真实代码修改，不可作为完成证据 |
| Claude Code adapter | 最小实现：查找 PATH 中的 `claude`，以 `claude -p prompt` 在 workdir 执行，逐行转发 stdout/stderr | 不传 model、不解析 stream-json、不处理权限模式、不支持会话恢复与预算控制 |
| Codex adapter | 未实现 | 计划在 M2 提供 |
| OpenCode adapter | 已实现（M2.1 模型子项交付）：`run --format json`、`--model`、plan agent 只读、JSONL 事件映射、进程组取消、`opencode models` 模型目录与连通性测试 | 无路径级拦截，隔离依赖 worktree；`full_access` 的 `--auto` 需 UI 警示 |
| Scheduler | 进程内 worker 池，默认并发 2，队列容量 256，支持 context 取消与按 Agent 超时 | 无持久化队列、无排队原因、无每 Agent 并发限制、重启后队列丢失 |
| 机器与 Runner | 只有本地进程内 Runner；`ateam runner` 子命令仅提示 M3 预留 | 无 Machine 实体、无注册、心跳、租约、远程执行 |
| 工作区 | 每次 Run 在 `~/.ateam/workspaces/runs/{runId}` 创建普通目录；`workspaceMode` 字段被存储但被忽略 | 无 git worktree、无分支、无 diff、无清理策略 |
| Git 集成 | 无任何 Git 操作 | fetch、worktree、diff、commit、merge 全部计划在 M1 |
| Artifact/Evidence | 仅 Run 的 summary、error 与 run event 日志 | 无 diff、测试输出、截图、用量、证据集合 |
| 取消与超时 | 取消通过 context 传播；超时取 `Agent.TimeoutMinutes`；API 会立即把 Run 标记为 cancelled | 排队中的 Run 取消后仍可能被执行；运行中的取消存在状态回写竞态；超时被归类为 failed |
| 安全边界 | 以当前 OS 用户身份执行；`allowedPaths`、`allowedCommands` 仅存储、未执行 | 无路径/命令约束、无沙箱、无审批门、无凭据脱敏 |

## 2. 非目标

以下内容不在本章的产品范围内，至少不在对应里程碑之前：

1. **不托管或转售模型**：ATeam 不自建模型服务，不代管用户 API Key，不提供模型计费；Runtime 使用用户自己的本地 CLI、订阅或 Key。
2. **不做通用 CI/CD 平台**：本章的 Git 与测试能力服务于单次 Agent Run 的证据与评审，不承担持续集成、制品发布、环境编排。
3. **不做任意命令编排器**：ATeam 不是远程 shell，不提供任意的长时间后台任务、定时脚本执行或服务器运维能力。
4. **不做多租户 SaaS**：M3 的团队模式面向 2 至 10 人小团队的自托管或共享实例，不提供组织隔离、计费、公有云多租户。
5. **不自动合并**：无论证据多完整，合并到受保护分支必须由人确认；ATeam 不提供无人值守的自动合并。
6. **不在 M1 前支持跨机器迁移运行中的进程**：M1 的 Run 绑定本机；M3 的远程 Runner 也不做进程热迁移。
7. **不替用户管理 Git 凭据**：M1 只使用本机已有的 Git 配置与凭据；M3 的 PR 集成使用用户显式授权的凭据引用。
8. **不把 mock 运行当作真实交付**：mock 仅用于演示、联调与自动化测试，不产生可合并的代码。
9. **不承诺对所有语言与构建系统开箱即用**：证据采集依赖 Agent 声明与可配置命令，ATeam 不内置每种技术栈的测试矩阵。
10. **不把 Agent Team 会话回合当作 Run**：M2.3 的会话回复以 `read_only` 调用 Runtime，但不创建 Run、不产生 Artifact、不写仓库；会话用量只记录在消息上。执行与证据仍以 Run 为唯一载体。

## 3. 角色与场景

### 3.1 角色

| 角色 | 关注点 | 与本章的关系 |
| --- | --- | --- |
| 独立开发者 | 同时跑 3 至 5 个 Agent，快速看到结果与失败原因 | 创建 Run、查看事件流、取消/重试、评审 diff 并合并 |
| 小团队成员（2 至 10 人） | 共享任务、Agent 与机器，避免互相踩工作区 | 选择机器、查看他人 Run 的证据、审批高风险动作 |
| 评审者 / 仓库维护者 | 改动是否可控、测试是否可信、是否触碰敏感路径 | 依赖 Artifact/Evidence、审批门、合并策略 |
| Agent 配置者 | 角色 Agent 的 Runtime、模型、超时、路径与命令边界 | 配置 Agent 的执行参数与工作区模式 |
| 平台管理员（M3） | 机器注册、离线、审计、密钥与版本 | 管理 Machine/Runner、吊销令牌、查看审计日志 |

### 3.2 典型场景

本节除注明 M0 外，描述的都是目标态能力，不代表当前仓库已实现。每个场景标注其完整成立所需的里程碑。

**场景 A（M1）：独立开发者并行推进三个任务。** 开发者在看板把三个 Task 分别交给 Frontend、Backend、Docs 三个 Agent。三者的 Run 分别获得独立 worktree 与分支，事件流互不干扰；开发者在一个页面看到三份 diff 与测试结果，逐个评审后合并。注意并行发生在不同 Task 之间；同一 Task 在 M1 仍保持单活跃 Run。

**场景 B（M3）：小团队共享两台机器。** 队员 A 的笔记本只跑轻量任务，队员 B 的工作站承担需要 Docker 的集成测试。团队在 Machine 页面看到两台机器的在线状态、槽位占用与运行中的 Run；任务调度遵守机器标签与并发上限。

**场景 C（M2）：角色 Agent 串行交付。** UI Design Agent 先产出设计说明与截图证据，Frontend Agent 依赖其交付物契约再开始实现，Backend Agent 的接口契约由任务 DAG 约束。任何 Agent 的完成都必须附带约定证据，而不是在同一个会话里自由聊天。

**场景 D（M1）：长任务与超时。** 一个重构任务的 Run 超过 60 分钟仍未结束。系统按 Agent 超时终止进程，把 Run 置为 `failed`，`errorCode=timeout`，保留已产生的事件与部分 diff，允许人工决定重试或放弃。

**场景 E（M1 合并审批；M2 部署审批；M3 推送审批）：高风险动作审批。** Backend Agent 完成了代码与测试，但合并、推送与部署属于审批门范围；系统展示证据清单，等待有权限的人批准后才执行合并，DevOps Agent 在 M2 只能生成 staging 部署计划，生产部署由人工执行。

**场景 F（M3）：机器离线。** 远程 Runner 在执行中失联，控制面在心跳超时后把 Run 置为 `failed`，`errorCode=interrupted（failureDetail=runner_lost）`，保留租约记录与最后事件，不自动在其他机器重跑，避免双执行与代码分叉；由人工决定重试（新 Run）或放弃。

## 4. 领域对象与状态模型

### 4.1 对象关系

- **Machine**：一台物理机或虚拟机，拥有操作系统、架构、标签与能力集合；M3 引入。
- **Runner**：Machine 上运行的一个受控进程，向控制面注册、心跳、领取 Run 并回报事件；M0 为内嵌在服务进程中的本地 Runner。
- **Task**：上下文容器，定义「要做什么」与验收条件。
- **Agent**：持久配置，定义「谁来做、用什么 Runtime、什么模型、什么边界」。
- **Run**：Task 与 Agent 的一次组合执行，是所有状态、事件、证据与 Git 产物的归属主体。
- **Workspace（产品级）**：绑定本地 git 仓库路径与默认分支的顶层归属边界，回答「这些数据属于哪个项目」；M0 为隐式默认 Workspace，M1 建表，详见 `02-domain-model.md` §3.1。
- **Run Workspace（运行工作区）**：某次 Run 独占的执行环境，M0 为普通目录，M1 起为 git worktree 与分支；元数据记录在 Run 的 `branch`、`worktree`、`baseCommit`、`headCommit` 字段上。
- **Artifact / Evidence**：Run 产生的可核验材料，Artifact 是材料本身，Evidence 是把 Artifact 绑定到 Task 交付物契约条目的证据记录。

关系约束：一个 Workspace 拥有多个 Task、Agent 与 Run；一个 Task 可有多个 Run（M1 同一时刻至多一个活跃 Run，M2 Crew 例外）；一个 Agent 可被多个 Run 引用，但每个 Run 固定一个 AgentVersion；一个 Run 只绑定一个 Run Workspace；一个 Run 可产生多个 Artifact；Run 的状态与事件只追加、不改写历史语义。

### 4.2 Run 状态机

Run 的状态集合全库唯一，以 `02-domain-model.md` §4.3 为准：`queued`、`preparing`、`running`、`completed`、`failed`、`cancelled` 六个状态。**不引入 `blocked`、`interrupted`、`awaiting_approval` 作为 Run 状态**：

- 执行中断是 `failed` 的一种原因，通过 `errorCode=interrupted`（应用重启）或 `errorCode=interrupted（failureDetail=runner_lost）`（Runner 失联）表达，不新增状态。
- 合并冲突不改变 Run 状态：Run 保持 `completed`，合并接口返回结构化冲突错误，由人工解决或新建 Run。
- 等待审批由独立的 Approval 实体承载（M1 的合并确认、M2 的审批门），Run 不进入「等待审批」状态。

#### 4.2.1 M0 现状

M0 已实现的状态与迁移如下。这张表描述的是代码实际行为，不是目标契约。

| 状态 | 含义 | 代码中允许的下一状态 |
| --- | --- | --- |
| `queued` | 已创建并进入内存 channel，尚未占用 worker | 实际上可被任意覆盖为 `preparing`（包括已取消的 Run） |
| `preparing` | 正在创建 Run Workspace 目录 | `running`、`failed`；API 可在任意时刻直接写 `cancelled` |
| `running` | Adapter 已启动并持续产生事件 | `completed`、`failed`、`cancelled` |
| `completed` | Adapter 正常返回 | 无保护，可被后续写入覆盖 |
| `failed` | 准备或执行失败，`error` 字段记录原因 | 无保护，可被后续写入覆盖 |
| `cancelled` | API 收到取消请求后直接写入 | 无保护，可被 worker 覆盖为 `preparing`/`running`/`completed` |

**M0 的真实缺陷（必须按此理解现状）**：`scheduler.execute` 领取 Run 后不检查当前状态；`Cancel` 只查找取消句柄，排队中的 Run 没有句柄，API 却已把状态写为 `cancelled`。因此存在两个竞态：

1. **排队中取消被覆盖**：Run 仍留在 channel 中，worker 取出后把状态重新设为 `preparing` 并继续执行；mock 正常结束时写回 `completed`，claude 失败时写回 `failed`。取消不生效。
2. **运行中取消的终态取决于 adapter**：API 先写 `cancelled`；随后 adapter 返回错误，`execute` 无条件重写终态。mock adapter 返回 `context.Canceled`，最终为 `cancelled`；claude adapter 因进程被 kill，返回的是 `claude exited: signal: killed`，最终被写为 `failed`，而不是 `cancelled`。

因此「终态不可回退」是 **M1 要求**，M0 并未实现。

M0 缺口与 M1 的对应修复、测试用例如下，便于实现方逐条关闭：

| M0 缺口 | 现状 | M1 修复 | 对应用例 |
| --- | --- | --- | --- |
| 状态守卫缺失 | `execute` 领取 Run 后不检查当前状态 | 所有状态写入使用 compare-and-set，非法迁移写 `status_rejected` | 取消后 worker 领取不得迁移为 preparing；adapter 晚到的终态写入被拒绝 |
| 队列移除缺失 | queued Run 无取消句柄，仍留在 channel | 取消令牌覆盖 queued 与 preparing，worker 领取前二次校验 | queued 取消后不创建 Run Workspace、不启动进程 |
| 取消令牌缺失 | 仅 running 阶段登记 cancel 函数 | preparing 阶段可中断 Git 与目录准备 | preparing 取消后清理半成品 worktree |
| 终态不可变缺失 | 任何路径都可覆盖 completed/failed/cancelled | 终态写入拒绝并记录事件 | 重复取消、自然完成与取消竞态均不改变既有终态 |

#### 4.2.2 M1 目标状态机

| 状态 | 含义 | 进入条件 | 退出 / 下一状态 | 责任方 | 引入 |
| --- | --- | --- | --- | --- | --- |
| `queued` | 已创建，等待调度 | 创建 Run 成功，且同一 Task 无其他活跃 Run，已固定 `agentVersionId` | `preparing`（调度器）、`cancelled`（人工）、`failed`（启动前校验失败） | API / 调度器 | M0 |
| `preparing` | 准备 Run Workspace、读取 AgentVersion 快照并启动 Runtime | 调度器领取且状态仍为 `queued` | `running`、`failed`、`cancelled` | 调度器 | M0 |
| `running` | Adapter 正在执行 | worktree 就绪且 Runtime 已启动 | `completed`、`failed`、`cancelled` | 调度器 | M0 |
| `completed` | 执行正常结束 | adapter 正常返回 | 终态，不可回退 | 调度器 | M0 |
| `failed` | 准备失败、执行异常、超时、权限拒绝或中断 | adapter 错误、超时、权限拒绝、重启恢复、启动前校验失败 | 终态；重试创建新 Run | 调度器 | M0 |
| `cancelled` | 人工取消且已实际停止 | 取消请求被调度器确认并完成终止 | 终态；重试创建新 Run | 用户 + 调度器 | M0 |

状态机规则（M1 起强制执行）：

1. 每次状态写入都必须带前置状态校验（compare-and-set）；终态不可回退；任何非法迁移被拒绝并记录 `status_rejected` 事件。
2. 重试必须创建新 Run，`attempt` 在原 Task 的尝试序号上加一，不复用旧 Run。
3. 状态变更与事件写入必须能区分「谁改的」：用户取消、调度器推进、Runner 回报、审批结果。
4. `completed` 不得仅表示「进程退出码为 0」；M1 起还要求证据采集流程完成，否则按 §10.4 的 DoD 判定进入待补证状态或 `failed`（`errorCode=runtime_error`，`failureDetail=evidence_missing`）。
5. 取消必须先由调度器确认实际停止，再写 `cancelled`；不得由 API 先写状态、再由执行路径覆盖。
6. 应用重启时，`preparing`/`running` 且无存活执行者的 Run 写为 `failed`，`errorCode=interrupted`（对齐 `04-acceptance-and-test-plan.md` AC-RUN-11），不引入 `interrupted` 状态。

### 4.3 执行权、工作区与证据的归属

执行权属于 Run，不属于 Agent。Agent 可以复用，但每次 Run 的 Run Workspace、分支、事件序号、Artifact 都按 Run 独立存放。这样设计的目的，是让并行执行、重试与审计都围绕 Run 展开，而不是围绕一个长期存在的 Agent 会话展开。Agent 的 `maxConcurrency` 只限制同时运行的 Run 数量，不构成会话共享；Run 创建时固定 `agentVersionId`，执行期只读该快照，排队期间修改 Agent 不影响已创建的 Run（对齐 `02-domain-model.md` §3.5）。

产品级 Workspace 与 Run Workspace 的归属关系：Run 携带 `workspaceId` 指向产品级 Workspace，其 `worktree`、`branch`、`baseCommit`、`headCommit` 描述该 Run 的 Run Workspace。M1 默认只有一个 Workspace，M3 才允许一个安装实例拥有多个 Workspace。

## 5. 用户故事

以下用户故事均以 Given/When/Then 描述，覆盖 M0 到 M3 的目标行为；标注的里程碑表示该故事计划被完整满足的时间点。

**US-RUN-01（M0，已实现）创建并观察一次 mock 运行**
Given 一个状态为 todo 的 Task 和一个 runtime 为 mock 的 Agent，
When 用户在任务页点击 Run，
Then 系统创建一个 queued 状态的 Run，随后依次进入 preparing 与 running，事件流出现分步日志，最终变为 completed 并带有 summary。

**US-RUN-02（M0，已实现）拒绝不可执行的 Task**
Given 一个状态为 backlog 或 done 的 Task，
When 用户或 API 尝试为它创建 Run，
Then 系统返回冲突错误并提示先把 Task 移到 todo 或 in_progress，不创建 Run。

**US-RUN-03（M1）为每次运行准备独立 worktree**
Given 一个已绑定本地仓库的 Workspace 和一个 worktree 模式的 Agent，
When 用户启动 Run，
Then 系统 fetch 最新远端状态，从指定 base branch 创建唯一分支与 worktree，把 worktree 路径写入 Run，并保证同一 Task 的多次 Run 使用不同 worktree 与分支；M1 同一 Task 同时只允许一个活跃 Run，重复启动返回 409。

**US-RUN-04（M1）查看 diff 与测试证据**
Given 一个已完成的 Run，
When 评审者打开 Run 详情，
Then 可以看到相对 base 的 diff、改动文件列表、测试命令与退出码、测试输出摘要、运行日志与总结，并可下载或复制这些证据。

**US-RUN-05（M1）取消排队中的运行**
Given 一个仍在 queued 的 Run，
When 用户点击 Cancel，
Then Run 立即进入 cancelled，且调度器不会再执行它，不产生任何 Run Workspace 或 Adapter 进程。

**US-RUN-06（M1）取消运行中的运行**
Given 一个处于 running 的 Run，
When 用户点击 Cancel 并确认，
Then 系统先请求优雅终止，超过宽限期后强制终止子进程，Run 进入 cancelled，事件流保留取消原因与时间点。

**US-RUN-07（M1）超时后保留现场**
Given Agent 配置了 30 分钟超时，
When Run 执行超过 30 分钟，
Then 系统终止进程，Run 进入 failed 且 `errorCode=timeout`，已产生的日志、事件与部分 diff 仍可查看。

**US-RUN-08（M1）重试失败运行**
Given 一个因网络或 Runtime 临时不可用而失败的 Run，
When 用户点击 Retry，
Then 系统创建新的 Run，`attempt` 在原值上加一，复用同一 Task 与 Agent，但使用新的 worktree 与分支，旧 Run 保持原状。

**US-RUN-09（M2）按角色 Agent 的权限边界执行**
Given 一个只允许修改 `apps/web` 且只允许执行 `pnpm test` 的 Frontend Agent，
When 它在 Run 中尝试修改其他路径或执行未授权命令，
Then 系统阻止该动作、记录 permission_denied 事件，并在证据中标注被拒动作，Run 可按策略继续或失败。

**US-RUN-10（M1）完成定义要求证据**
Given 一个类型为代码变更且要求测试证据的 Task，
When Agent 声称完成但没有测试输出，
Then 系统不允许直接把 Task 移到 done，要求补充证据或由人工记录例外并说明理由；mock Run 的证据一律不计入。

**US-RUN-11（M2）高风险动作等待审批**
Given 一个已通过代码评审的 Run，
When 用户请求合并到受保护分支，
Then 系统展示 diff 摘要、测试证据与目标分支，等待人工批准后执行合并；被拒绝时不产生任何 Git 变更。M1 的合并确认由 Review + `confirm=true` 承担，M2 升级为 Approval 实体。

**US-RUN-12（M3）远程机器执行**
Given 管理员已注册一台在线 Runner 并授予团队使用，
When 用户选择该机器启动 Run，
Then 控制面下发租约，Runner 在本地仓库副本中执行并回报事件与证据；机器离线超过宽限期后 Run 置为 failed 且 `errorCode=interrupted（failureDetail=runner_lost）`，不自动重跑。

**US-RUN-13（M3）机器离线与恢复**
Given 一台 Runner 在 Run 执行中心跳超时，
When 控制面确认其离线，
Then 机器状态变为 offline，运行中的 Run 置为 failed 且 `errorCode=interrupted（failureDetail=runner_lost）`，租约冻结；机器恢复后由人工决定重试（新 Run）或放弃，Runner 不得自行恢复为 running。

**US-RUN-14（M0，部分实现）查看运行历史**
Given 用户进入 Runs 页面，
When 列表加载完成，
Then 可以看到每个 Run 的状态、所属 Task、触发方式、创建时间与摘要或错误；失败原因以人类可读文本展示。

## 6. Runtime Adapter

### 6.1 接口契约

M0 的 Adapter 契约非常小：`Name()` 返回稳定标识，`Run(ctx, Request, emit)` 执行一次运行，通过 `emit` 回报事件，遇到错误时返回 error。`Request` 包含 RunID、TaskID、AgentID、Prompt 与 Workdir。取消通过 `context.Context` 传播，超时由调度器在调用 Adapter 前用 `context.WithTimeout` 包装。

产品层面需要把这一契约扩展为可测试的完整能力集合，但扩展必须保持向后兼容：现有两个 adapter 可以继续工作，新能力以可选接口或能力声明的方式逐步加入。

| 契约要素 | M0 现状 | 计划要求 | 里程碑 |
| --- | --- | --- | --- |
| 标识 | `Name()` 返回 `mock` 或 `claude` | 标识稳定、全局唯一、大小写不敏感匹配；创建 Agent 时校验 | M1 |
| 执行 | `Run` 同步阻塞直到结束 | 保持同步语义，内部自行管理子进程；调度器负责超时 | 已实现（M0） |
| 事件流 | `emit` 回调；`domain.RunEvent` 已含 type、message、payload、createdAt，并由调度器从 1 起分配 seq | 增加来源（stdout/stderr/system/adapter）、`level`、事件语义分类与 `(run_id, seq)` 唯一/连续约束、超长截断规则 | 部分实现（M0 已有基础字段与 seq，缺来源、level、约束） |
| 取消 | 依赖 context，`exec.CommandContext` 终止进程 | 明确取消语义：优雅终止宽限期、强制终止、取消确认 | M1 |
| 超时 | 调度器按 Agent 包装 context | Adapter 需把超时映射为可分类错误，不得吞掉 | M1 |
| 能力探测 | 无 | `Probe()` 返回是否安装、版本、可用模型、所需凭据状态 | M1 |
| 能力声明 | 无 | 声明是否支持模型选择、结构化流、会话恢复、截图、预算 | M2 |
| 工作目录 | `Workdir` 字符串 | 必须是已准备的 Run Workspace 绝对路径；不得为空 | M1 |
| 参数映射 | 仅 prompt | 模型、权限模式（M1）；允许工具、预算、环境变量白名单（M2） | M1 起分批 |
| 错误契约 | 返回 error 文本 | 返回可分类错误码与可读信息，调度器映射为规范 `errorCode` 与 `failureDetail` | M1 |

### 6.2 事件模型

事件是 Run 可观测性的最小单位。M0 只有 `log` 与 `summary` 两类，且 `log` 混合了正常输出与 stderr。M1 起需要按语义分类，使 UI 能折叠、过滤、生成时间线与证据。

| 事件类型 | 含义 | M0 状态 | 计划里程碑 |
| --- | --- | --- | --- |
| `log` | 普通文本日志，允许高频与折叠 | 已实现 | 保持 |
| `summary` | 运行结束时的总结 | 已实现 | 保持 |
| `status` | Adapter 阶段变化，如启动、等待权限、收尾 | 未实现 | M1 |
| `tool_call` | Agent 调用工具或命令的开始 | 未实现 | M1 |
| `tool_result` | 工具或命令的结果摘要 | 未实现 | M1 |
| `file_change` | 文件新增、修改、删除的路径与统计 | 未实现 | M1 |
| `test_result` | 测试命令、退出码、通过/失败计数 | 未实现 | M1 |
| `artifact` | 指向一个已落盘的证据对象 | 未实现 | M1 |
| `permission_request` | 需要人工确认的权限请求 | 未实现 | M2（需先在 `02-domain-model.md` §3.7 登记枚举） |
| `usage` | token、费用估算、模型与耗时 | 未实现 | M1（以 `status` 事件 + `subtype=usage` 表达，暂不新增顶层类型） |
| `error` | 结构化错误事件，含分类码 | 未实现 | M1 |
| `done` | 显式结束事件，带结果与证据摘要 | 未实现 | M1（以 `status` 事件 + `subtype=done` 表达，暂不新增顶层类型） |

事件规则：

1. 事件按 Run 分配单调递增的 `seq`。M0 由调度器在进程内从 1 计数并持久化；M1 增加 `(run_id, seq)` 唯一约束，保证同一 Run 内唯一且连续，重启后从数据库最大值继续。
2. 每个事件至少包含 type、message、payload 与 createdAt；M1 增加来源字段（`stdout`、`stderr`、`system`、`adapter`）与 `level`（`debug`、`info`、`warn`、`error`），见 `02-domain-model.md` §3.7。
3. 事件 payload 只允许 JSON 可序列化内容，单条 message 建议不超过 64 KiB；超长输出必须截断并标记 `truncated=true`，完整内容写入 `log_bundle` Artifact。
4. stderr 不得伪装成普通日志：M0 已有 `[stderr]` 前缀但无结构化来源字段；M1 起保留来源字段，失败诊断以 stderr 与退出码为主要依据。
5. 事件写入失败不能阻断运行，但必须记录本地告警；证据型事件写入失败应使 Run 的完成判定降级。
6. 事件中包含的 token、密钥、URL 凭据必须在落库前脱敏。
7. `test_result` 事件与 `test_report` Artifact 的唯一生产者是系统验证命令（`source=system`）；Adapter 的测试调用只产生 `tool_call`/`tool_result`，Agent 自述只作为 `note` 或日志，不得伪装为系统验证。

### 6.3 已支持与计划支持的 Runtime

| Runtime | 状态 | 适用场景 | 关键限制 |
| --- | --- | --- | --- |
| `mock` | 已实现（M0） | 演示、UI 联调、自动化测试、无 CLI 环境 | 不产生真实修改，不可作为交付证据 |
| `claude` | 已实现（M1 完整版） | 使用本机 Claude Code CLI 执行真实编码任务 | 模型目录来自本地 `modelPicker`/`ANTHROPIC_*_MODEL`，CLI 不枚举模型 |
| `opencode` | 已实现（M2.1） | 使用本机 OpenCode CLI 与其配置的任意模型（DeepSeek、GLM、MiniMax 等） | 权限边界弱于 Claude：read_only 用 plan agent，无路径级拦截；依赖 worktree 隔离 |
| `codex` | 计划（M2） | 使用本机 Codex CLI 作为替代 Runtime | 协议与参数不同，需要独立 adapter 与能力声明 |

对 Runtime 的产品约束：

- ATeam 不内置模型调用，不代理请求，不缓存用户代码；Runtime 进程直接在用户机器或受控 Runner 上运行。
- 一个 Agent 绑定一个 Runtime 名称；Run 创建后不再切换 Runtime，切换必须新建 Run。
- 同一台机器可以同时安装多个 Runtime；能力探测结果按机器与用户环境分别记录。
- 未知 Runtime 名称不得回退到 mock；M0 的静默回退仅作为脚手架行为，M1 必须改为显式错误。

### 6.4 Runtime 选择、校验与回退

M0 的 Registry 在找不到指定名称时返回 mock adapter，这会让配置错误表现为「运行成功但没有改动」，是产品上不可接受的误导。计划规则如下：

1. 创建或更新 Agent 时，若 Runtime 不在注册表中，返回校验错误并列出可用 Runtime。
2. 启动 Run 前再次校验，防止 Agent 保存后运行环境变化导致 Runtime 不可用。
3. Runtime 存在但 CLI 不在 PATH、未登录或版本不兼容时，Run 进入 failed，`errorCode=runtime_error`，并以 `failureDetail` 区分 `runtime_missing`、`runtime_auth`、`runtime_version_unsupported`，错误信息给出可执行的修复建议（错误码映射见 §11.3）。
4. 只有 Agent 显式选择 mock 时才允许 mock 运行；UI 在 Run 详情与列表上显示明显的 mock 标识。
5. 自动重试不得把失败的 claude Run 降级为 mock 重跑。

### 6.4.1 模型目录与本地模型配置（M2.1）

Agent 的模型选择不再是自由文本，而是所选 Runtime 的**模型目录**。目录由三部分合并去重：

1. **Runtime 探测**：Adapter 的 `Probe()` 返回本机该 Runtime 可用的模型标识。不同 CLI 能力不同：能枚举的返回真实列表；不能枚举的返回空列表并给出 `modelsError`，不得伪造模型名。
2. **Claude Code 本地配置**：从 `CLAUDE_CONFIG_DIR/settings.json`（默认 `~/.claude/settings.json`）读取 `modelPicker.options[]` 与 `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_FABLE_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL` 等模型别名；只读取模型键与展示名，**不得读取或记录 token/API Key**。这些条目标记为本地配置，供用户直接选择（例如 DeepSeek、GLM、MiniMax）。
3. **本地模型配置**：用户在 ATeam 设置中为某个 Runtime 维护的模型 ID 列表，存储在本机配置中，不包含密钥。用于补足 CLI 无法枚举或用户使用自定义模型 ID 的场景。

模型条目至少包含：`id`、`label`、`source`（`runtime`/`settings`）、`default`（是否 Runtime 默认）、`status`（`available`/`unverified`/`unavailable`）、`deprecated`。规则：

- `id` 是不透明字符串；ATeam 不解释其语义，只做精确匹配与展示；`label` 缺失时展示 `id`。
- 合并时按 `id` 去重；同一 `id` 以 Runtime 探测条目的状态为准，本地配置只补充缺失项。
- 空模型值表示「使用 Runtime 默认」，始终是下拉首项；目录为空时只允许空模型。
- 目录按 Runtime 缓存，TTL 60 秒；用户可手动刷新。探测失败时返回本地配置列表与 `modelsError`，不得把过期缓存当作实时结果。
- 模型目录只用于选择与校验，不改变权限、隔离或审批；模型不可用不自动降级到其他模型。
- Agent 保存时按目录校验；Run 启动时若目录可用则再次校验，不可用时交由 Adapter 返回 `runtime_error`，不得静默改用默认模型。

**Runtime 列表的发现规则**：`GET /runtimes` 除已注册 Adapter 外，还必须扫描 PATH 中已知的 harness CLI（至少 `claude`、`codex`、`opencode`、`cursor-agent`，可扩展 `gemini`、`qwen`、`aider`）。已安装但没有执行适配器的 CLI 必须以 `supported=false` 返回并展示，禁止把它当作可执行 Runtime；UI 下拉中禁用并标注「暂不支持执行」。有适配器的 Runtime 才允许创建 Agent 与启动 Run。

### 6.5 Claude Code Adapter

M0 的最小实现行为：在 PATH 中查找 `claude`；以 `claude -p` 加完整 prompt 启动；设置 `Workdir`；逐行扫描 stdout 与 stderr；扫描缓冲上限 1 MB；进程退出后返回错误或发出 summary。该实现足以验证端到端链路，但不满足真实使用要求。

M1 的完整适配要求：

1. **结构化输出**：使用 CLI 支持的机器可读输出模式，把文本、工具调用、工具结果、用量与错误解析为对应事件，而不是把所有内容压成 log。
2. **模型映射**：Agent.Model 为空时使用 CLI 默认模型；非空时必须是 §6.4.1 模型目录中的 `id`，保存时校验，Run 启动时目录可用则复检；选择结果写入 Run 事件与配置快照。不得静默改用默认模型。
3. **权限模式**：根据 Agent 的路径与命令配置选择只读、受控编辑或完全授权模式；完全授权必须由用户在 Agent 配置中显式开启并在 UI 警示。
4. **会话与上下文**：一次 Run 默认无历史会话；需要延续时使用明确的会话标识并记录在 Run 元数据中，禁止隐式复用上一次会话。
5. **预算与限额**：支持最大轮次或费用上限参数（若 CLI 提供）；达到上限时产生 `usage` 事件并以可分类原因结束。
6. **环境变量**：只传递白名单变量与 Runtime 必需的凭据变量；不得把完整父进程环境打印到日志。
7. **版本兼容**：记录 CLI 版本；对已知不兼容版本给出明确提示，而不是在解析失败后泛化报错。
8. **取消与超时**：优先发送优雅终止信号，宽限期后强制终止；取消后仍需回收子进程，避免僵尸进程占用 worker。

### 6.6 Codex Adapter

Codex 计划在 M2 提供，定位是「同一 Task、同一 Agent 配置下的另一种执行引擎」，而不是与 Claude 并行的双 Agent 会话。产品要求：

1. 能力探测返回 Codex CLI 是否安装、版本、可用模型与登录状态。
2. 非交互执行参数、工作目录、模型与沙箱策略映射到 Codex 的对应选项；无法等价映射的 Agent 配置必须在启动前拒绝，并说明差异。
3. 结构化输出解析为统一事件类型；无法解析的行降级为 log，但不得丢失错误信息。
4. 能力声明中标明是否支持会话恢复、图片输入、预算控制；UI 对不支持的配置项禁用或提示。
5. Codex 与 Claude 产生的 Artifact 使用同一套类型与存储规则，评审界面不因 Runtime 不同而分裂。

### 6.7 OpenCode Adapter（M2.1）

OpenCode 适配器让 Agent 使用本机 OpenCode CLI 及其配置的任意模型（DeepSeek、GLM、MiniMax 等）。调用契约：

- 非交互执行：`opencode run --format json [--model provider/model] "<prompt>"`，工作目录为 Run Workspace；长提示词省略消息参数、经 stdin 传入；
- 模型选择：`--model provider/model`，`id` 与 `opencode models` 枚举一致；为空使用用户 OpenCode 默认模型；
- 权限映射：`read_only` 传 `--agent plan`（只读规划 agent）；`controlled_edit` 使用默认 agent；`full_access` 额外传 `--auto`（自动批准权限，必须在 UI 显式开启并警示）；OpenCode 无路径/命令级强制，隔离依赖 worktree 边界，隔离等级 B；
- 事件映射：JSONL 的 `step_start`→status、`text`→assistant 日志、`tool_use`→tool_call/tool_result（按 state.status）、`step_finish`→usage（tokens/cost）、`error`→error 事件并映射为 Run 失败；
- 取消与超时：进程组 SIGTERM→10 秒宽限→SIGKILL，与 Claude 适配器一致；
- 模型目录与连通性测试：`opencode models` 枚举目录；`TestModel` 以 plan agent 发送一次最小只读请求。

### 6.8 Mock Adapter

Mock 的产品定位是「可预测的演示与测试替身」：

- 固定步骤与固定耗时，便于截图、演示与自动化测试断言。
- 输出明确声明「这是 mock 运行」，不得让用户误以为产生了真实修改。
- 不创建文件、不调用外部命令、不访问网络。
- 在 M1 的证据化完成定义中，mock Run 不能被计为满足代码变更类 Task 的证据。
- Mock 仍应遵守事件、取消与超时契约，以便作为其他 adapter 的契约测试基准。

### 6.9 流式输出与背压

真实 Agent 可能在一秒内产生数百行输出。M0 逐行写库并广播，缺少限流，输出洪峰会造成数据库写入放大与 WebSocket 阻塞。M1 要求：

1. 对 `log` 事件按时间窗口合并，保留原文到本地日志文件，数据库只保存合并后摘要与指针。
2. 关键事件（error、tool_result、test_result、artifact、done）不得合并或丢弃。
3. 单 Run 事件速率超过阈值时，降低采样并向 UI 提示「日志已限流」，同时保留完整日志文件供下载。
4. WebSocket 客户端消费过慢时允许丢弃低优先级日志事件，但必须保证状态事件最终一致。
5. Adapter 的 stdout/stderr 读取协程必须在进程退出后完全结束，避免 goroutine 泄漏。

### 6.10 模型与凭据

- 模型选择属于 Agent 配置，不属于 Task；同一 Task 可以用不同 Agent 以不同模型重试。
- API Key、订阅凭据由用户在本机 CLI 或环境变量中管理，ATeam 只读取状态，不持久化明文密钥。
- 如果未来提供凭据引用，只保存引用名与作用域，不保存值；日志与事件必须脱敏。
- 团队模式下，凭据绑定到 Machine/Runner 或用户，不跨用户共享；管理员可以吊销，但不能查看明文。
- 用量事件只记录可获得的 token 数与估算费用，不承诺与供应商账单完全一致。

## 7. 机器与 Runner

### 7.1 概念边界

**Machine** 是执行资源的载体，**Runner** 是 Machine 上的受控执行进程，**Scheduler** 决定哪个 Run 交给哪个 Runner。M0 三者合一：服务进程内嵌调度器与执行器，机器就是当前电脑。M3 将三者拆开，以支持团队共享与远程执行。

拆分的产品价值：

- 团队可以把重任务放到性能更好的机器，把需要特定依赖的任务放到装有 Docker 或浏览器的工作站。
- 代码不离开代码所在机器：控制面只保存任务上下文、Run 元数据与证据索引；远程机器上的仓库副本由该机器的 Runner 管理。
- 机器离线、重启或升级不再等同于「服务不可用」：运行中的 Run 以 `failed` + `errorCode=interrupted（failureDetail=runner_lost）` 结束，保留最后事件与租约记录，由人工决定重试或放弃，不做自动热迁移。

### 7.2 本地 Runner（M0）

M0 的行为与限制：

- `ateam serve` 与 Wails 桌面壳都会在进程内启动 scheduler；桌面壳使用随机本地端口，API 仅监听 `127.0.0.1`。
- 并发由全局 `Concurrency` 配置决定，默认 2，可由 `--concurrency` 覆盖；所有 Agent 共享该并发。
- 队列是容量 256 的内存 channel；API 入队最多等待 5 秒，超时后 Run 仍停留在 queued 但无人执行，这是已知缺陷。
- 进程重启后，内存队列丢失；数据库中的 queued/preparing/running Run 不会被恢复执行。
- 本机是隐式的本地执行者，但没有 Machine 记录、没有心跳、没有槽位视图。M0 不展示任何「机器」实体。

M1 需要补齐的本地 Runner 能力：持久化队列或启动时重扫、排队原因、每 Agent 并发、孤儿状态修复、Run 与 worker 的绑定记录。

### 7.3 远程 Runner（M3）

远程 Runner 的产品契约：

1. **出站连接**：Runner 主动连接控制面，不需要在用户机器上开放入站端口；连接使用 TLS。
2. **注册**：管理员生成一次性注册令牌，Runner 首次启动时提交令牌、机器名、标签与能力清单，换取长期机器身份与轮换凭据。
3. **领取**：Runner 按自身槽位与标签请求可执行的 Run，控制面以租约方式下发，避免多个 Runner 同时执行同一 Run。
4. **回报**：事件、状态、Artifact 通过同一协议回传；网络中断时本地缓冲并按序重放，重复事件以 RunID 与 seq 去重。
5. **隔离**：Runner 使用专用系统用户或容器运行（M3 起可选），不共享控制面的数据库与文件系统。
6. **升级**：Runner 上报版本与协议版本；不兼容时拒绝领取新 Run，但允许完成已领取的 Run。

### 7.4 注册、心跳与状态

计划的 Machine 字段与规则（以 `02-domain-model.md` §3.14 为准）：

| 字段 | 含义 | 规则 |
| --- | --- | --- |
| `id` | 机器唯一标识 | 注册后生成，不复用 |
| `name` | 人类可读名称 | 团队内唯一，可修改 |
| `os`、`arch` | 操作系统与架构 | 注册时上报，变更需重新注册 |
| `hostnameHash` | 主机名哈希 | 服务端保存哈希，不保存原始主机名 |
| `labels` | 调度标签，如 `docker`、`browser`、`gpu` | 管理员维护，任务可按标签选择 |
| `capabilities` | 已探测的 Runtime、Git、Docker、磁盘空间 | 心跳时更新，用于可调度性判断 |
| `status` | `pending`、`online`、`offline`、`draining`、`disabled` | 由心跳与管理员操作驱动；`revoke` 是动作与事件名，不是状态值 |
| `lastSeenAt` | 最近心跳时间 | 超过阈值未更新则 offline |
| Runner `concurrency` | 机器槽位上限 | 管理员配置，实际并发取全局、机器、Agent 三者最小值（M3） |

心跳规则：Runner 默认每 15 秒发送心跳，连续 45 秒缺失判定 offline，租约 90 秒未续期视为过期，与 `02-domain-model.md` §3.14 一致；心跳间隔可配置但不得低于 10 秒，避免网络抖动导致误判。`draining` 表示不再领取新 Run，但允许运行中的 Run 完成，用于升级与维护；`disabled` 表示注册被停用，拒绝心跳与新 Run（旧稿的 `revoked` 状态已废弃）。

### 7.5 并发与排队

调度并发按三级约束计算，并分期落地：

1. **全局并发（M0 已有，M1 补齐排队原因）**：控制面级别的上限，防止单实例过载；M0 由 `--concurrency` 控制，默认 2，超出时 Run 留在内存 channel。
2. **Agent 并发（M2）**：同一 Agent 同时运行的 Run 数上限，M0 字段已存在但未生效，M2 由调度器强制执行。
3. **机器槽位（M3）**：每台 Machine 的上限，由 Runner 的 `concurrency` 与能力探测结果决定。

有效并发取三者最小值。超出时 Run 保持 queued，并记录主要排队原因。排队策略在 M1 采用「先入先出 + Task 优先级加权」，M2 引入依赖 DAG 后，未满足依赖的 Run 不得占用槽位；需要避免低优先级任务长期饥饿，计划对等待时间设置提升因子。M1 还需保证同一 Task 的活跃 Run 互斥：已有活跃 Run 时，新 Run 创建请求直接返回 409，而不是进入队列。

### 7.6 离线、租约与故障处理

- **租约**：Runner 领取 Run 时获得带过期时间的租约，并在运行期间按心跳续约；租约过期后其他 Runner 不得直接接管，必须先由控制面确认原 Runner 失联并把 Run 置为 `failed`（`errorCode=interrupted（failureDetail=runner_lost）`）。
- **离线**：机器离线时，其运行中的 Run 不自动重跑；在宽限期后置为 `failed`，`errorCode=interrupted（failureDetail=runner_lost）`，保留最后事件与租约信息。与 `02-domain-model.md` §3.14 语义一致。
- **恢复**：机器重新上线后，已结束的 Run 不会恢复为 running。若原进程仍存活，Runner 只能上报残留进程信息并请求人工处理；由人工选择重试（创建新 Run）或放弃。Runner 不得自行恢复 running，避免绕过真相与审批。
- **分裂脑防护**：同一 Run 的租约在同一时刻只能有一个持有者；控制面拒绝来自旧租约持有者的事件写入，要求其重新注册。
- **维护窗口**：管理员将机器置为 draining 后，新 Run 不再分配，已有 Run 完成后自动转为 offline 或维护状态。

### 7.7 机器能力探测

Runner 启动与每次心跳时探测：

- 操作系统、架构、主机名与 Runner 版本；
- `git` 是否存在与版本；
- 各 Runtime CLI 是否存在、版本与登录状态摘要；
- Docker 是否可用、是否允许挂载与网络；
- 工作目录所在磁盘的可用空间；
- 已安装的测试工具链（可选，用于提示而非强制）。

探测结果只用于调度与提示，不作为安全保证。安全边界仍由路径、命令与沙箱策略执行。

## 8. Run Workspace（运行工作区）与仓库绑定

本章的「工作区」一律指 Run Workspace（某次 Run 的隔离执行环境）。产品级 Workspace 的字段与生命周期见 `02-domain-model.md` §3.1，本节 8.7 只说明两者的映射。

### 8.1 工作区模式

| 模式 | 定义 | 隔离程度 | 计划里程碑 |
| --- | --- | --- | --- |
| `directory` | 每次 Run 一个独立空目录，不与仓库关联 | 目录级，无 Git 隔离 | 已实现（M0，实际唯一行为；`Agent.WorkspaceMode` 被存储但被忽略） |
| `worktree` | 从 Workspace 绑定的仓库创建独立 git worktree 与分支 | Git 级隔离，修改互不覆盖 | M1，默认模式 |
| `direct` | 直接在用户当前工作区执行，不创建 worktree | 无隔离，需显式确认 | M2（需在 Agent schema 登记后启用） |
| `clone` | 在远程机器上克隆仓库副本后执行 | 机器级 + 目录级隔离 | M3 |
| `container` | 在容器中挂载副本并执行 | 进程、文件系统与网络可受限 | M3 起可选 |

M0 的 `Agent.WorkspaceMode` 默认为 `worktree`，但 `workspace.Manager.Prepare` 忽略该参数，只会创建 `~/.ateam/workspaces/runs/{runId}` 普通目录，实际行为等价于 `directory`。这是一个必须被文档与 UI 明确标注的差距：M0 的 Run 之间不会互相覆盖，但也不会产生可评审的 Git 差异。

### 8.2 M0 的临时工作区行为

- 数据根目录默认为 `~/.ateam`。启动参数 `--db` 只修改数据库文件位置；`DataDir` 与工作区根目录仍固定为 `~/.ateam`，除非通过配置对象显式设置 `DataDir`。不能通过 `--db` 推导工作区位置。
- 工作区固定位于数据目录下的 `workspaces/runs/{runId}`。
- 目录创建权限为 0755，未做属主隔离；同一台机器上的其他用户可能读取。M1 起按 SEC-007 收紧为 `~/.ateam` 0700、数据库与证据 0600。
- 目录不会在 Run 结束后自动删除，也没有保留期与清理 UI，长期使用会累积垃圾。
- Run 的 `worktree` 字段保存该目录路径，`branch` 字段始终为空。
- 若目录创建失败，Run 进入 failed，错误信息以 `prepare workspace` 开头；M0 没有结构化 `errorCode`，M1 映射为 `workspace_error`。
- 该模式适合验证调度、事件与 UI，不适合真实代码任务。

### 8.3 git worktree 设计（M1）

M1 的目标是让每次 Run 的修改可精确评审、可独立合并、可安全丢弃。标准流程：

1. **解析仓库**：根据 Task 所属的产品级 Workspace 读取 `repoPath` 与 `defaultBranch`（见 `02-domain-model.md` §3.1）；M1 只支持已存在的本地仓库，不自动 clone。
2. **同步**：执行 `git fetch`，默认只 fetch 目标 base branch 所在 remote；失败时按网络错误处理，允许人工重试。
3. **校验 base**：只要求 base branch 存在且能被解析；不要求主工作区干净。允许用户存在未提交修改：worktree 从 base branch 的 commit 创建，diff 基准固定为 `baseCommit`，用户未提交的修改不会进入 Run，也不会被 Run 覆盖。UI 在启动前提示「主工作区存在未提交修改，它们不会参与本次 Run」。
4. **生成分支名**：按命名规则生成唯一分支，检查本地与远程是否已存在，冲突时追加短后缀。
5. **创建 worktree**：在 `~/.ateam/worktrees/{repoSlug}/{runId}` 创建 worktree，并记录分支、`baseCommit`、worktree 路径。
6. **执行**：Adapter 的 `Workdir` 指向 worktree 绝对路径；所有文件修改与命令都在该目录内发生。
7. **采集**：Run 结束后采集 `git status`、diff、改动文件列表与提交信息；未提交的修改也属于证据。
8. **保留**：worktree 在评审完成前保留；合并或放弃后按清理策略删除。

仓库级并发约束：同一仓库的 fetch 与 worktree 增删需要串行化，使用进程内锁与文件锁双重保护；不同 Run 的 Adapter 执行可以并行，但不得同时改写同一个分支。

**子模块与稀疏检出（M1 明确范围）**：

- 子模块：M1 不执行 `git submodule update`，worktree 中的子模块目录为空。检测到 `.gitmodules` 时，启动前提示「本次 Run 不包含子模块内容」；若任务需要子模块，Agent 会因缺少依赖失败，用户应改用 M2 的专项支持或手动预置。
- 稀疏检出：M1 不支持在启用 `core.sparseCheckout=true` 的仓库上创建 worktree，检测到时拒绝启动并说明原因，避免产生不完整的工作树。
- 以上两项在 M2 进行专项验证后再决定是否支持，不能静默忽略。

### 8.4 分支命名

默认规则：`ateam/{taskShort}/{slug}-{runShort}`；`slug` 为空时退化为 `ateam/{taskShort}/{runShort}`，与 `02-domain-model.md` §3.8 和 M1-local-loop §15.3 一致。

- `taskShort` 取 Task ID 前 8 位，避免标题变化导致分支名漂移。
- `slug` 由 Task 标题生成，转小写、空格转连字符、移除不安全字符、截断至 32 字符；标题为空时省略该段。
- `runShort` 取 Run ID 前 6 位，保证同一 Task 多次运行不冲突。
- 分支名总长度不超过 100 字符，兼容常见 Git 托管平台限制。
- 禁止使用受保护分支名、`HEAD`、以 `-` 开头的名称，以及包含 `..`、空格、`~`、`^`、`:`、`?`、`*`、`[`、`\` 的名称。
- M2 允许按 Workspace 的 `settings.branchTemplate` 配置前缀与模板；模板变量至少包含 task、agent、run、date。

### 8.5 直接运行模式（M2）

直接运行用于「用户明确希望 Agent 在当前工作区改代码」的场景，例如单人或紧急修复。产品规则：

1. 启动前必须弹出确认，列出当前分支、未提交修改数量与风险：Agent 的修改会与用户修改混在一起，无法自动区分。
2. 同一仓库同一时刻只允许一个 direct Run，避免多个 Agent 互相覆盖。
3. direct Run 不自动提交、不自动切分支；diff 证据以运行前后快照对比生成。
4. 运行前提示用户先提交或 stash；若用户拒绝，Run 记录 `worktreeDirty=true`，评审时必须人工确认。
5. direct Run 默认不参与自动重试，避免重复污染工作区。

### 8.6 生命周期与清理

Run Workspace 生命周期：`provisioning` → `active` → `review` → `archived` → `removed`。

- `provisioning`：正在 fetch 或创建 worktree；失败则 Run 进入 failed，`errorCode=workspace_error`。
- `active`：Adapter 执行中。
- `review`：Run 结束，等待人工评审；worktree 必须保留。
- `archived`：评审完成、已合并或已放弃；按保留策略等待清理。
- `removed`：worktree 已删除，记录保留路径与删除时间，便于审计。

清理规则：

- 未合并且有改动的 worktree 不得自动删除，只能由用户显式确认删除。
- 已合并或已放弃的 worktree 默认保留 30 天（对齐 `02-domain-model.md` §3.8），之后可自动清理；保留期可配置。评审未完成的 worktree 不进入自动清理。
- 启动扫描 `~/.ateam/worktrees` 与数据库记录，发现无主目录时标记为 orphan，不自动删除，提供清理入口。
- 删除 worktree 前执行 `git worktree prune` 的等价安全检查，避免破坏用户其他 worktree。
- 磁盘空间低于阈值时暂停创建新 worktree，并在 UI 提示清理。

### 8.7 与产品级 Workspace 的映射

M1 采用 `02-domain-model.md` §3.1 的 Workspace 实体，不再单独引入 Project/Repository 概念。本章关心的字段映射如下：

| 本章旧概念 | 归属实体 | 字段 | 说明 |
| --- | --- | --- | --- |
| 项目名称 | Workspace | `name` | 显示名 |
| 本地仓库路径 | Workspace | `repoPath` | 规范化绝对路径，创建后不可原地修改 |
| 默认 base branch | Workspace | `defaultBranch` | 新 Run 的基线与 fetch 目标 |
| remote 名称 | Workspace | `settings.remote` | 默认 `origin`，M1 仅支持一个 remote |
| 工作区根目录 | Workspace | `settings.worktreeRoot` | 默认 `~/.ateam/worktrees` |
| 分支命名模板 | Workspace | `settings.branchTemplate` | 默认规则见 §8.4 |
| 受保护分支列表 | Workspace | `settings.protectedBranches` | 合并审批与直推拦截的依据 |
| 验证命令 | Workspace | `settings.verificationCommands` | 系统复跑测试的命令列表，见 §10.2 |

一个 Task、Agent 与 Run 都属于且只属于一个 Workspace；Run 继承其 Workspace 的仓库配置。M3 支持以 URL 绑定远程仓库，由远程 Runner 在本地 clone 或复用缓存副本，但仍以 Workspace 为归属边界。

## 9. Git 集成

### 9.1 能力清单

| Git 能力 | 说明 | 里程碑 |
| --- | --- | --- |
| `fetch` | 获取 base branch 最新状态 | M1 |
| `worktree add/remove/list/prune` | 创建、删除、枚举与清理隔离工作区 | M1 |
| `branch` | 创建与删除 Run 分支 | M1 |
| `diff` | 生成 base 与工作区之间的统一 diff 与统计 | M1 |
| `status` | 列出改动、未跟踪文件与冲突 | M1 |
| `commit` | 在 Run 分支上按策略提交 | M1 |
| `merge` | 人工审批后合并到目标分支 | M1 |
| `push` | 人工审批后推送 Run 分支 | M3 |
| `pull request` | 创建或更新 PR 并回填链接 | M3 |
| `clone` | 远程机器准备仓库副本 | M3 |

### 9.2 diff 与评审

diff 证据必须明确基准，否则评审者无法判断改动范围。M1 规则：

1. 以 Run 创建时记录的 `baseCommit` 为基准，展示 `baseCommit...HEAD` 的提交差异与工作区未提交差异；Run 结束时记录 `headCommit`，评审与审批都必须引用该 SHA。
2. 同时展示 `git status` 的未跟踪文件；二进制文件标注类型与大小，不强行展示内容。
3. diff 以统一格式存储为 Artifact（类型 `diff`），并提供结构化的改动文件统计；评审界面按文件折叠、显示行号与统计。
4. 超过大小阈值的 diff 截断展示，完整内容保留在 Artifact 文件中；截断标记写入 Artifact 元数据。
5. 如果 Run 期间 base branch 前进，评审界面提示「基准已变化」，允许重新生成 diff，但不自动 rebase。

### 9.3 commit、branch 与 merge

- **commit**：默认在 Run 成功后、由系统在 Run 分支上提交一次，消息包含 Task 标题、Task ID 与 Run ID 短码；提交作者使用当前 Git 身份。若没有改动则不提交，并记录 `no_changes` 事件。
- **branch**：Run 分支只属于该 Run，不与其他 Run 共享；分支删除只发生在 worktree 清理时，且不得删除未合并提交所在分支，除非用户显式放弃。
- **merge**：必须人工审批。默认使用 `squash` 策略到目标分支，可选 `merge`；M2 增加 `rebase`。审批记录绑定 `headCommit` 与目标分支当时的 commit，合并前若任一发生变化则要求重新审批或 rebase。合并成功后发出 `merge.completed` 事件并记录合并结果 Artifact。
- **冲突**：不自动解决冲突。合并时检测到冲突，接口返回结构化冲突结果（冲突文件列表与合并基准），Run 保持 `completed` 不变；由人工在本地解决后重新发起合并，或新建 Run 处理冲突。不引入 `blocked` 状态，也不把冲突伪装成 Run 执行失败。
- **回滚**：合并后允许通过 revert 恢复，但不得用 force push 改写历史。

### 9.4 推送与 PR（M3）

- 推送目标只允许 Run 分支，禁止直接推送受保护分支。
- 推送前必须有人工审批，审批记录包含目标 remote、分支、commit 与 diff 摘要。
- PR 创建使用用户授权的凭据；ATeam 记录 PR URL、编号与状态，但不代替代码托管平台做权限管理。
- PR 创建失败时保留本地分支与推送状态，允许重试，不重复创建 PR。
- 不自动合并 PR；合并动作仍由人完成或经过明确审批。

### 9.5 Git 安全规则

1. 禁止 `push --force`、禁止改写已推送历史、禁止删除远程分支，除非用户在独立的高风险操作中显式确认并记录审计。
2. 禁止跳过 Git hooks；不得使用 `--no-verify` 绕过仓库策略。
3. Git 命令执行有超时，输出中的凭据与 URL 必须脱敏。
4. 所有 Git 操作记录命令、退出码、耗时与工作目录；失败时保留 stderr 摘要。
5. 仓库路径来自 Workspace 配置，不接受来自 Agent prompt 的相对路径跳转；`..` 与符号链接需解析后校验边界。

## 10. Artifact 与 Evidence

### 10.1 类型

Artifact 类型以 `modules/api-and-data.md` 的 M1 清单为准，M2 扩展类型必须登记在 `/api/v1/meta` 中。本章不定义并行类型。

| 类型 | 内容 | 产生方 | 里程碑 |
| --- | --- | --- | --- |
| `diff` | 统一 diff、改动文件列表、增删行数与二进制标记 | 系统采集 | M1 |
| `test_report` | 测试命令、退出码、通过/失败摘要与原始输出 | Adapter 事件或系统复跑 | M1 |
| `screenshot` | UI 变更截图、对比图 | Agent 声明目录或人工上传 | M1 类型可用；M2 起作为 UI 类 DoD 必需证据 |
| `log_bundle` | 完整运行日志包，内部按 `subtype` 切分为 `run_log`、`build_log`、`lint_output`、`command_log` | 系统或 Adapter | M1 |
| `note` | 运行总结、人工备注与说明 | Adapter、系统或评审者 | M1 |
| `file` | 其他单文件产物（配置、报告、导出物） | Agent 或人工 | M1 |
| `ui_review` | 角色交付物：UI 评审材料（M2 扩展，登记于 meta） | Agent | M2 |
| `deploy_plan` | 角色交付物：部署计划与回滚方案（M2 扩展，登记于 meta） | Agent | M2 |

说明：

- 原「changed_files」不单独建类型，它是 `diff` Artifact 内的结构化统计字段。
- 原「run_log / build_log / lint_output / command_log」是 `log_bundle` 的内部 `subtype`，不是并列的顶层类型。
- token、费用与耗时属于 Run 的 `metrics` 与 `usage` 事件，不作为 Artifact 类型。
- 审批记录由 Approval 实体保存，不作为 Artifact 类型。

### 10.2 采集时机与来源

1. **运行时事件**：Adapter 通过 `artifact` 事件声明证据，payload 包含类型、subtype（如适用）、路径、标题、内容类型与摘要。
2. **结束采集**：调度器在 Adapter 返回后执行系统采集，至少包括 diff、Git 状态与 summary；采集失败本身要记录 error 事件，并使 DoD 判定降级。
3. **验证测试复跑**：每个 Workspace 可在 `settings.verificationCommands` 中声明项目级验证命令（字符串数组，例如 `["pnpm test"]`）。Run 结束后由系统在 Run Workspace 中复跑一次，与 Agent 自述的测试结果分开记录：
   - 执行边界：只在 Run Workspace 内执行，使用参数数组，不经过 shell 拼接；命令必须来自 `settings.verificationCommands`，由用户或管理员配置，Agent 不得在 Run 中自行添加。
   - 超时：默认 10 分钟，可按 Workspace 配置；超时记为验证失败并记录 `verification_timeout=true`。
   - 输出：stdout/stderr 合并采集，单个 Artifact 仍受 §10.3 的 50 MiB 上限约束；超限时截断输出并标记 `truncated=true`，保留退出码与摘要，不把截断报告当作完整通过证据。
   - 结果：记录命令、退出码、耗时与 `test_report` Artifact；退出码非 0 时 DoD 不满足，除非评审者记录人工例外。
   - 未配置验证命令时，系统不臆造测试；代码变更类 Task 必须有 Agent 提供的 `test_report` 或人工例外。
4. **人工补充**：M2 允许评审者上传截图或备注，标注来源为人工，不计入 Agent 自述证据。
5. **禁止伪造**：证据必须可追溯到 Run、文件与时间；UI 不把 Agent 的文本声明直接等同于证据。系统根据 Artifact 元数据与 sha256 校验完整性。

### 10.3 存储

- 元数据存数据库：Artifact ID、RunID、类型、subtype、标题、内容类型、大小、sha256、存储路径、创建时间、来源、是否截断、归档状态。
- 内容落盘到 `~/.ateam/artifacts/{runId}/{artifactId}-{name}`；不使用数据库 BLOB 存放大文件。
- 单个 Artifact 默认上限 50 MiB（对齐 `02-domain-model.md` §3.9），超限拒绝入库并产生告警事件；可通过 `/api/v1/meta` 公布可配置上限。UI 预览可按 `maxBytes` 截断，但完整内容保留在 Artifact 文件中。
- 相同内容按 sha256 去重可以跨 Run 复用，但 Run 与 Artifact 的引用关系必须独立保留。
- Run Workspace 默认保留 30 天（§3.8）；Artifact 与事件的保留期独立配置，Workspace 删除时默认保留 90 天后再按策略清理。被审批记录或审计引用的证据不得直接物理删除，先标记归档。

### 10.4 证据化完成定义（DoD）

完成定义按 Task 类型可配置。**M1 提供最小集合，并作为 Task 进入 done 的必要条件**；M2 扩展 UI 与部署类。

- **代码变更类（M1）**：必须包含 `diff` Artifact（内含改动文件与统计）；必须包含 `test_report`，或由人工记录「不适用测试」的例外理由。mock Run 产生的任何证据都不计入。系统复跑验证测试失败时，DoD 不满足，除非评审者记录例外。
- **文档类（M1）**：`diff` 即可，不要求测试。
- **UI 变更类（M2）**：在代码证据之外，必须包含至少一张 `screenshot`；无法截图时需说明原因。
- **运维/部署计划类（M2）**：必须包含变更清单、影响范围、回滚计划与人工审批记录（`deploy_plan`）；生产部署不由 Agent 执行。

评审界面按清单显示「已有 / 缺失 / 例外」，缺失时完成按钮需要二次确认并记录原因。证据缺失不是 UI 装饰，而是 Task 能否进入 done 的判定条件之一；M1 起由服务端校验，不能只靠前端提示。

### 10.5 安全与脱敏

- 采集前扫描常见密钥模式：API Key、私钥块、Bearer Token、数据库 URL 中的密码；命中时替换为占位内容并保留命中位置提示。
- 环境变量值不进入证据；只记录变量名是否存在。
- 截图可能包含敏感数据，默认只在本地保存；团队同步需明确开启。
- Artifact 下载与预览需要与 Run 相同的访问权限；M3 增加审计记录。

## 11. 运行生命周期：状态、排队、失败、重试与取消

### 11.1 状态与时间字段

所有时间使用 UTC 存储，UI 按本地时区展示。Run 至少记录：创建时间（`createdAt`）、进入队列时间（`queuedAt`）、开始执行时间（`startedAt`）、结束时间（`endedAt`）与最后事件时间。M0 只有创建、开始、结束三个字段；M1 增加 `queuedAt`、`cancelRequestedAt` 与最后事件时间，preparing 起始时间以首个 `run.preparing` 事件时间推导，不新增 `preparedAt` 字段，用于区分排队耗时与执行耗时。

### 11.2 排队原因

M0 没有排队原因，用户只能看到 queued。M1 起记录主要原因：

| 原因码 | 触发条件 |
| --- | --- |
| `concurrency_limit` | 全局 worker 已满（M1） |
| `agent_concurrency` | 该 Agent 达到最大并发（M2） |
| `machine_offline` | 指定机器不在线（M3） |
| `machine_slots_full` | 机器槽位已满（M3） |
| `repo_locked` | 同一仓库的 Git 操作正在串行执行 |
| `queue_full` | 入队失败，等待重新调度 |
| `dependency_pending`（M2） | 任务 DAG 前置任务未完成 |
| `approval_pending`（M2） | 等待启动或动作审批 |
| `paused`（M2） | 用户或管理员暂停队列 |

一个 Run 可以有多个等待因素，UI 展示主要因素与全部因素的解释文案。

### 11.3 失败分类

`errorCode` 以 `02-domain-model.md` §3.6 的规范枚举为准，写入 `runs.error_code`；`failureDetail` 是 `errorCode` 的子分类，写入 `runs.failure_detail`，用于 UI 修复建议与统计，不构成第二套错误码。禁止继续使用 `failure_category` 这一同义字段。

| 规范 `errorCode` | `failureDetail` 子分类 | 典型原因 | 可自动重试 | 默认处理 |
| --- | --- | --- | --- | --- |
| `runtime_error` | `runtime_missing` | CLI 未安装、不在 PATH | 否 | 提示安装与配置，Run failed |
| `runtime_error` | `runtime_auth` | 未登录、Key 失效、订阅过期 | 否 | 提示重新登录，Run failed |
| `runtime_error` | `runtime_version_unsupported` | CLI 版本不兼容、必需参数缺失 | 否 | 提示升级或切换受支持版本 |
| `runtime_error` | `runtime_unavailable` | 网络错误、服务限流、临时 5xx | 是 | 有上限的指数退避重试（M2） |
| `runtime_error` | `invalid_agent_config` | 模型不存在、超时非法、工作区模式不支持 | 否 | 拒绝启动并提示修正 Agent |
| `runtime_error` | `adapter_crash` | Adapter panic、进程异常退出 | 是（一次，M2） | 记录退出码与最后日志 |
| `runtime_error` | `nonzero_exit` | Runtime 正常启动但以非零码退出 | 视原因 | 记录退出码、stderr 摘要 |
| `runtime_error` | `evidence_missing` | 完成但证据不满足 DoD | 否 | 等待补齐证据或人工例外 |
| `internal_error` | `scheduler_internal` | 调度器或存储异常 | 视原因 | 记录告警，人工介入 |
| `timeout` | `timeout` | 超过 Agent `timeoutMinutes` | 否（人工重试） | 终止进程，保留证据 |
| `workspace_error` | `workspace_provision_failed` | 目录创建失败、磁盘不足、权限不足 | 视原因 | 清理残留后允许人工重试 |
| `workspace_error` | `git_error` | fetch 失败、worktree 冲突、索引锁 | 部分 | 保留现场，人工处理后重试 |
| `workspace_error` | `submodule_unsupported` | 仓库含子模块且任务依赖其内容（M1） | 否 | 拒绝或提示缺少依赖 |
| `workspace_error` | `sparse_checkout_unsupported` | 仓库启用稀疏检出（M1） | 否 | 拒绝启动并说明原因 |
| `workspace_error` | `sandbox_unavailable` | 沙箱不可用且未获降级批准（M3） | 否 | Run failed，等待人工批准降级 |
| `permission_denied` | `path_denied` | 路径越界 | 否 | 记录被拒动作，按策略失败或继续 |
| `permission_denied` | `command_denied` | 命令不在白名单 | 否 | 记录被拒动作，按策略失败或继续 |
| `invalid_task_state` | `task_not_executable` | Task 状态不可执行 | 否 | 拒绝创建/启动 Run |
| `interrupted` | `runner_lost` | 远程 Runner 心跳超时且租约失效 | 否（人工重试） | Run failed，保留租约与最后事件 |
| `interrupted` | `lease_expired` | 租约过期 | 否（人工确认） | Run failed，不自动重派 |
| `interrupted` | `app_restart` | 应用重启导致执行中断 | 否（人工重试） | Run failed，提示重试 |
| `internal_error` | `scheduler_internal` / `queue_rejected` / `artifact_write_failed` | 调度器、存储或证据写入异常 | 视原因 | 记录告警，人工介入 |
| `cancelled_by_user` | `user_cancel` | 用户取消 | 否 | 终态，用户可手动重试 |

失败码必须写入 Run 的结构化字段，而不仅是 error 文本；UI 按 `errorCode` 展示修复建议与是否可重试，`failureDetail` 用于更具体的提示。

### 11.4 重试

1. 手动重试创建新 Run，`attempt` 在原 Run 基础上加一，Task 与 Agent 默认不变，Run Workspace 新建。
2. 自动重试（M2）只针对 `runtime_error/runtime_unavailable`、部分 `workspace_error/git_error` 与 `runtime_error/adapter_crash`，默认最多 2 次，使用指数退避；每次尝试以独立 Run 记录，`attempt` 递增。
3. `permission_denied`、`runtime_error/runtime_auth`、`invalid_task_state` 永不自动重试，避免放大错误或绕过安全边界。
4. 达到自动重试上限后 Run failed，并保留所有尝试的 Task 级引用链（同一 Task 的 Run 列表按 `attempt` 排序）。
5. 重试不应复用原 worktree，避免把半成品修改带入新一次执行判断。

### 11.5 取消

M0 的实际语义必须按状态分清，不能笼统写成「回写 failed」：

- **queued（M0）**：`POST /api/runs/{id}/cancel` 直接把数据库状态写为 `cancelled`，但调度器从未登记取消句柄，Run 仍留在内存 channel。worker 取出后重新加载 Run、把状态覆盖为 `preparing` 并照常执行；mock 正常结束时写回 `completed`，claude 失败时写回 `failed`。取消不生效，且可能产生完整执行。
- **preparing（M0）**：API 写 `cancelled`，但准备流程没有取消令牌；`execute` 不检查当前状态，随后写 `running` 并继续。取消可能被覆盖。
- **running（M0）**：API 先写 `cancelled`；调度器登记了 cancel 函数后，context 取消会终止进程，但最终状态取决于 adapter 返回的错误：mock 返回 `context.Canceled`，`execute` 写回 `cancelled`；claude 因进程被 kill 返回 `claude exited: signal: killed`，`execute` 写回 `failed`，并覆盖先前状态。
- **终态（M0）**：取消已结束的 Run 返回原对象，行为幂等，但不校验状态与事件。

M1 的目标语义：

- **queued**：取消必须从队列移除并立即进入 `cancelled`；worker 领取时再次校验状态，发现已取消则跳过，不产生 Run Workspace 或 Adapter 进程。若从队列移除失败，进入 `cancelled` 后也必须被状态守卫拒绝执行。
- **preparing**：取消中断 Git 与目录准备，清理未完成的 worktree；已创建的分支与目录按安全规则处理，Run 进入 `cancelled`。
- **running**：先请求优雅终止，默认宽限 10 秒（可按 Runtime 配置），超时后强制终止进程树；无论 Adapter 返回何种错误，调度器都统一写 `cancelled`，并记录取消发起人与时间。
- **终态**：取消已结束的 Run 是幂等操作，返回当前状态，不产生新事件。
- **竞态**：M1 必须保证取消后调度器不会把状态回写为 `preparing`/`running`/`completed`/`failed`；所有状态写入必须带前置状态校验与版本号。取消请求与自然完成同时发生时，以先通过状态守卫写入的合法终态为准，另一方记录 `cancel_lost_race` 事件并保留审计。

### 11.6 超时

- 超时时长来自 Agent 的 `TimeoutMinutes`；数据库默认 60 分钟，创建 Agent 时小于等于 0 会被修正为 60。
- 超时从 Run 进入 running 开始计算，不包含排队时间；排队时间单独观测。
- M1 起超时映射为 `errorCode=timeout` 且状态为 `failed`，而不是笼统的 failed 文本，也不是 `cancelled`；事件流记录超时阈值与实际耗时。
- 超时后仍需执行证据采集的尽力而为版本：至少保留日志与工作区状态，避免现场丢失。
- 长任务建议用户在 Agent 配置中显式提高超时，而不是无限等待。

### 11.7 服务重启与恢复

M0 的限制：队列在内存中，重启后 queued Run 无人执行，running Run 可能永远停在 running。M1 的最小恢复策略：

1. 启动时扫描 queued 且未取消的 Run，按创建时间重新入队。
2. 扫描 preparing/running Run：如果本地没有对应的存活执行进程，写为 `failed` 且 `errorCode=interrupted`，并记录 `recovered_after_restart` 事件，不静默视为成功，也不保留 running 造成悬挂。
3. 清理上次进程遗留的 worktree 锁。
4. 事件序号从数据库最大值继续，避免主键冲突与乱序。

### 11.8 运行中的可观测性

Run 详情需要展示：当前阶段、已运行时长、最后事件时间、排队时长、Runtime 与版本、机器、工作区路径、分支、当前是否可取消。M2 起对超过阈值无事件的 running Run 标记 `stalled` 并在列表提示，但不自动终止，避免误杀长编译。

## 12. 功能需求

以下需求均可测试。优先级定义：P0 为当前里程碑必须完成，P1 为应当完成，P2 为可选增强。**每条 FR 只对应一个里程碑**；跨阶段能力拆成多条 FR。「状态」列描述当前仓库（M0）的实现情况，与「里程碑」列相互独立：里程碑是承诺交付点，状态是现状。

### 12.1 Runtime 与 Adapter

| 编号 | 需求 | 优先级 | 里程碑 | 状态（M0） |
| --- | --- | --- | --- | --- |
| RUN-001 | 系统提供 Runtime 注册表，每个 Adapter 以稳定名称注册；名称全局唯一且大小写不敏感匹配。 | P0 | M1 | 部分实现（注册表存在；同名覆盖、大小写不敏感未处理） |
| RUN-002 | 创建或更新 Agent 时，系统校验 Runtime 名称存在于注册表；未知名称返回 400 并列出可用 Runtime。 | P0 | M1 | 未实现 |
| RUN-003 | 启动 Run 前再次校验 Runtime 可用性；不可用时 Run 进入 failed，`errorCode=runtime_error`，不得回退到 mock。 | P0 | M1 | 未实现（M0 静默回退 mock） |
| RUN-004 | Adapter 的 `Run` 必须接受 context；context 取消后 10 秒内终止子进程并返回可识别为取消的错误。 | P0 | M1 | 部分实现（有 context，无宽限期与错误契约） |
| RUN-005 | 调度器按 Agent 的 `timeoutMinutes` 设置超时；超时产生 `errorCode=timeout` 并记录阈值与实际耗时。 | P0 | M1 | 部分实现（超时可用，未写 errorCode） |
| RUN-006 | 每个事件包含 type、message、payload、createdAt、seq 与来源；M1 增加 `level`；同一 Run 内 `(run_id, seq)` 唯一且连续。 | P0 | M1 | 部分实现（已有 type/message/payload/createdAt/seq；缺来源、level 与唯一约束） |
| RUN-007 | 事件落库后通过 WebSocket 广播 `run.event`；`GET /api/runs/{id}/events` 按 seq 升序提供全量回放。 | P0 | M0 | 已实现（服务端回放） |
| RUN-116 | 客户端断线重连后使用 `afterSeq` 游标主动拉取缺失事件并去重补齐，不得只重建 WebSocket。 | P0 | M1 | 未实现 |
| RUN-008 | 单事件 payload 超过 64 KiB 时截断并标记 `truncated=true`，完整内容写入 `log_bundle` Artifact。 | P1 | M1 | 未实现 |
| RUN-009 | stderr 内容保留来源标记；错误诊断优先展示 stderr 与退出码。 | P1 | M1 | 部分实现（M0 有 `[stderr]` 前缀，无结构化来源） |
| RUN-010 | mock adapter 不创建文件、不调用外部命令、不访问网络；Run 列表与 Run 详情显示 mock 徽标。 | P0 | M0 | 部分实现（Agents 页面与 Agent 选择器已显示 runtime；Run 列表/详情缺 mock 徽标，且 M0 无 Run 详情页） |
| RUN-011 | mock Run 不得计入任何 Task 的完成证据，包括代码变更类。 | P0 | M1 | 未实现 |
| RUN-012 | Claude Code adapter 启动前探测 CLI 是否存在并记录版本；缺失时给出安装提示。 | P0 | M1 | 部分实现（仅报错，无版本探测） |
| RUN-013 | Claude Code adapter 支持 Agent.Model 映射、权限模式、结构化输出与用量事件。 | P0 | M1 | 未实现 |
| RUN-014 | Claude Code adapter 的取消先优雅终止、宽限 10 秒后强制终止进程树。 | P0 | M1 | 部分实现（直接 kill） |
| RUN-015 | Codex adapter 提供与 Claude adapter 等价的事件、取消与超时契约，并声明能力差异。 | P0 | M2 | 未实现 |
| RUN-016 | `GET /api/v1/runtimes` 返回每个 Runtime 的可用性、版本、能力、模型目录与所需凭据状态；模型目录包含 `id`、`label`、`source`、`default`、`status`、`deprecated`；探测失败返回 `modelsError` 与本地配置列表 | P1 | M1 基础探测；M2.1 模型目录 | 未实现 |
| RUN-017 | Adapter 不得把 API Key、Token 或完整父进程环境写入事件、日志或数据库。 | P0 | M1 | 未实现 |
| RUN-018 | Adapter 异常 panic 时由调度器恢复，Run 进入 failed，`errorCode=runtime_error`、`failureDetail=adapter_crash`，worker 不退出。 | P0 | M1 | 未实现 |
| RUN-095 | Run 创建时固定 `agentVersionId`（见 `02-domain-model.md` §3.5）；执行期只读快照，排队期间修改 Agent 不影响该 Run。 | P0 | M1 | 未实现（调度时现取 Agent） |

### 12.2 机器与 Runner

| 编号 | 需求 | 优先级 | 里程碑 | 状态（M0） |
| --- | --- | --- | --- | --- |
| RUN-020 | 本地服务内嵌 Runner，无需注册即可执行 Run；本机作为隐式本地执行者，不产生 Machine 实体或机器视图。 | P0 | M0 | 已实现（仅本地进程内执行） |
| RUN-021 | 系统提供 Machine 实体，字段与状态以 `02-domain-model.md` §3.14 为准：名称、系统、架构、主机名哈希、标签、能力、状态、心跳与令牌哈希。 | P0 | M3 | 未实现 |
| RUN-022 | 管理员可使用一次性注册令牌注册 Runner；令牌可吊销，使用后失效，服务端只存哈希。 | P0 | M3 | 未实现 |
| RUN-023 | Runner 默认每 15 秒发送心跳；连续 45 秒缺失后机器标记为 offline；租约 90 秒未续期视为过期。 | P0 | M3 | 未实现 |
| RUN-024 | Runner 注册与心跳上报 Git、Runtime、Docker、磁盘等能力信息，用于调度与提示。 | P1 | M3 | 未实现 |
| RUN-025 | 全局并发上限生效；超出的 Run 保持 queued 并记录 `concurrency_limit` 排队原因。 | P0 | M1 | 部分实现（全局并发存在；无排队原因） |
| RUN-032 | 机器槽位参与有效并发；有效并发取全局、机器、Agent 三者最小值。 | P0 | M3 | 未实现 |
| RUN-033 | 同一 Agent 的活跃 Run 数不超过 `maxConcurrency`；超出的 Run 进入队列并记录 `agent_concurrency`。 | P0 | M2 | 未实现（字段仅存储） |
| RUN-026 | 机器进入 draining 后不再领取新 Run，运行中的 Run 允许完成。 | P1 | M3 | 未实现 |
| RUN-027 | Runner 领取 Run 必须获得租约并在运行中续约；同一 Run 同时只能有一个有效租约。 | P0 | M3 | 未实现 |
| RUN-028 | 机器离线超过宽限期时，运行中的 Run 置为 failed，`errorCode=interrupted（failureDetail=runner_lost）`，不自动重跑。 | P0 | M3 | 未实现 |
| RUN-029 | 机器恢复后，由人工决定重试（新 Run）或放弃；恢复动作写入事件与审计，Runner 不得自行恢复 running。 | P0 | M3 | 未实现 |
| RUN-030 | Runner 上报协议版本；控制面拒绝不兼容版本领取新 Run。 | P1 | M3 | 未实现 |
| RUN-031 | 机器详情展示当前运行中的 Run、槽位占用、能力探测结果与最近错误。 | P1 | M3 | 未实现 |

### 12.3 运行工作区与 Git

| 编号 | 需求 | 优先级 | 里程碑 | 状态（M0） |
| --- | --- | --- | --- | --- |
| RUN-040 | M1 通过 Run 前后的文件快照与 diff 检测 Adapter 在 Run Workspace 之外的写入，输出越界文件清单、`workspace_escape_detected` 事件并在 Run 详情告警；M1 只承诺检测，不承诺阻止。 | P0 | M1 | 未实现 |
| RUN-117 | M2 通过路径权限与沙箱强制执行写入边界；越界写入被拒绝并记录 `permission_denied`。 | P0 | M2 | 未实现 |
| RUN-041 | worktree 模式下，系统从 Workspace 的 `defaultBranch` 创建唯一分支与 worktree，并记录 `baseCommit`。 | P0 | M1 | 未实现 |
| RUN-042 | 创建 worktree 前执行 `git fetch`；fetch 失败按 `workspace_error/git_error` 处理，不静默使用过期状态。 | P0 | M1 | 未实现 |
| RUN-043 | 分支名符合 `ateam/{taskShort}/{slug}-{runShort}` 规则（slug 可省略），冲突时追加短后缀且不超过 100 字符。 | P0 | M1 | 未实现 |
| RUN-044 | 同一 Task 的多次 Run 使用不同 worktree 与分支，互不覆盖；M1 同一 Task 同时最多一个活跃 Run，重复启动返回 409；M2 Crew 例外。 | P0 | M1 | 未实现 |
| RUN-045 | Run 详情展示 Run Workspace 绝对路径、分支名、`baseCommit` 与工作区状态。 | P0 | M1 | 未实现（M0 无 Run 详情页；API 仅返回 worktree 路径） |
| RUN-046 | Run 结束后采集 diff、改动文件、未跟踪文件与 Git 状态，并生成 `diff` Artifact。 | P0 | M1 | 未实现 |
| RUN-047 | 系统支持在 Run 分支上提交，提交信息包含 Task 标题、Task ID 与 Run ID 短码。 | P0 | M1 | 未实现 |
| RUN-048 | 合并必须人工审批；审批绑定 `headCommit` 与目标分支 commit，任一变化后审批失效；合并前重新校验。 | P0 | M1 | 未实现 |
| RUN-049 | 禁止 force push、禁止直推受保护分支、禁止跳过 Git hooks；违规操作必须被拒绝并审计。 | P0 | M1 | 未实现 |
| RUN-050 | direct 模式启动前必须确认风险；同一仓库同时只允许一个 direct Run。 | P1 | M2 | 未实现 |
| RUN-051 | 未合并且有改动的 worktree 不得自动删除；删除需要显式确认。 | P0 | M1 | 未实现 |
| RUN-052 | 已合并或已放弃的 worktree 默认保留 30 天，之后可自动清理；保留期可配置。 | P1 | M2 | 未实现 |
| RUN-053 | 启动时检测 orphan worktree 并展示清理入口，不自动删除。 | P1 | M2 | 未实现 |
| RUN-054 | Git 操作设置超时与仓库级锁；同一仓库的 fetch/worktree 操作串行执行。 | P0 | M1 | 未实现 |
| RUN-055 | 推送与 PR 创建需要人工审批，并记录目标 remote、分支、commit 与审批人。 | P0 | M3 | 未实现 |
| RUN-056 | 冲突不自动解决；合并冲突返回结构化错误与冲突文件列表，Run 保持 completed，由人工解决或新建 Run。 | P0 | M1 | 未实现 |
| RUN-057 | Git 输出中的凭据与 URL 必须脱敏后才可进入事件与日志。 | P0 | M1 | 未实现 |

### 12.4 Artifact 与 Evidence

| 编号 | 需求 | 优先级 | 里程碑 | 状态（M0） |
| --- | --- | --- | --- | --- |
| RUN-060 | 系统维护 Artifact 元数据表，类型取自 §10.1 的规范集合，并记录 Run、subtype、标题、大小、sha256、路径、来源、截断与归档状态。 | P0 | M1 | 未实现 |
| RUN-061 | Artifact 内容落盘到数据目录，不写入数据库 BLOB；按 Run 隔离目录。 | P0 | M1 | 未实现 |
| RUN-062 | Run 结束时自动生成 summary（`note`）与完整日志（`log_bundle`）Artifact。 | P0 | M1 | 部分实现（summary 仅为 Run 文本字段） |
| RUN-063 | 测试证据以 `test_report` 记录命令、退出码、通过/失败计数与原始输出摘要。 | P0 | M1 | 未实现 |
| RUN-064 | UI 变更类 Task 支持 `screenshot` 证据；截图来源、目录与采集开关可配置。 | P1 | M2 | 未实现 |
| RUN-065 | 单个 Artifact 默认上限 50 MiB；超限拒绝入库、记录告警并提示，不静默截断成不可信证据。 | P1 | M1 | 未实现 |
| RUN-066 | 完成定义按 Task 类型检查证据；M1 覆盖代码变更类与文档类，缺失时阻止直接完成或要求人工例外；UI 与部署类的证据扩展分别见 RUN-064 与角色交付物契约。 | P0 | M1 | 未实现 |
| RUN-067 | 评审界面按证据清单展示已有、缺失与例外，并允许下载证据。 | P0 | M1 | 未实现 |
| RUN-068 | 证据采集与展示前执行密钥模式扫描与脱敏。 | P0 | M1 | 未实现 |
| RUN-069 | Artifact 访问遵循 Run 的权限；团队模式记录访问审计。 | P0 | M3 | 未实现 |
| RUN-070 | Artifact 保留期可配置；被审批记录引用的证据先归档后删除。 | P1 | M2 | 未实现 |
| RUN-118 | 系统支持 Workspace 级 `settings.verificationCommands`；Run 结束后在 Run Workspace 内复跑一次，记录命令、退出码、耗时与 `test_report`，按 §10.2 参与 DoD 判定。 | P0 | M1 | 未实现 |

### 12.5 Run 生命周期

| 编号 | 需求 | 优先级 | 里程碑 | 状态（M0） |
| --- | --- | --- | --- | --- |
| RUN-080 | 创建 Run 时状态为 queued；所有状态迁移符合 §4.2.2，终态不可回退；非法迁移被状态守卫拒绝并记录 `status_rejected` 事件。 | P0 | M1 | 部分实现（仅创建为 queued；无状态守卫） |
| RUN-081 | Run 记录 queuedAt、startedAt、endedAt 与最后事件时间；preparing 起始时间以首个 `run.preparing` 事件时间推导，不新增字段。 | P1 | M1 | 部分实现（仅创建/开始/结束） |
| RUN-082 | Run 失败时写入规范 `errorCode` 与可选 `failureDetail`，并提供人类可读原因。 | P0 | M1 | 未实现 |
| RUN-083 | 手动重试创建新 Run 且 `attempt` 加一；旧 Run 保持不可变。 | P0 | M1 | 未实现 |
| RUN-084 | 自动重试仅限可重试分类，默认最多 2 次并使用指数退避；每次尝试有独立 Run 记录。 | P1 | M2 | 未实现 |
| RUN-085 | 取消 queued Run 必须从队列移除且永不执行；API 取消幂等。 | P0 | M1 | 未实现（M0 缺陷：仍会被 worker 执行并可能写回 completed） |
| RUN-086 | 取消 running Run 使用优雅终止加宽限期强制终止，状态不被后续回写覆盖；claude 与 mock 结果一致为 cancelled。 | P0 | M1 | 部分实现（存在竞态；claude 下写回 failed） |
| RUN-087 | 取消终态 Run 返回当前状态，不产生新事件。 | P1 | M0 | 已实现（返回原对象） |
| RUN-088 | Run 详情与列表展示排队原因与可操作提示。 | P1 | M1 | 未实现 |
| RUN-089 | 服务启动时恢复 queued Run；失去执行者的 preparing/running Run 写为 failed 且 `errorCode=interrupted`。 | P0 | M1 | 未实现 |
| RUN-090 | 同一 Run 不允许被两个执行者同时执行；重复领取必须被拒绝。 | P0 | M3 | 未实现 |
| RUN-091 | 时间字段统一以 UTC 存储，API 使用 ISO 8601，UI 按本地时区展示。 | P0 | M0 | 已实现 |
| RUN-092 | running Run 超过阈值无事件时标记 stalled 并提示，不自动终止。 | P2 | M2 | 未实现 |
| RUN-093 | 运行中展示 Runtime 版本、模型、机器、Run Workspace 与分支，缺失时显示未知而不是空白。 | P1 | M1 | 未实现（M0 无 Run 详情页） |
| RUN-094 | 对 mock、direct、worktree 等模式在 Run 详情显示模式徽标与风险说明。 | P1 | M1 | 未实现 |

### 12.6 安全与权限

| 编号 | 需求 | 优先级 | 里程碑 | 状态（M0） |
| --- | --- | --- | --- | --- |
| RUN-100 | Agent 配置与首次运行提示明确说明「Run 以你的 OS 用户身份执行」及其文件系统与网络权限范围。 | P0 | M1 | 部分实现（执行身份确实如此；UI 与文档说明缺失） |
| RUN-101 | Agent 的 `allowedPaths` 作为写入边界执行；越界写入被拒绝并记录 `permission_denied`。 | P0 | M2 | 未实现（仅存储） |
| RUN-102 | Agent 的 `allowedCommands` 作为命令白名单执行；未匹配命令默认拒绝。 | P0 | M2 | 未实现（仅存储） |
| RUN-103 | 部署、删除分支/worktree/Artifact、修改仓库配置等高风险动作必须经过人工审批并记录；合并见 RUN-048，推送见 RUN-055；M1 的 worktree 删除仅按 RUN-051 要求显式确认。 | P0 | M2 | 未实现 |
| RUN-104 | 环境变量按白名单传递；凭据不落库、不进入日志与证据。 | P0 | M1 | 未实现 |
| RUN-105 | 提供 Docker 沙箱运行模式，限制文件系统、网络与进程能力。 | P1 | M3 | 未实现 |
| RUN-106 | API 与 WebSocket 默认仅监听 `127.0.0.1`。 | P0 | M0 | 已实现（`127.0.0.1:8787` 或桌面壳随机本地端口） |
| RUN-107 | 非法跨域来源不得携带凭据访问 API；WebSocket 升级校验来源；非回环访问必须显式开启。 | P0 | M1 | 未实现（当前接受任意来源） |
| RUN-108 | 审批、机器注册、令牌吊销与高风险 Git 操作写入审计日志。 | P0 | M3 | 未实现 |
| RUN-109 | 路径解析需处理符号链接与 `..`，校验最终真实路径仍位于允许边界内。 | P0 | M2 | 未实现 |
| RUN-110 | 命令白名单拒绝 shell 元字符拼接绕过；参数按数组传递而非拼接字符串。 | P0 | M2 | 未实现 |
| RUN-111 | Agent 支持 `readOnlyPaths`：只读边界默认是 Run Workspace，仓库外只读资料必须显式声明并经真实路径校验。 | P1 | M2 | 未实现 |
| RUN-112 | 沙箱不可用时默认失败关闭；只有用户显式批准降级才可在本机执行，并把批准写入审批记录与审计；Agent/Workspace 配置默认不允许降级。 | P0 | M3 | 未实现 |
| RUN-115 | 开放非本地访问时必须启用认证、来源校验与 TLS；未认证请求不得读取 Run、Agent、Artifact。 | P0 | M3 | 未实现 |

### 12.7 章节验收标准

本章 FR 的验收分为正向与负向两类，按里程碑汇总。条目编号引用 `04-acceptance-and-test-plan.md` 的 AC-RUN 系列；负向用例是本模块补充，必须与正向用例一起进入测试计划。

| 里程碑 | 正向验收 | 负向 / 边界验收 |
| --- | --- | --- |
| M0 | AC-RUN-01/02/03/04/06：合法 Task 能创建 Run 并按状态序列结束；事件持久化可回放；取消终态幂等；Runtime 失败不会被标为 completed | 不可执行 Task 返回 409；非法状态枚举返回 400。M0 的「未知 Runtime 回退 mock」「排队取消仍执行」是已记录缺陷，不得作为通过标准 |
| M1 | 本章相关的 AC-RUN-01 至 AC-RUN-12 中标注为 M1 的条目全部通过：worktree 与分支、diff 与测试证据、取消、超时、重启恢复、DoD、合并审批 | 同一 Task 第二个活跃 Run 返回 409；queued 取消后不创建 Run Workspace 与进程；重启后 preparing/running 写为 failed 且 `errorCode=interrupted`；mock 证据不能通过 DoD；Runtime 缺失不回退 mock；Artifact 超过 50 MiB 被拒绝并告警；无测试证据时阻止直接完成或要求例外；验证命令失败或超时时 DoD 不满足；排队期间修改 Agent 不影响已创建 Run；主工作区有未提交修改时 diff 基准仍为 `baseCommit`；非法 Origin 请求被拒 |
| M2 | Agent 并发上限生效；路径与命令越界被拒；UI 与部署类 DoD 生效；审批记录可追溯；只读路径按声明生效 | 越界写入/命令返回 permission_denied；超出 Agent 并发时保持 queued 且原因正确；`readOnlyPaths` 之外的读取被拒；审批被拒后不产生 Git 变更；部署类任务缺少 `deploy_plan` 时不能完成 |
| M3 | Runner 注册、心跳、租约、离线处理可用；非本地访问需要认证；审计覆盖审批与机器操作 | 心跳 90 秒缺失后 Run 为 failed + `errorCode=interrupted（failureDetail=runner_lost）` 且不自动重跑；旧租约持有者事件被拒；未认证请求返回 401/403；禁用机器不能领取新 Run |

## 13. 交互与规则

### 13.1 页面与入口

本章只定义信息需求与状态语义；颜色、组件、布局等视觉细节以 `ui-ux.md` 为准。每项标注当前状态与里程碑。

1. **Task 详情页的 Runs 面板（M0）**：选择 Agent 后启动 Run；列表显示状态、触发方式、时间、摘要与错误；选中 Run 显示事件日志与取消按钮。M0 的实现事实是：TaskView 使用本地 ref 并以约 1.5 秒轮询刷新；WebSocket 事件只更新 Pinia stores，不会直接驱动该面板刷新。M1 改为事件驱动并保留轮询兜底。
2. **全局 Runs 页（M0）**：按时间倒序展示所有 Run；列包含状态、Task、触发方式、创建时间、摘要/错误；点击进入 Task 详情。
3. **Run 详情（M1）**：独立路由或抽屉，包含概览、日志、Diff、Evidence、Usage 五个标签；概览展示 Runtime 与版本、模型、机器、分支、Run Workspace、排队与执行耗时、`errorCode`。M0 没有 Run 详情页。
4. **Agent 编辑器（M0 部分，M1 补齐）**：Runtime 下拉在 M0 只展示已有 runtime 字符串；M1 起只提供注册表中的可用项并显示探测状态。Run Workspace 模式说明与风险（M1）、超时与并发推荐值（M1）、路径与命令列表（M0 可编辑，M2 才有执行语义）。
5. **Machines 页面（M3）**：机器列表、状态、槽位、能力、运行中的 Run、注册与吊销入口。M0 不展示任何机器视图。
6. **设置页（M1 起逐步提供）**：数据目录、worktree 根目录、保留期、并发、WebSocket 重连策略、脱敏开关。M0 的 SettingsView 只有占位说明，不提供这些设置项；M1 提供数据目录与保留期，M2 提供脱敏开关，M3 提供团队级策略。

### 13.2 状态与提示

- 状态颜色与文案统一：queued 为中性、preparing 为提示、running 为进行中、completed 为成功、failed 为错误、cancelled 为中性偏弱。不存在 interrupted 或 awaiting_approval 状态；中断与等待审批分别通过 `errorCode` 与 Approval 状态展示。M0 已有基本状态展示；文案统一在 M1 完成。
- 失败提示必须包含 `errorCode` 文案、`failureDetail` 的可执行下一步与是否可重试；不得只展示原始堆栈（M1）。
- 排队超过阈值时展示排队原因与预计可调度条件；无法估计时间时不编造预计时间（M1）。
- mock 运行在 Run 列表与详情有明显徽标，并在 summary 中说明没有真实修改（M1；M0 的 Agents 页面与 Agent 选择器已显示 runtime，但 Run 列表/详情缺徽标）。
- 取消按钮对终态 Run 隐藏；取消需确认，确认文案说明可能丢失未保存输出（M0 已有确认；终态隐藏 M1）。
- 未知或缺失字段显示「未知」或「不适用」，不留空白造成误判（M1）。

### 13.3 关键交互规则

1. 只有 Task 状态为 todo、in_progress 或 in_review 时才允许启动 Run（M0 已实现，对应 `TaskStatus.Executable()`）。
2. 启动 Run 后 Task 自动指派给该 Agent；如果原状态为 todo，则推进为 in_progress（M0 行为；M1 增加 UI 提示）。
3. **同一 Task 在 M1 同时只允许一个活跃 Run**：已有 queued/preparing/running 的 Run 时，新的启动请求返回 409，并提示等待或取消当前 Run。跨 Task 的并行不受限制，这正是「并行任务」的产品主张。M2 的 Crew 场景允许同一 Task 下多个角色 Run 并行，但必须由 Crew 显式声明并受 DAG 约束；普通任务不享受该例外。
4. 取消、重试、合并、推送属于显式动作，均需确认；M1 的合并需要评审结论与 `confirm=true`，M3 的推送需要审批。
5. 事件日志默认自动滚动到底部；用户向上滚动后暂停自动滚动，并提供「回到最新」（M1；M0 未实现自动滚动策略）。
6. 大日志默认折叠，只展示最后 500 行与关键事件；完整日志通过 `log_bundle` Artifact 下载（M1）。
7. 工作区路径可复制（M1）；在桌面壳中提供「在文件管理器中打开」（M2），不得自动打开外部编辑器。
8. 删除 Task 不级联删除 Run 与 Artifact；Run 作为历史记录保留，UI 标注所属 Task 已归档（M1；M0 的硬删除会留下悬空 task 引用且 UI 无标注）。

### 13.4 空状态

空状态必须与「加载失败」区分，且不能用示例数据冒充真实数据。

| 场景 | API 行为 | 界面行为 |
| --- | --- | --- |
| 无 Run | `GET /api/v1/runs` 返回 200、空数组与 `nextCursor=null` | 展示「还没有运行记录」与「从 Task 启动 Run」入口；不显示虚假耗时或状态 |
| 无 Machine（M3） | `GET /api/v1/machines` 返回 200、空数组 | 展示本地隐式执行说明与「注册 Runner」入口；不把本机伪装成已注册 Machine |
| 无 Artifact | `GET /api/v1/runs/{id}/artifacts` 返回 200、空数组 | 展示「该 Run 尚未产生证据」并解释 DoD 要求；不显示空白表格 |
| 无 Evidence / DoD 未满足 | `GET /api/v1/runs/{id}/evidence`（M2）返回 200 与缺失清单；M1 由服务端在完成动作中校验 | 展示缺失项与补齐方式；完成按钮禁用或要求例外理由 |
| 查询不存在的 Run | `GET /api/v1/runs/{id}` 返回 404 | 展示「Run 不存在或已不可访问」，提供返回列表入口 |

## 14. 数据与 API 影响

### 14.1 现有数据模型（M0）

- `tasks`：id、title、description、status、priority、assignee_type、assignee_id、parent_id、labels、created_at、updated_at。
- `agents`：id、name、description、instructions、runtime、model、workspace_mode、max_concurrency、timeout_minutes、allowed_paths、allowed_commands、created_at、updated_at。
- `runs`：id、task_id、agent_id、status、trigger、branch、worktree、summary、error、created_at、started_at、ended_at。
- `run_events`：id、run_id、seq、type、message、payload、created_at；按 run_id 与 seq 建立索引。

### 14.2 计划新增的数据结构

字段命名以 `02-domain-model.md` 为准；本章不引入同义字段。M0 的 `runs` 表没有下列字段。

| 对象 | 新增内容 | 里程碑 |
| --- | --- | --- |
| `workspaces` | `id`、`name`、`repoPath`、`defaultBranch`、`taskPrefix`、`settings`（JSON，含 remote、worktreeRoot、branchTemplate、protectedBranches、verificationCommands、保留策略）、`status`、创建/更新时间 | M1 |
| `agent_versions` | Agent 不可变快照、`contentHash`、创建时间；Run 通过 `agent_version_id` 引用 | M1 |
| `runs`（M1） | `workspace_id`、`agent_version_id`、`attempt`、`error_code`、`failure_detail`（`errorCode` 的子分类，需在领域模型 §3.6 登记）、`queue_reason`、`base_commit`、`head_commit`、`exit_code`、`last_event_at`、`cancel_requested_at`、`queued_at` | M1 |
| `runs`（M2） | `metrics`（JSON：耗时、token、费用估算等） | M2 |
| `runs`（M3） | `runner_id` | M3 |
| `machines` | 机器身份、标签、能力、状态、`lastSeenAt`、令牌哈希、注册与吊销信息（见 §7.4） | M3 |
| `runners` | Runner 版本、协议版本、状态、并发槽位、当前租约、最后错误 | M3 |
| `run_leases` | Run、Runner、租约开始与过期时间、续约计数 | M3 |
| `agents`（M2） | `read_only_paths`（只读路径：仓库相对或经批准的绝对路径，M2 存储并执行；需在 `02-domain-model.md` 的 Agent 表同步登记） | M2 |
| `artifacts` | Run、类型、subtype、标题、大小、sha256、路径、来源、截断标记、归档状态 | M1 |
| `reviews` | Run、结论、评论、引用的 Artifact、评审人与时间；M1 的合并确认绑定 Review | M1 |
| `evidence_items` | Run、Artifact 引用、证据类型、是否满足 DoD、例外理由 | M2 |
| `approvals` | 对象类型与 ID、动作、参数哈希、发起人、审批人、结果、理由、时间、绑定的 commit | M2 |

M1 的 DoD 判定直接基于 Artifact 类型与人工例外记录，不依赖 `evidence_items`；该表在 M2 引入，用于角色交付物契约与证据验证状态。

### 14.3 现有 API 与本章的关系

M0 的 API 未版本化，以下路径为现状；M1 起统一迁移到 `/api/v1`（与 `api-and-data.md` 的迁移表一致），M0 路径不再新增能力。

| 方法与路径 | 作用 | 本章关注点 |
| --- | --- | --- |
| `GET /api/health` | 存活与版本 | Runner 可用性探测的基础 |
| `GET /api/agents`、`POST /api/agents`、`GET/PATCH/DELETE /api/agents/{id}` | Agent CRUD | Runtime、模型、超时、并发、路径与命令配置 |
| `GET /api/tasks/{id}/runs`、`POST /api/tasks/{id}/runs` | 列出/创建 Run | 状态校验、指派、入队、同 Task 活跃 Run 互斥（M1） |
| `GET /api/runs`、`GET /api/runs/{id}` | Run 列表与详情 | 状态、错误、工作区 |
| `GET /api/runs/{id}/events` | 事件回放 | 日志与证据事件 |
| `POST /api/runs/{id}/cancel` | 取消 | 取消语义与幂等 |
| `GET /api/ws` | WebSocket 事件流 | `run.event`、`run.updated` 等广播 |

### 14.4 计划新增 API

所有计划端点统一使用 `/api/v1` 前缀。本表只列本章新增或强相关的端点；完整请求/响应/错误码以 `api-and-data.md` 为准，新增端点必须先登记到该文档的端点表。

| 方法与路径 | 作用 | 里程碑 |
| --- | --- | --- |
| `GET /api/v1/runtimes` | Runtime 能力与可用性探测；返回 `name`、`available`、`version`、`models`、`authStatus`、`capabilities`。探测失败返回 500 `{code:"PROBE_FAILED"}`；本地模式不要求认证，M3 团队模式需登录 | M1 |
| `POST /api/v1/runs/{id}/retry` | 基于原 Run 的 Task/Agent 创建新 Run，`attempt` 递增；原 Run 必须为终态 | M1 |
| `GET /api/v1/runs/{id}/diff` | 返回结构化 diff 与统计；大 diff 截断并给出 Artifact 引用 | M1 |
| `POST /api/v1/runs/{id}/merge` | 受评审门保护的合并；M1 需要 `confirm=true`，M2 增加 `approvalId`；冲突返回 409 与冲突文件列表 | M1 |
| `GET /api/v1/runs/{id}/artifacts` | 证据列表；游标分页（`cursor`、`limit`），按类型过滤 | M1 |
| `GET /api/v1/artifacts/{id}` | Artifact 元数据：类型、subtype、大小、sha256、来源 Run、创建时间 | M1 |
| `GET /api/v1/artifacts/{id}/content` | 流式内容；设置 Content-Type 与 ETag（sha256）；文本可 `?maxBytes=` 截断预览；访问权限与所属 Run 一致，M3 记录审计 | M1 |
| `GET /api/v1/runs/{id}/evidence` | 证据化完成定义检查结果（已有/缺失/例外） | M2 |
| `POST /api/v1/approvals`、`POST /api/v1/approvals/{id}/decision` | 发起与决策审批；绑定对象、动作、commit 与参数 | M2 |
| `GET /api/v1/workspaces`、`POST /api/v1/workspaces` | 产品级 Workspace 的读取与创建（仓库绑定），替代早期的 Project/Repository 概念 | M1 |
| `GET /api/v1/machines`、`POST /api/v1/machines/register`、`POST /api/v1/machines/{id}/heartbeat`、`DELETE /api/v1/machines/{id}` | 机器与 Runner 管理 | M3 |

分页与鉴权规则：列表端点使用游标分页，默认 20 条、最大 100 条；Artifact 列表与内容端点不得绕过 Run 的访问权限；M3 团队模式下，无权限用户请求 Artifact 返回 403，且响应不得泄露其他 Workspace 的资源是否存在。

### 14.5 WebSocket 事件

M0 已有：`task.created`、`task.updated`、`task.deleted`、`agent.created`、`agent.updated`、`agent.deleted`、`run.queued`、`run.preparing`、`run.running`、`run.event`、`run.updated`。M1 起补充：

| 事件 | 触发时机 | 载荷要点 |
| --- | --- | --- |
| `run.completed` | Run 进入 completed | Run 摘要、证据计数、耗时 |
| `run.failed` | Run 进入 failed | `errorCode`、`failureDetail`、可读原因、是否可重试；`interrupted` 与 `runner_lost` 都走此事件 |
| `run.timeout` | 超时终止完成 | 超时阈值、实际耗时、`errorCode=timeout` |
| `run.cancelled` | 取消完成 | 取消发起人、阶段、耗时 |
| `run.progress` | 低频进度心跳 | 阶段、最后事件时间、已运行时长 |
| `artifact.created` | 证据落盘 | Artifact ID、类型、subtype、大小 |
| `merge.completed` | 合并成功 | Run、目标分支、合并 commit、审批记录 ID |
| `machine.online` / `machine.offline` | 机器状态变化 | 机器 ID、最后心跳 |
| `approval.requested` / `approval.decided` | 审批流程 | 对象、动作、结果 |

事件只用于 UI 推送，不作为唯一事实来源；客户端重连后必须通过 REST 拉取当前状态，并使用 `afterSeq` 补齐事件。

## 15. 异常与边界

| 场景 | 期望行为 | 里程碑 |
| --- | --- | --- |
| Claude CLI 未安装 | Run failed，`errorCode=runtime_error`、`failureDetail=runtime_missing`，提示安装与 PATH 配置，不回退 mock | M1 |
| Claude CLI 未登录或 Key 失效 | Run failed，`errorCode=runtime_error`、`failureDetail=runtime_auth`，提示重新登录，不自动重试 | M1 |
| API Key 被写入 prompt 或日志 | 脱敏后落库，事件中显示已脱敏标记，提示用户轮换密钥 | M1 |
| 磁盘空间不足 | 创建 Run Workspace 前预检；不足时 Run failed，`errorCode=workspace_error`、`failureDetail=workspace_provision_failed`，提示清理 | M1 |
| Git 索引被其他进程锁定 | 重试有限次数后失败，`errorCode=workspace_error`、`failureDetail=git_error`，提示关闭其他 Git 操作 | M1 |
| fetch 时网络中断 | 失败并保留本地状态，允许人工重试；不静默使用旧 base | M1 |
| 同一 Task 连续启动多个 Run | M1 返回 409，提示等待或取消当前活跃 Run；Run 终态后可重试，`attempt` 递增且各自使用独立 worktree 与分支。M2 Crew 允许同 Task 并行角色 Run | M1 |
| 主工作区存在未提交修改 | worktree 仍从 `baseCommit` 创建，未提交修改不进入 Run、不被覆盖；UI 提示其存在 | M1 |
| 仓库包含子模块 | M1 不初始化子模块，启动前提示；任务依赖子模块时失败并记录 `workspace_error/submodule_unsupported` | M1 |
| 仓库启用稀疏检出 | M1 拒绝启动并说明原因，`errorCode=workspace_error`、`failureDetail=sparse_checkout_unsupported` | M1 |
| 取消发生在 preparing 阶段 | 中断 Git/目录操作，清理半成品，Run cancelled | M1 |
| 取消与自然完成竞态 | 以先通过状态守卫写入的合法终态为准；后续写入被拒绝并记录 `cancel_lost_race` | M1 |
| 单行输出超过 1 MB | 扫描器报错；M1 需提高上限并分块处理，记录截断标记，不丢错误 | M1 |
| 输出洪峰 | 日志限流与合并，关键事件不丢，保留完整日志文件 | M1 |
| 服务重启时存在 running Run | 无存活进程则写为 failed，`errorCode=interrupted`，并记录恢复事件 | M1 |
| 服务重启时存在 queued Run | 重新入队并保留原创建时间，避免顺序倒置 | M1 |
| 工作区路径包含空格或中文 | 正常创建与执行，所有命令使用参数数组而非字符串拼接 | M1 |
| Windows 路径与长路径 | 使用兼容路径处理，提供明确的错误信息；打包阶段专项验证 | M4 |
| 远程 Runner 心跳丢失后恢复 | Run 已为 failed + `runner_lost`，人工决定重试或放弃，不自动双跑，不恢复 running | M3 |
| 机器时间与服务器偏差 | 事件时间以服务器接收时间为准，Runner 上报时间作为辅助字段 | M3 |
| Artifact 超大 | 超过 50 MiB 拒绝入库，记录告警事件与原因；完整内容不进入数据库 | M1 |
| 证据采集失败 | Run 不直接完成；记录 `errorCode=runtime_error`、`failureDetail=evidence_missing` 或要求人工例外 | M1 |
| Task 在 Run 执行中被删除 | Run 继续执行并保留历史，UI 标注 Task 已删除；取消由用户决定 | M1 |
| Agent 在 Run 排队或执行中被修改 | Run 使用创建时固定的 `agentVersionId` 快照，修改只影响后续 Run | M1 |
| 同一仓库的多个 direct Run | 拒绝第二个，提示先结束当前 direct Run | M2 |

## 16. 权限与安全

### 16.1 执行身份

M0 的所有 Runtime 进程以 ATeam 服务进程的 OS 用户身份执行，继承该用户对文件系统、网络与凭据的访问能力。这意味着 Agent 理论上可以读取用户的 SSH Key、浏览器数据与其他仓库。产品必须做到：

1. 在 Agent 配置与首次运行提示中明确「Agent 以你的用户身份运行」。
2. 默认不把完整环境变量传给 Adapter，使用白名单。
3. 高风险动作有审批门，且审批门不能由 Agent 自行触发通过。
4. M3 远程 Runner 推荐使用专用系统用户或容器，降低对个人环境的暴露。

### 16.2 允许路径与命令

- `allowedPaths` 定义可写边界（仓库相对 glob）；读取边界默认是 Run Workspace，M1 不承诺读取仓库外资料。
- M2 增加 `readOnlyPaths`（仓库相对或经批准的绝对路径）：仅当 Agent 显式声明并完成真实路径校验后，才允许读取仓库外资料；未声明时不得读取。该字段在 M2 存储并执行，需同步登记到 `02-domain-model.md` 的 Agent 表。
- 路径校验在真实路径解析后进行，防止符号链接逃逸；不允许通过 `..` 跳出边界。
- `allowedCommands` 采用白名单前缀匹配或精确匹配，建议精确到可执行文件与子命令；未在白名单中的命令默认拒绝。
- 命令必须通过参数数组执行，禁止把 Agent 提供的字符串直接交给 shell；需要 shell 能力时显式声明并承担风险。
- 被拒绝的动作记录为 `permission_denied` 事件，包含命令、路径与原因；是否终止 Run 由 Agent 策略决定，默认终止高风险越界。
- **M1 越界检测范围**：比较 Run 前后 Workspace 仓库根目录与用户主工作区中属于该仓库的路径，列出 Run Workspace 之外发生变化或被读取的文件；系统临时目录、Runtime 自身缓存与 Git 内部对象不在检测范围。检测到越界只告警并记录 `status` 事件（`subtype=workspace_escape_detected`），不阻断执行；误报可由评审者标记 `false_positive`，并保留原始证据供复核。真正阻止写入由 M2 的路径权限与沙箱承担。
- M2 的 DevOps Agent 只能执行 staging 相关命令与生成部署计划；生产部署命令永远不在白名单内，必须人工执行。

### 16.3 审批门

必须经过人工审批的动作：

1. 合并 Run 分支到目标分支；
2. 推送 Run 分支到远程或创建/更新 PR；
3. 部署到任何环境（M2 的 DevOps 只能生成计划，staging 也需审批后由人工或受控流水线执行）；
4. 删除分支、删除 worktree、删除 Artifact 等不可逆操作；
5. 修改 Workspace 仓库配置、受保护分支列表与 Runner 注册令牌。

审批记录至少包含：动作、对象、发起人、审批人、时间、结果、理由、当时的 commit 与证据摘要。审批通过后对象发生变化（如 commit 变化）时审批失效，需要重新审批。

### 16.4 凭据与密钥

- Runtime 凭据由用户在本机 CLI 或环境变量中管理；ATeam 不提供 Key 输入框作为唯一方式，避免误存。
- 若未来支持凭据引用，只保存引用名、作用域与创建者，不保存明文；读取时由本机凭据代理注入。
- 事件、日志、Artifact、审计记录统一经过脱敏管线；脱敏失败时拒绝写入而不是原样落库。
- 团队模式下按用户或机器隔离凭据，管理员可吊销但不可查看明文。

### 16.5 网络与多用户

- M0 的 HTTP 服务默认绑定 `127.0.0.1`，但 WebSocket 接受任意来源，CORS 反射请求来源；这在本地单人场景可接受，在局域网或团队场景不可接受。
- M3 开放非本地访问时必须启用认证、来源校验与 TLS；未认证请求不得读取 Run、Agent、Artifact。
- 团队模式下的权限至少区分：查看、运行、评审、合并、管理机器、管理工作区；权限检查在 API 层执行，不依赖 UI 隐藏。
- WebSocket 订阅需要鉴权，事件载荷按权限裁剪；不得把其他用户无权限的 diff 或日志推送给所有客户端。

### 16.6 Docker 沙箱（M3 起）

沙箱目标不是「绝对安全」，而是把 Agent 的文件系统与网络能力限制在可控范围：

- 默认只挂载 Run Workspace，不挂载用户主目录；
- 默认禁用网络或只允许白名单域名，取决于任务类型；
- 使用非 root 用户运行，限制 capabilities 与进程数；
- 容器镜像与依赖由 Workspace 配置，禁止 Agent 自行拉取任意镜像；
- 沙箱不可用时**默认失败关闭**：Run 进入 failed，`errorCode=workspace_error`、`failureDetail=sandbox_unavailable`。只有用户对该次 Run 显式批准降级，才允许在本机执行，并把批准写入审批记录与审计；Agent/Workspace 配置中的 `allowSandboxFallback` 默认 false，不能由 Agent 自行修改；
- 沙箱内的 Git 凭据通过短期令牌注入，不写入镜像层或日志。

## 17. 指标

以下为产品观测指标与设计目标。目标值需在 M1 实测基线后校准，不应当作已达成承诺。

| 指标 | 定义 | 设计目标 |
| --- | --- | --- |
| Run 成功率 | completed / 已结束 Run | 稳定任务不低于 90%，按 Runtime 与 Agent 分组观察 |
| 排队等待时间 | queued 到 preparing 的时长 | 默认并发下 p95 不超过 60 秒 |
| 执行时长 | running 阶段时长 | 按任务类型分桶，不设统一目标 |
| 失败分类覆盖率 | 带 `errorCode` 的失败 Run / 全部失败 Run | 100% |
| 可重试失败率 | 可重试分类失败 / 全部失败 | 用于评估自动重试收益 |
| 取消成功率 | 取消后 10 秒内进入 cancelled / 取消请求 | 不低于 99% |
| 超时率 | timeout 分类 / 全部 Run | 按 Agent 超时配置观察，异常升高触发提示 |
| 证据完整率 | 满足 DoD 的完成 Run / 完成 Run | 不低于 95%（允许人工例外） |
| worktree 泄漏数 | 无数据库记录或超期未清理的 worktree 数量 | 0 为健康，超过阈值告警 |
| 事件写入失败率 | 失败的 AppendRunEvent / 总事件 | 低于 0.1% |
| 机器利用率 | 运行中槽位 / 总槽位 | 用于容量规划，不追求满载 |
| 机器离线恢复时长 | offline 到重新 online 的时长 | 用于团队 SLA 观察 |
| 平均修复时间 | 失败 Run 从失败到下一次成功重试的时长 | 作为体验指标持续下降 |
| 凭据泄漏事件 | 日志/证据中检测到明文密钥的次数 | 0 |

指标采集遵循本地优先：M0 至 M2 只做本地统计与界面展示；M4 的遥测必须显式选择加入，且不包含代码、prompt、diff 与路径等敏感内容。

## 18. 依赖与风险

| 依赖/风险 | 说明 | 应对 |
| --- | --- | --- |
| Claude Code CLI 协议变化 | 参数、输出格式与权限模式可能随版本变化 | 版本探测、适配层隔离、契约测试、失败时给出明确版本提示 |
| Codex CLI 差异 | 非交互模式与能力集合不同 | 独立 adapter 与能力声明，不强行等价映射 |
| Git worktree 限制 | 同一分支不能同时在多个 worktree 检出；子模块与稀疏检出行为复杂 | 每 Run 独立分支；M1 不初始化子模块并在启动前提示，检测到稀疏检出时拒绝启动；M2 专项验证后再决定支持范围 |
| 磁盘占用 | worktree、日志、Artifact 与依赖缓存增长快 | 保留期、容量预检、清理入口、按 Run 统计占用 |
| 进程逃逸与命令注入 | Agent 可能执行超出预期的命令 | 参数数组、命令白名单、路径校验、M3 沙箱 |
| 凭据泄漏 | 日志、diff、截图可能包含密钥 | 脱敏管线、默认不采集环境变量、审计与轮换提示 |
| 多 Agent 并发写同一仓库 | Git 锁、索引竞争、分支冲突 | 每 Run 独立 worktree，仓库级锁，direct 模式限制单实例 |
| 服务重启导致状态不一致 | 内存队列与运行中进程丢失 | M1 启动恢复、租约与前置状态校验 |
| 远程执行信任边界 | 远程机器可能被共享或不受控 | 注册令牌、租约、能力声明、最小权限 Runner 用户 |
| WebSocket 事件风暴 | 高频日志压垮服务与 UI | 限流、合并、背压与关键事件保障 |
| 跨平台差异 | Windows 路径、进程终止、文件锁行为不同 | 分平台测试，M4 打包前专项验证 |
| 任务与 Agent 配置漂移 | Run 执行或排队期间配置被修改 | Run 创建时固定 `agentVersionId`，执行期只读快照 |
| 证据可信度 | Agent 自述测试通过但实际失败 | 系统按 Workspace 的 `verificationCommands` 复跑一次，分离自述与系统证据；失败则 DoD 不满足 |

## 19. 里程碑映射

| 里程碑 | 本章交付内容 | 退出标准 |
| --- | --- | --- |
| M0（已完成骨架） | Adapter 接口、mock 与最小 claude adapter、进程内 Scheduler、每 Run 独立目录、Run 事件持久化与 WebSocket 广播、取消与超时基础能力、Runs 页面 | 能从 Task 启动 Run 并看到事件与终态；SQLite 持久化；桌面壳可运行。已知缺陷（取消竞态、未知 Runtime 回退 mock、queued 悬挂）必须在 M1 修复 |
| M1（本地闭环） | git worktree 与分支、fetch 与 diff、真实 Claude Code 结构化适配、Artifact（diff、test_report、log_bundle、note；Evidence 从 M2）、AgentVersion 快照、失败码、状态守卫与取消修复、超时、重试、启动恢复、Workspace 实体与仓库绑定、同 Task 单活跃 Run、M1 最小 DoD、系统复跑验证命令、人工审批合并、本地 API 安全加固（Origin 校验与远程访问开关） | 一次真实编码任务可以在独立 worktree 完成，评审者看到 diff 与测试证据并人工合并；未知 Runtime 不再回退 mock；排队取消不再执行；重启后非终态 Run 写为 failed + `errorCode=interrupted`；mock 与无测试证据不能通过 DoD；同一 Task 第二个活跃 Run 返回 409 |
| M2（角色 Agent 协作） | Codex adapter、能力声明、路径与命令权限执行、Agent 并发、UI/部署类 DoD、截图证据、Approval 实体、direct 模式、角色模板与 DAG 依赖下的调度、`readOnlyPaths`、orphan 清理 | UI Design、Frontend、Backend、DevOps 角色按 DAG 与交付物契约协作；越界动作被拒；DevOps 仅生成 staging 计划，生产部署人工执行；自动重试与 Agent 并发按策略生效 |
| M3（团队模式） | Machine/Runner 实体、注册、心跳、租约、远程执行、离线（failed + `runner_lost`）、Docker 沙箱与降级审批、Postgres、登录与权限、审计、GitHub PR、凭据隔离、非本地访问认证 | 两台机器共享调度；Runner 离线不导致双执行，Run 以 `runner_lost` 结束并由人工决定重试；合并与推送有审批与审计；非本地访问需要认证 |
| M4（自动化与分发） | 定时与 Webhook 触发的 Run、通知、Wails 打包（DMG/NSIS/AppImage）、自动更新、插件 API、选择性遥测、文档 | 跨平台安装包可用；自动化触发遵守同一安全与审批规则；遥测默认关闭且不采集敏感内容 |

里程碑之间的依赖：M1 的 worktree、AgentVersion 快照与证据是 M2 协作与 DoD 的基础；M2 的权限与审批是 M3 团队共享的前提；M3 的 Runner 复用 M1 的 Run Workspace 与证据契约，不另起一套执行模型。Run 状态集合在 M1 冻结为六个状态，M2/M3 只新增 `errorCode` 子分类与 Approval 流程，不新增 Run 状态。

## 20. 与其他文档的关系

- **领域模型（`prd/02-domain-model.md`）**：本章的 Run、RunEvent、Run Workspace、Artifact/Evidence、Machine/Runner 字段、状态机与错误码均以其 §3、§4 为准。本章不重复定义实体，只补充执行期的产品契约；出现差异时以领域模型为准并回改本章。
- **验收计划（`prd/04-acceptance-and-test-plan.md`）**：定义 AC-RUN-01 至 AC-RUN-12 等验收条目；本章 §12.7 引用这些编号，并补充负向用例。任何 FR 变更必须同步验收映射。
- **任务与看板模块（`prd/modules/task-management.md`）**：定义 Task 的上下文、状态与验收条件；本章消费 Task 的可执行状态与完成定义。M1 起同一 Task 单活跃 Run 的约束由该文档与本章共同保证。
- **Agent 配置模块（`prd/modules/agent-system.md`）**：定义 Runtime、模型、超时、并发、路径与命令配置以及 AgentVersion；本章定义这些配置在执行期的解释与约束，并新增 `readOnlyPaths` 与 Workspace 级 `verificationCommands` 的落地要求。
- **协作与评审模块（`prd/modules/collaboration-and-review.md`）**：定义角色 Agent、任务 DAG、交付物契约与人工评审门；本章提供其所需的 Run、Run Workspace、Artifact/Evidence 原始能力。
- **安全与权限模块（`prd/modules/security-and-permissions.md`）**：展开审批矩阵、团队角色与密钥管理。本章 RUN-100 至 RUN-112、RUN-115、RUN-117 与该文档按**主题范围**映射，不要求一一对应：
  - 本地服务与来源防护：SEC-001 至 SEC-008；
  - 路径、命令、凭据与 Runtime 隔离：SEC-010 至 SEC-019；
  - 合并、推送、部署与删除审批：SEC-020 至 SEC-027；
  - Runner 注册、心跳与租约：SEC-040 至 SEC-044；
  - 审计与保留：SEC-050 至 SEC-054；
  - 供应链、发布与遥测：SEC-060 至 SEC-073。
  其中 SEC-041/042 的 15 秒/45 秒/90 秒与本章一致，旧稿的 30 秒 × 3 次已废弃。
- **平台与 API 模块（`prd/modules/api-and-data.md`）**：定义 API 风格、认证、错误码、端点表与数据表。本章新增端点必须使用 `/api/v1` 并先登记到该文档；Run 字段命名以其与领域模型为准。
- **界面与可观测性模块（`prd/modules/ui-ux.md`）**：定义 Run 详情、日志、Diff 与机器页面的视觉与交互细节；本章只给出信息需求与状态语义，视觉细节不在本章重复。
- **非功能需求（`prd/modules/non-functional-requirements.md`）**：定义性能、可靠性与可观测性指标；本章 §17 的指标需与其口径一致。
- **里程碑文档（`prd/milestones/M0-scaffold.md`、`M1-local-loop.md`、`M2-role-agents.md`、`M3-team-mode.md`、`M4-automation-and-packaging.md`）**：按进度展开交付范围与验收脚本；本章负责模块能力与 FR 映射，不重复里程碑级计划，出现冲突时以里程碑文档的排期为准并回改本章。
- **范围与路线图（`prd/01-scope-and-roadmap.md`）**：定义里程碑边界与非目标；本章的 M1-M4 能力不得越过该文档的范围。
- **架构文档**：当前仓库没有独立的架构文档（旧名 `prd/architecture.md` 未创建，也不再计划创建）；若后续新增，本章的 Adapter、Scheduler 与 Run Workspace 需求应与其组件边界对应。

## 21. 待确认/未文档化

以下问题仍未决，但每项都给出**默认决策**，在正式决策前按默认值实现，避免阻塞工程。已决定的事项已写回正文，不再在本节重复。每项标注影响范围与决策截止里程碑。

1. **取消宽限期是否按 Runtime 配置**：默认 10 秒适用于所有 Runtime；影响取消体验与进程回收，Windows 进程树终止方式需专项验证。决策截止 M1。
2. **截图采集主路径**：默认以 Agent 声明目录为主、人工上传为补充，系统不主动驱动浏览器；影响 M2 的 UI 证据可信度。决策截止 M2。
3. **远程 Runner 的事件缓冲与重放协议**：默认上限 100 MB、断线期间按 seq 缓冲、重连后按序重放并以 `(runId, seq)` 去重；缓冲溢出时停止执行并回报错误。影响 M3 协议设计与磁盘占用。决策截止 M3。
4. **Docker 沙箱网络策略默认值**：默认禁用网络，任务显式声明白名单才允许出站；影响 M3 的可用性与安全。决策截止 M3。
5. **direct 模式是否保留**：默认保留在 M2，仅限单人、单仓库单实例；若与并行 Agent 主张冲突，可在 M2 评审时删除。决策截止 M2。
6. **Codex adapter 的支持深度**：默认要求事件、取消、超时契约等价，模型/会话/预算能力允许差异并在 UI 标注；影响 M2 工作量。决策截止 M2。
7. **团队模式事件可见性**：默认 Run 日志与 diff 对同 Workspace 成员可见，跨 Workspace 不可见；影响权限模型与 M3 审计。决策截止 M3。
8. **`failureDetail` 子分类的冻结清单**：§11.3 已给出 M1-M3 所需集合，是否允许后续自由扩展由 API 治理规则决定；默认通过 `/api/v1/meta` 公布并保持向后兼容。影响错误码治理与客户端适配。决策截止 M1。
