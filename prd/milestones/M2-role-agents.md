# 里程碑 M2：角色 Agent 协作

## 本章导读

本章定义 ATeam M2 里程碑「角色 Agent 协作」的目标、范围、用户故事、交付物、验收标准、演示脚本、依赖、风险与退出标准。M2 的核心命题不是「让更多 Agent 同时说话」，而是让 UI Design、Frontend、Backend、DevOps 四类角色 Agent 通过任务 DAG、交付物契约、审批门和证据化完成定义（DoD）完成一条可演示、可审计、可回滚的功能交付流水线。

**状态声明。** 当前仓库处于 M0 骨架阶段：Task、Agent、Run、RunEvent、SQLite、REST/WebSocket、Mock Runtime、最小 Claude CLI adapter、Vue 看板和 Wails 壳已经存在；git worktree、真实 Claude Code 流式适配、diff 评审、Artifact/Evidence、人工合并、任务依赖 DAG、交付物契约、角色模板、路径与命令权限执行、审批门、Crew、收件箱、技能和任务模板均未实现。M2 是计划，不是现状；M1 是 M2 的硬前置。任何把计划能力写成已实现的内容都违反本 PRD 的事实标记规则。

**阅读路径。** 第 1 至 3 章说明目标、范围与关键决策；第 4 至 6 章说明当前基线、角色与用户故事；第 7 至 12 章给出里程碑级需求追踪、交互规则、数据与 API 影响、异常边界、权限安全和指标；第 13 至 16 章给出阶段拆分、交付物、演示脚本、依赖、风险、验收与退出标准；第 17 至 19 章给出里程碑映射、文档关系与待确认事项。模块细节不在本章重复，统一指向 `prd/modules/` 下对应文档。

**本章的硬约束。** M2 不允许把合并、推送、部署、删除等高风险动作交给 Agent 自主执行；DevOps 在 M2 只能执行 staging 部署与生成生产部署计划，生产部署必须由人在 ATeam 之外执行；所有完成声明必须由证据支撑；角色之间的协作必须落到任务、契约和证据上，不得退化为共享会话中的自由聊天。

## 1. 里程碑目标

本章先定义 M2 要解决的问题、目标陈述与可验证结果，再据此划定范围与关键决策。

### 1.1 为什么单 Agent 闭环之后需要 M2

M1 解决的是「一个开发者把一个任务交给一个 Agent，在隔离工作区中执行，看到 diff 与证据，人工评审后合并」。这条闭环证明了 ATeam 的本地优先、可评审、可回滚的基本价值，但它只覆盖单角色、单任务、单执行者的情况。真实开发中，一个可交付的功能往往同时涉及设计、前端、后端和部署：设计意图需要传给前端，API 契约需要前后端共同遵守，构建与测试证据需要汇入合并评审，staging 部署需要有人批准。若没有显式的协作模型，多 Agent 开发会迅速退化为以下问题：

- **交接失真**：上游角色只给出一段自然语言总结，下游角色无法判断哪些是承诺、哪些是猜测，反复追问或重新实现。
- **职责漂移**：同一个 Agent 同时修改设计、前端、后端和部署脚本，权限边界消失，评审无法定位责任。
- **并行失控**：多个 Run 同时修改同一批文件，合并顺序靠运气，冲突在最后一步才暴露。
- **完成失真**：Agent 报告「完成了」，但没有 diff、测试、构建或截图证据，人类只能凭信任接受。
- **风险失控**：合并、推送、staging 与生产部署没有强制人工门禁，提示词中的「请不要这样做」被当成安全边界。
- **阻塞不可见**：Agent 卡住后没有升级路径，任务停在 `in_progress`，人类不知道应该介入。

M2 要解决的不是「Agent 数量不够」，而是「多角色协作缺少可验证的接口、可执行的权限和可追溯的决定」。

### 1.2 一句话目标

**让四类角色 Agent 围绕同一个交付目标，以任务 DAG 表达依赖、以交付物契约表达接口、以审批门控制风险、以证据化 DoD 声明完成，并在单机本地环境中完成一次从设计规格到 staging 部署的可演示流水线。**

M2 不追求覆盖所有研发流程，也不要求每个任务都使用四角色。小任务允许走「单 Agent + 合并门」的轻量路径；只有存在明确上下游交接、需要多个角色或需要 staged 发布的任务，才进入 DAG 与契约流程。

### 1.3 可验证结果

M2 完成后，以下结果必须可以被演示、被测试、被回归：

1. **DAG 可执行**：父任务可以拆成带角色与依赖的子任务；依赖未满足时下游不能启动 Run；依赖满足后自动解除阻塞；循环依赖被拒绝并返回完整环路径。
2. **契约可交接**：UI Design 产出并冻结 `design_spec`，Backend 产出并冻结 `api_contract`；Frontend 与 Backend 在契约冻结后并行实现；契约未冻结时下游 Run 按钮禁用并显示结构化原因。
3. **权限可执行（按 Runtime 能力分级）**：在声明 `enforced` 的 Runtime 上，Agent 只能写入 `allowedPaths` 内的路径、只能执行 `allowedCommands` 内的命令，越界写入与未授权命令在执行前被拒绝并产生证据事件；`partial` 或 `advisory` Runtime 必须在 Run 结束后按基线变更与命令日志检测越界，终止或阻断 Run 并转人工复核，且在 UI 明确标注隔离等级。提示词永远不构成安全边界。
4. **风险可审批**：合并、推送、staging 部署、删除与权限升级必须创建人类审批记录；审批绑定目标 commit、环境或参数，目标变化后审批失效；Agent 不能批准任何请求，包括自己发起的请求。
5. **完成可证据化**：任务进入 `done` 前必须满足契约要求的证据、验收检查、评审与审批；Run 状态 `completed` 不等于任务完成。
6. **DevOps 有边界**：DevOps Agent 可以生成 build、`deploy_plan`、执行 staging 部署与冒烟测试，但不能持有生产凭据、不能自动执行生产部署；生产部署只生成计划与回滚方案，由人工执行并回填结果。
7. **协作可观察**：收件箱聚合待审批、待评审、阻塞、失败与依赖就绪事项；任务时间线记录契约、门禁、证据与决定；导出包含完整决策链。
8. **Crew 可编排**：在 M2.1 稳定后，队长 Agent 可以把父任务拆成子任务 DAG、选择角色、分派成员并汇总证据，但不能绕过审批门，也不能代替成员提交证据。
9. **审批不可被浏览器来源绕过**：本地 API 要求随机会话令牌，CORS、Host 与 WebSocket Origin 按动态白名单校验；用户浏览器中的其他网页与跨源请求不能创建、批准、消费或撤销 Approval。审批门是业务门禁，不是唯一安全边界，二者必须同时成立；同机同用户进程的隔离不在 M2 承诺内，属于 M3 及以后。

### 1.4 成功口径

M2 的成功不是「功能列表全部存在」，而是「一条真实的功能交付可以在不使用隐藏命令、不手工修改数据库的情况下完成，并且所有高风险动作都有记录」。因此，M2 的验收以第 16 章的退出标准为准，而不是以页面数量或代码行数为准。

## 2. 范围与非目标

M2 的范围必须同时覆盖协作能力与安全边界；本章用范围内、范围外与裁剪顺序三部分明确边界。

### 2.1 范围内

M2 按 `prd/01-scope-and-roadmap.md` 的约定拆成两个子阶段。M2.1 是协作基础，M2.2 是 Crew 与队长模式。M2.2 不得在 M2.1 的并行调度与权限测试通过前启动。

| 能力 | 子阶段 | 核心内容 | 详情文档 |
|---|---|---|---|
| 任务依赖 DAG | M2.1 | `finish_to_start` 依赖、`requiredArtifactKinds` 检查、环检测、就绪判定、阻塞与自动解锁、DAG 局部视图 | `prd/modules/task-management.md`、`prd/modules/collaboration-and-review.md` |
| 交付物契约 | M2.1 | `design_spec`、`api_contract`、`build`、`test_report`、`deploy_plan` 五类契约；版本、冻结、变更、过期；任务级 `required_contracts` | `prd/modules/collaboration-and-review.md` |
| 角色模板 | M2.1 | General、UI Design、Frontend、Backend、DevOps 共五个内置模板（其中四个为角色模板）；role 枚举含 `general`、`custom`、默认权限、必交证据、模板复制与归档 | `prd/modules/agent-system.md` |
| 路径与命令权限 | M2.1 | `allowedPaths`、`allowedCommands`、环境变量白名单、拒绝事件、符号链接逃逸防护；按 Runtime 能力声明 `enforced`、`partial`、`advisory` | `prd/modules/security-and-permissions.md` |
| 审批门 | M2.1 | `merge`、`push`、`staging`、`prod`（仅计划与人工回执）、`destructive_operation`、`high_risk_command`、`scope_change`、`contract_break`、`design_review`、`api_contract_review`；`crew_plan` 随 M2.2；证据快照与指纹绑定 | `prd/modules/collaboration-and-review.md`、`prd/modules/security-and-permissions.md` |
| 证据化 DoD | M2.1 | diff、command_log、build、test_report、screenshot、contract_snapshot、review_note；缺失证据阻止完成 | `prd/modules/collaboration-and-review.md`、`prd/modules/runtime-and-workspace.md` |
| 并行调度 | M2.1 | DAG 就绪、全局 worker、单 Agent 并发、队列原因、同任务单活跃 Run、合并队列单飞 | `prd/modules/runtime-and-workspace.md`、`prd/modules/agent-system.md` |
| 收件箱与任务时间线 | M2.1 | 十类事项：approval_request、approval_expired、blocker、escalation、mention、contract_change、dependency_ready、run_failed、evidence_unverified、crew_plan_ready（最后一项随 M2.2）；已读与处理；结构化评论 | `prd/modules/ui-ux.md`、`prd/modules/collaboration-and-review.md` |
| 技能 | M2.1 | 本地 `SKILL.md` 导入、版本化、Agent 绑定、命令子集校验、提示词预算、Run 记录技能版本 | `prd/modules/agent-system.md` |
| 任务模板 | M2.1 | UI Design、Frontend、Backend、DevOps Staging、Bugfix、Feature 六类模板；预填 DAG、角色、契约、证据要求 | `prd/modules/task-management.md` |
| Crew 与队长 | M2.2 | 父任务拆解、角色分派、计划审批、成员执行、汇总、预算、死锁检测、Crew 视图 | `prd/modules/collaboration-and-review.md` |
| 本地 API 信任边界 | M2.1 | 随机会话令牌、一次性 bootstrap、WS ticket、CORS/Host/Origin 白名单、无令牌请求拒绝；M1 的 Origin/Host 校验作为回归项 | `prd/modules/security-and-permissions.md` |
| 界面与交互 | M2.1、M2.2 | Task 详情标签页（Overview、Runs、DAG、Contracts、Gates、Evidence、Timeline；Run 详情内嵌 Timeline、Logs、Diff、Artifacts、Review、Approval）、Inbox、角色模板创建、权限编辑器、Runtime 模型下拉与本地模型配置、Crew 只读视图 | `prd/modules/ui-ux.md` |
| 数据与 API | M2.1、M2.2 | 依赖、契约、审批、证据、Crew、收件箱、技能、模板的存储与接口；只追加迁移；规范路径 `/api/v1` | `prd/modules/api-and-data.md`、`prd/modules/collaboration-and-review.md` |
| 安全与审计 | M2.1 | 权限执行、审批记录、拒绝事件、本地审计、日志脱敏、提示注入防护、本地 API 认证 | `prd/modules/security-and-permissions.md` |
| Codex Runtime（可选） | M2.1 可选 | 适配器契约稳定后可进入，不作为 M2.1 退出条件；是否进入由 OQ-M2-14 决定 | `prd/modules/runtime-and-workspace.md` |

### 2.2 不在 M2 的范围

以下能力明确不属于 M2；即使实现成本看起来很低，也不得顺手加入，否则视为范围蔓延并走变更流程：

- **多用户登录与团队权限**：M2 是单用户本地模式，不做用户账号、登录会话、组织、角色矩阵、成员邀请。M2.1 的本地 API 会话令牌只用于本机浏览器与 API 认证，不是用户登录体系。团队权限属于 M3。
- **远程 Runner 与机器注册**：M2 只使用本机 Runner；不做远程执行、心跳、租约、机器池、共享机器隔离。远程 Runner 属于 M3。
- **GitHub PR 集成**：M2 不做 PR 创建、状态回写、评论同步；推送与合并仍然在本地或人工执行。GitHub PR 属于 M3。
- **自动合并、自动推送、自动生产部署**：这些动作永远需要人工批准或人工执行，M2 不提供 Agent 自主入口。
- **多个 Agent 在同一会话中自由聊天**：不提供共享聊天室、Agent 私聊、Agent 互相 @ 并要求回答的通道。
- **完整的 OpenAPI 级契约工具链**：M2 使用结构化 JSON 校验 `api_contract`，不要求完整 OpenAPI 编辑器、代码生成和 Mock Server。
- **自动冲突解决**：合并冲突必须阻止合并并生成集成任务，由人工决定处理方式。
- **跨仓库依赖与跨仓库 Crew**：M2 的 DAG、契约与 Crew 限定在同一仓库或同一 Workspace root 内；跨仓库依赖留待 M3 评估。
- **Docker 沙箱与网络出口隔离**：M2 不承诺容器级或操作系统级沙箱，Agent 仍以当前 OS 用户身份运行并可能访问网络；风险在安全章节说明。M2 的权限执行按 Runtime 能力分级，不能把 advisory 能力宣传为强制隔离。
- **技能市场与远程技能下载**：M2 只支持本地目录导入 `SKILL.md`，不做在线市场、评分、付费、审核与自动更新。
- **任务模板市场与 Agent 包分发**：模板导入导出、签名与市场属于 M4。
- **定时任务与 Webhook 自动化**：M2 不提供 cron、Webhook 触发、事件驱动自动建任务；属于 M4。
- **桌面通知、IM 机器人与移动端审批**：M2 只做应用内收件箱与页面提示；桌面通知和 Webhook 属于 M4。
- **完整审计平台**：M2 记录审批、权限拒绝与关键状态变更；完整审计事件模型、哈希链、团队审计属于 M3。
- **高级任务管理**：不做通用项目管理套件克隆、故事点、冲刺、甘特图、工时、完整项目组合管理。
- **模型托管与计费**：ATeam 不转售模型、不代收模型费用、不托管模型；用户自带 Runtime 与 Key。
- **生产环境执行**：M2 不保存生产凭据，不提供生产部署执行入口；生产部署由人在 ATeam 之外完成并回填结果。

### 2.3 范围分层与裁剪顺序

M2 范围较大，必须有明确的裁剪顺序。以下分层用于进度压力下的决策，不得用于降低安全底线：

| 层级 | 内容 | 裁剪规则 |
|---|---|---|
| P0 不可裁剪 | 任务 DAG 与环检测、就绪判定、交付物契约、五个内置模板（General + 四类角色）、路径与命令权限、合并与 staging 审批、证据化 DoD、并行调度、收件箱基础、本地 API 认证、M1 回归 | 任何一项缺失，M2 不得退出 |
| P1 应当交付（M2.1 内） | 技能、任务模板、审批过期与升级、任务时间线评论、保存视图、命令面板、审计导出 | 技能与任务模板必须在 M2.1 内完成（M2.1 退出标准第 10 项）；审批过期提醒、任务时间线评论、保存视图、命令面板、审计导出可在 M2.1 后移，不阻塞 M2.1 退出，但必须在 M2 结束前完成或在第 19 章登记裁剪决定 |
| P1 可后移（M2.2/M2.x） | Crew 与队长 | 可在 M2.2 或 M2.x 交付，不阻塞 M2.1 核心退出，但 M3 前必须完成 |
| P2 可延后 | 审批依赖边、`artifact_ready` 独立边类型、direct 模式扩展、worktree 自动清理扩展、Agent 包导出、Crew 预算自动调优、Codex Runtime | 不阻塞 M2 核心退出，记录到后续里程碑；Codex 是否进入 M2.1 由 OQ-M2-14 决定 |

裁剪顺序建议为：先保 P0 的 DAG、契约、权限、审批与证据；再保并行调度与收件箱；然后保角色模板、技能与任务模板；最后保 Crew。**不能为了 Crew 牺牲权限和审批，也不能为了界面完整度牺牲证据链。**

### 2.4 范围守卫规则

- 任何新增功能必须回答：它服务于「角色之间可验证的交接」还是「减少人类评审负担」？若两者都不是，默认不做。
- 任何「 Agent 自主执行高风险动作」的提议都必须被拒绝，除非人类显式批准并且系统记录完整证据。
- 任何跨任务、跨仓库、跨机器的协作扩展都必须先更新领域模型与权限模型，不得在 UI 层偷偷实现。
- 任何契约格式扩展都必须保持向后兼容；破坏性变更走 `contract_break` 审批门。
- 任何里程碑文档不得把 M2 能力描述为 M0/M1 已实现；发布说明必须以仓库代码与验收报告为准。

## 3. 关键决策

以下决策是 M2 设计与验收的前提；若与后续模块文档冲突，以本章决策和 `prd/01-scope-and-roadmap.md` 为准并回写修正。

### 3.1 决策清单

| 编号 | 决策 | 理由 | 影响 |
|---|---|---|---|
| M2-DEC-01 | 先流水线，后 Crew | 并行任务与 DAG 是共享基础设施；Crew 只是编排层。先做 Crew 会把调度、权限、协作复杂度绑在一起 | M2 拆成 M2.1 与 M2.2；M2.2 不得早于 M2.1 的并行调度和权限测试 |
| M2-DEC-02 | 契约先行 | 下游只消费冻结过的契约，避免「边做边猜」；契约是评审与并行开发的接口 | 增加契约对象、版本、冻结门与过期提示；没有契约的交接视为无效交接 |
| M2-DEC-03 | DevOps 只做 staging 与部署计划 | 生产部署风险最高，Agent 不应持有生产凭据；人类必须保留最终执行权 | DevOps 模板只配置 staging 凭据；prod 只生成计划、检查单与回滚方案；`prod` 门是「计划确认 + 人工回执」，不阻断也不替代 ATeam 之外的人工执行 |
| M2-DEC-04 | 角色是模板，不是硬编码 | 真实项目职责会交叉，固定角色无法覆盖所有团队；模板复制后允许用户调整 | 五个内置模板（General + 四类角色）+ `custom` 角色；模板升级不回溯修改已实例化 Agent |
| M2-DEC-05 | 权限在 Go core 执行，不在提示词 | 提示词不是安全边界；路径与命令必须由调度器、Workspace 与 Runtime adapter 强制校验；外部 CLI 内部行为不能被 Go core 直接拦截，因此必须按 Runtime 能力分级 | 越界写入与未授权命令产生 `permission_denied` 事件；`enforced` Runtime 在执行前拒绝并使 Run 失败，`partial`/`advisory` Runtime 必须检测越界、终止或阻断 Run 并转人工复核 |
| M2-DEC-06 | 证据化 DoD，Run completed 不等于 Task done | Agent 的自我声明不可信；完成必须由 diff、测试、构建、截图、契约与审批共同证明 | Task 进入 `done` 需要证据齐全、门禁通过、人工确认 |
| M2-DEC-07 | 不做多 Agent 自由聊天 | 自由聊天上下文不可控、权限不可控、成本不可控、评审不可控；协作必须可审计、可复现 | 不提供共享聊天室与 Agent 私聊；信息通过契约、结构化评论、任务状态传递 |
| M2-DEC-08 | 单用户本地审批仍需显式记录 | 「自己审自己」不等于免审批；本地用户是唯一审批人，但每个决定必须留下操作者、时间、理由与证据快照 | 审批记录不可删除；Agent 永远不能作为审批人 |
| M2-DEC-09 | 审批门之外必须有本地 API 信任边界 | 若本机任意网页或进程都能调用审批接口，审批门可被直接绕过；M0 无认证、CORS 反射任意 Origin、WS `CheckOrigin` 恒为 true | M2.1 交付会话令牌、bootstrap、WS ticket，并回归 Origin/Host/CORS 校验；审批接口与消费端点必须带有效令牌 |

### 3.2 决策一：先流水线，后 Crew

M2.1 先交付「并行任务」：多个独立 Task 各自绑定角色 Agent，通过 DAG 表达先后关系，互不共享工作区与上下文。只有 M2.1 的 DAG、契约、权限、审批、证据与收件箱通过验收后，M2.2 才引入 Crew。Crew 的价值是把同一父任务下的多个角色子任务组织成一个可审批的计划，但它不改变 Run 的执行模型：每个成员仍然是一次普通 Run，拥有独立 worktree、独立事件流、独立证据和独立审批记录。

先流水线的另一个原因是可解释性。并行任务的失败可以定位到某个 Task、某个 Run、某个契约或某个门禁；Crew 引入后，失败可能来自队长拆解、成员执行、汇总或死锁检测。先稳定前者，才能把后者的变量隔离出来。

### 3.3 决策二：契约先行

契约先行包含三层含义：

