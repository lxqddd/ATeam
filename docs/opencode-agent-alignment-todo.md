# ATeam Agent 对齐 OpenCode TODO List

> 对比基准：OpenCode `master`（2026-11-22 复审）与 ATeam `master` 当前实现；第一轮记录基于 2026-11-21 的 `dev` 文档。
> 范围：Agent 核心能力（会话、工具、权限、上下文、扩展、运行时接口），不包含主题、打包等桌面外观；CLI/TUI/IDE 等接口差距在第二轮 P2 单列。
> 标记：`[x]` 已完成，`[ ]` 待办。优先级：**P0** 必须、**P1** 重要、**P2** 后续。

## 第一轮已对齐（2026-11-21）

- [x] 会话创建、重命名、删除与持久化
- [x] 流式 text / reasoning / tool 事件
- [x] 多供应商配置、模型列表获取、默认模型与会话级模型切换
- [x] 推理强度与会话级权限模式（只读 / 逐项确认 / 自动改文件 / 自动）
- [x] 基础工具：read / list / grep / write / edit / shell
- [x] 工具审批卡、停止、重试、token 用量展示
- [x] Agent 独立 utility process、工作区路径限制、API Key 凭据存储
- [x] 上下文窗口管理、自动 / 手动压缩与超长重试（基础版）
- [x] 项目规则加载：全局 → Git 项目根 → 工作区，`AGENTS.md` / `CLAUDE.md`（基础版）
- [x] 持久化权限规则：通配符匹配、allow / ask / deny、shell 扫描与规则管理
- [x] 文件快照与 undo / redo：文件与对话一起回滚，撤销的 prompt 回到输入框
- [x] LSP 诊断与自动格式化：内置语言服务器、诊断注入、格式化器发现与执行

## 第二轮复审：与当前 OpenCode master 的差距（2026-11-22）

> 第一轮的 P0/P1/P2 记录保留在下方。第一轮中的“剩余：无”表示当时的对齐范围内已完成，不代表与当前 OpenCode `master` 完全一致。第二轮条目是新增待办，第一轮的基础版实现仍然有效。
>
> **配置方向（2026-11-22）**：参考 OpenCode 的分层发现、深合并与字段组织，但使用 ATeam 自有配置文件和 schema；不读取 `opencode.json(c)`，不承诺 OpenCode 配置格式兼容。现有 `.opencode/agent|command|skill` 资源目录可保留为便利入口，但不作为新配置基线。

### 第二轮已对齐（2026-11-22）

- [x] 供应商凭据改为明文 `auth.json`（OpenCode 风格 api/oauth 条目，文件权限 0600）
- [x] MCP OAuth 改为明文 `mcp-auth.json`（tokens / clientInfo 结构，文件权限 0600）
- [x] Web 搜索 Key 改为明文 `websearch.json`（文件权限 0600）
- [x] 移除写入路径的 `safeStorage` 加密依赖、加密可用性 UI 与 `ENCRYPTION_UNAVAILABLE` 错误（仅保留旧数据一次性迁移读取）
- [x] 启动时一次性把旧 `secrets.json` / `oauth-tokens.json` / 旧版 `mcp-auth.json` / 加密搜索 Key 迁移为明文
- [x] 测试明文落盘、0600 权限、刷新 / 登出、损坏条目与旧数据迁移

### 第二轮 P0 实现进度（2026-11-22）

| 项目                  | 状态     | 已实现                                                                                                                                                | 仍待补齐                                                                                           |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R-P0-1 分层配置       | 部分完成 | `ateam.json/jsonc` 项目根发现、全局合并、instructions/references/permissions/lsp/formatters/snapshots/agents/MCP/plugins，项目权限与 MCP 已接入运行时 | 设置页来源展示与项目级编辑、项目 providers、自定义 LSP server、项目 commands/skills、配置热更新    |
| R-P0-2 插件系统       | 核心完成 | 本地/包加载、config/tool/chatParams/system/permissionAsk/toolBefore/toolAfter/shellEnv hook                                                           | npm 自动安装与版本检查、command/event/auth/provider/workspace hook、插件管理 UI、错误展示、dispose |
| R-P0-3 LLM 重试       | 基础完成 | 429/5xx/网络重试、Retry-After、指数退避+抖动、最大次数、可中止等待、UI 重试状态                                                                       | 流已开始后的中断重试、可配置重试策略、重试指标                                                     |
| R-P0-4 提示词与上下文 | 基础完成 | 模型族提示、环境块（模型/目录/Git/平台/日期）、MCP instructions 注入、plan 模式提示                                                                   | 完整模型专用 prompt 文件、MCP instructions 权限过滤的细化、XML 转义                                |
| R-P0-5 推理与缓存     | 基础完成 | 同模型 reasoning providerMetadata 回放、Anthropic cache control、OpenAI promptCacheKey                                                                | provider transform 层、system/tool 结果缓存断点、缓存命中指标、跨供应商 reasoning 降级             |
| R-P0-6 Shell arity    | 基础完成 | 单命令 arity 前缀、始终允许生成 `命令前缀 *`、复合命令保持精确匹配                                                                                    | tree-sitter/PowerShell 解析、更大 arity 表、参数级外部目录提取、危险命令策略                       |
| R-P0-7 Plan 工作流    | 基础完成 | `.ateam/plans/<session>.md` 写入权限、plan_exit 确认、切换 build agent、plan 提示                                                                     | 当前轮内切换工具集、计划文件 UI/查看入口、build 切换提醒、自动化测试覆盖                           |

### 第二轮 P0 审计遗留（2026-11-23）

> 以下是 P0 首轮实现后的逐项审计结果。上表记录“已实现”，本节只列仍未对齐、需要继续补齐的点。

#### R-P0-1 分层配置

- [ ] 设置页展示每项配置的来源（全局 / 项目）与最终生效值
- [ ] 支持项目级配置编辑，或明确项目配置只读并展示文件路径
- [ ] 应用项目 `providers`，支持项目级供应商与模型覆盖
- [ ] 支持项目级自定义 LSP server 配置，而不只是 `lsp: boolean`
- [ ] 支持项目级自定义 formatter 命令，而不只是内置 formatter 覆盖
- [ ] 支持在 `ateam.json` 中定义 commands / skills，而不只依赖资源目录
- [ ] 项目 MCP server 进入设置页展示与 OAuth 授权流程，或明确标记为配置文件管理
- [ ] 配置变更后的热加载 / 会话刷新策略
- [ ] 项目 instructions 相对路径按项目根解析，而不是固定按 workspace
- [ ] 增加配置来源、冲突覆盖、坏配置降级的端到端测试

#### R-P0-2 插件系统

