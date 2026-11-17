# 模块：API、数据与 CLI

## 本章导读

本章定义 ATeam 的对外契约与本地数据底座。UI、桌面壳、CLI、远程 Runner 与插件都通过同一套 REST/WebSocket API 访问核心能力；SQLite（M3 起可选 Postgres）保存 Workspace、Task、Agent、AgentVersion、Run、Artifact、Evidence、Review、Deliverable 与治理记录；`ateam` CLI 提供无界面的自动化入口。本章覆盖资源模型、端点总表、WebSocket 事件目录、错误码目录、分页与检索、数据库 schema 与迁移、CLI、类型化客户端、版本兼容，以及这些能力在 M0-M4 中的边界。

本章是**接口与数据契约的唯一权威**：REST 路径、请求/响应结构、WebSocket 事件名与信封、错误码、分页语义、数据库表与字段，均以本章为准。任务模块负责 Task 业务状态机（`prd/modules/task-management.md` §5.2），运行时模块负责 Run 生命周期与失败分类（`prd/modules/runtime-and-workspace.md` §11），协作模块负责评审、合并门与交付物契约（`prd/modules/collaboration-and-review.md` §8、§9），领域模型负责实体语义（`prd/02-domain-model.md` §3、§4、§6）。本章不另立第二套业务矩阵，只定义 API 层如何校验、持久化与广播这些规则。

阅读本章时需要始终区分两类内容：

- **已实现（M0）**：以仓库当前代码为准，包括 `/api` 下的 Task/Agent/Run CRUD、Run 事件、WebSocket 广播、SQLite 迁移、`ateam serve`/`version`、TypeScript API 客户端与共享类型。这些能力可用，但存在 5.3 节列出的明确缺口。
- **计划中（M1-M4）**：包括 `/api/v1` 版本化、Workspace/AgentVersion、Artifact/Evidence/Review/Deliverable/Approval、分页与检索、结构化错误、事件序号与断线重放、CLI 子命令、Runner 租约协议、M3 组织与权限、M4 自动化与插件等。计划内容不得在对外文档或演示中描述为已经可用。

本次修订解决了以下跨文档冲突，后续变更必须遵守同一套决策：

1. **路径版本**：M1 起新端点统一为 `/api/v1/*`；M0 的 `/api/*` 永久保留为兼容别名并携带弃用头，不再在 M2 删除。见 5.0。
2. **Task 状态机**：本章 13.1 只引用任务模块 §5.2 的权威矩阵，并在 CI 对七状态全矩阵做契约测试。
3. **归档与删除**：单一字段 `archived_at` 承载归档与软删除；不建 `deleted_at`；M1 为确认 + 阻止 + 归档，M2.1 起提供 30 天恢复窗口；`restore` 与 `unarchive` 同义。受限物理清理只在无引用且过期后执行。
4. **Workspace/Project**：产品级实体统一为 Workspace（数据库 `workspaces`、字段 `workspace_id`）；里程碑文档中的 Project 与 `projectId` 是同一实体的历史称谓，`/api/v1/projects` 在 M1-M2 是正式别名，M3 起保留但不再宣传。
5. **事件与错误码**：本章 6.3 与 7.3/7.4 是唯一目录，旧事件名与旧失败码在对应表的“旧名/别名”列给出映射。
6. **Runner 数值**：心跳 15 秒、45 秒无心跳判定 offline、租约 90 秒未续期判定 interrupted、注册令牌 15 分钟有效；Runner 身份为机器密钥对 + 签名挑战，不使用长期 Bearer 令牌。

## 1. 目的与范围

### 1.1 目的

1. 为所有客户端（Vue Web、Wails 桌面壳、CLI、M3 远程 Runner、M4 插件）提供单一、版本化、可测试的访问契约，避免每个客户端各自拼装业务规则。
2. 为 Workspace、Task、Agent、AgentVersion、Run、Artifact、Evidence、Review、Deliverable、Approval、Skill、Machine、Runner 等实体定义稳定的数据表示、生命周期与持久化方式。
3. 定义事件流的语义（顺序、重连、幂等），让 UI 能实时反映 Run 进展，让自动化能可靠消费状态变化。
4. 定义数据库演进规则，保证本地用户升级 ATeam 时数据可迁移、可回滚到备份、不丢失运行历史。
5. 定义 CLI 的行为、输出、实例发现与退出码，使 ATeam 可以被脚本、CI 与远程 Runner 无歧义地调用。

### 1.2 范围

- REST 资源：workspaces、tasks、agents、agent versions、runs、run events、artifacts、evidence、reviews、review comments、deliverables、approvals、skills、machines、runners、leases，以及 health/events/meta/auth/audit 等系统端点。
- WebSocket 事件模型：事件信封、类型目录、Run 事件类型、重连与重放、幂等与背压、订阅过滤。
- 错误模型：HTTP 状态码、HTTP 错误码、Run `errorCode` 与 `failureDetail`、可重试语义。
- 列表语义：分页、过滤、排序、搜索及其边界。
- 数据层：M0 schema、M1-M4 计划表、索引、约束、保留策略、迁移与备份。
- CLI：`serve`、`runner`、`task`、`agent`、`run`、`version`、`db status` 及全局约定。
- 类型化客户端与共享类型：TypeScript 包与 Go 客户端、契约测试、类型同步。
- 版本化：产品版本、API 版本、事件版本、数据库版本、Runner 协议版本与兼容规则。
- M4 自动化面：Schedule、Webhook、Notification、Plugin、Telemetry、Update 的端点、事件、错误码与表。

### 1.3 非目标

- 不做模型托管、模型计费或 API Key 转售；Runtime 由用户自备（BYO Runtime/Key）。
- 不追求与任何第三方产品的 API 兼容，也不复制第三方接口形状。
- M1-M2 不引入 GraphQL、gRPC 或公网 SaaS API；本地 HTTP/JSON 足够，复杂度应投入到证据与治理。
- 不把 WebSocket 当作唯一事实来源；持久化的事件日志与资源快照才是事实来源。
- 不在本章定义具体 Runtime 的流式解析细节、workspace 的 worktree 创建算法、协作 DAG 的业务规则；这些分别由 Agent/Runtime、Workspace/Git、协作模块负责，本章只定义它们对 API 与数据的契约要求。
- 不在 M0-M2 实现多租户隔离、计费配额或对外开放的 API 网关。
- 不在本章重新定义业务状态机；见 13.1 的权威引用。

### 1.4 术语与契约单源

| 术语 | 定义 |
| --- | --- |
| Workspace | 产品级工作区，绑定一个本地 git 仓库，是 Task、Agent、Run 等实体的归属边界；数据库表 `workspaces`。界面文案可称「项目工作区」 |
| Project | 里程碑文档与任务模块对 Workspace 的历史称谓，不是第二个实体；`projectId` 等价于 `workspaceId` |
| Run Workspace | 某次 Run 的隔离执行环境（M1 起为 git worktree 与分支），不是归属实体 |
| AgentVersion | Agent 在某一时刻的不可变配置快照；M1 起 Run 固定引用 `agentVersionId` |
| Deliverable | 任务交付物契约的当前版本对象；历史版本在 `contract_versions`，任务引用在 `contract_requirements` |
| 契约夹具 | CI 中固定请求/响应/事件样本的 JSON 文件，用于跨语言一致性检查 |

契约变更流程：任何路径、字段、事件名、错误码、表名变更，必须先修改本章并更新契约夹具，再修改实现与消费方；任务、运行时、协作、安全、UI、验收文档只引用本章编号，不复制定义。

## 2. 角色与场景

| 角色 | 关注点 | 典型场景 | 能力起点 |
| --- | --- | --- | --- |
| 独立开发者 | 快速启动 Run、查看证据、脚本化重复操作 | 在 UI 创建 Task 后，用 `ateam task run --watch` 观察执行；用 `--json` 接入脚本 | M0 基础，M1 完整 |
| 前端开发者 | 类型安全、实时更新、错误可展示 | 通过 `@ateam/api-client` 拉取分页任务列表，订阅事件并在重连后补齐状态 | M0 基础，M1 完整 |
| Runtime/后端开发者 | Adapter 事件契约、Run 生命周期、失败归因 | 实现 Claude Code/Codex adapter，把 stdout、工具调用、测试结果映射为规范的 Run 事件 | M0 mock，M1 真实 |
| 小团队管理员 | 身份、权限、机器、审计 | 注册远程 Runner，审批合并，查询谁在何时批准了哪次合并 | M3 |
| 自动化脚本/CI | 非交互、稳定退出码、幂等 | 在 CI 中以 `--json` 创建 Run，用 `Idempotency-Key` 避免重试产生重复 Run | M1 |
| 插件开发者 | 稳定 API、事件目录、扩展点 | 订阅 `run.completed` 事件，生成自定义报表或触发外部通知 | M4 |
| 远程 Runner | 注册、心跳、租约、事件与证据回传 | 领取 Run、执行 Runtime、按 `seq` 批量上报事件、分片上传 Artifact | M3 |

关键场景链路：

1. **创建并执行**：客户端 `POST /api/v1/tasks/{id}/runs`，服务端返回 `queued` 的 Run，调度器随后推进 `preparing → running → completed/failed/cancelled`，全过程通过 WebSocket 与持久化事件双通道可观测。
2. **断线恢复**：UI 断网或桌面壳休眠后重连，携带 `afterSeq` 请求重放，服务端从事件日志补发遗漏事件；超出保留窗口时明确通知客户端重新拉取快照。
3. **证据化评审**：Run 结束后生成 diff、测试结果、截图等 Artifact 与 Evidence；人工提交 Review；Merge 端点校验 `reviewId`、证据快照与 `expectedHeadCommit` 后才允许合并。
4. **升级迁移**：用户安装新版本，服务启动前完成数据库备份与迁移；迁移失败则拒绝启动并给出可执行的恢复指引。
5. **团队执行（M3）**：管理员生成一次性注册令牌，Runner 生成密钥对并完成签名挑战；服务端把 Run 以租约下发到匹配 runtime/OS/标签/容量的机器，审计记录注册、调度、审批与执行。
6. **自动化（M4）**：定时规则或签名 Webhook 创建 Backlog Task，去重键保证同一投递只创建一次；通知中心汇总阻塞、评审与失败事件。

## 3. 用户故事与验收标准

每条故事标注首个交付里程碑；未标 M0 的均为计划能力。

**US-API-01（M0 基础，M1 完整）：通过 API 启动 Run 并观察进度**
- Given 存在一个 `todo` 状态的 Task 和一个可用的 Agent
- When 开发者调用 `POST /api/v1/tasks/{id}/runs` 并携带 `agentId`
- Then 服务端返回 `201` 与 `queued` 状态的 Run；随后事件流依次出现 `run.queued`、`run.preparing`、`run.running`、`run.completed`；Task 被指派给该 Agent，状态从 `todo` 变为 `in_progress`
- And 重复提交相同 `Idempotency-Key` 不会创建第二个 Run，返回原 Run 并标记 `Idempotency-Replayed: true`

**US-API-02（M1）：取消排队中的 Run 不会被执行**
- Given 一个 Run 处于 `queued`，尚未被 Worker 取走
- When 开发者调用 `POST /api/v1/runs/{id}/cancel`
- Then Run 立即进入 `cancelled`，`endedAt` 被记录；Worker 后续即使从队列取到该 ID，也必须重新读取状态并跳过执行
- And 对已处于 `completed`/`failed`/`cancelled` 的 Run 重复取消返回 `200` 与原 Run，不产生副作用

**US-API-03（M1）：断线后补齐事件**
- Given 客户端已接收到 `seq=100` 的事件后连接断开，期间服务端产生了 `seq=101..110`
- When 客户端重连并在握手参数中携带 `afterSeq=100`
- Then 服务端按序补发 101-110，客户端按 `id` 去重后状态与快照一致
- And 若 `afterSeq` 早于保留窗口，服务端发送 `events.replay_reset`，客户端重新拉取资源快照而不是静默丢失状态

**US-API-04（M1）：Agent 配置变更不影响历史 Run**
- Given Agent A 在 Run 1 开始时使用 `claude` runtime 与 instructions 版本 X
- When 用户把 Agent A 改为 `mock` 并修改 instructions
- Then Run 1 的详情仍展示执行时的 runtime、model、instructions 摘要与 `agentVersionId`；新的 Run 使用新配置
- And 服务端通过 Run 上的 `agentVersionId` 与 `run_config_snapshots` 保证可追溯，而不是依赖 Agent 当前值

**US-API-05（M1）：人工评审门阻止未批准的合并**
- Given Run 已完成并生成了 diff Artifact，但没有状态为 `approved` 的 Review
- When 客户端调用 `POST /api/v1/runs/{id}/merge`
- Then 服务端返回 `409 REVIEW_REQUIRED`，不执行任何 git 写操作
- And 存在 `changes_requested` 且未被后续 `approved` 取代时同样拒绝合并

**US-API-06（M1）：CLI 在 CI 中可脚本化**
- Given CI 环境可访问本机 ATeam 服务
- When 执行 `ateam task run <task-id> --agent <agent> --json --watch-timeout 10m`
- Then 标准输出只包含一个 JSON 文档，包含 `runId`、最终状态与退出原因；日志走标准错误
- And Run 完成时命令以 `0` 退出，失败时以 `1` 退出，服务端取消时以 `7` 退出，便于流水线判断

**US-API-07（M1）：数据库升级可恢复**
- Given 用户从 M0 版本升级到 M1 版本，数据库中存在 tasks/agents/runs/run_events
- When 启动新版本
- Then 服务在监听端口前完成备份与迁移；迁移成功后所有历史数据可读，并回填默认 Workspace
- And 若迁移失败，服务拒绝启动，原数据库保持不变，日志指出备份路径与失败迁移编号

**US-API-08（M1）：归档 Task 不产生孤儿数据**
- Given 一个 Task 拥有多个 Run 与 Run 事件
- When 用户归档该 Task，或尝试删除它
- Then 删除请求返回 `409 TASK_HAS_REFERENCES` 并提示归档；归档成功后 Task 从默认列表隐藏，Run、Artifact、Evidence 与评审记录仍可查询用于审计
- And 只有不存在任何 Run、Artifact、Evidence、Review 引用且状态为 `backlog`/`cancelled` 的任务才允许硬删除；归档不会被误报为删除

**US-API-09（M3）：团队机器注册与调度**
- Given 管理员在服务端生成一次性注册令牌（15 分钟有效）
- When Runner 执行 `ateam runner --server <url> --token-file <path>`，生成机器密钥对并完成签名挑战
- Then Machine 出现在列表中并保持 15 秒心跳；服务端只把满足 runtime/OS/标签/容量的 Run 以租约下发
- And 令牌明文只在创建时展示一次，服务端仅存哈希；Runner 后续不再使用该令牌

**US-API-10（M2）：高风险动作必须审批**
- Given DevOps Agent 完成 staging 部署计划
- When 它请求执行 `deploy_staging`
- Then 服务端创建 `pending` 的 Approval，不执行动作；人工批准且参数指纹匹配后才允许执行
- And 审批过期、参数被修改或由无权限角色批准时，执行端点返回对应错误且不产生副作用

**US-API-11（M3）：Runner 租约与断线恢复**
- Given Runner R1 持有一个 90 秒有效租约并持续上报事件
- When R1 断网超过 45 秒
- Then Machine 被标记 `offline`，租约到期后 Run 进入 `failed`/`runner_lost`；不自动改派到其他机器
- And R1 恢复后，若原进程仍存活可续租并补齐事件；若进程已不存在，由人工决定重试或放弃

**US-API-12（M4）：Webhook 幂等创建任务**
- Given 用户创建启用中的 Webhook，密钥有效
- When 外部系统发送签名正确且未重放的请求
- Then ATeam 返回 `202` 与 delivery ID，按模板创建 Backlog Task，记录 `trigger=webhook` 与 `dedupeKey`
- And 同一 delivery 重复发送只创建一个 Task，重复事件标记为 `webhook.replayed`

## 4. 设计原则

1. **单一时钟与单一事实来源**：所有时间戳由服务端生成并以 UTC 毫秒存储；Run 事件先持久化再广播，广播失败不改变事实。
2. **先快照、后事件**：客户端任何时刻都应能通过 REST 拉取一致快照，再用事件增量更新；事件丢失不能导致不可恢复的状态。
3. **显式版本化**：路径携带 API 主版本，事件携带 `v`，数据库记录 schema 版本，Runner 携带协议版本；不依赖「客户端会自己适配」的假设。
4. **契约单源**：路径、字段、事件名、错误码、表名只在本章定义；其他文档引用编号，不复制定义。跨文档冲突以本章为准并回写对方。
5. **本地默认安全**：默认只监听 loopback、CORS 不反射任意来源、WebSocket 校验 Origin；M2.1 增加本地会话令牌，M3 增加身份与权限，而不是推翻重来。
6. **可重试操作必须幂等**：创建 Run、执行审批、合并等操作接受幂等键；服务端区分「重复请求」与「冲突请求」。
7. **失败可归因**：错误体包含稳定错误码、可读消息、结构化 details 与 requestId；Run 失败包含 `errorCode` 与 `failureDetail`，而不是只有一段字符串。
8. **前向兼容**：v1 内只做加法；客户端忽略未知字段与未知事件类型；服务端忽略请求中的未知字段。
9. **迁移不可逆但可恢复**：只向前迁移，迁移前备份，迁移失败拒绝启动；降级通过恢复备份完成。
10. **列表接口默认有界**：任何列表都必须分页，默认限制 50、最大 200；禁止无界全量返回。
11. **CLI 与 UI 同等重要**：CLI 不是调试附属品，其输出、退出码与幂等语义与 UI 使用同一 API 契约。
12. **别名不是第二套契约**：`/api/*`、`/api/v1/projects`、`/api/v1/contracts`、`restore` 等兼容别名共享同一 handler 与同一语义，只为迁移存在，不得新增仅别名可用的能力。

## 5. REST 资源与端点

### 5.0 路径、版本与别名决策

| 决策 | 内容 |
| --- | --- |
| 规范前缀 | M1 起所有第一方 API 使用 `/api/v1/*`；`/api/v1` 内只做加法 |
| 兼容别名 | `/api/*`（除 `/api/hooks/{hookId}` 外）一律作为 `/api/v1/*` 的别名，返回同样的响应并携带 `Deprecation: true`、`Link: </api/v1/...>; rel="successor-version"`；别名不设移除期限，未来 v2 出现时冻结为 v1 语义 |
| 入站 Hook 例外 | `/api/hooks/{hookId}` 是用户粘贴给外部系统的稳定 URL，故意不带版本；它路由到 M4 Webhook 接收逻辑 |
| WebSocket | 规范路径 `/api/v1/ws`；`/api/ws` 为 M0 兼容别名 |
| 版本头 | 所有响应携带 `X-ATEAM-API-Version: 1` 与 `X-Request-ID` |
| 文档写法 | 其他文档中的 `/api/...` 一律解释为对应的 `/api/v1/...`；新增端点只登记在 5.13 的端点总表 |

理由：M1 里程碑、任务模块、协作模块、安全模块与 M4 文档混用了带版本与不带版本的路径。若同时维护两套语义，任何一侧的校验、错误码或分页都会漂移。本章统一规定「规范路径 v1、`/api` 永久别名」，里程碑文档中的写法可直接工作，但新增能力只在 v1 定义。

### 5.1 资源总览

| 资源 | M0 路径（已实现） | 规范路径（M1 起） | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| Health | `GET /api/health` | `GET /api/v1/health` | M0 已实现 | 存活与版本；M1 增加数据库与迁移状态 |
| Meta | 无 | `GET /api/v1/meta` | 计划 M1 | Runtime、限制值、事件目录版本、权限模式等能力发现 |
| Workspace | 无 | `/api/v1/workspaces` | 计划 M1 | 产品级工作区；`/api/v1/projects` 为别名至 M2 |
| Task | `/api/tasks` | `/api/v1/tasks` | M0 已实现 CRUD | M1 增加分页、过滤、状态机、归档、revision |
| Agent | `/api/agents` | `/api/v1/agents` | M0 已实现 CRUD | M1 增加 runtime 校验、AgentVersion、归档 |
| AgentVersion | 无 | `/api/v1/agents/{id}/versions` | 计划 M1 | 不可变配置快照；M2 增加发布体验 |
| Run | `/api/runs`、`/api/tasks/{id}/runs` | `/api/v1/runs` | M0 已实现 | M1 增加 retry、merge、分页、快照、workspace 摘要 |
| Run Event | `/api/runs/{id}/events` | `/api/v1/runs/{id}/events` | M0 已实现 | M1 增加游标、类型过滤、唯一序号 |
| Artifact | 无 | `/api/v1/artifacts` | 计划 M1 | diff、测试报告、截图、日志包、说明 |
| Evidence | 无 | `/api/v1/evidence` | M2 | 结构化完成证明，绑定契约条目；M1 的 DoD 基于 Artifact |
| Review / ReviewComment | 无 | `/api/v1/reviews` | 计划 M1 | 人工评审结论、阻塞意见与证据快照 |
| Deliverable（契约） | 无 | `/api/v1/deliverables` | 计划 M2 | 交付物契约与版本；`/api/v1/contracts` 为别名 |
| Approval | 无 | `/api/v1/approvals` | 计划 M2 | 高风险动作审批，M1 合并由 Review + confirm 把关 |
| Skill | 无 | `/api/v1/skills` | 计划 M2 | 可复用技能包，版本不可变 |
| Machine | 无 | `/api/v1/machines` | 计划 M3 | 远程 Runner 注册、心跳、能力 |
| Runner / Lease | 无 | `/api/v1/runner` | 计划 M3 | 租约领取、续约、事件与证据上传 |
| Event Log | 无 | `/api/v1/events` | 计划 M1 | 全局事件序号与重放来源 |
| Inbox | 无 | `/api/v1/inbox` | 计划 M2 | 收件箱与审批待办 |
| M4 自动化 | 无 | `/api/v1/schedules` 等 | 计划 M4 | 定时、Webhook、通知、插件、遥测、更新 |

### 5.2 M0 已实现端点

以下行为以当前代码为准，全部位于 `/api` 前缀下，无版本号。

| 方法 | 路径 | 成功状态 | 主要失败 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 200 | 无 | 返回 `status`、`version`、`time`；不检查数据库 |
| GET | `/api/tasks` | 200 | 500 | 返回全部 Task 数组，按 `createdAt` 降序 |
| POST | `/api/tasks` | 201 | 400、500 | `title` 必填；`status` 缺省 `backlog`；校验状态枚举 |
| GET | `/api/tasks/{id}` | 200 | 404、500 | 不存在返回 404 |
| PATCH | `/api/tasks/{id}` | 200 | 400、404、500 | 部分更新；`title` 不允许空串 |
| DELETE | `/api/tasks/{id}` | 204 | 404、500 | 硬删除，不清理关联 Run |
| GET | `/api/tasks/{id}/runs` | 200 | 500 | 按 `createdAt` 降序；不校验 Task 是否存在 |
| POST | `/api/tasks/{id}/runs` | 201 | 400、404、409、500 | 要求 `agentId`；Task 必须为 `todo`/`in_progress`/`in_review`；创建后异步入队 |
| GET | `/api/agents` | 200 | 500 | 全部 Agent 数组，按 `createdAt` 降序 |
| POST | `/api/agents` | 201 | 400、500 | `name` 必填；缺省 `runtime=mock`、`workspaceMode=worktree`、`maxConcurrency=1`、`timeoutMinutes=60` |
| GET | `/api/agents/{id}` | 200 | 404、500 | 不存在返回 404 |
| PATCH | `/api/agents/{id}` | 200 | 400、404、500 | 部分更新 |
| DELETE | `/api/agents/{id}` | 204 | 404、500 | 硬删除，不检查进行中的 Run |
| GET | `/api/runs` | 200 | 500 | 全部 Run 数组，按 `createdAt` 降序 |
| GET | `/api/runs/{id}` | 200 | 404、500 | 不存在返回 404 |
| GET | `/api/runs/{id}/events` | 200 | 500 | 按 `seq` 升序；不校验 Run 是否存在 |
| POST | `/api/runs/{id}/cancel` | 200 | 404、500 | 终态 Run 重复取消返回 200 原对象；否则标记 `cancelled` |
| GET | `/api/ws` | 101 | 握手失败 | WebSocket 事件流，广播全部事件 |
| GET | 非 `/api/*` 路径 | 200 | 404（仅 `/api/*`） | 静态 SPA；文件不存在时回退 `index.html` |

请求与响应约定（M0 实际行为）：

- 请求体上限 1 MiB，通过 `io.LimitReader` 截断后解码；超限表现为 JSON 解码错误并返回 400。
- 响应均为 `application/json; charset=utf-8`；`DELETE` 返回 204 且无 body。请求通常为 JSON，但 M0 不校验请求头（见下一条）。
- **M0 不校验请求 `Content-Type`**：任意类型请求体都会进入 JSON 解码；M1 起非 `application/json` 的写请求返回 415。
- 响应结构直接是领域对象的 JSON 序列化，例如 Task 的字段为 `id`、`title`、`description`、`status`、`priority`、`assigneeType`、`assigneeId`、`parentId`、`labels`、`createdAt`、`updatedAt`。
- ID 为 24 位小写十六进制字符串（12 字节随机数）；客户端必须将其视为不透明字符串，不得解析格式。
- 未知 JSON 字段被忽略；`PATCH` 通过指针字段区分「字段缺失」与「显式传值」，但无法用 `null` 清空字符串字段。
- CORS 反射请求的任意 `Origin`，允许 `GET/POST/PATCH/DELETE/OPTIONS` 与 `Content-Type` 请求头；`OPTIONS` 直接返回 204。
- WebSocket 升级不校验来源，不处理客户端消息；服务端每 30 秒发送 ping，读超时 60 秒，发送缓冲区满时断开慢客户端。

### 5.3 M0 行为细节与已知缺口

这些缺口是 M1 需求的事实依据，必须在设计与测试中显式处理，不能把 M0 描述为完整闭环。

**G-01 排队 Run 的取消存在竞态。** 取消端点只在 Worker 已经注册 `cancel` 函数时才真正取消上下文；对于仍在队列中的 Run，API 会把状态改为 `cancelled`，但 Worker 随后仍可能取到该 ID 并开始执行，因为执行入口没有重新检查 Run 状态。M1 必须在 Worker 取到任务后先读取并判断终态，终态直接跳过。

**G-02 进程重启后无恢复策略。** 调度队列在内存中；服务重启后 `queued`/`preparing`/`running` 的 Run 不会继续，也不会自动失败。M1 需要定义启动恢复：`queued` 可重新入队，`preparing`/`running` 因上下文已丢失应标记为 `failed` 且 `errorCode=interrupted`、`failureDetail=app_restart`，并在事件日志中说明。

**G-03 队列满时 Run 可能永久停留 `queued`。** 入队使用 5 秒超时的后台 goroutine，失败只记录日志；HTTP 已经返回 201。M1 应在创建前同步确认队列容量：满时返回 `503 QUEUE_FULL` 且不创建 Run；若创建后入队因存储异常失败，则把 Run 标记为 `failed`（`runtime_error`/`scheduler_internal`），不能留下无主的 queued 记录。

**G-04 嵌套路径不校验父资源。** `GET /tasks/{id}/runs` 对不存在的 Task 返回空数组，`GET /runs/{id}/events` 对不存在的 Run 返回空数组。M1 统一返回 404，避免客户端把「不存在」误判为「没有数据」。

**G-05 Runtime 值未校验且会静默回退。** agent 写入时接受任意 `runtime` 字符串，执行时 `Registry.Get` 找不到就回退到 `mock`，导致用户以为在跑 Claude Code，实际只是模拟。M1 在创建/更新时校验枚举并返回 400；执行时缺失适配器应让 Run 失败并给出 `runtime_error`/`runtime_missing`。

**G-06 Worktree 与 Branch 尚未实现。** `workspace.Manager.Prepare` 只创建每 Run 的普通目录，`workspaceMode` 参数未被使用；`Run.Branch` 永远为空，`Run.Worktree` 只是目录路径。M1 由 Workspace/Git 模块接管，API 需要把它们填充为真实分支与 worktree 路径，并提供清理语义。

**G-07 权限与并发字段仅存储未执行。** `allowedPaths`、`allowedCommands`、`maxConcurrency`、`model` 已经进入 Agent schema，但未被调度器或 Runtime 使用；`claude` adapter 只执行 `claude -p <prompt>`，没有传 model、权限或流式解析。M1 至少把 model、权限模式与 timeout 传递给适配器；路径/命令权限在 M2 强制执行。

**G-08 Run 事件序号没有唯一约束。** `run_events.seq` 由单次执行内的计数器生成，进程重启或未来重试会产生冲突；表上只有 `(run_id, seq)` 普通索引。M1 添加唯一约束并在写事件时使用事务或原子自增。

**G-09 时间精度不一致。** 创建响应直接返回内存中的纳秒时间，重新读取时从 SQLite 毫秒时间戳还原，同一对象在不同请求中可能相差亚毫秒。M1 统一在领域层截断到毫秒。

**G-10 本地 API 无认证且 CORS 过于宽松。** 任意网页都能向 `127.0.0.1:8787` 发起跨源请求并读取响应；WebSocket 也不校验 Origin。M1 收紧 Origin 白名单并校验 WebSocket 来源；M2.1 引入本地会话令牌；M3 引入团队身份。

**G-11 请求体超限返回 400 而非 413。** 当前 `LimitReader` 截断后由 JSON 解码器报错。M1 使用 `http.MaxBytesReader` 并返回 `413 PAYLOAD_TOO_LARGE`。

**G-12 迁移器过于简单。** 迁移文件按分号切分语句，字符串字面量或触发器中的分号会破坏迁移；没有校验和、没有备份、没有降级说明。M1 重做迁移器，见第 9 节。

**G-13 删除产生孤儿数据。** 删除 Task/Agent 不处理关联 `runs` 与 `run_events`，也没有外键约束。M1 改为归档默认、硬删除受限，并为新表增加外键；Run 历史保留。

**G-14 列表无分页、过滤、排序、搜索。** 所有列表全量返回，数据量增长后 UI 与 CLI 都会退化。M1 引入统一列表语义，见第 8 节。

**G-15 错误体只有字符串。** `{"error":"..."}` 无法让客户端区分校验失败、冲突、未找到，也没有请求 ID 关联日志。M1 引入结构化错误，见第 7 节。

**G-16 环境变量示例与实现不一致。** `.env.example` 列出 `ATEAM_ADDR`、`ATEAM_DB`、`ATEAM_WEB_DIR`，但 `cmd/ateam` 与 `app.DefaultConfig` 未读取环境变量，仅支持命令行 flag。M1 统一配置优先级，并在 `.env.example` 补齐 `ATEAM_LOG_LEVEL`、`NO_COLOR`、`ATEAM_SERVER`。

**G-17 健康检查不覆盖依赖。** `/api/health` 只证明进程存活，不检查数据库可读写、迁移版本与磁盘空间。M1 增加 `database`、`schemaVersion`、`dataDir` 可写性等字段。

**G-18 HTTP 服务缺少超时与限制。** 未设置 `ReadHeaderTimeout`、`ReadTimeout`、`WriteTimeout`、`MaxHeaderBytes`。M1 补齐，避免本机恶意或异常客户端占用资源。