1. **下游启动前必须有冻结契约**：Frontend 不能只凭 UI Design 的自然语言描述开始实现；它必须消费冻结的 `design_spec`。Backend 变更 API 时必须更新 `api_contract` 并触发下游重新评审。
2. **契约有明确的生产者、消费者、版本与状态**：契约状态为 `draft`、`proposed`、`frozen`、`superseded`、`withdrawn`；只有 `frozen` 能满足下游依赖。冻结必须经过对应审批门：`design_spec` 走 `design_review`，`api_contract` 走 `api_contract_review`。
3. **契约变更必须显式**：已冻结契约不允许原地编辑；修改必须创建新版本。破坏性变更（删除字段、改变类型、改变错误码语义、改变鉴权要求）必须走 `contract_break` 门，并附影响分析与迁移方案。

契约不是文档附件，而是任务 DAG 的就绪条件、评审依据和下游输入。M2 的契约实现以 `prd/modules/collaboration-and-review.md` 第 5 节与 `prd/02-domain-model.md` 第 3.16 节为准；资源与表名以 `prd/modules/api-and-data.md` 为权威：当前版本存于 `deliverables`，历史版本存于 `contract_versions`，任务引用存于 `contract_requirements`，API 规范路径为 `/api/v1/deliverables`（`/api/v1/contracts` 为兼容别名）。领域模型中的 TaskContractVersion 是冻结版本的概念名，对应 `contract_versions` 的一行；该映射在 §19 记录并回写领域模型。

### 3.4 决策三：DevOps 只做 staging 与部署计划

DevOps Agent 在 M2 的权限必须写死：

- 可以维护 CI 配置、Dockerfile、部署清单、构建脚本与基础设施目录。
- 可以执行 build、test、staging 部署与冒烟检查，但 staging 部署前必须有人类对 `deploy_plan` 的 `staging` 审批。
- 可以生成生产部署计划、检查单、时间窗、执行人与回滚方案，但不能执行生产部署。
- 不持有生产凭据；生产部署由人在 ATeam 之外执行，ATeam 只记录 `prod` 门（计划确认与人工回执）以及人工回填的结果。
- 不能合并代码、不能推送主分支、不能修改生产命令白名单、不能批准任何请求。

这条边界的实现不依赖 Agent 自觉，而依赖审批实体、凭据隔离与命令策略：`prod` 在系统中没有 Agent 可调用的执行入口；生产凭据不进入 Workspace 环境变量；生产命令不在 DevOps 的 `allowedCommands` 中。`prod` 门的语义是「批准这份计划并由人回执执行结果」，不是「系统执行生产动作」；审批通过后系统不会产生任何生产副作用。

### 3.5 决策四：角色是模板，不是硬编码

四类角色不是写死的代码分支，而是可复制的内置模板；模板提供职责、默认权限、必交契约与 DoD，实例化后与模板解耦。General 是第五个内置模板与默认角色，`custom` 用于用户自定义职责；任何角色都不自动获得门禁豁免。模板升级只影响未来实例，不回溯修改已有 Agent。

### 3.6 决策五：权限在 Go core 执行

M2 的权限模型遵循「默认拒绝、最小权限、服务端策略优先」：

- `allowedPaths` 使用仓库相对 POSIX 路径与前缀/通配模式；空列表表示不可写任何路径，而不是「整个工作区」。该语义已与 `AGENT-023` 现行版本和 `UI-067` 对齐，不再保留旧版「空表示整个工作区」的解释。
- `allowedCommands` 使用可执行名与前缀白名单；默认不经过 shell；未列出的命令被拒绝，需要临时执行时走 `high_risk_command` 审批；扩大白名单本身走 `scope_change` 审批并审计。
- 每个 Run 的 worktree 是唯一可写根；系统对路径做 `realpath` 规范化，拒绝绝对路径、`..` 穿越、符号链接逃逸与大小写绕过。
- Runtime adapter 必须声明自己支持哪些隔离能力；不支持的 Runtime 必须在 UI 显示隔离等级警告，并要求人工确认，不能静默降级。
- 拒绝事件进入 RunEvent 与本地审计，包含 `code`、`message`、`remediation` 与策略来源，便于用户修复而不是猜测。

**外部 CLI 的现实边界。** M2 的 Claude Code adapter 仍是 `claude -p` 子进程，Go core 不能直接拦截子进程内部的工具调用或文件写入。因此「Go core 强制执行」必须落到可验证的机制矩阵上，而不是一句架构口号：

| 机制 | 覆盖 | 生效时机 | 能力级别 | 限制 |
|---|---|---|---|---|
| Runtime 原生工具级策略（权限参数、工具白名单、settings/hooks） | 写入与命令 | 执行前 | `enforced`（仅当 adapter 能证明并测试） | 依赖 CLI 版本与参数稳定性；版本不兼容时必须拒绝启动而不是降级 |
| ATeam 命令代理（Run 内所有经 ATeam 发起的命令按 argv 白名单校验，无 shell） | 命令 | 执行前 | `enforced`（仅限经代理的命令） | 不能约束被允许命令派生的子进程 |
| Runtime 权限模式（只读、受控编辑、完全授权） | 写入与命令 | 执行前 | `partial` | 粒度取决于 Runtime；完全授权必须显式开启 |
| Run 前后基线变更与工作区逃逸检测 | 写入 | 执行后 | `partial`/`advisory` | 只能发现已发生的越界，不能阻止；发现后必须终止或阻断 Run 并转人工复核 |
| 操作系统级沙箱（seatbelt、namespaces、job object） | 文件系统与网络 | 执行前 | `enforced` | 属于 M3，不在 M2 承诺 |

`enforced`、`partial`、`advisory` 的定义：`enforced` 表示在副作用发生前阻断并产生事件；`partial` 表示部分路径可阻断、其余只能在事后检测并阻断后续流程；`advisory` 表示没有工具级拦截，只能事后检测、标注隔离等级并要求人工确认。M2 的退出标准只对 `enforced` Runtime 要求「执行前拒绝」；对 `partial` 与 `advisory` Runtime 要求「检测越界 → 终止或阻断 Run → 人工复核 → 不得进入 `done`」，并把该限制写入 UI 与验收记录。

### 3.7 决策六至九：证据化 DoD、不自由聊天、单用户审批与本地 API 边界

M2 的完成定义由证据组成：

- Run `completed` 只表示 Runtime 正常退出；Task `done` 需要契约要求的所有证据、验收检查、评审与审批。
- 证据类型至少包括 diff、command_log、build、test_report、screenshot、contract_snapshot、review_note、human_signoff；系统采集优先于 Agent 自述。
- Agent 可以在时间线报告状态，但必须包含 `summary`、`evidenceRefs`、`nextStep`、`needsHuman`、`blockerCode`；只有自然语言「我完成了」不构成完成。
- Agent 之间不直接对话。需要协作时，通过父任务时间线的结构化评论、契约变更、依赖变更或队长创建的新子任务表达。
- 单用户模式仍然逐次记录审批：操作者、时间、理由、证据快照与指纹不可省略；Agent 永远不是审批人（DEC-08）。
- 审批接口必须位于本地 API 信任边界之后：无令牌请求、未知 Origin/Host 与无 ticket 的 WebSocket 均不得触达审批（DEC-09）。

## 4. 当前实现基线与差距

本章以仓库代码为准，区分 M0 已实现、M1 前置与 M2 计划，避免把计划能力写成现状。

### 4.1 M0 已实现（以仓库代码为准）

| 能力 | 当前实现 | 与 M2 的关系 |
|---|---|---|
| 领域模型 | `internal/domain/domain.go` 定义 Task、Agent、Run、RunEvent；Task 状态 7 个、Run 状态 6 个；AssigneeType 含 human、agent、crew | M2 复用 Task 状态与 Run 状态，新增依赖、契约、审批、Crew 等实体 |
| SQLite | `internal/store/migrations/0001_init.sql` 建 tasks、agents、runs、run_events 四张表；migration 嵌入式执行 | M2 只追加迁移，不破坏既有表 |
| REST API | Task CRUD、Agent CRUD、按 Task 创建 Run、Run 列表/详情、RunEvent 列表、取消、健康检查 | M2 在其上增加依赖、契约、审批、收件箱、技能、模板接口 |
| WebSocket | `/api/ws` 广播 task、agent、run 事件与 run.event | M2 增加 dependency、deliverable、approval、inbox、skill 事件 |
| 调度器 | `internal/scheduler/scheduler.go` 内存队列、可配置 worker（默认 2）、按 Agent.TimeoutMinutes 设置超时、按 Run ID 的取消表 | M2 需要重写为统一的 readiness 检查、依赖感知、按 Agent 并发与队列原因；M1 先修复取消竞态与超时分类 |
| Workspace | `internal/workspace/workspace.go` 为每个 Run 创建 `Root/runs/{runID}` 普通目录，忽略 `WorkspaceMode` | M2 依赖 M1 的 git worktree；M2 在其上增加路径权限校验 |
| Runtime | Registry 注册 mock 与 claude；mock 产生确定性事件；claude 调用本地 `claude -p` 并逐行转发 stdout/stderr | M2 需要真实 adapter 能力声明、命令/路径策略挂接、Codex 可选 |
| Task 视图 | `apps/web/src/views/TaskView.vue` 可选择 Agent 启动 Run、轮询日志、取消、修改状态 | M2 增加 Runs、DAG、Contracts、Gates、Evidence、Timeline 标签页与 readiness 原因 |
| Agent 视图 | `apps/web/src/views/AgentsView.vue` 创建与列出 Agent；表单包含名称、描述、指令、Runtime、模型、并发、超时、允许路径 | M2 增加角色模板、技能、允许命令、权限风险分级与影响预览；M2.1 模型子项把模型改为 Runtime 目录下拉并增加本地模型配置 |
| 桌面壳 | Wails v3 启动随机端口服务并加载 Web UI；未打包 | M2 不涉及打包；打包属于 M4 |
| 本地 API 安全 | 无认证；CORS 反射任意 `Origin`；WebSocket `CheckOrigin` 恒为 `true`；`--addr` 无回环守卫 | M1 交付 Origin/CORS/Host 校验（SEC-004）；M2.1 交付会话令牌、bootstrap 与 WS ticket（SEC-003），审批接口纳入认证范围 |

### 4.2 M1 应提供的地基与当前差距

M2 依赖 M1 的以下能力。除「取消与超时」「全局并发」为部分实现外，其余尚未实现，因此 M2 不能开始，也不能演示：

| M1 能力 | 为什么 M2 需要 | M2 的使用方式 |
|---|---|---|
| git worktree 与分支隔离 | 每个 Run 必须有独立可写根；DAG 并行需要互不污染的工作区 | 路径权限以 worktree 为根；并行 Run 不共享未提交修改 |
| 真实 Claude Code 流式适配 | 角色 Agent 需要结构化事件、工具调用、测试与构建输出 | 证据采集、命令日志、失败分类依赖 adapter；权限执行依赖 adapter 的权限参数与工具策略能力 |
| Artifact/Evidence 存储 | 契约与 DoD 需要证据索引、校验和与不可变性 | 契约冻结绑定证据快照；Task 完成检查证据清单 |
| Diff 评审与人工合并 | merge 门需要在批准前展示真实 diff、测试与构建 | 审批人逐项确认后执行合并；目标 commit 变化使审批失效 |
| 取消与超时的可靠性 | DAG 阻塞、Crew 预算与升级需要可靠终止 | M0 已有 `/api/runs/{id}/cancel`、cancel map 与 `TimeoutMinutes` 超时；M1 补齐 queued/preparing/running 取消竞态、排队残留、进程组终止与超时分类（RUN-002 至 RUN-006） |
| 状态机加固 | M2 的门禁与依赖依赖稳定的状态语义 | 终态不可回退；非法迁移返回冲突状态 |
| Origin/CORS/Host 与 WS Origin 校验 | M2 的审批接口必须不可被本机恶意网页直接调用 | M1 交付 SEC-004 与 NFR-SEC-002/004；M2.1 在其上增加会话令牌与 WS ticket |
| 删除确认与活跃 Run 阻止 | M2 的 `destructive_operation` 门以 M1 的删除保护为前置 | M1 交付 SEC-023；M2.1 增加审批门与恢复窗口（SEC-028） |
| 全局并发上限 | M2 的按 Agent 并发以全局 worker 为外层约束 | M1 交付 RUN-025 的全局并发与排队记录；M2.1 增加 Agent 级并发与排队原因 |

### 4.3 M2 需要新建的能力

| 能力 | M0 现状 | M2 目标 | 主要差距 |
|---|---|---|---|
| 任务依赖 DAG | `Task.ParentID` 只是字段，无依赖语义 | `task_dependencies` 表、环检测、就绪判定、自动解锁、DAG 视图 | 新表、调度器改造、UI 图视图 |
| 交付物契约 | 无 | 五类契约、版本、冻结、变更、过期、任务引用 | 新实体、状态机、校验器、审批对接 |
| 角色模板 | 无 | 五个内置模板（General + 四类角色）、role 字段（含 `custom`）、默认权限与 DoD | Agent schema 扩展、模板库、实例化流程 |
| 路径与命令权限 | 字段可保存但不执行 | 按 Runtime 能力分级执行、拒绝事件、符号链接防护、越界检测转人工复核 | Workspace/Runtime 钩子、策略引擎、能力声明 |
| 审批门 | 只在提示词中要求 | Approval 实体、证据快照、指纹绑定、过期升级 | 新表、API、UI、审计 |
| 证据化 DoD | 无证据模型 | 证据类型、清单、校验、不可变、完成检查 | M1 证据基础 + M2 契约校验 |
| 并行调度 | 仅全局 worker | DAG 就绪、单 Agent 并发、队列原因、合并队列 | 调度器重写、持久化队列 |
| 收件箱 | 无 | 十类事项（M2.1 交付其中九类，crew_plan_ready 随 M2.2）、未读计数、处理动作、升级 | 新表、API、页面 |
| 技能 | 无 | 本地 `SKILL.md`、版本、绑定、预算 | 新实体、导入器、提示词组装 |
| 任务模板 | 无 | 六类模板、预填 DAG/契约/证据 | 模板库、创建流程 |
| 本地 API 认证 | 无认证、CORS/WS 放行任意来源 | 会话令牌、bootstrap、WS ticket、审批接口鉴权 | 认证中间件、前端令牌注入、测试矩阵 |
| Crew | AssigneeType 有 `crew` 常量，无实体 | 计划、子任务、成员、汇总、预算、死锁 | 新实体、队长 Run、Crew 视图 |

### 4.4 事实声明

本章所有「已实现」描述均来自仓库代码；所有「M2 目标」「计划」描述均为产品需求，不代表当前可用。发布 M2 前必须逐项核对代码、测试与演示记录；若发现文档超前于实现，以代码为准并回写文档。

## 5. 角色与场景

M2 的协作以角色为配置、以场景为验证；本章定义人类角色、四类 Agent 角色与典型协作场景。

### 5.1 人类角色

M2 是单用户本地模式，不引入账号、登录与团队权限。下表中的四种人类角色是同一个本地用户在不同阶段的**概念性职责（hats）**，不是独立账号、独立身份或独立权限主体；系统不会因为「换帽子」而产生第二个审批人。M3 才引入登录、角色矩阵与真正的职责分离。因此，M2 的审批记录只记录「本地用户」，并在 UI 中提示「你正在批准自己的操作」。

| 角色 | 在 M2 中的职责 | 权限边界 |
|---|---|---|
| 独立开发者 | 创建任务与角色 Agent，启动 Run，处理收件箱，审批合并与 staging，最终确认任务完成 | M2 的唯一人类审批人；必须逐项查看证据后才能批准 |
| 技术负责人 | 定义角色模板、路径与命令策略、契约标准、DoD 基线；评审跨角色交付 | 可以修改 Agent 权限，但必须二次确认并记录审计；不能绕过系统级安全约束 |
| 评审者 | 查看 diff、测试、构建、截图与契约，提出 blocking/non-blocking 意见，批准或拒绝 | Agent 永远不能批准任何请求；人类在单用户模式下批准自己发起的请求时必须看到自批提示并逐项确认；高风险动作不可批量批准 |
| 运维执行人 | 在 ATeam 之外执行生产部署，回填执行结果与证据 | M2 不向 Agent 提供生产执行入口；执行结果作为 Artifact/Evidence 记录；该职责不能委托给 Agent |

### 5.2 四类角色 Agent

| 角色 | role 值 | 核心职责 | 主要输入 | 主要输出 | 禁止事项 |
|---|---|---|---|---|---|
| UI Design | `ui_design` | 把产品意图转成可实现的设计规格 | Task 描述、现有设计系统、平台约束 | `design_spec`、状态矩阵、token 表、截图 | 修改业务源码、安装依赖、执行构建或部署 |
| Frontend | `frontend` | 按设计规格与 API 契约实现界面 | 冻结的 `design_spec`、冻结的 `api_contract`、现有组件 | 前端 diff、build、test_report、关键状态截图 | 修改后端、推送、合并、部署 |
| Backend | `backend` | 按 API 契约实现接口、数据层与迁移 | 冻结的 `api_contract`、数据模型、错误码规范 | 后端 diff、migration、test_report、API 文档 | 修改前端、连接生产库、部署 |
| DevOps | `devops` | 维护构建部署脚本，生成并执行 staging 计划 | build、test_report、环境配置、变更清单 | build 证据、`deploy_plan`、staging 日志、冒烟结果、回滚方案 | 执行 prod、合并、推送主分支、持有生产凭据 |

M2 的 role 枚举以 `prd/02-domain-model.md` 第 3.4 节为准：`general`（默认值，未分类 Agent 与旧 Agent 迁移均使用）、`ui_design`、`frontend`、`backend`、`devops`、`custom`。内置模板共五个：General 加上述四类角色模板；General 是默认模板，四个角色模板是本里程碑 P0 验收对象。`custom` 角色允许用户自定义职责与权限，但不自动获得任何门禁豁免；涉及合并、推送、部署时仍走通用审批门。角色模板的具体字段、默认路径与默认命令见 `prd/modules/collaboration-and-review.md` 第 4 节与 `prd/modules/agent-system.md` 第 7.3 节。旧数据迁移默认 `general`，与领域模型和 agent-system 一致。

### 5.3 典型场景

**场景 A：设计先行的新功能。** 父任务「新增用户资料页」拆为 UI Design、Frontend、Backend、DevOps 四个子任务。UI Design 先产出 `design_spec`，经 `design_review` 冻结；Backend 产出 `api_contract`，经 `api_contract_review` 冻结；Frontend 与 Backend 在契约满足后并行实现；DevOps 在前后端完成并产生 build/test 证据后生成 staging 计划；人工审批后执行 staging，生产只生成计划。

**场景 B：API 契约先行的前后端并行。** Backend 先提交 `api_contract`，人工批准并冻结；Frontend 依据契约并行开发并使用 mock 数据；Backend 按契约实现。两边完成后分别提交证据，合并顺序由 DAG 与契约冻结顺序建议，人工确认。

**场景 C：跨栈缺陷修复。** 一个登录重定向缺陷同时涉及前端路由与后端回调。任务拆为 Backend 子任务与 Frontend 子任务，二者共享同一 `api_contract` 版本；合并时若触及共享类型文件，触发 pre-merge 冲突检测并生成集成任务。

**场景 D：发布准备。** DevOps 生成 build 与 `deploy_plan`；staging 门批准后执行 staging 部署与冒烟；prod 只输出计划、执行人、时间窗与回滚方案，由人工执行并回填结果。

**场景 E：小任务轻量路径。** 单文件修复或文档更新不创建 DAG，不要求契约；直接使用单 Agent + merge 门。M2 不强制所有任务走四角色流水线。

### 5.4 同一任务内协作与跨任务协作

| 维度 | 同一任务内协作（Crew） | 跨任务协作（DAG） |
|---|---|---|
| 共享对象 | 父任务、Crew 计划、任务级门禁 | 各自独立 Task，通过显式依赖边连接 |
| 契约 | 子任务契约在同一 Crew 计划内引用 | 必须显式引用契约 ID 与版本，不自动继承 |
| 工作区 | 每个成员 Run 仍有独立 worktree | 每个 Run 独立 worktree，不允许跨任务写入 |
| 对话 | 共享父任务时间线 | 不共享评论与 Run 日志 |
| 证据 | 汇总到父任务 | 只引用，不复制 |
| 审批 | 继承任务级门禁 | 各自独立门禁 |

三条硬性规则：`parentId` 只表示层级归属，不产生依赖，依赖必须显式创建；Agent 不得读取其他 Task 的评论、Run 事件或工作区；M2 的跨任务依赖限定在同一仓库/同一 Workspace root 内，跨仓库依赖返回 `unsupported_scope`。

## 6. 用户故事与验收标准

以下用户故事使用 Given/When/Then 描述，全部属于 M2 计划，不是当前已实现能力。每条故事末尾给出关联需求编号，详细定义见对应模块文档。

### US-M2-01 用角色模板搭建四角色流水线

作为独立开发者，我希望从内置模板快速创建四类角色 Agent，以便把一个大任务拆成有明确职责的子任务。