- [ ] npm 插件安装、版本兼容检查与锁文件
- [ ] `command.execute.before`、`event`、`auth`、`provider`、workspace adapter hook
- [ ] 插件管理 UI：启用/禁用、加载错误、来源与版本
- [ ] 插件 `dispose` 生命周期与缓存失效
- [ ] 插件工具纳入权限规则，或明确只允许可信本地插件
- [ ] `permissionAsk` 对 deny 的覆盖策略，避免绕过安全边界
- [ ] 工具 hook 修改后的参数/结果同步到 UI 工具详情
- [ ] 插件加载、hook 顺序、失败隔离、shell env 的运行时测试

#### R-P0-3 LLM 重试

- [ ] 响应头已返回后的流中断重试
- [ ] 可配置最大重试次数、退避上限与总超时
- [ ] 重试原因、最终失败原因在 UI 中展示
- [ ] 重试次数、成功率与时延指标
- [ ] 覆盖 AI SDK 响应解析错误与流式错误的重试测试

#### R-P0-4 提示词与上下文

- [ ] 完整的分模型 prompt 文件，而不是单行 model guidance
- [ ] MCP instructions 按 agent 工具权限精细过滤
- [ ] MCP server 名称与 instructions 的 XML 转义
- [ ] 本地时区日期与可配置环境信息
- [ ] MCP server instructions 捕获与注入的运行时测试

#### R-P0-5 推理与缓存

- [ ] provider transform 层，集中处理缓存与供应商差异
- [ ] system / tool 结果的缓存断点
- [ ] 缓存命中率与节省 token 指标
- [ ] 跨供应商 reasoning 降级（不同模型时降级为文本或丢弃）
- [ ] 旧消息缺少 `model` 字段时的兼容策略与迁移
- [ ] 供应商 reasoning metadata 的端到端测试

#### R-P0-6 Shell arity

- [ ] tree-sitter 或等价解析，覆盖 bash 与 PowerShell / cmd
- [ ] 扩大命令 arity 表，覆盖 flags 在子命令前的常见形式
- [ ] 参数级外部目录提取，替代简单 token 扫描
- [ ] 危险命令（`rm *`、`sudo` 等）的额外保护策略
- [ ] 权限规则命中未来同类命令的集成测试

#### R-P0-7 Plan 工作流

- [ ] `plan_exit` 后当前轮立即切换 build 工具集，或注入新的 build 回合
- [ ] 计划文件查看/打开入口与计划状态 UI
- [ ] plan → build 切换提醒（build switch reminder）
- [ ] 按模式隐藏 `plan_exit`，避免 build / 子代理调用
- [ ] plan_exit、计划文件权限与切换 agent 的端到端测试

### 第二轮 P0：核心运行时与配置

#### R-P0-1 分层配置模型（ATeam 自有格式）

**现状**：ATeam 只读取 `userData/agent/config.json`（[config-store.ts](../apps/desktop/src/main/agent/config/config-store.ts)），项目侧仅支持 `.opencode/agent|command|skill` 目录与 `references.json`；没有项目级 provider、MCP、LSP、formatter、permission、plugin 配置。

**OpenCode 参考**：`packages/opencode/src/config/config.ts` 的分层发现与深合并思路，以及 agents、providers、mcp、lsp、plugins、permissions、formatters、instructions、references 的字段组织。

**建议方案**：

- 全局层：沿用现有 `userData/agent/config.json`，或后续迁移为 `config.jsonc`。
- 项目层：项目根 `ateam.json` / `ateam.jsonc` 与 `.ateam/` 资源目录（agents、commands、skills 等）。
- 设置页默认编辑全局配置；项目层配置由仓库文件提供，设置页展示来源与覆盖结果。
- 凭据使用明文 JSON（`auth.json` / `mcp-auth.json`，文件权限 0600），与 OpenCode 的存储方式一致；不写入项目配置。
- 现有 `.opencode` 资源发现保留为便利入口，但不实现 `opencode.json` 字段兼容。

**待办**：

- [ ] 定义 ATeam 配置 schema、文件名与目录约定，明确哪些字段可放在项目层
- [ ] 实现“全局 → 项目（后续可扩展工作区）”的分层发现与深合并
- [ ] 覆盖 agents / providers / mcp / lsp / permissions / formatters / instructions / references / plugin 字段
- [ ] 明确与现有 `agent/config.json`、设置页、组织策略的覆盖顺序
- [ ] 对非法字段跳过并展示来源文件与错误，不让单个坏配置阻断启动
- [ ] 设置页展示每项配置的来源（全局/项目）与生效值
- [ ] 测试层级覆盖、深合并、UI 与文件一致性、旧配置迁移

**验收**：ATeam 可以通过全局与项目两层自有配置管理 agents / MCP / LSP / 权限 / 格式化，不依赖任何 OpenCode 配置文件，设置页能看清每项配置来源。

#### R-P0-2 插件系统

**现状**：ATeam 没有插件加载器或 hook 机制；扩展能力只能修改源码，或通过 MCP、Skills、Commands 间接实现。

**OpenCode 参考**：`packages/opencode/src/plugin/index.ts` 与 `@opencode-ai/plugin` 支持外部 npm / 路径插件、版本兼容检查、内置供应商认证插件，以及 `tool`、`chat.message`、`chat.params`、`chat.headers`、`permission.ask`、`command.execute.before`、`tool.execute.before|after`、`shell.env`、`experimental.chat.system.transform`、`experimental.session.compacting`、`tool.definition` 等 hook。

**待办**：

- [ ] 定义 ATeam 插件接口与加载器（本地路径、npm 包、版本兼容检查）
- [ ] 支持插件注册工具、修改聊天参数与请求头、拦截消息与命令
- [ ] 支持权限决策 hook、工具执行前后 hook、shell 环境 hook
- [ ] 支持 system prompt / compaction / tool definition 变换
- [ ] 插件加载失败隔离、错误事件、启用/禁用与设置页展示
- [ ] 测试插件发现、hook 顺序、工具注册、权限覆盖、失败隔离

**验收**：第三方插件可以注册工具并参与权限、提示词与工具执行流程，且插件故障不影响主流程。

#### R-P0-3 LLM 重试与错误状态

**现状**：AI SDK 调用固定 `maxRetries: 1`（[defaults.ts](../apps/desktop/src/main/agent/runtime/defaults.ts)），没有可重试分类、退避策略、`Retry-After` 解析，也没有把重试状态推送到 UI。

**OpenCode 参考**：`packages/opencode/src/session/retry.ts` 对 429/5xx/网络/超时做指数退避 + 抖动，解析 `retry-after` 与 `retry-after-ms`，最多 5 次，上下文溢出与用户取消不重试，并发布 retry 状态。

**待办**：

- [ ] 建立错误分类：可重试（429/5xx/网络/超时）与不可重试（上下文溢出/取消/鉴权失败）
- [ ] 实现指数退避 + 抖动、最大重试次数与总时长上限
- [ ] 解析 `Retry-After` 秒数与 HTTP 日期格式
- [ ] 通过事件/状态把重试次数、等待时间、最终失败原因传给 UI
- [ ] 与上下文压缩重试协调，避免同一错误重复压缩
- [ ] 测试各错误码、重试上限、取消、Retry-After、状态事件

