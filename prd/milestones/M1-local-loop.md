# 里程碑 M1：本地闭环

## 本章导读

M1 是 ATeam 从「可演示骨架」走向「可真实使用」的第一个里程碑。M0 已经验证了领域模型、SQLite 持久化、REST/WebSocket API、进程内调度器、mock Runtime、Vue 看板与 Wails 桌面壳，但 M0 的 Run 并不真正接触代码仓库：工作区只是数据目录下的一个空目录，Claude 适配器只是把 `claude -p` 的 stdout/stderr 逐行转成日志，没有 diff、没有证据、没有评审、没有合并。因此 M0 完成的是「操作闭环」，M1 要完成的是「交付闭环」。

M1 只回答一个问题：一个开发者能否在 ATeam 中，使用本机已登录的 Claude Code CLI，把一个真实 Git 仓库中的 Task 放到隔离 worktree 上执行，得到可评审的 diff 与证据，并由人工确认后合并回目标分支，同时整个过程可取消、可超时、可追溯、失败后可恢复？

本文件定义 M1 的目标、范围、用户故事、功能需求、交付物、演示脚本、依赖、风险与退出标准。模块级细节不在本文件重复展开，而是指向 `prd/modules/` 与 `prd/` 根目录下的权威文档：领域实体与状态机见 `prd/02-domain-model.md`；工作区、Runtime、Artifact 与 Run 生命周期见 `runtime-and-workspace.md`；评审与合并见 `collaboration-and-review.md`；安全与权限见 `security-and-permissions.md`；API 与数据契约见 `api-and-data.md`；界面见 `ui-ux.md`；非功能指标见 `non-functional-requirements.md`；验收用例见 `prd/04-acceptance-and-test-plan.md`。

**命名约定（全章适用）**：本文件中的 **Workspace** 指产品级归属实体（API 层名称，UI 文案称「项目」），持有仓库绑定、默认分支与执行设置；**Run Workspace** 指某次 Run 的隔离执行目录（M1 为 git worktree）。两者不得混用。Task 与 Run 通过 `workspaceId` 归属 Workspace。该实体在所有文档中统一为 Workspace / `workspaceId`（表 `workspaces`，默认 ID `default`）；`Project`/`projectId` 仅为 M1-M2 请求输入别名，不建第二张表、不做双写。字段与约束以 `02-domain-model.md` §3.1 为准。

阅读建议：产品与项目管理者重点看第 1、2、9、13 节；工程师重点看第 4、5、6、7 节；设计重点看第 5.8 节并配合 `ui-ux.md`；决策者重点看第 10、11、12、15 节。

## 1. 里程碑定位与目标

### 1.1 一句话目标

一个开发者在 ATeam 中，使用真实 Claude Code Runtime，在隔离的 git worktree 上完成一次代码修改，经过 diff 与证据评审，由人工确认合并回目标分支。

### 1.2 M0 基线：已经有什么、缺什么

M1 的起点是当前仓库代码，而不是路线图文档里的理想状态。下表左侧是 M0 真实实现，右侧是 M1 必须补齐的能力。

| 能力 | M0 当前实现 | M1 需要达到 |
|---|---|---|
| Task/Agent/Run | Task、Agent、Run 的 CRUD 与状态枚举；SQLite 持久化；创建 Run 时自动指派 Agent，并把 todo 任务移到 in_progress | Workspace 实体与 `workspaceId` 回填；Run 固定 `agentVersionId`；受控状态流转与单活跃 Run |
| 调度与执行 | 进程内队列，容量 256，默认 2 个 worker；按 `Agent.TimeoutMinutes` 设置 context 超时；Run 事件写入 SQLite 并通过 WebSocket 广播 | 取消语义、`errorCode` + `failureDetail`、重启恢复、同 Task 活跃 Run 互斥、事件唯一序号与背压 |
| Workspace | 每个 Run 在 `~/.ateam/workspaces/runs/{runId}` 创建独立空目录，`Run.branch` 始终为空 | 真实 git worktree、唯一分支、base commit、生命周期与清理策略 |
| Runtime | mock 输出固定步骤；claude 执行 `claude -p`，逐行扫描 stdout/stderr，扫描缓冲上限 1 MB，无结构化解析 | 结构化事件、模型与权限参数、能力探测、无 mock 回退、进程组终止 |
| 证据 | 只有 `Run.summary` 文本与事件日志 | Artifact 数据模型、diff、changed files、test_report、log_bundle、校验和与脱敏；M1 不建 Evidence 表 |
| 评审与合并 | 无 | Review 与 ReviewComment、diff 评审界面、人工合并、MergeRecord 审计 |
| UI | 看板与 Task 详情；Run 日志为纯文本，1.5 秒轮询刷新 | 独立 Run 详情、结构化时间线、diff viewer、证据面板、评审面板、合并对话框 |
| 数据 | 单库 SQLite，4 张表：tasks、agents、runs、run_events | 增量迁移：workspaces、agent_versions、artifacts、reviews、review_comments、merge_records 与 Run 扩展字段 |

有三处 M0 行为必须在 M1 明确修正，不能作为「已知限制」带入正式使用：

1. `runtime.Registry.Get` 在找不到指定 Runtime 时返回 mock。配置写错会表现为「运行成功但没有改动」，这是产品上不可接受的误导。M1 必须显式失败，并在 UI 给出可用 Runtime 列表。
2. `workspace.Manager.Prepare` 忽略 `WorkspaceMode`，只创建普通目录；`Run.branch` 永远为空。M1 的 worktree 模式必须真正创建 git worktree 与分支，并在 Run 记录中保存 base commit、head commit 与 worktree 路径。
3. 当前取消接口先把 Run 标记为 cancelled，运行结束后调度器还会再次写状态；queued Run 被取消后仍可能留在 channel 中被 worker 取出执行。M1 必须修复状态竞态与队列残留，保证终态不被覆盖。

### 1.3 成功标准（用户视角）

M1 完成时，用户应能观察到以下五个结果：

- **真实改动**：Run 产生的 diff 来自真实 worktree，修改的是用户指定的本地仓库，而不是空目录或 mock 输出。
- **真实隔离**：同一仓库上的两个 Run 拥有各自的 worktree 与分支，一个 Run 的未提交修改不会出现在另一个 Run 的工作区。
- **真实证据**：代码变更类 Run 至少拥有 diff 或 changed files，以及 test_report 或人工记录的「不适用测试」例外理由；证据可追溯到 Run、文件与时间。
- **真实门禁**：任何合并都必须由人在评审界面明确确认，并生成包含操作者、时间、目标分支、源分支、head commit 与证据哈希的 MergeRecord；ATeam 不向 Runtime 暴露合并、推送或部署入口。
- **真实可恢复**：取消、超时、CLI 缺失、仓库不可用、磁盘不足等失败都有明确分类、可执行修复建议，且不会留下不可解释的中间状态。

关于门禁的边界必须说清楚：M1 **不提供命令级阻断**。Agent 仍以当前 OS 用户身份运行，理论上可以在 Bash 中执行 `git push`；M1 能做的是不提供合并/推送/部署工具、在 UI 与文档中明示该残余风险、并通过 Git 元数据变更检测留下告警。`allowedPaths` 与 `allowedCommands` 的强制执行属于 M2（见 `03-user-flows.md` 第 4 章与 `security-and-permissions.md` 第 11 章）。此外，M1 没有身份认证，服务端无法从技术上证明合并请求来自人类而不是本机脚本；M1 的「人工门」是 UI 工作流、显式确认与 MergeRecord 审计层面的约束，不是对抗恶意本机进程的安全边界。该风险在 M2.1 引入会话令牌后关闭。任何对外说明都不得把提示词约束或 UI 流程描述为系统强制。

### 1.4 设计原则（M1 约束）

1. **工作区即边界，但 M1 是检测级而非强制级**：Runtime 的 `Workdir` 必须是已准备的 worktree 绝对路径；所有文件修改默认发生在这个目录内。M1 做路径边界校验与越界写入检测（`workspace_escape_detected` 告警），细粒度路径与命令策略留给 M2。
2. **证据优先于自述**：系统采集的 diff、changed files、测试输出优先于 Agent 的文本总结。Agent 声称「测试通过」不等于证据成立。
3. **人工门不可绕过，但不虚构 Approval 实体**：M1 使用 Review（`approved`）+ MergeRecord + 显式确认承担合并门；`02-domain-model.md` §3.11 与 `security-and-permissions.md` §8.1 规定 Approval 实体从 M2.1 起引入，M1 不建 `approvals` 表、不伪造审批。
4. **单用户、单机、最小依赖**：M1 不引入登录、团队、权限、远程 Runner 或 Postgres；数据仍写入本地 SQLite 与本地文件系统。任何需要多人协作才能体现价值的能力后置。
5. **增量兼容**：M0 的 Task、Agent、Run 与事件接口保持可用；新增字段与资源采用增量迁移，不要求用户重建数据库。
6. **只做本地闭环**：凡是不影响「一次 Task 到合并」完整性的能力，一律后置到 M2 及以后；范围争议按第 2.3 节的判定规则处理。
7. **声明与能力一致**：产品文案、Agent 提示词与退出标准必须区分「系统强制」「系统检测」「仅提示词约束」三档。做不到的边界写成残余风险，不得用「已防护」的措辞掩盖。

### 1.5 目标用户与主场景

M1 的主要用户是独立开发者，或小团队中先在单机上试用 ATeam 的成员。该用户同时运行 1 至 3 个 Agent，使用自己已有的 Claude Code 订阅或 API 凭据，关心的是：代码是否被隔离、Agent 改了什么、测试是否真的通过、合并是否安全。

主场景可以概括为：用户在本地示例仓库中发现一个失败的测试，创建一个包含验收标准的 Task，选择一个真实 Claude Code Agent，启动 Run；Agent 在独立 worktree 中修改代码并运行测试；用户在 ATeam 内查看 diff、测试输出与事件时间线，批准后把分支 squash 合并回 main；Task 进入 done，证据与评审记录保留。整个过程不需要离开桌面应用，也不需要手工创建分支或复制 diff。

小团队用户在 M1 中同样以单用户方式使用，不共享任务、Agent 或机器。团队共享、登录、权限与远程执行是 M3 的内容。

### 1.6 本里程碑不证明的假设

- 不能证明多角色 Agent 通过 DAG 与交付物契约协作的效率；这属于 M2。
- 不能证明 2 至 10 人团队共享 Agent、机器与任务的治理能力；这属于 M3。
- 不能证明某个模型或 Runtime 在代码质量上优于其他选择；ATeam 不与模型质量竞争。
- 不能证明跨平台打包、自动更新与插件生态可用；这属于 M4。
- 不能证明 M1 的隔离足以抵御同一 OS 用户下的恶意进程；M1 只降低浏览器攻击面与误操作风险。

## 2. 范围

### 2.1 范围内

| 能力域 | M1 要交付的结果 | 权威细节 |
|---|---|---|
| Workspace 与仓库绑定 | Workspace 记录 `name`、`repoPath`、`defaultBranch`、`settings.remote`、`settings.worktreeRoot`、`settings.branchTemplate`、`settings.verificationCommands`、`settings.protectedBranches`、`settings.retentionDays` 与 `status`；Task 与 Run 带 `workspaceId`；单实例只有一个默认 Workspace，M0 数据回填到它 | `02-domain-model.md` §3.1；`runtime-and-workspace.md` §8.7 |
| git worktree 与分支 | 每个 Run 创建独立 worktree 与唯一分支，preparing 阶段解析并记录 base commit，支持仓库级串行化、生命周期与清理 | `02-domain-model.md` §3.8；`runtime-and-workspace.md` §8.3、§8.4、§8.6 |
| 真实 Claude Code adapter | 结构化事件、模型选择、权限模式、能力探测、版本提示、进程组终止、无 mock 回退 | `runtime-and-workspace.md` §6.5；本文件 §5.4.1 |
| Run 生命周期强化 | 取消、超时（含 preparing/Git 超时）、`errorCode` + `failureDetail`、`queuedAt`、`lastEventAt`、重启恢复、AgentVersion 快照 | `02-domain-model.md` §3.6、§4.3；`runtime-and-workspace.md` §11 |
| Artifact 与完成证据 | diff、changed files、test_report、log_bundle、note 等 Artifact 的采集、存储、校验和、脱敏与 DoD 判定；M1 不建 Evidence 表 | `02-domain-model.md` §3.9.1；`runtime-and-workspace.md` §10 |
| Review 与 Merge | 人工评审 `pending → approved / changes_requested`；ReviewComment；合并对话框；服务端合并校验；MergeRecord | `02-domain-model.md` §3.10、§3.15、§4.5；`collaboration-and-review.md` 第 9 章 |
| UI 本地闭环 | Task 三栏详情、Run 详情与时间线、diff viewer（含行内评论）、证据面板、评审面板、合并对话框 | `ui-ux.md` UI-038 至 UI-043、UI-108 |
| API 与事件 | Workspace、Artifact、Review、ReviewComment、Merge 的增量接口与 WebSocket 事件；`/api/v1` 前缀 | `api-and-data.md` 第 5 章 |
| 安全与本地审计 | 回环监听、非回环拒绝、Origin/Host/CORS、安全响应头、请求体上限、文件权限、启动失败关闭、敏感环境变量过滤、脱敏、合并人工确认、删除保护；M1 不写 `audit_events`，以 Review 决定与 MergeRecord 作为审计前身 | `security-and-permissions.md` §13 |
| 测试与演示资产 | 临时 Git 仓库测试夹具、假 Claude CLI 夹具、端到端演示脚本与示例仓库 | 本文件第 8、9 节 |

### 2.2 范围外

以下能力不属于 M1，不能在 M1 的验收、演示或对外说明中出现：

- 任务依赖 DAG、交付物契约、UI Design/Frontend/Backend/DevOps 角色模板、审批门、Crew 与队长模式、收件箱、技能、任务模板（M2）。
- `allowedPaths` 与 `allowedCommands` 的强制执行、细粒度命令白名单、权限审批请求（M2）。M1 只做 worktree 级隔离、Runtime 权限参数、提示词约束与越界检测，不能宣称具备完整权限信封。
- 桌面壳会话令牌（SEC-003）、WS ticket、统一 `audit_events` 表（M2.1）。
- 推送远端分支、创建或合并代码托管平台 PR、远程仓库 clone（M3）。M1 只做本地 merge，不执行 push。
- Postgres、登录、团队与角色权限、远程 Runner、机器注册、共享 Agent、团队审计（M3）。
- 定时执行、Webhook 自动化、通知、DMG/NSIS/AppImage 打包、自动更新、插件 API、遥测（M4）。
- Codex adapter、截图作为 DoD 必需证据、direct 运行模式、容器工作区、自动重试策略与重试链 UI（M2 或更晚）。
- 单 Task 证据包导出（EVIDENCE-009 原条目）、多用户同时评审、实时协同编辑、移动端、多租户 SaaS、模型托管。

### 2.3 边界判定规则

当一个需求是否属于 M1 存在争议时，按以下顺序判断：

1. 它是否是「一个开发者用真实 Claude Code 完成一次修改并人工合并」所必需？不是则后置。
2. 它是否要求多用户、远程机器、团队权限或跨任务编排？是则后置到 M2 或 M3。
3. 它是否直接提升 worktree 隔离、证据可信度或合并安全性？是则优先纳入 M1，但仍需控制在可演示的最小范围。
4. 它是否只是让界面更好看、让日志更丰富，但不影响闭环成立？可以作为 M1 的次要项，不能挤占退出标准中的硬性能力。

### 2.4 M1 与 M2 的交界