- Given 仓库已配置，M1 的 worktree、证据与合并能力可用；存在父任务「新增用户资料页」。
- When 我从模板创建 UI Design、Frontend、Backend、DevOps 四个 Agent，并创建四个子任务与依赖。
- Then 每个 Agent 具备 `role`、默认 `allowedPaths`、默认 `allowedCommands`、必交契约与 DoD；DAG 视图显示四个节点与依赖边。
- And 模板字段缺失或变量未解析时，系统不创建 Agent，并指出缺失项。
- 关联：COLLAB-001、COLLAB-002、COLLAB-003、AGENT-044、UI-065。

### US-M2-02 设计规格冻结前下游不可启动

作为前端开发者，我希望在 `design_spec` 冻结前无法启动 Frontend Run，避免按猜测实现。

- Given T1 UI Design 已产出 `design_spec` v1（`draft`），T3 Frontend 的 `required_contracts` 引用该契约。
- When 我在 T3 上点击 Run。
- Then 系统拒绝入队，返回 `contract_not_frozen`，列出契约 ID、当前状态与需要执行的门禁。
- And `design_review` 批准后契约变为 `frozen`，T3 的 Run 按钮可用；若 `api_contract` 仍未冻结，T3 仍不可启动并显示第二个原因。
- 关联：COLLAB-012、COLLAB-016、COLLAB-022、UI-031、UI-043。

### US-M2-03 API 契约冻结后前后端并行

作为小团队成员，我希望前后端在 API 契约冻结后并行开发，减少互相等待。

- Given T2 Backend 已产出 `api_contract` v1 并通过 `api_contract_review` 冻结。
- When 我启动 T3 Frontend 与 T4 Backend。
- Then 两个 Run 在容量允许时同时处于 `running`，各自拥有独立 worktree 与事件流。
- And T3 使用契约中的 mock 数据；T4 按契约实现；两边均提交 diff、test_report 与 build 证据。
- 关联：COLLAB-016、COLLAB-023、COLLAB-033、COLLAB-074、RUN-025。

### US-M2-04 依赖未满足时明确阻止

作为开发者，我希望系统在依赖没完成时阻止启动，而不是运行到一半才失败。

- Given T5 DevOps staging 依赖 T3 与 T4 完成，且 T4 仍在 `running`。
- When 我尝试启动 T5。
- Then 系统拒绝入队，返回 `dependency_unfinished` 的具体任务与角色。
- And T5 状态为 `blocked`，`blockedReason` 指向 T4；T4 进入 `done` 后 T5 自动解除阻塞并收到通知。
- 关联：TASK-097、TASK-098、TASK-099、COLLAB-020、COLLAB-022。

### US-M2-05 路径越界写入被拒绝或阻断

作为代码所有者，我希望 Agent 只能修改授权目录，越界写入必须被系统阻止或至少被发现并阻断后续流程。

- Given Frontend Agent 的 `allowedPaths` 为 `apps/web/` 与 `packages/ui/`，且其 Runtime 声明路径策略能力。
- When Agent 尝试写入 `internal/api/handlers.go`。
- Then 对声明 `enforced` 的 Runtime，写入在发生前被拒绝，Run 终止并产生 `permission_denied` 事件；对 `partial` 或 `advisory` 的 Runtime，Run 结束后基线变更检测发现越界文件，Run 被标记失败或进入人工复核，T3 不能直接置为 `done`。
- And 拒绝或检测事件包含路径、策略、隔离等级与修复建议。
- 关联：COLLAB-072、AGENT-021、SEC-010、SEC-017、SEC-018。

### US-M2-06 未授权命令触发审批或被阻断

作为代码所有者，我希望 Agent 不能静默安装依赖或执行高风险命令。

- Given Frontend Agent 的 `allowedCommands` 不包含 `pnpm add`。
- When Agent 尝试执行 `pnpm add some-package`。
- Then 对声明命令策略能力的 Runtime，命令在经 ATeam 代理执行前被拦截，系统创建 `high_risk_command` 审批请求；未批准前命令不执行。
- And 对不支持命令拦截的 Runtime，命令日志被记录并标记为未授权，Run 进入人工复核且不能直接置为 `done`；批准后命令在受控环境执行并记录完整 argv、退出码与操作者，拒绝则 Agent 收到结构化原因。
- 关联：COLLAB-073、AGENT-022、SEC-011、SEC-015。

### US-M2-07 合并必须人工审批且绑定 commit

作为代码所有者，我希望任何合并都经过人工确认，并看到充分证据。

- Given T3 与 T4 均 `completed` 并提交 diff、test_report、build。
- When 我请求合并。
- Then 系统创建 `merge` 审批请求，展示目标分支、源分支、head SHA、diff 统计、证据清单与风险提示；审批人逐项查看后才能批准。
- And 批准后系统执行合并并记录；若分支在审批后出现新 commit，审批指纹不匹配，审批转为 `expired`，合并被拒绝并要求重新审批。
- 关联：COLLAB-043、COLLAB-046、SEC-020、SEC-026、RUN-048。

### US-M2-08 DevOps 只执行 staging，生产只生成计划

作为开发者，我希望 DevOps Agent 能准备发布并验证 staging，但绝不能碰生产。

- Given DevOps 已产出 build 与 `deploy_plan`，staging 审批已通过。
- When DevOps 执行 staging 部署与冒烟检查。
- Then 部署日志、健康检查结果与冒烟结果写入证据；生产计划单独列出执行人、时间窗、风险与回滚步骤。
- And Agent 尝试执行生产部署时被拒绝且无生产凭据；人工在 ATeam 之外执行后，结果回填为 Artifact/Evidence。
- 关联：COLLAB-044、COLLAB-045、SEC-022、AGENT-061。

### US-M2-09 证据不足不能标记完成

作为评审者，我希望没有测试与构建证据的任务不能被标记完成。

- Given T3 的 Run `completed`，但缺少关键状态截图与 test_report。
- When 我尝试把 T3 置为 `done`。
- Then 系统阻止操作并列出缺失证据、未通过的验收检查与未决审批；T3 保持 `in_review`。
- And 补齐证据并通过 merge 门后，人工最终确认才允许 `done`。
- 关联：COLLAB-051、COLLAB-054、COLLAB-056、COLLAB-077、RUN-066。

### US-M2-10 阻塞自动进入收件箱并升级

作为用户，我希望 Agent 卡住时能主动找我，而不是一直停在 `in_progress`。

- Given 成员 Run 报告 blocker，原因码为 `missing_input`。
- When 超过 15 分钟仍未解决。
- Then 收件箱生成高优先级条目，通知队长与人工；任务标记 `blocked` 并保留原因码与影响说明。
- And 超过 30 分钟升级为 L3；人工处理后可以恢复任务、改范围或取消。
- 关联：COLLAB-060、COLLAB-063、COLLAB-064、UI-073、UI-074。

### US-M2-11 Crew 计划需人工批准

作为用户，我希望在 Crew 开始执行前批准它的计划，避免范围失控。

- Given 我创建 Crew 并指派队长 Agent。
- When 队长产出子任务、角色分配、依赖、契约清单、验收标准与预算。
- Then 系统创建 `crew_plan` 审批；批准前不启动任何成员 Run。
- And 队长不能批准自己的计划；连续拒绝 3 次后升级人工，禁止自动再次请求。
- 关联：COLLAB-030、COLLAB-031、COLLAB-032、COLLAB-035、COLLAB-047。

### US-M2-12 并行冲突生成集成任务

作为开发者，我希望并行修改发生冲突时，系统明确阻断并给出处理入口。

- Given T3 与 T4 的分支都修改了共享类型文件，且我请求合并其中一个分支。
- When 系统在创建 `merge` 审批前执行 pre-merge 的 dry-run 冲突检测。
- Then 若检测到冲突，合并不执行、审批保持 `pending` 或不被创建，系统创建集成任务，附冲突文件清单、双方分支与冲突片段证据；若无冲突，才创建或继续 `merge` 审批，批准并消费后执行合并。
- And 集成任务完成后重新进入合并队列，重新执行 dry-run，旧审批不得复用。
- 关联：COLLAB-024、COLLAB-025。

### US-M2-13 技能按版本锁定并复用

作为用户，我希望把团队的操作步骤沉淀为技能，并确保 Run 使用的是已锁定版本。

- Given 存在 `frontend-form-patterns` v1.0.0 技能，Frontend Agent 已绑定该技能。
- When 启动 Run。
- Then 系统解析并锁定技能版本，提示词按绑定顺序拼接；Run 证据记录技能名、版本与哈希。
- And 技能版本缺失、Runtime 不兼容或命令不在 `allowedCommands` 子集时，启动被阻止并列出原因。
- 关联：AGENT-032、AGENT-033、AGENT-038、AGENT-039。

### US-M2-14 任务模板预填角色与交付物

作为用户，我希望用模板快速创建带 DAG、角色与证据要求的任务，而不是每次手工配置。

- Given 我选择「Frontend Feature」任务模板。
- When 我填写标题并创建任务。
- Then 描述骨架、验收标准、建议角色、标签、交付物契约与证据要求被预填；模板可以实例化一个预置 DAG。
- And 模板不自动启动 Run，任务默认进入 `backlog`；由 Agent 生成的任务草稿也必须人工确认后才写入。
- 关联：TASK-083、TASK-084、TASK-085、TASK-086、TASK-089。

### US-M2-15 审计与导出

作为代码所有者，我希望导出一次流水线的完整决策链，便于复盘与合规检查。

- Given 一次包含契约冻结、两次审批、一次合并、一次 staging 部署的流水线。
- When 我导出该 Task 的审计包。
- Then 导出包含操作者、时间、对象、决定、理由、证据快照引用与目标 commit/环境。
- And 普通 Agent 不能修改或删除审计记录；导出行为本身也被记录。
- 关联：COLLAB-049、COLLAB-079、SEC-050、SEC-051、NFR-OBS-010。

### US-M2-16 恶意网页不能驱动本地审批

作为用户，我希望浏览器里打开的任何其他网页都不能读取或操纵 ATeam 的审批，即使它能访问 `127.0.0.1`。

- Given ATeam 以桌面壳或 `ateam serve` 启动，本地 API 已启用会话令牌。
- When 另一个来源的网页尝试跨源调用 `POST /api/v1/approvals`、`POST /api/v1/approvals/{id}/decision` 或 `POST /api/v1/approvals/{id}/consume`，或尝试连接 `/api/v1/ws` 订阅事件。
- Then 请求因 Origin/Host/令牌校验失败被拒绝（403/401），不产生 Approval，不执行任何动作；WebSocket 升级被拒绝。
- And 未带令牌的本机 `curl` 调用同样返回 401；只有持有有效会话令牌与 WS ticket 的同源客户端可以操作审批。
- 关联：SEC-003、SEC-004、NFR-SEC-002、NFR-SEC-003、NFR-SEC-014。

## 7. 里程碑级功能需求与追踪

以下表格按能力域汇总 M2 需求与验收要点，模块级细节指向对应文档，避免重复展开。

### 7.1 编号与状态约定

本章不新造模块级需求编号，而是引用既有模块文档中的需求编号；里程碑验收检查点使用 `AC-M2-xx` 编号。需求状态分为：

- **M0 已实现**：仓库代码已有该行为，以代码为准。
- **M1 前置**：M2 依赖该能力，但由 M1 交付；M2 不重复实现，只做回归。
- **M1 基础 → M2 强制/扩展**：M1 已有基础实现，M2 增加强制语义或扩展。
- **M2 计划**：M2 必须交付或显式裁剪。
- **M3/M4 计划**：不属于 M2。

每张需求表新增「里程碑/状态」列，明确该行由谁首次交付、M2 是新增、回归还是扩展。若一行混合多种状态，必须在列内逐项写明，不得用一个「M2」覆盖。若模块文档与本里程碑文档在 M2 范围上冲突，以本章的里程碑范围为准，并在第 19 章记录需要回写的模块文档。模块细节以对应模块文档为准，本章只给出 M2 验收要点。

**M1 前置清单（M2.1 不重复实现，只做回归或扩展）：**

| M2.1 依赖项 | M1 交付项 | M2.1 的动作 |
|---|---|---|
| worktree 与分支隔离 | WS-003 至 WS-005、SEC-016 | 回归；以其为路径权限根 |
| 真实 Claude Code adapter | RUN-013、SEC-014 | 回归；增加能力声明与工具级策略映射 |
| Artifact/Evidence 基础 | COLLAB-050、052、053、RUN-063、064 | 回归；增加契约逐项证据与完成检查 |
| 人工合并确认 | SEC-020、SEC-026、NFR-SEC-007 | 回归；M2 增加 Approval 实体与消费语义，不降低 M1 要求 |
| 取消与超时可靠性 | RUN-002 至 RUN-006 | 回归；M2 依赖其保证取消后不再产生事件 |
| Origin/CORS/Host 与 WS Origin 校验 | SEC-004、NFR-SEC-002、NFR-SEC-004 | 回归；M2.1 增加会话令牌与 WS ticket |
| 删除确认与活跃 Run 阻止 | SEC-023 | 回归；M2.1 增加 `destructive_operation` 门与恢复窗口 |
| 全局并发与排队记录 | RUN-025（M0 部分实现） | 回归；M2.1 增加 Agent 级并发与排队原因 |
| Task/Agent 归档与状态机 | TASK-012、TASK-015、TASK-032 | 回归；M2.1 增加依赖阻塞与门禁状态联动 |

本文件确实定义了少量**里程碑级**追踪项（例如就绪检查六项、收件箱类型集合），这些不是模块级需求编号，已在第 19 章登记为「待模块化」或映射到现有模块 ID；不再使用 `TASK-M2-DAG-01`、`TASK-M2-CONTRACT-01` 这类模块文档中不存在的编号。

**优先级差异。** 本文件对少数模块需求采用不同的里程碑优先级，完整差异、理由与回写目标见第 19 章 19.2。未列入差异表的需求优先级与模块文档一致。

### 7.2 任务 DAG 与并行调度

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-020、COLLAB-021、COLLAB-026、COLLAB-029 | 创建 `finish_to_start` 依赖；环检测；`parentId` 不产生依赖；DAG 可视化 | P0 | M2.1 新增 | 可创建依赖并在任务详情显示；A→B→C→A 被拒绝并返回完整路径；创建子任务不自动产生依赖；DAG 节点状态与任务状态一致 | `prd/modules/collaboration-and-review.md` 第 6 节 |
| COLLAB-022、TASK-095、TASK-096、TASK-097、TASK-098、TASK-099 | 统一就绪判定、依赖阻塞与自动解锁 | P0 | M2.1 新增 | 就绪检查有单元测试；未就绪 Run 不入队；依赖未满足时任务 `blocked` 并显示前置任务；依赖完成后自动解除并广播事件 | `prd/modules/task-management.md` 第 9 节 |
| COLLAB-023、COLLAB-027、COLLAB-028、AGENT-017、AGENT-018、AGENT-050、RUN-025 | 并行调度、容量、队列原因、依赖删除保护、跨仓库限制 | P0（AGENT-050 为 P2） | RUN-025 为 M1 基础（全局并发）；其余 M2.1 新增/扩展 | 无依赖任务可在容量内并行；单 Agent 活跃 Run 不超过 `maxConcurrency`；超限 Run 保持 `queued` 并显示原因；跨仓库依赖返回 `unsupported_scope` | `prd/modules/runtime-and-workspace.md` 第 11 节 |
| COLLAB-024、COLLAB-025 | 合并队列拓扑序、pre-merge 冲突检测、集成任务 | P0 | M2.1 新增 | 合并按 DAG 拓扑序建议；同仓库合并单飞；冲突时阻止合并并生成集成任务，附冲突文件与双方分支 | `prd/modules/collaboration-and-review.md` 第 6.4 节 |
| DM-DEP-005、COLLAB-020 | 依赖可声明 `requiredArtifactKinds`，上游必须存在对应 Artifact/Evidence | P1 | M2.1 新增；`artifact_ready` 边为 P2 | 依赖声明 `design_spec` 时，上游没有对应 Artifact 则下游不可启动并返回 `artifact_missing`；`artifact_ready` 独立边类型不在 M2.1 实现 | `prd/02-domain-model.md` 第 3.3 节 |

**边界说明。** `prd/modules/collaboration-and-review.md` 早期稿曾提出 `finish_to_start`、`artifact_ready`、`approval` 三类依赖边；现行版已与本章对齐，M2 只支持 `finish_to_start` 加 `requiredArtifactKinds`，`artifact_ready` 与 `approval` 作为 P2 预留。这样避免在 M2.1 同时引入三种边语义；若未来引入，必须先更新 task-management、02-domain-model、api-and-data 与验收文档，再实现。

### 7.3 交付物契约

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-010、COLLAB-011、COLLAB-013 | 五类契约对象、状态机、必填字段校验 | P0 | M2.1 新增 | `design_spec`、`api_contract`、`build`、`test_report`、`deploy_plan` 均可创建；非法状态迁移返回原因；缺状态矩阵或错误码时不能提交评审 | `prd/modules/collaboration-and-review.md` 第 5 节 |
| COLLAB-012、COLLAB-041、COLLAB-042 | `design_spec` 与 `api_contract` 冻结门 | P0 | M2.1 新增 | 未批准时 `freeze` 返回 `APPROVAL_REQUIRED`；批准后记录证据快照、审批人与时间；拒绝必须填写原因 | `prd/modules/collaboration-and-review.md` 第 8 节 |
| COLLAB-014、COLLAB-015、COLLAB-018、COLLAB-019 | 契约版本、破坏性变更、基线过期、历史不可删 | P0 | M2.1 新增 | 冻结后原地编辑被拒绝；破坏性变更触发 `contract_break`；消费者基线触及契约文件时显示 stale 提示；历史版本只读 | `prd/modules/collaboration-and-review.md` 第 5.4 节 |
| COLLAB-016、COLLAB-017、COLLAB-027 | `required_contracts`、草稿可见性、被引用契约删除保护 | P0 | M2.1 新增 | 任务未满足契约时不可运行；未授权 Agent 读取草稿返回 `forbidden`；有下游引用时删除契约被拒绝并列出引用方 | `prd/modules/collaboration-and-review.md` 第 5 节 |
| DM-TASK-008、COLLAB-010、COLLAB-013 | Task 契约包含 `requiredEvidence`、`interfaces`、`acceptanceChecks`、`handoffNotes` | P0 | M2.1 新增；字段定义以领域模型 3.16 为准 | 角色任务缺少契约不能进入可评审状态；验收检查有最近一次执行结果；交接说明可被下游读取 | `prd/02-domain-model.md` 第 3.16 节 |

### 7.4 角色模板与任务模板

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-001、COLLAB-002、COLLAB-003、COLLAB-005 | 五个内置模板（General + 四类角色）、复制语义、role 字段、归档 | P0 | M2.1 新增 | 首次启动可见五个模板，其中四个角色模板字段完整；实例化后修改模板不影响已有 Agent；非法 role 被拒绝；被引用模板不能删除 | `prd/modules/collaboration-and-review.md` 第 4 节 |
| COLLAB-004、COLLAB-006、AGENT-044、AGENT-045 | 角色子任务、custom 角色、模板变量 | P1 | M2.1 新增 | 可从父任务创建带 role 的子任务并默认绑定同角色 Agent；custom 角色不获得门禁豁免；未解析变量阻止实例化 | `prd/modules/agent-system.md` 第 7.3 节 |
| TASK-083、TASK-084、TASK-085、TASK-086、TASK-089 | 任务模板、预填 DAG/契约/证据、Agent 草稿 | P1（TASK-083/084 保持模块 P2，可选） | M2.1 必须交付 TASK-085/086/089（退出标准第 10 项依赖 TASK-089）；TASK-083/084 不阻塞退出 | 至少六类模板可创建；模板可实例化预置 DAG；Agent 生成的任务默认 `backlog` 且不自动启动 Run | `prd/modules/task-management.md` 第 8 节 |
| AGENT-028、UI-064 | 六段式指令模板与 Markdown 预览 | P2 | M2.1 可选 | 模板包含职责、边界、输入、输出、检查、汇报；预览与源文切换不丢内容 | `prd/modules/agent-system.md` 第 5 节 |
| AGENT-079～082、UI-161～164、API-1426～1429 | Runtime 模型目录与 Agent 模型下拉；本地模型配置 | P0 | M2.1 模型子项，可随 Agent 编辑器提前交付，不依赖 DAG/契约 | 模型下拉只列所选 Runtime 目录；空值表示默认；非目录 ID 返回 `MODEL_NOT_AVAILABLE`；切换 Runtime 重新校验；目录为空只显示默认项与配置入口 | `prd/modules/agent-system.md` §4.4/§10.2、`prd/modules/runtime-and-workspace.md` §6.4.1、`prd/modules/api-and-data.md` §5.17 |