**验收**：遇到 429/5xx/网络抖动时自动退避重试，UI 能看到等待与最终结果；上下文溢出不会被无意义重试。

#### R-P0-4 系统提示词与上下文构建

**现状**：system prompt 基本固定（[policy.ts](../apps/desktop/src/main/agent/runtime/policy.ts)），仅拼接 AGENTS.md、references、skills；不按模型选择提示词，不包含模型 ID、Git 仓库状态、日期、MCP server instructions。

**OpenCode 参考**：`packages/opencode/src/session/system.ts` 按模型选择 Anthropic / GPT / Codex / Gemini / Kimi / Trinity 等提示词，并注入模型信息、工作目录、Git 状态、平台、日期、References 和 MCP instructions；`session/reminders.ts` 负责 plan/build 切换提醒。

**待办**：

- [ ] 按 provider/model 选择不同基础 system prompt，并允许项目覆盖
- [ ] 注入模型 ID、工作区、Git 仓库标记、平台、日期等环境块
- [ ] 将启用 MCP server 的 instructions 注入 system prompt，并按 agent 权限过滤
- [ ] 保持 references / skills / instructions 的现有拼接顺序，补充去重与 token 预算
- [ ] 为提示词快照增加测试，避免模型差异悄悄回退

**验收**：不同模型获得适配的提示词；Agent 知道当前模型、仓库、日期与 MCP server 使用说明。

#### R-P0-5 推理块与 prompt caching

**现状**：持久化消息中的 reasoning 只有 `text`，[message-history.ts](../apps/desktop/src/main/agent/message-history.ts) 重建历史时直接丢弃 reasoning；未显式设置 Anthropic cache control / OpenAI cache key，也没有 provider transform 层。

**OpenCode 参考**：同模型历史会保留 reasoning 的 `providerMetadata` 以支持推理连续性与 prompt caching；`provider/transform.ts` 和各 provider 插件处理缓存、请求头与供应商差异。

**待办**：

- [ ] 扩展 reasoning part，持久化 `providerMetadata` 与必要签名
- [ ] 重建历史时仅在模型一致时回传 reasoning metadata，避免跨模型污染
- [ ] 为 Anthropic 增加 cache_control 断点，为 OpenAI 增加 prompt cache key
- [ ] 建立 provider transform 层，集中处理供应商请求差异
- [ ] 测试 reasoning 回放、跨模型丢弃、缓存标记与多轮成本

**验收**：多轮对话能命中供应商缓存，推理模型在后续轮次保持必要的推理上下文。

#### R-P0-6 Shell 权限解析与 arity

**现状**：`scanShellCommand` 用正则和分隔符拆分命令（[permissions.ts](../apps/desktop/src/main/agent/config/permissions.ts)），权限资源是整条命令；“始终允许”对 shell 基本只匹配完全相同命令，外部目录识别也依赖 token 扫描。

**OpenCode 参考**：`packages/opencode/src/tool/shell.ts` 用 tree-sitter 解析 bash / PowerShell，按命令 arity 生成 `git status *`、`npm run *` 等规则，并从参数中精确提取外部目录。

**待办**：

- [ ] 解析 bash / PowerShell 命令结构，识别命令、子命令、管道与重定向
- [ ] 引入命令 arity 表或等价规则，生成可复用的 `命令前缀 *` 权限资源
- [ ] 从文件类命令参数中提取真实路径，改进 external_directory 判定
- [ ] 保留引号、转义、变量与动态路径的安全回退策略
- [ ] 让“始终允许”写入的规则与 arity 结果一致，并处理 Windows 大小写
- [ ] 测试常见命令、复合命令、引号路径、外部目录与危险命令

**验收**：允许一次 `git status` 后可覆盖同类命令，而不是只允许完全相同的字符串；外部目录判断不依赖简单 token 前缀。

#### R-P0-7 Plan 工作流

**现状**：内置 plan agent 只有只读工具集（[agents.ts](../apps/desktop/src/main/agent/config/agents.ts)），没有计划文件、没有退出工具，也不会在计划完成后切换 build agent。

**OpenCode 参考**：`packages/opencode/src/session/reminders.ts` 维护 plan 文件提示与 plan/build 切换提醒；`tool/plan.ts` 提供 `plan_exit`，确认后切换到 build agent 并注入执行指令（实验性）。

**待办**：

- [ ] 定义 plan 文件路径与写入策略，允许 plan agent 只写计划文件
- [ ] 增加 `plan_exit` 工具：确认后切换 build agent 并注入执行提示
- [ ] 在 plan/build 切换时注入提醒，说明计划文件位置与下一步
- [ ] UI 展示计划文件、当前 agent 与切换结果
- [ ] 测试 plan 文件创建、退出确认、拒绝退出、切换到 build 后的权限

**验收**：plan agent 产出可执行计划文件，用户确认后平滑进入 build 阶段。

### 第二轮 P1：Agent 能力补齐

#### R-P1-1 运行中消息排队 / Steering

**现状**：运行中 `sendDisabled` 直接禁止发送（[Composer.tsx](../apps/desktop/src/renderer/src/components/chat/Composer.tsx)），只能停止或等待。

**OpenCode 参考**：运行中允许记录 steer 消息并排队，在下一次模型步骤或当前轮结束后处理，支持打断当前生成。

**待办**：

- [ ] 运行中允许输入并发送，进入会话级待处理队列
- [ ] 定义“立即打断”与“当前步骤后插入”两种策略
- [ ] UI 展示排队消息，可编辑/取消
- [ ] 与权限卡、Question、停止逻辑协调
- [ ] 测试排队、打断、取消、运行结束后自动发送

**验收**：长任务运行中用户可以补充要求，而不必停止后重新开始。

#### R-P1-2 Max steps 收尾

**现状**：达到步数上限后直接结束并提示用户继续（`chat.stepLimitHint`），没有强制模型总结。

**OpenCode 参考**：最后一步禁用工具并注入 `MAX_STEPS_PROMPT`，要求模型总结已完成工作与下一步。

**待办**：

- [ ] 达到上限前禁用工具，注入总结指令
- [ ] 区分“正常完成”与“步数耗尽”的 outcome
- [ ] 输出中保留未完成事项与建议下一步
- [ ] 测试边界步数、总结内容与 UI 提示

**验收**：步数耗尽时得到可继续工作的结构化总结，而不是半截输出。

#### R-P1-3 会话级回滚、unrevert 与 diff

**现状**：已有 undo/redo 和最新轮文件级回滚（[snapshots.ts](../apps/desktop/src/main/agent/sessions/snapshots.ts)），但没有 part 级回滚、unrevert 和会话级 diff 汇总。

**OpenCode 参考**：`session/revert.ts` 支持 message/part 级 revert、快照恢复、diff 汇总与 unrevert；`session/summary.ts` 计算会话 diff。

**待办**：