**G-19 `ateam runner` 是占位命令。** 当前打印提示并以 0 退出；M3 才实现远程 Runner。CLI 文档与脚本不得依赖其成功语义。

**G-20 TypeScript 客户端能力有限。** 没有 WebSocket 封装、没有结构化错误类型、没有分页参数、没有取消请求能力；Web UI 直接使用原生 `WebSocket` 并在任意事件后全量刷新，属于可用的临时方案。

**G-21 请求 `Content-Type` 未校验。** 见 5.2；M1 的 415 校验是新增行为，客户端需显式设置 JSON 头。

**G-22 ID 生成存在退化路径。** `domain.NewID()` 在随机源失败时返回时间戳字符串的十六进制，长度与常规 24 位不一致。M1 移除退化逻辑，随机失败时返回错误而不是生成异形主键。

**G-23 桌面壳与 CLI 的端口发现缺失。** 桌面壳通过 `StartLocal` 绑定 `127.0.0.1:0`（随机端口），CLI 默认连 `127.0.0.1:8787`，桌面模式下 CLI 与 CI 默认连不上服务。M1 定义实例发现文件，见 10.2。

### 5.4 Workspaces（产品级工作区）与 Project 别名

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/workspaces` | M1 | 列出工作区；M1 通常只有一个 `default` |
| POST | `/api/v1/workspaces` | M1 | 创建并绑定本地 git 仓库：`name`、`repoPath`、`defaultBranch`、`settings`。M1 若默认 Workspace 尚未绑定仓库，则绑定 `default` 并返回 200 与该对象，不新建第二条记录；M3 新建返回 201 |
| GET | `/api/v1/workspaces/{id}` | M1 | 详情，含 `repoPath`、`defaultBranch`、`status`、`archivedAt` |
| PATCH | `/api/v1/workspaces/{id}` | M1 | 更新名称与设置；修改 `repoPath`/`defaultBranch` 前必须无活跃 Run |
| POST | `/api/v1/workspaces/{id}/archive` | M3 | 归档工作区；归档后只读 |
| DELETE | `/api/v1/workspaces/{id}` | M3 | 删除/彻底清理工作区，需 Approval；M1-M2 默认 Workspace 返回 `409 WORKSPACE_PROTECTED` |
| GET | `/api/v1/workspaces/{id}/members` | M3 | Team Workspace 成员与角色 |
| GET | `/api/v1/projects` 等 | M1-M2 | `workspaces` 的兼容别名，返回相同资源；M3 起不再新增 |
| GET | `/api/v1/runs/{id}/workspace` | M1 | Run Workspace 元数据：路径、分支、`baseCommit`、`headCommit`、生命周期状态、清理状态 |

规则：

- M1 启动时创建 ID 固定为 `default` 的 Workspace，并把 M0 的 Task/Agent/Run 全部回填 `workspace_id='default'`；默认 Workspace 初始 `repoPath` 为空。M1 的首次 `POST /workspaces` 在默认 Workspace 未绑定时绑定并返回 `default`，不创建第二条记录；默认 Workspace 已绑定后再 `POST` 返回 `409 WORKSPACE_LIMIT_REACHED`。M1 禁止删除默认 Workspace，M3 解除单 Workspace 限制。
- 所有实体（Task、Agent、AgentVersion、Run、Artifact、Review、Deliverable、Approval、Skill、Crew、Machine、Runner；Evidence 从 M2 起）都带 `workspace_id`；跨 Workspace 引用返回 `409 WORKSPACE_MISMATCH`。
- 领域模型与任务模块中的 Project、`projectId` 与本节的 Workspace、`workspaceId` 是同一概念；数据库不建 `projects` 表。里程碑文档中的 `Task.projectId` 按 `workspace_id` 实现，`Run.projectId` 同理。`/api/v1/projects` 别名对 `workspaces` 的全部方法（GET/POST/PATCH/DELETE）生效，包括 `/projects/{id}/archive`。
- `GET /api/v1/runs/{id}/workspace` 是 M1 里程碑 `GET /api/runs/{id}/workspace` 的规范路径，返回 Run Workspace，而不是产品级 Workspace。
- 字段映射：M1 里程碑 Project 的 `localPath` → Workspace 的 `repoPath`，`baseBranch` → `defaultBranch`；`remote`、`worktreeRoot`、`verifyCommand`、`protectedBranches` 存入 `workspaces.settings`（键名沿用里程碑写法）。Run 的 `projectId` → `workspaceId`，`workspaceState` → `GET /runs/{id}/workspace` 的派生状态，`configSnapshotId` → `run_config_snapshots.id`，`failureCode` → `failureDetail`，`reviewStatus` → 最新 Review 状态派生字段。
- M1 里程碑的 `DELETE /api/projects/{id}` 若指向默认 Workspace，按领域模型 §3.1 返回 `409 WORKSPACE_PROTECTED`；测试夹具应使用独立临时数据目录或在测试后删除数据库，不应要求删除默认工作区。

### 5.5 计划端点：Tasks

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks` | M1 | 分页列表；支持 `status`、`assigneeType`、`assigneeId`、`label`、`parentId`、`q`、`sort`、`cursor`、`limit`、`includeArchived` |
| POST | `/api/v1/tasks` | M1 | 创建；校验标题、优先级、labels、父任务存在性、Workspace 归属 |
| GET | `/api/v1/tasks/{id}` | M1 | 详情；可选 `include=latestRun,runCount,artifacts,readiness` |
| PATCH | `/api/v1/tasks/{id}` | M1 | 部分更新；显式 `null` 清空 `assigneeId`/`parentId`；状态变更走 13.1 |
| DELETE | `/api/v1/tasks/{id}` | M1 | 归档（软删除）：M1 为「确认 + 阻止 + 归档」，存在活跃 Run 或未关闭 Review 时 409；M2.1 起归档进入 30 天恢复窗口（复用同一个 `archivedAt` 字段，不新增 `deletedAt`），窗口内可恢复，之后且无引用时才可物理清理 |
| POST | `/api/v1/tasks/{id}/archive` | M1 | `DELETE` 的别名，语义完全相同；设置 `archivedAt`，不删历史 |
| POST | `/api/v1/tasks/{id}/unarchive` | M2 | 恢复归档；M2.1 起同时覆盖软删除恢复 |
| POST | `/api/v1/tasks/{id}/restore` | M2 | `unarchive` 的兼容别名，语义完全相同 |
| GET | `/api/v1/tasks/{id}/runs` | M1 | 分页；父任务不存在返回 404 |
| POST | `/api/v1/tasks/{id}/runs` | M1 | 创建 Run；支持 `Idempotency-Key`；默认禁止同一 Task 并发活跃 Run |
| GET | `/api/v1/tasks/{id}/dependencies` | M2 | 任务依赖 DAG 的读取 |
| PUT | `/api/v1/tasks/{id}/dependencies` | M2 | 整体替换依赖；校验环路与同 Workspace |
| GET | `/api/v1/tasks/{id}/readiness` | M2 | 就绪状态与结构化原因（依赖、契约、审批、容量） |
| GET | `/api/v1/tasks/{id}/deliverables` | M2 | 该任务各交付物契约的聚合状态 |
| GET | `/api/v1/tasks/{id}/evidence` | M2 | 跨 Run 的证据聚合与 DoD 缺失清单；M1 的 DoD 直接基于 Artifact 与人工例外，不提供 Evidence 端点 |
| GET | `/api/v1/tasks/{id}/reviews` | M2 | 任务维度评审历史 |
| GET | `/api/v1/tasks/{id}/comments` | M2 | 任务评论与时间线 |
| POST | `/api/v1/tasks/{id}/comments` | M2 | 添加评论 |
| POST | `/api/v1/tasks/bulk` | M2 | 批量状态、指派、标签、归档 |

规则：

- M1 起 Task 状态变更受任务模块 §5.2 矩阵约束；非法迁移返回 `409 INVALID_STATUS_TRANSITION`，details 中列出当前状态允许的目标状态。本章 13.1 是该矩阵的引用副本，不独立定义语义。
- `parentId` 在 M1 仅支持一层父子（子任务），M2 由依赖 DAG 承担协作主模型；M1 写入时校验父任务存在、不能自指、不得成环、同 Workspace。
- 归档 Task 在默认列表中不可见；`includeArchived=true` 仅对本地单用户开放，M3 团队模式要求 workspace_admin 权限。归档不影响依赖满足：已 `done` 的任务归档后，下游仍视为依赖已满足；归档未完成任务时下游转为 `blocked`。
- 标签过滤采用 AND 语义：`label=ui&label=frontend` 表示同时包含两个标签。
- 删除 Task 不清理 Run；因为存在 Run 引用时删除已被拒绝，孤儿 Run 只可能来自 M0 数据，M1 迁移后由清理任务处理。

### 5.6 计划端点：Agents 与 AgentVersion

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/agents` | M1 | 分页；支持 `runtime`、`role`、`q`、`sort`、`includeArchived` |
| POST | `/api/v1/agents` | M1 | 创建；runtime 枚举校验；名称活跃唯一 |
| GET | `/api/v1/agents/{id}` | M1 | 详情；返回 `currentVersionId` 与技能绑定摘要 |
| PATCH | `/api/v1/agents/{id}` | M1 | 更新；执行语义变化时生成新 AgentVersion |
| DELETE | `/api/v1/agents/{id}` | M1 | 归档（软删除）：M1 为「确认 + 阻止 + 归档」，存在活跃 Run 或未关闭 Review 时 409 `AGENT_HAS_REFERENCES`；M2.1 起进入 30 天恢复窗口（`archivedAt`），之后且无引用时才可物理清理 |
| POST | `/api/v1/agents/{id}/archive` | M1 | `DELETE` 的别名，语义完全相同；历史 Run 仍可读 |
| POST | `/api/v1/agents/{id}/unarchive` | M2 | 恢复归档 |
| POST | `/api/v1/agents/{id}/restore` | M2 | `unarchive` 的兼容别名 |
| GET | `/api/v1/agents/{id}/versions` | M1 | 版本列表，按 `versionNumber` 降序 |
| GET | `/api/v1/agents/{id}/versions/{versionId}` | M1 | 版本快照与 `contentHash` |
| GET | `/api/v1/agents/{id}/runs` | M1 | 该 Agent 的 Run 分页列表 |
| GET | `/api/v1/agents/{id}/skills` | M2 | 已绑定技能与固定版本 |
| POST | `/api/v1/agents/{id}/skills` | M2 | 绑定技能，必须指定版本 |
| DELETE | `/api/v1/agents/{id}/skills/{skillId}` | M2 | 解绑技能 |

规则：

- `runtime` 允许值由服务端 `meta` 端点公布；M1 包含 `mock`、`claude`，M2 增加 `codex`。写入未知值返回 `400 VALIDATION_FAILED`。
- 名称唯一性只针对未归档的 Agent；冲突返回 `409 AGENT_NAME_CONFLICT`。
- `allowedPaths` 使用工作区相对 glob；`allowedCommands` 使用可执行名或前缀匹配。M1 存储与展示，M2 由 Runtime 执行前强制校验，拒绝时 Run 失败为 `permission_denied`（HTTP 层不返回 `POLICY_DENIED` 以外的 Run 码）。
- `permissionMode` 取 `read_only`、`controlled_edit`、`full_access`，默认 `controlled_edit`；`full_access` 必须在 UI 显式开启并显示风险警示，生效模式写入 `run_config_snapshots` 与 Run 事件。
- 任何改变执行语义的更新（instructions、runtime、model、workspaceMode、超时、权限、技能）都生成新的 AgentVersion；纯展示字段（description）不生成。M1 自动快照、无草稿/发布 UI；M2 增加草稿/发布体验。
- Run 创建时固定 `agentVersionId`；Agent 继续编辑不影响该 Run。

### 5.7 计划端点：Runs

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/runs` | M1 | 分页；支持 `taskId`、`agentId`、`status`、`trigger`、`since`、`until`、`q`、`sort` |
| GET | `/api/v1/runs/{id}` | M1 | 详情；包含 `errorCode`、`failureDetail`、`exitCode`、`agentVersionId`、workspace 摘要、artifact/review 摘要 |
| GET | `/api/v1/runs/{id}/events` | M1 | 游标分页；`afterSeq`、`limit`、`type`；父 Run 不存在返回 404 |
| POST | `/api/v1/runs/{id}/cancel` | M1 | 幂等取消；排队中也能可靠取消（修复 G-01） |
| POST | `/api/v1/runs/{id}/retry` | M1 | 基于原 Run 的 Task/Agent 创建新 Run；原 Run 必须为终态；`attempt` 递增 |
| POST | `/api/v1/runs/{id}/merge` | M1 | 受评审门保护的合并；请求体见 13.3 |
| POST | `/api/v1/runs/{id}/pull-request` | M3 | 创建代码托管平台 PR；需要审批，返回 PR URL |
| GET | `/api/v1/runs/{id}/workspace` | M1 | Run Workspace 元数据 |
| GET | `/api/v1/runs/{id}/diff` | M1 | 结构化 diff 与统计；大 diff 截断并给出 Artifact 引用 |
| GET | `/api/v1/runs/{id}/artifacts` | M1 | 该 Run 的证据列表 |
| GET | `/api/v1/runs/{id}/evidence` | M2 | DoD 检查结果与证据列表；M1 返回 `404 NOT_FOUND`（Evidence 从 M2 起） |
| GET | `/api/v1/runs/{id}/reviews` | M1 | 该 Run 的评审列表 |
| POST | `/api/v1/runs/{id}/reviews` | M1 | 创建评审或直接提交结论，见 5.8 |
| POST | `/api/v1/runs/{id}/approvals` | M2 | 为该 Run 的动作创建审批请求（也可用通用 `/approvals`） |

规则：

- 创建 Run 时要求 Task 处于可执行状态：M1 仅 `todo`、`in_progress`；`in_review` 必须先 `changes_requested` 回到 `in_progress`。M2 的返工允许从 `in_review` 创建新 Run，但前提是先创建新 Review 或记录取代旧评审的原因。其余状态返回 `409 TASK_NOT_EXECUTABLE`，details 给出允许状态。
- M1 默认同一 Task 同时只允许一个活跃 Run（`queued`/`preparing`/`running`），冲突返回 `409 RUN_ALREADY_ACTIVE` 并返回现有 Run；M2 通过任务级 `parallelRunPolicy` 或 `allowConcurrent=true` 显式放开，UI 必须提示风险。
- `trigger` 取值固定为领域模型 §3.6 的六值：`manual`、`retry`、`schedule`、`webhook`、`dependency`、`crew`；M1 只产生 `manual`/`retry`，M2 增加 `dependency`/`crew`，M4 增加 `schedule`/`webhook`。不得新增第七值（包括 `api`）；API 客户端触发的 Run 归入 `manual`。M0 接受任意字符串。
- Run 终态不可变；任何更新终态 Run 的尝试返回 `409 INVALID_STATUS_TRANSITION`，取消除外（幂等返回原对象）。
- `retry` 不复用旧 worktree；它创建新的 Run 与新的 Run Workspace，事件中记录 `retryOf`，`attempt` 递增。
- 合并校验顺序与错误码见 13.3；任一条件失败不产生 git 副作用。
- 合并策略枚举统一为 `squash`、`merge`、`rebase`，默认 `squash`；M1 支持 `squash` 与 `merge`，M2 增加 `rebase`；任何里程碑都不允许 `force push`。
- Run 响应可包含派生字段 `workspaceState`（`provisioning`/`active`/`review`/`archived`/`removed`）与 `reviewStatus`，分别由 Run Workspace 状态与最新 Review 状态计算，不单独存列；M2 起客户端应优先使用 `GET /runs/{id}/workspace` 与 `GET /runs/{id}/reviews`。M1 里程碑中的 `preparingAt` 由首个 `run.preparing` 事件时间派生，不新增数据库列。

### 5.8 计划端点：Artifacts、Evidence、Reviews 与 ReviewComment

Artifacts：

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/artifacts/{id}` | M1 | 元数据：类型、大小、sha256、来源 Run、创建时间、`redactionState` |
| GET | `/api/v1/artifacts/{id}/content` | M1 | 流式内容；设置 Content-Type 与 ETag（sha256）；文本可 `?maxBytes=` 截断预览 |
| GET | `/api/v1/runs/{id}/artifacts` | M1 | 按类型与时间排序的证据列表 |
| GET | `/api/v1/tasks/{id}/artifacts` | M2 | 跨 Run 聚合的证据视图 |
| DELETE | `/api/v1/artifacts/{id}` | M2 | 删除证据并同步删除磁盘文件。M2 本地模式要求 `confirm=true` 二次确认；M3 团队模式要求 workspace_admin 权限或有效 Approval。不得删除仍被 Review 引用的证据 |

Artifact 类型（M1）：`diff`、`test_report`、`screenshot`、`log_bundle`、`note`、`file`。M2 可扩展 `ui_review`、`deploy_plan`、`contract_snapshot` 等角色交付物类型，但必须登记在 `meta` 中。M1 的 `screenshot` 是可选 Artifact，仅用于查看，不作为 DoD 必需项；M2 起 UI 类任务的 DoD 才要求关键状态截图。

规则：

- Artifact 内容只通过 `artifactId` 访问，API 永不接受任意文件路径，避免目录穿越。
- 服务端在接收 Runtime 声明的产物时，校验相对路径位于 Run Workspace 内、解析符号链接后仍位于工作区内、大小不超过单文件与单 Run 限制。单文件默认上限 50 MiB（与领域模型一致）。
- 摘要使用 SHA-256；下载响应带 `ETag`，条件请求可返回 304。
- 文本预览默认最多 1 MiB，超出部分返回截断标记与总大小；二进制只提供下载。
- 证据采集前必须脱敏；命中密钥模式时 `redactionState` 不为 `none`，不得被标记为 verified。
- M1 里程碑的 Artifact 字段映射：`title` → `name`，`contentType` → `mediaType`；`origin`、`truncated`、`supersedesId` 与本章一致。

Evidence：

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/evidence/{id}` | M2 | 证据详情，返回 `status`（`passed`/`failed`/`missing`/`waived`）与 `validity`（`valid`/`unverified`/`invalid`） |
| GET | `/api/v1/runs/{id}/evidence` | M2 | Run 的证据与 DoD 检查；M1 不提供该端点 |
| GET | `/api/v1/tasks/{id}/evidence` | M2 | 任务聚合证据与缺失清单；M1 不提供该端点 |
| POST | `/api/v1/runs/{id}/evidence` | M2 | 人工补充证据（引用同 Run 的 Artifact） |
| POST | `/api/v1/evidence/{id}/verify` | M2 | 人工或系统复核：写入/更新 `status` 与 `validity`（如 `passed`/`valid`、`failed`/`invalid`），并记录 `verifiedBy`、`verifiedAt` |

规则：以领域模型 §3.9.2 为唯一 Evidence 模型，`status` 与 `validity` 正交；API 旧取值按 `present → missing`、`verified → passed`、`rejected → failed` 归一化，响应必须同时返回 `status` 与 `validity`。Evidence 只能引用同 Task、同 Run 的 Artifact；Review 执行 `approve` 前，契约要求条目的 Evidence 必须为 `passed` 或 `waived`，且 `validity` 不得为 `invalid`。Agent 只能提交 `missing`/`failed` 等初始判定，人工才能确认 `passed`。证据一旦写入不可修改，只能通过 `supersedesId` 追加新记录。

Reviews：

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/reviews/{id}` | M1 | 评审详情，含 `status`、`reviewerId`、`evidenceSnapshotHash`、`requiresMerge`、`supersededBy` |
| GET | `/api/v1/runs/{id}/reviews` | M1 | 该 Run 的评审列表 |
| POST | `/api/v1/runs/{id}/reviews` | M1 | 创建评审。请求体含 `decision`（可选）、`comment`、`artifactIds`、`comments`；省略 `decision` 时创建 `pending`，提供时直接进入 `approved`/`changes_requested` |
| POST | `/api/v1/reviews/{id}/decision` | M1 | 对已有 Review 做决定：`approve` 或 `changes_requested`，带 `comment` |
| POST | `/api/v1/reviews/{id}/comments` | M1 | 添加 ReviewComment：`artifactId`、`filePath`、`line`、`severity`、`body` |
| GET | `/api/v1/reviews/{id}/comments` | M1 | 评审意见列表 |
| POST | `/api/v1/review-comments/{id}/resolve` | M1 | 解决 blocking 意见 |
| GET | `/api/v1/tasks/{id}/reviews` | M2 | 任务维度评审历史 |

规则：

- Review 状态机以领域模型 §4.5 为准：`pending → in_review → approved | changes_requested | superseded | cancelled`；`approved` 可被新 Run 置为 `superseded`。M1 只使用 `pending`、`approved`、`changes_requested` 与 `superseded`。Review 没有 `expired` 状态；评审失效统一由 `superseded` 表达，合并校验由此返回 412 并要求重新评审。
- 评审不可修改结论，只能通过新 Review 取代旧 Review；ReviewComment 可追加，blocking 意见只能标记解决，不能删除。
- 同一评审人对同一 Run 的结论按最新有效 Review 计算；`changes_requested` 后必须出现新的 `approved` 才能合并。
- M1 本地模式评审人记为 `local`；M3 记录真实成员 ID 并写入审计。
- 评审可引用 Artifact ID，服务端校验 Artifact 属于该 Run 或该 Task，防止跨任务引用。
- 合并必须携带 `reviewId`，且 Review 必须为 `approved` 且未被 `superseded`，证据快照哈希与当前证据一致；不存在单独的 `review.expired` 事件或状态。
- M1 里程碑的 Review 字段映射：`reviewer` → `reviewerId`，`decision` → `status`（`approve` → `approved`，`request_changes` → `changes_requested`），`comment` → `decisionNote`；新增字段以本章为准。

### 5.9 计划端点：Deliverables（交付物契约）与 Approvals

Deliverables（M2；`/api/v1/contracts` 是兼容别名）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/tasks/{id}/deliverables` | 聚合契约与交付物状态 |
| GET | `/api/v1/deliverables/{id}` | 读取当前版本 |
| PATCH | `/api/v1/deliverables/{id}` | 编辑草稿；已冻结版本不可原地修改 |
| POST | `/api/v1/deliverables/{id}/submit` | 提交评审（评审型契约） |
| POST | `/api/v1/deliverables/{id}/validate` | 校验并自动冻结（校验型契约：build、test_report、deploy_plan） |
| POST | `/api/v1/deliverables/{id}/freeze` | 请求冻结（评审型契约，内部校验审批门） |
| POST | `/api/v1/deliverables/{id}/revise` | 创建修订版本 |
| POST | `/api/v1/deliverables/{id}/withdraw` | 撤回草稿或已提交版本 |
| GET | `/api/v1/deliverables/{id}/versions` | 版本历史 |

契约状态：`draft`、`proposed`、`frozen`、`superseded`、`withdrawn`；只有 `frozen` 能满足下游 `required_contracts`。任务引用字段为 `required_contracts`、`required_version`（精确版本，默认 pin）、`allow_newer`（默认 false）与 `min_version`（仅 `allow_newer=true` 时生效）。字段语义以协作模块 §5.4 为准。契约实体唯一名称为 Deliverable（表 `deliverables`），版本历史在 `contract_versions`；Task 上的 `deliverableContract` 是该实体当前版本的投影，`Task.contract` 是待弃用别名，不得作为第二份事实来源。

Approvals（M2）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/approvals` | 分页；支持 `status`、`actionType`、`taskId`、`runId`、`sort` |
| POST | `/api/v1/approvals` | 创建审批请求：`actionType`、`targetType`、`targetId`、`taskId`、`runId`、`params`、`summary`、`reason`、`expiresIn` |
| GET | `/api/v1/approvals/{id}` | 详情，包含 `actionFingerprint`、`paramsHash`、`contentHash`、状态、请求人与决策人 |
| POST | `/api/v1/approvals/{id}/decision` | 人工决策：`approve` 或 `reject`，带 `comment` |
| POST | `/api/v1/approvals/{id}/approve` / `reject` | `decision` 的兼容别名；M2 里程碑写法，行为相同 |
| POST | `/api/v1/approvals/{id}/consume` | 受控消费端点：执行动作时消费已批准审批，防止重复使用 |
| POST | `/api/v1/approvals/{id}/revoke` | 执行前撤销未消费审批 |

`actionType` 枚举（**全库唯一权威定义**，`02-domain-model.md` §3.11 与 `security-and-permissions.md` §5.2 均引用此处，不得各自维护第二套）：`merge`、`push`、`deploy_staging`、`deploy_prod`、`delete_task`、`delete_agent`、`delete_workspace`、`permission_escalation`、`command_allowlist_change`、`high_risk_command`、`contract_break`、`design_review`、`api_contract_review`、`crew_plan`、`scope_change`、`destructive_operation`、`organization_delete`、`owner_transfer`、`runner_revoke`、`secret_rotate`。**不提供 `force_push` 动作**：M1-M4 一律禁止 force push，因此不存在可审批的例外。`deploy_prod` 只生成审批记录与人工检查单，ATeam 不提供自动执行入口。M2 里程碑的 `subject_type`/`subject_id`/`fingerprint` 分别映射为 `targetType`/`targetId`/`actionFingerprint`。

### 5.10 计划端点：Skills 与 Machines

Skills（M2）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/skills` | 分页；支持 `q`、`tag`、`role` |
| POST | `/api/v1/skills` | 创建技能（稳定身份、slug、说明） |
| GET | `/api/v1/skills/{id}` | 详情与版本列表 |
| PATCH | `/api/v1/skills/{id}` | 更新名称、说明等非版本字段 |
| POST | `/api/v1/skills/{id}/versions` | 发布新版本；语义化版本，内容不可变 |
| GET | `/api/v1/skills/{id}/versions/{version}` | 版本内容与哈希 |
| POST | `/api/v1/skills/{id}/archive` | 归档技能；已有绑定继续可用 |
| DELETE | `/api/v1/skills/{id}` | 仅无绑定时硬删除，否则 409 并列出引用方 |
| GET/POST/DELETE | `/api/v1/agents/{id}/skills` | Agent 技能绑定与解绑 |

规则：`skill_versions` 按 `(skill_id, version)` 唯一，每个版本含 `content_hash` 与 `manifest`；`agent_skills` 外键指向 `skill_version_id`，不能只指向 skill。Run 配置快照记录技能版本集合。

Machines（M3）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/machines` | 列表；`status`、`platform`、`q` |
| POST | `/api/v1/machines` | 兼容别名，等价 `POST /api/v1/machines/register-tokens`（Admin 创建注册令牌） |
| POST | `/api/v1/machines/register-tokens` | Admin 创建一次性注册令牌（15 分钟有效，明文只返回一次）；旧别名 `/machines/tokens` |
| POST | `/api/v1/machines/register` | 兼容别名，等价 `/api/v1/runner/register`；只接受注册令牌 |
| POST | `/api/v1/machines/{id}/heartbeat` | 兼容别名，等价 `/api/v1/runner/heartbeat`；必须使用机器签名认证 |
| PATCH | `/api/v1/machines/{id}` | 改名、改标签、置 `draining`/`disabled` |
| POST | `/api/v1/machines/{id}/revoke` | 撤销机器；立即拒绝新租约并取消未开始 Job |
| DELETE | `/api/v1/machines/{id}` | 仅无 Runner 与租约时移除 |

规则：

- 安全模块端点表中的 `POST /api/v1/machines` 是创建注册令牌的旧写法，等价于 `POST /api/v1/machines/register-tokens`；机器注册本身由 Runner 调用 `/api/v1/runner/register` 完成。
- Machine 业务状态为五态：`pending`（注册未完成）、`online`、`offline`、`draining`、`disabled`；`revoke` 是动作与事件名，不是状态值，`revoked` 不再是合法状态。`draining` 不再领取新 Run，但允许运行中的 Run 完成；`disabled` 由管理员显式停用，不自动恢复。
- 心跳每 15 秒一次；连续 45 秒未收到心跳标记 `offline`；租约 90 秒未续期视为过期。数值以领域模型 §3.14、安全模块 §7.2 与 M3 TEAM-021/022 为准；运行时模块 §7.4 的 30 秒 × 3 次为旧值，需同步修订。
- 注册令牌默认 15 分钟有效、仅可使用一次；服务端只保存哈希与过期时间。
- 服务端只把满足 Runtime、OS/架构、标签与并发容量的 Run 以租约下发；无匹配时 Run 保持 `queued` 并发出 `run.unschedulable`。

### 5.11 计划端点：Runner 作业协议（M3）

Runner 使用机器密钥对 + 签名挑战认证，不使用长期 Bearer 令牌。控制面的人类 API 使用会话令牌或个人访问令牌，两者认证域分离。

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/runner/register` | 一次性注册令牌 | 提交机器信息、OS/架构、标签、能力与协议版本；返回 `machineId`、`runnerId`、`challenge`、`protocolVersion` |
| POST | `/api/v1/runner/auth/verify` | 签名挑战 | 用机器私钥签名挑战，换取短期会话票据（TTL 15 分钟） |
| POST | `/api/v1/runner/heartbeat` | 机器签名 | 上报负载、运行中 Job、磁盘余量、版本、能力变化；响应可包含租约指令与 `desiredState` |
| POST | `/api/v1/runner/leases/claim` | 机器签名 | 按空闲槽位请求下一个匹配租约；无匹配返回 204 |
| POST | `/api/v1/runner/leases/{id}/renew` | 机器签名 | 续租；返回新的 `expiresAt` |
| POST | `/api/v1/runner/leases/{id}/events` | 机器签名 | 批量上报事件，携带 `runId` 与 `seq`；重复事件幂等去重 |
| POST | `/api/v1/runner/leases/{id}/artifacts` | 机器签名 | 开始 Artifact 上传，返回 `uploadId` 与分片大小 |
| PUT | `/api/v1/runner/leases/{id}/artifacts/{uploadId}/chunks/{n}` | 机器签名 | 分片上传；校验哈希 |
| POST | `/api/v1/runner/leases/{id}/artifacts/{uploadId}/complete` | 机器签名 | 完成上传并登记 Artifact/Evidence |
| POST | `/api/v1/runner/leases/{id}/release` | 机器签名 | 主动释放租约（成功、失败或放弃） |

租约模型：`leaseId`、`runId`、`runnerId`、`machineId`、`status`（`active`、`expired`、`released`、`cancelled`）、`expiresAt`、`renewedAt`、`fencedToken`。规则：

- 同一 Run 同时只允许一个有效租约；旧租约持有者的事件与 Artifact 上传被拒绝，返回 `409 RUNNER_FENCED`。
- Runner 状态取 `idle`、`busy`、`draining`、`offline`、`disabled`（五态，与 Machine 一致地不引入 `revoked`/`unknown`）；`revoke` 只是动作与事件名。Machine 状态取 5.10 的五态。两者不得混用。
- 租约过期后先标记 `interrupted`，不自动跨机重跑；必须人工确认后才能重试。
- Runner 版本与协议不兼容时：拒绝新租约（`409 RUNNER_VERSION_INCOMPATIBLE`），但允许完成已领取的 Run（对齐 M3 TEAM-025）。
- 事件上报必须携带 `runId + seq`；控制面按 `seq` 排序并幂等去重，不静默丢失。
- 事件与 Artifact 在断网时缓存在 Runner 本地；超过缓冲上限时上报失败并把 Run 记为 `failed`/`runner_lost`。

