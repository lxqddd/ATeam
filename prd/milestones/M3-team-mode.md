# 里程碑 M3：团队模式

## 本章导读

本章定义 ATeam M3「团队模式」的目标、范围、用户故事、功能需求、交付物、演示脚本、依赖、风险与退出标准。M3 要回答的问题是：一个 2-10 人的小团队，能否在保留本地优先的前提下，共享 Task、Agent、Machine 与 Audit，并通过登录、角色权限、远程 Runner、机器注册、共享 Agent、审计与 GitHub PR 形成可追溯的团队协作闭环？

阅读本章前必须建立一个事实前提：截至本文档编写时，仓库只完成 M0 骨架——Go 核心、SQLite、REST/WebSocket API、Mock Runtime、Vue 看板与 Wails 桌面壳可用；M1 的 git worktree、diff 评审、Artifact/Evidence、真实 Claude Code 流式适配与合并没有实现；M2 的任务依赖 DAG、交付物契约、角色 Agent 模板、路径/命令权限、审批门、Crew、收件箱、技能与模板也没有实现。因此，本章中的 M3 能力全部是计划，不是现状；任何「已经支持团队模式」的表述都不符合仓库事实。

本章是里程碑文档，不是模块手册。身份与权限矩阵、Runner 协议与机器模型、审计账本、共享 Agent 规则、审批门与 PR 流程的字段级定义，分别由 `prd/modules/` 下的模块文档负责；本章只给出里程碑级的目标、拆分顺序、验收口径与演示方式。读者需要字段、接口或交互细节时，应先看第 8.2 节的模块指针，再阅读对应模块文档。

阅读建议：产品与决策者重点阅读第 1、2、13、14 节，判断范围与退出条件；工程师重点阅读第 4、5、6、7、8 节，拆解实现任务；安全与运维重点阅读第 3、6、10、11 节；测试与演示负责人重点阅读第 9、13 节。关键架构决策（本地优先 vs SaaS、认证方式、Runner 协议、数据层、跨机器数据边界、推送与 PR 归属）集中在第 6.7 节，决策者可以直接跳读。

## 1. 里程碑定位与目标

### 1.1 一句话目标

**让 2-10 人的团队在自己的基础设施上安全地共享 Task、Agent 与 Machine，使每一次 Run 都能回答「谁发起、在哪台机器执行、依据什么配置、产出了什么证据、由谁批准、是否已合入」。**

这个目标包含四层含义：

1. **共享**：Task、Agent、Run、Artifact、Evidence、Approval 属于团队可见的作用域，而不是某台电脑上的孤岛。
2. **隔离**：不同组织、不同 Team Workspace 之间的数据不可见；不同 Run 的远端工作区互不干扰。
3. **可执行**：团队的机器可以注册为 Runner，按能力、标签与仓库匹配领取任务，把执行从单机扩展到多机。
4. **可治理**：登录、角色、审批、审计与 PR 形成闭环，高风险动作始终有人类批准，且事后可追溯。

### 1.2 目标用户结果

M3 完成后，一个 2-10 人团队应当能够完成以下动作，而不需要手工修改数据库、在聊天里口头同步权限或在服务器上直接执行 SQL：

1. 团队管理员创建组织与 Team Workspace，邀请成员并分配角色。
2. 成员登录后只看到自己有权访问的 Task、Agent、Run 与证据。
3. 团队维护一组共享 Agent，成员直接复用；共享 Agent 的配置与权限不会被普通成员随意改动。
4. 管理员注册一台或多台远程 Runner；Runner 上线后显示心跳、能力与状态。
5. 成员发起 Run，控制面把 Run 分配给满足 runtime、仓库与标签要求的 Runner。
6. Runner 在远端独立工作区执行，事件与证据回传；断线后 Run 不被静默重跑。
7. 评审者查看 diff、测试结果与证据哈希，批准或退回；发起人不能批准自己的合并。
8. 审批通过后由 Runner 创建 GitHub PR，PR 状态回写 Task；系统不自动合并。
9. 管理员按人、动作、资源与时间检索审计，并导出带哈希链的审计包。
10. 本地单用户模式仍然可用，不需要 Postgres、登录或团队配置。

### 1.3 基线：M0 已实现、M1/M2 为前置计划

M3 的起点是当前仓库代码，不是路线图里的理想状态。下表左侧是 M0 真实实现，中间是 M1/M2 必须补齐的前置能力，右侧是 M3 要增加的团队能力。

| 维度 | M0 当前实现（已实现） | M1/M2 前置能力（计划） | M3 目标（计划） |
|---|---|---|---|
| 领域模型 | Task、Agent、Run、RunEvent；Task 有 assigneeType/assigneeId/parentId；Agent 有 runtime/model/workspaceMode/maxConcurrency/timeoutMinutes/allowedPaths/allowedCommands；Run 有 branch/worktree 字段 | Agent 配置快照、Workspace 绑定、Artifact/Evidence、Review/Merge、TaskDependency、Contract、Approval、Crew、Skill | `users`、`organizations`、`team_workspaces`、`memberships`、`machines`、`runners`、`audit_events`、`github_links`；资源带 `organization_id`、`team_workspace_id` 与 `workspace_id`（`project_id` 仅为历史输入别名） |
| 存储 | SQLite（modernc.org/sqlite），WAL、busy_timeout 5000ms、最大打开连接数 1；内嵌 migration 与 schema_migrations | 增量 migration；`workspaces`、Artifact/Evidence/Review/Approval 等表；本地审计表 | Postgres 控制面；SQLite 导入器、字段映射、校验与回滚；团队表与 `audit_events` 哈希链 |
| API | health、tasks、agents、runs、run events、cancel、WebSocket；静态 SPA 回退；CORS 反射任意 Origin；WebSocket `CheckOrigin` 恒为 true；无认证 | 本地会话令牌、Host/Origin 校验、Artifact/Review/Merge 接口、审批接口、错误模型 | `/api/v1/auth/*`、`/me`、`/members`、`/tokens`、`/machines`、`/runner/*`、`/audit-events*`、`/runs/{id}/pull-request`；服务端权限中间件；TLS 与非回环监听保护 |
| Runtime | mock 与最小 claude 适配器；mock 产生确定性步骤；claude 逐行转发 stdout/stderr | 结构化流式事件、工具调用与测试结果解析、权限参数、能力探测 | Runner 侧 Runtime 池、远端执行、版本与能力上报 |
| 调度 | 进程内队列与固定 worker；无持久化队列、无机器感知 | 持久化队列、重启恢复、按 Agent 并发、依赖 DAG 调度 | 机器槽位、租约、fencing、断线恢复、团队配额 |
| Workspace | 每个 Run 在数据目录下创建独立普通目录，不是 git worktree | git worktree、分支、base/head commit、生命周期与清理 | 远端每 Job 独立工作区、路径与命令策略、证据回传 |
| 前端 | Board、Task 详情、Agents、Runs、Settings；事件流 composable | Run 详情、diff viewer、证据面板、评审与合并、Inbox | 登录、Access、Machines、Audit、PR 面板、只读与权限不足状态 |
| CLI | `ateam serve`、`ateam runner`、`ateam version`；`runner` 当前只打印 “runner mode is reserved for M3” | `ateam serve` 的 Run 生命周期与合并能力 | `ateam runner` 真正注册、心跳、领取与执行 |
| 桌面包 | Wails v3 壳启动本地随机端口服务并加载窗口；打包未实现 | 桌面端使用 M1/M2 的本地能力 | 桌面端连接团队控制面；打包仍在 M4 |
| 安全基线 | 默认仅监听 `127.0.0.1:8787`；无认证；CORS 与 WebSocket 来源校验缺失 | 本地 API 会话令牌、Host/Origin 校验、脱敏、本地审计 | 登录、会话、令牌、TLS、权限矩阵、团队审计、Runner 身份 |

字段存在不等于能力存在。M0 的 `Agent.maxConcurrency`、`Agent.allowedPaths`、`Agent.allowedCommands`、`Run.branch`、`Run.worktree`、`Task.parentId` 大多只是持久化占位：调度器不读取、Runtime 不校验、Workspace 不创建 worktree、看板不使用依赖语义。M3 不得基于这些字段宣称已有团队权限或隔离能力。

### 1.4 为什么 M3 必须建立在 M1/M2 之上

团队模式会放大系统中的一切缺陷。如果地基不成立，M3 会把局部问题变成团队事故：

- **没有 worktree 与证据，远程 Runner 只是把不可信改动搬到另一台机器。** 团队看不到 diff、测试与截图，评审只能依赖 Agent 的自述，远端执行反而增加风险。
- **没有服务端审批门，团队角色只是 UI 标签。** Agent 仍可能直接合并或推送；权限矩阵无法阻止任何真实动作。
- **没有 Agent 版本快照，共享 Agent 被编辑后历史 Run 无法复现。** 审计无法回答「当时用的是什么 instructions、什么权限、什么模型」，共享配置会变成不可追责的漂移源。
- **没有本地来源校验与会话令牌，直接进入团队认证会把已有本地 API 暴露面带入多人环境。** M0 的 CORS 反射任意 Origin、WebSocket 接受任意 Origin、API 无认证，必须先由 M1 收敛 Origin/Host/CORS，并在 M2.1 交付本地会话令牌。
- **没有 DAG、契约与证据化 DoD，团队协作会退化为自由聊天。** M3 不重新发明协作模型，只把 M2 的结构化协作扩展到多人多机。

因此，M3 启动前必须完成一次前置差距审计：M1 与 M2 的退出标准逐项对照，未通过项要么在 M3 前修复，要么在 M3 范围中显式列为阻塞项，不允许「边做团队模式边补地基」。该要求与 `prd/01-scope-and-roadmap.md` 的 MILE-001 与 MILE-005 一致：M3 不得在 M2 的权限模型与审计事件 schema 冻结前启动；审计结论是 M3 入口门（第 13.0 节）的放行依据。若审计发现远程 Runner 的安全高危问题无法在本里程碑内关闭，按 `01-scope-and-roadmap.md` §8.2 的预案拆分为 M3.1（Postgres、登录、权限、审计）与 M3.2（远程 Runner、GitHub PR），不以不安全方式上线。

### 1.5 成功标准与不证明什么

M3 成功不以「功能列表全部打勾」为标准，而以以下可观察状态为准：

- 团队可以连续两周在自己的基础设施上完成从 Task 到 PR 的协作，且不需要手工改数据库或绕过审批。
- 任何高风险动作都能回答操作者、角色、时间、对象、证据与结果。
- Runner 断线、版本不兼容、权限拒绝等异常都有明确状态与人工恢复路径。
- 新成员在 5 个工作日内能够完成第一次被评审的 Run。
- 本地单用户模式没有因为团队代码路径而退化。

M3 不证明：

- 模型能力足够强，或 Agent 产出一定正确。
- 多租户 SaaS 可行，或团队愿意为托管付费。
- 所有代码托管平台都已支持；M3 只承诺 GitHub。
- 远程 Runner 提供强沙箱；Runner 机器所有者仍然可以读取运行中的代码与进程内存。
- 团队可以无人值守地自动合并或自动生产部署；这些永远需要人类决定。

## 2. 范围

### 2.1 范围内

M3 的交付范围包括十二项能力：

1. **Postgres 数据层**：控制面使用 Postgres 存储组织、成员、Task、Agent、Run、事件、证据索引、审批与审计；提供从 SQLite 到 Postgres 的导入器，包含字段映射、预检、快照、导入、行数与关键哈希校验、失败回滚，以及旧库只读快照的生命周期管理。该交付与 `prd/01-scope-and-roadmap.md` §4.5.2/§4.5.3 的 M3 范围一致；`prd/modules/api-and-data.md` §9.4 中「是否需要导入工具待确认」的表述应在本章范围冻结后回写为「M3 交付一次性导入器，不做双写」。
2. **登录与会话**：团队模式默认拒绝未认证请求；健康检查、登录、邀请接受、密码重置、Runner 注册与机器签名端点、GitHub Webhook 是明确的例外，按 6.1.1 的例外表逐一列出认证方式；支持登录、登出、会话续期、密码策略、个人访问令牌与撤销。
3. **组织、Team Workspace 与角色**：组织是最高作用域，Team Workspace 是团队资源边界；采用 `security-and-permissions.md` §4.2 的两层四角色模型：组织级 Owner、Admin、Member、Viewer，Team Workspace 级 workspace_admin、Contributor、Reviewer、Viewer。旧称谓 Maintainer 对应 workspace_admin，Developer 对应 Contributor。
4. **服务端权限执行**：权限矩阵在服务端中间件强制执行；不可见资源返回 404，可见但角色不足返回 403；高权限操作需要二次确认；权限变更写入审计。
5. **远程 Runner 与机器注册**：Runner 通过一次性令牌注册，使用机器密钥与签名挑战认证；心跳 15 秒、45 秒未心跳标记 offline、租约 90 秒未续期失效；支持 pending、online、offline、draining、disabled 状态与版本兼容检查。
6. **共享 Agent**：Agent 支持 private、team、shared 可见性；团队 Agent 默认只读；编辑、归档、转移所有权需要相应角色；Run 固化 AgentVersion 快照；共享 Agent 不得携带创建者的私有 Secret 绑定。
7. **审计**：只追加的审计账本，覆盖登录、成员与角色变更、Agent 变更、Runner 注册与撤销、Run 创建/取消/失败、审批、合并、PR 创建与部署请求；支持按人、动作、资源、时间查询与导出，并在哈希链校验失败时告警。
8. **GitHub PR**：在人工审批后由 Runner 使用用户授权的短期 Git 凭据推送 Run 分支并创建 GitHub PR；控制面只下发审批、记录结果与状态；PR 状态回写 Task；不自动合并。
9. **团队 UI**：登录与邀请接受页、Access（成员与角色）、Machines（注册与状态）、Audit（审计查看器）、PR 状态面板、权限不足与只读模式，以及无机器、无 Run、无审计、无 PR、WebSocket 断线等加载/空/离线状态。
10. **自托管部署与运维**：控制面部署说明、TLS 配置、备份与恢复、升级与健康检查。
11. **跨机器数据边界**：控制面默认只接收元数据、事件、日志、测试/构建结果摘要与证据哈希；diff、截图等含源码内容的证据默认留在 Runner 本机，项目级显式开启 `allowSourceEvidenceUpload` 并逐次审批后才回传。该边界与 `01-scope-and-roadmap.md` SCOPE-010、§4.5.2/§4.5.3 第 4 条一致，是 M3 的安全承诺而非部署建议。
12. **M3 入口门与拆分预案**：启动前复核 M1/M2 退出标准、M2 权限模型与审计 schema 冻结情况；若远程 Runner 安全无法收口，按 M3.1/M3.2 拆分，并在范围评审中记录。

### 2.2 范围外

详细的后置项与长期非目标见第 14 节。此处先给出边界摘要：

- 不做多租户 SaaS、计费、订阅与自助开通。
- 不做模型托管、转售与密钥代管。
- 不做 SAML、SCIM、LDAP 同步与自定义角色；OIDC 是否在 M3 交付见第 16 节。
- 不做自动合并与自动生产部署；prod 部署仍由人类在 ATeam 之外执行。
- 不做完整项目管理、20+ 集成、IM 机器人、移动端、技能/Agent 市场。
- 不做跨仓库任务与跨仓库 DAG。
- 不做 SQLite 与 Postgres 双写；团队模式启用后 SQLite 只作为导入来源或本地离线工作区。
- M3 不交付 Docker 沙箱与降级审批；Runner 以受信任机器为前提，专用 OS 用户、全盘加密与容器运行只作为部署建议。`runtime-and-workspace.md` 里程碑映射中把「Docker 沙箱与降级审批」列入 M3 的行需要回写为 M4，Q-M3-14 记录该结论。
- 不做实时协同编辑；团队模式使用乐观锁与冲突提示。
- 不做 DMG/NSIS/AppImage 打包与自动更新；这些属于 M4。

### 2.3 范围判定规则

当一个新的团队模式需求出现时，按以下顺序判断是否属于 M3：

1. **是否服务于 2-10 人团队共享 Task、Agent、Machine 与 Audit？** 如果只是单人便利功能，退回 M1/M2 或 M4。
2. **是否依赖身份、作用域、远程执行、审计或 PR 中的至少一项？** 如果完全不依赖，说明它不属于团队模式核心。
3. **是否可以用现有模块文档中的实体与流程表达？** 如果不能，先补领域模型与模块文档，不在里程碑文档中临时发明概念。
4. **是否触碰高风险动作？** 如果触碰，必须有审批、审计与权限校验；没有这三项的需求不得进入 M3。
5. **是否会迫使产品转向多租户 SaaS 或模型托管？** 如果是，拒绝并记录为长期非目标。

## 3. 角色与场景

### 3.1 团队角色

M3 的角色定义以 `prd/modules/security-and-permissions.md` §4.2 与 `prd/01-scope-and-roadmap.md` §4.5.2 为准，采用**两层四角色**模型。本章不再把六角色当作权威词表；旧稿中的 Maintainer、Developer 是别名，必须按本节映射理解。

**组织级（Organization）**

| 角色 | 定位 | 关键允许 | 关键禁止 |
|---|---|---|---|
| Owner | 组织所有者 | 组织设置、成员与角色、Runner、全部 Team Workspace、删除组织、Owner 转移 | 不能绕过四眼原则单独批准自己发起的合并；覆盖需记录理由并审计；不得移除或降级最后一名 Owner |
| Admin | 组织管理员 | 成员管理、Runner 管理、共享 Agent、安全设置、审计查看与导出 | 不能授予 Owner、不能修改自己的组织角色、不能审批自己的高风险请求 |
| Member | 组织成员 | 默认无 Team Workspace 访问权；被加入 Team Workspace 后按 Contributor/Reviewer/Viewer 工作 | 未加入 Team Workspace 时不能查看或创建团队资源 |
| Viewer | 组织只读成员 | 仅查看被显式授权的只读范围 | 所有写操作、审批、导出与审计查看均禁止 |

