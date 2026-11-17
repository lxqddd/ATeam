# 04 验收标准与测试计划

## 本章导读

本章定义 ATeam 的验收标准与测试计划，回答三个问题：一个需求做到什么程度才算完成、每个里程碑如何证明它真的完成、以及用什么测试手段防止已完成的能力回退。读者是产品经理、工程师、设计师、评审人和决策者。验收对象覆盖 Task、Workspace、Agent、Run、Run Workspace、Runtime、Artifact/Evidence、协作与审批、UI、API、安全与体验质量。

本章严格区分「当前已实现（M0）」与「计划中（M1-M4）」。M0 的结论来自 2026-11-17 在本仓库实际执行的构建、测试和接口冒烟验证；M1 及之后的验收标准是待实现目标，不能当作已有能力引用。所有验收项都必须绑定可复现的证据，而不是口头描述或演示截图本身。

阅读建议：产品经理关注第 1、3、4、8、11 节；工程师关注第 3、5、6、7、9 节；评审人重点关注第 4 节的里程碑演示脚本与第 8 节的验收记录模板。

## 1. 验收原则

### 1.1 证据化完成（Evidence-based Done）

ATeam 采用证据化完成定义：一条功能需求只有在同时满足「实现存在、行为可观察、证据可复现、评审人确认」四项条件时才算完成。任何一条缺失，状态只能是「进行中」或「有条件通过」，不能标记为完成。

证据必须是仓库内可追溯的制品或可重复执行的命令输出，包括：

| 证据类型 | 具体形式 | 适用场景 | 存放位置 |
|---|---|---|---|
| 自动化测试证据 | `go test`、`go test -race`、Vitest、Playwright 的退出码与报告 | 单元、集成、E2E、回归 | CI 日志 / `prd/evidence/` 归档 |
| 接口证据 | HTTP 状态码、响应 JSON、WebSocket 事件序列 | API、事件、Run 生命周期 | 验收记录中的命令与输出摘要 |
| 构建证据 | 二进制、前端产物、安装包、校验和 | 构建、打包、分发 | CI artifact / Release |
| 行为证据 | 截图或录屏、事件日志、diff、测试报告、Artifact | UI、评审、证据化 DoD | Run 详情 / 验收记录 |
| 审批证据 | 审批人、时间、动作、对象、结果 | 合并、推送、部署、删除 | 审批记录与审计日志 |
| 回归证据 | 缺陷编号、复现用例、修复前后结果 | 缺陷修复与发布准入 | 测试报告 |

判定规则：没有证据的功能一律视为未完成；只有代码没有测试或演示，最多判定为「有条件通过」；只有演示没有可重复步骤，不计入验收。AI Agent 产出的总结不是证据，必须由 Runtime 日志、diff、测试输出或 Artifact 支撑。

### 1.2 可演示

每个里程碑必须提供一段可在干净环境重复执行的演示脚本。演示脚本不是营销演示，而是验收脚本：步骤、命令、预期结果、失败判定和证据采集方式都要写明。演示时长控制在 15 分钟以内，超出部分拆分为自动化回归或单独的性能、安全验证。演示必须使用示例仓库或专用测试数据，不允许拿真实用户项目做不可回滚的演示。

演示成功的标准是「换一个人按脚本执行也能得到相同结果」。如果演示依赖演示者记忆、手工修数据库、临时改代码或未提交的本地状态，则判定为不可演示。

### 1.3 可回归

所有验收通过的用例都要版本化。新增功能必须同时新增或更新验收用例；修复缺陷必须新增回归用例，并在缺陷记录中关联用例编号。回归用例优先自动化，无法自动化的进入手工 checklist，并注明执行频率与责任人。

回归的基本要求：

- 单元与集成测试必须确定性执行，不依赖公网、不依赖真实用户目录、不依赖系统时间。
- 测试数据使用固定 fixture，随机数据必须固定随机种子。
- 涉及并发的用例必须显式控制并发度与等待条件，禁止用固定 `sleep` 作为唯一同步手段。
- 每次发布前执行全量回归；每次合并前至少执行受影响模块的回归集。

### 1.4 风险分级与人工门

验收按风险分级，高风险动作不允许由 Agent 或自动化流程自行批准。以下动作必须留下人工确认或审批记录，未获批准时服务端必须拒绝：

- 合并到受保护分支：M1 起必须 Review approved + 显式确认 + MergeRecord；M2.1 起升级为 Approval。Agent 调用合并接口必须返回 403。
- 推送远程（M2.1 只创建/消费审批记录、M3 才执行）、部署到 staging、删除 Workspace（M3 团队 Workspace 删除必须 Approval，见 AC-SEC-10）、扩大 Agent 路径或命令权限、轮换或撤销 Secret：M2.1 起必须 Approval 或显式确认并写审计。staging 不因环境级别较低而豁免，部署前必须有人工批准 deploy_plan。Task/Agent 删除不生成 Approval：M1 为二次确认 + 影响面展示 + 活跃 Run 阻止 + 归档；M2.1 起进入 30 天恢复窗口（AC-TASK-08）。
- 部署到 prod：只审批部署计划并记录人工回填结果；执行必须在 ATeam 之外由人完成，ATeam 不保存生产凭据，也不提供 Agent 执行入口。
- 删除 Team Workspace：M3 起要求双人审批、输入名称确认与回收站，不能与删除本地 Task 共用同一套轻量确认。

M1 的合并确认以 Review + MergeRecord 承担，不伪造 Approval 记录；M2.1 起 Approval 是授权、MergeRecord 是执行结果，两者通过 `approvalId` 关联。

| 等级 | 定义 | 示例 | 验收要求 |
|---|---|---|---|
| S0 阻断 | 数据丢失、越权执行、密钥泄露、主分支被污染 | 未审批的 merge、路径逃逸写文件 | 必须修复并有负向测试，禁止带缺陷发布 |
| S1 严重 | 核心闭环不可用或状态错误 | Run 取消后仍执行、任务状态错乱 | 必须修复并回归，发布前关闭 |
| S2 一般 | 局部功能异常但有绕过方式 | 某个筛选条件失效、日志缺少字段 | 可带已知问题发布，需记录并排期 |
| S3 轻微 | 文案、样式、非关键提示 | 对齐偏差、提示语不通顺 | 可进入后续迭代 |

人工门的验收不只看「有没有按钮」，还要看「没有审批时后端是否拒绝」。前端隐藏按钮不算权限控制；所有高风险动作必须在服务端再次校验审批状态。

### 1.5 当前实现与计划实现的区分

本章所有条目带「阶段」标记：

- M0：当前仓库已存在的行为，按第 9 节的实际验证结果判定。
- M1-M4：计划行为，只有对应里程碑实现并通过验收后才能改为「已通过」。
- M2 按路线图拆为 M2.1（DAG、契约、权限信封、审批门、本地审计、并行调度）与 M2.2（Crew/队长）；本章标「M2」的条目默认指 M2.1，Crew 相关条目单独标注 M2 后段。
- 「部分实现」表示数据结构或接口存在，但关键语义未实现，例如当前 Agent 保存了 `workspaceMode`，但 Run Workspace 仍只创建普通目录。

任何文档、演示或对外说明都不得把计划能力写成已实现能力。评审时如发现「文档超前于代码」，按文档缺陷处理并回退描述。

### 1.6 验收状态与判定

| 状态 | 含义 | 后续动作 |
|---|---|---|
| 通过 | 全部验收项通过，证据齐全 | 可签署里程碑退出 |
| 有条件通过 | 主路径通过，存在已记录的 S2/S3 问题或有限范围内的未验证项 | 明确条件、责任人与关闭时间 |
| 不通过 | 存在 S0/S1 问题，或核心验收项缺失 | 阻断发布，修复后重新验收 |
| 阻塞 | 依赖未就绪，无法执行验收 | 记录阻塞原因与解除条件 |
| 不适用 | 该阶段不涉及 | 必须写明原因，不能留空 |

里程碑退出采用「零 S0、零未关闭 S1、S2 有明确排期」的硬规则。M0 作为骨架允许有条件通过，但 M1 的核心语义缺陷不能继承到 M1 退出。

## 2. 验收范围、角色与追踪链

### 2.1 验收范围

本章覆盖：

- 核心对象与闭环：Task、Workspace（仓库绑定）、Agent、Run、Run Workspace、Runtime、Artifact/Evidence、Review、Merge。
- 角色协作：任务 DAG、交付物契约、角色模板、路径与命令权限、审批门、Crew/队长、收件箱。
- 产品界面：看板、任务详情、Agent 管理、Run 列表、设置、评审与审批界面。
- 接口与事件：REST、WebSocket、错误模型、事件顺序与恢复。
- 安全与治理：本地优先边界、路径约束、命令约束、密钥、审批、审计。
- 非功能质量：性能、可靠性、可移植性、可访问性、可观测性、资源与容量、离线与网络、成本、打包与升级。

不在本章展开：第三方产品的功能对照、模型能力评测、具体实现代码讲解、商业定价与市场策略。这些不属于验收口径。

### 2.2 验收角色

| 角色 | 职责 | 能否单独签署 |
|---|---|---|
| 产品经理 | 维护验收标准与范围，确认用户价值与演示脚本 | 可以，需与工程共同签署 |
| 工程师 | 提供实现、自动化测试、构建与运行证据 | 不能单独签署 |
| 设计师 | 验收界面一致性、可用性与可访问性 | 仅 UI 相关项 |
| 评审人 / 人类审批者 | 对 diff、Artifact、合并与部署做人工判断 | 可以，仅限其权限范围 |
| 安全负责人 | 验收权限、密钥、审计与高风险动作 | 仅安全相关项 |
| Agent | 执行任务并提交证据 | 不能作为验收人 |

Agent 可以生成测试报告草稿、截图和 diff 摘要，但不能给自己签发验收结论。角色化 Agent 的产出必须经过人类评审或明确的上游验收门。

### 2.3 追踪链

验收追踪链固定为：产品目标 → 模块 FR → 验收用例 AC → 测试用例 TC → 证据 → 签署记录。任何一环缺失都要在验收记录中标明。模块文档是 FR 的权威来源；本章不重复 FR 细节，只定义「如何证明 FR 达标」。

## 3. 按模块的验收标准

### 3.1 FR 引用约定

本章引用 `prd/modules/` 下各模块文档中已经定义的 FR 编号。模块文档是 FR 的权威来源；本章表格保留需求语义，编号调整时只需同步「引用 FR」列，不改变验收用例本身的判定逻辑。评审时必须核对模块文档版本，并在验收记录中写明对齐后的编号。

本章第 3 节表格中的 TASK、AGENT、RUN、COLLAB、UI、SEC、API、NFR 编号默认指 `prd/modules/` 下对应模块文档。`prd/02-domain-model.md` 自 2026-11 修订起只定义 `DM-` 前缀的领域需求（如 DM-TASK、DM-RUN、DM-REV、DM-MRG、DM-APPR），引用时必须写全「02-domain-model DM-REV-001」，不能只写裸编号。`prd/03-user-flows.md` 自同期修订起使用独占的 FLOW- 前缀（FLOW-A～FLOW-F 按流程、FLOW-X 为跨流程、FLOW-N 为非功能）；该文档第 135 行已明确旧版 TASK-/AGENT-/RUN-/SEC-/COLLAB-/UI-/API-/NFR- 编号全部停用，只保留 FLOW- 编号。验收用例引用用户流程文档时使用 FLOW- 编号，不得再去该文档查找旧号段。如果模块文档与领域模型出现同名编号，以模块文档为准；实体字段与状态机以 02-domain-model 为准，并在评审中统一。

REST、WebSocket、错误模型、分页、迁移与 CLI 的接口规则由 `prd/modules/api-and-data.md` 统一定义；本章第 3.7 节引用该文档的 API 编号，不另行发明接口需求。

| 文档 | FR 前缀 | 本章引用范围 | 核心验收关注点 |
|---|---|---|---|
| `prd/modules/task-management.md` | TASK | TASK-001～TASK-144 | 上下文容器、状态机、看板、DAG、删除保护 |
| `prd/modules/agent-system.md` | AGENT | AGENT-001～AGENT-073 | 可复用配置、版本、技能、权限字段、运行时选择 |
| `prd/modules/runtime-and-workspace.md` | RUN | RUN-001～RUN-118 | 执行、调度、取消、超时、工作区、Runtime、Artifact |
| `prd/modules/collaboration-and-review.md` | COLLAB | COLLAB-001～COLLAB-087 | DAG、交付物契约、审批门、Crew、证据化 DoD |
| `prd/modules/ui-ux.md` | UI | UI-001～UI-143 | 看板、详情、评审、审批、收件箱、可访问性 |
| `prd/modules/security-and-permissions.md` | SEC | SEC-001～SEC-080 | 本地边界、路径、命令、密钥、审批、审计、供应链 |
| `prd/modules/api-and-data.md` | API | API-1001～API-1299（M4 至 API-1399） | REST、WebSocket、错误模型、分页、迁移、CLI、类型契约 |
| `prd/modules/non-functional-requirements.md` | NFR-PERF、NFR-REL、NFR-PORT、NFR-OBS、NFR-RES、NFR-NET、NFR-COST、NFR-PKG、NFR-SEC | 各子族全部条目 | 性能、可靠性、可移植性、可观测性、资源、离线、成本、打包、非功能安全 |
| `prd/02-domain-model.md` | DM-（DM-PROJ、DM-TASK、DM-RUN、DM-REV、DM-MRG、DM-APPR 等） | 第 3 节中与状态机、快照、审批相关的条目 | 状态转换、对象快照、权限默认值、审批指纹、单活跃 Run、软删除 |
| `prd/03-user-flows.md` | FLOW-A、FLOW-B、FLOW-C、FLOW-D、FLOW-E、FLOW-F、FLOW-X、FLOW-N | FLOW-A-001～FLOW-A-022、FLOW-B-001～FLOW-B-020、FLOW-C-001～FLOW-C-012、FLOW-D-001～FLOW-D-020、FLOW-E-001～FLOW-E-018、FLOW-F-001～FLOW-F-017、FLOW-X-001～FLOW-X-046、FLOW-N-001～FLOW-N-008 | 主流程、跨角色流程、审批状态、删除归档、失败恢复 |
| `prd/milestones/M3-team-mode.md`、`prd/milestones/M4-automation-and-packaging.md` | TEAM、M4-AUTO、M4-HOOK、M4-NOTIFY、M4-PKG、M4-UPD、M4-PLUG、M4-TEL | 第 3.12、3.13 节 | 团队模式与自动化分发的里程碑级验收 |

`prd/02-domain-model.md` 提供状态机、对象快照和权限默认值的对照基线，`prd/03-user-flows.md` 提供主流程与跨角色流程的演示依据；两者的 FLOW- 与 DM- 编号都不替代模块文档的 FR 权威性。

FLOW 需求与本章 AC 的覆盖关系如下，便于评审时双向核对：

| FLOW 范围 | 主要覆盖的验收项 |
|---|---|
| FLOW-A-001～022 单人本地闭环 | AC-TASK-01～05、AC-RUN-01～04、AC-UI-01/02、AC-PROJ-01 |
| FLOW-B-001～020 角色 Agent 流水线 | AC-COLLAB-02/03、AC-AGENT-05/06、AC-REVIEW-01 |
| FLOW-C-001～012 Crew/队长 | AC-COLLAB-07/08 |
| FLOW-D-001～020 评审、审批与合并 | AC-REVIEW-01/02、AC-MERGE-01/02、AC-COLLAB-04/05 |
| FLOW-E-001～018 失败恢复 | AC-RUN-04～06/11、AC-API-05 |
| FLOW-F-001～017 团队模式 | AC-TEAM-01～06 |
| FLOW-X-001～046 跨流程规则 | AC-TASK-08、AC-SEC-05/10、AC-PROJ-01、AC-MERGE-02 |
| FLOW-N-001～008 非功能 | AC-NFR-01～10、AC-UI-08/09 |

