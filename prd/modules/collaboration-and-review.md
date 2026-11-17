# 模块：角色 Agent 协作与评审

## 本章导读

ATeam 要解决的不是「让更多 Agent 同时说话」，而是「让承担不同职责的 Agent 围绕同一个交付目标，以可验证的方式交接工作」。本章定义角色 Agent（UI Design、Frontend、Backend、DevOps）的职责、输入、输出、权限与完成定义（DoD），定义交付物契约（Handoff Contract）的格式与冻结规则，定义任务依赖 DAG、Crew/队长模式、人工审批门、证据化 DoD、收件箱与升级路径，并划清同一任务内协作与跨任务协作的边界。

本章的主体能力落在 M2。M1 需要先交付 worktree、diff、Artifact 与人工合并评审，作为本章的地基（Evidence 实体从 M2 起）；M3/M4 只做团队化与自动化扩展。阅读时请特别注意：M0 仓库目前有 Task/Agent/Run 的基础模型、SQLite、HTTP/WS API、Mock Runtime、最小 Claude CLI adapter（注册但无结构化流式解析、无权限参数）、Vue 看板与 Wails 桌面壳；角色协作、依赖 DAG、契约、审批门、收件箱均未实现。文中标注 M1-M4 的内容都是计划，不是现状。

## 1. 目的与范围

### 1.1 目的

单个开发者用编码 Agent 完成一次任务已经足够快，真正的损耗发生在任务之间和角色之间：设计意图无法完整传给前端，API 契约靠口头约定，多个 Agent 并行后不知道谁先合并，Agent 报告「完成」但拿不出测试与构建证据，合并、部署这类高风险动作缺少明确的人工确认点。本章要解决以下问题：

- **交接失真**：上游角色的输出没有结构，下游角色只能重新猜测或反复追问。
- **职责漂移**：Agent 越界修改不属于自己的目录，或把设计、实现、部署混在一次 Run 里。
- **并行失控**：多个 Run 同时改同一批文件，合并顺序靠运气，冲突在最后才发现。
- **评审无依据**：评审者只能看一句 summary，看不到 diff、测试、构建和截图。
- **高风险动作失控**：合并、推送、部署没有强制的人工门禁，Agent 的「建议」被当成「执行」。
- **阻塞不可见**：Agent 卡住后没有升级路径，任务停在 in_progress 无人处理。
- **协作退化为聊天**：多个 Agent 在同一会话里互相对话，输出不可追踪、不可复现。

本章的产品主张是：角色 Agent 之间不进行自由聊天，而是通过任务 DAG 表达依赖，通过交付物契约表达接口，通过审批门控制风险，通过证据化 DoD 声明完成。

### 1.2 范围

本章覆盖以下能力：

- 四类内置角色模板（UI Design、Frontend、Backend、DevOps）及其实例化、职责、输入、输出、权限与 DoD。
- 五类交付物契约：design_spec、api_contract、build、test_report、deploy_plan，以及契约的版本、冻结、变更与失效规则。
- 任务依赖 DAG：finish_to_start 依赖、required_contracts/required_artifact_kinds 就绪条件、并行策略、合并顺序、冲突处理、父子任务语义。
- Crew/队长模式：队长拆解、成员执行、汇总、人工确认点、预算、死锁与父任务状态联动。
- 审批门：设计评审、API 契约评审、Crew 计划、合并、push、staging、prod、破坏性契约变更、越权命令、范围变更、破坏性操作。
- 证据化 DoD：各角色必交证据、证据校验、不可变性与保留策略。
- 收件箱、任务评论、通知、阻塞与升级。
- 同一任务内协作与跨任务协作的边界。
- M2 按 Runtime 能力分级的路径与命令权限执行，以及 M3 团队审批的身份扩展。

### 1.3 非目标

本章明确不做以下事情：

- 不做多个 Agent 自由聊天的群聊房间，不提供 Agent 之间的私聊通道。
- 不做自动合并、自动推送、自动生产部署；这些动作永远需要人工批准或人工执行。
- 不做 IM 机器人、移动端审批、邮件审批；通知渠道只做应用内（M2）与桌面通知/Webhook（M4）。
- 不做技能市场、Agent 商店或跨组织共享市场。
- 不在 M2 支持跨机器 Crew；远程 Runner 与机器注册属于 M3。
- 不在本章重新定义 Task、Agent、Run、Workspace 的基础生命周期，只定义协作层对其的扩展；基础模型见对应模块章节。
- 不在本章定义登录、多租户与计费；M3 的团队权限只描述对审批门的影响。
- 不追求覆盖所有研发流程；小任务允许走「单 Agent + 合并门」的轻量路径。

## 2. 当前实现基线（M0）

M0 的代码已经包含一些看起来与协作相关的字段，但它们只是预留，不具备协作语义。以下为仓库代码的实际情况：

| 能力 | M0 现状 | 与本章目标的差距 |
|---|---|---|
| Task.parentId | 数据库、Go 模型、API 与 TypeScript 类型均有该字段 | 看板与任务页未使用；没有子任务语义、没有依赖边 |
| Task.assigneeType | 枚举包含 human、agent、crew | 没有 Crew 实体、API 或 UI；crew 只是类型占位 |
| Agent.allowedPaths | 已持久化到 SQLite | 调度器与 workspace 均未强制；写入不受限 |
| Agent.allowedCommands | 已持久化到 SQLite | 未执行白名单；命令没有拦截或审批 |
| Agent.workspaceMode | 默认值为 worktree | workspace.Prepare 只按 Run 创建普通目录，不创建 git worktree |
| Run.branch / Run.worktree | 字段存在 | branch 从未赋值；worktree 指向每个 Run 的普通目录 |
| Scheduler | 内存队列加固定 worker，执行前只检查 Task 状态是否可执行 | 无依赖、契约、审批门、角色容量检查 |
| RunEvent | 有序事件日志，经 WebSocket 广播 | 可作为证据采集的原始来源，但尚无证据对象 |
| Runtime | 注册了 MockAdapter 与最小 ClaudeAdapter（`claude -p <prompt>` + cwd，逐行输出日志，无结构化流式解析、无权限参数） | 无能力声明、无权限模式、无命令审计 |
| 桌面壳 | Wails v3 壳可启动本地服务并打开原生窗口 | 未打包、未签名、无自动更新 |
| TaskView | 可选择 Agent 启动 Run、查看日志、取消、修改状态 | 无评审面板、无契约、无证据、无依赖 |
| AgentsView | 可创建和列出 Agent | 无角色模板、无角色字段、无 DoD 配置 |
| 评审 | 人工把 Task 状态改为 in_review 或 done | 没有正式评审记录、没有门禁、没有证据要求 |
| 收件箱/评论/通知 | 不存在 | 全部为 M2 计划 |

M0 的 runtime 注册表同时包含 mock 与 claude 两个 adapter，README 也写明 scaffold ships with both；claude adapter 只是最小实现，不能据此认为「已有真实 Claude Code 流式集成」。M1 必须补齐的地基包括：真实 git worktree、diff 生成、Run 产物与证据存储、人工 diff review 与合并，以及 Claude adapter 的权限参数与流式事件。没有这些，M2 的契约与门禁只能停留在表单层面。

## 3. 概念模型与协作原则

### 3.1 核心概念

| 概念 | 定义 |
|---|---|
| 角色 Agent（Role Agent） | 具有明确职责、输入、输出、权限和 DoD 的持久 Agent 配置，由角色模板实例化而来 |
| 交付物契约（Handoff Contract） | 上游角色提交、下游角色消费的结构化交付物，有类型、版本、状态和审批记录 |
| Artifact | 契约、diff、构建产物、截图、日志等可引用的文件或数据对象 |
| Evidence | 与 Run/Task 绑定、用于证明完成质量的证据记录，带来源、校验和与时间 |
| 审批门（Gate） | 对特定对象（契约、合并、部署、计划、越权命令）的人工批准请求与决定记录 |
| 任务 DAG | 由任务节点和有向依赖边组成的图，决定就绪、并行与合并顺序 |
| Crew | 由一个队长 Agent 和若干成员 Agent 组成的协作单元，围绕一个父任务工作 |
| Inbox | 所有需要人工处理的事项的统一入口 |
| Escalation | 阻塞或超时后，按层级把决定权交给队长或人工的机制 |

### 3.2 七条协作原则

1. **结构化交接优先于对话。** Agent 之间的信息通道是契约、任务状态、证据和结构化评论，不是自然语言聊天记录。
2. **契约先行。** 下游开始实现前，上游必须冻结契约；没有契约的交接视为无效交接。
3. **依赖显式化。** 任务之间的先后关系必须建成 finish_to_start 边；契约与证据条件挂在消费任务上，不能依赖「大家心里知道」。
4. **角色是模板，不是硬编码。** 四类角色是内置模板，用户可以复制、修改、派生自定义角色。
5. **高风险动作必须人工批准。** 合并、推送、staging 部署、prod 部署、删除分支/工作区、越权命令都不能由 Agent 自主执行。
6. **证据说话。** Run completed 不等于 Task done；Task 完成需要契约、证据和门禁共同满足。
7. **工作区隔离。** 每个 Run 使用独立 worktree；角色之间不共享未提交的工作区，也不共享会话上下文。

## 4. 角色与场景

### 4.1 角色 Agent 总览

| 角色 | 核心职责 | 主要输入 | 主要输出 | 禁止事项 |
|---|---|---|---|---|
| UI Design | 把产品意图转成可实现的设计规格 | Task 描述、现有设计系统、平台约束 | design_spec、状态清单、token、可访问性要求 | 修改业务源码、安装依赖、执行构建 |
| Frontend | 按设计规格与 API 契约实现界面 | design_spec、api_contract、现有组件 | 前端 diff、build、test_report、截图 | 修改后端、部署、push/merge |
| Backend | 按 API 契约实现接口与数据层 | api_contract、数据模型、错误码规范 | 后端 diff、migration、test_report、API 文档 | 修改前端、连接生产库、部署 |
| DevOps | 维护构建部署脚本并准备发布 | build、test_report、环境配置、变更清单 | build 证据、deploy_plan、staging 证据、回滚方案 | prod 执行、merge、push 主分支 |

### 4.2 UI Design Agent

**职责。** UI Design Agent 负责把 Task 中的产品意图转化为工程可实现的设计规格。它不直接修改业务代码，而是维护 design_spec 契约，回答下游在实现中提出的设计问题，并在设计变更时更新契约版本。

**输入。**

- Task 的标题、描述、验收标准与优先级。
- 现有设计系统、组件库、品牌约束与既有页面清单（只读）。
- 目标平台、响应式要求、可访问性基线。
- 用户或产品负责人在评论中给出的补充说明。

**输出（design_spec 契约）。**

- 页面/流程清单与导航关系。
- 每个界面的默认、空、加载、错误、禁用、权限不足状态。
- 组件清单、复用关系与新增组件说明。
- 布局、响应式断点与栅格规则。
- Design token：颜色、字号、行高、间距、圆角、阴影、层级，均需命名。
- 交互说明：触发条件、状态变化、动效时长与降级方案。
- 可访问性要求：对比度、焦点顺序、键盘操作、语义标签。
- 待决问题与假设列表；阻塞项必须显式标记。
- 可选的线框图或参考截图 Artifact。

**权限。**

- 仓库只读；写入仅限 design/ 或 Artifact 存储。
- 允许只读命令与图片处理命令；禁止安装依赖、修改源码、执行构建或部署脚本。
- 不持有任何部署凭据。

**DoD。**

- design_spec 通过 design_review 门并冻结。
- 所有界面状态齐全，没有「以后再补」的状态。
- token 命名唯一，前端可以直接引用。
- 待决问题中没有阻塞项，或已给出明确默认决策。
- 前端能够在不再追问的情况下完成实现。

### 4.3 Frontend Agent

**职责。** 按冻结的 design_spec 与 api_contract 实现界面，复用既有组件与样式体系，保证构建、类型检查、单测通过，并为变更界面提供截图证据。

**输入。** 冻结的 design_spec、冻结的 api_contract、仓库约定、现有组件与路由。

**输出。**

- 限定在前端路径内的代码 diff。
- build 证据：命令、退出码、产物位置与校验和。
- test_report：套件、通过/失败/跳过数量、失败用例。
- 关键状态截图：默认、空、加载、错误。
- 设计覆盖清单：design_spec 条目到实现位置的映射。
- 自评与已知偏差说明。

**权限。** 写入 apps/web/、packages/ui/ 等前端路径；允许 lint、test、build 命令；禁止修改后端目录、禁止部署、禁止 push 与 merge。

**DoD。**

- build、lint、类型检查、单测全部通过。
- 每个变更界面至少有一张截图，且状态命名与 design_spec 一致。
- 设计覆盖清单完整，没有未实现条目。
- diff 中没有越界文件。
- 与 design_spec 的偏差已记录并被人工接受。

### 4.4 Backend Agent

**职责。** 按冻结的 api_contract 实现接口、数据模型、数据库迁移与测试，保证错误码、鉴权与兼容性符合契约。

**输入。** 冻结的 api_contract、现有数据模型与迁移、错误码规范、性能与安全约束。

**输出。**

- 后端路径内的代码 diff。
- 数据库 migration 与回滚说明。
- test_report：单测与集成测试的命令、退出码、通过/失败数量。
- API 文档或契约示例更新。
- 兼容性说明：是否破坏既有字段、行为或错误码。

**权限。** 写入 internal/、migrations/、API 文档等后端路径；允许在本地/开发环境运行迁移与测试；禁止修改前端、禁止连接生产数据库、禁止部署。

**DoD。**

- api_contract 中每个 endpoint 均有实现与对应测试。
- 错误码、请求/响应字段与契约一致。
- migration 可回滚，或明确说明不可逆原因与备份要求。
- 单测与集成测试通过。
- 破坏性变更已走 contract_break 门。

### 4.5 DevOps Agent

**职责。** 维护构建与部署脚本，产出 build 与 deploy_plan 契约，在获得批准后执行 staging 部署与冒烟测试，准备并演练回滚方案。M2 中 DevOps Agent 不接触生产环境。

**输入。** build 证据、test_report、环境配置、变更清单、deploy_plan 模板、回滚要求。

**输出。**

- build 证据：可复现命令、退出码、产物位置与校验和。
- deploy_plan 契约：目标环境、步骤、审批要求、回滚步骤、冒烟检查、风险说明。
- staging 部署日志、健康检查结果与冒烟测试结果。
- 回滚演练记录。
- prod 部署计划与建议执行人，但不执行。

**权限。** 可写 CI 配置、部署脚本与 infrastructure 目录；持有 staging 凭据；M2 不持有 prod 凭据；禁止 merge、禁止 push 主分支、禁止执行 prod 部署。

**DoD。**

- build 可在干净环境复现。
- staging 冒烟检查全部通过。
- 回滚步骤在 staging 演练过并有记录。
- deploy_plan 通过校验并 frozen；staging 门批准后执行 staging 并留存证据。
- prod 计划的执行人、时间窗与回滚责任明确，等待人工执行。

### 4.6 角色模板与实例化

M2 内置四个角色模板。模板包含：名称、role 标识、模板版本号、职责说明、默认 instructions、默认 Runtime、默认 allowedPaths、默认 allowedCommands、artifactWriteScope、必交契约类型、DoD 清单、默认审批门。用户从模板创建 Agent 时，系统复制模板内容生成独立配置，并把模板版本与完整内容快照写入 Agent（`role_template_version`、`template_snapshot`）；后续模板升级不回溯修改已实例化的 Agent，用户可手动升级并查看两版差异。模板只能归档，不能删除仍被 Agent 引用的模板。模板版本不可就地修改，修订必须发布新版本。