**Team Workspace 级**

| 角色 | 旧称谓 | 关键允许 | 关键禁止 |
|---|---|---|---|
| workspace_admin | Maintainer | 管理本 Team Workspace 成员、设置、共享 Agent；审批合并与 staging 部署 | 不管理组织成员与 Runner；不能审批 prod；不能访问其他 Team Workspace |
| Contributor | Developer | 创建/编辑 Task、使用可见 Agent 启动 Run、查看本 Team Workspace 的 Run 与证据元数据、取消自己启动的 Run | 不能审批合并；不能修改共享 Agent 权限；不能管理成员与 Runner |
| Reviewer | Reviewer | 查看 Task/Run/证据元数据、评论、在被指派时审批合并 | 不能修改 Agent、不能管理成员与 Runner、不能查看组织审计 |
| Viewer | Viewer | 只读查看被授权的 Task、Run 摘要、证据清单与校验状态 | 所有写操作、审批、导出；不能下载证据正文 |

叠加与继承规则：

1. 组织 Owner/Admin 自动在所有 Team Workspace 拥有 workspace_admin 能力；组织 Member 只有被加入具体 Team Workspace 后才获得 workspace 角色，且必须被显式授予 Contributor、Reviewer 或 Viewer 之一，不存在「默认 Member 角色」；workspace_admin 角色需组织 Admin 及以上授予。组织 Viewer 不因组织角色自动获得 Team Workspace 访问权。
2. 同一用户可以同时拥有组织角色与多个 Team Workspace 角色，权限取并集；但组织级高风险动作（组织删除、Owner 转移、成员与角色管理、Runner 管理）仍要求组织角色，workspace 角色不能替代。
3. 角色是**服务端**的权限来源，不是界面显示状态。界面可以隐藏入口或禁用按钮，但任何隐藏都不能替代 API 鉴权。
4. 角色变更必须写入审计，并且需要二次确认；成员被降级或移除时，其会话与个人令牌立即失效；最后一个 Owner 不得被移除或降级，除非先完成 Owner 转移（`SEC-035`）。
5. 本章其余章节为可读性保留 Owner/Admin/Maintainer/Developer/Reviewer/Viewer 的旧称谓时，一律按上表映射；需要回写的文档清单见 Q-M3-01。
6. Viewer 的证据可见性以本章 3.1 与 US-M3-10 为准：可见证据元数据与校验状态，不可下载正文；`security-and-permissions.md` §4.5 的「查看证据」需回写为「查看证据元数据」，并增加证据正文接口 403 的验收测试。

### 3.2 系统身份

除人类成员外，系统还包括三类非人类身份：

- **Runner**：代表一台已注册机器，只能领取租约、回传事件与证据，不能创建 Task、不能审批、不能修改 Agent。
- **Control Plane（控制面）**：执行调度、租约管理、审计写入与 PR 状态同步；系统动作以 `actor_type=system` 记录，不能伪装成人类审批。
- **Agent**：不是独立安全主体。Agent 的行为通过某个 Run 发生，Run 归属于发起人或触发者；Agent 不能创建或批准 Approval，不能自我授权，也不能绕过 Runner 策略。

这一区分是团队治理的基础：审计必须能回答「这是人做的、机器做的，还是系统做的」，并且高风险动作只能由具备权限的人类批准。

### 3.3 关键场景

**场景 S1：共享任务池与共享 Agent。** 团队维护一组共享 Agent（Frontend、Backend、UI Design、DevOps），成员在同一个 Board 上创建与领取任务。Contributor 只能使用共享 Agent，不能修改其权限信封；workspace_admin 修改 Agent 后，新 Run 使用新版本，历史 Run 仍保留旧快照。

**场景 S2：远程 Runner 执行重任务。** 团队有一台装有浏览器、测试工具链与构建缓存的 Linux 工作站，注册为 Runner。成员把需要这些能力的任务指定到该 Runner；Runner 领取租约、拉取仓库、创建 worktree、执行 Runtime，并把事件与证据回传。控制面默认不保存完整代码副本与模型密钥：模型密钥只留在 Runner 本机；diff、截图等含源码内容的证据默认也留在 Runner 本机，控制面只接收元数据、事件、日志、测试/构建结果摘要与证据哈希。团队在项目级显式开启 `allowSourceEvidenceUpload` 并对每次上传逐次审批后，含源码证据才允许回传，回传范围、脱敏与保留期按 6.7.5 执行。

**场景 S3：越权与离职。** 一名成员试图删除共享 Agent 或批准自己发起的合并；服务端拒绝并写入审计。成员离职后，管理员移除其账号，其会话与个人令牌立即失效；历史 Run 与审批保留原成员标识，未完成审批转交。

**场景 S4：受保护分支与 PR。** 团队的 `main` 分支受保护。Run 完成后，Developer（Contributor）请求合并；系统要求另一名具备权限的成员审批。审批通过后，由 Runner 使用用户授权的短期 Git 凭据推送 Run 分支并创建 GitHub PR；控制面只下发审批、记录 PR 链接与状态，不持有可推送仓库的长期凭据。PR 的合并仍由人在 GitHub 完成，状态回写 Task 与审计。

**场景 S5：审计复盘。** 季度复盘时，Admin 按成员、动作、资源与时间检索审计，核对某次合并由谁批准、依据哪次 Run 的哪份证据、当时 Agent 拥有哪些权限，并导出带哈希链的审计包。

### 3.4 与本地模式的映射

本地模式没有登录与角色，所有操作者被视为同一个本机用户。为了支持平滑升级：

- 本地模式保留隐式用户与本地 API 会话令牌；`actor_id` 记录本机用户名与机器标识，但明确标注「本地模式不提供身份认证」。
- 升级到团队模式时，迁移向导创建一个组织与一个默认 Team Workspace，把本地数据导入并把执行迁移的管理员设为 Owner。
- 迁移前的历史审计记录以 `actor_type=local` 保留，不伪造成团队账号；迁移动作本身写入新审计账本。
- 团队模式启用后，本地模式仍可作为个人离线工作区存在，但两者的数据不自动双向同步。
- 本地模式下 `organization_id` 与 `team_workspace_id` 固定为 `local`，`workspace_id` 指向 M1 引入的仓库绑定 Workspace；团队模式下三个作用域字段均为必填，不再新增第四层实体。

## 4. 用户故事与验收标准

以下用户故事是 M3 的验收主线。每条故事都包含可观察的 Given/When/Then，并与第 5 节的功能需求、第 13 节的退出标准对应。

### US-M3-01 创建团队并完成首次登录

**Given** 组织所有者已在自托管服务器上部署 ATeam 控制面并创建组织；
**When** 所有者通过邀请链接邀请开发者 A 与评审者 B，并分别分配 Contributor（旧称 Developer）与 Reviewer 角色；
**Then** A、B 设置密码并登录成功，只能看到所属 Team Workspace 的资源；邀请、角色分配与首次登录写入审计；未登录访问团队 API 返回 401。

### US-M3-02 共享 Agent 的可见性与版本快照

**Given** workspace_admin（旧称 Maintainer）将一个 Frontend Agent 的可见性设为 `team`，并配置允许路径与允许命令；
**When** Contributor A（旧称 Developer）在任务上选择该 Agent 启动 Run；
**Then** Run 使用启动时的 AgentVersion 快照；A 不能修改 Agent 的权限配置；workspace_admin 之后编辑 Agent 不会改变已启动 Run 的配置；Agent 的创建、编辑、可见性变更与权限拒绝均写入审计。

### US-M3-03 远程 Runner 注册并领取任务

**Given** Admin 在 Machines 页面生成一次性注册令牌，令牌绑定组织与可选 Team Workspace，有效期 15 分钟且只能使用一次；
**When** 运维在远程机器上运行 `ateam runner` 并提交令牌；
**Then** Runner 生成机器密钥对、完成注册并出现在 Machines 页面；Runner 每 15 秒发送心跳；当存在匹配 runtime、仓库与标签的 queued Run 时，Runner 获得租约并开始执行；令牌明文只显示一次，注册与令牌使用写入审计。

### US-M3-04 远程执行断线与恢复

**Given** Runner R1 正在执行一个 Run；
**When** R1 所在机器断网超过 45 秒；
**Then** 控制面把 R1 所在机器标记为 `offline`；租约在 90 秒未续期后失效，Run 进入 `failed`，`errorCode=interrupted`、`failureDetail=runner_lost`（租约自然到期时为 `lease_expired`）；系统不在其他 Runner 上自动重跑；网络恢复后 Runner 不得自行把 Run 恢复为 `running`，旧租约持有者的事件与证据写入被拒绝（fencing）；由人工选择重试（创建新 Run，`attempt+1`）或放弃；整个过程的事件、租约与审计可查。

### US-M3-05 越权操作被拒绝

**Given** 用户只有 Viewer 角色，或只属于另一个 Team Workspace；
**When** 其调用创建 Task、启动 Run、删除共享 Agent、查看审计或下载证据正文的 API；
**Then** 对不可见资源返回 404（与真正不存在完全一致），对可见但角色不足的请求返回 403 并说明所需角色；不产生副作用，并写入拒绝审计；界面显示禁用态；错误消息不泄露资源名称、创建者或是否存在。

### US-M3-06 四眼原则与 GitHub PR

**Given** Developer（Contributor）A 发起一个 Run 并请求合入受保护分支；
**When** A 尝试批准自己的合并请求；
**Then** 系统拒绝该审批；Maintainer（workspace_admin）B 审阅 diff、测试结果与证据哈希后批准；若源码类证据未回传，B 看到文件列表、改动统计与哈希，并在 Runner 本机或经批准的加密通道查看完整 diff；审批通过后，Runner 使用用户授权的短期 Git 凭据推送 Run 分支并创建 GitHub PR，控制面记录 PR URL 与编号；PR 的 opened/merged/closed 状态回写 Task；系统不自动合并 PR。

### US-M3-07 审计查询与导出

**Given** 团队已经运行了一段时间并产生了登录、Agent 变更、Run、审批与 PR 记录；
**When** Admin 按成员、动作、资源与时间检索审计，并导出 JSON/CSV；
**Then** 返回只追加的审计记录，包含 `prev_hash`/`hash` 与每日锚点；导出动作本身产生审计；普通成员无法查看或导出审计；哈希链或锚点校验失败时触发 `security.alert`、写入审计并通知 Owner/Admin，告警按 TEAM-046 去重与恢复。

### US-M3-08 成员移除与工作交接

**Given** 一名成员离职或需要立即撤销访问；
**When** Admin 移除该成员；
**Then** 其会话与全部个人令牌立即失效，后续 API 返回 401；历史 Run、审批与审计保留原成员标识；未完成的审批转交给其他具备权限的成员；移除与转交动作写入审计。

### US-M3-09 SQLite 到 Postgres 的迁移

**Given** 团队在 M2 的本地 SQLite 中已有 Task、Agent、Run、RunEvent、Artifact/Evidence 与 Approval 数据；
**When** 管理员运行 M3 导入器，依次执行预检、快照、字段映射、导入、校验与切换；
**Then** 导入器按 7.4 的字段映射表处理 `workspace_id`、`team_workspace_id`、`organization_id` 与 `local` 固定值（`project_id` 仅作输入别名归一化）；迁移后的行数、关键字段哈希与证据校验和一致；迁移报告列出跳过项、异常项与字段映射版本；失败时自动回滚到迁移前快照；旧 SQLite 以只读快照保留，删除需 Owner/Admin 审批并确认快照不含新数据；导入与回滚都写入审计。

### US-M3-10 只读观察者

**Given** 产品经理或外部审计员只有 Viewer 角色；
**When** 其浏览被授权的 Board、Task、Run 摘要与证据清单；
**Then** 只读内容可见，包括证据类型、大小、哈希与校验状态；证据正文与下载不可用，直接调用证据内容接口返回 403；所有写操作不可用；不能看到其他 Team Workspace 的资源与审计；界面明确标注只读模式。

### US-M3-11 团队并发配额

**Given** 团队配置了并发配额与单 Run 时长上限；
**When** 配额已满时成员发起新的 Run；
**Then** Run 进入 queued 并显示排队原因与预计可执行条件；不占用 Runner 槽位；管理员调整配额后新 Run 可按顺序执行；配额变更写入审计。

### US-M3-12 共享 Runner 提示与审批

**Given** Admin 要注册一台 `shared=true` 的 Runner，供多个 Team Workspace 使用；
**When** 保存注册配置；
**Then** 系统要求申请人以外的 Owner 或 Admin 审批（申请人不能自批；高风险时要求 Owner/Admin 双人确认），并提示「机器所有者理论上可以读取运行中的代码与进程内存，敏感任务应使用专用机器」；共享 Runner 默认拒绝，审批通过后才生效；`shared`、允许的 Team Workspace、磁盘配额与并发上限的变更写入审计。

### US-M3-13 远程取消与超时

**Given** Runner R1 正在执行一个 Run；
**When** 有权限的成员在控制面点击取消，或 Run 超过单 Run 时长上限；
**Then** 控制面通过租约下发取消指令；Runner 终止进程树并回传 `run.cancelled`（超时为 `run.failed`，`errorCode=timeout`）；Run 进入终态且不可恢复；证据与 Run Workspace 按保留策略保留，不自动删除未合并改动；重复取消幂等；取消/超时事件、审计与状态可查。

### US-M3-14 跨机器证据边界

**Given** 团队未开启源码类证据回传，或已开启但本次上传未获批准；
**When** 成员 B 在另一台电脑查看 Run 的 diff 与证据；
**Then** 控制面只展示文件列表、改动统计、事件/日志、测试结果摘要与证据哈希；完整 diff、截图等源码类证据保留在 Runner 本机，B 需通过 Runner 本机的受控查看或在批准后经加密通道获取；任何源码类证据上传都有显式同意、审批人、脱敏结果与审计；关闭回传后既有已上传证据按保留策略处理。

## 5. 功能需求

说明：以下需求均为 M3 计划，当前均未实现。编号沿用 TEAM 前缀；TEAM 前缀的权威定义在本章与 `prd/04-acceptance-and-test-plan.md`，`prd/03-user-flows.md` 已停用 TEAM 前缀、改用 `FLOW-F-*` 描述流程，不再作为 TEAM-001 至 TEAM-012 的来源。本章 5.1 直接给出这 12 条的需求行与验收口径，流程背景引用 `prd/03-user-flows.md` 流程 F（FLOW-F-001～017）。

### 5.1 继承需求（TEAM-001 至 TEAM-012）

| 编号 | 需求摘要 | M3 处理 |
|---|---|---|
| TEAM-001 | 登录、成员邀请与角色分配 | 必交；见 TEAM-015/016、TEAM-049 |
| TEAM-002 | 权限矩阵在服务端强制执行 | 必交；见 TEAM-017 |
| TEAM-003 | Task、Agent、Run 的团队可见性规则 | 必交；见 TEAM-013/018 |
| TEAM-004 | Runner 注册与心跳 | 必交；见 TEAM-020/021 |
| TEAM-005 | Run 分配匹配 runtime、仓库与标签能力 | 必交；见 TEAM-022 |
| TEAM-006 | 远端 Workspace 隔离与路径/命令边界 | 必交；见 TEAM-026 |
| TEAM-007 | Evidence 断点续传与哈希校验 | 必交；见 TEAM-024 |
| TEAM-008 | 高风险动作写审计 | 必交；见 TEAM-028/029 |
| TEAM-009 | 合并优先走 GitHub PR | 必交；见 TEAM-031/032 |
| TEAM-010 | Runner 版本与协议兼容 | 必交；见 TEAM-025 |
| TEAM-011 | 团队并发配额与运行时长限制 | 必交；见 TEAM-027 |
| TEAM-012 | 成员移除后令牌立即失效 | 必交；见 TEAM-016/033 |

### 5.2 新增需求（TEAM-013 至 TEAM-049）

