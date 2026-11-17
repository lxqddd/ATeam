# 里程碑 M4：自动化与分发

| 项目 | 内容 |
|---|---|
| 文档编号 | PRD-M4 |
| 产品 | ATeam |
| 文档类型 | 里程碑文档 |
| 文档状态 | 草案 v0.2（按审稿意见修订）；M4 全部能力均为计划中，尚未实现 |
| 更新日期 | 2026-11-17 |
| 适用里程碑 | M4（自动化与分发） |
| 前置里程碑 | M1、M2、M3 已通过各自退出标准 |
| 需求 ID 前缀 | M4-AUTO、M4-HOOK、M4-NOTIFY、M4-PKG、M4-UPD、M4-PLUG、M4-TEL、M4-DOC、M4-EXP |
| 主要依据 | `prd/00-product-overview.md`、`prd/01-scope-and-roadmap.md`、`prd/03-user-flows.md`、`prd/04-acceptance-and-test-plan.md`、`prd/05-risks-and-open-questions.md` 与 `prd/modules/` 下的模块文档 |

## 本章导读

本章定义 ATeam 第四个里程碑 M4「自动化与分发」的目标、范围、用户故事、交付物、验收标准、演示脚本、依赖、风险与退出标准。M4 要完成两件事：第一，让例行任务可以按定时规则或 Webhook 自动创建，并在规则显式指定 `todo` 时自动排队 Run，而不需要人每天手动点击；第二，让 ATeam 从「开发者本地能跑起来的源码」变成「普通用户可以安装、启动、升级、卸载的桌面应用」。同时，M4 要为扩展开发者和隐私敏感用户补上两块信任基础设施：受限插件 API 与默认关闭的可选遥测。

阅读本章前必须明确一个事实：**当前仓库处于 M0 骨架阶段，M4 的所有能力都尚未实现。** 当前已有 Go 核心、SQLite 持久化、REST/WebSocket API、mock Runtime、Vue 看板与 Wails 桌面壳；但桌面壳只是开发壳，Web 资源由 `internal/app/app.go` 的 `DefaultConfig.WebDir` 默认指向 `apps/web/dist`，`internal/api/api.go` 使用该目录并在缺失时提供占位页；版本号在 `internal/version/version.go` 中硬编码为 `0.1.0-dev`，没有 DMG、NSIS、AppImage，没有自动更新，没有定时或 Webhook 触发器，没有通知中心，没有插件 API，没有遥测，也没有面向用户的安装、升级、隐私与排障文档。任何把 M4 内容描述为「已具备」的发布说明、演示或销售材料都是错误的。

本章是里程碑文档，不是模块设计文档。定时、Webhook、通知、打包、更新、插件、遥测的字段级语义、交互细节与安全规则，分别由 `prd/modules/` 下的模块文档定义；本章只规定「M4 交付什么、做到什么程度算通过、如何演示、依赖什么、害怕什么、什么时候必须停」。读者应当能够用本章判断一个 M4 需求是否属于范围、是否达到退出标准、是否必须后置。

**v0.2 修订要点**：统一自动化触发语义为「默认创建 Task 并进入 Backlog，规则显式指定 todo 才排队 Run；『立即运行』是显式手动例外」；演示脚本改用 M1 的假 Claude CLI 夹具产生真实 diff 与测试证据，mock 仅用于安装冒烟；API 契约统一引用 `prd/modules/api-and-data.md` 并按 `/api/v1` 版本化；补充自动化与任务 DAG、交付物契约、上游验收的交互，补充空状态与引用完整性，关闭与正文冲突的开放问题，并明确 macOS 演示只证明 DMG，NSIS 与 AppImage 另附独立平台验收记录。

## 1. 里程碑目标与定位

### 1.1 一句话目标

**让 ATeam 从「开发者能跑起来」变成「可以安装、可以升级、可以按规则自动创建例行任务并在显式配置时自动排队 Run，但所有高风险动作仍由人决定」的分发级产品。**

这句话有三个限定，任何一个被削弱都意味着 M4 失败：

1. **可以安装**：目标用户不需要安装 Go、Node、pnpm 或 Wails CLI，就能在干净机器上安装并启动 ATeam，完成一次 Run。
2. **可以升级**：新版本能够被检测、校验、安装；升级不破坏本地任务、Agent、Run、证据与配置；失败能够回滚。
3. **自动化不等于自动批准**：定时与 Webhook 默认只创建 Task 并进入 Backlog；只有规则显式指定 `todo` 时才排队 Run；「立即运行」是可审计的显式手动例外，可创建 Task 与 Run。任何来源都不能自动合并、推送、部署、删除，也不能绕过 M2 建立的审批门、任务 DAG、交付物契约与证据化 DoD。

### 1.2 三条结果线

M4 的交付可以归纳为三条结果线。它们相互独立又彼此支撑，任何一条缺失都不能称为「可分发」。

| 结果线 | 用户可感知的结果 | 核心交付 | 失败的表现 |
|---|---|---|---|
| 分发 | 用户在干净机器上安装、启动、升级、卸载 ATeam | DMG、NSIS、AppImage、签名与公证、自动更新、版本信息、卸载保留数据 | 需要开发工具链才能运行；安装包被系统拦截；升级后数据丢失 |
| 自动化 | 例行任务按规则自动创建，显式 todo 的规则自动排队 Run；结果进入通知与评审队列 | 定时规则、Webhook 入站、触发器去重、通知中心、失败告警 | 自动化绕过审批；重复创建任务；失败无人知晓 |
| 扩展与信任 | 社区可以写受限插件；用户能看懂并控制数据上报 | 插件清单与权限、进程隔离、遥测默认关闭、隐私文档、完整用户文档 | 插件能读任意文件或调用高风险动作；遥测默认开启或采集代码 |

### 1.3 与前序里程碑的关系

M4 不引入新的核心领域语义。Task 仍是上下文容器，Agent 仍是持久工作配置，Run 仍是一次执行，Run Workspace 仍是隔离工作区，Runtime 仍是 Claude Code、Codex 或 mock，Artifact/Evidence 仍是完成凭据，Human Review 与 Approval Gate 仍是治理节点。M4 做的是把这些已有能力**打包、调度、通知和开放**。

这意味着 M4 对前序里程碑有硬依赖：

- **M1** 必须已经提供 git worktree、独立分支、diff、Artifact/Evidence、取消与超时、人工合并。没有证据与隔离，自动化只会更快地制造不可评审的改动。
- **M2** 必须已经提供任务依赖 DAG、交付物契约、角色模板、路径与命令权限、审批门、证据化 DoD、收件箱。自动化与插件都必须复用这些约束，而不是另建一套。
- **M3** 必须已经提供登录、权限、远程 Runner、机器注册、共享 Agent、审计。团队场景下的定时任务、Webhook 与插件管理需要身份与审计；没有身份，M4 的「谁触发了什么」无法回答。

如果 M1-M3 的退出标准未通过，M4 不应启动正式开发，只允许进行打包与签名的技术预研。M4 会把前序缺陷放大：隔离不稳会在无人值守时造成更大污染，证据不足会让自动产生的 Run 更难评审，审批不严会让定时任务成为绕过人工的通道。

### 1.4 当前状态与 M4 差距（M0 事实基线）

下表以当前仓库代码为准，列出的「M0 现状」均可在仓库中验证；「M4 目标」全部为计划，不代表已经可用。

| 能力 | M0 现状（仓库事实） | M4 目标 | 状态 |
|---|---|---|---|
| 桌面壳 | `apps/desktop/main.go` 启动本地服务并创建 1440×900 Wails 窗口；仅开发壳 | 三平台安装包，带图标、版本、签名、公证与卸载 | 计划（M4） |
| Web 资源 | `internal/app/app.go` 的 `DefaultConfig.WebDir` 默认指向 `apps/web/dist`；`internal/api/api.go` 使用传入的 `webDir` 读取静态文件，目录缺失时显示占位页 | 通过 Go embed 打入二进制，运行时不依赖 Node 或外部目录 | 计划（M4） |
| 版本信息 | `internal/version/version.go` 中 `Version = "0.1.0-dev"` 硬编码；`NFR-PKG-005` 原计划 M1 交付版本注入与关于页版本一致性，当前仓库尚未交付 | 构建时注入版本、提交号、构建时间；安装包、关于页、健康接口一致 | 计划（M4，承接 M1 未交付的 NFR-PKG-005 遗留） |
| 构建与打包 | `Makefile` 只构建 `bin/ateam` 与 `bin/ateam-desktop`；无安装包 | DMG、NSIS、AppImage；SBOM、校验和、签名清单 | 计划（M4） |
| CI | 仅 Ubuntu 上的 Go test/vet 与 pnpm typecheck/build；无桌面打包任务 | macOS、Windows、Linux 原生构建矩阵与发布流水线 | 计划（M4） |
| 调度器 | 进程内队列，默认 2 个 worker；无持久化定时规则 | 持久化 Schedule、时区感知、错过与重叠策略、运行历史 | 计划（M4） |
| Run 触发 | `Run.Trigger` 字段存在，默认 `manual`；无 schedule/webhook 来源 | `manual`、`retry`、`schedule`、`webhook`、`dependency`、`crew` 枚举与去重键 | 计划（M4） |
| 通知 | 仅 WebSocket 事件驱动界面刷新；无通知中心 | 应用内通知、桌面原生通知、出站 Webhook；去重、聚合、重试 | 计划（M4） |
| 自动更新 | 无 | 签名清单、校验、原子替换、保留上一版本、失败回滚 | 计划（M4） |
| 插件 API | 无 | 受限插件、清单权限、进程隔离、只读核心数据、事件订阅 | 计划（M4） |
| 遥测 | 无 | 默认关闭、显式 opt-in、匿名聚合、本地可查看与删除 | 计划（M4） |
| 用户文档 | 仅有 README、CONTRIBUTING、NOTICE、LICENSE（Apache-2.0）与 PRD | 安装、升级、Runtime 配置、权限、自动化、插件、隐私、管理员、排障、发布说明 | 计划（M4） |

上表中「版本信息」一行需要特别说明：版本注入、关于页与 `/api/v1/health` 的版本一致性由 `NFR-PKG-005` 定义，该需求的计划里程碑是 M1，但当前仓库尚未交付。M4-PKG-003 承接这一遗留缺口，属于「补齐 M1 承诺」，不是 M4 新增能力；发布说明与验收记录必须注明其归属，避免出现「M1 已交付」的错误表述。仓库根目录的 `LICENSE` 是分发基线的一部分，安装包与关于页的许可信息必须与之一致。

### 1.5 里程碑内部阶段与顺序

M4 的内容密度高于普通的「打包里程碑」。为避免最后两周同时处理签名、更新、插件与遥测，M4 内部按五个阶段推进；每个阶段都必须有可演示的最小闭环，不能把风险全部堆到最后。

| 阶段 | 目标 | 入口条件 | 退出证据 |
|---|---|---|---|
| M4.0 打包与签名预研 | 证明三平台能产出可安装产物，签名与公证账号可用 | M1 已通过；Wails v3 版本锁定 | 三平台各一个可启动的 spike 包；签名与公证链路演练记录 |
| M4.1 可安装版本 | Web 资源嵌入、版本注入、DMG/NSIS/AppImage、关于页、卸载保留数据 | M4.0 通过 | 干净机器安装并完成一次 Mock Run；产物哈希与 SBOM |
| M4.2 自动化与通知 | Schedule、Webhook、触发器去重、通知中心、桌面通知、出站通知重试 | M4.1 通过；M2 审批门稳定 | 定时任务与签名 Webhook 端到端演示；通知不丢不重 |
| M4.3 更新与插件 | 签名更新清单、回滚、stable/beta、插件宿主、权限清单、示例插件 | M4.1 通过；M4.2 的通知可用 | 升级保留数据与回滚演练；插件越权测试通过 |
| M4.4 遥测、文档与发布 | opt-in 遥测、隐私文档、完整用户文档、发布门禁、公开预览 | M4.2 与 M4.3 通过 | 关闭遥测无上报；文档评审通过；发布门禁全绿 |

阶段之间允许并行准备（例如文档与 UI 稿可以提前），但不得跳过阶段门。若 M4.3 的插件宿主无法在安全边界内交付，可以按第 16.5 节的「收缩」策略后置插件，而不是降低沙箱要求。

## 2. 范围与非目标

### 2.1 范围内

M4 覆盖以下八个工作流。每个工作流在 `prd/modules/` 中都有对应的行为定义或需求编号；本章只规定里程碑级验收。

1. **定时自动化**：持久化的 Schedule、时区感知的 cron、启用/暂停、手动触发、错过与重叠策略、运行历史、预算与并发上限。
2. **Webhook 入站自动化**：签名校验、时间戳与重放保护、去重、请求体限制、速率限制、投递日志、密钥轮换、失败关闭。
3. **通知**：应用内通知中心、桌面原生通知、出站 Webhook 通知；事件覆盖 Run 完成/无新增/失败、待评审、待审批、依赖就绪、自动化跳过/失败、更新可用；去重与聚合。
4. **Wails 打包**：macOS DMG、Windows NSIS、Linux AppImage；Web 资源嵌入、版本注入、图标、许可证与 NOTICE、安装与卸载体验。
5. **签名与公证**：macOS Developer ID、Hardened Runtime、公证与 staple；Windows Authenticode 与时间戳；Linux SHA-256 校验和与可选 GPG。
6. **自动更新**：stable/beta 通道、签名清单、校验和、原子替换、保留上一版本、启动失败回滚、数据库备份、拒绝降级、离线容错。
7. **插件 API**：清单与权限、进程隔离、只读核心数据、事件订阅、UI/通知渠道/证据渲染扩展点、审批门附加检查、启用/停用/卸载、版本兼容与失败隔离。
8. **遥测与文档**：默认关闭的 opt-in 遥测、字段最小化、本地查看/导出/删除、崩溃日志本地优先；安装、升级、权限、自动化、插件、隐私与排障文档。

### 2.2 范围外（M4 明确不做）

以下内容不属于 M4，不应以「顺手做」为理由进入排期。重新评估条件见第 17 节。

- 自动合并、自动推送、自动部署、自动删除、自动批准。M4 的自动化默认只负责「创建任务」；规则显式指定 `todo` 时才排队 Run，「立即运行」是手动例外，但仍不负责「决定」。
- Crew 与队长模式的自动编排。M4 的 Schedule/Webhook 不自动创建 Crew、不自动拆分子任务、不自动选择队长；依赖触发只处理任务 DAG 的就绪任务。`prd/01-scope-and-roadmap.md` 能力矩阵已回写为「M4 只做定时/Webhook 创建 Task，不做 Crew 自动化编排」，对账记录见 5.9.1。
- 插件作为 Agent Runtime 适配器。M4 的「插件 Runtime」仅指插件的独立进程宿主，不是让插件替代 Claude Code/Codex 等模型 Runtime；第三方 Runtime 适配器后置。
- 生产部署的自动执行。DevOps Agent 在 M2 只能生成 staging 计划与部署计划；prod 必须由人执行，M4 不改变这条边界。
- 模型托管、模型转售、模型计费代收。ATeam 继续坚持 BYO Runtime/Key。
- 多租户 SaaS、云端代码托管、云端 IDE。
- 移动端原生应用、IM 机器人、邮件审批、短信通知。
- 插件市场、技能市场、模板市场的商业分发与内容审核。M4 只做本地插件安装与 Agent 包导入导出。
- 插件默认联网、默认读写任意文件、默认访问密钥或 Runtime 凭据。
- 跨仓库、跨项目的自动化编排。M4 的定时与 Webhook 绑定单个仓库与单个项目范围；跨项目事件联动后置。
- Windows arm64 与 Linux arm64 的正式安装包。M4 只承诺 Tier 1 平台；Tier 2 架构另行评估。
- 秒级 cron、分布式调度、外部 cron 服务依赖。
- 自动重试风暴与无人值守自愈。仅允许对明确可重试错误做有限重试，且仍需人工合并。
- 企业级 DLP、合规认证、私有更新服务器托管服务。

### 2.3 范围边界规则

为避免 M4 侵蚀产品底线，以下规则优先于任何具体需求：

1. **触发器默认只产生任务，不产生审批结论。** Schedule 与 Webhook 默认创建 Task 并进入 Backlog；只有规则显式指定 `todo` 时才排队 Run；「立即运行」是显式手动例外，可创建 Task 与 Run。任何来源都不能调用 Review、Approval、Merge、Push、Deploy、Delete。
2. **自动化的权限不得高于触发者。** 本地用户创建的 Schedule 使用该用户可用的 Agent 与路径权限；团队模式下 Schedule 与 Webhook 需要 `automation:write` 权限，且不能使用调用者无权使用的 Agent。
3. **自动化任务与手动任务同权。** 自动创建的任务必须绑定合法的任务模板与 DAG；上游任务未验收时不得进入 `todo` 或启动 Run；「立即运行」也不得绕过上游验收、交付物契约与审批门。
4. **数据默认不出本机。** 打包、更新检查、通知、插件与遥测都不得默认上传代码、任务内容、提示词、diff、日志正文或文件路径。
5. **打包不改变语义。** 安装版与浏览器开发模式必须共享同一套 API、事件与状态机；不允许出现「只有桌面版才有的隐藏状态」。
6. **插件只增不减。** 插件可以增加只读视图、事件订阅、导出动作、通知渠道、证据渲染与审批前的附加检查；不能删除审批、降低证据要求、替人批准或修改审计。
7. **失败关闭。** Webhook 签名失败、更新签名失败、插件权限不清、审批检查插件故障、遥测未同意，都必须拒绝执行而不是放行。

### 2.4 伴随交付（引用模块需求）

以下能力已在模块文档中被归入 M4，本章不重复展开，但纳入 M4 验收范围：

| 能力 | 模块文档 | 需求编号 | 在 M4 中的定位 |
|---|---|---|---|
| Agent 包导出与导入 | `prd/modules/agent-system.md` | AGENT-046、AGENT-047 | 扩展与复用的基础；导入前展示权限差异并扫描敏感信息 |
| Agent 工作时间窗口 | `prd/modules/agent-system.md` | AGENT-051 | 与定时规则共同决定队列准入；不终止运行中的 Run |
| 任务与证据导入导出 | `prd/modules/task-management.md`、`prd/modules/collaboration-and-review.md` | 本章定义 M4-EXP-001、M4-EXP-002（模块文档第 20.5 节仅列能力，未分配稳定需求编号） | 便携格式；导出前敏感信息检查；用于迁移与备份 |
| 通知偏好 | `prd/modules/ui-ux.md` | UI-129 | Inbox、桌面通知、声音分别可开关 |
| 应用内通知与 M4 外部通知 | `prd/modules/collaboration-and-review.md` | COLLAB-065 | M2 提供应用内通知；M4 增加桌面通知与 Webhook |
| 打包与升级非功能要求 | `prd/modules/non-functional-requirements.md` | NFR-PKG-001 至 NFR-PKG-013（其中 NFR-PKG-005 原计划 M1，M4 承接遗留） | 本章打包与更新验收的直接依据 |
| 管理员指南 | `prd/01-scope-and-roadmap.md` §4.6.2、`prd/modules/security-and-permissions.md` | 本章 M4-DOC-011 | 团队部署、权限与审计、自动化与插件治理 |

