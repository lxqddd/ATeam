# 里程碑 M0：项目骨架（已完成）

## 本章导读

本章是 ATeam PRD 的里程碑 M0 章节，记录「项目骨架」阶段的目标、范围、用户故事、交付物、验收标准、演示脚本、依赖、风险与退出标准。M0 要回答的不是「多 Agent 好不好用」，而是「Task → Agent → Run 这条最小链路能否在本机真实跑通，并且有可复现的工程证据」。

阅读本章需要先接受三个事实。第一，M0 的「已完成」是骨架完成，不是产品可用：仓库已有 Go 核心、SQLite、REST/WebSocket API、mock Runtime、Vue 看板与 Wails 桌面壳，但没有 git worktree、diff 评审、Artifact/Evidence、真实 Claude Code 流式适配、远程 Runner、登录权限与安装包。第二，M0 的验收结论是「有条件通过」：构建、测试、API 主路径、Mock Run、事件流、重启持久化、SPA 托管、浏览器操作均已验证，但排队中 Run 的取消存在已复现的 S1 状态缺陷，测试覆盖与安全边界仍有明确缺口；超时（D-M0-13）、blocked 任务可见性（TASK-031）、离线（PROD-001）与 WebSocket 断线重连（NFR-NET-006）属于「机制存在或仅有代码审阅、未做行为验证」的边界项。第三，本章只写里程碑级目标、范围与验收，不重复模块级字段、接口与交互细节；需要展开时以 `prd/modules/` 下对应文档为准。

第 6 节的结论列以「通过 / 部分通过 / 未验证 / 边界确认」为主档，必要时附条件说明，避免把代码审阅或机制接线写成实测通过。`通过` 指本轮有可复现命令与观察结果；`部分通过` 指主路径通过但存在明确未覆盖面；`未验证` 指只有代码或设计证据、没有行为证据；`边界确认` 指该项本身是已知限制，验收的是限制被准确记录与演示。

本章的读者包括产品经理、工程师、设计师、测试与决策者。产品与决策者重点阅读第 1、2、10、11 节；工程师重点阅读第 4、5、6、7 节；测试与演示负责人重点阅读第 7、9、10 节。文中状态标记统一为：已实现（M0）、部分实现（M0）、计划（M1-M4）。任何未标注为已实现的内容，都不得在演示、README 或对外材料中描述为现有能力。

## 1. 里程碑目标与定位

### 1.1 目标用户结果

完成 M0 后，独立开发者应当能够在一台开发机上完成以下动作，而不依赖任何云端服务：

1. 启动 ATeam 的 Go 服务与 Vue Web UI，确认本地 API 可用。
2. 在看板上创建 Task，修改 Task 状态，并在刷新或重启后保留数据。
3. 创建可复用的 Agent，指定 Runtime、instructions、超时与工作区模式（超时字段可保存，行为未验证）。
4. 从 Task 详情选择一个 Agent，触发一次 Run。
5. 观察 Run 从 queued 依次进入 preparing、running、completed 或 failed，并看到按顺序排列的事件日志。
6. 对 Run 发起取消：终态取消幂等可验证；运行中取消在约 1.4 秒的 mock 窗口中可观察到 cancelled，但不是稳定可演示的路径（见 7.4 第 8 步与 D-M0-01）。
7. 使用 Wails 桌面壳加载同一套 Web UI。
8. 通过 CI 或本地 `make test` 获得可重复的构建与类型检查结果。

M0 不要求 Agent 真正修改仓库代码。mock Runtime 只验证执行管道、状态机、事件流和界面反馈；真实代码修改、diff、证据与合并属于 M1。

超时不在上述用户结果内：调度器已按 `timeoutMinutes` 接线 context 超时，但该字段为整数分钟（默认 60），mock Run 约 1.4 秒结束，M0 没有可执行的超时验证路径。本章把超时标注为「机制存在、未验证」（D-M0-13），不计入 M0 已交付能力。

### 1.2 工程目标

M0 的工程目标是把后续里程碑要用的「承重结构」一次性立起来，避免 M1 在泥地上盖楼：

- 用 Go 定义 Task、Agent、Run、RunEvent 四个核心领域对象，状态枚举覆盖后续扩展。
- 用 SQLite + 内嵌 migration 建立可重复执行的持久化基线。
- 用 REST + WebSocket 建立前后端单一契约，而不是让 Vue 直接读数据库或依赖桌面壳私有通道。
- 用 Scheduler + Runtime Adapter 接口把「排队、执行、事件、取消、超时」与具体编码 Agent CLI 解耦；超时在 M0 只完成 context 接线，行为未验证（D-M0-13）。
- 用 Workspace Manager 预留每次 Run 独立工作区的概念，即使 M0 只是普通目录。
- 用 pnpm monorepo 管住 Go 核心、Vue Web、Wails 桌面壳与 TypeScript 共享包。
- 用 CI、Makefile、README 与 PRD 把「已实现」与「计划中」写清楚，防止路线图被误读为现状。

### 1.3 为什么先做骨架

编码 Agent 的能力不是 ATeam 的差异化来源。Claude Code、Codex 等 CLI 已经能完成大量编码工作；ATeam 要解决的是多 Agent 并行时的上下文交接、工作区隔离、可观测性、评审与治理。如果先做真实 Runtime 适配而不先定义 Task、Agent、Run、Workspace、Artifact、Evidence 这些对象，后续每个功能都会长在聊天记录或临时脚本上，无法被评审和审计。

因此 M0 的顺序是：先定义对象与状态，再定义 API 与事件，再接入 mock Runtime 验证闭环形状，最后做最小 UI 与桌面壳。真实 Runtime、worktree、证据与合并放在 M1，是因为它们依赖 M0 的对象与管道；角色 Agent 协作放在 M2，是因为它依赖 M1 的隔离与证据。

### 1.4 「已完成」的口径

本章标题中的「已完成」指 M0 的骨架交付物已经落地，并且有代码、构建、测试、API 冒烟与浏览器操作的证据，不代表 ATeam 已经是可用的多 Agent 开发产品。M0 的正式验收结论是「有条件通过」：主路径通过，已知缺陷被记录，S1 缺陷有明确的 M1 修复计划。任何对外说明必须同时给出这两个限定词，不能只引用「已完成」。

「有条件通过」还包含四类边界，本章在第 6 节逐项给出结论：超时只有机制接线（D-M0-13）；blocked/cancelled 任务在看板不可见（TASK-031、UI-018）；离线只有代码审阅、未做断网走查（PROD-001、NFR-NET-001）；WebSocket 断线重连只有代码审阅、未做断网实测（NFR-NET-006）。这些边界不改变 M0 作为骨架的退出结论，但不得被写成已验证能力。

## 2. 范围

### 2.1 范围内：M0 已交付的能力

| 能力域 | M0 已实现内容 | 代码或配置载体 | 模块文档 |
|---|---|---|---|
| 领域模型 | Task、Agent、Run、RunEvent；Task 七种状态；Run 六种状态；AssigneeType 预留 human、agent、crew | `internal/domain/domain.go` | `prd/02-domain-model.md`、`prd/modules/task-management.md`、`prd/modules/agent-system.md`、`prd/modules/runtime-and-workspace.md` |
| 持久化 | SQLite、内嵌 SQL migration、schema_migrations、WAL、busy_timeout、外键开关；tasks、agents、runs、run_events 四张表与索引 | `internal/store/sqlite.go`、`internal/store/migrations/0001_init.sql` | `prd/modules/api-and-data.md` |
| HTTP API | 健康检查；Task CRUD；Agent CRUD；按 Task 列出与创建 Run；Run 列表与详情；RunEvent 列表；Run 取消；统一 JSON 错误 | `internal/api/api.go`、`internal/api/handlers.go` | `prd/modules/api-and-data.md` |
| WebSocket | `/api/ws` 广播 task、agent、run 状态事件与 `run.event`；客户端断开后固定每 2 秒重连并全量刷新，无连接状态提示（未做断网实测） | `internal/events/hub.go`、`apps/web/src/composables/useEventStream.ts` | `prd/modules/api-and-data.md`、`prd/modules/ui-ux.md` |
| 调度器 | 进程内队列（容量 256）、默认 2 个 worker、Run 状态推进、按 Agent timeoutMinutes 设置上下文超时（整数分钟、最小 1，仅机制接线、未验证）、运行中取消表 | `internal/scheduler/scheduler.go`、`internal/app/app.go` | `prd/modules/runtime-and-workspace.md` |
| Runtime | Adapter 接口；mock 适配器按四步、每步约 350 毫秒输出日志与 summary；claude 适配器调用本机 `claude -p` 并逐行转发 stdout/stderr；未知 Runtime 静默回退 mock（缺陷 D-M0-18） | `internal/runtime/runtime.go`、`internal/runtime/mock.go`、`internal/runtime/claude.go` | `prd/modules/runtime-and-workspace.md`、`prd/modules/agent-system.md` |
| Workspace | 每次 Run 在 `{dataDir}/workspaces/runs/{runId}` 创建普通目录；默认 dataDir 为 `~/.ateam`；`--db` 只改数据库，不改变 workspace 根目录；`workspaceMode` 字段被保存但未生效 | `internal/workspace/workspace.go`、`internal/app/app.go` | `prd/modules/runtime-and-workspace.md` |
| Vue Web | Board 五列看板（blocked/cancelled 不渲染）、任务详情（状态选择器仅五状态）、Agent 列表与创建、Runs 列表、Settings 健康检查、拖拽改状态、Run 日志轮询 | `apps/web/src/views/`、`apps/web/src/stores/`、`apps/web/src/router.ts` | `prd/modules/ui-ux.md` |
| 共享包 | `@ateam/shared` 类型与枚举；`@ateam/api-client` 类型化客户端 | `packages/shared/src/index.ts`、`packages/api-client/src/index.ts` | `prd/modules/api-and-data.md` |
| 桌面壳 | Wails v3 启动随机本地端口，加载 1440×900 原生窗口；未打包 | `apps/desktop/main.go` | `prd/modules/non-functional-requirements.md` |
| 工程与 CI | Makefile、Go test/vet、Vue typecheck、Web build、pnpm monorepo、GitHub Actions | `Makefile`、`.github/workflows/ci.yml`、`go.mod`、`package.json` | `prd/modules/non-functional-requirements.md`、`prd/modules/api-and-data.md` |

表中「已实现」不等于「已验证」。超时（D-M0-13）、blocked/cancelled 可见性（TASK-031、UI-018）、离线（PROD-001）与 WebSocket 断线重连（NFR-NET-006）在 M0 只有机制或代码层面的证据，结论见第 6 节。运行中取消虽然有 API 冒烟记录，但 mock Run 全程约 1.4 秒，没有稳定操作窗口，不能作为可重复演示项。

### 2.2 非目标：M0 明确不做

以下内容在 M0 中是计划或非目标，不得写成已实现：

