# 模块：任务与看板

## 本章导读

任务与看板是 ATeam 的第一入口。ATeam 的核心闭环是「Task（上下文容器）→ Agent（可复用工作配置）→ Run（一次执行）→ Run Workspace（隔离工作区）→ Runtime（Claude Code/Codex/mock）→ Artifact/Evidence（diff、测试、截图）→ Human Review → Merge」，其中 Task 是整个闭环的起点和上下文载体：没有任务，Agent 就没有边界；没有任务状态，人就无法知道多个 Agent 在并行做什么；没有任务上的证据聚合，评审就只能靠口头描述。

本章以仓库当前代码为事实基线，完整定义任务对象、状态机、看板与列表、任务详情、任务依赖 DAG、角色 Agent 协作、交付物契约、评论与证据、批量与归档、异常与冲突、API 与数据影响、权限安全、指标和里程碑映射。凡标注「M0 已实现」的能力，都能在现有 Go 服务、SQLite schema、REST/WS API 和 Vue 页面中找到对应实现；标注 M1-M4 的能力均为计划，不得在对外沟通中描述为已交付。

本章涉及跨文档契约时按以下优先级取值：REST 路径、请求响应结构、WebSocket 事件名、错误码与数据表字段以 `prd/modules/api-and-data.md` 为准；评审、合并门、证据化 DoD 与角色协作规则以 `prd/modules/collaboration-and-review.md` 为准；里程碑范围与退出标准以 `prd/milestones/` 为准。本章第 14 章的功能需求只描述任务域行为，不另立第二套接口或事件契约；出现冲突时，先修正本章，再同步修订引用方。

建议阅读顺序：产品与设计同学先读第 4、5、6 章，建立任务对象和状态心智；工程同学先读第 14、15 章，确认 FR 与 API 边界；负责 M2 协作能力的同学重点读第 9、10 章，理解为什么角色 Agent 必须通过任务 DAG、交付物契约和审批门协作，而不是在同一个会话里自由聊天。

本次修订修复了以下跨文档冲突：评审门与合并门分离、Run 完成后的默认状态、revision 与 workspaceId 的里程碑归属、`/api/v1` 路径与评审端点形状、状态流转矩阵、事件命名、归档与软删除的关系、评审记录数据模型以及 M0 能力的真实性描述。修订后的正文以「M0 已实现」「M1-M4 计划」两档标注，不再把计划能力写成现状。

本章中的关键术语约定如下：

| 术语 | 含义 |
|---|---|
| Task | 一次可交付工作的上下文容器，包含目标、约束、验收标准、处理人和证据要求 |
| Workspace | 本地仓库与执行策略的绑定，保存仓库路径、remote、默认 base branch 与 worktree 根目录；M1 起 Task 必须归属一个 Workspace。领域模型文档中的同名概念为 Workspace，本章统一使用 Workspace，迁移映射见表后说明 |
| Run | 某个 Agent 针对某个 Task 的一次执行，是事实记录，不可篡改状态历史 |
| Review | 对某个 Run 的人工评审记录，包含结论、意见、证据快照与评审人；Review 不是任务状态，也不等于合并 |
| 合并门（Merge Gate） | 在评审通过后，把 Run 分支合并进目标分支前的人工审批检查点；合并成功才允许 Task 进入 done |
| Backlog | 尚未准备好执行的任务池，任何情况下都不触发 Agent |
| 可执行（Executable） | 当前实现中状态为 todo、in_progress 或 in_review，且满足依赖与并发约束 |
| Artifact | Run 产生的文件型产物，例如 diff、截图、测试报告、构建包 |
| Evidence | 对完成度的结构化证明，例如测试通过、lint 通过、人工评审签字 |
| DoD | Definition of Done，证据化完成定义，绑定任务类型与交付物契约 |
| 审批门 | 高风险动作前必须由人确认的检查点，例如合并、推送、部署、删除 |
| 归档（Archive） | 产品文案中的隐藏与保留操作；数据层是软删除，设置 `archived_at`，不删除 Run、Artifact 与 Evidence |

## 1. 目的与范围

### 1.1 目的

本模块要解决四个问题。

第一，给用户一个可靠的工作入口。任何需要 Agent 执行的事情，都应先成为一个 Task，而不是直接打开一个终端输入提示词。Task 让目标、上下文、约束和验收标准被固定下来，使 Run 可重放、可比较、可评审。

第二，给 Agent 一个边界清晰的上下文容器。Agent 的 instructions 是可复用配置，Task 的 description、acceptanceCriteria、dependsOn 和 deliverableContract 描述本次工作的具体边界。两者组合后才生成 Run 的提示词，避免把项目级规则和一次性目标混在一起。

第三，让并行开发可视化、可筛选、可治理。独立开发者同时运行 3-5 个 Agent 时，最稀缺的不是算力而是注意力。看板必须让人一眼看到哪些任务在排队、哪些在运行、哪些等待评审、哪些被依赖阻塞。

第四，让「完成」可验证。任务进入 done 不能只靠 Agent 自述，必须有 Run 记录、diff、测试证据、截图或人工评审意见。证据化 DoD 是 ATeam 区别于「终端里跑一个 Agent」的核心产品价值。

### 1.2 范围

本章覆盖以下内容：

- Task 对象的字段、类型、校验、默认值和生命周期。
- Task 与 Workspace 的归属关系、创建时的项目选择、跨项目移动与项目归档规则。
- 任务状态枚举、状态流转矩阵、可执行判定和守卫规则。
- 评审门与合并门的分离，以及 Run 完成、评审通过、合并成功之间的关系。
- 看板视图、列表视图、筛选、搜索、排序、保存视图。
- 任务详情页的信息架构，包括描述、验收标准、Run 记录、diff、Artifact、Evidence、评论和评审。
- 新建任务、用 Agent 创建任务草稿、快捷模板。
- 任务依赖 DAG 的数据语义、阻塞判定、可执行计算和调度器集成。
- 角色 Agent 通过 DAG 与交付物契约协作的规则。
- 批量操作、归档、删除和数据保留。
- 空状态、加载、错误、冲突、离线等交互状态。
- 任务模块的 API、WebSocket 事件、数据库迁移和兼容性影响。
- M4 自动化触发任务、通知、插件、导入导出与遥测在任务域的约束。
- 权限、安全、审计、指标、依赖、风险和里程碑映射。

与 Agent 配置、Run 生命周期、Workspace 隔离、Runtime 适配器、Artifact 存储和团队权限相关的实现细节，分别由对应模块文档展开。本章只定义任务模块对这些能力的消费方式和接口契约。

### 1.3 非目标

以下内容明确不在本模块范围内，避免范围蔓延：

- 不做完整的企业级项目管理套件克隆。不实现 Sprint、Story Point、Epic 体系、自定义工作流引擎、工时填报和燃尽图。
- 不做实时多人富文本协同编辑。M3 团队模式只提供乐观锁、冲突提示和刷新，不实现字符级协同。
- 不做移动端任务应用。桌面端和本地 Web 是唯一入口。
- 不做跨组织多租户 SaaS。M3 的团队模式是单团队、自托管或共享机器。
- 不做模型托管，不转售模型额度，不代理用户 Key。
- 不在 M0/M1 实现「多个 Agent 在同一会话自由聊天」的协作模式。角色 Agent 协作必须通过任务 DAG、交付物契约和审批门表达。
- 不做甘特图、资源容量规划和自动排程算法。M2 只做基于依赖与并发的简单调度。
- 不把 Blocked 状态当作队列。被阻塞的任务不得进入调度器等待队列，避免无效占用并发槽位。

## 2. 角色与场景

### 2.1 角色定义

| 角色 | 与本模块的关系 | 关键诉求 |
|---|---|---|
| 独立开发者 | 任务创建者、评审人、合并人 | 快速捕捉想法，同时盯住 3-5 个 Agent，不让任务丢失 |
| 任务评审人 | 对 in_review 任务做通过或打回 | 在一个页面看到 diff、测试证据、截图和风险点 |
| 团队成员（M3） | 共享任务、Agent 和机器 | 知道谁在做什么，权限清晰，操作可审计 |
| 角色 Agent（UI Design、Frontend、Backend、DevOps） | 任务处理人或子任务处理人 | 拿到明确输入、交付物要求和可执行边界，不越权 |
| Crew/队长（M2 后置） | 把父任务拆成子任务 DAG | 不直接写代码，负责拆分、分派和汇总证据 |
| 调度器 | 读取任务可执行性并消费 Run 队列 | 只调度满足状态、依赖和并发约束的任务 |

需要特别说明：M0 的 `assigneeType` 已经预留 `human`、`agent`、`crew` 三种取值，但当前只有启动 Run 时自动写入 `agent` 这一条实际路径。`crew` 是向前兼容的枚举值，M0 没有 Crew 实体、没有 Crew 页面、没有 Crew 调度逻辑。M2 后置的 Crew 模式也必须落到任务 DAG 上，而不是新增一个绕过任务系统的聊天容器。

### 2.2 典型场景

场景 S1：早晨整理。开发者打开看板，Backlog 中有昨晚记录的 8 个想法。他把其中 3 个补充验收标准后拖到 Todo，为每个任务选择 Frontend 或 Backend Agent，然后逐个点击 Run。看板上三张卡片进入 In Progress，他继续做自己的事。

场景 S2：并行观察。开发者同时运行 4 个任务，其中 1 个 Run 失败、1 个等待评审、2 个运行中。看板卡片上的活跃 Run 指示和状态颜色让他不用打开每个详情页就能判断优先级。

场景 S3：证据评审与合并。一个任务进入 In Review。评审人打开详情页，看到 diff 涉及 6 个文件，测试证据显示单元测试通过、lint 通过，截图显示登录页修复后的效果。他点击 Approve，任务仍停留在 In Review，只是记录「评审通过」；随后他在合并对话框中确认目标分支、commit 与证据，执行合并。合并成功后任务才进入 Done。若证据缺失，他点击 Request changes，任务回到 In Progress 并保留评审意见。若该任务不需要合并（例如研究、文档或仅产出设计说明），评审人必须显式勾选「No merge required」并填写理由，任务才能从 In Review 进入 Done。

场景 S4：角色链路（M2）。一个「新增设置页」需求被拆成 DAG：UI Design 任务产出设计说明与截图，Frontend 任务依赖 UI Design，Backend 任务依赖 UI Design，DevOps Staging 任务依赖 Frontend 与 Backend。每个任务有交付物契约和证据要求。Frontend 任务在 UI Design 完成前保持 Blocked，调度器不会为它创建 Run。

场景 S5：团队筛选（M3）。团队成员按 assignee、label、status 筛选出「本周我负责的所有 In Review 任务」，保存为个人视图；团队共享一个「等待合并」视图，所有 Member 可见。

场景 S6：冲突与恢复（M1/M2）。两个浏览器窗口同时编辑同一个任务：M1 起使用 `revision` 与 `If-Match`，后提交的请求返回 409 `STALE_REVISION`，界面展示字段差异并要求刷新后重提。服务重启后，之前处于 running 的 Run 被标记为 interrupted，任务卡片提示需要重新运行。

## 3. 用户故事与验收标准

以下用户故事以 Given/When/Then 描述。每个故事在标题后标注里程碑，并在下表给出对应功能需求编号；未标注 M0 的故事均为计划能力。FR 编号规则见第 14 章开篇。

| 故事 | 里程碑 | 对应 FR |
|---|---|---|
| US-TASK-001 快速捕捉任务 | M0 | TASK-001、TASK-003、TASK-080、TASK-082 |
| US-TASK-002 Backlog 不触发 Agent | M0 | TASK-021、TASK-022 |
| US-TASK-003 从任务启动 Run | M0 | TASK-023、TASK-030 |
| US-TASK-004 看板拖拽改变状态 | M0 基础拖拽，M1 乐观更新 | TASK-042、TASK-123 |
| US-TASK-005 查看运行轨迹并取消 | M1（M0 仅有取消与事件） | TASK-063、TASK-126、TASK-127 |
| US-TASK-006 验收标准驱动评审 | M1 | TASK-025、TASK-033、TASK-034、TASK-061、TASK-067 |
| US-TASK-007 依赖阻塞 | M2 | TASK-095 至 TASK-099 |
| US-TASK-008 角色 Agent 链路 | M2 | TASK-083、TASK-095、TASK-100 |
| US-TASK-009 搜索与筛选 | M1 | TASK-047、TASK-048、TASK-054 |
| US-TASK-010 批量归档 | M2 | TASK-100、TASK-114、TASK-115 |
| US-TASK-011 编辑冲突 | M2 | TASK-122 |
| US-TASK-012 从失败 Run 创建跟进任务 | M2 | TASK-087 |
| US-TASK-013 Workspace 归属 | M1 | TASK-013、TASK-014 |
| US-TASK-014 离线与服务不可用 | M1 | TASK-139、TASK-121 |
| US-TASK-015 Run 失败、超时与取消 | M1 | TASK-036、TASK-125、TASK-074 |
| US-TASK-016 权限不足 | M3 | TASK-075、TASK-131 |
| US-TASK-017 Webhook 自动创建任务 | M4 | TASK-140、TASK-141 |

### US-TASK-001 快速捕捉任务（M0）

- Given 用户在任意页面，脑中有一个待办想法
- When 用户点击「New task」，只填写标题并提交
- Then 系统创建一个 Backlog 任务，标题去除首尾空格，描述为空，优先级为 0，处理人为空，并立即出现在 Backlog 列顶部
- And 创建动作不会启动任何 Run，不会调用任何 Runtime

### US-TASK-002 Backlog 不触发 Agent（M0）

- Given 一个任务处于 Backlog
- When 用户或自动化尝试为该任务创建 Run
- Then API 返回 409，错误信息明确提示先将任务移动到 Todo 或 In Progress
- And 调度器即使收到该 Run，也会在加载任务后再次校验并失败，不启动 Runtime

### US-TASK-003 从任务启动 Run（M0）

- Given 任务处于 Todo，且已选择 Agent
- When 用户点击 Run
- Then 系统创建状态为 queued 的 Run，把任务处理人写为所选 Agent，将任务从 Todo 转为 In Progress，并通过 WebSocket 广播 run.queued 与 task.updated
- And 详情页自动选中新 Run，展示其实时事件

### US-TASK-004 看板拖拽改变状态（M0 基础，M1 乐观更新）

- Given 任务在 Backlog 列
- When 用户把卡片拖到 Todo 列
- Then 卡片立即移动到目标列（乐观更新），后台发送 PATCH 请求
- And 请求成功后以服务端返回的任务为准更新卡片；请求失败时卡片回滚到原列并显示错误提示

### US-TASK-005 查看运行轨迹并取消（M1）

- Given 任务详情页展示 Run 列表
- When 用户选中一个 queued、preparing 或 running 的 Run 并点击 Cancel
- Then 系统调用取消接口，Run 进入 cancelled，事件流停止追加，任务卡片不再显示活跃 Run 指示
- And 已产生的 RunEvent 保留；Artifact 与 Evidence 的保留策略从 M1 起生效，不因取消而主动删除
- And M0 的验收范围只包括「取消接口生效、RunEvent 可按 seq 读取」；活跃 Run 动画、Artifact 保留与证据聚合属于 M1

### US-TASK-006 验收标准驱动评审（M1）

- Given 任务包含三条验收标准，且最近一次 Run 已完成
- When 评审人打开任务详情页
- Then 页面同时展示验收标准 checklist、Run 的 diff、测试 Evidence 与截图 Artifact
- And 评审人只有在勾选全部必需项或填写豁免理由后，才能点击 Approve；Approve 只记录评审通过，任务保持在 In Review
- And 任务进入 Done 需要合并成功，或评审人显式标记「No merge required」并填写理由；证据缺失或审批未通过时，Done 操作返回 409

### US-TASK-007 依赖阻塞（M2）

- Given 任务 B 的 dependsOn 包含任务 A，任务 A 尚未 Done
- When 用户尝试启动任务 B 的 Run
- Then 系统拒绝启动，任务 B 显示 Blocked 与阻塞原因「等待 A 完成」
- And 当 A 转为 Done 时，B 自动解除阻塞并广播 `task.unblocked`；该事件以 `api-and-data.md` 登记为准，客户端同时可依赖 `task.updated` 的 status 变化

### US-TASK-008 角色 Agent 链路（M2）

- Given 一个设置页需求被拆为 UI Design、Frontend、Backend、DevOps Staging 四个任务
- When 用户启动链路执行
- Then 调度器只执行依赖已满足且状态为 Todo 的任务；Frontend 与 Backend 在 UI Design 完成前保持 Blocked
- And 每个任务只有在其交付物契约要求的 Artifact 与 Evidence 齐全后，才能进入 In Review

### US-TASK-009 搜索与筛选（M1）

- Given 工作区中有 200 个任务
- When 用户输入关键词「login」并筛选 status 为 in_progress
- Then 列表只显示标题、描述或标签命中「login」且状态为 in_progress 的任务；M1 只返回命中列表，不承诺高亮
- And 刷新页面后筛选条件与关键词从 URL 恢复
- And 命中词高亮随 M2 的 SQLite FTS5 引入，属于 M2 验收项，不能作为 M1 的退出门

### US-TASK-010 批量归档（M2）

- Given 用户在列表中多选了 12 个 Done 任务
- When 用户选择批量归档
- Then 系统逐项检查任务是否可归档，成功项从默认视图隐藏，失败项返回原因
- And 归档不会删除 Run、Artifact 或 Evidence，用户可以在「已归档」筛选中恢复
- And 归档 Done 或 Cancelled 任务不会影响依赖满足：已完成任务归档后，下游仍视为依赖已满足，不会被重新阻塞
- And 只有归档未完成任务（backlog、todo、in_progress、in_review、blocked）时，才把仍依赖它的下游任务转为 Blocked，并在确认对话框中列出受影响任务

### US-TASK-011 编辑冲突（M2）

- Given 用户 A 和用户 B 同时打开同一个任务
- When 用户 A 先保存，用户 B 随后用旧版本号保存
- Then 服务端返回 412 `PRECONDITION_FAILED`，用户 B 看到 "This task was changed elsewhere." 以及字段差异
- And 用户 B 可以刷新采用最新版本，或明确选择覆盖并留下审计记录

### US-TASK-012 从失败 Run 创建跟进任务（M2）

- Given 一个 Run 以 failed 结束，错误摘要为「测试未通过」
- When 用户点击「Create follow-up task」
- Then 系统创建一个新任务草稿，自动引用原任务 ID、Run ID、失败摘要和相关 Artifact
- And 新任务默认进入 Backlog，不自动启动 Run