Agent 包与任务导出属于「本地文件交换」，不属于市场分发；M4 不提供在线模板商店、不提供付费下载、不提供社区评分。

## 3. 角色与场景

### 3.1 角色

| 角色 | 在 M4 中的关注点 | 成功定义 |
|---|---|---|
| 独立开发者 A | 安装简单、升级不丢数据、定时跑例行任务、通知不打扰 | 一次安装后每天自动完成 Bug 分诊，人工只处理评审与合并 |
| 小团队 B | 共享 Schedule、共享 Agent、通知进入团队收件箱、beta 通道 | 成员看到同一套自动化规则与通知，权限与审计清晰 |
| 平台负责人 C | 签名与更新可信、插件权限可控、遥测可关闭、审计可追溯 | 能回答「谁在什么时候用什么规则触发了什么」，并能一键停用自动化或插件 |
| 评审者 D | 通知能直达待评审项，证据不被通知摘要替代 | 从通知进入评审后能看到 diff、测试与截图，而不是只看一句「完成」 |
| 扩展开发者 E | 插件 API 稳定、权限清晰、示例可运行、失败不影响主程序 | 不修改核心代码即可增加只读视图或事件导出 |
| 发布负责人 F | 三平台产物可重复、签名可验证、回滚可演练、文档齐全 | 发布检查单全绿，出现问题时能回滚并通知用户 |

### 3.2 关键场景

**场景一：每日 Bug 分诊。** 独立开发者在测试仓库上配置「每天 09:00 从 Bug 分诊模板创建任务，交给 Triage Agent，只允许读取 `bugs/` 与 `tests/`，产出分诊报告与修复建议」。到点后 ATeam 创建 Task 并记录 `trigger=schedule` 与去重键，默认进入 Backlog；若规则显式指定 `todo`，则在上游依赖满足后排队 Run。Run 完成产生 Artifact 与 Evidence；开发者在通知中心看到「待评审」，打开任务查看 diff 与测试结果，批准合并。若当天没有新 Bug，Run 以 `completed` 结束并记录 `status/subtype=no_changes` 事件，生成 no-op 证据，不产生空 diff、空 commit 或无意义改动；如果该任务处于 DAG 中且上游未验收，任务保持 `blocked`，不得启动 Run。

**场景一补充：无新增与悬空引用。** 当模板被归档、Agent 权限被收紧或模板字段被修改时，Schedule/Webhook 不得静默失败：规则进入 `blocked` 或 `needs_review` 状态并通知负责人；用户必须重新确认模板版本、Agent 权限与目标状态后才能恢复触发。

**场景二：外部系统触发。** 小团队把问题跟踪系统的 Webhook 指向 ATeam。请求携带签名与时间戳；ATeam 校验签名、拒绝重放、按 delivery ID 去重，然后从模板创建 Task，默认进入 Backlog。团队负责人可以在自动化页面看到投递日志与失败原因；密钥可以轮换，旧密钥在宽限期后失效。

**场景三：干净机器安装与升级。** 平台负责人拿到 DMG/NSIS/AppImage，在对应平台的干净虚拟机安装，启动后完成一次 Mock Run；随后通过签名更新清单升级到下一版本，确认任务、Agent、Run 与证据全部保留；再模拟一次升级失败，确认回滚到上一版本且数据库可用。macOS 的主演示只证明 DMG；Windows 的 NSIS、WebView2 检测与 Authenticode，以及 Linux 的 AppImage、WebKitGTK 检测与校验和，必须各自附独立平台验收记录，不能由 macOS 录屏代替。

**场景四：受限插件。** 扩展开发者安装一个只读插件，订阅 `run.completed` 事件并把任务列表导出为 CSV。插件清单只申请 `tasks.read`、`events.subscribe` 与 `files.export` 权限；尝试读取仓库文件或访问网络时被拒绝；插件崩溃不会导致 ATeam 退出；停用插件后事件不再投递。

**场景五：隐私选择。** 隐私敏感用户首次启动时看到遥测说明，默认不勾选；关闭后通过网络抓包确认没有上报；之后主动开启，查看本地遥测事件清单，导出并删除本地记录；再次关闭后队列被清空且不再发送。

**场景六：自动化被滥用。** 一个 Webhook 密钥泄露后，攻击者尝试发送未签名请求、重复请求与超大请求体。ATeam 分别返回 401、409、413，记录失败并触发告警；连续失败达到阈值后自动停用该 Webhook，等待人工重新启用。

## 4. 用户故事与验收标准

以下用户故事全部为 M4 计划行为。每条故事都给出 Given/When/Then 与可观察的验收结果；验收时必须同时检查「功能成功」与「治理未被削弱」。

**US-M4-01 定时创建分诊任务（独立开发者）**
Given 用户已创建一个 Bug 分诊模板与一个可用 Agent，且本地时间设置为 `Asia/Shanghai`；
When 用户创建「每天 09:00」的 Schedule 并启用；
Then 系统保存规则、显示未来 5 次运行时间，并在到点时创建 Task、记录 `trigger=schedule` 与去重键，默认状态为 Backlog；只有规则显式选择 `todo` 且上游依赖已验收时才排队 Run，不直接合并任何改动。

**US-M4-02 手动运行定时规则（独立开发者）**
Given 一个已启用的 Schedule；
When 用户点击「立即运行」；
Then 系统立即创建一次 Task 与 Run（显式手动例外），Run 记录 `trigger=manual` 与来源字段 `source=manual`（产品语义为手动测试），不改变下一次计划运行时间，也不影响已有 Run 的历史；立即运行不得绕过任务 DAG 的上游验收、交付物契约与审批门。

**US-M4-03 错过运行与重叠运行（独立开发者）**
Given 应用在计划时间处于关闭状态，或上一次 Run 仍在运行；
When 应用重新启动或下一次触发到来；
Then 系统按配置的错过策略与重叠策略处理：默认跳过并记录原因，不产生补跑风暴，不并行启动同一 Schedule 的第二个 Run。

**US-M4-04 签名 Webhook 创建任务（小团队）**
Given 团队已创建一个启用中的 Webhook，密钥保存在系统钥匙串；
When 外部系统使用正确签名、有效时间戳与唯一 delivery ID 发送请求；
Then ATeam 返回 202 与 delivery ID，创建 Task 并记录 `trigger=webhook`；Task 默认进入 Backlog，等待人工决定是否执行；只有端点显式配置 `todo` 且上游依赖已验收时才排队 Run。

**US-M4-05 Webhook 拒绝伪造与重放（平台负责人）**
Given 同一 Webhook 端点；
When 请求签名错误、时间戳超出允许窗口，或 delivery ID 已处理；
Then 系统分别返回 401、401 与 409，不创建 Task，不泄露密钥或内部堆栈，并记录拒绝事件与来源摘要。

**US-M4-06 通知不泄露敏感内容（评审者）**
Given 一个 Run 完成并产生 diff 与测试证据；
When 桌面通知与出站 Webhook 通知被发送；
Then 通知只包含任务标题、Agent 名称、状态、时间与深链，不包含代码、提示词、diff、文件路径、密钥或完整日志；点击通知可回到正确的 Task 或 Run。

**US-M4-07 干净机器安装（新用户）**
Given 一台没有安装 Go、Node、pnpm 或 Wails CLI 的干净机器；
When 用户安装 DMG、NSIS 或 AppImage 并首次启动；
Then 应用成功启动，关于页显示的版本与安装包一致，用户能在 10 分钟内完成一次 Mock Run；卸载时默认保留用户数据，除非用户显式选择删除。

**US-M4-08 自动更新与回滚（平台负责人）**
Given 当前安装版本为 N，更新服务发布签名版本 N+1；
When 用户同意更新；
Then 客户端校验清单签名与包校验和，原子替换并保留 N；若 N+1 启动失败或健康检查失败，自动回滚到 N，数据不丢失；签名无效时拒绝安装并保留当前版本。

**US-M4-09 升级保留数据（独立开发者）**
Given 本地已有 Task、Agent、Run、Artifact 与审批记录；
When 用户从 N 升级到 N+1，且 N+1 包含数据库迁移；
Then 升级前自动备份数据库；迁移成功后数据可读；迁移失败时恢复备份与旧版本，并拒绝降级到更旧版本。

**US-M4-10 插件权限边界（扩展开发者）**
Given 一个声明了 `tasks.read` 与 `events.subscribe` 的插件；
When 插件尝试读取仓库文件、访问网络、调用合并接口或读取 Runtime 密钥；
Then 所有越权请求被拒绝并记录审计；插件崩溃或超时不影响主程序；停用插件后其权限立即失效。

**US-M4-11 遥测默认关闭（隐私敏感用户）**
Given 用户首次安装并启动 ATeam；
When 用户未主动开启遥测；
Then 应用不发送任何遥测；设置页可查看事件清单、端点与保留期限；开启后发送内容不包含代码、提示词、diff、路径、用户名或任务内容；用户可随时关闭、导出与删除。

**US-M4-12 自动化不绕过审批门（平台负责人）**
Given 一个由 Schedule 或 Webhook 创建的 Run 已完成；
When 该 Run 请求合并、推送或部署；
Then 系统仍按 M2 的审批门要求人工批准；自动化身份不能自批，插件不能代批，未批准的动作被阻止并记录审计。

**US-M4-13 文档可完成安装与排障（新用户）**
Given 用户只阅读产品文档，不使用开发者帮助；
When 按文档安装、配置 Runtime、创建 Schedule、排查一次签名失败；
Then 用户能完成操作并找到日志位置、错误码含义与下一步；文档版本与安装版本一致。

**US-M4-14 自动化遵守任务 DAG 与上游验收（小团队）**
Given 一个由 Schedule 或 Webhook 创建的任务属于 M2 的任务 DAG，且存在未验收的上游任务；
When 规则试图把该任务置为 `todo` 或启动 Run；
Then 系统阻止进入可执行状态，任务保持 `blocked` 并记录上游阻塞原因；上游验收后发出依赖就绪通知，只有规则显式配置 `todo` 时才排队 Run；「立即运行」同样不得绕过上游验收。

**US-M4-15 自动化无新增与引用失效（独立开发者）**
Given 一个每日分诊 Schedule 或一个 Webhook 端点；
When 当天没有新 Bug，或引用的模板被归档、模板字段被修改、Agent 权限被收紧；
Then 无新增时 Run 以 `completed` 结束并记录 `status/subtype=no_changes` 事件，生成 no-op 证据，不产生空 diff 或空 commit；引用失效时规则进入 `blocked`/`needs_review` 并通知负责人，不得静默失败或带旧权限继续触发。

## 5. 功能需求

本节使用 M4- 前缀的里程碑级需求编号。每条需求都必须可测试；优先级 P0 为退出阻断项，P1 为应交付项，P2 为可后置项。行为细节以对应模块文档为准，本章规定验收口径。

### 5.1 定时自动化（M4-AUTO）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-AUTO-001 | 用户可以创建、编辑、复制、删除、启用、暂停 Schedule；字段包含名称、cron/间隔、时区、任务模板与模板版本、DAG、默认状态（Backlog/todo）、Agent、启用状态与策略 | P0 | CRUD 与状态持久化；重启后规则仍存在；模板版本被记录 | 任务模板、DAG、Agent |
| M4-AUTO-002 | Schedule 支持 5 段 cron 与固定间隔；使用 IANA 时区；保存前校验表达式并预览未来 5 次运行时间 | P0 | 非法表达式返回可读错误；预览与到时结果一致 | NFR-I18N-005（UTC 存储）、NFR-I18N-006（本地时区） |
| M4-AUTO-003 | 触发时从任务模板创建 Task，默认状态为 Backlog；只有规则显式指定 `todo` 时才允许排队 Run；不得直接进入 `in_progress` 或 `done`。「立即运行」是显式手动例外，可创建 Task 与 Run，但同样不得绕过 DAG 与上游验收 | P0 | 默认不自动执行；显式 `todo` 才排队 Run；非法状态转换被拒绝 | 任务状态机、TASK-104 |
| M4-AUTO-004 | 自动创建的 Task 与 Run 记录 `automationId`、`trigger=schedule`、`dedupeKey`、`scheduledFor` 与触发时间；同一计划时刻重复触发不产生重复 Task | P0 | 重复调用返回同一结果或被跳过；数据库无重复记录 | `prd/02-domain-model.md` 的 DM-RUN-012 |
| M4-AUTO-005 | Schedule 支持重叠策略：跳过（默认）、排队、并行；跳过与排队都要记录原因并通知 | P0 | 上一次活跃时不产生默认并行；策略可切换 | 调度器 |
| M4-AUTO-006 | 支持错过运行策略：跳过（默认）、启动后补跑一次、在指定窗口内补跑；不得补跑全部历史 | P0 | 关闭 3 天后启动，默认不产生 3 次补跑 | 可靠性 |
| M4-AUTO-007 | 正确处理夏令时：不存在的本地时间向后顺延；重复的本地时间只运行一次；行为写入文档 | P1 | DST 测试用例通过；预览显示解析后的时间 | 时区库 |
| M4-AUTO-008 | 暂停的 Schedule 不到点触发；恢复时从当前时间重新计算下一次运行，不补跑暂停期间的次数 | P0 | 暂停期间无 Task；恢复后无历史补跑 | 调度器 |
| M4-AUTO-009 | 提供「立即运行」用于测试：创建一次 Task 与 Run，Run 记录 `trigger=manual`、`source=manual`；不改变下一次计划时间，不影响历史统计；不得绕过上游验收与审批门 | P1 | 运行一次后 nextRunAt 不变；审计可区分手动来源 | M4-AUTO-002 |
| M4-AUTO-010 | 每个 Schedule 支持最大并行数、每日最大运行次数与单次最大时长；默认单 Schedule 最大并行 1、每日 24 次、单次超时 60 分钟，均可配置；超限时跳过并通知，不静默堆积 | P0 | 默认值写入配置与测试；超限产生跳过事件；无无限排队 | 资源与成本 |
| M4-AUTO-011 | 自动化创建的 Run 必须继承 Agent 的 `allowedPaths`、`allowedCommands`、超时与并发限制；不能因为自动化而放宽权限 | P0 | 越界路径/命令仍被拒绝；审计记录自动化来源 | AGENT-021、AGENT-022、AGENT-023、SEC-010、SEC-011 |
| M4-AUTO-012 | 自动化不能创建审批记录、不能替人批准、不能合并、不能推送、不能部署、不能删除；尝试上述动作时被阻止并记录 | P0 | 自动化身份调用高风险接口返回 403 | PROD-009、SEC-020、SEC-024、SEC-025、SEC-026 |
| M4-AUTO-013 | Schedule 触发时若目标 Task 仍有活跃 Run，按策略创建新 Task 或跳过；不得违反「同一 Task 同时最多一个活跃 Run」 | P0 | 409 或跳过；无并发双 Run | `prd/02-domain-model.md` DM-RUN-006 |
| M4-AUTO-014 | Agent 的工作时间窗口只影响队列准入，不终止运行中的 Run；Schedule 在窗口外触发时按配置排队或跳过 | P1 | 窗口外不开始新 Run；运行中 Run 继续 | AGENT-051 |
| M4-AUTO-015 | 提供 dry-run/preview：展示将要创建的任务模板版本、Agent、权限、允许路径、DAG 上游状态与预估影响，不产生任何写入 | P1 | preview 后数据库无新记录；悬空引用在 preview 中失败 | UI、M4-AUTO-019 |
| M4-AUTO-016 | 系统时钟大幅跳变、时区变更或休眠唤醒后，重新计算 nextRunAt 并记录审计；不得因时钟回拨重复触发 | P1 | 时钟回拨测试无重复 Task | 可靠性 |
| M4-AUTO-017 | 自动化创建的任务必须绑定合法的任务模板与 DAG；若存在未验收的上游任务，任务只能处于 Backlog 或 `blocked`，不得进入 `todo` 或启动 Run；上游验收后发出依赖就绪通知；规则显式 `todo` 时才自动排队 Run | P0 | 上游未验收时无法执行；上游通过后按规则排队；无绕过路径 | M2 任务 DAG、COLLAB 依赖规则 |
| M4-AUTO-018 | 当 Agent 输出「无新增」或没有可审查改动时，Run 以 `completed` 结束并记录 `status/subtype=no_changes` 事件，生成 no-op 证据；不得生成空 diff、空 commit 或进入合并流程；通知明确标注「无新增」 | P0 | no-op Run 不产生 diff/commit；合并入口不可用；通知文案正确 | `M1-local-loop.md` 的 EVIDENCE-005、UI-009（mock/证据规则） |
| M4-AUTO-019 | 引用完整性：模板删除/归档、模板字段变更、Agent 删除或权限收紧时，Schedule 必须阻止触发并进入 `blocked`/`needs_review`，或先停用规则并通知负责人；不得静默使用旧快照或悬空引用 | P0 | 删除被引用模板被阻止或提示停用规则；权限收紧后规则需重新确认 | 任务模板、Agent 生命周期 |
| M4-AUTO-020 | 团队模式下 Schedule 的触发由单一 leader 执行；远程 Runner 只执行 Run，不承担定时触发；团队 Schedule 需要 `automation:write` 与审计 | P1 | 双 leader 不重复触发；远程 Runner 不创建 Schedule Task | M3 远程 Runner、审计 |