### 7.5 路径与命令权限

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-072、COLLAB-074、AGENT-021、AGENT-023、SEC-010、SEC-016、SEC-017 | 路径白名单、worktree 唯一可写根、符号链接防护 | P0 | SEC-016 为 M1 前置；SEC-010/017、AGENT-021/023、COLLAB-072/074 为 M2.1 新增 | 对 `enforced` Runtime，越界写入在发生前被拒绝并产生 `permission_denied`；绝对路径、`..`、符号链接逃逸均被阻止；对 `partial`/`advisory` Runtime，越界变更被检出并阻断完成；两个 Run 的 worktree 不同且互不可见未提交修改 | `prd/modules/security-and-permissions.md` 第 6 节 |
| COLLAB-073、AGENT-022、SEC-011、SEC-012 | 命令白名单、argv 匹配、无 shell、环境变量白名单 | P0 | M2.1 新增 | 未列出的命令被拒绝或事后标记；shell 元字符不能绕过；敏感环境变量默认不继承；拒绝事件包含命令与策略 | `prd/modules/security-and-permissions.md` 第 6 节 |
| SEC-013、SEC-015、SEC-018、SEC-019 | 凭据隔离、权限扩大确认、拒绝事件、Runtime 隔离能力声明 | P0（SEC-015 为 P1） | M2.1 新增 | Secret 存 OS 钥匙串或等价安全存储；扩大权限需二次确认并审计；不支持路径/命令隔离的 Runtime 显示 `enforced`/`partial`/`advisory` 等级并要求人工确认 | `prd/modules/security-and-permissions.md` 第 6 节 |
| NFR-SEC-008 | 权限由 Runtime adapter 与 Go core 强制执行，不依赖提示词 | P0 | M2.1 新增；按 Runtime 能力分级验收 | 通过注入提示「跳过权限」不能改变策略；`enforced` Runtime 越权操作仍被拒绝并记录；`partial`/`advisory` Runtime 越界被检出并阻断完成 | `prd/modules/non-functional-requirements.md` 第 6.11 节 |

**语义修正。** `AGENT-023` 早期版本写「空 `allowedPaths` 表示整个工作区，空 `allowedCommands` 表示继承 Runtime 默认策略」；`UI-067` 写「空列表显示不可写任何路径」。M2 采用默认拒绝：空 `allowedPaths` 表示不可写任何路径；空 `allowedCommands` 表示不额外授权任何命令。该冲突已按第 19 章回写 Agent 与 UI 模块文档。

### 7.6 审批门与高风险动作

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-040、COLLAB-043、COLLAB-046、COLLAB-047、SEC-020、SEC-026 | Approval 实体、merge 门、证据快照、禁止 Agent 审批、指纹绑定 | P0 | SEC-020/026 为 M1 前置（合并确认）；COLLAB-040/043/046/047 为 M2.1 新增 | 每次请求创建 Approval 记录，状态为 `pending/approved/rejected/expired/cancelled/consumed`；批准前必须查看证据；产出者 Agent 不能批准；目标 commit 变化使审批 `expired`；拒绝必须填写原因 | `prd/modules/collaboration-and-review.md` 第 8 节、`prd/02-domain-model.md` 第 3.11 节 |
| COLLAB-044、COLLAB-045、SEC-022、AGENT-061 | staging 审批、prod 仅计划与人工回执、生产凭据隔离 | P0 | M2.1 新增 | 未批准时 DevOps 无法执行 staging；Agent 无 prod 执行入口与凭据；`prod` 计划包含执行人、时间窗、commit、结果回执与回滚方案 | `prd/modules/security-and-permissions.md` 第 5 节 |
| SEC-021 | 推送审批门 | P0 | M2.1 新增 | 推送前必须有 Approval，绑定 remote、ref 与 commit；Agent 推送返回 403；force push 另需理由 | `prd/modules/security-and-permissions.md` 第 5 节 |
| SEC-023、SEC-028 | 删除确认、活跃 Run 阻止、软删除与恢复 | P0 | SEC-023 为 M1 前置；SEC-028 为 M2.1 新增 | 活跃 Run 下删除返回 409；有历史的对象删除走 `destructive_operation` 门并展示影响面；恢复窗口与恢复端点可用 | `prd/modules/security-and-permissions.md` 第 5 节 |
| COLLAB-048、COLLAB-049、SEC-025 | 门禁时间型过期、升级、撤销与决定链导出 | P1 | M2.1 新增（不阻塞 M2.1 退出，但 M2 结束前必须完成或登记裁剪） | 超时提醒与升级可配置；审批执行前可撤销；决定记录操作者、时间、理由与证据快照并可导出 | `prd/modules/collaboration-and-review.md` 第 8.2 节 |
| COLLAB-068、COLLAB-069 | 禁止批量高风险审批、通知限频 | P0（COLLAB-069 为 P2） | M2.1 新增 | merge、push、prod、contract_break、destructive_operation 不支持批量批准；紧急事件不受限频 | `prd/modules/collaboration-and-review.md` 第 8.2 节 |
| NFR-SEC-007、NFR-SEC-014 | 高风险动作人工审批、通用 Approval Gate | P0 | NFR-SEC-007 为 M1 前置（合并确认）；NFR-SEC-014 为 M2.1 新增 | 所有高风险动作有审批记录，包含对象、证据、影响与操作者；无记录的动作被拒绝；M2 不降低 M1 的合并确认要求 | `prd/modules/non-functional-requirements.md` 第 6.11 节 |

**M3 需求不在本节验收。** SEC-027（高危操作重新认证）属于 M3，M2 只要求显式确认与理由，不要求重新认证。SEC-024（职责分离）同样属于 M3。

### 7.7 证据化 DoD

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-050、COLLAB-052、COLLAB-053、RUN-063、RUN-064 | 证据类型与必填字段：diff、command_log、build、test_report、screenshot | P0 | COLLAB-050/052/053、RUN-063/064 为 M1 基础；M2.1 强制 | 证据记录类型、来源、校验和、生产者与时间；test_report 含命令、退出码、通过/失败/跳过数量；build 含产物位置与校验和 | `prd/modules/runtime-and-workspace.md` 第 10 节 |
| COLLAB-051、COLLAB-054、COLLAB-056、COLLAB-076、RUN-066 | 角色 DoD、缺失证据阻止完成、下游依赖 | P0 | M1 部分 → M2.1 完整 | 缺 test_report 或关键状态截图时 DoD 不通过；Task 不能置 `done`；依赖方缺少必交证据时下游不满足 | `prd/modules/collaboration-and-review.md` 第 9 节 |
| COLLAB-055、COLLAB-057、COLLAB-058、COLLAB-059 | 命令比对、证据不可变、保留策略、抽查 | P1 | M2.1 新增（不阻塞 M2.1 退出） | 证据中的命令与 RunEvent 不一致时标记 `unverified`；修正通过新证据 supersede；被门禁引用的证据延迟清理 | `prd/modules/collaboration-and-review.md` 第 9.3 节 |
| COLLAB-077、TASK-025 | 人工最终确认，Agent 不能把 Task 置 done | P0 | TASK-025 为 M1 基础；M2.1 绑定契约与 Approval | Agent 调用完成接口返回 `forbidden`；人工确认前最多 `in_review`；未满足契约或审批时返回缺失项 | `prd/modules/collaboration-and-review.md` 第 9.4 节 |

### 7.8 Crew 与队长

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-030、COLLAB-031、COLLAB-032、COLLAB-035 | Crew 创建、计划字段、`crew_plan` 门、队长限制 | P1 | M2.2（可后移；模块内为 P0，里程碑差异见 19.2） | 创建后为 `draft`；计划包含子任务、角色、依赖、契约清单、验收标准、预算；未批准不启动成员；队长不能批准门禁 | `prd/modules/collaboration-and-review.md` 第 7 节 |
| COLLAB-033、COLLAB-034、COLLAB-038 | 成员独立 Run、汇总、队长失败处理 | P1 | M2.2 | 每个成员 Run 有独立 worktree、事件流与证据；汇总包含子任务状态、证据索引与未决风险；队长失败后 Crew `blocked` 且已完成证据保留 | `prd/modules/collaboration-and-review.md` 第 7.4 至 7.6 节 |
| COLLAB-036、COLLAB-037、COLLAB-039 | 预算、死锁、与普通任务共存 | P1 | M2.2（COLLAB-039 为 P0 但随 M2.2 验证） | 超预算 Crew `paused` 并创建紧急收件箱条目；所有子任务阻塞且无活动 Run 时 `blocked`；不创建 Crew 也能使用 DAG/契约/门禁 | `prd/modules/collaboration-and-review.md` 第 7.6 节 |

### 7.9 收件箱、评论与升级

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| COLLAB-060、COLLAB-061、COLLAB-063、COLLAB-064、UI-073、UI-074 | 收件箱类型、去重、blocker 原因码、升级、未读计数 | P0 | M2.1 新增（crew_plan_ready 随 M2.2） | approval_request、approval_expired、blocker、escalation、mention、contract_change、dependency_ready、run_failed、evidence_unverified 九类在 M2.1 生成；crew_plan_ready 在 M2.2 生成；同类事件 10 分钟内去重；blocker 缺 `blockerCode` 不被受理；超时生成 L2/L3 条目 | `prd/modules/collaboration-and-review.md` 第 10 节 |
| COLLAB-062、COLLAB-066、COLLAB-067、UI-044、UI-045 | 任务时间线、结构化评论、禁止 Agent 私聊、decision 记录 | P0 | M2.1 新增 | 五种评论类型可筛选；Agent 状态消息包含 `summary`、`evidenceRefs`、`nextStep`、`needsHuman`、`blockerCode`；系统不提供 Agent 私聊 API | `prd/modules/collaboration-and-review.md` 第 10.2 节 |
| COLLAB-068、COLLAB-069、UI-075、UI-076、UI-078 | 禁止批量高风险审批、通知限频、键盘巡检、空状态 | P1（COLLAB-068 为 P0） | M2.1 新增（P1 不阻塞退出） | 批量操作只影响已读状态；高风险审批必须逐条；J/K/Enter/E/M/Esc 可用；已清空与暂无事项文案不同 | `prd/modules/ui-ux.md` 第 7.6 节 |

### 7.10 技能与任务模板

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| AGENT-032、AGENT-033、AGENT-034、AGENT-038 | `SKILL.md` 解析、绑定、本地导入、Run 版本解析 | P1（AGENT-038 为 P0 门槛） | M2.1 必须交付（退出标准第 10 项）；技能版本解析为 P0 门槛 | 缺失字段导入失败并给出字段级错误；绑定校验 Runtime 与命令子集；导入不执行脚本；Run 启动缺失技能时阻止并列出 | `prd/modules/agent-system.md` 第 6 节 |
| AGENT-035、AGENT-036、AGENT-037、AGENT-039 | 版本不可变、同名冲突、提示词预算、证据记录 | P1 | M2.1 新增（版本不可编辑与证据记录为退出必需；预算提示可后移） | 已发布版本不可就地修改；同名不同来源不能同时绑定；超预算警告/阻止；Run 证据记录技能名、版本与哈希 | `prd/modules/agent-system.md` 第 6.3 节 |
| AGENT-042、UI-066 | 版本差异与技能绑定界面 | P2 | M2.1 可选 | 可查看两版本差异；技能显示来源、版本、启用状态；移除后保存生效 | `prd/modules/ui-ux.md` 第 7.5 节 |

### 7.11 界面与交互

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| UI-019、UI-020、UI-021、UI-030、UI-031 | 看板筛选、保存视图、批量操作、任务元数据、依赖入口 | P1 | M2.1 新增（保存视图不阻塞退出） | 筛选条件写入 URL；保存视图可命名；批量操作逐项确认；任务可编辑标签、优先级、分配对象；有依赖时显示上游状态 | `prd/modules/ui-ux.md` 第 7.2 至 7.3 节 |
| UI-043、UI-044、UI-045、UI-088、UI-089、UI-131 | 审批缺口提示、任务时间线、评论、冲突提示、权限不足状态、Task 详情标签页 | P0 | M2.1 新增 | Merge 未满足审批时禁用并列出缺口；时间线按时间排序；评论不自动进入 Agent 上下文；冲突显示最新值；权限不足不泄露受限数据；Task 详情提供 Overview、Runs、DAG、Contracts、Gates、Evidence、Timeline 七个标签，Run 详情内嵌 Timeline、Logs、Diff、Artifacts、Review、Approval | `prd/modules/ui-ux.md` 第 7.3 至 7.7 节、第 5.3 至 5.4 节 |
| UI-010、UI-063、UI-064、UI-065、UI-066、UI-067、UI-068、UI-069、UI-072 | 命令面板、Agent 复制、指令预览、角色模板、技能、权限编辑器与统计 | P1 | M2.1 新增（命令面板、保存视图不阻塞退出） | Cmd/Ctrl+K 可打开；模板至少五个；允许路径白名单语义；允许命令风险分级；放宽权限二次确认 | `prd/modules/ui-ux.md` 第 7.5 节、第 5.10 节 |
| UI-092、UI-095、UI-097、UI-098、UI-099、UI-117 | 快捷键帮助、可禁用、多选、上下文菜单、URL 还原、200% 缩放 | P2 | M2.1 可选 | 快捷键按作用域分组；用户可禁用单键快捷键；多选与菜单可用；复制 URL 可还原视图；200% 缩放不溢出 | `prd/modules/ui-ux.md` 第 7.8 至 7.10 节 |

### 7.12 非功能与安全

| 编号 | 需求摘要 | 优先级 | 里程碑/状态 | M2 验收要点 | 详情 |
|---|---|---|---|---|---|
| NFR-PERF-008、NFR-PERF-014、NFR-PERF-016、NFR-REL-009、NFR-REL-011 | 调度开销、事件批量、前端筛选、数据库检查、单实例 | P1 | M2.1 新增/回归 | 每 Run 调度额外开销不超过 100ms；事件批量写入；1,000 Task 筛选 P95 不超过 200ms；启动 quick_check；同一数据目录只允许一个写入实例 | `prd/modules/non-functional-requirements.md` 第 6 节 |
| NFR-OBS-007、NFR-OBS-008、NFR-OBS-010、NFR-OBS-012 | 指标端点、诊断包、审计、事件导出 | P1 | M2.1 新增（审计导出不阻塞 M2.1 退出） | `/api/v1/diagnostics/metrics` 输出队列、活跃 Run、事件等指标；诊断包脱敏且不超过 50MB；高风险动作写入只追加审计；事件可导出 JSONL | `prd/modules/non-functional-requirements.md` 第 6.4 节 |
| NFR-A11Y-006、NFR-A11Y-008、NFR-A11Y-010、NFR-A11Y-012、NFR-I18N-001、NFR-I18N-006、NFR-I18N-007、NFR-I18N-008 | 对比度、读屏播报、缩放、读屏测试、国际化与格式 | P1 | M2.1 新增 | 正文对比度不低于 4.5:1；Run 状态变化礼貌播报；1024×640 与 200% 缩放可用；zh-CN 与 en-US 文案来自资源文件；时间与数字使用 Intl | `prd/modules/non-functional-requirements.md` 第 6.5 至 6.6 节 |
| NFR-SEC-003 | 本地 API 会话令牌、bootstrap 与 WS ticket | P0 | M2.1 新增（SEC-003 与 NFR-SEC-003 均已统一为 M2.1） | 无令牌请求返回 401；bootstrap 一次性且 5 分钟过期；WS ticket 单次使用；令牌不落日志；恶意网页不能创建或批准 Approval | `prd/modules/security-and-permissions.md` 第 3.1 至 3.2 节 |
| NFR-SEC-007 | 合并必须人工确认并绑定 head commit | P0 | M1 前置；M2.1 回归 | M2 的 merge 门增加 Approval 实体与消费语义，但不得降低 M1 的人工确认与绑定要求 | `prd/modules/non-functional-requirements.md` 第 6.11 节 |
| NFR-SEC-008、NFR-SEC-014 | 路径/命令强制执行、通用 Approval Gate | P0 | M2.1 新增；NFR-SEC-008 按 Runtime 能力分级 | 提示注入不能改变策略；`enforced` Runtime 在执行前阻断；`partial`/`advisory` Runtime 检测越界并阻断完成；审批覆盖推送、staging、删除、越权命令 | `prd/modules/non-functional-requirements.md` 第 6.11 节 |
| SEC-050、SEC-051 | 本地审计事件模型与闭环 | P0 | M2.1 新增 | 审批、权限拒绝、合并、staging、删除、权限变更写入只追加审计；高风险动作先写审计后执行；审计失败时动作阻断 | `prd/modules/security-and-permissions.md` 第 5 节 |

## 8. 交互与规则

本章给出 M2 的端到端流程、就绪、契约、审批、合并、Crew 与收件箱规则；这些规则同时约束 UI、API 与调度器。

### 8.1 流水线主流程

M2 的主流程如下：

```text
父任务（人工创建）
  ├── T1 UI Design 子任务
  │     └── Run → design_spec draft → design_review → frozen
  ├── T2 Backend 契约子任务
  │     └── Run → api_contract draft → api_contract_review → frozen
  ├── T3 Frontend 子任务（依赖 T1 的 design_spec + T2 的 api_contract）
  │     └── Run → diff / build / test_report / screenshots
  ├── T4 Backend 实现子任务（依赖 T2 的 api_contract）
  │     └── Run → diff / migration / test_report
  ├── T5 DevOps staging 子任务（依赖 T3、T4 done 与 build 证据）
  │     └── Run → deploy_plan → staging 审批 → staging 部署 → 冒烟证据
  └── T6 生产计划子任务（依赖 T5 staging 证据）
        └── Run → prod 部署计划与回滚方案（人工执行，系统记录结果）
```

读图规则：实线表示依赖，箭头从上游指向下游；契约冻结是下游就绪的必要条件；审批门是动作执行的必要条件；证据是任务完成的必要条件。任何一条不满足，流程停在当前节点并进入收件箱，而不是继续执行。第 14 章的演示脚本额外创建无依赖的 T7（General 文档任务），用于验证三路并行与 General 模板，不属于主流水线的必需节点。

### 8.2 就绪与启动规则

调度器在将 Run 入队前执行统一就绪检查。前六项与 `collaboration-and-review.md` 第 6.2 节一致，第七项是 Crew 场景的附加条件；缺一不可：

1. Task 状态为 `todo`、`in_progress` 或 `in_review`（与 M0 已实现的 TASK-022、`task-management.md` §5.1 一致）；`backlog`、`done`、`blocked`、`cancelled` 不可执行。M1 起若需要收紧为仅 `todo`/`in_progress`，必须同时修改 TASK-022、本表与 M1 文档，不能只改一处。
2. 所有 `finish_to_start` 依赖的上游 Task 状态为 `done`。
3. 依赖声明的 `requiredArtifactKinds` 在上游存在对应 Artifact/Evidence，且证据未被标记 invalid。
4. 任务 `required_contracts` 引用的契约状态为 `frozen`，且版本解析成功（默认精确版本；`allow_newer` 时按 `min_version` 解析并记录）。
5. 没有同一对象上 pending 状态的阻塞性审批（例如同一 Run 的 `merge` 审批未决时不允许重复启动同用途 Run）。
6. 绑定 Agent 的并发容量未超限，全局 worker 有空位。
7. Crew 子任务所属 Crew 处于 `executing` 且计划已批准（仅 Crew 场景）。

任一条件不满足时，Run 不得入队。API 返回结构化原因码，例如 `dependency_unfinished`、`contract_not_frozen`、`contract_version_unresolved`、`artifact_missing`、`approval_pending`、`agent_capacity_exceeded`、`crew_not_started`，并附具体对象 ID 与名称。UI 的 Run 按钮置灰并直接展示原因列表，而不是点击后才失败。

### 8.3 契约冻结与消费规则

- 契约状态为 `draft`、`proposed`、`frozen`、`superseded`、`withdrawn`；只有 `frozen` 能满足下游依赖。
- `design_spec` 冻结必须经过 `design_review`；`api_contract` 冻结必须经过 `api_contract_review`；`build`、`test_report`、`deploy_plan` 不需要独立评审门，但必须在字段完整且引用证据校验一致后通过 `validate` 自动冻结（COLLAB-083），并被 merge 与 staging 门引用。
- 冻结操作幂等：重复冻结返回同一结果，不重复创建审批记录。
- 已冻结契约的任何修改都必须创建新版本，不允许原地编辑；被替代版本保留只读副本。
- 破坏性变更（删除字段、改变类型、改变错误码语义、改变鉴权要求）需要 `contract_break` 门，并附影响分析与迁移方案。
- 消费者引用的契约版本固定，不自动跟随新版本；生产者发布新版本后，系统通知消费者并标记「有新版本可用」。
- 消费者的 worktree 基线 commit 与契约 `baseCommit` 之间的变更触及契约引用文件时，系统在整个任务上标记「契约可能过期」，但不自动阻断；启动 Run 前提示人工确认。

### 8.4 审批门规则