1. 不做 git worktree、分支创建、diff、commit、merge、push；M0 的 Workspace 只是普通目录，Run 的 branch 字段为空。
2. 不做真实 Claude Code 的结构化流适配、模型选择、权限参数、工具事件解析与错误分类；claude 适配器仅为实验性最小实现。
3. 不做 Codex Runtime；具体接入里程碑由后续规划确认。
4. 不做 Artifact/Evidence 数据模型、存储与评审界面；Run 只有 summary、error 与文本事件。
5. 不做人工评审门与合并动作；M0 没有可合并的代码变更，也没有 diff 可看。
6. 不做登录、团队权限、审计、Postgres、远程 Runner、机器注册、GitHub PR；这些属于 M3。
7. 不做安装包（DMG/NSIS/AppImage）、自动更新、通知、定时/Webhook 自动化、插件 API、遥测；这些属于 M4。
8. 不做任务依赖 DAG、交付物契约、角色 Agent 模板、Crew/队长模式、收件箱、技能与任务模板；这些属于 M2。
9. 不做完整的通用项目管理套件、20+ 外部集成、IM 机器人、技能市场、移动端、多租户 SaaS、模型托管与转售。
10. 不做多个 Agent 在同一会话中自由聊天。角色 Agent 的协作方向是任务 DAG + 交付物契约 + 审批门 + 证据化 DoD，M2 才交付，M0 不提供任何协作编排能力。
11. 不提供 blocked/cancelled 的看板列、筛选或 UI 状态恢复入口；领域模型与 API 支持这两个状态，但 Board 只渲染五列，详情页状态选择器也只覆盖五状态。M1 按 TASK-031、UI-018 补齐。
12. 不提供超时的独立错误分类与可执行验证路径；M0 只有调度器的 context 超时接线，超时最终表现为 failed，没有 `timeout` 分类。M1 按 AGENT-015、RUN-005 补齐。

### 2.3 角色 Agent 协作的边界

M0 的 Agent 只是「可复用的工作配置」，不是「会互相聊天的角色」。UI Design、Frontend、Backend、DevOps 四类角色在 M2 通过任务 DAG 表达依赖，通过交付物契约表达输入输出，通过审批门控制高风险动作，通过证据化 DoD 声明完成。M0 的角色能力仅限于：用户可以在 Agent 的 instructions 中写角色化提示，调度器会把 instructions 组合进提示词；除此之外没有角色模板、没有角色字段、没有角色间交接。

这条边界是产品原则，不是实现偷懒。自由聊天的多 Agent 模式输出不可追踪、不可复现，也无法在合并前形成可核验的交付物；ATeam 选择显式协作，详见 `prd/modules/collaboration-and-review.md`。

### 2.4 高风险动作的边界

M0 没有任何合并、推送、部署、删除工作区的高风险动作。提示词中包含「不要在没有人工批准的情况下推送、合并或部署」，但这只是文本规则，不是系统强制。M0 的 delete Task / delete Agent 接口没有审批、没有 Run 引用检查，属于已知缺口。

从 M1 起，合并必须由人工在评审界面批准；M2 起，推送、部署、删除等动作必须产生审批记录，未批准时被服务端阻止。DevOps Agent 在 M2 只能生成部署计划与执行 staging，生产部署必须由人执行。M0 不提供这些能力，因此也不存在「自动合并」或「自动部署」的风险敞口。

## 3. 角色与场景

### 3.1 角色

| 角色 | 在 M0 中的职责 | 主要接触面 | 不在 M0 中的能力 |
|---|---|---|---|
| 独立开发者 | 创建 Task 与 Agent，启动 Run，观察日志，取消运行，判断骨架是否可用 | Board、Task 详情、Agents、Runs、Settings | 不能评审 diff、不能合并、不能使用 worktree |
| 评审者 | M0 没有真实代码变更，评审者只验证 Run 记录是否可读、状态是否正确 | Task 详情、Run 日志 | 不能接受/拒绝变更，不能评论 |
| 工程维护者 | 维护 Go 服务、Vue 前端、Wails 壳、CI 与迁移；新增 Runtime adapter | 代码、Makefile、CI | 不能依赖 M0 的 API 兼容性承诺 |
| 小团队 | M0 只支持单机单用户视角；多人共享数据、权限与远程机器均未实现 | 本机浏览器或桌面壳 | 不能登录、不能分配权限、不能共享 Runner |
| 产品与决策者 | 用 M0 判断产品骨架是否符合预期，决定是否投入 M1 | 演示脚本、验收记录、PRD | 不能把 M0 作为可发布版本 |

### 3.2 典型场景

**场景 A：首次启动与看板总览。** 开发者安装依赖，启动 Go 服务与 Vue 开发服务器，打开 Board，看到 Backlog、Todo、In Progress、In Review、Done 五列。空列显示空状态，侧边栏显示 Board、Agents、Runs、Settings 与本地优先标识。

**场景 B：创建 Task 并在看板流转。** 开发者创建标题与描述，默认状态为 backlog；把卡片拖到 Todo；刷新页面后状态仍在。M0 的拖拽是直接 PATCH，没有乐观更新与失败回滚，这是 M1 的改进项。

**场景 C：创建 Agent 并跑一次 Mock Run。** 开发者创建 Agent，Runtime 选择 mock，instructions 写清职责；进入 Task 详情，选择 Agent，点击 Run；Run 依次进入 queued、preparing、running、completed，日志出现启动信息、四步 mock 日志与 summary；Task 被指派给该 Agent，todo 自动转为 in_progress。

**场景 D：失败与取消的诊断。** 开发者选择 claude Runtime 但本机没有 `claude` CLI，Run 进入 failed，error 提示 CLI 不存在；该路径在 M0 只有代码审阅结论，本轮未做端到端故障注入（D-M0-04）。对运行中的 mock Run 点击 Cancel，Run 进入 cancelled，error 为 `run cancelled`；但 mock Run 四步共约 1.4 秒，运行中取消没有稳定操作窗口。M0 的取消验收以「终态取消幂等」为准，运行中取消与排队取消的确定性演示放到 M1（D-M0-01 修复后，配合可配置步数与延迟的 mock）。

**场景 E：重启后的数据持久化。** 开发者停止服务并用同一个数据库路径重启，Task、Agent、Run 与 RunEvent 仍可读取；迁移表不会重复执行。

**场景 F：桌面壳加载。** 开发者运行 `make dev-desktop`，Wails 启动本地随机端口服务并打开 1440×900 原生窗口，窗口加载与浏览器相同的 Web UI；M0 不提供安装包与签名。

**场景 G：工程扩展。** 工程维护者实现一个新的 `runtime.Adapter`，在 Registry 注册后即可被 Agent 的 runtime 字段选择，不需要修改 Task、Run 或 HTTP handler；这是 PROD-002 与 PROD-012 在 M0 的接口级兑现。

**场景 H：blocked 任务的可见性边界。** 开发者通过 API 或已有的状态修改路径把任务置为 blocked；API 与领域模型接受该状态，但 Board 只渲染 Backlog、Todo、In Progress、In Review、Done 五列，任务从看板消失，任务详情页的状态选择器也只覆盖五状态，无法从 UI 改回。这是 M0 的已知可见性缺口（TASK-031、UI-018、FLOW-A-016），数据未损坏，可通过 `PATCH /api/tasks/{id}` 恢复；M1 必须提供 blocked/cancelled 的列或筛选。

**场景 I：离线与断线边界。** mock Runtime、Task/Agent CRUD 与静态资源都不依赖网络，代码层面满足 PROD-001 的「断网可用」描述；但本轮未执行断网走查，因此离线验收结论为「部分通过」。WebSocket 断开后前端固定每 2 秒重连并全量刷新，没有连接状态提示；断网实测与退避策略属于 M1/M2（NFR-NET-006 为 M1，NFR-NET-007 为 M2），连接状态横幅属于 M1（UI-009）。

## 4. 用户故事与验收证据

### 4.1 用户故事

编号约定：本节与第 6 节的「模块需求」一律指 `prd/modules/*.md` 中的需求 ID（TASK-、AGENT-、RUN-、API-、UI-、SEC-、NFR-）；用户流程编号统一写为 `FLOW-<流程>-<序号>`，引用 `prd/03-user-flows.md`。03 已停用旧的 TASK-/RUN-/AGENT- 前缀，本章不得用流程文档的编号冒充模块需求，也不得用模块编号指代流程验收点。

**US-M0-01 首次启动（独立开发者）**
Given 开发者已安装 Go、Node、pnpm，并执行了 `make web-install`；
When 开发者运行 `make dev-server` 与 `make dev-web`，或直接运行构建后的 `bin/ateam serve`；
Then `/api/health` 返回 `status=ok` 与版本号，浏览器能打开 Board、Agents、Runs、Settings 四个页面。
验收映射：M0-AC-01、M0-AC-11、M0-AC-12、M0-AC-13；模块需求 UI-001、UI-011、UI-126、NFR-SEC-001。

**US-M0-02 创建任务并看到看板列（独立开发者）**
Given Board 已加载；
When 开发者点击 New task，填写非空标题、描述并选择状态；
Then 任务创建成功并出现在对应列；刷新页面后任务仍在。
验收映射：M0-AC-02、M0-AC-11；模块需求 TASK-001、TASK-003。

**US-M0-03 创建 Agent 并启动 Run（独立开发者）**
Given 已存在一个 Agent，Runtime 为 mock；
When 开发者进入一个 todo 状态的 Task，选择该 Agent 并点击 Run；
Then 系统创建 Run，Task 被指派给该 Agent，todo 转为 in_progress，Run 在数秒内完成并写入 summary。
验收映射：M0-AC-03、M0-AC-04、M0-AC-05、M0-AC-07；模块需求 AGENT-001、AGENT-007、TASK-021、TASK-022、TASK-023、RUN-080、FLOW-A-002。

**US-M0-04 观察事件流（独立开发者）**
Given 一个已启动的 Run；
When 开发者查看 Run 日志；
Then 事件按 seq 从 1 连续递增显示，类型至少包含 log 与 summary；刷新页面后可按事件 API 重新读取。
验收映射：M0-AC-06、M0-AC-11；模块需求 RUN-006、RUN-007、TASK-063、FLOW-A-004。

**US-M0-05 取消运行中的 Run（独立开发者）**
Given 一个 running 状态的 Run；
When 开发者点击 Cancel；
Then Run 进入 cancelled，error 记录原因；对终态 Run 再次取消返回当前对象且不改变状态。
验收映射：M0-AC-08；模块需求 RUN-086、RUN-087、RUN-085（M1 修复项）；排队取消的 M1 要求见 FLOW-A-009，已知缺陷 D-M0-01 仅影响排队中的 Run。M0 的 mock Run 只有约 1.4 秒操作窗口，本故事不作为稳定演示项。

**US-M0-06 重启后数据仍在（独立开发者）**
Given 已创建 Task、Agent 与 Run；
When 开发者停止服务，使用同一数据库路径重启；
Then 任务、Agent、Run 与 Run 事件仍可读取，schema_migrations 不重复执行。
验收映射：M0-AC-02、M0-AC-17；模块需求 NFR-REL-008、API-063（M1 队列恢复）。