### 5.2 Webhook 入站（M4-HOOK）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-HOOK-001 | 用户可以创建、编辑、启用、暂停、删除 Webhook 端点；字段包含名称、目标模板与模板版本、DAG、默认状态（Backlog/todo）、Agent、允许来源与启用状态 | P0 | CRUD 与持久化；停用后请求被拒绝；模板版本被记录 | 任务模板、DAG、Agent |
| M4-HOOK-002 | Webhook 默认关闭；启用外部访问需要显式确认并展示风险说明；默认只监听回环地址 | P0 | 默认安装无可从局域网访问的端点 | SEC |
| M4-HOOK-003 | 每个端点有不可猜测的 ID 与独立密钥；密钥存入系统钥匙串或加密本地存储，不在日志、导出与界面明文展示 | P0 | 日志扫描无密钥；界面只显示掩码 | SEC、密钥管理 |
| M4-HOOK-004 | 使用 HMAC-SHA256 对「时间戳 + 原始请求体」签名；校验使用常量时间比较；签名算法与头部写入文档 | P0 | 正确签名通过；错误签名 401 | 安全 |
| M4-HOOK-005 | 拒绝重放：时间戳必须在允许窗口内（默认 ±300 秒，可配置）；delivery ID 在保留期内唯一；重复请求返回 409 且不创建 Task | P0 | 重放测试无重复 Task；默认窗口写入配置与测试 | 去重、SEC-079 |
| M4-HOOK-006 | 请求体上限默认 256 KiB（低于 SEC-006 的 1 MiB 全局上限），可配置但不得超过 1 MiB；JSON 结构校验失败返回 400；未知字段默认按严格模式拒绝（400 `UNKNOWN_FIELD`）；白名单忽略模式必须显式配置，并记录告警与命中字段名 | P0 | 超大请求 413；畸形 JSON 400；两种未知字段模式均有测试与错误码 | SEC-006、安全 |
| M4-HOOK-007 | 成功请求返回 202 与 delivery ID；创建的 Task 记录 `trigger=webhook`、来源端点、delivery ID 与去重键，默认进入 Backlog；只有端点显式 `todo` 且上游验收后才排队 Run | P0 | 返回码与数据库一致；默认不自动执行 | RUN-012、M4-AUTO-017 |
| M4-HOOK-008 | 提供速率限制与失败熔断：每端点默认 60 次/分钟；连续失败达到阈值后自动停用并通知负责人 | P1 | 429 返回；熔断后请求被拒绝直至人工恢复 | 可靠性、API-1302 |
| M4-HOOK-009 | 保存投递日志：时间、delivery ID、状态码、错误码、关联 Task、请求体摘要（不含敏感正文）；支持人工重放 | P1 | 日志可查询；重放需确认且仍走去重 | 审计 |
| M4-HOOK-010 | 支持密钥轮换与撤销：轮换期间旧密钥有有限重叠窗口；撤销立即生效；操作写入审计 | P0 | 轮换后旧密钥在宽限期后失效 | SEC-079 |
| M4-HOOK-011 | Webhook 只能创建 Task；端点显式 `todo` 时才排队 Run；不得调用 Review、Approval、Merge、Push、Deploy、Delete，也不得修改 Agent 权限 | P0 | 越权字段被忽略/拒绝并记录 | PROD-009、M4-AUTO-012 |
| M4-HOOK-012 | 模板变量只允许白名单字段；不得把请求体拼接为 shell 命令、路径或提示词注入点；所有字段做长度与字符限制 | P0 | 注入测试通过；越界路径被拒绝 | 安全 |
| M4-HOOK-013 | 如启用局域网访问，必须要求 TLS 反向代理或显式令牌，并提供来源 IP 允许列表；文档说明不推荐直接暴露公网 | P1 | 无 TLS/令牌时拒绝启用外部模式 | SEC-079 |
| M4-HOOK-014 | 发布 `webhook.received`、`webhook.accepted`、`webhook.rejected`、`webhook.replayed`、`webhook.disabled` 事件；事件用于通知与审计 | P1 | 事件顺序与状态一致 | 事件模型 |
| M4-HOOK-015 | 明确至少一次投递语义：外部系统可能重试；ATeam 通过 delivery ID 保证幂等；响应码与重试建议写入文档 | P1 | 重复投递不产生重复 Task | 文档 |
| M4-HOOK-016 | Webhook 创建的任务必须绑定合法的任务模板与 DAG；上游未验收时不得进入 `todo` 或启动 Run；上游验收后发出依赖就绪通知；端点显式 `todo` 时才自动排队 Run | P0 | 上游阻塞时无 Run；上游通过后按配置排队 | M2 任务 DAG |
| M4-HOOK-017 | 引用完整性：目标模板删除/归档、模板字段变更、Agent 删除或权限收紧时，端点必须拒绝新投递并返回 409 与结构化错误、可读原因，或先停用端点并通知负责人；不得静默使用悬空引用 | P0 | 失效端点返回结构化错误；恢复需人工确认 | 模板与 Agent 生命周期 |
| M4-HOOK-018 | 团队模式下 Webhook 端点需要 `automation:write` 权限；创建、轮换、停用与重放均写入审计，记录操作者、来源摘要与结果 | P1 | 权限与审计测试通过 | M3 权限 |

### 5.3 通知（M4-NOTIFY）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-NOTIFY-001 | 通知覆盖 Run 完成、Run 无新增、Run 失败、待评审、待审批、审批过期、依赖就绪、自动化跳过/暂停/失败、更新可用、插件被停用 | P0 | 每类事件都能产生通知；无遗漏 | COLLAB-065 |
| M4-NOTIFY-002 | 渠道包括应用内通知中心、桌面原生通知、出站 Webhook；M4 不提供邮件、短信或 IM | P0 | 设置页只出现三种渠道 | UI-129 |
| M4-NOTIFY-003 | 用户可按事件类型与渠道分别开关；默认应用内开启、桌面开启、出站关闭；安静时段默认关闭；审批、prod 门禁与升级提醒不能被静默丢弃 | P1 | 关闭后不再投递；审批类仍保留在应用内；默认值写入测试 | UI-129、D-M4-14 |
| M4-NOTIFY-004 | 通知内容最小化：任务标题、Agent 名称、状态、时间、深链；不含代码、提示词、diff、路径、密钥、完整日志 | P0 | 抓包与界面检查无敏感内容 | NFR-SEC-011 |
| M4-NOTIFY-005 | 同一任务同一类型通知在 10 分钟内去重聚合；审批、prod 门禁与升级提醒不受频率限制 | P1 | 连续 5 次失败只产生一条聚合通知 | COLLAB 通知规则 |
| M4-NOTIFY-006 | 桌面通知权限被拒绝时回退到应用内，不静默丢失；设置页显示权限状态与修复指引 | P1 | 拒绝权限后仍能在 Inbox 看到 | 桌面能力 |
| M4-NOTIFY-007 | 通知深链打开正确的 Task、Run 或 Review；对象被删除时显示可理解的兜底页 | P1 | 深链测试通过 | UI 路由 |
| M4-NOTIFY-008 | 出站 Webhook 通知带签名、超时与重试；默认 5 次指数退避；失败不影响 Run 状态，记录投递日志 | P0 | 端点不可用时 Run 仍完成；重试日志完整 | 可靠性 |
| M4-NOTIFY-009 | 支持安静时段；安静时段只抑制桌面提示音与弹出，不抑制应用内记录；审批与升级提醒仍可见 | P2 | 安静时段 Inbox 仍显示审批 | UI |
| M4-NOTIFY-010 | 通知中心支持未读/已读、按类型筛选、批量标记已读与保留期限；清理不影响审计记录 | P1 | 批量操作与清理测试通过 | UI |
| M4-NOTIFY-011 | 通知发送失败有本地诊断日志；用户可查看失败原因并手动重试 | P1 | 失败可见、可重试 | 可观测性 |
| M4-NOTIFY-012 | 通知模块故障不得阻塞 Run 完成、评审或审批；所有投递异步执行 | P0 | 注入通知故障后核心闭环仍通过 | 可靠性 |
| M4-NOTIFY-013 | 通知中心、桌面通知、出站通知均需定义空状态与不可用状态：无通知时区分「已全部处理」与「暂无通知」，并提供去创建任务或规则的入口；桌面权限被拒绝、出站未配置时显示状态与修复入口，不只显示空白 | P1 | 空状态文案与入口审查；权限拒绝与未配置状态可见 | UI-078、UI-080 |

### 5.4 打包与签名（M4-PKG）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-PKG-001 | 产出 macOS DMG（arm64 与 amd64）、Windows NSIS 安装包（x64）、Linux AppImage（x64）与 tar.gz | P0 | 以上产物均能在干净机器安装并启动 | NFR-PKG-001 |
| M4-PKG-002 | Web 资源通过 Go embed 打入二进制；运行时不依赖 Node、pnpm 或外部 `apps/web/dist` 目录 | P0 | 删除源码目录后应用仍可启动 | NFR-PKG-001 |
| M4-PKG-003 | 构建时注入版本、提交号与构建时间；关于页、`/api/v1/health`、安装包文件名与发布说明一致 | P0 | 三处版本一致；无 `0.1.0-dev` 泄漏到正式包 | NFR-PKG-005（原计划 M1，M4 承接未交付遗留） |
| M4-PKG-004 | macOS 包使用 Developer ID 签名、Hardened Runtime、公证与 staple；`spctl` 与 `codesign` 验证通过 | P0 | Gatekeeper 放行；公证票据可验证 | NFR-PKG-002、SEC-065 |
| M4-PKG-005 | Windows 包使用 Authenticode 签名并加时间戳；安装器检测 WebView2，缺失时给出可操作的安装指引 | P0 | 签名验证通过；干净虚拟机安装成功 | NFR-PKG-003、NFR-PORT-009 |
| M4-PKG-006 | Linux 提供 AppImage 与 tar.gz，附 SHA-256 校验和；可选 GPG 签名；启动时检测 WebKitGTK 版本 | P0 | 校验和匹配；缺失依赖时有明确提示 | NFR-PKG-004 |
| M4-PKG-007 | 干净机器验收：无开发工具链，安装、启动、完成一次 Mock Run、卸载 | P0 | 全流程录像与日志；Mock Run 明确标注 mock 证据 | NFR-PKG-001、`M1-local-loop.md` UI-009 |
| M4-PKG-008 | 卸载默认保留用户数据目录与 Workspace；删除数据必须由用户显式选择并二次确认 | P1 | 卸载后数据仍在；删除路径有确认 | NFR-PKG-009 |
| M4-PKG-009 | 应用图标、LICENSE、许可、NOTICE、第三方许可证清单随包分发；许可证信息与仓库根目录 `LICENSE`（Apache-2.0）一致；不得包含第三方产品的图标、文案或品牌资产 | P0 | 许可证审查通过；无侵权素材 | PROD-014、SEC-063 |
| M4-PKG-010 | 安装器、LICENSE/NOTICE、更新说明与安全披露支持 zh-CN 与 en-US；关于页与应用 UI 的语言由 D-M4-20 的 UI 语言策略决定，M4 不强制应用 UI 全量双语 | P1 | 安装器与法律文本两种语言完整可见；关于页与 UI 语言策略一致 | NFR-I18N-013（关于页范围按 D-M4-20 收窄）、D-M4-20 |
| M4-PKG-011 | 安装包体积不超过 150 MB；应用可执行文件不超过 120 MB；Web 资源 gzip 后不超过 5 MB | P2 | 构建产物测量 | NFR-PKG-011、NFR-RES-005 |
| M4-PKG-012 | 发布生成 SBOM、SHA-256 清单、构建元数据与可追溯记录；关键依赖版本锁定 | P0 | 发布检查单勾选；清单可下载 | NFR-PKG-012、SEC-064 |
| M4-PKG-013 | 签名密钥不进入仓库；CI 使用受控密钥存储；发布构建在隔离环境执行并记录访问者 | P0 | 仓库扫描无密钥；审计可追溯 | SEC-065 |
| M4-PKG-014 | 启动失败时写入本地崩溃日志并显示可操作对话框，不得静默退出或只留空白窗口 | P1 | 故障注入测试可见提示 | 可观测性 |
| M4-PKG-015 | 三个平台分别产出独立验收记录：macOS（DMG、公证、`spctl`）、Windows（NSIS、WebView2 检测、Authenticode 与时间戳）、Linux（AppImage、WebKitGTK 检测、SHA-256）；任一平台缺失记录则 M4 退出标准不通过 | P0 | 三份平台验收记录与产物哈希归档；macOS 录屏不能替代其余两平台 | NFR-PKG-001、NFR-PORT-009 |

### 5.5 自动更新（M4-UPD）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-UPD-001 | 自动更新默认关闭；用户可在设置中开启自动检查；手动「检查更新」始终可用；首次启动不诱导开启 | P0 | 默认安装无更新网络请求；手动检查可用 | NFR-PKG-006、隐私原则 |
| M4-UPD-002 | 提供 stable 与 beta 两个通道；beta 不得自动推送给 stable 用户；切换通道需要确认并显示风险 | P0 | 通道隔离测试通过 | NFR-PKG-010 |
| M4-UPD-003 | 更新清单通过 HTTPS 获取，包含 `version`、`channel`、`minOSVersion`、`minUpgradableVersion`、`minSecurityVersion`、`packageSizeBytes`、`securityUpdate`（布尔）与 `severity`、`sha256`、`signature`、`notesUrl` 与 `rolloutPercent`；`minVersion` 保留为 `minUpgradableVersion` 的兼容别名并注明语义；客户端先验签再下载 | P0 | 清单字段校验通过；篡改清单被拒绝；无效签名不下载 | SEC-065、NFR-PKG-006 |
| M4-UPD-004 | 下载完成后再次校验包校验和；安装采用原子替换；保留上一版本；新版本启动失败或健康检查失败时自动回滚 | P0 | 回滚演练通过；旧版本可启动 | NFR-PKG-006 |
| M4-UPD-005 | 升级前自动备份数据库；迁移失败恢复备份与旧版本；检测到数据库版本高于应用时拒绝启动并提示 | P0 | 迁移失败不丢数据；降级被拒绝 | NFR-PKG-008 |
| M4-UPD-006 | 更新检查不阻塞启动；单次检查超时 3 秒；离线时静默失败并保留重试入口，不重复弹窗 | P1 | 离线启动测试；无网络等待 | NFR-PKG-007 |
| M4-UPD-007 | 更新提示展示版本、`packageSizeBytes`、发布说明、是否为安全更新与严重级别；安装需要用户确认，不静默安装 | P0 | 无静默安装；体积与安全标记与清单一致；安全更新也需确认 | 人工在回路、M4-UPD-003 |
| M4-UPD-008 | 清单支持灰度比例、`minUpgradableVersion` 与 `minSecurityVersion`；客户端遵守灰度；低于最低安全版本时提示强制更新，但仍由用户执行；`minOSVersion` 不满足时拒绝安装并说明原因 | P1 | 灰度测试；强制提示不自动执行；最低系统版本与最低安全版本分别测试 | 发布策略、M4-UPD-003、D-M4-16 |
| M4-UPD-009 | 更新日志本地保存，可导出用于排障；日志不包含任务内容、代码或密钥 | P1 | 日志检查通过 | 隐私 |
| M4-UPD-010 | 更新失败保留当前版本与数据；用户可重试或按文档手动下载；失败原因可读 | P0 | 断网、磁盘满、签名错误三类失败测试 | 可靠性 |
| M4-UPD-011 | 更新密钥有轮换与吊销流程；密钥泄露时可发布吊销公告、启用 kill switch 并停止分发 | P0 | 演练记录；kill switch 生效 | SEC-065 |
| M4-UPD-012 | 开发构建与未签名构建不参与自动更新；界面明确显示「开发版本」并禁用更新安装 | P1 | 开发包检查更新被拒绝 | 发布工程 |
| M4-UPD-013 | 更新可用通过通知中心提示，遵循通知内容最小化与频率规则 | P2 | 通知不含敏感内容 | M4-NOTIFY |

### 5.6 插件 API（M4-PLUG）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-PLUG-001 | 插件清单包含 id、名称、版本、API 版本、入口、权限、贡献点与内容哈希；缺少必填字段拒绝安装 | P0 | 清单校验测试 | OQ-010 |
| M4-PLUG-002 | M4 仅支持从本地文件安装插件；不提供在线市场、不自动下载、不自动更新插件 | P0 | 无网络安装路径 | 范围 |
| M4-PLUG-003 | 权限采用默认拒绝：`tasks.read`、`events.subscribe`、`files.export`、`ui.panel`、`templates.contribute`、`approval.check` 等需逐项声明与授予 | P0 | 未声明权限的调用被拒绝 | SEC |
| M4-PLUG-004 | 插件默认无网络、无任意文件访问；网络权限需按域名授权；文件访问仅限插件数据目录与用户显式选择的导出目录 | P0 | 越权网络/文件测试 | SEC-010、SEC-080 |
| M4-PLUG-005 | 插件运行在独立进程或等效隔离边界；崩溃、死循环与内存超限不影响核心；有超时与熔断 | P0 | 崩溃注入后主程序可用 | 可靠性 |
| M4-PLUG-006 | 插件 API 使用语义化版本；不兼容版本拒绝加载并提示；废弃 API 有窗口期与迁移说明 | P1 | 版本兼容测试 | 扩展性 |
| M4-PLUG-007 | 插件不能审批、合并、推送、部署、删除、修改权限或审计；越权调用被阻止并记录 | P0 | 越权接口返回 403 并审计 | PROD-009 |
| M4-PLUG-008 | 事件订阅采用至少一次投递与游标；插件必须幂等；事件负载最小化，不含密钥与完整日志 | P1 | 重复事件不导致重复副作用 | 事件模型 |
| M4-PLUG-009 | UI 与扩展点限定为：设置页、任务详情只读面板、导出动作、通知渠道、证据渲染器；不得覆盖核心导航与高风险按钮。通知渠道只能通过宿主提供的投递 API 发送，域名需单独授权；证据渲染器只读、沙箱化、不得执行脚本或加载远程内容，不得修改原始证据 | P1 | 扩展点清单与截图审查；越权 DOM/网络/脚本测试通过 | UI、SEC-080 |
| M4-PLUG-010 | 支持启用、停用、卸载；停用立即撤销权限并停止进程；卸载时由用户选择是否保留插件数据 | P0 | 停用后调用被拒绝 | 生命周期 |
| M4-PLUG-011 | 插件错误写入独立日志并带插件 id；连续失败触发熔断，主程序提示但不崩溃 | P1 | 错误隔离测试 | 可观测性 |
| M4-PLUG-012 | 插件安装、启用、停用、升级、权限变更全部写入审计，包含操作者、时间、版本与哈希 | P0 | 审计可查询 | SEC |
| M4-PLUG-013 | 插件签名可选；界面展示来源、哈希与权限差异；未签名插件需要额外确认；不自动信任 | P1 | 未签名安装有二次确认 | 供应链、D-M4-17 |
| M4-PLUG-014 | `approval.check` 只能增加检查或要求更多证据，不能批准、不能降低证据要求；插件故障默认失败关闭（阻断合并）；只有显式配置 `approval.check.onFailure=manual_override` 时，才允许审批人填写理由、二次确认后人工覆盖，并写入审计。两种模式都必须有测试与错误码（`PLUGIN_APPROVAL_CHECK_FAILED`、`APPROVAL_OVERRIDE_REQUIRED`） | P0 | 插件不能批准合并；默认故障阻断；覆盖模式有理由与审计 | M2 审批门、D-M4-22 |
| M4-PLUG-015 | 插件不能读取 Runtime 凭据、模型密钥、环境变量中的密钥或审计原文 | P0 | 密钥读取测试失败 | SEC |
| M4-PLUG-016 | 提供示例插件、API 参考与权限说明；示例在干净环境可运行 | P1 | 文档与示例验收 | M4-DOC |
| M4-PLUG-017 | M4 的「插件 Runtime」仅指插件独立进程宿主，不提供第三方 Agent Runtime 适配器；插件不能替代 Claude Code、Codex 或 mock 执行 Run | P0 | 插件无法注册为 Agent runtime；配置校验拒绝 | 01-scope §4.6.2 对账 |
| M4-PLUG-018 | 插件列表、权限授予、事件订阅与错误日志均需空状态与不可用状态：无插件时提供「从本地文件安装」入口；插件 API 版本不兼容时显示原因与兼容版本；插件宿主未启动时禁用相关扩展点并说明 | P1 | 空状态与不兼容状态审查 | UI-078、UI-080 |