- [ ] 评估在现有消息 part 模型上支持 part 级回滚
- [ ] 增加 unrevert（撤销回滚）与对应的 UI 状态
- [ ] 增加会话级 diff 汇总（文件数、增删行、按轮次）
- [ ] 统一文件审查面板、undo/redo 与 revert 语义，避免两套状态冲突
- [ ] 测试历史轮次、部分 part、回滚后继续对话、unrevert

**验收**：用户可以回滚到消息或 part，并在回滚后恢复；审查面板能看到整个会话的改动汇总。

#### R-P1-4 后台任务框架与结果注入

**现状**：后台 shell 有完成通知，后台子代理通过 `subagent.finished` 发 UI 通知（[agent-runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)），结果不会回到父会话上下文。

**OpenCode 参考**：`background/job.ts` 提供 list / get / wait / extend / promote / cancel 的统一任务注册表；`tool/task.ts` 在后台任务完成后把结果作为合成消息注入父会话。

**待办**：

- [ ] 建立统一后台任务注册表（类型、状态、输出、取消）
- [ ] 暴露任务列表/等待/取消工具或 UI
- [ ] 后台子代理完成后向父会话注入结构化 `task_result`
- [ ] 处理父会话忙、已结束、被取消等边界
- [ ] 测试任务生命周期、结果注入顺序、取消与失败

**验收**：后台任务完成后 Agent 能继续基于结果工作，用户也能查看/取消任务。

#### R-P1-5 工具输出截断策略

**现状**：固定 30k 字符、只保留头部（[tool-output-store.ts](../apps/desktop/src/main/agent/sessions/tool-output-store.ts)），没有配置项、tail 模式、过期清理或子代理提示。

**OpenCode 参考**：`tool/truncate.ts` 支持 `max_lines` / `max_bytes` 配置、head/tail、写盘预览、按子代理能力提示委派，并定期清理过期输出。

**待办**：

- [ ] 配置最大行数/字节数，支持 head 与 tail
- [ ] 截断结果附带完整输出路径与按需读取提示
- [ ] 定期清理过期输出文件
- [ ] 有子代理能力时提示把大文件交给 explore 子代理
- [ ] 测试边界、UTF-8 截断、清理与提示

**验收**：不同工具可按配置截断，完整输出可追溯且不会无限增长。

#### R-P1-6 LSP 工具与服务矩阵

**现状**：仅 5 个内置服务器（[lsp.ts](../apps/desktop/src/main/agent/integrations/lsp.ts)），只暴露 `lsp_hover` / `lsp_definition`，不能配置自定义 server，也不会自动安装。

**OpenCode 参考**：`lsp/server.ts` 覆盖 20+ 语言服务器，支持 npm 自动安装、root marker、自定义配置；LSP 工具支持 references、implementation、documentSymbol、workspaceSymbol、callHierarchy 等操作。

**待办**：

- [ ] 扩展语言服务器矩阵与 root marker 检测
- [ ] 支持项目级自定义 LSP server 配置与覆盖
- [ ] 可选自动安装（npm）与安装失败回退
- [ ] 扩展 LSP 工具操作：references / implementation / symbols / call hierarchy
- [ ] 增加独立 `lsp` 权限 action，替代复用 `read`
- [ ] 测试 server 选择、root 解析、操作结果与权限

**验收**：多语言项目能自动使用合适 LSP，Agent 可查询引用、实现与符号。

#### R-P1-7 MCP 细节

**现状**：已实现 stdio / Streamable HTTP、OAuth、prompts/resources 与工具刷新（[mcp.ts](../apps/desktop/src/main/agent/integrations/mcp.ts)）；缺少 server instructions 注入、resource templates、SSE transport fallback、per-server timeout/cwd 配置。

**OpenCode 参考**：`mcp/index.ts` 注入 server instructions，支持 resources / resourceTemplates、StreamableHTTP 与 SSE 两种远程传输回退、per-server timeout/cwd/OAuth 配置，以及按 agent 权限过滤工具。

**待办**：

- [ ] 将 server instructions 注入 system prompt，并按 agent 工具权限过滤
- [ ] 支持 resource templates 的列出与读取
- [ ] 远程连接失败时回退到 SSE transport
- [ ] 增加 per-server timeout、cwd、OAuth client 配置
- [ ] 测试 instructions、templates、传输回退与超时

**验收**：MCP server 的使用说明能被 Agent 看到，旧 SSE server 也能连接。

#### R-P1-8 消息 part 模型

**现状**：消息 part 只有 text / reasoning / attachment / tool；步骤、快照、patch、subtask 等信息放在消息字段或其他结构中。

**OpenCode 参考**：`session/message-v2.ts` 的 part 覆盖 patch、snapshot、step-start/step-finish、subtask、retry、compaction 等，支撑更细的 UI 展示与回滚。

**待办**：

- [ ] 评估引入 step / patch / snapshot / subtask / retry part 的迁移成本
- [ ] 优先补齐 step 与 patch/snapshot part，支撑审查面板与回滚
- [ ] 保持旧消息向后兼容与迁移
- [ ] 测试 part 序列化、历史回放、UI 渲染与回滚

**验收**：消息历史能表达每一步的工具、改动与状态，审查与回滚不再依赖旁路字段。

#### R-P1-9 Formatter / Commands / Subagent 细节

**现状**：formatter 固定 5 个；命令已覆盖用户命令与 MCP prompts，但缺少内置 init/review、skills 作为命令与 subtask 命令；子代理硬性禁止嵌套，后台结果只通知。

**OpenCode 参考**：formatter 矩阵更广并支持自定义命令；`command/index.ts` 提供内置 `init` / `review`，把 MCP prompts 与 skills 也作为命令；`tool/task.ts` 支持可配置嵌套深度、task_id 与后台结果注入。

**待办**：

- [ ] 扩展 formatter 矩阵与自定义 formatter 命令
- [ ] 增加内置 `init` / `review` 命令
- [ ] 让 MCP prompts 与 skills 进入统一命令面板
- [ ] 支持命令的 subtask 模式
- [ ] 支持可配置子代理深度与 `task_id` 语义（与 R-P1-4 一起）
- [ ] 测试命令来源、优先级、subtask 执行与嵌套限制

**验收**：命令面板覆盖内置、用户、MCP、Skill 来源；子代理嵌套可按配置放开。

#### R-P1-10 VCS / Git 模块

**现状**：只有 worktree 辅助（[worktrees.ts](../apps/desktop/src/main/agent/worktrees.ts)）和 shell 里的 git；没有统一的 branch/status/diff/apply 服务，也没有会话级 Git diff。

**OpenCode 参考**：`project/vcs.ts` 提供 branch、default branch、status、diff、diffRaw、apply，并与 session diff / TUI 侧栏集成。

**待办**：

- [ ] 增加 VCS 服务：branch、status、diff、patch apply
- [ ] 处理非 Git 项目与未跟踪文件
- [ ] 将会话 diff 与 Git diff 区分展示
- [ ] 为审查面板增加“工作区 Git 改动”视图
- [ ] 测试分支检测、未跟踪文件、patch 应用失败