M1 只要求 Artifact 能随 Run 保存，diff、测试输出与运行日志可以作为评审材料进入人工评审；不要求正式的交付物契约、契约版本、冻结门与依赖 DAG，也不要求 Evidence 表与逐条契约校验（Evidence 表从 M2 开始）。

M1 的合并确认是 Review（`approved`）+ MergeRecord + 显式 `confirm=true`，不是通用 Approval Gate。理由有三点：`02-domain-model.md` §3.11 明确规定「M1 不引入 Approval 实体」；§3.15 规定 MergeRecord 是合并审计记录而非授权；`security-and-permissions.md` §8.1 与 §15.1 将 `approvals` 与 `audit_events` 表都排在 M2.1。M1 的 MergeRecord 通过可空 `approvalId` 预留 M2.1 关联，但历史记录不回填、不伪造审批。

契约和审批门依赖稳定的 worktree、证据链与评审记录；如果这些基础不存在，提前引入只会增加表单而没有可信输入。

## 3. 角色与场景

### 3.1 角色

| 角色 | 在 M1 中的职责 | 不承担的职责 |
|---|---|---|
| 开发者/评审者 | 创建 Workspace、Task、Agent；启动 Run；查看 diff 与证据；批准、退回或合并 | 不手工创建 worktree 或分支；不在 M1 中审批团队权限 |
| Claude Code Runtime | 在指定 worktree 中读取代码、修改文件、运行命令、输出结构化事件与总结 | 不决定任务是否完成；不执行合并、推送或部署 |
| ATeam 系统 | 准备 worktree、调度 Run、采集证据、强制人工门、记录状态与 MergeRecord | 不代替模型生成代码；不自动解决冲突；不静默降级 Runtime；不阻断 Runtime 内的任意命令（M2） |
| Git 仓库 | 提供 base branch、提交历史、diff 与合并语义 | 不承担任务状态与评审状态；不被 ATeam 直接推送 |

### 3.2 主场景：在示例仓库修一个 bug

用户有一个 Go 示例仓库 `sample-todo`，main 分支上的 `TestCountCompleted` 失败。用户在 ATeam 中创建 Workspace（UI 显示为「项目」）并绑定该仓库，创建一个 Agent「Bug Fixer」，Runtime 选择 claude，超时设为 20 分钟，工作区模式为 worktree。用户创建一个 Task，描述中包含失败的测试、期望行为与验收标准，然后启动 Run。

系统 fetch 目标 remote，解析 base commit，在 `~/.ateam/worktrees/{repoSlug}/{runId}` 创建 worktree，并创建分支 `ateam/{taskShort}/{slug}-{runShort}`。Claude Code 在 worktree 中定位问题、修改代码、运行 `go test ./...`。运行结束后，系统按「自动提交 → 系统验证 → 证据采集」的顺序处理，生成 diff、changed files、test_report 与 log_bundle。Task 进入 in_review。用户打开 diff，确认修改范围合理、测试通过，在合并对话框中确认目标分支、源分支、commit 与证据清单，执行 squash merge。Task 进入 done，MergeRecord 与证据保留。

### 3.3 次场景

| 场景 | 期望行为 |
|---|---|
| 两个 Task 并行运行 | 两个 Run 获得不同 worktree 与分支；文件修改互不可见；仓库级 Git 操作串行化，但 Runtime 执行可并行 |
| 用户在 running 阶段取消 | 先发送优雅终止，10 秒宽限后强制终止进程组；若取消与完成同时发生，以先通过状态守卫写入的合法终态为准，另一方记录 `cancel_lost_race` |
| Run 超过 Agent 超时 | Run 进入 failed，`errorCode=timeout`；事件记录阈值与实际耗时；保留日志与工作区现场 |
| preparing 阶段 Git 挂起 | fetch、worktree add 或分支创建各自有超时；总准备阶段有上限；超时后清理半成品，Run 失败并给出 `workspace_error/git_error` |
| 评审要求修改 | Review 进入 `changes_requested` 与原因；Task 回到 in_progress；用户重新启动新 Run，旧 Run 与证据保留 |
| 合并时目标分支已前进 | 阻止自动合并，返回 412；用户重新评审或重新运行，不允许静默覆盖 |
| 合并产生冲突 | 不自动解决冲突；合并中止，MergeRecord 结果为 `conflicted`，Run 保持 `completed`，Task 保持 in_review，展示冲突文件 |
| Claude CLI 未安装或未登录 | Run 失败，`errorCode=runtime_error`，`failureDetail=runtime_missing` 或 `runtime_auth`；UI 给出安装或登录建议；不得回退到 mock |
| 仓库有未提交修改 | worktree 创建不受影响，base commit 仍以提交为准；只有合并路径需要主工作区干净时才阻止合并并提示 |
| 删除有活跃 Run 的 Task/Agent | 返回 409，提示先取消或等待 Run 结束；归档优先于硬删除 |

### 3.4 反场景（M1 明确不支持）

- 两个开发者同时打开同一个 Task 并分别评审、合并。
- Agent 在运行中请求扩大权限，或请求执行不在白名单内的命令并通过审批继续。
- 一个 Task 自动拆成 UI、前端、后端、DevOps 子任务并按 DAG 推进。
- Agent 直接把分支推送到远端或创建 PR。
- 用户在 ATeam 之外手工修改 worktree 后仍期待系统自动识别并接管。
- 在 Windows 上完成完整桌面闭环；M1 的退出验收以 macOS 为准。

## 4. 用户故事与验收标准

以下用户故事覆盖 M1 闭环的关键路径与失败路径。每条故事都附带可测试的验收补充，作为工程拆分与验收用例的来源。

### US-M1-01 绑定本地仓库并启动真实 Run

Given 用户有一个存在的本地 Git 仓库，包含 main 分支与至少一个提交，且本机已安装并登录 Claude Code CLI；
When 用户创建 Workspace、创建 Runtime 为 claude 的 Agent，并为 Task 启动 Run；
Then 系统为 Run 创建独立 worktree 与分支，Runtime 在 worktree 中执行，Run 记录 `baseCommit`、`headCommit` 与 worktree 路径，且不会回退到 mock。

验收补充：

- Workspace 的 `repoPath` 必须是绝对路径、存在且是 Git 工作树根目录；不满足时创建失败并给出具体原因。
- Run 创建后，事件流包含 `run.preparing`、`run.running` 与至少一个 Runtime 结构化事件。
- 若 claude 不可用，Run 失败且 `errorCode=runtime_error`，`failureDetail` 为 `runtime_missing` 或 `runtime_auth`；不得出现「completed 但没有改动」的假成功。

### US-M1-02 并行隔离

Given 同一仓库上有两个可执行 Task，用户为它们选择了不同的 Agent 或同一 Agent；
When 用户先后启动两个 Run，全局 worker 数允许并行；
Then 每个 Run 获得独立 worktree 与唯一分支，两个 Run 的文件改动互不可见，任一 Run 失败或取消不影响另一个 Run 的工作区。

验收补充：

- 两个 worktree 的绝对路径不同，且都位于配置的 `settings.worktreeRoot` 下。
- 分支名符合 `ateam/{taskShort}/{slug}-{runShort}`，且不重复。
- 在一个 worktree 中创建或修改的文件，不出现在另一个 worktree 的 `git status` 中。
- 同一仓库的 fetch 与 worktree 增删被串行化，不出现 `index.lock` 冲突。

### US-M1-03 结构化可观测

Given 一个正在运行的真实 Claude Code Run；
When 用户打开 Run 详情；
Then 时间线按顺序展示生命周期、状态、工具调用、文件变更、测试结果、用量、错误与结束事件，序号连续，普通日志可在 Logs 标签单独查看与下载。

验收补充：

- 关键事件类型不因日志限流而丢失；普通日志可以合并或采样，但完整日志文件保留。
- 本地 WebSocket 事件到 UI 可见的 p95 目标为 1 秒（`M1-NFR-001` / `NFR-PERF-010`），产品硬上限为 2 秒（`01-scope-and-roadmap.md` §4.3.5）；指标同时记录两者。
- 单条事件 message 超过 8 KiB 时截断并标记 `truncated=true`，单事件 payload 上限 64 KiB；两者均不阻塞 Run。
- stderr 保留 `source=stderr`，不伪装成普通 stdout 日志。

### US-M1-04 证据化完成

Given 一个代码变更类 Run 已经结束；
When 用户打开证据面板；
Then 至少能看到 diff 或 changed files，以及 test_report 或人工记录的「不适用测试」例外理由；每个证据可追溯到 Run、文件、生成时间与 sha256。

验收补充：

- `baseCommit` 在 preparing 阶段 fetch 之后解析并写入 Run；diff 以 `baseCommit...headCommit` 为基准，同时展示结束时的 `git status` 与未跟踪文件列表。
- 采集顺序固定为：Run 结束 → 可选自动提交 → 系统验证命令 → 采集 diff/status/未跟踪文件 → 生成 Artifact。
- 测试输出区分来源：系统验证命令产生的 `test_result`（`source=system`）与 Agent 自述（`source=adapter` 或 `note` Artifact）；两者不一致时标记 unverified。
- 证据缺失时，Task 不能进入 done，合并入口禁用并说明缺少哪一项。
- mock Run 不计入代码变更类 Task 的完成证据。

### US-M1-05 人工评审

Given 一个 completed 且具备初步证据的 Run；
When 评审者打开评审面板并选择 Approve 或 Request changes；
Then 决策被持久化到 Review，包含 `reviewerId`、`decidedAt`、`status`、`decisionNote` 与 `evidenceSnapshotHash`；Request changes 必须填写原因或至少一条 blocking ReviewComment。

验收补充：

- Review 状态只使用 `pending`、`in_review`、`approved`、`changes_requested`、`superseded`、`cancelled`；API 决策动词为 `approve` 与 `changes_requested`。
- 评审记录绑定 Run 与证据快照，后续新增证据不改变已作出的决定；证据变化导致哈希不匹配时，合并返回 412。
- Approve 后 Task 仍保持 in_review，直到合并成功才进入 done（`requiresMerge=true` 的 M1 默认）。
- Request changes 后 Task 回到 in_progress，原因展示在任务时间线与下一次 Run 的上下文中。

### US-M1-06 人工合并

Given 一个已 Approve 的 Run，且目标分支、head commit、目标分支 commit 与证据快照满足合并条件；
When 评审者在合并对话框中确认目标分支、源分支、合并策略与风险提示；
Then 服务端校验 Review、证据与 commit 后执行合并，Task 进入 done，MergeRecord 包含操作者、时间、目标分支、源分支、commit、策略与结果。

验收补充：

- 合并对话框默认焦点在取消按钮；必须显式勾选「我理解该操作会修改目标分支」。
- 合并请求必须携带 `reviewId`、`expectedHeadCommit`、`targetBaseCommit`、`targetBranch`、`strategy` 与 `confirm=true`；head commit 或目标分支 commit 变化时审批失效并返回 412。
- 默认使用 `squash` 策略；目标分支未前进时可选 `merge`，不提供 force merge。
- 合并失败或冲突时不得部分写入；目标分支保持可解释状态。

### US-M1-07 取消

Given 一个处于 queued、preparing 或 running 的 Run；
When 用户点击 Cancel；
Then Run 最终进入 cancelled，之后不会被执行，也不会被调度器回写为 running 或 completed；running 阶段的子进程在宽限期后被终止。

验收补充：

- queued 取消必须从待执行集合中移除，或在 worker 取出时检查状态并跳过。
- preparing 取消要中断 Git 与目录准备，清理不完整的 worktree 与分支。
- running 取消先请求优雅终止，默认宽限 10 秒，超时后终止整个进程组。
- 取消与完成竞态以先通过状态守卫写入的合法终态为准，另一方记录 `cancel_lost_race` 事件；不再宣称「取消一律优先」。
- 对终态 Run 再次取消是幂等操作，返回当前状态，不产生新事件。

### US-M1-08 超时

Given Agent 的 `timeoutMinutes` 设置为 1 分钟，Run 已进入 running；
When 执行时间超过阈值；
Then Run 进入 failed，`errorCode=timeout`、`failureDetail=timeout`，事件记录阈值与实际耗时，Runtime 进程被终止，证据采集执行尽力而为版本。

验收补充：

- 执行超时从 Run 进入 running 开始计算，不包含排队与 worktree 准备时间。
- preparing 阶段另有 Git 与总准备超时；超时映射为 `workspace_error/git_error` 或 `workspace_error/workspace_provision_failed`，并清理半成品。
- 超时不归类为普通 failed 文本错误，必须写入结构化字段。
- 超时后至少保留日志、Git 状态与已有事件。

### US-M1-09 配置快照

Given 一个 Run 已经结束，用户随后修改了 Agent 的 instructions、模型或超时；
When 用户查看历史 Run；
Then Run 展示创建时固定的 `agentVersionId` 快照、组合后的提示词哈希、Runtime 版本与生效的权限模式，历史记录不因 Agent 编辑而变化。

验收补充：

- 快照包含 Agent 的全部执行相关字段：Runtime、模型、工作区模式、超时、权限模式、允许路径、允许命令、技能版本（M2 起）的当时值。
- 快照在 Run 创建（进入 queued）时写入，执行期只读，Run 结束后不得补写。
- 快照记录提示词哈希与权限信封摘要，不要求保存完整提示词明文到事件流。
- 修改 Agent 后新建 Run 使用新版本，旧 Run 不被重写。

### US-M1-10 失败可修复

Given Runtime 缺失、认证失效、仓库不可用、磁盘不足、preparing 超时或 worktree 创建失败；
When Run 失败；
Then UI 展示 `errorCode`、`failureDetail`、可读原因与下一步动作；用户修复环境后可以新建 Run，旧 Run 记录与证据不被覆盖。

验收补充：

- `errorCode` 至少覆盖 `runtime_error`、`timeout`、`workspace_error`、`invalid_task_state`、`cancelled_by_user`、`interrupted`、`internal_error`；`failureDetail` 覆盖对应子分类（见 §5.3 表）。
- 失败 Run 不自动降级为 mock，不自动复用原 worktree。
- 手工重试创建新 Run，`attempt` 在原值上加一；原 Run 保持不可变。

### US-M1-11 合并安全与基准变化

Given 一个 Run 已 Approve，但目标分支在 Approve 后前进，或目标工作区存在未提交修改；
When 用户尝试合并；
Then 系统阻止合并并说明原因，要求用户重新评审、重新运行或手工处理；不得静默 rebase、覆盖或自动解决冲突。

验收补充：

- 目标分支 head 不等于 Review 记录的 `targetBaseCommit` 时，合并返回 412 `TARGET_BRANCH_MOVED`，原 Review 置为 `superseded` 或要求重新评审。
- 目标分支已在其他 worktree 检出，或主工作区不干净且需要就地合并时，返回 409 `TARGET_WORKSPACE_NOT_READY`。
- 冲突文件列表可查看，但系统不自动修改冲突内容。
- 用户放弃合并后，Run 分支与 worktree 按清理策略保留，不自动删除未合并改动。

### US-M1-12 删除保护与归档

Given 一个 Task 或 Agent 仍有 queued、preparing 或 running 的 Run；
When 用户请求删除；
Then 系统返回 409 并提示先取消或完成 Run；没有活跃 Run 时，删除需二次确认，Task 优先使用归档而非硬删除。

验收补充：

- 删除确认文案说明影响范围与不可逆性。
- 归档 Task 后默认列表不展示，历史 Run 与 Artifact 仍可查询。
- M1 不级联删除 Run、Artifact、Review 或 MergeRecord。