**US-M0-07 Runtime 不可用时错误可读（独立开发者）**
Given Agent 选择 claude Runtime，但本机没有 `claude` CLI；
When 开发者启动 Run；
Then Run 进入 failed，error 明确提示 CLI 不在 PATH；不得把失败标为 completed。
验收映射：M0-AC-18；模块需求 RUN-003（M1 严格化）、RUN-012、AGENT-011。M0 只有代码审阅结论，未执行端到端故障注入（D-M0-04）。

**US-M0-08 桌面壳加载同一 UI（独立开发者）**
Given 本机已安装 Wails v3 依赖；
When 开发者运行 `make dev-desktop`；
Then 桌面窗口启动并加载与浏览器相同的 Web UI，无白屏与跨域错误。
验收映射：M0-AC-14；模块需求 NFR-PORT-006、UI-125（窗口尺寸约束，M1 完整验收）。

**US-M0-09 通过 Adapter 扩展 Runtime（工程维护者）**
Given 工程维护者实现一个新的 `runtime.Adapter`；
When 在 Registry 注册并创建选择该 runtime 的 Agent；
Then 调度器可以调用新适配器，不需要修改领域模型与 HTTP handler；未知 Runtime 的静默回退 mock 行为在 M1 必须改为显式报错。
验收映射：M0-AC-03、M0-AC-18；模块需求 AGENT-011、RUN-001、RUN-002、RUN-003、PROD-002、PROD-012。

**US-M0-10 超时机制（独立开发者，M0 仅机制）**
Given 一个 Agent 设置了 `timeoutMinutes`；
When 该 Run 的执行时间超过该阈值；
Then 调度器应取消执行上下文并使 Run 以超时相关状态结束，不得标为 completed。
M0 现状：`timeoutMinutes` 为整数分钟且最小 1，mock Run 约 1.4 秒结束，现有接口无法在 M0 稳定触发超时；本故事在 M0 只完成机制接线，验收结论为「未验证」（D-M0-13）。M1 必须提供短超时测试配置或可配置延迟的 mock，并区分 timeout 与普通失败。
验收映射：M0-AC-19；模块需求 AGENT-014、AGENT-015、RUN-005。

**US-M0-11 blocked 任务的可见性（独立开发者，M0 边界）**
Given 任务被置为 blocked；
When 开发者回到 Board；
Then 任务不显示在五列中，且无法从 UI 改回其他状态；只能通过 API 恢复。
验收映射：M0-AC-20；模块需求 TASK-031、UI-018（均为 M1 目标）。

**US-M0-12 断网使用（独立开发者）**
Given 本机已启动 ATeam 且页面已加载；
When 断开网络后创建 Task/Agent 并启动 mock Run；
Then CRUD 与 mock Run 仍可用，页面不因外部资源失败。
验收映射：M0-AC-21；模块需求 NFR-NET-001、NFR-NET-002（M1 正式验收）。

**US-M0-13 断线重连（独立开发者）**
Given 页面已连接 `/api/ws`；
When WebSocket 连接断开并恢复；
Then 客户端在 2 秒后自动重连并全量刷新列表；用户看不到显式连接状态（M1 增加状态横幅）。
验收映射：M0-AC-22；模块需求 API-123、NFR-NET-006、UI-009（M1）。

### 4.2 本次复核执行的验收证据

下表记录本章撰写时在当前 macOS 环境实际执行并观察到的结果。所有命令都在 `/Users/liuxq/Desktop/mineSpace/ATeam` 下执行，未读取任何第三方研究资料，未引用第三方产品资产。

| 证据类型 | 命令或操作 | 实际结果 | 结论 |
|---|---|---|---|
| 干净构建 | `make build` | 退出码 0；生成 `bin/ateam` 与 `bin/ateam-desktop`；`apps/web/dist` 生成；桌面链接出现 macOS 部署目标警告 | 通过（有警告） |
| Go 测试 | `go test $(go list ./... \| grep -v '/apps/desktop')` | 全部包通过；仅 `internal/store` 有测试文件 `TestTaskLifecycle` | 通过（覆盖有限） |
| Go 静态检查 | `go vet $(go list ./... \| grep -v '/apps/desktop')` | 退出码 0 | 通过 |
| 前端类型检查 | `pnpm --filter @ateam/web typecheck` | `vue-tsc --noEmit` 退出码 0 | 通过 |
| 健康检查 | `GET /api/health` | `{"status":"ok","version":"0.1.0-dev",...}` | 通过 |
| Task 创建 | `POST /api/tasks`，状态 todo | 返回 201 与完整对象，ID 自动生成 | 通过 |
| Agent 默认值 | `POST /api/agents`，仅传名称与 runtime | 返回 workspaceMode=worktree、maxConcurrency=1、timeoutMinutes=60 | 通过 |
| Mock Run 闭环 | 对 todo Task 创建 Run | Run 从 queued 到 completed，约 1.4 秒，summary 为 `Completed with mock runtime` | 通过 |
| Run 事件 | `GET /api/runs/{id}/events` | 6 条事件，5 条 log + 1 条 summary，seq 为 1 至 6 | 通过 |
| 任务自动关联 | 启动 Run 后读取 Task | assigneeType=agent、assigneeId 指向 Agent，todo 变为 in_progress | 通过 |
| 非法状态拒绝 | 对 backlog Task 创建 Run | 返回 HTTP 409 与可读错误 | 通过 |
| 运行中取消 | 对 running 的 Mock Run 调用 cancel | Run 进入 cancelled，error 为 `run cancelled` | 通过（单次冒烟；无稳定操作窗口；排队取消另见 D-M0-01） |
| SPA 托管 | `GET /` | 返回 200 与 `text/html` | 通过 |
| 浏览器实测 | 打开 Board，创建任务与 Agent，启动 Run，刷新，查看 Runs 页 | Board 与侧边栏渲染正常；任务出现在 Todo；Agent 卡片出现；Run 显示 Completed，Task 显示 In Progress；日志面板出现；刷新后状态保留；Runs 页出现 `Completed / 浏览器验收任务 / manual / Completed with mock runtime` | 通过 |
| 桌面编译 | `make build` 包含 `go build -o bin/ateam-desktop ./apps/desktop` | 编译成功，未在无头环境启动 GUI | 部分通过 |

浏览器复核过程中保存了页面截图到本机临时目录，仅作为本次评审证据，不进入仓库；正式演示时应按第 7.8 节重新采集并归档。WebSocket 事件类型与重启持久化的验证结果见 `prd/04-acceptance-and-test-plan.md` 第 9.2 节，本章不重复抓包数据。

**未执行、仅有代码审阅的边界项。** 下表与上表区分：上表是实际执行并观察到的证据；下表是本轮没有执行行为验证、只做了代码审阅或设计确认的项目，不得引用为上表同类证据。

| 边界项 | 本轮证据 | 结论 |
|---|---|---|
| 超时 | 代码审阅 `internal/scheduler/scheduler.go` 的 `context.WithTimeout`；mock Run 约 1.4 秒、`timeoutMinutes` 为整数分钟 | 机制存在、未验证（D-M0-13、M0-AC-19） |
| claude CLI 缺失 | 代码审阅 claude adapter 与调度器失败路径；未执行故障注入，复核环境未做端到端 claude 验证 | 未验证端到端（D-M0-04、M0-AC-18） |
| Settings 页面 | 路由 `/settings` 与 `SettingsView.vue` 健康检查代码审阅；未做浏览器验收 | 部分通过（M0-AC-12） |
| 离线 | 代码审阅：`apps/web` 未引用外部 URL，mock adapter 无网络调用；未做断网走查 | 部分通过（M0-AC-21） |
| WebSocket 断线重连 | 代码审阅 `useEventStream.ts`：连接关闭后固定 2 秒重连并全量刷新；服务端每 30 秒 ping；未做断网实测 | 部分通过（M0-AC-22） |
| blocked 任务可见性 | API 冒烟 + `BoardView.vue` / `TaskView.vue` 代码审阅：Board 仅渲染五列 | 边界确认（M0-AC-20） |

US-M0-07 与 M0-AC-18 的 claude 缺失路径本轮未执行故障注入：复核环境未安装或未登录 claude CLI，也没有构造 PATH 中移除 `claude` 的对照运行，因此结论只能来自代码审阅。该缺口登记为 D-M0-04，M1 补做端到端验证并归档 Run JSON。

### 4.3 证据留存与复现规则

- 每次验收至少保存：健康检查输出、Run 事件 JSON、任务列表截图、Run 详情截图、重启后的任务列表截图。
- 浏览器实测必须使用独立数据库、独立端口与临时 HOME：`--db /tmp/ateam-demo/ateam.db` 只改变数据库路径，workspace 根目录仍固定为 `~/.ateam/workspaces`（`Config.DataDir` 默认来自用户主目录，Q-M0-04）。推荐在演示终端内设置 `HOME=/tmp/ateam-demo/home`，让数据库默认路径与 workspace 一起落到临时目录；若不覆盖 HOME，演示后必须清理 `~/.ateam/workspaces/runs/<runId>`。`--data-dir` 是 M1 计划项（11.2 第 4 条）。
- 演示结束后删除 `/tmp/ateam-demo`；若使用了真实 HOME，还需核对 `~/.ateam` 下没有残留的演示 Run 目录与事件数据。
- 不使用真实业务仓库作为 M0 演示仓库；M0 不修改代码，也不产生 diff。
- 不保存任何 API Key、Token、用户隐私数据或第三方研究资料到验收记录。
- 证据记录必须注明命令、退出码、观察结果与时间；口头描述和聊天截图不能替代可复现命令。
- 演示失败时按第 7.7 节判定，不允许用「环境问题」跳过失败项；失败项必须登记为缺陷或阻塞项。

## 5. 交付物

### 5.1 软件交付物

| 交付物 | 内容 | 验收方式 | 模块文档 |
|---|---|---|---|
| Go 核心与 CLI | `ateam serve`、`ateam version`；`ateam runner` 仅提示 M3 预留；`--addr`、`--db`、`--web`、`--concurrency` 参数 | `go build ./cmd/ateam`；启动后健康检查 | `prd/modules/api-and-data.md` |
| 领域模型 | Task、Agent、Run、RunEvent 及状态枚举；ID 生成与 UTC 时间 | 单元测试与 API 对象检查 | `prd/02-domain-model.md` |
| SQLite 存储 | 四张业务表、索引、migration、WAL、busy_timeout、外键开关 | 重启后数据仍在；迁移表只有 `0001_init.sql` | `prd/modules/api-and-data.md` |
| REST API | Task/Agent CRUD、Run 创建与查询、事件查询、取消、健康检查 | HTTP 冒烟与状态码检查 | `prd/modules/api-and-data.md` |
| WebSocket | task、agent、run 状态事件与 run.event；客户端固定 2 秒重连（代码审阅） | 事件抓包与前端刷新；重连未做断网实测 | `prd/modules/api-and-data.md` |
| 调度器 | 进程内队列、worker 池、超时接线（未验证）、取消（存在竞态）、Run 状态推进 | Mock Run 状态序列与取消测试；超时仅代码审阅 | `prd/modules/runtime-and-workspace.md` |
| Runtime Adapter | Adapter 接口、Registry、mock、最小 claude；未知 Runtime 回退 mock（D-M0-18） | mock 闭环；claude 缺失路径为代码审阅，未做端到端故障注入 | `prd/modules/runtime-and-workspace.md` |
| Workspace Manager | 每 Run 独立普通目录（非 worktree） | Run.worktree 路径存在且互不重叠 | `prd/modules/runtime-and-workspace.md` |
| Vue Web | Board、Task、Agents、Runs、Settings 与基础组件 | 浏览器实测与类型检查 | `prd/modules/ui-ux.md` |
| 共享 TypeScript 包 | Task、Agent、Run、RunEvent 类型；API 客户端 | `pnpm -r typecheck` | `prd/modules/api-and-data.md` |
| Wails 桌面壳 | 随机端口启动服务并加载 Web UI | 编译；演示时手工启动 | `prd/modules/non-functional-requirements.md` |
| CI 与 Makefile | Go test/vet、pnpm install、typecheck、web build、本地构建命令 | CI 配置审阅与本地执行 | `prd/modules/non-functional-requirements.md` |