### US-TASK-013 Workspace 归属（M1）

- Given 本地已有至少一个 Workspace，保存仓库路径与 base branch
- When 用户创建任务或为 Backlog 任务补充执行信息
- Then 用户必须选择或确认一个 Workspace；只有一个 Workspace 时系统自动选中
- And 未绑定 Workspace 的任务可以存在于 Backlog，但启动 Run 时返回 409 `WORKSPACE_REQUIRED`，并提示绑定项目
- And 任务详情展示 Workspace 名称、仓库与 base branch，启动 Run 时使用该 Workspace 解析仓库

### US-TASK-014 离线与服务不可用（M1）

- Given 用户已经打开看板，本地服务因重启或崩溃暂时不可用
- When 用户继续浏览已缓存的任务列表或尝试编辑任务
- Then 界面顶部显示离线横幅，说明数据可能过期，读操作保留最后一次成功快照
- And 写操作被明确拒绝并保留用户输入，不进入本地队列，避免恢复后静默覆盖他人修改
- And 服务恢复后横幅自动消失，用户可手动或自动刷新；重连成功后执行一次全量刷新

### US-TASK-015 Run 失败、超时与取消（M1）

- Given 一个任务处于 In Progress，其活跃 Run 因超时、失败或被取消而结束
- When 用户打开任务详情页
- Then 任务保持 In Progress（或按规则转 Blocked），不会自动进入 Done，也不会自动进入 In Review
- And 页面展示结构化失败原因、结束时间与重试入口；重试创建新 Run，不复用原 worktree
- And 任务卡片移除活跃 Run 指示，并显示最近一次 Run 的失败状态摘要

### US-TASK-016 权限不足（M3）

- Given 团队成员以 Viewer 身份打开一个项目内任务
- When 用户尝试编辑任务、改变状态或审批合并
- Then 界面进入只读模式，隐藏或禁用不可用操作，并说明所需角色与申请方式
- And 服务端返回 403 `FORBIDDEN`，不泄露受限字段；审批人不可用时任务显示 "Waiting for approver" 并进入收件箱

### US-TASK-017 Webhook 自动创建任务（M4）

- Given 用户配置了一个启用中的 Webhook，密钥有效
- When 外部系统发送签名正确且未重放的请求
- Then ATeam 返回 202 与 delivery ID，按模板创建一个 Backlog 任务，记录 `trigger=webhook` 与去重键
- And 自动创建的任务不会自动启动 Run、不会自动评审或合并；重复 delivery 只创建一次任务

## 4. 任务对象模型

### 4.1 设计原则

Task 是上下文容器，不是聊天记录。任务描述应说明目标、背景、约束和验收标准，而不是粘贴一段对话。Run 才承载执行过程，包括日志、事件、工具调用和产物。

任务状态描述「工作处于哪个阶段」，Run 状态描述「某次执行进行到哪里」，两者不能混用。一个任务可以有多次 Run，任务状态不应被单次 Run 的结果直接覆盖；Run 完成只产生建议，是否进入 In Review 或 Done 由人工评审或明确配置决定。

任务上的证据是聚合视图，不是副本。Artifact 和 Evidence 归属于 Run，任务详情页按任务聚合展示；删除任务时不得静默删除证据，必须先处理引用关系。

### 4.2 字段定义

下表以当前 Go `domain.Task`、SQLite `tasks` 表和 shared TypeScript `Task` 为准，并标注目标里程碑。

| 字段 | 类型 | 必填 | 说明 | M0 现状 | 计划 |
|---|---|---|---|---|---|
| id | string | 是 | 服务端生成的 24 位十六进制 ID | 已实现，API 不接受客户端指定 | 保持；人可读短编号见 22.2 待确认，不作为实现依据 |
| title | string | 是 | 任务标题，trim 后 1-200 字符 | 已实现非空校验，无长度上限 | M1 增加长度校验 |
| description | string | 否 | 任务描述，纯文本存储，最长 64KB | 已实现可空字符串 | M1 增加长度限制与 Markdown 渲染开关 |
| status | enum | 是 | backlog、todo、in_progress、in_review、done、blocked、cancelled | 已实现七种枚举与合法性校验 | M1 增加服务端流转矩阵 |
| priority | integer | 是 | 0=None、1=Low、2=Medium、3=High、4=Urgent | 已存储，API 接受任意整数，UI 不可编辑 | M1 校验 0-4 并加入创建/编辑表单 |
| assigneeType | enum | 是 | 空字符串、human、agent、crew | 已存储；启动 Run 时写为 agent | M2 校验实体存在；M2 后置 Crew |
| assigneeId | string | 否 | 对应 Human、Agent 或 Crew 的 ID | 启动 Run 时自动写为 Agent ID | M2 支持手动指派与取消指派 |
| parentId | string | 否 | 父任务 ID，用于任务层级，不表达依赖 | 已存储，无外键、无 UI、无校验 | M1 校验存在性、自指与同项目；M2 父子完成规则 |
| labels | string[] | 否 | 任务标签，JSON 数组存储 | 已存储，默认空数组 | M1 去重、长度与数量限制、UI 编辑 |
| createdAt | time | 是 | 创建时间，UTC 存储 | 已实现 | 保持 |
| updatedAt | time | 是 | 最后更新时间，UTC 存储 | 已实现，服务端写入 | 保持 |
| acceptanceCriteria | object[] | 否 | 验收标准 checklist，含文本、完成状态、完成人、完成时间 | 未实现 | M1 |
| dependsOn | string[] | 否 | 依赖任务 ID 的 API 派生字段，由 `task_dependencies` 聚合，不单独存储 | 未实现 | M2 |
| blockedReason | string | 否 | 阻塞原因，人工或系统写入 | 未实现 | M2 |
| archivedAt | time | 否 | 归档/软删除时间，0 表示未删除；唯一字段，不设第二列 | 未实现 | M1 |
| completedAt | time | 否 | 进入 done 的时间，重开时清空；用于周期时间指标 | 未实现 | M1 |
| revision | integer | 是 | 乐观锁版本号，每次成功更新加一；`version` 是弃用输入别名，不进入响应 | 未实现，当前为最后写入覆盖 | M1 启用；冲突返回 409 `STALE_REVISION` |
| createdBy | string | 否 | 创建者标识 | 未实现 | M3 |
| workspaceId | string | M0 否，M1 是 | 所属 Workspace；M1 起 Run 通过它解析本地仓库与 base branch | 未实现 | M1 必填（单 Workspace 模式自动选择）；M3 支持跨项目移动 |
| templateId | string | 否 | 创建任务所用模板的 ID | 未实现 | M2 |
| templateVersionSnapshot | object | 否 | 模板版本快照，包含模板版本号与关键字段副本 | 未实现 | M2 |
| deliverableContract | object | 否 | 交付物契约，含必需产物、证据类型、审批门与执行范围 | 未实现 | M2 |
| boardOrder | integer | 否 | 看板列内手动排序值，仅影响展示 | 未实现 | M2 |

补充约定：

- `dependsOn` 是只读派生字段，唯一事实源是 `task_dependencies` 表；任何写入都必须通过依赖端点，不能直接 PATCH 数组。
- `archivedAt` 是唯一的软删除/归档字段，产品文案称「归档」，API 的 DELETE 也执行归档（软删除）；M1 为确认 + 阻止 + 归档，M2.1 起增加 30 天恢复窗口。不提供第二个 `deletedAt` 字段。
- `revision` 是唯一版本字段；`version` 只是请求输入的兼容别名，响应只返回 `revision`。M1 起按 `If-Match`/`expectedRevision` 启用，冲突返回 409 `STALE_REVISION`；412 仅用于动作前置条件（审批指纹、内容哈希、评审快照）。
- `workspaceId` 在 M1 对应 `prd/milestones/M1-local-loop.md` 的 Workspace 绑定；领域模型文档中的 Workspace 是同一归属概念的上位名称。M0 无 Workspace，任务事实上位于隐式默认项目。
- 模板删除或升级后，任务继续读取 `templateVersionSnapshot`，不因模板变化改变历史任务；模板快照缺失时按空契约处理并提示重建。
- M0 的 `Task` JSON 中 `parentId` 带 `omitempty`，空字符串时可能不出现在响应里；前端类型将其视为可选。M1 起统一返回空字符串或空数组，减少客户端分支。`labels` 在 M0 以 JSON 文本存入 SQLite，读取时解析失败会回退为空数组，这一容错行为应保留。

### 4.3 关联关系

| 关系 | 基数 | 说明 | 里程碑 |
|---|---|---|---|
| Task 与 Workspace | N:1 | 一个任务归属一个 Workspace；Run 通过 Workspace 解析仓库与 base branch | M1 |
| Task 与 Run | 1:N | 一个任务可被多个 Agent 多次执行；Run 记录 agentId、branch、worktree、summary、error | M0 已实现 |
| Task 与 RunEvent | 1:N（经 Run） | 事件按 Run 内的 seq 递增持久化，WebSocket 逐条推送；M0 客户端收到相关事件后全量刷新，M1 改为增量 | M0 已实现 |
| Task 与 Review | 1:N（经 Run） | 评审记录不可变，绑定 Run、评审人、结论、意见与证据快照 | M1 |
| Task 与 Artifact | 1:N（经 Run） | diff、截图、测试报告、构建包等文件产物 | M1 |
| Task 与 Evidence | 1:N（经 Run） | 结构化的完成证明，绑定 Run、commit 与 DoD 条目 | M2（M1 只展示 Artifact，不建 `evidence` 表） |
| Task 与 Comment | 1:N | 补充上下文、讨论与 @提及；评审意见不依赖评论线程 | M2 |
| Task 与 Task（依赖） | N:N | `task_dependencies` 自关联边，默认 finish-to-start；`Task.dependsOn` 只是派生视图 | M2 |
| Task 与 Task（父子） | 1:N | parentId 形成层级，子任务不自动继承状态，也不隐含依赖 | M1 数据校验，M2 规则 |
| Task 与 TaskView | 无关 | 保存视图是查询配置，不拥有任务，也不保存任务 ID 快照 | M2 |
| Task 与 Template | 多对一 | 任务记录 templateId 与不可变的 templateVersionSnapshot | M2 |

### 4.4 优先级语义

`priority` 使用 `PRIORITY_LABELS` 的 0-4 五档。它影响看板列内排序和人的注意力分配，不是硬性 SLA，也不保证调度顺序。M0 的调度器使用先进先出队列，不读取 priority；M2 在并发槽位竞争时可按 priority 降序、createdAt 升序做二次排序，但仍需保证同一依赖链上的任务不被饥饿。

优先级的使用建议：

| 值 | 标签 | 使用建议 |
|---|---|---|
| 0 | None | 默认值，表示尚未评估，不应长期保留在 Todo |
| 1 | Low | 有空再做，可以长期停留在 Backlog |
| 2 | Medium | 常规迭代任务 |
| 3 | High | 阻塞他人或影响演示，应优先进入 Todo |
| 4 | Urgent | 线上问题、数据风险、必须当天处理 |

### 4.5 任务层级与父子规则

M0 仅存储 `parentId`，没有校验、没有 UI、没有级联行为。M1 增加以下约束：父任务必须存在；不能把自己设为父任务；父子关系不得形成环；父任务与子任务必须在同一 Workspace。

M2 增加软规则：父任务进入 Done 前，若仍有未完成的直接子任务，界面显示警告并列出子任务，但不强制阻断，允许用户填写豁免理由后继续。父任务取消时，不自动取消子任务，避免误伤正在进行的工作；用户需要显式选择「同时取消子任务」。

子任务的 `description` 建议引用父任务上下文，但不自动复制父任务全文，避免上下文膨胀。M2 的「从父任务创建子任务」会预填父任务链接、继承标签和项目范围，并把父任务 ID 写入 `parentId`。

### 4.6 Workspace 归属、移动与归档

M1 起每个 Task 必须归属一个 Workspace。Workspace 保存本地仓库路径、remote、默认 base branch、验证命令与 worktree 根目录；没有 Workspace，Run 无法解析仓库，也无法准备 worktree。M0 的任务事实上位于隐式默认项目，升级到 M1 时迁移器创建一个默认 Workspace 并回填所有既有任务的 `workspaceId`。

规则：

- 创建任务时，若本地只有一个活跃 Workspace，创建表单默认选中且不可为空；有多个 Workspace 时必须显式选择。未绑定 Workspace 的任务只能停留在 Backlog，启动 Run 返回 409 `WORKSPACE_REQUIRED`。
- M1 单 Workspace 模式下不提供跨项目移动。M3 团队模式允许多 Workspace，移动任务需要同时满足：任务没有活跃 Run；任务没有跨项目依赖；目标任务属于调用者有权限的 Workspace。移动会记录审计，历史 Run 保留原 Workspace 的仓库与 worktree 快照，新 Run 使用新 Workspace。
- 删除 Workspace 前必须没有未归档任务；仍有任务时返回 409 并列出任务数量，要求先归档或迁移。归档 Workspace 是一个高风险动作：确认后，该 Workspace 下所有任务进入归档（软删除）状态，只读保留；Workspace 恢复后任务不会自动恢复，需要逐个或批量恢复。
- M3 团队模式下，Workspace 删除与归档需要 Owner 或 Admin 权限，并写入审批与审计记录；M1 本机模式仍需二次确认，不能静默级联。
- Workspace 是唯一产品级归属实体：表 `workspaces`、字段 `workspace_id`、默认 ID `default`；`Project`/`projectId` 只是历史称谓与 M1-M2 请求输入别名。领域模型、API 与里程碑均不再保留第二套实体，迁移与查询不得双写。

## 5. 状态机与流转

### 5.1 状态定义

| 状态 | 语义 | 可执行 | M0 看板列 | 进入条件 |
|---|---|---|---|---|
| backlog | 想法或未准备好执行 | 否 | 有 | 新建默认状态 |
| todo | 已具备执行条件，等待 Agent | 是 | 有 | 人确认描述、验收标准、Workspace 和依赖已就绪 |
| in_progress | 已有 Run 正在执行或刚执行完待整理 | 是 | 有 | 启动 Run 时由 todo 自动进入，或人工设置 |
| in_review | 等待人工评审或评审已通过但尚未合并 | 否（M1；M2 返工例外见 5.2） | 有 | Run completed 后按 `auto_move_to_review` 进入（默认开启，可配置关闭），或人工设置 |
| done | 评审通过且合并成功，或显式豁免合并并满足 DoD | 否 | 有 | 评审门 + 合并门同时满足；Approve 本身不进入 done |
| blocked | 被依赖、外部条件或人工标记阻塞 | 否 | 无 | M2 系统自动标记或人工设置 |
| cancelled | 放弃执行 | 否 | 无 | 人工取消 |

M0 已实现七种状态的枚举和合法性校验，`TaskStatus.Executable()` 明确把 todo、in_progress、in_review 视为可执行。M0 的看板只渲染五种状态列，`blocked` 与 `cancelled` 虽然在 API 和状态徽章中支持，但没有列、没有筛选入口，因此这两类任务在看板上不可见。这是当前实现的明确缺口，M1 必须修复。

### 5.2 流转矩阵

M0 的 PATCH 接口只校验目标状态是否合法，不限制从哪个状态转来，因此任意两种合法状态之间都可以互转；看板拖拽和详情页下拉同样没有矩阵约束。M1 起由服务端强制执行下表规则，前端只展示允许的目标状态。

| 当前状态 | 允许流转到 | 触发方式 | 约束 |
|---|---|---|---|
| backlog | todo、blocked、cancelled | 人工或系统标记阻塞 | 进入 todo 前通过 DoR 检查：标题、描述、验收标准、Workspace、依赖、处理方式至少明确一项执行策略；归档未完成上游时，下游可从 backlog 进入 blocked |
| todo | in_progress、backlog、blocked、cancelled | 人工或启动 Run | 启动 Run 自动进入 in_progress；退回 backlog 由用户显式操作 |
| in_progress | todo、in_review、blocked、cancelled | Run 完成、人工重新排队、人工评审打回或人工设置 | 由 Run completed 按 `auto_move_to_review` 触发，或人工设置并记录说明；回到 todo 需先无活跃 Run |
| in_review | in_progress、done、blocked、cancelled | 人工评审、合并或打回 | 进入 done 必须同时满足评审门与合并门；Request changes 回到 in_progress |
| blocked | todo、in_progress、in_review、cancelled | 人工或依赖解除 | 解除时按阻塞来源恢复：依赖阻塞回 todo，人工阻塞由用户选择；阻塞前处于 in_review 时允许恢复到 in_review |
| done | todo | 人工重开（M2） | 需要二次确认并填写原因；重开清空 completedAt，不删除历史 Run 与评审 |
| cancelled | backlog | 人工重开（M2） | 需要二次确认并填写原因；重开后回到 Backlog，不恢复 Run |

补充规则：

- 本表与 `02-domain-model.md` §4.2、`api-and-data.md` 13.1 保持一致，是唯一实现口径。M1 起服务端对非法迁移返回 `409 INVALID_STATUS_TRANSITION`，details 中列出当前状态允许的目标状态。
- 重开语义统一：`done → todo`（M2），`cancelled → backlog`（M2）；不存在 `done → in_progress` 的独立路径。`in_progress → todo` 只允许在无活跃 Run 时人工重新排队。
- `in_review → blocked` 由系统在依赖或不可恢复外部阻塞出现时使用，并必须记录 `blockedReason`；人工打开 blocked 同样允许。
- M1 不允许从 `in_review` 创建新 Run；M2 的返工必须先创建新 Review 或记录「取代旧评审」的原因，旧 Review 置为 `superseded`。
- 归档不是状态，而是 `archivedAt` 归档字段（软删除复用同一字段）。归档任务保留原状态，但从默认看板、列表、搜索和依赖可执行计算中排除。
- 归档已完成（done）任务时，依赖它的下游任务仍视为依赖已满足；归档已取消（cancelled）任务时，下游维持原有未满足/阻塞状态，不因归档而改变，也不把 cancelled 当作完成。只有归档未完成任务时，才把仍依赖它的下游任务转为 blocked，并提示「依赖任务已归档」。
- 评审通过（Approve）不改变任务状态，任务保持 in_review；只有合并成功或显式「No merge required」豁免才允许进入 done。

### 5.3 核心规则

R1：Backlog 永不触发 Agent。API 在 `POST /api/tasks/{id}/runs`（M0）或 `POST /api/v1/tasks/{id}/runs`（M1 起）处校验并返回 409；调度器在执行前再次校验，防止任务在排队期间被移回 Backlog。两道防线都必须保留，不能只依赖前端置灰按钮。