## 5. 功能需求

说明：以下需求均为 M1 计划，除非「状态」列明确标注 M0 已实现。编号统一使用 `M1-` 前缀（如 `M1-RUN-001`），与模块文档的 `RUN-`、`TASK-`、`AGENT-`、`SEC-`、`API-`、`UI-`、`NFR-` 编号空间隔离；追溯关系见第 15.2 节。

**字段序列化说明**：Workspace 的仓库与执行字段在 `02-domain-model.md` §3.1 中登记为顶层字段（`remote`、`worktreeRoot`、`verificationCommands`、`protectedBranches`），而 `runtime-and-workspace.md` §8.7 与 `api-and-data.md` 的请求体使用 `settings.*`。两者是同一字段的两种视图：持久化只保留一份（以域模型字段为准），API 可按 `settings.*` 聚合序列化，禁止双写。Artifact 的 `title`/`contentType` 同理以域模型 §3.9.1 为准，`subtype` 仅作为 `log_bundle` 等类型的二级分类。

### 5.1 Workspace、Task 与 Agent

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-TASK-001 | Workspace 是产品级归属实体，保存 `name`、`repoPath`、`defaultBranch`、`settings.remote`、`settings.worktreeRoot`、`settings.branchTemplate`、`settings.verificationCommands`、`settings.protectedBranches`、`settings.retentionDays` 与 `status`；Task 与 Run 必须带 `workspaceId` | 创建 Workspace 时校验 `repoPath` 为绝对路径、存在且为 Git 工作树根；M0 数据回填默认 Workspace；M1 单实例只有一个 Workspace，不建 `projects` 表 | M1 新增 |
| M1-TASK-002 | Task 状态由 Run 与 Review 结果驱动，但只按 §6.2 映射表变化 | Run completed 且证据齐备 → in_review 并创建 pending Review；Approve 且合并成功 → done；changes_requested → in_progress；用户取消与可重试失败保持 in_progress；不可重试失败 → blocked 并写 `blockedReason`；Run 终态不得直接映射为 Task cancelled | M1 强化 |
| M1-TASK-003 | 同一 Task 同一时间最多一个活跃 Run | 已存在 queued、preparing 或 running 的 Run 时，再次启动返回 409 与当前活动 Run ID；终态后允许新建 Run | M1 新增 |
| M1-TASK-004 | 删除与归档保护 | 存在活跃 Run 或未关闭 Review 时删除 Task/Agent 返回 409；Task 删除优先归档；M1 不做级联删除 | M1 新增 |
| M1-AGENT-001 | Run 创建时固定 `agentVersionId`，生成不可变快照 | 快照包含 Runtime、模型、工作区模式、超时、权限模式、允许路径、允许命令、提示词哈希、Runtime 版本与权限信封摘要；历史 Run 读取快照而非当前 Agent | M1 新增 |
| M1-AGENT-002 | 创建、更新 Agent 与启动 Run 时校验 Runtime 名称 | 未知 Runtime 返回 400 并列出可用 Runtime；运行前再次校验；任何路径都不得回退到 mock | M1 强化 |
| M1-AGENT-003 | Agent 支持 Runtime 权限模式字段 | 取值为 `read_only`、`controlled_edit`、`full_access`；默认 `controlled_edit`；`full_access` 必须显式开启、二次确认并显示风险；能力矩阵见 §6.5 | M1 新增 |
| M1-AGENT-004 | Agent 编辑不影响历史 Run | 修改 instructions、模型、超时或权限后，历史 Run 的快照、事件与评审记录保持不变 | M1 新增 |

### 5.2 Workspace 与 git worktree

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-WS-001 | 准备 worktree 前解析 Workspace 与本地仓库 | `repoPath` 必须存在、非 bare、有有效 `defaultBranch`；不支持自动 clone；不满足时 Run 失败并给出具体原因 | M1 新增 |
| M1-WS-002 | 按策略 fetch base branch 所在 remote | 默认只 fetch `settings.remote`；网络失败映射为 `workspace_error/git_error`；离线时可显式选择使用本地 base，但必须记录 | M1 新增 |
| M1-WS-003 | 每次 Run 创建独立 worktree 并记录 base commit | worktree 位于 `settings.worktreeRoot/{repoSlug}/{runId}`；`repoSlug` 在 Workspace 创建时计算并持久化，规则为「目录名转小写 kebab-case + 绝对路径 SHA-256 前 8 位」，避免同名目录冲突；`baseCommit` 在 preparing 阶段 fetch 后解析并写入 Run，不早于 fetch | M1 新增 |
| M1-WS-004 | 分支命名遵循统一规则 | 默认 `ateam/{taskShort}/{slug}-{runShort}`；taskShort 取 Task ID 前 8 位，slug 为标题转小写、空格转连字符、移除不安全字符、最长 32 字符，runShort 取 Run ID 前 6 位；slug 为空时退化为 `ateam/{taskShort}/{runShort}`；总长不超过 100；冲突时追加短后缀；不得使用受保护分支名 | M1 新增 |
| M1-WS-005 | 同一仓库的 Git 操作串行化 | fetch、worktree add/remove、分支创建与合并使用进程内锁与文件锁；Runtime 执行可并行，但不得同时改写同一分支 | M1 新增 |
| M1-WS-006 | Run Workspace 生命周期可追踪 | 状态为 `provisioning`、`active`、`review`、`archived`、`removed`；Run 详情与 API 可查看当前状态、路径、分支与 base commit | M1 新增 |
| M1-WS-007 | 清理策略保护未合并改动 | 未合并且有改动的 worktree 不得自动删除；已合并或放弃的默认保留 30 天（`settings.retentionDays`），M1 只标记 `archived` 并提供显式清理，不自动删除；启动扫描 orphan 只列出、不删除 | M1 新增 |
| M1-WS-008 | 失败与磁盘保护 | worktree 创建失败时清理残留；磁盘低于阈值时暂停创建并提示清理；失败写入 `workspace_error` 与对应 `failureDetail` | M1 新增 |
| M1-WS-009 | Run 成功后按固定顺序自动提交 | 仅在 Run completed 且存在改动时，在 Run 分支上 `git add -A`（遵守 .gitignore）并提交一次；消息包含 Task 标题、Task ID 与 Run 短码；无改动时不提交并记录 `status/subtype=no_changes` 事件；提交作者使用当前 Git 身份 | M1 新增 |
| M1-WS-010 | Workspace 元数据通过 API 与 UI 暴露 | `GET /api/v1/runs/{id}/workspace` 返回路径、分支、base/head commit、生命周期状态与清理状态；Task 详情展示摘要 | M1 新增 |
| M1-WS-011 | Workspace 清理与 orphan 可见 | 提供当前 Workspace 的 Run Workspace 列表、orphan 列表与显式清理端点；清理含未合并改动的 worktree 必须二次确认并记录操作者 | M1 新增 |
| M1-WS-012 | preparing 与 Git 操作有超时 | `git fetch` 默认 120 秒、worktree add/remove 默认 30 秒、preparing 总时长默认 10 分钟，均可配置；各超时映射为对应 `workspace_error` 子分类，超时后清理半成品，不占用 worker | M1 新增 |

### 5.3 Run 生命周期

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-RUN-001 | Run 记录排队时间与最后事件时间 | 增加 `queuedAt` 与 `lastEventAt`；preparing 起始时间以首个 `run.preparing` 事件时间推导，不新增 `preparingAt` 字段；时间统一 UTC | M1 新增 |
| M1-RUN-002 | queued 取消保证不执行 | 取消后从待执行集合移除，或 worker 取出时检查状态并跳过；Run 进入 cancelled 后不得再出现 running 事件 | M1 强化（M0 有缺陷） |
| M1-RUN-003 | preparing 取消清理中间产物 | 中断 fetch、worktree 创建与分支创建；清理未完成的 worktree 与分支；状态保持 cancelled | M1 新增 |
| M1-RUN-004 | running 取消先优雅后强制 | 先发送优雅终止信号，默认宽限 10 秒；超时后终止整个进程组；Run 进入 cancelled，记录 `cancelRequestedAt`、取消阶段与发起者 | M1 强化 |
| M1-RUN-005 | 终态不可变且状态写入带前置条件 | completed、failed、cancelled 为终态；所有状态写入使用条件更新（compare-and-set）；取消与完成竞态以先写入的合法终态为准，另一方记录 `cancel_lost_race` | M1 新增 |
| M1-RUN-006 | 执行超时映射为结构化失败 | `timeoutMinutes` 大于 0 时从 running 起计时；超时后 `errorCode=timeout`、`failureDetail=timeout`，记录阈值与实际耗时；保留尽力而为的证据 | M1 强化 |
| M1-RUN-007 | 失败分类写入 `errorCode` + `failureDetail` | 使用 §5.3.1 的规范映射；禁止使用 `failureCode`、`failureCategory` 等第二套字段名 | M1 新增 |
| M1-RUN-008 | 重启恢复 | 服务启动时扫描非终态 Run：queued 按创建时间重新入队；preparing/running 在 10 秒内标记为 failed，`errorCode=interrupted`、`failureDetail=app_restart`；保留事件与现场 | M1 新增 |
| M1-RUN-009 | 手工重试创建新 Run | 新 Run 使用新 worktree 与新分支，`attempt` 在原基础上加一；原 Run 保持不可变；自动重试策略不在 M1 | M1 新增 |
| M1-RUN-010 | 事件序号连续且支持背压 | 同一 Run 内 `(runId, seq)` 唯一且连续；普通日志可合并或采样，关键事件不得丢弃；完整日志落盘可下载；客户端按 `afterSeq` 补拉 | M1 强化 |
| M1-RUN-011 | 事件写入失败不阻断执行但影响完成判定 | 证据型事件写入失败时记录本地告警，并将 Run 的完成判定降级为 `runtime_error/evidence_missing` | M1 新增 |
| M1-RUN-012 | AgentVersion 与 Runtime 会话随 Run 持久化 | Run 可查询 `agentVersionId`、提示词哈希、Runtime 版本、生效权限模式与 `runtimeSessionId`；不得在 Run 结束后补写快照 | M1 新增 |

#### 5.3.1 Run 失败分类映射（`errorCode` / `failureDetail`）

| `errorCode` | `failureDetail` | 典型原因 | M1 处理 |
|---|---|---|---|
| `runtime_error` | `runtime_missing` | CLI 未安装、不在 PATH | 提示安装与配置 |
| `runtime_error` | `runtime_auth` | 未登录、Key 失效、订阅过期 | 提示重新登录 |
| `runtime_error` | `runtime_unavailable` | 网络错误、服务限流、临时 5xx | 可重试，M1 仅人工重试 |
| `runtime_error` | `invalid_agent_config` | 模型不存在、超时非法、工作区模式不支持 | 拒绝启动并提示修正 Agent |
| `runtime_error` | `adapter_crash` | Adapter panic、进程异常退出 | 记录退出码与最后日志 |
| `runtime_error` | `nonzero_exit` | Runtime 启动但非零退出 | 记录退出码与 stderr 摘要 |
| `runtime_error` | `evidence_missing` | 完成但证据不满足 DoD | 阻止进入 done，等待补齐或人工例外 |
| `runtime_error` | `runtime_version_unsupported` | CLI 版本或必需参数不兼容 | 提示升级；该子分类需回写域模型 §3.6 |
| `timeout` | `timeout` | 超过 `timeoutMinutes` | 终止进程，保留证据 |
| `workspace_error` | `workspace_provision_failed` | 目录创建失败、磁盘不足、权限不足 | 清理残留，允许人工重试 |
| `workspace_error` | `git_error` | fetch 失败、worktree 冲突、索引锁、Git 超时 | 保留现场，人工处理后重试 |
| `workspace_error` | `submodule_unsupported` | 仓库含子模块且任务依赖其内容 | 启动前拒绝并说明 |
| `workspace_error` | `sparse_checkout_unsupported` | 仓库启用稀疏检出 | 启动前拒绝并说明 |
| `invalid_task_state` | `task_not_executable` | Task 状态不可执行 | 拒绝创建或启动 Run |
| `cancelled_by_user` | `user_cancel` | 用户取消 | 终态；可人工重试 |
| `interrupted` | `app_restart` | 应用重启导致执行中断 | 提示重试；`SERVER_RESTART` 为历史别名 |
| `interrupted` | `runner_lost` | 远程 Runner 心跳超时（M3） | M3 实现，M1 不使用 |
| `internal_error` | `scheduler_internal`、`queue_rejected` | 调度器或存储异常 | 记录告警，人工介入 |

### 5.4 Claude Code Runtime adapter

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-RUNTIME-001 | 启动前探测 CLI 是否安装、版本与可用参数 | 探测不产生副作用、不读取或打印密钥；结果按机器缓存（内存即可，M1 不建机器能力表）；失败时给出安装或升级建议 | M1 新增 |
| M1-RUNTIME-002 | Runtime 不存在时显式失败 | 未知名称、CLI 不在 PATH、版本不兼容均不得回退到 mock；错误码与修复建议可被 UI 直接展示 | M1 强化（M0 会回退 mock） |
| M1-RUNTIME-003 | 解析结构化输出为统一事件 | 至少映射 `status`、`tool_call`、`tool_result`、`file_change`、`test_result`、`usage`、`error`、`done`；无法解析的行降级为 `log`（`source=adapter`），不得丢失错误信息；`test_result` 只由系统验证产生（见 §6.4） | M1 新增 |
| M1-RUNTIME-004 | 模型选择映射并记录生效模型 | `Agent.Model` 为空时使用 CLI 默认模型；非空时校验是否为该 CLI 支持的标识；实际模型写入 Run 事件与快照 | M1 新增 |
| M1-RUNTIME-005 | 权限参数按最小权限原则传入 | 默认 `controlled_edit`；`read_only` 使用非写入权限模式并禁用写工具；`full_access` 必须显式开启；不得默认跳过权限检查；生效模式写入事件与快照 | M1 新增 |
| M1-RUNTIME-006 | 工作目录与执行方式受控 | `Workdir` 必须是已准备的 worktree 绝对路径；非交互执行；不继承交互式终端状态；不把完整父进程环境传给子进程 | M1 强化 |
| M1-RUNTIME-007 | 版本兼容与错误提示 | 记录 CLI 版本与能力探测结果；必需参数缺失时返回 `runtime_error/runtime_version_unsupported`；解析失败不得泛化为「运行失败」 | M1 新增 |
| M1-RUNTIME-008 | 流式输出限流与背压 | 普通日志按时间窗口合并，关键事件不合并；事件速率超阈值时降采样并在 UI 提示；stdout/stderr 读取协程在进程退出后完全结束 | M1 新增 |
| M1-RUNTIME-009 | 取消与超时终止整个进程树 | Unix 下使用进程组终止；先优雅后强制；回收子进程，避免僵尸进程占用 worker | M1 新增 |
| M1-RUNTIME-010 | 环境变量最小过滤 | M1 按 `SEC-009` 的拒绝名单剥离 `*_KEY`、`*_TOKEN`、`*_SECRET`、`*_PASSWORD` 等变量；确需传递给某个 Agent 的模型凭据必须由用户显式绑定并记录；日志与事件不得输出密钥值 | M1 新增 |
| M1-RUNTIME-011 | 退出码与错误分类 | 非零退出、认证失败、限流、版本不兼容分别映射到可分类错误；原始 stderr 保留摘要供诊断 | M1 新增 |

#### 5.4.1 M1 关键技术决策：Claude Code 调用契约

本节把 adapter 的输入、输出与权限映射固定为可测试契约。CLI 的具体标志以能力探测为准；探测不满足时启动失败，不得静默降级。