| 编号 | 需求 | 可测试的验收标准 | 优先级 | 模块指针 |
|---|---|---|---|---|
| TEAM-013 | 组织、Team Workspace 与 Workspace 归属 | Owner 可创建组织与 Team Workspace；所有 Task/Agent/Run/Artifact/Approval/Audit 携带 `organization_id`、`team_workspace_id` 与 `workspace_id`；Workspace 归属一个 Team Workspace，成员通过 Team Workspace 角色获得 Workspace 访问权，不引入 `workspace_members` 之外的平行权限表（成员表即 `workspace_memberships`）；不可见资源返回 404，可见但角色不足返回 403 | P0 | security 4.2/4.6、01-scope 4.5.2、domain model 2.3 |
| TEAM-014 | 本地模式兼容 | 未配置团队模式时，`ateam serve` 仍以 SQLite 本地模式启动并完成 M0-M2 本地闭环；作用域字段固定为 `local`；无需登录；升级不破坏本地数据 | P0 | app.go、store |
| TEAM-015 | 登录、会话与认证例外 | 默认拒绝未认证请求；6.1.1 例外表之外的团队 API 均需有效会话；会话可续期、登出、撤销；连续失败登录触发限流与审计；邀请接受、密码重置、Runner 注册与机器签名端点、GitHub Webhook 按例外表认证并有自动化测试 | P0 | security 4.1/4.2、3.3 |
| TEAM-016 | 个人访问令牌 | 成员可创建带作用域与过期时间的令牌；令牌只显示一次，服务端只存哈希；撤销后立即失效；成员移除后全部令牌失效 | P0 | security 3.3 |
| TEAM-017 | 服务端权限强制 | 两层四角色矩阵在服务端执行；不可见返回 404、可见但角色不足返回 403；越权写审计；查询先按成员关系过滤，禁止先按 ID 查询再判断；UI 隐藏不作为安全边界 | P0 | security 4.4/4.6 |
| TEAM-018 | 共享 Agent 可见性与所有权 | private/team 的权威定义见 `agent-system.md` 9.2/AGENT-058；shared 的权威定义见 `security-and-permissions.md` 4.2/4.3；team 默认只读；编辑、归档、转移所有权需 workspace_admin 及以上；shared 编辑需组织 Admin；可见性变更需二次确认并审计；共享 Agent 不得携带创建者私有 Secret | P1 | agent-system 9.2、security 4.2/4.3 |
| TEAM-019 | Agent 版本快照 | Run 启动时固化 AgentVersion（配置哈希、instructions 哈希、技能版本、runtime/model）；后续编辑不影响已启动 Run；Run 详情可查看快照 | P0 | agent-system 6/9 |
| TEAM-020 | Runner 注册令牌 | 令牌一次性、15 分钟有效、单次使用、绑定组织与可选 Team Workspace；明文只显示一次；创建、使用与失败均审计；覆盖过期、复用与时钟偏差测试 | P0 | security 7.1、api-and-data 5.10 |
| TEAM-021 | Runner 身份、心跳与密钥生命周期 | 注册生成密钥对，服务端存公钥；签名挑战认证；TLS；心跳 15 秒；45 秒未心跳标记 `offline`；Machine 状态 `pending/online/offline/draining/disabled`，`revoke` 是动作与事件名；支持密钥轮换；钥匙串不可用时 fail closed，不退化为明文存储 | P0 | security 7.1/7.2/7.4、domain model 3.14 |
| TEAM-022 | 租约调度与失联 | Run 分配匹配 runtime、仓库、标签与能力；同一 Run 同时只有一个有效租约；租约 90 秒未续期失效后 Run 进入 `failed`，`errorCode=interrupted`、`failureDetail=runner_lost` 或 `lease_expired`；不自动跨机重跑；人工确认后创建新 Run 重试；旧租约事件写入返回 `409 RUNNER_FENCED` | P0 | runtime 7.4-7.6、api-and-data 5.11 |
| TEAM-023 | 事件回传与去重 | 事件带 runId+seq；断网本地缓冲；重连按 seq 续传；重复事件幂等去重；控制面按 seq 排序；事件不静默丢失 | P0 | runtime 7.3 |
| TEAM-024 | 证据回传与跨机器数据边界 | 默认只上传元数据、事件/日志、测试/构建结果摘要与证据哈希；源码类证据需项目级 `allowSourceEvidenceUpload` 开启并逐次审批；分片上传、断点续传与哈希校验；哈希不一致拒绝并标记证据不完整；上传失败保留本地副本可重试 | P0 | runtime 10、01-scope 4.5.2 |
| TEAM-025 | Runner 版本、协议与 Runtime 支持矩阵 | Runner 上报版本与协议版本；不兼容时拒绝新租约（`409 RUNNER_VERSION_INCOMPATIBLE`）并提示升级，已领取 Run 允许完成；声明 Claude Code、Codex、mock 的支持版本与能力探测结果，不兼容时拒绝而非静默降级 | P1 | runtime 7.3 |
| TEAM-026 | 远端 Workspace 隔离 | 每 Job 独立工作目录与临时目录；不复用环境变量、凭据或敏感缓存；路径规范化防 `..` 与符号链接逃逸；结束后按保留策略清理并审计；工作目录可配置 | P0 | runtime 8、security 7.3 |
| TEAM-027 | 团队并发与配额 | 有效并发取全局、机器、Agent 三者最小值；支持团队配额与单 Run 时长上限；超限排队并显示原因；调整配额写审计；超时按 TEAM-041 终止并回传 `run.failed`/`timeout` | P1 | runtime 7.5、NFR-COST-006 |
| TEAM-028 | 审计账本 | 审计只追加；字段包含作用域、actor、action、resource、source、时间、结果、原因码、元数据、prev_hash 与 hash；按组织分区哈希链；每日锚点；无更新/删除 API；默认保留 180 天，可配置 90 天至 3 年，仅归档不物理删除 | P0 | security 8.1/8.3 |
| TEAM-029 | 审计查询与导出 | 支持按 actor、action、resource、时间、结果过滤；默认最近 30 天；Owner/Admin 可导出 JSON/CSV，包含哈希与锚点；导出动作本身审计；导出文件脱敏并附完整性校验说明 | P1 | security 8.3 |
| TEAM-030 | 四眼原则 | 受保护分支合并的审批人不得是 Run 发起人；Owner 覆盖必须填写理由并审计；Agent 与系统不能审批；审批与证据哈希绑定，证据变化则审批失效 | P0 | collaboration 8、domain model DM-APPR-007 |
| TEAM-031 | GitHub PR 创建 | 只允许推送 Run 分支；Runner 使用用户授权的短期 Git 凭据执行 push 与 PR 创建，控制面不保存长期仓库凭据；推送与创建 PR 前必须有人工审批，审批绑定 remote、分支、commit 与 diff 摘要；记录 PR URL、编号与状态；失败保留本地分支可重试且不重复创建 PR | P0 | runtime 9.4、01-scope 4.5.3 #7 |
| TEAM-032 | PR 状态回写 | PR opened/merged/closed 事件回写 Task 与 Run；合并由人在 GitHub 完成或经明确审批触发；系统不自动合并；Webhook 不可达时轮询对账 | P1 | runtime 9.4、api-and-data 6.3 |
| TEAM-033 | 成员移除与交接 | 移除后会话与令牌立即失效；历史记录保留原成员标识；未完成审批转交；Run 归属可重新指派；全部动作审计 | P1 | security 4.2 |
| TEAM-034 | 团队数据导出与删除 | Owner/Admin 可导出团队配置、Task、Agent、Run 元数据与审计；删除组织或 Team Workspace 需二次审批与再认证；删除前导出摘要并审计 | P1 | security 5.4、8.3 |
| TEAM-035 | Postgres 迁移与备份 | 提供预检、快照、字段映射、导入、校验、回滚工具；迁移前自动备份；行数、关键字段哈希与证据校验和一致；失败回滚；旧 SQLite 只读快照保留并受删除审批保护；支持定时备份与恢复演练 | P0 | api-and-data 9.4、NFR 12.4、RISK-T-005 |
| TEAM-036 | 非回环监听安全 | 监听非回环地址时必须启用 TLS 与认证，否则拒绝启动；健康检查最小暴露；配置安全头与 CSP；本地模式保持回环限制 | P0 | NFR-SEC-001、security 3.1 |
| TEAM-037 | 团队 UI 与状态覆盖 | 登录/邀请接受、Access、Machines、Audit、PR 面板、权限不足状态、只读模式；覆盖无机器、无 Run、无审计、无 PR、WebSocket 断线、配额排队等加载/空/离线/错误状态；敏感操作有禁用态与原因 | P1 | ui-ux 11.2、14 |
| TEAM-038 | 团队收件箱过滤 | 待审批、待评审、Runner 离线、证据不完整进入对应成员收件箱；按成员与角色过滤；不泄露无权资源 | P1 | collaboration 9、ui-ux 5.8 |
| TEAM-039 | 共享 Runner 安全 | `shared=true` 需申请人以外的 Owner/Admin 审批，高风险时 Owner/Admin 双人确认；每 Job 隔离；界面提示机器所有者可读取代码与进程内存；建议专用 OS 用户与全盘加密；数据模型包含 `shared`、`allowed_team_workspace_ids`、`disk_quota` 与 `max_concurrency` | P0 | security 7.3 |
| TEAM-040 | 团队指标与用量 | 团队可查看 Run 数、成功率、审批等待、Runner 利用率、配额使用；指标在自托管侧计算；不含代码、提示词与密钥 | P2 | NFR 6.4、12.4 |
| TEAM-041 | 远程取消与超时 | 控制面通过租约下发取消；Runner 终止进程树并回传 `run.cancelled`；超时回传 `run.failed` 且 `errorCode=timeout`；定义取消/超时/失联三种终态与错误码、证据与工作区保留策略、幂等与权限；重复取消不产生副作用 | P0 | runtime 7.6、api-and-data 7.4 |
| TEAM-042 | 跨机器证据分级与显式授权 | 默认只传元数据、摘要与哈希；`allowSourceEvidenceUpload` 为项目级开关，逐次上传需审批；上传前脱敏、上传后审计；定义保留、删除与关闭回传后的处理 | P0 | 01-scope 4.5.2、runtime 10.3 |
| TEAM-043 | 团队 UI 空状态与离线状态 | 无 Runner、无审计、无 PR、无 Run、权限不足、WebSocket 断线、配额排队、证据不完整均有明确文案与恢复入口；不得以空白页或「未知错误」代替 | P1 | ui-ux 14 |
| TEAM-044 | GitHub Webhook 安全 | HMAC 签名校验、时间戳与重放窗口、`dedupeKey` 去重、事件去重、PR 状态对账、轮询降级、无效签名拒绝并审计 | P1 | api-and-data 6.3/7.4 |
| TEAM-045 | Runner 凭据与密钥生命周期 | 机器密钥轮换、短期凭据租约、撤销后拒绝新租约并处理在途 Job、钥匙串不可用 fail closed、撤销后黑名单与 Secret 轮换提示 | P0 | security 7.4、3.3 |
| TEAM-046 | 审计完整性告警与导出保护 | 哈希链或锚点校验失败时发出 `security.alert`、写入审计并通知 Owner/Admin；定义告警接收人、频率、静默与恢复；导出文件加密/脱敏并附校验方法 | P1 | security 8.3/8.4、SEC-074 |
| TEAM-047 | M3 容量与压测口径 | 以 `non-functional-requirements.md` §12.4 为唯一门禁：10,000 Task、100,000 Run、1,000,000 条审计、30 台机器；任务、Run、审计与机器状态查询 p95 低于 1 秒；压测数据集与脚本纳入 D-M3-13 | P0 | NFR 12.4、api-and-data 18.1 |
| TEAM-048 | Runner 工作目录与磁盘配额 | 配置 `workdirRoot`、磁盘配额、并发上限与允许的 Team Workspace；超配额拒绝新 Job 而不是降级隔离；配置变更审计；跨 Team Workspace 可见性与配额测试 | P0 | 01-scope 4.5.2、security 7.3 |
| TEAM-049 | 邀请与密码恢复（无 SMTP 默认） | 邀请码/一次性链接、管理员手动重置、离线恢复码；限流、过期、一次性与审计；SMTP 邮件邀请作为可选配置 | P0 | security 4.3、Q-M3-04 |

### 5.3 优先级与裁剪规则

- **P0**：安全、权限、身份、租约、审计、迁移与 PR 审批底线。任何 P0 未通过，M3 不得退出；不允许用「后续版本补」作为例外。
- **P1**：团队协作完整性所需，但在极端情况下可按第 13.2 节的例外流程延期；延期必须有影响评估、补偿措施、签署人、目标里程碑与复查日期，并符合 `01-scope-and-roadmap.md` MILE-008。
- **P2**：指标与体验增强，可按试点反馈裁剪或延后。
- 任何新增需求必须先映射到 TEAM 编号或模块需求编号，再进入实现；没有编号的需求不进入 M3 范围。

## 6. 关键交互、规则与关键决策

本节把分散的需求收敛为团队级的端到端规则，并集中说明三个影响架构与验收口径的关键决策，便于联调与验收时逐项核对。字段级规则仍以模块文档为准。

### 6.1 身份与作用域规则

#### 6.1.1 默认拒绝与认证例外

团队模式采用「默认拒绝 + 明确例外」：除下表列出的端点外，所有团队 API 与 WebSocket 都需要有效用户会话或个人访问令牌。例外不等于无保护：每个例外端点仍必须限流、限制请求体、记录审计，并返回最小必要信息。

| 例外端点 | 认证方式 | 关键约束 |
|---|---|---|
| `GET /api/v1/health` | 无会话 | 只返回状态、版本、时间等最小字段；不泄露数据库连接、配置与成员信息 |
| `POST /api/v1/auth/login` | 邮箱 + 密码 | 失败限流与锁定；登录成功/失败审计；不区分「用户不存在」与「密码错误」的响应 |
| `POST /api/v1/auth/invitations/accept` | 一次性邀请码或邀请链接 | 绑定组织与角色；一次性、可过期；限流；接受后写审计 |
| `POST /api/v1/auth/password-reset/request` 与 `/confirm` | 一次性重置令牌或管理员重置流程 | 不泄露账号是否存在；令牌一次性、短 TTL；限流；重置写审计 |
| `POST /api/v1/runner/register` | 一次性注册令牌 | 15 分钟有效、单次使用；绑定组织与可选 Team Workspace；创建与使用审计 |
| `POST /api/v1/runner/auth/verify` | 机器密钥签名挑战 | 挑战一次性、短 TTL；失败限流；不返回其他机器信息 |
| `POST /api/v1/runner/heartbeat`、`/leases/claim`、`/leases/{id}/renew`、`/leases/{id}/events`、`/leases/{id}/artifacts/*`、`/leases/{id}/release` | 机器签名 | 只允许访问本机有效租约；旧租约写入拒绝；按机器限流 |
| `POST /api/hooks/github` | HMAC 签名 + 时间戳 | 重放窗口、`dedupeKey` 去重、无效签名拒绝并审计；只更新 PR 状态，不触发合并 |

`GET /api/v1/meta`、`/api/v1/events`、`/api/v1/audit-events*`、`/api/v1/machines*`、`/api/v1/runners*` 等管理端点不属于例外，必须带用户会话；WebSocket 在建立连接前校验会话与 Origin，会话过期时发送 `auth.session_expired` 并关闭连接。邀请接受、密码重置与 GitHub Webhook 的具体路径需在 `api-and-data.md` 登记；本章给出认证语义与约束，不替代 API 契约。Runner 端点以 `api-and-data.md` §5.11 为准。

#### 6.1.2 作用域与响应语义

1. **三层作用域**：Organization → Team Workspace → Workspace（`repo_path` 绑定的仓库实体）→ Task/Agent/Run/Artifact/Evidence/Review/Approval/Skill/Crew。所有团队资源必须携带 `organization_id`、`team_workspace_id` 与 `workspace_id`；本地模式三者固定为 `local`/`local`/默认 Workspace，不允许缺失。
2. **先过滤后查询**：所有列表与详情查询必须先按当前成员所属的组织与 Team Workspace 过滤，再按资源 ID 查询；禁止「先按 ID 查出资源再判断权限」造成枚举侧信道。
3. **统一响应语义**：资源不在调用者可见范围内（或存在性本身敏感）返回 **404**，错误体与真正不存在完全一致；资源可见但角色不足返回 **403**，并说明所需角色与申请方式（`SEC-033`）。其他文档中的「404 或 403」表述按此替换；若旧稿或评审记录仍保留「统一 403」的口径，一并回写。
4. **拒绝审计**：404/403 都不产生副作用；403 与跨作用域探测写入拒绝审计，记录 actor、作用域、目标类型与结果，不记录敏感正文。
5. **角色不叠加系统身份**：Runner 与 Agent 不能通过角色继承获得人类权限；系统动作必须标注 `actor_type=system`。
6. **最后 Owner 保护**：组织必须始终至少有一个 Owner；移除或降级最后一个 Owner 的请求被拒绝，除非先完成 Owner 转移（`SEC-035`）。
7. **角色变更即撤销**：成员被降级或移除时，其会话与令牌立即失效；正在进行的审批若需要该角色，必须转交或重新发起。

### 6.2 远程执行与租约规则

1. **出站连接**：Runner 主动连接控制面，不需要开放入站端口；控制面不主动拨号 Runner。
2. **一次性注册**：注册令牌只显示一次、只能使用一次、默认 15 分钟有效；服务端只存令牌哈希；创建、使用、过期与复用失败都写审计。
3. **机器身份与密钥轮换**：注册后使用机器密钥对与签名挑战认证；不使用长期共享密钥；机器私钥保存在操作系统钥匙串或等效安全存储；支持密钥轮换（新公钥登记后旧公钥进入宽限期随后失效）。钥匙串不可用时注册失败并给出可操作提示，不得退化为明文存储（`SEC-013` 的 fail closed 原则）。
4. **能力匹配**：Run 分配必须匹配 runtime、仓库、标签与机器能力；不匹配时保持 queued 并发出 `run.unschedulable`，不把任务硬塞给不满足条件的 Runner。
5. **单一租约与失联**：同一 Run 同一时间只允许一个有效租约；租约状态使用 `active/expired/released/cancelled`，不存在 `revoked` 或 `unknown`。旧租约持有者的事件与证据写入返回 `409 RUNNER_FENCED`。心跳 15 秒、45 秒未心跳标记 Machine `offline`、租约 90 秒未续期失效；Run 进入 `failed`，`errorCode=interrupted`、`failureDetail=runner_lost`（心跳超时）或 `lease_expired`（租约自然到期），不自动跨机重跑。
6. **事件顺序**：同一 Run 的 seq 单调递增；控制面按 seq 去重与排序；断线重连后按 seq 补齐，不能只用「最后一条」覆盖。
7. **证据可验证**：证据上传必须带哈希；控制面校验通过后才将证据计入完成判定；哈希不一致时 Run 标记证据不完整，不允许合并。
8. **离线不等于失败，但终态必须明确**：Runner 离线时 Run 先保留现场与最后事件；租约失效后按第 5 条进入 `failed` + `interrupted`，由人工决定重试（创建新 Run）或放弃，系统不静默重跑、不把 Run 恢复为 `running`。
9. **取消与超时**：控制面通过租约下发取消；Runner 必须终止进程树并回传 `run.cancelled`；超过单 Run 时长上限由控制面标记 `run.failed` + `errorCode=timeout`；取消、超时与失联是三种不同终态，证据与 Run Workspace 的保留策略见 6.6。
10. **凭证生命周期**：Runner 执行 push/PR 时使用用户授权的短期 Git 凭据；凭据来自 Runner 本机钥匙串或凭据助手，控制面不保存可推送仓库的长期凭据；撤销机器时拒绝新租约、取消未开始 Job，并提示轮换可能暴露的 Secret。