### 5.2 工程与文档交付物

- `README.md`：产品定位、核心闭环、monorepo 布局、快速开始、API 概览、Runtime 说明、路线图与 clean-room 声明。
- `Makefile`：`dev-server`、`dev-web`、`dev-desktop`、`web-install`、`web-build`、`build`、`test`、`fmt`、`tidy`、`clean`。
- `.github/workflows/ci.yml`：Go 测试与 vet；pnpm 安装、全仓 typecheck、Web 构建。
- `CONTRIBUTING.md`：clean-room 贡献要求、DCO、代码风格与问题报告规范。
- `LICENSE`（Apache-2.0）与 `NOTICE`：原创实现与许可证声明。
- `internal/store/sqlite_test.go`：Task 生命周期测试，覆盖创建、读取、更新、列表与删除。
- `.gitignore`：构建产物、本地数据、Node 依赖、Wails 构建目录、`.env`、第三方研究资料隔离。
- 本 PRD 文档集：产品总览、范围与路线图、领域模型、用户流程、验收与测试计划、风险与开放问题、模块文档与本里程碑文档。

### 5.3 交付物与需求映射

M0 的交付物对应以下产品级需求，但必须按实际完成度区分，不能把它们整体写成「已交付」：

- PROD-001（本地默认可运行）：M0 已实现 CRUD 与 mock Run 的本地路径；断网走查未执行，验收结论为部分通过（M0-AC-21）。
- PROD-002（BYO Runtime 接口）：Adapter 接口、Registry、mock 与最小 claude 已存在；未知 Runtime 静默回退 mock 是已知缺陷（D-M0-18、AGENT-011），校验属于 M1。
- PROD-003（Task 作为上下文容器）：M0 已实现提示词组合与 Task 关联，提示词不落库。
- PROD-006（可观测性机制）：事件持久化与 WS 推送已有；claude adapter 的并发 emit 未串行化、seq 可能重复或乱序，断线重放未实现（RUN-006、RUN-116 属 M1）。
- PROD-013（数据主权）与 PROD-014（开源与原创）：M0 已实现。
- PROD-015（取消与超时）：M0 只交付「机制接线」——运行中 context 取消可观察、终态取消幂等；排队取消存在 D-M0-01，超时只有经过代码审阅的上下文超时、未做行为验证（D-M0-13），因此不计入 M0 的完整交付。

PROD-004、PROD-005、PROD-007、PROD-008、PROD-009、PROD-010 分别属于部分实现或 M1/M2，详见 `prd/00-product-overview.md` 第 10 节。

## 6. 验收标准

### 6.1 功能验收标准

| ID | 验收项 | 判定标准 | 证据方法 | M0 结论 | 关联需求 |
|---|---|---|---|---|---|
| M0-AC-01 | 本地启动与健康检查 | 服务监听默认 `127.0.0.1:8787`；`/api/health` 返回 status、version、time | `curl` 健康检查 | 通过 | NFR-SEC-001、API-011（M1 扩展）、UI-126 |
| M0-AC-02 | Task CRUD 与持久化 | 创建返回 201；读取、更新、删除符合 200/204/404；重启后数据保留 | API 冒烟 + 重启 | 通过 | TASK-001、TASK-003、TASK-004、TASK-020、NFR-REL-008 |
| M0-AC-03 | Agent CRUD 与默认值 | 名称必填；runtime 默认 mock、workspaceMode 默认 worktree、maxConcurrency 默认 1、timeoutMinutes 默认 60 | API 默认值断言 | 通过 | AGENT-001、AGENT-002、AGENT-003、AGENT-007 |
| M0-AC-04 | 可执行状态与 Run 创建 | 仅 todo、in_progress、in_review 可创建 Run；缺少 agentId 返回 400；非法状态返回 409 | API 状态码测试 | 通过 | TASK-021、TASK-022、API-028 |
| M0-AC-05 | Mock Run 状态机 | queued → preparing → running → completed；开始与结束时间写入；summary 可读 | 运行后读取 Run | 通过 | RUN-080（M1 状态守卫）、RUN-081 |
| M0-AC-06 | RunEvent 顺序与查询 | 事件 seq 从 1 连续递增；按 seq 返回；log 与 summary 可区分；持久化后可重读 | 事件 API | 通过 | RUN-006、RUN-007 |
| M0-AC-07 | 任务自动指派 | 启动 Run 后 assigneeType=agent、assigneeId 指向 Agent；todo 转为 in_progress | 运行后读取 Task | 通过 | TASK-023、FLOW-A-002 |
| M0-AC-08 | 取消与幂等 | 运行中的 Run 可取消并进入 cancelled；终态 Run 再次取消不改变状态 | 取消 API | 部分通过：运行中取消单次冒烟通过；排队取消不通过（D-M0-01）；运行中取消无稳定演示窗口 | RUN-085（M1）、RUN-086、RUN-087 |
| M0-AC-09 | 列表与详情 | Task、Agent、Run 列表返回数组；不存在资源返回 404；错误为 JSON | API 断言 | 通过 | TASK-120、AGENT-002、AGENT-003 |
| M0-AC-10 | WebSocket 广播 | 连接 `/api/ws` 后能收到 task.created、agent.created、task.updated、run.queued、run.preparing、run.running、run.event、run.updated | 事件抓包（见验收文档第 9.2 节） | 通过 | RUN-007、AGENT-008、API-123 |
| M0-AC-11 | Board 与任务详情 | Board 五列、计数、空状态、创建任务、拖拽改状态；任务详情显示描述、Run 列表、日志、取消 | 浏览器实测 | 通过 | UI-011、UI-012、UI-013、UI-014、UI-025、UI-032、UI-035、UI-036、UI-037、TASK-063、FLOW-A-013、FLOW-A-017 |
| M0-AC-12 | Agents、Runs、Settings 页面 | Agent 列表与创建、Run 列表与跳转、Settings 健康检查 | Agents/Runs 浏览器实测；Settings 路由 + 代码审阅，未做浏览器验收 | 部分通过：Agents 与 Runs 通过；Settings 未做浏览器验收 | UI-058、UI-059、UI-060、UI-126 |
| M0-AC-13 | SPA 托管与深链接 | `GET /` 返回 200；非 API 路径回退 `index.html` | HTTP 冒烟 | 通过 | API-006 |
| M0-AC-14 | Wails 桌面壳 | 编译成功；启动后加载同一 Web UI | 编译 + 手工启动 | 编译通过；GUI 未在无头环境验证（D-M0-02） | NFR-PORT-006、UI-125（M1） |
| M0-AC-15 | 构建与 CI | `make build`、`go test`、`go vet`、`pnpm typecheck`、Web build 全部通过 | 本地执行 + CI 配置审阅 | 通过（本地）；CI 配置存在但本轮未在远端执行 | `non-functional-requirements.md` §5.1「分发与平台」、§14 里程碑映射；质量门逐项见 04 §7.1；M1 扩展 NFR-SEC-009、NFR-PORT-001 |
| M0-AC-16 | 安全边界与缺口标注 | 默认回环监听；请求体读取上限 1 MiB；CORS/WS Origin 缺口、无认证、路径/命令未强制执行在文档中明确标注 | 代码审阅 + 文档核对 | 通过（缺口已标注） | NFR-SEC-001、NFR-SEC-002（M1）、SEC-004（M1）、SEC-006（M1）、API-004（M1） |
| M0-AC-17 | 重启持久化 | 停止并重启服务后 Task、Agent、Run、RunEvent 仍可读；迁移不重复执行 | 重启测试 | 通过 | NFR-REL-008、API-063（M1 队列恢复） |
| M0-AC-18 | Runtime 失败可读 | claude CLI 不存在时 Run failed，错误明确；不得标为 completed；未知 Runtime 的 mock 回退在 M1 改为显式错误 | 代码审阅（未执行端到端故障注入） | 部分通过（仅代码审阅，D-M0-04；未知 Runtime 回退见 D-M0-18） | RUN-003（M1）、RUN-012、AGENT-011 |
| M0-AC-19 | 超时机制 | 调度器按 `timeoutMinutes` 设置 context 超时；超时不得标为 completed；当前无 timeout 分类与独立 errorCode | 代码审阅 + 可执行性说明（整数分钟、mock 约 1.4 秒） | 未验证（D-M0-13） | AGENT-014（M1 校验）、AGENT-015（M1）、RUN-005（M1） |
| M0-AC-20 | blocked/cancelled 任务边界 | API 与领域模型接受 blocked、cancelled；Board 只渲染五列，任务从看板消失；详情页状态选择器只覆盖五状态，UI 无法改回 | API 断言 + BoardView/TaskView 代码审阅 | 边界确认（已知缺口） | TASK-031（M1）、UI-018（M1）、FLOW-A-016（M1 补齐） |
| M0-AC-21 | 离线可用（PROD-001） | 断网时 Task/Agent CRUD 与 mock Run 可用；页面不引用外部资源 | 代码审阅（静态资源无外链、mock 无网络调用）；未执行断网走查 | 部分通过（代码审阅；未断网走查） | PROD-001、NFR-NET-001、NFR-NET-002（M1 正式验收） |
| M0-AC-22 | WebSocket 断线重连 | 连接关闭后客户端固定每 2 秒重连；重连后全量刷新；无连接状态提示 | 代码审阅 `useEventStream.ts`；未做断网实测 | 部分通过（代码审阅；未断网实测） | API-123、NFR-NET-006（M1）、UI-009（M1）、NFR-NET-007（M2） |

本表的映射规则：`关联需求` 只写 `prd/modules/*.md` 的模块 ID、`PROD-` 产品 ID 或带 `FLOW-` 前缀的流程 ID；`D-M0-` 是缺陷编号，只出现在结论列，不作为需求映射。凡无法在上述命名空间中找到归属的验收项，按关系规则 3 视为文档缺口，不得临时借用其他文档的同形编号。

### 6.2 工程验收标准