R2：可执行判定由服务端负责。M0 的判定是状态属于 todo、in_progress、in_review；M1 收紧为 todo、in_progress；M2 扩展为「状态可执行、`finish_to_start` 依赖的上游 done、`required_artifact_kinds` 齐备、`required_contracts` 已冻结、无人工阻塞、无活跃 Run 冲突、处理 Agent 可用」。M2 不实现 `artifact_ready` 或 `approval` 独立依赖边。前端只做展示，不作为最终依据。

R3：启动 Run 的副作用要原子化。当前实现先创建 Run，再更新任务处理人与状态，再广播事件，最后异步入队。M1 应把「检查可执行、创建 Run、更新任务、写入事件」放入同一事务或补偿流程，避免出现 Run 已创建但任务状态未更新的中间态。

R4：Run 完成不等于任务完成。M1 起，Run completed 后是否自动进入 in_review 由 `auto_move_to_review` 配置决定，**默认开启**（自动进入 in_review，与 TASK-024 一致）；关闭后任务保持 in_progress，由人手动移入评审。无论配置如何，系统都绝不自动进入 done。Run failed、cancelled 或超时则不自动进入 in_review：任务保持 in_progress 或转为 blocked，详情页展示失败原因与重试入口。

R5：Done 必须同时通过评审门与合并门。评审门要求存在针对最近一次 Run 的人工 Approve，且必需 Artifact 齐备或带理由人工例外（M2 起为必需 Evidence 全部 `passed` 或 `waived`）；合并门要求该 Run 已成功合并进目标分支，或任务被显式标记「No merge required」并填写理由（仅适用于设计、文档、研究等不产生合并的任务）。Approve 只记录评审通过并让任务保持 in_review，不直接改变任务状态；M2 起 Approve 还必须满足交付物契约中的必需 Evidence。

R6：Blocked 不是队列。被阻塞任务不得进入调度队列。M2 的调度器在依赖全部完成时才重新计算可执行性，并按需触发 task.unblocked 事件；是否自动启动由任务的 autoRun 开关决定，默认关闭。

R7：Cancelled 是终态，但允许重新打开。取消任务时必须取消其活跃 Run；重新打开只在 M2 提供，且需要记录原因和操作者，重开目标固定为 backlog。

R8：同一任务的并发 Run 默认受控。M0 没有限制，用户可以连续点击 Run 创建多个 Run；M1 默认只允许一个活跃 Run（queued、preparing、running），超出返回 409；M2 允许通过任务级 `parallelRunPolicy` 显式放开，但必须显示风险提示。该默认值已拍板，不再作为待确认项。

R9：状态变更必须广播。所有成功变更都通过 WebSocket 广播 `task.updated`；M2 起事件携带 `revision`，客户端据此判断是否需要刷新或提示冲突。M1 的事件不携带 revision，客户端以 `updatedAt` 与事件内容为准。

R10：M0 的宽松行为必须显式标注。在 M1 上线流转矩阵前，文档、演示和销售材料不得声称 ATeam 已具备状态机治理能力。

R11：评审门与合并门是两个独立检查点。评审记录（Review）回答「改动是否可以接受」，合并门回答「改动是否已经进入目标分支」。两者可以由同一个本地用户操作，但必须分别记录，不能用一个 Approve 同时完成两个语义。只有合并门通过后，任务才允许进入 done；合并失败或冲突时任务保持 in_review 或转 blocked。

R12：归档必须区分任务状态。归档 done/cancelled 任务只影响可见性，不改变依赖满足关系；归档未完成任务才可能阻塞下游。任何归档操作都必须展示受影响的下游任务清单，并在恢复时重新计算依赖。

### 5.4 守卫与副作用

进入 Todo 的 DoR 检查建议包含：标题清晰；描述包含目标与范围；至少一条验收标准；Workspace 已绑定；依赖已列出；处理方式明确（人工执行或指定 Agent）；若为角色链路任务，交付物契约已选择模板。检查结果以提示为主，M1 不强制阻断，避免早期用户被流程卡住；M2 团队模式可配置为强制。

进入 Done 的检查包含两个独立部分。评审门：最近一次 Run 为 completed；M1 检查必需 Artifact 齐备或有人工例外理由，M2 起检查必需 Evidence 全部 `passed` 或 `waived`；验收标准全部勾选或有豁免理由；无未解决的 Request changes；存在人工 Approve 记录。合并门：涉及代码变更的任务必须已完成合并，且合并绑定评审记录与 head commit；不涉及合并的任务必须显式标记「No merge required」并填写理由。任一条件不满足时，Done 操作返回 409 并列出缺口；任务保持 in_review。

状态变更后的副作用包括：写入 task_events（M2）；广播 `task.updated`；重新计算依赖该任务的下游任务可执行性（M2）；更新看板列计数；刷新任务详情页；若任务被阻塞或解除阻塞，分别广播 `task.blocked` 与 `task.unblocked`（M2，事件名以 api-and-data 登记为准）。进入 done 时写入 `completedAt`；从 done 重开时清空 `completedAt` 并保留历史评审与合并记录。

## 6. 看板与视图

### 6.1 看板结构

M0 看板由 `TASK_STATUSES` 驱动，渲染 Backlog、Todo、In Progress、In Review、Done 五列。每列宽度固定 256 像素，支持横向滚动；列头显示状态名称、该列任务数量和一行提示文案；列体是纵向滚动的虚线边框容器。空列显示 EmptyState 组件，文案为 "No tasks / Drag a card here or create a new one"。

M1 起看板必须让七种状态都可被找到：五个主列加一个可折叠的 "Blocked / Cancelled" 辅助区，或按用户设置在 Blocked、Cancelled 作为独立列之间切换。M1 默认采用可折叠辅助区，避免七列横向过宽；具体呈现形式的最终选择列入第 22 章待确认项，但无论采用哪种形式，TASK-031 的可见性验收都必须在 M1 通过。

界面语言约定：M0 实现的可见文案为英文，本章引用 UI 文案一律保留英文原文，中文只用于解释语义；M1 起建立统一文案表，新增文案必须同时给出英文 key 与中文说明，不得在代码或 PRD 中混用两种语言的用户可见字符串。

列顺序应可配置。默认顺序为 Backlog、Todo、In Progress、In Review、Done；Blocked 放在 In Review 之后、Done 之前更符合评审视角，Cancelled 放在最右侧折叠区。M2 的保存视图可以保存列顺序与列可见性。

### 6.2 任务卡片

M0 卡片显示标题、描述前两行、状态徽章、优先级文本和任务 ID 前四位。卡片支持点击打开详情，支持 HTML5 拖拽。

M1 卡片信息扩展为：标题；描述摘要两行；状态徽章；优先级；标签最多三个，超出显示加号计数；处理人头像或 Agent 名称；活跃 Run 指示（queued、preparing、running 分别使用不同动画或颜色）；最近更新时间；阻塞图标与原因摘要。卡片必须保持紧凑，详情信息放在悬浮面板或详情页，避免卡片变成小型报表。

M2 卡片增加交付物契约完成度指示，例如 "Evidence 2/4"，以及审批门状态，例如 "Awaiting merge"。这些指示只在任务进入 In Review 后显示，避免 Todo 阶段信息过载。

### 6.3 拖拽与列内排序

M0 拖拽在 drop 时直接 PATCH 状态，没有乐观更新、没有失败回滚、没有非法目标提示。M1 目标行为：拖拽开始显示拖拽预览和可放置列高亮；放置时先本地移动卡片并记录原位置；发送 PATCH；成功以服务端响应覆盖本地状态；失败则回滚并显示 toast；若目标状态不在流转矩阵允许范围内，放置时直接回弹并提示原因。

列内排序 M0 按任务在数组中的顺序，实际由 `ListTasks` 的 createdAt 降序决定，拖拽不会保存顺序。M1 默认按 priority 降序、updatedAt 降序；M2 提供手动排序并把 `boardOrder` 持久化（TASK-058），但手动排序只影响同列展示，不改变任务语义与依赖关系。

WIP 限制属于 M2 可选能力：列头可设置最大任务数，超出时列头变黄并提示，但不强制阻断创建，避免用户被工具卡住。

### 6.4 列表视图

M1 增加列表视图，适合任务数量超过一屏或需要批量操作的场景。列包括：选择框、标题、状态、优先级、处理人、标签、父任务、最近 Run 状态、更新时间。列表支持列宽调整、列显示隐藏和行内状态修改。

列表与看板共享同一套筛选、搜索、排序和保存视图配置。用户在两个视图之间切换时，查询条件保持不变。M2 的批量操作只在列表视图提供，看板多选作为补充入口。

### 6.5 筛选、搜索与排序

| 维度 | 操作符 | 说明 | 里程碑 |
|---|---|---|---|
| status | 等于、属于集合 | 支持多选七个状态 | M1 |
| priority | 等于、大于等于、范围 | 0-4 | M1 |
| assigneeType | 等于 | human、agent、crew、未指派 | M1 |
| assigneeId | 等于 | 按具体 Agent 或人筛选 | M1 |
| label | 包含任一、包含全部 | 标签多选 | M1 |
| parentId | 等于、为空 | 查看某父任务的子任务 | M1 |
| hasActiveRun | 是、否 | 是否存在 queued、preparing、running 的 Run | M1 |
| archived | 排除、仅归档、包含 | 默认排除归档 | M1 |
| createdBy | 等于 | 团队模式按创建人筛选 | M3 |
| workspaceId | 等于 | 团队模式按项目筛选 | M3 |

搜索语义：M1 使用大小写不敏感的包含匹配，覆盖 title、description、labels 和任务 ID；关键词按空白拆分后取交集；搜索结果按 updatedAt 降序。M2 在任务量超过一万时启用 SQLite FTS5 虚拟表，提供更快的全文检索和简单高亮，但 API 语义保持不变。M3 团队模式在 Postgres 上使用 trigram 或全文索引。

排序字段包括 createdAt、updatedAt、priority、title。默认排序为 createdAt 降序；看板列内默认 priority 降序、updatedAt 降序。排序必须稳定，相同排序值以 id 作为最终 tie-breaker，避免刷新后顺序跳动。

筛选、搜索、排序和视图类型必须写入 URL query，例如 `?view=board&status=todo,in_progress&q=login&sort=priority`。刷新页面、复制链接、浏览器前进后退都应恢复相同视图。M2 的保存视图在此基础上增加名称和作用域。

### 6.6 保存视图

保存视图的数据结构包括：id、名称、视图类型（board 或 list）、筛选条件 JSON、排序、列配置、作用域（personal 或 team）、创建者、创建时间、更新时间。M2 支持个人视图，M3 支持团队共享视图并受权限控制。

保存视图的原则：视图只保存查询，不保存任务 ID 快照；视图不成为任务的新归属地；删除视图不影响任务；团队视图的修改需要记录审计。用户可以把当前筛选「另存为视图」，也可以把视图设为默认首页。

### 6.7 实时性与性能

M0 的 WebSocket 客户端在收到任意 `task.*`、`agent.*`、`run.*` 事件后触发对应 store 的全量刷新。任务量较小时可接受，任务量增大后会造成明显抖动和带宽浪费。M1 改为增量处理：`task.created` 插入列表、`task.updated` 按 id 替换、`task.deleted` 按 id 移除；只有检测到事件缺口或重连后才执行全量刷新。

性能预算：1,000 个任务时看板首次加载 P95 小于 500ms；筛选或搜索响应小于 300ms；拖拽本地反馈小于 16ms，服务端往返 P95 小于 200ms；WebSocket 事件到卡片更新 P95 小于 300ms。上述指标在本地 SQLite 环境下测量，M3 团队模式需要重新标定。

## 7. 任务详情页

### 7.1 信息架构

| 区域 | 内容 | M0 现状 | 目标 |
|---|---|---|---|
| 头部 | 任务 ID、状态徽章、标题、状态切换、返回看板 | 已实现，状态下拉仅五个选项 | M1 增加优先级、处理人、标签、Workspace、更多操作菜单 |
| 描述 | 任务描述全文 | 已实现纯文本展示，不可编辑 | M1 内联编辑，Markdown 渲染可选 |
| 验收标准 | checklist、完成状态、完成人、完成时间 | 未实现 | M1 |
| 依赖 | dependsOn 列表、阻塞原因、DAG 入口 | 未实现 | M2 |
| Run 列表 | Run 状态、trigger、时间、summary、error | 已实现，默认选中最近一次 | M1 增加筛选和分页 |
| Run 日志 | RunEvent 文本流、取消按钮 | 已实现，1.5 秒轮询 | M1 改为 WebSocket 增量并支持搜索 |
| Diff | 变更文件、行级 diff、按文件折叠 | 未实现 | M1 只读 diff；行内评论 M2 |
| Artifact | 截图、报告、构建产物、下载与预览 | 未实现 | M1 |
| Evidence | DoD 条目、通过状态、来源命令、commit | 未实现 | M2（M1 详情页只展示 Artifact 与 DoD 清单，不提供 Evidence 实体） |
| 评审 | Approve、Request changes、评审意见、评审历史 | 未实现 | M1 使用独立 Review 记录，不依赖评论线程 |
| 合并 | 目标分支、commit、策略、合并确认与结果 | 未实现 | M1 合并对话框与合并门；M2 审批记录 |
| 评论 | Markdown 评论、@提及、引用 Run | 未实现 | M2 |
| 活动 | 状态变更、字段变更、评审记录 | 未实现 | M2 轻量，M3 完整审计 |

### 7.2 Run 区域交互

M0 的 Run 区域包含 Agent 选择器、Run 按钮、Run 列表和选中 Run 的日志。Agent 选择器默认选中 Agent 列表中的第一个；Run 按钮在任务不可执行或未选择 Agent 时置灰；不可执行时显示「Move the task to Todo or In Progress before starting a run.」。日志区域每 1.5 秒轮询一次，仅在存在活跃 Run 时刷新。

M1 改进：Run 列表显示 trigger（manual、retry，M2 增加 dependency、crew，M4 增加 schedule、webhook）、分支、worktree 摘要、耗时；支持按状态筛选；支持重试失败 Run；支持从 Run 创建跟进任务；日志区域使用虚拟滚动，支持按事件类型过滤和关键词搜索；取消按钮需要二次确认，避免误触。

Run 与任务的关系必须明确：Run 是任务的子资源，任务详情页负责聚合展示，但 Run 的调度、取消、超时和工作区细节由 Run 模块负责。任务模块不直接操作 worktree 或 Runtime 进程。

### 7.3 评审区域

M1 的评审区域包含四个部分：DoD 核对、变更审阅、评审结论、合并操作。DoD 核对列出任务类型要求的 Artifact 与人工例外理由（M2 起改为列出 Evidence）；变更审阅展示 diff 摘要、测试结果、截图；评审结论提供 Approve 与 Request changes，必须填写意见；合并操作在评审通过后启用，展示目标分支、源分支、head commit、合并策略与风险提示。

评审记录字段包括：评审人、结论（approve、changes_requested、comment）、意见、关联 Run ID、关联 commit、证据快照哈希、时间。M1 的评审人是本地用户标识 `local`；M3 接入账号体系后使用真实成员 ID。评审记录不可编辑，只能追加新记录；同一评审人对同一 Run 的多次结论按时间取最新有效结论。Agent 不能代替人做最终 Approve；Agent 可以生成评审摘要和建议，但按钮只能由人点击。

状态语义必须严格区分：点击 Approve 只写入一条 approve 评审记录，任务保持 In Review；点击 Request changes 写入 changes_requested 记录，任务回到 In Progress；只有合并成功（`POST /api/v1/runs/{id}/merge`）或显式提交「No merge required」豁免后，任务才进入 Done。M1 不依赖评论线程承载评审意见：意见直接存于 Review 记录，通过 task_events 与评审历史展示；评论线程与 diff 行内评论属于 M2，不能作为 M1 评审的前置依赖。

Request changes 后，后续 Run 的日志与 diff 需要能够关联到「针对上一轮意见」；M1 通过评审记录 ID 与 Run 的先后关系建立引用，M2 再提供评论引用与行内标注。同一任务可以多轮评审，历史记录全部保留。

### 7.4 详情页状态与实时更新

M0 详情页在加载时先显示占位文案，数据到达后渲染头部与描述，Run 数据到达后渲染 Run 区域；没有骨架屏，存在短暂布局跳动。M1 改为头部、描述、Run 三个骨架区块（TASK-137）。任务不存在时显示 "Task not found" 和返回看板按钮；无权限时 M3 显示申请权限入口。

实时更新策略：任务字段变更通过 `task.updated` 增量更新；Run 列表变更通过 `run.*` 事件增量更新；RunEvent 通过 `run.event` 追加。若事件序号出现缺口，或是重连后的第一次消息，则触发一次全量刷新。编辑中的字段不被远端更新覆盖，界面提示 "This field was updated elsewhere."，用户确认后再合并。

## 8. 新建任务、Agent 创建与模板

### 8.1 快速创建（M0 已实现）

M0 的创建弹窗只包含 Title、Description、Status 三个字段。Title 必填，提交时前端检查非空，服务端再次检查 trim 后非空；Status 默认 Backlog；创建成功后弹窗关闭，卡片以 createdAt 降序出现在对应列。M0 没有优先级、标签、处理人、父任务、验收标准字段。

快速创建的原则是低摩擦：用户可以在 5 秒内记录一个想法，之后再完善。M1 保留快速创建，同时提供「更多字段」展开区域，不需要用户进入完整表单。

### 8.2 完整创建（M1）

完整创建表单包含：标题、描述、状态、Workspace、优先级、标签、处理人、父任务、验收标准、依赖（M2）、交付物模板（M2）。表单采用分区布局：基本信息、执行设置、验收与证据。保存后停留在详情页，便于继续补充上下文。

Workspace 字段在 M1 为必填：只有一个活跃 Workspace 时默认选中，有多个时必须选择。未绑定 Workspace 的草稿可以保存，但状态只能是 Backlog，且 Run 按钮显示 "Bind a project before starting a run"。

校验规则与第 4 章字段定义一致。表单需要支持草稿自动保存到本地，避免误关闭导致内容丢失；草稿不写入服务端，M1 使用浏览器本地存储。M2 的 Agent 创建任务也复用该表单进行人工确认。

### 8.3 用 Agent 创建任务（M2）

用 Agent 创建任务的流程必须保证「Agent 只生成草稿，人负责决策」：