**阶段标注规则**：每一行的「阶段」取该行引用 FR 的最高里程碑，不得把 M1/M2 需求标成 M0。若同一行同时包含 M0 已实现与后续目标，必须写成「M0（子项）/M1（子项）」并逐条列出子项；M0 子项只能描述当前代码可观察到的行为。评审发现阶段与 FR 阶段不一致时，按 AC 缺陷处理并回写本表。

**多断言记录规则**：一行包含多个独立断言时，验收记录必须逐条标注「满足 / 不满足 / 未验证」，不能只写整行「通过」；M1 核心闭环的 AC-RUN-12、AC-REVIEW-01/02、AC-MERGE-01 已用 Given/When/Then 或 (a)(b)(c) 子项拆分，后续新增核心 AC 沿用同一写法。

### 3.2 Task 模块验收

Task 是上下文容器，验收重点是「信息完整、状态可解释、与 Run 的关联可追溯」。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-TASK-01 | TASK-001、TASK-004、TASK-005、TASK-006、TASK-120 | 创建任务后返回 201 与完整对象；必填标题为空返回 400；读取、更新行为符合 200/404 约定；对无 Run 的任务删除返回 204，删除后读取返回 404；重启进程后数据仍存在 | API 响应与 SQLite 重启记录 | M0（删除保护见 AC-TASK-08） |
| AC-TASK-02 | M0 子项：TASK-020、TASK-021、TASK-022；M1 子项：TASK-032、02-domain-model DM-TASK-003、DM-TASK-004 | M0 子项：状态只能是 backlog、todo、in_progress、in_review、done、blocked、cancelled；非法状态返回 400；backlog、done、blocked、cancelled 不允许直接启动 Run，违反时返回 409。M1 子项：强制执行状态转换矩阵，非法转换返回 409；done 只能由 in_review 经人工 Approve 进入，直接 PATCH 为 done 返回 409 | 状态矩阵测试与错误响应 | M0（枚举与启动约束）/M1（受控转换与评审门） |
| AC-TASK-03 | TASK-040、TASK-042、UI-011、UI-014；M1 子项：TASK-043、TASK-123、UI-015 | M0 子项：看板按状态分列；拖拽卡片后 PATCH 成功并持久化，刷新页面不丢失；空列显示空状态。M1 子项：拖拽采用乐观 UI，非法目标不发送 PATCH 并回弹提示；PATCH 失败时卡片回滚并显示可重试错误，不得静默吞掉 | M0：浏览器操作记录与 PATCH 响应；M1：失败注入与回滚录屏 | M0（基础拖拽）/M1（乐观更新与错误回显） |
| AC-TASK-04 | M0 子项：TASK-062、TASK-063、TASK-120、UI-025、UI-035、UI-036；M1 子项：TASK-060 | M0 子项：任务详情展示标题、状态、描述、Run 历史与所选 Run 的事件日志；不存在的任务展示明确的未找到状态并可返回看板。M1 子项：详情页展示全部可编辑字段并支持内联编辑，保存后看板同步 | 页面截图与 404 响应 | M0（只读详情）/M1（全字段内联编辑） |
| AC-TASK-05 | TASK-008、TASK-009、TASK-010、TASK-023 | 优先级、标签、负责人类型、负责人 ID、父任务 ID 可写入并原样读回；M1 起校验 priority 范围与 labels 约束；M2 起校验 assignee 引用；启动 Run 后任务自动关联 Agent，todo 自动进入 in_progress | API 对象对比与校验测试 | M0（字段）/M1（取值）/M2（引用） |
| AC-TASK-06 | TASK-080、TASK-083、TASK-084、TASK-088 | 任务模板可创建带默认描述、标签和验收清单的任务；模板实例化后修改模板不得反向影响已创建任务；M3 起模板与任务都带版本号与创建快照 | 模板 API 与对象快照 | M2（模板）/M3（版本快照） |
| AC-TASK-07 | TASK-095、TASK-096、TASK-097、TASK-101 | 子任务必须属于同一项目且不能形成环；父任务取消时子任务按既定策略处理；DAG 展示与实际依赖一致 | 图结构测试与 UI 截图 | M2 |
| AC-TASK-08 | TASK-012、TASK-116、TASK-117、TASK-126、SEC-023 | M1 子项：删除前必须二次确认并展示影响面；存在 queued/preparing/running Run 或未关闭 Review 时返回 409；通过校验后执行归档（写 `archivedAt`），不提供硬删除，不产生孤儿 Run。M2.1 子项：归档进入 30 天恢复窗口与回收站，可恢复；物理清理仅在无引用且过期后执行。M3 的 Team Workspace 删除见 AC-SEC-10，不复用本行 | 删除流程测试、409 响应、恢复演练与数据库检查 | M1（确认+阻止+归档）/M2.1（30 天恢复）/M3（团队空间另列） |

### 3.3 Agent 模块验收

Agent 是可复用工作配置，验收重点是「配置可复用、运行时选择明确、权限字段不被静默忽略」。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-AGENT-01 | AGENT-001、AGENT-002、AGENT-006、AGENT-007 | 创建 Agent 返回 201 且 ID 非空；名称为空返回 400；仅传名称与 runtime 时默认 workspaceMode=worktree、maxConcurrency=1、timeoutMinutes=60；GET/PATCH/DELETE 分别符合 200/200/204 与 404 约定 | API 响应与默认值断言 | M0 |
| AC-AGENT-02 | M0 子项：AGENT-024；M1 子项：AGENT-025 | M0 子项：Agent 指令会被组合进 Run 的提示词，至少包含任务标题、描述、状态、优先级与 Agent 指令；未配置指令时提示词仍可执行。M1 子项：按平台策略、Agent 指令、交付物契约、技能、任务上下文、Run 工作区上下文的顺序组装，并把任务内容标记为不可信数据 | Runtime 收到的提示词快照 | M0（基础提示词）/M1（完整组装顺序） |
| AC-AGENT-03 | AGENT-011、AGENT-012、AGENT-013、RUN-001、RUN-002、RUN-003 | 选择 mock 时使用确定性 Mock Runtime；选择 claude 时调用本机 `claude` CLI；M0 未知 runtime 回退 mock 属于已知临时行为，M1 起创建 Agent 时对未知 runtime 返回 400、启动 Run 前再次校验并失败，不得静默回退 | Run 日志与适配器选择记录 | M0（M1 收紧） |
| AC-AGENT-04 | AGENT-014、AGENT-015、AGENT-016、AGENT-017、RUN-005 | timeoutMinutes 在 Run 执行时生效；超过时限的 Run 进入 failed 且 errorCode=timeout；M2 起 Agent 级并发按 maxConcurrency 生效，而不是只靠全局 worker 数 | 超时与并发测试 | M0（字段）/M1（超时）/M2（并发） |
| AC-AGENT-05 | AGENT-019、AGENT-020、AGENT-021、AGENT-022、SEC-010、SEC-011 | allowedPaths 与 allowedCommands 不只是保存字段：越界路径写入被拒绝，未授权命令被拒绝，拒绝行为产生事件与可读错误 | 负向权限测试 | M2 |
| AC-AGENT-06 | AGENT-028、AGENT-044、COLLAB-001、COLLAB-002 | UI Design、Frontend、Backend、DevOps 四类角色模板可创建；模板包含职责、禁止事项、交付物格式、验收清单和推荐运行时 | 模板对象与创建流程 | M2 |
| AC-AGENT-07 | AGENT-032、AGENT-033、AGENT-034、AGENT-035、AGENT-038 | 技能可挂载到 Agent；技能启停影响后续 Run，不影响历史 Run；技能内容进入提示词时有长度与来源校验 | 技能挂载测试与 Run 快照 | M2 |
| AC-AGENT-08 | AGENT-030、AGENT-040、AGENT-041、AGENT-048 | Run 创建时对 Agent 配置做快照；排队期间修改 Agent 不改变已排队 Run 的提示词、权限和超时；历史 Run 可追溯其配置版本 | 快照对比测试 | M1 |

### 3.4 Run、Run Workspace 与 Runtime 验收

Run 是一次执行，Run Workspace 是隔离边界，Runtime 是执行适配层。三者放在一起验收，因为任何一层的缺陷都会表现为 Run 状态不可信。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-RUN-01 | RUN-080、TASK-021、TASK-022、TASK-030、API-1061 | 只有可执行任务能启动 Run；缺少 agentId 返回 400；任务不存在返回 404；合法请求返回 201 且初始状态为 queued；M1 起同一任务最多一个活跃 Run，重复启动返回 409 | API 状态码与响应 | M0（单活跃 Run 为 M1） |
| AC-RUN-02 | RUN-080、RUN-081、RUN-082、RUN-086、RUN-087 | M0 子项：Run 按 queued → preparing → running → completed/failed/cancelled 流转，开始与结束时间写入；终态不可再次流转在 M0 未实现，D-M0-01 已复现 cancelled 被调度器回写 completed，因此不作为 M0 通过项。M1 子项：所有终态写入带前置状态守卫，重复取消、自然完成与取消竞态均不改变既有终态；排队取消后不得执行 | M0：状态序列与 D-M0-01 复现记录；M1：状态守卫单测与竞争测试 | M0（流转）/M1（终态不可变） |
| AC-RUN-03 | M0 子项：RUN-006（部分）、RUN-007；M1 子项：RUN-006、RUN-008、RUN-009 | M0 子项：每个 Run 的事件序号从 1 连续递增；事件按 seq 返回；日志、summary、error 可区分；事件持久化后重启仍可读。M1 子项：事件带来源与 level，`(runID, seq)` 唯一；单事件 payload 超过 64 KiB 截断并标记；stderr 保留结构化来源 | 事件 API 与数据库记录 | M0（seq 与持久化）/M1（完整事件契约） |
| AC-RUN-04 | M0 子项：RUN-087（幂等返回）；M1 子项：RUN-085、RUN-086 | M0 子项：运行中的 Mock Run 可取消，返回 cancelled 并带原因；重复取消幂等返回当前对象。M1 子项：排队中取消后调度器不得执行；取消由调度器确认停止后条件写入 cancelled；取消与自然完成竞态不覆盖已写入的终态 | 取消前后事件与状态 | M0（Mock 运行中取消）/M1（排队取消与竞态） |
| AC-RUN-05 | RUN-004、RUN-005、RUN-014、AGENT-015 | 超时触发后 Runtime 进程被终止；Run 进入 failed 且 errorCode=timeout，不得标记为 cancelled 或 completed；错误信息包含超时原因；不残留运行中的子进程 | 超时测试与进程检查 | M1 |
| AC-RUN-06 | M0 子项：（按代码路径核验，无对应 M0 FR）；M1 子项：RUN-003、RUN-009、RUN-012、RUN-018 | M0 子项：Runtime 非零退出时 Run 失败且 stderr 进入事件，不标记 completed；受 D-M0-04 限制，仅做代码路径与本地 CLI 失败验证。M1 子项：CLI 不存在、认证失败、退出码非零分别映射可读 errorCode 与 failureDetail；stderr 结构化采集；adapter panic 由调度器恢复为 failed，worker 不退出 | 故障注入测试 | M0（基础失败路径）/M1（错误码与故障注入） |
| AC-RUN-07 | RUN-025、AGENT-016、AGENT-017、AGENT-018 | 同一 Agent 的并发 Run 不超过 maxConcurrency；全局并发不超过配置值；超出的 Run 保持 queued 且顺序可解释 | 并发计数与队列快照 | M1（全局）/M2（Agent 级） |
| AC-RUN-08 | RUN-041、RUN-043、RUN-045、RUN-093、AGENT-030、AGENT-041 | Run 记录 branch、worktree、base commit、agent 配置快照、runtime、model；历史 Run 可复现输入 | Run 详情对象 | M1 |
| AC-RUN-09 | M1 子项：RUN-046、RUN-051、RUN-056；M2 子项：RUN-052、RUN-053 | M1 子项：取消、失败、完成后保留证据，释放 worktree 或标记可回收；清理失败不损坏主仓库；未合并且有改动的 worktree 不得自动删除。M2 子项：已合并或已放弃的 worktree 按配置保留期保留（取值以 02-domain-model §3.8 为准），启动扫描 orphan worktree 并展示清理入口，不自动删除 | 文件系统检查与清理日志 | M1（释放与保护）/M2（保留期与 orphan） |
| AC-RUN-10 | RUN-060、RUN-061、RUN-062、RUN-063、RUN-065、COLLAB-050 | Artifact 与 Run 关联：diff、测试输出、日志可查询、可下载、有大小与类型限制；M1 的 screenshot Artifact 可选、仅查看，M2 起截图作为 UI 类 DoD 必需；Evidence 实体的 DoD 清单从 M2 起验收 | Artifact API 与详情页 | M1（Artifact）/M2（Evidence 与截图 DoD） |
| AC-RUN-11 | RUN-089、RUN-090、TASK-125、API-1063 | 进程崩溃或重启后，遗留的 preparing/running Run 被标记为 failed 且 errorCode=interrupted，不长期悬挂；queued Run 必须恢复或明确标记失败，不得静默消失 | 重启恢复测试 | M1 |
| AC-RUN-12 | RUN-040、RUN-046、RUN-048、RUN-080、COLLAB-043、COLLAB-050、UI-042 | Given 一个绑定 Workspace 的 Task 与 Claude Code Agent；When 启动 Run 并完成；Then 依次满足：(a) Run 继承 Workspace 的仓库配置，在独立 worktree 与分支执行，主工作区无改动；(b) diff、test_report、日志与 DoD 清单与 Run 绑定；(c) Run completed 后生成 pending Review；(d) 人工 approve 后按 AC-MERGE-01 合并，Task 进入 done；(e) 任一步失败时可通过错误码、Run 事件与证据定位失败点 | 里程碑演示记录、Run 对象、Artifact 列表与 MergeRecord | M1 |

### 3.5 角色协作与 DAG 验收