- 审批状态为 `pending`、`approved`、`rejected`、`expired`、`cancelled`、`consumed`。`pending` 时冻结证据快照；决定只能基于该快照，后续新增证据不改变已作出的决定。动作执行时审批从 `approved` 转为 `consumed`，重复消费返回 409。协作模块旧称 `revoked`、安全模块旧称 `requested` 的差异按第 19 章统一为 `cancelled` 与 `pending`，并回写模块文档。
- 产出该对象的 Agent 不能作为审批人；队长不能批准；本地人类审批人不受产出者限制，但必须逐项查看证据，并在批准自己发起的请求时看到自批提示。
- 拒绝必须填写原因；原因回到任务时间线并通知请求者。
- 同一门禁对象连续被拒绝 3 次后，系统创建 `escalation` 收件箱条目并强制人工复核并填写复核结论；M2 没有更高的第二审批人，不得假装升级到另一个角色。
- 内容变化即失效：分支新增提交、契约版本变化、`deploy_plan` 修改、命令参数变化都会使对应审批转为 `expired`；必须重新请求。这是 P0 行为。
- 时间型 TTL 与提醒为 P1：`merge` 24 小时、`staging` 4 小时、`prod` 30 分钟、其他动作（含 destructive_operation 与 push）72 小时，可配置但不得无限延长；`prod` 门按时过期，不设「不自动过期」例外。P1 未交付时，内容变化失效仍然必须生效，不得以「没有 TTL」为由复用旧审批。
- 门禁过期后对象回到待处理状态，任务标记 `blocked` 或 `in_review`，不得静默继续。
- 合并、推送、生产部署计划与 `contract_break`、`destructive_operation` 不允许批量审批；`design_review` 与 `api_contract_review` 在同一任务内可以一次打开多个契约，但每个契约仍需单独决定。
- 所有决定记录请求人、审批人、时间、理由与证据快照 ID；审批指纹包含动作类型、目标 ID、commit SHA、diff 哈希、环境或命令参数，目标变化即失效。
- `prod` 门只确认部署计划与人工回执，不产生系统执行动作；审批记录必须包含计划哈希、commit、执行人、时间窗和回填结果。

### 8.5 合并队列与冲突规则

- 合并队列按 DAG 拓扑序生成建议顺序；同一层级内按契约冻结时间排序；用户可以调整顺序，但必须记录原因。
- 合并队列对同一仓库单飞执行：前一个合并完成或失败后，才处理下一个，避免互相污染。
- 每次合并前执行 pre-merge 的 dry-run 冲突检测；检测到冲突时阻止合并，创建集成任务，附冲突文件清单、双方分支与冲突片段证据。
- 集成任务由人工指定角色 Agent 处理；处理完成后重新进入合并队列。
- 合并后必须重新运行受影响测试；测试失败时不得自动改写目标分支。系统生成 revert 提交计划与证据，并创建新的 `merge`（回滚）审批；由人工批准后执行 revert，或由人工在 ATeam 之外处理。回滚动作本身也必须留下审批记录与证据。
- 合并本身是审批动作；顺序建议不等于自动执行。`merge` 审批必须在 pre-merge dry-run 通过后创建或继续；冲突时保持 `pending` 并生成集成任务。

### 8.6 Crew 规则

- Crew 由父任务、队长 Agent 与成员 Agent 组成；队长只能编排、分派与汇总，不能批准门禁、不能修改已批准范围、不能代替成员提交证据。
- Crew 状态为 `draft`、`planning`、`plan_review`、`executing`、`aggregating`、`review`、`done`、`paused`、`blocked`、`cancelled`。
- 计划必须经过 `crew_plan` 审批；批准前不启动任何成员 Run。
- 每个成员 Run 仍然是普通 Run，拥有独立 worktree、事件流、证据与审批记录。
- 队长 Run 失败时 Crew 进入 `blocked`，已完成成员 Run 与证据保留，允许替换队长或转人工编排。
- Crew 可设置最大 Run 数、最大总时长与最大重试次数；超过预算时进入 `paused` 并创建高优先级收件箱条目。
- 所有剩余子任务均处于 `blocked` 或未就绪，且没有活动 Run 时，Crew 进入 `blocked` 并通知人工。

### 8.7 收件箱与状态规则

- 收件箱按优先级倒序展示；每条包含来源任务、类型、摘要、截止时间与操作按钮。
- 批准类条目的主操作是「打开并评审」，不是直接批准；合并与生产部署条目禁止快捷批准。
- 未读项有明确圆点与加粗标题；已读但未处理项仍保留在「待处理」筛选。
- 批量操作只允许「全部标记已读」，不允许批量批准或批量合并。
- 通知按事件去重、按任务聚合；同一任务 10 分钟内最多一条同类通知；紧急事件不受频率限制。
- Task 状态在 M2 的转换规则以 `prd/modules/collaboration-and-review.md` 第 13.4 节为准；Agent 不能直接把 Task 置为 `done`。

## 9. 数据与 API 影响

M2 的数据与接口只做加法演进；本章列出新增对象、接口分组、事件与迁移约束，完整 schema 见模块文档。UI 中的 Contracts 与 Gates 是界面标签，分别对应后端的 `deliverables` 与 `approvals` 资源，不是第二套 API 或表名。

### 9.1 新增领域对象与表（里程碑级）

| 对象/表 | 用途 | 关键字段 | 子阶段 |
|---|---|---|---|
| `task_dependencies` | 任务依赖边 | `task_id`、`depends_on_task_id`、`type`、`required_artifact_kinds`、`created_at`；复合主键 | M2.1 |
| `deliverables` | 契约当前版本（`/api/v1/contracts` 为兼容别名） | `id`、`workspace_id`、`task_id`、`kind`、`revision`、`version`、`status`、`produced_by_run_id`、`contract`、`validated_at`、`frozen_at` | M2.1 |
| `contract_versions` | 契约历史版本（TaskContractVersion 的存储实现） | `deliverable_id`、`version`、`payload`、`payload_hash`、`status`、`supersedes_id`、`created_at` | M2.1 |
| `contract_requirements` | 任务对契约的引用 | `task_id`、`deliverable_id`、`required_version`、`required_state`、`allow_newer`、`min_version` | M2.1 |
| `approvals` | 审批记录 | `id`、`workspace_id`、`task_id`、`run_id`、`action_type`、`target_type`、`target_id`、`status`、`evidence_snapshot_hash`、`params_hash`、`content_hash`、`action_fingerprint`、`requested_by`、`decided_by`、`reason`、`expires_at`、`consumed_at`、`consumed_by` | M2.1 |
| `evidence` 扩展 | 契约逐项证据 | `criterion_key`、`status`、`verified_by`、`verified_at`、`supersedes_id` | M2.1 |
| `skills`、`skill_versions`、`agent_skills` | 技能身份、版本与绑定 | `skills`：`id`、`name`、`slug`、`status`；`skill_versions`：`skill_id`、`version`、`content_hash`、`manifest`；`agent_skills`：`agent_id`、`skill_id`、`skill_version_id`、`binding_order`、`enabled` | M2.1 |
| `task_templates` | 任务模板与预置 DAG | `id`、`name`、`role`、`version`、`payload`（含 DAG 步骤、契约与证据默认值）、`created_by`、`created_at` | M2.1 |
| `inbox_items` | 收件箱 | `type`、`severity`、`subject_type`、`subject_id`、`status`、`due_at` | M2.1 |
| `task_comments` | 任务时间线 | `id`、`task_id`、`author`、`author_type`、`kind`、`body`、`refs`、`run_id`、`created_at` | M2.1 |
| `crews`、`crew_members` | Crew 与成员 | `task_id`、`lead_agent_id`、`status`、`budget`、`plan_contract_id`、`role` | M2.2 |
| 本地审计扩展 | 审批、拒绝、权限变更 | `actor`、`action`、`subject_type`、`subject_id`、`result`、`reason`、`created_at` | M2.1 |
| `agents` 扩展 | 角色与模板 | `role`（默认 `general`）、`role_template_id`、`role_template_version`、`template_snapshot`、`output_contract_types` | M2.1 |
| `runs` 扩展 | 基线与证据摘要 | `base_commit`、`evidence_summary`、`crew_id`、`crew_step_id` | M2.1、M2.2 |

### 9.2 API 面（摘要）

M2 的完整端点、字段、错误码与分页规则见 `prd/modules/api-and-data.md` 第 5 节与 `prd/modules/collaboration-and-review.md` 第 14.2 节。规范路径统一为 `/api/v1/*`；M0 的 `/api/*` 作为永久兼容别名保留并携带 `Deprecation` 头，新增能力只在 `/api/v1` 定义。里程碑级接口分组如下：

| 分组 | 主要端点 | 用途 | 子阶段 |
|---|---|---|---|
| 依赖与就绪 | `GET/POST /api/v1/tasks/{id}/dependencies`、`DELETE /api/v1/tasks/{id}/dependencies/{depId}`、`GET /api/v1/tasks/{id}/readiness` | 创建、删除、查询依赖与就绪原因 | M2.1 |
| 契约 | `GET/POST /api/v1/deliverables`、`GET/PATCH /api/v1/deliverables/{id}`、`POST /api/v1/deliverables/{id}/submit`、`POST /api/v1/deliverables/{id}/validate`、`POST /api/v1/deliverables/{id}/freeze`、`POST /api/v1/deliverables/{id}/revise`、`POST /api/v1/deliverables/{id}/withdraw`、`GET /api/v1/deliverables/{id}/versions` | 契约创建、提交、校验、冻结、修订、撤回与版本 | M2.1 |
| 审批 | `GET/POST /api/v1/approvals`、`GET /api/v1/approvals/{id}`、`POST /api/v1/approvals/{id}/decision`、`POST /api/v1/approvals/{id}/consume`、`POST /api/v1/approvals/{id}/revoke` | 审批请求、决定、消费、撤销与查询 | M2.1 |
| 收件箱与评论 | `GET /api/v1/inbox`、`PATCH /api/v1/inbox/{id}`、`POST /api/v1/inbox/{id}/action`、`GET/POST /api/v1/tasks/{id}/comments` | 收件箱处理与任务时间线 | M2.1 |
| 技能与模板 | `GET/POST /api/v1/skills`、`GET/POST /api/v1/agents/{id}/skills`、`DELETE /api/v1/agents/{id}/skills/{skillId}`、`GET/POST /api/v1/task-templates` | 技能导入、绑定、任务模板 | M2.1 |
| 证据 | `GET/POST /api/v1/runs/{id}/evidence`、`GET /api/v1/tasks/{id}/deliverables`、`POST /api/v1/evidence/{id}/verify` | 证据查询、新增、复核与任务交付物聚合 | M2.1 |
| 认证 | `POST /api/v1/auth/bootstrap`、`POST /api/v1/auth/ws-ticket` | 一次性 bootstrap 换取会话令牌；申请一次性 WS ticket | M2.1 |
| Crew | `GET/POST /api/v1/crews`、`GET /api/v1/crews/{id}`、`POST /api/v1/crews/{id}/submit-plan`、`POST /api/v1/crews/{id}/pause`、`POST /api/v1/crews/{id}/resume`、`POST /api/v1/crews/{id}/cancel` | Crew 创建、计划、暂停、恢复与取消 | M2.2 |
| 诊断 | `GET /api/v1/diagnostics/metrics`、`POST /api/v1/diagnostics/bundle` | 指标与脱敏诊断包 | M2.1 |

### 9.3 WebSocket 事件

在 M0 已有 `task.created`、`task.updated`、`task.deleted`、`agent.created`、`agent.updated`、`agent.deleted`、`run.queued`、`run.preparing`、`run.running`、`run.updated`、`run.event` 基础上，M2 增加：

- `task.dependency.added`、`task.dependency.removed`、`task.readiness_changed`、`task.unblocked`（`task.dependency.updated` 仅作为旧名别名）
- `deliverable.created`、`deliverable.submitted`、`deliverable.frozen`、`deliverable.revised`、`deliverable.withdrawn`、`deliverable.updated`（旧名 `contract.*` 仅作为别名并行发送，不新增仅旧名可用的能力）
- `approval.requested`、`approval.decided`、`approval.expired`、`approval.cancelled`、`approval.consumed`
- `inbox.item.created`、`inbox.item.updated`、`inbox.updated`
- `comment.created`、`comment.updated`、`evidence.added`、`evidence.verified`
- `skill.created`、`skill.updated`、`skill.deleted`
- `crew.updated`、`crew.plan_submitted`、`crew.member_updated`

事件只携带摘要与对象 ID，详情由客户端按需拉取；消费者必须忽略未知字段和未知事件；M2 起事件带 `schemaVersion`，字段变更遵循只加不删原则。

### 9.4 兼容与迁移约束

- M2 只做加法迁移：新增表、可空列与索引；不删除既有列，不改变既有字段语义。
- 旧 Agent 的 `role` 迁移默认为 `general`（与领域模型默认值一致）；`custom` 只用于用户显式创建的自定义角色，不作为迁移默认值。
- 旧 Task 的 `parentId` 语义保持为层级归属，不自动转换为依赖。
- 旧 Run 的 `branch`、`worktree` 为空时显示明确空状态，不伪造数据。
- 契约、审批、证据与审计记录不可物理删除；归档与 supersede 是唯一修正方式。
- 迁移在事务中执行，失败整体回滚；迁移前创建可恢复备份；`schema_migrations` 记录校验和。
- M3 迁移到 Postgres 时保持 ID 值与逻辑模型不变，按同一语义重建约束。

## 10. 异常与边界

| 场景 | 期望行为 | 关联需求 |
|---|---|---|
| 添加依赖形成环 | 拒绝保存，返回完整环路径，UI 高亮冲突边 | COLLAB-021、TASK-096 |
| `parentId` 自指或成环 | 拒绝保存，返回 400；不产生依赖语义 | TASK-011 |
| 依赖上游被取消 | 下游保持 `blocked`，提示解除依赖或改引用，不自动开始 | COLLAB-020、TASK-098 |
| `requiredArtifactKinds` 缺失 | 下游保持 `blocked`，返回 `artifact_missing` 与缺失类型，不自动开始 | DM-DEP-005、COLLAB-022 |
| 契约长期未冻结 | 下游保持不可运行，24 小时提醒，72 小时升级 | COLLAB-022、COLLAB-048 |
| 契约可能过期 | 启动 Run 前提示，需人工确认；不自动阻断 | COLLAB-018 |
| 审批连续拒绝 3 次 | 任务 `blocked`，创建 escalation，强制人工复核并填写结论 | COLLAB-047 |
| 审批超时 | 状态 `expired`，任务回到待处理，通知请求者；`prod` 同样按时过期 | COLLAB-048、SEC-025 |
| Run 在评审期间被取消 | 审批自动转为 `cancelled`，证据保留，任务回 `in_progress` | COLLAB-040、COLLAB-057 |
| Run 执行超时 | Run `failed`，`failureCode=timeout`，记录阈值与实际耗时，保留尽力而为的证据；不自动重试 | RUN-006 |
| queued Run 取消 | Run 进入 `cancelled`，从待执行集合移除，不再出现 `running` 事件 | RUN-002 |
| preparing Run 取消 | 中断 fetch、worktree 与分支创建，清理残留，保持 `cancelled` | RUN-003 |
| running Run 取消 | 先优雅终止，宽限期后终止整个进程组；Run `cancelled`，记录发起人与时间 | RUN-004 |
| Runtime CLI 未安装、未登录或版本不兼容 | Run `failed`，`runtime_error` 区分 `runtime_missing`、`runtime_auth`、`runtime_version_unsupported`；给出可操作修复建议 | RUN-007、SEC-077 |
| 离线或断线 | 本地 CRUD 与证据浏览可用，写操作被拒绝并显示离线横幅；WebSocket 按 `afterSeq` 重连补拉，不假装在线 | NFR-NET-006、RUN-116、TASK-057 |
| 磁盘满或 SQLite 锁冲突 | Run `failed` 并分类为 `workspace_error` 或 `internal_error`，保留已有证据；写请求可重试，不静默丢数据；磁盘低于阈值时告警并阻止创建新 Run | NFR-RES-007 |
| 队长 Run 失败 | Crew `blocked`，成员已完成 Run 与证据保留，可替换队长 | COLLAB-038 |
| 成员 Run 失败 | 按重试策略处理，达到上限升级队长或人工 | COLLAB-038 |
| 合并冲突 | pre-merge dry-run 阻止合并，审批保持 `pending`，创建集成任务并附冲突证据 | COLLAB-025 |
| 同一 Agent 并发超限 | Run 保持 `queued`，提示容量原因，不直接失败 | COLLAB-022、COLLAB-023 |
| 证据与命令不一致 | 标记 `unverified`，审批人可见并决定 | COLLAB-055 |
| 工作区丢失 | Run 失败，已有证据保留，重跑创建新 worktree | COLLAB-050、COLLAB-074 |
| 跨任务依赖目标被删除 | 下游任务 `blocked`，提示解除依赖或改引用 | COLLAB-027、COLLAB-071 |
| Crew 预算耗尽 | Crew `paused`，保留证据，创建紧急收件箱条目 | COLLAB-036 |
| Agent 试图读取其他任务 | 返回 `forbidden`，记录安全事件 | COLLAB-071、COLLAB-075 |
| Agent 试图执行 prod | 拒绝且无凭据可用，记录安全事件；不产生任何生产副作用 | COLLAB-045、AGENT-061 |
| 技能版本缺失 | 阻止启动 Run，列出缺失技能与版本 | AGENT-038 |
| 模板被 Agent 引用时删除 | 返回冲突错误，要求先归档或解除引用 | COLLAB-005 |
| 收件箱事件洪峰 | 同类事件去重聚合，紧急事件不受限频 | COLLAB-061、COLLAB-069 |
| 同一任务并发编辑 | 旧版本提交被拒绝并返回 409 `STALE_REVISION`，展示最新值；不得静默覆盖（TASK-122、领域模型 §7.4 与 api §13.4 已统一为 `revision` + 409） | TASK-122、UI-088 |
| 不支持隔离能力的 Runtime | 显示 `enforced`/`partial`/`advisory` 等级，高风险动作要求人工确认，不静默降级；越界只能事后检测时必须阻断完成 | SEC-019、AGENT-021、AGENT-022 |
| 本地 API 令牌缺失或过期 | 返回 401，提示重新打开 ATeam 或重新 bootstrap；不泄露资源是否存在 | SEC-003 |
| 跨源网页尝试创建、批准或消费审批 | 返回 403/401，不产生 Approval，不执行动作；WebSocket 升级被拒绝 | SEC-003、SEC-004 |

## 11. 权限与安全

M2 的安全目标是让权限、审批与证据成为可执行的产品机制，而不是提示词中的建议。

### 11.1 本地 API 信任边界

ATeam 的本地服务是本机应用的一部分，不是公开 Web 服务；但「监听 127.0.0.1」不等于安全的信任边界。M0 的实现是：无认证、CORS 反射任意 `Origin`、WebSocket `CheckOrigin` 恒为 `true`、`--addr` 无回环守卫。这意味着用户浏览器中打开的任意网页都能读取任务与 Agent、订阅全部事件、触发 Run、甚至调用审批接口。如果 M2 只增加 Approval 实体而不补本地 API 认证，审批门可以被浏览器网页或无令牌调用直接绕过；同机同用户进程之间的隔离不在 M2 承诺内。

M2 的信任边界规则：

- **M1 交付并回归（SEC-004、NFR-SEC-002/004）**：只监听回环地址；CORS 使用动态白名单（当前监听 origin、显式开发端口、桌面壳随机端口），未知 `Origin` 返回 403 且不写 `Access-Control-Allow-*` 头；`Origin: null` 拒绝；Host 只接受实际监听值；WebSocket 握手校验 Origin 与 Host。非回环绑定必须失败或显式开启并显示风险横幅（NFR-SEC-013）。若 M1 未交付这些能力，M2.1 必须补交，否则 M2.1 不得退出。
- **M2.1 交付（SEC-003、NFR-SEC-003）**：桌面壳每次启动生成 256 位随机会话令牌并通过 Wails 绑定或一次性 URL 片段注入；`ateam serve` 打印一次性 bootstrap URL（TTL 5 分钟、单次使用）；页面用 bootstrap 换取会话令牌，令牌只存内存或 `sessionStorage`；无头模式提供 `0600` 令牌文件与 Bearer 头。WebSocket 使用一次性 ticket（TTL ≤ 60 秒、单次使用、绑定 session/Origin/Host）；除 `/api/v1/health`、`/api/v1/auth/bootstrap` 外，所有 `/api/*` 要求令牌。
- **审批接口属于受保护资源**：`POST /api/v1/approvals`、`/decision`、`/consume`、`/revoke` 与审批查询全部要求有效令牌；未认证请求不得创建、批准、消费或撤销 Approval。CSRF 通过自定义头触发预检 + 严格 CORS 降低风险，不以 Cookie 作为唯一凭据。
- **不把本地 OS 用户当作隔离边界**：同机进程以同一用户身份运行，不是 M2 能解决的问题；M2 的目标是阻止浏览器跨源攻击与无令牌调用。更强的进程隔离与远程访问认证属于 M3 及以后。
- **验收**：恶意网页/跨源请求/无令牌 `curl` 不能创建或批准 Approval；WS 无 ticket 不能订阅；令牌不出现在日志、审计与错误消息中。

### 11.2 执行侧权限

M2 的权限执行以 Go core 为策略来源，但不是所有 Runtime 都能在子进程内部执行工具级拦截。调度器与 Workspace 在创建 Run 时快照 `allowedPaths`、`allowedCommands`、环境变量白名单与隔离等级；Runtime adapter 按第 3.6 节的机制矩阵声明自己能阻断什么、只能检测什么。任何一层拒绝或检测都必须产生结构化事件与本地审计，并在 UI 显示 `enforced`、`partial` 或 `advisory`。声称「已强制执行」的前提是该 Runtime 在能力矩阵中登记为 `enforced` 且有测试证明。