1. 用户在创建入口选择「Let an Agent draft this task」，输入一段自然语言需求。
2. 系统调用一个只读的任务起草 Agent 配置，要求输出结构化 JSON，包含标题、描述、建议验收标准、建议标签、建议处理 Agent、建议依赖、风险提示。
3. 系统对 JSON 做 schema 校验；不合法的输出直接展示原始文本并要求用户重试，不写入任务表。
4. 用户在完整创建表单中看到预填内容，可以逐项修改。
5. 用户点击创建后，任务以 Backlog 状态写入；Agent 不能自动创建任务，也不能自动启动 Run。
6. 草稿生成过程消耗的 Runtime 调用与普通 Run 一样记录来源和成本，但不产生任务对应的 Run，也不修改工作区。

M2 的任务起草 Agent 需要具备结构化输出能力；若用户选择的 Runtime 不支持结构化输出，系统回退为「生成一段文本，用户手动复制到表单」，并在界面说明原因。

### 8.4 快捷模板（M2）

模板用于把高频任务类型的字段、验收标准、交付物契约和证据要求固化，减少重复填写，同时保证角色链路的一致性。内置模板至少包含：

| 模板 | 预填内容 | 交付物契约 | 必需 Evidence |
|---|---|---|---|
| UI Design | 设计目标、目标用户、约束、相关页面 | 设计说明、关键界面截图、组件与 token 变更说明、可访问性检查 | 截图、设计说明链接、评审通过记录 |
| Frontend | 页面与组件范围、依赖的 UI 设计任务、浏览器矩阵 | diff、组件测试、lint 与类型检查结果、截图对比 | 测试输出、lint 输出、截图 |
| Backend | API 契约、数据模型、迁移要求、兼容性约束 | diff、单元与集成测试、迁移脚本、API 变更说明 | 测试输出、迁移验证记录、API 文档变更 |
| DevOps Staging | 目标环境、staging 配置、回滚方案 | 部署计划、staging 验证记录、回滚步骤 | 部署日志、健康检查结果、人工确认记录 |
| Bugfix | 复现步骤、期望行为、影响范围 | 修复 diff、回归测试、复现验证 | 复现失败截图、回归测试输出 |
| Feature | 用户故事、验收标准、边界条件 | 功能 diff、测试、文档更新 | 测试输出、验收 checklist |

模板字段包括：名称、适用角色、默认标签、默认优先级、描述骨架、验收标准骨架、交付物契约、证据要求、允许的路径与命令建议、版本号。任务创建时记录 `templateId` 与 `templateVersionSnapshot`；模板后续升级或删除不改变既有任务。M2 模板由用户手动创建和编辑；M3 支持团队共享和只读内置模板。

DevOps 模板有一个硬约束：M2 只能创建 staging 部署任务和部署计划任务，prod 部署任务只能生成计划，执行必须由人完成。模板不得预填任何自动执行 prod 的命令。

### 8.5 从 Run 创建跟进任务

当 Run 失败、被取消或产生遗留问题时，详情页提供 "Create follow-up task"。新任务自动填充：标题为 "Follow up: <original title>"；描述包含原任务链接、Run 链接、错误摘要或问题摘要；标签继承原任务；父任务可选为原任务；优先级默认为原任务优先级；状态为 Backlog。

该能力属于 M2，但数据结构在 M1 就可以预留引用字段。跟进任务不自动继承原任务的 Run 或 Artifact，只保留引用关系，避免证据归属混乱。

## 9. 任务依赖 DAG（M2）

### 9.1 数据语义

任务依赖使用自关联边表 `task_dependencies` 作为唯一事实源：`task_id`、`depends_on_task_id`、`type`、`required_artifact_kinds`、`created_at`，主键为 `(task_id, depends_on_task_id)`。字段名为 `type`（早期草案称 `kind`，已弃用）。M2 仅支持 `finish_to_start` 一种依赖边，以 `02-domain-model.md` §3.3、`collaboration-and-review.md` §6.1/COLLAB-020 与 M2 §7.2 为准；产物就绪通过任务属性 `required_artifact_kinds` 表达，不设 `artifact_ready` 独立边；审批通过 `required_contracts`（契约冻结）与审批门表达，不设 `approval` 独立边。不支持 `start_to_start` 等时间型依赖；若未来引入，必须单独设计并扩展 `type` 枚举，不得在 M2 悄悄扩展语义。`Task.dependsOn` 只是读取时由边表聚合出的派生数组，不是独立存储；任何写入都必须经过 `PUT /api/v1/tasks/{id}/dependencies`，不允许 PATCH `dependsOn` 数组。

约束：依赖必须指向存在的任务；不能依赖自己；不能形成环；同一对任务只能有一条边；单个任务的直接依赖上限为 50 条；依赖两端必须在同一 Workspace 内；归档任务不能作为新增依赖的目标，已有依赖按第 12 章规则处理。禁止同时保留 `tasks.depends_on` 列与 `task_dependencies` 表；M2 迁移只创建边表，不创建冗余列。

### 9.2 可执行判定

M2 的任务可执行判定在 M0 基础上扩展为以下全部条件：

- 任务状态属于 todo、in_progress（M1 起不再包含 in_review；M2 返工例外见 5.2）。
- 所有 `finish_to_start` 依赖的上游任务状态为 done；任务属性 `required_artifact_kinds` 列出的 Artifact 类型已由上游产出并通过校验；`required_contracts` 引用已冻结且版本匹配。
- 没有人工设置的阻塞标记。
- 若任务已指派 Agent，该 Agent 存在且未被禁用。
- 若任务级 `parallelRunPolicy` 为 single，则不存在 queued、preparing、running 的 Run。
- 若任务开启了 autoRun，则其指纹（任务版本号加依赖版本）未被执行过，避免重复自动触发。

判定结果分为三种：可执行、等待依赖、被阻塞。等待依赖是系统可自动解除的，被阻塞需要人工处理或依赖解除。界面必须展示判定原因，而不是只把 Run 按钮置灰。

### 9.3 阻塞与解除

依赖未满足时，系统把任务标记为 blocked，并写入 blockedReason，例如 "Waiting for TASK-102 (UI Design)"。当所有依赖满足时（`finish_to_start` 上游 done 且 `required_artifact_kinds` 齐备），系统做三件事：重新计算可执行性；把 blockedReason 清空；若任务在阻塞前处于 todo，则恢复为 todo；若在阻塞前处于 in_progress 且没有活跃 Run，则由用户确认是否恢复。

人工阻塞与依赖阻塞共用 blocked 状态，但原因字段区分来源。人工阻塞不会因依赖完成而自动解除；依赖阻塞在依赖满足后自动解除。解除阻塞时广播 `task.unblocked`，payload 包含任务、原因和新的可执行性。

### 9.4 DAG 可视化与编辑

M2 提供只读 DAG 视图和受限编辑。节点显示任务标题、状态、角色、处理人；边显示依赖类型；阻塞路径高亮显示。用户可以在详情页添加或删除直接依赖，提交前系统检测环并展示将要影响的下游任务数量。

DAG 视图不替代看板，它是任务详情的一个页签或抽屉。大图采用分层布局，支持缩放和搜索定位；超过 200 个节点的图默认折叠非相关节点，避免浏览器卡顿。

### 9.5 删除、归档与依赖保护

删除或归档被其他任务依赖的任务时，必须二次确认，并列出所有直接和间接下游任务。任务没有硬删除入口；删除动作在 M1 就是软删除（归档）。归档时按被归档任务的状态区分处理：

- 被归档任务为 done：依赖满足关系不变，下游任务仍视为已满足，不被阻塞。
- 被归档任务为 cancelled：依赖本就不可满足，下游维持原有阻塞状态；归档不改变状态，也不把 cancelled 当作完成。
- 被归档任务为 backlog、todo、in_progress、in_review 或 blocked：依赖不再可能自动满足，所有仍依赖它的下游任务转为 blocked，`blockedReason` 指向归档任务，并提示「依赖任务已归档」。
- 恢复归档任务时，系统重新计算依赖；原本因它阻塞的下游任务在依赖满足后自动解除阻塞，但不会自动启动 Run。

M2 不自动级联删除依赖边之外的数据。归档任务保留依赖边、Run、Artifact 与 Evidence；若用户希望彻底移除依赖，必须显式删除依赖边。硬删除任务只在 M3 之后的受控清理流程中存在，且需要审批与审计。

### 9.6 调度器集成

调度器在执行 Run 前必须重新读取任务、依赖和 Agent 状态，不能信任创建 Run 时的快照。任务在队列中等待期间可能被阻塞、取消或改派，调度器需要再次校验并在不满足时失败该 Run，错误信息写入 Run.error。

依赖完成事件由任务状态变更触发。M2 的调度器订阅 `task.updated` 或直接查询待解除任务；为避免惊群，按项目或工作区分批处理。autoRun 默认关闭，开启后也只对显式标记的任务生效，并且同一依赖链在同一时间只允许一个自动 Run。

## 10. 角色 Agent 协作与交付物契约（M2）

### 10.1 协作模型

角色 Agent 协作不是把 UI Design、Frontend、Backend、DevOps 放进同一个会话自由聊天，而是把协作关系显式建模为任务 DAG。每个角色 Agent 只负责一个任务或一组同角色子任务，任务之间的输入输出通过交付物契约连接，完成与否由证据判定。

以「新增设置页」为例：

| 任务 | 角色 Agent | 依赖 | 交付物 | 必需 Evidence | 审批门 |
|---|---|---|---|---|---|
| T1 设置页 UI 设计 | UI Design | 无 | 设计说明、页面截图、组件与 token 变更 | 截图、设计评审记录 | 人工确认设计通过 |
| T2 设置页后端 API | Backend | T1 | diff、API 契约、迁移脚本、集成测试 | 测试输出、迁移验证 | 人工评审 |
| T3 设置页前端实现 | Frontend | T1 | diff、组件测试、截图对比 | 测试输出、lint 输出、截图 | 人工评审 |
| T4 staging 部署验证 | DevOps | T2、T3 | 部署计划、staging 验证记录、回滚步骤 | 部署日志、健康检查 | 人工批准 staging 操作 |
| T5 prod 部署 | DevOps（仅计划） | T4 | prod 部署计划与风险清单 | 人工执行记录 | 必须人工执行，Agent 不得执行 |

这张表体现了三个原则：依赖方向清晰；每个任务有可检查的交付物；高风险动作有审批门。Agent 之间不需要互相「聊天」，它们通过任务状态和产物交接。

### 10.2 交付物契约字段

交付物契约的唯一实体是 Deliverable（表 `deliverables`），版本历史在 `contract_versions`；`Task.deliverableContract` 是当前版本的投影，`Task.contract` 是待弃用别名，不得作为第二份事实来源。契约 JSON 的字段如下（M2 建独立表并冻结版本，不在 Task 行内存放唯一副本）。

| 字段 | 类型 | 说明 |
|---|---|---|
| deliverables | array | 交付物列表，每项包含 type、required、pathGlob、description |
| type | enum | diff、test_report、screenshot、design_spec、deploy_plan、build_artifact、doc |
| required | boolean | 是否必须存在，缺失时阻止进入 In Review 或 Done |
| pathGlob | string | 产物在工作区或 Artifact 存储中的路径模式 |
| evidenceRequirements | array | 证据类型与最低要求，例如单元测试必须通过 |
| approvalGates | array | 审批门列表，包含动作、审批角色、是否需要本人执行 |
| executionScope | object | 任务级执行范围建议，包含 allowedPaths 与 allowedCommands；创建 Run 时与 Agent 权限求交集 |
| reviewPolicy | enum | human_required、human_or_auto；只控制「Run 完成后是否允许自动进入 in_review」，不控制 Done。Done 永远是 human_required |

`reviewPolicy` 的语义必须严格限定：它只决定 Run 完成后的预评审流转，`auto_allowed` 已删除，因为任何自动判定都不能替代 Done 前的人工确认。即使 `reviewPolicy=human_or_auto`，任务也最多自动进入 in_review，Approve 与合并仍必须由人完成。

`executionScope` 是任务侧权限来源：模板可以预填路径与命令建议，用户在创建任务时可以收窄但不能扩大 Agent 的上限。创建 Run 时，实际执行范围 = Agent.allowedPaths ∩ executionScope.allowedPaths，命令同理；交集为空时拒绝启动并返回 `403 POLICY_DENIED`，details 指出是路径还是命令为空，以及如何调整任务或 Agent。任务描述、评论或 Artifact 中的路径提示不能扩大该范围。

契约由模板预填，用户可以在创建任务时调整。契约变更视为任务范围变更，M2 记录在 task_events 中；若任务已有 Run，变更后需要重新评审。

### 10.3 各角色 DoD

| 角色 | 必需交付物 | 必需证据 | 禁止动作 |
|---|---|---|---|
| UI Design | 设计说明、关键界面截图、组件与 token 变更说明 | 截图、设计评审通过记录 | 直接修改业务代码、执行部署 |
| Frontend | 代码 diff、组件测试、截图对比 | 测试通过、lint 与类型检查通过 | 修改后端迁移、执行 prod 部署 |
| Backend | 代码 diff、API 契约、迁移脚本、集成测试 | 测试通过、迁移验证、接口兼容性说明 | 修改前端视觉、执行 prod 部署 |
| DevOps | 部署计划、staging 验证记录、回滚步骤 | 部署日志、健康检查结果、人工确认 | 执行 prod 部署（无论是否经过审批）、合并代码 |
| Crew/队长（M2 后置） | 子任务 DAG、分派记录、汇总报告 | 子任务证据汇总、依赖满足情况 | 代替子 Agent 产出代码、绕过审批门 |

DoD 不是固定文案，而是任务类型、模板和用户配置的组合。M2 的默认模板提供上述基线，用户可以在模板上增加证据要求，但不能删除「prod 必须人工执行」这类系统级约束。

### 10.4 审批门规则

必须人工审批的动作包括：合并代码、推送远端、部署到 staging、删除有历史的任务或 Workspace、批量归档超过阈值、修改团队级模板或权限。M1 实现合并门、归档/删除确认门和「No merge required」豁免；M2 实现 staging 部署审批与部署计划审批；M2.1 实现 push 审批记录（只创建/消费审批，不执行远程 push）；M3 才执行远程 push、GitHub PR 合并与团队权限变更审批。`deploy_prod` 只生成审批记录与人工检查单，生产部署始终由人在 ATeam 之外执行。M2 不再重复实现 M1 已交付的合并门；M2 只增加 approvalId、参数哈希与消费语义。

审批门的状态使用领域模型 §4.6 的六态：pending、approved、rejected、expired、cancelled、consumed（`requested` 是 `pending` 的输入别名，`revoked` 是 `cancelled` 的输入别名）。审批记录包含动作、对象、请求者、审批人、理由、时间、关联 Run 与 commit。TTL：merge 24 小时、staging 4 小时、prod 30 分钟且不允许「不自动过期」、其他动作 72 小时。Agent 可以发起审批请求并附上证据，但不能批准自己发起的请求；M2 的本机单人模式下，审批人就是本地用户，仍然需要显式确认并记录，不能静默通过。

DevOps 的边界：M2 允许 Agent 生成 staging 部署计划和执行 staging 验证，prod 只允许生成计划和风险清单，执行必须由人完成。任何模板、插件或 Webhook 都不得绕过该约束。

### 10.5 Crew/队长模式（M2 后置）

Crew 是任务的 assigneeType 之一，表示一组 Agent 的协调者。Crew 模式必须满足：队长只负责把父任务拆成子任务 DAG；每个子任务有独立 Agent、独立工作区和独立证据；队长不能把多个角色塞进同一个 Run；队长的汇总报告必须引用子任务证据。

Crew 的调度仍然走任务队列，不新增旁路。队长的「决策」以创建子任务、调整依赖、发起审批的形式落地，全部可在任务历史中审计。Crew 模式在 M2 后置，意味着 M2 主体先交付单 Agent 并行任务与角色模板，Crew 在依赖 DAG、契约和审批门稳定后开放。

### 10.6 为什么不是自由聊天

自由聊天模式在演示中看起来灵活，但在工程上有四个硬问题：上下文不可控，多个 Agent 的输出互相污染；权限不可控，无法判断哪条命令由哪个角色发起；成本不可控，会话越长 token 消耗越不可预测；评审不可控，最终结果没有清晰的责任边界和证据链。

任务 DAG 加交付物契约把协作变成可验证的接口：输入是上游任务的产物，输出是契约要求的交付物，完成由证据判定。这样每个 Agent 的工作可以独立重跑、独立评审、独立计费，也才能在 M3 团队模式中做权限与审计。

## 11. 评论、Artifact 与 Evidence

### 11.1 评论（M2）

评论用于补充上下文、记录评审意见和讨论方案。字段包括：id、taskId、作者、正文、引用 Run ID、引用 Artifact ID、父评论 ID、创建时间、编辑时间、解决状态。正文支持 Markdown，M2 不支持富文本编辑器。

评论规则：评论不可删除，只能标记为已解决或隐藏；编辑评论保留编辑记录；@提及在 M3 团队模式生效，本机模式只做文本高亮；涉及密钥、token、个人信息的评论在提交时提示用户脱敏，但系统不做强制扫描。

M2 的评论入口在任务详情页底部，可以在评论中引用评审记录 ID，但评论不自动生成评审记录，评审记录也不依赖评论存在。评论不改变任务状态，状态变更必须通过显式操作。

### 11.2 Artifact（M1）

Artifact 是 Run 产生的文件型产物，字段包括：id、taskId、runId、type、name、mimeType、size、storagePath、hash、origin、truncated、supersedesId、createdAt、redacted。存储路径位于本地数据目录下的任务与 Run 子目录，数据库只保存索引和元数据。`origin` 区分系统采集与 Agent 自述；`redacted` 标记内容是否经过脱敏；`truncated` 标记预览或存储是否因大小限制截断；`supersedesId` 指向被替代的旧 Artifact。M1 的 Artifact 表由 `api-and-data.md` 的 `artifacts` 表承载，本章字段必须与其对齐，不得新增同义列。

Artifact 类型以 `api-and-data.md` 5.7 为准：M1 为 diff、test_report、screenshot、log_bundle、note、file；M2 可扩展 design_spec、deploy_plan、build_artifact、ui_review 等角色交付物类型，但必须先登记到 `meta` 与 API 文档，不能由前端自定义字符串。单个 Artifact 默认上限 50 MiB（与 `02-domain-model.md` §3.9、`runtime-and-workspace.md` §10.3 一致），单任务默认上限 500MB，均可在设置中调整。图片支持缩略图预览，Markdown 与文本支持只读预览，二进制提供下载。Artifact 不写入 git 仓库，避免污染用户代码。

### 11.3 Evidence（M2）