| 决策项 | M1 契约 | 验证方式 |
|---|---|---|
| 命令行模板 | `claude -p <prompt> --output-format stream-json --verbose [--model <id>] --permission-mode <mode> [--max-turns <n>] [--allowedTools <list>]`；参数以数组传递，不经过 shell；prompt 超长时由 stdin 传入 | 单元测试断言 argv 顺序与转义；假 CLI 记录收到的参数 |
| 输出格式 | 按行 JSON（JSONL），每行一个对象；解析器只依赖 `type` 与本文约定的字段，未知字段忽略；无法解析的行降级为 log，不终止 Run | 正常、错误、限流、截断、未知事件五类夹具 |
| 事件映射 | `system` → `status`；assistant 的 `tool_use` → `tool_call`；user 的 `tool_result` → `tool_result`；文件编辑 → `file_change`；`result` → `usage` + `done`；stderr 行 → `log(source=stderr)` | 每种映射至少一个夹具；映射失败不影响进程退出码 |
| 权限模式 | `read_only` → `--permission-mode plan` 并用 `--allowedTools`/`--disallowedTools` 禁用写工具；`controlled_edit` → `--permission-mode acceptEdits`；`full_access` → `--permission-mode bypassPermissions`，必须显式开启、二次确认并写入事件 | 三种模式各一个夹具；`read_only` 负向用例断言无文件改动 |
| 版本与能力 | M1 不写死版本号；启动时执行 `claude --version`，并校验必需参数是否被支持。最低版本定义为「同时支持上述必需参数的最早版本」，在 M1 第 1 周由真实 CLI 探测后固化到 adapter 文档（owner：Runtime adapter 负责人，截止：M1 第 5 个工作日） | 伪造旧版本与缺参数的假 CLI 夹具；不兼容时 Run 失败且错误可操作 |
| 会话策略 | 每次 Run 独立会话，不传 `--resume`/`--continue`；若 CLI 返回会话标识，写入 `runtimeSessionId` 仅供诊断，不用于跨 Run 复用上下文 | 连续两个 Run 的提示词与上下文不共享 |
| 预算与轮次 | Agent 可配置最大轮次（M1 默认不限制或 100，以 Agent 配置为准）；达到上限产生 `usage` 事件并以可分类原因结束；token 与费用只记录 CLI 实际提供的数据，不估算 | 假 CLI 模拟达到上限；事件包含 `maxTurns` 与实际轮次 |
| 环境变量 | 只传 `PATH`、`HOME`、临时目录、语言运行时必要变量与显式绑定的模型凭据；其余敏感变量按 `SEC-009` 剥离 | 子进程环境断言；日志扫描无密钥 |
| 取消 | 先向进程组发送 SIGTERM，10 秒后 SIGKILL；回收子进程；无论 CLI 返回何种错误，取消确认后统一写 cancelled | 假 CLI 忽略 SIGTERM 的用例；无残留进程 |

### 5.5 Artifact 与完成证据

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-ART-001 | Artifact 元数据持久化 | 记录 `id`、`workspaceId`、`taskId`、`runId`、`type`、`subtype`（可选）、`title`、`contentType`、`size`、`sha256`、`storagePath`、`origin`、`truncated`、`createdAt`；内容不使用数据库 BLOB 存储 | M1 新增 |
| M1-ART-002 | 结束采集 diff 与 changed files | 采集 `git status`、`git diff --stat`、`git diff base...head` 与未跟踪文件列表；changed files 作为 diff Artifact 内的结构化统计，不单独建类型；二进制文件标注类型与大小 | M1 新增 |
| M1-ART-003 | 系统验证命令与 Agent 自述分离 | Workspace 可配置 `settings.verificationCommands`，Run 结束后由系统在 worktree 中复跑一次并记录命令、退出码、耗时与输出摘要；Agent 自述测试结果单独标注来源，不得伪装为系统验证 | M1 新增 |
| M1-ART-004 | 存储、校验和与容量限制 | 单个 Artifact 默认硬上限 50 MiB，超限拒绝入库并告警；文本类证据（diff、日志、测试输出）单条超过 10 MB 时截断并标记 `truncated=true`，完整内容保留为 `log_bundle`；相同内容按 sha256 去重但保留独立引用；存储路径不可被 Agent 写入 | M1 新增 |
| M1-ART-005 | 证据化完成定义可执行 | 代码变更类 Run 必须包含 `diff` Artifact，以及 `test_report` 或人工例外理由；文档类 Run 至少包含 `diff`；缺失时禁止 Task 进入 done 与合并；M1 不建 Evidence 表 | M1 新增 |
| M1-ART-006 | 采集前脱敏 | 扫描 API Key、私钥块、Bearer Token、数据库 URL 密码等模式；命中时替换并保留位置提示；环境变量只记录名称是否存在 | M1 新增 |
| M1-ART-007 | 证据不可原地修改 | 证据创建后不可编辑；修正创建新证据并通过 `supersedesId` 指向旧证据 | M1 新增 |
| M1-ART-008 | 证据事件与 UI 展示 | 生成 `artifact.created` 事件；证据面板按类型、来源、时间、摘要展示；缺失项与例外理由清晰可见 | M1 新增 |

原 EVIDENCE-009「单 Task 证据包导出」不属于闭环必需，按 §2.3 规则后置到 M2；M1 只提供按 Run 的 Artifact 下载与按 Task 的 DoD 缺失清单查询（`GET /api/v1/tasks/{id}/artifacts` 返回 Artifact 与派生 DoD 状态，不创建 Evidence 实体），不提供 zip 导出。

### 5.6 Review 与 Merge

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-REVIEW-001 | Review 记录持久化 | 字段与 `02-domain-model.md` §3.10 一致：`id`、`workspaceId`、`taskId`、`runId`、`status`、`requestedBy`、`reviewerId`、`decisionNote`、`evidenceSnapshotHash`、`requiresMerge`、`createdAt`、`startedAt`、`decidedAt`、`supersededBy`；M1 额外记录 `targetBaseCommit` 用于绑定目标分支；`evidenceSnapshotHash` 属于 M1 | M1 新增 |
| M1-REVIEW-002 | 评审状态机与决策枚举唯一 | 状态只使用 `pending`、`in_review`、`approved`、`changes_requested`、`superseded`、`cancelled`；API 决策动词为 `approve` 与 `changes_requested`；UI 文案复用同一枚举 | M1 新增 |
| M1-REVIEW-003 | 评审驱动任务状态 | Run completed 且证据齐备自动创建 pending Review；Approve 且 `requiresMerge=false` 进入 done；`requiresMerge=true` 等合并成功；changes_requested 回到 in_progress | M1 新增 |
| M1-REVIEW-004 | Approve 前置条件 | 评审人必须打开证据清单并逐项确认；证据缺失时不允许 Approve；不提供未经查看的一键批准 | M1 新增 |
| M1-REVIEW-005 | ReviewComment 持久化 | 字段：`id`、`reviewId`、`artifactId`、`filePath`、`line`、`severity`（`blocking`、`non_blocking`、`info`）、`body`、`resolvedAt`、`createdBy`、`createdAt`；评论只追加，blocking 意见只能标记解决，不能删除 | M1 新增 |
| M1-REVIEW-006 | Request changes 反馈进入下一次 Run | 退回原因写入 Review 与 ReviewComment；用户新建 Run 时，原因作为附加上下文加入组合提示词，但不修改历史 Run 记录 | M1 新增 |
| M1-REVIEW-007 | 行内评论属于 M1 范围 | 按 `ui-ux.md` UI-039 提供文件级与行内评论、已读标记；若排期紧张只能降级为文件级评论，必须由产品负责人书面接受并同步修改 UI-039 与验收口径，不得默认静默降级 | M1 新增 |
| M1-MERGE-001 | 合并对话框信息完整 | 展示目标分支、源分支、base/head commit、目标分支当前 commit、diff 统计、证据清单、评审结论与风险提示；默认焦点在取消按钮 | M1 新增 |
| M1-MERGE-002 | 服务端合并校验 | 校验 `reviewId`、Review `approved` 且未被 superseded、`evidenceSnapshotHash`、`expectedHeadCommit`、`targetBaseCommit`、目标分支状态与合并路径的工作区状态；`expectedHeadCommit` 或证据快照不匹配返回 412 `STALE_HEAD`/`STALE_EVIDENCE`，Review 状态或分支非法返回 409，且不产生 Git 副作用 | M1 新增 |
| M1-MERGE-003 | 合并策略与执行位置 | 默认 `squash`；目标分支未前进时可选 `merge`；不允许 force merge；合并优先在临时 worktree 中执行，具体分支检出矩阵见 §5.6.1 | M1 新增 |
| M1-MERGE-004 | 合并提交规则 | 提交作者为当前 Git 身份；消息包含 Task 标题、Task ID、Run ID、reviewId 与证据哈希短码；不跳过 hooks；仓库启用签名时尊重 `commit.gpgsign`，签名失败则合并失败并回滚 | M1 新增 |
| M1-MERGE-005 | 内容变化使审批失效 | 源分支 head、目标分支 commit 或证据快照变化后，原 Approve 不可用于合并；返回 412，要求重新评审；不静默 rebase | M1 新增 |
| M1-MERGE-006 | 冲突不自动解决 | 合并冲突时中止，MergeRecord 结果为 `conflicted` 并记录冲突文件；Run 保持 `completed`，Task 保持 in_review；不自动选择 ours/theirs，不自动 rebase | M1 新增 |
| M1-MERGE-007 | 合并审计记录 | 每次合并尝试写入 MergeRecord：`id`、`workspaceId`、`taskId`、`runId`、`reviewId`、`approvalId`（M1 为空）、`targetBranch`、`sourceBranch`、`strategy`、`expectedHeadCommit`、`targetBaseCommit`、`commit`、`operator`、`result`、`conflictFiles`、`evidenceSnapshotHash`、`createdAt`；`merged` 记录不可修改 | M1 新增 |
| M1-MERGE-008 | Agent 不具备合并入口 | Runtime 不暴露合并工具或命令；合并接口要求人类评审记录、显式 `confirm=true` 与 commit 绑定；服务端不提供可由 Agent 调用的合并 CLI 子命令。M1 无身份认证，无法区分恶意本机脚本，残余风险见 §5.9 | M1 新增 |

#### 5.6.1 合并执行契约

合并必须在明确的位置执行，且不能破坏用户主工作区。M1 采用以下决策矩阵：

| 目标分支检出状态 | 前置检查 | 执行方式 | 失败/冲突处理 |
|---|---|---|---|
| 未被任何 worktree 检出（推荐） | 目标分支存在；`targetBaseCommit` 匹配；源分支 head 匹配 | 在 `settings.worktreeRoot/merge/{runId}-{timestamp}` 创建临时 worktree，检出目标分支；执行 `git merge --squash <source>` 后提交，或目标未前进时 `git merge --no-ff <source>`；完成后删除临时 worktree | 任何步骤失败都删除临时 worktree；目标分支 ref 未被更新；写入 `failed` 或 `conflicted` |
| 已在主工作区检出 | 主工作区 `HEAD` 等于目标分支；`git status --porcelain` 为空（忽略 ignored 文件）；`targetBaseCommit` 匹配 | 在主工作区执行同样的 merge；执行前记录 `mergeStartHead` | 冲突时 `git merge --abort`；失败时 `git reset --hard <mergeStartHead>`（仅在执行前确认干净时允许），并报告恢复结果 |
| 已在其他 worktree 检出，或主工作区不干净/不在目标分支 | 不满足 | 拒绝合并，返回 409 `TARGET_WORKSPACE_NOT_READY`，提示用户先切换分支或提交/stash | 不自动 checkout、不自动 stash、不自动 reset |

补充规则：

- 合并前必须确认目标分支在 `settings.protectedBranches` 中；受保护分支只能通过本接口修改，ATeam 不提供直推。
- `targetBaseCommit` 在 Review 创建或 Approve 时写入，取当时目标分支 head；目标分支在 Approve 后前进时，合并返回 412，Review 被新评审取代。
- 合并提交创建后，若更新目标分支 ref 失败（例如并发写入），事务回滚并记录 `failed`；不得留下半提交状态。
- 集成测试必须覆盖：主工作区在另一分支、主工作区有未提交修改、目标分支在临时 worktree 中合并、冲突、hooks 失败、签名失败、并发移动目标分支。

### 5.7 API 与事件

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-API-001 | Workspace 接口 | `GET/POST /api/v1/workspaces`、`GET/PATCH /api/v1/workspaces/{id}`；创建与更新校验 `repoPath` 与 `defaultBranch`；`/api/v1/projects` 为兼容别名，返回同一资源 | M1 新增 |
| M1-API-002 | Run Workspace 接口 | `GET /api/v1/runs/{id}/workspace` 返回路径、分支、base/head commit、状态与清理信息；`GET /api/v1/workspaces/{id}/orphan-worktrees`、`POST /api/v1/workspaces/{id}/cleanup` 与 `POST /api/v1/runs/{id}/workspace/cleanup` 提供 orphan 列表、批量清理已归档项与单 Run 显式清理 | M1 新增 |
| M1-API-003 | Artifact 接口 | `GET /api/v1/runs/{id}/artifacts`、`GET /api/v1/artifacts/{id}`、`GET /api/v1/artifacts/{id}/content`；下载校验路径与权限，支持 `maxBytes` 预览 | M1 新增 |
| M1-API-004 | Review 与 ReviewComment 接口 | `GET/POST /api/v1/runs/{id}/reviews`、`GET /api/v1/reviews/{id}`、`POST /api/v1/reviews/{id}/decision`、`GET/POST /api/v1/reviews/{id}/comments`、`POST /api/v1/review-comments/{id}/resolve`；提交决策时校验证据快照与意见 | M1 新增 |
| M1-API-005 | Merge 接口 | `POST /api/v1/runs/{id}/merge`，请求包含 `reviewId`、`expectedHeadCommit`、`targetBaseCommit`、`targetBranch`、`strategy` 与 `confirm=true`；服务端执行全部校验 | M1 新增 |
| M1-API-006 | Run 快照接口 | `GET /api/v1/runs/{id}` 返回 `agentVersionId`、`errorCode`、`failureDetail`、workspace 摘要与证据计数；保持 M0 字段兼容 | M1 强化 |
| M1-API-007 | 结构化错误 | 新接口错误返回 `code`、`message`、`details`、`requestId`、`retryable`；M0 的 `{error: string}` 保持可解析，新增字段为增量 | M1 新增 |
| M1-API-008 | WebSocket 事件扩展 | 新增 `run.workspace.provisioning`、`run.workspace.ready`、`run.workspace.failed`、`run.workspace.cleaned`、`artifact.created`、`review.requested`、`review.approved`、`review.changes_requested`、`review.superseded`、`merge.started`、`merge.completed`、`merge.conflicted`、`run.completed`、`run.failed`、`run.cancelled`、`run.timeout`；事件负载包含对象 ID 与状态，客户端可幂等处理 | M1 新增 |
| M1-API-009 | 共享类型同步 | `packages/shared` 与 `packages/api-client` 增加 M1 类型与客户端方法；前后端编译通过，不出现手写重复类型 | M1 新增 |
| M1-API-010 | 分页与事件补拉 | 列表接口支持游标分页；Run 事件支持 `afterSeq` 补拉；断线重连后按游标补齐，不依赖 WebSocket 重放 | M1 新增 |

### 5.8 UI