协作验收的原则是「通过 DAG、交付物契约、审批门和证据化 DoD 协作」，不是多个 Agent 在同一会话里自由聊天。除明确引用 M1 合并基线的条目外，以下均为 M2 计划项。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-COLLAB-01 | COLLAB-020、COLLAB-021、COLLAB-022、TASK-095、TASK-096、TASK-097 | 任务 DAG 支持前置依赖；上游未完成时下游 Run 不能启动并给出阻塞原因；环检测在保存时拒绝 | DAG API 与启动拒绝记录 | M2 |
| AC-COLLAB-02 | COLLAB-010、COLLAB-011、COLLAB-013、COLLAB-050、COLLAB-051 | 每个角色任务声明交付物契约：文件路径、格式、必填字段、验收命令；Run 结束前契约校验失败则不能标记完成 | 契约校验报告 | M2 |
| AC-COLLAB-03 | COLLAB-001、COLLAB-002、COLLAB-012、COLLAB-051、COLLAB-054 | UI Design 交付设计说明与资源清单，Frontend 消费约定路径的交付物；契约不匹配时阻止启动并提示缺失项 | 跨角色演示记录 | M2 |
| AC-COLLAB-04 | COLLAB-040、COLLAB-046、COLLAB-049、COLLAB-068、SEC-021、SEC-022、02-domain-model DM-APPR-001～DM-APPR-006 | 推送、staging 部署、删除、权限升级与命令白名单变更必须创建 Approval；未批准时服务端拒绝执行；Approval 绑定动作、目标、参数指纹与证据快照，内容变化后失效；拒绝必须填写原因；合并的 M1 基线见 AC-MERGE-01，M2 起同时受 Approval 约束 | 审批记录、审计日志与绕过测试 | M2（M1 合并见 AC-MERGE-01） |
| AC-COLLAB-05 | COLLAB-044、COLLAB-045、AGENT-061、SEC-022、RUN-103 | DevOps Agent 在 M2 只能执行 staging 范围内的动作并生成部署计划；staging 执行前必须有人工批准的 deploy_plan，未批准时服务端拒绝（负向用例必须覆盖）；prod 部署只能由人工在 ATeam 之外执行并回填结果，Agent 无执行入口与生产凭据；越权请求被拒绝并审计 | 权限负向测试、staging 审批记录与部署计划 | M2 |
| AC-COLLAB-06 | COLLAB-060、COLLAB-062、COLLAB-064、UI-073、UI-074 | 收件箱聚合待评审、待审批、被阻塞、失败四类事项；每条事项可跳转到对应任务或 Run；已读状态按用户隔离 | 收件箱接口与 UI | M2 |
| AC-COLLAB-07 | COLLAB-023、COLLAB-024、COLLAB-025、RUN-025、TASK-030 | 并行调度遵守 DAG 与资源上限；同一文件冲突可被检测并提示人工处理；不因并行导致任务状态互相覆盖 | 并行调度测试 | M2 |
| AC-COLLAB-08 | COLLAB-030、COLLAB-031、COLLAB-032、COLLAB-035、COLLAB-068 | Crew/队长模式在「并行任务」稳定后启用；队长只做分派与汇总，不绕过审批门；成员产出仍按契约验收 | Crew 演示与审批记录 | M2 后段 |
| AC-COLLAB-09 | AGENT-035、AGENT-054、AGENT-058、AGENT-059、COLLAB-005、TASK-088 | 技能与任务模板可复用；模板升级不破坏历史任务；收件箱、技能、模板的权限与可见范围明确 | 模板版本与权限测试 | M2（本地）/M3（团队可见性） |
| AC-COLLAB-10 | COLLAB-043、COLLAB-045、COLLAB-050、COLLAB-070、COLLAB-072、COLLAB-077 | 四角色协作全流程演示：设计 → 前端 → 后端 → DevOps 计划 → 人工评审 → 合并；每一步均有 Artifact 与审批证据 | 里程碑演示记录 | M2 |

### 3.6 UI 验收

UI 验收以「可操作、可理解、可恢复」为核心，不以视觉华丽为标准。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-UI-01 | M0 子项：UI-011、UI-012、UI-014、UI-017、UI-018、UI-080（部分）；M1 子项：UI-015、UI-079、UI-080（完整） | M0 子项：看板展示 Backlog、Todo、In Progress、In Review、Done 五列；列内计数正确；空列有空状态；创建任务后无需手刷即可出现。M1 子项：拖拽乐观更新与失败回滚；blocked 与 cancelled 通过独立列或筛选可见 | 浏览器操作与截图 | M0（五列看板）/M1（拖拽健壮性与 blocked/cancelled） |
| AC-UI-02 | UI-025、UI-026、UI-032、UI-033、UI-034、UI-036、UI-037 | 任务详情可切换状态、选择 Agent、启动 Run、查看 Run 列表与事件日志；不可执行状态有明确提示且按钮禁用 | 操作记录 | M0 |
| AC-UI-03 | UI-058、UI-059、UI-060；M1 子项：UI-071 | M0 子项：Agent 列表展示名称、描述、运行时、并发、超时、工作区模式；创建 Agent 表单必填校验生效。M1 子项：Runtime 下拉只展示已注册适配器，未安装项置灰并提供检测入口 | 页面截图与 API 请求 | M0（列表与校验）/M1（Runtime 可用性） |
| AC-UI-04 | M0 子项：UI-035（部分）、UI-036；M1 子项：UI-035（完整）、UI-046、UI-047、UI-048 | M0 子项：Runs 列表展示状态、任务、触发方式、创建时间、摘要或错误；点击行可进入任务详情。M1 子项：独立 Run 详情路由与页头字段完整，时间线按生命周期、Workspace、工具、文件、测试、Artifact、评审与审批分类渲染 | 页面截图 | M0（列表）/M1（独立 Run 详情） |
| AC-UI-05 | UI-038、UI-039、UI-040、UI-041 | diff 评审页展示文件级变更、增删行、上下文；可标记已读、提出问题、请求修改；大 diff 有折叠与加载策略 | diff 页面与评审记录 | M1 |
| AC-UI-06 | UI-041、UI-042、UI-043、UI-084 | 审批页明确展示动作、对象、风险、将执行的命令或合并目标；默认不批准；拒绝必须填写原因 | 审批页面与记录 | M2 |
| AC-UI-07 | UI-040、UI-073、UI-074、UI-077、UI-078 | 收件箱与证据面板可从导航到达；证据包含测试、截图、日志、DoD 清单；缺失证据有明确提示 | 页面截图 | M2 |
| AC-UI-08 | UI-108、UI-109、UI-110、UI-111、UI-116、UI-117、UI-119 | 键盘可完成主要流程；焦点可见；对比度符合 WCAG AA；空状态、加载、错误三态齐全；最小窗口尺寸下无内容遮挡 | 可访问性检查与截图 | M1/M2 |
| AC-UI-09 | M0 子项：UI-126；M1 子项：UI-007、UI-009、UI-125；M4 子项：UI-009 打包模式 | M0 子项：桌面壳能编译并加载同一 Web UI，无白屏。M1 子项：窗口标题反映当前对象；连接状态全局可见，断开显示横幅；窗口最小尺寸 1024×640 生效。M4 子项：打包模式与开发模式行为一致 | 桌面操作记录 | M0（开发壳加载）/M1（标题、连接状态、最小尺寸）/M4（打包一致性） |

### 3.7 API 与 WebSocket 验收

REST、WebSocket、错误模型、分页、迁移与 CLI 的接口规则由 `prd/modules/api-and-data.md` 统一定义。本节验收状态码、错误模型、事件顺序、断线恢复、契约一致性与 CLI 行为，引用 API FR，不重复接口细节。

M0 的 API 结论已按当前代码逐项核对：`internal/api/api.go` 的 `webHandler` 对 `/api/` 前缀调用 `http.NotFound`（纯文本）；`writeError` 只写 `{"error": ...}`；`decodeJSON` 使用 `io.LimitReader(r.Body, 1<<20)`，不存在 413 分支；`internal/events/hub.go` 的 `Event` 只有 `type/data/at` 且 `CheckOrigin` 恒为 true；`apps/web/src/composables/useEventStream.ts` 固定 2 秒重连。以下 M0 行按这些实际行为判定，不按目标契约判定；对应差异登记为 D-M0-21～D-M0-24。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-API-01 | M0 子项：API-1005、API-1008、API-1009、API-1020、API-1040、API-1060；M1 子项：API-1005、API-1008、API-1009、API-1020、API-1040、API-1060、API-1140 | M0 子项：Task、Agent、Run 的已注册 CRUD 路由可访问；未知 `/api/*` 在配置了 webDir 时由 `http.NotFound` 返回纯文本 404，未配置 webDir 时返回 200 占位 HTML（不是 JSON 404）；方法不匹配由 Go 1.22 ServeMux 返回 405 纯文本并带 Allow；未知资源返回 404，但错误体只有 `error` 字段；ID 按不透明字符串处理。M1 子项：未知 `/api/v1/*` 返回结构化 JSON 404，405 也返回可解析错误体，且不把未知路径落到 SPA | M0：路由表测试与代码审阅（D-M0-21）；M1：路由测试表与错误响应 | M0（路由基本可用，未知路径与错误体不达标）/M1 |
| AC-API-02 | M0 子项：API-1140、API-1141、API-1142（目标）；M1 子项：API-1140、API-1141、API-1142 | M0 子项：错误体只有 `{"error":"..."}` 一个字段，没有 code、message、details、requestId、retryable；400/404/409/500 共用该结构（D-M0-22）。M1 子项：错误体包含 code、message、details、requestId、retryable；400 表示输入错误，404 表示不存在，409 表示状态冲突；500 不泄露堆栈、SQL、绝对路径与密钥 | M0：错误响应抓包；M1：错误响应断言与错误注入 | M0（最小错误体）/M1 |
| AC-API-03 | M0 子项：API-1004、API-1009；M1 子项：API-1004、API-1009、API-1021、API-1022、API-1140、SEC-006 | M0 子项：`decodeJSON` 使用 `io.LimitReader` 截断 1 MiB，超限通常表现为 JSON 解析失败并返回 400，代码中不存在 413 分支；非法 JSON 返回 400；未知字段被忽略，未做字段级 details（D-M0-23）。M1 子项：请求体上限 1 MiB，超限返回 413 `PAYLOAD_TOO_LARGE`；非法 JSON 返回 400；未知字段策略明确；字段校验失败返回字段级 details | M0：边界请求抓包；M1：边界测试 | M0（400 行为）/M1 |
| AC-API-04 | M0 子项：API-1120、API-1123、API-1130（目标）；M1 子项：API-1120、API-1123、API-1130、NFR-NET-006 | M0 子项：WebSocket 事件信封只有 type、data、at 三个字段，没有 id、seq、v、scope；任务、Agent、Run 事件均可收到；`events.Hub.CheckOrigin` 恒为 true，跨源握手不会被拒绝；前端 `useEventStream` 固定 2 秒重连，无退避、无 afterSeq（D-M0-08、D-M0-24）。M1 子项：信封包含 id、seq、v、type、at、scope、data；30 秒 ping；跨源握手被拒绝；断线按指数退避（上限 30 秒）重连并可按 afterSeq 补拉 | M0：事件抓包与代码审阅；M1：事件抓包与重连测试 | M0（广播可用，契约与安全不达标）/M1 |
| AC-API-05 | API-1122、API-1125、API-1127、API-1150 | 客户端可用 afterSeq 补拉断线事件；事件按 (runId, seq) 单调且唯一；重复投递可去重；超出保留窗口返回明确的重置事件，不造成状态空洞 | 事件回放与断线测试 | M1 |
| AC-API-06 | API-1020、API-1145、API-1146、API-1147、API-1151、TASK-047 | 列表支持分页、过滤、排序与搜索；默认 limit 与最大 limit 生效；游标非法返回 400；1,000 Task、10,000 Run 规模下列表 p95 达标 | 分页与基准测试 | M1 |
| AC-API-07 | API-1220、API-1221、API-1222、API-1225、API-1226 | 前后端共享类型覆盖全部对外资源与枚举；ApiError 暴露 code、status、details、requestId、retryable；列表客户端返回 Page；golden fixture 契约测试阻断不兼容变更；M2 生成 OpenAPI 3.1 且无差异 | 契约测试与类型检查 | M1/M2 |
| AC-API-08 | API-1003、API-1011、API-1140 | 健康检查返回数据库可读写、schema 版本与数据目录状态；每个响应带 X-Request-ID；异常时返回非 200 或 503 且错误体可解析 | 健康检查与中间件测试 | M1 |
| AC-API-09 | API-1200、API-1201、API-1203、API-1205、API-1207、API-1209 | M0 的 `ateam serve` 与 `ateam version` 可用；M1 起 `ateam task/agent/run` 支持 JSON 输出、稳定退出码与 `--data-dir`；高风险命令在非交互模式必须 `--yes`，缺失时不执行 | CLI 集成测试 | M0（serve/version）/M1（子命令） |

### 3.8 权限与安全验收

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-SEC-01 | SEC-001、SEC-002、SEC-004、SEC-005；M2.1 子项：SEC-003 | M0 子项：默认监听 127.0.0.1:8787；无认证，CORS 反射任意 Origin，WebSocket 放行任意来源（D-M0-08）。M1 子项：非回环绑定启动失败并说明风险；CORS 只允许动态白名单，`Origin: null` 拒绝，Host 只接受实际监听值，未知 Origin 返回 403 且不写 ACAO；WebSocket 同样校验；安全响应头存在。M2.1 子项：随机会话令牌与一次性 bootstrap URL，WebSocket 使用一次性 ticket；无令牌请求返回 401 | 启动日志、Origin 正负矩阵与访问测试 | M0（回环基线）/M1（浏览器攻击面）/M2.1（会话令牌） |
| AC-SEC-02 | SEC-010、SEC-016、SEC-017 | 工作区路径必须位于配置根目录内；`..`、符号链接、绝对路径逃逸均被拒绝；拒绝不泄露主机敏感路径 | 路径逃逸负向测试 | M2 |
| AC-SEC-03 | SEC-011、SEC-014、SEC-019 | 命令执行不使用 shell 拼接；未在白名单的命令被拒绝；参数化调用不能被注入额外命令 | 命令注入测试 | M2 |
| AC-SEC-04 | M1 子项：SEC-071；M2.1 子项：SEC-012、SEC-013 | M1 子项：API Key、Token、环境变量不写入日志、事件、数据库明文和 Artifact；错误信息不包含密钥；常见 Key 模式在写入前掩码。M2.1 子项：Agent 只继承白名单变量，Secret 存 OS 钥匙串、DB 只存引用，创建后不可读明文 | 日志、数据库与 Artifact 扫描 | M1（脱敏）/M2.1（凭据隔离） |
| AC-SEC-05 | SEC-020、SEC-026；M2 子项：SEC-021、SEC-022、SEC-023、02-domain-model DM-APPR-001～DM-APPR-004 | M1 子项：合并必须有 Review approved + 显式确认 + MergeRecord，Agent 调用合并接口返回 403，确认绑定 head SHA 与 diff 哈希；M2 子项：推送、staging 部署、删除、权限升级必须有 Approval，审批不可由 Agent 自签，未批准动作被拒绝并写审计 | 审批绕过测试与 MergeRecord/Approval 记录 | M1（合并确认）/M2（正式审批门） |
| AC-SEC-06 | SEC-050、SEC-051、SEC-052、SEC-053 | 关键动作有审计记录：谁、何时、对什么、做了什么、结果如何；审计记录不可由普通 Agent 修改 | 审计查询与篡改测试 | M2/M3 |
| AC-SEC-07 | SEC-030、SEC-031、SEC-032、SEC-033 | M3 登录、会话、角色权限生效；跨团队数据隔离；按 security 模块 §4.6 的统一语义：资源不在可见作用域返回 404（与真正不存在一致），资源可见但角色不足返回 403 并说明所需角色；两种响应均写审计，且不泄露资源名称、创建者或成员列表 | 多用户权限矩阵与审计查询 | M3 |
| AC-SEC-08 | M1 子项：SEC-060、SEC-061；M4 子项：SEC-062、SEC-063 | M1 子项：依赖锁定与 CI 漏洞扫描接入，发现高危输出告警；升级依赖需评审。M4 子项：严重/高危漏洞阻断发布，例外有审批与到期；许可证允许列表与 NOTICE/第三方清单检查通过 | CI 日志、`govulncheck`/依赖审计报告与许可证报告 | M1（扫描）/M4（阻断与合规） |
| AC-SEC-09 | SEC-071、NFR-SEC-011、NFR-COST-008、TASK-144 | 遥测默认关闭或明确 opt-in；上报内容不包含代码、提示词、密钥、diff、文件路径与用量明细；关闭后无网络上报；开启后可查看、导出并删除本地遥测记录 | 网络抓包、上报字段审查与设置检查 | M4 |
| AC-SEC-10 | SEC-015、SEC-023、SEC-028、SEC-029、SEC-078、COLLAB-078、FLOW-X-042 | M2.1 子项：修改 allowedPaths/allowedCommands/Secret 绑定必须显式确认并写审计，未确认的权限扩张请求被服务端拒绝，变更只影响后续 Run；轮换或撤销 Secret 只允许创建者或 Admin，记录审计并提示影响面。M3 子项：删除 Team Workspace 必须双人审批 + 输入名称确认 + 回收站，未审批删除返回 403；删除 Workspace 需无活跃 Run 并写审计 | 权限变更事件、审计记录与未授权测试 | M2.1（权限与 Secret）/M3（Team Workspace 删除） |
| AC-SEC-11 | SEC-068、SEC-071、NFR-NET-001、NFR-NET-010 | M1 子项：首次配置 Runtime 时 UI 明确告知「提示词可能包含代码片段并发送到用户选择的模型服务」，告知可回看且设置页有入口；M1-M2 网络抓包确认 ATeam 自身除用户触发的 Runtime 调用外无出网；前端不加载 CDN、远程字体或远程图标 | 首次配置录屏、抓包与静态资源扫描 | M1（告知与出网审计）/M4（更新检查） |