1. `make build` 退出码为 0，生成 `bin/ateam`、`bin/ateam-desktop` 与 `apps/web/dist`。
2. `go test $(go list ./... | grep -v '/apps/desktop')` 退出码为 0。
3. `go vet $(go list ./... | grep -v '/apps/desktop')` 退出码为 0。
4. `pnpm --filter @ateam/web typecheck` 退出码为 0。
5. `pnpm --filter @ateam/web build` 生成可被 Go 服务托管的静态资源。
6. CI 配置为在 push 到 main 与 pull request 时执行 Go 测试、vet、pnpm 安装、全仓 typecheck 与 Web 构建；本轮验收只审阅配置，未在 CI 远端执行，且 CI 不构建 `apps/desktop`（Q-M0-12）。
7. Go 代码使用 `gofmt`；Vue 使用 `script setup` 与 TypeScript、Composition API、Pinia 与类型化 API 客户端。
8. 第三方研究资料目录按仓库政策隔离，构建与产品实现不读取该目录。

### 6.3 安全与边界验收

M0 的安全结论必须按「已知缺口」验收，而不是按「已安全」验收：

- 默认监听 `127.0.0.1:8787`（NFR-SEC-001）；通过 `--addr` 暴露到局域网时没有认证，也没有 TLS，属于显式配置风险。
- CORS 反射任意 Origin；WebSocket 的 `CheckOrigin` 始终返回 true（NFR-SEC-002、SEC-004 为 M1 目标）。M1 必须改为允许列表与 Origin 校验。
- HTTP 请求体读取上限为 1 MiB（`io.LimitReader`）；超限时表现为 JSON 解码失败（400），不是 413。结构化 413 属于 M1 的 API-004、SEC-006。
- 没有登录、角色、权限、审计；所有本地调用者被视为同一 OS 用户。
- `allowedPaths`、`allowedCommands` 仅存储不执行；`maxConcurrency` 仅存储，调度器只使用全局 worker 数。
- Agent 进程以当前 OS 用户身份执行；运行中取消依赖 Go context，不保证终止整个进程组。
- 高风险动作没有系统级审批门；提示词中的「不推送、不合并、不部署」不是强制策略。

这些缺口不是 M0 的隐藏缺陷，而是必须在 M1/M2 偿还的安全债。M0 的验收要求是「缺口被记录且演示中明确说明」，不是「缺口不存在」。

### 6.4 判定规则与度量

**缺陷分级规则。** S0 为数据丢失、安全事故或不可恢复的启动失败；S1 为核心路径错误、状态错误，或阻塞下一里程碑的关键能力/质量缺口（如真实 Runtime、worktree 隔离、测试覆盖、安全基线）；S2 为体验或边界缺陷；S3 为文档、告警或低风险债务。M0 退出要求零 S0；S1 必须有明确修复计划与目标里程碑；S2/S3 可以进入 M1 待办。

**M0 观察值。** 本轮验收中：Mock Run 约 1.4 秒完成；Run 事件 6 条且 seq 连续；健康检查即时返回；构建、测试、vet、typecheck 全部通过；已复现 1 个 S1 状态错误（D-M0-01，见验收文档第 9.3 节）；另有 4 个 S1 能力/质量缺口（D-M0-03、D-M0-04、D-M0-05、D-M0-08）；本章摘录 5 个 S2（D-M0-02、D-M0-09、D-M0-10、D-M0-13、D-M0-18）与 2 个 S3（D-M0-14、D-M0-15）。完整清单共 24 项：S1 5 项、S2 13 项、S3 6 项，见 04 §9.3。以上是观察值，不是 M1 的性能目标；M1 的量化指标见 `prd/modules/non-functional-requirements.md`。

**结论口径。** M0 判定为「骨架完成、有条件通过」：主路径可演示，构建与测试可复现，已知缺陷已登记并明确归属 M1。任何将 M0 描述为「生产可用」「多 Agent 闭环已完成」「真实 Claude Code 已支持」的说法都不符合事实。

## 7. 演示脚本

### 7.1 演示目标与时长

演示脚本以 `prd/04-acceptance-and-test-plan.md` §4.1 为单一事实来源：主脚本、命令与计划 10 分钟时长以该节为准。本章 7.3–7.8 只保留 M0 特有的执行补充：演示隔离、浏览器细节、取消项处理、证据归档与失败判定；两处不一致时以 04 为准并回写本章。演示目标是证明本地服务可启动、Task 与 Agent 可创建、Mock Run 可完成、事件可观察、数据可持久化、桌面壳可加载；不涉及真实代码修改、diff、合并、部署与团队权限，也不包含稳定的运行中取消演示（见 7.4 第 8 步）。

### 7.2 环境准备

- macOS 或 Linux 开发机；M0 未在 Windows 上验证。
- Go 1.27+、Node 24+、pnpm 11+；桌面壳需要 Wails v3。
- 必须使用独立数据库、端口与临时 HOME：仅设置 `--db` 不会改变 workspace 根目录，Run 仍会写入 `~/.ateam/workspaces/runs/<runId>`（Q-M0-04）。演示前先确认 `~/.ateam` 中没有需要保留的数据。
- 不需要 API Key；mock Runtime 不访问网络。

### 7.3 命令行步骤

```bash
# 1. 安装前端依赖并构建（在未覆盖 HOME 的终端中执行）
make web-install
make build

# 2. 在演示终端内使用临时 HOME 与临时数据库启动服务
export HOME=/tmp/ateam-demo/home
mkdir -p "$HOME" /tmp/ateam-demo
./bin/ateam serve \
  --addr 127.0.0.1:8787 \
  --db /tmp/ateam-demo/ateam.db \
  --web apps/web/dist

# 3. 另一个终端验证健康检查
curl -s http://127.0.0.1:8787/api/health
```

预期：构建退出码为 0；健康检查返回 `status=ok` 与 `version=0.1.0-dev`；浏览器打开 `http://127.0.0.1:8787` 能看到 Board。

`HOME` 覆盖只影响当前演示终端：数据库默认路径与 workspace 根目录都会落到 `/tmp/ateam-demo/home/.ateam`，避免写入真实 `~/.ateam/workspaces`。演示结束后执行 `rm -rf /tmp/ateam-demo`。如果演示者不覆盖 HOME，则必须在每轮 Mock Run 后手动清理 `~/.ateam/workspaces/runs/<runId>`，并在演示记录中注明该污染风险。

### 7.4 浏览器演示步骤

1. 打开 `http://127.0.0.1:8787`，确认侧边栏包含 Board、Agents、Runs、Settings，Board 显示五列。
2. 点击 **New task**，标题填写「演示任务」，描述填写验收目标，状态选择 **Todo**，点击 **Create**。
3. 确认任务卡片出现在 Todo 列；把卡片拖到 In Progress，再拖回 Todo，刷新页面确认状态保留。
4. 进入 **Agents**，点击 **+ New agent**，名称填写「Mock 演示 Agent」，Runtime 保持 **Mock**，instructions 填写「按任务描述完成工作」，点击 **Create**。
5. 返回 Board，点击「演示任务」卡片，进入任务详情；确认 Agent 选择器默认选中「Mock 演示 Agent」。
6. 点击 **Run**，观察任务状态变为 In Progress，Run 卡片出现并最终变为 Completed，日志面板出现启动信息、四步 mock 日志与 summary。
7. 打开 **Runs** 页面，确认出现一条 Completed 记录，包含任务名、manual 触发方式、创建时间与 `Completed with mock runtime` 摘要。
8. 取消演示按 M0 边界处理：**(a) 终态取消幂等（必做）** 对已 Completed 的 Run 调用 `POST /api/runs/{id}/cancel`，确认返回原对象、状态仍为 Completed、无新事件；**(b) 运行中取消（非必过）** mock Run 四步共约 1.4 秒，没有稳定操作窗口，本章不把它列为演示必过项。M1 在 D-M0-01 修复后，用可配置步数与延迟的 mock 演示运行中取消与排队取消，不得在 M0 用排队取消做演示。
9. 刷新页面，确认任务、Agent 与 Run 数据仍在。

### 7.5 桌面壳步骤

```bash
make dev-desktop
```

预期：Wails 启动本地随机端口服务并打开 1440×900 窗口，加载与浏览器相同的 Web UI；无白屏与跨域错误。关闭窗口后进程退出，不残留后台服务。该步骤应在与 7.3 相同的演示终端中执行，使桌面壳复用临时 HOME；否则它会写入真实 `~/.ateam`，污染日常数据。

### 7.6 重启持久化步骤

1. 在终端按 Ctrl+C 停止 `bin/ateam serve`。
2. 使用同一 `--db /tmp/ateam-demo/ateam.db` 重新启动服务。
3. 刷新浏览器，确认 Task、Agent、Run 与 RunEvent 仍可读取。
4. 直接查询 `/api/runs` 与 `/api/runs/{id}/events`，确认事件 seq 不变。

### 7.7 预期结果与失败判定

| 演示项 | 通过标准 | 失败判定 |
|---|---|---|
| 构建 | `make build` 退出码 0，生成两个二进制与 Web 资源 | 任一构建失败或前端资源缺失 |
| 健康检查 | `status=ok`，版本号存在 | 非 200、超时或字段缺失 |
| Board | 五列、空状态、侧边栏与创建按钮正常 | 白屏、路由错误、控制台报错 |
| Task 创建 | 201 创建，卡片出现在所选列，刷新后仍在 | 创建失败、卡片不出现、刷新丢失 |
| Agent 创建 | 列表出现名称、runtime、并发、超时、工作区模式 | 表单提交失败或字段缺失 |
| Mock Run | queued 到 completed，约数秒内完成，summary 可读 | 卡在 running、失败、事件不连续 |
| 事件流 | seq 连续，log 与 summary 可区分 | 事件缺失、乱序或页面不刷新 |
| 终态取消幂等 | 对已 completed 的 Run 调用 cancel，返回原对象，状态仍为 completed，无新事件 | 状态被改写或返回错误 |
| 运行中取消 | 非 M0 演示必过项：mock Run 约 1.4 秒，无稳定操作窗口；M1 用确定性慢速 mock 验证 | 未演示不判失败，但不得宣称已稳定通过 |
| 重启持久化 | 数据与事件仍可读，迁移不重复 | 数据丢失或迁移重复执行 |
| 桌面壳 | 窗口加载同一 UI，无白屏 | 启动失败、白屏、跨域错误 |

任一项失败即判定该演示项失败，必须登记缺陷；不允许用「mock 环境问题」或「演示机器问题」跳过。若失败项属于已知缺陷，应在演示前明确说明，并在演示记录中引用缺陷编号。运行中取消、超时、离线走查与 WebSocket 断线重连在 M0 属于「未演示/未验证」项，演示记录必须标注原因，不得用其他项的通过结果替代。

### 7.8 证据归档