| ID | 需求 | 验收标准 | 状态 |
|---|---|---|---|
| M1-UI-001 | Task 详情三栏结构 | 左栏上下文、中栏执行、右栏评审；窄屏按 1280px 与 1024px 断点折叠与堆叠；现有 Task 操作保持可用 | M1 新增 |
| M1-UI-002 | 独立 Run 详情 | 路由可直达；页头展示状态、Task 链接、Agent、时间与耗时；标签页至少包含 Timeline、Logs、Diff、Artifacts | M1 新增 |
| M1-UI-003 | Diff viewer | 文件树、变更统计、统一与分栏视图、按文件折叠、语法高亮、行内评论、已读标记、二进制提示；大 diff 使用截断提示与完整文件下载 | M1 新增 |
| M1-UI-004 | 证据面板 | 展示 diff、changed files、test_report、log_bundle 与 usage；区分系统采集与 Agent 自述；缺失项与例外理由可见 | M1 新增 |
| M1-UI-005 | 评审面板 | 提供 Approve 与 Request changes；Approve 需逐项确认证据；退回必须填写原因或 blocking 评论；显示评审人、时间与历史 | M1 新增 |
| M1-UI-006 | 合并对话框 | 展示目标分支、源分支、commit、目标分支 commit、diff 统计、证据清单与风险提示；默认焦点在取消；显式勾选后才允许合并；目标分支变化时显示失效原因 | M1 新增 |
| M1-UI-007 | 实时时间线与重连 | 使用 WebSocket 推送更新；断线后自动重连并按 `afterSeq` 补齐事件；降级为轮询时明确提示当前为降级模式 | M1 新增 |
| M1-UI-008 | 错误与修复建议 | 按 `errorCode` + `failureDetail` 显示可读原因与下一步动作；提供跳转到 Settings 或 Run 详情的入口 | M1 新增 |
| M1-UI-009 | mock 与真实 Run 明确区分 | mock Run 在列表、详情与证据面板显示显著标识；mock 证据不能触发完成或合并 | M1 强化 |
| M1-UI-010 | 空状态、加载与离线 | 无 Workspace、无 Run、无证据、断线、加载失败均有明确文案与下一步动作；不出现无解释的空白页 | M1 新增 |
| M1-UI-011 | 键盘与可访问性基线 | 目标为 WCAG 2.1 AA（对齐 `UI-108`）：核心路径键盘可达、焦点可见、文本对比度 4.5:1、对话框焦点陷阱正确、状态变化使用 aria-live polite；自动扫描无严重问题 | M1 新增 |

### 5.9 安全与权限

M1 安全需求逐项映射 `security-and-permissions.md` §13 的 M1 交付清单；不在此重复定义阈值。

| ID | 需求 | 验收标准 | 对应模块需求 |
|---|---|---|---|
| M1-SEC-001 | 默认只监听回环地址 | 无参数启动绑定 `127.0.0.1`；非回环地址（含 `0.0.0.0`、局域网 IP、`::`）启动失败并说明原因；M1 不提供远程放行开关 | SEC-001、SEC-002 |
| M1-SEC-002 | CORS 允许列表与 Host/Origin 校验 | 只允许实际监听 origin、开发端口与桌面壳随机端口；未知 Origin 返回 403 且不写 ACAO；`Origin: null` 拒绝；Host 只接受实际监听值；WebSocket 握手同样校验 | SEC-004 |
| M1-SEC-003 | 安全响应头与请求体上限 | 返回 CSP、nosniff、Referrer-Policy、frame-ancestors；全部 JSON 写接口限制 1 MiB，超限返回 413 `PAYLOAD_TOO_LARGE` | SEC-005、SEC-006 |
| M1-SEC-004 | 本地文件权限与启动失败关闭 | `~/.ateam` 为 `0700`，数据库、WAL/SHM、证据为 `0600`，Run Workspace 为 `0700`；端口占用、权限不足、非法地址时启动失败，不回退端口 | SEC-007、SEC-008 |
| M1-SEC-005 | 敏感环境变量最小过滤 | 启动 Runtime 前剥离名称匹配敏感模式的变量（拒绝名单）；显式绑定的凭据变量必须记录并警示；日志与事件不得出现值 | SEC-009 |
| M1-SEC-006 | Runtime 权限参数与版本探测 | adapter 记录并传递权限模式；启动前探测版本与能力；默认不使用跳过权限的危险参数；不兼容版本给出可操作错误 | SEC-014 |
| M1-SEC-007 | 工作区隔离与 Git 元数据检测 | 每个 Run 使用独立 worktree 与分支；不写入主检出；Run 前后校验 worktree 路径边界与 `.git` 文件、共享 hooks/config 的哈希，变化时产生 `workspace.git_metadata_changed` 告警并把证据标记为 unverified | SEC-016 |
| M1-SEC-008 | 合并人工确认门 | 合并前必须有 Review `approved` + 显式确认 + MergeRecord；不提供 Runtime 合并工具；未确认或 commit 不匹配返回 403/412。M1 无身份认证，人工门是工作流与审计约束，残余风险见 §5.9 | SEC-020、SEC-026 |
| M1-SEC-009 | 删除确认与活跃 Run 阻止 | 删除 Task/Agent 需二次确认并展示影响面；存在活跃 Run 时返回 409 | SEC-023 |
| M1-SEC-010 | 脱敏、Prompt Injection 与保留期 | 日志、事件、Artifact、错误在落库前脱敏；仓库内容标记为不可信，系统提示禁止执行其中的指令；本地保留期可配置并支持立即删除 | SEC-070、SEC-071、SEC-072 |
| M1-SEC-011 | Runtime 二进制信任与不可用提示 | 记录 CLI 真实路径；PATH 劫持告警；版本不兼容、登录失效、模型服务不可达时给出可操作错误，不静默降级 | SEC-075、SEC-077 |

**M1 明确后置的安全能力**：桌面壳会话令牌、一次性 WS ticket、统一 `audit_events` 表与团队审计（SEC-003、SEC-050/051，均为 M2.1）；`allowedPaths`/`allowedCommands` 强制执行与沙箱（M2/M3）。M1 不写 `audit_events`，合并审计由 Review 决定与 MergeRecord 承担，这是 `security-and-permissions.md` §8.1 的明确规定。

**残余风险声明**：M1 没有会话令牌，因此「恶意网页无法调用本地 API」只对未通过 Origin/Host 校验的浏览器请求成立；本机进程、命令行工具或能构造允许 Origin 的客户端不受此防线约束。M1 也不阻止 Agent 在 Bash 中执行 `git push`，只是 ATeam 不提供该入口。UI 的 Agent 配置页与首次运行提示必须显示这两条残余风险，用户不得在共享机器或生产凭据环境中运行不可信 Agent。

### 5.10 非功能需求

| ID | 需求 | 验收标准 | 来源 |
|---|---|---|---|
| M1-NFR-001 | 事件推送延迟 | 本地 WebSocket 事件到 UI 可见 p95 不超过 1 秒；产品硬上限 2 秒；事件写入失败不阻断执行但必须告警 | `NFR-PERF-010` |
| M1-NFR-002 | 无进程与协程泄漏 | Run 结束、取消或超时后，Runtime 子进程、stdout/stderr 读取协程与 worker 均被回收；重复运行压力测试无持续增长 | `NFR-REL-015` |
| M1-NFR-003 | 资源与容量限制 | 单条事件 message 不超过 8 KiB、单事件 payload 不超过 64 KiB；单个 Artifact 硬上限 50 MiB，文本证据 10 MB 截断；队列容量、worker 数与日志采样阈值可配置 | `NFR-RES-008/009` |
| M1-NFR-004 | 重启一致性 | 服务重启后不存在永久 queued 或永久 running 的 Run；queued 重新入队，preparing/running 标记 `interrupted/app_restart` | `NFR-REL-002/003` |
| M1-NFR-005 | 性能基线 | 常规仓库创建 worktree 目标在 10 秒内完成（不含网络 fetch）；50 个文件、5000 行以内的 diff 首屏渲染目标在 2 秒内 | `runtime-and-workspace.md` §8；`collaboration-and-review.md` §9 |
| M1-NFR-006 | 平台与兼容 | macOS 为退出验收平台；Linux 保证编译、Go 测试与 Web 构建通过；Windows 完整验证在 M4；SQLite 使用现有驱动 | `NFR-PORT-001/002` |
| M1-NFR-007 | 可观测与可诊断 | 每个 Run 有关联日志、事件、`errorCode`/`failureDetail` 与配置快照；JSON 日志包含 runId/taskId；不输出敏感值 | `NFR-OBS-001/004/009` |
| M1-NFR-008 | 数据完整性与迁移 | 迁移在事务中执行、可重复、失败整体回滚；迁移前自动备份 SQLite 文件；开发期允许用备份恢复到迁移前状态，不要求 undo migration；Run、Artifact、Review、MergeRecord 的引用不得悬空 | `NFR-REL-008/016` |

## 6. 关键交互与规则

### 6.1 端到端状态流

| 对象 | 状态流转 | 说明 |
|---|---|---|
| Task | backlog → todo → in_progress → in_review → done；in_review → in_progress（changes_requested）；任意非终态 → blocked（必须提供 `blockedReason`）；任意非终态 → cancelled | 只有 todo、in_progress 可启动 Run；in_review 在 M1 不可启动新 Run；done 需 Review approved 与合并成功 |
| Run | queued → preparing → running → completed 或 failed；任意非终态 → cancelled；终态不可再次执行 | 重试创建新 Run，`attempt` 递增，不复用原 Run 与 worktree |
| Run Workspace | provisioning → active → review → archived → removed | review 阶段 worktree 必须保留；未合并改动不得自动删除 |
| Review | pending → in_review；pending 或 in_review → approved 或 changes_requested；pending/in_review/approved → superseded；pending/in_review → cancelled | `approved` 被新 Run 取代后失效；不存在 `expired` 状态 |
| MergeRecord | pending → merged、conflicted、failed 或 invalidated | 只有 merged 表示成功；冲突与基准变化进入人工处理 |

### 6.2 Run 结果到 Task 状态的映射

| Run 结果 | `errorCode` / `failureDetail` | Task 变化 | 依据 |
|---|---|---|---|
| completed 且证据齐备 | 无 | in_progress → in_review，创建 pending Review | T-03 |
| completed 但证据缺失 | `runtime_error/evidence_missing` | 保持 in_progress，Review 不可 approve | T-14 |
| failed 且可重试（网络、限流、adapter crash、非零退出、timeout） | 对应子分类 | 保持 in_progress，记录原因，允许人工重试 | T-14 |
| failed 且不可重试（权限拒绝、Task 非法、不可恢复的 workspace 错误） | `permission_denied`、`invalid_task_state`、不可重试的 `workspace_error` | in_progress → blocked，写入 `blockedReason` | T-13 |
| cancelled by user | `cancelled_by_user/user_cancel` | 保持 in_progress；不自动退回 todo 或 blocked | T-14 |
| interrupted（应用重启） | `interrupted/app_restart` | 保持 in_progress，允许人工重试 | T-14 |
| Review changes_requested | 无 | in_review → in_progress | T-05 |
| Review approved 且合并成功 | 无 | in_review → done | T-04 |
| 合并冲突 | 无 | 保持 in_review；Run 保持 completed；不引入 blocked | runtime §9.3 |

任何情况下都不得把 Run 的终态直接映射为 Task 的 cancelled；Task 取消必须由人类显式操作（T-10）。

### 6.3 评审与合并门规则

1. Run completed 只表示 Runtime 正常退出，不表示 Task 完成。Task 最多进入 in_review，必须经过人工评审与合并才能 done。
2. Approve 必须基于证据快照。评审人需要逐项确认 diff、test_report 与例外理由；缺失证据时只能 Request changes 或补齐证据。
3. 合并审批绑定源分支 head 与目标分支 commit：`expectedHeadCommit` 与 `targetBaseCommit` 任一变化，原 Approve 不可用于合并，返回 412 要求重新评审；不静默 rebase。
4. 合并前检查目标分支与合并路径：目标分支必须存在且属于受保护分支；临时 worktree 路径可写；主工作区就地合并时必须干净且 HEAD 等于目标分支（见 §5.6.1）。
5. 默认 squash merge。合并提交包含 Task 标题、Task ID、Run ID、reviewId 与证据哈希；不使用 force push，不跳过 Git hooks。
6. 冲突不自动解决。合并中止后记录 `MergeRecord.result=conflicted` 与冲突文件；Run 保持 completed，Task 保持 in_review，由人工解决或新建 Run。
7. Agent 不能合并。Runtime 不暴露合并工具；合并接口要求人类 Review 与显式确认；服务端不接受缺少 `reviewId` 或 `expectedHeadCommit` 的请求。
8. 放弃合并不会丢失证据。Run 分支与 worktree 按清理策略保留；未合并改动不得被自动删除，用户需显式确认。

### 6.4 异常与边界

| 场景 | 系统行为 | 用户可见结果 |
|---|---|---|
| Claude CLI 未安装 | Run 失败，`runtime_error/runtime_missing` | 错误卡片给出安装建议与 Settings 入口；不回退 mock |
| Claude CLI 未登录或凭据失效 | 启动或首个请求失败，`runtime_error/runtime_auth` | 提示重新登录；保留已产生的事件 |
| CLI 版本或必需参数不兼容 | Run 失败，`runtime_error/runtime_version_unsupported` | 显示当前版本、缺失能力与升级建议 |
| 仓库路径不存在或不是 Git 根目录 | Workspace 创建或 Run 准备失败 | 指明路径与原因；不创建 worktree |
| base branch 不存在 | Run 准备失败，`workspace_error/git_error` | 提示检查 Workspace 配置 |
| fetch 失败或超时 | `workspace_error/git_error`；允许重试或显式使用本地 base | 显示 fetch 错误摘要；不静默使用过期远端 |
| worktree 创建冲突或 index.lock | 仓库操作串行化；冲突时失败并保留现场 | 提示重试或检查其他 Git 进程 |
| 磁盘空间不足 | 暂停创建新 worktree，Run 失败 | 显示剩余空间与清理入口 |
| Run 无代码改动 | 不提交，记录 `status/subtype=no_changes` 事件 | 评审界面显示「无改动」，不能作为代码变更证据 |
| diff 超过阈值 | 界面截断展示，完整内容保留为 Artifact | 显示截断提示与下载入口 |
| 二进制文件变更 | 不展示内容，展示类型、大小与路径 | 评审者可下载或本地查看 |
| Agent 自述测试通过但系统验证失败 | 保留两份结果，证据标记 unverified | 合并入口禁用；评审者可要求修改 |
| 验证命令执行失败或超时 | 记录 `test_report` 与失败原因；不伪造通过 | 证据面板标记 failed；DoD 不满足 |
| 取消与完成竞态 | 先通过状态守卫写入的合法终态获胜，另一方记录 `cancel_lost_race` | 状态稳定为其中一个合法终态，事件保留竞态记录 |
| 服务重启时 Run 正在执行 | 10 秒内标记 `interrupted/app_restart`；保留日志与工作区 | 用户可查看现场并新建 Run |
| 合并时目标工作区不干净（就地合并路径） | 拒绝合并，列出未提交文件 | 提示先提交或 stash，或切换到其他分支 |
| 合并时目标分支前进 | 返回 412，显示 base 与当前 head 差异 | 要求重新评审或重新运行 |
| Agent 改写 worktree 的 `.git` 文件或共享 hooks | Run 结束时检测到哈希变化，产生 `workspace.git_metadata_changed` 告警 | 证据标记 unverified，合并前必须人工确认 |
| Agent 尝试修改 worktree 外文件 | M1 做路径校验与越界写入检测；检测到即告警 | 事件记录越界尝试；真正阻止在 M2 |