### 3.9 非功能验收

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-NFR-01 | M1 子项：NFR-PERF-004、NFR-PERF-005；M2 子项：NFR-PERF-006 | M1 子项：1,000 个 Task 时列表 p95 ≤100ms（默认 limit=50），5,000 个 Task 时单页查询 p95 ≤200ms；含 500 个 Task 的看板首屏在服务就绪后 1.5 秒内可交互。M2 子项：超过 500 行的 Task 与 Run 列表启用虚拟化，滚动帧率不低于 50fps | 基准测试报告与浏览器帧率采样 | M1（API 与首屏）/M2（虚拟化） |
| AC-NFR-02 | NFR-PERF-009、NFR-RES-008、NFR-REL-005 | 5 个并行 Run 下调度不串行阻塞、状态不串写；事件不丢失；取消与超时不互相覆盖 | 并发测试报告 | M1 |
| AC-NFR-03 | NFR-REL-001、NFR-REL-008、NFR-REL-010、02-domain-model DM-PROJ-001；升级场景见 api-and-data US-API-07 | M0 子项：SQLite WAL 正常；迁移在事务中执行且可重复；异常退出后数据库可打开。M1 子项：RunEvent 在 (runID, seq) 上唯一；备份与恢复演练可执行；**M0→M1 升级验收**：用 M0 生成的数据库启动 M1，迁移前自动备份，schema 升级成功，Task/Agent/Run/RunEvent 的数量与内容不变，M0 数据回填默认 Workspace；迁移失败时服务拒绝启动、原库保持不变，日志给出备份路径与失败迁移编号 | 迁移、重启、升级与恢复测试 | M0（WAL/事务迁移）/M1（事件唯一、备份、M0→M1 升级） |
| AC-NFR-04 | M1 子项：NFR-PORT-006、UI-108、UI-117；M2 子项：NFR-PORT-005 | M1 子项：最小窗口 1024×640 下核心操作仍可用；主要页面满足 WCAG AA 对比度，键盘可操作，焦点顺序合理，错误有文本说明而不只靠颜色。M2 子项：支持 100% 至 200% 系统缩放与多显示器切换，布局不重叠、不截断关键操作 | 可访问性报告与窗口尺寸测试 | M1（窗口与 WCAG）/M2（缩放与多显示器） |
| AC-NFR-05 | NFR-OBS-001、NFR-OBS-004、NFR-OBS-005 | 日志结构化、级别合理、包含 runId/taskId；关键路径可追踪；日志不包含密钥 | 日志样例 | M1 |
| AC-NFR-06 | NFR-RES-006、NFR-RES-007、NFR-REL-013 | Artifact 与事件有保留、归档与容量上限；数据库增长有监控与清理入口；清理不删除审批与审计记录；用户可导出 | 保留策略与容量测试 | M2 |
| AC-NFR-07 | M1 子项：NFR-PORT-001、NFR-PORT-003；M2 子项：NFR-PORT-002、NFR-PORT-004；M4 子项：NFR-PORT-001、NFR-PORT-002 三平台发布 | M1 子项：macOS 真实闭环可用，Go core 在 macOS/Linux/Windows 可编译，Linux 上 Go 测试与 Web 构建通过；M2 子项：WKWebView、WebView2、WebKitGTK 的核心流程内部验证，Windows 路径处理有单测与开发构建冒烟；M4 子项：三平台 Tier 1 发布验收 | 构建矩阵与平台测试记录 | M1（macOS 闭环与编译）/M2（内部平台验证）/M4（三平台发布） |
| AC-NFR-08 | NFR-PKG-001、NFR-PKG-006、NFR-PKG-008 | 打包产物可安装、可卸载、可升级；版本号与健康检查一致；升级失败可回滚 | 安装包与升级测试 | M4 |
| AC-NFR-09 | NFR-NET-001、NFR-NET-002、NFR-NET-006、NFR-NET-007、NFR-NET-010 | M1 子项：完全断网时 Task、Agent、Run 记录、事件浏览、评审、导出与设置可用；断网冷启动不依赖网络，启动不被更新检查阻塞；WebSocket 断线按退避重连，恢复后按 afterSeq 补拉或触发一次一致的全量同步；静态资源扫描无 CDN、远程字体或远程图标。M2 子项：WebSocket 不可用时降级为 3 秒轮询并明确提示连接状态 | 断网走查、抓包、资源扫描与重连测试 | M1（离线与恢复）/M2（降级轮询） |
| AC-NFR-10 | NFR-RES-001、NFR-RES-002、NFR-RES-003、NFR-RES-004、NFR-RES-009、NFR-RES-010 | M1 子项：空闲 CPU 60 秒平均 ≤1%，日志流式渲染 ≤单核 15%；队列容量有上限，溢出返回 503 `QUEUE_FULL`，不静默丢弃；全局并发默认 2 且可配置 1-8。M2 子项：空闲总 RSS ≤300MB（Go 服务 ≤80MB），5 个活跃 Run 时 ATeam 自身 ≤700MB，三路并发含 Runtime ≤2GB；24 小时执行 100 个 Run 后 RSS 涨幅 ≤20%；8 小时稳定性测试中 fd 与子进程数量不持续增长 | 性能采样、压测报告与长跑快照 | M1（CPU/队列/并发）/M2（RSS/泄漏） |

### 3.10 Workspace（仓库绑定）验收

Workspace 是产品级归属边界，M1 首个版本只支持单 Workspace 的本地仓库绑定。本节验收仓库绑定、归属继承与归档保护。规范实体为 Workspace（`workspaceId`，表 `workspaces`，默认 ID `default`）；`Project`/`projectId` 仅为 M1-M2 请求输入别名，规范路径为 `/api/v1/workspaces`，`/api/v1/projects` 是兼容别名。AC-PROJ 编号保留为仓库绑定用例的稳定编号。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-PROJ-01 | 02-domain-model DM-PROJ-001～DM-PROJ-006、DM-PROJ-008 | M1 子项：首次启动创建 ID 固定的默认 Workspace `default`，M0 的 Task/Agent/Run 全部回填；创建 Workspace 时校验 repoPath 为绝对路径、存在、是 git 工作树根，非法时返回 400 并说明原因；Task 与 Run 的 workspaceId 必填且 Run 的 workspaceId 必须等于 Task 的；Run 继承 defaultBranch、remote、worktreeRoot、verificationCommands；修改 defaultBranch/remote/worktreeRoot/verificationCommands 前必须无活跃 Run，否则返回 409；归档后不能创建新 Task/Agent/Run，历史只读；M1 禁止删除默认 Workspace。M3 子项：多 Workspace 可见性按权限过滤；删除 Workspace 需 Approval 并导出审计摘要 | 创建/更新 API 测试、回填后的数据对比、归档后创建拒绝 | M1（单 Workspace 与继承）/M3（多 Workspace 与删除） |
| AC-PROJ-02 | RUN-041、RUN-043、02-domain-model DM-PROJ-003、DM-PROJ-004、DM-PROJ-005 | repoPath 创建后不可原地修改；尝试 PATCH repoPath 返回 409 并提示重新绑定流程；重新绑定只在 M3 提供，要求无活跃 Run、重新校验仓库与分支、生成 Approval 与审计 | PATCH 负向测试与审计记录 | M1（拒绝）/M3（重新绑定） |

### 3.11 Review 与 Merge 验收（M1）

M1 不引入 Approval 实体，合并门由 Review approved + 显式确认 + MergeRecord 承担；M2 起 Approval 叠加，但 M1 的可判定项不能推迟到 M2。

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-REVIEW-01 | COLLAB-043、COLLAB-050、COLLAB-056、02-domain-model DM-REV-001～DM-REV-006 | Review 状态机为 pending → in_review → approved/changes_requested，另有 superseded/cancelled；Run completed 且证据齐备时可自动创建 pending Review，Review 绑定 runId 与 evidenceSnapshotHash；同一 Task 同时最多一个 open Review；只有人类可 approve 或 request changes，Agent 调用返回 403；changes_requested 必须带 blocking comment 或非空理由，Task 自动回到 in_progress | Review API 测试与角色负向测试 | M1 |
| AC-REVIEW-02 | COLLAB-056、02-domain-model DM-REV-004、DM-REV-005 | Task 进入 done 必须基于 approved Review 与完整证据；直接 PATCH 为 done 返回 409；approve 前缺必需 Artifact、存在未解决 blocking comment、diff 不可读或含冲突标记时拒绝；requiresMerge=true 时 Review approved 后 Task 保持 in_review，直到 MergeRecord 记录合并成功 | 状态机测试与接口拒绝记录 | M1 |
| AC-MERGE-01 | RUN-047、RUN-048、RUN-049、COLLAB-043、SEC-020、SEC-026、02-domain-model DM-MRG-001、DM-MRG-003 | Given 一个 approved Review；When 人类请求 `POST /api/v1/runs/{id}/merge` 并携带 reviewId、expectedHeadCommit、targetBranch、strategy、confirm=true；Then 服务端校验 Review approved、证据快照哈希、目标分支 head 未偏离、目标工作区干净；`expectedHeadCommit` 或证据快照不匹配返回 412 `STALE_HEAD`/`STALE_EVIDENCE`，Review 状态或分支非法返回 409；任一失败不执行 git 写操作；Agent 调用返回 403；追加提交后旧确认失效并被置为 superseded | 合并 API 正负测试与 412 记录 | M1 |
| AC-MERGE-02 | RUN-047、RUN-048、COLLAB-050、02-domain-model DM-MRG-002、DM-MRG-004 | 每次合并尝试写 MergeRecord（操作者、时间、源/目标分支、策略、commit、结果、冲突文件）；merged 记录不可修改；冲突时阻止合并且不产生部分合并；合并成功后 Task 进入 done，worktree 按 AC-RUN-09 清理；M2 起 MergeRecord 通过 approvalId 关联 Approval | MergeRecord 查询、冲突注入与审计记录 | M1 |

### 3.12 M3 团队模式验收

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-TEAM-01 | TEAM-013、TEAM-014、TEAM-015、TEAM-016、TEAM-017 | 登录、会话、个人访问令牌与两层角色权限在服务端生效；未配置团队模式时本地 SQLite 模式仍可启动且无需登录；跨团队可见性按 AC-SEC-07 的 404/403 语义处理 | 登录与权限矩阵测试 | M3 |
| AC-TEAM-02 | TEAM-035、NFR-REL-008、NFR-REL-016 | Postgres 迁移提供预检、迁移、校验与回滚工具；迁移前自动备份；行数与关键哈希校验一致，失败整体回滚；SQLite 与 Postgres 的领域行为差异有对照表 | 迁移演练、对照表与回滚记录 | M3 |
| AC-TEAM-03 | TEAM-004、TEAM-021、TEAM-022、TEAM-023、SEC-040、SEC-041、SEC-042、SEC-044 | Runner 注册令牌一次性、15 分钟有效、单次使用；心跳 15 秒，45 秒未心跳标记 offline；同一 Run 只有一个有效租约；离线或撤销后不自动跨机重跑；事件按 runId+seq 续传并幂等去重 | 双机演示、断网测试与审计记录 | M3 |
| AC-TEAM-04 | TEAM-018、TEAM-019、AGENT-058、AGENT-059、AGENT-060 | 共享 Agent 的 private/team/shared 可见性生效；编辑、归档、转移所有权需 workspace_admin 及以上；Run 启动时固化 AgentVersion 快照；敏感配置不下发到无权限 Runner | 权限矩阵与快照对比 | M3 |
| AC-TEAM-05 | TEAM-028、TEAM-029、SEC-050、SEC-052、SEC-053、SEC-054 | 审计只追加，字段包含作用域、actor、action、resource、时间、结果、原因码与哈希链；支持按条件查询与 JSON/CSV 导出，导出动作本身审计；锚点可校验，篡改可检测 | 审计查询与篡改测试 | M3 |
| AC-TEAM-06 | TEAM-031、TEAM-032、SEC-021 | 推送 Run 分支与创建 PR 前必须人工 Approval，绑定 remote/ref/commit；记录 PR URL、编号与状态；合并由人在 GitHub 完成或经明确批准触发，系统不自动合并；失败可重试且不重复创建 PR | PR 演示与审批记录 | M3 |

### 3.13 M4 自动化与分发验收

| 验收编号 | 引用 FR | 验收标准（可判定） | 证据 | 阶段 |
|---|---|---|---|---|
| AC-AUTO-01 | TASK-140、SEC-079、M4-AUTO-001～M4-AUTO-009、M4-HOOK-001～M4-HOOK-009 | 定时规则与签名 Webhook 可创建任务，默认进入 backlog，记录 automationId、trigger 与去重键；未签名、过期或重放请求被拒绝；自动化触发的 Run 不绕过审批策略 | 重放测试与任务记录 | M4 |
| AC-AUTO-02 | TASK-141、COLLAB-065、M4-NOTIFY-001～M4-NOTIFY-009 | 通知覆盖运行完成、失败、待评审、待审批、审批过期、依赖就绪与自动化失败；同一任务 10 分钟内同类通知最多一条且不丢失；渠道可配置；通知内容不包含代码、提示词、diff、路径与密钥 | 通知演示与字段审查 | M4 |
| AC-AUTO-03 | NFR-PKG-001～NFR-PKG-005、NFR-PKG-009、M4-PKG-001～M4-PKG-009 | DMG、NSIS、AppImage 可安装、启动、卸载；卸载默认保留用户数据目录；版本号、提交号与健康检查一致；签名、公证与许可证清单按 M4-PKG-004/005/006/009 验证 | 干净机器安装记录与签名验证 | M4 |
| AC-AUTO-04 | NFR-PKG-006、NFR-PKG-007、NFR-PKG-008、NFR-PKG-010、NFR-PKG-013、SEC-065、M4-UPD-001～M4-UPD-009 | 自动更新默认关闭；从 HTTPS 获取签名清单，先验签再验哈希，原子替换并保留上一版本；升级前备份数据库，失败可回滚；离线检查 3 秒超时且不阻塞启动；stable 与 beta 通道隔离；安装需用户确认 | 更新、回滚与通道测试 | M4 |
| AC-AUTO-05 | TASK-142、SEC-080、M4-PLUG-001～M4-PLUG-009 | 插件只能读取任务与订阅事件，不能绕过审批门、不能替人批准；停用后不再收到事件；恶意插件不能读取未授权文件；插件 API 有版本兼容策略与失败隔离；越权调用返回 403 并写审计 | 插件权限负向测试 | M4 |
| AC-AUTO-06 | TASK-144、NFR-SEC-011、SEC-080、M4-TEL-001～M4-TEL-009 | 遥测默认关闭且必须 opt-in，可查看、导出与删除本地记录；不采集任务标题、描述、评论、代码、diff、文件路径与用量明细；关闭后立即停止上报并清空队列 | 抓包、设置检查与字段审查 | M4 |