### 5.7 遥测（M4-TEL）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-TEL-001 | 遥测默认关闭；未同意前不发送任何遥测请求；首次启动不预选同意 | P0 | 抓包无上报；默认开关为关 | NFR-SEC-011、GOV-010 |
| M4-TEL-002 | 同意页用简明语言说明采集项、用途、保留期限与关闭方式；提供事件清单链接；崩溃上传单独同意 | P0 | 用户可理解；无捆绑同意 | 隐私 |
| M4-TEL-003 | 采集字段限定为应用版本、操作系统族与版本、事件名、时间、匿名安装 ID、功能开关、错误码、耗时区间；不含任务/Agent 名称、提示词、代码、diff、路径、用户名、仓库名、密钥 | P0 | 字段审查与抓包 | NFR-SEC-011、NFR-COST-008 |
| M4-TEL-004 | 本地保存遥测发送记录与队列；用户可查看、导出、删除 | P1 | 导出文件可读；删除后无残留 | 数据主权 |
| M4-TEL-005 | 关闭遥测立即停止发送并清空未发送队列；关闭操作不需要重启 | P0 | 关闭后抓包无请求 | NFR-SEC-011 |
| M4-TEL-006 | 端点与隐私政策公开；遥测事件与服务端保留期限默认 90 天并明确展示；不使用广告或跨站追踪；不向第三方转售数据 | P0 | 文档与端点可访问；保留期限与设置页一致 | 隐私、D-M4-15 |
| M4-TEL-007 | 崩溃日志默认只存本地；上传仅在单独同意后执行；上传前脱敏路径、用户名与可能的代码片段 | P1 | 崩溃上传测试；脱敏检查 | NFR-OBS-011 |
| M4-TEL-008 | 团队/组织策略可以禁用遥测；成员不能覆盖组织禁用 | P1 | 策略测试 | M3 权限 |
| M4-TEL-009 | 遥测失败不得影响产品功能；失败只写本地诊断日志，不重试轰炸 | P1 | 端点不可用测试 | 可靠性 |
| M4-TEL-010 | 每次发送前生成本地审计记录；用户可核对「本地记录 = 实际发送」 | P1 | 审计与抓包一致 | 信任 |

### 5.8 文档（M4-DOC）

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-DOC-001 | 提供 macOS、Windows、Linux 的安装、首次启动、升级、卸载与数据保留说明 | P0 | 新用户按文档完成安装 | NFR-PKG-009 |
| M4-DOC-002 | 提供 Runtime 配置说明：CLI 路径、认证、模型选择、BYO Key、本地数据边界与「提示词会发往模型服务」的准确表述 | P0 | 文档审查通过 | SEC 隐私表述 |
| M4-DOC-003 | 提供权限与审批说明：允许路径、允许命令、合并/推送/部署/删除审批、DevOps prod 人工执行 | P0 | 与 SEC/COLLAB 需求一致 | PROD-009 |
| M4-DOC-004 | 提供自动化指南：Schedule、Webhook 签名示例、错误码、重放与重试语义、失败排查 | P0 | 按文档可完成签名请求 | M4-AUTO、M4-HOOK |
| M4-DOC-005 | 提供插件 API 参考、权限清单、生命周期、版本兼容与示例插件 | P1 | 示例可运行 | M4-PLUG |
| M4-DOC-006 | 提供隐私与遥测说明：采集字段、端点、保留期限、导出与删除步骤 | P0 | 与实现一致 | M4-TEL |
| M4-DOC-007 | 提供排障与 FAQ：日志位置、诊断包、常见错误、离线与代理、WebView 依赖 | P1 | 常见问题可自助解决 | NFR |
| M4-DOC-008 | 提供发布说明、已知问题、安全披露渠道与响应时限 | P0 | 发布检查单包含 | SEC-066 |
| M4-DOC-009 | 文档与安装版本同步；关于页可打开离线文档或本地帮助入口 | P1 | 版本号一致 | 发布工程 |
| M4-DOC-010 | 安装器、LICENSE/NOTICE、更新说明与安全披露支持中英双语；关于页与应用 UI 的语言遵循 D-M4-20，不在 M4 强制应用 UI 全量双语 | P1 | 安装器与法律文本双语检查；关于页与 UI 语言策略一致 | NFR-I18N-013、D-M4-20 |
| M4-DOC-011 | 提供管理员指南：团队部署、成员与角色、共享 Agent、自动化权限与审计、Webhook 密钥轮换、插件治理、遥测组织策略、备份与恢复 | P1 | 管理员按文档完成一次团队配置与审计查询 | 01-scope §4.6.2、SEC |

### 5.9 需求追溯与模块映射

M4 的里程碑需求不是替代模块需求，而是把模块需求组合成可验收的发布门禁。追溯关系如下：

| M4 工作流 | 模块文档中的行为定义 | 既有需求编号 | 追溯说明 |
|---|---|---|---|
| 定时自动化 | `prd/modules/runtime-and-workspace.md`、`prd/modules/task-management.md`、`prd/02-domain-model.md`、`prd/modules/agent-system.md`、`prd/modules/api-and-data.md` | Run 生命周期与 `trigger` 字段、02-domain-model DM-RUN-012（trigger 与去重）、AGENT-051、TASK-104、API-1008、API-1300/API-1301 | 里程碑只验收触发、去重、DAG 准入、权限继承与人工门禁 |
| Webhook | `prd/modules/runtime-and-workspace.md`、`prd/modules/security-and-permissions.md`、`prd/modules/api-and-data.md` | SEC-006（请求体上限）、SEC-079（Webhook/定时自动化身份与防重放）、API-1302（Webhook 端点与投递）、API-1303（HMAC 与时间戳）、02-domain-model DM-RUN-012 | 里程碑只验收签名、重放、去重、投递日志、密钥轮换与越权阻止 |
| 通知 | `prd/modules/collaboration-and-review.md`、`prd/modules/ui-ux.md` | COLLAB-065、UI-129、UI-078、UI-080 | 里程碑只验收事件覆盖、内容最小化、去重、渠道与空状态 |
| 打包与签名 | `prd/modules/non-functional-requirements.md`、`prd/modules/security-and-permissions.md` | NFR-PKG-001 至 NFR-PKG-013（NFR-PKG-005 原计划 M1）、NFR-PORT-009、NFR-I18N-013、SEC-062 至 SEC-066 | 里程碑只验收产物、干净机器、平台矩阵、签名、体积与 SBOM |
| 自动更新 | `prd/modules/non-functional-requirements.md`、`prd/modules/security-and-permissions.md` | NFR-PKG-006 至 NFR-PKG-010、NFR-PKG-013、SEC-065 | 里程碑只验收通道、清单字段、签名、回滚、备份与降级拒绝 |
| 插件 API | `prd/modules/agent-system.md`、`prd/modules/task-management.md`、`prd/modules/security-and-permissions.md` | AGENT-046、AGENT-047、OQ-010（已决定受限插件）、SEC-010、SEC-080 | 里程碑只验收权限、隔离、扩展点、审计、越权阻止与示例 |
| 遥测 | `prd/modules/non-functional-requirements.md`、`prd/05-risks-and-open-questions.md` | NFR-SEC-011、NFR-COST-008、NFR-OBS-011、GOV-010、RISK-S-008 | 里程碑只验收默认关闭、字段、导出删除与关闭生效 |
| 文档 | `prd/modules/non-functional-requirements.md`、`prd/modules/security-and-permissions.md` | NFR-I18N-013、SEC-066 | 里程碑只验收覆盖度、管理员指南、版本一致与关键文档双语 |
| 导入导出 | `prd/modules/task-management.md`、`prd/modules/collaboration-and-review.md` | 本章 M4-EXP-001、M4-EXP-002（模块第 20.5 节未分配稳定编号） | 里程碑只验收便携格式、敏感信息检查与恢复可用 |

#### 5.9.1 跨文档对账记录

以下差异在 v0.2 修订中被识别并给出本章口径。它们是待同步到对应文档的编辑清单，不是可选的解释空间；在同步完成前，本章口径优先。

| 对账项 | 本章唯一口径 | 需要同步的文档与章节 | 同步动作 | 状态 |
|---|---|---|---|---|
| 自动化触发语义 | 默认创建 Task 并进入 Backlog；规则显式 `todo` 且上游验收后才排队 Run；「立即运行」是显式手动例外，可创建 Task+Run，记录 `trigger=manual`、`source=manual` | `prd/01-scope-and-roadmap.md` §4.6.3 #4、`prd/03-user-flows.md` S7、`prd/04-acceptance-and-test-plan.md` §4.5 #1、`prd/modules/api-and-data.md` §5.12 | 已按「默认创建 Task，显式 todo 才排队 Run；立即运行是手动例外」回写 01/03/04 与 api §5.12 | 已同步 |
| Crew 自动编排 | M4 不交付 Crew/队长自动编排；依赖触发只处理任务 DAG 的就绪任务 | `prd/01-scope-and-roadmap.md` 能力矩阵「Crew：自动化编排」 | 已改为「M4 不交付 Crew 自动化编排，后置」 | 已同步 |
| 插件扩展范围 | M4 插件包含设置页、任务详情只读面板、导出动作、通知渠道、证据渲染器；「插件 Runtime」仅指插件宿主，不是 Agent Runtime 适配器，不提供第三方 Runtime 适配器 | `prd/01-scope-and-roadmap.md` §4.6.2 与能力矩阵、`prd/00-product-overview.md` PROD-012 | 已澄清插件 Runtime 含义并删除第三方 Runtime 适配器承诺 | 已同步 |
| trigger 枚举 | 以 `prd/02-domain-model.md` 六值为准：`manual`、`retry`、`schedule`、`webhook`、`dependency`、`crew`；M4 只新增 `schedule`/`webhook` 的落库与查询 | `prd/modules/api-and-data.md` §5.7 | 已补齐 `dependency`/`crew` 的里程碑说明并删除 `api`，M1 只产生 manual/retry | 已同步 |
| DM-RUN-006 / DM-RUN-012 编号 | 本章引用一律写 `02-domain-model` 的 `DM-RUN-006`（同一 Task 最多一个活跃 Run）与 `DM-RUN-012`（触发去重）；runtime-and-workspace 的 RUN-006 是事件 seq 需求，属不同命名空间 | `prd/modules/runtime-and-workspace.md` §需求表、`prd/05-risks-and-open-questions.md` Q-M4-21 | 本章引用已全部带 `DM-` 前缀；运行时模块的事件 seq 需求保持 `RUN-006`，不再与领域模型混用 | 已同步 |
| unsigned 发布门禁 | 公开分发必须签名；未签名包只能内部测试并在界面与文档中明确标注，不得对外分发；自动更新只接受签名产物 | `prd/01-scope-and-roadmap.md` §4.6.3 #2、§13.3 | 删除「可发布 unsigned」的兜底，或限定为内部测试并同步风险披露 | 待同步 |
| NFR-PKG-005 归属 | 版本注入与关于页版本一致性属于 M1 计划需求，当前未交付；M4-PKG-003 承接遗留，不算 M4 新增 | `prd/modules/non-functional-requirements.md` NFR-PKG-005、`prd/04-acceptance-and-test-plan.md` | 在需求行注明「M1 未交付遗留，M4 补齐」，或把里程碑改为 M4；验收记录同步 | 待同步 |
| 任务与证据导入导出 | 模块第 20.5 节只列能力、未给稳定编号；本章以 M4-EXP-001/002 作为里程碑验收编号 | `prd/modules/task-management.md` §20.5、`prd/modules/collaboration-and-review.md` | 为导入导出分配模块需求编号，或在模块中引用本章 M4-EXP 编号 | 待同步 |
| 双语范围 | 安装器、LICENSE/NOTICE、更新说明、安全披露与关键用户文档双语；应用 UI 在 M4 保持英文，关于页跟随 UI；完整 i18n 后置 | `prd/modules/ui-ux.md`、`prd/modules/non-functional-requirements.md` NFR-I18N-013、`prd/05-risks-and-open-questions.md` Q-M4-20（已关闭） | 同步 UI 语言策略与验收范围；把 NFR-I18N-013 的「关于页双语」按 D-M4-20 收窄，避免把「关于页双语」写成 UI 全量双语 | 待同步 |
| API 契约文件 | 契约来源为 `prd/modules/api-and-data.md`；`08-api.md` 是过期引用，不存在该文件；M4 端点统一 `/api/v1` | `prd/00-product-overview.md` 文档地图（已列 api-and-data）、本章 7.2 | 删除任何 `08-api.md` 引用；新端点不得使用未版本化路径 | 待同步 |
| 风险编号引用 | `prd/05-risks-and-open-questions.md` 第 7 章定义 GOV-001 至 GOV-012，第 11 章给出里程碑退出条件，第 12 章给出 OQ 编号与决策日志 | 本章 16.4/16.5、文档关系表 | 引用时写「编号 + 标题 + 章节」；若风险文档存在重号，以章节与标题限定命名空间 | 待同步 |

若里程碑需求与模块需求冲突，执行顺序为：产品总览的 PROD 与产品原则优先；其次是安全与权限模块的 SEC 约束；再次是模块文档的功能语义；最后是本章的验收口径。任何降低安全、审批或证据要求的解释都无效。5.9.1 中的对账项在对应文档完成同步前，以本章口径为准。

### 5.10 伴随能力验收：任务与证据导入导出（M4-EXP）

`prd/modules/task-management.md` 第 20.5 节把「任务与证据导入导出」列为 M4 交付，但没有分配稳定需求编号；`prd/modules/collaboration-and-review.md` 也只在证据保留与导出处描述能力。为避免验收悬空，本章补两条里程碑级需求。它们不替代模块文档，模块文档落地时应回填编号。

| ID | 需求（可测试） | 优先级 | 验收要点 | 依赖/引用 |
|---|---|---|---|---|
| M4-EXP-001 | 提供任务与证据的便携导出：单个 Task 的元数据、Run 摘要、Artifact/Evidence 清单、diff 与测试输出；导出前扫描敏感信息并提示；导出文件带 schema 版本与校验和 | P1 | 导出可在另一安装导入；敏感信息命中时需确认或排除；校验和可验证 | TASK-116、COLLAB-079、NFR-SEC-011 |
| M4-EXP-002 | 提供导入：校验 schema 版本与校验和；引用缺失的 Agent/模板时提示映射或保持只读；不得因导入覆盖现有审计与审批记录；导入写入审计 | P1 | 导入不覆盖审计；缺失引用有映射界面；版本不兼容拒绝并说明 | M3 审计、任务模板 |

## 6. 交互与规则

### 6.1 自动化编辑器

自动化页面采用「列表 + 详情 + 运行历史」结构。列表显示规则名称、目标模板、Agent、cron 的人类可读描述、下一次运行时间、最近一次结果与启用开关。详情页包含：

- 基本信息：名称、描述、时区、启用状态。
- 触发规则：cron 或间隔，保存前预览未来 5 次运行；非法表达式就地提示。
- 执行目标：任务模板、Agent、默认状态（Backlog 或 todo）、标签。
- 策略：重叠、错过运行、每日上限、最大并行、单次超时。
- 权限预览：Agent 的允许路径、允许命令、Runtime、模型、是否会请求高风险动作。
- 安全提示：自动化不会自动合并或部署；高风险动作仍需人工审批。
- 运行历史：触发时间、结果、跳过原因、关联 Task/Run、投递耗时。

编辑器应支持 dry-run（M4-AUTO-015，P1）。dry-run 只展示将创建什么，不写数据库、不启动 Runtime；如果模板字段缺失、模板版本失效或 Agent 不可用，dry-run 必须失败并说明原因。若 dry-run 在阶段评审中明确后置，保存前必须降级为静态权限预览：展示 Agent、允许路径、允许命令、默认状态、DAG 上游状态与是否会排队 Run，并要求用户显式确认；降级不得改变 M4-AUTO-003 的默认 Backlog 语义。

### 6.2 Webhook 配置

Webhook 页面默认只显示「未启用」状态。启用外部访问时，界面必须展示以下风险与配置：

- 端点 URL 与不可猜测的 ID；密钥只显示一次，之后仅显示掩码与「轮换」按钮。
- 签名算法、时间戳窗口（默认 ±300 秒）、请求体上限（默认 256 KiB）、示例请求与错误码表。
- 允许来源：仅本机（默认）、局域网（需要 TLS 反向代理或令牌）、自定义 IP 允许列表。
- 目标模板与 Agent 的引用状态；模板被归档、字段变更或 Agent 权限收紧时，端点显示「需要重新确认」并暂停新投递。
- 投递日志与失败原因；支持人工重放，但重放前必须确认「不会重复创建任务」。
- 连续失败熔断阈值与恢复方式。
- 明确说明：Webhook 只能创建 Task，默认进入 Backlog；端点显式 `todo` 时才排队 Run，且不得绕过 DAG、审批、合并、部署或删除。

### 6.3 通知中心

通知中心是 M2 Inbox 的延伸，不是独立聊天窗口。它按类型分组：待评审、待审批、Run 失败、依赖就绪、自动化异常、更新提醒、插件异常。每条通知包含来源、时间、任务标题、状态与深链。点击后进入对应 Task/Run/Review，通知本身不承载完整证据，只承载「去哪里看」。

偏好设置按事件类型与渠道呈现。审批与 prod 门禁通知不能被静默丢弃；用户可以关闭桌面弹窗，但应用内记录必须保留，直到被处理或明确标记已读。

### 6.4 更新流程

更新流程遵循「检查、展示、确认、下载、校验、安装、重启、健康检查、回滚」九步。界面必须诚实呈现每一步：

- 检查：手动检查立即反馈；自动检查在后台进行，不阻塞启动。
- 展示：版本、`packageSizeBytes`、发布日期、发布说明摘要、是否为安全更新及严重级别、最低系统版本与最低安全版本要求。
- 确认：安装前必须由用户点击确认；安全更新也不能静默安装。
- 下载：显示进度与可取消；下载失败可重试。
- 校验：签名或校验和失败时明确提示「更新包不可信」，保留当前版本。
- 安装与重启：提示会短暂退出应用；本地任务与 Run 状态在重启后恢复。
- 健康检查与回滚：新版本启动失败时自动回到上一版本，并提示用户提交诊断信息（可选）。