**验收**：Agent 和 UI 都能查询仓库状态与 diff，不再依赖临时 shell 解析。

### 第二轮 P2：接口与生态

- [ ] Session share / sync / export / import / stats：分享链接、同步、脱敏导出、导入与使用统计
- [ ] HTTP API / SDK 广度：文件、find、agents、commands、config、providers、MCP、LSP、TUI 等路由与生成式 SDK/client 包
- [ ] CLI / TUI：完整 TUI、attach、serve、web、mcp、providers、import/export、stats、agent create
- [ ] IDE 集成：VS Code 扩展、IDE 上下文/选区、ACP 之外的编辑器能力
- [ ] GitHub / Slack：issue/PR 集成、share URL 导入、Slack 集成；现有 Action 仅覆盖基础 CLI 调用
- [ ] 远程 workspace / control plane：workspace adapter、远程 target；当前仅本地 worktree
- [ ] ACP 细节：usage/report、config options/profile、Question 映射
- [ ] Account / Console / Enterprise：OpenCode 商业生态，建议明确为 ATeam 非目标

### 第二轮建议实施顺序

1. **R-P0-1 分层配置模型**（中等）——统一项目级 Agents / MCP / LSP / 权限 / 插件配置；只借鉴 OpenCode 结构，不做格式兼容。
2. **R-P0-3 重试 + R-P0-5 推理/缓存 + R-P1-2 max steps + R-P1-1 steering**（小到中等）——直接改善长任务可靠性。
3. **R-P0-6 shell arity + R-P0-7 plan 工作流 + R-P1-6 LSP + R-P1-7 MCP + R-P1-4 后台任务 + R-P1-5 输出截断**（中等）——补齐日常编码体验。
4. **R-P0-2 插件系统**（大）——如果目标是 OpenCode 级扩展生态则必须做，否则明确列为非目标。
5. **第二轮 P2 接口层**（按产品方向取舍）——share/export/stats、API/SDK、TUI/IDE。

## 第一轮 P0：可靠性、安全与编辑质量（已完成）

### P0-1 上下文窗口管理与自动压缩

**现状**：每轮把完整历史重新提交（[message-history.ts](../apps/desktop/src/main/agent/message-history.ts)）；模型只有 id/name，没有上下文窗口等元数据（[model-types.ts](../packages/shared/src/model-types.ts)）；长会话最终会触发供应商 context overflow。

**OpenCode 参考**：自动 / 手动 / 后台压缩，保留最近一段对话，按模型窗口留 buffer，超长错误自动压缩后重试一次。

**进度（2026-11-22）**：已实现自动预检压缩、强制手动压缩、超长错误重试一次、压缩边界与摘要展示、上下文占用显示、后台预生成摘要和模型上下文窗口配置；上下文估算优先使用供应商返回的真实 usage（取最后一步，并在压缩后忽略旧用量），图片按固定 token 估算；Anthropic 模型可开启供应商侧压缩（`compact_20260112`），超长错误恢复改为强制压缩。

- [x] 为模型增加 `contextWindow` 元数据，并在模型表单与存储中维护
- [x] 补充 `maxOutputTokens`、推理能力等模型元数据（与 P1-7 一起做）
- [x] 发送前估算输入 token（ASCII 与中文分别估算），按模型窗口与预留 buffer 判断是否需要压缩
- [x] 实现摘要压缩：保留最近 N tokens，把更早的轮次替换为一条压缩摘要消息
- [x] 原始消息继续持久化，压缩只影响发给模型的历史
- [x] 增加手动“压缩上下文”入口与压缩中状态；短历史也支持强制压缩
- [x] 捕获 context-too-long 类错误，自动压缩后重试一次，第二次失败如实报错
- [x] 在消息列表标记压缩边界，并可展开查看摘要
- [x] 展示上下文占用
- [x] 后台预生成摘要，达到阈值时复用
- [x] provider 原生压缩（Anthropic `compact_20260112`，按模型开关）
- [x] 用真实用量替代启发式估算（以上一条 assistant 消息的供应商 usage 为锚点，缺失时回退启发式）
- [x] 测试压缩阈值、摘要消息构建、超长重试、重启后恢复

**验收**：超过模型上下文窗口的会话仍可继续；压缩后原始消息仍能在 UI 查看；不会无限重试。

### P0-2 项目规则 AGENTS.md

**现状**：system prompt 完全硬编码（[agent-runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)），不读取仓库的构建命令、测试要求或代码约定。

**OpenCode 参考**：全局、项目根、当前目录向上的 `AGENTS.md` 自动合并，`CLAUDE.md` 作为回退，支持配置额外 instructions。

**进度（2026-11-21）**：已按 OpenCode 对齐为“全局 → 工作区 → 上层目录 → 项目根”的最近优先顺序；无 Git 时向 home 方向发现；读取文件或目录时按需加载更深层 `AGENTS.md`；支持设置页配置额外 instructions 与远程 URL。

- [x] 支持全局指令文件（应用配置目录下的 `AGENTS.md`）
- [x] 从工作区向上发现项目 `AGENTS.md` 并注入 system prompt
- [x] 支持 `CLAUDE.md` 回退，且同一目录 `AGENTS.md` 优先
- [x] 合并顺序与 OpenCode 对齐：全局 → 工作区 → 上层 → 项目根，冲突不做自动解析
- [x] 无 Git 时向 home 方向发现；读取更深层目录时按需加载该目录的 `AGENTS.md`
- [x] 在设置页展示当前加载的规则文件
- [x] 支持配置额外 instructions（相对 / 绝对 / ~/ / glob）与远程 URL
- [x] 测试发现顺序、去重、缺失回退、内容拼接

**验收**：新建会话后，Agent 能遵守仓库 `AGENTS.md` 中的构建、测试和风格要求。

### P0-3 文件快照与撤销 / 重做

**现状**：只持久化消息，没有文件快照，Agent 改错文件后无法回滚。

**OpenCode 参考**：每个模型步骤前后做文件快照，`/undo` `/redo` 同时回滚对话与文件，并可回滚到任意消息。

**进度（2026-11-21）**：已按 OpenCode 对齐为每个模型步骤快照、只恢复本轮归属文件、可回滚到任意 assistant 轮次、Git ignore 与未跟踪文件 2 MiB 限制、会话删除时清理快照；增加快照开关、消息级回退按钮和撤销/重做快捷键。撤销采用立即生效 + redo，OpenCode 为暂存回滚，用户可见流程一致。

- [x] 每个模型步骤前后对工作区文件做快照（外部 blob 存储，不污染用户仓库）
- [x] 记录步骤内改动的文件列表，并关联到 assistant 消息
- [x] 增加 undo / redo 的 IPC、头部按钮、消息级回退和快捷键
- [x] undo 时只恢复归属该轮的文件，并回滚对话、把 prompt 放回输入框
- [x] 支持回滚到任意 assistant 轮次
- [x] 会话运行中禁止回滚
- [x] 不依赖 Git；Git 仓库中遵循 ignore 规则并限制未跟踪文件大小
- [x] 会话删除时清理快照与不再被引用的 blob
- [x] 快照功能开关（Agent 设置页）
- [x] 测试快照捕获、文件恢复、新建文件删除、运行中拒绝