- 路径使用仓库相对 POSIX 前缀与通配模式；默认拒绝未列出的路径；空列表表示不可写任何路径。
- 命令使用可执行名与参数前缀匹配；默认不经过 shell；未列出的命令被拒绝或事后标记，临时执行走 `high_risk_command` 审批。
- 每个 Run 的 worktree 是唯一可写根；系统使用 `realpath` 规范化，拒绝绝对路径、`..` 穿越、符号链接逃逸与大小写绕过。
- Agent 只能继承白名单环境变量；敏感名称默认不继承；Secret 存 OS 钥匙串或等价安全存储，数据库只存引用。
- Agent 无法读取其他 Run 的工作区、其他 Task 的评论或未授权契约草稿。

### 11.3 审批与职责分离

- 合并（`merge`）、推送（`push`）、staging（`staging`）、生产部署计划（`prod`）、删除（`destructive_operation`）、权限扩大（`scope_change`）与一次性命令许可（`high_risk_command`）必须创建 Approval。
- 产出对象的 Agent 不能批准；队长不能批准；Agent 永远不是审批人。
- 审批必须绑定目标 commit、环境或命令参数；目标变化使审批失效。
- 内容变化使审批失效（P0）；时间型 TTL、提醒与升级为 P1。执行前可以撤销；高风险动作执行前必须重新校验审批指纹与消费状态。
- 本地单用户模式下，人类是唯一审批人，但仍需显式确认、逐项查看证据并留下记录；批准自己发起的请求时必须显示自批提示并要求显式勾选；不得提供「一键批准全部」。
- 生产部署在 M2 只生成计划与检查单；`prod` 门只做计划确认与人工回执，不阻断也不替代 ATeam 之外的人工执行；ATeam 不保存生产凭据，不提供自动执行入口。

### 11.4 密钥与数据边界

- 本地优先：代码、契约、证据默认不离开本机；Runtime 使用用户自带凭据。
- 密钥只存在于本地配置或系统密钥环，不写入 Artifact、评论、RunEvent 或日志。
- 日志与证据采集前执行敏感模式扫描与脱敏，至少覆盖常见 Token、密码、私钥格式与连接串。
- 诊断包默认不包含源码、diff、提示词与密钥；导出前展示内容清单。
- M2 不承诺网络出口隔离；用户必须理解 Agent 可能访问网络，相关风险在风险章节说明。

### 11.5 提示注入与对抗性输入

- 仓库内容、契约文本、任务描述、Issue 内容都视为不可信数据；系统提示明确标记其不可信，但真正的边界在 Go core 的策略执行。
- 契约只做结构化校验，不执行其中指令；Agent 收到的「跳过审批」「自动合并」「忽略权限」等文本不能改变门禁策略。
- 证据可信度分为系统采集、结构化上传、Agent 自述三档；合并与生产部署审批必须以系统采集证据为主，自述证据只能作为补充。
- 命令白名单拒绝 shell 元字符与包装脚本绕过；路径校验拒绝符号链接与大小写绕过。
- 任何越权尝试都记录为安全事件，包含对象、策略、命令或路径与修复建议。

### 11.6 审计

- M2 记录审批、权限拒绝、契约冻结、合并、staging 部署、删除与权限变更；记录只追加不修改。
- 每条记录包含操作者、时间、对象、动作、理由、结果与证据快照引用。
- 审计导出支持按任务、Agent、时间与操作者过滤；导出行为本身也被记录。
- 完整审计事件模型、哈希链与团队审计属于 M3；M2 的本地审计必须足以复盘一次完整流水线。

## 12. 指标

以下指标为 M2 内测阶段的初始目标，需在真实使用中校准，不作为对外承诺。指标采集优先本地计算，默认不外发。

| 指标 | 定义 | 采集方式 | M2 初始目标 |
|---|---|---|---|
| 角色流水线完成率 | 启动四角色流水线后完成 staging 的任务比例 | Task 状态与 Approval 记录 | 不低于 60% |
| 一次通过率 | 首次审批通过的比例 | Approval 记录 | 高于 70% |
| 契约冻结周期 | 契约创建到 `frozen` 的时长 | 契约状态时间 | 中位数低于 24 小时 |
| 审批响应时间 | `pending` 到 `decided` 的时长 | Approval 记录 | P90 低于 24 小时 |
| 跨角色返工率 | 因契约或证据不足导致下游重跑的 Run 比例 | Run 与 Approval 关联 | 低于 20% |
| 证据完整率 | 具备全部必交证据的 Task 比例 | 证据清单 | 高于 90% |
| 越界拦截或检出率 | 越界写入与未授权命令被拒绝（enforced）或检出（partial/advisory）的比例 | 权限拒绝/检测事件 | 100% 处理并记录 |
| 未审批高风险动作 | 未审批即执行的高风险动作数量 | Approval 审计对比 | 0 |
| 未授权审批请求拦截率 | 无令牌或跨源审批请求被拒绝的比例 | 认证与安全事件 | 100% 拒绝并记录 |
| 合并冲突率 | 触发 pre-merge 冲突的合并比例 | 合并队列 | 低于 10% |
| 并行利用率 | 活动 Run 数除以可用容量 | 调度器指标 | 1.5 至 3.0 之间 |
| 阻塞升级及时率 | 超时阻塞在阈值内生成 L2/L3 收件箱条目的比例 | 收件箱时间 | 高于 95% |
| 收件箱清零周期 | 收件箱从有事项到清空的时长 | 收件箱状态 | 中位数低于 1 个工作日 |
| Crew 计划偏差 | 实际子任务数与计划数差异 | Crew 记录 | 低于 20% |

## 13. 交付计划与交付物

M2 按依赖关系分阶段交付；本章列出阶段、进入与退出条件、交付物与阶段依赖。

### 13.1 阶段拆分

M2 按依赖关系拆成以下阶段。阶段编号用于计划与验收，不表示固定日历工期；每个阶段必须有进入条件、退出条件与可演示结果。

| 阶段 | 范围 | 进入条件 | 退出条件 | 可裁剪 |
|---|---|---|---|---|
| M2.0 准备 | M1 回归、数据模型评审、契约格式决策、权限语义修正、测试夹具 | M1 退出标准通过 | 数据模型与 API 骨架评审通过；测试仓库与 staging stub 就绪 | 否 |
| M2.1a DAG 与就绪 | `task_dependencies`、环检测、就绪判定、阻塞与自动解锁、DAG 视图 | M2.0 完成 | 依赖测试与调度器单测通过；未就绪 Run 无法入队 | 否 |
| M2.1b 契约与审批 | 契约对象、状态机、冻结门、Approval 实体、merge/staging 审批、证据快照、本地 API 会话令牌与 WS ticket | M2.1a 完成 | 契约校验与审批状态机测试通过；未审批合并被拒绝；无令牌请求返回 401，跨源请求不能创建或批准 Approval | 否 |
| M2.1c 角色模板与权限 | 五个内置模板、role 字段、`allowedPaths`/`allowedCommands` 执行、Runtime 能力声明与隔离等级、拒绝事件、密钥隔离 | M2.1b 完成 | `enforced` Runtime 的越界写入与未授权命令测试通过；`partial`/`advisory` 越界检测与人工复核测试通过；模板实例化测试通过 | 否 |
| M2.1d 调度与收件箱 | 并行调度、Agent 并发、队列原因、收件箱、任务时间线、任务模板、技能 | M2.1c 完成 | 三任务并行互不污染；收件箱九类事项可处理（crew_plan_ready 随 M2.2）；技能版本锁定 | 技能与任务模板不得晚于 M2.1 退出；审批过期提醒、时间线评论、保存视图、命令面板、审计导出可在本阶段后移，不阻塞退出 |
| M2.1e 硬化与演示 | 审计导出、诊断包、可访问性、性能校准、M2.1 演示脚本 | M2.1d 完成 | M2.1 退出标准全部通过；无 P0/P1 缺陷 | 否 |
| M2.2a Crew 基础 | Crew 实体、计划、`crew_plan` 门、成员独立 Run、汇总 | M2.1 退出标准通过 | 队长拆解与计划审批测试通过；成员 Run 独立 | 可后移，但不得早于 M2.1 |
| M2.2b Crew 视图与硬化 | Crew 视图、预算、死锁、升级、M2.2 演示脚本 | M2.2a 完成 | M2.2 退出标准通过；无 P0/P1 缺陷 | 可后移 |

### 13.2 交付物清单

| 交付物 | 说明 | 验收方式 |
|---|---|---|
| Go 领域与存储 | TaskDependency、Contract、Approval、Evidence 扩展、Skill、Crew、Inbox 实体与 SQLite 迁移 | 单元测试、迁移测试、数据回滚演练 |
| 调度器改造 | 统一就绪检查、依赖感知、Agent 并发、队列原因、合并队列单飞 | 并发测试、依赖测试、故障注入 |
| 权限执行 | 路径规范化、命令 argv 校验、环境变量白名单、拒绝事件、Runtime 能力声明与隔离等级、越界检测转人工复核 | 越权注入测试、符号链接测试、命令绕过测试、能力矩阵测试 |
| 本地 API 认证 | 会话令牌、一次性 bootstrap、WS ticket、CORS/Host/Origin 回归、审批接口鉴权 | 无令牌 401、跨源 403、WS 拒绝升级、日志无令牌 |
| API 与 WebSocket | 依赖、契约、审批、收件箱、技能、模板、Crew 接口与事件 | 契约测试、事件回放测试、错误码测试 |
| Vue 界面 | Task 详情标签页、DAG 局部视图、契约面板、审批面板、证据面板、Inbox、Agent 角色与权限编辑器、Crew 视图 | 手工走查、组件测试、Playwright 冒烟 |
| 模板与技能库 | 五个内置模板、六类任务模板、至少两个示例技能 | 实例化测试、导入测试、版本锁定测试 |
| 测试夹具 | 示例仓库（含设计系统 token、前后端目录与固定脚本）、冲突分支、失败测试、staging stub、截图 fixture、权限越界脚本 | 可重复执行、可清理 |
| 文档 | M2 用户指南、API 参考、权限说明、迁移说明、演示脚本、验收报告 | 文档评审与干净环境执行 |
| 演示记录 | M2.1 与 M2.2 演示脚本执行记录、截图、事件与审批导出 | 非作者执行并签署 |

### 13.3 阶段依赖

```text
M2.0 准备
  → M2.1a DAG 与就绪
    → M2.1b 契约与审批
      → M2.1c 角色模板与权限
        → M2.1d 调度与收件箱
          → M2.1e 硬化与演示
            → M2.2a Crew 基础
              → M2.2b Crew 视图与硬化
```

硬规则：M2.2 不得早于 M2.1 的并行调度与权限测试；M2.1b 不得早于 M2.1a 的依赖就绪测试；M2.1c 不得早于 M2.1b 的审批状态机测试。若某阶段延期，优先裁剪 P2 能力，不得跳过安全门。

## 14. 演示脚本：从设计规格到 staging 部署

演示脚本是 M2 验收的核心证据；以下步骤必须在干净环境可复现，并包含失败路径。

### 14.1 演示目标与时长

演示目标：在干净环境中，用四类角色 Agent 完成一次从设计规格到 staging 部署的完整流水线，并展示三条失败路径。核心演示 13.5 分钟，失败路径 1.5 分钟，合计约 15 分钟；可选 Crew 演示另加 5 分钟（M2.2），不计入 M2.1 验收时长。

演示必须证明：

1. 契约未冻结时下游不能启动；冻结后可并行。
2. 路径与命令权限按 Runtime 能力执行：`enforced` 在执行前拒绝，`partial`/`advisory` 检测越界并阻断完成。
3. 合并与 staging 必须人工审批；生产只生成计划；未审批的删除被拒绝。
4. 证据不足不能完成任务；Inbox 能聚合待处理事项。
5. 审批与证据可导出，决策链完整。
6. 本地 API 要求会话令牌；未带令牌或跨源的审批请求被拒绝。

### 14.2 前置条件

- 已完成 M1 验收：git worktree、真实 Claude Code adapter、Artifact/Evidence、diff 评审、人工合并可用。
- 已构建 M2 版本：Go 服务、Vue Web、Wails 壳可启动。
- 本机已安装并登录 Claude Code CLI；已准备一个固定的示例仓库 fixture：`apps/web/`（Vue 应用与 `packages/ui/tokens.json` 设计 token）、`internal/`（Go 后端）、可运行的 `pnpm typecheck`/`pnpm test`/`pnpm build` 与 `go test`/`go vet`/`go build`、`scripts/staging-deploy.sh`、一个可注入失败的测试用例。
- 示例仓库必须包含 UI Design 需要的设计系统（token 表与至少三个现有组件）；截图采集方式在演示前固定为 OQ-M2-10 的决策结果（Runtime 能力、浏览器自动化或人工上传），并在 fixture 中提供对应脚本或清单。
- OQ-M2-07（各角色默认命令白名单）与 OQ-M2-10（截图采集方式）必须在演示前关闭；未关闭时不得把演示结果作为 M2.1 退出证据。
- 已配置 staging 环境；生产环境未被配置，ATeam 中没有生产凭据。
- 已准备临时数据目录，避免污染日常数据。
- 演示启动命令显式使用 `--concurrency 3`，保证三个无依赖任务可以并行。

### 14.3 准备步骤

```bash
# 1. 干净构建
make web-install
make build

# 2. 使用临时数据库启动 API 与 Web（三并发；浏览器模式会打印一次性 bootstrap URL）
mkdir -p /tmp/ateam-m2-demo
./bin/ateam serve --addr 127.0.0.1:8787 --db /tmp/ateam-m2-demo/ateam.db --web apps/web/dist --concurrency 3

# 3. 在另一个终端验证健康检查（健康检查不需要令牌）
curl -s http://127.0.0.1:8787/api/v1/health
```

浏览器打开终端打印的 bootstrap URL（含一次性令牌），确认 Board、Agents、Runs、Inbox、Settings 可访问；确认 Settings 中显示 Runtime 检测结果与 Workspace 根目录；确认 Inbox 为空状态与 Board 空状态文案不同。额外验证：不带令牌直接访问 `/api/v1/tasks` 返回 401。

### 14.4 演示步骤

**步骤 1：创建父任务与五个内置模板（约 2 分钟）。**

在 Board 创建父任务「新增用户资料页」，填写验收标准：页面包含默认、加载、错误、空状态；API 返回用户资料；staging 冒烟通过。打开 Agents，从模板分别创建 General、UI Design、Frontend、Backend、DevOps 五个 Agent。逐个展示 `role`、默认 `allowedPaths`、默认 `allowedCommands`、必交证据与 DoD；确认 DevOps 的 `allowedCommands` 不包含生产部署命令。

预期结果：五个 Agent 出现在列表；每个卡片显示角色、Runtime、并发、超时与权限摘要；模板实例化后修改模板不会影响已创建的 Agent。

**步骤 2：拆分子任务与依赖（约 1.5 分钟）。**

在父任务下创建 T1 UI Design、T2 Backend 契约、T3 Frontend、T4 Backend 实现、T5 DevOps staging、T6 生产计划、T7 文档更新（General Agent，无依赖）七个子任务。建立依赖：T3 依赖 T1 与 T2；T4 依赖 T2；T5 依赖 T3 与 T4；T6 依赖 T5；T7 无依赖。打开 DAG 视图，确认节点、边与状态颜色。尝试添加 T1 依赖 T5，确认系统拒绝并显示环路径。

预期结果：DAG 显示七个节点；T3 的 Run 按钮禁用并显示「等待 design_spec 与 api_contract 冻结」；环依赖被拒绝并高亮冲突边。

**步骤 3：UI Design 产出并冻结 design_spec（约 1.5 分钟）。**

启动 T1。UI Design Agent 读取任务与现有设计系统，产出 `design_spec` v1，包含页面清单、状态矩阵、组件清单、token 表、交互说明、可访问性要求与待决问题。打开 Contracts 面板，确认状态为 `draft`；提交评审后状态为 `proposed`；打开 `design_review`，逐项查看证据并批准；契约变为 `frozen`。

预期结果：T3 的 Run 按钮仍禁用，因为 `api_contract` 未冻结；T1 在 `design_review` 通过、`design_spec` 冻结且状态矩阵、token 表与截图证据齐全后，由人工确认进入 `done`，不经过 merge 门（UI Design 不修改业务源码）；若设计产物需要入库，另设设计产物的归档/合并规则。审批记录包含审批人、时间、证据快照。

**步骤 4：Backend 产出并冻结 api_contract（约 1.5 分钟）。**

启动 T2。Backend Agent 产出 `api_contract` v1，包含 endpoint、请求/响应 schema、错误码、鉴权要求与示例。提交 `api_contract_review`，逐项查看后批准并冻结。

预期结果：T3 与 T4 的 Run 按钮变为可用；T3 显示两个契约均已满足；T4 只显示 `api_contract` 满足；Inbox 中出现「依赖就绪」条目，处理后计数减少。

**步骤 5：三任务并行实现（约 2 分钟）。**

同时启动 T3、T4 与 T7（T7 为 General Agent 的文档更新任务，无依赖）。服务以 `--concurrency 3` 启动，保证三个 Run 可同时处于 `running`。展示三个 Run 的独立 worktree、分支与事件流。Frontend Agent 修改 `apps/web/` 内的组件并运行 `pnpm typecheck`、`pnpm test`、`pnpm build`；Backend Agent 修改 `internal/` 与 `migrations/` 并运行 `go test`、`go vet`、`go build`；General Agent 只修改 `README.md` 与 `CHANGELOG.md` 内的说明。三方分别提交 diff、test_report 与 build 证据；Frontend 额外提交关键状态截图。

预期结果：三个 Run 同时处于 `running`；三个 worktree 路径不同；T3 的界面截图覆盖默认、加载、错误、空状态；T4 的 test_report 包含命令、退出码与通过/失败数量；T7 无源码变更；Inbox 中暂无新的高风险事项。

**步骤 6：失败路径一，路径越界（约 0.5 分钟）。**

在 T3 的 Run 中，让 Frontend Agent 尝试写入 `internal/api/handlers.go`。若 Runtime 为 `enforced`，系统拒绝写入并产生 `permission_denied` 事件；若为 `partial`/`advisory`，Run 结束后基线变更检测列出越界文件，Run 进入人工复核。

预期结果：`enforced` 下写入未发生；`partial`/`advisory` 下越界被检出且 T3 不能直接置为 `done`；事件包含路径、策略、隔离等级与修复建议；Run 事件与证据可导出。

**步骤 7：失败路径二，未授权命令（约 0.5 分钟）。**

让 Frontend Agent 尝试执行 `pnpm add some-package`。命令不在 `allowedCommands` 中：`enforced` 下系统拦截并创建 `high_risk_command` 审批请求；`partial`/`advisory` 下命令日志被标记为未授权并进入人工复核。在 Inbox 中打开审批（若创建），查看命令、目的与影响范围；拒绝并填写原因。

预期结果：命令未执行或被标记；Agent 收到结构化拒绝/标记原因；Inbox 条目状态更新；审批记录进入审计。

**步骤 8：合并审批与冲突检测（约 1.5 分钟）。**

T3 与 T4 完成后，分别请求合并。系统先执行 pre-merge dry-run：无冲突时才创建或继续 `merge` 审批，打开审批展示目标分支、源分支、head SHA、diff 统计、test_report、build 与截图；批准并消费审批后执行合并。若两个分支修改了共享类型文件，dry-run 阻止合并、审批保持 `pending`，系统创建集成任务；打开集成任务查看冲突文件与片段证据。

预期结果：pre-merge 未通过时合并不执行且不产生可消费审批；无冲突时未审批合并被拒绝，审批后合并成功并记录 commit；冲突时集成任务生成，原 `merge` 审批保持 `pending` 且不可复用。

**步骤 9：DevOps 生成 deploy_plan 并执行 staging（约 1.5 分钟）。**

启动 T5。DevOps Agent 读取 build 与 test_report，生成 `deploy_plan`，包含目标环境、步骤、审批要求、回滚步骤、冒烟检查、时间窗与风险说明。打开 staging 审批，逐项查看后批准；DevOps 执行 staging 部署与冒烟，提交部署日志、健康检查与冒烟结果。

预期结果：未批准时 DevOps 无法执行 staging；批准后 staging 部署成功；证据包含日志、健康检查与冒烟结果；T5 进入 `in_review`。

**步骤 10：生产只生成计划，Agent 执行被拒绝（约 1 分钟）。**

启动 T6。DevOps Agent 生成生产部署计划与回滚方案，列出执行人、时间窗与风险。尝试让 DevOps 执行生产部署命令，系统拒绝且无生产凭据可用。人工在 ATeam 之外执行生产部署后，将结果回填为 Artifact/Evidence。

预期结果：生产计划存在；Agent 无生产执行入口；拒绝事件记录；人工回填结果可作为证据，但不改变「生产由人执行」的规则。

**步骤 11：证据化完成与 Inbox 清理（约 1 分钟）。**

尝试在缺少截图或 test_report 的情况下把 T3 置为 `done`，系统阻止并列出缺失项。补齐证据后，人工最终确认 T3、T4、T5 与 T7 完成。打开 Inbox，处理剩余条目；确认已清空与暂无事项两种空状态。打开 Task 时间线，查看契约冻结、审批、证据与决定记录。