## 4. 按里程碑的验收标准与演示脚本

### 4.1 M0：本地骨架

M0 的目标是证明「对象模型、持久化、API、事件、Mock Runtime、Vue 看板和 Wails 壳」这条骨架能跑通，不承诺真实隔离与真实 Agent 能力。

验收标准：

1. `go test`、`go vet`、`pnpm -r typecheck`、Web 构建、Go 二进制构建全部通过。
2. Task、Agent、Run 的创建、读取、更新、删除按 M0 实际 API 行为工作（错误体仅 `error` 字段，未知 `/api` 路径为纯文本 404，见 AC-API-01～04 的 M0 行）；SQLite 重启后数据保留。
3. Mock Runtime 能完成一次 Run，产生连续事件，Run 进入 completed，任务被关联到 Agent。
4. WebSocket 能广播任务、Agent、Run 状态与 Run 事件；M0 信封仅 `type/data/at`，不得按 M1 的 id/seq/scope 契约验收。
5. Vue 看板能创建任务、分列展示、拖拽改状态；任务详情能启动 Run、查看日志、取消运行中的 Run。
6. Wails 桌面壳能编译并启动，加载同一套 Web UI。
7. 已知缺陷有记录，不把 M0 骨架描述为生产可用。

演示脚本（计划 10 分钟）：

```bash
# 1. 干净构建
make web-install
make build

# 2. 使用临时数据库启动，避免污染日常数据
mkdir -p /tmp/ateam-demo
./bin/ateam serve --addr 127.0.0.1:8787 --db /tmp/ateam-demo/ateam.db --web apps/web/dist

# 3. 另一个终端验证健康检查
curl -s http://127.0.0.1:8787/api/health
```

浏览器打开 `http://127.0.0.1:8787`，依次执行：创建任务「演示任务」→ 创建 Mock Agent → 在任务详情启动 Run → 观察日志逐条出现 → Run 变为 completed → 刷新页面确认数据仍在。随后停止服务并重新启动，确认任务和 Run 仍可读取。最后执行 `make dev-desktop`，确认桌面窗口加载同一界面。

预期结果与失败判定：健康检查返回 `status=ok`；Run 在数秒内完成且事件序号连续；重启后数据存在；桌面窗口无白屏。任一项不满足即判定演示失败。演示过程需保存健康检查输出、Run 事件截图和重启后的任务列表截图。Wails 窗口启动属于手工验收项；本轮自动验证只覆盖桌面壳编译，结果见第 9.3 节 D-M0-02。

M0 退出标准：上述 1-6 项通过；S0/S1 缺陷有明确处理结论。当前 M0 的实际验证结果见第 9 节，其中排队中 Run 的取消语义存在已复现缺陷，按「M0 骨架有条件通过、M1 必须修复」处理。

### 4.2 M1：本地闭环

M1 的目标是把「一次执行」变成可评审、可合并的闭环：Workspace 仓库绑定、git worktree 隔离、真实 Claude Code 适配、diff 评审、Artifact（Evidence 从 M2 起）、取消与超时、Review/Merge、M0 数据库升级。

验收标准：

1. Workspace 可绑定本地 Git 仓库（repoPath、defaultBranch、remote、verificationCommands）；Task 归属 Workspace，每个 Run 在独立 worktree 中执行，分支命名可追溯，主工作区不被修改；创建校验与继承规则按 AC-PROJ-01。
2. 真实 Claude Code adapter 能以结构化事件流式输出 tool_call、file_change、test_result 与 usage，支持模型与权限参数，失败时错误可读。
3. diff review 能展示文件级与行级变更，评审人可标记、评论、请求修改。
4. Artifact/Evidence 覆盖 diff、changed files、test_report、screenshot、log_bundle、usage 与 DoD 清单，并与 Run 绑定；证据与 diff 可导出且经过脱敏；系统复跑的验证结果与 Agent 自述测试结果分开记录。
5. 取消与超时对所有状态生效；排队中取消后不得再执行；取消、超时与 Runtime 失败不会互相覆盖状态；终态不可被后续写入覆盖（D-M0-01 的回归用例必须通过）。
6. Review 与 Merge 按 AC-REVIEW-01、AC-REVIEW-02、AC-MERGE-01、AC-MERGE-02 执行：Task 进入 done 需 approved Review 与完整证据；合并需 reviewId、expectedHeadCommit、干净工作区与显式确认；Agent 不能合并。
7. Run 输入有快照，历史 Run 可追溯；崩溃重启后 preparing/running 遗留 Run 写为 failed + `errorCode=interrupted`，不悬挂。
8. M0→M1 数据库升级可执行：用 M0 数据库启动 M1，迁移前备份、升级成功、历史 Task/Agent/Run/RunEvent 数量与内容不变，并回填默认 Workspace；迁移失败拒绝启动且原库可打开（AC-NFR-03）。
9. 质量门加入 `go test -race`、核心包覆盖率不低于 70%（与 `01-scope-and-roadmap.md` REL-Q-002、M2 AC-M2-Q-02 一致）、golangci-lint、Vitest、Playwright 看板与 Run 冒烟、`govulncheck`/`pnpm audit`。

演示脚本（计划 15 分钟）：

前置：M1 计划提供 `scripts/demo/sample-todo.sh` 生成 fixture；脚本未就绪时按下面命令手工生成。

```bash
# 1. 生成示例仓库：main 上 TestCountCompleted 失败
mkdir -p /tmp/ateam-demo/sample-todo && cd /tmp/ateam-demo/sample-todo
git init -b main
printf 'module sample-todo\n\ngo 1.27\n' > go.mod
printf 'package todo\n\nfunc CountCompleted(items []string) int {\n\treturn 0\n}\n' > todo.go
printf 'package todo\n\nimport "testing"\n\nfunc TestCountCompleted(t *testing.T) {\n\tif got := CountCompleted([]string{"done", "todo"}); got != 1 {\n\t\tt.Fatalf("CountCompleted = %%d, want 1", got)\n\t}\n}\n' > todo_test.go
git add . && git commit -m "fixture: failing TestCountCompleted"
go test ./...   # 预期：FAIL，TestCountCompleted 失败
```

```bash
# 2. 干净构建并用临时目录启动 M1（--data-dir 为 M1 计划参数）
make build
./bin/ateam serve --addr 127.0.0.1:8787 --data-dir /tmp/ateam-demo/data --web apps/web/dist
```

```bash
# 3. 创建 Workspace；合法路径返回 201，非法路径返回 400
curl -s -X POST http://127.0.0.1:8787/api/v1/projects -H 'Content-Type: application/json' \
  -d '{"name":"sample-todo","repoPath":"/tmp/ateam-demo/sample-todo","defaultBranch":"main","verificationCommands":["go test ./..."]}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/api/v1/projects \
  -H 'Content-Type: application/json' -d '{"name":"bad","repoPath":"/tmp/not-a-repo","defaultBranch":"main"}'
# 预期：第一条 201 且返回 id；第二条 400
```

4. 创建任务「修复示例测试并更新 README」，创建 runtime=claude 的 Agent，启动 Run。预期：Run 记录 queued→preparing→running→completed；worktree 路径不同于主仓库，分支名含 task/run 短码；日志流式出现；主仓库 `git status` 干净。
5. 打开 diff review 与证据面板。预期：diff 只包含允许路径；`test_report`、`log_bundle` 与 DoD 清单存在；系统复跑的 `go test ./...` 由失败变为通过；Agent 自述与系统复跑分列。
6. 失败测试语义（必测，不得判 Run 失败）：在示例仓库增加一个失败断言后重跑。预期 Run 可为 completed，但 test_report 标记失败、DoD 不满足、合并入口禁用，评审者只能 Request changes 或要求补证。另做「验证命令无法执行」场景（例如把 verificationCommands 改为不存在的可执行文件）：预期 Run 进入 failed 或证据标记 unverified，错误信息指出命令与原因，不得显示为通过。
7. 人工评审与合并：以人类身份 approve Review（Agent 身份调用返回 403）；调用 merge 携带 reviewId、expectedHeadCommit、targetBranch、strategy、confirm=true。预期成功，主分支出现提交，MergeRecord 记录 actor/SHA/结果；追加一个提交后重试合并，预期 412。未审批或证据哈希不符时预期 409/412，且无 git 写操作。
8. 排队取消：创建第二个 Run，在 queued 阶段取消；等待超过原执行时长，预期状态仍为 cancelled、无新事件、无 worktree 创建。
9. M0→M1 升级：用 M0 版本生成的数据库（含 Task/Agent/Run/RunEvent）启动 M1，记录升级前后各表数量与抽样内容；预期迁移成功、默认 Workspace 回填、数据不变；再用一个故意损坏的迁移副本启动，预期拒绝启动且原库可打开、日志给出备份路径。

预期结果与失败判定：主工作区被直接修改、未审批可合并、Task 未经 approved Review 进入 done、排队取消后仍执行、测试失败被误判为 Run failed、证据缺失、worktree 泄漏、升级丢数据，任一发生即 M1 不通过。

证据采集：保存 `git status`、`git log --oneline`、Run 事件 JSON、Artifact 清单与 sha256、MergeRecord JSON、升级前后表计数脚本输出、失败注入的命令与退出码；截图命名 `<ac>-<step>.png`，存放于 `prd/evidence/M1/<date>/`。演示结束删除 `/tmp/ateam-demo` 并确认无残留 worktree 与进程。

### 4.3 M2：角色 Agent 协作

M2 的目标是让 UI Design、Frontend、Backend、DevOps 四类角色通过 DAG、交付物契约、权限和审批门协作，而不是让多个 Agent 自由聊天。

验收标准：

1. 任务 DAG 可创建、可视化、校验环；上游未验收时下游不能启动，readiness 返回结构化原因。
2. 每种角色有模板、交付物契约和 DoD；契约校验失败不能完成。
3. allowedPaths 与 allowedCommands 在服务端强制执行；越界写入与未授权命令被拒绝并产生事件。
4. 推送、staging 部署、删除、权限升级必须人工审批；DevOps 在 M2 只能执行 staging 与生成部署计划，staging 执行前必须有批准的 deploy_plan，prod 只能由人在 ATeam 之外执行并回填结果。合并的 M1 基线已由 AC-MERGE-01 覆盖，M2 起叠加 Approval。
5. 收件箱聚合待评审、待审批、阻塞、失败事项；已读状态按用户隔离。
6. 并行调度遵守 DAG 与资源上限；文件冲突可检测。
7. Crew/队长模式只做分派与汇总，不绕过审批门。

演示脚本（计划 15 分钟）：

```bash
# 1. 创建父任务与四个角色子任务（返回体只示意关键字段）
PARENT=$(curl -s -X POST http://127.0.0.1:8787/api/v1/tasks -H 'Content-Type: application/json' \
  -d '{"title":"新增用户资料页","status":"todo"}' | jq -r .id)
UI=$(curl -s -X POST http://127.0.0.1:8787/api/v1/tasks -H 'Content-Type: application/json' \
  -d "{\"title\":\"UI Design：资料页设计\",\"parentId\":\"$PARENT\",\"status\":\"todo\"}" | jq -r .id)
FE=$(curl -s -X POST http://127.0.0.1:8787/api/v1/tasks -H 'Content-Type: application/json' \
  -d "{\"title\":\"Frontend：资料页实现\",\"parentId\":\"$PARENT\",\"status\":\"todo\"}" | jq -r .id)
BE=$(curl -s -X POST http://127.0.0.1:8787/api/v1/tasks -H 'Content-Type: application/json' \
  -d "{\"title\":\"Backend：资料 API\",\"parentId\":\"$PARENT\",\"status\":\"todo\"}" | jq -r .id)
OPS=$(curl -s -X POST http://127.0.0.1:8787/api/v1/tasks -H 'Content-Type: application/json' \
  -d "{\"title\":\"DevOps：staging 部署计划\",\"parentId\":\"$PARENT\",\"status\":\"todo\"}" | jq -r .id)

# 2. 在 DAG 编辑器建立依赖 UI→FE、UI→BE、BE→OPS；保存后读取就绪状态
curl -s http://127.0.0.1:8787/api/v1/tasks/$UI/readiness | jq '{ready,reasons}'
curl -s http://127.0.0.1:8787/api/v1/tasks/$FE/readiness | jq '{ready,reasons}'
# 预期：UI ready=true；FE ready=false，reasons 含 dependency_unfinished
```

3. 启动 UI Design Run，产出设计说明与资源清单；提交 design_review 并人工批准后，Frontend 任务 readiness 变为 true。
4. 启动 Frontend Run，修改允许路径内的组件；手工尝试写入后端目录，预期服务端拒绝并产生 `permission_denied` 事件，Run 详情标注隔离等级为 enforced 或说明部分隔离。
5. 启动 Backend Run，产出 API 与测试；DevOps Agent 生成 `deploy_plan` 并请求 staging 部署。先不审批直接请求执行，预期返回 403/409 且无部署副作用；人工批准 deploy_plan 后重试，预期 staging 执行成功并记录审批人、计划哈希与结果。再请求 prod 部署，预期无执行入口、无生产凭据，只允许回填人工执行结果并写审计。
6. 打开收件箱，确认待评审、待审批、阻塞、失败四类事项齐全且可跳转；人工 approve 合并，确认 MergeRecord 与审计记录完整。
7. 故意删除一个上游交付物，预期下游任务变为 blocked 或 readiness=false，不会继续执行。

预期结果与失败判定：DAG 允许无依赖下游提前执行、越界写入未被拒绝、未审批 staging 被执行、Agent 获得 prod 凭据、契约缺失仍可完成、收件箱遗漏审批事项，任一发生即 M2 不通过。

证据采集：保存 readiness 响应、`permission_denied` 事件、deploy_plan 与 Approval 记录、staging 执行日志、收件箱截图与审计导出；存放于 `prd/evidence/M2/<date>/`。演示结束撤销临时 Agent 的权限并清理测试部署。

### 4.4 M3：团队模式

M3 的目标是支持 2-10 人团队共享任务、Agent 和机器，同时保持本地优先与最小权限。

验收标准：

1. Postgres 存储与 SQLite 的领域行为一致；迁移、备份、恢复可执行。
2. 登录、会话、角色权限生效；跨团队数据隔离；越权操作按 AC-SEC-07 的 404/403 语义拒绝。
3. 远程 Runner 可注册、心跳、领取任务、回传事件；运行中失联的 Run 置为 failed + `errorCode=runner_lost`，任务保留人工重试入口，不自动跨机重跑。
4. 共享 Agent 的可见范围与编辑权限明确；敏感配置不下发到无权限的 Runner。
5. 审计覆盖登录、配置变更、审批、合并、部署、Runner 注册；审计可查询、不可由普通用户篡改。
6. GitHub PR 创建与状态回写需要人工审批；不能在未审批时推送。
7. 远程执行失败可定位到机器、Run、日志片段；不会静默丢失任务。

演示脚本（计划 15 分钟）：