**验收**：误改或误删的文件可以通过 undo 恢复；redo 能取消尚未提交的回滚。

### P0-4 细粒度且可持久化的权限规则

**现状**：会话级 mode + 内存中的 `allowed` 集合（[agent-runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)）；没有通配符、路径或命令级规则，重启后“始终允许”丢失。

**OpenCode 参考**：有序的 allow / ask / deny 规则，支持通配符、持久化审批、按 agent 配置、shell 命令扫描和 external_directory 边界。

**进度（2026-11-21）**：已按 OpenCode 对齐规则“后匹配优先”、shell ` *` 后缀匹配、Windows 大小写、外部目录默认允许、危险命令交给规则决定、引号感知的命令分段，并为 read / list / glob / grep 增加权限 action。按 agent、URL、MCP、Skill 等规则随对应功能补充。

- [x] 把权限模型扩展为 `action + resource + effect` 规则，支持通配符
- [x] 规则按“后匹配优先”组合；多资源操作任一 deny 即拒绝
- [x] 支持按路径、shell 命令等资源进行匹配（URL 资源待 P1-3）
- [x] shell ` *` 后缀匹配无参数命令，Windows 下大小写不敏感
- [x] “始终允许”持久化到磁盘，重启后继续生效
- [x] 支持全局 / 会话级规则覆盖；按 agent 覆盖待 P1-2
- [x] 外部目录默认允许；危险命令不再强制弹窗，由规则与模式决定
- [x] 增加 read / list / glob / grep 权限 action
- [x] 提供规则管理 UI（查看、添加、撤销已保存规则）
- [x] Web / Skill / 子代理权限 action（`webfetch` / `websearch` / `skill` / `subagent`）
- [x] 测试规则优先级、通配符匹配、持久化恢复、命令扫描

**验收**：用户可以对“某个目录的写操作”或“某类命令”设置永久允许/拒绝；重启后规则仍然有效。

### P0-5 工具集补齐

**进度（2026-11-21）**：已增加 glob、patch 多文件编辑、后台 shell 与完成通知、shell 输出流式回传、大输出落盘、grep literal / caseSensitive / limit，以及工作区外路径的 `external_directory` 审批。剩余：无。glob 增加 10 秒遍历超时；grep 在安装 ripgrep 时自动使用 rg（缺失或失败回退 JS 遍历）；read 支持图片（作为图像内容返回）与 PDF（抽取文本）。

- [x] 增加 `glob` 工具：`**/*.ts` 模式、hidden、limit（超时待补）
- [x] 增加 `patch` / `apply_patch` 多文件工具：新增、更新、删除文件
- [x] 对支持的模型优先暴露 patch，其余模型继续使用 edit / write（模型能力 `applyPatch`）
- [x] shell 支持 `background`，完成后向会话发送通知
- [x] shell 输出流式回传 UI
- [x] 大输出写入受管文件，模型上下文只保留截断视图
- [x] grep 增加 literal / caseSensitive / limit 参数（ripgrep 加速待评估）
- [x] 工作区外文件访问：external_directory 审批后允许
- [x] 测试 glob 匹配、patch 多文件、后台任务通知、输出截断与落盘

**验收**：可以按模式找文件、一次修改多个文件；dev server 等长命令不阻塞对话；完整输出可追溯。

### P0-6 LSP 诊断与自动格式化

**现状**：没有 LSP 与格式化集成，Agent 改完代码看不到类型错误，也不会自动格式化。

**OpenCode 参考**：内置多语言 LSP，编辑后注入诊断；识别项目格式化器并在写入后自动执行。

**进度（2026-11-21）**：已实现内置语言服务器表（TypeScript / Go / Python / Rust / C/C++）、按工作区复用与关闭的 LSP 客户端、read / write / edit / patch 后注入诊断、基于项目配置发现的 prettier / biome / gofmt / rustfmt / ruff 自动格式化，以及设置页开关与检测状态。格式化失败只作为提示，不影响工具结果；语言服务器不可用时静默跳过。剩余：无。新增 `lsp_hover` / `lsp_definition` 查询工具；设置页可为扩展名指定格式化器或关闭格式化。

- [x] 增加 LSP 客户端管理：按项目与语言启动、复用、关闭
- [x] 读取 / 写入 / 编辑后请求 diagnostics，并注入工具结果
- [x] 先实现 diagnostics，后续再补 hover / definition 等查询
- [x] 自动识别并执行 prettier、biome、gofmt、rustfmt、ruff
- [x] 设置页提供开关与检测状态显示
- [x] 测试诊断注入、格式化器发现、格式化失败不影响主流程

**验收**：Agent 修改 TypeScript 文件后能看到类型错误；文件写入后按项目配置自动格式化。

## 第一轮 P1：日常编码效率（已完成）

### P1-1 MCP（Model Context Protocol）

**进度（2026-11-21）**：已实现 MCP 服务器配置存储与设置页（新增 / 编辑 / 启停 / 删除 / 状态探测）、本地 stdio 与远程 Streamable HTTP 传输、自定义 headers、工具自动注册为 `mcp_<server>_<tool>` 并纳入 `mcp` 权限动作、工具列表变更刷新、失败隔离与下次运行重连、连接状态与工具 / prompts / resources 数量展示。剩余：无。OAuth 已实现授权发现（RFC 9728 / RFC 8414）、动态客户端注册、PKCE S256、浏览器回调、明文 token 存储（0600）与自动刷新；MCP prompts 作为斜杠命令展开，resources 通过 `mcp_resource` 工具读取。

**验收**：在设置页添加一个本地或远程 MCP server 后，对话中可以使用它提供的工具，并按权限规则审批。

- [x] 增加 MCP 配置存储与设置页
- [x] 支持本地（stdio）与远程（HTTP）MCP server
- [x] 支持自定义 headers
- [x] 支持 OAuth（授权发现、浏览器回调与 token 存储）
- [x] 把 MCP 工具注册进工具列表，并纳入权限规则
- [x] 连接后读取并展示 MCP prompts / resources 数量
- [x] prompts 作为命令、resources 提供给 Agent 读取（随 P1-5）
- [x] 断线重连与连接状态展示
- [x] 测试配置校验、工具注册、权限匹配、传输与分页、失败恢复

### P1-2 子代理与自定义 Agent

**进度（2026-11-21）**：已实现内置 build / plan 主 Agent 与 general / explore 子 Agent；支持 Markdown（`~/.config/ATeam/agent/agents`、`.opencode/agent`、`.opencode/agents`）与 `agents.json` 自定义 Agent（description、mode、model、tools、permission、steps、prompt）；会话级 Agent 选择器（输入框上方）与持久化；`subagent` 工具创建隐藏子会话、同步执行并回报结果、支持继续同一子会话、子会话权限上抛到父会话并携带子 Agent 的权限规则、禁止嵌套、删除父会话时级联清理。剩余：无（后台子代理与温度采样已补齐）。