### 6.3 共享 Agent 与版本规则

1. **可见性三档**：private 仅创建者可见；team 对 Team Workspace 成员可见且默认只读；shared 对组织内被授权成员可见。private/team 的权威定义见 `agent-system.md` 9.2/AGENT-058；shared 的权威定义见 `security-and-permissions.md` 4.2/4.3。可见性变更需要二次确认并审计。
2. **共享不得夹带私有凭据**：共享 Agent 不得携带创建者的私有 Secret 绑定；从 private 提升到 team/shared 时，若存在私有绑定，必须先解绑或改为团队 Secret；UI 必须提示 instructions、默认权限与 Secret 引用将对更多人可见。
3. **启动即快照**：Run 启动时固化 AgentVersion；快照包含 instructions 哈希、配置哈希、runtime/model、技能版本与权限信封。后续编辑 Agent 不影响已启动 Run。
4. **权限信封随 Run 固化**：允许路径、允许命令、超时与并发限制在 Run 启动时固化；Run 执行期间修改 Agent 不改变本次 Run 的权限。
5. **默认只读**：团队成员使用 team Agent 时默认只读；编辑 team Agent 需要 workspace_admin 及以上；编辑 shared Agent 需要组织 Admin 及以上；转移所有权需要组织 Admin 及以上。
6. **归档而非删除**：被 Run 引用过的 Agent 归档而不删除；归档 Agent 不出现在新 Run 的候选中，但历史 Run 与证据保留。
7. **审计全覆盖**：创建、编辑、克隆、归档、恢复、删除、可见性变更、所有权转移与权限拒绝都写入审计；共享字段（instructions、权限、Secret 引用）的变更需记录差异摘要，不记录 Secret 明文。

### 6.4 审批、四眼与 PR 规则

1. **发起人与审批人分离**：受保护分支合并的审批人不得是 Run 发起人；Owner 覆盖必须填写理由并写入审计，默认不开启。
2. **Agent 不能审批**：Agent、Runner 与系统身份不能创建或批准 Approval；审批必须来自具备权限的人类成员。
3. **审批绑定证据**：审批记录绑定证据哈希与 head commit；证据或 commit 变化后审批失效，必须重新评审。
4. **先审批后推送**：任何 push 到远端或创建 PR 的动作都必须先有覆盖该动作的审批；审批绑定 remote、目标分支、commit 与 diff 摘要；未审批的推送请求被服务端拒绝。
5. **执行归属**：push 与 PR 创建由 Runner 使用用户授权的短期 Git 凭据执行；控制面只下发审批、记录结果与状态，不保存可推送仓库的长期凭据。若未来改为控制面执行，必须单独立项并重新做凭据与分支获取的安全评审。
6. **只推 Run 分支**：推送目标只允许 Run 分支，禁止直接推送受保护分支；禁止 force push 与删除远程分支，除非走独立高风险审批并记录审计。
7. **PR 不自动合并**：系统可以创建 PR、更新状态，但不自动合并；合并由人在 GitHub 完成，或由具备权限的人在 ATeam 中明确批准后调用平台 API。
8. **失败可恢复且幂等**：PR 创建失败时保留本地分支与推送状态，允许重试；重试不得重复创建 PR；以 `github_links` 的 `run_id + repo` 与最后一次成功结果为准；PR 状态事件使用 Webhook 签名与 `dedupeKey`，Webhook 不可达时轮询对账。
9. **凭据最小权限**：Git 凭据只覆盖目标仓库与所需分支操作，短期有效、可撤销；Runner 从本机钥匙串或凭据助手读取，日志与事件中必须脱敏；凭据不可用时失败并提示，不得改用更宽权限的凭据。

### 6.5 审计与异常规则

1. **高风险动作先写审计**：合并、推送、删除、权限变更、Runner 撤销等动作必须在执行前成功写入审计；审计写入失败则动作失败。
2. **审计只追加**：产品不提供更新或删除审计的 API；数据库管理员理论上可以修改，但哈希链与每日锚点会暴露篡改，产品只宣称「可检测」而非「不可篡改」。
3. **审计不含敏感正文**：审计记录资源 ID、摘要、哈希与元数据，不记录完整源代码、完整提示词、模型密钥与凭据明文；diff 只记录文件列表与统计。
4. **保留期统一口径**：`audit_events` 默认保留 180 天，组织可配置为 90 天至 3 年，到期仅归档、不物理删除；物理删除必须走审批并再次审计。`run_events` 默认保留 90 天，单 Run 仍受 20,000 条或 50 MB 截断约束。`api-and-data.md` §9.5 的「永久」表述应回写为本口径。
5. **完整性告警**：哈希链或锚点校验失败、审计队列积压超过阈值时触发 `security.alert`，写入审计并通知 Owner/Admin；告警接收人、频率、静默与恢复按 TEAM-046 定义。
6. **异常有明确归宿**：Runner 离线、租约过期、版本不兼容、证据不完整、跨团队访问、配额耗尽等异常都必须有明确状态、用户提示与人工处置路径，不能停留在「未知错误」。
7. **降级可解释**：WebSocket 断线时降级为轮询；PR Webhook 不可达时降级为轮询；任何降级都必须在界面提示当前数据可能延迟，并保留手动刷新入口。

#### 6.5.1 GitHub Webhook 安全

- Webhook 使用 HMAC 签名校验，校验失败返回 401 并写审计，不改变任何 PR 状态。
- 请求必须携带时间戳，超出重放窗口的请求拒绝；同一 `deliveryId` 或 `dedupeKey` 只处理一次，重复投递幂等。
- Webhook 只用于 PR 状态回写与对账，不能触发合并、审批或 Run；这些动作仍要求用户会话与服务端权限。
- Webhook 不可达时由轮询对账补偿，对账结果与 Webhook 使用同一状态机；对账失败进入告警，不静默丢状态。
- 仓库与 PR 的关联以 `github_links` 为准，收到的 `repo` 与 `pr_number` 不匹配时拒绝并审计。

### 6.6 异常与边界

| 异常 | 系统行为 | 人工处置 |
|---|---|---|
| Runner 离线 | 45 秒未心跳标记 Machine `offline`；租约 90 秒未续期后 Run 进入 `failed`，`errorCode=interrupted`、`failureDetail=runner_lost`；不自动改派 | 恢复 Runner；人工选择重试（新 Run）或放弃 |
| 租约过期 | 停止原 Runner 的执行授权；旧租约事件与证据写入返回 `409 RUNNER_FENCED`；保留现场与最后事件 | 人工确认后重试或放弃 |
| 远程取消 | 控制面通过租约下发取消；Runner 终止进程树并回传 `run.cancelled`；重复取消幂等，不产生额外副作用 | 无需人工；若 Runner 未响应，按失联处理 |
| Run 超时 | 控制面标记 `failed` + `errorCode=timeout`；终止执行并保留最后事件；不自动重跑 | 人工决定重试或调整单 Run 时长上限 |
| 网络分区 | 事件本地缓冲，恢复后按 seq 续传；超过缓冲上限则 Run `failed`/`runner_lost` | 检查证据完整性与事件缺口 |
| Runner 版本或 Runtime 不兼容 | 拒绝新租约（`409 RUNNER_VERSION_INCOMPATIBLE`）并提示升级；已领取 Run 允许完成；不静默回退 mock | 管理员升级 Runner 或 Runtime |
| 仓库凭据失效 | Run `failed`，错误分类为环境问题；不重试到其他机器；不请求更宽权限凭据 | 管理员或机器所有者更新凭据 |
| 证据上传失败 | 保留本地证据并重试；Run 标记证据不完整，禁止合并；源码类证据未获批准时保持本机 | 手动重传、在 Runner 本机查看或导出证据 |
| 跨团队访问 | 不可见返回 404；可见但角色不足返回 403；写拒绝审计 | 管理员核查 |
| 配额耗尽 | 排队并提示预计可执行条件；不占用 Runner 槽位；Task 可显示 `blocked` 原因 | 调整配额或等待 |
| 无可用 Runner | Run 保持 `queued` 并发出 `run.unschedulable`；界面显示缺少的 runtime、标签或能力 | 注册/恢复 Runner，或调整匹配条件 |
| Task 被依赖阻塞 | Task 进入 `blocked`，显示未满足的依赖；不启动 Run | 完成上游 Task 或调整依赖 |
| PR 创建失败 | 保留本地分支与推送状态，允许重试，不重复创建 PR；记录失败原因 | 检查 GitHub 权限、网络与审批状态后重试 |
| Webhook 签名无效或重放 | 返回 401/4xx，不改变状态，写审计；轮询对账继续工作 | 检查 Webhook 密钥与时钟 |
| 审批证据变化 | 原审批失效，返回 412 或等价错误 | 重新评审并批准 |
| 审计哈希链校验失败 | 触发 `security.alert`、写审计并通知 Owner/Admin；导出与写入继续但标记异常 | 安全负责人复核锚点、备份与访问记录 |
| 钥匙串不可用 | Runner 注册或取用凭据失败并提示解锁/安装；不退化为明文存储 | 修复钥匙串后重试 |
| 无审计/无 PR/无 Run 的空状态 | 界面显示明确空状态与下一步入口，不显示空白页或「未知错误」 | 按提示创建数据或调整筛选 |

### 6.7 关键决策：本地优先、认证与 Runner 协议

M3 有六个会直接影响架构、部署与验收口径的决策：本地优先 vs SaaS、认证方式、Runner 协议、数据层、跨机器数据边界、推送与 PR 执行归属。以下为本章决策，需在 M3 设计评审中确认；确认后应回写决策日志或对应模块文档。

#### 6.7.1 本地优先 vs SaaS

**建议决策：M3 只做自托管、单组织的团队模式，不做多租户 SaaS。**

控制面由团队部署在自己的服务器或私有云上；组织和数据归团队所有；ATeam 不托管团队代码、任务内容与审计数据。本地单用户模式继续保留，并作为默认入口。团队模式是显式启用的部署形态，不是强制升级。

理由：

- 本地优先是产品的信任基础。团队模式如果默认把代码与审计上传到厂商云端，会与 PROD-013 的数据主权原则冲突。
- 多租户 SaaS 需要计费、配额、合规、跨租户隔离、运维与支持体系，这些能力会把 M3 从「团队协作」变成「平台运营」，超出当前里程碑的资源与验证范围。
- 2-10 人团队的规模可以用一台控制面服务器加若干 Runner 满足；自托管成本可控，且与开发者的机器所有权一致。
- 自托管让团队可以自行决定备份、保留与网络边界，减少对厂商的信任依赖。

影响：

- M3 必须交付部署文档、TLS 配置、备份恢复、健康检查与升级说明；不能只交付一个需要开发者手工拼装的二进制。
- 不承诺高可用、多活、跨区域容灾；这些属于后续托管版本或企业部署选项。
- 不提供集中计费与订阅；团队自行承担服务器与模型费用。
- 如果未来做托管，必须作为独立产品形态重新做安全评审，不能把 M3 的控制面直接多租户化。

| 方案 | 结论 | 原因 |
|---|---|---|
| 多租户 SaaS | M3 不做 | 数据边界、合规、计费与运维成本过高 |
| 托管单租户 | 可作为 M4 后的商业选项 | 需要独立的安全与运维模型，不影响 M3 架构 |
| 本地 SQLite 直连共享 | 拒绝 | 无法支持并发、权限、审计与远程执行 |
| 双向云同步 | 拒绝 | 冲突语义复杂，容易泄露代码与配置 |

重新评估条件：出现三个以上目标团队明确要求托管版本，且愿意接受相应的数据边界与费用；或者自托管部署成为主要采用障碍，且团队愿意为托管付费。

#### 6.7.2 认证方式

**建议决策：团队模式采用本地账号（邮箱 + 密码，Argon2id 哈希）+ 可选 TOTP；Web 使用 HttpOnly、Secure、SameSite 的会话 Cookie；CLI 与 Runner 使用个人访问令牌或机器密钥；本地模式不强制登录，但保留本地 API 会话令牌。**

具体规则：

- 密码使用 Argon2id 或等效强哈希；服务端不存明文；最小长度、常见密码拒绝、失败限流与锁定阈值可配置。
- 会话有绝对过期与滑动续期；登出、改密、角色变更、成员移除时撤销相关会话。
- 个人访问令牌带作用域（如 `tasks:read`、`runs:write`、`audit:read`）与过期时间；明文只显示一次；服务端只存哈希。
- Runner 不使用个人密码登录，而使用一次性注册令牌换取机器身份，再通过密钥对与签名挑战认证。
- 本地模式保留随机生成的本地 API 会话令牌，防止浏览器中的任意网页调用本地 API；这不等于团队登录，但为 M3 的认证模型打基础。

理由：

- 自托管环境不一定有可用的邮件服务或企业 IdP，密码 + TOTP 是最低依赖、可离线部署的方案。
- OIDC 适合有身份提供商的组织，但把它作为 M3 的必选项会抬高采用门槛；可作为可选适配器，在接口稳定后接入。
- 个人访问令牌适合 CLI、CI 与 Runner 场景，避免在脚本中保存密码。
- 本地模式不强制登录，保持个人开发者的低摩擦体验；团队模式才引入完整身份。

| 方案 | 结论 | 原因 |
|---|---|---|
| 邮箱魔法链接 | M3 不作为主方案 | 自托管需要可靠邮件服务，失败时无法登录 |
| 仅 OIDC | M3 不作为唯一方案 | 要求团队先有 IdP，个人与小团队门槛高 |
| 本地 PIN | 不适合团队 | 无法区分成员，审计无意义 |
| 共享账号 | 拒绝 | 破坏四眼原则与审计追责 |

待确认：是否在 M3 后半段交付 OIDC 适配；是否在 M3 就提供 SMTP 邮件邀请与找回。M3 的默认路径不依赖 SMTP：邀请使用一次性邀请码/链接，密码重置使用一次性重置令牌或由 Owner/Admin 手动重置，Owner 另持有首次创建组织时生成的离线恢复码；邮件邀请与邮件找回只作为可选配置，启用后仍需一次性、短 TTL、限流与审计。详见 TEAM-049 与 Q-M3-04。

#### 6.7.3 Runner 协议

**建议决策：Runner 主动出站连接控制面，使用 HTTPS + WebSocket 与 JSON 消息；注册令牌换取机器身份；机器密钥对 + 签名挑战认证；Run 通过租约下发；事件带 seq 与 ack；证据通过 HTTPS 分片上传；协议版本在握手时校验。**

协议要点：

1. **连接方向**：Runner 主动连接控制面，不需要在团队机器上开放入站端口；控制面不主动拨号 Runner。这样能穿透 NAT 与防火墙，也减少暴露面。
2. **注册**：Admin 生成一次性令牌；Runner 首次启动提交令牌、机器名、OS/架构、标签、能力清单与 Runtime 版本；控制面返回机器 ID、Runner ID、挑战与协议版本；Runner 生成密钥对并把公钥注册到控制面。注册令牌默认 15 分钟有效、单次使用，与 `api-and-data.md` §5.10 一致。
3. **认证**：后续连接使用签名挑战或短期会话票据（TTL 15 分钟）；不使用长期共享密钥；机器密钥保存在操作系统钥匙串或等效安全存储；支持密钥轮换，旧公钥在宽限期后失效。
4. **调度**：控制面按 runtime、仓库、标签、能力与槽位匹配 Run，以租约下发；租约有过期时间与续租；同一 Run 同时只允许一个有效租约，旧租约持有者的事件与证据写入被拒绝（fencing），返回 `409 RUNNER_FENCED`。
5. **事件**：事件包含 runId、seq、type、payload 与时间；Runner 断网时本地缓冲，重连后按 seq 续传；控制面按 seq 去重与排序；事件落库后再确认；超过缓冲上限时 Run 记为 `failed`/`runner_lost`。
6. **证据**：Artifact/Evidence 使用分片上传与哈希校验；支持断点续传；控制面保存索引与校验和；源码类证据默认留在 Runner 本机，是否允许回传按 6.7.5 执行。
7. **心跳与租约**：心跳 15 秒；45 秒未心跳标记 Machine `offline`；租约 90 秒未续期失效，Run 进入 `failed`，`errorCode=interrupted`、`failureDetail=runner_lost`（心跳超时）或 `lease_expired`（租约自然到期）；不自动跨机重跑，必须人工确认后创建新 Run 重试。
8. **版本与 Runtime 能力**：握手包含 Runner 版本、协议版本、Runtime 名称与版本、能力探测结果；不兼容时拒绝新租约（`409 RUNNER_VERSION_INCOMPATIBLE`），但允许完成已领取 Run；升级由管理员手动执行，M3 不做自动更新；未知 Runtime 不得静默回退 mock。
9. **取消**：控制面通过租约下发取消；Runner 终止进程树并回传 `run.cancelled`；超时由控制面标记 `failed`/`timeout`；取消与超时都保留证据与 Run Workspace 记录，不自动删除未合并改动。

理由：

- 出站 WebSocket 兼顾穿透性、实时性与实现成本；JSON 便于调试与跨语言扩展。
- 租约 + fencing 防止两个 Runner 同时执行同一 Run，避免双写与重复副作用。
- 事件 seq/ack 与证据哈希让断线恢复可验证，而不是「大概传完了」。
- 协议版本握手让 M4 的 Runner 升级与兼容有明确边界。

| 方案 | 结论 | 原因 |
|---|---|---|
| gRPC 双向流 | 可作为后续内部协议 | 性能好，但引入 protobuf 工具链与调试成本；M3 先用 WebSocket |
| 长轮询 | 备选降级 | 实现简单，但延迟与请求开销高，不适合大量事件 |
| SSH 反向隧道 | 不采用 | 运维复杂、审计弱、依赖用户环境 |
| 控制面直连 Runner | 拒绝 | NAT/防火墙下不可用，且扩大控制面攻击面 |