```bash
# 1. 按 M3 部署文档以团队模式启动（Postgres）；从启动日志或实例发现文件取得服务地址
export ATEAM_URL='http://127.0.0.1:8787'

# 2. 用户 A、B 登录；A 创建任务，B 读取同一任务（登录字段与认证头以 api-and-data 为准）
TOKEN_A=$(curl -s -X POST "$ATEAM_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","password":"<password>"}' | jq -r .token)
TOKEN_B=$(curl -s -X POST "$ATEAM_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"b@example.com","password":"<password>"}' | jq -r .token)
TASK=$(curl -s -X POST "$ATEAM_URL/api/v1/tasks" -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{"title":"团队任务","status":"todo"}' | jq -r .id)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN_B" \
  "$ATEAM_URL/api/v1/tasks/$TASK"
# 预期：B 读取可见任务返回 200；B 修改 A 的私有 Agent 返回 403/404

# 3. 生成一次性注册令牌并启动 Runner（令牌复用应失败）
REG_TOKEN=$(curl -s -X POST "$ATEAM_URL/api/v1/machines/register-tokens" -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{}' | jq -r .token)
# 默认有效期 15 分钟；字段以 api-and-data 的 M3 端点定义为准
printf '%s' "$REG_TOKEN" > /tmp/ateam-team/reg.token && chmod 600 /tmp/ateam-team/reg.token
./bin/ateam runner --server "$ATEAM_URL" --token-file /tmp/ateam-team/reg.token
# 预期：机器 online，心跳 15 秒；同一令牌第二次注册失败
```

4. 让远程 Runner 领取一个任务并回传事件；运行中杀掉 Runner 进程，等待 45 秒后预期机器 offline、Run 变为 failed + `runner_lost`、保留最后事件与租约记录，任务显示重试入口且不自动在另一台机器重跑。
5. 用户 B 尝试越权删除共享 Agent，预期返回 403/404，并产生审计记录。
6. 完成一次 PR 流程：请求推送 Run 分支，未审批时预期 403；人工批准后推送并创建 PR，记录 PR URL、编号与状态；在 GitHub 侧合并后确认状态回写 Task/Run；系统不得自动合并。
7. 查询审计日志并导出 JSON/CSV，核对操作者、时间、对象、结果与哈希链；手工篡改一条记录后校验必须失败。

预期结果与失败判定：Runner 失联后 Run 被静默重跑、未审批可推送、跨团队可读、审计缺失或可篡改、PR 状态丢失，任一发生即 M3 不通过。

证据采集：登录与权限矩阵输出、Runner 日志与心跳记录、Run 事件与 `runner_lost` 错误码、PR URL、审计导出文件及哈希校验结果；存放于 `prd/evidence/M3/<date>/`。演示结束撤销测试令牌并清理团队数据。

### 4.5 M4：自动化与分发

M4 的目标是让 ATeam 可安装、可升级、可自动化触发，并保持插件与遥测的边界。

验收标准：

1. 定时与 Webhook 可触发任务；Webhook 有签名校验、重放保护与失败重试；自动化默认只创建 Backlog Task，不自动审批、合并、推送或部署。
2. 通知覆盖运行完成、失败、待审批；可配置渠道，通知内容不泄露代码与密钥。
3. DMG、NSIS、AppImage 可安装、启动、卸载；版本号一致；卸载默认保留用户数据。
4. 自动更新可检测、下载、校验、安装；失败可回滚，不破坏本地数据；默认关闭。
5. 插件 API 有权限边界、版本兼容策略与失败隔离；恶意插件不能读取未授权文件，也不能调用审批或合并。
6. 遥测默认关闭或明确 opt-in，可查看、导出、删除；关闭后无上报。
7. 文档覆盖安装、升级、Runtime 配置、权限、故障排查与隐私说明。

演示脚本（计划 15 分钟）：

```bash
# 1. 干净机器安装产物；从实例发现文件或启动日志取得服务地址
export ATEAM_URL='http://127.0.0.1:8787'
curl -s "$ATEAM_URL/api/v1/health" | jq '{version,commit,buildTime}'
# 预期：版本与安装包/关于页一致，不出现 0.1.0-dev

# 2. 签名 Webhook：正确签名返回 202，重复返回 409，错误签名返回 401
#    签名头名称与签名串格式以 M4-HOOK-004 文档为准；HOOK_ID/HOOK_SECRET 从创建响应与环境变量取得
TS=$(date +%s)
BODY='{"title":"来自 Webhook 的任务"}'
SIG=$(printf '%s' "$TS$BODY" | openssl dgst -sha256 -hmac "$HOOK_SECRET" -hex | awk '{print $2}')
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ATEAM_URL/api/hooks/$HOOK_ID" \
  -H "X-Ateam-Timestamp: $TS" -H "X-Ateam-Signature: $SIG" -H 'Content-Type: application/json' -d "$BODY"
# 预期：202 + delivery ID；原样重放 409；篡改签名 401；Task 默认进入 Backlog
```

3. 观察通知：Run 完成、失败、待审批各产生一条通知；同一任务同类通知 10 分钟内聚合；通知内容不含代码、路径与密钥。
4. 自动更新：在测试更新通道发布新版本清单与安装包，执行检查与安装，确认版本变化且本地任务数据保留；再用签名错误的清单重试，预期拒绝下载/安装；模拟新版本启动失败，预期回滚到上一版本。
5. 安装本地测试插件，尝试调用合并或审批接口，预期 403 并写审计；停用插件后确认不再收到事件；卸载后核心功能不受影响。
6. 关闭遥测并进行网络抓包，预期无上报；开启后导出本地遥测记录，核对字段不包含任务标题、描述、评论、代码、diff、路径与用量明细，再执行删除。

预期结果与失败判定：未签名或重放 Webhook 创建了任务、通知泄露代码、更新未验签、插件可审批或读越权文件、关闭遥测后仍有上报，任一发生即 M4 不通过。

证据采集：安装与卸载录屏、健康检查输出、Webhook 投递日志、通知截图、更新清单与验签结果、插件审计事件、抓包文件与遥测导出；存放于 `prd/evidence/M4/<date>/`。演示在干净虚拟机执行，结束后恢复快照。

## 5. 测试矩阵

### 5.1 分层测试矩阵

| 层级 | 目标 | 工具与方法 | 触发时机 | 证据 | 当前状态 |
|---|---|---|---|---|---|
| Go 单元测试 | 领域规则、存储、状态机、路径拼接 | `go test`，表驱动，临时 SQLite | 每次提交 | 测试退出码与报告 | 部分存在，仅 Store 生命周期测试 |
| Go 竞态测试 | 调度、事件、取消并发安全 | `go test -race` | CI 与发布前 | race 报告 | 未配置 |
| 前端单元测试 | Store、composable、组件逻辑 | Vitest + Vue Test Utils | 每次提交 | 覆盖率与报告 | 未配置 |
| 接口集成测试 | REST、WebSocket、错误码、事件顺序 | `httptest` + 临时数据库 + Mock Runtime | 每次提交 | 接口断言报告 | 未配置 |
| 契约测试 | API schema、共享类型、事件 envelope | JSON Schema / OpenAPI 校验 | 合并前 | 契约差异报告 | 未配置 |
| E2E 测试 | 看板、任务详情、Run 日志、审批流程 | Playwright 驱动 Web UI | 每日与发布前 | 录屏、截图、trace | 未配置 |
| 桌面验收 | Wails 壳启动、加载、关闭 | 手工 + 平台构建 | 发布前 | 操作记录 | 仅编译验证 |
| 手工探索 | 新功能、异常路径、可访问性 | 手工 checklist | 每个里程碑 | checklist 签署 | 未建立 |
| 回归测试 | 已修缺陷与核心闭环 | 自动化回归集 + 冒烟脚本 | 每次合并/发布 | 回归报告 | 仅冒烟脚本思路 |
| 性能测试 | API、调度、并发 Run、看板大数据量 | Go benchmark、k6 或 vegeta | 里程碑与发布前 | 基准报告 | 未配置 |
| 安全测试 | 路径逃逸、命令注入、密钥泄露、审批绕过 | 负向用例、静态扫描、依赖扫描 | 合并前与发布前 | 安全报告 | 未配置 |
| 兼容性测试 | macOS、Linux、Windows | 构建矩阵与安装测试 | 发布前 | 平台矩阵 | 仅 macOS 开发验证 |

### 5.2 测试用例编号与追踪

测试用例编号规则为「TC-」加模块名加三位序号，例如 `TC-RUN-003`。每个 AC 至少对应一个 TC；一个 TC 可以覆盖多个 AC，但必须在测试报告中列出覆盖关系。自动化测试名称应包含 AC 编号或缺陷编号，便于从失败用例反查需求。

M0 与 M1 的 AC→TC 映射如下；「自动化位置」中的路径为计划路径（当前仓库只有 `internal/store/sqlite_test.go`），M1 首次落地时必须按此表补齐或在验收记录中说明替代位置：

| AC | TC 编号 | 层级 | 自动化位置 | 负责人 |
|---|---|---|---|---|
| AC-TASK-01 | TC-TASK-001 | Go 集成 | `internal/api/tasks_test.go`、`internal/store/sqlite_test.go` | 后端模块作者 |
| AC-TASK-02 | TC-TASK-002 | Go 表驱动 | `internal/api/tasks_test.go` | 后端模块作者 |
| AC-TASK-03 | TC-TASK-003（M0 手工）/TC-TASK-103（M1） | E2E | `apps/web/e2e/board.spec.ts` | 前端模块作者 |
| AC-TASK-04 | TC-TASK-004 | E2E | `apps/web/e2e/task-detail.spec.ts` | 前端模块作者 |
| AC-TASK-05 | TC-TASK-005 | Go 集成 | `internal/api/tasks_test.go` | 后端模块作者 |
| AC-TASK-08 | TC-TASK-108 | Go 集成 + 手工 | `internal/api/tasks_test.go` | 后端模块作者 |
| AC-AGENT-01 | TC-AGENT-001 | Go 集成 | `internal/api/agents_test.go` | 后端模块作者 |
| AC-AGENT-02 | TC-AGENT-002 | Go 单元 | `internal/runtime/prompt_test.go` | Runtime 模块作者 |
| AC-AGENT-03 | TC-AGENT-003 | Go 单元 | `internal/runtime/registry_test.go` | Runtime 模块作者 |
| AC-AGENT-04 | TC-AGENT-004（字段）/TC-AGENT-104（超时） | Go 集成 | `internal/scheduler/timeout_test.go` | 调度模块作者 |
| AC-AGENT-08 | TC-AGENT-108 | Go 集成 | `internal/scheduler/snapshot_test.go` | 调度模块作者 |
| AC-RUN-01 | TC-RUN-001（M0）/TC-RUN-101（M1 单活跃） | Go 集成 | `internal/api/runs_test.go` | 后端模块作者 |
| AC-RUN-02 | TC-RUN-002（M0 流转）/TC-RUN-102（M1 状态守卫） | Go 单测 + 竞争 | `internal/scheduler/state_test.go` | 调度模块作者 |
| AC-RUN-03 | TC-RUN-003 | Go 集成 | `internal/store/events_test.go` | 存储模块作者 |
| AC-RUN-04 | TC-RUN-004（运行中）/TC-RUN-104（排队中） | Go 集成 | `internal/scheduler/cancel_test.go` | 调度模块作者 |
| AC-RUN-05 | TC-RUN-105 | Go 集成 | `internal/scheduler/timeout_test.go` | 调度模块作者 |
| AC-RUN-06 | TC-RUN-006 | Go 故障注入 | `internal/runtime/failure_test.go` | Runtime 模块作者 |
| AC-RUN-07 | TC-RUN-107 | Go 并发 | `internal/scheduler/concurrency_test.go` | 调度模块作者 |
| AC-RUN-08 | TC-RUN-108 | Go 集成 | `internal/scheduler/workspace_test.go` | 调度模块作者 |
| AC-RUN-09 | TC-RUN-109 | Go 集成 + 文件系统检查 | `internal/workspace/cleanup_test.go` | Workspace 模块作者 |
| AC-RUN-10 | TC-RUN-110 | Go 集成 | `internal/api/artifacts_test.go` | 后端模块作者 |
| AC-RUN-11 | TC-RUN-111 | Go 集成 | `internal/scheduler/recovery_test.go` | 调度模块作者 |
| AC-RUN-12 | TC-E2E-101 | E2E + 手工演示 | `apps/web/e2e/local-loop.spec.ts` | 产品经理 + 工程负责人 |
| AC-PROJ-01/02 | TC-PROJ-001/002 | Go 集成 | `internal/api/projects_test.go` | 后端模块作者 |
| AC-REVIEW-01/02 | TC-REVIEW-001/002 | Go 集成 | `internal/api/reviews_test.go` | 后端模块作者 |
| AC-MERGE-01/02 | TC-MERGE-001/002 | Go 集成 + 临时 git 仓库 | `internal/merge/merge_test.go` | 后端模块作者 |
| AC-UI-01～04 | TC-UI-001～004 | E2E | `apps/web/e2e/board.spec.ts`、`task-detail.spec.ts` | 前端模块作者 |
| AC-UI-05 | TC-UI-105 | E2E | `apps/web/e2e/review.spec.ts` | 前端模块作者 |
| AC-UI-09 | TC-UI-009 | 手工 | `prd/evidence/` 操作记录 | 工程负责人 |
| AC-API-01～04 | TC-API-001～004（M0）/TC-API-101～104（M1） | Go 接口测试 | `internal/api/routing_test.go`、`error_test.go`、`ws_test.go` | 后端模块作者 |
| AC-API-05～08 | TC-API-105～108 | Go 接口测试 | `internal/api/events_test.go`、`pagination_test.go`、`health_test.go` | 后端模块作者 |
| AC-API-09 | TC-CLI-001 | CLI 集成 | `cmd/ateam/cli_test.go`（计划） | 后端模块作者 |
| AC-SEC-01 | TC-SEC-001（M0）/TC-SEC-101（M1 Origin 矩阵） | Go 接口 + 手工 | `internal/api/origin_test.go` | 安全负责人 |
| AC-SEC-04/08 | TC-SEC-104/108 | Go 模块 + CI | `internal/security/redact_test.go`、CI `govulncheck` | 安全负责人 |
| AC-SEC-11 | TC-SEC-111 | 手工抓包 + 脚本 | `scripts/verify/egress_check.sh`（计划） | 安全负责人 |
| AC-NFR-01/02 | TC-NFR-101/102 | Go benchmark + 压测 | `internal/scheduler/bench_test.go` | 性能负责人 |
| AC-NFR-03 | TC-NFR-103（含 M0→M1 升级） | Go 集成 + 升级脚本 | `internal/store/migrate_test.go`、`scripts/verify/upgrade_check.sh` | 存储模块作者 |
| AC-NFR-04/05/07 | TC-NFR-104/105/107 | 手工 + 日志检查 | `prd/evidence/` 报告 | 工程负责人 |
| AC-NFR-09/10 | TC-NFR-109/110 | 手工抓包 + 长跑脚本 | `scripts/verify/offline_check.sh`、`soak_check.sh`（计划） | 性能/安全负责人 |

M2-M4 的 TC 规划：M2 使用 `TC-COLLAB-*`、`TC-AGENT-2xx`、`TC-UI-2xx`、`TC-SEC-2xx`、`TC-NFR-2xx`，覆盖 AC-COLLAB-01～10、AC-AGENT-05～07、AC-UI-06～08、AC-SEC-02/03/05/06/10、AC-NFR-06；M3 使用 `TC-TEAM-001～020` 覆盖 AC-TEAM-01～06 与 AC-SEC-07；M4 使用 `TC-AUTO-001～015` 覆盖 AC-AUTO-01～06 与 AC-SEC-09/AC-NFR-08。每个里程碑开工时把上述 TC 落到独立测试文档 `prd/testcases/<milestone>.md`，字段与上表相同；本表是 M0/M1 的规范映射，也是后续 TC 文档的模板。未建立 TC 的 AC 不得在验收记录中标记「通过」，只能标记「阻塞」或「有条件通过」并说明原因。

追踪要求：