M1 不建 `evidence` 表，DoD 直接基于 Artifact 类型与人工例外理由；Evidence 实体从 M2 起交付。Evidence 是对完成度的结构化证明，字段以 `02-domain-model.md` §3.9.2 为准：id、taskId、runId、artifactId、criterionKey、type、status、validity、summary、sourceCommand、commit、capturedAt、verifiedBy、verifiedAt、supersedesId。type 包括 unit_test、integration_test、lint、typecheck、build、screenshot_review、manual_approval、deployment_plan、api_contract、other；`status` 为 passed、failed、missing、waived（DoD 判定结果），`validity` 为 valid、unverified、invalid（证据完整性），两者正交。

Evidence 与 Artifact 的区别：Artifact 是原始产物，Evidence 是对产物的判定。一个测试报告 Artifact 可以产生一条 unit_test Evidence；一张截图 Artifact 可以产生一条 screenshot_review Evidence，但截图是否满足设计要求仍需人工标记。Evidence 一旦写入不可修改，只能通过 `supersedesId` 追加新判定；waived 必须填写理由。

任务进入 Done 时，M1 按 Artifact 类型与人工例外检查完成定义；M2 起按交付物契约检查必需 Evidence。缺失时阻止 Done 并列出缺失项；用户可以选择 waive，但必须填写理由并记录审批人。

### 11.4 保留与配额

默认保留策略与 `api-and-data.md` §9.5、`non-functional-requirements.md` 的同一张表一致：Artifact、Evidence 与 RunEvent 默认保留 90 天，Run Workspace 已合并或放弃后保留 30 天，未合并改动不得自动删除。用户可以在设置中配置保留天数、单任务配额和清理策略；清理前必须显示将删除的文件数量和大小。归档任务保留证据，删除任务按第 12 章规则处理。

配额达到上限时，新的 Artifact 写入失败并在 Run 事件中记录错误，不阻塞 Run 完成，但会导致 DoD 检查失败。界面应提示用户清理或扩容，而不是静默丢弃。

### 11.5 安全与脱敏

Artifact 路径必须限制在 ATeam 数据目录内，禁止通过路径穿越读取任意文件。上传或采集前对常见密钥格式做提示；日志与 diff 中检测到疑似密钥时标记 redacted，并在预览时默认遮蔽。M2 的 Agent 权限不允许读取 Artifact 存储之外的路径。

## 12. 批量操作、归档与删除

### 12.1 多选与批量操作

M1 在列表视图提供多选，支持全选当前页、按筛选结果全选和取消选择；单任务归档在 M1 提供。M2 支持以下批量动作：

| 动作 | 规则 | 里程碑 |
|---|---|---|
| 批量修改状态 | 逐项校验流转矩阵，非法项跳过并报告 | M2 |
| 批量指派 | 指派给同一 human、agent 或 crew；Agent 必须存在 | M2 |
| 批量添加标签 | 去重，单任务标签上限 20 | M2 |
| 批量移除标签 | 不存在则忽略 | M2 |
| 批量归档 | 逐项检查活跃 Run 与依赖；按任务状态决定是否阻塞下游 | M2 |
| 批量恢复 | 只恢复已归档任务，逐项校验 Workspace 是否存在 | M2 |
| 批量删除 | M2 的「删除」也是软删除，不允许硬删除；有活跃 Run 的任务失败并报告 | M2 |

批量操作采用「部分成功」语义，不整体回滚已成功项。结果面板列出成功数量、失败数量、失败任务与原因，并支持复制失败清单。批量操作前显示影响摘要，超过 50 项时要求二次确认。

### 12.2 归档

归档就是软删除，设置 `archivedAt` 并从默认视图隐藏。归档不改变任务状态，不删除 Run、Artifact、Evidence 或评论。归档任务的依赖边保留；下游是否阻塞取决于被归档任务的状态：

- done 被归档：下游仍视为依赖已满足，不重新阻塞。cancelled 被归档：下游维持原有未满足状态，不把 cancelled 当作完成，也不因归档新增阻塞。
- backlog、todo、in_progress、in_review 或 blocked 被归档：仍依赖它的下游任务转为 blocked，并提示「依赖任务已归档」。
- 归档确认对话框必须列出受影响的下游任务；没有下游影响时也需提示「该任务被 N 个任务依赖」。

归档入口包括：任务详情页更多菜单、列表批量操作、已归档筛选中的恢复操作。M1 提供单任务归档与「已归档」筛选；M2.1 提供恢复窗口（30 天）与批量归档、批量恢复、按归档时间/状态/标签筛选。恢复归档时清空 `archivedAt`，任务回到原状态所在列；若原状态为 done，仍保持 done，但不会重新触发合并或评审。

### 12.3 删除

任务模块只有一个删除机制：软删除（归档）。`DELETE /api/v1/tasks/{id}` 与 `POST /api/v1/tasks/{id}/archive` 都设置 `archivedAt`，重复调用幂等返回 204。M1 不提供任务硬删除；M2.1 起归档进入 30 天恢复窗口；M3 之后的受控清理流程如需物理删除，必须经过 Owner/Admin 审批、写入审计，并先删除或导出关联证据。

删除（软删除）前展示影响清单：子任务、依赖边、下游任务、Run 数量、Artifact 与 Evidence 数量。清单不包含保存视图，因为保存视图只保存查询条件，不引用具体任务 ID。用户需输入任务标题或勾选确认框。

M0 现状：DELETE 接口直接物理删除任务，没有 Run 引用检查，也没有 UI 入口；由于 SQLite schema 未声明外键，删除任务会留下孤儿 Run。该行为在 M1 修复前属于已知风险，演示和文档必须明确说明。M1 起删除改为归档（软删除），Run、Artifact 与 Evidence 保留；M2.1 起增加 30 天恢复窗口；M2 起软删除写入 task_events；M3 团队模式写入审计并要求权限。

### 12.4 数据保留

M0 遗留的孤儿 Run 在 M1 启动迁移时标记为孤立并保留，不自动删除；任务详情不可达，Run 列表仍可按 ID 查询。M1 增加数据清理任务，定期扫描孤儿 Run 并提供导出或删除选项。归档任务默认保留 30 天恢复窗口，之后可按配置清理；用户可以在设置中配置保留期限，清理前必须显示将删除的记录与文件数量。归档任务的证据在归档期间只读保留，恢复后继续可评审；清理归档任务时必须先处理被门禁引用的证据。

## 13. 交互状态设计：空、加载、错误、冲突与离线

### 13.1 空状态

| 场景 | 展示内容 | 主行动 |
|---|---|---|
| 全局无任务 | 说明 Task 是上下文容器，Agent 与 Run 如何工作 | 新建第一个任务 |
| 看板某列为空 | "No tasks / Drag a card here or create a new one." | 新建任务 |
| 筛选无结果 | "No tasks match the current filters." 并列出当前筛选条件 | 清除筛选 |
| 搜索无结果 | "No tasks contain xxx." | 清空关键词 |
| 无 Run | "No runs yet." 并展示选择 Agent 与 Run 入口 | 启动 Run |
| 无证据 | "No evidence yet." 并说明需要运行检查 | 查看 Run |
| 无评论 | "No comments yet." | 添加评论（M2） |

文案规则：M0 的界面语言为英文，本章引用一律使用英文原文；M1 建立统一文案表，所有空状态必须包含标题、解释和一个主行动。中文只出现在 PRD 说明中，不直接作为实现文案，除非产品另行决定本地化。

### 13.2 加载

M0 现状：看板与详情页没有骨架屏，列先渲染、数据未到时会闪现空状态；按钮没有统一的 loading 禁用，Run、Cancel 可被重复点击。M1 目标：看板首次加载显示列骨架与卡片骨架，避免先闪空状态再出现数据；详情页显示头部、描述、Run 三个骨架区块；分页或筛选加载时保留旧数据并显示顶部进度条，避免整页闪烁。对应 FR 为 TASK-137。

所有按钮在请求进行中进入 loading 状态并禁用重复提交，尤其是 Run、Approve、合并、删除、批量操作。M1 的乐观更新用于拖拽，不用于删除与评审等高风险操作。

### 13.3 错误

错误分为四类：网络错误、校验错误、权限错误、服务端错误。网络错误显示可重试的横幅，保留用户输入；校验错误定位到字段并显示具体原因；权限错误显示所需权限和申请入口（M3 账号体系）；服务端错误显示错误摘要和请求 ID，支持复制诊断信息。对应 FR 为 TASK-121 与 TASK-138。

404 任务不存在时展示专门页面，而不是空白页。409 冲突时展示冲突原因和可行动作。500 时不暴露堆栈给最终用户，日志中保留完整错误。错误文案不得使用中文与英文混排；实现文案统一英文，PRD 中的中文只解释含义。

### 13.4 冲突

M0 没有版本字段，更新采用最后写入覆盖，两个窗口同时编辑时后提交者静默覆盖前者的结果。M1 起引入 `revision`（`version` 仅作请求输入别名）与 `If-Match`/`expectedRevision`：版本不匹配返回 `409 STALE_REVISION` 并展示字段级差异；412 仅用于审批指纹、内容哈希与评审快照等动作前置条件，与 api-and-data.md 13.4 及领域模型 §7.4 一致。

冲突解决策略：默认要求用户刷新后重新提交；提供「保留我的修改并覆盖」选项，但需要显式确认并记录审计；批量操作遇到冲突项跳过并报告。拖拽状态冲突时以服务端状态为准，卡片回滚到服务端列。

### 13.5 离线与服务不可用

本地优先不等于永远在线。M1 的离线策略是「只读缓存 + 拒绝写入」，不做离线写队列：

- 看板与详情页保留最后一次成功加载的快照，服务不可达时继续展示，但顶部显示离线横幅并标注数据可能过期。
- 创建、编辑、拖拽、评审、合并、归档等写操作在离线时直接拒绝，保留用户已输入内容并提示 "Service unavailable. Your changes were not saved."；不得假装成功，也不得把写请求排队到恢复后静默执行。
- 服务恢复后横幅自动消失；用户可手动刷新，或由重连成功触发的全量刷新同步数据。若恢复时发现任务已被修改，按 13.4 的冲突策略处理。
- M3 团队模式下，离线期间不得进行审批与合并；审批人不可用时任务显示 "Waiting for approver"，并进入收件箱提醒。
- 断线重连与重放规则以 `api-and-data.md` 6.5 为准：客户端携带 `afterSeq`，服务端补发或返回 `events.replay_reset`，客户端在重放重置时拉取全量快照。

## 14. 功能需求

以下需求按主题分组。编号规则：`TASK-` 是任务域模块文档的全局命名空间，编号在本章内唯一且发布后不改号；其他模块使用各自前缀（AGENT-、RUN-、COLLAB-、API-、UI-、SEC- 等），里程碑文档中的局部编号必须带里程碑前缀（例如 `M1-TASK-001`），不得与本章编号重名。当前 `prd/milestones/M1-local-loop.md` 的 TASK-001/002/003 与本模块编号冲突，里程碑文档应在下一次修订中改为 `M1-TASK-xxx`；在改名完成前，跨文档引用必须同时写明来源文档。优先级分为 P0（闭环必需）、P1（体验关键）、P2（增强）。「里程碑」列中的 M0 表示当前已实现，其余为计划。

### 14.1 任务对象与 CRUD

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-001 | 创建任务时标题必填，trim 后长度为 1-200 字符 | P0 | M0 必填已实现，长度校验 M1 | 空标题或纯空白返回 400；201 字符返回 400 |
| TASK-002 | 任务描述最长 64KB，超限返回 400 | P1 | M1 | 64KB 边界通过，超出返回明确错误 |
| TASK-003 | 新任务默认 status=backlog、priority=0、labels=[]、处理人为空 | P0 | M0 已实现 | 不传字段时响应符合默认值 |
| TASK-004 | 任务 ID 由服务端生成 24 位十六进制字符串，客户端不能指定 | P0 | M0 已实现 | POST body 中的 id 被忽略；响应 ID 长度 24 |
| TASK-005 | 任务列表默认按 createdAt 降序返回 | P0 | M0 已实现 | 新建任务出现在列表首位 |
| TASK-006 | PATCH 只更新请求中出现的字段，未出现字段保持不变 | P0 | M0 已实现 | 只传 status 时 title、description 不变 |
| TASK-007 | 更新时标题不能为空，状态必须是七个合法值之一 | P0 | M0 已实现 | 空标题与非法状态均返回 400 |
| TASK-008 | priority 仅允许 0-4，非法值返回 400 | P1 | M1（M0 接受任意整数） | -1 与 5 均返回 400 |
| TASK-009 | labels 去重、trim、单标签不超过 32 字符、总数不超过 20 | P1 | M1 | 重复标签只保留一个；超限返回 400 |
| TASK-010 | assigneeType 仅允许空、human、agent、crew；agent 与 crew 的 assigneeId 必须存在 | P1 | M2（M0 不校验） | 不存在的 Agent ID 返回 400 |
| TASK-011 | parentId 必须存在、不能指向自己、不能形成环，且与父任务同 Workspace | P1 | M1 | 自指、环与跨 Workspace 返回 400 |
| TASK-012 | 任务删除统一为软删除（归档）；DELETE 与 archive 幂等，不提供硬删除 | P0 | M1（M0 物理删除） | 删除后默认列表不可见，带 includeDeleted 可读取；重复 DELETE 返回 204 |
| TASK-013 | 任务必须绑定一个 Workspace；单 Workspace 自动选择，多 Workspace 必须显式选择 | P0 | M1 | 未绑定 Workspace 的任务启动 Run 返回 409 `WORKSPACE_REQUIRED` |
| TASK-014 | 跨 Workspace 移动任务需要无活跃 Run、无跨项目依赖并记录审计 | P2 | M3 | 违反任一条件返回 409；成功后新 Run 使用新 Workspace |
| TASK-015 | 进入 done 写入 completedAt，重开清空；周期时间可计算 | P1 | M1 | done 后 completedAt 非空；done→in_progress 后为空 |

### 14.2 状态与流转

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-020 | 状态只能是 backlog、todo、in_progress、in_review、done、blocked、cancelled | P0 | M0 已实现 | 非法状态返回 400 |
| TASK-021 | Backlog 任务创建 Run 返回 409，提示先移动到 Todo 或 In Progress | P0 | M0 已实现 | POST runs 返回 409 且不创建 Run |
| TASK-022 | 可执行状态为 todo、in_progress、in_review | P0 | M0 已实现 | 其余状态启动 Run 均被拒绝 |
| TASK-023 | 从 todo 启动 Run 时任务自动转 in_progress，处理人写为所选 Agent | P0 | M0 已实现 | 启动后 GET task 状态与 assignee 正确 |
| TASK-024 | Run completed 后任务默认自动进入 in_review；`auto_move_to_review` 可关闭，但绝不自动进入 done | P0 | M1 | 默认配置下 Run completed 后任务为 in_review；关闭后保持 in_progress；两种配置都不会出现自动 done |
| TASK-025 | Done 必须同时满足评审门与合并门 | P0 | M1 基础门，M2 绑定契约与 approvalId | Approve 后任务仍为 in_review；未合并且未填写 No merge required 时进入 done 返回 409 |
| TASK-026 | done 重新打开只能到 todo，需要二次确认并填写原因 | P1 | M2 | PATCH done→in_progress 返回 409；done→todo 未填原因被拒绝 |
| TASK-027 | blocked 可由人工设置原因；依赖未满足时系统自动标记 blocked | P1 | M2 | 两种来源在 blockedReason 中可区分 |
| TASK-028 | cancelled 为终态，重新打开只能到 backlog 并需要原因 | P1 | M2 | 直接 PATCH cancelled→todo 返回 409；cancelled→backlog 需原因 |
| TASK-029 | 所有状态流转写入 task_events，包含 actor、from、to、reason、时间 | P1 | M2 | 每次流转后查询历史可复现 |
| TASK-030 | 同一任务默认最多一个活跃 Run（queued、preparing、running），M2 可显式 allowConcurrent 放开，超出返回 409 | P0 | M1 默认限制，M2 显式放开 | 连续两次启动 Run 第二次返回 409；显式放开后两个 Run 均存在且有风险提示 |
| TASK-031 | 看板必须可查看 blocked 与 cancelled 任务 | P0 | M1（M0 仅五列） | 两种状态的任务均可在看板找到 |
| TASK-032 | 服务端强制执行第 5.2 节流转矩阵 | P0 | M1（M0 允许任意状态互转） | 非法流转返回 409 并说明原因 |
| TASK-033 | Approve 只写入评审记录，不改变任务状态 | P0 | M1 | Approve 后任务仍为 in_review；无合并或豁免时 Done 按钮禁用 |
| TASK-034 | 合并成功后任务才能进入 done；合并失败或冲突时任务保持 in_review 或转 blocked | P0 | M1 | 合并接口成功后 status=done；失败时任务状态不被改写 |
| TASK-035 | 不涉及合并的任务可在填写 No merge required 理由后进入 done | P0 | M1 | 未填理由不能提交；理由写入评审历史与 task_events |
| TASK-036 | Run 失败、取消或超时时，任务保持 in_progress 或转 blocked，展示原因与重试入口 | P1 | M1 | 三种终态均不自动进入 in_review 或 done；重试创建新 Run |