待确认：WebSocket 与 gRPC 的最终选择、协议版本兼容矩阵与最低 Runner 版本；远程 Runner 认证采用 mTLS、短期 token 还是两者组合。当前基线为 TLS + 机器密钥签名挑战 + 短期会话票据，`05-risks-and-open-questions.md` 的 RSK-SEC-007 明确不要求双向 TLS 客户端证书；若威胁建模要求 mTLS，作为 Q-M3-05 的备选并评估部署与密钥轮换成本。以上均在第 16 节记录。

#### 6.7.4 数据层选择

**建议决策：扩展 `internal/store.Store` 接口，提供 SQLite 与 Postgres 两套实现；本地模式用 SQLite，团队模式用 Postgres；不做双写；迁移工具一次性导入。**

约束与影响：

- 领域模型与 Store 接口保持不变或向后兼容扩展；新增实体通过接口扩展，不修改既有 Task/Agent/Run 的语义。
- SQL 方言差异（自增、JSON、时间戳、索引、并发控制）必须在 Postgres 实现中显式处理；迁移脚本按数据库分目录管理，不共用同一份 SQL。
- 对 Store 的关键行为建立契约测试，同一组测试分别跑 SQLite 与 Postgres，防止行为漂移。
- 迁移工具必须支持预检、快照、字段映射、导入、校验与回滚；迁移前自动备份；校验至少包含行数、关键字段哈希与证据校验和；字段映射表见 7.4。
- **迁移范围决策**：M3 交付一次性导入器，不做双写；这与 `01-scope-and-roadmap.md` §4.5.2/§4.5.3 的 M3 范围一致。`api-and-data.md` §9.4 中「不承诺 SQLite 到 Postgres 的自动数据搬迁、是否需要导入工具列为待确认」的表述属于旧口径，应在 M3 范围冻结时回写为「M3 交付一次性导入器，默认新建 Postgres，导入为可选步骤」。
- 迁移完成后旧 SQLite 以只读快照保留；快照的保留期、删除审批与「不含新数据」校验见 7.4，不得无限期保留含敏感源码的旧库副本。
- 不支持 SQLite 与 Postgres 同时写入；团队模式启用后，SQLite 仅作为迁移来源或本地离线工作区。

#### 6.7.5 跨机器数据边界与证据分级

M3 的「代码不出本机」不是一句口号，而是可验证的默认传输策略。控制面与 Runner 之间的数据按以下分级处理：

| 数据 | 默认策略 | 可选上传 | 约束 |
|---|---|---|---|
| RunEvent、状态、进度、错误摘要 | 上传 | — | 落库前脱敏；单条 8 KiB、单 Run 20,000 条/50 MB 截断 |
| 测试/构建结果摘要、退出码、耗时 | 上传 | — | 不包含完整源码；失败输出截断并脱敏 |
| 证据哈希、校验和、文件列表与改动统计 | 上传 | — | 用于远程评审与完整性校验 |
| diff/patch、截图、完整日志包等含源码内容的证据 | 留在 Runner 本机 | 项目级 `allowSourceEvidenceUpload` + 逐次审批 | 审批人不得是上传发起人；上传前脱敏；上传动作审计 |
| 模型密钥、Git 凭据、Secret 明文 | 永不上传 | — | 只存在于 Runner 本机钥匙串或环境；控制面只保存引用与状态 |

规则：

1. 默认关闭 `allowSourceEvidenceUpload`；开启需要 Team Workspace 的 workspace_admin 或组织 Admin 审批并写审计，关闭立即停止新上传。
2. 每次源码类证据上传都需要独立审批，绑定 Run、证据类型、大小、哈希与接收范围；审批过期或证据变化则上传失效。
3. 未开启或未获批时，远程评审只展示文件列表、改动统计、事件/日志、测试结果摘要与哈希；完整 diff 通过在 Runner 本机的受控查看器或经批准的加密通道查看，不在控制面落盘。
4. 上传前统一脱敏（`sk-`、`ghp_`、`AKIA`、JWT、私钥块等）；脱敏失败丢弃字段而不是原样上传。
5. 已上传的源码类证据按项目保留策略处理，默认不超过 30 天；删除需审批并审计；团队导出不得绕过该边界。
6. 该策略与 `01-scope-and-roadmap.md` 的 SCOPE-010（数据默认留在本机）与 §4.5.3 第 4 条、`security-and-permissions.md` 的 SEC-012/SEC-071 与 `runtime-and-workspace.md` §10.3 对齐；任何放宽都必须走范围评审与安全评审。

#### 6.7.6 推送与 PR 的执行归属与凭据

**决策：由 Runner 执行 push 与 PR 创建，使用用户授权的短期 Git 凭据；控制面只下发审批、记录结果与状态。**

理由与约束：

- 控制面不持有可推送仓库的长期凭据，也不需要访问 Runner 上的 Run 分支；这与 `01-scope-and-roadmap.md` §4.5.3 第 7 条和 `runtime-and-workspace.md` §9.4 一致。
- 审批在控制面生成，绑定 remote、目标分支、head commit、diff 摘要与审批人；Runner 在执行前校验审批指纹与 commit，任一不匹配则拒绝推送并回报 `approval_invalidated`。
- Git 凭据由用户在 Runner 本机授权，保存在钥匙串或凭据助手，短期有效、按仓库最小权限；控制面、日志、事件与证据中不得出现凭据明文。
- 推送失败或 PR 创建失败时保留本地分支与推送状态，允许重试；重试以 `github_links` 的 `run_id + repo` 去重，不重复创建 PR。
- 全部动作写入审计：申请人、审批人、remote、分支、commit、diff 摘要、推送结果、PR URL 与失败原因。
- 若未来改为控制面执行推送，必须单独立项，定义控制面如何取得仓库凭据与 Runner 分支，并重新做安全评审；M3 不采用该方案。

## 7. 数据与 API 影响

### 7.1 数据模型影响

M3 需要在 `prd/02-domain-model.md` 的现有实体之外新增或扩展以下对象。字段级定义由领域模型与模块文档负责，此处只列出里程碑级影响。

**层级关系（先统一语义）**：Organization → Team Workspace → Workspace（绑定 `repo_path` 的仓库实体）→ Task/Agent/Run/Artifact/Evidence/Review/Approval/Skill/Crew。Workspace 是 M1 引入的产品级归属实体，Run Workspace 是某次 Run 的隔离执行环境，二者不是同一层；Team Workspace 是 M3 新增的团队资源边界，位于 Workspace 之上。`workspace_id` 是唯一字段名，`project_id` 仅为旧输入别名；`team_workspace_id` 在团队模式必填，本地模式固定为 `local`。不新增第四层实体，也不把 Team Workspace 与 Workspace 合并为同一张表。

| 对象 / 表 | 变化 | 说明 |
|---|---|---|
| `users` | 新增 | 团队成员账号；邮箱、显示名、密码哈希（Argon2id）、状态、最后登录、创建时间；不存明文密码与令牌 |
| `organizations` | 新增 | 最高作用域；名称、创建者、创建时间、状态 |
| `team_workspaces` | 新增 | 团队资源边界；`organization_id`、名称、创建者、创建时间；Workspace 归属于它 |
| `memberships` / `workspace_memberships` | 新增 | 组织级与 Team Workspace 级成员关系分开存储：`memberships`（`organization_id`、`user_id`、`role`）与 `workspace_memberships`（`workspace_id`、`user_id`、`role`），含邀请状态与加入时间。表名以 `api-and-data.md` §9.3 为准；`workspace_memberships` 即 Team Workspace 成员表，不再引入 Project/Workspace 命名分支 |
| `sessions` / `personal_access_tokens` | 新增 | 会话与个人令牌；只存哈希，记录作用域、过期时间与最后使用 |
| `workspaces` | 扩展 | M1 的仓库绑定实体；M3 增加 `organization_id`、`team_workspace_id`；`repo_path` 创建后不可原地修改。不建同名 `projects` 表 |
| `machines` | 新增 | `id`、`organization_id`、`owner_id`、名称、OS/架构、`hostname_hash`、`public_key`/`key_id`、状态 `pending/online/offline/draining/disabled`、标签、能力、`shared`、`allowed_team_workspace_ids`、`disk_quota`、`max_concurrency`、最后心跳、注册与撤销时间 |
| `runners` | 新增 | `id`、`machine_id`、`project_id`、模式、状态 `idle/busy/draining/offline/disabled`、并发、活跃 Run 数、版本、协议版本、最后心跳 |
| `run_leases` | 新增 | `id`、`run_id`、`runner_id`、`machine_id`、状态 `active/expired/released/cancelled`、过期与续租时间、`fenced_token` |
| `audit_events` | 新增 | 只追加审计；作用域、actor、action、resource、source、结果、原因码、元数据、`prev_hash`、`hash`、`seq`、每日锚点引用 |
| `audit_anchors` | 新增 | 组织级每日锚点；`organization_id`、`anchor_hash`、周期起止 |
| `github_links` | 新增 | Run 与 PR 的关联；`run_id`、`repo`、`pr_number`、`pr_url`、创建与更新时间 |
| Task/Agent/Run | 扩展 | 增加 `organization_id`、`team_workspace_id`、`project_id`、`created_by`、`owner_id`、`visibility` 等字段；Run 增加 `runner_id`、`error_code`、`failure_detail`、AgentVersion 快照引用 |
| Approval | 扩展 | 增加审批人身份、角色、证据哈希、四眼校验结果与覆盖理由 |

约束：

- 所有团队资源必须带 `organization_id`、`team_workspace_id` 与 `workspace_id`；缺失作用域的写入被拒绝；本地模式三者固定为 `local`/`local`/默认 Workspace。
- 审计事件不可更新、不可删除；哈希链按组织分区，每日生成锚点；保留默认 180 天、可配置 90 天至 3 年，仅归档。
- 删除采用软删除或归档；审计、Run、Evidence 按保留策略处理，不能被普通删除操作直接清除。
- 时间统一 UTC；ID 由服务端生成；跨表引用不得出现悬空记录。
- `team_workspaces`、`machines`、`runners` 的字段需要回写 `api-and-data.md` §9.3 与 `02-domain-model.md` §3.14；`02-domain-model.md` 中「Workspace 是根实体、无上级归属」的表述仅适用于本地单用户模式，团队模式需补充 `team_workspace_id`。

### 7.2 API 影响

M3 新增的 API 以 `prd/modules/api-and-data.md` 为唯一契约来源：Machines 与注册令牌见 §5.10，Runner 作业协议见 §5.11，认证、成员、令牌、审计与 PR 端点见 §5.13 的端点总表，事件见 §6.3，表结构见 §9.3。本章只列里程碑级能力与约束，路径、请求/响应结构、错误码与分页规则不在本章重复定义。

| 资源 | 能力 | 关键约束 |
|---|---|---|
| Auth | `POST /api/v1/auth/login`、`/logout`、邀请接受、密码重置、会话续期 | 登录失败限流；会话 Cookie 使用 HttpOnly/Secure/SameSite；CSRF 防护；不把令牌放在 URL；邀请/重置令牌一次性 |
| Members / Invitations | `GET/POST/PATCH/DELETE /api/v1/members`、邀请、角色变更、移除、转交 | 仅 Owner/Admin；最后 Owner 保护；角色变更即时生效并审计 |
| Tokens | `GET/POST/DELETE /api/v1/tokens` | 明文只显示一次；作用域与过期时间；撤销立即生效 |
| Team Workspaces | 创建、读取、更新、归档 | 作用域隔离；归档需二次确认；删除需双人审批 |
| Agents | 列表、创建、编辑、归档、转移所有权、可见性变更 | 按可见性过滤；team 默认只读；shared 编辑需组织 Admin；版本快照 |
| Machines / Runners | `GET /api/v1/machines`、`POST /api/v1/machines/register-tokens`、`PATCH /api/v1/machines/{id}`、`POST /api/v1/machines/{id}/revoke`、`DELETE /api/v1/machines/{id}`；`/api/v1/runner/*` | Owner/Admin 管理（Owner 始终可管理，Admin 受角色限制）；注册令牌 15 分钟一次性；撤销立即拒绝新租约 |
| Runs | 在团队模式下列表、读取、取消、重试、`POST /api/v1/runs/{id}/pull-request` | 按 Team Workspace 过滤；取消/超时按 TEAM-041；租约与 Runner 归属可查 |
| Audit | `GET /api/v1/audit-events`、`/export`、`/verify` | 仅 Owner/Admin；只追加；默认最近 30 天视图；导出动作审计；校验失败告警 |
| GitHub PR | 创建、读取状态、重试、状态回写 | 审批后由 Runner 推送；不自动合并；失败可重试；Webhook 签名校验 |
| Health / Meta | 健康检查与能力发现 | 健康检查最小暴露；`/meta` 需会话，不返回敏感配置 |
| Runner 协议 | 注册、认证、心跳、租约、事件、证据上传、释放 | 机器签名认证；旧租约写入 409；限流；与人类会话认证域分离 |

API 权限与错误语义：不可见资源返回 404，可见但角色不足返回 403；写拒绝与 403 写审计；错误体包含 `code`、`message`、`details`、`requestId`，不泄露资源存在性与敏感正文。认证例外端点严格按 6.1.1 执行，不得因为「内部端点」而放宽。

### 7.3 事件与 WebSocket 影响

M3 的事件以 `prd/modules/api-and-data.md` §6.3 的事件目录为唯一基线；本章不另造第二套命名。事件命名保持 `aggregate.past_tense` 风格，负载包含对象 ID、作用域与状态，客户端必须幂等处理。

| 事件 | 里程碑 | 载荷要点 | 生产者 → 消费者 | 幂等与顺序 |
|---|---|---|---|---|
| `machine.online` / `machine.offline` / `machine.draining` / `machine.disabled` / `machine.revoked` / `machine.updated` | M3 | 机器摘要与 `lastSeenAt` | 控制面 → UI/审计 | 按 `machineId` 去重；事件 ID 幂等 |
| `runner.registered` / `runner.lease_granted` / `runner.lease_expired` / `runner.disconnected` / `runner.revoked` | M3 | `{runnerId, machineId, leaseId?, runId?}` | 控制面 → UI/审计 | 按 `runnerId + leaseId` 去重 |
| `run.unschedulable` | M3 | `{runId, reason}` | 控制面 → UI/收件箱 | 按 `runId + reason` 合并 |
| `run.cancel_requested` / `run.cancelled` / `run.timeout` | M1/M3 | Run 快照或 `{id, requestedAt}` | 控制面 → UI/审计 | 按 `runId + 终态` 去重 |
| `run.failed` | M1/M3 | `{runId, errorCode, failureDetail}`；失联与租约过期都走此事件，不新增 `run.interrupted` | 控制面/Runner → UI/审计 | 终态只发一次 |
| `run.queued` / `run.preparing` / `run.running` / `run.updated` / `run.completed` | M0/M1 | Run 快照 | 控制面 → UI | 非终态按 `runId + 更新序号` |
| `approval.requested` / `approval.decided` / `approval.expired` / `approval.consumed` / `approval.revoked` | M2 | Approval 摘要 | 控制面 → UI/收件箱 | 按 `approvalId` 状态机 |
| `agent.updated`（可见性/所有权变更） | M3 | `{id, change: "visibility" 或 "ownership", visibility?, ownerId?}` | 控制面 → UI/审计 | 按 `agentId + revision` |
| `auth.login_succeeded` / `auth.login_failed` / `auth.session_revoked` / `auth.session_expired` | M3（待登记） | `{userId?, sessionId?, reason?}` | 控制面 → 安全审计/UI | 按事件 ID；不广播敏感元数据 |
| `member.invited` / `member.role_changed` / `member.removed` | M3（待登记） | `{memberId, role?, scope}` | 控制面 → UI/审计 | 按 `memberId + revision` |
| `github_pr.created` / `github_pr.status_changed` | M3（待登记） | `{runId, repo, prNumber, prUrl, status}` | 控制面 → UI/审计 | 按 `runId + prNumber` |
| `security.alert` | M3（待登记） | `{kind, severity, resourceId?, summary}` | 控制面 → Owner/Admin | 按 `kind + resourceId` 去重与恢复 |
| `audit.appended` | M3 可选（待登记） | 管理员视图摘要，不含敏感元数据 | 控制面 → Admin UI | 按 `seq` |
| `events.replay_reset` | M1 | `{reason, lastSeq}` | 控制面 → 客户端 | 客户端重新拉取快照 |

事件治理：

- 新事件（`auth.*`、`member.*`、`github_pr.*`、`security.alert`、`audit.appended`）必须先登记到 `api-and-data.md` §6.3 并提升 `meta.eventCatalogVersion`；未登记不得上线。
- 已登记但本章未改名的事件（如 `machine.*`、`runner.*`）以目录为准；旧名至少保留一个里程碑的并行发送期，并在 `data.deprecation` 标注。
- 客户端遇到未知 `type` 必须忽略，不得报错或丢弃后续事件；同一资源的状态以快照为准，事件只用于增量。
- WebSocket 在团队模式下必须校验会话与来源；断线重连按 `afterSeq` 补齐；不得把其他 Team Workspace 的事件推送给无权限连接；Reviewer/Viewer 不接收含敏感元数据的事件。
- 事件载荷不得包含 Secret、完整源码、凭据或绝对家目录路径；落库前统一脱敏。

### 7.4 迁移影响

- 从 M2 SQLite 到 M3 Postgres 的迁移是单向的；迁移前自动备份，失败回滚；不做双写与持续同步。
- 导入器必须支持预检、快照、字段映射、导入、校验、切换与回滚七个步骤，并输出可审计的迁移报告（含字段映射版本、跳过项、异常项与校验结果）。
- **字段映射**：