- 每个里程碑开始时锁定 AC 清单，变更需产品经理确认。
- 每个 AC 在验收记录中必须有状态与证据链接。
- 修复缺陷时新增「TC-REG-」加缺陷号的回归用例，例如 `TC-REG-D-M0-01`，缺陷关闭前该用例必须通过。
- 删除或合并 AC 时保留历史记录，不能直接覆盖。

### 5.3 覆盖策略

初期不追求全量覆盖率数字，而是按风险分配测试投入：

| 模块 | 优先测试内容 | 目标 |
|---|---|---|
| Store | 迁移、CRUD、重启持久化、并发写入 | 语句覆盖不低于 70%，关键错误分支全覆盖 |
| Scheduler | 状态流转、取消、超时、并发、崩溃恢复 | 关键状态组合全覆盖 |
| Runtime | 适配器选择、失败退出、stderr、超时、进程终止 | 成功与失败路径全覆盖 |
| Workspace | Run Workspace 隔离、worktree 生命周期、清理、路径逃逸 | 负向路径全覆盖 |
| API | 状态码、校验、错误格式、事件顺序 | 路由与错误分支全覆盖 |
| 协作 | DAG 环、依赖阻塞、契约校验、审批绕过 | 负向用例优先 |
| UI | 主路径、空状态、错误状态、键盘操作 | 主路径 E2E 全覆盖 |

覆盖率的数字目标在 M1 基准测试后固化，并由 CI 执行。覆盖率下降时阻止合并，除非有明确理由与补救计划。

### 5.4 缺陷分级与回归规则

缺陷分级沿用 S0-S3。缺陷修复流程：

1. 用最小步骤复现并记录环境、输入、实际结果、期望结果。
2. 编写失败测试或手工复现用例，确认能稳定复现。
3. 修复后运行该用例与相关回归集。
4. 在验收记录中更新缺陷状态与证据。
5. S0/S1 缺陷关闭前不得发布；S2/S3 可带问题发布，但必须有责任人与排期。

回归集分层：核心回归（Task/Agent/Run 主路径）、模块回归（受影响模块）、里程碑回归（演示脚本）。每次合并至少跑核心回归；每次发布跑全部三层。

## 6. 测试环境与测试数据

### 6.1 环境矩阵

当前实际环境（2026-11-17）：

| 组件 | 版本 | 说明 |
|---|---|---|
| 操作系统 | macOS 26.6.2（Darwin 25.6.0，amd64） | 当前开发与验证环境 |
| Go | 1.27.1 | 与 `go.mod` 的 go 1.27.0 匹配 |
| Node.js | v24.18.0 | 满足 Node 24+ 要求 |
| pnpm | 11.9.0 | 与 `packageManager` 一致 |
| Wails | v3.1.0 | 来自 `go.mod` |
| SQLite 驱动 | modernc.org/sqlite v1.62.0 | 纯 Go，便于跨平台 |

CI 环境：GitHub Actions，Go job 使用 `go.mod` 指定版本，Web job 使用 pnpm 11 与 Node 24。M1 起增加 macOS 桌面构建 job 与 Linux 打包冒烟；M4 增加 Windows。

### 6.2 隔离规则

- 单元与集成测试使用临时目录与临时数据库，禁止连接开发者日常数据库。
- 当前 `ateam serve` 的 `--db` 只改变数据库路径，工作区仍位于用户主目录下的 `~/.ateam/workspaces`；自动化测试必须通过设置临时 `HOME` 或 API-1201 计划新增的 `--data-dir` 参数隔离工作区，避免污染真实目录。这是当前可测试性缺口，列入第 9 节。
- 端口使用随机空闲端口或固定隔离端口，测试结束释放。
- 测试不访问公网；真实 Claude Code 测试默认跳过，需要显式开启。
- 测试结束清理临时仓库、worktree、数据库、日志与截图；失败时保留诊断产物并注明位置。

### 6.3 示例仓库与测试数据

M1 起在仓库内建立 `testdata/repos/`，只存放小型、确定性、无密钥的示例：

| fixture | 内容 | 用途 |
|---|---|---|
| `sample-todo`（M1 演示外部仓库） | M1 计划由 `scripts/demo/sample-todo.sh` 在 `/tmp/ateam-demo/sample-todo` 生成；脚本未就绪时按 §4.2 命令手工生成；main 分支初始提交为 `fixture: failing TestCountCompleted`，`go test ./...` 预期失败 | M1 演示、AC-MERGE-01/02 手工验收 |
| `minimal-go` | 一个 Go module、一个 handler、一条可通过与一条可失败测试 | Run、diff、测试证据、超时 |
| `minimal-vue` | 一个 Vue 组件、一个 Vitest 用例、一个样式文件 | UI 角色、前端交付物、截图证据 |
| `conflict-pair` | 两个分支修改同一文件 | 合并冲突与人工处理 |
| `permission-escape` | 包含符号链接、`..` 路径、敏感文件名 | 路径逃逸负向测试 |
| `large-tree` | 脚本生成的千文件仓库，不提交生成物 | 性能与 diff 规模测试 |

测试数据规则：固定文本、固定种子、固定初始提交；禁止放入真实用户代码、真实密钥、真实截图；每个 fixture 附 README 说明预期行为与清理方式。`sample-todo` 是 M1 文档定义的外部演示仓库，不放入 `testdata/repos/`；生成方式见 §4.2，预期失败测试为 `TestCountCompleted`，演示后删除 `/tmp/ateam-demo`，不得提交到仓库。

### 6.4 Mock Runtime 测试数据

当前 Mock Runtime 的行为是确定性模拟：约 350 毫秒一步，共四步，先输出一条启动日志，再输出四条步骤日志和一条 summary，总时长约 1.4 秒。它不访问网络、不修改工作区，适合作为 API、调度、UI 和 E2E 的默认 Runtime。

验收要求：

- Mock Run 的事件类型、数量、顺序必须稳定；断言基于事件类型与序号，不依赖具体文案。
- 需要测试失败、超时、取消时，M1 增加故障注入配置，例如指定失败步骤、延迟、退出码；在实现前不得假设这些配置已存在。
- Mock Runtime 不得被用来宣称真实 Claude Code 行为已验证；两者证据必须分开记录。
- 并发测试使用 Mock Runtime 时，必须显式控制每个 Run 的完成时间，避免用固定等待造成偶发失败。

### 6.5 Claude Code Runtime 测试

真实 Claude Code adapter 的测试分三层：

1. 适配器单元测试：不启动真实 CLI，使用假的可执行文件验证参数、工作目录、stdout/stderr 采集、退出码与超时。
2. 本地手工集成测试：开发机已安装并登录 Claude Code，在示例仓库执行只读或小改动任务，确认流式日志、diff、测试输出与取消。
3. 可选的真实 CLI 回归：在受控环境显式开启，使用专用测试账号或本地凭据，任务只针对 fixture 仓库，禁止指向真实项目。

当前适配器实现较基础：通过 PATH 查找 `claude`，以 `-p` 传入提示词，设置工作目录，逐行采集 stdout 与 stderr。M1 验收要求补齐模型选择、权限参数、结构化流解析、退出码映射与取消后的进程清理。未安装 CLI 时必须返回可读错误，而不是让 Run 悬挂。

安全要求：真实 Runtime 测试不得把密钥写入仓库、日志或截图；测试仓库不得包含生产数据；每次测试后检查是否有残留进程、worktree 与临时文件。

## 7. 质量门

### 7.1 当前质量门（M0 实际）

| 质量门 | 命令 | 覆盖范围 | 当前结果 | 是否阻断 |
|---|---|---|---|---|
| Go 测试 | `go test $(go list ./... \| grep -v '/apps/desktop')` | 全部 Go 包，桌面包除外 | 通过，仅 Store 有测试 | 是 |
| Go 静态检查 | `go vet $(go list ./... \| grep -v '/apps/desktop')` | 全部 Go 包 | 通过 | 是 |
| 前端类型检查 | `pnpm --filter @ateam/web typecheck` | Vue + TypeScript | 通过 | 是 |
| 前端构建 | `pnpm --filter @ateam/web build` | Vite 生产构建 | 通过 | 是 |
| Go 二进制构建 | `go build ./cmd/ateam` | CLI | 通过 | 是 |
| 桌面构建 | `go build ./apps/desktop` | Wails 壳 | 通过，存在 macOS 链接器警告 | 否（有待清理） |
| CI | `.github/workflows/ci.yml` | Go test/vet、Web install/typecheck/build | 配置存在，本次未在 CI 远端执行 | 是 |

当前没有配置 lint、覆盖率、前端单测、E2E、依赖漏洞扫描与桌面平台构建。M0 可以把这些列为条件，但 M1 起必须补齐。

### 7.2 目标质量门

M1：

- `go test -race` 覆盖 Store、Scheduler、Workspace、Runtime、API。
- 核心包覆盖率不低于 70%，关键状态与错误分支全覆盖。
- `golangci-lint` 与前端 ESLint/Prettier 接入；无新增告警。
- Vitest 覆盖 Store 与关键组件；Playwright 覆盖看板、任务详情、Run 生命周期冒烟。
- `govulncheck` 与 `pnpm audit` 接入；高危漏洞阻断。
- M0→M1 数据库升级测试（含升级失败拒绝启动与原库可打开）。
- 断网冒烟与静态资源扫描（无 CDN/远程字体）。
- 桌面构建进入 macOS CI；打包另行安排。
- 手工 checklist 完成并签署。

M2：

- DAG 环检测、依赖阻塞、契约校验、权限矩阵、审批绕过的负向测试全部通过。
- 5 个并行 Run 的负载测试通过；无状态串写、无事件丢失。
- 角色模板与收件箱的 E2E 覆盖主路径。
- 安全测试覆盖路径逃逸、命令注入、密钥泄露。

M3：

- Postgres 集成测试与迁移测试通过；SQLite 与 Postgres 行为差异有对照表。
- 登录、会话、RBAC、跨团队隔离的权限矩阵通过。
- 远程 Runner 的注册、心跳、断线、重试、离线任务回收测试通过。
- 审计不可篡改测试通过；GitHub PR 审批链路通过。

M4：

- 三平台打包与安装冒烟通过。
- 自动更新成功、失败回滚测试通过。
- Webhook 签名、重放保护、失败重试测试通过。
- 插件权限边界与遥测关闭测试通过。

### 7.3 手工验收 checklist

每次里程碑验收至少执行以下清单，M0 只执行与当前能力相关的条目：

- 看板：创建任务、拖拽改状态、刷新后状态保持、空列空状态、接口失败提示。
- 任务详情：切换状态、选择 Agent、启动 Run、日志实时出现、取消运行中的 Run、失败 Run 显示错误。
- Agent：创建 Mock Agent、创建 Claude Agent、默认值正确、必填校验、列表展示完整。
- Runs：列表数据正确、点击行跳转、终态与摘要一致。
- 设置：健康检查成功与失败两种状态都能展示。
- 事件流：断开服务后重连，页面能恢复数据；重复事件不造成重复卡片。
- 持久化：停止并重启服务，任务、Agent、Run、事件仍可读取。
- 桌面：窗口启动、加载、关闭；开发模式与构建产物行为一致。
- M1 追加：worktree 创建与清理、diff 评审、Artifact 展示、Review/Merge 审批、排队取消、M0→M1 升级、断网启动、请求体超限 413、WebSocket 退避重连。
- M2 追加：DAG 依赖、契约校验、路径/命令拒绝、审批门、收件箱、DevOps staging 未审批拒绝与 prod 无执行入口。
- M3 追加：登录、越权拒绝、远程 Runner、审计查询、PR 审批。
- M4 追加：安装包、自动更新、Webhook、通知、插件、遥测开关。

### 7.4 发布准入与退出标准

发布准入必须同时满足：

1. 质量门全部通过，CI 无阻断失败。
2. 零 S0、零未关闭 S1；S2 有责任人与排期。
3. 里程碑演示脚本在干净环境完整执行并留存证据。
4. 验收记录完成签署，未验证项明确列出且不影响发布范围。
5. 文档与实现一致，不把计划能力写成已实现能力。

## 8. 验收记录模板

每次里程碑验收复制以下模板填写。模板本身不写入代码仓库的业务目录，建议存放于 `prd/evidence/[里程碑]/[日期]-acceptance.md`。模板中的示例行用于说明填写粒度，复制时替换为本次验收项。

```markdown
# ATeam 验收记录：[里程碑]

## 基本信息

- 验收日期：
- 验收人：
- 版本 / 构建号：
- 代码提交：
- 环境：操作系统、Go、Node、pnpm、Wails、数据库
- 验收范围：
- 关联文档：模块 FR 版本、里程碑文档版本

## 验收结果

| 验收编号 | 引用 FR | 结果（通过/有条件/不通过/阻塞/不适用） | 证据 | 备注 |
|---|---|---|---|---|
| AC-RUN-01（示例） | RUN-080、TASK-021、TASK-022、TASK-030 | 通过 | POST /api/tasks/{id}/runs 返回 201；事件序号 1-6 | M0 冒烟记录 |

## 缺陷

| 缺陷编号 | 等级 | 描述 | 复现步骤 | 影响 | 状态 | 责任人 |
|---|---|---|---|---|---|---|
| D-M0-01（示例） | S1 | 排队中 Run 取消后仍执行 | 单 worker 取消第 3 个 Run，5 秒后变 completed | 取消语义错误 | 已修复 | 工程负责人 |

## 未验证项与风险

- 未验证项：
- 已知风险：
- 依赖与假设：

## 签署

- 产品经理：
- 工程负责人：
- 设计负责人（如涉及）：
- 安全负责人（如涉及）：
- 结论：通过 / 有条件通过 / 不通过 / 阻塞
- 条件与关闭时间：
```

填写要求：证据必须可访问；复现步骤必须包含环境与输入；结果不能只写「正常」；有条件通过必须写明条件与关闭时间。§1.6 的「不适用」只用于单项，不能作为里程碑结论；里程碑结论采用通过、有条件通过、不通过、阻塞四态，单项结果为「不适用」时必须在备注写明原因。示例记录可以引用真实冒烟结果，例如「AC-RUN-01 通过，证据：POST /api/tasks/{id}/runs 返回 201，Run 初始状态 queued，随后 completed，事件序号 1-6」。

## 9. 当前 M0 已验证项与未验证项

### 9.1 验证环境与基线

本次验证于 2026-11-17 在 macOS 26.6.2（Darwin 25.6.0，amd64）执行，使用 Go 1.27.1、Node v24.18.0、pnpm 11.9.0、Wails v3.1.0。验证对象为当前工作区代码，未使用第三方研究资料。验证方式包括命令执行、HTTP 冒烟、WebSocket 冒烟、SQLite 重启检查和并发取消探测。

### 9.2 已验证项