### 6.5 权限模式能力矩阵

| 模式 | 工作区写入 | 工具/命令 | Runtime 参数 | 验收用例 |
|---|---|---|---|---|
| `read_only` | 禁止（由 CLI 权限模式与工具禁用实现） | 只读工具；不启用写文件与执行命令工具 | `--permission-mode plan` + 禁用写工具 | Agent 尝试编辑文件被拒，worktree 无改动；事件记录被拒 |
| `controlled_edit` | 允许在 worktree 内修改 | 允许 CLI 内置编辑与命令工具；路径/命令策略尚未强制执行 | `--permission-mode acceptEdits` | worktree 内文件变更被记录；`.git` 元数据变化被检测；不宣称已拦截 `git push` |
| `full_access` | 允许 OS 用户可写的一切 | 不限制工具 | `--permission-mode bypassPermissions`，必须显式开启、二次确认 | 保存与每次生效都写事件与快照；UI 显示高风险警示 |

### 6.6 权限与安全规则

M1 处于单用户本地模式，用户既是操作者也是审批者。产品必须明确显示「你正在批准自己的操作」，并要求二次确认；不把单用户自批包装成多人治理。完整信任模型、网络边界与权限信封见 `security-and-permissions.md` 第 2、3、5、6 章。

M1 的硬性安全规则：

- 默认只监听本机回环地址；非回环地址启动失败；CORS 与 WebSocket 只接受允许的 Origin/Host。
- Runtime 只能写入 worktree；路径 `..` 与符号链接逃逸被拒绝；`.git` 文件与共享 hooks/config 的变更会被检测并告警。
- 合并、推送、部署、删除属于高风险动作；M1 只实现合并，且合并必须人工确认。推送、部署不在 M1。M1 无身份认证，合并门是工作流与审计约束，不是对抗恶意本机进程的安全边界；该残余风险在 M2.1 会话令牌后关闭。
- 日志、事件、证据与错误中的密钥必须脱敏；凭据不落盘明文。
- 不使用 `git push --force`、不跳过 hooks、不删除远程分支；ATeam 不执行 push。
- 合并与清理动作写入 Review、MergeRecord 与结构化日志；M1 不写 `audit_events`（M2.1）。

## 7. 数据与 API 影响

### 7.1 新增与变更的数据模型

字段语义以 `02-domain-model.md` 为准；本节只列 M1 实际落地的字段与视图。

| 实体/字段 | 关键内容 | 用途 |
|---|---|---|
| Workspace | `id`、`name`、`repoPath`、`defaultBranch`、`settings`（`remote`、`worktreeRoot`、`branchTemplate`、`verificationCommands`、`protectedBranches`、`retentionDays`、`repoSlug`）、`status`、`createdAt`、`updatedAt`、`archivedAt` | 绑定本地仓库与执行策略；M1 只建 `workspaces` 表，不建 `projects` 表 |
| Task.workspaceId | 关联 Workspace 的外键；Run 的 `workspaceId` 必须与 Task 一致 | 解析仓库与 base branch |
| Run 扩展字段 | `workspaceId`、`agentVersionId`、`attempt`、`workspaceState`、`baseCommit`、`headCommit`、`runtimeSessionId`、`errorCode`、`failureDetail`、`queuedAt`、`lastEventAt`、`cancelRequestedAt` | 支撑 worktree、失败分类、快照与恢复 |
| AgentVersion | `id`、`agentId`、`versionNumber`、`snapshot`、`contentHash`、`createdAt` | 不可变执行配置；M1 的 `snapshot` 等价于 RunConfigSnapshot 内容，不另建快照表 |
| Artifact | `id`、`workspaceId`、`taskId`、`runId`、`type`、`subtype`、`title`、`contentType`、`size`、`sha256`、`storagePath`、`origin`、`truncated`、`supersedesId`、`createdAt` | 保存 diff、test_report、log_bundle、note、file |
| Review | `id`、`workspaceId`、`taskId`、`runId`、`status`、`requestedBy`、`reviewerId`、`decisionNote`、`evidenceSnapshotHash`、`requiresMerge`、`targetBaseCommit`、`createdAt`、`startedAt`、`decidedAt`、`supersededBy` | 人工评审记录；`targetBaseCommit` 为 M1 扩展，待回写域模型 |
| ReviewComment | `id`、`reviewId`、`artifactId`、`filePath`、`line`、`severity`、`body`、`resolvedAt`、`createdBy`、`createdAt` | 行内与文件级评审意见 |
| MergeRecord | `id`、`workspaceId`、`taskId`、`runId`、`reviewId`、`approvalId`（M1 空）、`targetBranch`、`sourceBranch`、`strategy`、`expectedHeadCommit`、`targetBaseCommit`、`commit`、`operator`、`result`、`conflictFiles`、`evidenceSnapshotHash`、`createdAt` | 合并审计与结果追溯 |
| RunEvent 扩展 | `level`、`source`（stdout/stderr/system/adapter）、`truncated` | 区分日志来源，支持截断与事件演进 |

**M1 明确不建的表**：`approvals`、`audit_events`、`evidence`、`task_dependencies`、`contract_versions`、`crews`、`machines`、`runners`。机器能力探测结果在 M1 只缓存在内存，不建 `machine_capabilities` 表。

### 7.2 API 增量

| 方法 | 路径 | 用途 | 里程碑 |
|---|---|---|---|
| GET/POST | `/api/v1/workspaces` | 列出与创建 Workspace（`/api/v1/projects` 为兼容别名） | M1 |
| GET/PATCH | `/api/v1/workspaces/{id}` | 读取与更新 Workspace；修改仓库字段前检查活跃 Run | M1 |
| GET | `/api/v1/runs/{id}/workspace` | 查询 Run Workspace 路径、分支、commit 与生命周期状态 | M1 |
| GET | `/api/v1/workspaces/{id}/orphan-worktrees` | 列出无数据库记录的 orphan worktree（只读） | M1 |
| POST | `/api/v1/workspaces/{id}/cleanup` | 批量清理已归档的 Run Workspace；未合并改动需二次确认 | M1 |
| POST | `/api/v1/runs/{id}/workspace/cleanup` | 显式清理单个 worktree；未合并改动需二次确认 | M1 |
| GET | `/api/v1/runs/{id}/artifacts` | 列出 Run 的证据与附件 | M1 |
| GET | `/api/v1/artifacts/{id}` | 读取 Artifact 元数据 | M1 |
| GET | `/api/v1/artifacts/{id}/content` | 下载或预览 Artifact 内容 | M1 |
| GET/POST | `/api/v1/runs/{id}/reviews` | 列出与提交评审 | M1 |
| GET | `/api/v1/reviews/{id}` | 读取评审详情 | M1 |
| POST | `/api/v1/reviews/{id}/decision` | 提交 `approve` 或 `changes_requested` | M1 |
| GET/POST | `/api/v1/reviews/{id}/comments` | 列出与添加 ReviewComment | M1 |
| POST | `/api/v1/review-comments/{id}/resolve` | 解决 blocking 意见 | M1 |
| POST | `/api/v1/runs/{id}/merge` | 在人工确认后执行合并 | M1 |
| GET | `/api/v1/runs/{id}` | 返回扩展后的 Run，包含快照、失败码与 workspace 摘要 | M1 |
| GET | `/api/v1/tasks/{id}/artifacts` | 返回 Task 的 Artifact 聚合与派生 DoD 缺失清单（不提供 zip 导出；M1 不建 Evidence 实体） | M1 |
| POST | `/api/v1/runs/{id}/cancel` | 语义强化：覆盖 queued、preparing、running，保证终态与幂等 | M1 |
| POST | `/api/v1/runs/{id}/retry` | 基于原 Run 创建新 Run，`attempt` 递增 | M1 |

### 7.3 WebSocket 事件

| 事件 | 触发 | 关键负载 |
|---|---|---|
| `run.workspace.provisioning` | 开始准备 worktree | runId、baseBranch |
| `run.workspace.ready` | worktree 与分支创建完成 | runId、path、branch、baseCommit |
| `run.workspace.failed` | 准备失败 | runId、errorCode、failureDetail |
| `run.workspace.cleaned` | 显式清理完成 | runId、path |
| `artifact.created` | 证据落盘 | runId、artifactId、type、size |
| `review.requested` | Review 创建 | runId、reviewId、status |
| `review.approved` / `review.changes_requested` | 评审决策 | runId、reviewId、reviewerId |
| `review.superseded` | 审批因新 Run 或新 Review 失效 | runId、reviewId、supersededBy |
| `merge.started` / `merge.completed` / `merge.conflicted` | 合并阶段变化 | runId、targetBranch、commit、mergeRecordId、conflictFiles |
| `run.completed` / `run.failed` / `run.cancelled` / `run.timeout` | Run 终态 | runId、status、errorCode、failureDetail、updatedAt |

事件命名以 `api-and-data.md` §6.4 为准；新增事件不得破坏 M0 的 `task.*`、`agent.*`、`run.*` 与 `run.event`。`no_changes` 与 `cancel_lost_race` 是 RunEvent 的 `status` 事件子类型，不新增顶层 WebSocket 事件。

### 7.4 兼容与迁移

- 数据库采用内嵌 SQL 迁移，新增表与字段以增量脚本执行；迁移在事务中执行，失败整体回滚，迁移前自动备份。
- M0 的 REST 路径与字段保持可用；M1 起新端点统一使用 `/api/v1`，`/api/*` 作为兼容别名并携带弃用头。
- 错误响应从 `{error: string}` 扩展为包含 `code`、`message`、`details`、`requestId`、`retryable`；旧客户端仍能读取 `error` 字段。
- `packages/shared` 与 `packages/api-client` 必须与 Go 端类型同步更新；不允许前端手写一份独立类型。
- RunEvent 增加 `level`、`source`、`truncated`；旧事件按默认值解释。
- Workspace/Project 命名只保留一个实体：表名为 `workspaces`，字段为 `workspace_id`；API 同时接受 `/api/v1/projects` 别名；不双写。

## 8. 交付物

### 8.1 工程交付物

| 交付物 | 内容 | 验收方式 |
|---|---|---|
| Go 核心 | Workspace 管理、worktree 准备与清理、Claude 结构化适配器、Artifact 采集、Review 与 Merge 服务、Run 生命周期强化 | 单元测试与集成测试通过 |
| SQLite 迁移 | `workspaces`、`agent_versions`、`artifacts`、`reviews`、`review_comments`、`merge_records` 与 Run 扩展字段 | 迁移在空库与 M0 库上均可执行，失败可回滚 |
| REST/WS API | 第 7.2、7.3 节列出的增量接口与事件 | API 测试与前端联调通过 |
| Vue UI | Task 三栏详情、Run 详情、diff viewer、证据面板、评审面板、合并对话框、错误与重连状态 | 端到端演示通过 |
| 共享包 | `packages/shared` 类型与 `packages/api-client` 客户端方法 | Go 与 TypeScript 编译通过 |
| 测试夹具 | 临时 Git 仓库生成器、假 Claude CLI、失败/超时/取消/挂起场景脚本 | CI 中稳定运行 |
| 演示仓库 | 带一个失败测试的示例项目与初始化脚本 | 演示脚本可重复执行 |

### 8.2 用户可见交付物

- 一个可运行的本地 ATeam 版本，能够绑定本地仓库并完成 Task 到合并的闭环。
- 一个真实 Run 详情页，展示结构化时间线、完整日志、diff、证据与失败修复建议。
- 一个可操作的评审与合并流程，包含人工确认、证据清单与审批失效提示。
- 一个可重复的演示脚本，任何工程师按脚本可在 15 分钟内复现闭环。

### 8.3 测试与质量交付物

- 针对 Workspace 创建、worktree 创建、`repoSlug`、分支命名、路径边界、清理策略的单元测试。
- 针对取消（queued、preparing、running）、执行超时、preparing/Git 超时、进程组回收、状态竞态的集成测试。
- 针对 Claude 结构化输出解析的夹具测试，覆盖正常、错误、限流、截断、未知事件与三种权限模式。
- 针对证据采集顺序、脱敏、大小限制、sha256 与 DoD 判定的测试。
- 针对评审、合并校验、审批失效、目标分支前进、冲突、主工作区状态、签名失败、hooks 失败的测试。
- 端到端演示测试：临时仓库 + 假 CLI 自动化执行完整闭环。

### 8.4 文档交付物

- `README.md` 更新当前状态：明确 M1 已实现的能力与仍未实现的能力，删除或修正与真实代码不符的描述。
- `runtime-and-workspace.md` 更新最终失败码、事件类型、worktree 路径、清理策略与 §8.7 的 Workspace 命名。
- `collaboration-and-review.md` 更新 M1 评审记录的轻量实现、ReviewComment 与 M2 Approval 的差异。
- `security-and-permissions.md` 更新 M1 无会话令牌的残余风险、`.git` 元数据检测与合并确认规则。
- `ui-ux.md` 更新 Task 三栏、Run 详情、diff 行内评论、证据、评审与合并对话框的最终交互。
- `api-and-data.md` 登记 orphan/cleanup 端点、`targetBaseCommit` 与 M1 事件名。
- Runtime 适配说明：记录支持的 Claude Code 能力矩阵、结构化输出模式、权限参数语义与已知限制。

## 9. 演示脚本

演示脚本是 M1 验收的可重复证据。它使用一个真实的本地示例仓库与真实 Claude Code CLI，按固定步骤验证从 Task 到合并的完整闭环。

### 9.1 演示前提

- macOS 14 或以上；Git 2.40 或以上；Go 1.27；Node 24；pnpm 11；Wails v3 可选。
- Claude Code CLI 已安装、已登录，且能力探测通过。
- ATeam 已构建：`make build`，并可执行 `./bin/ateam serve --db .data/ateam.db --web apps/web/dist`。
- 示例仓库路径由环境变量提供：`export SAMPLE_REPO="${SAMPLE_REPO:-$HOME/work/sample-todo}"`；运行 `scripts/demo/init-sample-todo.sh "$SAMPLE_REPO"` 创建带失败测试的仓库。
- 演示前清空 ATeam 数据库或使用全新的数据目录。

### 9.2 示例仓库与示例数据

示例仓库是一个最小的 Go todo 应用：

- `main.go` 提供按状态筛选 todo 的逻辑。
- `main_test.go` 中 `TestCountCompleted` 期望筛选「completed」后返回 2 条记录，当前实现错误地返回 3 条。
- Workspace 名称：`sample-todo`；`repoPath=$SAMPLE_REPO`；`defaultBranch=main`；`settings.remote=origin`；`settings.verificationCommands=["go test ./..."]`；`settings.worktreeRoot` 使用默认值。
- Agent 名称：`Bug Fixer`；Runtime 为 `claude`；模型留空以使用 CLI 默认；超时 20 分钟；工作区模式为 worktree；权限模式为 `controlled_edit`。
- Task 标题：`Fix completed filter count`（英文，确保 slug 可预测）；Task ID 示例为 `1a2b3c4d5e6f7a8b9c0d1e2f`；描述包含失败测试、期望行为、验收标准与不允许修改的文件。
- slug 推导：`fix-completed-filter-count`（26 字符）；分支名示例为 `ateam/1a2b3c4d/fix-completed-filter-count-9f8e7d`。若使用中文标题，slug 为空，按规则退化为 `ateam/1a2b3c4d/9f8e7d`。

### 9.3 演示步骤