| 角色 | role 值 | 默认 allowedPaths | artifactWriteScope | 默认 allowedCommands | 必交契约/证据 |
|---|---|---|---|---|---|
| UI Design | ui_design | design/、design-assets/ | task（仅 Artifact 存储） | 只读查看、图片处理白名单 | design_spec、状态清单、token 表 |
| Frontend | frontend | apps/web/、packages/ui/ | task | lint、test、typecheck、build | build、test_report、截图、覆盖清单 |
| Backend | backend | internal/、migrations/、API 文档 | task | build、test、migrate（本地） | test_report、migration 说明、API 文档 |
| DevOps | devops | .github/、scripts/deploy/、infra/ | task | build、deploy staging、smoke | build、deploy_plan、staging 证据、回滚演练 |

Artifact 不属于仓库路径，不能写进 allowedPaths；Agent 需要产出截图、报告等文件时，由系统管理的 Artifact 存储承接，写入范围由 `artifactWriteScope` 与单文件/单 Run 配额约束。

用户可创建 role 为 custom 的 Agent，自定义职责与权限，但 custom 角色不自动获得任何默认门禁豁免；涉及合并与部署时仍走通用门禁。

### 4.7 典型场景

**场景 A：设计先行的新功能。** 父任务包含设置页改版。UI Design 先产出 design_spec，经 design_review 冻结；Frontend 与 Backend 分别依赖 design_spec 与 api_contract 并行执行；最后进入合并门与 staging 计划。UI Design 不参与代码合并。

**场景 B：API 契约先行的前后端并行。** Backend 先提交 api_contract，经 api_contract_review 冻结；Frontend 依据契约并行开发并使用 mock 数据；Backend 按契约实现。两边完成后分别提交证据，合并顺序由 DAG 与契约冻结顺序建议，人工确认。

**场景 C：跨栈缺陷修复。** 一个登录重定向缺陷同时涉及前端路由与后端回调。任务拆为 Backend 子任务与 Frontend 子任务，二者共享同一 api_contract 版本；合并时若触及共享类型文件，触发 pre-merge 冲突检测。

**场景 D：发布准备。** DevOps 生成 build 与 deploy_plan；staging 门批准后执行 staging 部署与冒烟；prod 只输出计划与回滚方案，由人工执行并把结果记录回 Task。

## 5. 交付物契约（Handoff Contract）

### 5.1 契约生命周期

契约状态为：draft（编辑中）、proposed（待评审）、frozen（已冻结，可供消费）、superseded（被新版本替代）、withdrawn（生产者撤回）。只有 frozen 状态的契约才能满足下游任务的引用条件。冻结路径分两类：

- **评审型契约**（design_spec、api_contract）：冻结前必须经过对应审批门，design_spec 走 design_review，api_contract 走 api_contract_review。
- **校验型契约**（build、test_report、deploy_plan）：M2 不设独立评审门，生产者提交后通过必填字段与证据绑定校验（payload 引用的 evidence ID 存在、校验和一致、命令可在 command_log 中复核）即自动 frozen，并记录 `validatedAt`、`validatedBy=system` 与绑定证据 ID；校验失败保持 draft 并返回字段级错误。deploy_plan 冻结只代表计划完整，不代表获准执行，staging 执行仍需 staging 门。

状态转换规则：

| 当前状态 | 事件 | 目标状态 | 说明 |
|---|---|---|---|
| draft | 提交评审（评审型） | proposed | 必填字段校验通过才允许提交 |
| draft | 提交校验（校验型） | frozen | 校验通过，记录 validatedAt 与证据绑定；失败保持 draft |
| proposed | 审批通过 | frozen | 记录审批人、时间、证据快照 ID 与内容哈希 |
| proposed | 审批拒绝 | draft | 必须填写拒绝原因 |
| proposed | 生产者撤回 | draft 或 withdrawn | 未交付消费者前可回到 draft |
| frozen | 生产者创建修订版本 | 旧版本保持 frozen，新版本为 draft | 旧版本继续有效，服务只设置 `revisionInProgress=true`，不改变任何下游可消费状态 |
| draft（新版本） | 新版本冻结 | 新版本 frozen，旧版本 superseded | 两者在同一事务内原子完成；已 pin 旧版本的消费者继续读取旧版本，直到显式升级 |
| draft（新版本） | 新版本被拒绝或撤回 | 旧版本保持 frozen | 修订失败不影响现有消费，清除 revisionInProgress |
| frozen | 生产者撤回 | withdrawn | 已有消费者时需 scope_change 门；已 pin 的消费者仍可读取该版本 |
| superseded / withdrawn | 查看 | 只读 | 不可再被新任务引用 |

这里的关键修正是：修订不会提前撤销旧版本的 frozen 状态。只有新版本成功冻结的那一刻，旧版本才原子地转为 superseded；修订草稿失败、被拒或撤回都不会让下游失去依赖条件。这与 5.4 的「消费者固定版本、新版本只提示」一致。

### 5.2 通用字段

所有契约共享以下字段：id、type、version、taskId、producerAgentId、consumerRoles、payload、requiredEvidence、baseCommit、status、createdAt、validatedAt、frozenAt、approvedBy、contentHash、revisionInProgress、supersedesId。payload 按类型校验；contentHash 是规范化 payload 的哈希，供门禁与依赖引用绑定；baseCommit 记录生产时的代码基线，用于过期提示。

### 5.3 五类契约定义

**design_spec。** 生产者 UI Design，消费者 Frontend 与人工评审者。必填：页面/流程清单、界面状态矩阵、组件清单、token 表、交互说明、可访问性要求、待决问题。冻结门为 design_review。

**api_contract。** 生产者 Backend，消费者 Frontend、DevOps 与人工评审者。必填：endpoint 列表（方法、路径、请求 schema、响应 schema、错误码）、鉴权要求、版本策略、示例、兼容性说明。冻结门为 api_contract_review。M2 采用结构化 JSON 校验，不要求完整 OpenAPI。

**build。** 生产者 Frontend、Backend 或 DevOps，消费者合并门与 staging 门。必填：commit、构建命令、退出码、产物位置、校验和、环境、耗时。build 必须引用实际 Run 产生的 evidence ID，不能由 Agent 口述；契约 payload 只保存声明与引用，不重复保存产物。

**test_report。** 生产者 Frontend 或 Backend，消费者合并门与人工评审者。必填：测试命令、退出码、套件数量、通过/失败/跳过数量、失败用例列表、环境、evidence ID。没有退出码的报告视为不完整。

**deploy_plan。** 生产者 DevOps，消费者 staging 门与人工执行者。必填：目标环境、步骤序列、所需审批、回滚步骤、冒烟检查、时间窗、风险说明、执行人。prod 计划必须单独标注，不能与 staging 计划混为一谈。

三类校验型契约为 frozen 的条件是「字段完整 + 引用的 evidence 存在且校验和一致」，不经人工门。这样 build 契约可以真正满足下游 `required_contracts`，不会出现「契约永远冻结不了、DAG 永远不可执行」的死结。

**契约与证据的分工。** Contract 是交付声明与接口，payload 通过 evidence ID 或校验和引用证据；build、test_report 同时是证据类型，由契约绑定，而不是两个各自独立的实体。证据内容只存一份（见 9.1），契约不复制证据正文，避免双重记账和审批依据不一致。design_spec、api_contract、deploy_plan 的正文属于契约 payload，其结构化 JSON 快照可另存为 `contract_snapshot` 证据供门禁引用。

### 5.4 冻结、变更与过期

- 冻结操作幂等：重复冻结返回同一结果，不重复创建审批记录。
- 已冻结契约的任何修改都必须创建新版本，不允许原地编辑。
- 破坏性变更（删除字段、改变类型、改变错误码语义、改变鉴权要求）需要 contract_break 门，并附影响分析与迁移方案。
- 版本解析统一为「默认 exact pin」：`required_contracts` 记录 `required_version`（精确版本），消费者固定该版本，不自动跟随新版本；生产者发布新版本后，系统通知消费者并标记「有新版本可用」。只有消费者显式开启 `allow_newer` 并声明 `min_version` 时，系统才接受 `>= min_version` 的 frozen 版本，并把解析结果（实际解析到的版本）写入 readiness 与审计。task-management.md、API 契约与 US-COLLAB-09 使用同一组字段名：`required_version` 为必填精确版本，`min_version` 为可选下界且仅当 `allow_newer=true` 时生效，`allow_newer` 默认 false。示例：X 引用 v2 时，v3 不满足；只有开启 allow_newer 且 v3 ≥ min_version 时才提示可升级，升级仍需确认并重新计算依赖。
- 当消费者的 worktree 基线 commit 与契约 baseCommit 之间的变更触及契约引用文件时，系统在整个任务上标记「契约可能过期」，但不自动阻断；启动 Run 前提示人工确认。
- 契约历史不可删除；被替代版本保留只读副本。

### 5.5 M1 与 M2 的边界

M1 只要求 Artifact 能随 Run 保存，diff、测试输出与截图可以作为附件进入人工评审；Evidence 实体从 M2 起交付。M2 才引入契约实体、状态机、冻结审批和 required_contracts 依赖。这样拆分的原因是：契约的价值依赖稳定的 worktree 与证据链，否则只是多了一张表单。

### 5.6 消费者反馈与协商变更

契约不是生产者的单向公告，下游必须能表达「这份契约无法实现」。M2 提供最小协商回路：

- 消费者可以提交 consumer_feedback（结构化：问题类型、期望变更、影响范围、阻塞程度），它是一条 decision 类型的任务评论并引用契约 ID，不直接修改契约。
- 生产者收到后三选一：澄清（评论回复）、创建修订版本、拒绝并说明理由。
- 修订走 5.1 的版本流程；破坏性变更仍走 contract_break 门。新版本冻结前，旧版本继续有效。
- 消费者拒绝契约（rejected_by_consumer）不改变契约状态，只让消费者任务保持 blocked 并给出 `contract_rejected` 原因，防止生产者单方面推进。
- 协商过程不进入 Agent 会话上下文，除非被显式装配（见 10.6）。

## 6. 任务 DAG 与并行协作

### 6.1 节点、边与语义

DAG 的节点是 Task（包括 Crew 产生的子任务），边表示依赖。M2 的依赖边只有一种：

| 依赖形式 | 满足条件 | 典型用途 | 里程碑 |
|---|---|---|---|
| finish_to_start 边 | 上游 Task 状态为 done | 普通先后关系 | M2 |
| required_contracts（任务属性，不是边） | 引用的契约状态为 frozen，且版本按 5.4 的规则解析成功 | 设计交付、API 契约交付、build/test_report 交付 | M2 |
| required_artifact_kinds（任务属性，不是边） | 上游存在指定类型的 Artifact/Evidence | 要求上游已产出构建或测试证据 | M2 |
| artifact_ready 独立边 | — | 评估后未采用 | P2 后评估 |
| approval 独立边 | — | 评估后未采用 | P2 后评估 |

这里采用 task-management.md §9.1、02-domain-model.md 与 milestones/M2-role-agents.md §7.2 的结论：M2 不支持其他依赖边类型，也不在 M2 悄悄扩展 DAG 语义。契约就绪与证据就绪通过任务属性表达，调度器在就绪判定时统一检查，不在图里增加新边。本章旧稿中的 artifact_ready 与 approval 两类边降级为未来候选，若将来引入，必须先更新 task-management、02-domain-model、api-and-data 与验收文档，再实现。

依赖不传递上下文：B 依赖 A 只代表 A 的完成条件满足，不自动把 A 的评论、Run 日志或未提交代码暴露给 B。

**上游闭包校验。** 创建 required_contracts 或 required_artifact_kinds 时，契约或证据的生产任务必须位于当前任务的上游闭包内（或是其直接上游）。若生产任务就是当前任务或位于当前任务下游，保存被拒绝并返回 `contract_upstream_violation`。这条校验用于阻止「Task B 要求一份只有 B 完成后才可能产生的契约」这种 Task→Contract→Task 的不可调度死锁；Crew 内的计划提交也要做同样校验。

### 6.2 就绪判定

调度器在将 Run 入队前必须执行统一的就绪检查，缺一不可：

1. Task 状态为 todo 或 in_progress：todo 用于首次启动，in_progress 用于已启动后的重跑。M1 不允许从 in_review 创建 Run；M2 的返工必须先创建新 Review 或记录「取代旧评审」的原因，原 Review 置为 superseded，任务回到 in_progress 后再启动。这与 02-domain-model.md §4.2/§4.4、M1-local-loop 与 api-and-data.md 的 `POST /api/v1/tasks/{id}/runs` 一致；backlog、in_review（M1）、done、blocked、cancelled 不可执行。
2. 所有 finish_to_start 依赖的上游 Task 为 done。
3. 所有 required_contracts 引用已 frozen，且版本解析成功（默认 exact pin；开启 allow_newer 时按 min_version 解析并记录解析结果）。
4. 所有 required_artifact_kinds 在上游存在对应 Artifact/Evidence，且证据未被标记 invalid。
5. 任务没有处于 pending 状态的阻塞性门（例如同一 Run 的 merge 审批未决时不允许重复启动同用途 Run）。
6. Crew 子任务所属 Crew 处于 executing 状态且计划已批准。

以上六项决定「能否入队」。任一不可恢复条件不满足时，Run 不得入队，API 返回结构化原因码，例如 dependency_unfinished、contract_not_frozen、contract_version_unresolved、artifact_missing、approval_pending、crew_not_started，并附具体对象 ID 与名称。UI 的 Run 按钮置灰并展示原因，而不是点击后才失败。

**容量不是入队条件。** 绑定 Agent 的并发容量、全局 worker 空位属于瞬时资源状态，不列入就绪判定。就绪的 Run 一律进入 queued，由调度器按容量取走；容量不足时 Run 保持 queued 并记录排队原因（agent_capacity_exceeded、global_capacity_exceeded），进入收件箱提示，而不是拒绝入队或直接失败。只有不可恢复条件才在入队前拒绝；6.3 与第 15 章使用同一错误码和状态。M2-role-agents.md §8.2 中把容量列为第 6 项就绪检查的写法需要按本节回写为「排队原因」。

### 6.3 并行与容量

- 无依赖关系的任务可以在容量允许时并行执行。
- 全局并发由 Scheduler 的 worker 数控制；单 Agent 并发由 Agent.maxConcurrency 控制；任务级并发由 `Task.parallelRunPolicy` 控制：`single`（默认）同一时间最多一个活动 Run；`multiple` 允许同一 Task 并行多个 Run，各自独立 worktree 与分支，评审与合并以 Run 为单位。实际可同时运行的 Run 数必须同时满足这三层限制。
- M1-M2 的默认值为 single，用户可以在任务设置中显式改为 multiple，UI 必须提示「同一任务会产生多个分支与证据，合并需逐个进行」。
- Crew 子任务是独立 Task，不共享父任务的 parallelRunPolicy；父任务本身不会因为 Crew 成员并行而被判定为多 Run。这样 Crew 的子任务可以并行，而不违反父任务的 single 约束。
- 并行不改变工作区隔离：每个 Run 使用独立 worktree，互不可见未提交修改。
- 重跑遵循同样的策略：single 时重跑必须等前一个 Run 结束或被取消；multiple 时允许并存，但 UI 需标示最新 Run。
- 平台资源不足时，Run 保持 queued 并进入收件箱提示，而不是直接失败（见 6.2 的容量说明）。

本节的 parallelRunPolicy 是唯一权威表述；task-management.md §5.3 R8、runtime-and-workspace.md §13.3、api-and-data.md 的并发规则与 UI 提示都引用本节，不再各自定义。

### 6.4 合并顺序与冲突处理