### 14.3 看板、列表与视图

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-040 | 看板按状态分列，列顺序可配置 | P0 | M0 五列固定，M1 可配置 | 刷新后自定义列顺序保留 |
| TASK-041 | 卡片显示标题、描述摘要、状态、优先级；M1 增加标签与活跃 Run 指示 | P1 | M0 基础，M1 扩展 | 有活跃 Run 的卡片有明确视觉指示 |
| TASK-042 | 拖拽卡片到另一列发起状态变更，采用乐观更新 | P0 | M0 基础拖拽，M1 乐观更新 | 网络失败时卡片回到原列 |
| TASK-043 | 拖拽到不允许的状态时回弹并提示原因 | P1 | M1 | 非法目标不发送 PATCH |
| TASK-044 | 列内默认按 priority 降序、updatedAt 降序排序 | P1 | M1 | 同优先级按更新时间稳定排序 |
| TASK-045 | 列头显示任务数，可选 WIP 上限提示 | P2 | M2 | 超限时列头警告但不阻断 |
| TASK-046 | 提供列表视图，显示状态、优先级、处理人、标签、更新时间 | P1 | M1 | 与看板共享查询条件 |
| TASK-047 | 筛选支持 status、priority、assignee、label、parentId、hasActiveRun、archived | P1 | M1 | 多个筛选组合结果正确 |
| TASK-048 | 搜索覆盖 title、description、labels、任务 ID，大小写不敏感 | P1 | M1 | 关键词命中任一字段即返回 |
| TASK-049 | 排序支持 createdAt、updatedAt、priority、title | P1 | M1 | 升降序切换正确且稳定 |
| TASK-050 | 筛选、搜索、排序写入 URL，刷新可恢复 | P1 | M1 | 复制 URL 到新窗口得到相同结果 |
| TASK-051 | 保存视图保存筛选、排序、视图类型与列配置 | P2 | 个人 M2，共享 M3 | 视图删除不影响任务 |
| TASK-052 | 1,000 个任务时看板首次加载 P95 小于 500ms | P1 | M1 | 本地基准测试记录 |
| TASK-053 | 空列显示引导文案与新建入口 | P2 | M0 文案已实现，M1 增加动作 | 空列可直接创建任务并预填列状态 |
| TASK-054 | 任务列表服务端分页使用 cursor，返回 nextCursor 与 hasMore | P0 | M1 | 1,000 任务下翻页无重复、无跳过；非法 cursor 返回 400 |
| TASK-055 | 单任务归档与恢复入口 | P0 | 归档 M1，恢复 M2 | 归档后默认视图隐藏；恢复后回到原状态 |
| TASK-057 | task.* 事件增量更新看板与详情；重连或事件缺口时全量刷新 | P1 | M1 | 断网 30 秒恢复后看板与详情数据一致，无重复卡片 |
| TASK-058 | 看板列内手动排序并持久化 boardOrder | P2 | M2 | 刷新后顺序保留；不影响任务语义与依赖 |

### 14.4 详情、评审与证据

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-060 | 详情页展示全部可编辑字段并支持内联编辑 | P1 | M1 | 修改保存后列表与看板同步 |
| TASK-061 | 详情页展示验收标准 checklist，可勾选并记录完成人与时间 | P1 | M1 | 勾选状态持久化 |
| TASK-062 | 详情页展示 Run 列表并默认选中最近一次 Run | P0 | M0 已实现 | 打开详情页自动加载最近 Run 日志 |
| TASK-063 | 选中 Run 展示事件流；M0 轮询，M1 改为 WebSocket 增量 | P0 | M0 轮询已实现，M1 增量 | 事件按 seq 有序且无重复 |
| TASK-064 | 详情页展示 Run diff，支持按文件折叠；行内评论属于 M2 | P1 | 只读 diff M1，行内评论 M2 | diff 与 worktree 分支一致；M1 不依赖评论系统 |
| TASK-065 | 详情页展示 Artifact，支持图片与 Markdown 预览和下载 | P1 | M1 | 50 MiB 文件可上传与预览；超过上限被拒绝并告警 |
| TASK-066 | 详情页展示 DoD 核对结果与相关 Artifact；Evidence 实体从 M2 起交付 | P1 | M1（Artifact + DoD 清单）/M2（Evidence 实体） | 缺失必需 Artifact 时明确列出 |
| TASK-067 | 评审人可 Approve 或 Request changes，必须填写意见并写入独立 Review 记录 | P0 | M1 | 空意见不能提交；记录包含 runId、commit 与证据快照哈希 |
| TASK-068 | 详情页展示依赖列表、阻塞原因与 DAG 入口 | P1 | M2 | 阻塞路径可定位 |
| TASK-069 | 详情页提供评论线程，支持 Markdown 与引用 Run | P2 | M2 | 引用 Run 可跳转 |
| TASK-070 | 详情页支持创建子任务或跟进任务并继承上下文 | P2 | M2 | 新任务 parentId 与引用正确 |
| TASK-071 | 合并对话框展示目标分支、源分支、head commit、策略与风险提示 | P0 | M1 | 默认焦点在取消；未勾选确认不能合并 |
| TASK-072 | 合并失败、冲突或 commit 变化时保留任务状态并给出可行动原因 | P0 | M1 | 冲突时不产生部分合并；审批失效返回明确错误 |
| TASK-073 | 不涉及合并的任务提供 No merge required 豁免，理由必填并写入历史 | P0 | M1 | 理由为空不能提交；豁免记录可审计 |
| TASK-074 | 详情页展示最近一次 Run 的失败/超时/取消原因与重试入口 | P1 | M1 | 重试创建新 Run，不复用旧 worktree |
| TASK-075 | 权限不足时进入只读模式，说明所需角色与申请方式 | P1 | M3 | Viewer 看不到禁用操作的可用入口；不泄露受限字段 |

### 14.5 创建与模板

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-080 | 看板快速创建只需标题，可填描述与初始状态 | P0 | M0 已实现 | 5 秒内完成创建 |
| TASK-081 | 完整创建表单包含 Workspace、全部字段与验收标准 | P1 | M1 | 所有字段可保存并回显；Workspace 必填 |
| TASK-082 | 创建后默认进入 Backlog，除非用户显式选择其他状态 | P0 | M0 已实现 | 不选状态时进入 Backlog |
| TASK-083 | 快捷模板预填描述骨架、验收标准、建议 Agent、标签与证据要求 | P2 | M2 | 选择模板后表单字段正确预填 |
| TASK-084 | 内置模板至少包含 UI Design、Frontend、Backend、DevOps Staging、Bugfix、Feature | P2 | M2 | 六个模板均可创建任务 |
| TASK-085 | 用 Agent 创建任务时只能生成草稿，人工确认后才写入 | P1 | M2 | 未确认时任务表无新记录 |
| TASK-086 | Agent 生成的任务草稿默认 Backlog 且不自动启动 Run | P1 | M2 | 创建后无 Run 记录 |
| TASK-087 | 从失败或取消的 Run 创建跟进任务时自动引用原任务与错误摘要 | P2 | M2 | 新任务描述包含 Run 链接 |
| TASK-088 | 模板变更需版本号，任务保留创建时的 templateId 与 templateVersionSnapshot | P2 | M2 | 模板升级或删除不改变既有任务 |
| TASK-089 | 模板实例化可预置任务 DAG、交付物契约与证据要求 | P1 | M2.1 | 从模板创建的任务依赖与契约与模板一致 |
| TASK-090 | 模板删除前检查引用；被任务引用时只允许归档，不允许物理删除 | P2 | M2 | 删除被引用模板返回 409；归档后既有任务仍可读取快照 |

### 14.6 依赖 DAG

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-095 | 任务依赖以 `task_dependencies` 为唯一事实源，支持 finish_to_start、artifact_ready、approval 三类 | P1 | M2 | 依赖关系持久化并可查询；PATCH dependsOn 不生效；三类依赖均可创建 |
| TASK-096 | 创建依赖时检测环，存在环返回 400 并列出路径 | P1 | M2 | A→B→A 被拒绝 |
| TASK-097 | 所有依赖满足才允许启动 Run | P1 | M2 | `finish_to_start` 上游未 done 或 `required_artifact_kinds` 缺产物时，POST runs 返回 409；M2 不实现 artifact_ready/approval 独立边 |
| TASK-098 | 依赖未满足时任务自动 blocked 并显示原因 | P1 | M2 | 原因包含前置任务标题 |
| TASK-099 | 依赖全部满足时触发 task.unblocked 并重新计算可执行性 | P1 | M2 | 事件 payload 含任务与原因 |
| TASK-100 | 删除或归档被依赖任务需二次确认并列出下游；归档不改变既有依赖满足状态 | P1 | M2 | done 上游归档后下游仍满足；cancelled 上游归档后下游维持未满足；未完成上游归档时下游 blocked |
| TASK-101 | 提供 DAG 视图，显示节点、边、状态与阻塞路径 | P2 | M2 | 200 节点内可流畅渲染 |
| TASK-102 | 禁止跨 Workspace 依赖 | P2 | M2（M1 单 Workspace 自然满足） | 跨 Workspace 创建返回 400 |
| TASK-103 | 单任务直接依赖上限 50 条 | P2 | M2 | 第 51 条返回 400 |
| TASK-104 | autoRun 仅对显式开启且已指派 Agent 的任务生效，默认关闭 | P2 | M2 | 默认配置下依赖完成不自动启动 |

### 14.7 批量、归档与删除

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-110 | 列表与看板支持多选 | P1 | M1 | 全选当前页与取消选择正确 |
| TASK-111 | 批量修改状态逐项校验流转，返回部分成功报告 | P2 | M2 | 非法项不改变状态 |
| TASK-112 | 批量指派同一 human、agent 或 crew | P2 | M2 | 不存在的 Agent 项失败 |
| TASK-113 | 批量添加或移除标签 | P2 | M2 | 标签去重且遵守上限 |
| TASK-114 | 批量归档，归档后默认视图隐藏 | P2 | M2 | 归档任务不出现在默认看板 |
| TASK-115 | 已归档任务可筛选，恢复入口在 M2 提供 | P2 | M1 筛选，M2 恢复 | 恢复后回到原状态列，不重新触发评审或合并 |
| TASK-116 | 删除（软删除）前展示影响清单 | P1 | M1 | 清单包含 Run、Artifact、Evidence、子任务、依赖与下游任务；不含保存视图 |
| TASK-117 | 任务删除统一为软删除；硬删除仅存在于 M3+ 受控清理并需审批 | P0 | M1 软删除 | DELETE 后任务默认不可见但可恢复；无硬删除端点 |
| TASK-118 | 删除与归档写入审计日志 | P2 | M3 | 审计可按任务与操作者查询 |

### 14.8 异常、并发与冲突

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-120 | 任务不存在返回 404，详情页显示明确页面与返回入口 | P0 | M0 已实现 | 访问不存在 ID 不白屏 |
| TASK-121 | 网络或服务错误显示可重试提示并保留未提交输入 | P1 | M1 | 重试成功后数据正确 |
| TASK-122 | 并发编辑使用 `revision` 乐观锁与 `If-Match`，M1 起冲突返回 409 `STALE_REVISION` 并展示差异 | P1 | M1 | 旧版本提交返回 409 `STALE_REVISION`；响应不返回 `version` 字段 |
| TASK-123 | 拖拽状态更新失败时卡片回滚并提示 | P1 | M1 | 服务端失败后 UI 与原状态一致 |
| TASK-124 | 批量操作部分失败时返回成功与失败明细 | P2 | M2 | 失败项可复制 |
| TASK-125 | 服务重启后活跃 Run 标记为 interrupted 或 failed 并提示重跑 | P1 | M1 | 重启后无永久 running 的 Run |
| TASK-126 | 任务删除或归档前必须取消或等待活跃 Run 结束 | P1 | M1 | 有活跃 Run 时操作返回 409 |
| TASK-127 | WebSocket 断线自动重连；M1 起重连成功后执行全量刷新并显示重连状态 | P1 | M0 仅自动重连；M1 补齐刷新与状态 | M0 只验证 close 后 2 秒重连；M1 断网 30 秒恢复后看板与详情一致，顶部状态消失 |
| TASK-128 | 长描述在卡片截断、详情完整显示 | P2 | M0 已实现 | 卡片两行截断，详情不截断 |
| TASK-129 | 时间以 UTC 存储、按本地时区显示 | P1 | M0 已实现 | 跨时区显示正确 |
| TASK-137 | 加载骨架与按钮 loading 禁用 | P1 | M1 | 首次加载不闪 EmptyState；Run、Approve、合并按钮请求中不可重复点击 |
| TASK-138 | 服务端错误展示 requestId 并支持复制诊断信息 | P1 | M1 | 任意 500 响应可读取 X-Request-ID；复制内容包含 requestId |
| TASK-139 | 服务不可用时展示离线横幅，读缓存、拒绝写操作 | P1 | M1 | 离线时写操作明确失败并保留输入；恢复后横幅消失并可刷新 |

### 14.9 权限、安全与审计

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-119 | 关联 GitHub PR：审批后推送分支、创建 PR、回写状态，不自动合并 | P1 | M3 | 无审批不得推送；PR 状态变化回写任务；创建失败可重试且不重复建 PR |
| TASK-130 | 本机模式默认只监听回环地址，不提供账号鉴权 | P0 | M0 已实现默认绑定 | `ateam serve` 默认 127.0.0.1:8787；桌面壳 StartLocal 监听 127.0.0.1:0 随机端口；两者外部网卡均不可访问 |
| TASK-131 | 团队模式按组织 Owner/Admin/Member/Viewer 与 Workspace 级 workspace_admin/Contributor/Reviewer/Viewer 授权任务操作 | P1 | M3 | Viewer 不能创建或修改任务；组织 Member 未加入 Workspace 时不可访问 |
| TASK-059 | 远程 Runner 下任务可分派到指定机器并同步状态 | P1 | M3 | 机器离线时任务显示等待调度；恢复后不重复执行 |
| TASK-132 | 删除、合并、推送、部署必须人工审批，Agent 发起的请求进入审批队列 | P0 | 软删除确认与合并 M1，staging/prod M2，push 审批记录 M2.1、执行 M3 | prod 无执行入口；Agent 无法自行批准；审批绑定 commit 或参数哈希 |
| TASK-133 | Agent 与任务执行范围取交集后，只能读取 allowedPaths、执行 allowedCommands | P1 | M2 | 交集为空返回 POLICY_DENIED；越权路径与命令被拒绝 |
| TASK-134 | 任务描述、评论、Run 日志不得存储密钥，疑似密钥需提示脱敏 | P1 | M1 | 疑似密钥内容有警告标记 |
| TASK-135 | 任务变更审计包含 actor、action、变更前后摘要与时间 | P2 | M3 | 审计可按任务导出 |
| TASK-136 | 本机 API 在 M2.1 引入启动时生成的本地访问 token（bootstrap），CORS 仅允许应用自身 origin；M1 仅收紧 Origin/Host/CORS | P0 | M2.1（M0 任意 Origin 可调用） | 非应用页面调用返回 401 或预检失败；M1 验证 Origin 白名单 |

### 14.10 M4 自动化与分发

| 编号 | 需求 | 优先级 | 里程碑 | 验收要点 |
|---|---|---|---|---|
| TASK-140 | 定时规则与签名 Webhook 可创建任务，默认 Backlog，并记录 trigger 与去重键 | P1 | M4 | 重复 schedule 时间点或相同 delivery 只创建一个任务；未签名或重放请求被拒绝 |
| TASK-141 | 通知中心覆盖阻塞、评审请求、Run 失败、依赖解除，去重且不丢失 | P1 | M4 | 同一任务 10 分钟内同类通知最多一条；恢复后不重复投递；点击可跳到任务或 Run |
| TASK-142 | 插件只能读取任务与订阅事件，不能绕过审批门、不能替人批准 | P1 | M4 | 插件调用合并、审批或删除端点返回 403；停用后不再收到事件 |
| TASK-143 | 任务与证据可导入导出，导出前进行敏感信息检查 | P2 | M4 | 导出包含任务、评审、Artifact 索引与 Evidence；密钥与完整环境变量被排除 |
| TASK-144 | 遥测默认关闭且必须 opt-in，不采集任务标题、描述、评论、代码或路径 | P1 | M4 | 关闭时无上报；开启后可查看、导出并删除本地遥测记录 |

## 15. 数据与 API 影响

### 15.1 当前 API（M0）

| 方法 | 路径 | 用途 | 行为要点 |
|---|---|---|---|
| GET | /api/tasks | 列出任务 | 无分页、无筛选，按 createdAt 降序 |
| POST | /api/tasks | 创建任务 | 标题必填；status 默认 backlog；校验状态枚举 |
| GET | /api/tasks/{id} | 读取任务 | 不存在返回 404 |
| PATCH | /api/tasks/{id} | 局部更新 | 字段级 patch；不校验流转矩阵与版本 |
| DELETE | /api/tasks/{id} | 删除任务 | 无引用检查，直接删除 |
| GET | /api/tasks/{id}/runs | 列出任务的 Run | 按 createdAt 降序 |
| POST | /api/tasks/{id}/runs | 用 Agent 启动 Run | 校验任务可执行；设置 assignee；todo 自动转 in_progress；提交调度 |
| GET | /api/runs/{id} | 读取 Run | 不存在返回 404 |
| GET | /api/runs/{id}/events | 读取 RunEvent | 按 seq 升序 |
| POST | /api/runs/{id}/cancel | 取消 Run | 终态直接返回；否则取消并写 cancelled |
| GET | /api/ws | WebSocket 事件流 | 广播 task、agent、run 事件 |

### 15.2 计划 API（M1-M4）

以下路径全部以 `api-and-data.md` 为准，M1 起使用 `/api/v1` 前缀；M1 同期保留 `/api` 作为永久兼容别名并返回 `Deprecation` 头，不在 M2 移除。本章不再规划「M3 前使用 /api」的第二套路径。

| 方法 | 路径 | 用途 | 里程碑 |
|---|---|---|---|
| GET | /api/v1/tasks?status=&assigneeType=&assigneeId=&label=&parentId=&q=&sort=&cursor=&limit=&includeDeleted= | 服务端筛选、搜索、排序、分页 | M1 |
| POST | /api/v1/tasks/{id}/archive | 归档任务（软删除） | M1 |
| POST | /api/v1/tasks/{id}/restore | 恢复归档 | M2 |
| GET/POST | /api/v1/projects | 列出与创建 Workspace | M1 |
| GET/PATCH/DELETE | /api/v1/projects/{id} | 读取、更新、归档 Workspace | M1 |
| GET | /api/v1/tasks/{id}/artifacts | 跨 Run 聚合 Artifact | M2 |
| GET | /api/v1/runs/{id}/artifacts | 获取 Run 的 Artifact 与 diff 产物 | M1 |
| GET | /api/v1/artifacts/{id}/content | 读取 Artifact 内容 | M1 |
| GET | /api/v1/tasks/{id}/evidence | 聚合 Evidence 与 DoD 核对 | M2（M1 由 run artifacts 与 reviews 组合返回 DoD 核对） |
| GET | /api/v1/runs/{id}/reviews | 列出该 Run 的评审 | M1 |
| POST | /api/v1/runs/{id}/reviews | 提交 Approve、changes_requested 或 comment | M1 |
| GET | /api/v1/reviews/{id} | 读取单条评审 | M1 |
| GET | /api/v1/tasks/{id}/reviews | 任务维度评审历史 | M2 |
| POST | /api/v1/runs/{id}/merge | 受评审门保护的合并；需显式确认 | M1 |
| POST | /api/v1/runs/{id}/retry | 重试失败或取消的 Run | M1 |
| POST | /api/v1/tasks/bulk | 批量状态、指派、标签、归档、恢复 | M2 |
| GET/PUT | /api/v1/tasks/{id}/dependencies | 查询与整体替换依赖，校验环路 | M2 |
| GET/POST | /api/v1/tasks/{id}/comments | 查询与添加评论 | M2（需在 api-and-data 登记） |
| PATCH/DELETE | /api/v1/tasks/{id}/comments/{commentId} | 编辑、隐藏评论 | M2（需在 api-and-data 登记） |
| POST | /api/v1/tasks/draft | Agent 生成任务草稿 | M2（需在 api-and-data 登记） |
| GET/POST | /api/v1/task-views | 保存视图 | M2 |
| PATCH/DELETE | /api/v1/task-views/{id} | 修改、删除视图 | M2 |
| GET/POST | /api/v1/task-templates | 模板管理 | M2 |
| POST | /api/v1/runs/{id}/pull-request | 审批后推送分支并创建 GitHub PR | M3 |
| GET | /api/v1/audit/tasks | 任务审计查询 | M3 |
| GET/POST | /api/v1/schedules | 定时规则 | M4 |
| GET/POST | /api/v1/webhooks | Webhook 配置与投递日志 | M4 |
| GET | /api/v1/notifications | 应用内通知与通知偏好 | M4 |
| GET/POST | /api/v1/plugins | 插件安装、启停与权限清单 | M4 |