| 验证项 | 命令或操作 | 实际结果 | 结论 |
|---|---|---|---|
| Go 测试 | `go test $(go list ./... \| grep -v '/apps/desktop')` | 全部包通过；仅 `internal/store` 有测试文件，其余包无测试 | 通过（测试覆盖有限） |
| Go 静态检查 | `go vet $(go list ./... \| grep -v '/apps/desktop')` | 退出码 0 | 通过 |
| 前端类型检查 | `pnpm --filter @ateam/web typecheck` | `vue-tsc --noEmit` 退出码 0 | 通过 |
| 前端构建 | `pnpm --filter @ateam/web build` | 63 个模块转换成功，生成 `apps/web/dist` | 通过 |
| CLI 构建 | `go build ./cmd/ateam` | 生成可执行文件 | 通过 |
| 桌面构建 | `go build ./apps/desktop` | 编译成功；存在 macOS 部署目标链接器警告 | 通过（有警告） |
| 健康检查 | `GET /api/health` | 返回 `status=ok`、`version=0.1.0-dev` | 通过 |
| Task 创建与读取 | `POST /api/tasks`、`GET /api/tasks/{id}` | 201 创建，ID 自动生成，缺省 status=backlog、priority=0、labels=[]，字段完整 | 通过 |
| Agent 默认值 | `POST /api/agents`，仅传名称与 runtime | 默认 workspaceMode=worktree、maxConcurrency=1、timeoutMinutes=60 | 通过 |
| Mock Run 闭环 | 创建任务与 Agent 后启动 Run | Run 从 queued 到 completed，约 1.4 秒，summary 为 `Completed with mock runtime` | 通过 |
| Run 事件 | `GET /api/runs/{id}/events` | 6 条事件，类型为 5 条 log 与 1 条 summary，seq 为 1-6 | 通过 |
| 任务自动关联 | 启动 Run 后读取任务 | assigneeType=agent、assigneeId 指向 Agent，todo 变为 in_progress | 通过 |
| 非法状态启动 | 对 backlog 任务启动 Run | 返回 409，错误信息提示先移动到 todo 或 in_progress | 通过 |
| 删除与 404 | `DELETE /api/tasks/{id}` 后 `GET` | 删除返回 204，读取返回 404 | 通过 |
| SPA 托管 | `GET /` | 返回 200，页面标题为 ATeam | 通过 |
| WebSocket 事件 | 连接 `/api/ws` 后执行创建与 Run | 收到 task.created、agent.created、task.updated、run.queued、run.preparing、run.running、run.event、run.updated | 通过 |
| 运行中取消 | 对非终态 Mock Run 调用取消 | 返回 cancelled，error 为 `run cancelled` | 通过 |
| SQLite 重启持久化 | 创建任务后停止并重启服务 | 任务仍可读取；迁移表只有 `0001_init.sql`，未重复执行 | 通过 |

补充观察：本次冒烟使用 `--db /tmp/...` 时，Run 的 worktree 字段仍指向 `~/.ateam/workspaces/runs/<run-id>`，说明 `--db` 不改变工作区根目录。该行为对测试隔离不友好，列为可测试性缺陷。

### 9.3 未验证项与已知缺陷

| 编号 | 等级 | 描述 | 证据 / 复现 | 处理阶段 |
|---|---|---|---|---|
| D-M0-01 | S1 | 排队中的 Run 被取消后仍会被调度执行，最终状态被覆盖为 completed，但 error 仍保留 `run cancelled` | 使用单 worker 提交 3 个 Mock Run，取消第 3 个；5 秒后其状态为 completed，事件 1-6 正常执行；与 RUN-085、02-domain-model DM-RUN-005 的语义冲突 | M1 首迭代修复并新增回归用例 |
| D-M0-02 | S2 | 桌面窗口未在无头环境实际启动验证，只验证了编译 | `go build ./apps/desktop` 通过，未运行 GUI | M1 手工验收 |
| D-M0-03 | S1 | 除 Store 生命周期外，没有 Scheduler、Workspace、Runtime、API、WebSocket 的自动化测试 | 测试文件列表仅 `internal/store/sqlite_test.go` | M1 |
| D-M0-04 | S1 | 真实 Claude Code adapter 未做端到端验证；当前实现只支持 `claude -p`，缺少模型、权限参数与结构化流解析 | 代码审阅与缺少 CLI 认证环境 | M1 |
| D-M0-05 | S1 | `workspaceMode` 字段被保存但未生效；当前每个 Run 只是普通目录，不是 git worktree；branch 字段为空 | Run 的 worktree 路径为普通目录，主仓库未被隔离 | M1 |
| D-M0-06 | S2 | 只限制全局 worker 数，未按 Agent 的 maxConcurrency 限制并发 | Scheduler 仅使用全局 workers | M2 |
| D-M0-07 | S2 | M0 的 PATCH 允许任意合法任务状态跳转，未执行受控转换矩阵与评审门 | API 代码审阅；02-domain-model DM-TASK-003、DM-TASK-004 要求 M1 起非法转换返回 409 | M1 |
| D-M0-08 | S1 | CORS 反射任意 Origin，WebSocket `CheckOrigin` 恒为 true；默认绑定回环地址降低风险，但改为对外监听时不安全 | 代码审阅 `internal/api/api.go`、`internal/events/hub.go` | M1/M3 |
| D-M0-09 | S2 | 没有崩溃恢复：进程退出时处于 running/preparing 的 Run 不会被标记中断，queued Run 也不会恢复 | 代码审阅 Scheduler 启动逻辑 | M1 |
| D-M0-10 | S2 | 列表接口无分页与筛选，任务和 Run 数量大时性能未验证 | API 代码审阅 | M1 |
| D-M0-11 | S3 | 前端任务与 Agent 的编辑、删除入口不完整；API 支持但 UI 仅覆盖创建、状态切换和 Run 操作 | 页面代码审阅 | M1 |
| D-M0-12 | S2 | 没有 Artifact/Evidence 数据模型，diff、测试输出、截图未与 Run 绑定 | 领域模型与数据库 schema 审阅 | M1（Artifact）/M2（Evidence） |
| D-M0-13 | S2 | 超时语义未验证；取消与超时、Runtime 失败的优先级未定义 | 缺少自动化测试 | M1 |
| D-M0-14 | S3 | 桌面构建出现 macOS 部署目标链接器警告（10.13 与 13.0/26.0 不一致） | 构建输出 | M1/M4 |
| D-M0-15 | S3 | 数据库迁移按分号简单切分 SQL，未来包含分号的语句会失败 | `internal/store/sqlite.go` 迁移逻辑 | M1 |
| D-M0-16 | S3 | 前端同时使用 WebSocket 全量刷新与任务详情 1.5 秒轮询，存在重复请求，暂未造成正确性问题 | 代码审阅 | M1 优化 |
| D-M0-17 | S2 | 同一任务可同时启动多个活跃 Run，未执行单活跃 Run 限制 | 连续创建 Run 均返回 201；TASK-030 要求 M1 起第二次返回 409 | M1 |
| D-M0-18 | S2 | 未知 Runtime 静默回退到 mock，可能把错误配置显示为成功 | 代码审阅 `runtime.Registry.Get`；AGENT-011 要求 M1 起创建 Agent 返回 400、启动 Run 前再次校验 | M1 |
| D-M0-19 | S3 | `GET /api/tasks/{id}/runs` 对不存在的 Task 返回空数组而不是 404 | API 代码审阅；API-1027 列为 M1 修复项 | M1 |
| D-M0-20 | S3 | 没有 `--data-dir`，测试与演示容易污染 `~/.ateam` 工作区 | 启动参数审阅；API-1201 计划新增 | M1 |
| D-M0-21 | S2 | 未知 `/api/*` 路径在配置 webDir 时返回纯文本 404（`http.NotFound`），未配置 webDir 时返回 200 占位 HTML；方法不匹配为 405 纯文本，不是 JSON 错误体 | `internal/api/api.go` 的 `webHandler`；AC-API-01 的 M0 行按此判定 | M1 |
| D-M0-22 | S2 | 错误体只有 `{"error":"..."}`，缺少 code、message、details、requestId、retryable | `internal/api/handlers.go` 的 `writeError`；AC-API-02 | M1 |
| D-M0-23 | S2 | 请求体上限用 `io.LimitReader` 截断 1 MiB，超限通常返回 400，代码中不存在 413 分支 | `internal/api/handlers.go` 的 `decodeJSON`；AC-API-03 | M1 |
| D-M0-24 | S2 | WebSocket 信封只有 type/data/at，无 id/seq/v/scope；无 30 秒 ping；前端固定 2 秒重连、无退避与 afterSeq | `internal/events/hub.go`、`apps/web/src/composables/useEventStream.ts`；AC-API-04 | M1 |

### 9.4 M0 验收结论

M0 作为骨架验收的结论是「有条件通过」：构建、类型检查、API 主路径、Mock Run、事件流、重启持久化和 SPA 托管均通过实际验证；但测试覆盖、真实 Runtime、worktree 隔离、取消队列语义、崩溃恢复和安全边界尚未达到 M1 要求。

D-M0-01 是唯一在本轮验证中实际复现的 S1 状态错误，必须在 M1 第一迭代修复，并新增「排队中取消后等待超过原执行时长仍为 cancelled 且事件不增加」的回归用例。D-M0-03 至 D-M0-05 属于已知能力缺口，不阻塞 M0 骨架，但阻塞 M1 退出。M0 的「完成」只表示骨架可运行，不表示可以用于真实项目的无人值守执行。

## 10. 与其他文档的关系

本章位于 PRD 的验收层，向下承接产品目标与模块需求，向上约束里程碑退出与发布准入：

- `prd/00-product-overview.md` 定义产品目标、用户与核心闭环；本章把这些目标转成可判定的验收项。
- `prd/01-scope-and-roadmap.md` 定义产品范围、里程碑顺序与发布标准；本章的里程碑验收与发布准入必须与路线图一致。
- `prd/02-domain-model.md` 定义领域对象、状态机、快照与权限默认值；本章的状态验收、快照验收与审批验收必须与该文档一致。该文档自 2026-11 修订起使用 `DM-` 需求前缀，本章引用时写全「02-domain-model DM-xxx」。
- `prd/03-user-flows.md` 定义主流程、角色协作流程、团队流程与通用规则；本章第 4 节的里程碑演示脚本以这些流程为蓝本，引用其需求时使用 FLOW- 编号。
- `prd/05-risks-and-open-questions.md` 定义风险、假设与开放问题；本章的缺陷分级、未验证项与待确认清单应与风险登记保持一致，风险缓解措施要能映射到验收用例。
- `prd/modules/task-management.md`、`prd/modules/agent-system.md`、`prd/modules/runtime-and-workspace.md`、`prd/modules/collaboration-and-review.md`、`prd/modules/ui-ux.md`、`prd/modules/security-and-permissions.md`、`prd/modules/api-and-data.md`、`prd/modules/non-functional-requirements.md` 定义各模块的 FR、交互、数据与边界；本章只引用 FR 编号与验收口径，不重复模块细节。模块 FR 变更时，必须同步更新本章的引用与验收用例。
- `prd/milestones/M0-scaffold.md`、`prd/milestones/M1-local-loop.md`、`prd/milestones/M2-role-agents.md`、`prd/milestones/M3-team-mode.md`、`prd/milestones/M4-automation-and-packaging.md` 定义各里程碑的目标、范围与交付物；本章第 4 节给出对应的验收标准与演示脚本，里程碑文档应以本章作为退出依据。M0 文档已经引用本章第 4.1、9 节作为证据来源；M1 文档已把本章列为验收用例来源，其 Workspace 命名已与本章 §11 第 17 项统一；M2 文档引用本章第 4.3 节；M3/M4 文档引用本章第 4.4/4.5 节。
- 安全文档（`prd/modules/security-and-permissions.md`）定义威胁模型与权限矩阵；本章第 3.8 节与第 7.2 节把安全要求转成负向测试与质量门。
- 设计文档与设计系统定义界面规范；本章 UI 验收只判断可用性与一致性，不替代设计评审。

维护规则：本章由产品经理维护，工程负责人共同签署。每次模块 FR、里程碑范围或质量门变更，都要触发本章对应表格的更新；验收记录不得只存在于聊天或会议纪要中。

## 11. 待确认/未文档化

以下问题在撰写本章时尚未有最终结论，需要在 PRD 评审与里程碑规划中明确。它们不是实现待办，而是会影响验收口径的产品决策：

1. FR 编号基线：本轮模块文档已经产出，本章引用以当前编号为准；评审后若模块文档调整编号，必须同步更新第 3.1 节与各验收表的引用列。
2. API 版本迁移窗口：API-1002 规定 `/api` 在 M1 作为弃用兼容前缀保留、作为永久兼容别名不删除；前端、CLI 与外部脚本的迁移窗口和弃用告警策略需要确认。
3. 模块口径冲突：空 `allowedPaths` 的语义在不同文档中不一致，AGENT-023 表示整个工作区，UI-067 显示「不可写任何路径」；评审时必须统一并以安全优先的原则回写。
4. 测试数据治理：fixture 仓库的维护责任、大小上限、是否允许包含历史缺陷样例，以及示例数据的许可证。
5. 覆盖率阈值与质量门阻断策略：按包还是按模块计算，覆盖率下降是否一律阻断，例外如何审批。
6. 性能基准的数据集与环境归一化：NFR 文档定义了基准 A/B/C，但验收需要固定数据集、机器规格与测量脚本，否则 p95 数字不可比较。
7. Claude Code 与 Codex adapter 的 CLI 契约：RUN-013 定义了能力，但具体参数、结构化流格式、权限模式与版本兼容策略仍需随 Runtime 版本固化。
8. 合并执行边界：M1 本地 git merge 与 M3 GitHub PR 的审批对象、commit 绑定与审计字段需要统一，避免两套语义。
9. 审批人角色与单人模式的例外：M0-M2 为单用户本地模式，四眼原则与职责分离在 M3 才完整生效；单人模式下哪些门允许自批、哪些必须二次确认，需要明确。
10. 遥测与隐私：端点、采集字段、保留期、导出与删除责任，以及企业策略开关。
11. 远程 Runner 信任模型：Runner 认证、事件签名、离线任务回收与重试上限的细节。
12. 桌面打包与签名：macOS 公证、Windows 签名、Linux 分发的账号与证书归属；自动更新服务器由谁运营。
13. 审计保留与合规：审计日志保留多久，是否需要导出给团队管理员，删除策略如何与隐私要求平衡。
14. 桌面 GUI 自动化策略：Wails WebView 是否可由 Playwright 直接驱动尚未验证；若不支持，需要明确「浏览器 E2E + 桌面手工冒烟」的分工。
15. 设计任务证据标准：COLLAB-054 要求 UI 变更附截图，但是否还需要视觉 diff、资源清单与多状态截图，需要设计评审确认。
16. 团队模式数据迁移：SQLite 到 Postgres 的迁移验收基线、双写或停机窗口策略，以及回滚条件。
17. **Workspace 与接口路径（已裁决）**：产品级实体统一为 Workspace（`workspaceId`，表 `workspaces`，默认 ID `default`），规范路径 `/api/v1/workspaces`，`/api/v1/projects` 仅为兼容别名；02-domain-model、api-and-data、runtime-and-workspace、03-user-flows 已按此回写。AC-PROJ-01/02 使用规范路径验收，不再标记「有条件通过」。
18. **越权响应语义（已裁决）**：统一为不可见资源 404、可见但角色不足 403；security §4.6 与 02-domain-model DM-PROJ-007 已一致，AC-SEC-07 按此验收。
19. M0 API 契约回写：D-M0-21～D-M0-24 记录了未知路径、错误体、请求体上限与 WebSocket 信封的实际行为；M1 实现前需确认 `/api` 兼容前缀的保留窗口（API-1002）与 413 错误码，避免验收标准再次超前于代码。
20. **Workspace 保留期（已裁决）**：Run Workspace（worktree）在已合并或放弃后默认保留 30 天；02-domain-model、runtime-and-workspace、api-and-data 与 M1 已统一。AC-RUN-09 按 30 天验收。
21. **合并失败错误码（已裁决）**：`expectedHeadCommit` 或证据快照变化返回 412 `STALE_HEAD`/`STALE_EVIDENCE`，Review 状态或分支非法返回 409；02-domain-model DM-MRG-003、api-and-data §13.3 与 AC-MERGE-01 已统一。

上述问题确认后，应回写本章、对应模块文档与里程碑文档；在确认前，相关验收项按「阻塞」或「有条件通过」处理，不作为已验收能力对外承诺。
