# 模块：安全、权限与治理

## 本章导读

本章定义 ATeam 作为「本地优先、开源、多 Agent 开发驾驶舱」的安全底座，回答四个问题：谁在什么边界内执行、Agent 能碰什么、哪些动作必须由人批准、出了事如何追溯。

核心结论如下：

- ATeam 的默认信任边界是**当前操作系统用户**。M0-M2 不提供操作系统级沙箱，Agent 子进程以当前用户身份运行；因此安全设计必须同时依赖「默认回环网络」「Agent 权限信封」「Runtime 自带权限参数」「人工审批」和「审计」五层防线，任何一层都不能被宣传为绝对隔离。
- 「代码不出本机」需要精确表述：ATeam 自身不上传代码；但 Runtime 调用用户自带的模型服务时，提示词（可能包含代码片段）会发往该服务。这是 BYO Runtime/Key 模式的固有数据流，产品必须在首次配置 Runtime 时于 UI 内如实说明，而不是只在文档里声明。
- M0 只有最小基线：默认监听 `127.0.0.1:8787`、请求体 1 MiB 限制、Agent 的 `allowedPaths`/`allowedCommands` 字段已持久化但未执行。CORS 反射任意 Origin、WebSocket 放行任意来源、无认证、无 git worktree、无审计，是已知缺口，不能当作已实现的安全能力。
- 里程碑按 roadmap 的 M0-M4 划分：**M1** 关闭本地浏览器攻击面（回环绑定、Host/Origin/CORS、凭证脱敏、工作区路径校验）并建立「合并人工确认」；**M2.1** 落地 Agent 权限信封、正式 Approval 实体、本地审计与软删除；**M3** 引入登录、组织角色、远程 Runner 与团队审计；**M4** 补齐供应链、签名与自动更新验证。远程访问不是 M1/M2 的承诺，只在 M3 作为高级非承诺能力出现。
- 所有高风险动作——合并、推送、部署、删除、权限扩张、组织级操作——都必须留下**人工批准记录**，其最小字段为 actor、action、target、content fingerprint 与时间。M1 的合并确认由 Review 决定与 MergeRecord 承担；M2.1 起统一为 Approval 实体。人工在 UI 中直接触发执行**不构成豁免**：触发本身也必须生成同结构的批准记录。
- DevOps Agent 在 M2 只能生成部署计划与执行 staging；prod 部署由人在 ATeam 之外完成，ATeam 只记录计划、审批与人工回填的执行结果，不保存生产凭据、不自动执行生产变更。

本章是产品需求文档，不替代安全评审、渗透测试或合规审计。文中的「必须」表示发布门槛，「应该」表示强烈建议，「可以」表示可选能力。事实标记规则：标注「M0 已实现」的能力必须能在当前 Go core、SQLite schema、REST/WS API 与 Vue 页面中找到对应实现；M1-M4 的条目均为计划。

## 1. 目的与范围

### 1.1 目的

1. 把 ATeam 的信任模型写成可执行的产品约束，而不是散落在代码和口头约定里。
2. 为 M1-M4 的安全能力提供统一的需求编号（SEC-）、验收口径和唯一的首次交付里程碑，便于工程拆分与发布评审。
3. 让「本地优先」既是部署形态，也是安全承诺：默认不暴露网络、默认不收集数据、默认不替用户做不可逆决定。
4. 为团队模式（M3）提前定义身份、角色、Agent 可见性、Runner 信任与审计模型，避免在多人场景下用「大家都信任」来掩盖权限问题。
5. 明确当前实现与计划能力的边界，防止把路线图写成既成事实。

### 1.2 范围

本章覆盖：

- 信任模型、资产分类、对手假设与安全原则。
- 本地网络边界：监听地址、浏览器引导、CORS/Host/WebSocket 认证、请求体限制、安全响应头。
- 密钥与凭据管理：BYO Key、环境变量、操作系统钥匙串、Secret 轮换、团队 Secret 引用。
- 权限模型：M0-M2 的单用户模式，M3 的组织角色 / Team Workspace 成员角色 / Agent 可见性。
- Agent 权限信封：版本化策略 schema、允许路径、允许命令、环境变量、凭据隔离、Runtime 权限参数。
- 高风险动作与人工审批：合并、推送、部署、删除、权限扩张、组织删除与 Owner 转移。
- Runner 与机器安全：注册令牌、心跳、租约、共享机器风险、撤销。
- 审计日志：事件模型、本地审计、团队审计、完整性、轮转与保留。
- 供应链与发布安全：依赖、许可证、构建可验证性、产物签名、自动更新。
- 威胁模型、用户故事、功能需求、交互规则、数据/API 影响、异常边界、指标、依赖与风险。

### 1.3 非目标

以下内容不在本章范围，也不作为 M1-M4 的承诺：

- 完整的 IAM/SSO 套件、SCIM、细粒度 ABAC 策略引擎。M3 只做满足 2-10 人团队的最小 RBAC。
- 操作系统级或虚拟机级沙箱。M0-M2 不隔离文件系统、网络和进程；强隔离属于后续独立课题，未列入 M1-M4。
- 密钥托管服务或模型代理。ATeam 不托管模型、不转售模型、不代管用户的模型密钥。
- SOC 2、ISO 27001、等保等合规认证。产品可以朝可审计方向设计，但本章不宣称合规。
- 对第三方 Runtime 内部行为的完全控制。ATeam 只能通过其公开参数、工作目录、环境与工具级策略施加约束，并如实标注隔离等级。
- 数据防泄漏（DLP）、终端检测与响应（EDR）、企业设备管理集成。
- 面向公网的远程访问承诺。远程模式只在 M3 作为高级非承诺能力提供，且必须满足本章的认证与传输要求。

### 1.4 当前状态与差距

下表以仓库代码为准，区分「M0 已实现」「M0 部分实现」「计划中」。

| 能力 | M0 现状（代码依据） | 差距 | 目标里程碑 |
|---|---|---|---|
| 默认监听 | `app.DefaultConfig` 默认 `127.0.0.1:8787`；桌面壳 `StartLocal` 绑定 `127.0.0.1:0` 随机端口 | `--addr` 可绑定任意地址，无守卫、无告警 | M1 |
| 认证与授权 | 无。所有 `/api/*` 无身份校验 | 无会话、无令牌、无角色 | M2.1 本地令牌；M3 登录与 RBAC |
| CORS | `withCORS` 反射请求中的任意 `Origin`；固定返回 `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`；`Allow-Headers` 仅含 `Content-Type` | 任意网页可跨域调用本地 API；新增自定义认证头会因未列入 Allow-Headers 而预检失败 | M1 |
| WebSocket | `CheckOrigin` 恒为 `true`，无认证 | 任意来源可订阅全量事件 | M1 |
| 请求体限制 | `decodeJSON` 被全部 JSON 写接口使用（create/update Task、create/update Agent、createRun）；`io.LimitReader` 截断 1 MiB 后由 JSON 解码器报错并返回 400；DELETE 等无请求体接口不适用 | 超限未返回 413；没有统一错误码 | M1 |
| 文件权限 | `~/.ateam` 数据库目录与 Run 工作区均以 `0o755` 创建（`store.Open`、`workspace.Prepare`） | 本机其他用户可能读取数据库与工作区 | M1 |
| Agent 权限字段 | `Agent.AllowedPaths`、`AllowedCommands` 已入库，默认空数组 | 调度器与 Runtime 均未读取和执行 | M2.1 |
| 工作区隔离 | 每个 Run 一个 `~/.ateam/workspaces/runs/<run-id>` 目录，无 git worktree | 不隔离分支、不隔离仓库状态、不防止越界写 | M1 |
| Runtime 权限参数 | Claude adapter 仅执行 `claude -p <prompt>`、设置 `cwd`、逐行扫描 stdout/stderr | 无 stream-json 解析、无权限参数、无版本探测、无工具事件 | M1 |
| 高风险动作 | 合并/推送/部署未实现；Task 与 Agent 删除为硬删除（`DELETE FROM tasks/agents`） | 无审批、无归档保护 | M1 删除确认与归档；M2.1 软删除与恢复；审批门从 M2 起 |
| 审计 | 仅有 `run_events` 运行日志 | 无操作者、无动作类型、无审批链、无完整性保护 | M2.1 本地；M3 团队 |
| Runner | `ateam runner` 仅打印「reserved for M3」 | 无注册、无心跳、无租约 | M3 |
| 供应链 | `go.sum`、`pnpm-lock.yaml` 已提交；CI 执行 `go test`、`go vet`、`pnpm typecheck`、Web 构建 | 无 govulncheck、无 pnpm audit、无 SBOM、无签名、无更新校验、无许可证自动检查 | M1 扫描告警；M4 发布门禁与签名 |
| 原创性与许可 | Apache-2.0；CONTRIBUTING 要求 DCO 与清洁室声明；NOTICE 声明原创 | M0 部分交付；CI 无许可证/第三方资产自动检查，需在 M4 前补齐（见 SEC-063） | M0（部分） |

### 1.5 文档基线与跨文档规则

本章不自造并行的事实体系，以下文档是本章的对齐基线：

- 范围与里程碑：`prd/01-scope-and-roadmap.md`。
- 实体与字段：`prd/02-domain-model.md`（Approval、Run、Task、Agent 等）。
- 审批门与协作：`prd/modules/collaboration-and-review.md` 第 8 章。
- API 路径、错误码与数据表：`prd/modules/api-and-data.md`。
- 非功能目标：`prd/modules/non-functional-requirements.md`。
- 验收编号：`prd/04-acceptance-and-test-plan.md`。

规则：

1. 每个 SEC- 编号只有一个首次交付里程碑；后续里程碑只能「扩展」，不能把同一编号重复计为交付。
2. 本章与上述文档出现冲突时：范围以 roadmap 为准，实体字段以 domain model 为准，审批门语义以 collaboration-and-review 第 8 章为准，API 形状以 api-and-data 为准；冲突项必须登记在 §21.2 的待同步清单，不得用两种口径同时存在。
3. 里程碑细分沿用 roadmap：M2 拆为 M2.1（DAG、契约、权限、审批门、审计事件、并行调度）与 M2.2（Crew 与队长）。本章未特别说明时，M2 一律指 M2.1。

## 2. 信任模型

### 2.1 信任边界

ATeam 的运行时信任链如下：

```text
人类用户
  │  本机 UI / HTTP API（默认仅 127.0.0.1）
  ▼
ATeam Core（调度器、存储、策略与审批）
  │  权限信封：允许路径、允许命令、环境变量、凭据引用
  ▼
Run Workspace（M1 起为 git worktree）
  │  以当前操作系统用户身份启动子进程
  ▼
Runtime（Claude Code / Codex / mock）
  │  使用用户自带的 Key 访问模型服务（可选出网）
  ▼
模型服务商
```

关键含义：

- **信任起点是操作系统账户**。能登录该账户的人，理论上可以读写 ATeam 的数据库、工作区和 Runtime 配置。ATeam 的权限模型不是操作系统安全边界，而是减少误操作与越权意图的产品层控制。
- **本机其他进程不在防御边界内**。M1 的浏览器防护解决的是「恶意网页」，不解决「同一 OS 用户下的恶意进程」；后者应通过独立 OS 用户或全盘加密缓解，产品只做提示。
- **ATeam Core 是策略执行点**。调度器在启动 Run 前解析 Agent 权限信封，在工作区边界、命令执行边界和审批边界做判断；Runtime 内部是否遵守，取决于 Runtime 的能力声明。
- **模型服务商是外部数据接收方**。ATeam 不代理、不记录模型请求内容；是否发送代码片段由 Runtime 和用户配置决定。产品必须在首次配置 Runtime 时提示这一数据流（SEC-068）。
- **Git 远端是显式出网点**。M0-M2 不实现自动推送；M2.1 起的 push 必须由人触发并审批；ATeam 不做后台自动推送。
- **团队模式新增两个信任方**：组织管理员（可配置策略、查看审计）和 Runner 机器所有者（可接触运行中的代码与凭据）。M3 必须把它们纳入威胁模型，而不是默认可信。

### 2.2 资产与数据分类

| 资产 | 示例 | 分类 | 主要威胁 | 保护要求 |
|---|---|---|---|---|
| 源代码与 git 历史 | 仓库文件、分支、diff、commit | 机密 | 越界读取、日志泄漏、Runner 共享 | 工作区隔离、证据脱敏、最小权限 |
| 凭据 | 模型 API Key、Git token、部署密钥 | 最高机密 | 明文落盘、环境变量泄漏、日志打印 | 钥匙串/密钥库、引用传递、只写不读 |
| Agent 配置 | instructions、权限信封、模型选择 | 内部 | 未授权修改、权限扩张 | 角色校验、变更审计、审批 |
| Task 与 Run 数据 | 标题、描述、日志、摘要 | 内部/机密 | 跨工作区越权、审计缺失 | 资源作用域、成员校验、保留策略 |
| Artifact/Evidence | diff、测试输出、截图、构建产物 | 机密 | 路径穿越、公开链接泄漏 | 私有存储、签名 URL、过期清理 |
| 审计日志 | 登录、审批、合并、权限变更 | 机密且需完整 | 篡改、删除、越权读取 | 追加写、哈希链、管理员限定 |
| 数据库 | SQLite/Postgres 文件或实例 | 机密 | 本机其他用户读取、备份泄漏 | 文件权限、磁盘加密建议、备份加密 |
| 发布产物 | DMG、NSIS、AppImage、更新包 | 公开但需完整 | 供应链投毒、更新劫持 | 校验和、代码签名、更新签名验证 |

数据分类的使用规则：

- **最高机密**只能在创建时写入，之后 API 只返回引用和掩码；任何日志、审计、错误消息、证据都不得包含明文。
- **机密**默认不跨 Team Workspace 共享；导出、截图、审计查看都需要显式权限。
- **内部**可在组织内按角色可见，但默认不公开到组织外。
- **公开**才允许进入发布物、文档或演示材料。

### 2.3 对手与假设

| 对手 | 能力假设 | 典型行为 | 本章关注点 |
|---|---|---|---|
| 恶意网页 | 用户浏览器可访问 `127.0.0.1`，可发跨域请求与 WebSocket | 扫描本地端口、调用删除接口、订阅事件 | CORS、Origin、Host、会话令牌、WS ticket、CSRF |
| 本机其他用户 | 与 ATeam 用户共享一台机器，可能有本地 shell | 读取 `~/.ateam`、工作区、数据库 | 文件权限、磁盘加密建议、共享机器提示 |
| 被污染的仓库内容 | 可在源码、注释、Issue、README 中植入指令或恶意脚本 | Prompt injection；构建/测试脚本执行任意子进程 | 不可信内容标记、仓库信任确认、命令审批、权限信封 |
| 恶意或被攻陷的依赖 | 可执行安装脚本、运行时代码 | 窃取环境变量、篡改构建产物 | 锁文件、漏洞扫描、许可证审查、签名 |
| 配置错误的 Agent | 非恶意但权限过宽 | 大范围改写、执行破坏性命令 | 默认最小权限、权限变更确认、审批 |
| 内部人员越权（M3） | 合法账号，试图访问其他 Team Workspace | 枚举 ID、提升角色、导出审计 | 资源作用域、RBAC、防提权规则、审计 |
| 被攻陷的 Runner（M3） | 可读取该机器上运行的代码与凭据 | 横向移动、窃取 Secret、伪造心跳 | 注册令牌、租约、凭据最小化、撤销 |
| 供应链攻击者 | 可投毒依赖或更新通道 | 植入后门、劫持自动更新 | 锁定依赖、扫描、签名、可验证构建 |

通用假设：

- 用户的操作系统账户本身没有被攻陷。若账户已被攻陷，ATeam 无法提供有效保护，只能通过审计留下痕迹。
- 用户会按提示配置 Runtime 与模型 Key；ATeam 不假设用户会阅读全部文档，因此关键风险必须在 UI 内呈现。
- 网络默认可被本机任意进程访问；回环绑定不等于进程隔离。
- 第三方 Runtime 可能无视 ATeam 的指令性约束，因此必须把「可执行约束」与「提示性约束」分开描述。

### 2.4 安全原则

1. **默认拒绝**：没有明确允许的路径、命令、动作，一律拒绝或进入审批。
2. **默认回环**：没有显式远程模式，服务只监听 `127.0.0.1`。
3. **最小权限**：Agent 只获得完成当前 Task 所需的路径与命令；团队角色只获得职责所需的资源。
4. **不可逆动作必须人工批准**：合并、推送、部署、硬删除永远不自动执行，且每次批准都留下同结构的人工批准记录。
5. **审批绑定内容**：审批针对具体的 diff、commit、远端 ref、环境或计划，内容变化即失效。
6. **先审计后执行**：M2.1 起，高风险动作的审计写入失败时，动作必须失败关闭。
7. **密钥只写不读**：创建后不再通过 API 返回明文；日志与证据默认脱敏。
8. **失败关闭**：权限解析失败、路径校验失败、审批服务不可用时，宁可不执行。
9. **可解释**：每次拒绝都要给出机器可读的错误码和人类可读的原因，以及如何申请审批。
10. **人负最终责任**：Agent 是执行者，不是责任主体；产品界面不得暗示「Agent 已批准」。

## 3. 本地默认与网络边界

### 3.1 默认监听、浏览器引导与远程访问

M0 实现：

- `ateam serve` 默认 `127.0.0.1:8787`；`--addr` 可传入任意地址，没有任何守卫。
- Wails 桌面壳通过 `StartLocal` 监听 `127.0.0.1:0`，使用随机端口，并把该 URL 交给 WebView。
- Vite 开发服务器固定 `127.0.0.1:5173`，通过代理访问 Go 服务。

M1 要求：

- **只允许回环地址**。`--addr` 不是回环地址（`127.0.0.1`、`::1`、`localhost`）时，启动失败并给出明确错误；M1 不提供 `--allow-remote` 之类的放行开关。禁止静默接受 `0.0.0.0`、`::`、局域网 IP。
- 端口被占用时启动失败，不得回退到其他端口或更宽绑定。
- 桌面壳只使用随机回环端口，不开放固定端口。

M2.1 要求（本地会话令牌，见 SEC-003）：

- **桌面壳**：每次启动生成 256 位随机会话令牌，通过 Wails 绑定或一次性 URL 片段注入 WebView；令牌只保存在内存，不写入 localStorage、日志或崩溃报告；WebView 刷新后通过绑定重新获取。
- **浏览器模式（`ateam serve`）**：服务启动时在终端打印一次性 bootstrap URL（形如 `http://127.0.0.1:8787/#bootstrap=<一次性令牌>`），一次性令牌 TTL 5 分钟、单次使用；页面通过同源 `POST /api/v1/auth/bootstrap` 换取会话令牌，随后用 `history.replaceState` 清除 URL 片段。会话令牌存放在 `sessionStorage` 或内存中，关闭标签页即失效。
- **无头/脚本模式**：`ateam serve --print-token-file` 把会话令牌写入 `0600` 文件，并打印文件路径；脚本使用 `Authorization: Bearer <token>` 或 `X-ATeam-Token` 调用 API。
- 令牌比较使用常量时间；令牌不得出现在访问日志、错误消息、审计与前端错误上报中。
- 除 `/api/health`、`/api/v1/auth/bootstrap` 与 M3 的登录端点外，所有 `/api/*` 要求会话令牌。