| SQLite（M0-M2） | Postgres（M3） | 规则 |
|---|---|---|
| `tasks.id`、`agents.id`、`runs.id` 等 24 位十六进制 ID | 同名字段 | 保持原值，不重新生成；冲突则预检失败 |
| `workspace_id` | `workspace_id` | 保持同名同值；旧 `project_id` 输入别名在导入时归一化为 `workspace_id`；无对应 Workspace 时归入默认 Workspace `default` |
| 无 | `organization_id` | 由迁移向导创建的组织 ID 回填 |
| 无 | `team_workspace_id` | 由迁移向导创建的默认 Team Workspace ID 回填 |
| `actor_id`（本地用户名/机器标识） | `actor_type=local` + 原 `actor_id` | 不伪造团队成员账号；历史审计保留原标识 |
| 毫秒时间戳 | UTC `timestamptz`/毫秒整数 | 统一 UTC；不保留本地时区偏移 |
| JSON TEXT（`labels`、`payload` 等） | JSONB | 导入前校验可序列化与大小上限；非法 JSON 进入异常项 |
| `run_events(run_id, seq)` | 同结构 + 唯一约束 | 重复 `(run_id, seq)` 保留最大 `id` 并写入异常项 |
| 证据文件路径 | 对象存储/文件系统引用 | 校验 SHA-256；路径规范化；不复制未登记文件 |

- 校验至少包含：每表行数、关键字段哈希（Task 标题/状态、Agent 配置哈希、Run 终态与错误码）、证据校验和、外键与孤儿记录、抽样字段对照；任一不一致则回滚，不进入切换。
- 迁移后的组织与默认 Team Workspace 由执行迁移的管理员拥有；历史数据归入默认 Team Workspace；历史审计标注 `actor_type=local`；迁移动作本身写入新审计账本。
- **旧 SQLite 只读快照生命周期**：切换后旧库以只读快照保留，权限 0600；默认保留 30 天、最长 90 天，具体期限由 Owner/Admin 在迁移报告中确认；删除前必须验证快照哈希未变化、不含切换后的新数据（以切换水位与快照 mtime/哈希为准），删除需 Owner/Admin 审批并审计；快照不得被重新挂载为团队数据库。
- 迁移不改变 Task、Agent、Run 的业务语义；字段映射与默认值由领域模型文档定义；`api-and-data.md` §9.4 的「是否需要导入工具待确认」按 6.7.4 的决策回写。

## 8. 交付物

### 8.1 交付物清单

| 编号 | 交付物 | 内容 | 验收责任 |
|---|---|---|---|
| D-M3-01 | Postgres 数据层与迁移工具 | Postgres schema、迁移脚本、SQLite 导入器（字段映射、预检、快照、校验、回滚）、旧快照生命周期、备份恢复命令 | 后端 |
| D-M3-02 | 身份与会话服务 | 用户、密码哈希、登录、登出、会话、个人访问令牌、限流、邀请接受、密码重置与恢复码 | 后端/安全 |
| D-M3-03 | 组织、Team Workspace 与角色 | 组织、Team Workspace、Workspace 归属、成员、邀请、两层四角色、最后 Owner 保护、角色继承与防提权 | 后端/产品 |
| D-M3-04 | 权限中间件 | 两层角色矩阵、作用域查询、404/403 语义、拒绝审计、跨团队隔离测试 | 后端/安全 |
| D-M3-05 | 远程 Runner | `ateam runner` 命令、注册、密钥、密钥轮换、签名挑战、心跳、租约、版本握手、取消与进程树终止 | 后端 |
| D-M3-06 | 机器与调度 | Machines 页面与 API、能力与标签、槽位、draining、撤销、配额、工作目录与磁盘配额 | 后端/前端 |
| D-M3-07 | 远端 Workspace 与证据回传 | 每 Job 独立目录、worktree、路径/命令策略、事件缓冲、证据分片与哈希、跨机器数据边界 | 后端/安全 |
| D-M3-08 | 共享 Agent | 可见性、所有权、版本快照、编辑权限、Secret 绑定检查、归档、审计 | 后端/前端 |
| D-M3-09 | 团队审计账本 | 审计模型、哈希链、锚点、查询、导出、保留与完整性校验、告警 | 后端/安全 |
| D-M3-10 | GitHub PR 集成 | Runner 侧 push/PR 执行、短期 Git 凭据、审批绑定、PR 创建、Webhook 与轮询对账、失败重试 | 后端/集成 |
| D-M3-11 | 团队 UI | 登录、邀请接受、Access、Machines、Audit、PR 面板、只读与权限状态、加载/空/离线状态 | 前端/设计 |
| D-M3-12 | 部署与运维文档 | 控制面部署、TLS、Postgres、备份恢复、升级、Runner 安装、故障排查 | 工程/文档 |
| D-M3-13 | 测试与演示环境 | Postgres 测试库、2 成员 + 1 Runner 脚本、取消/超时/断线故障注入、Webhook 签名测试、权限矩阵测试、M3 容量压测数据集 | QA/工程 |
| D-M3-14 | 团队试点报告 | 2-10 人团队使用记录、指标、缺陷、退出评审结论 | 产品 |
| D-M3-15 | M3 入口门与拆分预案报告 | M1/M2 退出标准复核、M2 权限模型与审计 schema 冻结证明、前置差距审计、M3.1/M3.2 拆分条件评估 | 产品/工程/安全 |

交付物不是文件清单，而是可验收的能力。每个交付物必须能在干净环境中复现；仅在开发者本机可用不算交付完成。

### 8.2 模块分工与文档指针

M3 的模块细节不在本章展开，按以下指针阅读：

| 能力 | 权威文档 | 本章引用的需求 |
|---|---|---|
| 跨里程碑范围、里程碑依赖与变更规则 | `prd/01-scope-and-roadmap.md`（§4.5、§5.3、§7、§11.1） | MILE-001、MILE-005、MILE-008；TEAM-013 至 TEAM-049 的范围判定 |
| REST/WS 契约、事件目录、表结构、错误码、迁移策略 | `prd/modules/api-and-data.md`（§5.10、§5.11、§5.13、§6.3、§7.4、§9.3、§9.4、§17.3） | TEAM-015 至 TEAM-049 的端点、事件与字段依据 |
| 团队角色、权限矩阵、Runner 安全、审计 | `prd/modules/security-and-permissions.md`（§4.2、§4.3、§4.6、§7、§8） | SEC-030 至 SEC-038、SEC-040 至 SEC-044、SEC-052 至 SEC-054；TEAM-013 至 TEAM-017、TEAM-028 至 TEAM-029、TEAM-036、TEAM-039、TEAM-045 至 TEAM-046 |
| 机器、Runner、工作区、Git 推送与 PR | `prd/modules/runtime-and-workspace.md`（§7、§8、§9.4、§10） | TEAM-020 至 TEAM-027、TEAM-031 至 TEAM-032、TEAM-041 |
| 共享 Agent、可见性、版本、审计 | `prd/modules/agent-system.md`（§9.2、§10.7） | AGENT-058 至 AGENT-060 覆盖 private/team；shared 的权威定义在 security §4.2/§4.3；TEAM-018 至 TEAM-019 |
| 审批门、四眼原则、证据化 DoD | `prd/modules/collaboration-and-review.md`（§8、§9、§16.2）与 `prd/02-domain-model.md`（DM-APPR-007） | COLLAB-049、COLLAB-079、DM-APPR-007；TEAM-030 |
| 任务、看板、团队筛选 | `prd/modules/task-management.md`（§2、§6） | TASK 系列；TEAM-038 |
| 团队界面与权限状态 | `prd/modules/ui-ux.md`（§11.2、§14） | UI-089、UI-130；TEAM-037、TEAM-043 |
| 性能、可靠性、成本、保留与发布门禁 | `prd/modules/non-functional-requirements.md`（§6、§7.5、§12.4） | NFR-PERF-004、NFR-COST-006、§7.5 保留策略、§12.4 M3 门禁；TEAM-027、TEAM-035、TEAM-036、TEAM-047 |
| 领域实体与状态机 | `prd/02-domain-model.md`（§3.14 Machine/Runner、§3.11/§4.6 Approval、§4.3 Run 状态机） | TEAM-019、TEAM-021 至 TEAM-022、TEAM-028 |
| 团队用户流程 | `prd/03-user-flows.md`（流程 F） | 流程 F 用 FLOW-F-001～017 描述团队模式用户流程；TEAM-001 至 TEAM-012 在本章 5.1 定义，角色词表以 security §4.2 为准 |
| 里程碑验收与演示 | `prd/04-acceptance-and-test-plan.md`（§4.4） | 本章第 9、13 节 |
| 风险与开放问题 | `prd/05-risks-and-open-questions.md`（M3 行、OQ-009） | 本章第 11、16 节 |

如果模块文档与本章冲突，以模块文档中的字段级与流程级定义为准；本章负责里程碑范围与验收，不负责重新定义字段。发现冲突时应回写修正，而不是在两处各自解释。

### 8.3 实施顺序与阶段门

M3 的复杂度主要来自「身份 × 作用域 × 机器 × 审计」的交叉。建议按以下顺序交付，每一阶段都有明确阶段门，不通过不得进入下一阶段：

| 阶段 | 主要内容 | 阶段门 |
|---|---|---|
| M3-0 入口门 | 复核 M1/M2 退出标准、M2 权限模型与审计 schema 冻结、前置差距审计、角色词表与容量口径确认 | 第 13.0 节入口门全部满足；未满足项不得进入 M3-A |
| M3-A 数据与身份地基 | Postgres Store、迁移工具、User/Organization/Team Workspace/Membership、登录与会话、权限中间件骨架 | 本地模式回归通过；登录/登出/令牌测试通过；迁移预检与回滚演练通过 |
| M3-B 作用域与共享 Agent | Team Workspace 作用域、Workspace 归属、共享 Agent 可见性/所有权/版本快照、拒绝审计 | 不可见资源全部 404、可见但角色不足全部 403；共享 Agent 快照可复现；权限矩阵自动化测试通过 |
| M3-C Runner 与调度 | `ateam runner`、注册令牌、心跳、能力、租约、远端 Workspace、事件与证据回传、取消与超时 | 远程 Run 端到端通过；断线/租约/重连/取消/超时测试通过；无双跑与静默重跑 |
| M3-D 审计与审批联动 | 审计账本、哈希链、四眼原则、审批与证据哈希绑定、PR 创建与状态回写、Webhook 安全 | 高风险动作审计覆盖率 100%；自批被拒绝；PR 仅在审批后由 Runner 创建；哈希链校验失败告警可用 |
| M3-E UI 与部署 | Access、Machines、Audit、PR 面板、只读与权限状态、加载/空/离线状态；TLS、备份恢复、部署文档 | 干净环境部署成功；权限不足态可理解；备份恢复演练通过 |
| M3-F 试点与退出 | 2-10 人团队试点（至少连续两周）、指标采集、缺陷收敛、退出评审 | 第 13 节退出标准全部满足；无红色风险；M4 启动条件确认 |

阶段门的意义是防止「功能都做了但不可用」：例如先做 UI 而没有服务端权限，会制造安全的假象；先做 Runner 而没有审计，会无法追责。每个阶段结束时应有一次可演示的增量，而不是等到最后一次性验收。

## 9. 演示脚本

### 9.1 演示目标与前置条件

演示要证明的不是「页面能打开」，而是团队模式的七个关键行为：身份、共享、远程执行、证据、四眼审批、PR 与审计。演示环境如下：

- **控制面**：一台自托管服务器，Postgres 已初始化，TLS 已配置，健康检查通过。
- **成员 A**：Owner，同时具备 Contributor 能力；负责创建任务、启动 Run、尝试自批。
- **成员 B**：Reviewer；负责评审与批准合并，PR 由 Runner 在批准后创建；不能修改共享 Agent。
- **远程 Runner R1**：一台独立机器，已安装 `ateam runner`，标签 `linux`、`mock`，处于 online 状态，并已配置短期 Git 凭据。
- **演示仓库**：`ateam-demo`，`main` 为受保护分支；GitHub 侧已配置 PR 状态集成与 Webhook 签名密钥。
- **共享 Agent**：`team-frontend`，可见性 `team`，runtime 为 `mock`，配置了允许路径与允许命令。
- **确定性**：核心演示使用 mock Runtime，保证每次运行步骤与证据一致；如果环境允许，可追加一次真实 Claude Code Run 作为可选步骤。

### 9.2 演示步骤

| 步骤 | 角色 | 操作 | 预期可观察结果 | 时长 |
|---|---|---|---|---|
| 0 | 成员 A | 打开控制面，登录，进入 Access 与 Machines 页面 | 看到成员 A（Owner）、成员 B（Reviewer）与 Runner R1（online，最近心跳可见）；审计显示最近的登录与 Runner 注册记录 | 1 分钟 |
| 1 | 成员 A | 在团队 Board 创建任务「账单页空状态」，补充验收标准，选择共享 Agent `team-frontend`，点击 Run | Task 创建成功；Run 进入 queued；界面显示选择的是共享 Agent 且当前版本可见 | 2 分钟 |
| 2 | Runner R1 | 自动领取租约并执行 | Machines 显示 R1 busy；Run 进入 preparing/running；远端创建独立 worktree；事件流实时回传「读取仓库、修改组件、运行测试、生成摘要」 | 3 分钟 |
| 3 | 成员 B | 从另一台电脑登录，打开同一 Task 与 Run | B 能看到任务、Run 事件（含脱敏日志）、证据清单与哈希；默认看不到 diff 正文，需在 Runner 本机或经批准的加密通道查看；B 不能修改共享 Agent；B 的界面显示 Reviewer 可用的审批入口 | 2 分钟 |
| 4 | 成员 A | Run 完成后点击 Request merge，并尝试自己批准 | A 的自批被拒绝，界面说明「发起人不能批准自己的合并」；审计出现拒绝记录 | 2 分钟 |
| 5 | 成员 B | 打开评审，查看 diff 统计、测试结果与证据哈希；在 Runner 本机查看完整 diff（或经批准上传），留下评论并批准 | 审批记录包含 B、时间、证据哈希；Runner 使用短期 Git 凭据推送 Run 分支并创建 GitHub PR；控制面显示 URL/编号；Task 显示 PR 链接 | 3 分钟 |
| 6 | 成员 B | 在 GitHub 合并 PR | GitHub 显示 merged；控制面通过 Webhook 或轮询收到状态；Task 进入 done；审计记录 PR 合并 | 2 分钟 |
| 7 | 成员 A | 启动第二个 Run，执行中点击取消；再次点击取消 | 控制面通过租约下发取消；Runner 终止进程树并回传 `run.cancelled`；Run 进入 cancelled；重复取消幂等；证据与 Run Workspace 记录保留 | 2 分钟 |
| 8 | 成员 A | 启动第三个 Run，执行中杀掉 Runner 进程 | Machines 在 45 秒后标记 R1 offline；租约 90 秒未续期后 Run 进入 failed，errorCode=interrupted、failureDetail=runner_lost；没有在其他机器上自动重跑；审计记录租约失效 | 2 分钟 |
| 9 | 成员 A / 成员 B | 成员 A 重启 Runner；随后成员 B 尝试修改共享 Agent | Runner 重新上线；人工选择重试（创建新 Run）或放弃，Run 不会自行恢复 running；B 修改共享 Agent 返回 403 并写入审计 | 2 分钟 |
| 10 | 成员 A | 打开 Audit，按 actor/action/time 过滤并导出 JSON；运行哈希链校验 | 审计包含登录、Agent 使用、Run、取消、审批、PR、Runner 离线、越权拒绝；哈希链校验通过；导出动作本身也被审计 | 2 分钟 |

**主演示严格控制在 15 分钟内**（与 `04-acceptance-and-test-plan.md` §1.2 的演示上限一致）：步骤 0–6 与步骤 9–10 构成主脚本。取消、故障注入（步骤 7、8）与审计哈希链校验拆为独立的「故障注入与审计验收」，单独执行约 8 分钟，不计入 15 分钟主演示；两者都通过才算 M3 退出。若时间受限，可把步骤 7 的重复取消合并为一次、把步骤 8、9 合并为「杀掉 Runner 并观察 failed + interrupted/runner_lost」，但不得省略审计核对与证据边界说明。

### 9.3 演示判定

演示通过必须同时满足：

- 未登录访问团队 API 返回 401；Reviewer 修改共享 Agent 返回 403；不可见资源返回 404、可见但角色不足返回 403，错误体不泄露存在性。
- Run 使用共享 Agent 的版本快照；B 修改 Agent 后，已启动 Run 的配置不变。
- Runner 注册、心跳、领取、事件回传与证据上传全部可见；远端 Workspace 与本地控制面文件系统隔离；默认只上传元数据、摘要与哈希，diff 等源码证据留在 Runner 本机。
- A 不能批准自己的合并；B 批准后由 Runner 推送并创建 PR；PR 状态能回写 Task。
- 远程取消能在合理时间内终止进程树并进入 cancelled；重复取消幂等；超时进入 failed + timeout。
- Runner 断线后 Run 进入 failed + interrupted/runner_lost，不静默重跑；恢复路径明确；审计完整。
- 审计覆盖所有高风险动作，且可按人、动作、资源与时间查询与导出；哈希链校验失败时告警可触发。

任一条件不满足即演示失败，不能以「这是演示环境」为由跳过。演示环境本身也是 M3 交付物 D-M3-13 的一部分。

## 10. 依赖

### 10.1 里程碑依赖

- **M1 本地闭环**：worktree、分支、diff、Artifact/Evidence、人工合并、真实 Runtime、取消与超时。没有这些，团队模式没有可评审的产出。
- **M2 角色 Agent 协作**：DAG、交付物契约、角色模板、路径/命令权限、审批门、收件箱、并行调度。没有这些，团队权限没有可治理的对象。
- **M2 权限模型与审计 schema 冻结**：按 `01-scope-and-roadmap.md` MILE-005，M3 不得在 M2 的权限模型与审计事件 schema 冻结前启动；冻结证明、逐项复核记录与未通过项清单是 M3-0 入口门的交付物。
- **M3 内部顺序**：第 8.3 节的 0 至 F 阶段门；前一阶段不通过不得进入下一阶段。
- **M3.1/M3.2 拆分条件**：若威胁建模或安全评审发现远程 Runner 的高危问题无法在里程碑内关闭，按 `01-scope-and-roadmap.md` §8.2 拆分为 M3.1（Postgres、登录、权限、审计）与 M3.2（远程 Runner、GitHub PR）。M3.1 可发布给单机团队使用，但远程执行与 PR 必须等 M3.2，不能以不安全方式上线；拆分决定写入 Q-M3-19 与变更日志。