**验收**：选择 plan 后 Agent 只能读不能改；可以让子代理在独立上下文中探索代码并把结论带回主对话；自定义 Agent 的权限规则可以收紧或放宽全局策略。

- [x] 内置 primary agents：build、plan
- [x] 内置 subagents：general、explore
- [x] 支持 Markdown / JSON 自定义 Agent：system prompt、model、tools、steps
- [x] 按 Agent 的权限规则（`permission: action|resource|effect` 列表）
- [x] 按 Agent 的采样参数（temperature 等）
- [x] 增加 `subagent` 工具：子会话、执行完成后回报
- [x] 支持继续同一个子会话
- [x] 子代理后台运行与完成通知
- [x] 会话输入框上方增加 Agent 选择器（原计划为头部）
- [x] 测试 Agent 解析、权限规则、工具过滤、子会话创建、继续、权限上抛、嵌套深度限制、级联删除

### P1-3 Web 工具

**进度（2026-11-21）**：已实现 `webfetch`（http(s) 校验、30s 超时、5 MB 截断、HTML→Markdown / 纯文本 / 原始 HTML、错误与重定向 URL 回显）与 `websearch`（Tavily / Exa / Brave，明文密钥存储、0600 权限，设置页配置与状态）；两者都有独立权限 action，默认允许、可通过规则改为询问或拒绝。剩余：无。另增加 Serper 搜索 provider、webfetch 私网地址拦截（含 DNS 解析与重定向校验）与 5 分钟页面缓存。

**验收**：Agent 能抓取网页并读取正文，能用配置的搜索服务返回结果；两者都可以被权限规则限制。

- [x] 增加 `webfetch`：URL、format（markdown/text/html）、超时与输出限制
- [x] 增加 `websearch`：搜索 provider 配置与结果格式化
- [x] 为两个工具增加独立权限 action
- [x] 设置页展示搜索 provider 状态
- [x] 更多搜索 provider 与私有地址访问策略
- [x] 测试 HTML 转 markdown、错误处理、超时、权限控制

### P1-4 附件与 @ 文件引用

**进度（2026-11-21）**：已实现输入框附件（选择、拖拽、粘贴）、文本 / 图片 / PDF 支持（文本注入为 text part，PDF 优先抽取文本，抽取失败回退为多模态输入）、大小与类型校验、图片超过 1568px 自动缩放、图片附件缩略图预览、消息附件持久化与历史回放、删除会话时清理附件、以及 `@` 文件搜索与引用插入。

**验收**：可以拖入或粘贴图片、文本文件作为上下文；输入 `@` 能搜索并引用工作区文件。

- [x] 输入框支持选择文件、拖拽与粘贴
- [x] 支持文本、图片、PDF；文本直接注入，图片/PDF 作为模型输入
- [x] 支持 `@` 文件搜索与引用
- [x] 图片尺寸与大小限制、自动缩放
- [x] 扩展消息 parts 与持久化格式
- [x] 附件缩略图与 PDF 文本抽取
- [x] 测试附件解析、大小限制、引用补全、历史回放

### P1-5 自定义命令与 Skills

**进度（2026-11-21）**：已实现自定义命令发现（用户目录、`.opencode/command(s)`、`.claude/commands` 的 Markdown 与 `commands.json`）与 `$ARGUMENTS` / `$1..$9` 展开；输入框 `/` 菜单可搜索并插入命令，发送时自动展开。Skills 从用户目录、`.opencode/skill(s)`、`.claude/skills` 发现，启动时加载并把名称与描述注入 system prompt，`skill` 工具按需加载全文并纳入 `skill` 权限动作。剩余：无（命令可绑定 Agent / 模型，模板支持 `!` 包裹的 shell 片段，Skill 会附带资源文件清单）。

**验收**：输入 `/` 能选择自定义命令并按参数展开；Agent 能根据技能描述调用 `skill` 工具加载完整说明。

- [x] 支持 `.opencode/commands` 风格的 Markdown / JSON 命令
- [x] 输入框 `/` 命令菜单与参数替换
- [x] 支持 `.opencode/skills` 与 `.claude/skills` 发现
- [x] 增加 `skill` 工具与权限控制
- [x] 命令绑定 Agent / 模型与 shell 片段
- [x] 测试命令参数、Skills 发现、按需加载

### P1-6 Todo / 计划工具

**进度（2026-11-21）**：已实现 `todowrite` / `todoread`（整表替换、状态与优先级、会话持久化），输入框上方的任务面板展示进度与状态，plan 模式也可用；与 OpenCode 一致，todo 工具不单独做权限审批。剩余：无。任务状态由模型通过 todo 工具维护，与 OpenCode 一致，不做自动推进。

**验收**：多步骤任务会在会话中留下可勾选的任务清单，重启后仍可查看。

- [x] 增加 `todowrite` / `todoread` 工具
- [x] 输入框上方任务面板展示当前任务列表与进度
- [x] 权限控制与持久化（沿用会话权限模型；todo 工具本身不单独审批）
- [x] 测试任务增删改查、历史恢复

### P1-7 模型目录与能力元数据

**进度（2026-11-21）**：接入 models.dev 目录（24 小时磁盘缓存、离线回退到缓存）；模型表单与供应商表单支持“从目录填充”；模型新增最大输出、推理、附件能力与输入/输出价格元数据，运行时使用最大输出并计算每条消息成本，推理与附件控件按模型能力显隐。剩余：无。供应商支持 API Key 与通用 OAuth 2.0 两种认证方式（授权码 + PKCE、明文 token 存储 0600、自动刷新、设置页授权 / 退出）；ChatGPT / Copilot 等供应商专属 OAuth 流程未内置。模型变体可在模型表单中定义并在输入框选择，变体参与推理强度、温度与最大输出；创建供应商时可勾选并导入其模型。

**验收**：添加模型时可以从目录带出上下文、能力与价格；不具备推理或附件能力的模型会隐藏对应控件。

- [x] 接入 models.dev 模型目录，支持从目录填充供应商与模型
- [x] 一键创建供应商并导入全部模型
- [x] 支持 OAuth / API Key 两种认证方式（OpenAI 与 OpenAI 兼容供应商）
- [x] 模型元数据：上下文窗口、最大输出、推理能力、成本
- [x] 模型 variants（不同推理配置）
- [x] 根据能力启用或隐藏推理强度与附件入口
- [x] 测试目录解析与缓存、能力映射、成本计算

### P1-8 会话体验补齐

**进度（2026-11-21）**：已实现会话分叉（整段会话或从任意 assistant 消息）、按标题与消息内容搜索、首轮结束后 LLM 生成会话标题、消息成本与会话总成本、上下文占用进度条。分叉会复制所选消息及模型 / 权限 / Agent 设置，并重置任务列表与压缩状态。