M3 要求（远程访问，SEC-038，高级非承诺功能）：

- 远程模式不在 M1/M2 承诺范围内。M3 提供时，必须同时满足：显式 `--allow-remote` 开关、独立认证方案（团队登录或专用管理令牌，**不复用桌面壳临时令牌**）、TLS 或明确要求置于受信反向代理之后、按来源的速率限制、失败锁定、启动与 UI 顶部常驻红色横幅。
- 远程模式与本地模式使用不同令牌域；远程令牌可单独轮换与撤销；令牌泄露时管理员可一键撤销全部远程会话。
- 文档不得暗示明文 HTTP 可用于公网；不满足上述条件时服务拒绝启动。

### 3.2 浏览器攻击面、CORS 与 WebSocket 认证

M0 的 CORS 中间件会反射请求中的 `Origin`，WebSocket `CheckOrigin` 恒为 `true`，且没有认证。这意味着用户浏览器中打开的任意网页都可能：

- 读取 `/api/tasks`、`/api/agents`、`/api/runs` 等数据；
- 调用 `DELETE /api/tasks/{id}`、`DELETE /api/agents/{id}`；
- 通过 `/api/ws` 订阅全部事件；
- 触发 Run 创建，间接让本地 Runtime 执行任务。

M1 必须关闭该攻击面：

- **Origin 白名单动态生成**。启动时以实际监听地址构造允许来源：当前监听 origin（scheme+host+port，含 `127.0.0.1:<port>` 与 `localhost:<port>` 两种写法）；桌面壳使用随机端口时，以 `StartLocal` 返回的真实地址加入白名单；开发模式额外加入 `http://127.0.0.1:5173` 与 `http://localhost:5173`，且仅在显式开发配置下生效。
- 对带 `Origin` 且不在白名单的请求返回 403，且不写任何 `Access-Control-Allow-*` 头；`Origin: null`（沙箱 iframe、`file://` 页面、部分重定向场景）一律拒绝。
- `Access-Control-Allow-Headers` 必须随认证方案扩展：M1 至少允许 `Content-Type`；M2.1 加入 `X-ATeam-Token`、`Authorization`、`If-Match`。预检失败时浏览器不得发出实际请求。
- **Host 校验**：只接受与实际监听地址匹配的 `Host`（`127.0.0.1:<port>`、`localhost:<port>`、`[::1]:<port>`），其他 Host 返回 403。这是 DNS rebinding 的缓解措施（T-02），对 API 与 WebSocket 同时生效。
- **WebSocket 握手**：M1 校验 `Origin` 与 `Host`，不在白名单则拒绝升级；M2.1 起还要校验一次性的 WS ticket。
- **WebSocket 认证方式（M2.1）**：浏览器 WebSocket API 不能设置 `X-ATeam-Token` 自定义头，因此不得把「连接时带令牌头」写成需求。采用短期一次性 ticket：
  1. 客户端用会话令牌调用 `POST /api/v1/auth/ws-ticket`，返回 `{ticket, expiresAt}`；
  2. ticket 为 256 位随机值，TTL ≤ 60 秒，**单次使用**，绑定 session、Origin 与 Host；
  3. 客户端连接 `GET /api/ws?ticket=<opaque>`，服务端在升级前校验，失败返回 401 且不升级；
  4. 兼容方案：`Sec-WebSocket-Protocol: ateam.v1, ateam.ticket.<opaque>`，服务端回显 `ateam.v1`；查询参数会进入访问日志，日志中只允许记录 ticket 的哈希前缀；
  5. ticket 过期、复用、跨 Origin 使用均拒绝并计入安全告警。
- **会话令牌与 CSRF**：M1-M2 不使用 Cookie 作为唯一凭据；自定义头触发预检，配合严格 CORS 降低 CSRF 风险。M3 若为浏览器会话使用 Cookie，必须同时满足 SameSite=Lax 或 Strict、CSRF token、登录后轮换 session id（防会话固定），见 SEC-037。
- 增加 `Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`（或 CSP `frame-ancestors 'none'`）。生产构建不得使用 `unsafe-inline` 脚本。
- 开发环境的宽松 CORS 只能通过显式配置开启，且启动时打印警告。

**Origin/Host 正负测试矩阵（实现与验收共用）：**

| # | 场景 | Origin | Host | 期望 |
|---|---|---|---|---|
| 1 | 桌面壳同源 GET | `http://127.0.0.1:<随机端口>` | `127.0.0.1:<随机端口>` | 允许 |
| 2 | `ateam serve` 同源 | `http://127.0.0.1:8787` | `127.0.0.1:8787` | 允许 |
| 3 | 开发代理 | `http://127.0.0.1:5173` | `127.0.0.1:8787` | 允许（仅开发白名单） |
| 4 | 跨端口 | `http://127.0.0.1:5174` | `127.0.0.1:8787` | 403，无 ACAO |
| 5 | localhost 与 127.0.0.1 互换 | `http://localhost:8787` | `127.0.0.1:8787` | 允许（白名单含两种写法） |
| 6 | 不透明来源 | `null` | `127.0.0.1:8787` | 403 |
| 7 | HTTPS 页面 | `https://evil.example` | `127.0.0.1:8787` | 403 |
| 8 | 外部站点 | `https://example.com` | `127.0.0.1:8787` | 403 |
| 9 | DNS rebinding | 任意 | `evil.example:8787`（解析到 127.0.0.1） | 403 |
| 10 | Host 端口不匹配 | 无 | `127.0.0.1:9000` | 403 |
| 11 | WS 同源无 ticket（M1） | 同源 | 同源 | 允许（M1 仅 Origin/Host） |
| 12 | WS 无 ticket（M2.1） | 同源 | 同源 | 401，不升级 |
| 13 | WS ticket 复用/过期 | 同源 | 同源 | 拒绝并告警 |
| 14 | WS 跨源 | 外部站点 | 同源 | 拒绝握手 |
| 15 | CLI/curl 无 Origin | 无 | 回环 | M1 允许；M2.1 需令牌 |
| 16 | 预检非法来源 | 外部站点 | 同源 | 403，无 ACAO/ACAM |
| 17 | 桌面壳重启后的旧 Origin | 旧随机端口 | 新随机端口 | 403 |

### 3.3 密钥与凭据管理

M0 现状：Claude adapter 启动子进程时继承 ATeam 进程的完整环境变量。若用户把模型 Key 放在 shell 环境里，Agent 子进程可以读取；ATeam 不做脱敏。

M1 要求：

- **只做脱敏与最小过滤**，不做钥匙串：`SEC-009` 在启动 Runtime 子进程前剥离名称匹配敏感模式的变量（`*_KEY`、`*_TOKEN`、`*_SECRET`、`*_PASSWORD`、`AWS_*`、`GITHUB_TOKEN`、`ANTHROPIC_*` 等），这是拒绝名单，不是完整白名单。用户确需通过环境变量向某个 Agent 提供模型 Key 时，必须在 Agent 配置中显式绑定变量名，绑定时显示风险提示并记录；未显式绑定的敏感变量一律剥离。
- 日志与事件脱敏（SEC-071）：常见 Key 模式（`sk-`、`ghp_`、`xoxb-`、Bearer token、JWT、私钥块等）在写入 RunEvent、错误消息、证据前必须掩码。
- 明确区分三类凭据：Runtime 自身登录态（如 Claude Code 的本地配置）、模型 API Key、Git/部署凭据。三者生命周期与存储方式不同，不得混为一个「环境变量大礼包」。

M2.1 要求：

- 环境变量白名单（SEC-012）：Agent 只能继承显式列出的变量，敏感名称默认不继承。
- 操作系统钥匙串（SEC-013）：macOS Keychain、Windows Credential Manager、Linux Secret Service（libsecret）。数据库只保存 `secret_ref`，不保存明文。
- Keychain 不可用或锁定时，提示用户解锁或选择「仅本次会话使用」的内存凭据；**不得回退到明文文件**。Linux 上 libsecret 不可用时，允许列表中的替代后端（加密文件 + 主密码，或仅内存）仍待确认（§22 #2），但「明文回退」不在任何选项中。
- 凭据按 Agent 与 Runtime 绑定，默认不跨 Agent 继承。同一用户的不同 Agent 若需要同一 Key，必须显式引用同一 `secret_ref`。
- API 创建 Secret 后只返回 ID、名称、创建时间与最后使用时间；不提供「查看明文」接口。轮换覆盖写入并记录审计。
- **Secret 轮换与撤销语义（SEC-078）**：轮换只影响新建 Run，已启动的 Run 保留启动时解析的环境值直至进程结束；撤销立即使新 Run 无法解析该引用，并提示受影响的 Agent；绑定到运行中 Run 的临时值在 Run 结束、取消或超时后清除，不写盘。M3 Runner 的 Secret 租约到期即失效，控制面可提前撤销租约，Runner 在下一次心跳（≤45 秒）内生效。
- M3 团队 Secret 存放在服务端加密存储中，Runner 通过短期租约获取，租约绑定 Job、机器与过期时间；控制面不得把明文 Secret 写入日志或审计。

### 3.4 本地文件与数据库权限

M1 要求：

- `~/.ateam` 及其子目录以 `0700` 创建；SQLite 文件及 `-wal`/`-shm` 以 `0600` 创建或修正。
- 启动时检查数据目录权限；若组或其他用户可读，打印修复建议并以非零状态退出，或在用户确认后自动修复（默认不自动改）。
- Run Workspace 目录权限为 `0700`；证据文件默认 `0600`。
- 在共享机器（多用户）上首次启动时，给出「建议使用独立 OS 用户或全盘加密」的提示，并把该选择记录到本地设置。
- 数据库备份必须提醒用户备份文件同样包含机密数据。

## 4. 权限模型

### 4.1 单一用户阶段（M0-M2）

M0-M2 是单用户本地模式：没有登录、没有角色，所有操作者被视为同一个本地用户。此时权限模型的重点不是「谁能做什么」，而是「Agent 能做什么」：

- 用户可以创建、修改、删除 Task/Agent，启动 Run，取消 Run。
- Agent 的权限信封由用户配置，并在 Run 启动时固化到该 Run 的快照中；Run 执行期间修改 Agent 配置不影响已启动的 Run，只影响下一次 Run。
- 删除保护分阶段：**M1** 只做二次确认、显示影响面，并在存在 `queued`/`preparing`/`running` Run 或未关闭 Review 时阻止删除（确认后归档）；**M2.1** 起 Task 与 Agent 的归档进入 30 天恢复窗口与回收站；**M3** 起 Team Workspace 删除要求双人审批。
- 本地模式仍然记录操作者字段，值为本地用户名与机器标识，为 M3 迁移做准备；但不得把它当作安全认证。

### 4.2 角色词表与作用域模型（M3）

M3 引入组织（Organization）→ Team Workspace → 成员（Member）→ 角色（Role）。本章中「Team Workspace」特指团队资源边界，避免与 Run Workspace（隔离工作区）混淆。

**权威词表只有两层，各四个角色：**

| 层级 | 角色 | 说明 |
|---|---|---|
| 组织级 | Owner | 组织所有者；组织设置、成员与角色、Runner、全部 Team Workspace、删除组织、转移所有权 |
| 组织级 | Admin | 管理员；成员管理、Runner 管理、共享 Agent、审计查看、安全设置 |
| 组织级 | Member | 组织成员；默认无任何 Team Workspace 访问权，需被加入具体 Team Workspace 并获得成员角色 |
| 组织级 | Viewer | 组织只读成员；只能查看被显式授权的只读范围 |
| Team Workspace 级 | Admin（workspace_admin） | Team Workspace 管理员；管理本 workspace 成员、设置、共享 Agent 与合并审批 |
| Team Workspace 级 | Contributor | 开发者；创建/编辑 Task、使用可见 Agent 启动 Run、查看本 workspace 的 Run 与证据 |
| Team Workspace 级 | Reviewer | 评审者；查看 Task/Run/证据、评论、在被指派时审批合并；不能编辑 Agent 权限 |
| Team Workspace 级 | Viewer | 只读成员；只读查看被授权的 Task、Run 摘要与 Agent 描述 |

组织 Owner/Admin 自动在所有 Team Workspace 拥有 workspace_admin 能力；组织 Member 只有被加入 Team Workspace 后才获得 contributor/reviewer/viewer 之一。

**其他文档称谓的映射（下一轮 PRD 统稿时按此改写，不再新增角色名）：**

| 其他文档中的称谓 | 本章规范映射 |
|---|---|
| roadmap 的 owner / admin / member / viewer | 组织级 Owner / Admin / Member / Viewer |
| task-management 的 Owner / Admin / Member / Viewer | 同上 |
| collaboration-and-review 的 owner / admin / member / viewer | 同上；其中「被指派 reviewer 的 member」指本 workspace 的 Reviewer |
| ui-ux 界面角色 Viewer / Contributor / Reviewer / Admin / Owner | Team Workspace Viewer / Contributor / Reviewer，组织 Admin / Owner |
| user-flows 的 Maintainer | Team Workspace 的 workspace_admin（或组织 Admin） |
| user-flows / ui-ux 的 Operator（独立开发者） | Team Workspace Contributor；在单用户模式下无角色概念 |
| collaboration-and-review 的 design owner / backend owner / DevOps owner | Task 级指派标记，不是角色，不授予额外权限 |

作用域规则：

- 每个 Task、Agent、Run、Artifact、Approval、审计事件都携带 `organizationId` 与 `teamWorkspaceId`（本地模式使用固定值 `local`）。
- 所有 API 查询必须先按成员关系过滤，再做资源查询；禁止「先按 ID 查询再判断权限」造成的枚举侧信道。
- 跨 Team Workspace 访问的响应语义见 §4.6。
- Agent 的可见性分为 `private`（仅创建者）、`team`（Team Workspace 内可见）、`shared`（组织内可见）。只有可见的 Agent 才能被启动。
- 共享 Agent 的编辑权归 workspace_admin 及以上；Reviewer 与 Contributor 只能使用，不能改权限信封。
- 组织删除、Owner 转移、Team Workspace 删除属于最高风险动作，需要二次审批与重新认证。

### 4.3 角色授予、撤销与防提权

M3 必须定义「谁可以授予/撤销哪个角色」，否则权限矩阵无法落地：

| 操作者 | 可授予 | 可撤销 | 禁止 |
|---|---|---|---|
| 组织 Owner | 组织 Admin、Member、Viewer；任意 Team Workspace 角色；转移 Owner（需二次确认 + 重新认证） | 任意组织角色与 Team Workspace 角色（最后一名 Owner 除外） | 无 |
| 组织 Admin | 组织 Member、Viewer；Team Workspace 任意角色（含 workspace_admin） | 组织 Member、Viewer；Team Workspace 任意角色 | 授予/撤销组织 Admin、授予 Owner、修改自己的组织角色、移除最后一名 Owner |
| workspace_admin | 本 workspace 的 Contributor、Reviewer、Viewer | 同上 | 授予/撤销 workspace_admin（需组织 Admin 及以上）、访问其他 workspace |
| 其他角色 | 无 | 无 | 任何角色变更 |

规则：

1. **防提权**：任何非 Owner 不得授予与自己同级或更高的角色；Admin 不能自升为 Owner，不能把自己的角色改为 Owner。
2. **最后一名 Owner 保护**：当组织只有一名 Owner 时，禁止其退出组织、降级自己或删除组织；Owner 转移必须指定另一名已存在的 Admin/Member 并完成重新认证。
3. **破窗与恢复**：Owner 全部失联时，使用本地恢复码（M3 首次创建组织时生成、离线保存）或受控恢复流程恢复访问；恢复本身产生高优先级审计与告警，且不能绕过审计。
4. 角色变更即时生效：提升权限对新请求立即生效；降低权限时，已启动 Run 的快照不变，但新请求立即受限。
5. 角色授予/撤销全部审计（SEC-053），并在成员页面显示「上次修改人/时间」。

### 4.4 Agent 可见性

| 可见性 | 可查看 | 可启动 | 可编辑 | 可查看凭据引用 | 说明 |
|---|---|---|---|---|---|
| private | 创建者 | 创建者 | 创建者 | 创建者（掩码） | 个人草稿 |
| team | Team Workspace 成员 | Contributor 及以上 | workspace_admin 及以上 | workspace_admin 及以上 | 团队标准 Agent |
| shared | 组织内被授权的 Team Workspace 成员 | 被授权 workspace 的 Contributor 及以上 | 组织 Admin 及以上 | 组织 Admin 及以上 | 跨团队复用 |

可见性变更必须审计。将 Agent 从 `private` 提升到 `team`/`shared` 时，系统必须提示「该 Agent 的 instructions、默认权限与绑定的 Secret 引用将对更多人可见」，并要求确认。共享 Agent 不得携带创建者的私有 Secret 绑定；升级可见性时若存在私有绑定，必须先解绑或改为团队 Secret。

### 4.5 权限矩阵

**组织级能力（M3）：**

| 动作 | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| 查看组织设置 | 是 | 是 | 只读摘要 | 否 |
| 创建/归档 Team Workspace | 是 | 是 | 否 | 否 |
| 管理成员与角色 | 是 | 是（受 §4.3 限制） | 否 | 否 |
| 管理 Runner | 是 | 是 | 否 | 否 |
| 查看团队审计 | 是 | 是 | 否 | 否 |
| 导出团队审计 | 是 | 是 | 否 | 否 |
| 修改组织安全设置 | 是 | 是 | 否 | 否 |
| 删除组织 / 转移 Owner | 是（双人审批 + 重新认证） | 否 | 否 | 否 |

**Team Workspace 能力（M3）：**

| 动作 | workspace_admin | Contributor | Reviewer | Viewer |
|---|---|---|---|---|
| 查看 Task / Run / 证据 | 是 | 是 | 是 | 是 |
| 创建/编辑 Task | 是 | 是 | 是 | 否 |
| 删除 Task（软删除） | 是 | 仅自己创建 | 否 | 否 |
| 创建 Agent | 是 | 是（private） | 否 | 否 |
| 编辑 Agent 权限 | 是（team） | 仅自己 private | 否 | 否 |
| 启动 Run | 是 | 是 | 是 | 否 |
| 取消 Run | 是 | 自己启动的 | 自己启动的 | 否 |
| 审批合并（被指派时） | 是 | 否 | 是 | 否 |
| 审批 staging 部署 | 是 | 否 | 否 | 否 |
| 审批 prod 部署计划 | 否（组织 Owner/Admin，或被组织策略显式授权） | 否 | 否 | 否 |
| 管理本 workspace 成员 | 是 | 否 | 否 | 否 |
| 查看审计 | 否（审计是组织级能力） | 否 | 否 | 否 |