1. 启动 ATeam 服务，打开 Web UI，确认健康检查通过，Settings 中 Runtime 探测显示 claude 已安装、能力可用。
2. 创建 Workspace `sample-todo`，填入仓库路径、remote、默认分支与验证命令，保存后确认路径校验通过。
3. 创建 Agent `Bug Fixer`，选择 claude、默认模型、20 分钟超时、worktree 模式与 `controlled_edit` 权限，保存。
4. 创建 Task `Fix completed filter count`，填写描述与验收标准，绑定 Workspace，状态设为 todo。
5. 在 Task 详情选择 `Bug Fixer` 并点击 Run。观察 Run 依次进入 queued、preparing、running；准备完成后记录 worktree 路径与分支名。
6. 在终端执行 `git -C "$SAMPLE_REPO" worktree list`，确认出现 ATeam 创建的 worktree；分支名符合 `ateam/1a2b3c4d/fix-completed-filter-count-9f8e7d` 形式。
7. 在 Run 详情观察结构化时间线：Adapter 产生的 `tool_call`、`tool_result`、`file_change` 与 `usage`；Run 结束后系统验证产生 `test_result`。在 Logs 标签查看完整日志。
8. 打开证据面板，确认存在 diff、changed files、系统验证命令 `go test ./...` 的 `test_report`、log_bundle 与 usage；确认测试通过，且测试结果来源为 `system`。
9. 打开 diff viewer，按文件查看修改；确认只改动了与筛选计数相关的文件，没有越界修改；使用行内评论添加一条非阻塞意见。
10. 在评审面板点击 Approve，逐项确认证据清单；填写评审意见「修改范围符合预期，测试通过」。
11. 点击 Merge，打开合并对话框；确认目标分支 main、源分支、head commit、目标分支 commit、diff 统计与证据清单；勾选风险确认后执行 squash merge。
12. 返回 Task，确认状态为 done；打开 MergeRecord，确认操作者、时间、commit 与 reviewId；在示例仓库执行 `git log -1 --stat` 与 `go test ./...`，确认合并提交存在且测试通过。
13. 在 Workspace 页面确认该 worktree 进入 archived 状态；执行一次显式清理，确认未合并改动没有被自动删除。
14. 可选：执行一次 Request changes 流程，确认 Task 回到 in_progress，新建 Run 使用新 worktree，旧证据仍可查看。

### 9.4 演示通过判定

演示必须一次性连续通过，且满足以下全部条件：

- 第 5 至 12 步中，用户没有手工创建分支、worktree、提交或执行合并命令。
- Run 事件中至少出现一个真实的 `tool_call`、`file_change`，以及系统验证产生的 `test_result`；Adapter 不得伪造 `test_result`。
- `test_result` 的 payload 至少包含 `command`、`args`、`exitCode`、`durationMs`、`passed`、`failed`、`truncated` 与 `artifactId`；落库位置为 RunEvent 与 `test_report` Artifact。
- 证据面板中的 diff 来自 worktree，且与合并 commit 的变更一致。
- 合并只有在第 10 步 Approve 与第 11 步显式确认后才发生；在 Approve 之前尝试合并应被拒绝。
- 服务端在源分支 head 或目标分支 commit 变化后拒绝旧审批；演示中可通过在 worktree 追加一次提交或移动目标分支后重试合并来验证。
- Task 进入 done 的前提是证据齐全且合并不冲突；缺少 test_report 时合并按钮禁用。

### 9.5 反向演示

反向演示用于证明安全边界，不要求每次完整执行，但必须在 M1 验收中至少各执行一次：

- 将 claude 从 PATH 中移除或在 Settings 中指向不存在的路径，启动 Run：Run 失败为 `runtime_error/runtime_missing`，不出现 mock 成功。
- 启动一个长任务后点击 Cancel：Run 在 10 秒宽限期后进入 cancelled，终端中不残留 claude 进程。
- 在同一 Task 已有活动 Run 时再次启动：请求被拒绝，显示当前活动 Run。
- 在 Run 期间移动 main 分支并提交，再尝试合并：合并被阻止并提示基准已变化（412）。
- 在目标工作区制造未提交修改后尝试就地合并：合并被拒绝并列出未提交文件，且系统没有自动 stash 或 checkout。
- 在 worktree 中手动改写 `.git` 文件后结束 Run：事件出现 `workspace.git_metadata_changed` 告警，证据标记 unverified。

## 10. 依赖

### 10.1 外部依赖

| 依赖 | 说明 | 失败影响 |
|---|---|---|
| Git | 需要 worktree、diff、merge、分支与 status 能力；建议 2.40 以上 | 无法创建隔离工作区，M1 无法退出 |
| Claude Code CLI | 必须已安装、已登录，且支持 `-p`、`--output-format stream-json`、`--model`、`--permission-mode` 等 M1 必需参数；版本下限在 M1 第 1 周固化 | 真实 Run 无法执行；mock 不能替代 M1 验收 |
| 操作系统能力 | 进程组终止、文件权限、符号链接解析；macOS 为退出验收平台 | 取消与路径防护可能不完整 |
| 本地文件系统 | 需要足够磁盘空间保存 worktree、证据与日志 | 创建或采集失败，Run 进入失败分类 |
| Go 1.27、Node 24、pnpm 11、Wails v3 | 构建与桌面壳依赖 | 构建失败或桌面演示不可用 |
| SQLite（modernc.org/sqlite） | 本地持久化，不引入外部数据库 | M1 无法保存状态与证据索引 |

### 10.2 内部依赖

- M0 的 Task、Agent、Run、RunEvent 领域模型与 SQLite 存储必须保持可用。
- M0 的调度器队列、事件 Hub 与 API 路由是 M1 的改造基础；M1 需要在不破坏现有接口的前提下增加状态守卫与失败分类。
- `packages/shared` 与 `packages/api-client` 必须随 API 增量同步。
- `02-domain-model.md` 的实体与状态机、各模块文档的 FR 编号是 M1 细节的规范来源；实现与文档冲突时必须先修正文档再实现，冲突处理见 §15.3。

### 10.3 依赖失败时的处理

- Claude CLI 不可用：M1 不能以 mock 替代验收；UI 明确提示安装与登录，Run 失败分类，用户修复后重试。
- CLI 版本或参数不兼容：启动失败并给出所需能力清单；不得在解析失败后继续运行。
- Git 版本过低：Workspace 创建或 Run 准备阶段拒绝，并给出最低版本要求。
- 网络不可用：允许显式选择使用本地 base，不静默忽略 fetch 失败；记录本次 Run 使用的是本地基准。
- 磁盘不足：暂停创建 worktree，提示清理；不在空间不足时继续写证据。
- 跨平台差异：M1 只承诺 macOS 完整闭环；Linux 作为编译与测试平台，Windows 在 M4 前不作为验收对象。

## 11. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 | 触发信号 |
|---|---|---|---|---|
| Claude CLI 输出格式或参数变化 | 结构化解析失败，事件缺失 | 中 | 能力探测、版本记录、夹具测试、未知行降级为 log、失败关闭 | 解析错误率上升或 fixture 失败 |
| worktree 与特殊仓库不兼容 | 子模块、LFS、符号链接、嵌套仓库导致准备失败 | 中 | M1 只支持普通本地仓库；检测到不支持特性时明确拒绝；夹具覆盖常见边界 | 准备失败集中在特定仓库 |
| 取消竞态与僵尸进程 | 状态回写错误、worker 被占用 | 中 | 终态条件更新、队列移除、进程组终止、竞态集成测试 | 取消后仍出现 running 事件 |
| 合并造成数据丢失 | 目标分支被错误改写 | 低 | 人工确认、`expectedHeadCommit` + `targetBaseCommit`、临时 worktree 优先、冲突中止、禁止 force push | 合并校验被绕过或冲突被自动处理 |
| 合并路径破坏用户主工作区 | 未提交修改丢失 | 中 | 就地合并仅在干净且 HEAD 匹配时允许；失败用 `merge --abort` 或恢复到 `mergeStartHead`；其他情况拒绝 | 用户报告主工作区被修改 |
| 证据包含密钥 | 本地泄露或误分享 | 中 | 采集前脱敏、导出前扫描、环境变量只记录名称 | 脱敏测试发现遗漏模式 |
| 大 diff 或日志洪峰拖垮 UI | 评审不可用、事件延迟 | 中 | 事件限流、diff 截断与虚拟滚动、完整内容落盘 | p95 延迟超过 1 秒或页面卡顿 |
| 范围蔓延到 M2 | 里程碑延期，基础不稳 | 高 | 第 2.3 节判定规则、非目标清单、退出标准只认 M1 闭环 | 出现 DAG、契约、角色模板需求 |
| 单用户自批风险 | 用户误操作合并 | 中 | 显式确认、默认焦点取消、风险提示、MergeRecord 审计 | 误合并或无评审合并 |
| M0 数据迁移失败 | 升级后数据不可用 | 低 | 事务迁移、迁移前备份、失败回滚、迁移测试 | 迁移在 M0 库上失败 |
| 测试夹具依赖真实 CLI | CI 不稳定、成本高 | 中 | 假 CLI 夹具覆盖协议；少量真实 CLI 冒烟测试单独运行 | CI 随机失败 |
| 声明与执行能力不符 | 用户误以为 M1 已阻断命令级风险 | 高 | §1.3 与 §5.9 明示残余风险；UI 首次运行提示；不在文案中使用「已阻断」 | 用户反馈「以为不能 push」 |
| 清理策略误删未合并改动 | 用户工作丢失 | 低 | 未合并不得自动删除；orphan 只标记；删除需显式确认 | 出现自动清理未合并 worktree 的路径 |

## 12. 指标

M1 的指标只用于本地验收与产品判断，不引入遥测上传。数据来自 SQLite、测试报告与演示记录。

| 指标 | 定义 | M1 目标 | 采集方式 |
|---|---|---|---|
| 本地闭环演示成功率 | 按第 9 节脚本从创建 Task 到合并成功的完成率 | 连续 3 次全新环境演示均成功 | 演示记录 |
| worktree 隔离违规数 | 两个并行 Run 之间可见对方修改的次数 | 0 | 集成测试与演示检查 |
| 证据完整率 | 代码变更类 Run 中具备 diff 与 test_report（或例外理由）的比例 | 100% | 证据面板与测试断言 |
| 未授权合并数 | 没有人类 Review 或显式确认却执行的合并次数 | 0 | 服务端校验与测试 |
| 取消响应时间 | 从 Cancel 到 Run 进入 cancelled 的时间 | p95 不超过 12 秒（10 秒宽限加 2 秒收敛） | 集成测试计时 |
| 超时分类准确率 | 超时场景中 `errorCode=timeout` 且状态为 failed 的比例 | 100% | 集成测试 |
| 事件推送延迟 | 本地 WebSocket 从事件产生到 UI 可见的时间 | p95 不超过 1 秒；硬上限 2 秒 | 本地压测 |
| 结构化事件覆盖 | 已声明事件类型均有解析与展示路径的比例 | 100% 的已声明类型有夹具测试 | 测试清单 |
| 历史 Run 快照缺失数 | 查看历史 Run 时无法获得 `agentVersionId` 快照的次数 | 0 | 数据断言与 UI 检查 |
| 合并冲突自动解决数 | 系统自动选择 ours/theirs 或自动 rebase 的次数 | 0 | 代码审查与测试 |
| 清理误删数 | 未合并改动被自动删除的次数 | 0 | 集成测试与审计 |

指标的使用原则：

- 不以「Run 数量」或「生成代码行数」作为 M1 成功指标。
- 不把 mock Run 计入闭环演示成功率。
- 指标未达标时优先修复隔离、证据与合并安全，不用 UI 装饰掩盖。
- M1 不采集用户行为遥测；所有统计在本地可查、可删除。

## 13. 退出标准

退出标准是 M1 宣布完成的唯一依据。功能、质量、安全、文档与演示五组清单全部满足，且没有触发一票否决条件，才允许进入 M2。

### 13.1 功能退出清单

1. Workspace 可绑定本地 Git 仓库与默认分支，Task 可归属 Workspace；M0 数据回填默认 Workspace。
2. 每次真实 Run 创建独立 worktree 与唯一分支，Run 记录 base/head commit 与 worktree 路径。
3. 真实 Claude Code adapter 输出结构化事件，支持模型与权限参数，Runtime 缺失时不回退 mock。
4. Run 结束后按固定顺序处理：存在改动时自动提交一次，执行系统验证，采集 diff、changed files、test_report、log_bundle 与 usage，并生成可查看的 Artifact。
5. 评审者可以 Approve 或 Request changes，Review 与 ReviewComment 持久化并绑定证据快照。
6. 合并必须由人显式确认，服务端校验 `reviewId`、`evidenceSnapshotHash`、`expectedHeadCommit`、`targetBaseCommit`、目标分支与合并路径状态；每次尝试写入 MergeRecord。
7. queued、preparing、running 三种阶段的取消都可靠；取消与完成竞态以先写入的合法终态为准，并记录 `cancel_lost_race`。
8. 执行超时映射为 `errorCode=timeout`，preparing/Git 超时有独立超时与失败分类，并保留尽力而为的证据。
9. Run 创建时固定 `agentVersionId` 快照，历史 Run 不受后续 Agent 编辑影响。
10. 服务重启后非终态 Run 被正确恢复或标记 `interrupted/app_restart`，不存在永久 queued 或 running。
11. UI 提供 Task 三栏详情、Run 详情、diff viewer（含行内评论）、证据面板、评审面板与合并对话框。
12. 删除有活跃 Run 的 Task/Agent 被阻止；归档 Task 后历史记录可查。

### 13.2 质量退出清单

- 单元测试覆盖 Workspace、worktree、`repoSlug`、分支命名、路径校验、证据采集、脱敏、评审与合并校验。
- 集成测试覆盖取消、执行超时、preparing/Git 超时、进程组回收、状态竞态、重启恢复、合并失效与合并路径矩阵。
- 端到端测试使用临时 Git 仓库与假 Claude CLI 自动跑通完整闭环；真实 CLI 冒烟测试单独记录。
- `go test -race ./...` 通过；前端类型检查与构建通过；关键包无静态检查阻断项。
- 不存在 P0 或 P1 缺陷；P2 缺陷有明确记录与不影响闭环的说明。
- 重复运行压力测试后，无持续增长的进程、协程、数据库连接或磁盘垃圾。

### 13.3 安全退出清单

- 默认只监听 127.0.0.1，非回环地址启动失败；CORS、Host 与 WebSocket Origin 校验生效。
- Runtime 工作目录被限制在 worktree 内，符号链接与 `..` 越界被拒绝；`.git` 元数据变更被检测并告警。
- 合并只能由人工 Review 与显式确认触发，Agent 不具备合并入口。
- 证据、日志、事件与错误通过脱敏测试，不包含测试密钥。
- 不执行 force push，不跳过 hooks，不删除远程分支；ATeam 不提供 push 入口。
- 数据目录权限仅当前用户可读写；Artifact 下载不存在路径穿越。
- 产品文案与 UI 明确说明 M1 无会话令牌、无命令级阻断的残余风险。

### 13.4 文档与演示退出清单

- 第 9 节演示脚本在一台干净的 macOS 开发机上连续执行三次成功，并保留录屏或文字记录。
- 第 9.5 节反向演示至少各执行一次，结果符合预期。
- `README.md` 与相关模块文档更新完毕，明确 M1 已实现与未实现边界。
- Runtime 能力矩阵与已知限制记录在工程文档中，用户能在失败时找到修复路径。

### 13.5 一票否决条件