### 5.12 计划端点：M4 自动化、通知、插件、遥测与更新

所有第一方端点规范前缀为 `/api/v1`；`/api/*` 别名同样可用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/schedules` | 列出/创建定时规则（`cron`、`timezone`、`taskTemplateId`、`agentId`、`enabled`、`overlapPolicy`） |
| GET/PATCH/DELETE | `/api/v1/schedules/{id}` | 读取/更新/删除；删除保留触发历史 |
| POST | `/api/v1/schedules/{id}/run` | 立即运行，记录 `source=manual` |
| POST | `/api/v1/schedules/{id}/pause` | 暂停，立即生效 |
| GET | `/api/v1/schedules/{id}/triggers` | 触发历史，分页 |
| GET/POST | `/api/v1/webhooks` | 列出/创建 Webhook；创建时返回一次性密钥 |
| PATCH/DELETE | `/api/v1/webhooks/{id}` | 更新/删除；删除立即撤销 |
| POST | `/api/v1/webhooks/{id}/rotate` | 轮换密钥，允许有限重叠窗口 |
| GET | `/api/v1/webhooks/{id}/deliveries` | 投递日志，支持重放 |
| POST | `/api/hooks/{hookId}` | 入站 Webhook；HMAC 签名 + 时间戳 + `dedupeKey`，返回 202/4xx |
| GET | `/api/v1/notifications` | 通知列表，支持未读筛选 |
| PATCH | `/api/v1/notifications/{id}` | 标记已读 |
| GET/PATCH | `/api/v1/notification-preferences` | 通知偏好 |
| GET/POST | `/api/v1/plugins` | 列出/安装插件 |
| PATCH/DELETE | `/api/v1/plugins/{id}` | 启用/停用/卸载；停用立即撤权 |
| GET/POST/DELETE | `/api/v1/plugins/{id}/grants` | 插件授权范围 |
| GET/PATCH | `/api/v1/telemetry` | 遥测同意与状态；默认关闭 |
| POST | `/api/v1/telemetry/export` | 导出本地遥测记录 |
| DELETE | `/api/v1/telemetry/local` | 删除本地遥测记录，二次确认 |
| GET | `/api/v1/updates/status` | 更新状态 |
| POST | `/api/v1/updates/check` | 手动检查，超时 3 秒 |
| POST | `/api/v1/updates/install` | 安装已下载更新，需用户确认 |
| GET | `/api/v1/updates/log` | 更新日志 |

M4 规则：Schedule/Webhook 创建的任务默认进入 Backlog，不自动启动 Run、不自动评审或合并；自动触发必须记录 `automationId` 与 `dedupeKey`；插件只能通过登记的事件与 API 扩展，不得绕过审批门；遥测默认关闭且不采集任务内容、代码与文件路径。

### 5.13 系统端点与端点总表

系统端点：

| 方法 | 路径 | 里程碑 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | M1 | 返回 `status`、`version`、`apiVersion`、`schemaVersion`、`database`、`dataDir`、`time` |
| GET | `/api/v1/meta` | M1 | 支持的 Runtime、Artifact/契约类型、限制值、事件目录版本、错误码版本、权限模式；另含 `eventCatalogVersion` 与 `errorRegistryVersion` |
| GET | `/api/v1/events` | M1 | 全局事件日志，支持 `afterSeq`、`limit`、`type`；用于重放与调试 |
| GET | `/api/v1/runtimes` | M1 | Runtime 可用性、版本、模型与认证状态（运行时模块 RUN-016） |
| POST | `/api/v1/auth/bootstrap` | M2.1 | 一次性 bootstrap 令牌换取本地会话令牌 |
| POST | `/api/v1/auth/ws-ticket` | M2.1 | 申请一次性 WebSocket ticket（≤60 秒） |
| POST | `/api/v1/auth/login` / `logout` | M3 | 团队登录/登出 |
| GET | `/api/v1/me` | M3 | 当前用户与权限 |
| GET/POST/PATCH/DELETE | `/api/v1/members` | M3 | 组织成员与角色 |
| POST | `/api/v1/organizations/{id}/transfer-ownership` | M3 | 转移 Owner，需重新认证 |
| DELETE | `/api/v1/organizations/{id}` | M3 | 删除组织，Owner + 双人审批 |
| GET/POST/DELETE | `/api/v1/tokens` | M3 | 个人访问令牌 |
| GET | `/api/v1/security/status` | M1 | 监听地址、回环状态、认证模式、目录权限 |
| GET/PATCH | `/api/v1/security/settings` | M3 | 团队安全设置 |
| GET | `/api/v1/audit-events` | M2.1 | 本地审计事件；M3 扩展团队审计 |
| GET | `/api/v1/audit-events/export` | M3 | 导出审计；协作模块旧写法 `/api/v1/audit/export` 为别名 |
| GET | `/api/v1/audit-events/verify` | M3 | 校验哈希链与锚点 |
| GET/POST | `/api/v1/secrets` | M2.1 | Secret 引用与元数据 |
| POST | `/api/v1/secrets/{id}/rotate` | M2.1 | 轮换 Secret |
| DELETE | `/api/v1/secrets/{id}` | M2.1 | 删除 Secret |
| POST | `/api/v1/agents/{id}/permission-requests` | M2.1 | 申请扩大权限或一次性命令许可 |
| GET/POST | `/api/v1/inbox` | M2 | 收件箱列表与动作 |
| PATCH | `/api/v1/inbox/{id}` | M2 | 标记已读 |
| POST | `/api/v1/inbox/{id}/read` | M2 | 标记已读的兼容别名（M2 里程碑写法） |
| POST | `/api/v1/inbox/{id}/action` | M2 | 执行条目动作 |
| GET/POST | `/api/v1/crews` | M2 | Crew 查询与创建 |
| GET | `/api/v1/crews/{id}` | M2 | Crew 详情 |
| GET | `/api/v1/crews/{id}/plan` | M2 | 计划详情 |
| POST | `/api/v1/crews/{id}/submit-plan` | M2 | 提交计划 |
| POST | `/api/v1/crews/{id}/pause` / `resume` / `cancel` | M2 | 暂停、恢复、取消 |
| POST/DELETE | `/api/v1/crews/{id}/members` | M2 | 增删成员 |
| GET/POST | `/api/v1/task-views` | M2 | 保存视图 |
| PATCH/DELETE | `/api/v1/task-views/{id}` | M2 | 修改、删除视图 |
| GET/POST | `/api/v1/task-templates` | M2 | 任务模板管理 |
| GET | `/api/v1/diagnostics/metrics` | M2 | 队列、活跃 Run、事件速率等本地指标 |
| POST | `/api/v1/diagnostics/bundle` | M2 | 脱敏诊断包 |

端点总表（按里程碑汇总，规范路径）：

| 里程碑 | 端点组 |
| --- | --- |
| M0 | `GET /api/health`；`/api/tasks` CRUD 与 `/tasks/{id}/runs`；`/api/agents` CRUD；`/api/runs` 列表/详情/事件/取消；`/api/ws`；静态 SPA |
| M1 | `/api/v1/health`、`/meta`、`/events`、`/runtimes`；`/workspaces` 与 `/workspaces/{id}`；`/projects` 别名；`/tasks` 增强与 `/archive`；`/agents` 增强与 `/versions`、`/archive`；`/runs` 增强、`/cancel`、`/retry`、`/merge`、`/workspace`、`/diff`、`/artifacts`、`/reviews`；`/artifacts/{id}` 与 `/content`；`/reviews/{id}`、`/decision`、`/comments`、`/review-comments/{id}/resolve`；`/security/status` |
| M2 | `/tasks/{id}/dependencies`、`/readiness`、`/deliverables`、`/evidence`、`/reviews`、`/comments`、`/bulk`；`/unarchive` 与 `restore`；`/deliverables/{id}` 及 submit/validate/freeze/revise/withdraw/versions；`/approvals` 与 decision/consume/revoke；`/skills` 与 versions、`/agents/{id}/skills`；`/inbox`；`/crews`；`/task-views`、`/task-templates`；`/evidence/{id}`、`/verify`；`/diagnostics/metrics`、`/diagnostics/bundle`；`/auth/bootstrap`、`/auth/ws-ticket`、`/audit-events`、`/secrets`、`/permission-requests`（M2.1） |
| M3 | `/machines`、`/register-tokens`、`/revoke`；`/runner/*` 全组；`/auth/login`、`/logout`、`/me`、`/members`、`/tokens`；`/audit-events` 团队查询/export/verify；`/security/settings`；`/runs/{id}/pull-request`；`/workspaces/{id}/archive`、`/members` |
| M4 | `/schedules`、`/webhooks`、`/api/hooks/{hookId}`、`/notifications`、`/notification-preferences`、`/plugins` 与 grants、`/telemetry`、`/updates/*` |

### 5.14 资源 JSON 字段总表

以下字段是 API 的稳定形状；数据库内部列（如 `storage_path`、`source_path`、`fenced_token`）不直接暴露给普通客户端，或只对 Runner 认证域暴露。所有列表与详情默认返回完整对象；`include` 只增加摘要，不改变基础字段。

**Workspace**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `default` 或 24 位 hex |
| `organizationId` | string/null | 所属组织（M3；本地模式为 `local`） |
| `name` | string | 1-80 字符 |
| `repoPath` | string | 本地 git 仓库绝对路径；未绑定时为空 |
| `defaultBranch` | string | 默认 `main` |
| `settings` | object | `remote`、`worktreeRoot`、`verifyCommand`、`protectedBranches` 等 |
| `status` | string | `active`、`archived` |
| `archivedAt` | string/null | 归档时间 |
| `revision` | integer | 乐观锁版本 |
| `createdAt` / `updatedAt` | string | RFC3339 UTC 毫秒 |

**Task**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`workspaceId` | string | 主键与归属 |
| `key` | string/null | 人可读编号（M2） |
| `title`、`description` | string | 标题 1-200 字符；描述最长 64 KiB |
| `status` | string | 七状态之一 |
| `priority` | integer | 0-4 |
| `assigneeType`、`assigneeId` | string | `''`/`human`/`agent`/`crew` |
| `parentId` | string/null | 父任务 |
| `labels` | string[] | 最多 20 个 |
| `acceptanceCriteria` | object[] | `{text, done, doneBy, doneAt}` |
| `blockedReason` | string/null | 阻塞原因 |
| `contract` | object/null | 当前交付物契约投影（M2） |
| `revision` | integer | 乐观锁版本 |
| `createdBy` | string/null | 创建者（M3） |
| `archivedAt` | string/null | 归档时间 |
| `createdAt` / `updatedAt` | string | UTC |

**Agent 与 AgentVersion**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`workspaceId` | string | 主键与归属 |
| `name`、`description`、`instructions` | string | 名称 1-80 字符 |
| `role` | string | `general`/`ui_design`/`frontend`/`backend`/`devops`/`custom`（M2，默认 `general`） |
| `roleTemplateId`、`roleTemplateVersion`、`templateSnapshot`、`outputContractTypes` | string/object/string[] | 角色模板来源、版本、实例化快照与产出契约类型（M2）；旧名 `templateKey`/`templateVersion` 映射到此 |
| `runtime`、`model` | string | Runtime 枚举与模型标识 |
| `permissionMode` | string | `read_only`/`controlled_edit`/`full_access`，默认 `controlled_edit`（M1） |
| `workspaceMode` | string | `worktree`/`directory` |
| `maxConcurrency`、`timeoutMinutes` | integer | 并发与超时 |
| `allowedPaths`、`allowedCommands` | string[] | 权限边界 |
| `status` | string | `active`、`archived` |
| `currentVersionId` | string/null | 当前 AgentVersion |
| `revision` | integer | 乐观锁版本 |
| `createdBy` | string/null | 创建者（M3） |
| `archivedAt` | string/null | 归档时间 |
| `versions[].versionNumber` | integer | 从 1 递增 |
| `versions[].snapshot` | object | 完整配置快照 |
| `versions[].contentHash` | string | SHA-256 |
| `versions[].changeNote`、`createdAt` | string | 变更说明与时间 |

**Run**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`workspaceId`、`taskId`、`agentId` | string | 主键与归属 |
| `agentVersionId`、`configSnapshotId` | string | 固定版本与运行快照 |
| `crewId`、`crewStepId` | string/null | Crew 场景 |
| `attempt` | integer | 从 1 递增 |
| `status` | string | `queued`/`preparing`/`running`/`completed`/`failed`/`cancelled` |
| `trigger` | string | `manual`/`retry`/`dependency`/`crew`/`schedule`/`webhook`（六值，不含 `api`） |
| `branch`、`worktree` | string | Run Workspace 元数据 |
| `baseCommit`、`headCommit` | string | 基线/结束 commit |
| `runtimeSessionId`、`runnerId` | string/null | Runtime 与 Runner 标识 |
| `summary`、`error` | string | 摘要与错误详情（最大 8 KiB） |
| `errorCode`、`failureDetail` | string/null | 结构化失败码 |
| `exitCode` | integer/null | Runtime 退出码 |
| `metrics` | object | 耗时、token、工具调用次数（M2） |
| `createdBy` | string/null | 触发者（M3） |
| `retryOf` | string/null | 原 Run |
| `createdAt`、`queuedAt`、`startedAt`、`endedAt`、`cancelRequestedAt`、`lastEventAt` | string/null | UTC |
| `workspaceState`、`reviewStatus` | string | 派生字段，不存库 |

**RunEvent**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`runId` | string | 主键与归属 |
| `seq` | integer | Run 内从 1 递增 |
| `type` | string | 6.4 枚举 |
| `level` | string | `debug`/`info`/`warn`/`error` |
| `message` | string | 最大 8 KiB |
| `payload` | object | 类型相关 |
| `source` | string | `stdout`/`stderr`/`system`/`adapter` |
| `truncated` | boolean | 是否截断 |
| `payloadVersion` | integer | 事件载荷版本 |
| `createdAt` | string | UTC |

**Artifact / Evidence**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`workspaceId`、`runId`、`taskId` | string | 主键与归属 |
| `type`、`name`、`mediaType` | string | 类型、展示名、MIME |
| `sizeBytes`、`sha256` | integer/string | 大小与校验和 |
| `origin` | string | `runtime`/`human` |
| `truncated`、`redactionState` | boolean/string | 截断与脱敏状态 |
| `supersedesId` | string/null | 替代的旧证据 |
| `createdAt` | string | UTC |
| `evidence[].artifactId` | string | 对应 Artifact |
| `evidence[].type`、`criterionKey`、`status`、`validity` | string | 证据类型、契约条目、DoD 判定（`passed`/`failed`/`missing`/`waived`）与完整性（`valid`/`unverified`/`invalid`） |
| `evidence[].note`、`verifiedBy`、`verifiedAt` | string/null | 说明、验证者与时间 |

**Review / ReviewComment**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`workspaceId`、`taskId`、`runId` | string | 主键与归属 |
| `status` | string | `pending`/`in_review`/`approved`/`changes_requested`/`superseded`/`cancelled` |
| `requestedBy`、`reviewerId` | string/null | 发起人与评审者 |
| `decisionNote` | string/null | 结论说明 |
| `evidenceSnapshotHash` | string/null | 评审时证据集合哈希 |
| `requiresMerge` | boolean | 是否还需要合并 |
| `noMergeReason` | string/null | `requiresMerge=false` 时的理由 |
| `supersededBy` | string/null | 取代它的 Review |
| `revision` | integer | 乐观锁版本 |
| `comments[].artifactId`、`filePath`、`line` | string/int/null | 关联产物、文件与行号 |
| `comments[].severity`、`body`、`resolvedAt` | string | `blocking`/`non_blocking`/`info`、正文、解决时间 |

**Deliverable / Approval**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`workspaceId`、`taskId` | string | 主键与归属 |
| `kind`、`status`、`version` | string | `design_spec`/`api_contract`/`build`/`test_report`/`deploy_plan`；`draft`/`proposed`/`frozen`/`superseded`/`withdrawn`；版本 |
| `contract` | object | 契约 payload |
| `producedByRunId`、`validatedBy` | string/null | 生产者与校验者 |
| `validatedAt`、`frozenAt`、`verifiedAt` | string/null | 时间 |
| `approval.actionType`、`targetType`、`targetId` | string | 动作与目标 |
| `approval.status` | string | `pending`/`approved`/`rejected`/`expired`/`cancelled`/`consumed` |
| `approval.params`、`paramsHash`、`contentHash`、`actionFingerprint` | object/string | 参数与指纹 |
| `approval.evidenceSnapshotHash`、`riskLevel`、`summary` | string | 证据快照、风险级别、摘要 |
| `approval.requestedBy`、`decidedBy`、`reason`、`expiresAt`、`consumedAt` | string/null | 审批人与时效 |

**Skill / Machine / Runner**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `skill.id`、`workspaceId`、`name`、`slug`、`description`、`status` | string | 稳定身份 |
| `skillVersion.version`、`contentHash`、`manifest`、`instructions`、`createdAt` | string/object | 不可变版本 |
| `machine.id`、`organizationId`、`name`、`os`、`arch`、`hostnameHash`、`status` | string | 机器身份与状态 |
| `machine.labels`、`capabilities`、`shared`、`lastSeenAt` | array/object/boolean/string | 调度信息 |
| `runner.id`、`machineId`、`workspaceId`、`mode`、`status`、`concurrency`、`activeRunCount`、`version`、`protocolVersion`、`lastHeartbeatAt` | string/int | Runner 状态 |
| `lease.id`、`runId`、`runnerId`、`machineId`、`status`、`expiresAt`、`renewedAt`、`releasedAt` | string | 租约；`fencedToken` 只对 Runner 认证域返回 |

通用规则：可空字段返回 `null` 而不是省略（M1 起）；未知字段忽略；时间统一 RFC3339 UTC 毫秒；ID 不透明；`revision` 只在可写资源上出现；派生字段不参与写入。

## 6. WebSocket 事件模型

### 6.1 当前（M0）事件信封

M0 的事件结构为：

```json
{
  "type": "task.updated",
  "data": { "id": "a1b2c3d4e5f60718293a4b5c", "title": "..." },
  "at": "2026-11-17T05:00:00.123456Z"
}
```

已实际广播的事件类型：

| 事件类型 | 触发点 | data |
| --- | --- | --- |
| `task.created` | 创建 Task | 完整 Task |
| `task.updated` | 更新 Task；创建 Run 时指派 Agent，并可能把 `todo` 改为 `in_progress` | 完整 Task |
| `task.deleted` | 删除 Task | `{ "id": "..." }` |
| `agent.created` | 创建 Agent | 完整 Agent |
| `agent.updated` | 更新 Agent | 完整 Agent |
| `agent.deleted` | 删除 Agent | `{ "id": "..." }` |
| `run.queued` | Run 创建并入队 | 完整 Run |
| `run.preparing` | Run Workspace 准备阶段 | 完整 Run |
| `run.running` | Runtime 开始执行 | 完整 Run |
| `run.updated` | Run 状态/字段变化、取消、失败、完成 | 完整 Run |
| `run.event` | Runtime 产生一条事件 | 一条 RunEvent |

M0 的局限：没有事件 `id` 与全局 `seq`；没有订阅过滤；没有重放；客户端重连后依赖全量重新拉取；`run.event` 内部的 `seq` 只在单次执行内自增。

### 6.2 计划（M1 起）事件信封

```json
{
  "id": "evt_7f3a9c2e4b6d8a10",
  "seq": 1042,
  "v": 1,
  "type": "run.completed",
  "at": "2026-11-17T05:00:00.123Z",
  "workspaceId": "default",
  "actor": { "type": "agent", "id": "agent_9f8e", "displayName": "Backend Agent" },
  "correlationId": "corr_01J8Z9K2M3",
  "causationId": "evt_7f3a9c2e4b6d8a0f",
  "data": { "runId": "run_9f8e7d6c", "status": "completed", "endedAt": "2026-11-17T05:00:00.100Z" }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 全局唯一事件 ID，客户端用于去重 |
| `seq` | integer | 服务端持久化的单调递增序号；同一数据库内唯一，重连重放的依据 |
| `v` | integer | 事件 schema 版本，M1 固定为 1 |
| `type` | string | 事件类型，见 6.3 |
| `at` | string | 服务端产生事件的时间，RFC3339 UTC 毫秒 |
| `workspaceId` | string | 事件所属产品级 Workspace；本地模式为 `default` |
| `actor` | object | `type`（`human`、`agent`、`system`、`runner`）、`id`、可选 `displayName`；M4 插件订阅必须依赖该字段 |
| `correlationId` | string | 关联一条业务链路，例如创建 Run → 准备 → 证据 → 评审 |
| `causationId` | string | 可选，直接触发本事件的上一条事件 ID |
| `automationId` | string | M4 可选，触发本次动作的 Schedule/Webhook 等自动化配置 |
| `dedupeKey` | string | M4 可选，幂等去重键 |
| `data` | object | 事件载荷；不同类型有不同结构 |

M1 起不再使用 `scope.workspace`；`workspaceId` 是顶层字段。计划阶段没有外部客户端依赖旧形状，因此不保留 `scope` 别名。

### 6.3 事件目录（唯一权威）

命名规则：`aggregate.past_tense`。本表是唯一目录；其他文档中的事件名按下表映射。

| 事件类型 | 里程碑 | 载荷要点 | 旧名/别名 |
| --- | --- | --- | --- |
| `workspace.created` / `workspace.updated` / `workspace.archived` | M1/M3 | Workspace 快照或 `{id, archivedAt}` | — |
| `task.created` / `task.updated` / `task.deleted` | M0 | 完整 Task 或 `{id}` | `task.deleted` 仅 M0 硬删除的历史事件；M1 起删除动作统一发 `task.archived`，同一动作不得同时发两个事件 |
| `task.status_changed` | M1 | `{id, from, to, actor, reason}` | — |
| `task.assigned` | M1 | `{id, assigneeType, assigneeId}` | — |
| `task.archived` / `task.restored` | M1/M2 | `{id, archivedAt}` | `task.unarchived` → `task.restored` |
| `task.blocked` / `task.unblocked` | M2 | `{id, reason, source, satisfiedDependencies?}` | — |
| `task.reopened` | M2 | `{id, from, reason}` | — |
| `task.readiness_changed` | M2 | `{taskId, ready, reasons[]}` | — |
| `task.dependency.added` / `task.dependency.removed` | M2 | 依赖快照或 `{taskId, dependsOnTaskId}` | `task.dependency.updated`（带 `action`）→ 拆分后的 added/removed；`dependency.added/removed` → 加 `task.` 前缀 |
| `agent.created` / `agent.updated` / `agent.deleted` | M0 | 完整 Agent 或 `{id}` | — |
| `agent.archived` / `agent.restored` | M1/M2 | `{id, archivedAt}` | — |
| `agent.version_created` | M1 | 版本摘要与 `contentHash` | — |
| `run.queued` / `run.preparing` / `run.running` / `run.updated` | M0 | 完整 Run | — |
| `run.completed` / `run.failed` / `run.cancelled` / `run.timeout` | M1 | Run 快照，含 `errorCode`、`failureDetail`、`endedAt` | `run.finished` → 按终态拆分；`run.status` → `run.updated` 或对应的终态事件 |
| `run.cancel_requested` | M1 | `{id, requestedAt}` | — |
| `run.unschedulable` | M3 | `{runId, reason}` | — |
| `run.workspace.provisioning` / `ready` / `failed` / `cleaned` | M1 | `{runId, branch, baseCommit, path, errorCode?}` | M1 里程碑的 `workspace.provisioning/ready/failed` → `run.workspace.*`；领域模型的 `workspace.prepared/cleaned` → `run.workspace.ready/cleaned` |
| `run.event` | M0 | 完整 RunEvent | — |
| `artifact.created` / `artifact.deleted` | M1/M2 | Artifact 元数据或 `{id}` | — |
| `artifact.rejected` | M2 | `{runId, reason, sizeBytes?}` | — |
| `evidence.added` / `evidence.verified` / `evidence.rejected` | M2 | Evidence 摘要 | `evidence.attached` → `evidence.added`；`present` → `missing`、`verified` → `passed`、`rejected` → `failed` |
| `review.requested` | M1 | Review 快照 | `review.created` → `review.requested` |
| `review.approved` / `review.changes_requested` / `review.superseded` / `review.cancelled` | M1 | `{id, taskId, runId, decidedBy?, reason?}` | 不提供 `review.expired`；评审失效统一由 `review.superseded` 表达 |
| `approval.requested` / `approval.decided` / `approval.expired` / `approval.consumed` / `approval.cancelled` | M2 | Approval 摘要 | `approval.required` → `approval.requested`；`approval.revoked` → `approval.cancelled`（`revoked` 仅作输入别名） |
| `merge.started` / `merge.completed` / `merge.failed` | M1 | `{runId, targetBranch, commit?, result}` | `run.merged` → `merge.completed` |
| `deliverable.created` / `deliverable.updated` / `deliverable.submitted` / `deliverable.frozen` / `deliverable.revised` / `deliverable.withdrawn` | M2 | Deliverable 摘要 | `contract.created/submitted/frozen/revised` → `deliverable.*` |
| `comment.created` / `comment.updated` | M2 | Comment 摘要 | `task.comment.created` → `comment.created` |
| `inbox.item.created` / `inbox.item.updated` | M2 | 条目摘要 | `inbox.updated` → 保留为计数事件 `{unreadCount}`，不替代 item 事件 |
| `skill.created` / `skill.updated` / `skill.version_published` / `skill.archived` / `skill.deleted` | M2 | Skill 摘要 | — |
| `crew.created` / `crew.updated` / `crew.plan_submitted` / `crew.member_updated` / `crew.started` / `crew.paused` / `crew.completed` / `crew.cancelled` | M2 后段 | Crew 摘要 | — |
| `machine.online` / `machine.offline` / `machine.draining` / `machine.disabled` / `machine.revoked` / `machine.updated` | M3 | 机器摘要与 `lastSeenAt` | — |
| `runner.registered` / `runner.heartbeat` / `runner.lease_granted` / `runner.lease_expired` / `runner.disconnected` / `runner.revoked` | M3 | `{runnerId, machineId, leaseId?, runId?, activeRunCount?}` | `runner.offline` → `machine.offline` |
| `events.replay_reset` | M1 | `{reason: "retention" 或 "gap", lastSeq}`；客户端必须重新拉取快照 | — |
| `schedule.created` / `updated` / `deleted` / `paused` / `triggered` / `skipped` / `failed` | M4 | 自动化 ID、`dedupeKey`、Task/Run 引用 | — |
| `webhook.created` / `updated` / `deleted` / `received` / `accepted` / `rejected` / `replayed` / `disabled` | M4 | Hook ID、delivery ID、`dedupeKey` | — |
| `notification.created` / `notification.read` | M4 | 通知摘要 | — |
| `plugin.installed` / `plugin.enabled` / `plugin.disabled` / `plugin.error` / `plugin.revoked` | M4 | 插件 ID、版本、授权范围 | — |
| `update.available` / `update.downloaded` / `update.installed` / `update.failed` | M4 | 版本、通道、错误码 | — |
| `telemetry.consent_changed` | M4 | `{enabled, crashUploadEnabled}` | M4 文档的 `telemetry.consent.changed` 为本事件别名 |

事件治理：任何事件增删改必须先登记本表并提升 `meta.eventCatalogVersion`；旧名至少保留一个里程碑的并行发送期，并在 `data.deprecation` 中标注；客户端按 `type` 未知即忽略处理。M1 起 Run 进入终态只发对应的 `run.completed`/`run.failed`/`run.cancelled`/`run.timeout`，不再额外发 `run.updated`；非终态字段变化仍用 `run.updated`。协作模块所称的 `command.log` 不是独立领域事件，而是 6.4 的 RunEvent 类型 `command`，通过 `run.event` 广播；订阅方不得等待顶层 `command.log` 事件。

### 6.4 Run 事件类型

RunEvent 的 `type` 是 Runtime 输出被规范化后的结果。M0 只产生 `log` 与 `summary`；M1 起使用以下目录，adapter 负责把具体 Runtime 的原始输出映射到这些类型：

| Run 事件类型 | 说明 | payload 关键字段 |
| --- | --- | --- |
| `log` | 人类可读日志行 | 无 |
| `stdout` / `stderr` | 原始标准输出/错误 | `stream` |
| `status` | 生命周期阶段变化 | `phase`、`message` |
| `progress` | 低频进度心跳 | `phase`、`lastEventAt`、`elapsedMs` |
| `tool_call` | Runtime 调用工具 | `tool`、`inputSummary`、`durationMs` |
| `tool_result` | 工具返回 | `tool`、`ok`、`outputSummary`、`durationMs` |
| `file_change` | 文件变更 | `path`、`changeType`、`additions`、`deletions` |
| `test_result` | 测试命令结果 | `command`、`exitCode`、`passed`、`failed`、`durationMs` |
| `command` | 执行命令与其结果；即协作模块所称 `command.log` | `command`、`exitCode`、`durationMs`、`allowed` |
| `usage` | token、费用或时长用量 | `inputTokens`、`outputTokens`、`costUsd?` |
| `artifact` | 声明一个证据产物 | `artifactId`、`kind`、`name` |
| `warning` / `error` | 可恢复警告与错误 | `code`、`detail` |
| `summary` | Run 结束摘要 | `summary` |

约束：

- 单条 `message` 默认上限 8 KiB，超出截断并在 payload 中记录 `truncatedBytes`；避免一条超长日志撑爆数据库。
- 单条 RunEvent 的 `payload` 序列化后上限 64 KiB（M1 里程碑口径），超出截断并标记 `truncated=true`；`message` 与 `payload` 分别限制。
- Run 的事件总量有上限（默认每 Run 20,000 条或 50 MB，先到者为准）；达到上限后停止写入正文，追加一条 `warning` 标记 `EVENTS_TRUNCATED`，Run 本身不受影响。
- Adapter 不得把包含 API Key、令牌、绝对家目录路径的内容写入事件；服务端在持久化前做模式化脱敏。
- `level` 取 `debug`、`info`、`warn`、`error`；M1 起写入并参与过滤，M0 无该字段。

### 6.5 重连、重放与幂等

**连接与心跳。** 客户端连接 `/api/v1/ws`；服务端每 30 秒发送 ping，60 秒内未收到 pong 视为断开；客户端应在 10 秒内回应。发送缓冲区持续满时，服务端以关闭码 `1013`（Try Again Later）断开，客户端按退避重连。

**退避策略。** 客户端重连采用指数退避：0.5s、1s、2s、4s、8s、15s 封顶，叠加 ±20% 抖动；连接稳定 30 秒后重置退避；页面不可见时可暂停重连，恢复可见时立即重连。

**重放。** 客户端在握手 URL 中携带 `afterSeq=<lastSeq>`；服务端先补发事件日志中 `seq > afterSeq` 的事件，再进入实时广播，中间不产生空洞。若 `afterSeq` 早于保留窗口，服务端补发 `events.replay_reset`，客户端丢弃增量状态并重新拉取相关资源快照。

**顺序。** 全局 `seq` 单调递增，但不同资源的写操作没有跨资源顺序保证；客户端不应假设 `task.updated` 一定早于相关 `run.event`。需要严格因果的场景通过资源快照与 `correlationId` 判断。

**幂等。** 服务端采用至少一次投递；客户端按事件 `id` 做 LRU 去重（建议保留最近 1,000 条）。RunEvent 在数据库中以 `(run_id, seq)` 唯一约束保证不重复；重放可能重复发送同一事件，但不会产生不同内容。

**REST 幂等键。** `POST /tasks/{id}/runs`、`POST /runs/{id}/retry`、`POST /approvals/{id}/decision`、`POST /hooks/{hookId}` 接受 `Idempotency-Key` 请求头。服务端保存键、请求哈希与响应 24 小时；相同键相同请求返回原响应并标记 `Idempotency-Replayed: true`；相同键不同请求返回 `409 IDEMPOTENCY_CONFLICT`。

### 6.6 订阅过滤（M2）

本地模式下默认广播全部事件。M2 引入可选过滤：

- 握手参数 `topics=task:<id>,run:<id>,inbox,approvals`，不同 topic 以逗号分隔。
- 服务端只发送匹配的事件；`inbox` 聚合与当前用户相关的待办与审批。
- 过滤是性能优化而非权限边界；权限仍由 M3 服务端校验决定可见性。

### 6.7 事件 payload 契约

每个事件类型对应一个 JSON Schema 文件：`packages/shared/test/fixtures/events/<type>.schema.json`，CI 用同一份 schema 校验服务端发送与客户端解析。所有 payload 都位于信封的 `data` 下，不得把信封字段塞进 payload。关键事件组的必填字段如下：

| 事件组 | `data` 必填字段 |
| --- | --- |
| `workspace.*` | `id`；`workspace.archived` 另含 `archivedAt` |
| `task.created` / `task.updated` | 完整 Task（5.14） |
| `task.status_changed` | `id`、`from`、`to`、`actor`、可选 `reason` |
| `task.assigned` | `id`、`assigneeType`、`assigneeId` |
| `task.archived` / `task.restored` | `id`、`archivedAt` |
| `task.blocked` / `task.unblocked` | `id`、`reason`、`source`、可选 `satisfiedDependencies` |
| `task.dependency.added` / `task.dependency.removed` | `taskId`、`dependsOnTaskId`、`type` |
| `task.readiness_changed` | `taskId`、`ready`、`reasons[]` |
| `agent.*` / `agent.version_created` | `id`；版本事件含 `agentId`、`versionNumber`、`contentHash` |
| `run.queued` / `run.preparing` / `run.running` / `run.updated` | `runId`、`taskId`、`status`、`updatedAt` |
| `run.completed` / `run.failed` / `run.cancelled` / `run.timeout` | `runId`、`taskId`、`status`、`endedAt`、可选 `errorCode`/`failureDetail`/`exitCode` |
| `run.cancel_requested` | `runId`、`requestedAt` |
| `run.event` | 完整 RunEvent（5.14） |
| `run.workspace.*` | `runId`、`branch`、`baseCommit`、`path`；`failed` 另含 `errorCode`/`failureDetail` |
| `run.unschedulable` | `runId`、`reason` |
| `artifact.created` / `artifact.deleted` / `artifact.rejected` | `artifactId`、`runId`、`type`；`rejected` 含 `reason` |
| `evidence.added` / `evidence.verified` / `evidence.rejected` | `evidenceId`、`runId`、`status`、可选 `verifiedBy` |
| `review.requested` / `review.approved` / `review.changes_requested` / `review.superseded` / `review.cancelled` | `reviewId`、`taskId`、`runId`、`status`、可选 `decidedBy`/`reason` |
| `approval.requested` / `approval.decided` / `approval.expired` / `approval.consumed` / `approval.revoked` | `approvalId`、`actionType`、`targetId`、`status`、可选 `decidedBy` |
| `merge.started` / `merge.completed` / `merge.failed` | `runId`、`targetBranch`、`result`、可选 `commit`/`reason` |
| `deliverable.*` | `deliverableId`、`taskId`、`kind`、`status`、`version` |
| `comment.created` / `comment.updated` | `commentId`、`taskId`、`author`、`createdAt` |
| `inbox.item.created` / `inbox.item.updated` | `itemId`、`type`、`subjectType`、`subjectId`、`status` |
| `skill.*` / `crew.*` | 对应实体 ID、名称、状态；`crew.plan_submitted` 含 `planId` |
| `machine.*` / `runner.*` | `machineId`/`runnerId`、`status`、可选 `leaseId`/`runId`/`lastSeenAt` |
| `schedule.*` / `webhook.*` / `notification.*` / `plugin.*` / `update.*` | 实体 ID、状态、可选 `automationId`/`dedupeKey`/`deliveryId` |
| `events.replay_reset` | `reason`、`lastSeq` |

约定：事件 payload 不包含完整 Artifact 内容、不包含密钥、不包含绝对家目录路径；需要详情时客户端按 ID 拉取。新增事件必须先有 schema 文件与至少一个夹具，再登记 6.3 与 `meta.eventCatalogVersion`。

## 7. 错误模型

### 7.1 当前（M0）错误体

```json
{ "error": "title is required" }
```

状态码使用 400（请求/JSON/校验）、404（不存在）、409（Task 不可执行）、500（存储错误）。没有错误码、请求 ID、字段级 details，客户端只能展示字符串。

### 7.2 目标（M1）错误信封

```json
{
  "error": "Task is backlog; move it to todo or in_progress before running",
  "code": "TASK_NOT_EXECUTABLE",
  "message": "Task is backlog; move it to todo or in_progress before running",
  "details": {
    "taskId": "a1b2c3d4e5f60718293a4b5c",
    "status": "backlog",
    "allowed": ["todo", "in_progress", "in_review"]
  },
  "requestId": "req_01J8Z9K2M3",
  "retryable": false,
  "remediation": "Move the task to todo or in_progress, then retry."
}
```

采用**扁平信封**而不是嵌套 `error` 对象，原因是 M1 里程碑 API-007 要求 M0 的 `{error: string}` 保持可解析：旧客户端继续读取顶层 `error` 字符串，新客户端读取 `code`、`details` 与 `requestId`。这使 `/api` 别名与 `/api/v1` 可以共享同一错误体而不破坏 M0 客户端。

规则：

- `error` 是兼容用的可读字符串，M0 客户端可直接展示；M3 后可标记弃用，但不得在 v1 内删除。
- `code` 是稳定的大写蛇形标识，客户端不得依赖 `message` 文案。
- `message` 面向人类，可随文案优化而变化，不包含堆栈、绝对路径、SQL 或密钥。
- `details` 可选，结构随 `code` 定义；字段校验错误提供 `fields: [{field, reason}]`。
- `requestId` 同时出现在响应头 `X-Request-ID`，用于关联服务端日志。
- `retryable` 指示客户端是否可以原样重试；429 与 503 额外返回 `Retry-After`。
- `remediation` 可选，给用户下一步动作；M1 里程碑 API-007 要求该字段。
- 502/504 不出现于本地服务；M3 远程模式由网关处理。

### 7.3 HTTP 错误码目录

| HTTP | 错误码 | 含义 | 可重试 | 里程碑 |
| --- | --- | --- | --- | --- |
| 400 | `INVALID_JSON` | 请求体不是合法 JSON 或类型不符 | 否 | M0 起（M1 结构化） |
| 400 | `VALIDATION_FAILED` | 字段校验失败，details.fields 指出原因 | 否 | M1 |
| 400 | `INVALID_CURSOR` | 分页游标无法解析 | 否 | M1 |
| 400 | `INVALID_SORT` | 排序列不在白名单 | 否 | M1 |
| 400 | `INVALID_LIMIT` | limit 非正整数或超过最大值 | 否 | M1 |
| 401 | `UNAUTHENTICATED` | 未登录、会话过期或令牌无效 | 否 | M2.1/M3 |
| 403 | `FORBIDDEN` | 已认证但无权限 | 否 | M3 |
| 403 | `POLICY_DENIED` | HTTP 层的路径/命令权限拒绝；Run 内使用 `permission_denied` | 否 | M2 |
| 404 | `WORKSPACE_NOT_FOUND` / `TASK_NOT_FOUND` / `AGENT_NOT_FOUND` / `RUN_NOT_FOUND` / `RUN_EVENT_NOT_FOUND` / `ARTIFACT_NOT_FOUND` / `EVIDENCE_NOT_FOUND` / `REVIEW_NOT_FOUND` / `DELIVERABLE_NOT_FOUND` / `APPROVAL_NOT_FOUND` / `SKILL_NOT_FOUND` / `MACHINE_NOT_FOUND` / `RUNNER_NOT_FOUND` | 资源不存在 | 否 | M1 起逐步 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不支持 | 否 | M1 |
| 409 | `TASK_NOT_EXECUTABLE` | Task 状态不允许启动 Run | 否 | M0 起（M1 结构化） |
| 409 | `INVALID_STATUS_TRANSITION` | 状态机不允许的迁移 | 否 | M1 |
| 409 | `RUN_ALREADY_ACTIVE` | 同一 Task 已有活跃 Run | 否 | M1 |
| 409 | `RUN_ALREADY_MERGED` | Run 已合并，重复合并被拒绝 | 否 | M1 |
| 409 | `STALE_REVISION` | `If-Match` 或 `expectedRevision` 与当前 `revision` 不一致 | 否 | M1 |
| 409 | `AGENT_IN_USE` | Agent 仍被活跃 Run 使用 | 否 | M1 |
| 409 | `AGENT_HAS_REFERENCES` | Agent 仍被引用，不允许物理清理；`DELETE` 按归档语义处理 | 否 | M1 |
| 409 | `AGENT_NAME_CONFLICT` | Agent 名称重复 | 否 | M1 |
| 409 | `TASK_HAS_REFERENCES` | Task 存在引用，不允许物理清理；`DELETE` 按归档语义处理 | 否 | M1 |
| 409 | `TASK_HAS_ACTIVE_RUN` | Task 仍有活跃 Run，不允许归档或删除 | 否 | M1 |
| 409 | `WORKSPACE_REQUIRED` | Task 未绑定可用 Workspace/Project 就启动 Run；任务模块旧名 `TASK_PROJECT_REQUIRED` 为本码别名 | 否 | M1 |
| 409 | `WORKSPACE_MISMATCH` | 实体跨 Workspace 引用 | 否 | M1 |
| 409 | `WORKSPACE_LIMIT_REACHED` | M1 单 Workspace 模式下尝试创建第二个非归档 Workspace | 否 | M1 |
| 409 | `WORKSPACE_PROTECTED` | 默认 Workspace 不允许删除；M1-M2 的 Project DELETE 返回此码 | 否 | M1 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 | 否 | M1 |
| 409 | `REVIEW_REQUIRED` | 缺少已批准的 Review | 否 | M1 |
| 412 | `STALE_EVIDENCE` | Review 的 `evidenceSnapshotHash` 与当前证据不一致；原 Review 置为 `superseded`，要求重新评审 | 否 | M1 |
| 409 | `BASE_BRANCH_MOVED` | 目标分支已前进，不再等于 Run 的 base commit | 否 | M1 |
| 409 | `WORKSPACE_DIRTY` | 目标工作区存在未提交修改 | 否 | M1 |
| 409 | `TARGET_BRANCH_NOT_FOUND` | 目标分支不存在 | 否 | M1 |
| 409 | `MERGE_CONFLICT` | Git 合并冲突 | 否（需人工解决） | M1 |
| 409 | `APPROVAL_REQUIRED` / `APPROVAL_EXPIRED` / `APPROVAL_MISMATCH` / `APPROVAL_CONSUMED` / `APPROVAL_REVOKED` | 审批门禁失败；参数变化用 `APPROVAL_MISMATCH` | 否 | M2 |
| 409 | `SKILL_IN_USE` | Skill 仍被 Agent 绑定，不允许硬删除 | 否 | M2 |
| 400 | `DEPENDENCY_CYCLE` | 依赖形成环，不允许写入任何边 | 否 | M2 |
| 409 | `DEPENDENCY_UNFINISHED` | 依赖未满足 | 否 | M2 |
| 409 | `CONTRACT_NOT_FROZEN` | 引用的交付物契约未冻结或版本不匹配 | 否 | M2 |
| 409 | `READINESS_NOT_MET` | 任务不满足启动条件，details.reasons 列出全部原因 | 否 | M2 |
| 409 | `RUNNER_FENCED` | 旧租约持有者写入被拒绝 | 否 | M3 |
| 409 | `RUNNER_LEASE_EXPIRED` | 租约已过期 | 否 | M3 |
| 409 | `RUNNER_VERSION_INCOMPATIBLE` | Runner 协议版本不兼容，拒绝新租约 | 否 | M3 |
| 412 | `STALE_HEAD` | `expectedHeadCommit` 与当前 Run 分支 head 不一致 | 否 | M1 |
| 412 | `PRECONDITION_FAILED` | 动作内容哈希或审批指纹不匹配（非版本号冲突） | 否 | M2 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体或上传超过限制 | 否 | M1 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Content-Type 非 JSON | 否 | M1 |
| 429 | `RATE_LIMITED` | 请求频率超限 | 是（Retry-After） | M3/M4 |
| 431 | `HEADERS_TOO_LARGE` | 请求头超过 64 KiB | 否 | M1 |
| 500 | `INTERNAL` | 未预期内部错误 | 视情况 | M0 起（M1 结构化） |
| 503 | `DB_BUSY` | 数据库锁等待超时 | 是（Retry-After） | M1 |
| 503 | `QUEUE_FULL` | 调度队列已满，创建 Run 前拒绝 | 是（Retry-After） | M1 |
| 503 | `RUNTIME_UNAVAILABLE` | 指定 Runtime 暂不可用 | 是（Retry-After） | M1/M3 |
| 503 | `UPDATE_UNAVAILABLE` | 更新服务暂不可用 | 是 | M4 |

规则：

- `PRECONDITION_FAILED` 只用于动作前置条件（审批指纹、内容哈希、评审快照），不用于实体版本冲突；实体版本冲突统一为 `409 STALE_REVISION`，与领域模型 §7.4、任务模块 TASK-122 的 409 语义一致。
- `POLICY_DENIED` 是 HTTP 403 码，不是 Run 失败码；Run 内的同级语义是 `permission_denied`。
- 404 家族按资源登记，不允许使用未登记的资源码；新增资源必须同时新增 404 码。
- M2 里程碑中的 `dependency_unfinished`、`contract_not_frozen`、`gate_pending`、`agent_capacity_exceeded`、`crew_not_started` 等小写值是 readiness 原因码，作为 `409 READINESS_NOT_MET` 的 `details.reasons[]` 返回；单一原因需要独立 HTTP 码时使用 `DEPENDENCY_UNFINISHED`、`CONTRACT_NOT_FROZEN`、`APPROVAL_REQUIRED`。客户端不得把 readiness 原因码当作 HTTP 错误码。

### 7.4 Run 失败码目录（`errorCode` + `failureDetail`）

Run 失败使用独立的小写 snake_case 枚举，不复用 HTTP 错误码。`runs.error_code` 存规范 `errorCode`，`runs.failure_detail` 存子分类；`failure_detail` 用于 UI 修复建议与统计，不构成第二套错误码。禁止使用 `failureCategory`、`failureCode` 等第二字段名；M1 里程碑中的 `failureCode` 按下表映射到 `(errorCode, failureDetail)`。

| `errorCode` | 含义 | 默认 HTTP/行为 |
| --- | --- | --- |
| `runtime_error` | Runtime 缺失、认证失败、不可用、配置非法、异常退出或证据不满足 | Run `failed` |
| `timeout` | 超过 Agent `timeoutMinutes` | Run `failed`，不归类为取消 |
| `workspace_error` | worktree/目录准备、Git 操作或沙箱失败 | Run `failed` |
| `permission_denied` | 路径或命令越权 | Run `failed` 或按策略继续并记录 |
| `invalid_task_state` | Task 不可执行或在排队期间被删除/归档 | Run `failed` |
| `interrupted` | 应用重启、Runner 失联或租约过期导致执行中断 | Run `failed`，可人工重试 |
| `internal_error` | 调度器、存储或证据写入内部错误 | Run `failed` |
| `cancelled_by_user` | 人工取消 | Run `cancelled`（终态） |

`failureDetail` 目录：

| `errorCode` | `failureDetail` | 典型原因 | 自动重试 |
| --- | --- | --- | --- |
| `runtime_error` | `runtime_missing` | CLI 未安装、不在 PATH | 否 |
| `runtime_error` | `runtime_auth` | 未登录、Key 失效、订阅过期 | 否 |
| `runtime_error` | `runtime_unavailable` | 网络错误、服务限流、临时 5xx | 是（有上限，M2） |
| `runtime_error` | `invalid_agent_config` | 模型不存在、超时非法、工作区模式不支持 | 否 |
| `runtime_error` | `adapter_crash` | Adapter panic、进程异常退出 | 是（一次，M2） |
| `runtime_error` | `nonzero_exit` | Runtime 正常启动但非零退出 | 视原因 |
| `runtime_error` | `evidence_missing` | 完成但证据不满足 DoD | 否 |
| `runtime_error` | `scheduler_internal` | 调度器或存储异常、入队失败 | 视原因 |
| `timeout` | `timeout` | 超过 `timeoutMinutes` | 否（人工重试） |
| `workspace_error` | `workspace_provision_failed` | 目录创建失败、磁盘不足、权限不足 | 视原因 |
| `workspace_error` | `git_error` | fetch 失败、worktree 冲突、索引锁 | 部分 |
| `workspace_error` | `submodule_unsupported` | 子模块不受支持 | 否 |
| `workspace_error` | `sparse_checkout_unsupported` | 稀疏检出不受支持 | 否 |
| `workspace_error` | `sandbox_unavailable` | 沙箱不可用且未获降级批准（M3） | 否 |
| `permission_denied` | `path_denied` | 路径越界 | 否 |
| `permission_denied` | `command_denied` | 命令不在白名单 | 否 |
| `invalid_task_state` | `task_not_executable` | Task 状态不可执行 | 否 |
| `invalid_task_state` | `task_deleted` / `task_archived` | 排队期间 Task 被删除或归档 | 否 |
| `invalid_task_state` | `agent_deleted` / `agent_archived` | Agent 不可用 | 否 |
| `interrupted` | `runner_lost` | Runner 心跳超时且租约失效 | 否（人工重试） |
| `interrupted` | `app_restart` | 应用重启 | 否（人工重试） |
| `interrupted` | `lease_expired` | 租约过期 | 否（人工确认） |
| `internal_error` | `scheduler_internal` | 调度器或存储异常、入队失败 | 视原因 |
| `internal_error` | `queue_rejected` | 入队失败 | 否 |
| `internal_error` | `artifact_write_failed` | Artifact 写入失败 | 视原因 |
| `cancelled_by_user` | `user_cancel` | 用户取消 | 否 |

M1 里程碑中的旧 `failureCode` 映射示例：

| 旧值 | 新 `errorCode` | 新 `failureDetail` |
| --- | --- | --- |
| `runtime_missing` | `runtime_error` | `runtime_missing` |
| `runtime_auth` | `runtime_error` | `runtime_auth` |
| `runtime_unavailable` | `runtime_error` | `runtime_unavailable` |
| `invalid_agent_config` | `runtime_error` | `invalid_agent_config` |
| `invalid_task_state` | `invalid_task_state` | `task_not_executable` |
| `workspace_provision_failed` | `workspace_error` | `workspace_provision_failed` |
| `git_error` | `workspace_error` | `git_error` |
| `permission_denied` | `permission_denied` | `path_denied` 或 `command_denied` |
| `adapter_crash` | `runtime_error` | `adapter_crash` |
| `evidence_missing` | `runtime_error` | `evidence_missing` |
| `internal_error` | `internal_error` | `scheduler_internal` |
| `interrupted` | `interrupted` | `app_restart` |
| `cancelled` | `cancelled_by_user` | `user_cancel` |
| `RUNNER_DISCONNECTED` | `interrupted` | `runner_lost` |
| `SERVER_RESTART` | `interrupted` | `app_restart` |
| `RUNTIME_TIMEOUT` | `timeout` | `timeout` |
| `RUNTIME_NOT_FOUND` | `runtime_error` | `runtime_missing` |
| `QUEUE_REJECTED` | 无（创建前直接返回 `503 QUEUE_FULL`）；若已创建则 `internal_error` | `queue_rejected` |

兼容期：M1 的 Run 响应可同时返回 `failureCode`（等于 `failureDetail`）与 `reviewStatus`（由最新 Review 状态派生），供 M1 里程碑客户端过渡；两者在 M2 移除（这是字段级弃用，与路径别名 `/api` 的永久保留无关），规范字段始终是 `errorCode` + `failureDetail`。

### 7.5 边界与降级

- `/api` 别名与 `/api/v1` 返回相同的扁平错误信封；顶层 `error` 字符串保持可解析，`code`/`details`/`requestId` 为增量字段。
- 遇到未知内部错误，服务端记录完整日志（含 requestId），响应只返回通用 `INTERNAL` 消息，避免泄露实现细节。
- WebSocket 错误不使用 HTTP 错误体：握手失败返回标准 HTTP 状态；连接建立后的致命错误通过关闭码表达（1008 策略拒绝、1013 稍后重试），业务错误通过 `error` 类型 Run 事件表达。
- 429 与 503 必须同时设置 `Retry-After` 与 `error.retryable=true`；其他错误默认 `retryable=false`。

## 8. 分页、过滤、排序与搜索

### 8.1 统一列表参数

| 参数 | 类型 | 默认 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `limit` | integer | 50 | 1-200 | 超过 200 返回 `INVALID_LIMIT` |
| `cursor` | string | 无 | 不透明 base64url | 上一页返回的 `nextCursor` |
| `sort` | string | `-createdAt` | 资源白名单 | `-` 前缀表示降序；多列用逗号分隔 |
| `q` | string | 无 | 2-128 字符 | 去首尾空白后的子串搜索 |
| `includeArchived` | boolean | false | 本地/管理员 | 是否包含归档资源；替代旧 `includeDeleted` |
| `includeTotal` | boolean | false | M2 | 是否返回 `total`；大团队下代价较高 |
| `updatedSince` | string | 无 | RFC3339 | 增量同步：返回 `updatedAt > updatedSince` 的资源 |

`includeDeleted` 作为 `includeArchived` 的兼容别名保留一个里程碑；响应不再包含 `deletedAt`。

响应结构（M1 起）：

```json
{
  "items": [],
  "nextCursor": "eyJrIjoiMjAyNi0xMS0xN1QwNTowMDowMC4wMDBaIiwiaWQiOiJhMWIyIn0",
  "hasMore": false,
  "total": 42
}
```

`total` 仅在 `includeTotal=true` 时出现。M1 的本地 SQLite 可以使用 `COUNT(*)`；M3 Postgres 模式应限制该参数的使用频率。

### 8.2 各资源的过滤与排序列

| 资源 | 过滤参数 | 排序白名单 |
| --- | --- | --- |
| workspaces | `status`、`q`、`includeArchived` | `createdAt`、`updatedAt`、`name` |
| tasks | `status`（可重复）、`assigneeType`、`assigneeId`、`label`（可重复，AND）、`parentId`、`hasActiveRun`、`q`、`includeArchived`、`updatedSince` | `createdAt`、`updatedAt`、`priority`、`title` |
| agents | `runtime`、`role`、`q`、`includeArchived` | `createdAt`、`updatedAt`、`name` |
| agent versions | `agentId` | 固定 `versionNumber` 降序 |
| runs | `taskId`、`agentId`、`status`（可重复）、`trigger`、`since`、`until`、`q` | `createdAt`、`startedAt`、`endedAt`、`status` |
| run events | `type`（可重复）、`afterSeq` | 固定 `seq` 升序 |
| artifacts | `type`、`runId`、`taskId` | `createdAt`、`sizeBytes`、`type` |
| evidence | `runId`、`taskId`、`status`、`type` | `createdAt` |
| reviews | `runId`、`taskId`、`status` | `createdAt`、`decidedAt` |
| deliverables | `taskId`、`kind`、`status` | `createdAt`、`frozenAt` |
| approvals | `status`、`actionType`、`taskId`、`runId` | `createdAt`、`expiresAt` |
| skills | `q`、`tag`、`role`、`includeArchived` | `name`、`createdAt`、`updatedAt` |
| machines | `status`、`platform`、`q` | `name`、`lastSeenAt` |
| runners | `status`、`machineId` | `registeredAt`、`lastHeartbeatAt` |
| schedules | `enabled`、`q` | `nextRunAt`、`name` |
| notifications | `unread`、`type`、`since` | `createdAt` |

### 8.3 游标分页规则

- 游标是 base64url 编码的 JSON，至少包含排序键值与 ID 作为决胜列；服务端负责编码与解码，客户端不得构造。
- 使用 keyset 分页而非 OFFSET：`WHERE (sort_value, id) < (:value, :id)`（降序），保证并发插入时页面不重复、不跳项。
- `nextCursor` 为空表示没有下一页；`hasMore` 仅用于快速判断，客户端应以 `nextCursor` 为准。
- 游标无过期时间，但排序字段被删除或类型变化时可能失效；失效返回 `400 INVALID_CURSOR`。
- `run events` 使用 `afterSeq` 而非通用游标，返回 `{items, nextAfterSeq, hasMore}`，与 RunEvent 的 `seq` 语义一致。
- M1 的默认 limit 为 50、最大 200；`limit=0` 或负数返回 `INVALID_LIMIT`，不静默改为默认值。

### 8.4 搜索规则

- `q` 仅匹配资源的主要文本字段：Task 的 `title`/`description`、Agent 的 `name`/`description`、Run 的 `summary`/`error`、Artifact 的 `name`、Skill 的 `name`/`description`。
- 使用大小写不敏感的子串匹配；SQLite `LIKE` 对 ASCII 大小写不敏感，对非 ASCII 精确匹配。M1 在文档中明确该限制，M2 可评估 FTS5，但不作为必需项。
- 必须转义 `%`、`_` 与转义字符本身，防止用户输入改变匹配语义。
- `q` 不做分词、不做相关性排序；结果是按 `sort` 指定的顺序。
- 空字符串视为未提供；长度 1 或超过 128 返回 `VALIDATION_FAILED`。
- 搜索结果同样受 `limit` 约束，不允许一次返回全部匹配。

### 8.5 与 M0 的兼容

M0 的 `/api/tasks`、`/api/agents`、`/api/runs` 返回裸数组且无参数。M1 的 `/api/v1` 返回分页对象，这是有意的破坏性变更，由路径版本隔离；`@ateam/api-client` 同步升级。`/api` 别名在 M1 起也返回分页对象，以便与 v1 保持同一语义；M0 客户端若依赖裸数组，必须迁移到 v1 的分页结构或锁定旧版本。别名不承诺保留裸数组形状超过 M1。

## 9. 数据模型与迁移策略

### 9.1 存储总体

- 引擎：SQLite（`modernc.org/sqlite`），WAL 模式，`busy_timeout=5000`，启用 `foreign_keys`，连接池上限 1（单写者）。
- 数据目录：默认 `~/.ateam`；数据库 `~/.ateam/ateam.db`；M0 Run Workspace 目录 `~/.ateam/workspaces/runs/<runId>`；M1 起 git worktree 默认位于 `~/.ateam/worktrees/{repoSlug}/{runId}`（以运行时模块 §8 为准）。
- 时间：统一 UTC Unix 毫秒整数存储；API 输出 RFC3339 UTC 毫秒。
- JSON 字段：`labels`、`allowed_paths`、`allowed_commands`、RunEvent `payload`、`settings`、契约 `payload` 以 TEXT 保存 JSON；读取时容错为空数组/空对象。
- ID：24 位小写十六进制字符串，不透明；新表沿用同一格式，事件 ID 可加 `evt_` 前缀但客户端仍应视为不透明。
- M3 团队模式计划支持 Postgres；本地 SQLite 仍是默认与推荐路径，团队模式才需要共享数据库。

### 9.2 M0 已实现 schema

| 表 | 关键列 | 索引/约束 | 说明 |
| --- | --- | --- | --- |
| `tasks` | `id`、`title`、`description`、`status`、`priority`、`assignee_type`、`assignee_id`、`parent_id`、`labels`、`created_at`、`updated_at` | 主键 `id`；`idx_tasks_status`、`idx_tasks_created` | 硬删除；无软删除/归档列 |
| `agents` | `id`、`name`、`description`、`instructions`、`runtime`、`model`、`workspace_mode`、`max_concurrency`、`timeout_minutes`、`allowed_paths`、`allowed_commands`、`created_at`、`updated_at` | 主键 `id` | 名称无唯一约束；硬删除 |
| `runs` | `id`、`task_id`、`agent_id`、`status`、`trigger`、`branch`、`worktree`、`summary`、`error`、`created_at`、`started_at`、`ended_at` | 主键 `id`；`idx_runs_task`、`idx_runs_status` | 无 `error_code`、`exit_code`、配置快照 |
| `run_events` | `id`、`run_id`、`seq`、`type`、`message`、`payload`、`created_at` | 普通索引 `(run_id, seq)` | 无唯一约束；无外键 |
| `schema_migrations` | `version`、`applied_at` | 主键 `version` | 只记录文件名与时间；无校验和 |

迁移实现：迁移 SQL 通过 `go:embed migrations/*.sql` 打包；启动时按文件名字典序执行；每个文件按分号切分语句并在一个事务中执行；成功后写入 `schema_migrations`。该实现存在 5.3 节 G-12 的缺陷。

### 9.3 计划 schema（M1-M4）

M1 表：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `workspaces` | `id`、`organization_id`（M3）、`name`、`repo_path`、`default_branch`、`settings`、`status`、`archived_at`、`created_at`、`updated_at` | 默认工作区 ID 为 `default`；M1 单 Workspace |
| `tasks`（扩展） | `workspace_id`、`archived_at`、`revision`、`blocked_reason`、`acceptance_criteria`、`deliverable_contract`（M2；`contract` 为弃用别名）、`key`（M2）、`created_by`（M3） | 归档替代软删除；`revision` 从 1 起 |
| `agents`（扩展） | `workspace_id`、`role`（M2，默认 `general`）、`role_template_id`、`role_template_version`、`template_snapshot`、`output_contract_types`、`permission_mode`、`current_version_id`、`status`、`created_by`（M3）、`archived_at`、`revision` | 部分唯一索引 `name WHERE archived_at IS NULL`；`template_snapshot` 固化实例化时的模板内容 |
| `agent_versions` | `id`、`workspace_id`、`agent_id`、`version_number`、`snapshot`、`content_hash`、`change_note`、`created_at` | `(agent_id, version_number)` 唯一；不可变 |
| `run_config_snapshots` | `id`、`run_id`、`agent_version_id`、`config_snapshot`、`prompt_hash`、`runtime_version`、`permission_mode`、`permission_envelope`、`created_at` | 每次 Run 一份；禁止 Run 结束后补写 |
| `runs`（扩展） | `workspace_id`、`agent_version_id`、`config_snapshot_id`、`attempt`、`crew_id`（M2）、`crew_step_id`（M2）、`base_commit`、`head_commit`、`runtime_session_id`、`runner_id`（M3）、`metrics`（M2）、`created_by`（M3）、`error_code`、`failure_detail`、`queued_at`、`cancel_requested_at`、`last_event_at`、`retry_of` | 快照保证历史可复盘；`retry_of` 指向原 Run |
| `run_events`（重建） | 唯一 `(run_id, seq)`；外键 `run_id → runs(id) ON DELETE CASCADE`；`source`、`level`、`truncated`、`payload_version` | 修复序号冲突与孤儿事件 |
| `artifacts` | `id`、`workspace_id`、`run_id`、`task_id`、`type`、`name`、`media_type`、`size_bytes`、`sha256`、`storage_path`、`origin`、`truncated`、`supersedes_id`、`redaction_state`、`created_at` | 内容存磁盘，路径不可由客户端指定 |
| `reviews` | `id`、`workspace_id`、`task_id`、`run_id`、`status`、`requested_by`、`reviewer_id`、`decision_note`、`evidence_snapshot_hash`、`requires_merge`、`no_merge_reason`、`created_at`、`started_at`、`decided_at`、`superseded_by`、`revision` | 按领域模型 §3.10；不可变结论 |
| `review_comments` | `id`、`review_id`、`artifact_id`、`file_path`、`line`、`severity`、`body`、`resolved_at`、`created_by`、`created_at` | blocking 意见解决后写 `resolved_at` |
| `merge_records` | `id`、`workspace_id`、`run_id`、`review_id`、`approval_id`、`target_branch`、`source_branch`、`strategy`、`commit`、`operator`、`result`、`created_at` | 合并审计，不随 worktree 清理删除 |
| `events` | `seq INTEGER PRIMARY KEY AUTOINCREMENT`、`id`、`workspace_id`、`actor_type`、`actor_id`、`correlation_id`、`causation_id`、`type`、`payload`、`created_at` | 全局事件日志，供 WebSocket 重放 |
| `idempotency_keys` | `key`、`request_hash`、`status_code`、`response_body`、`created_at`、`expires_at` | 24 小时清理 |

M2 表：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `deliverables` | `id`、`workspace_id`、`task_id`、`kind`、`contract`、`status`、`version`、`revision`、`produced_by_run_id`、`validated_at`、`validated_by`、`frozen_at`、`revision_in_progress`、`verified_at`、`created_at`、`updated_at` | 契约当前版本；状态 draft/proposed/frozen/superseded/withdrawn |
| `contract_versions` | `id`、`deliverable_id`、`version`、`payload`、`payload_hash`、`status`、`supersedes_id`、`created_at` | `(deliverable_id, version)` 唯一；不可变 |
| `contract_requirements` | `id`、`task_id`、`deliverable_id`、`required_version`、`required_state`、`allow_newer`、`min_version`、`created_at` | 任务对契约的引用；默认精确版本 |
| `evidence` | `id`、`workspace_id`、`task_id`、`run_id`、`artifact_id`、`type`、`criterion_key`、`status`、`validity`、`summary`、`source_command`、`commit`、`captured_at`、`verified_by`、`verified_at`、`supersedes_id`、`created_at` | M2 起建表；`status`（passed/failed/missing/waived）与 `validity`（valid/unverified/invalid）正交 |
| `approvals` | `id`、`workspace_id`、`task_id`、`run_id`、`action_type`、`target_type`、`target_id`、`status`、`params`、`params_hash`、`content_hash`、`action_fingerprint`、`evidence_snapshot_hash`、`summary`、`risk_level`、`requested_by`、`decided_by`、`reason`、`expires_at`、`consumed_at`、`consumed_by`、`created_at`、`decided_at`、`revision` | 指纹绑定动作，单次消费 |
| `approval_evidence_snapshots` | `approval_id`、`evidence_id`、`checksum`、`snapshot_hash`、`captured_at` | 审批时冻结的证据快照 |
| `task_dependencies` | `task_id`、`depends_on_task_id`、`type`、`required_artifact_kinds`、`created_at` | 复合主键；M2 仅 `finish_to_start` |
| `comments` | `id`、`workspace_id`、`task_id`、`author_type`、`author_id`、`body`、`run_id`、`artifact_id`、`parent_id`、`resolved_at`、`created_at`、`updated_at` | 任务时间线 |
| `task_views` | `id`、`name`、`scope`、`view_type`、`filters`、`sort`、`columns`、`created_by`、`created_at` | 保存视图 |
| `task_templates` | `id`、`key`、`name`、`role`、`version`、`payload`、`created_by`、`created_at` | 任务模板 |
| `task_template_steps` | `template_id`、`step_key`、`title_skeleton`、`role`、`dependencies`、`contract_defaults` | 预置 DAG |
| `skills` | `id`、`workspace_id`、`name`、`slug`、`description`、`tags`、`compatible_roles`、`status`、`created_at`、`updated_at` | 稳定身份；`slug` 同 Workspace 唯一 |
| `skill_versions` | `id`、`skill_id`、`version`、`content_hash`、`manifest`、`instructions`、`source_path`、`created_at` | `(skill_id, version)` 唯一；版本不可变 |
| `agent_skills` | `agent_id`、`skill_id`、`skill_version_id`、`enabled`、`binding_order`、`created_at` | 外键指向具体版本，不指向稳定身份 |
| `inbox_items` | `id`、`workspace_id`、`type`、`severity`、`subject_type`、`subject_id`、`status`、`due_at`、`created_at` | 收件箱 |
| `crews` | `id`、`workspace_id`、`task_id`、`name`、`strategy`、`status`、`created_at`、`started_at`、`ended_at` | M2 后段 |
| `crew_members` | `id`、`crew_id`、`role`、`agent_id`、`agent_version_id`、`order`、`required` | M2 后段 |

M2.1 表：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `secrets` | `id`、`workspace_id`、`name`、`backend`、`ref`、`created_at`、`updated_at` | 只存引用，不存明文 |

M3 表：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `organizations` | `id`、`name`、`created_at` | 单组织起步 |
| `users` | `id`、`email`、`name`、`password_hash`、`status`、`created_at`、`updated_at` | 密码使用 Argon2id |
| `memberships` | `organization_id`、`user_id`、`role` | 组织级 owner/admin/member/viewer |
| `workspace_memberships` | `workspace_id`、`user_id`、`role` | workspace_admin/contributor/reviewer/viewer |
| `sessions` | `id`、`user_id`、`token_hash`、`expires_at`、`created_at`、`last_seen_at`、`revoked_at` | 服务端只存哈希 |
| `personal_access_tokens` | `id`、`user_id`、`name`、`token_hash`、`scopes`、`expires_at`、`created_at`、`revoked_at` | PAT |
| `machines` | `id`、`organization_id`、`name`、`os`、`arch`、`hostname_hash`、`public_key`、`status`、`labels`、`capabilities`、`shared`、`last_seen_at`、`registered_at`、`revoked_at` | `status` 五态 pending/online/offline/draining/disabled；`revoke` 为动作，写入 `revoked_at` |
| `runner_registration_tokens` | `id`、`organization_id`、`token_hash`、`expires_at`、`used_at`、`created_by`、`created_at` | 一次性、15 分钟 |
| `runners` | `id`、`machine_id`、`workspace_id`、`mode`、`status`、`concurrency`、`active_run_count`、`version`、`protocol_version`、`last_heartbeat_at`、`registered_at` | Runner 代理 |
| `run_leases` | `id`、`run_id`、`runner_id`、`machine_id`、`status`、`expires_at`、`renewed_at`、`released_at`、`fenced_token`、`created_at` | 同一 Run 同时只有一个 active |
| `audit_events` | `id`、`organization_id`、`workspace_id`、`actor_type`、`actor_id`、`action`、`resource_type`、`resource_id`、`source`、`result`、`reason_code`、`metadata`、`request_id`、`prev_hash`、`hash`、`created_at` | 追加写；哈希链；替代旧 `audit_log` |
| `github_links` | `run_id`、`repo`、`pr_number`、`pr_url`、`created_at` | PR 集成 |

M4 表：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `automation_schedules` | `id`、`workspace_id`、`name`、`cron`、`timezone`、`task_template_id`、`agent_id`、`enabled`、`overlap_policy`、`missed_run_policy`、`max_runs_per_day`、`max_concurrency`、`next_run_at`、`last_run_at`、`created_at`、`updated_at` | 定时规则 |
| `automation_triggers` | `id`、`automation_id`、`source`、`dedupe_key`、`status`、`run_id`、`task_id`、`scheduled_for`、`started_at`、`ended_at`、`error_code` | 触发历史 |
| `webhooks` | `id`、`workspace_id`、`name`、`secret_hash`、`enabled`、`created_at`、`updated_at` | 出站/入站配置 |
| `webhook_deliveries` | `id`、`webhook_id`、`delivery_id`、`dedupe_key`、`status`、`received_at`、`processed_at`、`error` | 投递日志 |
| `notifications` | `id`、`workspace_id`、`user_id`、`type`、`subject_type`、`subject_id`、`payload`、`read_at`、`created_at` | 通知 |
| `notification_preferences` | `user_id`、`event_type`、`channel`、`enabled` | 通知偏好 |
| `plugins` | `id`、`workspace_id`、`name`、`version`、`manifest`、`status`、`installed_at` | 插件 |
| `plugin_grants` | `id`、`plugin_id`、`scope`、`granted_by`、`created_at`、`revoked_at` | 授权范围 |
| `telemetry_preferences` | `id`、`install_id`、`enabled`、`crash_upload_enabled`、`updated_at` | 默认关闭 |
| `telemetry_events` | `id`、`install_id`、`event_type`、`payload`、`created_at` | 本地计数，不含任务内容 |
| `update_state` | `id`、`current_version`、`channel`、`last_checked_at`、`downloaded_version`、`status` | 更新状态 |

### 9.4 迁移策略

1. **命名与顺序**：`NNNN_描述.sql`，四位零填充，按字典序执行；已发布迁移不可修改，只能新增。
2. **事务性**：每个迁移在独立事务中执行；失败回滚并中止启动。SQLite 的 DDL 支持事务，M3 Postgres 同样遵守。
3. **备份**：M1 起在任何待执行迁移前使用 `VACUUM INTO` 生成一致性备份（避免直接复制正在写入的 WAL 数据库），文件名包含时间与目标版本，默认保留最近 5 份；备份后用 `PRAGMA integrity_check` 验证。
4. **校验和**：`schema_migrations` 增加 `checksum` 与 `applied_at_ms`；启动时校验已应用迁移的校验和，不一致拒绝启动并提示数据库被外部修改。
5. **版本兼容**：二进制声明支持的最高 schema 版本；数据库版本更高时拒绝启动，禁止旧代码写入新结构；数据库版本更低时自动迁移。
6. **语句处理**：迁移执行器不得用简单分号切分；优先整文件交给驱动执行，或使用能识别字符串/注释/触发器的分词器；增加包含分号字符串与触发器的测试用例。
7. **表重建**：SQLite 修改约束需要「建新表-复制-改名-重建索引」的 12 步流程；M1 对 `runs`、`run_events`、`tasks`、`agents` 的重建必须在单事务中完成，并用 M0 真实数据夹具验证行数、索引与外键。
8. **降级**：不提供 down migration；降级需停止服务、恢复对应备份、使用旧版本启动，文档给出命令。
9. **Postgres（M3）**：同一逻辑版本对应独立方言的迁移目录；CI 同时跑 SQLite 与 Postgres 迁移测试；不承诺 SQLite 到 Postgres 的自动数据搬迁，团队模式默认新建 Postgres 实例，是否需要导入工具列为待确认。
10. **启动顺序**：打开数据库 → 备份（如需）→ 迁移 → 健康检查 → 启动调度器恢复 → 写实例发现文件 → 监听端口；监听前任何失败都不得对外提供服务。

M1 的具体迁移顺序：

1. 创建 `workspaces`，插入 `default` 记录（`repo_path` 为空表示待绑定；启动真实 Run 前必须绑定）。
2. 为 `tasks`、`agents`、`runs`、`artifacts`、`reviews` 增加 `workspace_id`，默认 `default`，回填后改为非空（`evidence` 从 M2 建表，不在此步）。
3. 为 `tasks`、`agents` 增加 `archived_at`、`revision`；`revision` 默认 1。
4. 创建 `agent_versions`，为每个现有 Agent 生成 `version_number=1` 的初始快照；`agents.current_version_id` 指向该版本。
5. 重建 `runs`，增加 `agent_version_id`、`attempt`、`base_commit`、`head_commit`、`error_code`、`failure_detail` 等；为每个历史 Run 创建 `run_config_snapshots`，缺失字段以 M0 值填充并标注 `legacy=true`。
6. 重建 `run_events`，加唯一约束与外键；先清理重复 `(run_id, seq)`（保留最大 `id`），再建约束。
7. 创建 `artifacts`、`reviews`、`review_comments`、`merge_records`、`events`、`idempotency_keys`；M2 迁移再创建 `evidence`、`approvals`、`deliverables`、`contract_versions`、`contract_requirements`、`task_dependencies` 等表。
8. 重建索引；运行 `PRAGMA foreign_key_check` 与孤儿查询。

### 9.5 数据保留与清理

| 数据 | 默认保留 | 清理方式 |
| --- | --- | --- |
| `run_events` | 每 Run 20,000 条或 50 MB（容量上限）；Run 结束后保留 90 天（可配置） | 超出容量后截断并标记；到期后随清理任务删除 |
| `events`（WebSocket 重放缓冲） | 7 天或 100,000 条（先到者为准） | 后台定期删除最旧记录；清理后旧 `afterSeq` 触发重放重置 |
| `domain_events`（M2 领域事件日志） | 90 天 | 追加写；到期清理，不作为实体当前状态来源 |
| `idempotency_keys` | 24 小时 | 启动与定时清理 |
| Artifacts | Run 结束或 Workspace 删除后 90 天（可配置 30–365 天） | M2 支持显式删除；到期由清理任务删除磁盘内容 |
| Evidence | 与 Artifact 相同：90 天 | 随 Artifact 清理；被审批引用的记录只归档 |
| Run Workspaces | 已合并或放弃后 30 天；未合并且有改动不得自动删除 | 显式清理需二次确认；M2 提供清理 UI |
| 本地审计（M1-M3 本地模式） | 90 天 | 仅归档；M3 团队审计见下行 |
| `audit_events`（M3 团队审计） | 180 天（团队策略可配置） | 仅归档，不物理删除 |
| 本地遥测 | 默认关闭；开启后保留 30 天或直到用户删除 | 用户可导出与删除 |
| 备份文件 | 最近 5 份 | 新备份成功后删除最旧 |

同一份保留策略表在 `non-functional-requirements.md` 与 `security-and-permissions.md` 中必须与本表一致；不得再维护第二套数值。清理任务必须在服务内以低优先级执行，不得阻塞 API；每一步可中断、可重入，删除记录与磁盘文件时先标记后删除，避免半完成状态。

### 9.6 一致性与约束

- 新表必须声明外键与级联策略；SQLite 连接已启用 `foreign_keys=1`，迁移中需要为 M0 表补齐。
- 写操作使用单连接串行化；对可能超过 `busy_timeout` 的写，API 返回 `503 DB_BUSY` 并标记可重试，而不是 500。
- 更新 Run/Review/Approval 等状态时使用「条件更新」（`WHERE id=? AND status=?`），避免并发覆盖；M1 增加 `revision` 与 `If-Match`。
- 删除默认归档；物理删除仅用于清理任务与满足 5.5/5.6 条件的显式操作。
- JSON 字段写入前校验可序列化并提供大小上限；读取时容错，不让单条坏数据导致整页失败。

### 9.7 Workspace、Project 与历史命名

- `workspaces` 是唯一的产品级归属表；`projects` 不落表。M1 迁移把 M0 数据回填到 `default` Workspace。
- API 在 M1-M2 接受 `projectId` 作为请求输入的兼容别名：与 `workspaceId` 同时出现且不一致时返回 `400 VALIDATION_FAILED`；只出现 `projectId` 时归一化为 `workspaceId`。响应只返回 `workspaceId`，不返回 `projectId`，不存在双字段输出。
- `GET /api/v1/projects` 与 `/api/v1/projects/{id}` 在 M1-M2 是 `/api/v1/workspaces` 的别名，返回同一对象；M3 起别名保留但不再出现在 `meta` 的能力列表中。
- 安全模块的 `teamWorkspaceId` 与本章 `workspaceId` 同义：M3 团队模式下，一个 Workspace 即一个 Team Workspace；审计与成员表使用同一 `workspace_id` 外键，不新增平行实体。
- M3 起 `workspaces.organization_id` 是组织归属的权威列；为团队查询与审计性能，`tasks`、`agents`、`runs`、`artifacts`、`approvals`、`audit_events` 可增加冗余 `organization_id`，由服务层保证与 `workspaces.organization_id` 一致，并建立 `(organization_id, workspace_id)` 复合索引。该冗余不得成为第二事实来源。
- 里程碑文档中的 `Task.projectId`、`Run.projectId`、`Run.workspaceState` 分别按 `tasks.workspace_id`、`runs.workspace_id`、`runs` + `GET /runs/{id}/workspace` 实现；不新增 `runs.project_id` 或 `runs.workspace_state` 冗余列。

## 10. CLI

### 10.1 当前（M0）状态

| 命令 | 行为 |
| --- | --- |
| `ateam serve` | 支持 `--addr`（默认 `127.0.0.1:8787`）、`--db`（默认 `~/.ateam/ateam.db`）、`--web`（默认 `apps/web/dist`）、`--concurrency`（默认 2）；启动 API、静态站点与进程内调度器 |
| `ateam runner` | 占位：打印 "runner mode is reserved for M3; the local scheduler runs in-process today"，退出码 0 |
| `ateam version` | 打印 `0.1.0-dev`（编译期可覆盖的变量） |
| `ateam help` / `-h` / `--help` | 打印用法 |
| 无参数或未知命令 | 打印用法并以退出码 2 结束 |

M0 没有 `task`、`agent`、`run` 子命令，CLI 也不包含 Go API 客户端；`.env.example` 中的环境变量未被读取。

### 10.2 全局约定（M1 起）

**连接与实例发现。** `--server` 解析顺序：命令行 flag > `ATEAM_SERVER` 环境变量 > 当前数据目录的 `instance.json` > `~/.ateam/instance.json` > `http://127.0.0.1:8787`。

`ateam serve`（包括桌面壳的 `StartLocal`）在监听成功后写入 `<dataDir>/instance.json`（默认 `~/.ateam/instance.json`）：

```json
{
  "baseUrl": "http://127.0.0.1:54321",
  "addr": "127.0.0.1:54321",
  "pid": 12345,
  "version": "0.2.0",
  "schemaVersion": 3,
  "tokenFile": "~/.ateam/session-token",
  "startedAt": "2026-11-17T05:00:00.000Z"
}
```

文件权限 `0600`；优雅退出时删除；CLI 发现文件后先请求 `/api/v1/health` 校验 `pid` 与版本，失败则回退默认端口。桌面壳随机端口因此可被 CLI/CI 自动发现。`tokenFile` 字段在 M2.1 引入本地会话令牌后出现；M1 省略该字段。

- 配置优先级：命令行 flag > 环境变量 > 配置文件（`~/.ateam/config.toml`，M1）> 内置默认。`ATEAM_ADDR`、`ATEAM_DB`、`ATEAM_WEB_DIR`、`ATEAM_DATA_DIR`、`ATEAM_LOG_LEVEL`、`ATEAM_SERVER`、`NO_COLOR` 必须在 M1 真正生效，并写入 `.env.example`。
- 输出：人类可读表格/进度只输出到 TTY；`--json` 时标准输出仅一个 JSON 文档，`--jsonl` 时标准输出为逐行 JSON（适合 `watch` 等流式命令），日志与进度写标准错误，便于管道消费。
- 颜色：默认自动检测 TTY 与 `NO_COLOR`；`--no-color` 强制关闭。
- 超时：`--request-timeout` 作用于单次 HTTP 请求，默认 30 秒；`--watch-timeout` 作用于 `watch` 的总时长，默认 0 表示无总超时，但空闲时持续输出心跳。`--timeout` 作为 `--request-timeout` 的弃用别名保留一个里程碑。
- 非交互：`--yes` 用于确认删除、合并、部署等高风险动作；没有 `--yes` 且非 TTY 时直接拒绝并返回冲突退出码 4，不得等待输入。
- 幂等：创建类命令自动生成 `Idempotency-Key` 并在 `--json` 输出中回显，重试安全。

退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 运行时失败（Run 失败、服务端 500、内部错误） |
| 2 | 用法错误（未知命令、缺少必填参数） |
| 3 | 未找到（Workspace/Task/Agent/Run 不存在） |
| 4 | 冲突或需要人工决策（状态冲突、缺少评审、需要审批、非交互缺少 `--yes`） |
| 5 | 网络/连接/请求超时 |
| 6 | 认证或权限错误（M2.1/M3） |
| 7 | Run 被服务端取消或本地取消（`cancelled`/`cancelled_by_user`） |
| 130 | 本地用户中断（SIGINT） |

`task run` 的映射：Run `completed` → 0；`failed` → 1；服务端取消 → 7；本地 Ctrl-C → 130。`watch` 因 `--watch-timeout` 到期而退出且 Run 未终态 → 5，并在 `--json` 中标记 `timedOut=true`。

### 10.3 `ateam serve`

M0 已实现，M1 计划增强：

| Flag | 里程碑 | 说明 |
| --- | --- | --- |
| `--addr` | M0 | 监听地址；默认仅 loopback；非 loopback 在 M1 起必须携带 `--allow-remote` 并打印醒目警告 |
| `--db` | M0 | SQLite 路径 |
| `--web` | M0 | 静态资源目录 |
| `--concurrency` | M0 | 调度并发；M2 增加按 Agent 的并发上限 |
| `--config` | M1 | TOML 配置文件 |
| `--log-level` | M1 | `debug`/`info`/`warn`/`error` |
| `--data-dir` | M1 | 统一数据目录（数据库、workspaces、artifacts、backups、instance.json） |
| `--allow-remote` | M1 | 显式允许非 loopback；必须同时配置认证与 TLS 或受信代理 |
| `--print-token-file` | M2.1 | 把本地会话令牌写入 `0600` 文件并打印路径 |
| `--no-web` | M2 | 仅 API 模式，供远程 Runner 或纯 CLI 使用 |

`--data-dir` 与 `--db` 的优先级：显式 `--db` > `ATEAM_DB` > `--data-dir`/`ATEAM_DATA_DIR` 下的 `ateam.db` > `~/.ateam/ateam.db`。启动日志必须包含监听地址、数据库路径、schema 版本、备份路径（如执行了迁移）、恢复策略结果（如修复了 queued/running Run）与实例发现文件路径。

`config.toml` 的最小 schema（M1）：

| 段 | 键 | 默认 | 对应环境变量/flag |
| --- | --- | --- | --- |
| `server` | `addr` | `127.0.0.1:8787` | `ATEAM_ADDR` / `--addr` |
| `server` | `allowRemote` | `false` | `--allow-remote` |
| `server` | `webDir` | `apps/web/dist` | `ATEAM_WEB_DIR` / `--web` |
| `server` | `concurrency` | `2` | `--concurrency` |
| `storage` | `dataDir` | `~/.ateam` | `ATEAM_DATA_DIR` / `--data-dir` |
| `storage` | `dbPath` | `<dataDir>/ateam.db` | `ATEAM_DB` / `--db` |
| `storage` | `worktreeRoot` | `<dataDir>/worktrees` | `settings.worktreeRoot` |
| `storage` | `backupKeep` | `5` | 配置 |
| `logging` | `level` | `info` | `ATEAM_LOG_LEVEL` / `--log-level` |
| `logging` | `format` | `text` | 配置 |
| `runtime` | `default` | `mock` | 配置 |
| `runtime` | `claudePath` | `claude` | 配置 |
| `retention` | `eventsDays` | `7` | 配置 |
| `retention` | `eventsMaxRows` | `100000` | 配置 |
| `retention` | `runEventsPerRun` | `20000` | 配置 |
| `updates` | `channel` | `stable` | 配置 |
| `updates` | `checkOnStart` | `true` | 配置 |
| `telemetry` | `enabled` | `false` | 配置（M4） |

优先级：flag > 环境变量 > `config.toml` > 内置默认。未知配置键记录警告但不阻止启动；非法值阻止启动并给出键名。配置文件权限建议 `0600`。

### 10.4 `ateam runner`（M3）

| Flag | 说明 |
| --- | --- |
| `--server` | 服务端地址，HTTPS 或本地 HTTP |
| `--token-file` | 一次性注册令牌文件；注册后保存机器身份，不再需要该令牌 |
| `--name` | 机器名，默认主机名 |
| `--workdir` | Runner 数据目录，用于 worktree、日志与事件缓冲 |
| `--concurrency` | 本机最大并发 Run 数 |
| `--runtime` | 可重复，声明支持的 Runtime（如 `claude`、`codex`） |
| `--labels` | 可重复的键值标签，用于调度匹配 |
| `--insecure-skip-verify` | 仅开发环境，显式允许自签名证书 |

行为：注册 → 生成机器密钥对并保存到系统钥匙串或 `0600` 文件 → 签名挑战 → 心跳（15 秒）→ 领取租约 → 执行 → 按 `seq` 批量上报事件 → 分片上传 Artifact → 释放租约。与服务端断连时指数退避重连；正在执行的 Run 默认继续，事件缓存并在重连后补发；超过缓冲上限时上报失败并让 Run 失败为 `runner_lost`。Runner 版本与协议不兼容时拒绝领取新租约，但允许完成已领取的 Run。M0 的占位输出不属于兼容承诺。

### 10.5 `ateam task`（M1）

| 子命令 | 示例 | 说明 |
| --- | --- | --- |
| `list` | `ateam task list --status todo --limit 20 --json` | 列表，支持第 8 节过滤参数 |
| `get` | `ateam task get <id> --json` | 详情 |
| `create` | `ateam task create --title "Fix login" --description-file desc.md --priority 2 --label ui` | 创建；`--description-file` 避免 shell 转义问题 |
| `update` | `ateam task update <id> --status todo --if-match 3` | 更新；状态变更走状态机；`--if-match` 对应 `revision` |
| `delete` | `ateam task delete <id> --yes` | 受限硬删除；有引用时返回 4 并提示归档 |
| `archive` | `ateam task archive <id> --yes` | 归档（M1） |
| `unarchive` | `ateam task unarchive <id> --yes` | 恢复归档（M2） |
| `run` | `ateam task run <id> --agent <id 或 name> --watch --json` | 创建 Run；`--watch` 流式打印事件直到终态；`--detach` 立即返回 `runId` |

`--json` 输出至少包含 `runId`、`status`、`errorCode`、`failureDetail`、`durationMs`、`artifactCount`。

### 10.6 `ateam agent`（M1）

| 子命令 | 示例 | 说明 |
| --- | --- | --- |
| `list` | `ateam agent list --runtime claude --json` | 列表 |
| `get` | `ateam agent get <id> --json` | 详情 |
| `create` | `ateam agent create --name backend --runtime claude --model sonnet --instructions-file agent.md --allowed-path "internal/**"` | 创建；可重复 flag 生成数组 |
| `update` | `ateam agent update <id> --timeout-minutes 30` | 更新；生成新 AgentVersion |
| `delete` | `ateam agent delete <id> --yes` | 无 Run 引用时硬删除；否则提示归档 |
| `archive` | `ateam agent archive <id> --yes` | 归档（M1） |
| `versions` | `ateam agent versions <id> --json` | 版本历史（M1） |
| `skills` | `ateam agent skills <id>`（M2） | 查看/绑定/解绑技能 |

### 10.7 `ateam run`（M1）

| 子命令 | 示例 | 说明 |
| --- | --- | --- |
| `list` | `ateam run list --task <id> --status failed --json` | 列表 |
| `get` | `ateam run get <id> --json` | 详情，含 errorCode/failureDetail 与证据摘要 |
| `watch` | `ateam run watch <id> --json` | 订阅事件直至终态；断线自动重连并从 `lastSeq` 重放 |
| `cancel` | `ateam run cancel <id>` | 幂等取消 |
| `events` | `ateam run events <id> --after-seq 100 --type tool_call --json` | 拉取事件 |
| `artifacts` | `ateam run artifacts <id> --json` | 证据列表 |
| `merge` | `ateam run merge <id> --review <reviewId> --expected-head <sha> --strategy squash --yes` | 需已批准 Review；输出合并提交哈希 |
| `retry` | `ateam run retry <id> --watch` | 创建新的重试 Run |

### 10.8 `ateam version` 与 `ateam db`

M0 的 `ateam version` 输出纯字符串。M1 增加 `--json`，输出 `version`、`commit`、`buildDate`、`goVersion`、`apiVersion`、`schemaVersion`、`protocolVersion`。`ateam version` 不访问网络，不要求服务运行。

`ateam db status`（M1）输出数据库路径、大小、schema 版本、最近备份、未应用迁移与完整性检查结果；`--json` 供脚本使用。该命令只读，不执行迁移。

### 10.9 命令与里程碑汇总

| 能力 | M0 | M1 | M2 | M3 | M4 |
| --- | --- | --- | --- | --- | --- |
| `serve` | 已实现基础 flag | config、log-level、data-dir、实例发现、迁移备份 | no-web、按 Agent 并发、本地令牌 | Postgres/认证配置 | 打包集成 |
| `runner` | 占位 | 占位 | 占位 | 注册、挑战、心跳、租约、事件与证据 | 能力标签完善 |
| `task` | 无 | list/get/create/update/delete/archive/run | unarchive、依赖与交付物命令 | 团队过滤 | 模板命令 |
| `agent` | 无 | list/get/create/update/delete/archive/versions | skills、模板 | 共享 Agent | 模板导出 |
| `run` | 无 | list/get/watch/cancel/events/artifacts/merge/retry | approvals | PR 命令 | 通知偏好 |
| `version` | 纯字符串 | `--json` 详情 | 兼容输出 | 协议版本 | 插件版本信息 |
| `db` | 无 | status | 诊断包 | Postgres 状态 | 更新状态 |

## 11. 类型化 API 客户端与共享类型

### 11.1 当前（M0）

`packages/shared` 定义 `Task`、`Agent`、`Run`、`RunEvent`、`Health`、状态联合类型、标签映射与 `RUNTIMES`（`mock`、`claude`）。`packages/api-client` 的 `createClient(baseUrl='/api')` 暴露：

- `health`
- `listTasks`、`getTask`、`createTask`、`updateTask`、`deleteTask`
- `listAgents`、`getAgent`、`createAgent`、`updateAgent`、`deleteAgent`
- `listRuns`、`listRunsByTask`、`getRun`、`createRun`、`listRunEvents`、`cancelRun`

限制：错误处理只抛出包含原始响应文本的 `Error`；没有 WebSocket、分页、请求取消、重试或幂等键；`updateTask`/`updateAgent` 接受 `Partial<T>`，与服务端可空字段语义不完全一致。

### 11.2 计划（M1）

TypeScript 客户端目标接口：

```ts
interface Page<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
  total?: number
}

class ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>
  requestId?: string
  retryable: boolean
}

interface EventEnvelope<T = unknown> {
  id: string
  seq: number
  v: 1
  type: ServerEventType
  at: string
  workspaceId: string
  actor: { type: 'human' | 'agent' | 'system' | 'runner'; id: string; displayName?: string }
  correlationId: string
  causationId?: string
  automationId?: string
  dedupeKey?: string
  data: T
}

interface ClientOptions {
  baseUrl?: string
  token?: string
  fetch?: typeof fetch
  requestTimeoutMs?: number
  idempotencyKey?: () => string
}
```

方法变化：

- 列表方法接受查询参数对象并返回 `Page<T>`，例如 `listTasks({ status, label, q, cursor, limit, sort, includeArchived })`。
- 所有方法接受 `AbortSignal` 选项；`request` 层统一处理超时与取消。
- 写操作返回 `ApiError` 时可读取稳定 `code`；`requestId` 可直接展示给用户反馈。
- `updateTask`/`updateAgent` 等写方法接受 `expectedRevision` 或 `If-Match`，冲突时抛出 `STALE_REVISION`。
- 新增 `createEventStream({ afterSeq, topics, onEvent, onReset, onStateChange })`：封装连接、心跳、指数退避、去重与 `lastSeq` 维护；`onReset` 回调要求调用方重新拉取快照。
- 新增 `watchRun(runId, { onEvent, onFinished })`：订阅指定 Run，终态时自动结束。
- 新增 `archiveTask`/`unarchiveTask`、`listWorkspaces`/`createWorkspace`、`getRunWorkspace`、`listDeliverables`、`submitReview`、`decideApproval` 等方法，与 5.13 端点总表一一对应。
- `delete` 与 `cancel` 保持幂等语义，重复调用不抛错。

Go 侧：M1 增加 `internal/apiclient` 包，供 CLI 使用。它与 TypeScript 客户端语义一致：同样的错误码、分页参数、幂等键与重连逻辑。CLI 不得直接拼接 HTTP 请求，避免两套行为。

### 11.3 类型同步与契约测试

- **M1**：Go 领域对象是唯一事实来源。测试为每个端点的代表响应生成 golden JSON 夹具（`packages/shared/test/fixtures/*.json`）；TypeScript 测试用轻量校验器检查字段存在与类型，CI 发现漂移即失败。
- **事件与错误夹具**：`fixtures/events/*.json` 覆盖 6.3 的每个事件类型与 7.3/7.4 的每个错误码；`fixtures/endpoints.json` 是 5.13 端点总表的机器可读副本，CI 校验路由注册与夹具一致。
- **M2**：从 Go 路由与类型生成 OpenAPI 3.1 文档，使用 `openapi-typescript` 生成 TS 类型；生成文件纳入版本控制并有 `make check-types` 校验。Go 客户端仍可手写，但必须以 OpenAPI 为契约。
- **版本约束**：`packages/shared` 的 breaking change 与 `/api/v1` 的 breaking change 同步；同一 monorepo 内发布，不做独立语义化版本承诺。
- **未知字段**：TS 类型不设 `exactOptionalPropertyTypes` 级别的封闭校验；客户端必须忽略未知字段，保证服务端先升级、客户端后升级的场景可用。
- **跨文档引用检查**：CI 扫描 `prd/` 下的 `API-` 编号引用，确认不存在重复定义与悬空引用；本章固定使用 `API-1xxx` 段（见 14.0）。

## 12. 版本化与兼容性

### 12.1 版本层次

| 层次 | 标识 | 规则 |
| --- | --- | --- |
| 产品版本 | SemVer（`0.1.0-dev`） | M0-M2 为 0.x，允许在 CHANGELOG 说明后发生行为变更；1.0 后遵循 SemVer |
| REST API | 路径 `/api/v1` | 主版本在路径；v1 内只做加法；破坏性变更升 v2 |
| 路径别名 | `/api/*` | 永久兼容别名，携带 `Deprecation: true`；共享 v1 handler，不承诺与 v1 不同的行为 |
| 事件 schema | 信封字段 `v` | v1 内新增事件类型与字段允许；删除/改语义升 v2 |
| 事件目录 | `meta.eventCatalogVersion` | 每次增删事件递增；客户端可据此刷新订阅逻辑 |
| RunEvent | `type` 与 `payloadVersion` | 新增类型允许；现有类型 payload 只增字段 |
| 错误码 | `meta.errorRegistryVersion` | 新增码递增；不得重用已废弃码表示新语义 |
| 数据库 schema | `schema_migrations` | 单调递增；应用拒绝打开更高版本数据库 |
| Runner 协议（M3） | `protocolVersion` 与 `/api/v1/runner/*` | 主版本必须一致；不兼容时拒绝新租约，已领取 Run 允许完成 |
| 插件 API（M4） | manifest `apiVersion` | 只加载声明兼容版本的插件 |

### 12.2 兼容规则

1. v1 内允许：新增端点、新增可选查询参数、新增响应字段、新增事件类型、新增错误码、放宽输入限制。
2. v1 内禁止：删除或重命名字段、改变字段类型、改变枚举含义、改变默认排序、收紧已有合法输入导致旧客户端失败。
3. 枚举扩展：客户端遇到未知 Task 状态、Run 状态或事件类型时必须降级展示（显示原始值），不得崩溃或丢弃整个列表。
4. 服务端对未知请求字段忽略；对未知枚举值按 `VALIDATION_FAILED` 处理，避免写入不可解释状态。
5. 时间、ID、货币类字段不做隐式格式变更；ID 始终字符串。
6. 分页与错误体属于 v1 契约的一部分，M1 发布后不得回退为 M0 形状。
7. `force push` 不在任何版本的合法动作集合内；不存在通过新版本「恢复」该能力的路径。

### 12.3 弃用流程

- `/api/*` 从 M1 起标记弃用：所有别名响应带 `Deprecation: true` 与 `Link`；CHANGELOG 说明。别名不会在 M2 删除，只有未来发布 v2 后才可能冻结；是否最终移除由 05-risks-and-open-questions 中的兼容性决策决定。
- `/api/v1/projects`、`/api/v1/contracts`、`/api/v1/tasks/{id}/restore`、`/machines/tokens` 是里程碑或旧稿命名的兼容别名，语义分别等同 `workspaces`、`deliverables`、`unarchive`、`register-tokens`；新代码不得只实现别名。
- 已弃用的字段或端点至少在两个 minor 版本或一个里程碑内保持可用；本地应用节奏快，允许在一个里程碑内完成迁移，但必须提供迁移说明。
- 弃用不得静默改变行为；别名与规范路径行为不一致时，视为缺陷，先修复别名。

### 12.4 数据与协议兼容

- M0 数据库到 M1 必须自动迁移；发布前用 M0 真实数据夹具跑升级测试。
- M1 及以后每个版本保留「上一版本数据库」夹具，形成连续升级链测试。
- M3 远程 Runner 与服务端版本不一致时，服务端在注册/租约响应中返回 `protocolVersion` 与最低要求；Runner 拒绝新租约，但已领取的 Run 允许完成，避免半途丢弃工作。
- 插件与 Webhook 消费者依赖事件 `v`；服务端不得向声明 v1 的连接发送 v2 信封。
- 事件名或错误码重命名必须提供至少一个里程碑的并行发送与映射表，客户端在并行期按旧名或新名都能工作。

## 13. 交互与规则（API 层）

本章只定义 API 层的校验、持久化与广播契约。业务矩阵的权威位置如下：

| 规则 | 权威文档 | 本章职责 |
| --- | --- | --- |
| Task 状态流转 | `task-management.md` §5.2 | 在 PATCH/批量接口执行校验，返回 409 与允许目标 |
| Run 状态与失败分类 | `runtime-and-workspace.md` §11 与 `02-domain-model.md` §4.3 | 持久化状态、失败码与事件 |
| 评审、合并门、契约 | `collaboration-and-review.md` §8、§9 | 提供端点、表结构与校验顺序 |
| 归档、删除、依赖 | `task-management.md` §12、§9 | 提供归档字段、受限硬删除与依赖表 |
| 认证、RBAC、审计 | `security-and-permissions.md` §4、§7、§8 | 中间件、表结构与错误码 |

### 13.1 Task 状态机（引用任务模块 §5.2）

下表是任务模块 §5.2 的引用副本，不是第二套定义；两者不一致时以任务模块为准，并立即回写本章。M0 的 PATCH 允许任意合法状态互转，M1 起由服务端强制执行本表。

| 当前状态 | 允许流转到 | 触发方式 | 约束 |
| --- | --- | --- | --- |
| `backlog` | `todo`、`cancelled` | 人工 | 进入 `todo` 前通过 DoR 检查 |
| `todo` | `backlog`、`in_progress`、`blocked`、`cancelled` | 人工或启动 Run | 启动 Run 自动进入 `in_progress` |
| `in_progress` | `todo`、`in_review`、`blocked`、`cancelled` | 人工或 Run 完成建议 | 进入 `in_review` 建议存在 completed Run 或人工说明 |
| `in_review` | `in_progress`、`done`、`blocked`、`cancelled` | 人工评审 | 进入 `done` 必须通过评审门并满足 DoD |
| `done` | `todo`（重新打开） | 人工，M2 | 需要二次确认并填写原因 |
| `blocked` | `todo`、`in_progress`、`cancelled` | 人工或依赖解除 | 解除时恢复阻塞前状态或由用户选择 |
| `cancelled` | `backlog`（重新打开） | 人工，M2 | 需要二次确认并填写原因 |

实现要求：

- 非法迁移返回 `409 INVALID_STATUS_TRANSITION`，`details` 包含 `from`、`to`、`allowed` 与可选 `reason`。
- CI 必须跑 7×7 全矩阵契约测试：每个允许组合断言 200 与事件，每个禁止组合断言 409 且不写库。该测试是 M1 退出门，不能只测常见路径。
- `archivedAt` 不是状态；归档任务保留原状态，从默认列表与依赖新增候选中排除。归档未完成任务时下游转为 `blocked`；归档已完成任务不改变依赖满足。
- 批量状态更新逐项校验，采用「部分成功」语义，响应列出成功与失败明细；不得整体回滚已成功项。
- 创建 Run 只允许 `todo`、`in_progress`；M1 不允许从 `in_review` 创建 Run，M2 的返工例外必须先创建新 Review 或记录取代原因（领域模型 §4.2、§4.4）。Run 完成不会自动把 Task 置为 `done`。M1 提供 `auto_move_to_review` 配置，默认关闭；即使开启也只允许进入 `in_review`。M1 里程碑 TASK-002 的「Run completed 后自动进入 in_review」需按任务模块 §5.3 R4 改为「默认关闭、可配置」，两边统稿时同步。
- Review 为 `approved` 且 `requiresMerge=false` 时，评审决策可在同一事务把 Task 从 `in_review` 置为 `done`，但必须记录 `noMergeReason` 且由人类触发；`requiresMerge=true` 时 Task 保持 `in_review`，直到合并成功。

### 13.2 Run 状态机（引用运行时模块 §11）

`queued → preparing → running → completed | failed | cancelled`；`queued` 可直接 `cancelled`；`preparing` 可 `failed`/`cancelled`；`running` 可 `failed`/`cancelled`。终态不可迁移。

- Worker 取到 Run 后必须重新校验状态，非 `queued` 直接忽略；取消后不得被回写为 `preparing`/`running`/`completed`/`failed`。
- 应用重启时 `preparing`/`running` 标记为 `failed`，`errorCode=interrupted`、`failureDetail=app_restart`；`queued` 可重新入队。
- 超时映射为 `failed`/`timeout`/`timeout`，不是 `cancelled`；人工取消映射为 `cancelled`/`cancelled_by_user`/`user_cancel`。
- Run 终态写入使用条件更新（`WHERE id=? AND status IN (...)`），受影响行数为 0 视为冲突并读取最终状态返回幂等结果。
- 初始化恢复完成后，服务才写实例发现文件并开始监听端口。

### 13.3 合并与审批规则

**M1 合并请求体：**

```json
{
  "reviewId": "rev_01J8Z9K2M3",
  "expectedHeadCommit": "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
  "targetBranch": "main",
  "strategy": "squash",
  "confirm": true,
  "approvalId": null
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `reviewId` | 是 | 必须是该 Run 的 `approved` Review，且未被 `superseded`；不存在 `expired` 状态 |
| `expectedHeadCommit` | 是 | 与服务端记录的 Run 分支 head 完全一致；防止评审后分支移动 |
| `targetBranch` | 是 | 目标分支；默认为 Workspace 的 `defaultBranch` |
| `strategy` | 是 | M1 仅 `squash`、`merge`，默认 `squash`；M2 增加 `rebase` |
| `confirm` | 是 | 必须为 `true`；缺失或 `false` 返回 `400 VALIDATION_FAILED` |
| `approvalId` | M2 必填 | 有效且未消费的 `merge` Approval |

**校验顺序与错误码：**

1. 请求体合法且 `confirm=true`，否则 `400 VALIDATION_FAILED`。
2. Run 存在且为 `completed`，否则 `409 INVALID_STATUS_TRANSITION`。
3. Task 属于该 Run 且状态为 `in_review`，否则 `409 INVALID_STATUS_TRANSITION`。
4. `reviewId` 存在、属于该 Run、状态 `approved`、未被取代，否则 `409 REVIEW_REQUIRED`。
5. Review 的 `evidenceSnapshotHash` 与当前证据集合一致；不一致时把该 Review 置为 `superseded` 并返回 `412 STALE_EVIDENCE`，要求重新评审。
6. `expectedHeadCommit` 与 Run 记录的 head 一致，否则 `412 STALE_HEAD`。
7. 目标分支存在，否则 `409 TARGET_BRANCH_NOT_FOUND`。
8. 目标工作区干净，否则 `409 WORKSPACE_DIRTY`。
9. 目标分支 head 等于 Run 的 `baseCommit`，否则 `409 BASE_BRANCH_MOVED`。
10. M2：`approvalId` 有效、未消费、未过期，且 `actionFingerprint` 匹配 `runId`、`reviewId`、`expectedHeadCommit`、`targetBranch`、`strategy`；参数不一致返回 `409 APPROVAL_MISMATCH`，内容哈希不一致返回 `412 PRECONDITION_FAILED`，已消费返回 `409 APPROVAL_CONSUMED`。
11. 执行 pre-merge 冲突检测；冲突返回 `409 MERGE_CONFLICT` 与冲突文件列表，不自动解决。
12. 合并成功写 `merge_records`，Task 进入 `in_review` 并生成一条待人工确认项（`merge_confirmation`），发出 `merge.started` 与 `merge.completed`；只有人工确认后才进入 `done`，系统不得在合并后自动置 `done`（COLLAB-056、COLLAB-077、§9.4）。重复合并返回 `409 RUN_ALREADY_MERGED`。

规则：

- M1 不引入通用 Approval 实体：合并门 = 已批准 Review + 证据快照 + `expectedHeadCommit` + 显式确认。M2 增加 `merge` Approval；领域模型 §3.11 与本章一致，Approval 首交付为 M2。
- `deploy_prod` 永远由人类在 ATeam 之外执行；ATeam 不存在「审批后由 Agent 或受控执行器执行 prod」的路径，只生成审批记录与人工检查单。DevOps 在 M2 只能生成部署计划与执行 staging。
- `push` 在 M2.1 只创建与消费审批记录、不执行远程 push；M3 才执行远程 push。`deploy_staging`、`delete_workspace`、`runner_revoke`、`secret_rotate` 属于高风险动作，M2/M3 起需要 Approval；M1 不提供推送端点。
- Task/Agent 的 `DELETE` 与 `archive` 请求必须携带 `confirm=true`（查询参数或 `X-ATeam-Confirm: true` 头），缺失返回 `400 VALIDATION_FAILED`；M3 团队模式删除还需 workspace_admin 权限，Task 删除需二次审批并在 `audit_events` 留痕。Artifact 删除按 5.8 的本地确认/团队权限规则执行。
- 所有审批决策记录 `actor`、时间、`requestId` 与理由；M3 写入 `audit_events`。
- 合并端点只接受人类会话或本地用户；Agent、Runner、插件身份调用返回 `403 FORBIDDEN`，并记录安全事件。
- 不提供 `force_push` 动作；任何 `--force` 类 Git 操作都被 Git 安全规则禁止，不存在审批放行路径。

### 13.4 幂等与并发规则

- **版本字段**：M1 起 Workspace、Task、Agent、Review、Deliverable、Approval 带 `revision` 整数，初始 1，每次成功更新加一。响应只返回 `revision` 与 `updatedAt`，不返回 `version`。任务模块与里程碑文档中的 `version` 是 `revision` 的历史别名，只允许出现在请求输入的兼容层（`If-Match`/`expectedRevision` 优先），不得在响应或数据库中出现第二个版本字段。
- **条件更新**：`PATCH`、`POST /decision`、`POST /archive`、`POST /merge` 等写操作接受 `If-Match: "<revision>"` 请求头或请求体 `expectedRevision`；两者同时提供且不一致时返回 `400 VALIDATION_FAILED`。版本不匹配统一返回 `409 STALE_REVISION`，`details.currentRevision` 给出当前值。M1 起本地模式即启用；M3 团队模式强制要求。
- **412 的边界**：`412 PRECONDITION_FAILED` 只用于动作内容哈希、审批指纹、评审快照等前置条件，不用于实体版本号；这与领域模型 §4.1「并发更新返回 409」和任务模块 TASK-122 一致。
- **活跃 Run 唯一性**：同一 Task 的活跃 Run 唯一性由服务端事务（部分唯一索引或服务层锁）保证，不能只依赖 UI 禁用按钮。
- **状态竞争**：状态更新使用条件更新；并发取消与完成竞争时，先通过条件更新写入的合法终态生效，后到者读取最终状态并返回幂等结果。
- **幂等键**：`POST` 创建类端点支持 `Idempotency-Key`；未提供时按普通请求处理，不保证重试安全。相同键不同请求体返回 `409 IDEMPOTENCY_CONFLICT`，不执行写操作。
- **`PATCH` 的 `null` 语义**：`assigneeId`、`assigneeType`、`parentId`、`blockedReason` 可被显式 `null` 清空；字符串字段（如 `description`）用空串清空；数组字段用 `[]` 清空。服务端在文档与测试中固定该语义。
- **归档的并发**：归档与取消活跃 Run 同时发生时，先到者生效；若归档请求先到且有活跃 Run，返回 `409 TASK_HAS_ACTIVE_RUN` 并提示先取消 Run。

### 13.5 事件与 UI 的交互

- UI 收到任何事件后不应盲目全量刷新；M1 客户端按事件类型增量更新，并在重连或 `events.replay_reset` 时拉取快照。
- Run 详情页以 RunEvent 为主展示时间线，以 Run 字段为准展示状态；两者冲突时以 Run 快照为准并提示事件可能延迟。
- 对高频 `run.event`，UI 按 100ms 批量渲染，避免长输出导致卡顿；CLI `watch` 逐行输出，`--json` 模式按行输出 JSONL 以便处理。
- UI 必须依赖 `actor.type` 区分人类、Agent、系统与 Runner 动作；Agent 发起的请求不得显示为人工批准。

### 13.6 时间与排序

- 所有时间字段为 UTC，客户端按本地时区展示；API 不接受客户端时间作为事实，只接受 `since`/`until` 过滤。
- 默认排序统一为 `-createdAt`，但 Run 详情中的事件固定按 `seq` 升序。
- 相同时间戳的记录使用 ID 作为决胜列，保证分页稳定。
- M3 远程 Runner 以服务端接收心跳时间为准；Runner 上报时钟偏移超过 2 秒时在事件中标记，不阻塞执行。

## 14. 功能需求

### 14.0 编号注册表与本次重编号

本章 FR 编号固定使用 `API-1xxx` 段。原稿 `API-001..250` 与新编号的映射规则为：**新编号 = 旧编号 + 1000**（例如旧 API-001 → API-1001，旧 API-168 → API-1168，旧 API-250 → API-1250）。新增需求使用未占用的 `API-1251..1299` 与 `API-1300..1399`（M4）。

全局 FR 前缀保留段：

| 前缀 | 归属 | 说明 |
| --- | --- | --- |
| `API-1xxx` | 本章（API、数据、CLI） | 唯一允许在本章新增的 API 段 |
| `API-001..099` | M0 里程碑历史编号 | 只读保留；M0 文档中的健康检查、WebSocket 等编号不得在本章复用 |
| `API-100..999` | 未分配 | 预留给未来拆分，不得随意占用 |
| `TASK-` / `AGENT-` / `RUN-` / `WS-` / `ART-` / `REV-` / `APPR-` / `COLLAB-` / `TEAM-` / `UI-` / `NFR-` | 各模块文档 | 本章不新增这些前缀 |
| `M1-API-` 等 | 里程碑局部编号 | M1 里程碑的 `API-001..009` 属于此段，建议改写为 `M1-API-xxx` 或直接引用本章编号 |

CI 检查：同一文档内编号唯一；跨文档引用必须带文档前缀；`prd/` 下不得出现未登记的 `API-0xx` 新编号；本章 5.13 端点总表与路由注册、契约夹具三方一致。验收文档中「API-001～API-250」的范围说明同步更新为「API-1001～API-1299」，旧引用按 +1000 映射。

以下需求均以「可测试」为标准编写；里程碑列表示首次交付版本。当前 M0 已满足的项标注为 M0，并注明 M1 的结构化改造。

### 14.1 API 基础与版本（API-1001 至 API-1012）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1001 | M1 起提供 `/api/v1` 前缀，所有新端点只在该前缀下定义 | 请求 `/api/v1/health` 返回 200；未知 `/api/v1/*` 返回 JSON 404 | M1 |
| API-1002 | `/api` 作为永久兼容别名（入站 `/api/hooks/{hookId}` 除外），与 `/api/v1` 共享 handler 并返回 `Deprecation` 头 | 请求 `/api/tasks` 与 `/api/v1/tasks` 返回同构响应；响应含 `Deprecation: true` 与 `Link` | M1 |
| API-1003 | 每个响应携带 `X-Request-ID` 与 `X-ATEAM-API-Version: 1` | 任意成功与失败响应均可读取两个头 | M1 |
| API-1004 | JSON 请求体上限 1 MiB，超限返回 `413 PAYLOAD_TOO_LARGE` | 发送 2 MiB body 得到 413，而非 JSON 解析错误 | M1 |
| API-1005 | 未知 `/api/*` 路径返回 JSON 错误，不落入 SPA fallback | 请求 `/api/v1/nope` 得到 404 与错误体，Content-Type 为 JSON | M1 |
| API-1006 | 非 `/api` 路径继续提供 SPA 静态资源与 `index.html` 回退 | 访问 `/board` 返回 index.html；访问缺失的 `.js` 不返回 HTML | M0/M1 修正 |
| API-1007 | 所有时间字段以 RFC3339 UTC 毫秒输出，存储为 Unix 毫秒 | 创建后立即读取与稍后读取的时间字符串一致 | M1 |
| API-1008 | ID 为不透明字符串，客户端不得解析；新实体沿用 24 位十六进制 | 契约测试断言 ID 仅按字符串比较 | M0 |
| API-1009 | 服务端忽略请求中的未知字段，不影响合法字段解析 | 带 `unknown: 1` 的 POST 仍成功 | M0 |
| API-1010 | 写请求 `Content-Type` 不是 `application/json` 时返回 `415 UNSUPPORTED_MEDIA_TYPE` | 以 `text/plain` POST 得到 415；M0 此行为不存在 | M1 |
| API-1011 | 健康检查在数据库不可用时返回 `503`，`status="degraded"`，`database.status="down"`；正常时返回 `200`、`status="ok"`、`schemaVersion`、`dataDir.writable=true` | 关闭数据库后健康检查固定返回 503 与上述字段；这是单一可判定结果 | M1 |
| API-1012 | HTTP 服务设置 `ReadHeaderTimeout=5s`、`ReadTimeout=30s`、`WriteTimeout=60s`、`MaxHeaderBytes=64KiB` | 发送 65KiB 请求头得到 431；慢请求在 30 秒内被关闭 | M1 |

### 14.2 Tasks（API-1020 至 API-1031）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1020 | Task 列表支持分页、过滤、排序与搜索 | 传入 `status`、`q`、`limit`、`cursor`、`sort`、`includeArchived` 均生效；非法值返回对应错误码 | M1 |
| API-1021 | 创建 Task 校验标题 1-200 字符、描述不超过 64 KiB、labels 最多 20 个且每个不超过 32 字符 | 边界值测试通过；超限返回 `VALIDATION_FAILED` 与字段 details | M1 |
| API-1022 | 优先级限定为 0-4，未知值返回 400 | 传入 5 或 -1 被拒绝 | M1 |
| API-1023 | Task 状态变更遵循任务模块 §5.2 矩阵（本章 13.1） | 7×7 全矩阵契约测试通过；非法迁移返回 409 并列出允许状态 | M1 |
| API-1024 | `PATCH` 支持显式 `null` 清空可空字段，支持空串清空文本 | 三种语义各有测试 | M1 |
| API-1025 | 删除 Task 采用归档语义：M1 要求二次确认、存在活跃 Run 或未关闭 Review 时返回 `409 TASK_HAS_ACTIVE_RUN`/`TASK_HAS_REFERENCES`，通过校验后写 `archivedAt`；M2.1 起进入 30 天恢复窗口；不提供硬删除端点 | 有活跃 Run 的任务 DELETE 返回 409；无引用任务 DELETE 返回归档结果；缺少 confirm 返回 400；归档与 DELETE 行为一致 | M1/M2.1 |
| API-1026 | 提供 `POST /tasks/{id}/archive` 归档，`POST /tasks/{id}/unarchive` 恢复；归档设置 `archivedAt` 且默认列表不返回；请求必须带 `confirm=true` | 归档后 GET 返回 200 且 `archivedAt` 非空；默认列表不含；`includeArchived=true` 可见；缺少 confirm 返回 400；M2 可恢复 | M1/M2 |
| API-1027 | `GET /tasks/{id}/runs` 对不存在的 Task 返回 404 | 修复 M0 返回空数组的行为 | M1 |
| API-1028 | 创建 Run 时校验 Task 可执行状态与 Workspace 绑定；状态冲突返回 `TASK_NOT_EXECUTABLE`，未绑定仓库返回 `WORKSPACE_REQUIRED` | 与 M0 行为一致，但错误结构化并包含允许状态/绑定提示 | M1 |
| API-1029 | 标签过滤为 AND 语义，可重复传参 | `label=a&label=b` 只返回同时含两者的任务 | M1 |
| API-1030 | 搜索结果转义 `%`、`_` 与转义符，长度限制 2-128 | 特殊字符不会扩大匹配范围 | M1 |
| API-1031 | `restore` 作为 Task/Agent `unarchive` 的兼容别名，行为与响应完全一致；M2.1 起同时用于 30 天恢复窗口内的软删除恢复 | 两个端点对同一归档资源返回相同结果，且只产生一个 `task.restored`/`agent.restored` 事件 | M2.1 |

### 14.3 Agents（API-1040 至 API-1050）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1040 | Agent 的 `runtime` 在创建/更新时校验为服务端公布的枚举 | 传入未知 runtime 返回 400；`meta` 中可见合法值 | M1 |
| API-1041 | Agent 缺省值保持 M0 语义：runtime=mock、workspaceMode=worktree、maxConcurrency=1、timeoutMinutes=60 | 创建最小 Agent 后字段符合预期 | M0 |
| API-1042 | 活跃 Agent 名称唯一；冲突返回 `AGENT_NAME_CONFLICT` | 同名创建失败；归档后可复用名称 | M1 |
| API-1043 | `timeoutMinutes` 限定 1-1440，`maxConcurrency` 限定 1-16 | 越界返回 400 | M1 |
| API-1044 | 每个 Run 在创建时写入 `agentVersionId`、runtime、model、instructions 摘要与配置快照 | 修改 Agent 后历史 Run 的详情不变 | M1 |
| API-1045 | 删除 Agent 前检查引用：存在活跃 Run 返回 `AGENT_IN_USE`；仅有历史 Run 引用返回 `AGENT_HAS_REFERENCES` | 有历史 Run 时只能归档；活跃 Run 期间删除失败 | M1 |
| API-1046 | `allowedPaths` 与 `allowedCommands` 在 M1 存储并在 UI 展示，M2 执行前强制校验 | M2 违规调用产生 `permission_denied` 事件并终止 Run | M2 |
| API-1047 | Agent 列表支持 runtime、role 过滤，搜索、排序与分页 | 过滤与分页组合正确 | M1 |
| API-1048 | Agent 可绑定技能版本（M2），Run 快照记录技能版本 | 解绑或升级技能不改变历史 Run | M2 |
| API-1049 | 删除 Agent 采用「归档默认、硬删除受限」，保留历史 Run 的可读性 | 归档后历史 Run 仍能展示 Agent 名称与版本快照 | M1 |
| API-1050 | Agent 的每次执行语义变更生成新的 `AgentVersion`，`versionNumber` 单调递增且不可变；Run 固定引用版本 | 修改 instructions 后版本数加一；旧 Run 的 `agentVersionId` 不变 | M1 |

### 14.4 Runs（API-1060 至 API-1075）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1060 | 创建 Run 支持 `Idempotency-Key`，24 小时内相同键相同请求返回原响应 | 并发重试只产生一个 Run；不同请求体返回 409 | M1 |
| API-1061 | 同一 Task 默认只允许一个活跃 Run；冲突返回 `RUN_ALREADY_ACTIVE` | 第二个请求失败并返回现有 Run；M2 显式 `allowConcurrent=true` 或任务级策略可绕过 | M1 |
| API-1062 | Worker 执行前重新校验 Run 状态，终态直接跳过 | 取消排队 Run 后不再执行（修复 G-01） | M1 |
| API-1063 | 服务启动时恢复队列：queued 重新入队，preparing/running 标记 `failed`/`interrupted`/`app_restart` | 重启测试中无永久 queued 或错误 running 记录 | M1 |
| API-1064 | 队列满时在创建前返回 `503 QUEUE_FULL`，不创建 Run；若创建后入队异常，Run 终态为 `failed` 且 `errorCode=runtime_error`、`failureDetail=scheduler_internal` | 队列满测试中无无主 queued 记录 | M1 |
| API-1065 | 取消为幂等操作；终态重复取消返回原对象 | 并发取消与完成竞争后状态一致 | M0/M1 |
| API-1066 | Run 事件支持 `afterSeq`、`limit`、`type` 过滤，父 Run 不存在返回 404 | 游标翻页无重复、无遗漏 | M1 |
| API-1067 | 每条 Run 事件有唯一 `(runId, seq)`；冲突时服务端重试或拒绝写入 | 并发写入测试不产生重复 seq | M1 |
| API-1068 | Run 终态不可变；非终态到终态的迁移合法，其他更新返回 409 | 终态后 PATCH/重试取消行为符合规则 | M1 |
| API-1069 | `retry` 创建新 Run，记录 `retryOf` 与递增的 `attempt`，不复用旧 Run Workspace | 原 Run 保持终态；新 Run 有独立 worktree | M1 |
| API-1070 | `merge` 执行 13.3 的全部门禁，失败不产生 git 副作用 | 缺少 reviewId、head 变化、基线前进、脏工作区、冲突各有测试与固定错误码 | M1 |
| API-1071 | Run 详情返回 `errorCode`、`failureDetail`、`exitCode`、AgentVersion、Workspace 摘要、Artifact 与 Review 摘要 | 失败 Run 可定位到具体原因 | M1 |
| API-1072 | 同一 Run 的事件总量与单条消息有上限，超限截断并标记 | 长输出测试中数据库大小有界 | M1 |
| API-1073 | 合并请求体固定为 13.3 的 schema，包含 `reviewId`、`expectedHeadCommit`、`targetBranch`、`strategy`、`confirm`，M2 增加 `approvalId` | 契约夹具校验字段；缺字段返回 400；不允许未声明的字段改变行为 | M1 |
| API-1074 | 提供 `GET /runs/{id}/workspace`，返回路径、分支、base/head commit、生命周期状态与清理状态 | 与 worktree 实际状态一致；父 Run 不存在返回 404 | M1 |
| API-1075 | Run 的 `attempt` 从 1 开始，同一 Task 的 Run 可按 `attempt` 排序；重试链可查询 | 连续重试 3 次后 `attempt` 为 1/2/3 | M1 |

### 14.5 Artifacts 与 Reviews（API-1080 至 API-1092）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1080 | Run 结束后自动生成 diff Artifact，包含已跟踪与未跟踪文件 | 完成 Run 的证据列表包含类型为 diff 的 Artifact | M1 |
| API-1081 | Artifact 元数据包含类型、大小、sha256、来源 Run 与创建时间 | 下载内容哈希与元数据一致 | M1 |
| API-1082 | Artifact 内容只能通过 ID 访问，路径不得由客户端指定 | 构造路径穿越请求失败 | M1 |
| API-1083 | Runtime 声明的产物路径必须位于 Run Workspace 内且解析符号链接后仍在工作区内 | 越界路径被拒绝并产生 `error` 事件 | M1 |
| API-1084 | 单文件与单 Run Artifact 总量有上限：HTTP 上传超限返回 `413 PAYLOAD_TOO_LARGE`；Runtime 声明的产物超限产生 `artifact.rejected` 事件并把该证据标记为缺失 | 两条路径各有测试；大文件被拒绝且原因明确 | M1 |
| API-1085 | 文本预览支持 `maxBytes` 截断并返回总大小；二进制仅下载 | 预览与下载行为符合 Content-Type | M1 |
| API-1086 | Review 状态机遵循领域模型 §4.5；结论不可修改，只能被新 Review 取代 | 非法状态迁移返回 409；PATCH/DELETE Review 返回 `405 METHOD_NOT_ALLOWED` | M1 |
| API-1087 | 合并要求至少一个 `approved` Review 且无未解决 blocking comment；`changes_requested` 后必须出现新的 `approved` | 各种评审组合有测试 | M1 |
| API-1088 | Review 引用的 Artifact 必须属于同一 Run 或 Task | 跨任务引用返回 400 | M1 |
| API-1089 | 任务维度可聚合跨 Run 的证据与评审（M2） | 聚合视图与单 Run 数据一致 | M2 |
| API-1090 | 删除 Artifact：M2 本地模式要求 `confirm=true`，M3 要求 workspace_admin 权限或有效 Approval；同步删除磁盘文件 | 缺少确认返回 400；越权返回 403；删除后下载返回 404，磁盘无残留 | M2 |
| API-1091 | ReviewComment 支持 `blocking`/`non_blocking`/`info`；blocking 意见解决后写 `resolvedAt`，否则 Review 不得 approve | 未解决的 blocking 意见使 approve 返回 409 | M1 |
| API-1092 | Evidence 状态为 `passed`/`failed`/`missing`/`waived`，另带 `validity`（`valid`/`unverified`/`invalid`）；只有人类可 `verify`；契约要求的条目未 `passed`/`waived` 时 Review approve 失败；API 旧值 `present`/`verified`/`rejected` 按 `missing`/`passed`/`failed` 归一化 | Agent 调用 verify 返回 403；缺失证据返回 409 与缺失清单；响应同时包含 status 与 validity | M2 |

### 14.6 Approvals、Skills、Machines（API-1100 至 API-1112）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1100 | Approval 状态机为 pending → approved/rejected/expired/cancelled/consumed；approved 可被消费 | 非法决策返回 409；过期不可批准；消费后不可重用 | M2 |
| API-1101 | Approval 绑定 `actionType`、`targetType`、`targetId`、`actionFingerprint`、`paramsHash`、`contentHash`；执行时参数必须匹配 | 修改部署目标后使用原审批返回 `APPROVAL_MISMATCH`；指纹变化返回 412 | M2 |
| API-1102 | `deploy_prod` 在 ATeam 中无执行端点，审批只生成人工检查单；`push`（M2.1 只登记/消费审批、M3 才执行）、`deploy_staging`、`delete_workspace` 无有效审批时不得执行 | prod 直接调用任何执行端点返回 404/403；其余动作缺审批返回 `APPROVAL_REQUIRED` | M2/M3 |
| API-1103 | 单用户模式允许自审批但记录 `selfApproved=true`；团队模式要求请求人与决策人不同 | M3 中同一用户决策返回 403，除非 owner 覆盖并记录审计 | M2/M3 |
| API-1104 | Approval 默认过期时间按动作配置：merge 24 小时、staging 4 小时、prod 30 分钟且不允许「不自动过期」、其他动作 72 小时 | 过期后状态与执行行为正确 | M2 |
| API-1105 | Skill 版本不可变；发布新版本新增 `skill_versions` 记录，不覆盖历史 | 历史 Agent 绑定仍指向旧 `skillVersionId` | M2 |
| API-1106 | Skill 被 Agent 绑定时删除返回 `409 SKILL_IN_USE`，必须先解绑 | 绑定期间删除失败并列出引用方；解绑后删除成功 | M2 |
| API-1107 | Machine 注册令牌一次性、15 分钟过期、仅存哈希 | 重复使用令牌失败；过期令牌失败 | M3 |
| API-1108 | Machine 心跳间隔 15 秒，45 秒无心跳标记 `offline`；`draining` 不再接新 Run，`disabled` 由管理员控制 | 停止 Runner 后状态在阈值内变化；draining 期间已有 Run 完成 | M3 |
| API-1109 | 调度只分配给满足 runtime/OS/标签/容量的 Machine；不满足时 Run 保持 queued 并告警 | 无匹配机器时事件与状态正确 | M3 |
| API-1110 | 机器离线不影响已在执行 Run 的事件补发，重连后按序上报 | 断连重连测试事件完整 | M3 |
| API-1111 | `skills` 与 `skill_versions` 分离：Skill 是稳定身份，版本按语义化版本唯一且不可变；`agent_skills` 外键指向版本 | 同一技能两个版本可共存；绑定记录可解析到具体版本与哈希 | M2 |
| API-1112 | Machine 状态完整枚举为 `pending`、`online`、`offline`、`draining`、`disabled`（五态）；`revoke` 是动作与事件名，不是状态值 | 状态迁移测试覆盖注册、心跳、维护、停用、撤销动作 | M3 |

### 14.7 WebSocket（API-1120 至 API-1132）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1120 | 事件信封包含 `id`、`seq`、`v`、`type`、`at`、`workspaceId`、`actor`、`correlationId`、`data` | 所有服务端事件符合 schema；缺少字段的事件被拒绝发送 | M1 |
| API-1121 | 全局 seq 持久化且单调递增；事件与 seq 在同一事务写入 | 重启后 seq 不回退、不重复 | M1 |
| API-1122 | 支持 `afterSeq` 重放；超出保留窗口发送 `events.replay_reset` | 断线重连测试无状态空洞 | M1 |
| API-1123 | 服务端每 30 秒 ping，60 秒无 pong 断开；客户端按退避重连 | 心跳与断开测试通过 | M0/M1 |
| API-1124 | 发送缓冲区满时以 1013 关闭慢客户端，不阻塞其他连接 | 慢消费者测试不影响广播 | M1 |
| API-1125 | 客户端按事件 id 去重，服务端允许至少一次投递 | 重放后 UI 无重复状态 | M1 |
| API-1126 | 支持 topics 过滤（M2），未知 topic 忽略 | 只收到订阅主题事件 | M2 |
| API-1127 | `run.event` 的 seq 在 Run 内唯一且连续；重试 Run 使用新的 Run ID 与 seq 空间 | 事件时间线可按 seq 排序 | M1 |
| API-1128 | 事件内容脱敏，不包含密钥、令牌、绝对家目录路径 | 脱敏测试样例通过 | M1 |
| API-1129 | 事件类型新增不破坏旧客户端；旧客户端忽略未知类型 | 兼容性测试 | M1 |
| API-1130 | WebSocket 握手校验 Origin（本地白名单），失败返回 403 | 跨源连接被拒绝 | M1 |
| API-1131 | 6.3 事件目录是唯一权威；`meta.eventCatalogVersion` 随目录变化递增；旧名提供并行发送与映射 | 新增事件未登记则 CI 失败；旧名并行期客户端可正常消费 | M1 |
| API-1132 | 每个事件携带 `actor`（type/id）与 `correlationId`；M3 Runner 事件 `actor.type="runner"` | Agent 发起的动作不得伪装成 human；同一 Run 链路 correlationId 一致 | M1/M3 |

### 14.8 错误与列表（API-1140 至 API-1169）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1140 | 错误体包含兼容 `error` 字符串、`code`、`message`、`details`、`requestId`、`retryable` 与可选 `remediation` | 所有 4xx/5xx 响应结构一致；M0 客户端仍可读取 `error` | M1 |
| API-1141 | 错误码目录与 7.3/7.4 一致，客户端可依赖 code | 每个错误码至少一个测试；未登记码 CI 失败 | M1 |
| API-1142 | 500 响应不泄露堆栈、SQL、绝对路径与密钥 | 错误注入测试检查响应文本 | M1 |
| API-1143 | 429/503 返回 Retry-After 且 retryable=true | 客户端可据此退避 | M1/M3 |
| API-1144 | 字段校验错误提供 details.fields 数组 | 多字段错误一次返回全部 | M1 |
| API-1145 | 列表默认 limit=50、最大 200；非法 limit 返回 `INVALID_LIMIT` | 边界测试 | M1 |
| API-1146 | 列表返回 items、nextCursor、hasMore；可选 total | 分页字段齐全 | M1 |
| API-1147 | 游标为 keyset 编码，客户端不构造；非法游标返回 400 | 并发插入下翻页无重复 | M1 |
| API-1148 | 排序仅接受白名单列，非法列返回 `INVALID_SORT` | 各资源白名单测试 | M1 |
| API-1149 | 搜索长度 2-128，空串视为未提供，特殊字符转义 | 边界与注入测试 | M1 |
| API-1150 | Run 事件使用 afterSeq 分页，返回 nextAfterSeq 与 hasMore | 翻页完整 | M1 |
| API-1151 | 列表查询在 1,000 Task、10,000 Run 规模下 p95 ≤100ms（本地、默认 limit=50）；单资源点读 p95 ≤50ms | 基准测试分别记录列表与点读，不使用同一阈值 | M1 |
| API-1160 | 多值过滤参数语义明确（AND/OR）并在文档与测试中固定 | tasks 标签 AND、status 多值为 OR | M1 |
| API-1161 | `since`/`until` 接受 RFC3339，非法格式返回 400 | 时间过滤测试 | M1 |
| API-1162 | 列表默认不包含归档资源，除非显式 `includeArchived=true` | 默认与显式行为不同；不返回 `deletedAt` | M1 |
| API-1163 | 排序默认 `-createdAt`，事件默认 seq 升序 | 默认顺序测试 | M1 |
| API-1164 | `includeTotal=true` 才返回 total，且不影响性能阈值 | 默认响应无 total | M2 |
| API-1165 | 分页与过滤组合在空结果时返回空数组与 hasMore=false | 空结果测试 | M1 |
| API-1166 | 游标包含排序键与 ID，排序字段变化时旧游标返回 `INVALID_CURSOR` | 失效测试 | M1 |
| API-1167 | 搜索结果数量受 limit 限制，不一次返回全部匹配 | 大结果集测试 | M1 |
| API-1168 | M0 裸数组列表在 M1 起不再提供；`/api/v1` 与 `/api` 别名均返回分页对象，依赖旧形状的脚本必须锁定 M0 版本或迁移到分页 | 兼容路径测试；别名与 v1 形状一致；CHANGELOG 列出该破坏性变更 | M1 |
| API-1169 | 每个写接口返回 `revision`；版本不匹配统一 `409 STALE_REVISION`，不返回 412 | 并发 PATCH 测试：第二请求 409 且 details.currentRevision 正确 | M1 |

### 14.9 数据与迁移（API-1180 至 API-1196）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1180 | 迁移文件按四位编号命名、字典序执行、发布后不可修改 | CI 检查已发布文件哈希 | M1 |
| API-1181 | 每个迁移在单事务内执行；失败回滚并中止启动 | 注入失败迁移后数据库无部分变更 | M1 |
| API-1182 | 迁移前使用 `VACUUM INTO` 生成备份并做完整性检查，保留最近 5 份 | 备份存在且可打开 | M1 |
| API-1183 | `schema_migrations` 记录校验和；不匹配拒绝启动 | 手动修改迁移文件后启动失败 | M1 |
| API-1184 | 应用拒绝打开高于自身支持版本的数据库 | 用新 schema 数据库启动旧二进制失败并提示 | M1 |
| API-1185 | 迁移器正确处理字符串、注释与触发器中的分号 | 含分号迁移测试通过 | M1 |
| API-1186 | M1 重建 `runs`/`run_events`，增加 `(run_id, seq)` 唯一约束与外键级联 | 迁移后重复 seq 被拒绝，删除 Run 级联事件 | M1 |
| API-1187 | `tasks`/`agents` 增加 `archived_at`、`revision`；活跃名称唯一索引 | 归档后名称可复用；归档资源默认不返回 | M1 |
| API-1188 | 每个发布版本保留上一版本数据库夹具并跑连续升级链 | CI 升级矩阵通过 | M1 起持续 |
| API-1189 | 事件与 RunEvent 达到上限时截断并标记，不无限增长 | 长 Run 测试数据库大小有界 | M1 |
| API-1190 | 全局事件日志默认保留 7 天并在清理后触发重放重置 | 清理任务与重放行为测试 | M1 |
| API-1191 | 新表声明外键与删除策略；删除检查无孤儿记录 | 外键测试与孤儿查询为 0 | M1 |
| API-1192 | M3 Postgres 迁移与 SQLite 逻辑版本一致，CI 双库测试 | 两套迁移均通过集成测试 | M3 |
| API-1193 | M1 创建 `workspaces` 并插入 `default`，为所有业务表增加 `workspace_id` 并回填；回填后列非空 | 空库与 M0 数据夹具迁移均通过；跨 Workspace 引用返回 409 | M1 |
| API-1194 | M1 创建 `agent_versions` 并为现有 Agent 生成初始版本；`runs.agent_version_id` 回填 | 历史 Run 均可解析到版本；版本号从 1 起单调递增 | M1 |
| API-1195 | M1 创建 `run_config_snapshots`，每个 Run 一份；Run 结束后不得补写 | 快照字段完整；修改 Agent 后快照不变 | M1 |
| API-1196 | M3 以 `audit_events` 替代 `audit_log`，字段包含 organization/workspace/actor/action/prev_hash/hash | 安全模块查询与哈希链校验通过 | M3 |

### 14.10 CLI（API-1200 至 API-1215）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1200 | CLI 支持全局 `--server`、`--json`、`--jsonl`、`--no-color`、`--request-timeout`、`--watch-timeout`，并读取对应环境变量 | 优先级与输出测试 | M1 |
| API-1201 | `ateam serve` 保留现有 flag，增加 `--config`、`--log-level`、`--data-dir`、`--allow-remote` | 启动日志包含配置来源、schema 版本与实例文件路径 | M1 |
| API-1202 | `ateam runner` 在 M3 实现注册、挑战、心跳、领取、执行、事件与证据上报 | 端到端 Runner 测试 | M3 |
| API-1203 | `ateam task` 提供 list/get/create/update/delete/archive/run 子命令 | 每个子命令有集成测试 | M1 |
| API-1204 | `ateam agent` 提供 list/get/create/update/delete/archive/versions 子命令 | 每个子命令有集成测试 | M1 |
| API-1205 | `ateam run` 提供 list/get/watch/cancel/events/artifacts/merge/retry | 每个子命令有集成测试 | M1 |
| API-1206 | `ateam version --json` 输出版本、提交、构建时间、API、schema 与协议版本 | 字段齐全且不访问网络 | M1 |
| API-1207 | 高风险命令（delete、archive、merge、deploy）在非交互模式必须 `--yes` | 缺少时返回退出码 4，且不执行 | M1 |
| API-1208 | `--json` 模式下 stdout 只有一个 JSON 文档；`--jsonl` 模式下 stdout 为逐行 JSON；日志均走 stderr | 两种模式的管道消费测试 | M1 |
| API-1209 | CLI 退出码遵循 10.2 表格，含取消码 7 与本地中断 130 | 成功、失败、未找到、冲突、网络、取消各有测试 | M1 |
| API-1210 | CLI 使用 `internal/apiclient`，不直接拼接 HTTP 请求 | 代码审查与共享错误类型测试 | M1 |
| API-1211 | `ateam task run --watch` 断线后从 lastSeq 重放并继续输出 | 断线测试 | M1 |
| API-1212 | CLI 支持 `--output` 模板或字段选择（M2），便于脚本提取 | 字段选择测试 | M2 |
| API-1213 | `ateam serve` 与桌面壳在监听成功后写 `~/.ateam/instance.json`（0600），CLI 按 10.2 顺序发现实例 | 桌面随机端口下 CLI 可自动连接；退出后文件删除；陈旧文件被健康检查识别 | M1 |
| API-1214 | `task run` 的 Run 被服务端取消时 CLI 返回 7；本地 Ctrl-C 返回 130；`--watch-timeout` 到期返回 5 | 三种场景各有集成测试 | M1 |
| API-1215 | `ateam db status` 输出数据库路径、大小、schema 版本、备份与完整性检查 | `--json` 字段齐全；只读，不触发迁移 | M1 |

### 14.11 客户端与类型（API-1220 至 API-1229）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1220 | `packages/shared` 覆盖所有对外资源与枚举；新增字段先更新共享类型 | 类型检查与契约夹具通过 | M1 |
| API-1221 | `ApiError` 暴露 code、status、details、requestId、retryable | 错误场景测试 | M1 |
| API-1222 | 客户端列表方法返回 `Page<T>`，支持分页、过滤、排序参数 | 与 API 集成测试 | M1 |
| API-1223 | 客户端提供事件流封装，包含重连、退避、去重与 lastSeq | 断线重放测试 | M1 |
| API-1224 | 客户端所有请求支持 AbortSignal 与请求超时 | 取消测试 | M1 |
| API-1225 | M1 使用 golden fixture 做 Go/TS 契约测试，CI 失败即阻断 | CI 配置存在并运行 | M1 |
| API-1226 | M2 生成 OpenAPI 3.1 与 TS 类型，`make check-types` 无差异 | 生成文件与源码一致 | M2 |
| API-1227 | 客户端忽略未知字段与未知事件类型，不崩溃 | 模拟未来字段测试 | M1 |
| API-1228 | Go 客户端与 TS 客户端在错误码、分页、幂等语义一致 | 跨语言契约用例 | M1 |
| API-1229 | 客户端提供 archive/unarchive、workspaces、agent versions、deliverables、evidence、approval 方法，与端点总表一一对应 | 方法清单与 5.13 对账通过 | M1/M2 |

### 14.12 安全（API-1240 至 API-1252）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1240 | 默认仅监听 `127.0.0.1`（M0 已实现）；非 loopback 监听必须显式 `--allow-remote` 并打印醒目警告（M1） | M0 检查默认绑定；M1 测试无 flag 时拒绝启动、有 flag 时输出警告并启用认证要求 | M0/M1 |
| API-1241 | CORS 仅允许同源与开发白名单；不回显任意 Origin | 跨源预检与读取测试 | M1 |
| API-1242 | WebSocket 校验 Origin；非白名单浏览器来源拒绝 | 跨源 WS 测试 | M1 |
| API-1243 | Artifact、Workspace 路径做规范化与符号链接解析，拒绝越界 | 路径穿越测试 | M1 |
| API-1244 | 事件与日志脱敏，不包含密钥、令牌、绝对家目录路径 | 脱敏扫描测试 | M1 |
| API-1245 | M2.1 引入本地会话令牌与 WS ticket；M3 引入团队登录；人类 API 使用会话或 PAT，**Runner 不使用 Bearer 令牌** | 无令牌请求 401；Runner 用机器签名认证；Bearer 只在人类 API 生效 | M2.1/M3 |
| API-1246 | 团队模式对 Runner 与 Webhook 端点限流，返回 429 与 Retry-After | 限流测试 | M3/M4 |
| API-1247 | 高风险动作服务端强制审批，不能仅依赖 UI 禁用 | 直接调用端点被拒绝 | M2 |
| API-1248 | 写操作审计：审批、合并、部署、删除、机器注册记录 actor、requestId、参数哈希与 prev_hash/hash | 审计记录可查询且哈希链可校验 | M3 |
| API-1249 | 请求体、Artifact 上传、事件 payload 均有大小限制 | 超限测试 | M1 |
| API-1250 | Webhook 出站请求使用 HMAC 签名与时间戳，防重放 | 签名验证测试 | M4 |
| API-1251 | Runner 注册使用一次性令牌，后续认证使用机器密钥对 + 签名挑战；私钥只存本机安全存储 | 注册、挑战、伪造签名被拒、撤销后拒绝心跳 | M3 |
| API-1252 | Machine 注册令牌 15 分钟有效、单次使用、仅存哈希；撤销立即拒绝新租约 | 过期、复用、撤销测试 | M3 |

### 14.13 跨文档契约与补充需求（API-1260 至 API-1299）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1260 | 提供 `/api/v1/workspaces` 与 `/api/v1/workspaces/{id}`；M1 自动创建 `default`；`/api/v1/projects` 为别名至 M2 | 创建/读取/更新 Workspace；别名返回同一对象 | M1 |
| API-1261 | Task、Agent、AgentVersion、Run、Artifact、Evidence、Review、Deliverable、Approval、Skill、Machine、Runner 的 `workspaceId` 必填且与父实体一致 | 跨 Workspace 创建返回 409；迁移后所有行非空 | M1 |
| API-1262 | 请求接受 `projectId` 作为 `workspaceId` 的输入别名；冲突返回 400；响应只返回 `workspaceId`，不返回 `projectId` | 两字段一致时成功；不一致时失败；响应无 `projectId` 字段 | M1 |
| API-1263 | `GET /runs/{id}/workspace` 返回 Run Workspace，而不是产品级 Workspace；字段包含 `path`、`branch`、`baseCommit`、`headCommit`、`state`、`cleanupState` | 契约夹具固定字段；父 Run 不存在 404 | M1 |
| API-1264 | M1 创建 `agent_versions` 与 `runs.agent_version_id`；Run 创建时固定版本；Agent 更新生成新版本 | 版本不可变；历史 Run 版本不变 | M1 |
| API-1265 | M1 创建 `run_config_snapshots`，包含配置 JSON、`promptHash`、`runtimeVersion`、`permissionMode`、`permissionEnvelope`；禁止补写 | 快照可查询；Run 结束后修改 Agent 不影响快照 | M1 |
| API-1266 | M2 提供 Deliverables 端点与 `deliverables`、`contract_versions`、`contract_requirements` 表；`/api/v1/contracts` 为别名 | 创建、提交、冻结、修订、撤回与版本历史可用；别名行为一致 | M2 |
| API-1267 | `required_contracts` 未冻结或版本不匹配时，创建 Run 返回 `409 CONTRACT_NOT_FROZEN`，details 列出契约与所需版本 | 冻结后同一请求成功；版本 pin 规则生效 | M2 |
| API-1268 | Evidence 资源从 M2 起提供：`status`（passed/failed/missing/waived）与 `validity`（valid/unverified/invalid）分离，含 criterionKey、verify 端点与脱敏门禁；M1 不建表、不提供端点 | M2 验证流程完整；M1 请求返回 404 | M2 |
| API-1269 | Review 使用领域模型 §3.10 字段与 §4.5 状态机，替代旧的追加式 verdict 模型；ReviewComment 独立表 | 状态迁移、评论、取代关系有测试 | M1 |
| API-1270 | Approval 的 API 字段使用 `actionType`、`targetType`、`targetId`、`actionFingerprint`、`paramsHash`、`contentHash`；不使用旧 API 字段 `action`；数据库列采用 `action_type`、`params_hash` 等 snake_case | 契约夹具与表字段一致；旧 API 字段不再出现 | M2 |
| API-1271 | 合并请求契约固定为 13.3，含 `reviewId`、`expectedHeadCommit`、`targetBranch`、`strategy`、`confirm`、M2 `approvalId` | 契约夹具校验；所有失败分支有固定错误码 | M1 |
| API-1272 | M3 提供 Runner 注册、挑战、心跳、租约 claim/renew/release、事件批量上报、Artifact 分片上传 | 断线、续租、 fencing、证据续传测试通过 | M3 |
| API-1273 | Runner 心跳 15 秒、45 秒 offline、租约 90 秒过期；注册令牌 15 分钟 | 时间阈值测试；与安全模块 §7.2 一致 | M3 |
| API-1274 | Runner 协议不兼容时拒绝新租约但允许完成已领取 Run | 版本不匹配测试 | M3 |
| API-1275 | M3 数据模型包含 Organization、Membership、WorkspaceMembership、User、Session、PAT，角色按安全模块两级四角色模型 | 成员、角色、跨 Workspace 隔离测试 | M3 |
| API-1276 | `audit_events` 统一替代 `audit_log`，包含 org/workspace/actor/action/resource/result/prev_hash/hash | 哈希链校验与导出测试 | M3 |
| API-1277 | Skill 稳定身份与版本表分离；`agent_skills` 指向 `skill_version_id`；语义化版本与哈希校验 | 同技能多版本、绑定解析、删除保护测试 | M2 |
| API-1278 | M1 起可写资源带 `revision`；`If-Match`/`expectedRevision` 冲突返回 409 `STALE_REVISION` | 并发写测试；412 仅用于动作前置条件 | M1 |
| API-1279 | 6.3 是事件目录唯一权威；其他文档事件名必须映射到本表；CI 检查未登记事件 | 事件夹具覆盖全部类型 | M1 |
| API-1280 | 7.3/7.4 是错误码唯一权威；旧 `failureCode`/`errorCode` 按下表映射；CI 检查未登记码 | 错误夹具覆盖全部码 | M1 |
| API-1281 | 5.13 是端点总表唯一来源；其他文档路径按 5.0 解释；CI 检查路由与总表一致 | 路由注册测试 | M1 |
| API-1282 | `/api/*` 永久别名共享 v1 handler；不得出现仅别名可用的能力；别名带弃用头 | 别名与 v1 响应 diff 为空（除 Deprecation/Link 头） | M1 |
| API-1283 | M2.1/M3 提供 bootstrap、ws-ticket、login/logout、me、members、tokens、audit-events、security settings 端点 | 认证、会话、PAT、审计查询测试 | M2.1/M3 |
| API-1284 | Runner 事件上传必须携带 `runId+seq`，控制面按 seq 排序并幂等去重 | 重复与乱序上报测试 | M3 |
| API-1285 | M4 数据表包含 automation_schedules、automation_triggers、webhooks、webhook_deliveries、notifications、notification_preferences、plugins、plugin_grants、telemetry_preferences、telemetry_events、update_state | 迁移与 CRUD 测试 | M4 |
| API-1286 | M4 端点按 5.12 提供；`/api/hooks/{hookId}` 为稳定无版本入站路径 | 端点与签名测试 | M4 |
| API-1287 | 遥测默认关闭，opt-in 后可导出与删除，不采集任务内容、代码与文件路径 | 隐私测试与字段白名单 | M4 |
| API-1288 | 插件安装需确认授权范围，停用/卸载立即撤权，不能绕过审批门 | 授权与撤权测试 | M4 |
| API-1289 | 更新 API 只检查、下载与提示安装，不后台静默安装；安装需用户确认 | 更新流程测试 | M4 |

### 14.14 M4 自动化与分发（API-1300 至 API-1315）

| 编号 | 需求 | 验收要点 | 里程碑 |
| --- | --- | --- | --- |
| API-1300 | Schedule 支持 cron、timezone、任务模板、Agent、启停、重叠策略与错过策略 | 创建/更新/删除/暂停/立即运行均可用 | M4 |
| API-1301 | Schedule 触发历史可查询，记录 `source`、`dedupeKey`、Task/Run 引用与结果 | 同一时间点不重复触发；错过策略可解释 | M4 |
| API-1302 | Webhook 支持创建、更新、删除、密钥轮换与投递日志 | 密钥只显示一次；轮换有重叠窗口；删除立即撤销 | M4 |
| API-1303 | 入站 Hook 校验 HMAC 签名与时间戳，按 `dedupeKey` 幂等；重复投递返回 202 并标记 `webhook.replayed` | 伪造签名拒绝；重放不重复建 Task | M4 |
| API-1304 | 通知支持 created/read、未读筛选与偏好配置；高风险事项不受普通限频影响 | 通知不丢不重；偏好生效 | M4 |
| API-1305 | 插件支持安装、启用、停用、卸载与错误状态；manifest 声明 `apiVersion` 与所需权限 | 不兼容插件拒绝加载；停用立即撤权 | M4 |
| API-1306 | 插件授权按 scope 记录 `plugin_grants`，可撤销；插件不能读取未授权资源 | 越权访问返回 403 | M4 |
| API-1307 | 遥测同意状态持久化，默认关闭；关闭时不上传任何事件 | 关闭状态无网络请求；导出与删除可用 | M4 |
| API-1308 | 更新 API 返回可用版本、下载状态与日志；安装必须用户确认 | 检查超时 3 秒；安装不静默 | M4 |
| API-1309 | 自动化创建的任务默认 Backlog，不自动启动 Run、评审或合并 | Webhook/Schedule 创建后无 Run；需人工或显式规则 | M4 |
| API-1310 | M4 事件按 6.3 发送，必须携带 `automationId`/`dedupeKey`（适用时）与 `actor.type="system"` 或 `runner` | 事件夹具与顺序测试 | M4 |
| API-1311 | M4 表结构按 9.3 创建，含 AutomationTrigger、Notification、PluginGrant、Telemetry 与 UpdateState | 迁移与查询测试 | M4 |
| API-1312 | Webhook 与 Runner 端点独立限流，429 带 Retry-After；失败投递可重试且有上限 | 限流与重试测试 | M4 |
| API-1313 | 插件不得绕过 Approval、评审门或路径/命令权限；所有动作以插件身份审计 | 绕过尝试被拒绝并审计 | M4 |
| API-1314 | M4 数据保留与隐私策略可配置；导出不包含密钥与绝对路径 | 导出扫描测试 | M4 |
| API-1315 | 打包产物的 `/api/v1/health` 与关于页、安装包文件名报告相同版本、提交与构建时间 | 三处一致；无 `0.1.0-dev` 泄漏到正式包 | M4 |

## 15. 数据与 API 影响

### 15.1 契约所有权

| 契约 | 所有者 | 消费方 |
| --- | --- | --- |
| REST 路径、事件目录、错误码、分页语义、表与字段 | 本模块（API/数据） | Web、桌面壳、CLI、Runner、插件 |
| Workspace 实体、归属与归档 | `02-domain-model.md` §3.1、§7.3 | 本模块提供 `workspaces` 表与端点 |
| Task 状态机与业务规则 | 任务模块 §5.2、§12 | 本模块负责传输与持久化校验 |
| Run 生命周期与失败分类 | 运行时模块 §11 与领域模型 §4.3 | 本模块负责 schema、持久化与广播 |
| worktree/branch/merge 具体行为 | Workspace/Git 与运行时模块 §8、§9 | 本模块暴露端点与审计字段 |
| 依赖 DAG、交付物契约、评审与审批规则 | 协作与评审模块 §5、§8、§9 | 本模块提供表结构、端点与字段名 |
| 认证、角色、审计策略 | 安全与团队模块 §4、§7、§8 | 本模块执行中间件与数据写入 |

### 15.2 对 UI 的影响

- 列表页必须改用分页与游标；看板在 M1 需要处理「部分加载」与列内计数。
- 错误展示必须读取 `code`，对 `TASK_NOT_EXECUTABLE`、`REVIEW_REQUIRED`、`APPROVAL_REQUIRED`、`READINESS_NOT_MET` 给出可操作提示，而不是展示原始英文消息。
- 事件流改为增量更新；`events.replay_reset` 必须触发重新拉取，不得忽略。
- Run 详情页新增 Artifact、Evidence、Review、Approval、Workspace 区块；Merge 按钮必须由服务端门禁结果驱动，而不是只在点击后报错。
- 删除按钮必须区分「归档」与「受限硬删除」；有 Run 历史时 UI 只能提供归档，不得把 409 包装成通用失败。
- `revision` 冲突时 UI 提示「已被其他窗口/成员修改」，提供刷新与差异对比，不得静默覆盖。

### 15.3 对 Workspace/Git 的影响

- Run 创建后由 Workspace 模块准备真实 worktree 并回填 `branch`/`worktree`/`baseCommit`/`headCommit`；API 负责在事件中广播 `run.workspace.*`。
- diff Artifact 的生成依赖 Workspace 提供的基线提交与工作区路径；合并端点依赖干净工作区与目标分支状态。
- 清理策略需要与 Run Workspace 目录生命周期对齐，避免 API 删除记录但磁盘残留；未合并改动不得自动删除。
- `GET /runs/{id}/workspace` 只读；任何写操作通过 Workspace 模块或受控清理任务执行。

### 15.4 对团队模式的影响

- M3 的 Postgres schema 必须与 SQLite 逻辑模型一致；`events.seq` 在 Postgres 使用序列或 BIGSERIAL，保证全局单调。
- 认证中间件、审计写入、限流应作为 API 层横切能力实现，不污染领域逻辑。
- Machine 与 Runner 的心跳、租约与事件上报使用独立端点组与独立认证域，不复用浏览器会话。
- 所有查询必须先按组织与 Workspace 成员关系过滤，再按 ID 查询，避免枚举侧信道。

### 15.5 数据量估算

- 单次典型 Run 约 100-1,000 条事件，每条 0.5-8 KiB；按 500 条、2 KiB 估算约 1 MB/Run，极端 Run 接近 50 MB 上限。
- 1,000 个 Run 默认保留策略下数据库约 1-2 GB；M1 必须提供事件截断与清理，避免本地磁盘不可控。
- Artifact 是磁盘增长主要来源，必须提供单 Run 与全局配额；M2 的清理 UI 不可省略。
- 1,000 Task、10,000 Run 是 M1 列表基准；5,000 Task、100,000 事件是压力基准；M3 团队模式按 10,000 Task、100,000 Run 重新标定。

## 16. 异常与边界

| 场景 | 期望行为 | 里程碑 |
| --- | --- | --- |
| Task 在 Run 排队期间被归档 | 归档请求返回 409，要求先取消活跃 Run；Run 继续可取消 | M1 |
| Task 在 M0 数据中被硬删除，Run 仍存在 | Run 执行时加载 Task 失败，标记 `invalid_task_state`/`task_deleted`，不启动 Runtime | M1 迁移兼容 |
| Agent 在执行期间被归档 | 执行中的 Run 使用 `agentVersionId` 快照继续；归档成功但历史 Run 可读 | M1 |
| Agent 在有活跃 Run 时被删除 | 返回 `409 AGENT_IN_USE`；有历史 Run 时返回 `409 AGENT_HAS_REFERENCES` 并提示归档 | M1 |
| 队列已满 | 创建前返回 `503 QUEUE_FULL`，不创建 Run；客户端可重试 | M1 |
| 数据库锁等待超过 5 秒 | 返回 `503 DB_BUSY`，retryable=true，客户端可退避重试 | M1 |
| 磁盘空间不足导致 Artifact 写入失败 | Run 可完成但 DoD 降级为 `runtime_error`/`evidence_missing`；已写元数据回滚，事件中说明 | M1 |
| WebSocket 客户端过慢 | 服务端以 1013 关闭，客户端退避重连并从 lastSeq 重放 | M1 |
| 重放的 afterSeq 已被清理 | 发送 `events.replay_reset`，客户端拉取快照 | M1 |
| 幂等键相同但请求体不同 | 返回 `409 IDEMPOTENCY_CONFLICT`，不执行写操作 | M1 |
| 并发 PATCH 同一 Task | 带 `If-Match` 的旧 revision 返回 `409 STALE_REVISION`；M1 起不再最后写入生效 | M1 |
| 并发取消与完成 | 条件更新保证只有一个终态；另一方读取最终状态并幂等返回 | M1 |
| 游标对应的排序字段被修改 | 返回 `INVALID_CURSOR`，客户端从头拉取 | M1 |
| limit 超过 200 | 返回 `400 INVALID_LIMIT`，不静默截断 | M1 |
| Run 取消后再取消 | 返回 200 与原对象，不产生新事件或仅产生幂等重复事件 | M0/M1 |
| 未知 Runtime | 写入时 400；若数据库被外部修改导致未知值，执行失败 `runtime_error`/`runtime_missing`，不回退 mock | M1 |
| Runtime CLI 不存在 | Run 失败 `runtime_error`/`runtime_missing`，事件包含安装提示 | M1 |
| 迁移中途失败 | 事务回滚，服务不监听端口，日志给出迁移编号与备份路径 | M1 |
| 数据库版本高于二进制 | 拒绝启动，提示使用新版本或恢复备份 | M1 |
| 迁移文件被修改 | 校验和不匹配，拒绝启动 | M1 |
| 标题/描述包含 emoji 或非 ASCII | 允许；长度按字符（rune）而非字节校验 | M1 |
| 客户端与服务端时区不同 | 服务端统一 UTC，客户端本地化显示；过滤参数按 UTC 解释 | M1 |
| Artifact 为符号链接或越界路径 | 拒绝并记录安全事件，不读取内容 | M1 |
| 超长日志行 | 截断到 8 KiB 并记录 `truncatedBytes`；不拆分为多条事件 | M1 |
| 进程重启时有 running Run | 标记 `failed`/`interrupted`/`app_restart`，并发出 `run.failed` | M1 |
| 事件日志清理与重放同时发生 | 清理事务与读取隔离；读取到已删除区间时返回重放重置 | M1 |
| 合并时 head commit 已变化 | 返回 `412 STALE_HEAD`，原 Review 置为 `superseded`，要求重新评审 | M1 |
| 合并时目标分支已前进 | 返回 `409 BASE_BRANCH_MOVED`，不自动 rebase | M1 |
| 合并时目标工作区不干净 | 返回 `409 WORKSPACE_DIRTY`，列出未提交文件 | M1 |
| 合并冲突 | 返回 `409 MERGE_CONFLICT` 与冲突文件；不自动选择 ours/theirs | M1 |
| 重复合并 | 返回 `409 RUN_ALREADY_MERGED` | M1 |
| 审批过期后执行动作 | 返回 `409 APPROVAL_EXPIRED`，创建新审批，不执行动作 | M2 |
| 审批参数被修改 | `409 APPROVAL_MISMATCH`，不执行动作；内容指纹变化返回 412 | M2 |
| 依赖未完成 | 创建 Run 返回 `409 DEPENDENCY_UNFINISHED`，details 列出前置任务 | M2 |
| 契约未冻结 | 创建 Run 返回 `409 CONTRACT_NOT_FROZEN`，details 列出所需版本 | M2 |
| 机器离线时分配 Run | Run 保持 `queued`，机器恢复后重新匹配；M3 不自动改派已领取的 Run | M3 |
| Runner 心跳超时 | Machine `offline`；租约 90 秒后 Run `failed`/`runner_lost`/`heartbeat_timeout`；不自动重派 | M3 |
| 旧租约持有者上报 | 返回 `409 RUNNER_FENCED`，事件被拒绝 | M3 |
| Runner 协议不兼容 | 拒绝新租约；已领取 Run 允许完成 | M3 |
| Webhook 重放 | 返回 202，标记 `webhook.replayed`，不重复创建 Task | M4 |
| 插件请求未授权资源 | 返回 403，写审计，不影响其他插件 | M4 |
| 更新下载失败 | 保留当前版本，记录 `update.failed`，不阻塞使用 | M4 |

## 17. 权限与安全

### 17.1 当前（M0）安全姿态与风险

- 无认证、无授权；任何能访问 `127.0.0.1:8787` 的进程都可读写全部数据。
- CORS 反射任意 Origin，浏览器中的任何网站都能读取本机 API 响应；WebSocket 不校验 Origin。
- 静态文件服务与 API 同源，便于本地使用，但也意味着任何本机网页注入都能调用 API。
- 这些风险在「纯本地单用户、只监听 loopback」的前提下可接受，但必须在 M1 前收紧，否则桌面壳与浏览器共存会放大攻击面。

### 17.2 计划控制

| 控制 | 里程碑 | 说明 |
| --- | --- | --- |
| 仅 loopback 默认 | M0 | 默认绑定已实现；非 loopback 必须显式 `--allow-remote` 并打印醒目警告（M1） |
| CORS 白名单 | M1 | 允许同源与开发端口；生产桌面壳不需要跨源 |
| WebSocket Origin 校验 | M1 | 浏览器必须匹配白名单；CLI 无 Origin 时允许 |
| 请求大小与头部限制 | M1 | 1 MiB JSON、64 KiB 头、8 KiB 事件消息、Artifact 上限 |
| 路径与符号链接校验 | M1 | Artifact、Run Workspace 与静态文件均做规范化 |
| 脱敏 | M1 | 日志与事件过滤 `sk-`、`ghp_`、`Bearer`、常见 Key 名；保留诊断所需的最小信息 |
| 本地用户身份 | M1 | 评审与审批记录 `local`，为 M3 迁移预留 actor 字段 |
| 本地会话令牌 | M2.1 | 启动生成，bootstrap URL 或 `0600` 文件；WS 使用一次性 ticket |
| 会话与令牌认证 | M3 | 团队模式必须认证；本地模式可配置是否启用 |
| RBAC | M3 | 见 17.3 的两级四角色模型 |
| 审计 | M3 | 审批、合并、部署、删除、机器注册写入 `audit_events` 哈希链 |
| Runner 认证 | M3 | 一次性注册令牌 + 机器密钥对 + 签名挑战，不使用长期 Bearer |
| 限流与防重放 | M3/M4 | Runner 与 Webhook 端点限流；Webhook 使用 HMAC 与时间戳 |

### 17.3 角色与权限矩阵

以安全模块 §4.2 为准，权威词表为两级四角色：

- 组织级：Owner、Admin、Member、Viewer。
- Team Workspace 级：workspace_admin、Contributor、Reviewer、Viewer。

本章只负责 API 中间件与字段，不新增角色名。旧文档中的 owner/maintainer/viewer、Owner/Admin/Maintainer/Reviewer 等称谓按下表映射：

| 旧称谓 | 规范映射 |
| --- | --- |
| owner / admin / member / viewer（任意层级混用） | 组织 Owner/Admin/Member/Viewer，或 Team Workspace workspace_admin/Contributor/Reviewer/Viewer，按作用域判断 |
| maintainer | workspace_admin 或组织 Admin |
| reviewer（成员） | Team Workspace Reviewer |
| operator（独立开发者） | Team Workspace Contributor；单用户模式无角色 |

关键权限：写 Task/启动 Run 需 Contributor 及以上；评审与合并审批需 Reviewer 或 workspace_admin；管理成员、Runner、共享 Agent、安全设置需组织 Admin/workspace_admin；删除组织、转移 Owner 需 Owner + 二次审批 + 重新认证。

### 17.4 审批门与职责分离

- 高风险动作必须在服务端校验审批，不允许仅靠 UI 隐藏按钮。
- 单用户模式允许自审批，但记录 `selfApproved=true` 便于日后审计；团队模式禁止同一用户创建并批准同一动作，owner 覆盖必须记录原因。
- DevOps Agent 在 M2 只能执行 staging 与生成部署计划；`deploy_prod` 需要人工批准，且执行主体必须是受控端点，不允许 Agent 直接持有生产凭据。
- 审批参数（目标环境、分支、提交、命令）纳入哈希；任何变更都需要重新审批，防止「批准 A 执行 B」。
- Agent 不得创建、批准或消费 Approval；违反返回 403 并记录安全事件。

### 17.5 数据保护

- 本地数据库文件权限默认仅当前用户可读写（0700 目录、0600 文件）；备份文件同样限制权限。
- API 不返回 Runtime 凭据；Agent 只引用 Secret 名称（M2.1），真实密钥存于环境变量或系统钥匙串。
- 删除与导出操作记录审计；导出不包含密钥与绝对路径。
- 团队模式传输使用 TLS；本地 HTTP 仅限 loopback。
- 遥测默认关闭，不采集任务内容、代码、文件路径；详见 14.14 与安全模块 §9。

### 17.6 Runner 安全边界

- Runner 主动出站连接控制面，不需要开放入站端口；控制面不保存代码副本与模型密钥。
- 每个 Job 使用独立工作目录与临时目录，不复用环境变量、凭据或敏感缓存。
- 共享 Runner 需 Admin 审批并标注 `shared=true`；UI 必须提示机器所有者理论上可读取运行中的代码与进程内存。
- 机器密钥保存在操作系统钥匙串或等效安全存储；撤销后立即拒绝心跳与新租约。
- M3 远程访问不是默认能力：必须显式开关、独立认证、TLS 或受信代理、速率限制与 UI 风险横幅。

## 18. 指标

### 18.1 产品与体验指标

| 指标 | 目标 | 测量方式 |
| --- | --- | --- |
| 单资源点读 p95（1,000 Task） | < 50ms | 基准测试与运行时分位统计 |
| 列表查询 p95（1,000 Task、默认 limit=50） | ≤ 100ms | 基准测试，服务端计时 |
| 列表查询 p95（5,000 Task、limit=50 或 200） | ≤ 200ms | 同上，禁止以全量返回方式测量 |
| RunEvent 查询 p95（10 万条中查最近 1,000 条） | ≤ 200ms | SQLite 基准测试 |
| API 写请求 p95 | < 100ms | 同上 |
| 事件端到端延迟 p95（Runtime 产生到客户端收到） | ≤ 1s（M1 口径），2s 为不得突破上限 | 事件时间戳与客户端接收时间采样 |
| 断线重连后状态一致率 | 100% | 自动化断线测试 |
| Run 事件重放后重复可见率（未去重） | 允许重复但客户端去重后 0 | 事件 id 去重测试 |
| 5xx 错误率（正常本地使用） | < 0.1% | 服务端计数 |
| 迁移成功率（从上一版本升级） | 100% | CI 升级矩阵 |
| 迁移前备份成功率 | 100% | 集成测试 |
| 删除后孤儿记录 | 0 | 数据一致性检查任务 |
| CLI 端到端成功率（创建→执行→查看证据） | > 99% | 集成测试与用户反馈 |
| 首次使用 CLI 完成一次 Run 的命令数 | ≤ 3 条命令 | 演示脚本 |
| 契约漂移导致的 CI 失败 | 发布前 0 | 契约测试 |
| 事件/错误码未登记数 | 0 | CI 扫描 6.3、7.3、7.4 |

### 18.2 数据健康指标

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| 每 100 个完成 Run 的数据库增长 | < 100 MB（默认截断策略） | 超出需检查事件量或 Artifact 策略 |
| 单 Run 事件条数 p95 | < 2,000 | 超出考虑聚合或截断 |
| 全局事件日志行数 | < 100,000 | 超过按保留策略清理 |
| 备份文件数量 | ≤ 5 | 自动轮转 |
| WAL 大小 | 定期 checkpoint 后回落 | 关闭与定时 checkpoint |
| 失败迁移导致的启动失败 | 0（发布后） | 迁移测试保障 |
| 归档恢复率 | 作为产品信号观察 | 评估归档/硬删除策略 |
| 孤儿 Run/Artifact/Review | 0 | 外键与清理任务 |

### 18.3 可观测性

- 服务端结构化日志包含 `requestId`、`route`、`status`、`durationMs`、`errorCode`；不记录请求体与密钥。
- `GET /api/v1/diagnostics/metrics` 或 `ateam serve --verbose` 输出队列长度、活跃 Run 数、事件写入速率、数据库大小、租约数。
- M3 团队模式增加 Prometheus 兼容指标或等价的内置面板；M4 遥测必须显式选择加入。
- 所有指标在本地计算与保存，不上传；M4 遥测仅上传匿名计数、耗时、错误码与功能开关。

## 19. 依赖与风险

### 19.1 依赖

| 依赖 | 影响 | 应对 |
| --- | --- | --- |
| Workspace/Git 模块提供真实 worktree 与 diff | Run 的 branch/worktree 与 diff Artifact 无法交付 | M1 联调；API 先以字段与事件契约驱动实现 |
| Runtime 适配器输出规范化事件 | Run 时间线与测试证据质量 | 共同维护 RunEvent 目录；adapter 合约测试 |
| 协作模块定义依赖 DAG、交付物契约 | M2 端点与表结构 | 本章建表与端点，字段名以本章为准；业务规则由协作文档定义 |
| 任务模块定义状态矩阵与归档规则 | 校验与 UI 行为 | CI 全矩阵契约测试；任何变更两边同步 |
| 前端改用分页与增量事件 | v1 上线可用性 | M1 同步升级 api-client 与 UI |
| Wails 桌面壳生命周期与实例发现 | 服务启停、端口选择、数据目录 | 桌面壳写 `instance.json`；API 不依赖窗口 |
| SQLite 单写者模型 | 并发 Run 与事件写入吞吐 | WAL、批量写入、单写队列；M3 团队模式用 Postgres |
| Go 1.27 与现代 SQLite 驱动 | 迁移与外键行为 | CI 固定版本；迁移测试覆盖 |
| 浏览器对 WebSocket 头的限制 | WS 认证方式 | 使用一次性 ticket，不假设可设置自定义头 |
| GitHub 或代码托管平台（M3） | PR 集成 | 通过受控适配器，不在本章定义第三方 API 细节 |

### 19.2 风险

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| SQLite 写锁成为并行 Run 瓶颈 | 中 | 事件延迟、Run 启动变慢 | 事件批量写入、异步落盘、M2 评估单写 goroutine；M3 Postgres |
| 事件量爆炸导致数据库膨胀 | 高 | 磁盘占满、查询变慢 | 单条截断、每 Run 上限、保留策略、清理任务 |
| 迁移表重建损坏数据 | 中 | 用户历史丢失 | 迁移前备份、事务、夹具测试、渐进发布 |
| 路径别名与文档路径继续漂移 | 高 | 客户端连接失败或行为不一致 | 5.0 单一决策、端点总表、CI 路由对账、弃用头 |
| 事件名/错误码跨文档漂移 | 高 | 客户端无法归因 | 6.3/7.3/7.4 唯一目录、并行映射期、CI 扫描 |
| Runner 协议版本漂移 | 中 | 团队模式执行异常 | 显式 `protocolVersion`、拒绝新租约、允许完成已领取 Run |
| 审批流被绕过 | 低 | 高风险动作失控 | 服务端校验、动作指纹、单次消费、审计 |
| Artifact 路径穿越 | 低 | 读取任意文件 | ID 间接访问、路径规范化、符号链接校验 |
| 事件重复导致 UI 状态抖动 | 中 | 体验与正确性 | 事件 id 去重、seq 重放、快照优先 |
| CLI 输出被脚本误用 | 中 | 自动化错误 | `--json` 契约、退出码测试、禁止依赖人类文案 |
| 旧数据库升级失败无指引 | 中 | 用户无法启动 | 明确错误、备份路径、恢复文档、启动前检查 |
| OpenAPI 生成增加维护成本 | 低 | 类型漂移 | M2 再引入，先以 golden fixture 控制 |
| 归档与硬删除语义再次分叉 | 中 | 数据丢失或 UI 误判 | `archived_at` 唯一归档字段、DELETE 受限、契约测试 |
| M4 插件扩大攻击面 | 中 | 越权或数据泄露 | 授权 scope、默认拒绝、审计、不能绕过审批 |
| 遥测误采集敏感内容 | 低 | 信任受损 | 默认关闭、字段白名单、导出与删除、隐私评审 |

## 20. 里程碑映射

| 能力 | M0 | M1 | M2 | M3 | M4 |
| --- | --- | --- | --- | --- | --- |
| API 命名空间 | `/api` | `/api/v1` + `/api` 永久别名 | 别名继续 | 团队认证 | 稳定 v1 |
| 错误模型 | 字符串 | 结构化错误码 + Run failureDetail | 审批/契约错误码 | 认证/限流错误 | Webhook/插件错误 |
| 列表语义 | 全量数组 | 分页/过滤/排序/搜索 | total 可选 | 团队范围过滤 | 导出 |
| Workspace | 隐式 | 显式表、默认回填、`workspaceId` | Project 输入别名 | 多 Workspace 与成员 | 稳定 |
| Task | CRUD | 状态机、归档、`revision` | 依赖、交付物、恢复 | 团队权限 | 模板 |
| Agent | CRUD | runtime 校验、AgentVersion、归档 | 技能绑定、权限执行、版本发布体验 | 共享 Agent | 模板导出 |
| Run | 创建/取消/事件 | retry、merge、快照、恢复、并发约束、workspace 摘要 | 并发策略、Crew 关联 | PR 命令、Runner 租约 | 自动化触发 |
| Artifact | 无 | diff、日志、截图、下载 | 聚合、删除、配额 | 远程存储选项 | 导出 |
| Evidence | 无 | 无（DoD 基于 Artifact 与人工例外） | status+validity、契约条目、verify、脱敏门禁 | 审计 | 稳定 |
| Review | 无 | 状态机、ReviewComment、合并门 | 多 Run 聚合 | 团队评审身份 | 通知 |
| Deliverable | 无 | 无 | 契约版本、冻结、required_contracts | 团队模板 | 稳定 |
| Approval | 无 | 无（Review+confirm） | 通用审批、生产门禁 | 职责分离、审计 | 自动化审批策略 |
| Skill | 无 | 无 | 稳定身份 + 版本、绑定 | 共享技能 | 市场（非目标，仅预留） |
| Machine/Runner | 隐式本地 worker | 无 | 无 | 注册、心跳、租约、远程执行 | 能力标签完善 |
| WebSocket | 全量广播 | seq、重放、去重、Origin、actor | topics | 权限过滤 | 通知事件 |
| 数据层 | SQLite 单文件 | workspaces、agent_versions、events、归档、证据 | 契约、审批、技能、依赖 | Postgres、组织、审计 | 自动化表 |
| CLI | serve/version/占位 runner | task/agent/run/db、--json、退出码、实例发现 | 依赖/审批命令 | runner、PR | 模板/通知 |
| 客户端 | 基础 REST | 分页/错误/事件流/契约测试 | OpenAPI 生成 | 认证 | 插件 API |
| 自动化 | 无 | 无 | 无 | 无 | Schedule/Webhook/通知/插件/遥测/更新 |

各里程碑的模块退出标准：

- **M1**：API-1001 至 API-1075、API-1080 至 API-1092、API-1120 至 API-1169、API-1180 至 API-1195、API-1200 至 API-1215、API-1220 至 API-1229、API-1240 至 API-1244、API-1260 至 API-1271、API-1278 至 API-1282 中标注 M1 的需求全部通过；M0 数据库可自动升级并保留全部历史；CLI 可在三步内完成一次 Run 并展示证据。
- **M2**：审批、技能、依赖、交付物、证据与恢复端点可用；合并必须携带 `reviewId`、`expectedHeadCommit`，M2 起还可带 `approvalId`；角色 Agent 的路径/命令权限由服务端强制；事件 topics 与 OpenAPI 生成上线。
- **M3**：认证、组织与两级角色、Machine 与远程 Runner 端到端可用；Postgres 迁移测试通过；`audit_events` 覆盖审批、合并、部署、删除与机器注册；Runner 使用机器密钥与租约，不使用 Bearer。
- **M4**：自动化与 Webhook 使用签名、去重与审批；通知不丢不重；插件通过授权 scope 与稳定事件扩展且不能绕过审批门；回滚与升级验证通过；版本化策略冻结，破坏性变更需走 v2 流程。

## 与其他文档的关系

- **`prd/00-product-overview.md`**：定义产品愿景、用户、核心闭环与里程碑叙事；本章是其 API 与数据契约的展开。
- **`prd/01-scope-and-roadmap.md` §3.7、§4.3、§6**：定义范围内外、NFR-001/006、API-002 与 API-010 的跨模块底线；本章的路径决策与性能指标必须与其一致，冲突时以本章 5.0 为路径权威并回写 01。
- **`prd/02-domain-model.md` §2.1、§3、§4、§6、§7、§8、§14**：定义 Workspace、Task、AgentVersion、Run、Review、Approval、Skill、Machine/Runner 的字段、不变量与事件语义；本章的表结构与事件目录以其为语义基线。Approval 首交付在两份文档中均为 M2。
- **`prd/03-user-flows.md`**：定义用户操作路径；本章端点必须覆盖其中的 Run 启动、评审、合并、归档与恢复流程。
- **`prd/04-acceptance-and-test-plan.md` §3.7、§9**：本章 FR 编号的验收映射；其「API-001～API-250」范围需更新为「API-1001～API-1299」，旧引用按 14.0 映射；其「`/api` 在 M2 移除」的验收需改为「`/api` 永久别名 + Deprecation」，与本章 5.0/12.3 一致。
- **`prd/05-risks-and-open-questions.md`**：登记跨模块风险与开放问题；本章 19.2 与其保持同步。
- **`prd/modules/task-management.md` §5.2、§9、§12、§15**：定义 Task 状态矩阵、依赖、归档/删除与任务域 API 需求；本章 13.1 引用其矩阵，5.5 与 9.3 提供表与端点。TASK-136 的本地会话令牌已统一为 M2.1（M1 仅 Origin/Host/CORS 收紧）。
- **`prd/modules/agent-system.md` §6、§7、§9**：定义 Agent、AgentVersion、Skill 与模板语义；本章 5.6/5.10/9.3 提供表与端点。该文档 §7 已按本章 14.13 裁决回写为「M1 同时建 `agent_versions` 与 `run_config_snapshots`，但没有版本管理 UI」。
- **`prd/modules/runtime-and-workspace.md` §6、§7、§8、§10、§11**：定义 Runtime、Runner、Worktree、Artifact/Evidence 与失败分类；本章 5.7/5.8/5.11/7.4 与其对齐。心跳统一为 15 秒 / 45 秒 offline / 90 秒租约；Run Workspace 保留统一为 30 天；运行时模块 §7.4、§8.4 与 RUN-043/RUN-052 按此回写。
- **`prd/modules/collaboration-and-review.md` §5、§8、§9、§14**：定义契约、评审、合并门、证据化 DoD；本章 5.8/5.9、13.3 提供端点与校验顺序。该文档 §14 的 `deliverables`/`approvals` 命名与本章一致；其事件名按 6.3 映射。
- **`prd/modules/security-and-permissions.md` §2、§3、§4、§7、§8**：定义威胁模型、本地令牌、两级角色、Runner 安全与审计；本章 17 节落实中间件、字段与错误码。该文档的 `machines`、`runner` 端点与本章 5.10/5.11 一致。
- **`prd/modules/non-functional-requirements.md` §3、§6、§9**：定义性能、可靠性与可观测性目标；本章 18 节与其对齐，列表 p95 统一为 100ms/200ms。
- **`prd/modules/ui-ux.md` §5、§9、§10**：定义页面与交互；本章 15.2 给出 UI 消费契约的要求。该文档的 `/api/contracts`、`/api/gates` 路径按 5.0 解释为 `/api/v1/deliverables`、`/api/v1/approvals` 的旧写法，需同步修订。
- **`prd/milestones/M0-scaffold.md` 至 `M4-automation-and-packaging.md`**：里程碑文档定义目标、范围、演示与退出标准；本章 20 节提供模块映射，端点、事件与错误码必须引用本章编号，不重复展开。
- **Clean-room 约束**：仓库不提交、不引用第三方研究资料；研究结论必须以原创表述重新记录。

## 待确认/未文档化

1. **Project 别名退出时间（已裁决）**：`projectId` 只作为 M1-M2 的请求输入别名，响应永不返回 `projectId`；`/api/v1/projects` 路径别名在 M2 后保留但不再宣传，M3 前从 `meta` 能力列表移除。
2. **AgentVersion 的 M1 范围（已裁决）**：M1 同时创建 `agent_versions` 与 `run_config_snapshots`。前者保存 Agent 级不可变版本，后者保存 Run 级执行快照并引用 `agent_version_id`；M2 起增加版本对比、`changeNote` 与 `currentVersionId` 体验。`agent-system.md` §7 已按此回写。
3. **Approval 的里程碑（已裁决）**：领域模型 §3.11 与本章均为 M2；M1 只有 Review + MergeRecord，不存在 M1 Approval。
4. **心跳与离线阈值（已裁决）**：统一为 15 秒 / 45 秒 / 90 秒，安全模块 §7.2、M3 TEAM-021/022、领域模型 §3.14 与本章一致；运行时模块 §7.4 按此修订。
5. **契约表名与路径（已裁决）**：唯一实体为 Deliverable（`deliverables` + `contract_versions`），规范路径 `/api/v1/deliverables`，`/api/v1/contracts` 仅为兼容别名；M2 里程碑按此回写。
6. **`/api` 别名的最终生命周期**：当前决定永久保留并冻结为 v1；若未来发布 v2，是否提供自动迁移工具与强制下线日期仍未定。
7. **旧事件名并行期**：`task.dependency.updated`、`contract.*`、`approval.required` 等旧名建议并行发送一个里程碑；具体下线版本待定。
8. **归档与硬删除的保留期（已裁决）**：归档（软删除）默认保留 30 天并可恢复；物理清理仅限无引用的过期数据；批量清理与导出工具是否提供待定。
9. **Runner 事件缓冲上限**：断网缓存的事件条数与磁盘配额需结合真实 Runner 负载校准，当前未设固定值。
10. **M4 遥测字段清单**：默认关闭的前提下，opt-in 后采集哪些计数、保留多久、如何删除，需要隐私评审。
11. **`ateam db` 子命令范围**：当前只定义 `status`；是否需要 `ateam db backup`、`ateam db restore`、`ateam db migrate --dry-run` 待定。
12. **OpenAPI 生成时间**：M2 引入生成器与 `make check-types`；是否在 M1 就生成只读文档待定。
13. **SQLite 到 Postgres 的数据搬迁**：M3 团队模式是否提供导入工具尚未确认；若不提供，需要在升级文档中明确「团队模式从新数据库开始」。
14. **M4 更新通道与签名**：更新源、签名密钥轮换与回滚策略需要与发布流程共同确定。
15. **Codex 适配器的事件映射**：Codex 的流式输出结构尚未在仓库中落地，RunEvent 目录是否足以覆盖其工具调用与补丁事件需要实现时验证。
16. **M4 插件 API 的稳定范围**：插件可订阅的事件、可调用的端点与授权 scope 需要在 M4 设计评审中冻结，避免成为第二套 API。