矩阵是默认策略；组织可以在 M3 后期提供「自定义角色」，但本章不要求。任何放宽默认策略的配置都必须审计。矩阵之外的动作一律拒绝。

### 4.6 跨作用域访问的响应语义

统一策略：

- **资源不可见**（不在调用者的组织/Team Workspace 作用域内，或存在性本身敏感）→ 返回 **404**，错误体与「真正不存在」完全一致，不泄露资源是否存在。
- **资源可见但角色不足**（能确认资源在调用者可见范围内，但当前角色无权执行该动作）→ 返回 **403**，并说明所需角色与申请方式。
- 错误体不包含资源名称、创建者、成员列表等可用于枚举的信息；错误码使用 `NOT_FOUND` 与 `FORBIDDEN` 两档，details 中只允许包含调用者自己的角色与所需角色。
- 该策略同步适用于 §16、SEC-033、US-08 与 AC-SEC-07；其他文档出现「404 或 403」的表述一律按此替换。

## 5. 高风险动作与人工审批

### 5.1 高风险动作清单

| 动作 | 为什么高风险 | 默认处理与批准记录绑定字段 | 里程碑 |
|---|---|---|---|
| 合并到受保护分支 | 改变主干代码，影响所有人和发布 | Review 通过 + 显式确认 + MergeRecord（actor、目标分支、head SHA、diff 哈希、时间）；M2.1 起改用 Approval | M1 |
| 推送到远端 | 代码离开本机，可能覆盖远端分支 | Approval 必须绑定 remote + ref + commit SHA；人工在 UI 触发也生成一条 approved 的 Approval | M2.1 |
| 强制推送 | 可不可逆地改写远端历史 | 独立 Approval（`force=true`），要求填写理由与受影响分支说明 | M2.1 |
| 删除远端分支/标签 | 丢失协作者引用与审计线索 | 独立 Approval，绑定 remote + ref + 目标 commit | M2.1 |
| 修改远端地址或凭据绑定 | 可把推送引向攻击者仓库 | 显式确认 + 审计；涉及凭据更换时要求重新认证 | M2.1 |
| 部署到 staging | 影响共享测试环境 | workspace_admin 审批 + 部署计划指纹 | M2.1 |
| 部署到 prod | 影响真实用户与生产数据 | 只审批「生产部署计划」并记录；执行由人在 ATeam 之外完成，结果人工回填；不保存生产凭据 | M2.1 |
| 删除 Task | 丢失上下文与历史 | M1：确认 + 有活跃 Run 时阻止 + 归档；M2.1：30 天恢复窗口 | M1/M2.1（SEC-023/028） |
| 删除 Agent | 丢失可复用配置，可能影响正在运行的 Run | M1：确认 + 阻止有活跃 Run + 归档；M2.1：30 天恢复窗口 | M1/M2.1 |
| 删除 Team Workspace | 丢失团队全部资源 | 双人审批 + 输入名称确认 + 7 天回收站 | M3 |
| 删除组织 / 转移 Owner | 组织级不可逆或高影响变更 | 双人审批 + 重新认证 + 最后一名 Owner 保护 | M3 |
| 删除 Runner | 中断正在执行的任务 | Admin 审批 + 租约回收 | M3 |
| 扩大 Agent 权限 | 可能突破原有安全边界 | 显式确认 + 审计；跨级扩大需 Approval | M2.1 |
| 轮换/撤销 Secret | 可能中断运行中任务或暴露旧值 | 创建者或 Admin + 审计 + 影响面提示 | M2.1 |
| 修改安全设置 | 改变全局防线 | Admin 权限 + 审计 + 可选二次审批 | M3 |
| 创建/撤销 Runner 注册令牌 | 影响机器信任 | Admin 权限 + 审计 | M3 |
| 导出审计日志 | 可能带出敏感元数据 | Admin 权限 + 审计 | M3 |

### 5.2 统一 Approval 实体与状态机

审批对象（Approval）是独立实体，字段与状态机以 `prd/02-domain-model.md` §3.11 与 §4.6 为准，本章不另立定义。与 `collaboration-and-review.md` 第 8 章的 Gate 是**同一实体**：Gate 是面向协作场景的视图，Approval 是数据与治理层的实体名。

关键字段（API/事件使用 camelCase；SQLite 列名使用 snake_case，与 api-and-data 一致）：

- `id`、`workspaceId`（本地模式固定 `local`）
- M3 扩展：`organizationId`、`teamWorkspaceId`（本地模式为 `local`）
- `actionType`：以 `prd/modules/api-and-data.md` §5.9 的权威枚举为准（共 20 类，含 `design_review`、`api_contract_review`、`crew_plan`、`contract_break`、`high_risk_command`、`scope_change`、`destructive_operation`、`organization_delete`、`owner_transfer`、`runner_revoke`、`secret_rotate` 等）；本章不维护第二套枚举
- `targetType`、`targetId`
- `actionFingerprint`：动作参数规范化后的 SHA-256，必须覆盖动作类型、目标 ID、commit SHA、diff 哈希、remote、ref、环境、部署目标、命令或参数
- `summary`、`riskLevel`
- `requestedBy`、`requestedAt`
- `evidenceSnapshotId` / `requiredEvidence`：证据清单与冻结快照（与 collaboration §8 一致）
- `status`、`decidedBy`、`decidedAt`、`reason`、`expiresAt`、`consumedAt`、`createdAt`

**状态机（唯一版本）：**

| 状态 | 含义 | 终态 |
|---|---|---|
| `pending` | 等待人类审批；`requested` 是输入别名 | 否 |
| `approved` | 已批准，尚未消费 | 否 |
| `rejected` | 已拒绝 | 是 |
| `expired` | 超时失效 | 是 |
| `cancelled` | 请求者撤回或被系统关闭；`revoked` 是输入别名 | 是 |
| `consumed` | 已用于执行对应动作 | 是 |

转换：`pending → approved/rejected/expired/cancelled`；`approved → consumed/expired/cancelled`。执行失败时是否消费见 §5.3 第 8 条。

### 5.3 审批规则、时效与执行

1. **一条审批只对应一次具体动作**。动作执行后状态变为 `consumed`，不能复用。
2. **内容变化即失效**。合并与推送审批绑定 commit SHA；分支出现新提交后，旧审批自动变为 `expired`，必须重新审批；执行时 `actionFingerprint` 不匹配返回 412。
3. **审批有效期**：merge 24 小时、staging 4 小时、prod 30 分钟且不允许「不自动过期」、其他动作（含 push、删除类）72 小时。组织可缩短期限，不可无限延长；到期未消费即 `expired`，计划指纹变化同样立即失效，且每次执行前重新校验。
4. **审批可撤销**。请求者或 Admin 可以在执行前把状态改为 `cancelled`；已消费的审批不可撤销，只能走回滚流程。
5. **拒绝必须留痕**。拒绝原因进入任务时间线与审计；请求者可以修改内容后重新发起，但不能复用旧审批。
6. **超时清理**。后台任务把过期审批标记为 `expired` 并广播事件；不得静默删除。
7. **审批与执行分离**。审批通过不等于自动执行；执行动作仍由 ATeam 在权限校验后完成，并记录执行结果。
8. **执行幂等与失败处置**：执行请求必须携带幂等键；无副作用的失败（校验失败、连接失败）不消费审批，允许同一审批重试；已产生部分副作用时立即标记 `consumed` 并记录 `executionResult=failed`，重试需要新的审批，系统不得自动重试高风险动作。
9. **人工触发不豁免**。人在 UI 中直接执行合并/推送/部署时，系统必须即时生成 approved 状态的 Approval（或 M1 的 MergeRecord），记录 actor、target、content fingerprint 与时间，再执行动作。
10. **审批视图独立**。审批人必须打开证据清单并逐项确认；合并、prod、contract_break 不允许批量审批。

### 5.4 职责分离与 prod 部署

- M1-M2 单用户模式下，用户既是请求者也是审批者，但 UI 必须明确显示「你正在批准自己的操作」，并要求二次确认。
- M3 起，prod 计划审批与 Team Workspace 删除要求请求者与审批者不是同一人；Owner 可以在紧急情况下自批，但必须填写理由并触发高优先级审计告警。
- DevOps Agent 在 M2 只能：生成部署计划、执行 staging 部署、收集证据、提出 prod 部署计划请求。**prod 部署由人在 ATeam 之外执行**，ATeam 不提供 Agent 执行 prod 的开关，也不保存生产凭据；ATeam 只记录计划审批与人工回填的执行结果、执行人、时间与版本。原稿中的「通过 ATeam 的人工执行流程」不作为需求。
- 合并动作必须由人类在 Review 界面触发；Agent 可以准备分支、运行测试、生成摘要，但不能调用合并接口。
- 所有审批决定在 M3 要求重新认证（密码、系统生物识别或团队 SSO 重新确认）；M2.1 至少要求显式勾选「我理解该操作的影响」。

### 5.5 删除与数据保留

- **M1**：删除 Task/Agent 需二次确认并显示影响面；存在 `queued`/`preparing`/`running` Run 或未关闭 Review 时阻止（`409 RESOURCE_IN_USE`）；确认后执行归档（写 `archivedAt`），不提供硬删除；审计在 M2.1 起覆盖。
- **M2.1**：Task/Agent 的删除/归档统一复用 `archivedAt`（不新增 `deletedAt`），默认保留 30 天，期间 workspace_admin 可以恢复；到期且无引用时由清理任务物理删除。恢复端点见 §15.2。
- **M3**：Team Workspace 删除需要 Owner/Admin 双人审批，并要求输入 Team Workspace 名称；删除后进入 7 天回收站，再物理删除。
- Run 的 Workspace 在 Run 完成、合并或放弃后按保留策略清理；清理前必须保留证据索引。
- 数据库备份、审计导出、证据归档都必须遵循同一保留策略；产品提供「立即删除我的数据」的本地模式入口。

**统一数据保留表（与 api-and-data §9.5、non-functional-requirements、02 §16 同一口径）：**

| 数据 | 默认保留期 | 清理方式 | 里程碑 |
|---|---|---|---|
| `run_events` | Run 结束后 90 天（可配置 30-365 天）；每 Run 20,000 条或 50 MB 容量上限 | 按 Run 或按时间清理 | M1 |
| Run Workspace / worktree | 已合并或放弃后 30 天；未合并改动不得自动删除 | 显式清理 + 二次确认；保留证据索引 | M1 |
| Artifact | 90 天（可配置 30-365 天） | 到期清理，审计保留索引 | M1 |
| Evidence | 90 天 | 到期清理，审计保留索引 | M2 |
| 回收站（归档/软删除 Task/Agent） | 30 天 | 到期且无引用后物理删除 | M2.1 |
| 本地审计 | 90 天 | 轮转 + 到期删除，清空需审计 | M2.1 |
| 团队审计 | 180 天（可配置 90 天-3 年） | 归档或删除需审批 | M3 |
| 本地遥测 | 默认关闭；开启后 30 天或直到用户删除 | 用户可导出与删除 | M4 |
| 数据库备份 | 最近 5 份 | 新备份成功后删除最旧 | M1 |
| Secret | 直到显式删除/轮换 | 删除即不可恢复 | M2.1 |

删除操作必须审计（M2.1 起），包含操作者、资源快照、Approval ID、结果；审计记录本身不随资源删除而删除。

## 6. Agent 权限信封

Agent 权限信封是 ATeam 对「Agent 能做什么」的可执行定义，至少包含：允许路径、允许命令、环境变量白名单、凭据引用、Runtime 权限模式、网络访问意图。权限信封在 Run 启动时生成快照，写入 Run 事件，并在 UI 中可查看。

### 6.1 策略 schema 与匹配语义（总则）

- 权限信封使用**版本化 schema**（`agent.permissions.v1`），字段包括 `allowedPaths`、`externalReadOnlyRoots`、`allowedCommands`、`envAllowlist`、`secretRefs`、`runtimeMode`、`networkIntent`、`onViolation`。schema 变更走 `contract_break` 式兼容规则：新增可选字段可向后兼容，语义变更必须升版本。
- **执行位置**：策略由 Go core（调度器、Workspace、命令执行边界）强制执行；对不支持工具级策略的 Runtime，降级为 advisory，并在 UI 标注隔离等级（见 §6.5）。提示词中的「不要这样做」不构成安全边界。
- **违规处理（fail-closed）**：任何写入类或命令类违规默认终止 Run（状态 `failed`，`errorCode=POLICY_DENIED`）。只有 `read` 类违规允许 Agent 策略显式配置 `deny_and_continue`；写与命令违规不可配置为继续。
- **可测试性**：每条规则必须能写出确定的正例与反例；拒绝事件包含规则 ID，便于回归测试。

### 6.2 允许路径