- 合并队列按 DAG 拓扑序生成建议顺序；同一层级内按契约冻结时间排序；用户可调整顺序，但必须记录调整原因。
- 合并队列对同一仓库单飞执行：前一个合并完成或失败后，才处理下一个，避免互相污染。
- 每次合并前执行 pre-merge 冲突检测（dry-run merge）。检测到冲突时阻止合并，创建集成任务，附冲突文件清单、双方分支、冲突片段证据。
- 集成任务由人工指定角色 Agent 处理，处理完成后重新进入合并队列。
- 合并后必须重新运行受影响测试；测试失败则回滚合并并保留证据。
- 合并目标是项目配置的默认 base branch；用户可以在合并前选择其他目标分支，但切换目标会改变审批绑定，必须重新审批。受保护分支（main、master、release/* 等，由项目配置）只能通过 merge 门进入，禁止直接推送（见 8.3 与 runtime-and-workspace.md RUN-049）。
- 审批后目标分支出现新提交时，pre-merge 校验会失败，原 merge 审批按 8.2 置为 expired，必须重新审批，防止把旧批准用于已变化的基线。
- 合并本身是审批门动作，顺序建议不等于自动执行。

### 6.5 同一任务内协作与跨任务协作

| 维度 | 同一任务内协作 | 跨任务协作 |
|---|---|---|
| 共享 Task | 是，父任务或 Crew 父任务 | 否，各自独立 Task |
| 共享 DAG | 是，子任务在同一张图内 | 仅通过显式依赖边连接 |
| 契约 | 任务内契约，消费者直接引用 | 必须显式引用契约版本，不自动继承 |
| 工作区 | 每个 Run 独立 worktree | 同样是独立 worktree，且不允许跨任务写入 |
| 对话 | 同一 Task 时间线 | 不共享评论与 Run 日志 |
| 证据 | 引用聚合：父任务维护 evidence index，引用子任务证据 ID，不复制内容 | 只引用，不复制 |
| 审批 | 不共享门禁对象；子任务各自持有所需门禁，父任务完成条件检查「所有成员任务的必需门禁均已通过」；合并按 Run 单独请求 | 各自独立门禁 |
| 上下文 | Crew 计划、契约、结构化评论 | 仅契约摘要与链接 |

三条硬性规则：

1. parentId 表示层级归属，不产生依赖；依赖必须显式创建。
2. 跨任务读取受权限信封与隔离等级约束。Go core 与 API 禁止读取其他 Task 的评论、Run 事件与未授权契约草稿，并记录访问拒绝；但 M2 默认只有目录级隔离，Agent 进程以当前用户身份运行，系统不承诺 OS 级文件系统沙箱（见 16.1 与 security-and-permissions.md 第 2 章）。Runtime 支持路径/命令策略时按能力强制，否则降级为运行后审计与 UI 隔离等级提示。
3. M2 的跨任务依赖限定在同一仓库/同一 workspace root 内；跨仓库依赖已决定不在 M2 支持，留待 M3 评估（见 6.5 与 COLLAB-028），不再是待确认项。

### 6.6 DAG 示例

```text
需求任务（人工）
  ├── design_spec（UI Design）── design_review 门 ──┐
  ├── api_contract（Backend）── api_contract_review 门 ─┤
  ├── frontend 子任务（依赖 design_spec + api_contract）─┤
  ├── backend 子任务（依赖 api_contract）───────────────┤
  └── 集成合并任务（依赖 frontend + backend）────────────┘
        └── deploy_plan（DevOps）── staging 门 ── staging 执行
```

图中的门禁只表示契约冻结或部署执行所需的审批动作，不是 DAG 节点；M2 的 DAG 节点只有 Task，依赖边只有 finish_to_start，契约与证据条件挂在消费任务上。

## 7. Crew 与队长模式（M2）

### 7.1 定义与适用条件

Crew 是由一个队长 Agent 和若干成员 Agent 组成的协作单元，围绕一个父任务工作。Crew 适用于需要 3 个以上角色、存在明确上下游交接、且用户可以承担一次计划审批的场景。只有 1 到 2 个子任务、或没有契约交接的任务，应直接使用并行任务，不创建 Crew。

Crew 是编排层，不改变 Run 的执行模型：每个成员的每次执行仍然是一个普通 Run，拥有独立 workspace、事件流、证据和审批记录。

**里程碑优先级说明**：本章 COLLAB-030～039（Crew 簇）在模块内标为 P0，表示产品价值与完整性要求；首次交付里程碑以 `M2-role-agents.md` 为准——Crew 属 M2.2 P1 可选范围，不进入 M2.1 退出标准。模块优先级与里程碑优先级分离，不得据此把 Crew 提前列入 M2.1 必交付。

### 7.2 生命周期与状态机

Crew 状态为：draft、planning、plan_review、executing、aggregating、review、done、paused、blocked、cancelled。

| 状态 | 进入条件 | 允许动作 |
|---|---|---|
| draft | 创建 Crew | 编辑成员、指派队长 |
| planning | 启动规划 | 队长产出计划，不可执行成员 Run |
| plan_review | 计划提交 | 等待 crew_plan 门决定 |
| executing | 计划批准 | 成员按 DAG 执行 |
| aggregating | 所有子任务完成 | 队长汇总证据与变更 |
| review | 汇总提交 | 人工评审与合并门 |
| done | 合并与验收完成 | 只读 |
| paused | 人工暂停或预算触发 | 恢复或取消 |
| blocked | 死锁或关键失败 | 人工介入 |
| cancelled | 人工取消 | 只读 |

#### 7.2.1 Crew 状态与父 Task 状态联动

Crew 状态不自动等于父 Task 状态，两者通过下表联动；触发者与验收标准一并给出，避免出现「Crew 已完成但父任务仍 in_progress」或「Crew 取消后父任务卡死」：

| Crew 状态 | 父 Task 状态 | 触发者 | 进入/退出条件与验收 |
|---|---|---|---|
| draft | backlog 或 todo | 人工 | 创建 Crew 不改变父任务状态；父任务可独立存在 |
| planning | in_progress | 人工启动规划 | 队长 Run 启动即置 in_progress；规划期间不派发成员 Run |
| plan_review | in_progress；等待超过提醒阈值转 blocked | 系统 | 计划提交后父任务保持 in_progress；超过 crew_plan 提醒阈值未决定，父任务转 blocked 并进收件箱 |
| executing | in_progress | 系统（计划批准后） | 父任务保持 in_progress；成员 Run 完成不改变父任务状态 |
| aggregating | in_review | 系统 | 全部子任务 done 后队长开始汇总，父任务转 in_review |
| review | in_review | 系统 | 等待 merge 门与人工验收；父任务不得进入 done |
| done | 不自动迁移；父任务按自身门禁与人工确认进入 done | 人工 | Crew done 只表示 Crew 编排完成，父 Task 仍需父级必需门禁与人工最终确认 |
| paused | 保持暂停前状态 | 人工或预算触发 | 暂停只阻止新派发，不回退父任务状态；恢复后回到暂停前状态 |
| blocked | blocked | 系统或人工 | 死锁、队长失败、预算耗尽；解除后回到 in_progress 或 todo（人工确认） |
| cancelled | 人工选择 todo 或 in_progress | 人工 | 取消 Crew 不回滚已完成子任务；父任务状态由人工确认，系统不自动迁移；已完成证据保留 |

另外两条规则：Crew 的「done 即完成」不成立，父任务完成必须另行满足 9.4；Crew 取消时必须停止派发新成员 Run，已在途 Run 由人工决定继续或取消，其证据无论结果都保留。

### 7.3 队长职责与限制

队长负责：读取父任务与约束；把工作拆解为带角色的子任务；为子任务建立依赖与 required_contracts；给出验收标准与预算；在计划批准后分派成员；监控执行与阻塞；在全部子任务完成后汇总 diff、证据与风险；请求合并评审。

队长的限制是硬性的：

- 不能批准任何审批门，包括自己产出的计划。
- 不能修改已批准计划的范围；范围变化必须走 scope_change 门。
- 不能代替成员提交证据，也不能编辑成员 Run 的证据。
- 不能绕过 DAG 直接启动未就绪的子任务。
- 不能执行合并、推送或部署。
- 不能无限重试；预算耗尽必须暂停并升级。

### 7.4 成员职责

成员按分配到的子任务执行：读取自己的输入契约与 Task 上下文；在 allowedPaths 内修改代码；运行允许的命令；提交契约、diff、测试、构建与截图证据；报告 blocker 与下一步。成员之间不直接对话；需要协调时，通过父任务时间线的结构化评论或队长分派的新子任务表达。

成员增删与 Agent 失效的处理规则：

- 计划批准前可以自由增删成员；计划批准后增删成员属于范围变更，必须走 scope_change 门。
- 成员 Agent 被禁用或删除时，其未开始的子任务退回 todo 并等待改派；在途 Run 按 Run 生命周期继续或取消，已完成证据保留且不可篡改。
- 改派只影响后续 Run，不重写历史 Run 的 Agent 快照；新 Run 记录新的 Agent 与模板版本。

### 7.5 人工确认点

Crew 至少有三个不可跳过的人工确认点：

1. **计划确认（crew_plan 门）。** 批准子任务拆分、角色分配、依赖、契约清单、预算与验收标准。
2. **合并确认（merge 门）。** 对每个需要进入目标分支的 Run 逐一批准，附 diff、测试、构建与评审清单。
3. **发布确认（staging/prod 门）。** staging 由人工批准后由 DevOps 执行；prod 由人工执行，系统只记录。

设计评审与 API 契约评审可以作为计划内的前置门，也可以由队长在计划中声明为必需门；无论哪种方式，都不能由产出者自审。

### 7.6 预算、死锁与失败处理

- Crew 可设置最大 Run 数、最大总时长、最大重试次数；默认值在 M2 内测后校准。
- 超过预算时 Crew 自动进入 paused，创建高优先级收件箱条目，保留全部证据。
- 死锁检测：所有剩余子任务均处于 blocked 或未就绪，且没有活动 Run 时，Crew 进入 blocked，通知人工。检测范围包含契约与证据的生产方：如果某个子任务的 required_contracts 由 Crew 之外尚未创建或位于当前子任务下游的任务生产，直接判定为死锁，错误码 `contract_producer_missing` 或 `contract_upstream_violation`，而不是等到永远不满足。
- 计划提交时必须对子任务 DAG 与契约引用做一次环检测；Crew 运行期间新增依赖或契约引用时再次校验，防止运行中引入 Task→Contract→Task 环。
- 队长 Run 失败时，Crew 进入 blocked；已完成的成员 Run 保留，人工可替换队长或转人工编排。
- 成员 Run 失败时，按任务重试策略处理；连续失败达到上限后升级给队长，再由队长升级给人工。

### 7.7 与普通并行任务的关系

产品路线是先做「并行任务」，再做 Crew。M2 内也可以按以下顺序交付：任务 DAG 与契约 → 审批门与证据 → 角色模板 → 并行调度 → Crew → 收件箱。Crew 不应成为使用 ATeam 的前提；不用 Crew 的用户仍然可以通过手工建子任务和依赖获得大部分协作能力。

## 8. 审批门（Approval Gates）

### 8.1 门禁类型总表

| 类型 | 触发对象 | 必需证据 | M2 本地审批人 | M3 团队审批人 | 有效期与提醒 |
|---|---|---|---|---|---|
| design_review | design_spec 冻结 | 契约全文、状态清单、token 表 | 本地用户 | workspace_admin；被指派的 Reviewer | 24h 提醒、72h 升级 |
| api_contract_review | api_contract 冻结 | 契约、示例、错误码 | 本地用户 | workspace_admin；被指派的 Reviewer | 24h/72h |
| crew_plan | Crew 计划 | 子任务 DAG、角色、契约清单、预算 | 本地用户 | workspace_admin 及以上 | 12h/48h |
| merge | 合并 Run 分支 | diff、test_report、build、评审清单 | 本地用户 | workspace_admin 或 Reviewer | 24h 有效期、24h 提醒、72h 升级 |
| push | 推送远端分支 | 目标远端、分支、commit、diff 摘要 | 本地用户 | workspace_admin 或 Reviewer | 72h 有效期、24h/72h 提醒 |
| staging | 部署 staging | deploy_plan、build、test_report | 本地用户 | workspace_admin 及以上 | 4h 有效期、提醒可配置 |
| prod | 生产部署 | deploy_plan、staging 证据、回滚方案 | 人工执行，系统记录 | Owner 或 Admin | 30min 有效期，不自动升级 |
| contract_break | 破坏性契约变更 | 影响分析、迁移方案 | 本地用户 | Owner 或 Admin | 24h/72h |
| high_risk_command | 越权命令 | 命令、目的、影响范围 | 本地用户 | workspace_admin 及以上 | 单次许可、15min 有效期、15min/1h |
| destructive_operation | 删除分支/Workspace、清理有历史的资源 | 资源快照、未提交修改清单、影响范围 | 本地用户 | Owner/Admin；本人创建的资源可由 workspace_admin 审批 | 1h 有效期、1h/4h |
| scope_change | 计划外范围 | 变更说明、影响评估 | 本地用户 | workspace_admin 及以上 | 24h/72h |

表中不再出现「单独 push 门」「破坏性操作确认」这类未登记的类型：推送对应 push，删除分支/工作区对应 destructive_operation，安装依赖与读取密钥对应 high_risk_command。所有门禁类型必须在 8.1 登记后才能被 8.3 与 UI 引用。

审批有效期与 security-and-permissions.md §5.3 对齐：merge 24 小时、staging 4 小时、prod 30 分钟且必须过期；其他类型默认 72 小时有效期（含 push 与 destructive_operation），crew_plan 为 12h 提醒、48h 升级、72h 有效期；可按类型配置但不得无限延长。prod 审批按时过期，不以「不自动过期」例外。

### 8.2 状态机与规则

门禁在数据上对应 api-and-data.md 的 approvals 实体。本章的 Gate 是它的业务视图：`type` 对应 `actionType`，`subject_type/subject_id` 对应资源类型与 ID。状态以领域模型 §4.6 为准：pending、approved、rejected、expired、cancelled、consumed；`requested` 是 `pending` 的输入别名，`revoked` 是 `cancelled` 的输入别名，stale 不是门禁状态。

**内容绑定。** 每个门禁在创建时计算并保存 `subjectRevision`（被批准对象的修订号：merge 为 head commit SHA，契约类为版本号，部署类为 deploy_plan 版本）、`contentHash` 与 `paramsHash`：

- merge/push：绑定 Run 分支的 head commit SHA 与 diff 哈希；
- 契约类：绑定契约版本的 contentHash；
- 部署类：绑定 deploy_plan 的规范化哈希；
- 命令类：绑定 argv、工作目录与一次性许可哈希；
- 删除类：绑定资源快照哈希。

规则：

- 产出该对象的 Agent 不能作为审批人；人类审批人不受此限制。M2 单用户下本地用户批准自己的请求时，UI 必须显示「你正在批准自己的操作」并要求显式勾选确认。
- 审批人必须打开证据清单并逐项确认；UI 不提供未经查看的一键批准。pending 时冻结证据快照（approval_evidence_snapshots：证据 ID、校验和、快照哈希、冻结时间），决定只能基于该快照，后续新增证据不改变已作出的决定。
- 拒绝必须填写原因；原因会回到任务时间线并通知请求者。
- 审批被消费后不可复用：动作执行时状态从 approved 转为 consumed，记录 consumedAt、consumedBy 与执行结果；重复调用返回 409 APPROVAL_CONSUMED。
- **内容变化即失效**：分支新增提交、契约版本变化、deploy_plan 修改、命令参数变化都会使对应审批自动转为 expired；必须重新请求，不能在旧审批上继续执行。
- 请求者或 Admin 可以在执行前撤销，状态转 `cancelled`（`revoked` 仅作输入别名）；已消费的审批不可撤销，只能走回滚流程。
- 同一门禁对象连续被拒绝 3 次后，禁止自动再次请求并创建 escalation 收件箱条目；M2 单用户模式没有更高的另一审批人，改为强制人工复核并填写复核结论（继续、改范围、取消），复核结论进入时间线与审计。
- 门禁过期后对象回到待处理状态，任务标记 blocked 或 in_review，不得静默继续；过期由后台任务标记得出，不静默删除。
- merge、push、prod、contract_break、destructive_operation 不允许批量审批；design_review 与 api_contract_review 在同一任务内可以一次打开多个契约，但每个契约仍需单独决定。
- 所有决定记录请求人、审批人、时间、理由、证据快照 ID 与 contentHash；审批通过不等于自动执行，执行动作由受控执行器在重新校验指纹后完成。

### 8.3 高风险动作清单

| 动作 | 所需门禁 | 触发对象 | 必需证据 | 审批人与时限 | M2 允许执行者 |
|---|---|---|---|---|---|
| 合并分支 | merge | Run 分支 head commit 与目标分支 | diff、test_report、build、评审清单 | workspace_admin/Reviewer；24h 有效，24h/72h 提醒 | 人工批准后由受控执行器执行 |
| push 到远端 | push | 远端、分支、commit | commit、diff 摘要、目标远端 | workspace_admin/Reviewer；72h 有效 | M2.1 只创建/消费审批记录，不执行远程 push；M3 由受控执行器执行 |
| 部署 staging | staging | deploy_plan 与目标环境 | deploy_plan、build、test_report | workspace_admin 及以上；4h 有效 | DevOps Agent（批准后） |
| 部署 prod | prod | prod deploy_plan | deploy_plan、staging 证据、回滚方案 | Owner/Admin；30min 有效 | 人工执行，系统只记录 |
| 删除分支 | destructive_operation | 分支名与 head commit | 未合并提交清单、分支快照 | Owner/Admin；本人资源可由 workspace_admin 审批；1h 有效 | 人工 |
| 删除 Workspace | destructive_operation | Workspace 路径与 Run | 未提交修改清单、证据索引 | 同上；存在未提交修改时额外确认 | 人工 |
| 安装/升级依赖 | high_risk_command | 包名、版本、命令 | 供应链影响说明、锁文件变化 | workspace_admin 及以上；单次许可 15min | 批准后 Agent 可执行 |
| 读取密钥/环境变量 | high_risk_command | 变量名（脱敏）、用途 | 用途说明、脱敏承诺 | workspace_admin 及以上；单次许可 15min | 批准后受控读取，禁止写入日志 |
| 强制推送 | high_risk_command | 远端分支与提交范围 | 覆盖影响分析 | Owner/Admin；M2 不提供 Agent 入口 | 人工执行 |

8.3 引用的每一种门禁都必须在 8.1 中登记；新增高风险动作时先登记类型，再补触发对象、证据、审批人、时限与是否允许批量，不允许在清单里引用未定义的门禁。

### 8.4 拒绝、重试与升级

拒绝后任务回到 in_progress，并附带拒绝原因；请求者可以修改后重新提交。重新提交会创建新的门禁请求，旧请求保留为 rejected，且必须重新计算 contentHash。连续拒绝达到 3 次时，系统创建 escalation 收件箱条目，任务标记 blocked，并要求人工决定「继续、改范围、取消」；M2 单用户模式没有更高的第二个审批人，因此不写「升级到人工负责人」，而是强制进入人工复核并填写复核结论。

门禁超时先提醒，再过期；prod 门按 8.1 在 30 分钟后过期，不允许「不自动过期」的例外。部署计划的时间窗过后，deploy_plan 会附带一个派生标记 `isStale=true`（由时间窗计算得出，不是门禁状态），提醒审批人计划可能已不适用；stale 不会改变门禁状态，但重新执行前必须重新校验 deploy_plan 哈希与时间窗。

### 8.5 与任务、契约、Crew 状态联动

- design_review 通过后 design_spec 才能 frozen；未 frozen 时依赖它的任务保持不可运行。审批绑定契约 contentHash，契约内容变化即 expired。
- api_contract_review 通过后 api_contract 才能 frozen；破坏性变更走 contract_break。
- merge 门与 Run 绑定，并绑定 head commit SHA；Run 处于 in_review 等门禁，批准后 Task 才允许进入 done。审批后分支出现新提交，旧审批 expired，必须重新请求（与 runtime-and-workspace.md RUN-048 的「合并前校验目标分支未偏离审批时的 commit」一致）。
- staging 门与 deploy_plan 绑定；deploy_plan 变化后原审批 expired；批准后 DevOps 才能执行 staging。
- crew_plan 门通过后 Crew 才从 plan_review 进入 executing；拒绝则回到 planning。
- 任何门禁处于 pending 时，相关任务不得重复启动同用途 Run。
- 审批消费后，执行器必须记录执行结果；执行失败不恢复审批，需重新请求。

## 9. 证据化 DoD

### 9.1 证据类型与记录

| 证据类型 | 内容 | 采集方式 | 是否可自述 |
|---|---|---|---|
| diff | base/head commit、文件列表、增删行数 | Workspace/Run 自动生成 | 否 |
| command_log | 命令、退出码、耗时 | Runtime 事件自动记录 | 否 |
| build | 命令、退出码、产物位置、校验和 | 构建事件 + 文件扫描 | 部分 |
| test_report | 套件、通过/失败/跳过、失败用例、环境 | 测试事件解析或结构化上传 | 部分 |
| screenshot | 界面、状态名、尺寸、时间 | Runtime 能力、浏览器自动化或人工上传 | 是（需标注） |
| contract_snapshot | design_spec、api_contract、deploy_plan 的冻结版本快照 | 契约冻结时自动生成 | 否 |
| review_note | 人工评审意见与决定 | 门禁记录 | 不适用 |
| human_signoff | 人工确认记录 | 门禁/完成确认 | 不适用 |

证据类型中不再包含笼统的 `contract`：build 与 test_report 既是契约类型也是证据类型，证据实体只存一份，契约通过 evidence ID 引用；design_spec、api_contract、deploy_plan 的正文属于契约，冻结时会生成 `contract_snapshot` 证据供门禁与审计引用。关系是「契约声明 + 证据实体」，不是「契约包含证据、证据又包含契约」的循环。

系统采集优先于 Agent 自述。Agent 自述的证据必须标注来源，并在 UI 上与系统采集证据区分展示。

### 9.2 各角色 DoD 与必交证据

| 角色 | 完成定义 | 必交证据 | 可选证据 |
|---|---|---|---|
| UI Design | design_spec 冻结且前端可无追问实现 | design_spec、状态矩阵、token 表、design_review 记录 | 线框图、参考截图 |
| Frontend | 界面实现且质量门通过 | diff、build、test_report、关键状态截图、design_spec 覆盖清单 | 性能记录、可访问性检查 |
| Backend | 接口实现且契约覆盖 | diff、test_report、migration 说明、API 文档 | 压测记录、兼容性矩阵 |
| DevOps | 构建可复现、staging 通过、prod 计划就绪 | build、deploy_plan、staging 日志、冒烟结果、回滚演练记录 | 成本估算、变更窗口 |
| Crew 队长 | 子任务完成并汇总 | 计划、汇总报告、证据索引、未决风险 | 计划偏差分析 |

### 9.3 证据校验与不可变性

- 证据创建后不可编辑；修正必须创建新证据，并通过 supersedesId 指向旧证据。
- 证据记录来源 Run、生产者、创建时间与校验和；文件类证据保存内容哈希。
- 系统将 test_report/build 中的命令与 Run 事件中的 command_log 比对；不一致时标记 unverified，并提示审批人。
- 门禁审批绑定证据快照；新证据不会自动改变已作出的决定。
- 审批人可以对证据做抽查标记，抽查结论记录为 review_note。

### 9.4 Run 完成不等于 Task 完成

Run 状态 completed 只表示 Runtime 正常退出。Task 进入 done 需要同时满足：所有必需契约已冻结或已交付；必交证据齐全；该任务类型要求的门禁全部 approved 且（涉及执行动作时）已 consume；没有未解决的 blocker；人工做最终确认。仅有 completed Run 时，Task 最多进入 in_review。

「必需门禁」按任务类型确定，不是所有任务都要 merge：

| 任务类型 | 必需门禁 | 说明 |
|---|---|---|
| 代码变更任务 | merge（以及 push，如果计划推送） | 合并是把变更带入目标分支的必要条件 |
| 设计任务 | design_review | design_spec 冻结即满足，不产生合并 |
| 契约任务 | api_contract_review 或 contract_break | 只产出契约时不需要 merge |
| 部署任务 | staging / prod | 按目标环境；prod 还必须人工执行 |
| 文档、研究、配置说明类任务 | review 或 human_signoff | 由角色模板或任务模板声明，不强制 merge |
| 删除/破坏性任务 | destructive_operation | 与二次确认同时满足 |

角色模板与任务模板负责声明默认映射；用户可以在模板上增加门禁，但不能删除「合并必须审批」「prod 人工执行」这类系统级约束。

### 9.5 证据的存储与保留

M2 使用本地目录保存 Artifact，SQLite 保存证据索引与校验和。默认保留 90 天，可按项目配置；被门禁引用的证据在 Task 归档前不得清理。M3 团队模式可接入共享对象存储，但需保持校验和与访问控制。导出功能至少支持导出单个 Task 的证据清单与 diff。

## 10. 收件箱、对话、通知与升级

### 10.1 收件箱条目类型

| 类型 | 触发 | 默认优先级 | 可执行动作 |
|---|---|---|---|
| approval_request | 门禁创建 | 高 | 打开对象并批准/拒绝 |
| approval_expired | 门禁超时 | 高 | 重新请求或取消 |
| blocker | Agent 上报阻塞 | 高 | 回复、改范围、取消任务 |
| escalation | 连续失败或超时升级 | 紧急 | 接管、改派、取消 |
| mention | 评论中提及 | 中 | 打开任务时间线 |
| contract_change | 契约新版本或破坏性变更 | 中 | 查看影响并确认 |
| dependency_ready | 依赖条件满足 | 低 | 启动下游任务 |
| run_failed | Run 失败 | 中 | 查看日志、重试 |
| crew_plan_ready | 队长计划提交 | 高 | 审核计划 |
| evidence_unverified | 证据校验不一致 | 中 | 抽查并决定 |

### 10.2 任务评论与结构化消息

每个 Task 有一条时间线，评论类型包括：human_note（人工备注）、agent_status（Agent 状态）、blocker（阻塞）、system_event（系统事件）、decision（决定记录）。Agent 的状态消息必须包含结构化字段：summary、evidenceRefs、nextStep、needsHuman、blockerCode。禁止只写自然语言「我完成了」，却没有证据引用与下一步。

评论用于补充上下文和记录决定，不用于 Agent 之间的自由对话。Agent 不得 @ 其他 Agent 并要求其回答；需要协作时，由队长创建子任务或更新依赖。

### 10.3 通知渠道与频率

M2 只做应用内通知：侧边栏收件箱徽标、任务页提示、门禁到期提醒。M4 增加桌面原生通知与 Webhook；Webhook 需要重试与签名校验。通知按事件去重、按任务聚合，默认同一任务 10 分钟内最多一条同类通知。prod 门禁与 escalation 不受频率限制。

### 10.4 阻塞与升级矩阵

| 级别 | 触发 | 处理人 | 默认时限 | 结果 |
|---|---|---|---|---|
| L1 自主处理 | Run 内可重试错误 | 当前 Agent | 立即 | 重试或收窄范围 |
| L2 队长或任务负责人 | blocker 持续 15 分钟 | Crew 场景为队长 Agent；无 Crew 时为任务负责人（M2 即本地用户） | 自 blocker 创建时间起 15 分钟 | 改派、拆任务、升级 |
| L3 人工处理 | 队长/负责人无法解决，或 blocker 持续超过 30 分钟（任一满足即升级） | 本地用户/团队负责人 | 自 blocker 创建时间起 30 分钟 | 决定继续、改范围或取消 |
| L4 紧急升级 | 连续 3 次门禁拒绝、Crew 预算耗尽、死锁 | 人工负责人 | 立即 | 暂停 Crew 或任务，人工接管 |

补充规则：

- 计时起点统一为 blocker 的 `createdAt`，不是首次通知时间；L2 与 L3 的时限独立计算，L3 可在「负责人明确表示无法解决」时提前触发。
- 非 Crew 任务没有队长，L2 直接由任务负责人处理；若任务没有负责人或负责人不可用，原因码增加 `no_leader_available`，直接跳到 L3。
- M2 单用户模式下 L2 与 L3 都是同一个人，升级的意义是「从静默阻塞转为显式待办」；系统仍要生成收件箱条目并记录时限。
- 连续 3 次拒绝没有更高的审批人，因此在 M2 转为强制人工复核并填写复核结论，见 8.4；L4 只负责暂停与接管，不假装存在上级。

阻塞必须带原因码：missing_input、contract_conflict、contract_rejected、permission_denied、environment_error、dependency_stuck、scope_unclear、no_leader_available、other。原因码用于统计和路由，缺少原因码的 blocker 不被受理。

### 10.5 对话边界

- 同一 Task 的时间线对参与该 Task 的角色 Agent 可见；跨 Task 不可见。
- 人工可以把两个 Task 的契约互相引用，但不能把评论线程合并。
- Agent 不得向其他 Agent 发送私聊；系统不提供该 API。
- 所有影响执行的讨论必须落到契约变更、依赖变更或任务评论的 decision 类型中，便于审计。

### 10.6 Agent 上下文装配

Run 启动时，ATeam 负责把任务相关材料装配成 prompt，而不是把整条时间线塞给 Agent。装配规则必须在 Run 事件中可审计：

- **默认包含**：Task 标题、描述、验收标准、角色模板 instructions、冻结契约的摘要与 payload 引用、上游证据清单（ID、类型、校验和）、未解决 blocker 与明确指派给该 Agent 的 decision 评论。
- **默认不包含**：其他角色的完整 Run 日志、未授权契约草稿、被 superseded 的证据正文、跨 Task 评论；需要时只能通过显式引用加入。
- **裁剪**：按优先级填充固定 token 预算（默认 32K，可由 Agent 配置调低或调高），先保留验收标准与冻结契约，再保留最近 decision，最后才保留历史评论摘要；超出预算时生成「上下文被裁剪」事件并列出被省略的对象 ID。
- **脱敏**：进入 prompt 的评论、日志与证据统一经过与日志相同的敏感信息掩码（token、密码、私钥、连接串）；凭据永不进入 prompt。
- **可复现**：每次 Run 记录上下文清单的哈希与对象 ID 列表，评审时可展开查看「Agent 当时看到了什么」；修改上下文装配规则不追溯改变历史记录。
- **注入防护**：评论、契约文本与仓库内容按不可信数据处理，装配时只作为数据，不拼接为系统指令；任何「跳过审批」文本都不能改变 Go core 的门禁。

## 11. 用户故事与验收标准

### US-COLLAB-01 设计交付可被前端直接消费

作为独立开发者，我希望 UI Design Agent 产出完整的设计规格，使 Frontend Agent 不需要反复追问。

- Given 存在一个「新增设置页」的父任务，以及 UI Design、Frontend 两个角色 Agent。
- When UI Design 完成 design_spec 并请求 design_review，人工批准后契约冻结。
- Then Frontend 子任务的 required_contracts 满足，Run 可启动；实现覆盖 design_spec 的所有状态。
- And 若 design_spec 未冻结，Frontend 的 Run 按钮禁用并显示 contract_not_frozen 原因。
- 关联：COLLAB-001、COLLAB-010、COLLAB-012、COLLAB-016、COLLAB-041、COLLAB-051。

### US-COLLAB-02 API 契约冻结后前后端并行

作为小团队成员，我希望前后端在契约冻结后并行开发，减少互相等待。

- Given Backend 先产出 api_contract。
- When 人工批准 api_contract_review 并冻结契约。
- Then Frontend 与 Backend 的子任务可以并行执行；Frontend 使用契约定义的 mock 数据，Backend 按契约实现。
- And 两边完成后各自提交 diff、test_report 与 build 证据，进入合并门。
- 关联：COLLAB-016、COLLAB-023、COLLAB-042。

### US-COLLAB-03 依赖未满足时禁止启动

作为开发者，我希望系统在依赖没完成时阻止启动，而不是运行到一半才失败。

- Given Task B 声明 required_contracts，引用 Task A 将产出的 build 契约 v1。
- When A 尚未 done，或 build 契约仍为 draft 时，用户在 B 上点击 Run。
- Then 系统拒绝入队，分别列出 dependency_unfinished 或 contract_not_frozen 的具体任务与契约。
- And A 完成、build 契约通过字段与证据校验自动 frozen 后，B 的就绪状态自动更新并通知；启动仍需满足人工或自动触发配置。
- 关联：COLLAB-020、COLLAB-022、COLLAB-027、COLLAB-083。

### US-COLLAB-04 合并必须人工批准

作为代码所有者，我希望任何合并都经过人工确认，并看到充分证据。

- Given 一个 Run 已 completed，且产生 diff、test_report、build。
- When 用户请求合并。
- Then 系统创建 merge gate，审批人必须查看 diff 与测试结果后才能批准。
- And 批准后系统执行合并；拒绝必须填写原因，任务回到 in_progress。
- 关联：COLLAB-043、COLLAB-046、COLLAB-047、COLLAB-055。

### US-COLLAB-05 DevOps 只准备并执行 staging

作为开发者，我希望 DevOps Agent 能准备发布并部署 staging，但绝不能碰生产。

- Given DevOps 已生成 deploy_plan 与 build 证据。
- When 用户请求部署 staging。
- Then staging 门要求 build、test_report、deploy_plan 与回滚步骤；批准后 DevOps 执行 staging 部署与冒烟。
- And prod 步骤只生成计划与执行人，Agent 无 prod 凭据、不能执行。
- 关联：COLLAB-044、COLLAB-045、COLLAB-053、COLLAB-073。

### US-COLLAB-06 队长拆解需要人工确认

作为用户，我希望在 Crew 开始执行前批准它的计划，避免范围失控。

- Given 用户创建 Crew 并指派队长。
- When 队长产出子任务、角色、依赖、契约清单与预算。
- Then 系统创建 crew_plan 门；批准前不启动任何成员 Run。
- And 拒绝后队长可以修订并重新提交，连续拒绝 3 次升级人工。
- 关联：COLLAB-030、COLLAB-031、COLLAB-032、COLLAB-047。

### US-COLLAB-07 阻塞自动升级

作为用户，我希望 Agent 卡住时能主动找我，而不是一直停在 in_progress。

- Given 成员 Run 报告 blocker，原因码为 missing_input。
- When 超过 L2/L3 时限仍未解决。
- Then 收件箱创建高优先级条目，通知队长与人工；任务标记 blocked 并保留原因码。
- And 人工处理后可以恢复任务或取消。
- 关联：COLLAB-063、COLLAB-064、COLLAB-060。

### US-COLLAB-08 证据不足不能标记完成

作为评审者，我希望没有测试与构建证据的任务不能被标记完成。

- Given 一个 Run completed，但缺少 test_report。
- When 用户尝试把 Task 改为 done。
- Then 系统阻止操作并列出缺失证据与未通过的门禁。
- And 补齐证据并通过该任务类型要求的门禁后，才允许 done：代码变更任务需要 merge 门，设计任务需要 design_review，文档类任务可为 review/human_signoff（见 9.4）。
- 关联：COLLAB-051、COLLAB-056、COLLAB-052。

### US-COLLAB-09 跨任务契约显式引用

作为开发者，我希望复用另一个任务的 API 契约，但不继承它的聊天与工作区。

- Given Task X 需要 Task Y 的 api_contract 版本 v2，并以 required_version=v2 精确引用。
- When 用户在 X 中显式引用该契约版本。
- Then X 的依赖满足，X 可以启动；X 不继承 Y 的评论、Run 与工作区。
- And Y 发布 v3 时不会自动替换 X 的引用，只提示有新版本可用；X 未开启 allow_newer 时 v3 不满足 X 的依赖。
- And 若 X 显式开启 allow_newer 且 v2 满足 min_version，系统提示可升级到 v3，升级必须由用户确认并把解析结果写入审计。
- 关联：COLLAB-016、COLLAB-017、COLLAB-018、COLLAB-071。

### US-COLLAB-10 并行冲突生成集成任务

作为开发者，我希望并行修改发生冲突时，系统明确阻断并给出处理入口。

- Given Frontend 与 Backend 分支都修改了共享类型文件。
- When 合并队列执行 pre-merge 检测。
- Then 系统阻止合并，创建集成任务并附冲突文件与片段证据。
- And 原合并门作废（expired 或 revoked），不得继续用于合并；集成任务完成后重新进入合并队列，并针对新的 head commit 重新创建 merge 门与证据快照。
- 关联：COLLAB-024、COLLAB-025、COLLAB-080。

### US-COLLAB-11 破坏性契约变更必须审批

作为后端负责人，我希望删除字段或改变类型的契约变更被单独审批，避免下游在不知情时被破坏。

- Given 已冻结的 api_contract v2 被 Frontend 引用。
- When Backend 提交删除响应字段的 v3。
- Then 系统要求 contract_break 门，附影响分析与迁移方案；未批准时 v3 不能冻结。
- And Frontend 继续 pin v2 并收到「有新版本、存在破坏性变更」通知；确认升级后才重新校验依赖。
- 关联：COLLAB-015、COLLAB-018、COLLAB-085。

### US-COLLAB-12 模板实例化与版本快照

作为用户，我希望模板升级不悄悄改变我已经在用的 Agent。

- Given 存在 UI Design 模板 v1，且已由它创建 Agent A。
- When 模板发布 v2 并修改默认 allowedPaths。
- Then A 的权限与 instructions 保持不变，并记录 role_template_version=1 与 template_snapshot。
- And 用户可手动升级 A 到 v2，升级前可查看两版差异；升级需确认并记录。
- 关联：COLLAB-002、COLLAB-005、COLLAB-084。

### US-COLLAB-13 Crew 预算耗尽与死锁

作为用户，我希望 Crew 不会无限烧预算，也不会卡在永远无法满足的依赖上。

- Given Crew 设置最大 10 个 Run。
- When 第 11 次派发被触发，或所有剩余子任务 blocked 且没有活动 Run。
- Then 预算耗尽时 Crew 进入 paused，死锁时进入 blocked，均创建紧急收件箱条目并保留证据。
- And 系统不自动重试；用户可调整预算、改依赖或取消 Crew。
- 关联：COLLAB-036、COLLAB-037、COLLAB-086。

### US-COLLAB-14 路径与命令权限按 Runtime 能力分级

作为评审者，我希望知道 Agent 的越权行为是被实时阻止还是事后审计发现。

- Given Agent 的 allowedPaths 不包含 src/，当前 Runtime 不支持路径策略（partial 或 advisory）。
- When Agent 尝试写入 src/。
- Then 系统在 Run 详情标注隔离等级，运行后由 diff/命令审计发现越界并标记证据 unverified，拒绝以该 Run 作为完成依据。
- And 若 Runtime 支持路径策略，越界写入被实时拒绝并产生 permission_denied 事件。
- And 白名单外命令在支持命令策略的 Runtime 上被拒绝或要求 high_risk_command 门；不支持时只能事后标记。
- 关联：COLLAB-072、COLLAB-073、COLLAB-055。

### US-COLLAB-15 破坏性删除二次确认

作为用户，我希望删除分支或工作区前明确知道会丢什么。

- Given 一个 Run 分支尚未合并，或 Workspace 有未提交修改。
- When 用户点击删除。
- Then 系统创建 destructive_operation 门，要求输入资源名称确认，并列出未提交修改与未合并提交。
- And 文本不匹配或未通过审批时操作取消；删除后资源快照与审批记录保留在审计中。
- 关联：COLLAB-078、COLLAB-080。

### US-COLLAB-16 审批内容变化后自动失效

作为代码所有者，我希望批准的是我看到的那份内容。

- Given 一个 merge 审批已批准，绑定 head commit abc123。
- When 分支在批准后新增提交，head 变为 def456。
- Then 审批自动转为 expired，合并被拒绝并提示重新审批。
- And 重新审批展示新 diff、新测试与新构建证据；旧审批保留为历史。
- 关联：COLLAB-040、COLLAB-043、COLLAB-080。

### US-COLLAB-17 证据不一致标记 unverified

作为审批人，我希望 Agent 自述的测试结果不能冒充真实执行。

- Given test_report 声明的命令是 `pnpm test`，但 Run 事件中没有对应 command_log，或退出码不一致。
- When 审批人打开 merge 门。
- Then 该证据标记 unverified 并高亮差异，门禁提示证据不可靠。
- And 审批人可拒绝或要求补充系统采集证据；unverified 证据不能作为完成依据。
- 关联：COLLAB-053、COLLAB-055、COLLAB-059。

### US-COLLAB-18 消费者反馈驱动契约修订

作为前端开发者，我希望发现契约缺口时能正式要求后端修订，而不是在聊天里喊。

- Given Frontend 实现时发现 api_contract 缺少一个错误码。
- When 用户提交 consumer_feedback 并附期望变更与影响范围。
- Then 系统在契约时间线生成 decision 记录并通知 Backend；旧版本保持 frozen。
- And Backend 创建修订版本并走冻结流程；破坏性变更仍需 contract_break 门。
- 关联：COLLAB-018、COLLAB-085。

### 11.1 P0 需求到用户故事与验收的追踪

| 需求范围 | 主要用户故事 | 验收文档映射 |
|---|---|---|
| COLLAB-001～006 角色模板 | US-COLLAB-12、US-COLLAB-01 | AC-AGENT-06 |
| COLLAB-010～019 契约 | US-COLLAB-01、02、09、11、18 | AC-COLLAB-02、AC-COLLAB-03 |
| COLLAB-020～029 DAG 与并行 | US-COLLAB-03、10、13 | AC-COLLAB-01、AC-COLLAB-07 |
| COLLAB-030～039 Crew | US-COLLAB-06、13 | AC-COLLAB-08 |
| COLLAB-040～049 审批门 | US-COLLAB-04、05、16 | AC-COLLAB-04、AC-COLLAB-05 |
| COLLAB-050～059 证据与 DoD | US-COLLAB-08、17 | AC-COLLAB-02、AC-COLLAB-10 |
| COLLAB-060～069 收件箱与升级 | US-COLLAB-07 | AC-COLLAB-06 |
| COLLAB-070～079 边界与权限 | US-COLLAB-14、15 | AC-COLLAB-10 |
| COLLAB-080～087 内容绑定、模板快照、状态联动、上下文 | US-COLLAB-10、11、13、16、14 | AC-COLLAB-04、AC-COLLAB-08 |

每个 P0 需求至少被一个用户故事或 04 的验收检查点覆盖；新增 P0 需求时必须同时补故事或验收，不允许只加需求不加验证。

## 12. 功能需求

**编号注册表。** `COLLAB-xxx` 的唯一注册表在本章。03-user-flows.md 中原有的 COLLAB-001～028 与本章重号但语义不同（例如 03 的 COLLAB-001 是子任务 dependsOn，本章是四类角色模板；03 的 COLLAB-020 是单 Crew 约束，本章是依赖边），必须改为 `FLOW-xxx` 前缀或删除并改为引用本章编号；00-product-overview、01-scope-and-roadmap、04-acceptance-and-test-plan 的追踪统一以本章编号为准。新增需求只能在本章续号（当前至 COLLAB-087），并同步更新 04 的验收映射。

### 12.1 角色与模板

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-001 | 系统内置 UI Design、Frontend、Backend、DevOps 四类角色模板，包含职责、默认权限、必交契约与 DoD | P0 | 首次启动可看到四个模板；每个模板字段完整；创建 Agent 时可选择模板 | M2 |
| COLLAB-002 | 从模板创建 Agent 时复制配置，模板后续变更不影响已实例化 Agent | P0 | 修改模板后，既有 Agent 的 instructions 与权限保持不变 | M2 |
| COLLAB-003 | Agent 增加 role 字段（ui_design/frontend/backend/devops/custom），用于依赖校验与默认门禁 | P0 | 创建 Agent 可设置 role；非法值被拒绝；旧数据默认 custom | M2 |
| COLLAB-004 | 支持从父任务创建带 role 的子任务，并默认绑定同角色 Agent | P1 | 子任务继承父任务项目上下文；可改绑其他 Agent | M2 |
| COLLAB-005 | 模板支持版本与归档；被引用时不可删除 | P1 | 删除被引用模板返回冲突错误；归档后不可新建实例 | M2 |
| COLLAB-006 | 支持创建 custom 角色，自定义职责与权限，不自动获得门禁豁免 | P1 | custom Agent 涉及合并时仍触发 merge gate | M2 |

### 12.2 交付物契约

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-010 | 支持创建、编辑、查看五类契约对象 | P0 | 五种 type 均可创建；列表可按任务与类型过滤 | M2 |
| COLLAB-011 | 契约状态机为 draft/proposed/frozen/superseded/withdrawn，转换受规则约束 | P0 | 非法转换被拒绝并返回原因 | M2 |
| COLLAB-012 | design_spec 与 api_contract 冻结必须经过对应评审门 | P0 | 未批准时 freeze 返回 APPROVAL_REQUIRED | M2 |
| COLLAB-013 | 按契约类型校验必填字段，缺字段禁止提交评审 | P0 | design_spec 缺状态矩阵无法提交；api_contract 缺错误码无法提交 | M2 |
| COLLAB-014 | 已冻结契约修改必须创建新版本，并填写影响范围 | P0 | 原地编辑返回错误；新版本保留旧版本只读副本 | M2 |
| COLLAB-015 | 破坏性契约变更触发 contract_break 门 | P0 | 删除字段或改类型时强制创建门禁；未批准不能冻结 | M2 |
| COLLAB-016 | 任务可声明 required_contracts，默认按 `required_version` 精确固定；可选 `allow_newer` + `min_version` | P0 | 未满足时任务不可运行；满足后 readiness 更新；v3 不满足 pin v2 的引用；开启 allow_newer 时记录实际解析版本 | M2 |
| COLLAB-017 | 契约草稿仅生产者与授权评审者可见；冻结后消费者可读 | P1 | 未授权 Agent 读取草稿返回 forbidden | M2 |
| COLLAB-018 | 契约记录 baseCommit；当消费者基线变化触及契约文件时标记可能过期 | P1 | 构造基线差异后任务显示 stale 提示；不自动阻断 | M2 |
| COLLAB-019 | 契约历史不可删除，替代关系可追溯 | P0 | 删除接口不存在或返回拒绝；历史页面可查看 supersedes 链 | M2 |

### 12.3 任务 DAG

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-020 | M2 只支持 finish_to_start 依赖边；契约与证据就绪通过 required_contracts、required_artifact_kinds 任务属性表达 | P0 | finish_to_start 可创建并展示；required_contracts/required_artifact_kinds 在就绪判定中生效；artifact_ready 与 approval 独立边不在 M2 实现 | M2 |
| COLLAB-021 | 添加依赖或契约引用时检测环，并校验契约/证据生产方位于上游闭包 | P0 | A→B→C→A 被拒绝并返回完整节点序列；生产方在下游时返回 contract_upstream_violation | M2 |
| COLLAB-022 | 调度器入队前执行统一就绪检查（六项），容量与入队分离 | P0 | 六项检查均有单元测试；未就绪 Run 不入队；容量不足时 Run 为 queued 并记录排队原因 | M2 |
| COLLAB-023 | 无依赖任务在容量允许时并行执行；同一 Task 并发受 parallelRunPolicy 控制 | P0 | single 下同任务只有一个活动 Run；multiple 下多个 Run 各有独立 worktree；Crew 子任务不受父任务 single 限制 | M2 |
| COLLAB-024 | 合并队列按拓扑序与契约冻结顺序生成建议顺序，人工可调整并记录原因 | P1 | 调整顺序必须填写原因；记录进入审计 | M2 |
| COLLAB-025 | 合并前执行 pre-merge 冲突检测，冲突时阻止合并并创建集成任务 | P0 | 构造冲突后合并被阻断；集成任务包含冲突文件与双方分支 | M2 |
| COLLAB-026 | parentId 仅表示层级归属，不产生依赖 | P0 | 创建子任务后父任务不会自动等待子任务；依赖需显式创建 | M2 |
| COLLAB-027 | 删除依赖需二次确认；删除被引用契约需先解除引用 | P1 | 有下游引用时删除被拒绝并列出引用方 | M2 |
| COLLAB-028 | 跨任务依赖限定同一仓库/workspace root，跨仓库依赖被拒绝 | P1 | 跨仓库依赖返回 unsupported_scope | M2 |
| COLLAB-029 | 提供 DAG 可视化，展示节点状态、依赖类型、阻塞原因 | P1 | 图中节点状态与任务状态一致；点击可跳转任务 | M2 |

### 12.4 Crew 与队长

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-030 | 支持创建 Crew，指定父任务、队长 Agent 与成员 Agent | P0 | 创建后 Crew 为 draft；可增删成员 | M2 |
| COLLAB-031 | 队长产出计划：子任务、角色、依赖、契约清单、验收标准、预算 | P0 | 计划字段完整才可提交；缺预算不能提交 | M2 |
| COLLAB-032 | 计划必须经过 crew_plan 门批准，批准前不启动成员 Run | P0 | 未批准时成员 Run 入队被拒绝，原因 crew_not_started | M2 |
| COLLAB-033 | 成员执行沿用普通 Run 生命周期，独立 workspace 与证据 | P0 | 每个成员 Run 有独立 worktree 与事件流 | M2 |
| COLLAB-034 | 全部子任务完成后队长产出汇总报告并请求合并评审 | P1 | 汇总包含子任务状态、证据索引、未决风险 | M2 |
| COLLAB-035 | 队长不能批准门禁、不能改已批准范围、不能代交证据 | P0 | 队长调用审批接口返回 forbidden；范围变更需 scope_change 门 | M2 |
| COLLAB-036 | Crew 支持最大 Run 数、最大时长与重试上限，超限自动暂停 | P1 | 超限后状态为 paused 并创建紧急收件箱条目 | M2 |
| COLLAB-037 | 所有剩余子任务阻塞且无活动 Run 时标记 Crew blocked | P1 | 构造死锁后 Crew 进入 blocked 并通知人工 | M2 |
| COLLAB-038 | 队长失败时 Crew 进入 blocked，已完成成员 Run 保留 | P1 | 替换队长后可恢复；证据不丢失 | M2 |
| COLLAB-039 | Crew 与普通任务共存，普通任务不强制使用 Crew | P0 | 不创建 Crew 也能使用 DAG、契约与门禁 | M2 |

### 12.5 审批门

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-040 | 每次审批请求创建 Approval 记录，包含类型、对象、内容哈希、参数哈希、证据快照、请求人与状态（pending/approved/rejected/expired/cancelled/consumed；requested/revoked 仅作输入别名） | P0 | 门禁列表可按状态与类型过滤；记录不可删；pending 时冻结证据快照 | M2 |
| COLLAB-041 | design_spec 冻结前必须经过 design_review | P0 | 未批准无法冻结；批准记录包含证据快照 | M2 |
| COLLAB-042 | api_contract 冻结前必须经过 api_contract_review | P0 | 未批准无法冻结；破坏性变更另走 contract_break | M2 |
| COLLAB-043 | 任何分支合并必须人工批准，附 diff、测试、构建与评审清单 | P0 | 未批准合并被拒绝；批准后执行合并并记录 | M1（人工确认）、M2（正式 Gate） |
| COLLAB-044 | staging 部署前必须人工批准 deploy_plan | P0 | 未批准时 DevOps 无法执行 staging | M2 |
| COLLAB-045 | M2 中 Agent 不得执行 prod 部署，系统只记录人工执行结果 | P0 | Agent 无法获取 prod 凭据；prod 执行入口仅人工可用 | M2 |
| COLLAB-046 | 产出对象的 Agent 不能作为审批人；审批需逐项查看证据；M2 人类自批需显式确认 | P0 | Agent 自审请求被拒绝；一键批准接口不存在；人类自批显示确认文案并记录 | M2 |
| COLLAB-047 | 拒绝必须填写原因；同一对象连续拒绝 3 次后进入强制人工复核并填写结论 | P0 | 空原因被拒绝；第 3 次后创建 escalation 且禁止自动重试 | M2 |
| COLLAB-048 | 门禁按类型设置有效期、提醒与升级阈值（merge 24h、staging 4h、prod 30min），可配置但不得无限延长 | P1 | 修改配置后提醒时间变化；到期状态为 expired；prod 按时过期 | M2 |
| COLLAB-049 | 所有门禁决定记录操作者、时间、理由与证据快照，支持导出 | P1 | 导出文件包含完整决定链 | M2、M3 扩展 |

### 12.6 证据与 DoD

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-050 | Run 可附加证据，记录类型、来源、校验和、生产者、时间 | P0 | 证据列表按类型过滤；校验和可复核 | M1 |
| COLLAB-051 | 角色模板声明必交证据，缺失时 DoD 不通过 | P0 | 缺 test_report 时完成检查失败 | M2 |
| COLLAB-052 | test_report 必须包含命令、退出码、通过/失败/跳过数量与环境 | P0 | 缺退出码的上传被拒绝或标记不完整 | M1 基础、M2 强制 |
| COLLAB-053 | build 必须包含命令、退出码、产物位置与校验和 | P0 | 缺产物校验和的 build 标记 unverified | M1 基础、M2 强制 |
| COLLAB-054 | UI 变更必须附关键状态截图 | P0 | 缺截图的 Frontend DoD 不通过 | M2 |
| COLLAB-055 | 系统比对证据中的命令与 Run 事件，不一致标记 unverified | P1 | 伪造命令触发 unverified 标记 | M2 |
| COLLAB-056 | Task 置 done 前必须满足证据与门禁条件 | P0 | 仅 completed Run 无法置 done；接口返回缺失项 | M1 部分、M2 完整 |
| COLLAB-057 | 证据不可编辑；修正通过新证据 supersede | P0 | 修改接口被拒绝；替代链可追溯 | M2 |
| COLLAB-058 | 证据默认保留 90 天且可配置；被门禁引用时延迟清理 | P1 | 到期清理任务跳过被引用证据 | M2 |
| COLLAB-059 | 审批人可对证据做抽查标记，结论进入 review_note | P2 | 抽查记录可在时间线查看 | M2 |

### 12.7 收件箱与协作

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-060 | 所有待人工处理事项进入收件箱，含类型、优先级、截止时间与入口 | P0 | 门禁、阻塞、失败、升级均生成条目 | M2 |
| COLLAB-061 | 收件箱条目按对象与类型去重：10 分钟内同一对象的同类事件更新既有条目，不新建 | P1 | 重复触发后条目数不变，计数与最后时间更新 | M2 |
| COLLAB-062 | Task 支持时间线评论，区分 human/agent/system/blocker/decision | P0 | 五种类型可筛选；评论不可物理删除 | M2 |
| COLLAB-063 | Agent 上报 blocker 必须带原因码、影响与需要的决定 | P0 | 缺原因码的 blocker 被拒绝 | M2 |
| COLLAB-064 | 阻塞超过阈值自动升级到队长或人工 | P0 | 超时后生成 L2/L3 收件箱条目 | M2 |
| COLLAB-065 | M2 提供应用内通知；桌面通知与 Webhook 在 M4 提供 | P1 | M2 只出现应用内徽标与页面提示 | M2、M4 |
| COLLAB-066 | Agent 之间不得直接对话；协作信息通过契约、结构化评论与任务状态表达 | P0 | 系统不提供 Agent 私聊 API；消息只能落在 Task 时间线 | M2 |
| COLLAB-067 | 影响执行的讨论需记录为 decision 类型评论 | P1 | 范围变更、契约取舍可追溯到 decision | M2 |
| COLLAB-068 | merge、push、prod、contract_break、destructive_operation 门禁不支持批量批准 | P0 | 批量接口拒绝这些类型；design_review 可多份并排但逐份决定 | M2 |
| COLLAB-069 | 通知按任务聚合与限频；紧急事件不受限 | P2 | 普通事件 10 分钟内合并；escalation 立即发送 | M2 |

### 12.8 边界、权限与安全

| 编号 | 需求描述 | 优先级 | 可测试的验收要点 | 里程碑 |
|---|---|---|---|---|
| COLLAB-070 | 同一任务内通过 Crew 子任务、DAG 与契约协作；门禁对象各自独立，父任务做引用检查 | P0 | 子任务在同一 DAG 内共享父任务上下文；成员门禁不被复制或共享；父任务完成检查成员门禁均已通过 | M2 |
| COLLAB-071 | 跨任务只能通过显式依赖或契约引用协作，不共享会话与工作区 | P0 | 跨任务读取评论/事件被拒绝 | M2 |
| COLLAB-072 | Run 只能写入 Agent.allowedPaths；执行强度按 Runtime 能力分级（enforced 实时拒绝，partial/advisory 目录隔离 + 运行后审计） | P0 | enforced：越界写入被拒绝并产生 permission_denied；partial/advisory：Run 详情标注隔离等级，diff 审计发现越界并标记 unverified，不能作为完成依据 | M2 |
| COLLAB-073 | allowedCommands 之外的高风险命令需 high_risk_command 门；命令拦截按 Runtime 能力分级 | P0 | enforced：越权命令被拦截，批准后才执行；partial/advisory：命令记录进 command_log，事后标记并要求审批补录 | M2 |
| COLLAB-074 | 每个 Run 使用独立 worktree，角色之间不共享未提交工作区 | P0 | 两个 Run 的 worktree 路径不同且互不可见修改 | M1 基础、M2 强制 |
| COLLAB-075 | 与 COLLAB-017 重复，合并至 COLLAB-017，不再单独定义 | — | — | — |
| COLLAB-076 | 角色交接不得跳过必交证据 | P0 | 缺证据时下游依赖不满足 | M2 |
| COLLAB-077 | 人工保留最终完成确认权，Agent 不能把 Task 置 done | P0 | Agent 调用状态更新为 done 被拒绝 | M2 |
| COLLAB-078 | 删除分支、删除工作区等破坏性操作需二次确认 | P0 | 确认文本不匹配时操作取消 | M2 |
| COLLAB-079 | 协作记录支持审计导出（门禁、决定、证据清单） | P2 | 导出包含时间、操作者、对象与理由 | M2 基础、M3 完整 |
| COLLAB-080 | 审批绑定内容哈希（merge 绑定 head commit 与 diff，contract 绑定版本哈希，deploy 绑定计划哈希），支持 consumed 单次消费与 cancelled 撤销（revoked 为输入别名） | P0 | 内容变化后审批自动 expired；重复消费返回 409；撤销在执行前生效 | M2 |
| COLLAB-081 | 高风险动作门禁类型必须登记：push 与 destructive_operation 与 merge、high_risk_command 并列 | P0 | 8.1 与 8.3 的类型一一对应；不存在未登记门禁；批量限制按类型生效 | M2 |
| COLLAB-082 | Crew 状态与父 Task 状态按映射表联动，Crew done 不等于父 Task done；取消需人工选择父任务状态 | P0 | 各阶段父任务状态符合 7.2.1 表；取消与汇总有验收用例 | M2 |
| COLLAB-083 | build、test_report、deploy_plan 通过字段与证据绑定校验后自动 frozen，记录 validatedAt；校验失败保持 draft | P0 | 三类契约可被 required_contracts 引用；缺字段或缺证据时冻结失败 | M2 |
| COLLAB-084 | 角色模板有版本；Agent 记录 role_template_version 与 template_snapshot，模板升级不回溯，可手动升级并查看差异 | P0 | 模板 v2 不改变既有 Agent；手动升级有差异视图与确认记录 | M2 |
| COLLAB-085 | 消费者可提交 consumer_feedback，生产者澄清、修订或拒绝；消费者拒绝契约使任务 blocked 并给出 contract_rejected | P1 | 反馈进入时间线；旧版本保持 frozen；拒绝可解除 | M2 |
| COLLAB-086 | 契约/证据引用的生产方必须位于上游闭包；Crew 死锁检测包含契约生产方缺失 | P0 | 下游生产方被拒绝；Crew 遇 contract_producer_missing 进入 blocked | M2 |
| COLLAB-087 | Agent 上下文装配默认只含验收标准、冻结契约、上游证据索引与指派评论，按 token 预算裁剪并脱敏 | P1 | Run 记录上下文清单哈希；被裁剪对象可见；凭据不进入 prompt | M2 |

## 13. 交互与规则

页面结构、导航与视觉规范以 ui-ux.md 为准；本节只定义协作特有的行为要求、状态规则与异常状态。

### 13.1 任务详情页（M2）

任务详情页在现有 Run 面板之上增加标签页：Overview、DAG、Contracts、Gates、Evidence、Timeline。

- **Overview**：显示 readiness 状态、阻塞原因、当前 Crew、下一步建议。Run 按钮在不可就绪时置灰，并直接展示原因列表，例如「缺少 design_spec v2 冻结」「依赖 TASK-102 未完成」。
- **DAG**：图形化展示上游与下游节点，节点颜色对应任务状态；点击节点跳转任务；从当前任务可以添加依赖，添加时实时做环检测。
- **Contracts**：列出本任务生产与消费的契约；生产侧提供编辑、提交评审、冻结操作；消费侧展示版本、baseCommit 与是否可能过期。
- **Gates**：列出所有门禁请求与历史决定；每张门禁卡展示证据清单，审批人必须逐项勾选已查看后才能批准；拒绝需要填写原因。
- **Evidence**：按类型分组展示证据，系统采集与 Agent 自述使用不同标识；提供 diff 查看、测试失败用例、截图预览与校验状态。
- **Timeline**：任务评论与系统事件的统一时间线，支持按类型筛选；Agent 消息展示 summary、evidenceRefs、nextStep、needsHuman。

### 13.2 Crew 视图

Crew 视图展示计划、成员、子任务 DAG、预算消耗与当前状态。计划未批准时只读并显示 crew_plan 门入口；执行中展示每个成员的 Run 状态与阻塞；汇总阶段展示证据索引与合并请求入口。暂停、取消、改派成员都属于人工操作，且需要确认。

### 13.3 收件箱

收件箱按优先级倒序展示；每条包含来源任务、类型、摘要、截止时间与操作按钮。批准类条目的主操作是「打开并评审」，不是直接批准；合并与 prod 条目禁止快捷批准。已处理条目保留一段时间，支持按任务过滤。

### 13.4 状态与规则

Task 状态在 M2 的转换规则：

| 当前状态 | 事件 | 目标状态 | 条件 |
|---|---|---|---|
| backlog | 人工准备就绪 | todo | 人工操作 |
| todo | Run 启动 | in_progress | readiness 全部满足 |
| in_progress | Run 完成且证据已提交 | in_review | 存在待审批门禁或待人工确认 |
| in_progress | 出现阻塞 | blocked | blocker 被受理或依赖失效 |
| in_review | 评审中重跑 Run | in_progress | 记录重跑原因；原评审结论标记为已被新 Run 取代 |
| in_review | 全部门禁通过且证据齐全 | done | 人工最终确认 |
| in_review | 门禁被拒绝 | in_progress | 拒绝原因已记录 |
| blocked | 阻塞解除 | todo 或 in_progress | 人工或队长确认解除 |
| done | 重新打开 | in_progress | 必须填写原因 |
| 任意 | 人工取消 | cancelled | 二次确认 |

其他规则：

- 状态变更由人工或系统根据明确事件触发；Agent 不能直接把任务置 done。
- 证据提交后、门禁决定前，任务只能处于 in_review，不能进入 done。
- 契约冻结是幂等操作，重复调用不产生额外门禁。
- 删除正在被依赖引用的任务时返回 409，并列出直接与间接引用方；必须先解除依赖或归档下游。归档被依赖任务时允许继续，但下游转为 blocked 并提示改引用（与 task-management.md §9.5 一致）。
- 删除父任务前必须处理或归档其子任务；子任务不会随父任务被级联删除。
- 契约与证据不随任务删除而删除；任务软删除后引用保留，UI 标注「所属任务已删除」。评论随任务软删除保留 30 天，期间可恢复。
- 所有破坏性操作要求输入任务标题或对象名称确认，不能只点一次按钮。

### 13.5 空、加载、错误与权限不足状态

各标签页统一遵循 ui-ux.md 的 UI-078（Inbox 空状态区分「已清空」与「暂无事项」）、UI-079（骨架屏）、UI-080（每个空状态含标题、解释与一个主入口）、UI-081（错误内联重试）、UI-089（权限不足状态），本章只列协作特有差异：

| 区域 | 空状态主入口 | 加载 | 错误 | 权限不足 |
|---|---|---|---|---|
| DAG | 「添加第一个依赖」或「从模板生成子任务」 | 图骨架屏，不先画空节点 | 「依赖图加载失败，重试」；保留任务基础信息 | 只读用户隐藏添加/删除，显示所需角色 |
| Contracts | 「创建契约」或「从任务模板预填」 | 列表骨架屏 | 契约解析失败时显示字段级错误，不整页崩溃 | 草稿仅生产者和授权评审者可见，其他人显示「无访问权限」而非空白 |
| Gates | 区分「无待审批」与「本任务门禁已全部处理」 | 卡片占位 | 门禁详情加载失败可重试，不丢失已选证据 | 非审批人显示「等待 {角色} 审批」 |
| Evidence | 「等待首个 Run 产出证据」 | 分组骨架屏 | 校验和不可读时标记 unknown 并提供下载 | 仅可查看被授权任务 |
| Timeline | 「还没有评论」 | 时间线骨架 | 单条损坏不影响整页，显示占位 | 跨任务评论不可见 |
| Inbox | 引用 UI-078：已清空与暂无事项文案不同 | 列表骨架 | 条目动作失败保留条目并提示 | 只读成员可看不可批 |
| Crew | 「创建 Crew」或「改用并行任务」 | 计划与成员骨架 | 计划加载失败可重试 | 非成员只读 |

所有空状态必须给出下一步主入口，不能只显示「暂无数据」；加载超过 300 毫秒才显示骨架，避免闪烁；权限不足不得泄露受限对象的标题与数量。

## 14. 数据与 API 影响

**权威边界。** API 路径、字段名、错误码与表结构以 api-and-data.md 为权威；本章只定义业务语义与协作特有对象。旧稿自建的 contracts、contract_links、gates、comments 表名与 /api/contracts、/api/gates 路径不再使用，统一改为 api-and-data 的 deliverables、approvals、task_comments 与 /api/v1 前缀；契约版本历史使用 contract_versions 与 contract_requirements，不另建一套。

### 14.1 领域对象与表

| 表 | 用途 | 关键字段 | 里程碑 |
|---|---|---|---|
| task_dependencies | 任务依赖边 | id、task_id、depends_on_task_id、type（M2 仅 finish_to_start）、required_artifact_kinds、created_at | M2 |
| deliverables | 契约当前版本（api-and-data 权威） | id、task_id、kind（design_spec/api_contract/build/test_report/deploy_plan）、contract(JSON payload)、status、version、revision、produced_by_run_id、validated_at、frozen_at、revision_in_progress、verified_at | M2 |
| contract_versions | 契约历史版本 | deliverable_id、version、payload、status、content_hash、supersedes_id、created_at | M2 |
| contract_requirements | 任务对契约的引用 | task_id、deliverable_id、required_version、min_version、allow_newer、required_state | M2 |
| role_templates | 角色模板当前版本 | id、key、version、role、name、instructions、default_runtime、default_allowed_paths、default_allowed_commands、artifact_write_scope、required_contract_types、dod、status | M2 |
| role_template_versions | 模板历史版本 | template_id、version、payload、status、created_at | M2 |
| approvals | 审批记录（api-and-data 权威） | id、task_id、run_id、action_type、status、params、params_hash、subject_revision、content_hash、evidence_snapshot_hash、requested_by、decided_by、reason、expires_at、consumed_at、consumed_by、created_at | M2 |
| approval_evidence_snapshots | 审批时的证据快照 | approval_id、evidence_id、checksum、snapshot_hash、captured_at | M2 |
| artifacts | 文件类产物索引 | id、task_id、run_id、type、name、media_type、size_bytes、sha256、storage_path、created_at | M1 |
| evidence | 证据记录（M2 起） | id、task_id、run_id、type、source、artifact_id、criterion_key、status（passed/failed/missing/waived）、validity（valid/unverified/invalid）、summary、source_command、verified_by、verified_at、supersedes_id、created_at | M2 |
| crews | Crew 主体 | id、task_id、lead_agent_id、status、budget、plan_contract_id | M2 |
| crew_members | Crew 成员 | crew_id、agent_id、role、added_at | M2 |
| task_comments | 任务时间线（task-management 权威） | id、task_id、author、author_type、kind、body、refs、run_id、created_at | M2 |
| inbox_items | 收件箱 | id、type、severity、subject_type、subject_id、status、due_at | M2 |
| audit_events | 审计事件 | id、actor、action、subject_type、subject_id、payload、created_at | M3 |

补充列：Agent 增加 role（默认 `general`）、role_template_id、role_template_version、template_snapshot、output_contract_types；Task 增加 parallelRunPolicy（数据库列 parallel_run_policy，默认 single）、blocked_reason；Run 增加 base_commit、evidence_summary、isolation_level。旧数据 role 默认 `general`，不回填为 `custom`。

### 14.2 API 端点

统一使用 /api/v1 前缀；M0 的 /api/* 在 M1 迁移期保持兼容。契约、审批、证据、评论的字段与错误码以 api-and-data.md 为准：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | /api/v1/tasks/{id}/dependencies | 查询或添加依赖（M2 仅 finish_to_start） |
| DELETE | /api/v1/tasks/{id}/dependencies/{depId} | 解除依赖 |
| GET | /api/v1/tasks/{id}/readiness | 就绪状态与结构化原因 |
| GET | /api/v1/tasks/{id}/deliverables | 聚合契约与交付物状态（api-and-data） |
| GET/PATCH | /api/v1/deliverables/{id} | 读取或编辑草稿 |
| POST | /api/v1/deliverables/{id}/submit | 提交评审（评审型） |
| POST | /api/v1/deliverables/{id}/validate | 校验并自动冻结（校验型） |
| POST | /api/v1/deliverables/{id}/freeze | 请求冻结（评审型，内部校验门禁） |
| POST | /api/v1/deliverables/{id}/revise | 创建修订版本 |
| POST | /api/v1/deliverables/{id}/withdraw | 撤回 |
| GET | /api/v1/deliverables/{id}/versions | 版本历史 |
| GET/POST | /api/v1/approvals | 查询或创建审批 |
| GET | /api/v1/approvals/{id} | 审批详情（含 params_hash、content_hash、消费状态） |
| POST | /api/v1/approvals/{id}/decision | 批准或拒绝 |
| POST | /api/v1/approvals/{id}/consume | 执行动作时消费审批 |
| POST | /api/v1/approvals/{id}/revoke | 执行前撤销 |
| GET | /api/v1/evidence/{id} | 证据详情 |
| POST | /api/v1/evidence/{id}/verify | 复核证据（人工或系统） |
| GET/POST | /api/v1/crews | 查询或创建 Crew |
| GET | /api/v1/crews/{id}/plan | 计划详情 |
| POST | /api/v1/crews/{id}/submit-plan | 提交计划 |
| POST | /api/v1/crews/{id}/pause、/resume、/cancel | 暂停、恢复、取消 |
| POST/DELETE | /api/v1/crews/{id}/members | 增删成员 |
| GET | /api/v1/inbox；PATCH /api/v1/inbox/{id} | 收件箱列表与已读（ui-ux） |
| POST | /api/v1/inbox/{id}/action | 条目动作 |
| GET/POST | /api/v1/tasks/{id}/comments | 任务评论（task-management） |
| GET/POST | /api/v1/runs/{id}/evidence | 证据查询与新增 |
| GET | /api/v1/audit/export | 审计与决定链导出 |

所有状态机状态都有对应入口：withdrawn 有 withdraw，consumed 有 consume，cancelled 有 revoke 端点（`revoked` 为输入别名），Crew 的 cancel 与成员增删不再缺失；证据详情与复核不再只有列表接口。

其中 deliverables 的 validate/revise/withdraw/versions、evidence 的详情与 verify、crews 的 members/cancel/plan、audit/export 是本章新增的协作端点，需在 api-and-data.md 下一次修订中并入并补错误码；其余路径已存在于该文档。表结构同理：contract_versions、contract_requirements、role_templates、role_template_versions、approval_evidence_snapshots 需与 M2-role-agents.md §9.1 一起回写 api-and-data.md §9.3。

### 14.3 WebSocket 事件

在 M0 事件基础上新增（事件名以 api-and-data.md §6.3 与 M2-role-agents.md 为准）：task.dependency.added、task.dependency.removed、task.readiness_changed、task.unblocked、task.archived、task.restored、deliverable.created、deliverable.updated、deliverable.frozen、deliverable.revised、approval.requested、approval.decided、approval.expired、approval.consumed、approval.cancelled、inbox.item.created、inbox.item.updated、comment.created、evidence.added、evidence.verified、crew.updated、crew.plan_submitted、crew.member_updated。旧稿的 gate.requested/gate.approved/gate.rejected 统一改为 approval.*；`command.log` 不是顶层领域事件，它是 RunEvent 类型 `command`，通过 `run.event` 广播，并作为 9.3 命令比对与越权审计的数据来源。事件只携带摘要与对象 ID，详情由客户端按需拉取。

### 14.4 对现有模型的最小改动

- Agent 增加 role、role_template_id、role_template_version、template_snapshot、output_contract_types；旧 Agent 默认 role 为 `general`。
- Task 增加 parallel_run_policy（默认 single）与 blocked_reason；parentId 的语义保持层级归属，不产生依赖。
- Run 增加 base_commit、evidence_summary 与 isolation_level，用于契约过期判断、列表展示与权限提示。
- assigneeType 的 crew 值在 M2 才真正生效；M2 之前创建的 crew 值数据视为无效，不回填。
- 所有新增表通过 SQLite migration 新增，保持向后兼容；M3 迁移到 Postgres 时沿用同一逻辑模型。

## 15. 异常与边界

| 场景 | 期望行为 | 关联需求 |
|---|---|---|
| 添加依赖形成环 | 拒绝保存，返回完整环路径，UI 高亮冲突边 | COLLAB-021 |
| 契约/证据生产方位于下游 | 拒绝保存契约引用，返回 contract_upstream_violation；Crew 计划提交时同样校验 | COLLAB-021、COLLAB-086 |
| 契约长期未冻结 | 下游保持不可运行，24h 后收件箱提醒，72h 升级 | COLLAB-022、COLLAB-048 |
| 契约可能过期 | 启动 Run 前提示，需人工确认；不自动阻断 | COLLAB-018 |
| 门禁连续拒绝 3 次 | 任务 blocked，创建 escalation，强制人工复核并填写结论，禁止自动重试 | COLLAB-047 |
| 门禁超时 | 状态 expired，任务回到待处理，通知请求者 | COLLAB-048 |
| 门禁批准后内容变化 | 审批转 expired，执行被拒绝，必须重新请求 | COLLAB-080 |
| Run 在评审期间被取消 | 关联门禁转为 cancelled 或 expired，证据保留，任务回 in_progress | COLLAB-040、COLLAB-057 |
| 队长 Run 失败 | Crew blocked，成员已完成 Run 与证据保留，可替换队长 | COLLAB-038 |
| 成员 Run 失败 | 按重试策略处理，达到上限升级队长 | COLLAB-038 |
| 合并冲突 | 阻止合并，创建集成任务，附冲突证据；原合并门作废，集成后重新创建 | COLLAB-025、COLLAB-080 |
| 同一 Agent 并发超限 | Run 保持 queued，提示容量原因，不直接失败 | COLLAB-022、COLLAB-023 |
| 证据与命令不一致 | 标记 unverified，审批人可见并决定 | COLLAB-055 |
| 工作区丢失 | Run 失败，已有证据保留，重跑创建新 worktree | COLLAB-050、COLLAB-074 |
| 删除被依赖引用的任务 | 返回 409 并列出直接/间接引用方；先解除依赖或归档下游 | COLLAB-027、COLLAB-071 |
| 归档被依赖的任务 | 允许归档，下游任务 blocked，提示改引用或解除依赖 | COLLAB-027、COLLAB-071 |
| Crew 预算耗尽 | Crew paused，保留证据，创建紧急收件箱条目 | COLLAB-036 |
| Crew 剩余子任务全部阻塞 | Crew blocked；若契约生产方缺失，错误码 contract_producer_missing | COLLAB-037、COLLAB-086 |
| Agent 试图通过 API 读取其他任务 | 返回 forbidden，记录访问拒绝；进程级读取取决于 Runtime 隔离能力，见 16.1 | COLLAB-071 |
| Agent 试图执行 prod | 拒绝并无凭据可用，记录安全事件 | COLLAB-045 |
| 离线或本地服务不可达 | UI 显示离线横幅（UI-082），使用缓存快照，禁止提交审批与启动需要服务端的动作；恢复后按事件重放校准 | COLLAB-065 |
| 远程 Runner 失联（M3） | Run 标记 `failed` + `interrupted/runner_lost` 或 `lease_expired`，租约到期后不自动重新调度；证据与审批保留 | M3，见 security-and-permissions.md 第 7 章 |
| Webhook 失败（M4） | 退避重试，不阻塞本地事件；连续失败进入收件箱 | COLLAB-065 |
| 本地磁盘满 | 证据写入失败时 Run 可继续但标记 evidence_incomplete，禁止置 done；提示清理后补交 | COLLAB-050、COLLAB-056 |
| SQLite 忙或锁超时 | 写操作返回 503 DB_BUSY 并标记可重试；已提交的审批与状态不得丢失 | COLLAB-040、COLLAB-080 |
| 客户端与服务端时钟偏差 | 审批有效期、提醒与升级一律使用服务端 UTC 时间；客户端时间只用于显示 | COLLAB-048 |

## 16. 权限与安全

### 16.1 权限执行与 Runtime 能力契约

权限必须分两层描述，不能把计划能力写成已可保证的边界：

- **Go core 与 API 层**：鉴权、Task/Contract/Approval 访问控制、审批门禁、状态机与审计。这一层由 ATeam 自己强制执行，与 Runtime 无关。
- **Runtime/工具层**：文件系统路径、命令白名单、环境变量与网络。M0 的 scheduler 只是把 cwd 设为 Run 工作区后调用 adapter，claude adapter 用 `exec.CommandContext` 启动外部 CLI；没有文件系统沙箱，也没有工具调用拦截。Runtime 是否遵守权限信封，取决于适配器能力声明（security-and-permissions.md §6.4）。

Runtime 能力分为三档，Adapter 必须在注册时声明并写入 Run 快照：

| 等级 | 定义 | M2 行为 |
|---|---|---|
| enforced | Runtime 支持路径、命令或工具参数，ATeam 能强制传入 | 必须启用并强制；越界写入与越权命令被拒绝并产生 permission_denied |
| partial | 支持部分策略，或只能约束工作目录 | 目录级隔离 + 运行后 diff/命令审计 + UI 隔离等级提示；发现越界标记 unverified |
| advisory | 只能设置 cwd 与环境变量 | 依赖运行后审计、人工评审与审批；UI 明确提示「该 Runtime 仅提供目录级隔离」 |

规则：

- 支持权限参数或沙箱的 Runtime 必须强制启用，不得默认跳过权限检查，也不得使用跳过权限的危险参数。
- 不支持的 Runtime 降级为「目录级隔离 + 运行后 diff/命令审计 + UI 隔离等级提示」，不得声称已阻止越界。
- allowedPaths 使用仓库相对路径与通配模式，默认拒绝未列出的路径；符号链接与 `..` 在 enforced Runtime 上实时拒绝，在 partial/advisory Runtime 上通过运行后审计发现并标记。
- allowedCommands 按 argv 匹配；未列出的命令需要 high_risk_command 门。不支持命令拦截的 Runtime 只能把命令记录进 command_log 并事后标记。
- Agent 以当前操作系统用户身份运行，M0-M2 不提供 OS 级沙箱；「无法读取其他 Task」指的是 API 与产品界面的访问控制，不等于进程级隔离。信任模型以 security-and-permissions.md §2 为准，本章不重复定义，也不作出绝对化承诺。

### 16.2 审批权限矩阵（M3 团队）

采用 security-and-permissions.md §4.2 的唯一角色词表：组织级 Owner、Admin、Member、Viewer；Team Workspace 级 Admin（workspace_admin）、Contributor、Reviewer、Viewer。旧稿的 Maintainer/Developer 只是这两个层级的旧称，不再作为角色名；「design owner」「backend owner」「DevOps owner」是资源属主，不是角色，映射为 Workspace Admin 或被指派的 Reviewer。组织 Member 未加入某个 Workspace 时没有该 Workspace 的访问权。

| 门禁 | 组织 Owner | 组织 Admin | Workspace Admin | Contributor | Reviewer | Viewer |
|---|---|---|---|---|---|---|
| design_review | 可 | 可 | 可 | 不可 | 被指派时可 | 不可 |
| api_contract_review | 可 | 可 | 可 | 不可 | 被指派时可 | 不可 |
| crew_plan | 可 | 可 | 可 | 不可 | 不可 | 不可 |
| merge | 可 | 可 | 可 | 不可 | 可 | 不可 |
| push | 可 | 可 | 可 | 不可 | 可 | 不可 |
| staging | 可 | 可 | 可 | 不可 | 不可 | 不可 |
| prod | 可 | 可 | 不可 | 不可 | 不可 | 不可 |
| contract_break | 可 | 可 | 不可 | 不可 | 不可 | 不可 |
| high_risk_command | 可 | 可 | 可 | 不可 | 不可 | 不可 |
| destructive_operation | 可 | 可 | 仅本人创建的资源 | 不可 | 不可 | 不可 |
| scope_change | 可 | 可 | 可 | 不可 | 不可 | 不可 |

M2 为单用户本地模式，本地用户是唯一审批人；这并不等于免审批，所有决定仍需显式记录。Agent 永远不能成为审批人；M2 中人类批准自己的请求时，UI 必须显示「你正在批准自己的操作」。

### 16.3 隔离与密钥

- 本地优先：代码、契约、证据默认不离开本机；Runtime 使用用户自带凭据。
- 密钥只存在于本地配置或系统密钥环，不写入 Artifact、评论、Run 事件或日志。
- 日志与证据采集需要做敏感信息脱敏，至少覆盖常见 token、密码、私钥格式。
- M2 不承诺网络出口隔离；需要用户理解 Agent 可能访问网络，相关风险在风险章节说明。

### 16.4 对抗性输入与证据可信度

仓库内容、契约文本、Issue 描述都可能包含提示注入。系统必须把它们当作不可信数据：契约只做结构化校验，不执行其中指令；Agent 收到的任何「跳过审批」「自动合并」文本都不能改变 Go core 的门禁策略。证据的可信度分级为系统采集、结构化上传、Agent 自述三档；合并与 prod 门禁必须以系统采集证据为主，自述证据只能作为补充。

### 16.5 审计

M2 记录门禁与状态变更；M3 增加完整 audit_events，覆盖登录、Agent 修改、权限变更、合并、部署与审批。审计记录只追加不修改，支持按任务、Agent、时间与操作者导出。

## 17. 指标

| 指标 | 定义 | 采集方式 | 用途与初版目标 |
|---|---|---|---|
| 交接延迟 | 生产者 Run 完成到消费者 Run 开始的时长 | 时间戳差值 | 衡量契约与依赖是否顺畅；目标中位数低于 1 个工作日 |
| 契约冻结周期 | 契约创建到 frozen 的时长 | 契约状态时间 | 发现评审瓶颈；目标中位数低于 24 小时 |
| 门禁响应时间 | pending 到 decided 的时长 | Approval 记录 | 衡量人工评审负担；目标 P90 低于 24 小时 |
| 一次通过率 | 首次审批通过的比例 | Approval 记录 | 衡量交接质量；目标高于 70% |
| 返工率 | 因门禁拒绝而重跑的 Run 比例 | Run 与 Approval 关联 | 识别角色模板或契约问题 |
| 阻塞占比 | blocked 时间占任务总时长 | 状态历史 | 识别依赖与环境问题 |
| 证据完整率 | 具备全部必交证据的 Task 比例 | 证据清单 | 目标高于 90% |
| 并行利用率 | 活动 Run 数除以可用容量 | Scheduler 指标 | 判断并发配置是否合理 |
| 合并冲突率 | 触发 pre-merge 冲突的合并比例 | 合并队列 | 目标低于 10% |
| 升级率 | 进入 L3/L4 的任务比例 | 收件箱 | 判断自主协作是否健康 |
| Crew 计划偏差 | 实际子任务数与计划数差异 | Crew 记录 | 校准队长拆解质量 |

以上目标为 M2 内测阶段的假设值，需在真实使用中校准，不作为对外承诺。

## 18. 依赖与风险

### 18.1 依赖

- M1 的 git worktree、diff 生成、Run 产物与证据存储必须稳定，否则契约与门禁没有可靠输入。
- Scheduler 需要从「只检查任务状态」升级为「统一就绪判定 + 容量排队分离」，并保持幂等入队。
- Workspace Manager 需要为支持的 Runtime 传入路径/命令策略参数，为不支持的 Runtime 提供目录级隔离与运行后审计；Run 结束后保留分支。
- 前端需要新增 DAG 图、契约编辑器、门禁评审与收件箱，工作量显著，应优先保证任务详情页可用。
- 通知能力依赖 WebSocket 事件稳定性；M0 已有 Hub，但需要补充持久化与重放策略。
- 审批内容绑定依赖 git 层能稳定提供 head commit、diff 哈希与目标分支基线；这些能力由 runtime-and-workspace.md 的 RUN-046～RUN-049 提供。

### 18.2 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 流程过度设计 | 小任务被表单拖慢，用户放弃使用 | 提供轻量路径：无契约任务直接走单 Agent + merge 门；模板给默认值 |
| 门禁疲劳 | 用户无脑批准，审批失去意义 | 按风险分级；prod 与合并不可批量；证据清单必须展开 |
| 角色模板僵化 | 真实项目职责交叉，模板不适用 | 支持 custom 角色与模板复制；允许角色覆盖 allowedPaths；模板版本化，升级需手动确认 |
| 契约与代码漂移 | 下游按过期契约实现 | baseCommit 与过期提示；合并前重新校验；审批绑定内容哈希 |
| 多 Agent 冲突 | 合并频繁冲突，效率下降 | 路径所有权、合并队列单飞、pre-merge 检测、集成任务 |
| 证据造假或失真 | 评审误判 | 系统采集优先、校验和、command_log 比对、抽查机制 |
| 提示注入 | Agent 绕过规则或泄露信息 | 策略在 Go core 执行；仓库与契约视为不可信数据；高风险门禁；上下文装配不把外部文本当指令 |
| 权限被误认为沙箱 | 用户以为 Agent 无法越界，实际仅目录级隔离 | Adapter 能力声明；Run 快照记录隔离等级；UI 明示 enforced/partial/advisory；运行后审计 |
| 调度复杂度上升 | 死锁、饥饿、重复执行 | 统一 readiness 检查、幂等入队、契约上游闭包校验、Crew 与门禁死锁检测 |
| 本地资源不足 | 并行 Run 互相拖慢 | 队列与容量提示；按 Agent 与任务策略限并发；不静默失败 |
| 单人模式审批形式化 | 自己审自己没有约束力 | 显式「你正在批准自己的操作」确认、内容绑定与审计；M3 引入角色分离 |

## 19. 里程碑映射

| 能力 | M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| 角色模板 | 无，仅 Agent 通用配置 | 无 | 内置四类模板与实例化 | 团队共享 Agent 模板 | 插件提供模板扩展 |
| 交付物契约 | 无 | 契约作为 Run 附件，无状态机 | 正式契约、版本、评审/校验冻结、变更门 | 跨团队契约引用与审计 | 自动化契约校验与同步 |
| 任务 DAG | 无，parentId 仅字段 | 无 | finish_to_start 依赖、required_contracts、就绪判定、可视化 | 跨机器依赖与队列；评估 artifact_ready/approval 边 | 事件触发自动建依赖 |
| Crew/队长 | 无 | 无 | 队长拆解、计划门、汇总、状态联动 | 跨机器 Crew 与共享成员 | 自动编排与策略优化 |
| 审批门 | 无 | 合并人工确认与 diff review | 全部门禁类型、证据快照、内容绑定与消费、超时升级 | 身份化审批、两层角色矩阵、审计 | 策略自动化与通知联动 |
| 证据化 DoD | 无 | diff、测试、构建证据基础 | 证据类型与 DoD 校验、不可变 | 审计留存与导出 | 外部证据接入 |
| 收件箱 | 无 | 无 | 应用内收件箱与任务时间线 | 团队共享收件箱 | 桌面通知与 Webhook |
| 路径/命令权限 | 字段存储但不执行 | 无强制 | 按 Runtime 能力分级执行：enforced 强制、partial/advisory 目录隔离 + 审计 | 团队策略与远程 Runner 约束 | 策略中心与插件沙箱 |
| 同一任务协作 | 单任务单 Run | 单任务评审闭环 | Crew 子任务与成员独立门禁 | 多人协作与共享队列 | 自动化编排 |
| 跨任务协作 | 无 | 无 | 同仓库显式依赖与契约引用 | 跨仓库与 PR 关联 | 事件驱动跨项目协作 |

M2 内部建议的交付顺序是：任务 DAG 与就绪判定 → 契约对象与冻结 → 审批门与证据校验 → 角色模板 → 并行调度 → Crew → 收件箱。若进度紧张，Crew 与收件箱可以后移，但 DAG、契约、门禁与证据不可削减，否则本章的核心闭环不成立。

## 20. 与其他文档的关系

本章文件名是 `prd/modules/collaboration-and-review.md`，是协作、契约、门禁与证据化 DoD 的模块权威。其他文档的职责与引用关系如下：

- **产品总览与路线图（`prd/00-product-overview.md`、`prd/01-scope-and-roadmap.md`）**：定义 ATeam 的定位、核心闭环与里程碑边界；本章是其协作层展开。注意：00-product-overview.md 目前仍写旧文件名 `06-collaboration.md`，需回写为本章文件名。
- **任务与看板（`prd/modules/task-management.md`）**：定义 Task 字段、状态机、看板与 task_comments；本章在其上增加依赖、子任务与 Crew 关联。parentId 的层级语义以本章 6.5 为准，DAG 边语义与本章 6.1 一致。
- **Agent 与技能（`prd/modules/agent-system.md`）**：定义 Agent 配置、模板变量与技能绑定；本章定义角色模板、role 字段与实例化快照。
- **Runtime 与工作区（`prd/modules/runtime-and-workspace.md`）**：定义 Run 生命周期、worktree、diff、合并执行与冲突处理。本章的 merge 门、pre-merge 检测与合并队列引用其 RUN-046～RUN-049，其中 RUN-048 明确「合并前校验目标分支未偏离审批时的 commit」；本章 8.2 的审批失效规则与该条对齐。该模块不存在独立「评审与合并模块」。
- **API 与数据（`prd/modules/api-and-data.md`）**：API 路径、字段、错误码与表结构的权威；本章 14 节只补充协作语义，冲突时以 api-and-data 为准并回写本章。
- **UI 与交互（`prd/modules/ui-ux.md`）**：页面结构、空状态、加载、错误与权限不足规范；本章 13 节只保留协作特有行为，并引用 UI-078、UI-079、UI-080、UI-081、UI-089 与 `/inbox` 路由。该文件目前引用 `./collaboration.md`，需回写为本章文件名。
- **安全、权限与治理（`prd/modules/security-and-permissions.md`）**：信任模型（第 2 章）、角色矩阵（§4.2/§4.4）、审批规则与失效（§5.2）、Agent 权限信封与 Runtime 能力（第 6 章）、审计（第 8 章）。本章引用而不重复定义；16.1 与 16.2 直接采用其结论。
- **非功能需求（`prd/modules/non-functional-requirements.md`）**：性能、可靠性、可观测性、可访问性与国际化预算；本章的指标与审计导出需满足其约束。
- **里程碑文档**：`prd/milestones/M0-scaffold.md`、`M1-local-loop.md`、`M2-role-agents.md`、`M3-team-mode.md`、`M4-automation-and-packaging.md` 均已存在。M2 文档第 7.2 节明确了 M2 只采用 finish_to_start + requiredArtifactKinds 的结论，本章 6.1 与之对齐；若两者再次冲突，以 M2 里程碑的范围声明为准并回写本章。
- **用户流程与验收（`prd/03-user-flows.md`、`prd/04-acceptance-and-test-plan.md`）**：03 中原有的 COLLAB-001～028 与本章重号，必须改为 FLOW-xxx 或删除并引用本章；04 的 AC-COLLAB-xx 按本章编号建立追踪。COLLAB 编号的唯一注册表在本章 12 节。

## 21. 已决默认值与待确认事项

本章此前把已拍板的事项也列成「待确认」，导致正文与开放项互相矛盾。现拆成两部分：已决定但可调参的默认值，以及真正未决的问题。

### 21.1 已决定、可调参的默认值

| 事项 | 已决定内容 | 可调整范围 |
|---|---|---|
| api_contract 的 schema 载体 | M2 采用结构化 JSON 校验，不要求完整 OpenAPI；OpenAPI 导入是未来选项，不是 M2 未决项 | 字段集合与校验严格度 |
| 跨仓库任务依赖 | M2 不支持，限定同一仓库/workspace root，跨仓库依赖返回 unsupported_scope | M3 评估 |
| 团队审批角色 | 采用 security-and-permissions.md §4.2 的两级角色（组织 Owner/Admin/Member/Viewer + Workspace Admin/Contributor/Reviewer/Viewer），不再使用 workspace_admin/Developer 旧称 | 自定义角色属 M3 后期 |
| 契约版本解析 | 默认 exact pin；allow_newer + min_version 需显式开启并记录解析结果 | 默认是否允许 allow_newer |
| 门禁时限 | merge 24h、staging 4h、prod 30min、删除 1h；其余 72h 上限；24h/72h 提醒与升级 | 具体阈值可在内测校准，但不得无限延长 |
| 证据保留 | 默认 90 天，被门禁引用的证据在 Task 归档前不清理 | 按项目配置调整 |
| 合并队列并发 | 同一仓库单飞；按路径分段并行是未来优化 | M3 评估 |
| 模板升级 | 实例化时记录模板版本与快照，升级需手动确认并看差异 | 是否提供批量迁移工具 |
| Crew 与父任务状态 | 按 7.2.1 映射，Crew done 不等于父 Task done | 提醒阈值 |
| 空 allowedPaths 语义 | 默认拒绝写入任何路径（与 M2-role-agents.md 一致） | 无 |

### 21.2 真正未决的问题

以下问题仍需在对应决策点确认，未关闭前采用保守默认：

- **design_spec 的存储格式**：Markdown 加 JSON 混合，还是纯 JSON。前者对设计者友好，后者便于校验与前端消费。
- **单人模式下的审批人身份**：引入本地用户档案，还是直接使用操作系统账户；影响审计记录与 M3 映射。
- **各角色默认命令白名单的具体条目**：需要按技术栈细化；错误的白名单会直接阻塞正常工作。
- **Crew 预算默认值**：最大 Run 数、最大时长与重试次数的具体数值，以及超限后暂停还是终止（本章默认暂停）。
- **截图证据的采集方式**：Runtime 能力、浏览器自动化还是人工上传；不同方式影响证据可信度等级。
- **direct 模式是否进入 M2**：runtime-and-workspace.md 的 RUN-050 列为 M2，但本章未纳入 P0；需要范围评审。
- **Codex Runtime 是否进入 M2**：影响 Runtime 覆盖与测试工作量。
- **Crew 是否作为 M2 正式退出的必要项**：M2-role-agents.md 将其列为 M2.2，若进度紧张可后移，但 DAG、契约、门禁与证据不可削减。
- **任务模板版本化与模板升级迁移工具**：M2 只要求模板可实例化，版本化与历史任务复现的边界待定。
- **证据写入磁盘失败后的补交策略**：是否允许 Run 结束后补交系统采集证据，还是必须重跑。