说明：`priority`、`hasActiveRun`、`archived` 是任务模块需要的扩展过滤参数，M1 实现前必须先在 `api-and-data.md` 8.1 登记；登记前只能用 API 文档已列出的参数，不能私自扩展查询字符串。归档筛选在 API 上使用 `includeDeleted`，UI 文案可称 "Archived"。表中 `workspaces`、`evidence`、`comments`、`task-views`、`task-templates`、`schedules`、`webhooks`、`notifications`、`plugins` 端点来自对应里程碑或本章需求，若 `api-and-data.md` 5.x 尚未列出，实现前必须先补登记；未登记端点不得被前端或插件依赖。

分页采用 cursor 模式，响应返回 `nextCursor` 与 `hasMore`，避免 offset 在实时更新下跳过任务。列表与看板共享同一查询接口，前端通过 `view` 参数决定渲染方式。路径、请求体、响应体与错误码的最终定义以 `api-and-data.md` 第 5、7、8 节为准；本章表格只列出任务域实际消费的端点。

### 15.3 WebSocket 事件

M0 已实现的事件包括：`task.created`、`task.updated`、`task.deleted`、`agent.created`、`agent.updated`、`agent.deleted`、`run.queued`、`run.preparing`、`run.running`、`run.event`、`run.updated`。M1 起新增 `run.completed`、`run.failed`、`run.cancelled`、`run.timeout`、`merge.completed`、`artifact.created`、`review.requested`、`events.replay_reset`；M2 新增 `task.restored`、`task.dependency.added`、`task.dependency.removed`、`approval.*`、`comment.created` 等。`run.finished`、`run.merged`、`review.created` 是旧名，只保留一个里程碑的并行发送期。

事件命名以 `api-and-data.md` 第 6 节为唯一契约。本章早期草案中的 `task.dependency.changed`、`task.review.requested`、`task.review.approved`、`task.review.changes_requested` 不再作为契约事件；对应语义按下表映射：

| 本章业务语义 | API 契约事件 | 触发 | payload 要点 | 里程碑 |
|---|---|---|---|---|
| 任务创建/更新/状态变化 | task.created、task.updated | 创建、PATCH、Run 启动、评审打回等 | 完整 Task | M0 |
| 归档（软删除） | task.archived | 归档成功 | task 或 `{id, archivedAt}` | M1 |
| 恢复归档 | task.restored | 恢复成功 | 完整 Task | M2.1 |
| 人工阻塞 | task.blocked | 人工设置阻塞 | 完整 Task 含 blockedReason | M2 |
| 依赖阻塞/解除 | task.blocked / task.unblocked | 依赖变化导致状态迁移 | task、reason、source | M2 |
| 依赖增删 | task.dependency.added / task.dependency.removed | 添加或删除依赖边 | taskId、dependsOnTaskId | M2 |
| 评审提交（含 Approve/打回） | review.requested / review.approved / review.changes_requested | 写入 Review 记录或决策 | review 完整对象，含 status 与 runId | M1 |
| 评审记录失效 | review.superseded | commit 或证据快照变化 | runId、reviewId、reason | M1 |
| 新 Artifact | artifact.created | 产物落盘 | artifact 元数据 | M1 |
| 新 Evidence | evidence.added（M2） | Evidence 创建 | evidence 摘要 | M2 |
| 新评论 | comment.created | 评论创建 | comment 摘要 | M2 |
| 批量操作 | task.updated（逐项） | 批量完成后每项广播 | 完整 Task | M2 |
| 版本冲突 | 不广播独立事件；由 409 `STALE_REVISION` 响应表达 | PATCH 携带过期 If-Match | 响应含 currentRevision | M1 |
| 事件重放重置 | events.replay_reset | afterSeq 早于保留窗口 | reason、lastSeq | M1 |

事件 payload 只包含必要字段与任务 ID，客户端按需拉取完整对象。M0 事件无 `id` 与全局 `seq`；M1 起使用 `api-and-data.md` 6.2 的事件信封，客户端按 `id` 去重、按 `seq` 重放。`revision` 从 M1 起随事件携带；M1 之前的事件不携带版本字段，客户端以 `updatedAt` 与快照为准。

表中标注「需在 api-and-data 登记」的事件（task.blocked、task.unblocked、comment.created）在实现前必须先写入 `api-and-data.md` 6.3 的事件目录，并补充 payload schema；未登记前只能作为内部实现细节，不得作为前后端契约或插件 API 依赖。

### 15.4 数据库变更

M1 计划迁移（表名与 `api-and-data.md` 9.3 对齐）：

| 变更 | 内容 | 原因 |
|---|---|---|
| CREATE workspaces | id、name、repo_path、default_branch、settings、status、archived_at、created_at、updated_at | Workspace 绑定；完整列以 api §9.3 为准 |
| ALTER tasks | 增加 workspace_id TEXT NOT NULL DEFAULT 'default'、acceptance_criteria TEXT DEFAULT '[]'、archived_at INTEGER DEFAULT 0、completed_at INTEGER DEFAULT 0、revision INTEGER DEFAULT 1 | Workspace、验收标准、归档、完成时间、乐观锁 |
| CREATE artifacts | id、run_id、task_id、type、name、media_type、size_bytes、sha256、storage_path、origin、truncated、supersedes_id、redaction_state、created_at | Artifact 索引与元数据 |
| CREATE reviews | id、workspace_id、task_id、run_id、status、requested_by、reviewer_id、decision_note、evidence_snapshot_hash、requires_merge、no_merge_reason、created_at、started_at、decided_at、superseded_by、revision | 评审记录；字段以 api §9.3 与领域模型 §3.10 为准 |
| CREATE INDEX | tasks(status, updated_at)、tasks(archived_at)、tasks(parent_id)、tasks(workspace_id) | 查询性能 |

M1 建 `revision` 列并启用 409 `STALE_REVISION`；M1 不建 `evidence` 表（Evidence 从 M2 起）。上述 `workspaces` 表与 `tasks` 的 workspace_id、acceptance_criteria、archived_at、completed_at、revision 扩展，必须同步登记到 `api-and-data.md` 9.3；本章不另建第二套表名或同义列。

M2 计划迁移：

| 变更 | 内容 | 原因 |
|---|---|---|
| ALTER tasks | 增加 blocked_reason TEXT、deliverable_contract TEXT、template_id TEXT、template_version_snapshot TEXT、board_order INTEGER DEFAULT 0 | 阻塞、契约投影、模板快照、手动排序 |
| CREATE task_dependencies | task_id、depends_on_task_id、type、required_artifact_kinds、created_at，主键 (task_id, depends_on_task_id)，唯一索引 | 依赖唯一事实源；只支持 finish_to_start；不创建 tasks.depends_on 列 |
| CREATE task_comments | id、task_id、author、body、run_id、parent_id、resolved、created_at、updated_at | 评论 |
| CREATE task_views | id、name、scope、view_type、filters、sort、columns、created_by、created_at | 保存视图 |
| CREATE task_templates | id、name、role、version、payload、created_by、created_at | 模板 |
| CREATE task_events | id、task_id、actor、action、from_value、to_value、reason、created_at | 历史与审计 |
| CREATE VIRTUAL TABLE task_fts | title、description、labels | 全文搜索，任务量较大时启用 |

M3 计划迁移：增加 created_by；如启用多 Workspace，补充 Workspace 成员与可见性表；把任务与成员、项目关联；在 Postgres 上重建索引与约束；把 task_events 扩展为完整审计。M3 使用 Postgres，不再承诺 SQLite 指标计算。M4 的 schedules、webhooks、notifications、plugins 表由 `api-and-data.md` 9.3 与自动化模块定义，任务模块只记录 `trigger`、去重键与导入导出字段。迁移必须支持从 SQLite 导入，并提供回滚说明。

### 15.5 兼容性

字段新增采用可空或带默认值的方式，旧客户端忽略新字段即可继续工作。PATCH 的未知字段当前被忽略，保持这一行为。

- 路径：M1 起新端点只提供 `/api/v1`；`/api` 作为弃用兼容前缀保留到 M2，响应带 `Deprecation` 与 `Sunset` 头。任何新功能不得只挂在 `/api` 下。
- version/revision：M1 引入 `revision` 与 `If-Match`，冲突返回 409 `STALE_REVISION`；`version` 仅作请求输入别名，响应只返回 `revision`。M3 团队模式要求写请求必须携带 If-Match。
- 归档字段：存储为 `archived_at`，API 输出 `archivedAt`；唯一软删除字段，不设 `deletedAt` 第二列。M2.1 起归档进入 30 天恢复窗口。
- workspaceId：M1 新增，旧客户端忽略即可；M1 迁移为所有既有任务回填默认 Workspace `default`；`projectId` 仅作 M1-M2 的请求输入别名，响应不返回。
- 事件：M1 起使用带 `id`、`seq`、`v` 的信封；旧客户端若只解析 `type` 与 `data`，需在 M1 兼容期内同时收到这两个字段。
- 数据库：M1 迁移在空库与 M0 真实数据夹具上均可执行；破坏性变更必须提供迁移脚本与前端兼容窗口。

## 16. 异常与边界

| 场景 | 触发条件 | 系统行为 | 用户提示 | 里程碑 |
|---|---|---|---|---|
| 标题为空 | 创建或更新 | 返回 400，不写库 | "Title is required." | M0 |
| 标题过长 | 超过 200 字符 | 返回 400 | 显示允许长度 | M1 |
| 描述过大 | 超过 64KB | 返回 400 | 提示压缩或拆分 | M1 |
| 非法状态 | 传入未知值 | 返回 400 | 列出合法状态 | M0 |
| 非法流转 | PATCH 不允许的目标状态 | 返回 409 `INVALID_STATUS_TRANSITION` | 说明当前状态允许的目标 | M1 |
| Backlog 启动 Run | POST runs | 返回 409，不创建 Run | 提示先移动到 Todo 或 In Progress | M0 |
| 未绑定 Workspace 启动 Run | POST runs | 返回 409 `WORKSPACE_REQUIRED` | 提示先绑定 Workspace | M1 |
| 重复启动 Run | 已有活跃 Run | 返回 409 `RUN_ALREADY_ACTIVE` | 提示等待或取消现有 Run | M1 |
| 任务不存在 | GET/PATCH/DELETE 未知 ID | 返回 404 | 详情页显示不存在与返回入口 | M0 |
| 删除（软删除）有活跃 Run 的任务 | DELETE/archive | 返回 409，要求先取消 Run | 建议取消 Run 或等待结束 | M1 |
| 删除（软删除）有下游依赖的任务 | DELETE/archive | 二次确认并列出下游 | 已完成上游归档不阻塞；未完成上游归档会阻塞下游 | M2 |
| 依赖成环 | 添加依赖 | 返回 400 并列出环路径 | 高亮环 | M2 |
| 依赖任务被归档 | 归档 | 未完成上游：下游转 blocked；已完成/已取消上游：下游不变 | 提示受影响任务 | M2 |
| 服务重启 | 存在 running Run | 标记 interrupted 或 failed | 提示重新运行 | M1 |
| WebSocket 断线 | 网络中断 | M0 于 close 后 2 秒重连；M1 重连成功后执行一次全量刷新 | M1 顶部显示重连状态；恢复后消失 | M0 仅自动重连，M1 补齐刷新与状态 |
| 并发编辑 | If-Match 版本号不匹配 | M1 提示 updatedAt 变化；M2 返回 412 | 展示差异与刷新选项 | M1/M2 |
| 评审通过但未合并 | 点击 Approve | 任务保持 in_review | 提示「Review approved. Merge to complete.」 | M1 |
| 合并冲突 | 合并时目标分支变化或冲突 | 任务保持 in_review 或转 blocked，不产生部分合并 | 列出冲突文件与处理建议 | M1 |
| 离线或服务不可用 | 本地服务不可达 | 读缓存、拒绝写操作 | 顶部离线横幅并保留输入 | M1 |
| 批量部分失败 | 个别任务不合法 | 成功项生效，返回失败明细 | 可复制失败清单 | M2 |
| 搜索无结果 | 关键词无命中 | 返回空列表 | 提示清除筛选或更换关键词 | M1 |
| 时间跨时区 | 用户本地时区不同 | UTC 存储，本地渲染 | 显示本地时间与相对时间 | M0 已实现 |
| 描述包含疑似密钥 | 创建或更新 | 不阻断保存，标记提示 | 建议移除或使用环境变量 | M1 |

## 17. 权限与安全

### 17.1 本机模式（M0）

M0 默认只监听回环地址，但有两个入口需要区分：`cmd/ateam serve` 的默认地址是 `127.0.0.1:8787`；桌面壳 `apps/desktop/main.go` 调用 `StartLocal`，监听 `127.0.0.1:0` 随机端口。两者都没有账号、登录、会话和权限模型，任何能访问对应本机端口的进程都可以读写任务。当前 CORS 实现会反射任意 Origin，并允许 GET、POST、PATCH、DELETE 与 OPTIONS，这意味着用户浏览器中打开的恶意网页可能向本机 API 发起请求。M0 的缓解措施只有绑定回环地址，不足以防御浏览器侧攻击。

M1 先收紧 Origin/Host/CORS：只允许应用自身 origin，写操作校验 Origin。M2.1 起引入启动时生成的本地访问 token（bootstrap）：桌面壳或 Web 前端在加载时从同源接口或本地文件获取 token，后续请求携带 `Authorization` 头；对写操作同时校验 Origin 与 token。该变更不影响用户操作，但会改变外部脚本调用 API 的方式，需要在发布说明中明确。TASK-130 的验收同时覆盖固定端口与随机端口两种启动方式，不能只验证其中一种。

### 17.2 团队模式（M3）

| 角色 | 任务查看 | 创建任务 | 编辑任务 | 删除任务 | 管理模板 | 管理成员 | 合并/部署审批 |
|---|---|---|---|---|---|---|---|
| 组织 Owner | 全部 Workspace | 是 | 是 | 是 | 是 | 是 | 是 |
| 组织 Admin | 全部 Workspace | 是 | 是 | 是 | 是 | 是 | 是 |
| Workspace Admin（workspace_admin） | 本 Workspace | 是 | 是 | 是 | 是 | 是（本 Workspace） | 可审批 |
| Contributor | 本 Workspace | 是 | 自己创建或被指派 | 否 | 否 | 否 | 可发起，不可自批 |
| Reviewer | 本 Workspace | 否 | 否 | 否 | 否 | 否 | 可发起评审，不可自批 |
| Viewer | 本 Workspace | 否 | 否 | 否 | 否 | 否 | 否 |

组织 Member 默认不是任何 Workspace 的成员，必须先被加入某个 Workspace 并获得 Contributor/Reviewer/Viewer 角色才能访问其任务；不存在「组织 Member 自动可访问全部项目」的规则。M3 的任务级权限还区分创建者、处理人、评审人。Contributor 可以编辑自己创建或被指派的任务；编辑他人任务需要 Workspace Admin 或任务共享权限。Viewer 只能读取和评论（若开启评论权限），不能改变状态。

### 17.3 高风险动作审批

| 动作 | 规则 | 里程碑 |
|---|---|---|
| 归档/删除任务 | 人必须确认并看到影响清单；团队模式需 Owner 或 Admin | M1 本机确认，M3 角色校验 |
| 合并代码 | 评审通过后仍需独立合并确认；绑定评审记录与 head commit；Agent 只能准备合并说明 | M1 |
| 推送远端 | M2.1 只创建与消费审批记录，不执行远程 push；M3 才执行，并记录审计 | M2.1 审批，M3 执行 |
| 部署 staging | Agent 可执行，但必须有部署计划与人工批准记录 | M2 |
| 部署 prod | Agent 只能生成计划，必须人工执行 | M2 |
| 修改团队模板 | 需 Admin 权限并记录审计 | M3 |

审批门不得被模板、插件、自动化或 Webhook 绕过。任何「自动批准」配置都必须在 UI 中明确风险，并默认关闭。评审通过的 Review 记录不能替代合并审批；M1 的合并门要求单独的显式确认，M2 起使用 `approvalId` 与参数哈希绑定本次合并。

### 17.4 Agent 权限与任务边界

Agent 的 `allowedPaths` 与 `allowedCommands` 是任务执行边界的核心。任务描述、评论或 Artifact 中的路径提示不能扩大权限；Agent 只能在工作区与允许路径内读写，只能执行允许的命令。M2 在创建 Run 时把「Agent 权限」与「任务执行范围」求交集：任务执行范围来自交付物契约的 `executionScope`（模板建议路径与命令，用户可收窄），或 Run 级显式覆盖；两者都没有时不得默认全量放开。

交集为空时拒绝启动并返回 `403 POLICY_DENIED`，details 说明空的是路径还是命令，以及如何调整任务或 Agent；路径越界或命令不在白名单时，Runtime 层拒绝并产生安全事件，Run 失败并记录结构化原因。任务侧没有权限字段时，不得把「任务未声明范围」解释为「允许全部」。

角色 Agent 的越权行为按以下方式处理：越权读取被 Runtime 或 Workspace 层拦截，Run 失败并记录事件；越权写入被拒绝并产生安全事件；重复越权触发任务阻塞，要求人工检查 Agent 配置。M2 的 DevOps 模板必须显式限制 prod 凭据不可用。

### 17.5 数据安全与脱敏

任务描述、评论、Run 日志、diff 和 Artifact 都可能包含敏感信息。产品要求：不在任务中存储密钥；UI 对常见密钥格式提示；Run 日志采集时对疑似 token 做遮蔽；Artifact 预览默认隐藏疑似密钥；单任务证据导出在 M1 提供，任务与证据的可移植导入导出在 M4 提供（TASK-143），两者在导出前都必须提示并扫描敏感信息。