- 保存 `make build`、`go test`、`go vet`、`pnpm typecheck` 的完整输出与退出码。
- 保存健康检查 JSON、Run 详情 JSON、Run 事件 JSON。
- 保存 Board、Task 详情、Run 日志、Runs 列表、重启后列表的截图。
- 保存演示环境信息：OS 版本、Go 版本、Node 版本、pnpm 版本、Wails 版本、执行时间。
- 证据文件不进入 Git；如需归档，放在仓库外的验收目录，并在验收记录中引用路径。
- 演示记录必须注明已知缺陷 D-M0-01、D-M0-02、D-M0-13、D-M0-18 与 M0 的「有条件通过」结论，并记录 workspace 清理结果（临时 HOME 目录已删除，或真实 HOME 下无演示 Run 残留）。

## 8. 依赖

### 8.1 技术依赖

| 依赖 | 版本或范围 | 用途 | 风险与约束 |
|---|---|---|---|
| Go | 1.27+ | Go 核心、CLI、桌面主进程 | 版本升级可能影响 Wails 与 SQLite 驱动 |
| Wails v3 | v3.1.0 | 桌面壳 | v3 仍在演进，打包与平台差异属于 M4 风险 |
| modernc.org/sqlite | v1.62.0 | 纯 Go SQLite 驱动 | 迁移按分号切分，复杂 SQL 需要改进 |
| gorilla/websocket | v1.5.3 | WebSocket Hub | 当前不校验 Origin，M1 修复 |
| Node | 24+ | Vue/Vite 构建 | 需要与 pnpm 版本匹配 |
| pnpm | 11+ | monorepo 包管理 | lockfile 必须提交并冻结安装 |
| Vue | 3.5.x | Web UI | 使用 Composition API 与 TypeScript |
| Vite | 8.x | 开发服务器与构建 | 代理 `/api` 与 WebSocket 到 Go 服务 |
| Pinia | 3.x | 前端状态 | 当前收到事件后全量刷新，M1 增量更新 |
| Tailwind CSS + Element Plus + AI Elements Vue | Tailwind 4.x / Element Plus 2.x / AI Elements Vue 1.x | 原子化样式、通用组件与 AI 对话组件 | 主题 Token 在 `src/styles/main.css`；AI 组件在 `src/components/ai-elements` |
| TypeScript | 5.9.x | 类型检查 | `pnpm -r typecheck` 是质量门 |
| Git 与本地文件系统 | 本机 | M1 之前的 Workspace 只是目录；M1 才需要 Git | M0 不要求演示仓库是 Git 仓库 |
| Claude Code CLI | 用户自装 | claude 适配器 | 仅最小 `claude -p`；认证、模型与权限参数属于 M1 |

### 8.2 工程与流程依赖

- Makefile 必须保持 `help`、`dev-server`、`dev-web`、`dev-desktop`、`web-install`、`web-build`、`build`、`test`、`fmt`、`tidy`、`clean` 可用。
- CI 依赖 GitHub Actions 的 `actions/checkout`、`actions/setup-go`、`pnpm/action-setup`、`actions/setup-node`。
- 贡献流程依赖 DCO 与 clean-room 声明；任何贡献不得包含第三方产品的代码、文档、截图、图标或品牌资产。
- 文档流程依赖 PRD 的模块文档与里程碑文档同步更新；M0 的能力变化必须回写本章与 `README.md`。

### 8.3 里程碑依赖

M0 不依赖 M1-M4；它是所有后续里程碑的前置。反过来：

- M1 依赖 M0 的领域模型、SQLite、REST/WS、Scheduler、Runtime Adapter、Workspace 概念与 Vue 壳。
- M2 依赖 M1 的 worktree、diff、Artifact/Evidence 与人工评审门，再叠加任务 DAG、交付物契约、角色模板与审批门。
- M3 依赖 M2 的权限与审批语义，再引入 Postgres、登录、远程 Runner、机器注册与审计。
- M4 依赖前三者的稳定性，再做打包、自动更新、自动化与插件 API。

### 8.4 外部依赖与降级

- mock Runtime 不依赖网络与外部 CLI，是 M0 演示与 CI 的默认路径；代码层面满足 PROD-001 的断网描述，但本轮未做断网走查（M0-AC-21）。
- 超时依赖 Go context 与 `timeoutMinutes`；mock Run 约 1.4 秒结束，M0 无法触发分钟级超时，属于「机制存在、未验证」（D-M0-13），不得写成已通过。
- claude Runtime 依赖用户本机 CLI 与登录状态；CLI 缺失或退出码非零时 Run 必须 failed，不得伪装成功。该失败路径在 M0 只有代码审阅证据（D-M0-04）。
- Wails 桌面壳依赖平台 WebView；M0 只验证编译与手工启动，打包与签名在 M4。
- 若桌面壳不可用，Web UI 必须能独立运行，这是「渐进式采用」的底线。

## 9. 风险与已知缺陷

### 9.1 风险登记

| 风险编号 | 风险描述 | 对 M0 的影响 | 可能性 | 缓解措施 | 预警信号 |
|---|---|---|---|---|---|
| RISK-T-001 | Runtime CLI 行为变化与适配脆弱 | claude 适配器可能随时失效；mock 不受影响 | 中 | 明确标注 claude 为实验性；M1 做契约测试与版本探测；未知 Runtime 改显式报错 | CLI 升级后 Run 失败率骤升 |
| RISK-T-002 | worktree 与合并冲突 | M0 未实现，不直接受影响；但会把复杂度推到 M1 | 中 | M1 早期验证 monorepo、子模块、LFS；记录不支持场景 | M1 worktree 创建失败或磁盘暴涨 |
| RISK-T-003 | 长任务稳定性、取消竞态与崩溃恢复 | 排队取消缺陷已复现；进程退出后 running Run 悬挂 | 高 | M1 首迭代修复 D-M0-01；启动对账；取消收敛与回归用例 | 取消后仍执行、Run 永久 running |
| RISK-T-004 | 跨平台 WebView 与桌面壳 | M0 只在 macOS 验证；Windows/Linux 未验证 | 中 | Web UI 可独立运行；M4 前做三平台打包 spike | 桌面壳白屏、链接警告增多 |
| RISK-S-002 | 本地 API 暴露面 | CORS 反射任意 Origin、WS 放行任意来源、无认证 | 中 | 默认回环；M1 加允许列表与 Origin 校验；M2.1 加本地会话令牌 | 出现非本机访问或异常 Origin |
| RISK-S-005 | 开源合规与 clean-room | 若误引用第三方资料，项目信任受损 | 低-中 | 第三方研究资料隔离；贡献者声明；代码审查与 NOTICE | 贡献中出现可疑复制内容 |
| RISK-P-001 | 范围蔓延 | M0 被要求提前做完整项目管理套件、集成或移动端，拖慢 M1 | 高 | 严格执行第 2.2 节非目标；范围变更走 PRD 流程 | 路线图出现大量非核心集成 |
| RISK-T-006 | 任意命令执行与提示注入 | M0 以当前用户身份执行，提示词规则不是强制 | 中 | M1 起逐步引入路径/命令策略；M2 强制执行 | Agent 访问未授权路径或执行危险命令 |

### 9.2 已知缺陷与工程债

| 缺陷编号 | 等级 | 摘要 | 对 M0 结论的影响 | 处理阶段 |
|---|---|---|---|---|
| D-M0-01 | S1 | 排队中的 Run 被取消后仍会被调度执行，最终状态被覆盖为 completed，error 仍保留 `run cancelled` | 不阻塞骨架演示，但阻塞 M1 闭环；M0 为有条件通过 | M1 首迭代 |
| D-M0-02 | S2 | Wails 桌面窗口未在无头环境实际启动验证，只验证编译 | 桌面验收需手工补测 | M1 手工验收 |
| D-M0-03 | S1 | 除 Store 生命周期外，没有 Scheduler、Workspace、Runtime、API、WebSocket 的自动化测试 | 测试覆盖不足以支撑 M1 回归 | M1 |
| D-M0-04 | S1 | 真实 Claude Code adapter 未做端到端验证，只支持 `claude -p` | claude 只能标注为实验性 | M1 |
| D-M0-05 | S1 | `workspaceMode` 被保存但未生效；每个 Run 只是普通目录，branch 为空 | 不阻塞 Mock 演示，阻塞真实编码任务 | M1 |
| D-M0-08 | S1 | CORS 反射任意 Origin，WebSocket `CheckOrigin` 恒为 true | 回环默认降低风险，但不能对外监听 | M1/M3 |
| D-M0-09 | S2 | 无崩溃恢复；进程退出时 running/preparing Run 不会标记中断，queued Run 不会恢复 | M1 必须补启动对账 | M1 |
| D-M0-10 | S2 | 列表接口无分页与筛选 | 数据量增大后性能未验证 | M1 |
| D-M0-13 | S2 | 超时语义未验证；取消与超时、Runtime 失败的优先级未定义；超时统一归为 failed，无 timeout 分类 | 2.1、5.3、M0-AC-19 均按「机制存在、未验证」处理，PROD-015 不计入 M0 完整交付 | M1 |
| D-M0-14 | S3 | 桌面构建出现 macOS 部署目标链接器警告 | 不影响运行，影响打包质量 | M1/M4 |
| D-M0-15 | S3 | 数据库迁移按分号简单切分 SQL，未来包含分号的语句会失败 | 迁移机制需要更稳健 | M1 |
| D-M0-18 | S2 | 未知 Runtime 静默回退到 mock，可能把错误配置显示为成功 | 4.1 US-M0-09、6.1 M0-AC-18 与 11.2 均要求 M1 改为显式报错 | M1 |

摘录标准：只列对 M0 结论或 M1 输入有直接影响的项目。本章表内共 5 个 S1（D-M0-01、D-M0-03、D-M0-04、D-M0-05、D-M0-08）、5 个 S2（D-M0-02、D-M0-09、D-M0-10、D-M0-13、D-M0-18）与 2 个 S3（D-M0-14、D-M0-15）。完整清单见 `prd/04-acceptance-and-test-plan.md` 第 9.3 节，共 24 项：S1 5 项、S2 13 项、S3 6 项；未摘录的 D-M0-06、D-M0-07、D-M0-11、D-M0-12、D-M0-16、D-M0-17、D-M0-19、D-M0-20、D-M0-21、D-M0-22、D-M0-23、D-M0-24 同样以 04 为准。M0 文档不替代验收文档。

### 9.3 风险对 M0 结论的影响

M0 的最大风险不是「mock 跑不通」，而是「骨架被误当成产品」。如果团队或外部用户把 M0 当作可用的多 Agent 开发环境，就会在没有 worktree、diff、证据、审批的情况下把真实任务交给 Agent，导致代码污染、无法评审、无法追溯。因此本章把「非目标」「已知缺口」「有条件通过」放在显眼位置，并要求 README、演示与对外说明保持一致。

第二个风险是取消与超时语义。D-M0-01 说明「API 状态」和「调度器执行」之间缺少取消检查；D-M0-13 说明超时只有机制接线，M0 既无法实际触发，也没有 timeout 分类。M1 必须把取消与超时当作执行状态机的一部分，而不是只在数据库上改一个字段。否则 M1 的 worktree 与证据都会建立在不可靠的执行记录上。