### 6.5 插件与遥测设置

插件设置页展示已安装插件、版本、来源、哈希、权限、状态与最近错误。安装时先展示权限差异与贡献点，用户确认后才落库。停用后立即撤销权限；卸载时询问是否删除插件数据。没有插件时显示「从本地文件安装」的空状态；插件 API 版本不兼容或宿主未启动时，禁用相关扩展点并说明原因。`approval.check` 插件故障默认阻断合并；只有配置了人工覆盖模式时，审批人才能填写理由并二次确认后继续，操作写入审计。

遥测设置页默认关闭。开启前展示采集清单与用途；开启后显示「最近发送」与「导出本地记录」；关闭后显示「已停止并清空队列」。不得使用预勾选、灰色小字或捆绑同意。没有发送记录时显示「尚未发送任何遥测」并给出事件清单入口，而不是空白页。

### 6.6 交互规则表

| 规则 | 要求 |
|---|---|
| 高风险动作显式化 | 合并、推送、部署、删除、权限变更必须确认并展示影响范围 |
| 自动化不隐藏 | 每个由自动化创建的 Task/Run 都显示来源与规则链接 |
| 失败可解释 | 所有失败给出错误码、人类可读原因与下一步 |
| 离线诚实 | 离线时明确显示无法检查更新/无法发送通知，不假装成功 |
| 不打断 | 后台更新检查、通知发送、遥测发送都不得阻塞主流程 |
| 可撤销 | 暂停 Schedule、停用 Webhook、停用插件、关闭遥测都必须立即生效 |
| 证据不被摘要替代 | 通知与列表只做索引，评审必须回到证据视图 |

## 7. 数据与 API 影响

### 7.1 新增实体

M4 需要新增以下领域对象。字段为实现建议，最终以数据模型文档与 API 契约为准；所有实体都必须有稳定 ID、UTC 时间戳与审计字段。

| 实体 | 关键字段 | 说明 |
|---|---|---|
| AutomationSchedule | id、name、cron、timezone、taskTemplateId、taskTemplateVersion、dagTemplateId、defaultStatus（backlog/todo）、agentId、enabled、overlapPolicy、missedRunPolicy、maxRunsPerDay、maxConcurrency、timeoutMinutes、nextRunAt、lastRunAt、blockedReason、createdAt、updatedAt | 定时规则；与任务模板版本、DAG 与 Agent 关联；`blockedReason` 记录悬空引用或权限失效 |
| AutomationTrigger | id、scheduleId、triggerType、dedupeKey、scheduledFor、firedAt、taskId、runId、status、errorCode | 每次触发的幂等记录 |
| WebhookEndpoint | id、name、secretRef、enabled、targetTemplateId、targetTemplateVersion、dagTemplateId、defaultStatus、agentId、allowedSources、failureCount、createdAt、lastUsedAt | 密钥只存引用，不存明文 |
| WebhookDelivery | id、endpointId、deliveryId、receivedAt、sourceHash、signatureStatus、status、taskId、errorCode、payloadBytes、dedupeKey | 投递与拒绝日志 |
| Notification | id、type、channel、taskId、runId、title、bodySummary、deepLink、readAt、createdAt | 通知中心记录 |
| NotificationPreference | id、eventType、channel、enabled、quietHours | 用户偏好 |
| Plugin | id、manifest、version、apiVersion、permissions、enabled、hash、publisher、installedAt、state | 插件元数据 |
| PluginGrant | id、pluginId、permission、scope、grantedAt、grantedBy | 权限授予记录 |
| TelemetryPreference | id、enabled、crashUploadEnabled、installId、updatedAt | 遥测同意状态 |
| UpdateState | id、currentVersion、channel、lastCheckAt、availableVersion、downloadStatus、rollbackStatus | 更新状态 |
| AppRelease | id、version、channel、sha256、signature、packageSizeBytes、securityUpdate、severity、minOSVersion、minUpgradableVersion、minSecurityVersion、rolloutPercent、notesUrl | 更新清单条目；`minVersion` 仅作为 `minUpgradableVersion` 的兼容别名 |

### 7.2 新增 API（里程碑级建议）

以下路径遵循 `prd/modules/api-and-data.md` 的契约：第一方管理端点使用 `/api/v1` 前缀，沿用该文档的错误模型、分页、幂等键与事件信封；入站 Webhook 按该文档 §5.12 使用 `/api/hooks/{hookId}`，同时保留 `/api/v1/hooks/{hookId}` 规范别名。M0 的 `/api` 旧路径作为永久兼容别名保留，只标记弃用、不删除。最终字段与错误码以 `api-and-data.md` 为准，不得在实现中各自发明。该文档 §9.3 已规划 `automation_schedules` / `webhooks` 表，§5.12 已列出 M4 端点骨架；M4 只补充其字段与验收口径，不另建平行契约。

`Run.trigger` 以 `prd/02-domain-model.md` 的六值为准；M4 产生 `schedule` 与 `webhook`，「立即运行」记录 `trigger=manual` 与 `source=manual`。`api-and-data.md` 的 M1 枚举已按同一六值回写（不含 `api`，M1 只产生 manual/retry，M2 增加 dependency/crew，M4 增加 schedule/webhook），M4 不新增第七个枚举值。

| 方法 | 路径 | 用途 | 备注 |
|---|---|---|---|
| GET/POST | `/api/v1/schedules` | 列出/创建 Schedule | 需要 `automation:write` |
| GET/PATCH/DELETE | `/api/v1/schedules/{id}` | 读取/更新/删除 | 删除保留历史触发记录 |
| POST | `/api/v1/schedules/{id}/run` | 立即运行 | 记录 `trigger=manual`、`source=manual`，不改变 nextRunAt |
| POST | `/api/v1/schedules/{id}/pause` | 暂停 | 立即生效 |
| GET | `/api/v1/schedules/{id}/triggers` | 触发历史 | 分页；含跳过、错过、去重原因 |
| GET/POST | `/api/v1/webhooks` | 列出/创建 Webhook | 创建时返回一次性密钥 |
| GET/PATCH/DELETE | `/api/v1/webhooks/{id}` | 读取/更新/删除 | 删除立即撤销 |
| POST | `/api/v1/webhooks/{id}/rotate` | 轮换密钥 | 有限重叠窗口 |
| GET | `/api/v1/webhooks/{id}/deliveries` | 投递日志 | 支持重放 |
| POST | `/api/hooks/{hookId}` | 入站 Webhook（`/api/v1/hooks/{hookId}` 为规范别名） | 签名校验，返回 202/4xx；未知字段严格拒绝 |
| GET | `/api/v1/notifications` | 通知列表 | 未读筛选；空状态可区分「已处理」与「暂无」 |
| PATCH | `/api/v1/notifications/{id}` | 标记已读 | 批量接口可另设 |
| GET/PATCH | `/api/v1/notification-preferences` | 通知偏好 | 按事件/渠道 |
| GET/POST | `/api/v1/plugins` | 列出/安装插件 | 安装需确认权限 |
| PATCH/DELETE | `/api/v1/plugins/{id}` | 启用/停用/卸载 | 停用立即撤权 |
| GET/POST/DELETE | `/api/v1/plugins/{id}/grants` | 读取/授予/撤销插件权限 | 与插件清单权限逐项对应 |
| GET/PATCH | `/api/v1/telemetry` | 遥测同意与状态 | 默认关闭 |
| POST | `/api/v1/telemetry/export` | 导出本地遥测记录 | 本地文件 |
| DELETE | `/api/v1/telemetry/local` | 删除本地遥测记录 | 二次确认 |
| GET | `/api/v1/updates/status` | 更新状态 | 不阻塞 |
| POST | `/api/v1/updates/check` | 手动检查 | 超时 3 秒 |
| POST | `/api/v1/updates/install` | 安装已下载更新 | 需用户确认 |
| GET | `/api/v1/updates/log` | 更新日志 | 可导出 |
| POST | `/api/v1/exports/tasks/{id}` | 导出任务与证据 | M4-EXP-001 |
| POST | `/api/v1/imports/tasks` | 导入任务与证据 | M4-EXP-002，写入审计 |

`/api/v1/exports/tasks/{id}` 与 `/api/v1/imports/tasks` 是本章为 M4-EXP-001/002 新增的端点，需要回填 `prd/modules/api-and-data.md` §5.12；在回填前不得视为已存在契约。

### 7.3 事件

新增 WebSocket 领域事件，命名延续 `aggregate.past_tense` 约定：

- `schedule.created`、`schedule.updated`、`schedule.deleted`、`schedule.paused`、`schedule.triggered`、`schedule.skipped`、`schedule.failed`
- `webhook.received`、`webhook.accepted`、`webhook.rejected`、`webhook.replayed`、`webhook.disabled`
- `notification.created`、`notification.read`
- `plugin.installed`、`plugin.enabled`、`plugin.disabled`、`plugin.error`
- `update.available`、`update.downloaded`、`update.installed`、`update.failed`
- `telemetry.consent.changed`

事件必须携带 `actor` 字段，区分 `human:{userId}`、`system:schedule:{id}`、`system:webhook:{id}`、`system:plugin:{id}`。自动化与插件不能伪装为人类操作者。

### 7.4 迁移与兼容

- 所有新增表通过 SQLite 迁移创建；M3 的 Postgres 部署需要同步迁移。
- M4 的数据库迁移必须在升级前自动备份；迁移失败恢复旧版本与旧备份。
- API 新增遵循增量原则；破坏性变更需要版本化与发布说明。
- 更新清单的新字段（`packageSizeBytes`、`securityUpdate`、`severity`、`minOSVersion`、`minSecurityVersion`、`minUpgradableVersion`）按加字段方式引入；旧客户端遇到缺失字段必须降级为「未知」而不是崩溃或误判为安全更新。
- 插件 API 独立版本化；核心 API 版本不与插件 API 版本绑定。
- 旧版本客户端不得因新事件类型崩溃；事件消费者必须忽略未知类型。
- 自动化创建的 Task/Run 在数据导出中保留 `automationId`、`trigger`、`dedupeKey` 与来源字段，便于迁移与审计。

## 8. 异常与边界

### 8.1 失败与边界场景

M4 的异常处理必须遵循「失败关闭、可解释、可恢复、不丢数据」四项原则。以下场景必须有明确行为与测试。

| 场景 | 期望行为 | 证据 |
|---|---|---|
| 应用在 Schedule 触发时关闭 | 按错过策略处理；默认跳过并记录；不补跑全部历史 | 启动日志、触发历史 |
| 上一次 Run 仍未结束 | 默认跳过并通知；排队策略需显式开启；不得无限堆积 | 触发历史、通知 |
| 系统时钟回拨或时区变更 | 重新计算 nextRunAt；不重复触发；记录审计 | 审计记录 |
| 夏令时导致时间不存在或重复 | 不存在的时间顺延；重复的时间只运行一次 | DST 测试报告 |
| Webhook 签名错误 | 返回 401，不创建 Task，不泄露内部细节 | 投递日志 |
| Webhook 重放 | 返回 409，不创建重复 Task | 投递日志、数据库 |
| Webhook 请求体过大 | 返回 413，拒绝解析 | 投递日志 |
| Webhook 速率超限 | 返回 429，保留重试建议；连续失败熔断 | 投递日志、告警 |
| Webhook 密钥轮换后旧密钥仍被使用 | 宽限期内接受并标记轮换中；宽限期后拒绝 | 审计记录 |
| 通知渠道不可用 | 不影响 Run；记录失败；指数退避重试 | 通知日志 |
| 桌面通知权限被拒绝 | 回退应用内；显示修复指引 | 设置页状态 |
| 更新清单签名无效 | 拒绝下载与安装；保留当前版本；记录安全事件 | 更新日志 |
| 更新下载中断或磁盘满 | 保留当前版本；清理临时文件；可重试 | 更新日志 |
| 新版本启动失败 | 自动回滚到上一版本；数据库保持可用 | 回滚日志 |
| 数据库迁移失败 | 恢复备份与旧版本；拒绝启动新版本 | 迁移日志 |
| 插件崩溃或死循环 | 隔离进程被终止；主程序不受影响；熔断并提示 | 插件日志 |
| 插件请求未授权文件或网络 | 拒绝并审计；不返回文件内容 | 插件审计 |
| 遥测端点不可用 | 本地队列有限重试；不影响功能；用户可删除队列 | 遥测日志 |
| 多个应用实例同时运行 | 单实例锁；重复启动聚焦已有窗口；调度器只允许一个 leader | 启动测试 |
| 磁盘空间不足 | 暂停非关键写入；提示清理；不损坏数据库 | 故障注入 |
| 用户删除正在被 Schedule 引用的 Agent | 阻止删除或提示先停用 Schedule；不得留下悬空引用 | 引用完整性测试 |
| Schedule/Webhook 引用的任务模板被删除或归档 | 阻止删除并列出依赖规则，或要求先停用全部依赖；不得级联删除规则；规则进入 `blocked` 并通知 | 引用完整性测试、通知 |
| 模板字段被修改或模板升级 | 既有规则继续使用创建时的 `taskTemplateVersionSnapshot`；影响必填字段时规则进入 `needs_review`，用户确认后才使用新版本 | 模板版本测试 |
| Agent 的 `allowedPaths`/`allowedCommands` 被收紧 | 新权限只影响下一次 Run；现有 Schedule/Webhook 在下次触发前要求重新确认；规则权限超出新边界时跳过并通知 | 权限变更测试、审计 |
| 自动化任务属于未验收的上游 DAG | 任务保持 `blocked`，不得进入 `todo` 或启动 Run；上游验收后发出依赖就绪通知 | DAG 测试、通知 |
| Agent 输出「无新增」 | Run 以 `completed` 结束并记录 `status/subtype=no_changes` 事件，生成 no-op 证据，不产生空 diff/commit，不进入合并流程 | Run 证据、通知 |
| 插件审批检查故障 | 默认失败关闭，合并被阻断；显式人工覆盖模式需理由、二次确认与审计 | 审批门测试、审计 |

### 8.2 空状态验收

M4 的每个列表与设置页都必须定义空状态、加载状态与不可用状态，不能只显示空白或「暂无数据」。空状态遵循 `ui-ux.md` 的 UI-078（区分「已清空」与「暂无事项」）与 UI-080（标题、解释、一个主入口）。

| 界面 | 空状态要求 | 不可用/失败状态 | 证据 |
|---|---|---|---|
| 自动化列表（无 Schedule） | 说明「还没有定时规则」；主入口「创建第一个 Schedule」；提供示例规则说明 | 调度器未启动时显示状态与重试入口，不显示假规则 | 截图与交互测试 |
| 触发历史（无记录） | 区分「尚未触发」与「筛选无结果」；提供清除筛选入口 | 历史读取失败时内联重试，不阻塞规则编辑 | 截图与错误注入 |
| Webhook 列表（无端点） | 说明默认仅本机、需要显式启用；主入口「创建 Webhook」 | 密钥存储不可用时禁止创建并说明原因 | 截图与钥匙串故障测试 |
| 投递日志（无投递） | 区分「尚无外部请求」与「筛选无结果」；展示示例请求入口 | 日志损坏时显示可恢复提示 | 截图与日志注入 |
| 通知中心（无通知） | 区分「已全部处理」与「还没有任何通知」；提供创建任务或规则的入口 | 桌面通知被拒绝、出站未配置时显示状态与修复入口 | 截图与权限拒绝测试 |
| 插件列表（无插件） | 主入口「从本地文件安装」；说明插件默认无网络、无任意文件 | API 版本不兼容、宿主未启动时禁用扩展点并说明 | 截图与版本冲突测试 |
| 更新历史（无记录） | 说明「尚未检查或安装更新」；提供手动检查入口 | 离线、清单不可达、签名失败分别显示可读原因与重试入口 | 截图与网络故障测试 |
| 遥测记录（无发送） | 说明「尚未发送任何遥测」；提供事件清单与隐私说明入口 | 端点不可用时说明本地队列状态，不显示虚假成功 | 截图与抓包 |

### 8.3 引用完整性规则

1. **模板删除/归档**：任何被 Schedule 或 Webhook 引用的任务模板不得直接删除；系统必须列出依赖规则，要求先停用或改绑。归档视为不可用于新触发，规则进入 `blocked`。
2. **模板版本固定**：规则创建时记录 `taskTemplateVersionSnapshot`；模板升级不自动改变既有规则。模板字段变更影响必填字段或交付物契约时，规则进入 `needs_review`，用户确认后才能继续。
3. **Agent 删除**：被启用规则引用的 Agent 不得删除；必须停用或改绑。历史 Task/Run 保留原 Agent 快照，不因删除而失去可追溯性。
4. **Agent 权限收紧**：`allowedPaths`/`allowedCommands` 缩小只影响下一次 Run；规则在下次触发前要求重新确认。若规则配置的动作超出新权限，跳过本次触发并通知，不得静默放宽权限。
5. **密钥撤销**：Webhook 密钥撤销后立即拒绝新请求；轮换宽限期内旧密钥可用但标记 `rotating`，宽限期结束后拒绝。
6. **规则停用与恢复**：停用立即生效；恢复时必须重新校验模板、Agent、DAG 上游与权限，任一失效则保持 `blocked` 并说明原因。

## 9. 权限与安全

### 9.1 横切安全约束

M4 所有能力必须遵守以下底线，任何一条不满足都不得发布：

1. 合并、推送、部署、删除仍然需要人工审批；自动化与插件不能批准、不能代批、不能降低证据要求（PROD-009）。
2. 角色 Agent 的协作仍通过任务 DAG、交付物契约、审批门与证据化 DoD 完成，不因自动化而退化为自由聊天或自动执行链（PROD-010）。
3. 默认不上传代码、任务内容、提示词、diff、日志正文与文件路径；任何外发必须显式配置并说明用途（PROD-013）。
4. 本地优先：Webhook 默认只监听回环；插件默认无网络、无任意文件；遥测默认关闭。
5. 签名与更新必须可验证；校验失败必须拒绝安装并保留当前版本（SEC-065、NFR-SEC-010）。
6. 审计必须记录操作者、时间、动作、对象、结果与来源；自动化与插件使用独立 actor 标识。

### 9.2 自动化安全