本地数据目录的权限应限制为当前用户可读写。M3 团队模式的数据库与对象存储需要加密传输和访问控制；Postgres 连接凭据不得写入任务或日志。遥测在 M4 必须 opt-in，默认关闭，且不采集任务内容、代码和文件路径。

## 18. 指标

### 18.1 核心指标

任务模块的北极星指标是「每周完成且带证据的任务数」。它同时反映任务创建、执行、评审和证据链是否真的被使用，而不是只看创建量。

| 指标 | 定义 | 用途 | 目标方向 |
|---|---|---|---|
| 任务创建到首次 Run 转化率 | 创建后 24 小时内启动过 Run 的任务数除以新建任务数 | 判断任务是否具备可执行性 | M1 后持续提升 |
| 任务周期时间 | `completedAt - createdAt` 的中位数，排除 cancelled 与归档任务；M1 起 `completedAt` 在进入 done 时写入，重开时清空 | 衡量从想法到交付的效率 | 逐版本下降 |
| Run 成功率 | completed 数除以 completed 与 failed 之和，不含 cancelled | 衡量执行稳定性 | 提升 |
| 评审等待时间 | 首次评审动作时间减最近一次 Run completed 时间 | 衡量人工瓶颈 | 下降 |
| 一次通过率 | 首次评审即 Approve 的任务数除以进入评审的任务数 | 衡量交付质量 | 提升 |
| 证据完备率 | Done 且必需 Evidence 全部 passed 或 waived 的任务数除以 Done 任务数 | 衡量 DoD 执行情况 | 提升 |
| 返工率 | 30 天内重新打开的 Done 任务数除以 Done 任务数 | 衡量完成质量 | 下降 |
| 依赖阻塞时长 | 任务从进入 blocked 到解除 blocked 的时间中位数，由 task_events 或状态历史计算 | 衡量 DAG 健康度 | 下降 |
| 看板活跃任务数 | 同时处于 Todo、In Progress、In Review 的任务数 | 衡量并行度与注意力负载 | 按用户分层观察 |

### 18.2 性能预算

| 场景 | 指标 | 目标 |
|---|---|---|
| 看板首次加载（1,000 任务） | P95 | 小于 500ms |
| 筛选或搜索 | P95 | 小于 300ms |
| 拖拽本地反馈 | 首帧 | 小于 16ms |
| 状态更新往返 | P95 | 小于 200ms |
| 任务详情首屏 | P95 | 小于 800ms |
| WebSocket 事件到卡片更新 | P95 | 小于 300ms |
| DAG 视图渲染（200 节点） | P95 | 小于 1s |

### 18.3 埋点与隐私

M0-M2 的指标从本地 SQLite 计算，不上传；M3 团队模式使用 Postgres，指标从控制面数据库计算，但仍不默认上传到厂商云端。M4 若提供遥测，必须默认关闭、明确告知采集字段、支持一键导出和删除。任务标题、描述、评论、文件路径、代码内容一律不进入遥测；只采集匿名计数、耗时、错误码和功能使用开关。

## 19. 依赖与风险

### 19.1 模块依赖

| 依赖模块 | 依赖内容 | 影响 |
|---|---|---|
| 《Agent 体系》 | 处理人校验、运行配置、并发与超时、allowedPaths/Commands | 任务指派与 Run 启动依赖 Agent 存在且可用 |
| 《Runtime、机器与工作区》 | Run 创建、状态、事件、取消、超时、重试、Workspace 与 worktree | 任务详情页的 Run 区域、证据来源与 Workspace 绑定 |
| 《角色 Agent 协作与评审》 | 评审记录、合并门、审批门、证据化 DoD、交付物契约 | 任务进入 done 的门禁与角色链路 |
| 《API、数据与 CLI》 | 接口契约、WebSocket 事件、错误码、数据表与迁移 | 前后端一致性、实时更新与字段演进 |
| 《安全、权限与治理》 | 本机 token、团队 RBAC、审批规则、审计 | M1 本机安全与 M3 团队治理 |
| 《界面与交互》 | 看板、列表、详情、空状态、离线与冲突提示 | 任务模块的视觉与交互一致性 |
| 《非功能需求》 | 性能、可靠性、可用性、兼容性预算 | 指标与性能验收 |
| 数据库迁移 | SQLite 迁移、Postgres 迁移 | 字段与表的演进 |

### 19.2 风险

| 风险 | 影响 | 可能性 | 缓解 |
|---|---|---|---|
| 状态机过严导致用户绕过 | 用户直接改 done，证据链失效 | 中 | 提供 No merge required 豁免并记录理由，保留审计 |
| M0 看板不显示 blocked/cancelled | 任务看似消失，用户不信任看板 | 高 | M1 必须修复并加入可见性测试 |
| 同一任务并发 Run | 多 worktree 冲突、证据归属混乱 | 中 | M1 默认单活跃 Run，M2 显式放开并警告 |
| 无分页与筛选 | 任务增长后卡顿 | 高 | M1 服务端查询与 cursor 分页 |
| 本地 API 无鉴权且 CORS 反射 Origin | 恶意网页可读写本机任务 | 中 | M1 本地 token 与 origin allowlist |
| Run 与 Task 无外键 | M0 删除任务产生孤儿 Run | 高 | M1 改为软删除并增加孤儿清理任务 |
| 依赖 DAG 复杂难懂 | 用户不理解阻塞，绕过流程 | 中 | 阻塞原因、DAG 视图、模板化常用链路 |
| 证据存储膨胀 | 本地磁盘被占满 | 中 | 配额、压缩、清理策略与提示 |
| 模板与契约过度设计 | 小团队使用负担重 | 中 | 模板可选、默认轻量、逐步启用 |
| 自动流转误判 | 任务提前进入评审或 done | 中 | 自动流转只允许进入 in_review；Done 永远需要人工评审与合并门 |
| 评审与合并语义混淆 | 未合并代码被看板标记 Done | 高 | 评审门与合并门分离；合并成功或显式 No merge required 才写 done；TASK-033/034 覆盖验收 |
| 归档任务错误阻塞下游 | 依赖链被重新打开，调度混乱 | 中 | done 归档维持满足；cancelled 归档维持不满足；只有未完成上游归档才新增阻塞 |
| WebSocket 全量刷新 | 大数据量下抖动 | 中 | M1 增量事件与缺口检测 |
| 时间与时区处理 | 显示错乱、排序异常 | 低 | UTC 存储、本地渲染、统一格式化 |

## 20. 里程碑映射

### 20.1 M0（已完成骨架）

M0 在任务与看板模块中已交付：

- Task 领域对象与 SQLite `tasks` 表，字段包括 id、title、description、status、priority、assigneeType、assigneeId、parentId、labels、createdAt、updatedAt。
- 七个状态枚举与合法性校验；todo、in_progress、in_review 判定为可执行。
- 任务 CRUD API，PATCH 支持字段级局部更新。
- Backlog 不触发 Agent 的双重校验：API 与调度器各一次。
- 启动 Run 时自动写入处理 Agent，并把 todo 转为 in_progress。
- 看板五列、列计数、拖拽改状态、空列提示、快速创建弹窗。
- 任务详情页展示描述、状态切换、Run 列表、Agent 选择、启动/取消 Run、Run 日志轮询（1.5 秒）。
- WebSocket 事件驱动的全量刷新与 close 后 2 秒自动重连；任务不存在页面。M0 没有重连后的全量刷新，也没有顶部重连状态，这两项属于 M1。
- 明确缺口：blocked 与 cancelled 无看板列；状态下拉只有五个选项；优先级、标签、处理人、父任务、Workspace 无 UI；无删除入口；无筛选、搜索、排序、保存视图；无批量、归档；无验收标准、依赖、评论、Artifact、Evidence、diff、评审、合并；无并发 Run 限制；无版本冲突控制；无分页；删除接口无引用保护。

### 20.2 M1（本地闭环）

本模块 M1 交付：

- Workspace 绑定：Task.workspaceId、默认 Workspace、创建/详情 Workspace 选择与 `WORKSPACE_REQUIRED` 校验（TASK-013）。
- 完整字段编辑与校验：priority、labels、assignee、parentId、acceptanceCriteria、completedAt。
- 服务端状态流转矩阵（与 api-and-data 13.1 一致）；Run completed 默认自动进入 in_review；done 的评审门与合并门分离（TASK-024、TASK-025、TASK-033 至 TASK-036）。
- blocked 与 cancelled 的看板可见性与筛选。
- 列表视图、筛选、搜索、排序、URL 状态；服务端 cursor 分页（TASK-054）。
- 拖拽乐观更新与失败回滚；详情页内联编辑；骨架屏与按钮 loading（TASK-137）。
- Run diff、Artifact、Evidence 的最小闭环；独立 Review 记录；Approve、Request changes、合并对话框与 No merge required 豁免（TASK-064 至 TASK-073）。
- 单任务归档（软删除）、已归档筛选与影响清单（TASK-055、TASK-115、TASK-116、TASK-117）；恢复入口在 M2。
- task.* 事件增量更新、重连后全量刷新与重连状态（TASK-057、TASK-127）。
- 单活跃 Run 限制；服务重启后的 interrupted Run 处理；Run 失败/超时/取消的任务级展示（TASK-036、TASK-125）。
- 本机 API token 与 CORS 收紧；离线横幅与写操作拒绝（TASK-136、TASK-139）。
- 退出标准：完成 10 个任务从创建、评审、合并到 done 的端到端验证；1,000 任务性能达标；无 P0 缺陷；软删除不产生孤儿 Run（恢复入口在 M2 验证）；未合并任务不得显示 Done。

### 20.3 M2（角色 Agent 协作）

本模块 M2 交付：

- 任务依赖 DAG：`task_dependencies` 唯一事实源、环检测、阻塞与解除、可执行判定、DAG 视图（TASK-095 至 TASK-104）。
- 交付物契约与六个内置模板；角色 Agent 的 DoD 基线；模板快照（TASK-083 至 TASK-090）。
- 审批门：staging 部署审批、部署计划审批与 prod 人工执行门；prod 仅计划且必须人工执行。M1 已交付的合并门与软删除确认不再重复实现，M2 只增加 approvalId、参数哈希与消费语义。
- 评论线程；保存视图；批量状态、指派、标签、归档、恢复（TASK-110 至 TASK-115）。
- 用 Agent 创建任务草稿；从失败 Run 创建跟进任务（TASK-085 至 TASK-087）。
- task_events 与轻量历史；`revision` 乐观锁与 409 `STALE_REVISION` 冲突提示（TASK-029、TASK-122）。
- 看板手动排序 boardOrder（TASK-058）。
- Crew/队长模式后置开放，队长只拆任务、不代写代码。
- 退出标准：完成 UI Design → Frontend/Backend → DevOps Staging 的角色链路演示；依赖阻塞不可绕过；审批门记录完整；无 Agent 自主 prod 操作；revision 冲突不覆盖新数据。

### 20.4 M3（团队模式）

本模块 M3 交付：

- 多 Workspace 与跨项目移动（TASK-014）；任务归属、共享视图、成员可见性。M1 已完成单 Workspace 绑定，M3 不再重复实现 workspaceId。
- RBAC：Owner、Admin、Member、Viewer；删除与模板管理权限（TASK-131）。
- Postgres 迁移与任务查询适配；团队级索引与审计（TASK-118、TASK-135）。
- 任务审计日志与导出；GitHub PR 关联（TASK-119）。
- 多人并发编辑的 If-Match 强制校验与冲突解决（TASK-122）。
- 远程 Runner 下的任务分派与状态同步（TASK-059）。
- 权限不足的只读模式与申请入口（TASK-075）。
- 退出标准：5 人团队并发使用；权限矩阵测试通过；审计可追溯；Postgres 数据与任务语义一致（不再要求与 SQLite 双写一致）。

### 20.5 M4（自动化与分发）

本模块 M4 交付：

- 定时与 Webhook 自动创建任务；自动创建默认进入 Backlog，除非规则显式指定（TASK-140）。
- 通知中心：任务阻塞、评审请求、Run 失败、依赖解除（TASK-141）。
- 插件 API：任务事件订阅、只读任务查询、审批门附加检查（TASK-142）。
- 导入导出：任务与证据的便携格式；导出前敏感信息检查（TASK-143）。
- 遥测 opt-in 与隐私开关（TASK-144）。
- 退出标准：Webhook 创建任务端到端可用；通知不丢不重；插件不能绕过审批门；导出不含密钥；遥测关闭时无上报；打包版本升级不破坏任务数据。上述退出标准均可由 TASK-140 至 TASK-144 的验收项覆盖。

## 21. 与其他文档的关系

本章是 `prd/modules/` 下任务模块的主文档，与其他模块文档的分工如下。以下标题与仓库实际文件一致。

- 《Agent 体系》（`prd/modules/agent-system.md`）定义 Agent 的 instructions、runtime、model、workspaceMode、maxConcurrency、timeoutMinutes、allowedPaths、allowedCommands、角色与技能。本章只消费 Agent ID、可用性与执行范围，不重复定义 Agent 字段。
- 《Runtime、机器与工作区》（`prd/modules/runtime-and-workspace.md`）定义 Run 的排队、准备、执行、取消、超时、重试、事件流、Workspace 与 git worktree。本章定义任务如何启动 Run、聚合 Run 记录，以及 Run 完成对任务状态的影响边界。
- 《角色 Agent 协作与评审》（`prd/modules/collaboration-and-review.md`）定义交付物契约、任务 DAG、审批门、证据化 DoD、评审记录、合并门与 Crew。本章第 9、10、11 章与之对接；评审门与合并门的语义以该文档为准。
- 《API、数据与 CLI》（`prd/modules/api-and-data.md`）定义 REST 路径、请求响应 schema、错误码、分页、WebSocket 事件、数据表与 CLI。本章第 15 章是任务域的需求输入，最终契约以该文档为准。
- 《安全、权限与治理》（`prd/modules/security-and-permissions.md`）定义本机 token、团队 RBAC、审批规则与审计。本章第 17 章是任务域的权限需求，系统级策略以该文档为准。
- 《界面与交互》（`prd/modules/ui-ux.md`）定义看板、卡片、列表、详情页的视觉规范、组件、空状态与离线提示。本章定义信息架构与交互规则，视觉细节以该文档为准。
- 《非功能需求》（`prd/modules/non-functional-requirements.md`）定义性能、可靠性、可用性、兼容性与可访问性预算。本章第 18 章只给出任务域的指标，系统级预算以该文档为准。
- `prd/milestones/` 下现存的里程碑文档为 `M0-scaffold.md`、`M1-local-loop.md`、`M2-role-agents.md`、`M3-team-mode.md`、`M4-automation-and-packaging.md`。它们负责目标、范围、演示脚本、依赖、风险和退出标准；本模块第 20 章提供任务域的交付映射，里程碑细节不在此重复展开。M2 文档引用的 TASK-025、TASK-083 至 TASK-086、TASK-095 至 TASK-099 与本章编号一致，保持不变；M1 文档中的 TASK-001/002/003 属于里程碑局部编号，需改为 `M1-TASK-001` 至 `M1-TASK-003`，避免与本章的 TASK-001/002/003 冲突。

## 22. 已决定事项与待确认事项

### 22.1 已决定事项（写入正文，不再作为待确认）

以下事项已经拍板，正文按此实现，不再在第 22 章重复列为 TBD：

- Run completed 后任务默认自动进入 in_review，`auto_move_to_review` 可关闭，永不自动 done（R4、TASK-024）。
- 同一任务默认只允许一个活跃 Run，M2 可通过任务级策略显式放开（R8、TASK-030）。
- 评审记录在 M1 独立存储，评论与 diff 行内评论属于 M2；M1 评审不依赖评论线程（7.3、TASK-067）。
- 归档与软删除是同一机制，字段为 `archived_at`；M1 不提供任务硬删除（4.2、12.3、TASK-117）。
- done/cancelled 任务归档不改变既有依赖满足状态（done 仍满足，cancelled 仍不满足）；只有未完成任务归档才新增下游阻塞（5.2、9.5、12.2、TASK-100）。
- `revision` 与 If-Match 从 M1 启用；冲突返回 409 `STALE_REVISION`（4.2、13.4、TASK-122）。
- workspaceId 从 M1 启用，单 Workspace 自动选择；M3 才支持多 Workspace 与跨项目移动（4.2、4.6、TASK-013、TASK-014）。
- 交付物契约在 M2 以内嵌 JSON 存储，M3 再评估独立表；`reviewPolicy` 只控制进入 in_review，不能控制 Done（10.2）。
- Artifact 默认单文件 50 MiB、单任务 500MB，默认不自动删除（11.4）。
- 界面文案统一英文，PRD 中的中文只解释语义（6.1、13.1）。
- M1 离线策略是只读缓存加拒绝写入，不做离线写队列（13.5、TASK-139）。

### 22.2 待确认事项（未拍板，不得作为实现依据）

以下问题仍需产品、工程和设计确认。在拍板前，正文不得以肯定语气实现对应行为，也不得为它们分配 FR 编号：

1. blocked 与 cancelled 在看板中的最终视觉呈现：独立列、可折叠辅助区，还是仅通过筛选和列表查看。M1 暂以可折叠辅助区为实现默认，视觉形式可调整，但 TASK-031 的可见性验收不变。
2. 任务 ID 是否引入人可读短编号，例如 AT-123。当前为 24 位十六进制，卡片显示前四位，存在碰撞展示风险；需要确认编号生成规则、可编辑性和迁移方案。
3. 硬删除策略与 Run 历史保留期限。当前建议有 Run 即只允许归档，但长期用户需要清理机制；需要确认清理入口、保留期和导出能力。
4. 任务描述是否支持 Markdown 渲染与富文本编辑。当前存储纯文本，M1 至少支持 Markdown 预览，是否需要所见即所得编辑器待定。
5. 指标口径中的任务周期时间是否额外提供一个「进入 Todo 后周期」，与全生命周期并存。
6. 内置模板是否允许用户覆盖，以及团队共享模板的权限边界。
7. 保存视图是否允许 Viewer 创建个人视图；团队视图的审批与共享范围。
8. 团队模式中任务与远程 Runner 的绑定方式、机器选择与失败重试规则，需要与《Runtime、机器与工作区》《安全、权限与治理》共同确认。
9. Workspace 归档后的批量恢复交互与保留期限；是否提供项目级回收站。
10. 未来是否引入离线写队列或「草稿另存」；M1-M2 明确不做，M4 之前不重新评估。