第三个风险是安全边界。M0 的本地回环默认降低了暴露面，但 CORS 与 WebSocket 的宽松策略意味着一旦用户用 `--addr` 暴露到局域网，API 就没有认证保护。M1 必须在引入真实 Runtime 之前关闭这个缺口，不能等到 M3 团队模式。

### 9.4 风险缓解责任与复审

- 产品负责人：确认 M0 范围不被扩张，确认「有条件通过」口径对外一致，决定 M0 是否打标签或发布开发者预览。
- 工程负责人：修复 D-M0-01、D-M0-03、D-M0-04、D-M0-05、D-M0-08，补齐启动对账与测试覆盖。
- 安全评审：复核 CORS、WebSocket、命令执行与提示注入风险，签署 M1 的安全门槛。
- 测试负责人：在 M1 开始前建立回归用例，至少覆盖排队取消、运行取消、超时（D-M0-13）、失败与重启恢复。
- 文档负责人：保持 README、PRD、验收记录与当前代码一致；发现冲突时以代码与验收文档为准并回写。

## 10. 退出标准

### 10.1 已完成项

| 退出项 | 状态 | 证据 |
|---|---|---|
| Monorepo 可构建 | 已完成 | `make build` 退出码 0，生成两个二进制与 Web 资源 |
| Go 测试与 vet | 已完成 | 测试与 vet 全部通过；仅 Store 有测试 |
| 前端类型检查与构建 | 已完成 | `vue-tsc --noEmit` 与 Vite 构建通过 |
| SQLite 持久化 | 已完成 | 四张表、迁移、WAL；重启后数据仍在 |
| Task/Agent CRUD | 已完成 | API 冒烟与浏览器实测 |
| Run 创建与 Mock 执行 | 已完成 | queued 到 completed，约 1.4 秒，6 条事件 |
| 事件持久化与 WebSocket | 已完成 | 事件 API 与事件抓包；断线重连仅代码审阅 |
| Vue 看板与任务详情 | 已完成 | 浏览器实测 |
| Wails 桌面壳可编译 | 已完成（编译） | `bin/ateam-desktop` 生成；GUI 手工验证待补 |
| CI 配置 | 已完成（配置） | GitHub Actions 覆盖 Go 与 Web；本轮未在远端执行，且不构建桌面壳 |
| 文档与状态标注 | 已完成 | README 与 PRD 明确 M0 边界 |
| 已知缺陷登记 | 已完成 | 验收文档第 9.3 节与本章第 9.2 节 |

### 10.2 未完成项

| 未完成项 | 当前状态 | 目标里程碑 | 是否阻塞 M1 |
|---|---|---|---|
| git worktree 与分支隔离 | 只有普通目录，branch 为空 | M1 | 是 |
| diff 评审与合并 | 无 | M1 | 是 |
| Artifact/Evidence | 无数据模型与界面 | M1 | 是 |
| 真实 Claude Code 流式适配 | 最小 `claude -p` | M1 | 是 |
| 排队中取消语义 | 已复现缺陷 D-M0-01 | M1 首迭代 | 是 |
| 崩溃恢复与启动对账 | 无 | M1 | 是 |
| 配置快照 | Run 不保存 Agent 配置快照 | M1 | 是 |
| 自动化测试覆盖 | 仅 Store 生命周期 | M1 | 是 |
| 超时语义与验证路径 | 仅 context 接线；整数分钟、mock 约 1.4 秒，无法触发（D-M0-13） | M1 | 否（但阻塞 PROD-015 完整交付） |
| blocked/cancelled 看板可见性 | API 支持，Board 仅五列，UI 无法恢复（TASK-031、UI-018） | M1 | 否 |
| 离线断网走查 | 代码审阅通过，未实际断网验证 | M1 | 否 |
| WebSocket 断线重连实测与状态提示 | 固定 2 秒重连，无状态横幅（NFR-NET-006 为 M1，NFR-NET-007 为 M2，UI-009 为 M1） | M1/M2 | 否 |
| 登录、权限、审计 | 无 | M3 | 否（M1/M2 单用户） |
| 远程 Runner、机器注册 | 无；`ateam runner` 为占位 | M3 | 否 |
| 打包、自动更新、插件 API | 无 | M4 | 否 |
| 角色 Agent 协作 | 无 DAG、契约、审批门 | M2 | 否 |
| 路径与命令权限强制执行 | 字段仅存储 | M2 | 否 |

### 10.3 退出判定

M0 的退出判定为 **有条件通过**，判定依据如下：

1. 第 10.1 节的已完成项全部有可复现证据。
2. 没有 S0 缺陷；D-M0-01 是唯一已复现的 S1 状态错误，已被明确分配至 M1 首迭代，并有回归用例要求；其余 S1 为能力与质量缺口（D-M0-03、D-M0-04、D-M0-05、D-M0-08），均有目标里程碑。
3. M0 的非目标、已知缺口与「不可用于生产」的结论在 README、PRD 与演示脚本中一致。
4. 演示脚本可以完整跑通 Mock 闭环、浏览器操作、重启持久化与桌面壳加载；运行中取消不属于 M0 演示必过项，桌面 GUI 需在 M1 手工补测。
5. 产品、工程与测试负责人接受「骨架完成、产品未完成」的口径。

**与 01 §4.2.4 的差异。** `prd/01-scope-and-roadmap.md` §4.2.4 写「M0 的结论是：骨架验收通过」，并把「Wails 桌面壳可以打开窗口并加载同一套 UI」列为 M0 必须项。本章与 04 §9.4 的结论是「有条件通过」，且桌面 GUI 未验证（D-M0-02）。该差异以本章与 04 §9.4 为准；应在 M0 关闭前回写 01 §4.2.4，把桌面壳项改为「部分验收、M1 手工补验」，或把结论改为「有条件通过」。在回写完成前，任何引用 01 该节的演示或对外说明都必须同时声明这一差异。

M0 不满足以下任一条件时不得退出：存在未登记的 S0/S1 缺陷；构建或类型检查失败；演示中把 mock 结果描述为真实编码结果；把 M0 描述为可发布版本。

### 10.4 关闭条件

M0 的正式关闭需要补齐以下行政与工程动作：

- 确认仓库的首个 commit、版本号与发布标签策略；当前代码版本为 `0.1.0-dev`，仓库尚未建立正式发布标签。
- 归档一次完整的演示记录与浏览器截图，并附上构建、测试、健康检查、事件与重启证据。
- 在 `README.md`、`prd/00-product-overview.md`、本章与 `prd/04-acceptance-and-test-plan.md` 之间完成一次状态口径核对，确保没有「已实现」与「计划」互相矛盾。
- 回写 `prd/01-scope-and-roadmap.md` §4.2.4 的 M0 结论与桌面壳项（见 10.3），并完成 Q-M0-10 的文档命名与交叉引用核对：模块文件名、里程碑文件名（尤其 `M4-automation-and-packaging.md`）与总览文档地图必须使用仓库真实文件名。

### 10.5 度量与观察结果

M0 不承诺生产级指标，只记录骨架可用性的观察值：构建成功率为 100%（本轮验收）；Mock Run 完成时间约 1.4 秒；Run 事件 6 条且 seq 连续；健康检查即时返回；浏览器主路径无控制台阻塞错误；重启后数据保留；S1 缺陷 5 项（1 项已复现状态错误 + 4 项能力/质量缺口）；S2 13 项、S3 6 项。超时、离线走查、WebSocket 断线重连未进入行为验证，blocked 任务可见性是已确认的边界。上述观察值用于判断骨架是否值得进入 M1，不作为性能 SLA。

## 11. 对 M1 的输入

### 11.1 可复用的资产

- 领域模型与状态枚举：Task、Agent、Run、RunEvent；M1 在其上增加 Workspace、Artifact、Evidence、Review 等实体，不推翻已有对象。
- Store 接口与 SQLite 迁移机制：M1 增加新表与新迁移，保持 `schema_migrations` 记录方式。
- REST 路由风格与错误结构：M1 扩展 `/api` 资源时保持 JSON 错误与状态码约定，版本化策略由 API 模块文档定义。
- WebSocket 事件 envelope：`type`、`data`、`at`；M1 增加事件游标与重放时保持兼容。
- Scheduler 的队列、worker、context 超时与取消表：M1 修复取消竞态后继续使用，不另起执行框架。
- Runtime Adapter 接口与 Registry：M1 增加真实 Claude Code 适配器与能力声明，不修改领域模型。
- Workspace Manager：M1 将 `Prepare` 从普通目录升级为 git worktree，并填充 branch、base SHA、head SHA。
- Vue 页面外壳、Pinia Store、API Client 与共享类型：M1 增加 diff、证据、评审页面时复用导航与数据层。
- CI、Makefile、PRD 文档与验收记录：M1 在同一质量门上扩展测试矩阵。

### 11.2 必须在 M1 首迭代修复的缺陷

1. D-M0-01：排队中的 Run 取消后不得执行；调度器执行前必须检查 Run 状态；新增「取消后等待超过原执行时长仍为 cancelled 且事件不增加」的回归用例。
2. D-M0-08：CORS 使用允许列表；WebSocket 校验 Origin；默认回环之外的监听必须有显式风险提示与会话保护。
3. 未知 Runtime 回退 mock 的静默行为：M1 改为显式错误，避免 Agent 配置错误被掩盖。
4. Workspace 根目录与 `--db` 解耦：提供独立的 `--data-dir`（或 workspace 根目录配置）；`--db` 只控制数据库，测试与演示必须能预测工作区落点。
5. 运行中取消的进程组终止：确保 Claude CLI 派生的子进程不残留；明确取消、超时、Runtime 失败的优先级。
6. 崩溃恢复：启动时把 preparing/running 的遗留 Run 标记为中断，并给出可读原因。
7. 配置快照：Run 记录本次使用的 Agent 配置与提示词版本，避免 Agent 编辑影响历史 Run 的解读。
8. 演示确定性：mock Runtime 支持可配置步数与每步延迟（仅用于开发、演示与回归），用于稳定演示运行中取消与超时；在 D-M0-01 修复前不得用排队取消做演示。
9. 超时验证路径：提供短超时测试配置或注入式时钟，覆盖 timeout 分类、errorCode 与日志保留（D-M0-13、AGENT-015、RUN-005）。

### 11.3 需求与验收输入

M1 的范围、用户故事、FR 与验收标准由以下文档提供，本章不重复展开：

- `prd/01-scope-and-roadmap.md` 第 4.3 节：M1 目标用户结果与范围。
- `prd/02-domain-model.md`：Workspace、Artifact、Evidence、Review 的实体与状态机。
- `prd/03-user-flows.md` 流程 A 与流程 E：单 Agent 本地闭环、失败/取消/重试/阻塞。
- `prd/04-acceptance-and-test-plan.md` 第 4.2 节：M1 验收标准与演示脚本；第 5 节：测试矩阵。
- `prd/modules/runtime-and-workspace.md`：RUN、WORK 前缀需求，worktree、diff、Artifact/Evidence、取消与超时。
- `prd/modules/ui-ux.md`：diff 评审、证据面板、Run 详情与错误状态。
- `prd/modules/security-and-permissions.md`：合并审批、本地 API 边界、密钥处理。
- `prd/modules/api-and-data.md`：新增端点、事件版本与迁移策略。
- `prd/modules/non-functional-requirements.md`：M1 的性能、可靠性与质量门指标。