- Schedule 与 Webhook 的创建、修改、删除、启停都属于受控操作：本地模式记录本机操作者；团队模式要求 `automation:write` 并写审计。
- 自动化只能使用创建者有权使用的 Agent 与模板；团队共享 Agent 的权限不能被自动化绕过。
- 自动化创建的任务必须绑定合法模板与 DAG；上游未验收时不得进入 `todo` 或启动 Run；「立即运行」不得绕过上游验收、交付物契约与审批门。
- Webhook 密钥进入 OS 钥匙串或加密本地存储；日志、导出、错误信息与通知中不得出现密钥。
- Webhook 的签名校验必须在解析业务字段之前完成；未通过签名不得读取 payload。
- 请求体字段只作为数据使用，不得拼接为 shell 命令、文件路径或提示词指令；模板变量必须白名单化。
- 自动化触发的 Run 记录 `trigger`、`automationId`、`dedupeKey`、`scheduledFor` 与 `actor`，便于审计与去重。
- 自动化不能调用 `approve`、`merge`、`push`、`deploy`、`delete` 等高风险接口；即使 payload 中包含这些意图，也只能作为任务描述，不能作为动作执行。
- 自动化失败必须通知；连续失败达到阈值时暂停规则，避免消耗资源与制造噪音。

### 9.3 分发与更新安全

- macOS：Developer ID 签名、Hardened Runtime、公证与 staple；签名密钥由发布负责人保管，不进仓库。
- Windows：Authenticode 签名与时间戳；证书类型与 SmartScreen 信誉策略在第 12 节决策。
- Linux：SHA-256 校验和；可选 GPG；不承诺所有发行版原生包。
- 更新清单与安装包均签名；客户端先验签再下载，下载后再校验哈希；任一失败拒绝安装。
- 公开分发必须签名；未签名构建只能用于内部测试，界面显示「未签名开发版本」，禁用自动更新，且不得对外分发。签名能力不可用时，M4 发布阻断，不以「标注 unsigned」替代签名门禁。
- 更新密钥支持轮换与吊销；密钥泄露时可以停止分发、发布吊销公告与强制最低版本提示。
- 发布构建在隔离环境执行；构建日志、SBOM、校验和与签名记录保留，便于追溯。
- 安装包不得包含第三方产品的图标、文案、截图或品牌资产；许可证与 NOTICE 完整。

### 9.4 插件与遥测安全

- 插件必须声明权限，默认拒绝；安装时展示权限差异；运行时再次校验。
- 插件运行在独立进程或等效隔离边界；设置 CPU、内存、执行时间与消息大小上限。
- 插件不能读取 Runtime 凭据、模型密钥、环境变量中的密钥或审计原文。
- 插件不能修改核心状态、审批、审计与权限；`approval.check` 只能增加检查，不能批准。
- 插件故障按失败关闭处理：审批前检查插件不可用时，合并默认被阻断；只有显式配置人工覆盖模式时，审批人才能填写理由、二次确认后继续，覆盖本身写入审计。插件不能自行切换该模式。
- 插件宿主不是 Agent Runtime；插件不能注册或替代 Claude Code、Codex 或 mock 执行 Run。
- 遥测默认关闭；同意前无请求；关闭时立即停止并清空队列；字段最小化；本地可查看、导出、删除。
- 崩溃日志默认本地；上传需要单独同意，上传前脱敏路径、用户名与可能的代码片段。

## 10. 交付物

| 工作流 | 交付物 | 验收证据 |
|---|---|---|
| 定时自动化 | Schedule 数据模型、调度器、编辑器、运行历史、dry-run、审计事件 | 定时端到端测试、重启持久化测试、DST/错过/重叠测试 |
| Webhook | 端点管理、签名校验、重放保护、去重、投递日志、密钥轮换、速率限制与熔断 | 正确/错误签名、重放、超大请求、速率限制、密钥轮换测试 |
| 通知 | 应用内通知中心、桌面通知、出站 Webhook、偏好设置、去重聚合、重试、空状态与权限状态 | 事件覆盖矩阵、内容脱敏检查、渠道故障注入、空状态截图 |
| 打包 | DMG、NSIS、AppImage、tar.gz、嵌入 Web 资源、版本注入、图标、LICENSE/NOTICE、三平台独立验收记录 | 干净机器安装录像、`spctl`/签名验证、SBOM、校验和、三份平台记录 |
| 自动更新 | stable/beta 通道、签名清单、下载校验、原子替换、回滚、数据库备份、拒绝降级、失败/篡改包拒绝 | 升级/回滚/断网/磁盘满/签名无效演练 |
| 插件 API | 插件宿主、清单、权限、隔离、事件订阅、UI/通知渠道/证据渲染扩展点、示例插件、API 文档 | 越权测试、崩溃隔离、停用撤权、示例运行、扩展点审查 |
| 遥测 | 同意页、偏好设置、本地事件记录、导出/删除、崩溃日志脱敏、端点与隐私文档 | 默认无上报抓包、字段审查、关闭生效、导出删除测试 |
| 文档 | 安装/升级/卸载、Runtime 配置、权限、自动化、插件、隐私、管理员指南、排障、发布说明、安全披露 | 文档评审记录、新用户可用性测试、管理员场景测试、双语检查 |
| 导入导出 | 任务与证据的便携格式、敏感信息检查、导入审计与版本校验 | 导出导入往返测试、敏感信息命中测试、版本不兼容测试 |
| 发布工程 | CI 三平台矩阵、签名与公证流水线、发布检查单、回滚预案、发布说明 | 发布门禁记录、风险评审纪要、go/no-go 决策记录 |

## 11. 演示脚本：定时 Bug 分诊 + 安装包

### 11.1 演示目标与前置

演示分两层：**15 分钟 macOS 主脚本**与**三平台独立安装冒烟记录**。主脚本证明安装包可用、自动定时触发可用、Webhook 自动化可用、人工评审与审批门未被削弱；它只证明 macOS DMG，不证明 NSIS 或 AppImage。Windows 与 Linux 的安装、WebView2/WebKitGTK 检测、签名与校验和按 11.4 单独验收并归档。任一平台记录缺失，M4 退出标准不通过。

前置条件：

- 一台干净的 macOS 14+ 机器（Tier 1），未安装 Go、Node、pnpm 或 Wails CLI。
- 一台干净的 Windows 11 虚拟机与一台干净的 Ubuntu LTS 虚拟机，用于 11.4 的独立冒烟；不与 macOS 主脚本混剪。
- 一个专用测试仓库，包含 `bugs/` 目录、一个可复现的失败测试与一个 `README`；不得使用真实用户仓库。
- 一个 Triage Agent：Runtime 使用 M1 已定义的**假 Claude CLI 夹具**（`prd/milestones/M1-local-loop.md` 的测试与演示资产）或真实 Claude Code 适配器。夹具必须确定性修改一个文件、产生可审查 diff 与测试输出。**mock 仅用于安装与首启冒烟；mock 证据不能触发完成或合并（`M1-local-loop.md` 的 UI-009、EVIDENCE-005）**，演示记录必须逐 Run 标注 `runtime=mock` 或 `runtime=fake-claude`。
- 一个「越权夹具」：假 CLI 在 Run 中尝试读取 `bugs/` 之外的路径（例如 `.ssh`）并执行未允许命令（例如 `curl`）。该夹具必须通过受控工具调用或真实适配器实际发起路径/命令请求；仅打印「已拒绝」文案的模拟不算通过。该 Run 预期失败并留下 `PERMISSION_DENIED` 证据，用于验证 M2 的路径与命令权限在自动化下仍然生效。
- 一个 1 分钟间隔的 Schedule，或可注入时钟的 Schedule；演示前把下一次运行设为 1 分钟后，或使用可注入时钟推进，用于在 15 分钟内展示自动触发、`nextRunAt`、`dedupeKey` 与至少一个重叠/错过场景。不得只用「立即运行」证明定时器。
- 一个本地更新服务，提供：签名版本 N+1 的清单与安装包；一个故意启动失败的 N+2 包；一个签名被篡改的包。三者都附预期错误码与回滚日志。
- 一个测试插件，声明 `tasks.read` 与 `events.subscribe`，并尝试越权读取文件用于验证拒绝。
- 抓包工具与录屏工具；所有证据归档到演示记录，证据清单见 11.3。

### 11.2 脚本步骤（macOS 主脚本，15 分钟）

| 时间 | 步骤 | 操作 | 预期结果 |
|---|---|---|---|
| 0-2 分钟 | 安装与首启 | 从 DMG 安装并启动；打开关于页；运行一次 mock Run 仅验证安装 | 应用启动，版本与安装包一致；mock Run 带显著 mock 标识；演示记录标注该 Run 不可用于完成或合并 |
| 2-4 分钟 | 配置自动规则 | 创建 1 分钟间隔的 Bug 分诊 Schedule，显式选择 `todo`，绑定模板、Triage Agent 与假 Claude CLI；查看预览 | 保存成功；显示下一次运行时间；权限预览显示只读范围；规则状态为启用 |
| 4-5 分钟 | **等待自动触发** | 不点击「立即运行」，等待下一次计划时间到达 | 自动创建 Task，`trigger=schedule`、`dedupeKey` 与 `nextRunAt` 正确；Run 开始执行；不得只有手动触发记录 |
| 5-6 分钟 | 重叠与立即运行 | 第一个 Run 仍在运行时等待下一次计划时间；随后在第一个 Run 完成后点击「立即运行」 | 重叠触发产生 `schedule.skipped` 与原因；同一计划时刻重复触发不产生重复 Task；「立即运行」创建 Task+Run，记录 `trigger=manual`、`source=manual`，`nextRunAt` 不变 |
| 6-7 分钟 | 错过运行 | 在下一个计划时间前暂停应用或暂停规则，超过计划时间后恢复 | 默认按错过策略跳过并记录；不补跑全部历史；恢复后 `nextRunAt` 从当前时间重算 |
| 7-8 分钟 | 权限越界实测 | 用越权夹具触发一次 Run（可经第二个 Schedule 或显式手动运行）；若夹具无法实际发起系统调用，改用真实 Claude Code 适配器并配置只读 Agent | 越权路径读取与未允许命令被拒绝；Run 失败并留下 `PERMISSION_DENIED` 证据；主程序与调度器不受影响 |
| 8-9 分钟 | 配置 Webhook | 创建 Webhook，显示一次性密钥；发送正确签名请求、错误签名请求、重复 delivery ID 请求与超大请求体 | 正确请求 202；错误签名 401；重放 409；超大 413；Backlog 只出现一个 Task；默认不启动 Run |
| 9-11 分钟 | 通知与评审 | 查看通知中心与桌面通知；从通知进入评审；查看 diff、测试结果与摘要；批准合并 | 通知不含代码/路径；评审可见 diff 与测试证据；mock 证据不能触发完成或合并；合并产生人工审批与审计记录 |
| 11-13 分钟 | 自动更新 | 使用本地签名清单升级到 N+1；重启后检查任务数据；再演示 N+2 启动失败回滚与篡改包拒绝 | 版本变化；数据保留；N+2 回滚可用；篡改包返回签名错误码并保留当前版本；更新提示展示体积与安全更新标记 |
| 13-15 分钟 | 插件与遥测 | 安装测试插件，验证越权读取被拒绝；停用插件；确认遥测默认关闭并抓包 | 越权失败并有审计；停用后事件停止；无遥测上报；插件列表无空白状态 |

演示中的签名请求示例（路径与头部遵循 `prd/modules/api-and-data.md` 的 `/api/v1` 约定，最终以该契约为准）：

```bash
BODY='{"title":"修复登录跳转","source":"issue-123","priority":"high"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$ATEAM_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -sS -X POST "http://127.0.0.1:8787/api/hooks/$HOOK_ID" \
  -H "Content-Type: application/json" \
  -H "X-ATeam-Timestamp: $TS" \
  -H "X-ATeam-Delivery: demo-delivery-001" \
  -H "X-ATeam-Signature: sha256=$SIG" \
  --data "$BODY"
```

### 11.3 失败判定与证据

出现以下任一情况，演示判定失败：

- 安装或启动需要 Go、Node、pnpm 或 Wails CLI。
- 安装包未签名、公证失败，或系统安全提示无法解释。
- 用 mock Run 触发完成或合并；或演示记录未区分 mock 与真实证据。
- 只通过「立即运行」展示自动化，没有自动定时触发、`nextRunAt`、`dedupeKey` 或重叠/错过场景。
- 定时或 Webhook 创建了重复 Task，或绕过审批直接合并。
- 自动化创建的任务在上游未验收时进入 `todo` 或启动 Run。
- 越权路径或命令没有被拒绝，或拒绝后没有证据。
- 通知包含代码、提示词、diff、路径或密钥。
- 升级后任务、Agent、Run 或证据丢失；回滚不可用；篡改包被接受。
- 插件读取了未授权文件、访问了网络或调用了高风险接口。
- 关闭遥测后仍有网络上报。
- 任何自动化身份成功批准、合并、推送或部署。
- Windows 或 Linux 的平台验收记录缺失，或用 macOS 录屏替代。

演示证据包括：安装与首启录屏、版本截图、Schedule 与 Webhook 配置截图、自动触发与重叠/错过事件日志、权限拒绝证据、请求响应日志、Run 事件流、diff 与测试输出、通知截图、评审与审批记录、更新与回滚日志、篡改包拒绝日志、抓包文件、插件审计日志、三平台验收记录。证据随发布说明归档，供后续里程碑与审计复用。

### 11.4 三平台独立验收记录

| 平台 | 必做步骤 | 通过标准 | 证据 |
|---|---|---|---|
| macOS（DMG） | 干净机器安装、首启、Mock Run、升级 N+1、N+2 回滚、篡改包拒绝 | `spctl` 放行；公证票据可验证；数据保留；回滚成功 | 录屏、`spctl`/`codesign` 输出、更新日志 |
| Windows（NSIS） | 干净 Windows 11 安装、WebView2 缺失场景、启动、Mock Run、升级与卸载 | Authenticode 与时间戳验证通过；WebView2 缺失有可操作指引；卸载保留数据 | 安装录屏、签名验证输出、WebView2 检测截图 |
| Linux（AppImage + tar.gz） | 干净 Ubuntu LTS 启动、WebKitGTK 缺失场景、校验和验证、卸载 | AppImage 可执行；WebKitGTK 缺失有明确提示；SHA-256 匹配；tar.gz 可解压运行 | 启动录屏、`sha256sum` 输出、依赖提示截图 |

三份记录必须由不同平台环境分别产生，不能相互替代；每份记录都要包含产物文件名、哈希、构建提交号与验证时间。

## 12. 关键决策

| 编号 | 决策 | 选项 | 建议 | 理由 | 最晚决策点 |
|---|---|---|---|---|---|
| D-M4-01 | 打包工具 | Wails v3 官方打包；平台原生脚本；引入其他桌面框架 | 以 Wails v3 官方构建为主，macOS 使用 `hdiutil`/`codesign`/公证工具，Windows 使用 NSIS，Linux 使用 AppImage 工具链；不引入其他桌面壳框架 | 保持现有技术栈与单二进制优势；避免重写桌面壳 | M4.0 结束前 |
| D-M4-02 | macOS 签名与公证 | 仅签名；签名 + 公证；仅自签名 | Developer ID 签名 + Hardened Runtime + 公证 + staple | Gatekeeper 默认拦截未公证应用；公证是分发前提 | M4.0 结束前 |
| D-M4-03 | Windows 签名 | 不签名；OV 证书；EV 证书 | Authenticode 签名并加时间戳；证书类型按成本与 SmartScreen 需求选择 | 未签名安装包会被 SmartScreen 拦截；EV 信誉建立更快但成本更高 | M4.0 结束前 |
| D-M4-04 | Linux 分发格式 | 仅 AppImage；AppImage + tar.gz；deb/rpm/Flatpak | AppImage + tar.gz + SHA-256，可选 GPG；其他格式后置 | 覆盖主流桌面且维护成本可控；发行版原生包差异大 | M4.1 结束前 |
| D-M4-05 | 更新传输与签名 | 自托管静态清单；对象存储/CDN；应用内直连代码托管平台 | 自托管 HTTPS 静态清单 + 对象存储/CDN；清单与包均签名 | 不依赖单一平台；可灰度、可吊销、可离线镜像 | M4.3 启动前 |
| D-M4-06 | 自动检查默认值 | 默认开启；默认关闭；首次启动询问 | 默认关闭，手动检查可用；设置中可开启；安装始终需确认 | 符合本地优先与最小网络请求；避免未经同意的外发 | M4.1 结束前 |
| D-M4-07 | 调度语义 | 外部 cron；进程内持久化调度；系统计划任务 | 进程内持久化调度，数据库保存规则，单实例 leader；5 段 cron + IANA 时区 | 不引入外部依赖；跨平台一致；可审计 | M4.2 启动前 |
| D-M4-08 | Webhook 边界 | 默认公网；默认局域网；默认仅本机 | 默认仅本机；局域网需 TLS 反向代理或令牌 + IP 允许列表；HMAC + 时间戳 + 去重 | 减少攻击面；满足本地优先；仍支持外部集成 | M4.2 启动前 |
| D-M4-09 | 插件隔离模型 | 进程内 Go 插件；独立进程；WASM | 独立进程 + JSON-RPC/stdio 或本地 socket；清单权限；默认无网络/文件；本地安装 | 语言无关、崩溃隔离、权限可控；避免 Go 插件 ABI 脆弱性 | M4.3 启动前 |
| D-M4-10 | 遥测隐私 | 默认开启；默认关闭；仅崩溃 | 默认关闭；匿名聚合计数、错误类型、耗时区间；本地可查看/导出/删除；端点公开 | 信任是本地优先的核心资产；隐私争议会直接伤害采用 | M4.4 启动前 |
| D-M4-11 | 通知渠道 | 仅应用内；应用内 + 桌面；加 IM/邮件 | 应用内 + 桌面 + 出站 Webhook；不做邮件、短信、IM | 覆盖个人与团队的基本闭环；避免范围膨胀 | M4.2 启动前 |
| D-M4-12 | 文档形态 | 仅仓库 Markdown；仓库 + 网站；应用内离线文档 | 仓库为源，发布时生成版本化文档；关于页提供离线入口；关键文档中英双语 | 文档与版本同步；离线可用；降低支持成本 | M4.1 启动前 |
| D-M4-13 | 自动化触发语义 | 直接创建 Run；只创建 Task；Task-first + 显式 todo 排队 Run | 默认创建 Task 并进入 Backlog；规则显式 `todo` 且上游验收后才排队 Run；「立即运行」为显式手动例外，创建 Task+Run，记录 `trigger=manual`、`source=manual` | 保持人工在回路；与 M2 DAG/交付物契约一致；避免自动化绕过评审 | M4.2 启动前 |
| D-M4-14 | 通知默认值（关闭 Q-M4-09） | 全部默认开启；全部默认关闭；分级默认 | 应用内默认开启、桌面默认开启、出站默认关闭；安静时段默认关闭；审批、prod 门禁与升级提醒不可静默丢弃 | 兼顾及时性与通知疲劳；审批不可被噪音淹没 | M4.2 启动前 |
| D-M4-15 | 遥测事件清单与组织禁用（关闭 Q-M4-06） | 自定义清单；以 M4-TEL-003 为准；不做遥测 | 事件清单以 M4-TEL-003 的字段白名单为准；默认保留 90 天；组织策略可禁用且成员不能覆盖；不对未列字段做「顺便采集」 | 字段最小化；可审计；避免清单漂移 | M4.4 启动前 |
| D-M4-16 | 更新检查默认与灰度策略（关闭 Q-M4-11） | 默认开启；默认关闭；首次启动询问 | 自动检查默认关闭，手动检查始终可用；灰度比例与最低安全版本由清单字段控制；强制更新仍由用户执行 | 本地优先与最小网络请求；避免未经同意的外发 | M4.1 结束前 |
| D-M4-17 | 插件签名（关闭 Q-M4-18） | 强制签名；可选签名；不签名 | M4 采用可选签名；展示来源、哈希与权限差异；未签名插件需额外确认；不自动信任 | 降低本地插件开发门槛，同时保留供应链可见性 | M4.3 启动前 |
| D-M4-18 | Crew/队长自动编排 | 纳入 M4；后置；不做 | M4 不交付 Crew/队长自动编排；依赖触发只处理任务 DAG 的就绪任务；Crew 自动化在 Crew 模式稳定后另行评审 | 控制 M4 复杂度；避免自动化层与 Crew 协作层同时引入 | M4 范围冻结前 |
| D-M4-19 | 未签名构建的发布门禁 | 允许对外发布 unsigned；仅内部测试；完全不产出 | 公开分发必须签名；未签名构建仅内部测试，界面标注「未签名开发版本」，禁用自动更新，不得对外分发 | 供应链信任不可妥协；避免「标注风险」被当作发布捷径 | M4.0 结束前 |
| D-M4-20 | 双语范围（关闭 Q-M4-20） | 应用 UI 全量双语；仅安装器/法律文本双语；全部英文 | 安装器、LICENSE/NOTICE、更新说明、安全披露与关键用户文档双语；M4 应用 UI 保持英文，关于页跟随 UI 语言；完整 i18n 后置 | 与当前代码语言一致；避免 UI 全量翻译拖垮 M4 | M4.1 启动前 |
| D-M4-21 | 任务与证据导入导出编号 | 等待模块分配；由本章定义里程碑编号；不做 | 本章以 M4-EXP-001、M4-EXP-002 验收；模块文档落地时回填正式编号 | 避免验收悬空；不阻塞里程碑 | M4.2 启动前 |
| D-M4-22 | 插件审批检查失败语义（关闭 Q-M4-05） | 默认放行；默认失败关闭；仅人工覆盖 | 默认失败关闭并阻断合并；只有显式配置 `approval.check.onFailure=manual_override` 时，审批人才能填写理由、二次确认后覆盖，覆盖写入审计；两种模式均有测试与错误码 | 安全默认值优先；覆盖必须可追溯 | M4.3 启动前 |