**验收**：可以从任意一轮分叉出新会话；能搜索历史消息；首轮对话后标题由模型生成；头部显示成本与上下文占用。

- [x] 会话分叉（fork）
- [x] 会话搜索
- [x] 上下文占用条
- [x] 成本统计（每条消息 + 会话合计）
- [x] LLM 生成会话标题（当前取首条消息的回退保留）
- [x] 测试分叉、搜索、标题生成、成本与上下文展示

### P1-9 Question 工具

**进度（2026-11-21）**：已实现 `question` 工具（单选、多选、自由输入）、输入框上方的问答卡片、10 分钟超时与运行停止时的取消；答案回传给工具结果。子代理发起的提问会路由到父会话展示，回答后继续子代理执行。

**验收**：Agent 在执行中需要用户决策时会弹出结构化问答卡片，回答后继续执行。

- [x] 增加 `question` 工具：单选、多选、自由输入
- [x] 输入框上方展示提问卡
- [x] 取消与超时处理
- [x] 权限控制（与 OpenCode 一致不单独审批）
- [x] 子代理提问上抛到父会话
- [x] 测试单选、多选、自由输入、取消、超时

## 第一轮 P2：平台与生态（已完成）

- [x] Code Mode / `execute`：用 JavaScript 批量编排工具调用，减少中间结果进入上下文
- [x] 并行工具编排与结果聚合（同一步多个工具调用并发执行，结果按 toolCallId 聚合）
- [x] Git worktree 管理：创建、列出、删除，并支持会话迁移（`worktree_*` 工具与 `session_move`）
- [x] 桌面浏览器自动化（隐藏窗口 + `browser_*` 工具：打开、快照、点击、输入、截图、执行 JS）
- [x] Headless CLI（`pnpm cli -- ...`：prompt、工作区、模型、权限模式、会话续跑与 JSON 事件）
- [x] Server API / SDK（`pnpm serve`：REST + SSE、Bearer token、会话/消息/权限/提问接口与 `AteamClient` SDK）
- [x] ACP / 编辑器集成（`pnpm acp`：initialize、session/new、session/prompt、cancel、权限桥接与流式更新）
- [x] GitHub Action（根目录 composite action：安装后调用 Headless CLI，支持模型/权限/工作区等输入）
- [x] SQLite / 事件溯源会话存储（SQLite：`sessions.db` 存会话与消息，旧 JSON 数据自动导入）
- [x] References（命名外部资料：本地目录 / Git 仓库、描述注入、外部目录自动放行、设置页编辑）
- [x] 组织级 Policies（`agent/policy.json` 或 `ATEAM_POLICY_FILE`，权限规则最后生效）

## 第一轮实施顺序（已完成）

1. ~~P0-1 上下文压缩~~ → 已完成基础版；剩余模型能力元数据并入 P1-7，上下文占用条并入 P1-8
2. ~~P0-2 项目规则~~、~~P0-4 权限规则~~ → 已完成
3. ~~P0-3 快照 / undo~~ → 已完成
4. ~~P0-5 工具集补齐~~、~~P0-6 LSP / 格式化~~ → 已完成基础版
5. ~~P1-1 MCP~~、~~P1-2 子代理~~ → 已完成（含 MCP OAuth 与后台子代理）
6. ~~P1-3 Web 工具~~ → 已完成基础版
7. ~~P1-4 ~ P1-6、P1-9~~ → 已完成基础版
8. ~~P1-7 模型目录与能力元数据~~、~~P1-8 会话体验~~ → 已完成基础版；P1 剩余项见各模块遗留，汇总见功能文档

## 关键依赖

- 模型能力元数据是上下文压缩、推理强度显隐、模型变体的共同基础。
- 权限规则系统是 MCP、子代理、Web 工具、Skills 等新工具统一审批的基础。
- 文件快照是 undo / redo、回滚到消息、以及后续 worktree 场景的基础。
- 工具输出落盘是后台 shell、MCP 大结果、Web 抓取大页面的共同基础设施。
- 第二轮：分层配置模型是项目级 Agents / MCP / LSP / 权限 / 插件配置的共同入口，使用 ATeam 自有格式。
- 第二轮：重试与状态事件是 Steering、后台任务、UI 等待态的基础。
- 第二轮：消息 part 模型是 part 级回滚、会话 diff、审查面板与统计的基础。

## 参考

- OpenCode 源码（第二轮基准）：`packages/opencode/src/config/config.ts`、`plugin/index.ts`、`session/retry.ts`、`session/system.ts`、`session/reminders.ts`、`session/revert.ts`、`background/job.ts`、`tool/shell.ts`、`tool/task.ts`、`tool/truncate.ts`、`tool/lsp.ts`、`lsp/server.ts`、`mcp/index.ts`、`session/message-v2.ts`、`project/vcs.ts`。
- ATeam：[runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)、[defaults.ts](../apps/desktop/src/main/agent/runtime/defaults.ts)、[policy.ts](../apps/desktop/src/main/agent/runtime/policy.ts)、[message-history.ts](../apps/desktop/src/main/agent/message-history.ts)、[config-store.ts](../apps/desktop/src/main/agent/config/config-store.ts)、[tools.ts](../apps/desktop/src/main/agent/tools.ts)、[sessions-store.ts](../apps/desktop/src/main/agent/sessions/sessions-store.ts)、[model-types.ts](../packages/shared/src/model-types.ts)、[Composer.tsx](../apps/desktop/src/renderer/src/components/chat/Composer.tsx)
- ATeam 集成：[lsp.ts](../apps/desktop/src/main/agent/integrations/lsp.ts)、[formatters.ts](../apps/desktop/src/main/agent/integrations/formatters.ts)、[mcp.ts](../apps/desktop/src/main/agent/integrations/mcp.ts)、[mcp-auth-store.ts](../apps/desktop/src/main/agent/integrations/mcp-auth-store.ts)、[provider-auth-store.ts](../apps/desktop/src/main/models/provider-auth-store.ts)、[websearch.ts](../apps/desktop/src/main/stores/websearch.ts)、[permissions.ts](../apps/desktop/src/main/agent/config/permissions.ts)、[tool-output-store.ts](../apps/desktop/src/main/agent/sessions/tool-output-store.ts)、[snapshots.ts](../apps/desktop/src/main/agent/sessions/snapshots.ts)、[worktrees.ts](../apps/desktop/src/main/agent/worktrees.ts)
- ATeam 接口：[server/api.ts](../apps/desktop/src/server/api.ts)、[sdk/client.ts](../apps/desktop/src/sdk/client.ts)、[cli/main.ts](../apps/desktop/src/cli/main.ts)、[acp/server.ts](../apps/desktop/src/acp/server.ts)
- OpenCode 文档：Tools、Agents、Permissions、Instructions、Compaction、Snapshots、MCP Servers、Skills、Commands、Attachments、Formatters、LSP、Plugins、Server、TUI。