### 11.4 不应继承的临时行为

以下行为是 M0 的临时实现，M1 不得将其当作长期契约：

- 收到任何 task/agent/run 事件后全量刷新列表；M1 改为增量更新，保留全量刷新作为恢复手段。
- 任务详情对活跃 Run 每 1.5 秒轮询；M1 应以 WebSocket 事件为主，轮询作为兜底。
- API 取消立即把 Run 标记为 cancelled，而调度器仍可能执行；M1 统一由状态机裁决。
- 未知 Runtime 静默回退 mock；M1 显式报错。
- `workspaceMode` 字段被忽略；M1 必须生效并参与校验。
- 只限制全局 worker 数，不限制每 Agent 并发；M1/M2 按模块文档执行。
- 提示词中的高风险动作规则只是文本；M1 起合并必须系统级审批。
- 列表接口无分页与筛选；M1 按 API 模块文档补充分页。
- 数据库迁移按分号简单切分；M1 改为更稳健的 statement 解析或迁移工具。

### 11.5 M1 演示的最低要求

M1 演示的最低要求由 `prd/milestones/M1-local-loop.md` 与 `prd/04-acceptance-and-test-plan.md` §4.2 定义，本章不重复。只补充 M0 的差异输入：M1 不得继续以 mock 为主路径；运行中取消与超时必须使用确定性路径演示（11.2 第 8、9 条），不能用 M0 的 1.4 秒 mock 窗口或未验证的超时机制充数。

## 与其他文档的关系

本章是 PRD 的进度层文档，向下引用模块需求，向上对齐路线图与验收文档。文档关系如下：

| 文档 | 关系 |
|---|---|
| `prd/00-product-overview.md` | 定义产品愿景、用户、JTBD、价值主张、原则与 PROD 需求；本章的 M0 能力与边界必须与其第 10、14 节一致。 |
| `prd/01-scope-and-roadmap.md` | 定义产品范围、里程碑顺序与发布标准；本章引用其 M0 目标、已知缺口与退出标准，不重复路线图全文。其 §4.2.4 的「骨架验收通过」与桌面壳必须项和本章 §10.3 的「有条件通过」存在差异，以本章与 04 §9.4 为准并回写 01。 |
| `prd/02-domain-model.md` | 定义实体、字段、状态机与里程碑矩阵；本章的 Task、Agent、Run、RunEvent 描述以其为准。 |
| `prd/03-user-flows.md` | 定义流程 A 至 F；本章的用户故事对应流程 A（单 Agent 本地闭环）与流程 E（失败、取消、重试、阻塞），验收映射引用 `FLOW-A-xxx` 编号。03 已停用 TASK-/RUN-/AGENT- 等旧前缀，本章引用流程时不得省略 `FLOW-` 命名空间。 |
| `prd/04-acceptance-and-test-plan.md` | 定义 M0-M4 的验收标准、演示脚本、测试矩阵与 M0 已验证/未验证项；本章第 4、6、10 节以其第 4.1、9 节为证据来源，第 7 节的演示主脚本以其 §4.1 为单一事实来源，不重复全部测试用例。 |
| `prd/05-risks-and-open-questions.md` | 定义风险编号、假设与开放问题；本章第 9 节引用 RISK-T、RISK-S、RISK-P 编号，不重复风险全文。 |
| `prd/modules/task-management.md` | 定义 Task 字段、状态机、看板、详情与 TASK 需求；本章只引用 TASK-001、TASK-003、TASK-004、TASK-020 至 TASK-023、TASK-031、TASK-053、TASK-062、TASK-063、TASK-120，不重复字段与流转全文。 |
| `prd/modules/agent-system.md` | 定义 Agent 配置、默认值、指令、权限字段与 AGENT 需求；本章只引用 AGENT-001、AGENT-002、AGENT-003、AGENT-007、AGENT-008、AGENT-011、AGENT-014、AGENT-015、AGENT-024。 |
| `prd/modules/runtime-and-workspace.md` | 定义 Run 生命周期、Scheduler、Runtime Adapter、Workspace、Artifact/Evidence 与 RUN/WORK 需求；本章的 Run、Worker、workspace 行为以其为准。 |
| `prd/modules/collaboration-and-review.md` | 定义角色 Agent、任务 DAG、交付物契约、审批门与 COLLAB 需求；本章第 2.3、2.4 节只声明边界，不展开 M2 设计。 |
| `prd/modules/ui-ux.md` | 定义 Board、Task、Run、Agents、Runs、Settings 的界面与 UI 需求；本章只引用与 M0 直接相关的条目：UI-001 至 UI-003、UI-011 至 UI-014、UI-025 至 UI-028、UI-032 至 UI-037、UI-058 至 UI-060、UI-126；UI-004、UI-005、UI-009、UI-018、UI-125 属于 M1/M2，只在说明差距时引用。 |
| `prd/modules/api-and-data.md` | 定义 REST、WebSocket、错误模型、SQLite 与 API 需求；本章的端点、事件与持久化以其为准。 |
| `prd/modules/security-and-permissions.md` | 定义信任模型、权限、审批、审计与 SEC 需求；本章第 6.3 节的安全缺口引用其结论。 |
| `prd/modules/non-functional-requirements.md` | 定义性能、可靠性、可移植性、可观测性与 NFR 需求；本章只记录 M0 观察值，不替代 NFR 目标。 |
| `prd/milestones/M1-local-loop.md` 至 `M4-automation-and-packaging.md` | 分别定义后续里程碑的目标、范围、交付物与退出标准；本章第 11 节只给出 M1 输入，不重复 M1 全文。文件名以仓库实际文件为准，尤其 `M4-automation-and-packaging.md` 不得简写为 `M4-automation.md`。 |

关系规则：

1. 模块文档定义「做什么、字段是什么、交互与边界是什么」；本章定义「M0 何时算完成、如何验收、如何演示」。
2. 本章不得削弱模块文档中的必须要求；如果 M0 现状与模块目标冲突，以模块目标为计划方向，以本章记录的现状为事实基线。
3. 本章的验收标准必须能映射到模块需求编号（只来自 `prd/modules/*.md`）或流程编号（`FLOW-<流程>-<序号>`，来自 `prd/03-user-flows.md`）；两种编号不得混用。无法映射的验收项应视为文档缺口并在评审中补齐，不得临时借用其他文档的同形前缀。
4. 发现文档之间的状态冲突时，以仓库代码和 `prd/04-acceptance-and-test-plan.md` 第 9 节为事实来源，并同步修订其他文档。
5. 本章只描述 M0，不把 M1-M4 的能力写成已实现；后续里程碑文档应引用本章的资产与教训，而不是复制本章全文。

## 待确认/未文档化

以下事项是 M0 阶段真实存在、尚未最终拍板的开放问题。它们不影响 M0 作为骨架退出，但必须在 M1 规划或 PRD 评审前关闭：

| 编号 | 待确认事项 | 当前状态 | 影响 | 最晚决策点 |
|---|---|---|---|---|
| Q-M0-01 | M0 是否发布开发者预览标签，版本号如何命名 | 当前版本为 `0.1.0-dev`；仓库尚未建立正式发布标签 | 影响对外沟通、下载方式与升级路径 | M1 开始前 |
| Q-M0-02 | 排队中 Run 的取消语义 | 当前实现会先把数据库状态改为 cancelled，但调度器执行前不检查；已复现 D-M0-01 | 影响 Run 状态机、测试用例与用户预期 | M1 首迭代 |
| Q-M0-03 | M0 的 claude 适配器是否对外称为「已支持」 | 当前只有最小 `claude -p`，未做端到端验证 | 影响 README、演示与用户信任 | M1 规划前 |
| Q-M0-04 | Workspace 根目录是否应跟随 `--db` 或独立配置 | 当前 `--db` 只改数据库，workspace 仍在 `~/.ateam/workspaces` | 影响测试隔离、多项目与磁盘管理 | M1 开发前 |
| Q-M0-05 | `blocked` 与 `cancelled` 是否在 Board 提供列或筛选 | 领域模型与 API 支持，但 Board 只渲染五列 | 影响任务可见性与 M1 状态治理 | M1 界面设计前 |
| Q-M0-06 | 界面文案语言与 i18n 策略 | 当前界面文案为英文，产品文档为简体中文；存在中英混用 | 影响所有页面验收、截图基线与国际化成本 | M1 界面开发前 |
| Q-M0-07 | 桌面壳 GUI 的手工验收责任人与环境 | 当前只验证编译，未在无头环境启动 GUI（D-M0-02） | 影响 M0 桌面交付的最终结论 | M1 首次手工验收 |
| Q-M0-08 | M0 数据库是否承诺向后兼容 | 当前定位为开发与演示数据，允许 M1 重建 | 影响迁移成本、用户数据保留与导出功能 | M1 数据迁移设计前 |
| Q-M0-09 | M1 的测试覆盖基线与质量门阈值 | 当前仅 Store 生命周期测试；无覆盖率、lint、E2E | 影响 M1 回归能力与发布准入 | M1 规划前 |
| Q-M0-10 | 全 PRD 的文档命名与交叉引用口径核对 | 实际文件使用 `task-management.md`、`agent-system.md` 等描述性文件名；本章曾把 `M4-automation-and-packaging.md` 简写为 `M4-automation.md`（已修正）；M3 与 M4 里程碑文档中仍存在对 `01-task.md` 等编号文件名的引用（见 M3 §16、Q-M4-22）；00 文档地图需在关闭前核对为真实文件名 | 影响交叉引用、搜索与维护成本 | PRD 评审时 |
| Q-M0-11 | 运行中取消是否必须终止整个进程组 | 当前依赖 Go context，不保证子进程树全部终止 | 影响 Claude CLI 残留、资源占用与 M1 取消测试 | M1 开发前 |
| Q-M0-12 | M0 是否需要在 CI 中构建桌面壳 | 当前 CI 只构建 Web 与 Go 服务，不构建 `apps/desktop` | 影响桌面回归与 Wails 升级风险 | M1 CI 调整时 |
| Q-M0-13 | M0 的验收截图与演示记录是否进入仓库 | 当前建议放在仓库外，避免二进制与临时数据入库 | 影响证据可追溯性与仓库体积 | M0 关闭时 |
| Q-M0-14 | M1 是否引入显式 Workspace 实体（已裁决） | 当前所有数据属于隐式默认 Workspace；M1 建 `workspaces` 表并回填，默认 ID `default` | 影响多项目、权限与数据隔离 | 已关闭 |

上述问题关闭前，实现应选择可逆方案，不把未决假设固化到数据模型或对外承诺中。已确认的决策应回写本章、对应模块文档与 `prd/04-acceptance-and-test-plan.md`，并在下一次 PRD 评审中复核。