## 13. 依赖

### 13.1 内部依赖

| 依赖 | 为什么需要 | 缺失后果 | 最晚满足点 |
|---|---|---|---|
| M1 的 worktree、diff、Artifact/Evidence、人工合并 | 自动化产生的 Run 必须可隔离、可评审、可合并 | 自动化只会制造不可评审的改动 | M4 启动前 |
| M2 的任务 DAG、交付物契约、角色模板、审批门、证据化 DoD、收件箱 | 自动化与插件必须复用同一套治理 | 出现绕过审批的旁路 | M4.2 前 |
| M3 的登录、权限、远程 Runner、审计 | 团队 Schedule、Webhook、插件需要身份与审计 | 无法回答谁触发了什么 | M4 正式发布前 |
| API 契约与共享类型 | 新增端点、事件与前端类型需要统一 | 前后端各自发明字段 | M4.1 前 |
| UI 设计：自动化编辑器、通知中心、更新提示、插件与遥测设置 | 交互复杂，不能边写边设计 | 返工与可用性缺陷 | M4.2 前 |
| CI 三平台构建矩阵 | 安装包必须在目标平台构建与签名 | 无法产出可信产物 | M4.0 前 |
| 文档与发布流程 | 安装、升级、隐私、排障必须有用户文档 | 支持成本高，用户无法自助 | M4.4 前 |

### 13.2 外部依赖

| 依赖 | 用途 | 风险 | 应对 |
|---|---|---|---|
| Wails v3 的构建与打包能力 | 生成桌面应用与安装包 | API 演进、平台差异 | 锁定版本、封装薄壳、M4.0 做 spike、保留原生脚本兜底 |
| macOS 开发者账号与公证服务 | 签名、公证、staple | 账号审批与网络延迟 | 提前申请；CI 预演；保留手动发布路径 |
| Windows 代码签名证书 | Authenticode 签名 | 证书成本、签发周期、SmartScreen 信誉 | 提前采购；时间戳；发布说明解释首次安装提示 |
| Linux AppImage 工具链与 WebKitGTK | Linux 打包与运行 | 发行版差异、依赖缺失 | 限定 Tier 1 版本；启动检测；提供 tar.gz 兜底 |
| OS 桌面通知 API | 桌面通知 | 权限拒绝、平台差异 | 回退应用内；设置页显示权限状态 |
| HTTPS 静态托管与 CDN | 更新清单与安装包分发 | 可用性、成本、区域访问 | 多区域镜像；离线手动下载；签名校验不依赖传输安全 |
| 时区数据库 | cron 时区与 DST | 规则变更 | 随版本更新；测试覆盖常见时区 |
| 加密库 | HMAC、签名校验、密钥存储 | 实现错误 | 使用成熟库；测试向量；安全评审 |
| 许可证与法务审查 | SBOM、NOTICE、分发合规 | 许可证冲突 | 依赖允许列表；发布前审查；生成 NOTICE |
| 测试设备与虚拟机 | 干净机器安装、跨平台冒烟 | 环境不一致 | 固定镜像版本；自动化快照；记录环境元数据 |

### 13.3 依赖风险与应对

- **Wails v3 打包能力不足**：M4.0 必须先做 spike。如果官方打包无法满足签名、公证或安装器需求，改用平台原生脚本，但不更换桌面框架。
- **签名账号审批延迟**：签名是公开分发的阻断项，不是最后一步。M4.0 就要完成账号、证书与 CI 密钥配置；若延迟，M4.1 只能产出未签名内部测试包，界面标注「未签名开发版本」，禁用自动更新，**不得对外分发**。`prd/01-scope-and-roadmap.md` §4.6.3 #2 的「标注 unsigned 并说明风险」只适用于内部测试，不适用于公开分发；该处措辞按 5.9.1 的对账项同步收紧。
- **CI 平台能力差异**：macOS 公证、Windows 签名、Linux AppImage 都需要原生 runner；不能只用 Linux 交叉编译。提前确认 runner 配额与成本。
- **更新服务可用性**：更新检查失败不能影响启动；下载失败保留当前版本；离线用户可手动下载。更新服务不是产品可用性的单点。
- **文档滞后**：文档必须与功能同一批次评审；发布检查单中设置「文档未完成即阻断发布」。

## 14. 风险

| 编号 | 风险 | 影响 | 可能性 | 缓解措施 | 预警信号 |
|---|---|---|---|---|---|
| R-M4-01 | 打包与签名延期 | M4 无法按期发布 | 中 | M4.0 提前 spike；账号提前申请；原生脚本兜底；保留内部测试包 | 距发布两周仍无签名产物 |
| R-M4-02 | 自动更新供应链被篡改 | 大规模安全事件 | 低-高 | 清单与包双签名；HTTPS；校验和；密钥轮换与吊销；灰度 | 出现未知签名或异常下载量 |
| R-M4-03 | 升级导致数据丢失或迁移失败 | 用户信任崩塌 | 中 | 升级前备份；迁移事务；失败回滚；降级拒绝；跨版本矩阵 | 迁移失败率上升；用户报告数据缺失 |
| R-M4-04 | 自动化失控与成本失控 | 资源耗尽、账单上升、任务风暴 | 中 | 每日上限、并发上限、超时、去重、熔断、预算提示；默认跳过重叠 | 单日触发次数异常；队列持续满 |
| R-M4-05 | Webhook 被伪造、重放或滥用 | 未授权任务、数据污染 | 中 | HMAC、时间戳、delivery ID 去重、速率限制、失败熔断、默认仅本机 | 401/409/429 激增；异常来源 |
| R-M4-06 | 通知疲劳 | 用户关闭全部通知，错过审批 | 高 | 去重聚合、按事件开关、安静时段、审批不可静默丢弃 | 通知关闭率高；审批等待变长 |
| R-M4-07 | 插件沙箱逃逸或越权 | 文件泄露、权限提升 | 中 | 独立进程、默认拒绝、权限清单、密钥隔离、失败关闭、审计 | 插件越权告警；异常文件访问 |
| R-M4-08 | 遥测隐私争议 | 信任受损、采用受阻 | 中 | 默认关闭、字段公开、本地可查、可导出删除、组织可禁用 | 用户反馈担心上报；抓包发现意外请求 |
| R-M4-09 | 跨平台 WebView 差异 | 安装后白屏、通知/拖放异常 | 高 | Tier 1 版本限定；核心流程清单；启动检测；三平台冒烟 | 某平台特有崩溃或布局错乱 |
| R-M4-10 | 范围蔓延导致 M4 失控 | 核心交付延期 | 高 | 严格执行第 17 节非目标；阶段门；插件/遥测可后置但不降低安全 | 出现未计划的集成或市场功能 |
| R-M4-11 | 文档与实际行为漂移 | 用户无法排障、支持成本上升 | 中 | 文档与版本同批评审；示例自动化测试；发布检查单阻断 | 文档步骤与实际界面不符 |
| R-M4-12 | 许可证或 SBOM 不合规 | 分发受阻、法律风险 | 低-中 | 依赖允许列表；生成 NOTICE 与 SBOM；发布前审查 | 新增 GPL 类依赖；NOTICE 缺失 |
| R-M4-13 | 时区/DST/错过策略错误 | 任务在错误时间运行或重复运行 | 中 | 固定时区库；DST 测试；预览；时钟跳变审计 | 用户报告任务时间偏移 |
| R-M4-14 | 自动化与用户工作争抢资源 | 本机卡顿、Run 互相拖慢 | 中 | 并发上限；工作时间窗口；队列提示；优先级 | 用户报告应用变慢；Run 排队过长 |
| R-M4-15 | Windows SmartScreen 信誉不足 | 首次安装被拦截，转化下降 | 中 | 代码签名；时间戳；发布说明；逐步建立信誉 | 安装失败率偏高；用户报告拦截 |
| R-M4-16 | 团队模式身份与自动化冲突 | 自动任务使用错误身份或越权 | 中 | 自动化 actor 独立；权限校验；审计；组织策略 | 审计出现无主自动化操作 |
| R-M4-17 | 自动化任务绕过任务 DAG 或上游验收 | 提前执行、产出污染、角色协作失效 | 中 | 规则绑定模板版本与 DAG；上游未验收保持 blocked；立即运行同样受约束；审计记录阻塞原因 | 出现上游未验收却已启动的 Run |
| R-M4-18 | 演示与验收只覆盖 macOS | Windows/Linux 打包、WebView 依赖与签名缺陷漏到发布 | 高 | 三平台独立验收记录；平台专用 CI runner；产物哈希归档；macOS 录屏不得替代 | 发布前缺少 NSIS/AppImage 记录 |
| R-M4-19 | 空状态与悬空引用导致静默失败 | 用户误以为自动化在运行，实际未触发 | 中 | 空状态验收；规则 blocked/needs_review；模板与 Agent 引用完整性；通知负责人 | 规则长期无触发但无告警 |

## 15. 指标

以下指标为 M4 的初始目标，用于发布门禁与灰度观察；未标注目标的先采集基线，不设硬性承诺。指标优先在本地计算与展示，遥测只上传匿名聚合计数。

| 指标 | 定义 | 初始目标 | 数据来源 |
|---|---|---|---|
| 干净机器安装成功率 | 在支持的干净环境中完成安装并首次启动的比例 | ≥ 95% | 发布测试与可选遥测 |
| 安装后首次 Run 完成率 | 安装后 30 分钟内完成一次 Mock Run 的比例 | ≥ 80% | 本地统计 |
| 安装后首次 Run 耗时 | 从首次打开到首次 completed Run 的中位时间 | ≤ 10 分钟 | 本地统计 |
| 自动更新成功率 | 发起更新后成功启动新版本的比例 | ≥ 98% | 更新日志与可选遥测 |
| 更新回滚率 | 更新后回滚到上一版本的比例 | ≤ 1% | 更新日志 |
| 崩溃自由会话比例 | 正常退出会话占比 | ≥ 99.8% | 本地会话记录与可选遥测 |
| 定时触发成功率 | 排除用户配置错误后的成功自动触发比例（不含「立即运行」） | ≥ 95% | 触发历史 |
| 定时重复率 | 同一计划时刻产生重复 Task 的比例 | 0 | 触发历史 |
| 自动化 DAG 越权次数 | 上游未验收却进入 `todo` 或启动 Run 的次数 | 0 | DAG 测试与审计 |
| mock 证据误用次数 | mock Run 被用于完成或合并的次数 | 0 | `M1-local-loop.md` UI-009、EVIDENCE-009 测试 |
| 平台安装冒烟通过率 | macOS/Windows/Linux 独立验收记录通过的比例 | 100% | 三平台验收记录 |
| Webhook 签名正确率 | 测试用例中正确/错误签名判定符合预期的比例 | 100% | 测试报告 |
| Webhook 重放拦截率 | 重放请求被拒绝且不产生重复 Task 的比例 | 100% | 测试报告 |
| 通知投递成功率 | 应用内通知写入与桌面通知展示的比例 | 应用内 ≥ 99%；桌面 ≥ 95% | 通知日志 |
| 通知敏感内容违规数 | 通知中出现代码、路径、密钥或 diff 的次数 | 0 | 审查与测试 |
| 插件越权拦截率 | 越权文件/网络/高风险调用被拒绝的比例 | 100% | 插件审计 |
| 插件崩溃隔离率 | 插件崩溃不影响主程序的比例 | 100% | 故障注入 |
| 空状态可用率 | 有明确文案、解释与主入口的空状态页面占比 | 100% | UI-078/UI-080 审查 |
| 遥测默认关闭合规 | 默认安装无遥测请求的比例 | 100% | 抓包与审查 |
| 遥测关闭生效时间 | 关闭后到最后一个请求停止的时间 | ≤ 1 个发送周期 | 抓包 |
| 文档任务完成率 | 新用户按文档完成安装、配置、排障的比例 | ≥ 80% | 可用性测试 |
| 发布回滚演练通过率 | 回滚演练按预期恢复的比例 | 100% | 发布记录 |

反指标与解释规则：

- **安装量上升但首次 Run 完成率下降**：说明安装体验或 Runtime 配置有问题，不应只看下载量。
- **更新成功率很高但回滚率也上升**：可能是灰度不足或健康检查过松，应暂停扩大灰度。
- **定时触发量很高但评审通过率下降**：说明自动化在制造噪音，应检查模板与 Agent 质量，而不是庆祝吞吐。
- **通知数量上升但审批等待时间不降**：说明通知没有到达正确的人或被噪音淹没，应调整聚合与路由。
- **遥测开启率低**：不代表产品失败，本地优先用户有权拒绝；不得用诱导性文案提高开启率。

## 16. 验收标准与退出标准

### 16.1 功能验收

M4 功能验收按工作流逐项检查，所有 P0 需求必须通过，P1 需求除非在阶段评审中明确后置，否则也应通过。

| 工作流 | 必须通过的验收 |
|---|---|
| 定时自动化 | 创建/启用/暂停/恢复/删除；cron 预览；到时自动创建 Task；默认 Backlog；显式 todo 才排队 Run；触发去重；重叠与错过策略；DAG 上游阻塞；权限继承；自动化不能调用高风险接口；「立即运行」不改变 nextRunAt |
| Webhook | 正确签名 202；错误签名 401；重放 409；超大 413；速率限制 429；投递日志；密钥轮换；默认仅本机；默认 Backlog；不能创建审批或合并；悬空引用返回 409 与结构化错误 |
| 通知 | 事件覆盖；应用内/桌面/出站；内容最小化；去重聚合；失败重试；通知故障不阻塞核心闭环；空状态与权限状态 |
| 打包 | DMG/NSIS/AppImage/tar.gz；干净机器安装启动；Web 资源嵌入；版本一致；图标与 LICENSE/NOTICE；卸载保留数据；三平台独立验收记录 |
| 签名 | macOS 公证与 `spctl`；Windows 签名与时间戳；Linux 校验和；签名失败拒绝安装；未签名构建不得对外分发 |
| 自动更新 | stable/beta 隔离；签名清单；清单字段（体积、安全更新、最低系统/安全版本）；下载校验；原子替换；回滚；数据库备份；拒绝降级；离线不阻塞 |
| 插件 | 清单与权限；默认无网络/文件；独立隔离；事件订阅；设置页/任务面板/导出/通知渠道/证据渲染扩展点；越权阻止；停用撤权；审计；示例可运行；插件不作为 Runtime |
| 遥测 | 默认关闭；同意页；字段最小化；本地查看/导出/删除；关闭立即生效；崩溃上传单独同意 |
| 文档 | 安装、升级、卸载、Runtime、权限、自动化、插件、隐私、管理员指南、排障、发布说明、安全披露 |
| 导入导出 | 任务与证据导出、敏感信息检查、导入校验、审计不覆盖、版本不兼容拒绝 |
| 空状态与引用完整性 | 无 Schedule/Webhook/通知/插件/更新历史时均有文案与入口；模板删除/变更、Agent 删除/权限收紧时规则可阻断、可恢复、可审计 |

### 16.2 非功能与发布门禁

M4 发布必须满足 `prd/modules/non-functional-requirements.md` 第 12.5 节的 M4 发布门禁，本章再次列出并补充：

1. DMG、NSIS、AppImage 在各自平台的干净环境安装成功；macOS 公证与 Windows 签名验证通过；三份平台验收记录齐全。
2. 自动更新签名、校验、原子替换、失败回滚通过演练；成功率与回滚率达标；清单包含体积、安全更新与最低系统/安全版本字段。
3. 升级备份、降级拒绝、卸载保留数据通过测试。
4. 安装体积、安装包语言、关于页版本信息达标；未签名构建不得对外分发。
5. 遥测默认关闭、字段最小化、可关闭、端点公开；隐私说明完整。
6. 崩溃日志本地可用，上传仅在显式同意后进行。
7. 发布 SBOM、校验和、签名清单与构建记录完整。
8. 高危依赖漏洞阻断发布；许可证清单与 NOTICE 完整（SEC-062、SEC-063）。
9. 三平台核心流程冒烟通过；WebView2/WebKitGTK 依赖检测可用（NFR-PORT-009）。
10. 自动化任务遵守 DAG 与上游验收；mock 证据不能触发完成或合并；越权路径/命令被拒绝。
11. 性能、日志、事件与通知不因 M4 新增功能显著退化。
12. 空状态、引用完整性与通知不可用状态通过 UI-078/UI-080 与本章 8.2/8.3 的检查。