- 存在任何不经过人类评审与显式确认的合并路径。
- 两个并行 Run 能看到或修改对方的未提交文件。
- Run completed 但证据缺失时，Task 仍可进入 done 或执行合并。
- 取消后的 Run 又被写回 running 或 completed，且未记录合法终态竞态。
- Runtime 缺失时静默回退到 mock，并显示为成功。
- mock Run 被计入代码变更类 Task 的完成证据。
- 文档或 UI 宣称 M1 具备任务 DAG、交付物契约、Approval 实体、远程 Runner 或团队权限。
- 文档或 UI 宣称 M1 已阻断 Agent 的所有推送/合并命令。

## 14. 不在 M1 的范围

### 14.1 后置项与目标里程碑

| 后置项 | 为什么不在 M1 | 目标里程碑 |
|---|---|---|
| 任务依赖 DAG、交付物契约、角色 Agent 模板 | 依赖稳定的 worktree、证据链与评审记录 | M2 |
| allowedPaths、allowedCommands 强制执行与命令审批 | 需要权限信封与审批门；M1 只做目录级隔离与检测 | M2 |
| Approval 实体、Crew 与队长模式、收件箱、技能、任务模板 | 属于多角色协作层；Approval 从 M2.1 开始 | M2 |
| Codex adapter | 需要独立协议解析与能力声明 | M2 |
| 截图作为 DoD 必需证据、direct 运行模式 | 依赖 UI 验证与工作区安全策略 | M2 |
| 自动重试策略与重试链 UI | M1 只提供手工新建 Run | M2 |
| 单 Task 证据包导出（zip） | 不是闭环必需；M1 提供按 Run 下载与 DoD 缺失清单 | M2 |
| 桌面壳会话令牌、WS ticket、统一审计表 | `security-and-permissions.md` 将其排在 M2.1 | M2.1 |
| push 到远端、创建或合并代码托管平台 PR | 涉及远端凭据与外部副作用 | M3 |
| Postgres、登录、团队权限、远程 Runner、机器注册、共享 Agent、团队审计 | 属于团队模式 | M3 |
| 定时执行、Webhook、通知、打包、自动更新、插件 API、遥测 | 属于自动化与分发阶段 | M4 |
| Windows 与 Linux 的完整桌面打包与验证 | M1 以 macOS 为退出平台 | M4 |

### 14.2 长期非目标

- 完整的通用项目管理套件。
- 20 个以上的第三方集成。
- IM 机器人或聊天式工作流。
- 技能市场或 Agent 商店。
- 移动端应用。
- 多租户 SaaS。
- 模型托管或转售模型调用。

### 14.3 M1 内明确不做但容易被误解的事项

- M1 不提供「Agent 自动合并」开关，也不提供「跳过评审」按钮。
- M1 不提供「直接在主工作区运行」模式；该模式在 M2 需要显式确认与额外风险提示。
- M1 不提供完整的权限信封执行器；`allowedPaths` 与 `allowedCommands` 只作为配置与提示，强制执行在 M2。
- M1 不提供远程执行；Run 只在当前机器上运行。
- M1 不提供多人同时审批；Review 只代表本机当前用户。
- M1 不提供命令级 Git 拦截；Agent 在 Bash 中的 `git push` 只能通过事后审计与用户自律约束。

## 15. 与其他文档的关系

### 15.1 文档职责与权威顺序

全套 PRD 的优先级以 `02-domain-model.md` 开头的「文档优先级」为准：产品原则与 PROD 需求（`00-product-overview.md`）→ 范围与安全不变量（`01-scope-and-roadmap.md`）→ 领域语义（`02-domain-model.md`）→ 模块细节（`modules/*.md`）→ 里程碑执行（本文件）。本文件是最低层，不得覆盖上层约束；发现冲突时按 §15.3 登记并回写，而不是在实现中自行选择。

| 文档 | 关系 | 使用方式 |
|---|---|---|
| `prd/00-product-overview.md` | 定义产品愿景、用户、核心闭环、PROD 级需求与里程碑总表 | M1 的跨模块底线为 PROD-005、PROD-006、PROD-007、PROD-008、PROD-009、PROD-015、PROD-019 |
| `prd/01-scope-and-roadmap.md` | 定义 M1 目标、范围、交付物与 12 条退出标准 | 本文件第 2、13 节与其 §4.3 对齐；延迟指标以其 2 秒硬上限为准 |
| `prd/02-domain-model.md` | 定义实体字段、状态机、不变量、错误码与迁移 | 字段以 §3.1/§3.5/§3.6/§3.7/§3.8/§3.9/§3.10/§3.15 为准；状态机以 §4.2/§4.3/§4.4/§4.5 为准；本文件编号使用 `M1-`，引用域模型时写 `DM-` |
| `prd/03-user-flows.md` | 定义流程 A（单人闭环）与流程 E（评审与审批） | 取消、失败恢复、合并门与证据化 DoD 的流程口径以该文档为准 |
| `prd/04-acceptance-and-test-plan.md` | 定义 AC-RUN、AC-SEC、AC-UI、AC-NFR 验收用例 | 本文件第 13 节退出标准必须能映射到该文档 §4.2 与 §5 的用例 |
| `modules/task-management.md` | Task 字段、状态流转、Workspace 归属 | `M1-TASK-*` 追溯 TASK-012、TASK-013、TASK-030、TASK-032；命名已统一为 Workspace |
| `modules/agent-system.md` | Agent 配置、运行时权限模式、RunConfigSnapshot | `M1-AGENT-*` 追溯 AGENT-011、AGENT-062、AGENT-065；M1 的快照以 AgentVersion 承载 |
| `modules/runtime-and-workspace.md` | Run 生命周期、adapter、worktree、Artifact、失败分类 | `M1-WS-*`、`M1-RUN-*`、`M1-RUNTIME-*`、`M1-ART-*` 以其 FR 为准；§8.7 命名冲突见 §15.3 |
| `modules/collaboration-and-review.md` | 评审、合并、证据保留与 M2 契约 | M1 采用其中评审与合并最小集；证据保留 90 天以该文档 §9.5 为准 |
| `modules/security-and-permissions.md` | 信任模型、网络边界、SEC 需求、审计与保留 | M1 逐项映射其 §13 M1 清单；SEC-003、SEC-050/051 属于 M2.1 |
| `modules/api-and-data.md` | REST/WS 契约、错误码、端点总表、数据表 | 端点、错误码与事件名以其 §5、§6、§7 为准；新端点必须先登记 |
| `modules/ui-ux.md` | 页面结构、diff 与评审交互、可访问性 | `M1-UI-*` 追溯 UI-038 至 UI-043、UI-108、UI-112 |
| `modules/non-functional-requirements.md` | 性能、可靠性、资源、可移植性、可观测性 | `M1-NFR-001` 至 `M1-NFR-008` 与其 §3 的 M1 映射一致 |
| `README.md` 与 `CONTRIBUTING.md` | 仓库当前状态、开发方式与 clean-room 要求 | M1 完成后必须更新 README 状态，不能把计划写成已实现 |

### 15.2 M1 需求追溯矩阵

| M1 需求 | 模块/领域需求 |
|---|---|
| M1-TASK-001 | TASK-013；DM-PROJ-001、DM-PROJ-002、DM-PROJ-003；`02-domain-model.md` §3.1 |
| M1-TASK-002 | TASK-020 至 TASK-025、TASK-032；DM-TASK-003、DM-TASK-004、DM-TASK-015；§4.2、§4.4 |
| M1-TASK-003 | TASK-030；DM-RUN-006；INV-012 |
| M1-TASK-004 | TASK-012；DM-TASK-010、DM-AGENT-007；SEC-023 |
| M1-AGENT-001 | AGENT-030、AGENT-041、AGENT-048、AGENT-065；DM-AGENT-004、DM-AGENT-005 |
| M1-AGENT-002 | AGENT-011、AGENT-053；DM-AGENT-003；RUN-001 至 RUN-003 |
| M1-AGENT-003 | AGENT-062；`02-domain-model.md` §3.4；`security-and-permissions.md` §11 |
| M1-AGENT-004 | AGENT-041、AGENT-048；DM-AGENT-005 |
| M1-WS-001 至 M1-WS-008 | RUN-040 至 RUN-057；DM-RUN-007、DM-RUN-013、DM-RUN-014；§3.8 |
| M1-WS-009 至 M1-WS-012 | RUN-046、RUN-047、RUN-051、RUN-054；DM-RUN-015；§9.3 |
| M1-RUN-001 至 M1-RUN-012 | RUN-080 至 RUN-089；DM-RUN-004 至 DM-RUN-010；§4.3 |
| M1-RUNTIME-001 至 M1-RUNTIME-011 | RUN-012 至 RUN-018、RUN-095；AGENT-011 至 AGENT-015；SEC-014、SEC-075、SEC-077 |
| M1-ART-001 至 M1-ART-008 | RUN-060 至 RUN-068；DM-ART-001 至 DM-ART-005、DM-ART-009；§3.9.1 |
| M1-REVIEW-001 至 M1-REVIEW-007 | DM-REV-001 至 DM-REV-006；COLLAB 评审相关条目；§3.10、§4.5 |
| M1-MERGE-001 至 M1-MERGE-008 | DM-MRG-001 至 DM-MRG-004；RUN-048、RUN-056；SEC-020、SEC-026；§3.15 |
| M1-API-001 至 M1-API-010 | API-001 至 API-009（M1 局部编号）、API-1186；`api-and-data.md` §5 |
| M1-UI-001 至 M1-UI-011 | UI-038 至 UI-043、UI-108、UI-112；`ui-ux.md` §5.3、§5.4 |
| M1-SEC-001 至 M1-SEC-011 | SEC-001、SEC-002、SEC-004 至 SEC-009、SEC-014、SEC-016、SEC-020、SEC-023、SEC-026、SEC-070 至 SEC-072、SEC-075、SEC-077 |
| M1-NFR-001 至 M1-NFR-008 | NFR-PERF-010、NFR-REL-002/003/015、NFR-RES-008/009、NFR-PORT-001/002、NFR-OBS-001/004/009、NFR-REL-008/016 |

### 15.3 跨文档冲突与裁定

本版修订涉及的跨文档冲突已全部裁决，下表记录最终口径；实现方只能按此实现，不得同时维护两套模型。

| 冲突点 | 最终口径 | 状态 |
|---|---|---|
| 产品级实体命名 | 全套 PRD 统一为 Workspace / `workspaceId`，表 `workspaces`、默认 ID `default`；`Project`/`projectId` 仅作 M1-M2 输入别名；`/api/v1/projects` 为兼容别名 | 已回写 02/api/runtime/agent/task/03/04 |
| 合并审批实体 | M1 用 Review（`approved`）+ MergeRecord + `confirm=true`；不建 `approvals` 表；Approval 从 M2 起交付，MergeRecord 预留 `approvalId` | 已统一 |
| worktree 保留期 | 已合并/放弃后默认保留 30 天；M1 不自动删除；清理必须显式确认 | 已回写 02/runtime/security/api |
| 证据保留期 | RunEvent、Artifact 与 Evidence 默认保留 90 天，可配置 | 已统一 |
| 事件推送延迟 | M1 指标目标 1 秒，产品硬上限 2 秒；两者都采集 | 已在 00/03 标注「目标/上限」 |
| 会话令牌里程碑 | 统一为 M2.1（SEC-003）；M1 明示无令牌残余风险 | 已回写 00/04/NFR/ui/task |
| 本地审计表 | M1 不写 `audit_events`；Review 决定与 MergeRecord 作为审计前身；本地审计从 M2.1 起 | 已统一 |
| 重启错误码 | 使用 `interrupted/app_restart`；`SERVER_RESTART` 为历史别名 | 已回写 NFR |
| 分支命名分隔符 | 统一为 `ateam/{taskShort}/{slug}-{runShort}` | 已回写 runtime §8.4 与 RUN-043 |
| `test_result` 生产者 | M1 的 `test_result` 事件与 `test_report` Artifact 只由系统验证命令产生（`source=system`）；Adapter 的测试调用只产生 `tool_call`/`tool_result`，Agent 自述只作为 `note` 或日志 | 已回写 runtime §6.2 |
| 证据包导出 | 移出 M1，列入 M2；M1 只提供按 Run 下载 | 已统一 |
| 行内评论 | M1 纳入；若降级为文件级评论，必须书面接受并同步修改 UI-039 | 产品负责人确认 |

### 15.4 本文件要求其他文档回写的项

1. `runtime-and-workspace.md` §8.7：产品级归属统一为 Workspace，`Project` 仅作历史别名。
2. `runtime-and-workspace.md` §8.4 与 RUN-043：分支命名统一为 `ateam/{taskShort}/{slug}-{runShort}`（已回写）。
3. `runtime-and-workspace.md` §8.6、RUN-052 与 `02-domain-model.md` §3.8、DM-RUN-014：保留期统一为 30 天（已回写）。
4. `security-and-permissions.md` §5.5：worktree 清理口径统一为「标记 archived + 显式清理」，30 天保留（已回写）。
5. `04-acceptance-and-test-plan.md` AC-SEC-01：M1 会话令牌要求改为 M2.1（已回写）。
6. `non-functional-requirements.md` NFR-REL-002：`SERVER_RESTART` 改为 `interrupted/app_restart`（已回写）。
7. `api-and-data.md` 端点表：登记 `GET /api/v1/workspaces/{id}/orphan-worktrees`、`POST /api/v1/workspaces/{id}/cleanup`、`POST /api/v1/runs/{id}/workspace/cleanup` 与 `targetBaseCommit` 字段（清理端点已登记；`targetBaseCommit` 仍待 API 文档补列）。

## 16. 待确认/未文档化

以下问题仍有决策空间。每条给出默认方案、决策截止点与 owner，避免实现停摆；已由正文决定的事项不再列为待确认。

| 待确认项 | 默认方案 | 决策截止 | Owner |
|---|---|---|---|
| Claude Code CLI 的最低版本与精确参数 | 以能力探测为准；必需参数缺失即失败；第 1 周用真实 CLI 固化能力矩阵并写入 adapter 文档 | M1 第 5 个工作日 | Runtime adapter 负责人 |
| stream-json 的字段冻结清单 | 只依赖 `type` 与本文约定字段；未知字段忽略；夹具冻结后变更需兼容性评审 | M1 第 2 周 | Runtime adapter 负责人 |
| Workspace/Project 命名统一（已裁决） | 全套使用 Workspace/`workspaceId`；`/api/v1/projects` 仅为 M1-M2 输入别名；单实体不双写 | 已关闭 | PRD 负责人 |
| worktree 保留期（已裁决） | 30 天，M1 不自动删除；到期清理在 M2 实现 | 已关闭 | 产品 + 工程 |
| 合并策略与目标分支前进 | 默认 squash；目标未前进时可选 merge 或 rebase；目标前进必须重新评审 | M1 开发前 | 产品 + 工程 |
| 行内评论是否保持 M1 硬性 | 保持；仅允许产品负责人书面批准的降级 | M1 UI 评审 | 产品负责人 |
| 会话令牌与审计表 | 不在 M1；M2.1 交付；M1 UI 明示残余风险 | M2.1 规划 | 安全负责人 |
| 证据包导出格式 | M2 提供 zip（清单、diff、test_report、日志摘要），不含密钥 | M2 开发前 | 产品 |
| 验证命令的执行环境 | 只在 Run Workspace 内执行，参数数组、不经过 shell；默认超时 10 分钟 | M1 开发前 | 工程 |
| Linux 支持程度 | macOS 为退出平台；Linux 保证编译、Go 测试与 Web 构建通过 | M1 退出前 | 工程 |
| 子模块、LFS、嵌套仓库 | M1 检测到子模块或稀疏检出时明确拒绝并说明原因，不静默降级 | M1 开发前 | 工程 |