预期结果：缺证据不能完成；补齐后可完成；Inbox 计数归零；时间线完整；导出审计包包含操作者、时间、对象、决定、理由与证据快照。

**步骤 12：失败路径三，未审批删除被拒绝（约 0.5 分钟）。**

对一个有历史证据与合并记录的对象（例如 T3 的 Run 分支或 Workspace）请求删除。系统展示影响面并创建 `destructive_operation` 审批；在审批未批准时确认删除，系统拒绝执行；随后在审批中批准，再由受控执行器执行清理。

预期结果：未审批删除被拒绝（403/409），对象未被删除；审批记录包含影响面、证据快照与操作者；批准后清理才执行，审计记录完整。

**步骤 13（可选）：Crew 演示（约 5 分钟，M2.2）。**

创建 Crew，指派队长，提交计划；打开 `crew_plan` 审批，查看子任务、角色、依赖、契约、预算与验收标准；批准后成员按 DAG 执行；所有子任务完成后队长汇总证据与风险；尝试让队长批准 merge，系统拒绝；人工完成合并审批。

预期结果：计划未批准时成员不启动；队长不能审批；汇总包含子任务状态与证据索引；Crew 视图可定位阻塞与证据缺口。

### 14.5 预期结果与失败判定

演示成功必须同时满足：

- 契约未冻结时下游 Run 被拒绝，冻结后可并行。
- 路径越界与未授权命令按 Runtime 隔离等级被拒绝或被检出并阻断完成，均产生事件。
- 未审批的合并、staging 与删除被拒绝；审批绑定 commit/环境；`prod` 只生成计划与人工回执。
- 无令牌或跨源请求不能创建、批准或消费审批；WS 无 ticket 不能订阅。
- DevOps 无法执行生产部署；生产只生成计划。
- 缺证据不能把 Task 置为 `done`；Inbox 可处理并清零。
- 审计导出包含完整决策链；无隐藏命令、无手工改库、无维护者本机状态依赖。

任一情况发生即判定演示失败：下游在契约未冻结时启动；`enforced` Runtime 下越界写入成功；未授权命令在 `enforced` 下执行成功；`partial`/`advisory` 下越界未被检出或仍可完成；未审批合并、staging 或删除成功；无令牌请求创建或批准了审批；Agent 执行了生产部署；缺证据仍可完成；审计缺失；演示需要手工修改数据库。

### 14.6 证据留存与清理

演示结束后保存：健康检查输出、DAG 截图、契约冻结记录、审批记录、权限拒绝/越界检测事件、staging 日志、删除拒绝记录、审计导出文件、Inbox 清空截图。扫描演示日志、截图与审计文件，确认不含会话令牌、WS ticket 或 Secret 明文。清理临时数据库与示例仓库 worktree，确认没有残留进程、分支或未提交修改。演示记录由非作者执行并签署，附在 M2 验收报告中。

## 15. 依赖、风险与假设

M2 的交付依赖 M1 与多项基础设施；本章列出依赖、风险与需要验证的产品假设。

### 15.1 依赖

| 依赖 | 用途 | 风险 | 缓解 |
|---|---|---|---|
| M1 本地闭环 | worktree、真实 Claude adapter、Artifact/Evidence、diff 评审、合并 | M1 延期或质量不足会导致 M2 无法验证 | M2.0 先做 M1 回归；M1 未通过不得启动 M2.1 |
| 调度器重构 | DAG 就绪、Agent 并发、队列原因、合并队列 | 复杂度上升导致死锁、饥饿、重复执行 | 统一 readiness、幂等入队、状态机测试、故障注入 |
| Workspace 与 Runtime 能力 | 路径/命令策略、能力分级、符号链接防护、进程组终止 | Runtime 不支持时策略只能事后检测 | adapter 能力声明；不支持时显示隔离等级并要求人工确认 |
| SQLite 迁移 | 新表与新列 | 迁移失败或数据损坏 | 事务迁移、前置备份、迁移测试、回滚演练 |
| Vue 组件能力 | DAG 图、契约编辑器、审批面板、证据面板、Inbox、Crew 视图 | 前端工作量集中，易成为瓶颈 | 先保任务详情与 Inbox；DAG 先只读；复杂图组件后置 |
| WebSocket 事件稳定性 | 依赖、契约、审批、Inbox 的实时更新 | 事件丢失导致 UI 不一致 | 事件持久化、断线重连、按需拉取详情 |
| 示例仓库与 staging stub | 演示与 E2E | 演示依赖本机状态 | 提供可重复初始化的 fixtures 与清理脚本 |
| Claude Code CLI | 真实 Runtime | CLI 行为变化导致 adapter 失效 | 版本探测、fixture 测试、错误分类、清晰提示 |
| 操作系统的密钥链 | Secret 存储 | 平台差异 | 抽象 secret store；不可用时阻止高敏操作而不是明文落盘 |

### 15.2 风险

| RISK-ID | 风险 | 影响 | 可能性 | 缓解措施 | 预警信号 |
|---|---|---|---|---|---|
| RISK-T-002、RISK-T-003 | M1 能力不足或延期 | M2 无法开始或无法验证 | 高 | M2.0 硬门禁；M1 回归清单；不跳过 worktree 与证据 | M2.0 结束时 M1 仍有 P0 缺陷 |
| RISK-P-001、RISK-P-004 | 流程过度设计 | 小任务被表单拖慢，用户放弃 | 高 | 提供轻量路径；模板给默认值；Crew 不强制 | 用户绕过 DAG 直接单 Agent 执行 |
| RISK-A-003、RISK-P-005 | 门禁疲劳 | 用户无脑批准，审批失去意义 | 高 | 风险分级；高风险不可批量；证据清单必须展开；自批提示 | 审批响应时间极短且拒绝率接近零 |
| RISK-P-002 | 契约与代码漂移 | 下游按过期契约实现 | 中 | `baseCommit`、stale 提示、合并前重新校验 | 合并冲突集中在契约相关文件 |
| RISK-P-002、RISK-P-004 | 角色模板僵化 | 真实职责交叉，模板不适用 | 中 | custom 角色、模板复制、权限可调整 | 用户频繁复制后大改模板 |
| RISK-T-006 | 路径/命令策略被绕过 | 越权写入或命令执行 | 中 | 服务端策略、argv 解析、realpath、符号链接防护、能力分级、注入测试 | 出现未记录的拒绝或越界变更 |
| RISK-T-002、RISK-P-002 | 多 Agent 合并冲突 | 并行效率下降 | 中 | 路径所有权、合并队列单飞、pre-merge 检测、集成任务 | 冲突率持续高于 10% |
| RISK-T-003 | 调度复杂度上升 | 死锁、饥饿、重复执行 | 中 | 统一 readiness、幂等入队、Crew 死锁检测、容量监控 | 队列长期不前进或同一 Run 重复启动 |
| RISK-T-007 | 本地资源不足 | 并行 Run 互相拖慢 | 中 | 全局与 Agent 并发限制、队列原因、资源提示 | 三路并发时内存或 CPU 持续打满 |
| RISK-P-001 | 前端范围膨胀 | 交付延期，核心流程不可用 | 高 | 先保 Task 详情与 Inbox；DAG 先只读；复杂编辑器后置 | M2.1d 时核心页面仍不可用 |
| RISK-P-007 | 证据造假或失真 | 评审误判 | 中 | 系统采集优先、校验和、命令比对、抽查 | 证据与 RunEvent 不一致 |
| RISK-T-006、RISK-S-002 | 提示注入 | Agent 绕过规则或泄露信息 | 中 | 策略在 Go core；仓库与契约视为不可信；高风险审批 | 出现「忽略审批」类文本或异常命令 |
| RISK-A-003、RISK-P-007 | 单人审批形式化 | 自己审自己没有约束力 | 中 | 显式确认、逐项证据、审计记录；M3 引入职责分离 | 审批记录缺少理由或证据查看 |
| RISK-P-001 | 技能/模板范围蔓延 | M2 复杂度失控 | 中 | 技能只做本地导入；模板只做内置与基础实例化 | 出现市场、评分、远程下载需求 |
| RISK-P-002、RISK-T-003 | Crew 引入过早 | 调度与协作复杂度叠加 | 中 | M2.2 硬门禁；Crew 计划必须审批 | M2.1 权限测试未通过就启动 Crew |
| RISK-S-002 | 本地 API 被恶意网页或进程调用 | 审批被绕过、任务被删、Run 被触发 | 高 | 会话令牌、bootstrap、WS ticket、CORS/Host/Origin 白名单、无令牌 401 | 出现无 token 的成功请求或跨源审批 |
| RISK-T-006、RISK-T-001 | 外部 CLI 无法实时执行工具级策略 | 越界写入只能事后发现 | 高 | 能力矩阵、隔离等级标识、越界检测后终止 Run 与人工复核；不承诺 advisory 为强制 | UI 把 advisory 宣传为 enforced，或越界未被检出 |

### 15.3 假设与验证

| 假设 | 验证方式 | 失败后的调整 |
|---|---|---|
| 独立开发者会同时推进 3 个以上角色任务 | M2 内测访谈与使用日志（本地、可选） | 缩小角色模板范围，强化单 Agent 轻量路径 |
| 角色 Agent 与契约能显著提高一次验收通过率 | 对比使用契约前后的首次审批通过率 | 简化契约字段，保留关键证据要求 |
| 用户愿意为 staging 审批付出一次人工确认 | 观察审批响应时间与拒绝率 | 降低 staging 门频率，合并到发布批次 |
| 路径与命令白名单不会严重阻塞正常工作 | 统计 `permission_denied` 与修复时间 | 提供更细的模板默认值与一次性许可 |
| Crew 的协调开销可接受 | M2.2 试点任务与计划偏差 | 将 Crew 保持为可选，默认使用并行任务 |
| 本地 SQLite 足以支撑 M2 数据量 | 1,000 Task、10,000 证据、并发 3 Run 压测 | 优化索引与归档；M3 迁移 Postgres |
| 证据化 DoD 不会显著拖慢交付 | 统计证据采集耗时与任务周期 | 自动化证据采集，减少人工上传 |

## 16. 验收与退出标准

M2.1 的验收分为功能、安全、体验与质量四层；退出标准以可观察结果为准，不以功能列表为准。

### 16.1 验收分层

M2.1 验收分为四层，任何一层不通过都不得退出 M2.1：

- **功能验收（AC-M2-F）**：DAG、契约、角色、权限、审批、证据、收件箱、调度、技能、模板、本地 API 认证。
- **安全验收（AC-M2-S）**：路径/命令执行与分级、密钥隔离、审批不可绕过、本地 API 认证与跨源防护、提示注入防护、审计完整。
- **体验验收（AC-M2-U）**：任务详情、DAG 视图、契约面板、审批面板、Inbox、权限编辑器、错误状态与可访问性。
- **质量验收（AC-M2-Q）**：测试、覆盖率、迁移、性能、文档、演示、无 P0/P1 缺陷。

M2.2 的 Crew 使用 16.2.1 的附加清单，不与 M2.1 功能验收混判。M2.2 后移时，M2.1 仍可按上述四层退出；M2.1 功能验收明确排除 Crew。

### 16.2 功能验收清单

| 编号 | 验收项 | 通过条件 | 关联 |
|---|---|---|---|
| AC-M2-F-01 | 任务 DAG | 可创建 `finish_to_start` 依赖；环检测返回完整路径；依赖未满足时 Run 被拒绝 | COLLAB-020、COLLAB-021、COLLAB-022 |
| AC-M2-F-02 | 阻塞与解锁 | 依赖未满足时任务 `blocked`；依赖完成后自动解锁并广播事件 | TASK-097、TASK-098、TASK-099 |
| AC-M2-F-03 | 契约生命周期 | 五类契约可创建；状态机合法；未冻结不能消费；冻结需评审门 | COLLAB-010 至 COLLAB-013 |
| AC-M2-F-04 | 契约版本与变更 | 冻结后不可原地编辑；新版本保留历史；破坏性变更触发 `contract_break` | COLLAB-014、COLLAB-015、COLLAB-019 |
| AC-M2-F-05 | 角色模板 | 五个内置模板（General + 四角色）可实例化；role 正确；模板变更不影响已有 Agent | COLLAB-001 至 COLLAB-003 |
| AC-M2-F-06 | 路径权限 | `enforced` Runtime 越界写入被拒绝；`partial`/`advisory` Runtime 越界被检出并阻断完成；绝对路径、`..`、符号链接逃逸被阻止 | COLLAB-072、SEC-010、SEC-017 |
| AC-M2-F-07 | 命令权限 | `enforced` Runtime 未授权命令被拒绝；`partial`/`advisory` Runtime 命令被标记并进入人工复核；shell 元字符不能绕过；拒绝/检测事件完整 | COLLAB-073、SEC-011 |
| AC-M2-F-08 | 合并审批 | 未审批合并被拒绝；审批绑定 commit；目标变化使审批失效 | COLLAB-043、SEC-020、SEC-026 |
| AC-M2-F-09 | staging 审批 | 未批准不能执行 staging；批准后执行并产生日志与冒烟证据 | COLLAB-044、SEC-022 |
| AC-M2-F-10 | 生产边界 | Agent 无生产执行入口与凭据；prod 只生成计划；人工回填结果 | COLLAB-045、AGENT-061 |
| AC-M2-F-11 | 证据化 DoD | 缺证据不能置 `done`；证据不可变；命令不一致标记 `unverified` | COLLAB-051、COLLAB-055、COLLAB-056 |
| AC-M2-F-12 | 并行调度 | 三个无依赖任务可并行；全局与 Agent 并发限制生效；工作区互不污染 | COLLAB-023、AGENT-017、RUN-025 |
| AC-M2-F-13 | 收件箱 | 九类事项（approval_request、approval_expired、blocker、escalation、mention、contract_change、dependency_ready、run_failed、evidence_unverified）可生成、筛选、处理；crew_plan_ready 在 M2.2 生成；未读计数一致；高风险不可批量批准 | COLLAB-060、UI-073、UI-075 |
| AC-M2-F-14 | 任务时间线 | 契约、审批、证据、评论按时间排序；Agent 消息含 `summary`、`evidenceRefs`、`nextStep`、`needsHuman`、`blockerCode` | COLLAB-062、UI-044 |
| AC-M2-F-15 | 技能 | 本地导入、版本化、绑定、命令子集校验、Run 记录版本 | AGENT-032 至 AGENT-039 |
| AC-M2-F-16 | 任务模板 | 六类模板可创建；可实例化预置 DAG；Agent 草稿需人工确认 | TASK-083 至 TASK-086、TASK-089 |
| AC-M2-F-17 | 合并冲突 | pre-merge 检测在审批前阻止冲突合并并创建集成任务 | COLLAB-024、COLLAB-025 |
| AC-M2-F-18 | 本地 API 认证与审批接口 | 无令牌请求返回 401；跨源请求不能创建、批准、消费或撤销 Approval；WS 无 ticket 不能订阅 | SEC-003、SEC-004、NFR-SEC-003 |

**16.2.1 M2.2 功能验收（Crew 交付时适用，不阻塞 M2.1 退出）：**

| 编号 | 验收项 | 通过条件 | 关联 |
|---|---|---|---|
| AC-M2-F-C01 | Crew 计划审批 | 计划审批前成员不启动；成员独立 Run；队长不能批准；汇总含证据索引 | COLLAB-030 至 COLLAB-035 |
| AC-M2-F-C02 | Crew 预算与死锁 | 超预算暂停并创建紧急条目；全部子任务阻塞且无活动 Run 时 Crew blocked | COLLAB-036、COLLAB-037 |
| AC-M2-F-C03 | Crew 视图 | 成员、子任务状态、阻塞原因、证据完整度可查看 | COLLAB-033、COLLAB-034 |

### 16.3 安全验收清单

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| AC-M2-S-01 | 路径策略 | `enforced` 下注入 `../`、绝对路径、符号链接与大小写绕过均被拒绝并记录；`partial`/`advisory` 下越界被检出并阻断完成 |
| AC-M2-S-02 | 命令策略 | `enforced` 下注入 shell 元字符、包装脚本、未声明命令均被拒绝并记录；`partial`/`advisory` 下未声明命令被标记并进入人工复核 |
| AC-M2-S-03 | 环境变量 | 敏感变量默认不可见；白名单外变量不继承 |
| AC-M2-S-04 | 密钥 | 密钥不出现在数据库明文、日志、RunEvent、证据与诊断包 |
| AC-M2-S-05 | 审批不可绕过 | Agent 不能批准任何 Approval；队长不能批准；批量批准被拒绝；Agent 发起的请求只能由人类决定 |
| AC-M2-S-06 | 审批失效 | 目标 commit、diff 或环境变化后审批失效；过期审批不能执行 |
| AC-M2-S-07 | 生产隔离 | DevOps 无生产凭据与执行入口；生产命令不在白名单 |
| AC-M2-S-08 | 提示注入 | 仓库与契约中的「跳过审批」文本不能改变策略 |
| AC-M2-S-09 | 审计 | 高风险动作先写审计后执行；审计只追加；导出完整 |
| AC-M2-S-10 | 工作区隔离 | 两个 Run 的 worktree 不同；主工作区不被直接修改；无路径穿越 |
| AC-M2-S-11 | 权限能力分级 | 每个 Runtime 声明 `enforced`/`partial`/`advisory`；`enforced` 用例在执行前拒绝；`partial`/`advisory` 用例检测越界、终止或阻断 Run 并进入人工复核；不得把 advisory 宣称为强制 |
| AC-M2-S-12 | 本地 API 认证与跨源防护 | 无令牌返回 401；未知 Origin/Host 返回 403 且无 ACAO；WS 无 ticket 拒绝升级；恶意网页无法创建、批准或消费 Approval；令牌不落日志 |
| AC-M2-S-13 | 审批不可被绕过 | 直接调用本地 API 但未认证的审批请求失败；Agent 与队长无审批权限；已消费审批重复使用返回 409 |

### 16.4 体验与质量验收清单

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| AC-M2-U-01 | Task 详情 | Overview、Runs、DAG、Contracts、Gates、Evidence、Timeline 七个标签可用；Run 详情内嵌 Timeline、Logs、Diff、Artifacts、Review、Approval |
| AC-M2-U-02 | 就绪提示 | Run 按钮禁用时显示具体原因，而不是点击后才失败 |
| AC-M2-U-03 | 审批面板 | 证据逐项展示；拒绝需填原因；批准后状态同步；自批有提示 |
| AC-M2-U-04 | Inbox | 十类事项（M2.1 九类 + M2.2 的 crew_plan_ready）、未读计数、键盘巡检、空状态区分 |
| AC-M2-U-05 | 权限编辑器 | 白名单语义清晰；高风险命令标识；放宽权限二次确认 |
| AC-M2-U-06 | 错误状态 | 权限拒绝、契约未冻结、依赖未满足、合并冲突均有可操作提示 |
| AC-M2-U-07 | 可访问性 | 核心路径可键盘完成；对比度、焦点、读屏抽查通过 |
| AC-M2-U-08 | 国际化 | zh-CN 与 en-US 文案来自资源文件；时间与数字使用 Intl |
| AC-M2-Q-01 | 测试 | Go 测试、`go vet`、`gofmt`、TypeScript 类型检查、Web 构建通过 |
| AC-M2-Q-02 | 覆盖率 | 核心 Go 包行覆盖率不低于 70% |
| AC-M2-Q-03 | 端到端 | 至少一个 E2E smoke 覆盖 DAG 到 staging 的主路径 |
| AC-M2-Q-04 | 迁移 | 迁移前置备份、失败回滚、样例数据验证通过 |
| AC-M2-Q-05 | 性能 | 三次并发 Run 总常驻内存不超过 2GB；调度额外开销不超过 100ms |
| AC-M2-Q-06 | 缺陷 | 无 P0 缺陷；P1 缺陷为零；P2 有 workaround 与计划 |
| AC-M2-Q-07 | 文档 | README、用户指南、API 参考、权限说明、迁移说明、演示脚本齐全 |
| AC-M2-Q-08 | 演示 | 非作者在干净环境执行演示脚本通过并记录 |

### 16.5 退出标准

M2 退出分为 M2.1 退出与 M2.2 退出。M2.1 是核心协作能力的硬门禁；M2.2 是 Crew 的附加门禁。若进度紧张，M2.2 可以后移，但 M2.1 不得削减。

**M2.1 退出标准（必须全部满足；Crew 不参与 M2.1 判定）：**