### 10.2 技术与外部依赖

| 依赖 | 说明 | 失败影响 |
|---|---|---|
| Postgres 15 及以上 | 控制面数据库；需要备份、连接池、监控与升级方案 | 团队模式无法启动或数据不可用 |
| TLS 证书与域名 | 控制面与 Runner 的连接必须 TLS；Webhook 需要可访问的 HTTPS 端点 | 无法安全暴露控制面；Runner 拒绝连接 |
| GitHub | GitHub App 或细粒度 PAT；仓库管理员权限用于安装与保护分支配置；Runner 侧短期 Git 凭据用于 push/PR；Webhook 需要签名密钥 | 无法创建 PR 或回写状态；本地合并仍可用但团队闭环不完整 |
| Runtime CLI（Claude Code、Codex、mock） | Runner 侧需要已安装并登录的 Runtime；版本与协议在握手中上报；不支持时拒绝而非回退 mock | 对应 Runtime 的 Run 无法执行；需升级或改用其他 Runtime |
| 操作系统钥匙串 | Runner 机器密钥、Git 凭据与令牌的安全存储；钥匙串不可用时 fail closed | 凭据无法安全保存，Runner 注册或 push 失败；不得退化为明文 |
| Wails v3 与 WebView | 桌面端团队 UI；Web UI 可独立运行，不依赖桌面壳 | 桌面体验受影响，但不阻塞 Web 团队模式 |
| 对象存储或文件系统 | 证据大文件的存储；M3 可先用本地文件系统，接口保留对象存储适配；源码类证据默认不进入控制面存储 | 大证据无法保存或回传；需调整保留策略 |
| 团队试点环境 | 至少一台控制面服务器、一台远程 Runner、一个演示仓库与两名真实成员 | 无法完成试点与退出验收 |

### 10.3 内部依赖

- M0 的 Task、Agent、Run、RunEvent 领域模型与 SQLite 存储必须保持可用；M3 不得破坏本地模式。
- `internal/store/Store` 接口需要向后兼容扩展；新增 Postgres 实现不得改变既有方法语义。
- `packages/shared` 与 `packages/api-client` 必须随 API 增量同步；新增类型不得手写重复定义。
- 模块文档 `api-and-data.md`、`security-and-permissions.md`、`runtime-and-workspace.md`、`agent-system.md`、`collaboration-and-review.md`、`ui-ux.md`、`non-functional-requirements.md` 与 `prd/01-scope-and-roadmap.md` 是 M3 细节的规范来源；`api-and-data.md` 是 API、事件、表结构与迁移策略的唯一契约来源，`01-scope-and-roadmap.md` 是范围、依赖与变更规则的权威。实现与文档冲突时先修正文档再实现。

### 10.4 依赖失败时的处理

- **Postgres 不可用**：控制面拒绝启动团队模式，不降级到 SQLite；本地模式仍可启动；错误信息包含连接与迁移状态。
- **TLS 缺失**：非回环监听拒绝启动；本地回环模式可继续；不得以「内网可信」为由跳过 TLS。
- **GitHub 不可用**：PR 创建进入可重试状态，保留本地分支与审批记录；团队仍可在本地完成合并，但 M3 的 PR 验收不通过。
- **Runner 版本不兼容**：拒绝新租约并提示升级，允许完成已领取 Run；管理员升级后恢复；未知 Runtime 不回退 mock。
- **Runtime CLI 缺失或版本不兼容**：对应 Run 失败并给出可操作错误；不静默降级到 mock；Runner 能力探测结果在 Machines 页面可见。
- **GitHub Webhook 不可达**：轮询对账继续更新 PR 状态；界面提示可能延迟；超过阈值触发告警。
- **钥匙串不可用**：Runner 注册或 push 失败并提示安装或解锁钥匙串；不得退化为明文存储。
- **试点团队缺席**：M3 不能退出；功能完成但无真实团队使用，不能证明团队模式成立。

## 11. 风险与缓解

| 编号 | 风险 | 影响 | 可能性 | 缓解措施 | 预警信号 |
|---|---|---|---|---|---|
| R-M3-01 | SQLite 到 Postgres 迁移失败或数据损坏 | 高：任务、证据与审计丢失，团队无法上线 | 中 | 预检、快照、分批导入、行数与哈希校验、失败回滚、迁移演练；迁移前禁止写入 | 预检出现未知表或校验和不一致；迁移耗时远超预算 |
| R-M3-02 | 远程 Runner 代码与凭据暴露 | 高：源码、模型 Key 或仓库凭据泄露 | 中 | 专用机器/OS 用户、TLS、最小权限短期凭据、模型 Key 与 Git 凭据不落控制面、默认不上传源码类证据、`allowSourceEvidenceUpload` 逐次审批、脱敏、共享机器警示与审批、撤销与轮换 | 出现共享 Runner 上的敏感任务；机器被多人共用；控制面出现 diff 正文或凭据 |
| R-M3-03 | 控制面认证或权限绕过 | 高：未授权访问、跨团队泄露、恶意操作 | 中 | 服务端中间件、默认拒绝、权限矩阵测试、来源校验、CSP、限流、安全评审 | 404/403 拒绝日志异常减少；出现跨团队数据访问告警 |
| R-M3-04 | Runner 分裂脑或重复执行 | 高：同一 Run 被两台机器执行，产生重复提交或副作用 | 中 | 租约 + fencing、唯一持有者、旧租约事件拒绝、租约 90 秒失效后 Run `failed`/`interrupted`/`runner_lost`、人工确认后创建新 Run 重试 | 同一 Run 出现两个 Runner 事件流；租约续期冲突 |
| R-M3-05 | 角色命名与权限模型在文档间漂移 | 中：实现与验收口径不一致，测试遗漏 | 高 | 以 `security-and-permissions.md` §4.2 的两层四角色为唯一权威；六角色仅作别名；在 M3 设计评审统一别名并回写 01-scope §11.1、user-flows §9.3、ui-ux §3.1/§11.2、collaboration §16.2；生成权限矩阵测试 | 不同文档出现 Contributor/Operator/Developer 混用 |
| R-M3-06 | 范围膨胀到 SaaS、计费、SSO | 中：M3 延期，核心团队能力无法交付 | 高 | 第 2.3 节范围判定规则；任何新增需求必须映射 TEAM/PROD 并经过范围评审 | 路线图中出现托管、计费、SCIM 等需求 |
| R-M3-07 | GitHub 集成权限过宽或令牌泄露 | 高：仓库被越权访问或推送 | 中 | GitHub App 最小权限、按仓库安装、短期令牌、禁止 force push、审批后推送、审计 | App 申请组织级权限；令牌出现在日志或导出物 |
| R-M3-08 | 自托管运维负担导致采用失败 | 中：团队无法完成 TLS、备份与升级 | 中 | 单二进制 + compose 样例、部署文档、健康检查、备份脚本、升级指南、试点陪跑 | 试点团队反复卡在部署或备份 |
| R-M3-09 | 审计数据增长与隐私风险 | 中：磁盘膨胀，审计包含敏感元数据 | 中 | 只记录摘要与哈希，不记录代码正文；审计默认 180 天、可配 90 天至 3 年，仅归档；RunEvent 默认 90 天；异步批量写入；导出脱敏 | 审计表增长超预期；出现代码片段或密钥 |
| R-M3-10 | Postgres 并发与连接池瓶颈 | 中：团队规模上升后查询变慢 | 中 | 连接池、索引、分页、慢查询日志、按 §12.4 的 10k Task/100k Run/1M 审计/30 机器压测 | 审计或任务列表 p95 超过 1 秒 |
| R-M3-11 | 本地模式被团队代码路径破坏 | 中：个人用户体验回退，违反渐进式采用 | 中 | 双 Store、模式开关、本地模式回归测试、CI 同时跑两种模式 | 本地启动要求 Postgres 或登录 |
| R-M3-12 | 试点团队流程不匹配 | 中：功能可用但没人用，指标不达标 | 中 | 试点前访谈、任务模板、评审流程对齐、每周复盘、按反馈裁剪 P2 | 共享 Agent 使用率低、Run 完成但无人评审 |
| R-M3-13 | Webhook 不可达导致 PR 状态过期 | 低-中：任务状态与 GitHub 不一致 | 中 | Webhook + 轮询降级、手动刷新、状态对账任务、审计 | PR 已合并但 Task 仍显示待合并 |
| R-M3-14 | 迁移后历史审计身份失真 | 中：合规复盘无法解释旧记录 | 中 | 历史记录标注 `actor_type=local`；迁移向导显式确认 Owner；不伪造账号；回写审计说明 | 迁移后发现历史记录归属错误或缺失 |
| R-M3-15 | GitHub Webhook 伪造、重放或状态错乱 | 中：PR 状态被恶意或错误更新，Task 显示错误结论 | 中 | HMAC 签名、时间戳与重放窗口、`dedupeKey`、事件去重、轮询对账、无效签名拒绝并审计 | 收到无法对账的 PR 事件；同一 PR 状态反复横跳 |
| R-M3-16 | M3 范围过大或远程安全无法收口 | 高：里程碑延期或以不安全方式上线 | 中 | M3-0 入口门；M3.1/M3.2 拆分预案；安全评审前置；每阶段可演示增量；范围变更按 `01-scope-and-roadmap.md` §7 执行 | 远程 Runner 高危问题持续未关闭；M3-A 已开始但 M2 权限/审计 schema 未冻结 |

风险治理遵循 `prd/05-risks-and-open-questions.md` 的规则：红色风险未关闭不得退出；安全与法律风险必须由评审人签署接受或关闭。

## 12. 指标

以下指标用于判断团队模式是否真的被使用，而不是只看功能是否上线。目标值为初始假设，试点后校准。

| 指标 | 定义 | 目标 | 采集方式 |
|---|---|---|---|
| 团队激活 | 创建团队后 7 天内完成首次共享 Agent Run 的团队比例 | 不低于 70% | 控制面事件 |
| 共享 Agent 使用率 | 使用共享 Agent 的 Run / 团队总 Run | 不低于 40% | Run 与 Agent 归属 |
| Runner 利用率 | Runner 忙碌时间 / 在线时间 | 50%-80% | 心跳与租约 |
| 审计完整率 | 有审计记录的高风险动作 / 全部高风险动作 | 100% | 审计与动作对账 |
| 未授权高风险动作 | 未经审批执行的合并、推送、部署、删除数 | 0 | 审计与服务端日志 |
| 自批拦截率 | 被阻止的自我审批 / 自我审批尝试 | 100% | 审批记录 |
| 审批等待时长 | 提交审批到决定的中位时长 | 不超过 4 小时 | 审批时间戳 |
| 跨团队泄露 | 跨 Team Workspace 成功读取的事件数 | 0 | 权限测试与审计 |
| 团队关键查询延迟 | 任务、Run、审计、机器状态查询 p95（按 `non-functional-requirements.md` §12.4 数据集） | 低于 1 秒 | 压测与指标 |
| 新成员上手时间 | 被邀请到首次被评审 Run 完成的中位时间 | 不超过 5 个工作日 | 事件时间戳 |
| 团队 4 周留存 | 首周激活后第 4 周仍有 Run 的团队比例 | 不低于 60% | 控制面事件 |
| 迁移演练成功率 | 迁移演练一次通过的比例（字段映射、行数/哈希校验、回滚） | 100% | 导入器报告 |
| Runner 失联终态准确率 | 断线后 90 秒内进入 `failed` + `interrupted`/`runner_lost` 的比例；无静默重跑 | 100% | 故障注入测试 |
| 取消与超时终态准确率 | 取消进入 `cancelled`、超时进入 `failed`/`timeout` 的比例；重复取消无副作用 | 100% | 故障注入与审计 |
| 源码证据边界违规 | 未获批准即上传 diff/截图/完整日志的次数 | 0 | 上传审批与审计 |
| 审计告警响应 | 哈希链/锚点校验失败从告警到 Owner/Admin 确认的时长 | 不超过 1 个工作日 | `security.alert` 与审计 |

**M3 容量口径**：以 `prd/modules/non-functional-requirements.md` §12.4 为唯一发布门禁——一个 2-10 人团队，10,000 个 Task、100,000 个 Run、100,000 条全局事件、1,000,000 条审计记录、30 台注册机器；任务、Run、审计与机器状态查询 p95 均低于 1 秒，审计在 100 万条数据、按 actor/action/时间过滤时 p95 低于 1 秒。列表查询的中间目标沿用 `NFR-PERF-004`（1,000 Task p95 ≤100ms、5,000 Task 单页 p95 ≤200ms）与 `api-and-data.md` §18.1（RunEvent 10 万条中查最近 1,000 条 p95 ≤200ms）。旧稿中「5,000 Task/50 成员/20 Runner」的规模目标与 `02-domain-model.md` 的 NFR-007 引用已不再存在于当前领域模型（该文档改用 `DM-NFR-*`），`05-risks-and-open-questions.md` 中的残留引用应一并回写。

反指标：

- Run 数上升但审计完整率下降：说明团队在绕过治理，应暂停新功能并修复审计。
- Runner 利用率长期 100%：说明容量不足或队列设计有问题，不应以「充分利用」庆祝。
- 共享 Agent 使用率极低：说明共享机制没有价值或权限设计阻碍使用，应回访试点团队。
- 审批等待时长为零但返工率上升：可能是审批形式化，应检查证据打开率与误合率。

指标采集原则：

- 指标在控制面本地或团队自托管服务器计算，用户可自行查看；默认不向 ATeam 项目上传。
- 指标内容不包含代码、提示词、diff 正文与密钥。
- 团队指标归团队所有；跨组织不得共享。
- 目标值每季度复盘；未达标时优先修复权限、审计与执行可靠性，不用 UI 装饰掩盖。

## 13. 验收标准与退出标准

M3 的验收采用五个维度：功能验收、权限与安全验收、数据与迁移验收、性能与可靠性验收、试点与文档验收。第 4、5 节给出用户故事与逐条需求的可测试标准，第 9 节给出可重复的演示脚本，本节给出入口门、不可跳过的退出条件与例外流程。

### 13.0 M3 入口门（启动前）

M3 不得在以下条件满足前进入 M3-A：

1. M1 与 M2 的退出标准逐项复核完成；未通过项要么已修复，要么以书面阻塞项列入 M3 计划并有负责人。
2. M2 的权限模型与审计事件 schema 已冻结（MILE-005），并有设计评审与 schema 评审记录。
3. 前置差距审计报告（D-M3-15）完成，覆盖 CORS/Origin、本地会话令牌、worktree、证据、审批门与 Agent 版本快照。
4. 本章的关键决策与口径已记录：角色词表（3.1）、容量口径（12）、心跳/租约阈值（6.2）、跨机器证据边界（6.7.5）、推送执行归属（6.7.6）、迁移范围（6.7.4/7.4）；对应开放问题 Q-M3-01/02/05/19 有结论或明确的最晚决策点。
5. 若威胁建模显示远程 Runner 的高危问题无法在本里程碑内关闭，M3.1/M3.2 拆分方案已批准并记录。

### 13.1 退出标准

M3 退出必须同时满足以下条件，缺一不可：

1. TEAM-001 至 TEAM-012 全部通过；TEAM-013 至 TEAM-049 中所有 P0 项通过；P1 项通过或有按 13.2 签署的例外；P2 项可裁剪。
2. 第 9 节演示脚本在干净环境连续通过两次：一次正常路径，一次包含远程取消、Runner 断线与越权拒绝；两次都必须展示证据边界与审计核对。
3. 登录、会话、组织级四角色与 Team Workspace 级四角色的权限矩阵、404/403 语义、跨团队数据隔离的自动化测试全部通过；未授权高风险动作数为 0；最后 Owner 保护与成员移除撤销生效。
4. Postgres 与 SQLite 的领域行为契约测试一致；导入器的字段映射、行数与关键哈希、证据校验和、失败回滚、旧 SQLite 快照保留与删除审批全部通过；备份与恢复演练通过。
5. 审计覆盖登录、成员/角色变更、Agent 变更、Runner 注册/撤销、Run 创建/取消/失败、审批、PR、删除与部署请求；审计完整率 100%，哈希链与锚点校验通过；校验失败告警可触发、可通知并有确认记录。
6. Runner 注册、心跳、租约、取消、超时、断线、重连、撤销与版本/Runtime 不兼容场景全部通过；失联进入 `failed` + `interrupted`/`runner_lost`，取消进入 `cancelled`，超时进入 `failed`/`timeout`；不存在静默重跑或永久 running。
7. 至少一个 2-10 人团队完成连续两周的试点（两个自然周内均有活跃 Run 与评审），共享 Agent 使用率、Runner 利用率、审批等待、审计完整率与关键查询 p95 达到第 12 节目标或有签署的例外；§12.4 的容量门禁通过。
8. 安全评审完成，覆盖认证、授权、Runner 信任边界、跨机器数据边界、Git 凭据、Webhook、密钥轮换与审计完整性；无未关闭的红色风险；共享机器、凭据、TLS 与证据边界结论有书面签署。
9. 部署、备份恢复、Runner 安装、权限矩阵、证据边界与审计文档齐备，并在干净环境验证。
10. M1 与 M2 的依赖项复核完成；M4 所需的团队数据模型、事件与审计接口稳定，无阻塞性缺口。

### 13.2 例外流程