- `allowedPaths` 条目为 `{path, mode: read|write, note}`，路径相对 Workspace 根目录解析；默认不允许工作区之外的任何读写。
- 需要读取工作区外路径（如只读依赖缓存）时，必须通过独立的 `externalReadOnlyRoots` 显式声明，并强制 `read-only`；不得把外部绝对路径混入 `allowedPaths`。
- **glob 方言（v1）**：分隔符 `/`；`*` 匹配段内任意字符（不含 `/`）；`**` 匹配任意层目录；`?` 匹配单个非分隔符字符；不支持 `{}` 花括号、`[]` 字符类与 extglob（出现即配置错误）。模式必须为相对路径，大小写敏感。
- **前缀边界**：以 `/` 结尾的模式（如 `src/`）按目录前缀匹配，必须在路径段边界成立：`src/` 匹配 `src/a.go`，不匹配 `src2/a.go`；无通配符且不以 `/` 结尾的模式按精确路径匹配。
- **规范化顺序**（任何一步失败即拒绝）：
  1. 拒绝含 NUL 字节的路径；
  2. 拒绝绝对路径、Windows 盘符（`C:`）、UNC 路径（`\\server\share`）、`~` 展开；外部只读根走 `externalReadOnlyRoots`；
  3. 统一分隔符为 `/`（Windows 接受 `\`）；
  4. 用 `path.Clean` 解析 `.` 与 `..`，若结果逃出工作区根目录则拒绝；
  5. 对已存在的最深前缀做 `realpath` 解析；不存在部分校验其父目录的 `realpath`；
  6. 在大小写不敏感的文件系统上，以 `realpath` 返回的真实大小写与模式比较；
  7. 最终确认真实路径位于允许根目录内（与 glob 匹配结果独立复核，防止双重缺陷互相掩盖）。
- **示例与反例**：

| 规则 | 路径 | 结果 | 原因 |
|---|---|---|---|
| `src/**` | `src/a/b.go` | 允许 | 匹配 |
| `src/**` | `src2/a.go` | 拒绝 | 段边界不成立 |
| `src/` | `src/a.go` | 允许 | 目录前缀 |
| `src/` | `src2/a.go` | 拒绝 | 段边界不成立 |
| 任意 | `src/../../etc/passwd` | 拒绝 | clean 后逃出根目录 |
| 任意 | `C:\Windows\System32` | 拒绝 | 盘符绝对路径 |
| 任意 | `\\server\share\x` | 拒绝 | UNC |
| `src/**`，`src/link → ~/.ssh` | `src/link/id_rsa` | 拒绝 | realpath 在允许根之外 |
| `src/**` | `SRC/A.go`（真实文件为 `src/A.go`） | 允许 | realpath 返回真实大小写后匹配 |

- `.git` 目录默认只允许 ATeam 的 git 操作访问，Agent 不得改写 `.git/hooks`、`.git/config` 中的远端凭据。
- 写入证据、日志、临时文件的系统目录由 ATeam 管理，不计入 Agent 的允许路径；Agent 不得写入这些目录。
- 路径规则变更必须审计；扩大规则需要用户确认，并在 UI 中展示新增范围。

### 6.3 允许命令与仓库信任

- `allowedCommands` 条目为 `{executable, args, cwd, env, timeout, note}`；`args` 是 argv 模式列表，支持精确 token 与受限占位符（如 `{pkg}` 必须匹配 `^\./[\w./-]+$`）。整段 shell 字符串不是合法的条目。
- **匹配算法**：
  1. 在 Run 启动时解析并记录可执行文件的真实路径（不允许执行过程中 PATH 变化影响同一 Run）；
  2. `argv[0]` 必须与声明的可执行文件匹配（basename + 记录的真实路径）；
  3. 其余 argv 必须逐项匹配允许模式；任何未匹配参数导致拒绝，不做前缀截断或模糊匹配；
  4. `cwd` 必须在 Workspace 内且匹配条目约束；
  5. 注入的环境变量必须是 Run 环境与条目白名单的子集。
- **shell 禁用**：默认不允许 `sh -c`、`bash -c`、`cmd /c`、`powershell -Command` 等组合命令；需要 shell 的场景必须作为显式「高风险模板」配置，并触发 `high_risk_command` 审批。
- **可执行文件信任（SEC-075）**：优先使用配置的绝对路径；通过 PATH 解析时必须记录解析结果并在设置页展示，检测到 PATH 被修改或解析到非预期目录时告警；可选择固定可执行文件哈希，版本变化后要求确认。
- **仓库信任动作**：`go test`、`pnpm test`、`pnpm typecheck` 等会执行仓库内的测试二进制、构建脚本与生命周期脚本，等价于执行仓库代码。每个仓库首次运行此类命令前，必须显式确认「信任该仓库的构建/测试脚本」，信任记录绑定仓库路径与初始 commit；`package.json` 的 `scripts` 或构建配置变化时提示重新确认。未确认时命令被拒绝。
- **子进程与网络限制**：argv 白名单不能约束被允许命令派生的子进程。`pnpm install`、`go mod download`、`curl`、`wget`、`ssh`、`scp`、`rsync`、包管理器发布命令默认拒绝；网络隔离需要 Runtime 沙箱或显式策略，M0-M2 不承诺。该限制必须写入威胁模型与 UI 说明，见 T-06/T-21。
- 不在白名单的命令被拒绝；如果 Agent 认为必要，可以生成「命令审批请求」，由人决定是否临时允许一次，临时许可绑定 Run 与命令哈希，单次使用、到期失效，并写入审计。
- 命令执行的工作目录必须在 Workspace 内；执行超时与输出上限由 Agent 配置和系统上限共同约束。
- 所有命令拒绝与批准都写入 RunEvent；M2.1 起同时写入本地审计。

### 6.4 环境变量与凭据隔离

- M1 只做拒绝名单最小过滤（SEC-009）；M2.1 起 Agent 默认只继承最小环境：`PATH`、受控 `HOME`、临时目录、语言运行时必要变量；其他变量必须显式列入 `envAllowlist`。
- **受控 HOME**：Run 默认使用 `~/.ateam/workspaces/runs/<run-id>/home` 作为 `HOME`/`USERPROFILE` 与临时目录，避免 Runtime 直接读取用户真实家目录中的 `~/.ssh`、`~/.aws` 等凭据。Runtime 自身登录态需要真实配置目录时，必须通过显式、只读的 `runtimeConfigPaths` 绑定，并在 UI 说明影响。
- 任何名称匹配敏感模式（`*_KEY`、`*_TOKEN`、`*_SECRET`、`*_PASSWORD`、`AWS_*`、`GITHUB_TOKEN` 等）的变量默认不继承，除非绑定到显式凭据引用。
- 凭据引用在启动 Run 时解析为短期环境变量或 `0600` 临时文件，Run 结束、取消或超时后清除；不得写入磁盘持久环境。
- 不同 Agent、不同 Run 之间的凭据不共享；同一 Team Workspace 的共享 Agent 也不能把凭据暴露给运行者。
- 日志、RunEvent、错误、证据、审计中的凭据必须掩码；掩码规则集中管理，支持自定义正则。
- M3 Runner 上的凭据由控制面按租约下发，租约到期自动失效；Runner 本地不得持久化明文。

### 6.5 Runtime 权限参数与二进制信任

- Runtime adapter 必须声明能力：是否支持路径策略、命令策略、工具白名单、非交互模式、流式事件、取消。UI 根据能力显示「隔离等级」：`enforced`、`partial`、`advisory`。
- M1 的 Claude adapter 必须显式传入非交互与权限相关参数，并在 RunEvent 中记录实际生效的模式；默认不得使用跳过权限检查的危险参数。
- **版本探测与降级（SEC-077）**：adapter 在启动前探测 Runtime 版本；版本不兼容或不可用时给出可操作的错误（安装指引、登录指引、支持版本范围），不得静默降级。模型服务不可达时，Run 以可分类错误结束，并保留原始 stderr 摘要用于诊断。
- 对不支持细粒度权限的 Runtime，ATeam 至少通过工作目录、环境变量、命令审计和审批做补偿，并在 UI 中明确提示「该 Runtime 仅提供目录级隔离」。
- Agent 配置中的模型选择只影响 Runtime 调用，不影响权限信封；切换模型不得自动扩大权限。

### 6.6 权限拒绝的反馈

每次拒绝返回结构化信息：

- `code`：如 `PATH_OUTSIDE_WORKSPACE`、`SYMLINK_ESCAPE`、`COMMAND_NOT_ALLOWED`、`ENV_NOT_ALLOWED`、`SECRET_UNAVAILABLE`、`APPROVAL_REQUIRED`、`POLICY_DENIED`。
- `message`：人类可读原因，不包含敏感值。
- `resource`：被拒绝的路径或命令（已脱敏）。
- `remediation`：如何修改 Agent 配置或申请审批。
- `ruleId`、`runId`、`agentId`、`createdAt`。

拒绝事件必须进入 Run 时间线；M2.1 起同时写入本地审计。相同 Run 内重复拒绝应聚合，避免日志刷屏。

### 6.7 会话 Agent 的只读边界（M2.3）

Agent Team 会话是讨论层，必须与执行层的权限信封保持同等严格：

- 会话 Agent 固定使用 `read_only` 权限模式；禁止 Write/Edit/NotebookEdit 与 Bash；
- 工作目录为独立临时草稿目录，不得指向任何仓库、worktree 或 Workspace 根目录；
- 会话 Agent 不创建 Run、不产生 Artifact、不修改 Task 状态；用量只记录到消息的 `usage`；
- 会话 Agent 继承 SEC-009/SEC-012 的环境变量过滤与脱敏规则，不获得额外凭据；
- 路由器只做选择，不执行代码、不写仓库；路由输入中的仓库或消息内容视为不可信；
- Agent 消息不参与路由、不触发其他 Agent；服务端不得因 Agent 输出而自动创建下一条用户消息；
- 会话消息正文按 Markdown 渲染并消毒，禁止原始 HTML；路由标签、成员名与 rationale 在渲染前转义。

M2.3 不承诺对抗本机恶意进程；它保证的是「会话功能本身不会成为绕过执行层权限的侧门」。

### 6.8 Agent 工作页与 Run 快照（M2.4）

Agent 工作页是只读观察面，但会集中展示 Task、Agent 配置、Workspace 与事件，必须按最小暴露原则处理：

- `GET /agents/{id}/work` 只返回工作状态、Run 摘要与计数，不返回 Agent instructions 全文、凭据或完整 prompt；
- `GET /runs/{id}/snapshot` 返回配置快照的脱敏视图：**instructions 允许返回，但必须按 SEC-071 脱敏**；不返回完整拼装 prompt、明文密钥、凭据值与环境变量值；`credentialRefs` 只返回引用 ID；`permissionEnvelope` 只返回白名单名称与意图；
- 工作页不提供编辑 Agent、启动/取消 Run、审批或合并入口；
- 归档 Agent 的工作页历史只读，不提供写操作；
- Task 描述、事件消息与 Artifact 摘要按不可信文本渲染，禁止原始 HTML；
- 工作页只能读取同一 Workspace 的数据；跨 Workspace 的 Agent/Run 引用返回 404，不泄露资源存在性。

M2.4 的脱敏负向测试与 SEC-071 使用同一套敏感模式；任何快照字段新增都必须经过脱敏审查。

## 7. Runner 与机器安全（M3）

### 7.1 注册与身份

- Runner 通过一次性注册令牌加入组织。令牌由 Admin 创建，默认 15 分钟有效、单次使用、绑定组织与可选 Team Workspace。
- 注册时 Runner 生成机器密钥对，私钥保存在本机安全存储；控制面保存公钥与机器 ID。后续认证使用签名挑战，不使用长期共享密钥。
- 机器记录包含：名称、主机名、操作系统、架构、Runner 版本、能力标签（如 `go`、`node`、`docker`）、所有者、注册时间、最后心跳。
- 注册令牌在 UI 中只显示一次；丢失后只能重新创建。创建与使用都写入审计。
- Runner 与控制面之间使用 TLS；Runner 主动外连，不需要开放入站端口。

### 7.2 心跳、租约与失联

- Runner 每 15 秒发送心跳，包含当前负载、运行中的 Job、磁盘余量、版本与能力变更。
- 控制面在 45 秒未收到心跳时标记为 `offline`；90 秒后未续期的租约进入过期，其活跃 Run 置为 `failed`，`errorCode=interrupted`、`failureDetail=runner_lost` 或 `lease_expired`，不自动重派，等待人工决定。不存在 `unknown` 状态。
- Job 通过租约下发，租约有期限与续租机制；同一 Job 同一时间只允许一个有效租约，防止双跑合并。
- Runner 失联恢复后必须重新同步 Job 状态；如果 Job 已产生副作用（如提交、推送），必须由人确认后才能重试。
- 控制面记录每次租约的开始、续租、完成、过期与取消，作为审计的一部分。

### 7.3 共享机器风险

- 共享 Runner（多用户或多团队共用）必须在注册时标注 `shared=true`，并由 Admin 审批；默认拒绝共享。
- 共享 Runner 上，每个 Job 使用独立工作目录与独立临时目录；Job 之间不得复用环境变量、凭据或构建缓存中的敏感内容。
- 产品文档与 UI 必须提示：Runner 机器所有者理论上可以读取运行中的代码与进程内存；敏感任务应使用专用机器。
- 建议使用独立操作系统用户运行 Runner，并启用全盘加密；ATeam 可以检测并提示，但不能强制。
- Runner 的磁盘配额、并发上限与允许的 Team Workspace 由 Admin 配置；超出配额时拒绝新 Job，而不是降级隔离。

### 7.4 撤销与隔离

- Admin 可以立即撤销机器：撤销后控制面拒绝新租约、取消未开始 Job、把运行中 Job 标记为 `failed`（`interrupted/runner_lost`），并广播事件。
- 撤销不会自动删除机器上的代码与凭据；UI 必须提示管理员联系机器所有者清理，并轮换可能暴露的 Secret。
- 被撤销机器再次注册需要新的注册令牌；旧机器 ID 进入黑名单。
- 撤销、重新注册、黑名单变更全部审计；高风险场景（疑似泄漏）触发安全告警。

## 8. 审计与可追溯

### 8.1 审计事件模型

审计事件回答「谁、在什么时候、从哪里、对什么资源、做了什么、结果如何、经过了谁的批准」。字段至少包括：

| 字段 | 说明 |
|---|---|
| `id` | 事件唯一 ID |
| `organizationId` / `teamWorkspaceId` | 作用域；本地模式为固定值 `local` |
| `seq` | 组织内单调递增序号（团队模式）；本地模式为表内自增 |
| `actorType` / `actorId` | human/agent/system/runner；本地模式记录 OS 用户名与机器标识 |
| `action` | 如 `task.deleted`、`agent.permissions_changed`、`approval.approved`、`merge.executed` |
| `resourceType` / `resourceId` | 目标资源 |
| `source` | `ui`、`api`、`automation`、`runner`、`system` |
| `createdAt` | 服务端 UTC 时间 |
| `result` | `success`、`denied`、`failed` |
| `reasonCode` | 失败或拒绝的机器可读原因 |
| `metadata` | 不含机密的补充信息，如分支名、commit SHA、diff 统计、Approval ID |
| `prevHash` / `hash` | 团队模式下的哈希链字段 |

唯一性与索引：团队模式 `UNIQUE(organizationId, seq)`，索引 `(organizationId, createdAt)`、`(resourceType, resourceId)`；本地模式 `id` 主键，索引 `(createdAt)`、`(action)`。审计事件只追加，不提供更新与删除接口。

审计事件必须区分于 `run_events`：`run_events` 是 Run 的执行日志，供调试与回放；审计事件是安全与治理记录，供追责与合规。两者可以互相引用，但不能混为一谈。

### 8.2 本地审计（M2.1）

- 本地模式记录以下事件：Run 创建/启动/取消/完成/失败、权限拒绝、审批请求与决定、合并确认与执行、Task/Agent 删除与恢复、安全设置变更、Runtime 启动失败、Secret 轮换/删除。
- 本地审计写入 SQLite 的 `audit_events` 表，界面在 Run 详情与设置页提供只读列表。
- 本地模式没有多用户身份，`actorId` 为本地用户名；UI 必须标注「本地模式不提供身份认证，审计仅用于自我追溯」。
- 高风险动作（合并、删除、权限扩张）要求审计写入成功后才执行；写入失败则动作失败并提示用户检查磁盘与数据库。
- 本地审计默认保留 90 天；用户可以在设置中调整或立即清空。清空操作本身也要审计（记录清空前的计数与时间）。
- M1 不写 `audit_events`：M1 的合并确认记录在 Review 决定与 MergeRecord 中（操作者、时间、目标分支、head SHA、diff 哈希、结果），作为本地审计的前身；M2.1 起迁移到统一审计表并保留 MergeRecord 引用。

### 8.3 团队审计（M3）

- 团队审计存储在服务端 Postgres，只允许追加；API 不提供更新与删除接口。
- 每条事件计算 `hash = SHA-256(canonical_json(event_without_hash) + prev_hash)`，形成按组织分区的哈希链；定期生成锚点（如每日最后一条哈希）并单独保存。
- 审计查看支持按 actor、action、resource、时间、结果过滤；默认只显示最近 30 天，导出需要 Admin 权限。
- 管理员不能通过产品界面修改历史；数据库管理员理论上可以，但哈希链会暴露篡改。产品不宣称「不可篡改」，只宣称「可检测篡改」。提供 `GET /api/v1/audit-events/verify` 校验链与锚点。
- 审计导出为 JSON/CSV，包含哈希与锚点；导出动作本身产生审计事件。
- 审计保留默认 180 天，组织可以配置为 90 天到 3 年；到期归档或删除必须走审批。分区与轮转策略必须在启用团队审计前定义（SEC-055 定义本地轮转，团队轮转随 SEC-052/054 一并交付）。

### 8.4 审计的完整性、隐私与边界

- 审计不记录完整源代码、完整提示词、凭据明文；默认只记录资源 ID、摘要与哈希。
- 如果业务需要记录 diff 摘要，使用文件列表与统计信息，不写入文件内容。
- **审计查看与导出本身必须被记录**（已决定，不再是可选项）：记录 actor、时间、过滤条件摘要、结果条数与导出格式，只记录元数据，不记录查询结果内容；在隐私说明中向用户披露。该记录不能被普通 Admin 关闭。
- 时钟以服务端为准；客户端时间只作为参考字段，不参与审批有效期计算。
- 审计写入采用异步批量与同步关键事件结合：高风险动作同步写，普通读操作不审计。审计队列积压超过阈值时触发安全告警（SEC-073）。

## 9. 供应链与发布安全

### 9.1 依赖与锁文件

- Go 依赖使用 `go.mod` + `go.sum` 锁定；前端使用 `pnpm-lock.yaml` 锁定；两者必须提交并在 CI 中使用 frozen 模式安装。
- 新增或升级依赖必须经过代码评审，说明用途、许可证、维护状态与替代方案；禁止直接引用未知来源的二进制。
- M1 起在 CI 中运行 `govulncheck` 与 `pnpm audit` 作为告警；M4 起高危与严重漏洞阻断发布。
- 依赖更新采用小步、可回滚的方式；安全更新优先于功能更新。

### 9.2 许可证与原创性

- 项目使用 Apache-2.0；贡献者必须遵守 DCO 与清洁室声明，不提交第三方产品的代码、文档、截图、图标、文案或商标。
- 依赖许可证采用允许列表：Apache-2.0、MIT、BSD-2-Clause、BSD-3-Clause、ISC 等宽松许可证默认允许；GPL、AGPL、LGPL 及未知许可证需要法律评审后才能引入。
- 发布物生成 NOTICE 与第三方许可证清单；不得遗漏传递性依赖的归属信息。
- 仓库中的第三方研究资料不得进入构建、发布物或产品 UI；贡献流程必须能识别并拒绝这类内容。M0 已有 LICENSE、DCO 模板与 NOTICE；CI 自动检查在 M4 前补齐（SEC-063），在此之前由人工评审作为门禁。

### 9.3 构建与产物签名

- 构建工具链版本固定：Go 版本由 `go.mod` 声明，Node 与 pnpm 版本由 CI 与 `packageManager` 字段固定；发布构建只从受保护的提交或标签构建。
- Go 构建使用 `-trimpath`，写入版本与提交信息；前端构建关闭不必要的 sourcemap 外泄（发布包可保留私有符号文件）。
- **签名信任链（必须按序）**：
  1. 构建产物计算 SHA-256，生成 `checksums.txt` 清单；
  2. 对清单文件本身签名，签名身份独立于构建身份（构建账号与签名密钥分离）；
  3. 发布 `artifact + checksums.txt + checksums.txt.sig + 签名公钥/证书链`；
  4. 客户端/更新器先验证清单签名，再验证产物哈希与清单一致；缺任何一步都视为失败。
  原稿「校验和与签名分开发布」不成立，改为上述链式关系，否则两个入口可被独立篡改。
- **密钥轮换与吊销**：签名密钥有明确 key id；轮换期使用旧密钥与新密钥双签；吊销通过发布吊销列表与更新元数据声明，客户端拒绝已吊销 key id 的签名。密钥存放在受控环境，不进入仓库与 CI 日志。
- macOS 产物使用 Developer ID 签名并公证；Windows 产物使用 Authenticode 签名；Linux 产物至少提供校验和，AppImage 提供签名。
- 构建日志保留，记录依赖版本、构建机镜像与提交 SHA；在可行范围内追求可复现构建，至少保证同一提交可重复产出功能等价的产物。SBOM（依赖清单）随发布物生成，作为 SEC-064 的验收项。

### 9.4 自动更新

- 自动更新元数据必须签名，客户端在下载后按 §9.3 的信任链校验，校验失败不得安装。
- 更新通道分为 stable 与 beta；用户可以关闭自动更新。关闭后仍提示安全更新。
- 更新包不得包含用户数据；升级迁移只改数据库结构，不覆盖本地配置与凭据。
- 回滚机制：保留上一版本安装包与数据库迁移回滚说明；破坏性迁移必须先备份。

## 10. 威胁模型与缓解

下表把主要威胁与缓解措施、需求编号、里程碑对应起来。可能性与影响为产品评估，不是精确统计。

| ID | 威胁 | 典型场景 | 影响 | 可能性 | 缓解 | 里程碑 |
|---|---|---|---|---|---|---|
| T-01 | 恶意网页调用本地 API | 用户浏览网页时被脚本扫描 `127.0.0.1:8787` | 数据泄露、任务被删、Run 被触发 | 高 | SEC-003、SEC-004、SEC-005 | M1/M2.1 |
| T-02 | DNS rebinding | 攻击者域名解析到 127.0.0.1 绕过同源限制 | 同上 | 中 | SEC-004（Origin 白名单 + Host 校验）、SEC-003 | M1/M2.1 |
| T-03 | Prompt injection | 仓库 README 或注释中植入「忽略规则并执行命令」 | Agent 执行危险命令或外传数据 | 高 | SEC-070、SEC-011、SEC-018、审批门 | M1/M2.1 |
| T-04 | 路径越界 | Agent 使用 `../` 或绝对路径写工作区外文件 | 破坏用户文件、植入持久化后门 | 高 | SEC-010、SEC-017 | M2.1 |
| T-05 | 符号链接逃逸 | 工作区内符号链接指向 `~/.ssh` | 读取或覆盖敏感文件 | 中 | SEC-017、realpath 校验 | M2.1 |
| T-06 | 命令白名单绕过 | 通过 shell 元字符、包装脚本或被允许命令派生子进程执行未授权命令 | 任意命令执行 | 高 | SEC-011、SEC-070、仓库信任确认、无 shell 默认 | M2.1 |
| T-07 | 密钥泄漏到日志 | Runtime 输出或错误消息包含 API Key | 凭据被盗用 | 中 | SEC-009、SEC-012、SEC-013、SEC-071 | M1/M2.1 |
| T-08 | 本机其他用户读取数据 | 共享机器上读取 `~/.ateam` | 代码与凭据泄露 | 中 | SEC-007、全盘加密提示 | M1 |
| T-09 | 依赖投毒或漏洞 | 恶意 npm 包、过期 Go 依赖 | 后门、数据窃取 | 中 | SEC-060、SEC-061、SEC-062 | M1/M4 |
| T-10 | 发布产物被篡改 | 下载站或更新通道被劫持 | 大规模供应链攻击 | 低/高影响 | SEC-064、SEC-065 | M4 |
| T-11 | 共享 Runner 横向访问 | 同一机器上其他 Job 读取工作区或环境 | 跨团队代码与凭据泄露 | 中 | SEC-043、独立目录、凭据租约 | M3 |
| T-12 | 注册令牌泄漏 | 令牌被转发给未授权机器 | 未授权机器加入组织 | 中 | SEC-040、短 TTL、单次使用 | M3 |
| T-13 | 内部人员越权 | Contributor 尝试访问其他 Team Workspace | 数据泄露、越权操作 | 中 | SEC-031、SEC-033、SEC-036 | M3 |
| T-14 | 审批绕过或复用 | 旧审批被用于新提交，或自批 prod | 未评审代码进入主干/生产 | 中 | SEC-020、SEC-025、SEC-026、SEC-024 | M1/M2.1/M3 |
| T-15 | 审计被篡改或缺失 | 删除审计记录掩盖操作 | 无法追责 | 中 | SEC-050、SEC-052、先审计后执行 | M2.1/M3 |
| T-16 | 数据库或备份泄漏 | 备份文件被拷贝，未加密 | 全部本地数据泄露 | 中 | SEC-007、备份加密建议、SEC-072 | M1 |
| T-17 | 模型服务数据保留 | 提示词包含代码，被第三方留存 | 知识产权与机密泄露 | 中 | SEC-068、BYO Key、SEC-071 | M1 |
| T-18 | 本地端口被恶意进程占用或冒充 | 其他本地进程抢占端口、伪造服务 | 钓鱼、数据截获 | 低 | SEC-008、SEC-069、SEC-003 | M1/M2.1 |
| T-19 | 权限配置错误 | 用户给 Agent 开放整个 home 目录 | 越权面扩大 | 高 | 默认最小权限、SEC-015、UI 警告 | M2.1 |
| T-20 | 审计日志膨胀 | 长期运行产生大量事件 | 磁盘耗尽、性能下降 | 中 | SEC-054、SEC-055、保留策略 | M2.1/M3 |
| T-21 | 仓库脚本/包装器执行 | 被允许的 `pnpm test` 执行恶意 `postinstall` 或测试脚本 | 任意子进程、外传数据 | 中/高 | SEC-011 仓库信任、SEC-070、网络默认拒绝 | M2.1 |
| T-22 | PATH 劫持与假 Runtime | PATH 中放置同名的 `claude` 可执行文件 | 窃取提示词与凭据 | 中 | SEC-075、绝对路径与哈希固定 | M1 |
| T-23 | CSRF / 会话固定（M3 Cookie） | 浏览器 Cookie 被跨站自动携带 | 越权操作 | 中 | SEC-037、SameSite、CSRF token | M3 |
| T-24 | 远程访问暴露面过大 | 用户把服务暴露到公网且认证薄弱 | 未授权访问 | 中 | SEC-038、TLS、速率限制、独立令牌 | M3 |
| T-25 | 组织级破坏操作 | Admin 误删组织、恶意转移 Owner | 团队数据不可恢复 | 低/高影响 | SEC-035、SEC-024、最后一名 Owner 保护 | M3 |
| T-26 | Webhook/自动化重放 | 攻击者重放定时或 Webhook 请求触发 Run | 重复执行、资源消耗 | 中 | SEC-079、签名、时间戳、幂等键 | M4 |
| T-27 | 会话内容驱动越权或自动对话 | 用户在会话中粘贴恶意内容，诱导会话 Agent 写文件、创建 Run 或触发其他 Agent | 绕过执行层权限、连锁调用、数据外泄 | 中 | SEC-081 至 SEC-085、只读执行、Agent 不触发 Agent、消息渲染消毒 | M2.3 |
| T-28 | 工作页与快照泄漏敏感上下文 | 工作页集中展示 Agent 配置、Task 与 Run 事件，快照可能包含 prompt、环境变量或凭据引用 | 凭据、提示词或代码片段泄露 | 中 | SEC-086 至 SEC-088、快照脱敏、字段白名单、只读页面 | M2.4 |

## 11. 角色与场景

| 角色 | 目标 | 关键场景 | 安全关注点 |
|---|---|---|---|
| 独立开发者（单用户模式） | 同时跑 3-5 个 Agent，快速交付 | 本地启动服务、创建 Task、启动多个 Run、审查 diff、合并 | 默认不暴露网络、Agent 不越界、合并前看到证据 |
| 组织 Owner | 对组织和数据负责 | 创建 Team Workspace、邀请成员、配置审批策略、删除资源 | 角色最小化、双人审批、审计可查、最后一名 Owner 保护 |
| 组织 Admin / workspace_admin | 维护团队运行环境 | 管理成员、Runner、共享 Agent、安全设置 | Runner 撤销、Secret 轮换、审计导出、防提权 |
| Contributor | 完成任务 | 使用 Agent、启动 Run、查看日志与证据 | 只能使用可见 Agent、不能自批合并 |
| Reviewer | 把关代码质量 | 查看 diff、评论、批准合并 | 看到真实证据、审批不被复用 |
| Viewer | 只读了解进展 | 查看被授权的 Task、Run 摘要与 Agent 描述 | 只读隔离、不泄露受限数据 |
| DevOps 工程师 | 管理部署 | 创建部署计划、执行 staging、申请 prod 计划审批 | staging 与 prod 分级、prod 人工执行、无生产凭据 |
| 团队审计负责人 | 追溯与响应 | 查询审计、导出报告、调查异常 | 审计完整性、只读权限、查看行为被记录 |
| Runner 机器所有者 | 提供算力 | 注册机器、查看 Job、维护隔离 | 共享风险提示、撤销流程、凭据清理 |
| 恶意网页（对手） | 获取本地数据或触发动作 | 跨域请求、WebSocket 订阅 | 被 CORS/Origin/Host/令牌阻断 |
| 被污染仓库（对手） | 诱导 Agent 越权 | 在源码、脚本中植入指令 | 权限信封、仓库信任与审批阻断 |

## 12. 用户故事与验收标准

### US-01 本地默认安全

**Given** 一名独立开发者首次运行 `ateam serve`，没有提供任何参数
**When** 服务启动完成
**Then** 服务只监听 `127.0.0.1:8787`，同一局域网的其他设备无法连接；UI 不显示远程访问告警。

验收：使用 `lsof -iTCP -sTCP:LISTEN` 或等价工具确认绑定地址为回环；从另一台机器访问失败；传入 `--addr 0.0.0.0` 时启动失败。

### US-02 恶意网页无法驱动本地 API

**Given** 用户浏览器打开一个恶意网页，网页尝试向 `http://127.0.0.1:8787/api/tasks` 发起跨域请求，并尝试连接 `/api/ws`
**When** 请求到达 ATeam
**Then** M1 起，请求因 `Origin`/`Host` 不在白名单被拒绝（403），响应不包含允许该来源的 CORS 头；WebSocket 握手同样被拒绝；M2.1 起，即使构造同源页面，缺少有效会话令牌与 WS ticket 的请求仍返回 401。

验收：按 §3.2 测试矩阵执行；只有白名单来源成功；`Origin: null`、跨端口、外部站点、错误 Host 全部失败；M2.1 下 ticket 复用与过期被拒绝。

### US-03 Agent 越界写被拒绝并终止 Run

**Given** 一个 Agent 的 `allowedPaths` 只包含工作区内的 `src/**` 和 `tests/**`
**When** Agent 尝试写入 `../../.ssh/authorized_keys`，或通过符号链接写入工作区外文件
**Then** ATeam 在写入前拒绝，Run 时间线出现 `PATH_OUTSIDE_WORKSPACE` 或 `SYMLINK_ESCAPE` 事件，Run 以 `failed` 结束（`errorCode=POLICY_DENIED`），目标文件未被修改。

验收：构造包含路径穿越与符号链接的测试仓库；检查目标文件哈希不变；检查 Run 终态为 `failed` 且拒绝事件包含 ruleId 与 remediation。

### US-04 非白名单命令被拒绝并可申请审批

**Given** 一个 Agent 的 `allowedCommands` 只包含测试与只读 git 命令
**When** Agent 尝试执行 `curl https://example.com/upload` 或 `git push`
**Then** 命令被拒绝并记录 `COMMAND_NOT_ALLOWED`；如果策略允许，UI 提供「申请一次性执行」入口，审批通过后仅该命令在该 Run 内可执行一次。

验收：命令拦截日志可见；一次性许可不能跨 Run 复用；拒绝与批准都有审计（M2.1 起）与 RunEvent。

### US-05 合并必须人工确认且绑定 commit

**Given** 一个 Run 完成并产生分支与证据
**When** 开发者点击「合并」
**Then** 系统要求人工评审通过并逐项确认证据，确认页展示 diff 统计、测试证据、目标分支与 head SHA；确认后 ATeam 执行合并，并写入 MergeRecord（操作者、目标分支、head SHA、diff 哈希、时间与结果）；未确认时合并接口返回 403，Agent 身份调用合并接口被拒绝。

验收：直接调用合并 API 被拒绝；MergeRecord 包含 `contentHash` 与 head SHA；合并后可从 Run 详情追溯确认记录与评审 ID。

### US-06 新提交使旧确认失效

**Given** 一个合并确认已经通过，尚未执行
**When** 分支上出现新的 commit
**Then** 确认自动失效（M1 在 MergeRecord 校验时返回 412；M2.1 起 Approval 变为 `expired`），合并接口拒绝执行并提示重新确认；审计记录失效原因。

验收：在确认后追加提交，检查确认状态与合并结果；旧确认不能被复用。

### US-07 DevOps 只能准备 staging，prod 由人在 ATeam 之外执行

**Given** 一个 DevOps Agent 被要求部署到 prod
**When** Agent 生成部署计划并尝试执行
**Then** Agent 只能创建 staging 部署或 prod 部署计划；prod 执行被拒绝，提示「prod 部署必须在 ATeam 之外由人执行」；人可以在 ATeam 内审批计划并回填执行结果，审计记录执行者与审批 ID。

验收：检查 Agent 可用命令与审批策略；prod 执行接口对 Agent 身份返回 403；ATeam 配置与数据库中不存在生产凭据；人工回填入口要求 Admin 以上权限并写入审计。

### US-08 团队管理员限制 Agent 可见性

**Given** 一个 Team Workspace 的 workspace_admin 将一个 Agent 设为 `team` 可见
**When** 其他 Team Workspace 的 Contributor 查询 Agent 列表
**Then** 该 Agent 不可见；直接按 ID 查询返回 404；本 Team Workspace 的 Contributor 可以看到并启动。

验收：跨 Team Workspace 枚举测试；可见性与角色矩阵测试；变更审计存在；404 与 403 的语义符合 §4.6。

### US-09 丢失 Runner 后撤销令牌

**Given** 一台注册过的 Runner 丢失或疑似被入侵
**When** Admin 点击「撤销机器」
**Then** 控制面立即拒绝新租约，取消未开始 Job，运行中 Job 标记为 `failed`（`interrupted/runner_lost`），机器进入黑名单；相关 Secret 被提示轮换；审计记录完整。

验收：撤销后 Runner 心跳被拒绝；新 Job 不再下发；事件广播到 UI；重新注册需要新令牌。

### US-10 审计员追溯合并

**Given** 审计员需要回答「谁在什么时候合并了哪个分支，依据是什么」
**When** 审计员按资源 ID 或时间范围查询审计
**Then** 返回合并事件、审批事件、执行者、时间、commit、证据引用与结果；导出文件包含哈希链信息；**查看与导出行为本身被记录为审计事件（仅元数据）**。

验收：审计查询覆盖完整链路；导出格式可解析；非 Admin 无法导出；查看与导出各产生一条元数据审计记录，且记录不可关闭。

### US-11 密钥不落盘、不进日志

**Given** 用户通过钥匙串添加模型 API Key
**When** Agent 运行并产生日志、错误或证据
**Then** 数据库中只有 `secret_ref`；日志与证据中的 Key 显示为掩码；API 不返回明文；删除 Agent 后 Secret 引用按策略清理。

验收：扫描数据库、日志、证据文件，不出现明文 Key；Keychain 不可用时不会回退到明文文件；轮换后新 Run 使用新值、运行中 Run 不受影响。

### US-12 高危依赖漏洞阻止发布

**Given** 发布流水线检测到某个直接或传递依赖存在严重漏洞
**When** 构建发布产物
**Then** 流水线失败，发布会阻塞；安全负责人可以在有记录的情况下批准临时例外，例外有到期时间。

验收：注入一个已知漏洞的依赖版本，检查构建失败；例外审批与到期提醒生效。

### US-13 推送审批绑定远端、分支与 commit

**Given** 一个合并已完成、远程仓库已配置的 Run
**When** 用户为分支 `feature/a` 创建推送 Approval 并获批准，随后试图推送另一分支 `feature/b`，或对同一分支强制推送
**Then** 普通推送因 ref/commit 不匹配被拒绝（412）；强制推送需要另一条 `force=true` 的 Approval；Agent 身份调用推送接口返回 403。

验收：审批绑定 remote、ref、commit SHA；跨分支复用失败；强制推送审批记录理由；人工触发推送时系统生成 approved 的 Approval。

### US-14 组织删除与 Owner 转移受保护

**Given** 组织只有一名 Owner
**When** Owner 尝试退出组织、删除组织或把自己降级
**Then** 操作被拒绝并说明「最后一名 Owner 保护」；Owner 转移必须先指定另一名成员并完成重新认证与二次确认；所有变更写入审计并触发高优先级告警。

验收：最后一名 Owner 的退出/降级/删除均失败；转移后原 Owner 降为 Admin；恢复流程需要恢复码且产生审计。

### US-15 审批执行失败后的重试语义

**Given** 一个已批准的 staging 部署 Approval
**When** 执行因网络失败在产生任何副作用前中止
**Then** Approval 保持 `approved`，允许使用同一幂等键重试；若执行已产生部分副作用，Approval 立即变为 `consumed` 并标记 `executionResult=failed`，重试需要重新发起审批，系统不自动重试。

验收：模拟无副作用失败与部分成功两种路径，检查 Approval 状态、幂等键与审计记录。

### US-16 删除保护与恢复

**Given** 一个已有运行中 Run 的 Task，以及一个已软删除的 Task
**When** 用户分别尝试删除与恢复
**Then** M1 起，存在活跃 Run 的删除被阻止（409），界面说明需先取消或等待 Run 结束；M2 起删除进入回收站并可在 30 天内恢复；M3 起删除 Team Workspace 需要两人审批并输入名称。

验收：有活跃 Run 时删除失败；软删除后默认列表不可见、回收站可见；恢复后 Task 与历史 Run 关联完整；到期清理后不可恢复。

### US-17 审计写入失败时高风险动作被阻断

**Given** 一个即将执行的合并或删除动作
**When** 本地审计写入失败（磁盘满、数据库只读、锁超时）
**Then** 动作不执行，接口返回 503 与可操作提示；界面显示「安全审计不可用，操作已取消」；恢复后用户可以重试，且不会产生部分执行。

验收：模拟数据库只读与磁盘满；检查动作无副作用；审计恢复后重试成功并留下记录。

## 13. 功能需求

优先级：P0 为发布门槛，P1 为重要能力，P2 为增强项。里程碑表示**唯一的首次交付**；后续扩展在验收要点中注明，不重复计数。

编号规则：SEC-001–019 为本地边界与执行约束；020–029 为审批与删除；030–039 为身份、角色与组织治理；040–049 为 Runner；050–059 为审计；060–069 为供应链、发布与合规；070–079 为横向安全能力；080 为插件与遥测；081–085 为 M2.3 会话讨论层安全；086–088 为 M2.4 工作页与快照安全。空缺号为后续扩展保留，已用编号不复用。

| 编号 | 名称 | 需求描述 | 验收要点 | 优先级 | 里程碑 |
|---|---|---|---|---|---|
| SEC-001 | 默认仅回环监听 | 无参数启动只绑定 `127.0.0.1`；不得默认绑定 `0.0.0.0` 或 `::` | 启动日志与 `lsof` 验证；局域网访问失败 | P0 | M1 |
| SEC-002 | 非回环绑定拒绝 | `--addr` 非回环时启动失败并说明风险；M1 不提供远程放行开关 | 传 `0.0.0.0`、局域网 IP、`::` 均失败；错误信息可操作 | P0 | M1 |
| SEC-003 | 会话令牌与浏览器引导 | 桌面壳与 `ateam serve` 使用随机会话令牌；提供一次性 bootstrap URL 或 `0600` 令牌文件；令牌常量时间比较、不落日志；WS 使用一次性 ticket | 无令牌请求返回 401；bootstrap 复用/过期失败；ticket 单次有效；日志扫描无令牌 | P0 | M2.1 |
| SEC-004 | Origin/CORS/Host 校验 | CORS 只允许动态白名单（当前监听 origin、开发端口、桌面壳随机端口）；未知 Origin 返回 403 且不写 ACAO；`Origin: null` 拒绝；Host 只接受实际监听值；WS 同样校验 | 按 §3.2 的 17 条正负矩阵测试；预检失败不产生实际请求 | P0 | M1 |
| SEC-005 | 安全响应头 | 返回 CSP、nosniff、Referrer-Policy、frame-ancestors；生产页面无 inline script | 响应头存在且值正确；CSP 违规被报告 | P1 | M1 |
| SEC-006 | 请求体上限与 413 | 全部 JSON 写接口使用 `http.MaxBytesReader` 限制 1 MiB；超限返回 413 `PAYLOAD_TOO_LARGE` | 发送 2 MiB body 得到 413 与结构化错误；DELETE 等无 body 接口不受影响 | P1 | M1 |
| SEC-007 | 本地文件权限 | `~/.ateam` 为 `0700`，数据库、`-wal`/`-shm`、证据为 `0600`，Workspace 为 `0700`；启动检查并提示修复 | 多用户可读性测试；修复建议可复制执行 | P0 | M1 |
| SEC-008 | 启动失败关闭 | 端口占用、权限不足、地址非法时启动失败；不得回退到其他端口或更宽绑定 | 逐项构造错误路径；进程以非零状态退出 | P1 | M1 |
| SEC-009 | 敏感环境变量最小过滤 | M1 在启动 Runtime 子进程前剥离名称匹配敏感模式的变量（拒绝名单，非白名单）；确需继承时必须由 Agent 显式绑定变量名 | 子进程中不可见未绑定的 `*_KEY`/`*_TOKEN`/`*_SECRET` 等；显式绑定有风险提示与记录；完整白名单在 SEC-012 | P0 | M1 |
| SEC-010 | 允许路径强制执行 | Run 启动时快照 `allowedPaths`；按 §6.2 的 glob 与规范化语义执行；越界写终止 Run | 正反例表全部通过；尾斜杠、`..`、绝对路径、UNC、盘符、符号链接用例 | P0 | M2.1 |
| SEC-011 | 允许命令强制执行 | 按 argv 算法匹配；默认无 shell；仓库信任动作首次确认；拒绝时终止 Run | 元字符、包装脚本、子进程场景记录为已知限制；临时许可单次有效 | P0 | M2.1 |
| SEC-012 | 环境变量白名单 | Agent 只继承白名单变量；受控 HOME 与临时目录；敏感名称默认不继承 | 未授权变量不可见；`HOME` 指向 Run 专属目录 | P0 | M2.1 |
| SEC-013 | 凭据隔离与钥匙串 | Secret 存 OS 钥匙串，DB 只存引用；创建后不可读明文；Keychain 不可用不回退明文 | 跨 Agent 隔离测试；内存凭据仅本次会话；Linux 后端按 §22 #2 决策 | P0 | M2.1 |
| SEC-014 | Runtime 权限参数与版本探测 | adapter 记录并传递权限模式；启动前探测版本；默认不使用跳过权限的危险参数 | 参数与生效模式写入 RunEvent；不兼容版本给出可操作错误 | P0 | M1 |
| SEC-015 | 权限变更确认 | 扩大 `allowedPaths`/`allowedCommands`/Secret 绑定需要显式确认与审计；变更只影响下一次 Run | 变更前后事件；运行中 Run 快照不变 | P1 | M2.1 |
| SEC-016 | 工作区隔离与清理 | 每个 Run 使用独立 git worktree 与分支；不得写入主检出；合并/放弃后清理并保留证据索引 | 两个并发 Run 互不影响；清理后证据可查 | P0 | M1 |
| SEC-017 | 路径规范化与符号链接防护 | 按 §6.2 顺序执行 clean、realpath、大小写与根目录复核 | 逃逸用例全部拒绝；真实路径复核独立于 glob | P0 | M2.1 |
| SEC-018 | 权限拒绝事件 | 每次拒绝产生结构化 RunEvent；M2.1 起写本地审计；包含 code/ruleId/remediation | 事件字段完整；重复拒绝聚合 | P1 | M2.1 |
| SEC-019 | Runtime 隔离能力声明 | adapter 声明路径/命令/工具/取消能力；UI 显示 `enforced/partial/advisory` | 能力矩阵测试；不支持时显示风险提示 | P0 | M2.1 |
| SEC-020 | 合并人工确认门 | 合并前必须有 Review 通过 + 显式确认 + MergeRecord；Agent 不得调用合并接口；未确认返回 403 | 直接调用 API 被拒；MergeRecord 字段完整 | P0 | M1 |
| SEC-021 | 推送审批门 | 推送前必须有 Approval 或人工触发生成的批准记录；绑定 remote + ref + commit；强制推送、删除远端分支/标签另需审批 | 跨分支/跨远端复用失败；Agent 推送返回 403；force 审批要求理由 | P0 | M2.1 |
| SEC-022 | 部署分级 | staging 需 workspace_admin 审批；prod 只审批计划、由人在 ATeam 之外执行并回填结果；不保存生产凭据 | 身份与动作矩阵测试；prod 执行接口对 Agent 与 ATeam 均不存在 | P0 | M2.1 |
| SEC-023 | 删除确认与活跃 Run 阻止 | 删除 Task/Agent 需二次确认、展示影响面；存在活跃 Run 或未关闭 Review 时返回 409 阻止；通过校验后执行归档（写 `archivedAt`），不提供硬删除 | 活跃 Run 下删除失败；确认记录包含影响面；DELETE 后资源归档而非物理删除 | P0 | M1 |
| SEC-024 | 职责分离 | M3 起 prod 计划审批与 Team Workspace 删除要求请求者与审批者不同；Owner 自批需理由与告警 | 角色组合测试；自批被拒与例外路径 | P1 | M3 |
| SEC-025 | 审批时效、撤销与执行幂等 | 统一 Approval 状态机；TTL 与消费窗口；执行前可撤销；执行失败按 §5.3 第 8 条处理 | 时钟与状态机测试；幂等键；部分失败需重新审批 | P1 | M2.1 |
| SEC-026 | 合并确认内容绑定 | 合并确认绑定 head SHA 与 diff 哈希；新提交使确认失效并返回 412 | 追加提交后合并失败；旧确认不可复用 | P0 | M1 |
| SEC-027 | 高危操作重新认证 | prod 计划审批、Team Workspace 删除、组织级操作要求重新认证或显式确认 + 理由 | 交互与审计测试；重新认证失败不产生动作 | P1 | M3 |
| SEC-028 | 软删除与恢复窗口 | Task/Agent 归档（软删除，复用 `archivedAt`，不新增 `deletedAt`），30 天恢复窗口，提供恢复端点与回收站 | 恢复与到期清理测试；默认列表不含已归档项 | P0 | M2.1 |
| SEC-029 | Team Workspace 删除保护 | 双人审批 + 输入名称确认 + 7 天回收站 | 单人删除失败；回收站恢复与到期硬删除 | P0 | M3 |
| SEC-030 | 登录与会话 | M3 提供登录、登出、会话过期、失败锁定；密码哈希使用 Argon2id；Cookie 会话按 SEC-037 | 会话生命周期测试；暴力尝试被锁定 | P0 | M3 |
| SEC-031 | 组织与角色模型 | 组织角色 owner/admin/member/viewer 与 workspace 角色 workspace_admin/contributor/reviewer/viewer；资源携带组织与 Team Workspace 作用域 | 双矩阵测试；角色词表与 §4.2 一致；跨文档映射可查 | P0 | M3 |
| SEC-032 | Agent 可见性 | private/team/shared 三档；只有可见 Agent 可启动；共享 Agent 不得携带私有 Secret 绑定 | 枚举与可见性测试；升级可见性提示 | P0 | M3 |
| SEC-033 | API 鉴权与资源作用域 | 每个 API 先鉴权后查询；不可见返回 404、可见但角色不足返回 403；禁止 ID 枚举侧信道 | 全接口矩阵；错误体不泄露存在性 | P0 | M3 |
| SEC-034 | 个人访问令牌 | PAT 有作用域、过期时间、可撤销；数据库只存哈希 | 创建、使用、撤销、过期测试 | P1 | M3 |
| SEC-035 | 组织删除与 Owner 转移 | 双人审批 + 重新认证；最后一名 Owner 保护；恢复码破窗流程 | 最后一名 Owner 的退出/降级/删除失败；恢复流程产生审计与告警 | P0 | M3 |
| SEC-036 | 角色授予与撤销防提权 | 按 §4.3 的授予矩阵执行；Admin 不能授予同级以上角色；变更即时生效 | 防提权组合测试；最后一名 Owner 保护 | P0 | M3 |
| SEC-037 | 浏览器会话 CSRF 防护 | 若 M3 使用 Cookie 会话：SameSite=Lax/Strict、CSRF token、登录后轮换 session id、拒绝跨站状态变更 | CSRF 与固定会话测试 | P0 | M3 |
| SEC-038 | 远程访问模式（高级非承诺） | 显式开关 + 独立认证 + TLS/受信代理 + 速率限制 + UI 横幅；不复用桌面壳令牌 | 非显式配置拒绝启动；明文公网配置被拒绝；远程令牌可撤销 | P1 | M3 |
| SEC-040 | Runner 注册令牌 | 一次性、默认 15 分钟、绑定组织；只显示一次；创建与使用审计 | 过期与复用测试 | P0 | M3 |
| SEC-041 | Runner 认证与心跳 | 机器密钥认证；每 15 秒心跳；TLS；记录能力与版本 | 断线重连；伪造心跳被拒 | P0 | M3 |
| SEC-042 | 租约与失联处理 | 单 Job 单有效租约；45 秒离线、90 秒租约过期，Run 记为 `failed` + `interrupted/runner_lost`；不自动重派有副作用的 Job | 时钟测试；人工确认重试 | P0 | M3 |
| SEC-043 | 共享机器隔离 | 共享 Runner 需 Admin 审批；每 Job 独立目录与凭据租约；UI 风险提示 | 并发隔离测试 | P1 | M3 |
| SEC-044 | Runner 撤销 | 立即拒绝新租约并取消未开始 Job；黑名单；提示轮换 Secret | 撤销全流程测试 | P0 | M3 |
| SEC-050 | 审计事件模型 | 定义 actor/action/resource/time/result/metadata 字段；本地与团队共用 schema；唯一约束与索引 | 序列化与查询测试；只追加 | P0 | M2.1 |
| SEC-051 | 本地审计闭环 | Run 生命周期、权限拒绝、审批、合并、删除、Secret 变更写入本地审计；高风险动作先写后做 | 审计失败时动作阻断；MergeRecord 引用可查 | P0 | M2.1 |
| SEC-052 | 团队审计完整性 | Postgres 追加写；哈希链与定期锚点；`audit-events/verify` 校验；检测篡改 | 链校验与篡改测试 | P0 | M3 |
| SEC-053 | 认证与权限事件审计 | 登录成功/失败、登出、角色变更、Agent 可见性、令牌创建/撤销、Secret 访问元数据 | 覆盖矩阵 | P0 | M3 |
| SEC-054 | 审计导出与保留 | 按条件过滤与 JSON/CSV 导出；默认 180 天可配置；导出行为审计；团队轮转策略 | 权限与格式测试；轮转与归档 | P1 | M3 |
| SEC-055 | 本地审计轮转与磁盘保护 | 本地审计按大小/时间轮转；磁盘阈值告警；清空需审计 | 轮转与阈值测试 | P1 | M2.1 |
| SEC-060 | 依赖锁定与升级审查 | go.sum/pnpm-lock 提交；CI frozen 安装；升级需评审 | 锁文件完整性测试 | P0 | M1 |
| SEC-061 | 依赖漏洞扫描告警 | CI 运行 govulncheck 与 pnpm audit；发现高危输出告警 | 注入漏洞依赖测试；CI 日志可查 | P0 | M1 |
| SEC-062 | 高危漏洞阻断发布 | 严重/高危漏洞阻断发布；例外有审批与到期 | 阻断与例外测试 | P0 | M4 |
| SEC-063 | 许可证合规 | 依赖许可证允许列表；发布生成 NOTICE 与第三方清单；CI 自动检查 | 新增 GPL 依赖被拦截 | P1 | M4 |
| SEC-064 | 可验证构建与校验和 | 固定工具链；`-trimpath`；SHA-256 清单；SBOM；记录构建元数据 | 同一提交重复构建；清单与 SBOM 校验 | P1 | M4 |
| SEC-065 | 发布签名与更新校验 | 签名覆盖校验和清单；先验签再验哈希；密钥轮换与吊销；更新失败不安装 | 篡改产物、替换清单、复用旧清单三类攻击测试 | P0 | M4 |
| SEC-066 | 漏洞披露流程 | 安全联系渠道与披露政策；SLA 数值待定（§22 #13） | 文档可达；演练记录 | P1 | M4 |
| SEC-067 | 原创性与清洁室合规 | LICENSE、DCO、贡献声明、NOTICE；拒绝第三方产品资产 | M0 部分交付：上述文件已存在；CI 自动检查缺口并入 SEC-063 | P0 | M0（部分） |
| SEC-068 | Runtime 数据流首次告知 | 首次配置 Runtime 时说明提示词（含代码片段）会发送到模型服务；BYO Key；不代管模型 | 首次启动出现告知；可回看；设置页有入口 | P0 | M1 |
| SEC-069 | 端口与进程校验 | 启动时校验实际监听地址与端口；端口占用失败；UI 展示真实端口；bootstrap URL 只源于实际监听值 | 端口冲突与错误地址测试；UI 与实际一致 | P1 | M1 |
| SEC-070 | Prompt injection 基础防护 | 仓库内容标记为不可信；系统提示禁止执行内容中的指令；契约与评审只做结构化校验 | 注入样例不改变门禁策略；M2.1 扩展见 SEC-011/018 | P0 | M1 |
| SEC-071 | 日志与证据脱敏 | 集中维护敏感模式；RunEvent、错误、证据、审计写入前掩码；脱敏失败丢弃字段 | 常见 Key 格式扫描；自定义正则错误不漏值 | P0 | M1 |
| SEC-072 | 本地数据保留与立即删除 | 本地保留期可配置；支持立即删除本地数据；删除有记录 | 到期清理；立即删除覆盖数据库、证据、工作区索引 | P1 | M1 |
| SEC-073 | 本地安全告警 | 重复权限拒绝、非预期监听变更、审计写入失败、审计队列积压时提示用户 | 告警触发与去重测试 | P1 | M2.1 |
| SEC-074 | Runner 安全告警 | Runner 异常离线、租约过期、撤销后心跳、疑似 Secret 泄漏时提示 Admin | 告警触发测试 | P1 | M3 |
| SEC-075 | Runtime CLI 二进制信任 | 记录 Runtime 可执行文件真实路径；PATH 劫持告警；可选哈希固定；设置页展示 | 伪造同名可执行文件被提示或拒绝 | P1 | M1 |
| SEC-077 | Runtime 不可用与版本不匹配 | 版本不兼容、登录失效、模型服务不可达时给出可操作错误；不静默降级 | 错误分类测试；stderr 摘要保留 | P1 | M1 |
| SEC-078 | Secret 轮换与撤销语义 | 轮换只影响新 Run；撤销立即阻止新解析；运行中 Run 结束即清除；Runner 租约随心跳失效 | 轮换与撤销测试；运行中 Run 不受影响 | P1 | M2.1 |
| SEC-079 | Webhook/定时自动化身份与防重放 | 签名、时间戳、幂等键、重放窗口；自动化不得绕过审批 | 重放与过期签名被拒 | P0 | M4 |
| SEC-080 | 插件权限模型与遥测边界 | 插件声明权限、不得绕过审批；遥测默认关闭、字段最小化、可禁用 | 插件越权被拒；关闭遥测后无上报 | P0 | M4 |
| SEC-081 | 会话 Agent 只读执行 | Agent Team 会话固定 `read_only`；禁止写工具与 Bash；工作目录为独立临时草稿目录 | 尝试写文件或执行命令被拒绝；仓库无变化 | P0 | M2.3 |
| SEC-082 | 会话无执行副作用 | 会话 Agent 不创建 Run/Artifact、不修改 Task、不写仓库；用量仅写入消息 | 会话前后 Run/Artifact 数量与 Task 状态不变 | P0 | M2.3 |
| SEC-083 | 禁止 Agent 自动对话 | Agent 消息不参与路由、不触发其他 Agent；路由器不执行代码 | 300 秒观察无自动连锁回复；路由器无仓库写入 | P0 | M2.3 |
| SEC-084 | 会话内容渲染与注入防护 | 消息按 Markdown 消毒渲染，禁止原始 HTML；成员名、rationale 转义；会话内容视为不可信输入 | XSS 样例被转义；恶意内容不改变路由规则或执行边界 | P0 | M2.3 |
| SEC-085 | 会话审计与脱敏 | 路由决策、成员变更、转任务只追加；消息与 rationale 写入前按 SEC-071 脱敏 | 决策不可篡改；敏感模式扫描无泄漏 | P1 | M2.3 |
| SEC-086 | 工作摘要与快照脱敏 | `GET /agents/{id}/work` 不返回 instructions 全文、凭据或完整 prompt；`GET /runs/{id}/snapshot` 的 instructions 必须脱敏，且不返回完整拼装 prompt、明文密钥、凭据值与环境变量值 | 脱敏扫描与负向夹具 | P0 | M2.4 |
| SEC-087 | 工作页只读与归档只读 | 工作页不提供编辑、启动、取消、审批或合并入口；归档 Agent 的历史只读 | UI 与 API 负向测试 | P0 | M2.4 |
| SEC-088 | 工作页渲染与作用域 | Task/事件/Artifact 文本按不可信内容消毒；跨 Workspace 引用返回 404 | XSS 与跨 Workspace 测试 | P0 | M2.4 |

## 14. 交互与规则

本章只定义安全行为、状态与确认规则；导航结构、按钮布局、视觉样式以 `prd/modules/ui-ux.md` 的 UI 编号为准，本节不重复定义视觉细节。

### 14.1 安全设置与状态

本地设置页（M1 起逐步交付）展示只读安全状态：

- 监听地址与是否回环；端口实际值（SEC-069）。
- 数据目录、数据库、工作区权限检查结果；一键复制修复命令，不默认自动执行。
- Runtime 列表、可执行文件真实路径、版本与隔离等级（SEC-075/SEC-077）。
- M2.1 起：会话令牌状态（已启用/未启用）、bootstrap 说明、WS ticket 说明、重启提示。
- 审计保留天数、脱敏规则版本、最近一次审计写入失败时间。
- 「检查更新」与签名状态（M4）。

团队安全设置（M3）仅 Owner/Admin 可见：

- 默认审批策略与 TTL；是否允许 Owner 紧急自批；prod 部署执行与回填方式。
- 会话时长、密码策略或 SSO 配置；PAT 最长有效期；Cookie 会话安全项。
- Runner 默认策略：是否允许共享机器、并发上限、磁盘配额。
- Secret 提供方与轮换提醒；审计保留与导出权限。
- 所有修改即时审计，并在页面显示「上次修改人/时间」。

### 14.2 审批中心

- 待审批数量在全局入口可见（具体位置见 `ui-ux.md`）；审批中心按状态、动作、Team Workspace 过滤。
- 审批详情必须展示：请求者、动作、资源、目标分支/远端/环境、diff 统计、证据列表、风险提示、过期时间、`actionFingerprint` 摘要。
- 操作按钮：批准、拒绝、撤销（请求者）、查看证据。批准前要求确认；高危动作要求输入原因或重新认证。
- 审批状态变化通过 WebSocket 实时推送；`pending/approved/rejected/expired/cancelled/consumed` 六态都有明确视觉与文本状态，不只靠颜色区分。
- 执行失败时显示失败阶段、是否已消费、幂等键与重试入口；部分失败明确提示「需要重新审批」。
- 审批被拒绝后，请求者可以复制原因并修改内容重新发起；不得提供「一键复用旧审批」。

### 14.3 Agent 权限编辑

- Agent 编辑页分为「基本信息」「指令」「权限」「凭据」四个区域；权限区域必须显示当前生效值与风险等级。
- 路径编辑器支持逐条添加、删除、预览匹配结果；对 `**`、`/`、`..` 等高风险模式给出警告。
- 命令编辑器按可执行文件分组，展示参数约束与仓库信任状态；禁止直接粘贴整段 shell。
- 环境变量编辑器只允许名称与来源（字面值/Secret 引用）；字面值敏感变量强制要求使用 Secret。
- 保存时进行差异比较：扩大权限需要二次确认；缩小权限直接保存，并提示「该变更只影响下一次启动的 Run，正在运行的 Run 使用启动时的权限快照」。
- 页面显示「该 Agent 上次运行使用的权限快照」链接，便于排查。

### 14.4 删除与危险操作

- 删除按钮统一使用危险样式，并说明影响面：将影响的 Run、证据、审批关联数量；存在活跃 Run 时按钮禁用并说明原因。
- Task/Agent 删除在 M2 进入回收站；Team Workspace 删除要求输入名称并双人审批；组织删除与 Owner 转移要求重新认证与二次确认。
- 删除 Workspace 或证据前提示是否保留摘要；默认保留审计索引。
- 任何危险操作完成后显示审计事件 ID，便于追溯。

### 14.5 审计查看

- 本地审计列表支持按时间、动作、结果过滤；详情以键值对展示，不渲染未转义的 HTML。
- 团队审计列表支持 actor、action、resource、Team Workspace、时间范围；默认最近 30 天。
- 审计详情显示哈希链校验状态；校验失败显著提示，并建议联系安全负责人。
- 导出按钮仅对有权限的角色显示；导出前说明包含的字段与脱敏规则。
- 查看与导出均生成审计事件（仅元数据），界面在隐私说明中披露。

### 14.6 空状态与首次使用

- **审批中心空状态**：说明「当前没有待审批事项」，并给出「如何发起合并/推送审批」的入口。
- **审计列表空状态**：本地模式提示「高风险动作发生后会出现在这里」；团队模式提示检查筛选范围。
- **Agent 权限与凭据编辑首次使用**：显示默认最小权限说明、受控 HOME 的含义与 Secret 绑定步骤；不出现空白表单。
- **团队首次创建组织**：引导创建第一个 Team Workspace、邀请成员并指定 Admin；最后一名 Owner 保护提示必须出现。
- **Runtime 首次配置**：显示数据流告知（SEC-068）与隔离等级说明，用户确认后才能启动 Run。

### 14.7 规则汇总

1. 没有明确允许的路径与命令，一律拒绝；写与命令违规终止 Run。
2. 没有显式远程模式，一律只监听回环地址。
3. 合并、推送、部署、删除、权限扩张、组织级操作必须有同结构的人工批准记录；人工触发也生成记录。
4. 审批绑定具体内容，内容变化即失效；审批单次消费。
5. M2.1 起高风险动作先写审计，再执行；审计失败则动作失败。
6. 密钥创建后不可读；日志、证据、审计默认脱敏。
7. 权限解析或策略服务不可用时失败关闭。
8. 拒绝必须可解释，并给出修复或申请审批的路径。
9. 不可见资源返回 404，可见但角色不足返回 403；错误体不泄露存在性。
10. 产品文案不得暗示 Agent 可以替代人类承担责任。

## 15. 数据与 API 影响

### 15.1 数据模型

M0 已有表：`tasks`、`agents`、`runs`、`run_events`。其中 `agents.allowed_paths`、`agents.allowed_commands` 已存在但未执行。字段命名约定：API 与事件使用 camelCase，SQLite 列名使用 snake_case（与 `api-and-data.md` 一致）；下表使用 camelCase。

计划新增或扩展：

| 表/字段 | 里程碑 | 关键字段 | 说明 |
|---|---|---|---|
| `audit_events` | M2.1 | id, organizationId, teamWorkspaceId, seq, actorType, actorId, action, resourceType, resourceId, source, result, reasonCode, metadata, prevHash, hash, createdAt | 本地与团队共用 schema；本地 `organizationId=local`；`UNIQUE(organizationId, seq)`，索引 `(organizationId, createdAt)` |
| `approvals` | M2.1 | id, organizationId, teamWorkspaceId, actionType, targetType, targetId, actionFingerprint, summary, riskLevel, requestedBy, requestedAt, evidenceSnapshotId, status, decidedBy, decidedAt, reason, expiresAt, consumedAt, executionResult, revision, createdAt | 与 domain model §3.11 一致；本地作用域为 `local`；索引 `(status, expiresAt)`、`(targetType, targetId)` |
| `merge_records` | M1 | id, runId, reviewId, targetBranch, sourceBranch, strategy, commit, contentHash, operator, result, createdAt | M1 合并确认与追溯；M2.1 起同时引用 Approval |
| `agent_permission_snapshots` | M2.1 | id, runId, agentId, allowedPaths, externalReadOnlyRoots, allowedCommands, envAllowlist, secretRefs, runtimeMode, policyVersion, createdAt | Run 启动时固化；schema 版本化 |
| `secret_refs` | M2.1 | id, ownerId, teamWorkspaceId, name, provider, keychainKey, createdBy, lastUsedAt, rotatedAt | 不存明文；本地模式 teamWorkspaceId 为 `local`，M3 增加团队作用域与租约引用 |
| `security_settings` | M1/M3 | scope, key, value, updatedBy, updatedAt | 本地与团队设置 |
| `organizations` | M3 | id, name, createdBy, createdAt | 组织 |
| `team_workspaces` | M3 | id, organizationId, name, createdBy, createdAt | 团队资源边界 |
| `memberships` | M3 | id, organizationId, teamWorkspaceId, userId, role, grantedBy, grantedAt | 组织角色与 Team Workspace 角色分开存储：`scope=org` 或 `scope=workspace` |
| `users` | M3 | id, email, displayName, passwordHash, status | 本地账号；OIDC 另行设计 |
| `sessions` / `api_tokens` | M3 | id, userId, tokenHash, scopes, expiresAt, revokedAt | 会话与 PAT |
| `machines` | M3 | id, organizationId, name, publicKey, capabilities, shared, status, lastHeartbeat | Runner |
| `runner_registration_tokens` | M3 | id, organizationId, tokenHash, expiresAt, usedAt | 一次性注册 |
| `job_leases` | M3 | id, machineId, runId, status, expiresAt | 租约 |
| `audit_anchors` | M3 | id, organizationId, anchorHash, periodStart, periodEnd | 哈希链锚点 |

迁移原则：只增不删；破坏性变更必须提供备份与回滚说明；迁移脚本在 CI 中测试；迁移失败覆盖 M0-M4 全部版本（M0 起就有 SQLite 迁移）。

### 15.2 API 影响

M0 已有 `/api/...` 端点保持不变；M1 起新端点使用 `/api/v1/...`（与 api-and-data 的版本化计划一致），旧路径在 deprecation 窗口内保持兼容。所有 `/api/*` 自 M2.1 起统一加认证中间件。

新增端点建议：

| 方法 | 路径 | 里程碑 | 用途 | 权限/SEC |
|---|---|---|---|---|
| POST | `/api/v1/auth/bootstrap` | M2.1 | 一次性 bootstrap 令牌换取会话令牌；仅回环 Host/Origin | 无（受限于一次性与 TTL）/ SEC-003 |
| POST | `/api/v1/auth/ws-ticket` | M2.1 | 申请一次性 WS ticket（≤60 秒） | 会话令牌 / SEC-003 |
| GET | `/api/v1/security/status` | M1 | 监听地址、回环状态、认证模式、目录权限、Runtime 隔离等级 | 本地用户（M2.1 起需令牌）/ SEC-069 |
| GET | `/api/v1/audit-events` | M2.1 | 查询本地审计；M3 扩展团队审计与过滤 | 本地用户；M3 Admin / SEC-050/053 |
| GET | `/api/v1/audit-events/export` | M3 | 导出审计（JSON/CSV） | Admin / SEC-054 |
| GET | `/api/v1/audit-events/verify` | M3 | 校验哈希链与锚点 | Admin / SEC-052 |
| GET/POST | `/api/v1/approvals` | M2.1 | 列出/创建审批请求 | 请求者或 Admin / SEC-025 |
| POST | `/api/v1/approvals/{id}/decision` | M2.1 | 批准或拒绝；校验内容指纹 | 审批人 / SEC-025 |
| POST | `/api/v1/approvals/{id}/revoke` | M2.1 | 撤销未执行审批 | 请求者或 Admin / SEC-025 |
| GET/POST | `/api/v1/secrets` | M2.1 | 创建/列出 Secret（只返回引用与元数据） | 创建者/Admin / SEC-013 |
| POST | `/api/v1/secrets/{id}/rotate` | M2.1 | 轮换 Secret | 创建者/Admin / SEC-078 |
| GET/POST/DELETE | `/api/v1/secrets/{id}/bindings` | M2.1 | 查看、新增、解绑 Agent/Runtime 与 Secret 的引用关系 | 创建者/Admin / SEC-013 |
| DELETE | `/api/v1/secrets/{id}` | M2.1 | 删除 Secret | 创建者/Admin / SEC-078 |
| GET | `/api/v1/secrets/keychain-status` | M2.1 | 钥匙串可用性与后端类型 | 本地用户 / SEC-013 |
| POST | `/api/v1/agents/{id}/permission-requests` | M2.1 | 申请扩大权限或一次性命令许可 | Contributor+ / SEC-015 |
| POST | `/api/v1/tasks/{id}/restore` | M2.1 | 恢复软删除 Task | workspace_admin / SEC-028 |
| POST | `/api/v1/agents/{id}/restore` | M2.1 | 恢复软删除 Agent | workspace_admin / SEC-028 |
| POST | `/api/v1/auth/login` / `logout` | M3 | 登录/登出 | 公开/已登录 / SEC-030 |
| GET | `/api/v1/me` | M3 | 当前用户与权限 | 已登录 / SEC-033 |
| GET/POST/PATCH/DELETE | `/api/v1/members` | M3 | 成员与角色管理（含授予/撤销） | Owner/Admin / SEC-036 |
| POST | `/api/v1/organizations/{id}/transfer-ownership` | M3 | 转移 Owner | Owner + 重新认证 / SEC-035 |
| DELETE | `/api/v1/organizations/{id}` | M3 | 删除组织 | Owner + 双人审批 / SEC-035 |
| GET/POST | `/api/v1/machines` | M3 | Runner 列表与注册 | Admin / SEC-041 |
| POST | `/api/v1/machines/register-tokens` | M3 | 创建一次性注册令牌 | Admin / SEC-040 |
| POST | `/api/v1/machines/{id}/revoke` | M3 | 撤销机器 | Admin / SEC-044 |
| POST | `/api/v1/runner/register` | M3 | Runner 注册（机器认证前） | 注册令牌 / SEC-040 |
| POST | `/api/v1/runner/heartbeat` | M3 | Runner 心跳 | 机器签名 / SEC-041 |
| POST | `/api/v1/runner/leases/{id}/events` | M3 | Runner 上报 Job 事件 | 机器签名 / SEC-042 |
| GET/PATCH | `/api/v1/security/settings` | M3 | 团队安全设置 | Owner/Admin / SEC-031 |

API 规则：

- 所有错误使用统一结构：`{ "error": { "code": "...", "message": "...", "details": {...}, "requestId": "..." } }`；错误消息不包含 Secret。
- 状态码：400 校验失败、401 未认证、403 越权（可见但角色不足）、404 不存在或不可见、409 冲突/资源占用、412 指纹不匹配、413 请求体超限、429 远程模式限速、503 审计不可用。所有新端点与错误码在 `api-and-data.md` 登记。
- 分页默认 50，最大 200；审计导出使用流式响应，避免一次性加载。
- 写接口要求 `Content-Type: application/json`；高风险端点在执行前写入审计意图（M2.1 起），执行后写入结果；审计写入失败返回 503，不执行动作。

### 15.3 WebSocket 事件

在 M0 的 `task.created`、`run.event` 等事件基础上新增：

- `approval.requested`、`approval.decided`、`approval.expired`、`approval.cancelled`、`approval.consumed`
- `audit.appended`（团队模式可按权限裁剪）
- `security.alert`（重复拒绝、审计失败、审计积压、Runtime 路径异常、权限变更）
- `machine.online`、`machine.offline`、`machine.revoked`
- `auth.session_expired`
- M4：`automation.triggered`、`automation.rejected`（重放/签名失败）

WebSocket 连接必须校验 Origin 与 Host（M1），M2.1 起追加一次性 ticket 与会话有效性；事件按角色过滤，Reviewer 与 Viewer 不应收到包含敏感元数据的事件。事件载荷不包含 Secret 明文。连接建立后若会话过期，服务端发送 `auth.session_expired` 并关闭连接。

### 15.4 数据分类与脱敏

- 所有写入日志、证据、审计、WebSocket 的数据经过统一脱敏管道。
- 脱敏规则至少覆盖：`sk-` 前缀、`ghp_`/`github_pat_`、`xox[baprs]-`、`AKIA[0-9A-Z]{16}`、JWT、`Bearer ` 后的令牌、私钥块。
- 脱敏失败时默认丢弃该字段，而不是原样输出。
- 用户可以在设置中增加自定义正则；自定义规则错误不得导致敏感值漏出。

## 16. 异常与边界

| 场景 | 期望行为 | 用户可见信息 | 里程碑 |
|---|---|---|---|
| 非回环地址 | 启动失败 | 「M1 只支持回环地址；远程访问将在 M3 以独立认证提供」 | M1 |
| 端口被占用 | 启动失败，不回退 | 「端口 8787 已被占用；请释放端口或显式指定其他回环端口」 | M1 |
| 数据目录权限过宽 | 启动检查失败或提示修复 | 显示当前权限与建议命令 | M1 |
| CORS 来源不在白名单 | 返回 403，无 ACAO | 不暴露内部错误细节 | M1 |
| Host 不匹配（DNS rebinding） | 返回 403 | 「非预期访问来源」 | M1 |
| WebSocket 来源非法 | 拒绝握手 | 连接失败，无事件泄漏 | M1 |
| WebSocket ticket 缺失/过期/复用 | 返回 401，不升级 | 「连接凭证无效，请刷新页面」 | M2.1 |
| bootstrap 令牌过期/复用 | 401 | 「引导链接已失效，请从终端重新打开」 | M2.1 |
| 会话令牌缺失或过期 | 返回 401 | 「会话已过期，请重新打开 ATeam」 | M2.1 |
| 请求体超过 1 MiB | 返回 413 | 「请求体超过限制」 | M1 |
| Runtime 版本不匹配/登录失效/不可达 | Run 失败，错误可分类 | 安装/登录/网络指引；保留 stderr 摘要 | M1 |
| Runtime 可执行文件路径可疑 | 告警并要求确认 | 显示解析路径与「可能被 PATH 劫持」 | M1 |
| 路径越界（写/命令） | 拒绝并终止 Run | 错误码、ruleId 与修复建议 | M2.1 |
| 符号链接逃逸 | 拒绝并记录 | 同上 | M2.1 |
| 命令不在白名单 | 拒绝并终止 Run；可申请一次性许可 | 命令名称、策略 ID、申请入口 | M2.1 |
| 仓库首次执行构建/测试脚本 | 要求仓库信任确认 | 「该命令会执行仓库内脚本」 | M2.1 |
| 环境变量不在白名单 | 不注入并记录 | 变量名（脱敏值） | M2.1 |
| Secret 不存在或被撤销 | Run 启动前失败 | 「凭据不可用，请重新绑定」 | M2.1 |
| Secret 轮换/撤销 | 新 Run 使用新值；运行中 Run 不受影响；撤销阻止新解析 | 影响面提示 | M2.1 |
| Keychain 锁定/不可用 | 提示解锁或仅本次使用 | 不回退明文 | M2.1 |
| 审批过期 | 动作拒绝 | 「审批已过期，请重新发起」 | M2.1 |
| 审批内容变化 | 指纹不匹配返回 412 | 「目标已变化，审批失效」 | M1（合并）/M2.1（审批） |
| 审批已消费后重试 | 拒绝，要求重新审批 | 显示消费时间与执行结果 | M2.1 |
| 审批执行无副作用失败 | 保持 approved，允许幂等重试 | 显示可重试 | M2.1 |
| 审批执行部分成功 | 标记 consumed + executionResult=failed | 「已完成部分变更，需重新审批」 | M2.1 |
| Run 取消/超时 | 撤销该 Run 的临时命令许可与待决审批；清除注入的凭据与环境；按策略清理 worktree 并保留证据索引 | Run 状态、清理结果与保留的证据链接 | M1/M2.1 |
| 审计写入失败 | 高风险动作失败关闭 | 「安全审计不可用，操作已取消」 | M2.1 |
| 审计队列积压/磁盘阈值 | 告警并暂停非关键审计异步批量 | 磁盘与队列提示 | M2.1 |
| Runner 心跳超时 | 标记离线，租约过期，Run 记 `failed` + `interrupted/runner_lost` | UI 显示机器状态与影响 | M3 |
| Runner 租约过期 | 不自动重派有副作用 Job | 需要人工确认重试 | M3 |
| 注册令牌过期/复用 | 拒绝注册 | 「令牌无效或已使用」 | M3 |
| 跨 Team Workspace 访问（不可见） | 404，不泄露存在性 | 「资源不存在」 | M3 |
| 可见但角色不足 | 403 | 显示所需角色与申请方式 | M3 |
| 审批自批（M3） | 默认拒绝，Owner 例外需理由 | 明确提示职责分离 | M3 |
| 最后一名 Owner 退出/降级/删除 | 拒绝 | 「组织至少需要一名 Owner」 | M3 |
| 数据库磁盘满 | 写入失败，高风险动作阻断 | 磁盘不足提示与清理建议 | M1/M3 |
| 迁移失败 | 启动失败并保留备份；覆盖 M0-M4 | 回滚步骤 | M1-M4 |
| 更新包签名校验失败 | 不安装，保留旧版本 | 安全告警与手动下载说明 | M4 |
| 依赖漏洞阻断发布 | 构建失败 | 漏洞列表与修复建议 | M4 |
| 审批中心/审计列表/权限编辑为空 | 显示空状态与下一步入口 | 不显示骨架屏或空白页 | M2/M3 |

## 17. 权限与安全（安全功能自身的治理）

本章描述的安全能力本身也需要治理，避免「安全功能成为新的后门」：

- **谁可以修改安全设置**：本地模式仅本机用户；团队模式仅 Owner/Admin。所有修改审计，团队模式可选双人审批。
- **谁可以查看审计**：团队模式仅 Owner/Admin；本地模式本机用户可见。查看与导出本身被记录（仅元数据）。
- **谁可以管理 Secret**：Secret 创建者与 Admin；使用者只能引用，不能查看明文。轮换与删除需要权限与审计。
- **谁可以管理 Runner**：Owner/Admin；机器所有者只能查看自己机器的状态，不能扩大权限。
- **引导信任（bootstrap）**：M3 首次创建组织时，创建者成为 Owner；第一个 Admin 由 Owner 指定。系统不得预置默认密码或万能账号。M2.1 的本地会话令牌由进程启动时生成，不写入镜像或安装包。
- **恢复与破窗**：最后一名 Owner 丢失访问权限时，使用本地恢复码或受控恢复流程（组织恢复密钥），全程审计；恢复流程不能绕过审计，也不能在恢复后自动提升任意成员为 Owner。
- **安全功能的最小化**：不引入不必要的常驻权限；Runner 不默认以 root/Administrator 运行；ATeam 不安装内核扩展或系统级代理。
- **依赖最小化**：安全相关依赖（加密、钥匙串、TLS）优先使用标准库或成熟库，减少供应链面。
- **失败模式**：安全组件失败时默认拒绝；但必须提供明确的恢复指引，避免用户因无法工作而关闭全部防护。

## 18. 指标与采集

默认无遥测。指标分为三类：**发布/测试门禁**（CI 或验收测试可判定）、**本地诊断**（默认不出本机，用户可选择查看）、**M3 团队服务端指标**。无法采集的指标不得写成运行期承诺。

| 指标 | 定义 | 目标 | 采集方式 | 里程碑 |
|---|---|---|---|---|
| 未审批高风险动作执行数 | 合并/推送/部署/硬删除中无有效批准记录的次数 | 0 | 自动化验收测试 + 审计查询 | M2.1 起 |
| 高风险动作审计覆盖率 | 有审计记录的高风险动作 / 全部高风险动作 | 100% | 审计查询；测试用例 | M2.1 起 |
| 权限信封强制执行覆盖率 | 受路径/命令/环境约束的 Run / 全部 Run | 100%（支持能力的 Runtime） | 本地诊断与测试 | M2.1 起 |
| 密钥明文落盘或日志事件 | 数据库、日志、证据、审计中发现明文 Secret 的次数 | 0 | 测试扫描 + 发布审查 | M2.1 起 |
| 默认非回环监听 | 默认配置下监听非回环地址 | 0 | **CI 启动测试**（非运行期遥测） | M1 起 |
| 权限拒绝可解释率 | 带 code 与 remediation 的拒绝 / 全部拒绝 | 100% | 事件字段测试 | M2.1 起 |
| 审批等待时间 | 从请求到决定的时间 | P50 ≤ 15 分钟，P95 ≤ 4 小时（仅 M3 团队模式统计） | M3 服务端指标；本地不采集 | M3 起 |
| Runner 失联检测时间 | 心跳停止到标记离线 | ≤ 60 秒 | M3 服务端指标 | M3 起 |
| 审计导出成功率 | 成功导出 / 请求导出 | ≥ 99.9% | M3 服务端指标 | M3 起 |
| 高危依赖漏洞修复时长 | 从告警到修复或批准例外 | ≤ 7 天 | Issue/CI 跟踪 | M4 起 |
| 安全披露首次响应 | 从报告到确认 | **待定**（与 `05-risks-and-open-questions.md` 的 SLA 数值一并确认，见 §22 #13） | 流程记录 | M4 起 |
| 安全设置变更审计率 | 有审计的安全设置变更 / 全部变更 | 100% | 测试 + 审计查询 | M2.1 起 |

指标按版本发布评审；未达标需要记录原因与改进计划，不得用「已知问题」长期豁免。

## 19. 依赖与风险

### 19.1 依赖

- **M1 本地闭环**：git worktree 与 diff 能力（合并确认哈希依赖）、Run 生命周期与取消、Runtime adapter 能力声明、Wails WebView 与浏览器引导方式、SQLite 迁移机制。
- **M2.1 权限信封与审批**：Runtime 的权限参数与工具控制能力、OS 钥匙串跨平台封装、命令执行边界、Approval 状态机与证据快照、通知与收件箱、软删除迁移。
- **M3 团队模式**：Postgres、登录与会话、组织/角色模型、Runner 注册与租约、服务端审计、Secret 加密存储、GitHub PR 集成。
- **M4 分发**：打包流水线、代码签名证书与密钥轮换设施、更新服务、漏洞扫描与 SBOM 工具、漏洞披露渠道。
- **跨模块**：Task/Run/Agent 数据模型、API/WS 事件契约、UI 设计系统、桌面壳生命周期。

### 19.2 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 审批疲劳导致用户绕过流程 | 安全门形同虚设 | 风险分级：合并/部署/删除必审，低风险自动通过；批量审批仅限同类低风险；默认策略可解释 |
| Runtime 不支持细粒度权限 | 权限信封无法完全执行 | 能力声明与隔离等级展示；推荐支持权限控制的 Runtime；对不支持者增加确认与限制，并明确标注 advisory |
| 本地攻击面修复不彻底 | 恶意网页仍可调用 API | Origin/Host/令牌/WS ticket 组合；发布前安全测试；默认回环 |
| 跨平台钥匙串差异 | Linux 上体验差或回退明文 | 抽象 SecretProvider；检测 libsecret；无安全后端时明确拒绝持久化，仅内存或加密文件（待 §22 #2 决策） |
| 共享 Runner 泄露代码 | 团队信任受损 | 默认拒绝共享；独立目录与凭据租约；风险提示与审计 |
| 审计日志增长过快 | 磁盘与查询压力 | 保留策略、分区、异步写入、轮转、导出归档 |
| 供应链攻击 | 发布物被植入后门 | 锁文件、扫描、签名链、可验证构建、最小依赖 |
| 隐私表述不准确 | 用户误以为代码绝不离开本机 | UI 首次告知 Runtime 与模型服务的数据流；BYO Key；不代管模型 |
| M3 权限模型过度设计 | 延期、难用 | 固定「组织 4 角色 + workspace 4 角色」，默认矩阵，后续再考虑自定义角色 |
| 误拦截降低开发效率 | 用户关闭安全功能 | dry-run/解释模式、模板化允许列表、仓库信任、一次性许可、清晰修复建议 |
| 迁移破坏本地数据 | 用户数据丢失 | 迁移前备份、只增不删、CI 迁移测试、回滚说明 |

## 20. 里程碑映射

### M0（已完成骨架）

- 默认回环监听、随机端口桌面壳、1 MiB 请求体限制（超限返回 400）、JSON 写接口统一使用 `decodeJSON` 已具备。
- Agent 的 `allowedPaths`、`allowedCommands` 字段已持久化，但未执行。
- SEC-067：Apache-2.0、DCO、清洁室声明、NOTICE 已具备（部分交付；CI 自动检查归入 SEC-063）。
- 已知缺口：无认证、CORS/WS 放行任意来源、无 worktree、无审批、无审计、无 Runner、无供应链扫描。

### M1（本地闭环）

交付：SEC-001、SEC-002、SEC-004、SEC-005、SEC-006、SEC-007、SEC-008、SEC-009、SEC-014、SEC-016、SEC-020、SEC-023、SEC-026、SEC-060、SEC-061、SEC-068、SEC-069、SEC-070、SEC-071、SEC-072、SEC-075、SEC-077。

退出标准：

- 默认启动无网络暴露；`--addr` 非回环直接失败。
- 恶意网页跨域请求与 WS 订阅全部失败（Host/Origin 矩阵通过）。
- 合并必须有人工确认且绑定 head SHA；新提交使确认失效。
- 每个 Run 使用独立 worktree；完成后可清理并保留证据索引。
- 日志、事件与证据中无凭据明文；Runtime 子进程不继承敏感环境变量。
- 依赖漏洞扫描在 CI 中运行并输出结果；Runtime 版本不兼容时错误可操作。

### M2（角色 Agent 协作）

M2.1 交付：SEC-003、SEC-010、SEC-011、SEC-012、SEC-013、SEC-015、SEC-017、SEC-018、SEC-019、SEC-021、SEC-022、SEC-025、SEC-028、SEC-050、SEC-051、SEC-055、SEC-073、SEC-078。

M2.2 交付：无新增安全编号；Crew 与队长必须遵守既有审批门与权限信封，队长不能批准任何门禁、不能扩大成员权限（引用 collaboration-and-review 的 COLLAB FR）。

退出标准：

- 会话令牌、浏览器 bootstrap 与 WS ticket 流程可用；无令牌请求被拒绝。
- Agent 路径/命令/环境变量约束可执行，正反例测试通过；仓库信任动作有首次确认。
- 凭据进入 OS 钥匙串，日志与证据无明文；Secret 轮换语义生效。
- 推送审批绑定 remote/ref/commit；staging 需审批；prod 只生成计划并在 ATeam 之外执行。
- 权限变更与命令拒绝有本地审计与可解释反馈；本地审计轮转与告警可用。
- 软删除与恢复窗口可用；有活跃 Run 时删除被阻止。

### M3（团队模式）

交付：SEC-024、SEC-027、SEC-029、SEC-030、SEC-031、SEC-032、SEC-033、SEC-034、SEC-035、SEC-036、SEC-037、SEC-038、SEC-040、SEC-041、SEC-042、SEC-043、SEC-044、SEC-052、SEC-053、SEC-054、SEC-074。

退出标准：

- 组织 4 角色 + workspace 4 角色矩阵通过自动化测试；跨 Team Workspace 访问按 404/403 语义不可枚举。
- 角色授予/撤销符合 §4.3；最后一名 Owner 保护与破窗流程可用。
- Runner 注册、心跳、租约、撤销全流程可用；共享机器有隔离与提示。
- 团队审计追加写、哈希链可校验、导出有权限控制、查看行为被记录。
- prod 计划审批与 Team Workspace 删除满足职责分离；远程模式（若交付）满足独立认证与 TLS。
- 浏览器 Cookie 会话（若启用）通过 CSRF 与会话固定测试。

### M4（自动化与分发）

交付：SEC-062、SEC-063、SEC-064、SEC-065、SEC-066、SEC-079、SEC-080。

退出标准：

- 高危依赖漏洞阻断发布；许可证清单与 SBOM 随发布物生成。
- 发布物有链式校验和与平台签名；签名密钥轮换与吊销流程可用；更新包篡改测试通过。
- 漏洞披露渠道与响应流程上线（SLA 数值按 §22 #13 确认）。
- Webhook/定时自动化具备签名、防重放与幂等；插件与遥测边界符合 SEC-080。

### 与其他里程碑的关系

- M1 的合并确认依赖 git diff/commit 能力；若 git 模块延期，SEC-020/026 必须显式阻塞，但不得以「没有 diff」为由跳过人工确认。
- M2 的权限信封依赖 Runtime 能力；对不支持的 Runtime，必须先交付「隔离等级提示 + 人工确认」，不能静默降级。
- M3 的团队审计依赖登录与角色；不得在无身份系统时先上线「团队审计」。
- M4 的签名依赖打包流水线；签名密钥管理属于发布工程，不得硬编码在仓库。

## 21. 与其他文档的关系

### 21.1 引用

- `prd/00-product-overview.md`：产品定位、核心闭环、目标用户与里程碑边界；本章的安全原则与其中的产品原则保持一致。
- `prd/01-scope-and-roadmap.md`：范围内能力、里程碑、审批门与安全不变量；本章的里程碑以该文档为准。
- `prd/02-domain-model.md`：Approval、Run、Task、Agent 等实体与状态机；本章的审批、审计、角色字段与之合并。
- `prd/03-user-flows.md`：端到端用户流程；本章的审批规则与失败关闭行为嵌入这些流程。
- `prd/04-acceptance-and-test-plan.md`：验收标准、测试矩阵与质量门；本章的 SEC 需求与用户故事应在其测试矩阵中登记。
- `prd/05-risks-and-open-questions.md`：风险、开放问题与 SLA；本章的 §22 与之对应。
- `prd/modules/runtime-and-workspace.md`：Runtime adapter、Runner、Workspace、Git、Artifact/Evidence 与 Run 生命周期；本章的权限信封、隔离等级、合并确认哈希与 Runner 安全依赖该模块。
- `prd/modules/collaboration-and-review.md`：角色 Agent、任务 DAG、交付物契约、审批门与证据化 DoD；本章与第 8 章共用 Approval 实体与状态机。
- `prd/modules/ui-ux.md`：安全设置、审批中心、审计查看、Agent 权限编辑与危险操作确认的界面规范；本章只定义行为与规则，视觉细节以该文档为准。
- `prd/modules/task-management.md`：Task 作为上下文容器；本章的删除保护、审计字段与 Task 生命周期相关。
- `prd/modules/agent-system.md`：Agent 配置、指令语义、模型与权限字段；本章的权限信封与凭据隔离在该文档落地为配置模型。
- `prd/modules/api-and-data.md`：REST/WS 契约、错误码、认证与事件类型；本章新增端点与事件需在该文档登记。
- `prd/modules/non-functional-requirements.md`：性能、可用性、可访问性与安全 NFR；重叠项以 NFR 为目标、SEC 为验收与里程碑，冲突按 §21.2 同步。
- `prd/milestones/M0-scaffold.md` 至 `M4-automation-and-packaging.md`：里程碑目标、范围、交付物与退出标准；本章只提供安全模块的交付映射，不重复里程碑全文。

### 21.2 跨文档待同步清单

以下不一致已在本章按既定权威基线修正，需要其他文档在下一轮统稿时同步；同步前，以本章 §4.2、§5.2、§20 的口径为准：

| # | 不一致 | 本章口径 | 需同步的文档 |
|---|---|---|---|
| 1 | 角色词表：六角色 vs 四角色 vs Contributor/Operator | 组织 4 角色 + Workspace 4 角色（§4.2）；Maintainer/Developer 仅为旧称映射，已回写 01/ui/collab/task/M3 | `03-user-flows.md`、`ui-ux.md`、`task-management.md`、`collaboration-and-review.md` |
| 2 | 会话令牌里程碑：AC-SEC-01 写 M0/M1，NFR-SEC-003 写 M2 | 统一为 **M2.1**（SEC-003），已回写 00/01/04/NFR/ui/task | `04-acceptance-and-test-plan.md`、`non-functional-requirements.md` |
| 3 | 本地审计里程碑：本章旧稿 M1，roadmap M2.1，M1 里程碑文档写 M1 | 统一为 **M2.1**（SEC-050/051）；M1 只保留 MergeRecord 与 Review 决定 | `milestones/M1-local-loop.md`、`04-acceptance-and-test-plan.md` |
| 4 | 推送审批里程碑：roadmap 写 M2 | 统一为 **M2.1 审批记录、M3 执行**（SEC-021） | 本章（已修正）；其他文档引用时写 M2.1 |
| 5 | 软删除里程碑：API 文档与本章旧稿四处不一致 | 统一为 **M1 确认与阻止 + 归档、M2.1 软删除与 30 天恢复**，字段复用 `archivedAt`（SEC-023/028） | 已回写 `api-and-data.md`、`task-management.md`、`M1-local-loop.md` |
| 6 | Approval 状态命名：pending/requested/revoked/cancelled | 统一为 `pending/approved/rejected/expired/cancelled/consumed`（§5.2）；`requested`/`revoked` 仅作输入别名 | 已回写 `02-domain-model.md` §4.6、`collaboration-and-review.md` §8 |
| 7 | prod 审批是否过期：30 分钟 vs 不自动过期 | 统一为 **30 分钟且必须过期**，绑定计划指纹，执行前重新校验（§5.3）；prod 始终由人在 ATeam 之外执行 | 已回写 `02-domain-model.md`、`collaboration-and-review.md` |
| 8 | 404/403 语义：AC-SEC-07 写「403 而非 404」 | 统一为不可见 404、可见但角色不足 403（§4.6） | `04-acceptance-and-test-plan.md`、`03-user-flows.md` |
| 9 | 审计查看是否记录：US-10 要求、§8.4 写可选、§22 列为未决 | 统一为**记录（仅元数据）** | `ui-ux.md` 的隐私说明、`05-risks-and-open-questions.md` |
| 10 | 环境变量白名单里程碑：本章旧稿 M1 vs SEC-012 M2 | 统一为 M2.1（SEC-012）；M1 只做 SEC-009 拒绝名单 | 本章旧稿已修正 |
| 11 | prod 执行路径：ATeam 内「人工执行」vs roadmap 的 ATeam 之外执行 | 统一为 **ATeam 之外执行 + 结果回填**（§5.4），不存在审批后由 ATeam 执行的路径 | `03-user-flows.md`、`milestones/M2-role-agents.md` |
| 12 | 心跳与失联：30 秒 × 3 vs 15/45/90；租约 `unknown` | 统一为 15/45/90，失联 Run 为 `failed + interrupted/runner_lost`；无 `revoked`/`unknown` 状态 | `runtime-and-workspace.md`、`api-and-data.md`、`M3-team-mode.md` |
| 13 | SEC 编号期望被其他文档引用 | 其他文档引用 SEC 时以本章 §13 的编号与里程碑为准；多里程碑编号已拆分 | 全部 PRD |

## 22. 待确认/未文档化

以下问题需要在对应里程碑设计评审前确认。状态列为「已决定」的条目不再作为开放问题；「待决定」的条目在确认前按建议默认值执行，但不得在对外文档中写成最终结论。

| # | 问题 | 状态与默认值 | 影响 | 决策里程碑 |
|---|---|---|---|---|
| 1 | M3 登录方式：本地账号、OIDC，或两者都支持 | 待决定；默认先做本地账号，OIDC 作为可选 | SEC-030 范围与测试矩阵 | M3 设计评审 |
| 2 | Linux Secret 后端：libsecret 不可用时用加密文件 + 主密码还是仅内存 | 待决定；默认仅内存，明文回退永久排除 | SEC-013 与桌面分发体验 | M2.1 设计评审 |
| 3 | 团队模式部署形态：自托管控制面，还是某台桌面机器承担 | 待决定；默认自托管服务 | 远程访问、TLS 与备份策略 | M3 设计评审 |
| 4 | 审批默认策略：Reviewer 能否批准自己启动的 Run；Owner 自批范围 | 已决定：M3 起 prod 计划审批与 Team Workspace 删除不允许自批；Owner 紧急自批需理由 + 高优先级告警；本地单用户自批允许但需显式确认（§5.4） | 审批矩阵与测试 | M2.1 / M3 |
| 5 | 数据保留默认值 | 已决定：§5.5 统一表（Artifact/Evidence/RunEvent 90 天、Run Workspace 30 天、回收站 30 天、本地审计 90 天、团队审计 180 天、本地遥测 30 天） | 磁盘占用与隐私 | M1 / M3 |
| 6 | 「代码不出本机」正式文案 | 待产品确认；本章 §2.1 与 SEC-068 给出产品内表述要求 | UI、README、销售材料一致性 | M1 |
| 7 | 沙箱路线：是否在 M4 之后引入容器或独立 OS 用户级隔离 | 待决定；当前不在 M1-M4 承诺内 | 权限信封与 Runner 模型扩展 | M4 之后评估 |
| 8 | 签名与更新基础设施的所有权与成本 | 待决定；默认使用平台签名 + 自建更新清单 | 发布流程与密钥管理 | M4 设计评审 |
| 9 | 遥测默认值 | 已决定：默认关闭、可选 opt-in、字段最小化（SEC-080）；具体事件清单待定 | 隐私与运营 | M4 |
| 10 | Agent 导出与模板中的 Secret 引用 | 待决定；默认导出剔除 Secret 绑定，导入时要求重新绑定 | 模板分享与跨组织导入 | M2.2 / M3 |
| 11 | 是否记录「谁查看了审计」 | 已决定：记录（仅元数据：actor、时间、过滤摘要、结果条数、导出格式），并在隐私说明中披露（§8.4） | 审计隐私与合规 | M2.1 / M3 |
| 12 | 多用户共享本机：是否支持多个 OS 用户各自运行 ATeam | 待决定；当前只做权限检查与提示 | 文件权限与账户体系 | M3 之后评估 |
| 13 | 安全披露 SLA 的具体数值 | 待定；`05-risks-and-open-questions.md` 已定义 S1 缓解 72 小时与 48 小时复盘，对外披露响应数值未定 | SEC-066 与 §18 指标 | M4 |
| 14 | 跨文档角色词表与里程碑同步 | 已决定口径（§4.2、§21.2），执行同步待排期 | PRD 一致性 | 下一轮 PRD 统稿 |
| 15 | 远程访问是否在 M3 实际交付 | 待决定；标记为高级非承诺功能（SEC-038），不进入 M3 退出必要条件 | 远程 Runner 之外的使用场景 | M3 规划 |