1. 可以创建任务依赖；依赖未满足时下游不能启动 Run；依赖满足后自动解除阻塞；循环依赖被拒绝并给出明确错误；`requiredArtifactKinds` 缺失时返回 `artifact_missing`。
2. 可以为一个任务或角色模板声明交付物契约；缺少必需证据的 Run 不能进入可评审状态；UI 显示缺失项；`deliverables`、`contract_versions`、`contract_requirements` 的语义与 `/api/v1` 端点通过契约测试。
3. 内置五个模板：General、UI Design、Frontend、Backend、DevOps，包含指令、允许路径、允许命令与默认证据要求；其中四个角色模板可实例化并绑定到角色子任务。
4. 路径与命令权限按 Runtime 能力生效：`enforced` Runtime 在执行前拒绝越界写入与未授权命令并记录；`partial`/`advisory` Runtime 在事后检测越界、终止或阻断 Run 并转人工复核，UI 明确标注隔离等级；不得把 advisory 宣称为强制。
5. 审批门生效：合并、推送、staging、删除在没有审批时被阻止；`prod` 只确认计划与人工回执，不执行生产动作；审批记录包含审批人、时间、目标、证据摘要和指纹；目标变化后审批 `expired`；审批不可重复消费。
6. 本地 API 认证生效：无令牌请求返回 401；未知 Origin/Host 返回 403；WS 无 ticket 拒绝升级；恶意网页或跨源请求不能创建、批准、消费或撤销 Approval；令牌不落日志。M1 的 Origin/CORS/Host 校验作为回归项通过。
7. DevOps 只能执行 staging 部署和生成生产部署计划；生产执行不能被 ATeam 自动触发；生产凭据不出现在 Run 或证据中。
8. 收件箱汇总待审批、待评审、阻塞、失败、依赖就绪等九类事项（crew_plan_ready 随 M2.2）；处理收件箱项会更新对应任务或 Run 状态；已读状态在单用户模型下工作。
9. 三个任务由三个 Agent 并行执行时（演示以 `--concurrency 3` 启动），全局并发和单 Agent 并发限制都被遵守；工作区互不污染；UI 能区分每个 Run 的状态。
10. 任务模板可以实例化一个预置 DAG；技能包可以附加到 Agent，Run 记录技能版本；这两项是 M2.1 退出必需，若确需裁剪必须走范围变更并重新评审退出标准，不得静默降级。
11. 质量、安全、文档和演示标准满足 `prd/01-scope-and-roadmap.md` 第 6 节；无 P0 或 P1 未关闭缺陷。

**M2.2 退出标准（Crew 交付时全部满足；使用 16.2.1 验收）：**

1. 队长 Agent 可以把一个父任务拆成子任务 DAG，并为每个子任务选择角色模板和契约。
2. 子任务之间的交接通过 Artifact 和 Evidence 完成，不依赖共享自由聊天；队长不能读取或传递未授权的私有上下文。
3. 队长不能批准合并、推送或部署；所有高风险动作仍需人类审批。
4. Crew 视图展示成员、子任务状态、阻塞原因和证据完整度；成员失败时可以重试或升级给人。
5. Crew 演示脚本可以在干净环境复现；无 P0 或 P1 未关闭缺陷。

### 16.6 退出评审与记录

退出评审由产品负责人、工程负责人、设计负责人与至少一名非作者评审人参加。评审输入包括：验收清单逐项结果、测试报告、覆盖率报告、安全测试报告、性能记录、迁移演练记录、演示记录、已知限制与风险接受记录。评审输出包括：是否退出、未关闭缺陷与 workaround、是否允许进入 M3、需要回写的文档与 ADR。

以下情况不得退出：存在未缓解的 P0 安全风险；未审批可执行合并、推送、staging 或删除；无令牌或跨源请求可创建、批准或消费审批；路径/命令策略可被简单绕过；把 `advisory` Runtime 宣传为强制隔离；演示依赖手工改库或隐藏命令；把计划能力写成已实现。

## 17. 里程碑映射

| 能力 | M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| 任务 DAG | 无，`parentId` 仅字段 | 无 | M2.1 `finish_to_start` + `requiredArtifactKinds` | 团队共享 DAG | 事件触发自动建依赖 |
| 交付物契约 | 无 | 无正式契约；仅 diff 与证据附件进入评审 | M2.1 `deliverables` 五类契约、版本、冻结、变更门 | 跨团队契约引用与审计 | 自动化契约校验与同步 |
| 角色模板 | 无，仅通用 Agent | 无 | M2.1 五个内置模板（General + 四角色）+ custom | 团队共享 Agent 模板 | 插件提供模板扩展 |
| 路径/命令权限 | 字段存储但不执行 | 无强制；仅 worktree 级隔离与越界检测 | M2.1 按 Runtime 能力分级执行（enforced/partial/advisory） | 团队策略与远程 Runner 约束 | 策略中心与插件沙箱 |
| 审批门 | 无 | merge 人工确认（Review + confirm） | M2.1 design_review、api_contract_review、merge、push、staging、prod、destructive_operation、high_risk_command、scope_change、contract_break；crew_plan 随 M2.2 | 身份化审批、职责分离、团队审计 | 策略自动化与通知联动 |
| 本地 API 认证 | 无认证、CORS/WS 放行任意来源 | Origin/CORS/Host 与 WS Origin 校验（SEC-004） | M2.1 会话令牌、bootstrap、WS ticket（SEC-003） | 登录、会话与角色权限 | 远程访问认证与 TLS |
| 证据化 DoD | 无 | diff、测试、构建证据基础 | M2.1 契约逐项证据与完成检查 | 审计留存与导出 | 外部证据接入 |
| 并行调度 | 单队列、全局 worker | 单任务单活跃 Run | M2.1 DAG 就绪、Agent 并发、队列原因 | 跨机器调度 | 自动扩缩与优先级策略 |
| 收件箱 | 无 | 无 | M2.1 九类事项与处理（crew_plan_ready 随 M2.2） | 团队共享收件箱 | 桌面通知与 Webhook |
| 技能 | 无 | 无 | M2.1 本地技能与版本锁定 | 团队共享技能 | 技能市场与插件 |
| 任务模板 | 无 | 无 | M2.1 六类模板与预置 DAG | 团队模板与版本 | 模板市场与导入导出 |
| Crew/队长 | 无 | 无 | M2.2 计划、分派、汇总、预算 | 跨机器 Crew | 自动编排与策略优化 |
| 审计 | 无 | 本地审计基础 | M2.1 审批、拒绝、关键动作记录 | 哈希链、团队审计、导出 | 审计留存与外部接入 |
| 团队模式 | 无 | 无 | 无 | Postgres、登录、权限、远程 Runner、GitHub PR | 稳定与扩展 |
| 自动化与分发 | 无 | 无 | 无 | 无 | 定时/Webhook、通知、打包、自动更新、插件、遥测 |

M2 内部顺序固定为：M2.0 准备 → M2.1a DAG → M2.1b 契约与审批 → M2.1c 角色与权限 → M2.1d 调度与收件箱 → M2.1e 硬化 → M2.2a Crew 基础 → M2.2b Crew 硬化。若进度紧张，优先裁剪 P2 能力，不得跳过 M2.1 的权限与审批测试。

## 18. 与其他文档的关系

本章是 M2 里程碑的执行文档，不重复模块细节。相关文档与职责如下：

- `prd/00-product-overview.md`：产品愿景、用户、Jobs-to-be-Done、原则与核心闭环；本章在其约束下定义 M2 的目标与成功口径。
- `prd/01-scope-and-roadmap.md`：里程碑总览、M2.1/M2.2 拆分、发布标准、范围变更与硬依赖；本章的退出标准与其第 4.4.6 节保持一致。
- `prd/02-domain-model.md`：TaskDependency、Contract、Approval、Evidence、Skill、Crew 的领域语义与状态机；本章的数据与状态描述以其第 3 节为准。
- `prd/03-user-flows.md`：流程 B 角色 Agent 流水线、流程 C Crew、流程 D 评审与审批、流程 E 失败与升级；本章的用户故事与演示脚本引用其流程。
- `prd/04-acceptance-and-test-plan.md`：M2 验收标准与测试矩阵；本章的 `AC-M2-xx` 是其第 4.3 节的细化与补充。本章第 14 章的 13 步演示脚本（含 3 条失败路径）取代并细化 04 §4.3 的 6 步演示；04 §4.3 第 5 项「已读状态按用户隔离」与 M2 单用户模型冲突，按本章改为单用户已读状态，多用户隔离移到 M3，需在 04 中回写。
- `prd/05-risks-and-open-questions.md`：风险登记、决策日志与开放问题；本章 15.2 的每条风险已增加 `RISK-ID` 列并与该文档的 RISK-P/T/S 编号对应。
- `prd/modules/task-management.md`：Task 字段、状态机、看板、任务模板、依赖 DAG；本章的 DAG 与任务模板引用其第 8 至 10 节。
- `prd/modules/agent-system.md`：Agent 配置、角色、指令、技能、版本、并发与权限；本章的角色模板与技能引用其第 5 至 8 节。
- `prd/modules/runtime-and-workspace.md`：Run 生命周期、Runtime adapter、worktree、Artifact/Evidence、取消与超时；本章的调度与证据引用其第 6 至 11 节。
- `prd/modules/collaboration-and-review.md`：角色 Agent、交付物契约、任务 DAG、Crew、审批门、证据化 DoD、收件箱的权威模块文档；本章第 5 至 8 节是其 M2 部分的里程碑化摘要。
- `prd/modules/security-and-permissions.md`：信任模型、权限信封、审批规则、审计与威胁模型；本章第 11 章引用其第 4 至 6 节与第 20 节。
- `prd/modules/ui-ux.md`：页面清单、Task 详情、Agents、Inbox、交互与可访问性；本章第 7.11 节引用其 M2 界面要求。
- `prd/modules/non-functional-requirements.md`：性能、可靠性、可观测性、可访问性、国际化与安全约束；本章第 7.12 节与第 12 章引用其目标值。
- `prd/modules/api-and-data.md`：REST 端点、WebSocket 事件、错误模型、分页、迁移策略；本章第 9 章是其 M2 部分的摘要。

权威顺序：领域语义以 `02-domain-model.md` 为准；模块行为以对应模块文档为准；里程碑范围与退出以本章与 `01-scope-and-roadmap.md` 为准。若发现冲突，以更具体、更新的文档为准，并在第 19 章记录回写项。

## 19. 待确认/未文档化

以下事项是进入 M2 开发前必须确认的开放问题。它们不是遗漏，而是需要产品或技术决策的选项；在关闭前，实现应选择可逆方案，避免把未决假设固化到数据模型。

### 19.1 开放问题与已决事项

| 编号 | 待确认事项 | 当前状态 | 影响 | 最晚决策点 |
|---|---|---|---|---|
| OQ-M2-01 | 依赖边类型：M2 是否只支持 `finish_to_start` 加 `requiredArtifactKinds`，还是同时提供 `artifact_ready` 与 `approval` 独立边 | 已决：M2 只支持 `finish_to_start` + `requiredArtifactKinds`；`artifact_ready` 与 `approval` 为 P2 预留，`collaboration-and-review.md` 已对齐 | 影响 DAG 数据模型、调度器与 UI 图语义 | 已关闭 |
| OQ-M2-02 | 空 `allowedPaths` 的语义：默认拒绝写入，还是表示整个工作区 | 已决：默认拒绝；`AGENT-023` 现行版本与 `UI-067` 已采用该语义 | 影响安全默认值与用户体验 | 已关闭 |
| OQ-M2-03 | TaskContractVersion 与 `deliverables`/`contract_versions` 的映射 | 已决：以 `api-and-data.md` 为权威——`deliverables` 存当前版本，`contract_versions` 存历史，`contract_requirements` 存任务引用；TaskContractVersion 是 `contract_versions` 的概念名，Task 的 `deliverableContract`/`currentContractVersionId` 是投影 | 影响契约版本、查询与 API 形态 | 已关闭；回写 `02-domain-model.md` 与 `01-scope-and-roadmap.md` |
| OQ-M2-04 | `api_contract` 的 schema 载体：OpenAPI 子集还是自定义 JSON Schema | 未定 | 影响契约校验、前端类型生成与文档导出 | M2.1b 开发前 |
| OQ-M2-05 | `design_spec` 的存储格式：Markdown 加 JSON 混合，还是纯 JSON | 未定 | 影响设计者编辑体验与结构化校验 | M2.1b 开发前 |
| OQ-M2-06 | 本地单用户审批人身份：OS 账户、本地用户档案，还是不引入身份 | 未定 | 影响审计记录与 M3 迁移映射 | M2.1b 开发前 |
| OQ-M2-07 | 各角色默认命令白名单的具体条目 | 当前只给出类别 | 错误白名单会直接阻塞正常工作 | M2.1c 开发前 |
| OQ-M2-08 | 审批默认时限：24 小时提醒、72 小时升级是否适合个人节奏 | 初始假设 | 影响门禁疲劳与阻塞 | M2.1b 内测校准 |
| OQ-M2-09 | Crew 预算默认值：最大 Run 数、最大时长、最大重试次数 | 初始假设 | 影响 Crew 暂停与升级时机 | M2.2a 开发前 |
| OQ-M2-10 | 截图证据采集方式：Runtime 能力、浏览器自动化还是人工上传 | 未定 | 影响证据可信度与 Frontend DoD | M2.1d 开发前 |
| OQ-M2-11 | 合并队列并发策略：全局单飞还是按路径分段并行 | 本章采用同仓库单飞 | 影响合并吞吐与冲突检测复杂度 | M2.1b 开发前 |
| OQ-M2-12 | 跨任务契约复用默认策略：显式引用后是否提示复用、是否允许自动跟随小版本 | 当前为不自动跟随 | 影响契约过期与下游重跑 | M2.1b 开发前 |
| OQ-M2-13 | M2 是否支持 direct 模式（直接在用户工作区运行） | `RUN-050` 列为 M2，但本章未纳入 P0 | 影响安全模型与用户体验 | M2.1d 范围评审 |
| OQ-M2-14 | Codex Runtime 是否进入 M2 可选范围 | `01-scope-and-roadmap.md` 允许 M1.x 或 M2；本章不列为退出条件 | 影响 Runtime 覆盖与测试工作量 | M2.1d 范围评审 |
| OQ-M2-15 | 技能提示词预算：8K 警告、16K 硬上限是否合理 | 初始建议 | 影响技能复杂度与上下文成本 | M2.1d 内测校准 |
| OQ-M2-16 | 证据保留默认值：90 天是否适合本地磁盘与审计需求 | 初始假设 | 影响磁盘占用与审计完整性 | M2.1e 发布前 |
| OQ-M2-17 | M2.2 Crew 是否作为 M2 正式退出的必要项，还是可后移到 M2.x | 本章将其列为附加退出标准 | 影响 M2 时间与 M3 启动条件 | M2.1e 退出评审 |
| OQ-M2-18 | 团队共享 Agent 与团队审计的 schema 是否在 M2 预留 | M3 计划；M2 只做本地 | 影响 M3 迁移成本 | M2.1e 架构评审 |
| OQ-M2-19 | 任务模板版本化是否进入 M2，还是 M3 | `TASK-088` 为 M2、P2；本章不把模板版本快照作为 M2.1 退出必需，但模板实例化需保留 `templateVersionSnapshot` | 影响模板升级与历史任务复现 | M2.1d 范围评审 |
| OQ-M2-20 | 收件箱已读状态在单用户模式下是否需要多用户隔离字段 | 已决：M2.1 使用单用户已读状态（条目级已读/处理状态，不按 userId 分区）；多用户隔离属于 M3 | 影响数据模型与迁移 | 已关闭；回写 `04-acceptance-and-test-plan.md` §4.3 |
| OQ-M2-21 | 里程碑级命名：API 前缀、契约资源名、表名、门禁类型枚举、审批状态 | 已决：`/api/v1` 为规范前缀，`/api/*` 为永久别名；契约为 `deliverables` + `contract_versions`；审批为 `approvals`；门禁类型按 `collaboration-and-review.md` 8.1 的 11 类；状态为 `pending/approved/rejected/expired/cancelled/consumed` | 影响契约测试、迁移与 UI | 已关闭；api-and-data、安全模块、协作模块与任务模块已按此回写 |
| OQ-M2-22 | role 枚举与内置模板数量 | 已决：role 为 `general`（默认，含旧 Agent 迁移）、`ui_design`、`frontend`、`backend`、`devops`、`custom`；内置模板五个（General + 四角色） | 影响迁移、模板实例化与验收 | 已关闭；回写 `02-domain-model.md`、`agent-system.md` |
| OQ-M2-23 | 本地会话令牌的里程碑归属 | 已决：以 `security-and-permissions.md` 为准，SEC-003 由 M2.1 交付并纳入退出标准；SEC-004（Origin/CORS/Host）由 M1 交付并回归；`non-functional-requirements.md` 的 M1 标注需要回写 | 影响安全验收与 M2.1 范围 | 已关闭；回写 NFR 模块 |
| OQ-M2-24 | 收件箱类型集合 | 已决：采用 `collaboration-and-review.md` 10.1 的十类；M2.1 交付九类，`crew_plan_ready` 随 M2.2 | 影响 Inbox 数据模型与验收 | 已关闭 |
| OQ-M2-25 | Task 详情标签模型 | 已决：M2 使用 Overview、Runs、DAG、Contracts、Gates、Evidence、Timeline 七个标签；Run 详情内嵌 Timeline、Logs、Diff、Artifacts、Review、Approval | 影响 UI-124、UI-131 与验收 | 已关闭；回写 `ui-ux.md` |
| OQ-M2-26 | 04 §4.3 与本章的验收差异 | 已决：本章的 AC-M2 与 13 步演示取代 04 §4.3 的 6 步演示；已读状态按单用户模型；Crew 为 M2.2 可选，不阻塞 M2.1 | 影响验收口径与演示 | 已关闭；回写 04 §4.3 |
| OQ-M2-27 | `allow_newer` 与 `min_version` 的默认值 | 默认 `allow_newer=false`，精确版本固定；开启时记录实际解析版本；M2.1b 前确认 UI 文案 | 影响契约过期与下游重跑 | M2.1b 开发前 |

### 19.2 优先级差异与回写清单

**需求优先级差异（模块值 → 本文件值）：**

| 需求 | 模块文档值 | 本文件值 | 理由 | 状态 |
|---|---|---|---|---|
| COLLAB-030 至 COLLAB-039（Crew 簇） | 模块内为 P0/P1，里程碑 M2 | 本文件按 M2.2 可选处理，Crew 整体标 P1 | Crew 是 M2.2 的可后移能力，不得阻塞 M2.1；模块内 P0 表示「一旦交付 Crew 则闭环必需」，不是 M2.1 退出必需 | 已在 collaboration §7.1 注明里程碑优先级与模块优先级分离 |
| TASK-083、TASK-084 | P2，M2 | P2，M2.1 可选，不阻塞退出 | 任务模板的完整度不构成 M2.1 硬门禁；退出标准只依赖 TASK-089 | 无需回写，按模块值执行 |
| TASK-089 | P1，M2.1 | P1，M2.1 必须交付 | 直接对应退出标准第 10 项「模板实例化预置 DAG」 | 已回写 task-management |
| COLLAB-054 | P0，M2 | P0，M2.1 退出必需 | Frontend DoD 与演示要求关键状态截图；没有截图证据就无法证明界面完成 | 已回写 collaboration |

**跨文档回写清单（本章评审后执行，当前状态）：**

| 文档 | 回写项 | 状态 |
|---|---|---|
| `prd/modules/collaboration-and-review.md` | 审批状态 `revoked` 改为 `cancelled`；事件名 `contract.*` 改为 `deliverable.*` 并保留别名说明；`task_dependencies` 字段按 api-and-data 使用 `type` | 已回写 |
| `prd/modules/security-and-permissions.md` | 审批状态 `requested` 改为输入别名，规范值为 `pending` | 已回写 |
| `prd/02-domain-model.md` | role 默认与迁移统一为 `general`；TaskContractVersion 与 `contract_versions` 的映射；§7.4 的 `revision`/409 与 TASK-122 统一 | 已回写 |
| `prd/modules/agent-system.md` | 旧数据迁移默认值改为 `general`；模板字段统一为 `role_template_id`/`role_template_version`/`template_snapshot` | 已回写 |
| `prd/modules/ui-ux.md` | UI-124/UI-131 的 Task 标签集统一为七个（含 Runs）；Run 详情标签归属写明 | 已回写 |
| `prd/04-acceptance-and-test-plan.md` | §4.3 第 5 项改为单用户已读状态；演示脚本引用本章第 14 章；Crew 标注为 M2.2 可选 | 已回写 |
| `prd/modules/non-functional-requirements.md` | NFR-SEC-003 的里程碑由 M1 改为 M2.1，并与 SEC-003 合并为引用关系 | 已回写 |
| `prd/modules/runtime-and-workspace.md` | RUN-117 的「M2 沙箱」改为「M2 按 Runtime 能力分级，沙箱属于 M3」；RUN-025 标注 M1 部分实现、M2.1 扩展 | 已回写 |
| `prd/05-risks-and-open-questions.md` | RISK-S-002 的目标里程碑补充 M2.1；RISK-T-006 增加 M2.1 能力分级说明 | 已回写 |
| `prd/modules/task-management.md` | TASK-089 优先级更新为 P1/M2.1；TASK-083/084 保持 P2 | 已回写 |

以上问题的关闭方式：由产品负责人、工程负责人与设计负责人在对应决策点评审，形成 ADR 或文档更新；关闭后必须同步更新本章、相关模块文档与测试用例。未关闭前，默认采用本章给出的保守选项：默认拒绝、显式审批、证据优先、只做加法迁移。