### 16.3 回归

M4 发布前必须回归 M0-M3 的核心闭环：

- M0：Task/Agent/Run CRUD、SQLite、HTTP/WS、mock Runtime、Vue 看板、Wails 壳。
- M1：worktree、分支、diff、Artifact/Evidence、取消/超时、人工合并。
- M2：任务 DAG、交付物契约、角色模板、路径/命令权限、审批门、证据化 DoD、收件箱。
- M3：登录、权限、远程 Runner、机器注册、共享 Agent、审计。
- 回归重点：自动化创建的 Run 仍遵守审批；插件不能改变证据要求；更新不破坏数据库；通知不泄露内容；打包版与开发版行为一致。

### 16.4 退出标准

M4 只有同时满足以下条件才算完成：

1. 三平台安装包（DMG、NSIS、AppImage/tar.gz）在各自平台的干净机器安装、启动、完成一次 Mock Run；版本号一致；三份独立平台验收记录与产物哈希归档。
2. macOS 公证与 `spctl` 验证通过；Windows Authenticode 签名与时间戳验证通过；Linux 校验和可验证；未签名构建只允许内部测试，不得对外分发。
3. 自动更新从 N 到 N+1 成功，任务、Agent、Run、证据与配置保留；启动失败可回滚；数据库迁移失败可恢复；降级被拒绝；清单中的体积、安全更新与最低版本字段被正确展示与校验。
4. 定时规则端到端可用：创建、启用、暂停、恢复、**自动触发**（非仅「立即运行」）、去重、`nextRunAt`、错过与重叠策略、运行历史完整；「立即运行」不改变计划时间；自动化任务遵守 DAG 与上游验收，不能绕过审批。
5. 签名 Webhook 端到端可用：正确请求创建 Backlog Task、错误签名与重放被拒绝、投递日志与密钥轮换可用；悬空引用返回结构化错误。
6. 通知覆盖规定事件；内容不含敏感信息；通知故障不阻塞核心闭环；审批通知不可静默丢失；空状态与权限状态可用。
7. 插件权限、隔离、事件订阅、通知渠道/证据渲染扩展点、停用撤权、审计与示例通过测试；插件不能批准、合并、推送、部署、读取密钥或注册为 Runtime。
8. 遥测默认关闭；关闭后无上报；字段清单、端点、保留期限公开；本地查看、导出、删除可用。
9. 安装、升级、卸载、Runtime 配置、权限、自动化、插件、隐私、管理员指南、排障与发布说明文档完成评审；安装器/法律文本/关键文档双语。
10. SBOM、校验和、签名清单、构建记录、发布说明齐全；高危漏洞已修复或经批准例外。
11. 演示脚本在干净环境完整通过并归档证据；所有 P0 需求通过；mock 证据未被用于完成或合并；越权路径/命令被拒绝；无未解决 P0/P1 安全缺陷。
12. 风险评审完成，GOV-002（红/橙风险先行指标与阈值）、GOV-003（里程碑风险评审与登记表更新）、GOV-004（里程碑继续/收缩/停止标准）的要求得到满足；同时满足 `prd/05-risks-and-open-questions.md` 第 11 章 M4 退出条件中的 GOV-009、GOV-010、SEC-006、SEC-010、SEC-012；发布负责人签署 go/no-go。
13. 空状态与引用完整性验收通过：无 Schedule/Webhook/通知/插件/更新历史时有明确文案与入口；模板删除/归档/字段变更、Agent 删除/权限收紧时规则可阻断、可恢复、可审计。

### 16.5 继续 / 收缩 / 停止

按 GOV-004（里程碑继续/收缩/停止标准），M4 阶段评审必须给出三类决策之一：

| 决策 | 条件 | 行动 |
|---|---|---|
| 继续 | 所有 P0 通过；安装、签名、更新、自动化、插件、遥测与文档达到退出标准；风险可接受 | 进入公开发布与灰度 |
| 收缩 | 打包、更新、自动化与治理通过，但插件或 beta 通道或 Linux 额外格式未完成 | 插件与 beta 通道后置到 M4.5；不得后置签名、回滚、遥测默认关闭与审批保护 |
| 停止 | 出现签名绕过、更新导致数据丢失、插件可调用高风险动作、遥测泄露、自动化绕过审批之一 | 停止发布，回到 M4.2/M4.3 修复；不得以「已知问题」发布 |

任何「先发布、后补安全」的方案都不被接受。M4 的发布门禁是产品信任的一部分，不是工程收尾。

## 17. 不在 M4 的范围

| 非目标 | 原因 | 重新评估触发条件 |
|---|---|---|
| 自动合并、推送、部署、删除、批准 | 与人工在回路和高风险审批原则冲突 | 不重新评估；可通过审批策略放宽，但不取消人工最终决定权 |
| Crew 与队长模式的自动编排 | M4 只做任务级自动化；Crew 协作层后置，避免调度与协作复杂度叠加 | Crew 模式稳定且有明确自动化需求；需单独风险评审 |
| 生产部署自动执行 | DevOps 在 M2 只做 staging 与部署计划，prod 必须人工 | 不重新评估；保持长期边界 |
| 模型托管与转售 | 与 BYO Runtime/Key 模式冲突 | 不重新评估 |
| 多租户 SaaS | 与本地优先、自托管优先冲突 | 有明确托管需求与合规方案，且不损害本地数据边界 |
| 移动端应用 | 评审需要完整代码上下文，桌面优先 | 桌面稳定且用户研究证明移动审批是刚需 |
| IM 机器人、邮件、短信通知 | 通知先在应用内与桌面闭环 | 通知中心稳定且用户明确要求外部通道 |
| 插件市场、技能市场、模板市场商业分发 | 先做本地安装与导入导出，避免内容审核与商业复杂度 | 出现稳定的第三方插件生态与分发需求 |
| 插件默认联网/任意文件/密钥访问 | 安全边界不允许 | 不重新评估；只按权限逐项授予 |
| 插件作为 Agent Runtime 适配器 | M4 的插件宿主只扩展 UI、通知、导出、证据渲染与审批检查；模型 Runtime 仍由 Claude Code/Codex/mock 承担 | 出现稳定的第三方 Runtime 协议与安全评审方案 |
| 跨仓库、跨项目自动化 | 初期单仓库、单项目范围 | M3 跨仓库能力稳定且有明确用户需求 |
| Windows arm64、Linux arm64 正式包 | Tier 1 范围控制 | 用户占比与测试能力达到要求 |
| deb/rpm/Flatpak 等原生包 | 维护成本高，AppImage 已覆盖 | 发行版用户需求明确且有维护者 |
| 自动重试风暴与无人值守自愈 | 可能放大错误与成本 | 仅在明确可重试错误、有限次数与人工合并前提下评估 |
| 企业级 DLP、合规认证、私有更新服务器托管 | 超出 M4 范围 | 出现明确企业客户与合规预算 |
| 应用 UI 全量 i18n 与语言切换 | M4 安装器、法律文本与关键文档双语，但应用 UI 保持英文，避免 UI 全量翻译拖垮里程碑 | 有明确地区需求与翻译资源；D-M4-20 复审 |
| 技能市场与移动端审批 | 与初期非目标一致 | 见产品总览第 13 章 |

## 与其他文档的关系

本章是 M4 的执行与验收文档，不重复模块细节。文档关系如下：

| 文档 | 关系 |
|---|---|
| `prd/00-product-overview.md` | 定义产品愿景、用户、原则、非目标与里程碑边界；第 14.3 节已列出本章正确文件名 `M4-automation-and-packaging.md`。本章的 M4 目标必须服从其 PROD 需求与产品原则。 |
| `prd/02-domain-model.md` | 定义 Run 的 `trigger` 六值枚举（`manual`、`retry`、`schedule`、`webhook`、`dependency`、`crew`）与 RUN-012 的去重要求；本章的定时与 Webhook 触发必须沿用该模型，不新增平行执行语义。 |
| `prd/03-user-flows.md` | 定义 S7「定时或 Webhook 触发任务」与 M4 流程映射；本章按 5.9.1 将其统一为「默认创建 Task，显式 todo 才排队 Run，立即运行为手动例外」，并强调自动触发仍需人工合并门。 |
| `prd/04-acceptance-and-test-plan.md` | 第 4.5 节给出 M4 验收标准与 15 分钟演示脚本；本章将其细化为里程碑需求、演示步骤与失败判定。两者冲突时，以更严格的安全与人工门禁为准。 |
| `prd/05-risks-and-open-questions.md` | 第 5.7、5.8 节定义自动更新与遥测风险；第 7 章给出 GOV-001 至 GOV-012 风险治理需求；第 11 章给出里程碑映射与 M4 退出条件（含 GOV-009、GOV-010、SEC-006、SEC-010、SEC-012）；第 12 章给出决策日志与 OQ 编号。本章按「编号 + 标题 + 章节」引用。 |
| `prd/modules/agent-system.md` | 定义 Agent 包导入导出（AGENT-046、AGENT-047）与工作时间窗口（AGENT-051）；本章将其列为伴随交付。 |
| `prd/modules/collaboration-and-review.md` | 定义应用内通知与 M4 桌面/Webhook 通知（COLLAB-065）、收件箱、审批门与证据化 DoD；本章的通知与自动化不得绕过这些规则。 |
| `prd/modules/non-functional-requirements.md` | 定义打包、签名、更新、遥测、可移植性、国际化等 NFR；本章的第 16.2 节直接引用其 M4 发布门禁。NFR-PKG-005 原计划 M1，本章承接其未交付遗留。 |
| `prd/modules/api-and-data.md` | 定义 REST/WebSocket 契约、`/api/v1` 版本化、错误模型、分页、幂等键、trigger 枚举与 M4 的 `schedules`/`webhooks` 计划表；本章 7.2 的端点与 7.3 的事件必须服从该契约。 |
| `prd/modules/runtime-and-workspace.md` | 定义 Run 生命周期、Runtime、Workspace、Artifact/Evidence；本章的自动化只负责触发，不改变执行与证据语义。 |
| `prd/modules/security-and-permissions.md` | 定义信任模型、权限、审批、审计、供应链安全（SEC-062 至 SEC-066）；本章的 Webhook、插件、更新与遥测必须服从其约束。 |
| `prd/modules/task-management.md` | 第 20.5 节给出任务模块的 M4 交付；本章的自动创建任务、通知与 M4-EXP-001/002 导入导出与其保持一致。 |
| `prd/modules/ui-ux.md` | 第 14 节给出 M4 界面交付；本章的交互规则以其视觉与交互规范为准，不另行定义组件细节。 |
| `prd/milestones/` 下的其他里程碑文档 | M1、M2、M3 的退出标准是 M4 的入口条件；M4 不降低任何前序里程碑的安全、审批或证据要求。 |

使用规则：

1. 产品总览决定「为什么做、为谁做、不做什么」；模块文档决定「做什么、怎么交互、边界条件」；本章决定「M4 何时做、交付什么、如何验收」。三者冲突时，按第 5.9 节的优先级处理。
2. 本章的 M4- 需求是里程碑级验收编号，不替代模块的 TASK/AGENT/RUN/COLLAB/UI/SEC/NFR 编号；实现与测试应同时引用两者。
3. 任何 M4 功能的实现都不得削弱 PROD-009（高风险审批）、PROD-010（结构化多角色协作）、PROD-013（数据主权）与 PROD-014（开源与原创）。
4. 本章的演示脚本与退出标准应被测试计划、发布检查单与发布说明引用；不得出现「演示通过但门禁未过」的发布。
5. 本章引用的模块文件名以仓库实际文件为准；若模块文档后续重命名或拆分，应同步更新本章与产品总览的文档地图。

## 待确认/未文档化

以下事项是 M4 进入开发前需要跟踪的决策。已关闭项在表下单独列出；仍开放的条目只影响实现细节或运营安排，不得作为 P0/P1 的唯一依据。

| 编号 | 待确认事项 | 当前状态 | 影响 | 最晚决策点 |
|---|---|---|---|---|
| Q-M4-01 | 自动更新服务的归属与托管方式：自建、对象存储 + CDN，还是由发布负责人维护的静态站点 | 已由 D-M4-05 给出默认：自托管 HTTPS 静态清单 + 对象存储/CDN；剩余为部署细节 | 影响成本、可用性、灰度与密钥管理 | M4.3 启动前 |
| Q-M4-02 | Windows 代码签名证书类型：OV 还是 EV；预算与签发周期 | 已由 D-M4-03 给出默认：先 OV + 时间戳，按 SmartScreen 反馈评估 EV | 影响首次安装拦截率与发布节奏 | M4.0 结束前 |
| Q-M4-03 | macOS 开发者账号与公证账号的归属、团队协作与 CI 密钥保管 | 未定；运营事项，不影响需求定义；M4.0 前指定负责人 | 影响签名、公证与发布连续性 | M4.0 结束前 |
| Q-M4-04 | 插件隔离运行时：独立进程 + JSON-RPC、WASM，还是其他方案 | 已由 D-M4-09 给出默认：独立进程 + JSON-RPC/stdio | 影响 API、性能、跨平台与安全边界 | M4.3 启动前 |
| Q-M4-05 | 插件权限清单与 `approval.check` 的失败语义：插件故障时阻断合并还是允许人工覆盖 | 已关闭：默认失败关闭；只有显式配置 `manual_override` 才允许人工覆盖并记录理由（M4-PLUG-014） | 影响审批体验与安全 | 已关闭（D-M4-22） |
| Q-M4-07 | Webhook 是否允许局域网/公网暴露；TLS 由反向代理还是内置；来源 IP 允许列表的默认值 | 已由 D-M4-08 给出默认：仅本机，外部模式需显式配置 | 影响攻击面与集成能力 | M4.2 启动前 |
| Q-M4-08 | Schedule 的错过运行、重叠、DST、时钟跳变的默认策略 | 已由 M4-AUTO-005/006/007/016 给出默认值 | 影响任务是否重复或漏跑 | M4.2 启动前 |
| Q-M4-10 | 自动化的每日上限、并发上限、单次超时默认值；是否允许有限自动重试 | 已由 M4-AUTO-010 给出默认值：并行 1、每日 24、超时 60 分钟；自动重试仅限明确可重试错误 | 影响资源、成本与用户预期 | M4.2 启动前 |
| Q-M4-14 | 跨项目自动化：`prd/modules/collaboration-and-review.md` 的 M4 映射提到「事件驱动跨项目协作」，本章将其列为非目标 | 已关闭：M4 非目标；跨项目自动化后置（见 §2.2/§17） | 影响 M4 范围与 DAG 设计 | 已关闭（范围决策） |
| Q-M4-15 | 自动化、Webhook 投递、通知、插件与遥测日志的保留期限与清理策略 | 已由 M4-TEL-006（遥测 90 天）与安全模块的 30/90/180 天建议给出默认；剩余为各类日志的清理细节 | 影响磁盘、审计与隐私 | M4.2 启动前 |
| Q-M4-16 | 文档托管形态：仓库 Markdown、版本化网站、应用内离线文档的优先级与发布流程 | 已由 D-M4-12 给出默认：仓库为源 + 版本化站点 + 离线入口 | 影响文档维护成本与用户体验 | M4.1 启动前 |
| Q-M4-17 | Linux 是否只承诺 AppImage + tar.gz，还是需要 deb/rpm/Flatpak | 已由 D-M4-04 给出默认：只做 AppImage + tar.gz，其他后置 | 影响 Linux 用户覆盖与维护成本 | M4.1 结束前 |
| Q-M4-19 | 团队模式远程 Runner 是否接受 Schedule 触发；自动化 actor 与机器身份的绑定方式 | 已由 M4-AUTO-020 给出：本地 leader 触发，远程 Runner 只执行 Run，不承担定时 | 影响 M3/M4 交叉场景与审计 | M4.2 启动前 |
| Q-M4-21 | 需求 ID 冲突：`RUN-012` 在 `prd/02-domain-model.md` 表示定时/Webhook 去重，在 `prd/modules/runtime-and-workspace.md` 表示 Claude Code CLI 探测；`RUN-006` 在 `prd/02-domain-model.md` 表示「同一 Task 最多一个活跃 Run」，在 `prd/modules/runtime-and-workspace.md` 表示「Run 事件 seq 单调递增」 | 已裁决：领域模型需求统一使用 `DM-` 前缀，本章引用写 `DM-RUN-006`/`DM-RUN-012`；运行时模块的 `RUN-006` 保持为事件 seq 需求，两者属不同命名空间，不再视为同号冲突 | 影响追溯、测试与实现引用 | 已关闭 |
| Q-M4-22 | 模块文档互引文件名与仓库实际文件名不一致（例如引用 `01-task.md`，实际为 `task-management.md`） | 已知差异；本章引用以仓库实际文件名为准 | 影响导航与维护 | 下一次文档整理 |

**已关闭事项（v0.2）**：

- Q-M4-06 遥测事件清单/组织禁用 → 由 D-M4-15 关闭，事件清单以 M4-TEL-003 为准。
- Q-M4-09 桌面通知默认值 → 由 D-M4-14 关闭：应用内与桌面默认开启、出站默认关闭、审批不可静默丢弃。
- Q-M4-11 更新检查默认值 → 由 D-M4-16 关闭：自动检查默认关闭、手动可用。
- Q-M4-12 API 契约文档缺失 → 已核实关闭：实际契约为 `prd/modules/api-and-data.md`；`prd/modules/08-api.md` 不存在，任何旧引用作废。
- Q-M4-13 里程碑文件名不一致 → 已核实关闭：`prd/00-product-overview.md` 第 14.3 节已使用 `M4-automation-and-packaging.md`。
- Q-M4-18 插件签名 → 由 D-M4-17 关闭：可选签名，未签名需二次确认。
- Q-M4-20 界面语言 → 由 D-M4-20 关闭：安装器/法律文本/关键文档双语，应用 UI 保持英文。

**开放问题使用规则**：未关闭的 Q 不得作为 P0/P1 的唯一依据。若某条 FR 只能依赖未关闭 Q，必须标记「暂定，待 Q 关闭」，并移出 M4 退出标准；实现只能采用第 12 节默认值并保持可逆。当前所有 P0/P1 均已采用第 12 节决策或本章明确默认值，不依赖任何未关闭 Q 作为唯一依据。

在这些事项关闭前，M4 的实现应遵循第 12 节建议默认值，并在代码、配置与发布说明中保留可逆性。任何涉及签名、更新、插件权限与遥测默认值的决定，必须由产品负责人、安全评审人与发布负责人共同确认，不能由单一实现者自行拍板。