P1/P2 的延期必须按 `01-scope-and-roadmap.md` MILE-008 执行，不允许无声 carry-over：

1. 申请人提交影响评估、补偿措施、签署人、目标里程碑与复查日期。
2. 签署人为产品负责人与工程负责人；涉及安全、数据边界或审计的例外必须由安全评审人联署。
3. 例外记录写入变更日志与试点报告；未记录视为未批准。
4. 每个例外在下一里程碑启动评审时复查；逾期未处理升级为风险。
5. P0 项不允许例外；任何「先上线后补 P0」的请求按范围变更处理，不能作为退出例外。

退出评审由产品、工程、安全与一名试点团队代表共同参加；任何一项不通过，M3 不得标记完成，M4 不得启动依赖团队模式的能力。

## 14. 不在 M3 的范围

本节集中列出后置能力、长期非目标与容易被误解的排除项，供范围评审与对外沟通直接引用。

### 14.1 后置项与目标里程碑

| 后置项 | 为什么不在 M3 | 目标里程碑 |
|---|---|---|
| 定时执行、Webhook 自动化、通知中心、桌面通知 | 团队模式先保证身份、执行与审计；自动化需要稳定的团队事件与权限 | M4 |
| DMG、NSIS、AppImage 打包与签名 | 控制面以服务端部署为主；桌面分发包属于分发阶段 | M4 |
| 自动更新与回滚 | Runner 与桌面端的自动更新需要签名、校验与发布基础设施 | M4 |
| 插件 API、遥测、完整文档站 | 生态与分发是 M4 的主题 | M4 |
| 多租户 SaaS、计费、订阅、发票 | 与本地优先定位冲突，且引入合规与运维成本 | 不在当前路线图 |
| 模型托管、转售、密钥代管 | 与 BYO Runtime/Key 原则冲突 | 长期非目标 |
| SAML、SCIM、LDAP 同步、自定义角色 | 企业身份治理超出 2-10 人团队的核心需求 | 后续按客户需求评估 |
| 其他代码托管平台 | M3 只承诺 GitHub；其他平台需要独立适配与测试 | 后续评估 |
| 跨仓库任务与跨仓库 DAG | 需要重新设计 Workspace 与路径边界，M3 仍以单仓库为执行边界 | 后续评估 |
| 容器级强隔离、远程桌面与云端 IDE | M3 的 Runner 以受信任机器为前提；强隔离是另一层安全产品 | 后续评估 |
| Docker 沙箱与降级审批 | M3 不交付；专用 OS 用户、全盘加密与容器运行只作为部署建议；`runtime-and-workspace.md` 的 M3 映射需回写 | M4 |

### 14.2 长期非目标

以下方向不属于 ATeam 的初期产品边界，不应在 M3 的讨论中被引入：

- 完整的通用项目管理套件。
- 20 个以上的第三方集成。
- IM 机器人或聊天式工作流。
- 技能市场或 Agent 商店。
- 移动端应用。
- 多租户 SaaS。
- 模型托管或转售模型调用。
- 无人值守的自动合并与自动生产部署。

### 14.3 M3 内明确不做但容易被误解的事项

- M3 不提供「跳过审批」开关，也不提供 Agent 自动合并。
- M3 不把本地 SQLite 直接暴露成团队数据库；团队模式必须使用 Postgres 控制面。
- M3 不承诺跨机器强一致；远程执行采用租约与最终一致的事件回传。
- M3 不提供生产部署执行入口；DevOps Agent 只能产出 staging 与部署计划，prod 必须人工在 ATeam 之外执行。
- M3 不提供多 Agent 自由聊天；角色 Agent 仍通过任务 DAG、交付物契约、审批门与证据化 DoD 协作。
- M3 不提供 Windows Runner 的同级支持；具体支持深度见第 16 节。
- M3 不提供共享 Runner 的强隔离保证；共享机器必须显式审批并提示风险。

## 15. 与其他文档的关系

| 文档 | 关系 | 使用方式 |
|---|---|---|
| `prd/00-product-overview.md` | 定义产品愿景、用户、核心闭环、PROD 级需求与里程碑总表 | 本文件是产品总览中 M3 行的详细展开；PROD-009、PROD-011、PROD-013、PROD-014 是 M3 的跨模块底线 |
| `prd/01-scope-and-roadmap.md` | 定义跨里程碑范围、依赖、变更规则、MILE-001/005/008、M3 范围与退出标准 | 本章的范围判定、入口门、M3.1/M3.2 拆分与例外流程以其为准；角色词表与证据边界以其 §4.5.2 与 security §4.2 为准 |
| `prd/02-domain-model.md` | 定义 Workspace、Run Workspace、Task、Agent、Run、Approval、Machine/Runner 等实体与状态机 | 本章引用其 §3.14 Machine/Runner、§3.11/§4.6 Approval、§4.3 Run 状态机；Team Workspace 与 Workspace 的层级、`team_workspace_id` 与 `workspace_id` 映射需回写该文档 |
| `prd/03-user-flows.md` | 流程 F 用 FLOW-F-001～017 定义团队模式的用户流程、权限矩阵、异常与验收点；TEAM-001 至 TEAM-012 的权威需求行在本章 5.1，不在 03 | 本章不重复流程细节，只做里程碑级编排；流程 F 的角色表述按 security §4.2 的两层四角色回写 |
| `prd/04-acceptance-and-test-plan.md` | §4.4 给出 M3 的验收标准与 15 分钟演示脚本 | 本章第 9、13 节在其基础上展开为两名成员 + 一台远程 Runner 的完整演示与退出标准 |
| `prd/05-risks-and-open-questions.md` | 给出 M3 重点风险、OQ-009 与退出条件 | 本章第 11 节引用并补充团队模式特有风险；OQ-009 的导入工具口径需按 6.7.4 回写 |
| `prd/modules/api-and-data.md` | REST/WS 契约、事件目录、错误码、表结构与迁移策略的权威 | 本章 §7.2/§7.3/§7.4 引用其 §5.10、§5.11、§5.13、§6.3、§7.4、§9.3、§9.4、§17.3；端点、事件与表名不得另立一套 |
| `prd/modules/security-and-permissions.md` | 团队角色、权限矩阵、Runner 安全、审计、高风险动作的权威 | 本章 TEAM-013 至 TEAM-017、TEAM-028、TEAM-029、TEAM-036、TEAM-039、TEAM-045、TEAM-046 引用其 §4.2/§4.3/§4.6、§7、§8 |
| `prd/modules/runtime-and-workspace.md` | Machine、Runner、远程执行、Workspace、Git 推送与 PR 的权威 | 本章 TEAM-020 至 TEAM-027、TEAM-031、TEAM-032、TEAM-041 引用其 §7、§8、§9.4、§10；其 M3 映射中的 Docker 沙箱需移出 |
| `prd/modules/agent-system.md` | Agent 配置、private/team 可见性、版本、共享与审计的权威 | 本章 TEAM-018、TEAM-019 引用 AGENT-058 至 AGENT-060；shared 的权威定义在 security §4.2/§4.3 |
| `prd/modules/collaboration-and-review.md` | 审批门、四眼原则、证据化 DoD、收件箱的权威 | 本章 TEAM-030、TEAM-038 引用其 §8、§9、§16.2；§16.2 已按两层四角色回写 |
| `prd/modules/task-management.md` | Task 字段、状态机、看板与团队筛选的权威 | 本章不重复；团队筛选与任务归属以其为准 |
| `prd/modules/ui-ux.md` | 团队 UI 页面、权限状态与角色矩阵的权威 | 本章 TEAM-037、TEAM-043 引用 UI-089、UI-130 与 §14 的 M3 界面清单；它不是 API 契约来源 |
| `prd/modules/non-functional-requirements.md` | 性能、可靠性、安全、成本、保留与发布门禁的权威 | 本章第 12、13 节与 TEAM-027、TEAM-035、TEAM-036、TEAM-047 引用 NFR-PERF-004、NFR-COST-006、§7.5 保留策略与 §12.4 M3 门禁 |

文档地图说明：`prd/00-product-overview.md` 的文档地图使用描述性文件名（如 `task-management.md`、`agent-system.md`、`api-and-data.md`）；API 契约由 `prd/modules/api-and-data.md` 承担。本章按真实文件名引用。如果模块文档与本章冲突，以模块文档中的字段级与流程级定义为准；本章负责里程碑范围与验收，不负责重新定义字段。发现冲突时应回写修正，而不是在两处各自解释。

## 16. 待确认/未文档化

以下事项是 M3 真实存在的开放决策，不是遗漏的细节。每项给出当前状态、影响与最晚决策点；未确认前，实现应选择可逆方案，不得把假设固化为不可迁移的数据结构。

| 编号 | 事项 | 当前状态与选项 | 影响 | 最晚决策点 |
|---|---|---|---|---|
| Q-M3-01 | 团队角色命名与数量（已裁决） | 权威词表为 `security-and-permissions.md` §4.2 的两层四角色：组织级 Owner/Admin/Member/Viewer，Team Workspace 级 workspace_admin/Contributor/Reviewer/Viewer；Maintainer/Developer 仅为旧称谓。01-scope §4.5.2、ui-ux §11.2、collaboration §16.2、task-management §17.2 已按此回写；03-user-flows 的角色段落同步引用该词表 | 权限矩阵、API 鉴权、测试用例与文档一致性 | 已关闭 |
| Q-M3-02 | 心跳、租约与失联后的 Run 状态（已裁决） | 心跳 15 秒、offline 45 秒、租约 90 秒；Run 只有 `queued/preparing/running/completed/failed/cancelled` 六态，失联进入 `failed` + `errorCode=interrupted` + `failureDetail=runner_lost`（或 `lease_expired`）；不自动重新调度，人工确认后创建新 Run；Machine 状态 `pending/online/offline/draining/disabled`，`revoke` 是动作；租约持久状态 `active/expired/released/cancelled`，不存在 `revoked`/`unknown`。security §7.2、runtime §7.4、api §5.10/§7.4、collaboration §15 已按此回写 | 远程执行可靠性、审计与用户预期 | 已关闭 |
| Q-M3-03 | 认证最终形态与 OIDC | 建议本地账号 + 可选 TOTP；OIDC 只预留接口。是否在 M3 后半段交付 OIDC、是否支持 SAML/SCIM 尚未决定 | 登录实现、企业采用、安全评审范围 | M3-A 阶段设计评审 |
| Q-M3-04 | 邀请与密码重置通道 | 自托管环境可能没有 SMTP。选项：邀请码/一次性链接、管理员手动创建账号、配置 SMTP 后邮件邀请。**M3 默认**：邀请码/一次性链接 + 管理员手动重置 + Owner 离线恢复码，全部一次性、短 TTL、限流与审计；SMTP 邮件邀请/找回作为可选配置。落为 TEAM-049 与 6.1.1 例外端点 | 成员上手体验、部署复杂度 | M3-A 阶段 |
| Q-M3-05 | Runner 传输与认证方式 | 建议 HTTPS + WebSocket + JSON；备选 gRPC 双向流。认证基线为 TLS + 机器密钥签名挑战 + 短期会话票据；mTLS、短期 token 或两者组合尚未最终决定；`05-risks-and-open-questions.md` RSK-SEC-007 明确不要求双向 TLS 客户端证书。若威胁建模要求 mTLS，需评估部署复杂度、证书分发与密钥轮换 | Runner 实现、调试工具、部署复杂度、M4 升级策略 | M3-C 阶段开发前 |
| Q-M3-06 | GitHub 集成方式与托管范围 | 建议 GitHub App 优先、细粒度 PAT 降级；M3 只承诺 GitHub，不承诺其他托管平台。Webhook 与轮询的默认策略待定 | PR 创建、状态回写、自托管网络要求 | M3-D 阶段开发前 |
| Q-M3-07 | Postgres 部署形态与版本 | 建议 Postgres 15+，单机或 compose 部署；不承诺高可用与多活。备份责任归团队，ATeam 提供脚本与文档 | 部署复杂度、恢复能力、运维成本 | M3-A 阶段 |
| Q-M3-08 | 多 Team Workspace 与跨 Workspace Agent 共享 | `security-and-permissions.md` 允许组织内多个 Team Workspace 与 `shared` Agent；`02-domain-model.md` 提到 M3 多 Workspace 模式。产品简报只要求团队共享。建议 M3 支持至少一个默认 Team Workspace，多个作为 P1 | 数据模型、权限过滤、UI 复杂度 | M3-B 阶段设计评审 |
| Q-M3-09 | 团队审计的查看权限 | `security-and-permissions.md` 限定组织 Owner/Admin 查看与导出；UI 角色矩阵也将审计限定 Owner/Admin。Team Workspace 的 workspace_admin 是否可查看本 workspace 审计尚未决定。建议 M3 仅组织 Owner/Admin，后续再评估 | 审计隐私、团队协作效率 | M3-D 阶段 |
| Q-M3-10 | 数据保留与删除策略（已裁决） | 统一保留表以 `api-and-data.md` §9.5、`security-and-permissions.md` §5.5 与 `non-functional-requirements.md` §7.5 为准：RunEvent/Artifact/Evidence 90 天；Run Workspace 30 天；本地审计 90 天；团队审计默认 180 天、可配 90 天至 3 年、仅归档不物理删除；本地遥测 30 天；回收站 30 天。源码类证据上传后的保留期与 Artifact 相同（90 天）；删除需 Owner/Admin 审批并审计 | 磁盘、合规、用户信任 | 已关闭 |
| Q-M3-11 | 计费、预算与配额边界 | 产品简报的 M3 范围并未要求配额；`non-functional-requirements.md` NFR-COST-006 规定 M3 必交「按 Agent 的并发与单 Run 时长配额」，按 Agent 月度费用预算与按工作区日预算为可选、取决于 M3 范围评审，并非把预算硬限制列为 M3 必交。**本章裁定**：M3 只做并发与单 Run 时长配额（TEAM-027）；月度/日费用预算不进入 M3，除非范围评审显式纳入并补审计与覆盖流程；避免范围膨胀 | 范围、实现成本、用户预期 | M3 范围评审 |
| Q-M3-12 | 本地账号迁移与历史审计映射 | 升级到团队模式时，本地 `actor_id` 如何映射到真实账号、历史审计如何保留、谁成为 Owner，尚未定稿。建议迁移向导显式确认 Owner 与默认 Team Workspace，历史记录标注 `actor_type=local` | 数据迁移、审计可信度、用户信任 | M3-A 阶段 |
| Q-M3-13 | Windows Runner 的支持深度 | M3 的 Runner 以 macOS/Linux 为主；Windows Runner 是否需要同级支持未定。建议 M3 保证 macOS/Linux，Windows 在 M4 打包阶段补齐 | 测试矩阵、远程执行覆盖面 | M3-C 阶段 |
| Q-M3-14 | Runner 容器隔离是否默认 | **决议：M3 不交付 Docker 沙箱与降级审批**，不把容器沙箱作为默认安全承诺；专用 OS 用户、全盘加密与容器运行只作为部署建议。`runtime-and-workspace.md` 的 M3 映射把「Docker 沙箱与降级审批」列入，需回写为 M4；若安全评审坚持交付，必须新增 TEAM 需求、D-M3-07 范围、退出标准与威胁模型后再纳入 | 安全边界、部署复杂度、里程碑范围 | M3-C 阶段安全评审 |
| Q-M3-15 | 自定义角色与细粒度权限 | M3 只支持 `security-and-permissions.md` §4.2 的两层四角色；是否允许组织自定义角色、按资源授权未定。建议 M3 不做，避免权限模型复杂化 | 权限实现、UI、审计 | M3-B 阶段范围评审 |
| Q-M3-17 | 团队通知与收件箱的渠道 | M2 有应用内收件箱，M4 有桌面通知/Webhook。M3 的审批、Runner 离线、证据不完整是否只进收件箱，是否发送邮件，尚未定稿。建议 M3 只做应用内收件箱，邮件与 IM 留待 M4 | 用户响应速度、实现范围 | M3-E 阶段 |
| Q-M3-18 | 商业模型与团队功能边界 | 核心开源与团队功能是否收费、按席位还是按团队、是否提供托管 Runner，仍在开放问题中。M3 不实现计费，但数据模型与审计应保留导出能力，避免锁定 | 产品定位、开源信任、后续商业化 | M3 范围冻结前 |
| Q-M3-19 | M3.1/M3.2 拆分触发条件 | `01-scope-and-roadmap.md` §8.2 已规定：远程 Runner 安全无法在里程碑内关闭高危问题时，拆为 M3.1（Postgres、登录、权限、审计）与 M3.2（远程 Runner、GitHub PR）。本章的触发条件：威胁建模出现未缓解高危、安全评审两次未通过、或 Runner 凭据/数据边界无法验证。拆分需在 M3-0 入口门或 M3-C 前决定并记录 | 里程碑排期、安全边界、交付范围 | M3-0 / M3-C 阶段门 |
| Q-M3-20 | 跨机器源码证据的默认值与审批人 | 本章默认 `allowSourceEvidenceUpload=false`，逐次上传需 workspace_admin 或组织 Admin 审批且申请人不能自批；已上传证据默认保留不超过 30 天。待确认：是否允许项目级按仓库/分支细分、是否允许 Owner 例外覆盖、以及 Runner 本机受控查看器的实现形态。无论选项如何，默认路径必须是「不上传、只传摘要与哈希」 | 数据主权、评审体验、合规 | M3-D 阶段安全评审 |

Q-M3-16 已关闭：API 契约由 `prd/modules/api-and-data.md` 承担，包含 REST/WS 契约、事件目录、表结构与迁移策略；M3 端点见其 §5.10/§5.11/§5.13，事件见 §6.3，表见 §9.3/§9.4。该事项不再作为开放问题。

以上事项关闭后，应回写到对应模块文档与 `prd/02-domain-model.md`；未关闭前，本章的建议值作为实现默认值，但不能在对外文档中写成最终结论。
