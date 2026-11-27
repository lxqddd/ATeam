# ATeam 已实现功能模块说明

> 更新日期：2026-11-23。覆盖当前 `master` 上已实现并对齐 OpenCode 语义的 Agent 功能；文末列出已知遗留项。
>
> 运行架构：Electron 主进程负责窗口、IPC、模型 / 搜索配置与凭据存储；Electron-free Agent 运行时位于 `packages/agent-core/src`，由 desktop 的 agent-host 在 utilityProcess 中加载；CLI/Server/ACP 位于 `apps/headless`，HTTP SDK 位于 `packages/client-sdk`。渲染进程只通过 `window.api` 的窄接口与主进程通信。

## 1. 会话与消息

### 1.1 会话管理

- 创建、重命名、删除会话；删除会话时同时清理权限规则、文件快照、附件与子会话。
- 在会话页选择工作目录：标题栏显示当前目录，可切换到默认工作区、最近使用过的会话目录，或通过原生“选择文件夹”指定任意目录；运行中的会话不能切换，新会话默认使用默认工作区。目录随会话持久化，工具、提示词、快照、Skills、项目 Agent、LSP、MCP、`@` 文件搜索、项目命令发现与命令 shell 片段都使用该目录。
- 默认持久化到 SQLite（可切换 JSON 后端），按更新时间排序；应用重启时修复中断状态（运行中 → 空闲、流式消息 → interrupted、未结算工具 → failed）。
- 会话元数据：模型、推理强度、权限模式、当前 Agent、工作目录、压缩摘要、上下文占用、任务列表、隐藏标记与父会话。

### 1.2 流式对话

- 文本、推理过程、工具调用与工具输出均以增量事件推送；Markdown 渲染，工具行展示输入、输出与状态。
- 支持停止（中断当前运行）、重试最后一条失败 / 中断消息、错误信息持久化。
- 运行中仍可继续输入：消息进入会话级排队区（输入框上方展示，可编辑回填或取消）。Enter / 发送按钮按“当前步骤后插入”策略排队，当前模型步骤结束后自动发送；Ctrl/Cmd+Enter 或“立即打断”会中止当前运行后立即发送。停止按钮同时清空队列。排队消息随消息快照在重新加载时恢复；agent 重启会丢失内存中的队列，运行中暂不支持排队 shell 片段。
- 模型请求遇 429、5xx、网络错误或已建立响应后的流中断时自动退避重试；默认 4 次重试（共 5 次尝试），可在设置 → Agent 调整最大重试次数、最大等待与响应超时。聊天中展示重试次数、等待时间与原因，重试耗尽时显示最终失败原因；设置页展示重试次数、成功率与平均等待。
- 推理模型的 reasoning 与 provider metadata 仅在同一模型下回放（包括仅含 `providerMetadata` 的 redacted thinking），跨模型自动丢弃；Anthropic 在 system 与最新 user / tool 消息上设置 prompt cache 断点，OpenAI 使用会话级 prompt cache key。设置页展示缓存请求数、命中率、缓存读取 / 写入、节省 token 与估算节省金额；缓存指标与节省金额只统计聊天模型请求，标题生成、上下文压缩与模型连接测试不计入。旧消息缺少模型元数据时按启动时的会话模型补齐。
- system prompt 按 Claude / GPT / Gemini / Kimi / 通用模型选择完整基础提示，可用 `systemPrompt` 整体覆盖；环境块包含模型、工作目录、Git 标记、平台、本地时区日期与可配置备注。MCP server instructions 仅注入当前 agent 可用且未被权限拒绝的服务器，server 名称与正文进行 XML 转义。
- 每轮最多 25 个模型步骤（Agent 可覆盖）；最后一步禁用工具并要求模型总结已完成工作、未完成事项与建议下一步，run 以 `max-steps` 结束，消息下方提示可继续发送消息。

### 1.3 会话分叉（Fork）

- 可从当前会话整体分叉，或从任意 assistant 消息处截断分叉；分叉复制所选消息与模型 / 权限 / Agent 设置，重置任务列表、压缩与上下文占用。
- 运行中的会话禁止分叉。

### 1.4 会话搜索

- 左侧会话栏支持按标题与消息正文搜索（大小写不敏感），结果附带命中片段，最多 20 条；隐藏的子会话不参与搜索。

### 1.5 会话标题

- 首条用户消息会先派生标题；首轮对话成功结束后调用模型生成更简洁的标题（≤60 字符），失败时保留派生标题。
- 用户手动重命名过的会话不会被自动标题覆盖。

### 1.6 成本与上下文占用

- 每条 assistant 消息在模型配置了价格时记录估算成本（USD，六位小数）。
- 成本按实际 usage 分为普通输入、cache read、cache write 与输出四段计价；模型可单独配置 cache read / cache write 单价，留空时缓存 token 回退输入单价，四个价格都缺失时不记录成本。
- 缓存命中率与估算节省金额使用同一批 usage：命中率 = cache read / 总输入；节省金额 = cache read ×（输入单价 − cache read 单价），cache write 不计入节省。
- 会话头部展示累计成本与上下文占用进度条（上下文 token / 模型窗口）。

### 1.7 会话导出

- 当前会话（标题栏下载按钮）或全部会话（左侧会话栏）可导出为 JSON、JSONL 与 Markdown 三种格式；导出在 agent 进程中序列化，界面显示进行中状态，不阻塞聊天。「全部会话」包含隐藏的子代理会话，使父子关系能经导出 / 导入往返保留。
- 导出文件带 `kind: "ateam-session-export"` 与 `schemaVersion`（当前为 1），经原生保存对话框写入用户选择的位置。JSONL 首行为头部元数据、其后每个会话一行；Markdown 带 YAML front matter 与可读 transcript，并在末尾以 HTML 注释内嵌同一份 JSON，因此三种格式都能被导入流程重新读取。
- 默认脱敏：不包含 API Key、token、OAuth 凭据等敏感值——敏感字段（`apiKey`、`secret`、`password`、`authorization`、各类 token 等）与自由文本中的常见凭据形态（`sk-`、`ghp_`、`AKIA`、JWT、`Bearer` 等）统一替换为 `[REDACTED]`；绝对路径可选择替换为 `~` / `<PATH>` 占位符（默认开启）。
- 附件与文件快照默认不打包：附件只保留名称、类型与大小等元数据（本地路径替换为 `<ATTACHMENT>`），工具图片只保留数量，文件快照不写入导出，弹窗内有明确提示。
- 导出时归一运行状态（会话 running / waiting-permission → idle，消息 streaming → interrupted），保证导入后不会停留在运行中；保存对话框取消时保持弹窗打开，失败显示具体错误。
- 空会话与空会话列表同样可导出。

### 1.8 会话导入

- 左侧会话栏的导入按钮打开原生文件选择框，接受 JSON、JSONL 与 Markdown 导出文件；解析与校验在 agent 进程中完成，界面显示导入中状态，成功后直接载入并选中导入的会话。
- 导入总是创建新会话：会话、消息、工具调用与附件 id 全部重新生成，不覆盖已有数据；同一文件重复导入会产生彼此独立的副本。
- 父子关系保留：导出文件内的 `parentId` 映射到新会话 id；父会话不在文件中的隐藏子会话提升为可见的顶层会话，避免导入后不可见。
- 状态归一：会话状态置为 idle、`redoAvailable` 置为 false，消息 streaming / 未知状态视为 interrupted，未结算的工具调用（pending / running / awaiting-approval）标记为 failed（错误为 "Interrupted by import"），保证导入后可直接继续对话。
- 导入清洗：snapshot / step-start / step-finish / patch 等运行簿记 parts 被丢弃；附件仅保留元数据且路径替换为 `<ATTACHMENT>`；工具图片只保留数量；compaction 锚点重新映射到新消息 id，找不到时清空；todo 重新编号。
- 稳妥续聊：导出文件中的工作目录仅在本机存在且为绝对路径时保留，否则回退默认工作区；模型引用在本机配置中不可解析时清空并回退默认模型；`<PATH>` / `<ATTACHMENT>` 占位符不会作为本地路径使用。
- 非法、损坏或过旧 / 过新的文件被拒绝且不改动已有数据，界面按错误码给出可读原因（空文件、结构非法、schema 版本不支持、格式无法识别等）。

### 1.9 使用统计

- 左侧导航的统计页从本地会话记录聚合会话数、消息数、assistant 回复数、工具调用数、token 用量（输入 / 输出 / cache read / cache write / 总量）与估算成本，全部在本机完成，不上传任何数据。
- 时间范围支持全部、近 7 天与近 30 天：会话数按会话 `updatedAt` 过滤且只计可见会话；消息、token、成本、工具与模型分布按消息 `createdAt` 过滤。隐藏子代理会话的用量计入总量，但不计入会话数。
- 缺失数据单独标注而不按 0 计入：没有 usage 记录的 assistant 消息计入“未统计 usage”数量，没有 `costUsd` 的消息计入“未估算成本”数量，界面分别给出提示。
- 工具调用分布按调用次数降序（同值按名称）排列并统计失败次数；模型分布按 assistant 消息数降序（同值按供应商 / 模型）排列。两表各列可排序。
- 无数据时展示空态占位；加载失败显示错误并可重试。

## 2. 模型与供应商

### 2.1 供应商

- 支持 Anthropic、OpenAI、Google 与 OpenAI-compatible 四类供应商；可配置名称、Base URL 与 API Key。
- OpenAI 与 OpenAI-compatible 供应商可选择 OAuth 2.0 认证：填写授权地址、Token 地址、Client ID / Secret、Scope 与回调地址，在供应商卡片完成授权 / 重新授权 / 退出登录；access token 作为 Bearer 凭据使用，过期前自动刷新。
- API Key 与 OAuth 客户端密钥、access / refresh token 以明文 JSON 保存在 `userData/auth.json`（文件权限 0600），与 OpenCode 的存储方式一致；渲染层只能看到配置状态。旧版 `safeStorage` 加密数据会在启动时一次性迁移为明文。
- 支持从供应商接口拉取模型列表并批量添加。
- 项目 `ateam.json(c)` 的 `providers` / `models` 会合并进当前会话的模型选择器（带“项目”标识）：同 id 供应商/模型逐字段覆盖全局配置，新模型 id 为 `config:<provider>:<model>`；未设置默认模型时取合并后的第一个模型。合并只发生在渲染层，运行时仍以 worker 的合并结果为准，且项目 provider 只接受 `apiKeyEnv` 环境变量引用（`ProviderConfigInput` 无字面凭据字段）。
- 切换会话目录、创建会话或配置热更新时重建合并结果，请求竞态只应用最后一次；项目删除模型后自动清理失效的会话模型引用。

### 2.2 模型元数据

- 上下文窗口、最大输出 token、是否支持推理、是否支持附件、输入 / 输出 / cache read / cache write 价格（USD / 百万 token）。
- 工具与压缩能力：`applyPatch`（用多文件 patch 替代 edit / write）与 `compaction`（供应商侧压缩，当前支持 Anthropic）。
- 运行时使用上下文窗口做压缩判断、最大输出限制单次生成；推理与附件控件按能力显隐。
- 每条消息按实际用量与模型价格计算成本。
- 模型变体（variants）：每个模型可定义命名预设（推理强度、温度、最大输出），在输入框选择；选择结果保存为 `provider/model#variant`，运行时按“Agent 设置 > 变体 > 模型默认”应用。

### 2.3 模型目录（models.dev）

- 拉取 `https://models.dev/api.json` 并缓存 24 小时；离线或请求失败时回退到缓存。
- 供应商表单可按名称搜索并填充名称、类型与 Base URL；模型表单可按模型搜索并填充上下文、最大输出、能力与价格（含 cache read / cache write）。
- 推理强度（minimal / low / medium / high）按会话保存，默认跟随模型。

## 3. Agent 与子代理

### 3.1 内置 Agent

| Agent     | 模式     | 工具范围                                                                         |
| --------- | -------- | -------------------------------------------------------------------------------- |
| `build`   | primary  | 全部工具                                                                         |
| `plan`    | primary  | 只读工具（含 LSP 查询）+ todo + question（不能改文件、不能执行命令、不能用 MCP） |
| `general` | subagent | 全部工具（不能再创建子代理）                                                     |
| `explore` | subagent | 只读工具（含 LSP 查询）                                                          |

### 3.2 自定义 Agent

- 位置：用户目录 `agent/agents/*.md` 与 `agent/agents.json`，项目 `.opencode/agent(s)/*.md`；项目覆盖用户、用户覆盖内置。
- 字段：description（必填）、mode（primary / subagent / all）、model（支持 `provider/model#variant`）、tools、permission、steps、temperature（0–2）、prompt（正文）。
- Markdown 的 `permission` 使用 `action|resource|effect` 列表（逗号分隔），例如 `permission: edit|*|deny, shell|git *|ask`；JSON Agent 使用对象数组 `{ action, resource, effect }`。agent 权限在全局规则之后、会话规则之前生效，可收紧或放宽全局策略。
- 项目 Agent 按会话的当前工作目录发现；在会话页切换工作目录后，Agent 选择器与项目命令会同步刷新。
- 会话头部（输入框上方）可选择主 Agent；选择结果持久化到会话。
- 温度按 Agent 覆盖模型默认值；未配置时沿用模型 / 变体设置。

### 3.3 Plan 工作流

- plan agent 将计划写入工作区 `.ateam/plans/<session>.md`；只有该文件允许写入，其他文件、shell 与 MCP 仍被拒绝。
- `plan_exit` 先询问是否切换：确认后切换到 build agent、权限模式恢复为 `ask`，当前 plan 回合在下一次模型步骤停止，并自动开始新的 build 回合读取计划并实现；计划文件缺失或为空时不会切换，build 回合失败后重试会重新注入计划执行提示；拒绝则留在 plan 模式。
- `plan_exit` 只在 plan agent + plan 模式下暴露；build 与子代理不会获得该工具。
- 聊天头部提供计划按钮，可查看计划内容并复制绝对路径；plan_exit 成功后显示切换提醒。

### 3.4 子代理工具

- `subagent` 工具创建隐藏子会话，在独立上下文中运行指定子 Agent，完成后把结果与子会话 id 返回主对话。
- 传 `sessionId`（或 OpenCode 兼容别名 `taskId`）可继续已有子会话；子会话的权限请求上抛到父会话审批；嵌套深度由 `subagentDepth` 配置（0–5，默认 1，项目配置可覆盖），达到上限后子代理不再获得 `subagent` 工具。
- 支持后台运行：工具立即返回子会话 id；任务完成后结果以结构化合成消息注入父会话，父会话空闲时自动继续一轮让 Agent 基于结果工作；父会话忙时在当前回合结束后继续，用户停止会话后只注入不重启。
- 子代理发起的 Question 会以父会话身份展示，回答后继续子代理执行。
- 隐藏子会话不出现在会话列表、不向 UI 推送事件（完成通知除外）；删除父会话级联清理。
- `subagent` 工具纳入权限动作 `subagent`，资源为请求的 Agent 名称，默认允许。

### 3.5 后台任务

- 后台 shell 与后台子代理共用任务注册表：类型（shell / subagent）、状态（running / completed / failed / cancelled）、输出、退出码、子会话 id 与取消句柄。
- `background_tasks` 工具提供 `list` / `wait` / `cancel`；`wait` 返回结构化结果并消费该任务，避免完成时重复注入。
- 任务完成时追加合成 `background-result` 消息并自动续跑；取消的任务不注入结果；删除会话或关闭运行时取消该会话的全部后台任务。
- 聊天顶部提示条展示运行中的后台任务并可取消；完成的合成结果在对话流中展示，包含类型、标题、状态与输出（失败时高亮）。

## 4. 工具集

| 工具                 | 作用                                                               | 权限 action     |
| -------------------- | ------------------------------------------------------------------ | --------------- |
| `read`               | 读取文本（行号、offset / limit）；图片作为图像内容、PDF 抽取文本   | `read`          |
| `list`               | 列目录（深度限制）                                                 | `list`          |
| `grep`               | 正则 / 字面量搜索，include、大小写、结果上限；优先使用 ripgrep     | `grep`          |
| `glob`               | 按 glob 模式找文件，hidden、数量上限、10 秒超时                    | `list`          |
| `write`              | 创建 / 覆盖文件（≤1 MB），写后格式化并附带诊断                     | `write`         |
| `edit`               | 精确字符串替换，唯一匹配或 replaceAll（`applyPatch` 模型不暴露）   | `edit`          |
| `patch`              | 单次多文件新增 / 更新 / 删除，逐文件审批（仅 `applyPatch` 模型）   | `edit`          |
| `shell`              | 执行命令，超时、流式输出、后台运行与任务跟踪                       | `shell`         |
| `webfetch`           | 抓取网页，markdown / text / html；私网拦截、重定向校验、5 分钟缓存 | `webfetch`      |
| `websearch`          | Tavily / Exa / Brave / Serper 搜索，结果格式化                     | `websearch`     |
| `skill`              | 按名称加载 Skill 全文与附带资源清单                                | `skill`         |
| `subagent`           | 委派子任务到子代理（可后台运行）                                   | `subagent`      |
| `background_tasks`   | 列出 / 等待 / 取消后台任务                                         | 不需要审批      |
| `mcp_prompt`         | 列出 / 获取 MCP prompts 并展开为提示词                             | `mcp`           |
| `mcp_resource`       | 列出 / 读取 MCP resources 与 resource templates                    | `mcp`           |
| `lsp_hover`          | 查询符号的类型与文档                                               | `lsp`           |
| `lsp_definition`     | 查询符号定义位置                                                   | `lsp`           |
| `lsp_references`     | 查询符号的全部引用（含声明）                                       | `lsp`           |
| `lsp_implementation` | 查询接口 / 抽象符号的实现位置                                      | `lsp`           |
| `lsp_symbols`        | 列出文件符号，或按名称搜索工作区符号                               | `lsp`           |
| `lsp_call_hierarchy` | 查询函数的入向 / 出向调用层级                                      | `lsp`           |
| `vcs`                | 仓库信息、状态与 working / branch / committed diff；按补丁写工作区 | `read` / `edit` |
| `todowrite`          | 替换会话任务列表                                                   | 不需要审批      |
| `todoread`           | 读取任务列表                                                       | 不需要审批      |
| `question`           | 向用户提出结构化问题                                               | 不需要审批      |
| MCP 工具             | 动态注册为 `mcp_<server>_<tool>`                                   | `mcp`           |

- 单个工具结果先经过 200k 字符硬上限，再按 `toolOutput` 配置截断：默认 2000 行 / 50 KiB，`mode` 支持 `head` / `tail`，并可用 `toolOutput.tools.<name>` 按工具覆盖；完整输出保存到 `agent/tool-output/<session>/<call>.txt`，截断提示附带路径与 read 工具按需读取提示，超过 7 天的输出文件自动清理。
- 存在 `subagent` 工具时，系统提示会引导模型把过大的截断输出交给 `explore` 子代理阅读。
- 工作区外路径先触发 `external_directory` 审批；只读工具默认允许。

## 5. 权限系统

### 5.1 权限模式

| 模式          | 读 / 列表 / 搜索 | 写 / 编辑 | shell                | MCP  | Web / Skill / 子代理 |
| ------------- | ---------------- | --------- | -------------------- | ---- | -------------------- |
| `plan`        | 允许             | 拒绝      | 拒绝                 | 拒绝 | 允许                 |
| `ask`（默认） | 允许             | 询问      | 询问                 | 询问 | 允许                 |
| `acceptEdits` | 允许             | 允许      | 询问                 | 询问 | 允许                 |
| `auto`        | 允许             | 允许      | 允许（危险命令询问） | 允许 | 允许                 |

### 5.2 规则

- 规则 = `action + resource + effect(allow/ask/deny) + sessionId`；全局规则与会话规则按顺序合并，**后匹配优先**。
- 求值顺序：模式基础规则 → 全局规则 → 当前 Agent 的规则 → 会话规则 → 组织策略；组织策略最后生效，可强制执行 allow / ask / deny。子代理的 Agent 规则随权限请求上抛，由父会话统一裁决。
- 支持通配符（`*`）、shell 命令的 ` *` 后缀匹配、Windows 下大小写不敏感。
- “始终允许”持久化到 `agent/permissions.json`，重启后仍生效；设置页可查看与删除。
- 设置页按实际求值顺序展示六层规则来源：全局持久化 → 全局配置 → 项目配置 → 当前 Agent → 会话持久化 → 组织策略；持久化层可直接增删，其余只读并标注来源文件或 Agent 名称，空层也会显示。
- 多资源操作（如 shell 命令中的多个路径）任一命中 `deny` 即拒绝。
- shell 命令使用引号、转义感知的 bash / PowerShell / cmd 解析，按 `;`、`|`、`&&`、`||`、`&` 与换行分段；重定向目标、`--flag=value` 与普通参数中的绝对 / 父级相对路径都参与 `external_directory` 判定，变量展开路径视为不安全并触发确认。
- `sudo`、`rm -rf /`、`rm -rf .` / `.git`、`git clean -fdx`、`find -delete`、`mkfs`、`dd if=`、强制 push、管道执行 shell / Python / Node、`Invoke-Expression`、`cmd /c` 等危险命令在 `auto` 模式下仍需要显式 allow 规则或一次确认；`plan` 模式继续拒绝 shell。
- “始终允许”对单条命令按 arity 生成可复用前缀（如 `git status *`、`npm run dev *`），并支持 `git -C repo status`、`kubectl --context prod get pods` 等全局选项位于子命令前的常见形式。

## 6. 项目规则与自定义指令

- 发现顺序：全局 `AGENTS.md`（应用数据目录）→ 工作区 → 上层目录 → Git 项目根；同一目录 `AGENTS.md` 优先于 `CLAUDE.md`；无 Git 时向 home 方向查找。
- 读取或编辑更深层文件时，按需加载该目录的 `AGENTS.md`。
- 设置页可配置额外 instructions：相对路径、绝对路径、`~/`、glob 与远程 URL（5 秒超时）。

## 7. 上下文压缩

- 发送前估算上下文：优先使用最近一条完成 assistant 消息在**最后一步**的供应商 usage（避免多步工具循环的累计值高估），只估算其后的新消息；无 usage 时按模型选择 tokenizer（OpenAI o200k/cl100k、Claude 2 tokenizer），其他模型回退中英文启发式估算，图片附件与工具图片按固定 token 估算。超过“窗口 − 15%（最少 16k）”时自动压缩。
- 压缩后忽略压缩边界之前的旧 usage，避免刚压缩完又因历史用量触发重复压缩。
- 模型开启 `compaction` 且供应商为 Anthropic 时不进行本地预压缩，改为请求 Anthropic 的 `compact_20260112` 服务端压缩；其他供应商使用本地摘要压缩，供应商报告 context overflow 时仍强制本地压缩并重试一次。
- 保留最近约 15k token，其余替换为一条摘要消息（原始消息仍保留，仅影响发给模型的历史）；可在消息列表展开查看摘要。
- 支持手动压缩（头部按钮）与“强制压缩短历史”；达到 60% 占用时后台预生成摘要，压缩时复用。
- 供应商返回 context-length 类错误时自动压缩并重试一次，第二次失败如实报错。

## 8. 快照与撤销 / 重做

- 消息 part 模型：助手消息除文本、推理、附件与工具外，还包含 `step-start` / `step-finish` / `patch` / `snapshot` 元数据 part，分别记录每步开始时的快照、结束快照与结束原因 / usage、该步改动的文件，以及无步骤整轮的首尾快照；快照为内容寻址 blob，不写入用户仓库。
- 每个模型步骤结束时把工作区与步骤开始时对比；快照创建与 diff 都成功才写入 `step-finish` / `patch`，失败时该步仍保留但不提供回退；中断或报错会补一条带 `reason` 的 `step-finish`。
- 撤销：恢复该轮归属的文件、回滚对话、把用户 prompt 放回输入框；支持回滚到任意 assistant 轮次。
- 步骤回滚：最新一轮的每个已结束步骤（最后一步除外）提供回退按钮，消息按 `stepIndex` 截断到该步骤结束处，工作区恢复到该步骤结束时的快照；原始消息进入 redo 状态，重做后原位恢复。
- 重做：恢复最近一次撤销的文件与消息（整轮撤销或步骤回滚均可）。
- 文件审查面板可按文件或整轮回滚最新一轮的改动；改动文件来自消息内的 `patch` / `snapshot` part，回滚状态独立持久化，不改写消息内容，并支持按文件或一次性 unrevert；发送新消息、整轮撤销或步骤回滚会清除挂起的 revert。
- 旧消息在加载时一次性迁移：把旧的快照旁路字段编织为 step / patch / snapshot part 并持久化；迁移幂等，单条失败不阻塞会话加载；fork 会话不携带这些元数据 part。
- 会话改动汇总：审查面板可查看整个会话按轮次汇总的文件列表、增删行与去重文件数（最新轮在前，最多 50 轮，只读）。
- Git 仓库遵循 ignore 规则，未跟踪文件仅纳入 ≤2 MiB；非 Git 工作区直接遍历（跳过依赖目录）。
- 运行中禁止撤销 / 重做 / 回滚 / unrevert；会话删除时清理快照并按引用回收 blob；设置页提供快照开关。
- VCS 服务（独立于快照）：`info`（仓库根、当前分支、默认分支）、`status`、`diff`（`working` / `branch` / `committed`）与 `apply`（仅改工作区，先 check 再 apply）；非 Git 工作区返回空结果，文件数与差异文本有上限并标记截断；Agent 通过 `vcs` 工具使用，`apply` 逐文件申请 `edit` 权限。
- 工作区 Git 改动：审查面板新增“会话 / 工作区 Git”双标签，Git 标签只读展示当前分支、默认分支、文件列表与 hunks（固定 `working` 模式，打开时取一次快照），与快照 diff、revert / unrevert 数据源完全分离。

## 9. MCP（Model Context Protocol）

- 配置存储与设置页：新增 / 编辑 / 启停 / 删除 / 状态探测；本地服务器记录命令、参数、环境变量与可选工作目录（相对 workspace），远程服务器记录 URL 与自定义 headers；两类服务器都可设置请求超时（100–600000ms，留空用默认 30s）。
- 传输：本地 stdio（按行 JSON-RPC）；远程优先 Streamable HTTP（JSON / SSE、`Mcp-Session-Id` 复用），连接失败时自动回退到旧版 HTTP+SSE（`endpoint` 事件 + POST）并记住成功的传输方式，后续连接先走该方式；鉴权失败不触发回退，仍走 token 刷新流程。
- 连接后读取 tools / prompts / resources / resource templates；工具注册为 `mcp_<server>_<tool>`，执行前走 `mcp` 权限动作（资源为 `server/tool`）。
- 工具列表变更自动刷新；单个服务器失败不影响其他服务器，下次运行或状态探测时重连。
- OAuth：远程服务器支持授权发现（`WWW-Authenticate` / well-known）、动态客户端注册、PKCE S256、本地浏览器回调与 token 自动刷新；token 以明文保存在 `agent/mcp-auth.json`（文件权限 0600），设置页可授权 / 重新授权 / 退出登录，并可为需要预注册的服务器填写 OAuth Client ID、Scope 与回调地址。
- prompts 会作为斜杠命令出现在输入框菜单（命令发现最多等待 3 秒），在会话工作目录对应的 MCP 连接上展开并返回渲染后的提示词；展开失败会在输入框显示错误而不是发送原始模板；`mcp_prompt` / `mcp_resource` 工具供 Agent 列出与读取 prompts / resources / resource templates（资源为 `server/prompts/<name>`、`server/resources/<uri>`；模板以 `(template)` 标记，展开 `{placeholder}` 后按具体 URI 读取）。
- server instructions 会按当前 agent 的可用工具与 `mcp` 权限过滤后注入 system prompt（plan 模式不注入）。
- 状态为“需要授权”时，设置页提供 OAuth 授权入口；token 过期会在下次连接时自动刷新并持久化。

## 10. LSP 诊断与自动格式化

- 内置语言服务器矩阵覆盖 TypeScript / JavaScript、Go、Python、Rust、C/C++、YAML、Bash、JSON、CSS、HTML、Vue、Svelte、Astro、PHP、Prisma、TOML、Lua、Kotlin、Ruby、Dart、Swift、Zig 与 GraphQL；按 server + 项目根复用客户端，不可用时静默跳过。会话迁移或删除后，不再被任何会话使用的工作区会立即释放对应 LSP、格式化器与 Skills 缓存。
- root 检测：从文件所在目录向上查找 `tsconfig.json`、`go.mod`、`pyproject.toml` 等 marker，最近的命中目录作为 LSP root；工作区外文件与无 marker 的 server 回退到工作区。
- 项目级自定义：`ateam.json(c)` 的 `lsp` 可按 server id 覆盖 command / extensions / env / initialization，并支持 `rootMarkers`、`npmPackages` 与 `disabled`。
- 可选自动安装：配置 `lspInstall: true` 后，首次使用缺少可执行文件的 npm server 会安装到 `agent/lsp/<serverId>`；安装失败或超时（120 秒）静默回退为不可用，可用性检测本身不会触发安装。
- read / write / edit / patch 后附带诊断（最多 20 条，含行号、级别、来源与代码），便于 Agent 自我修正。
- LSP 工具：`lsp_hover` / `lsp_definition` / `lsp_references` / `lsp_implementation` / `lsp_symbols`（文件符号或工作区符号搜索）/ `lsp_call_hierarchy`（incoming / outgoing / both），统一使用独立 `lsp` 权限动作。
- 格式化器发现：内置 26 个格式化器，覆盖 Web（prettier / biome / oxfmt）、Go、Rust、Python（ruff / uv）、Elixir（mix）、Zig、C/C++（clang-format）、Kotlin（ktlint）、Ruby（rubocop / standardrb）、R（air）、Dart、OCaml（ocamlformat）、Terraform、LaTeX（latexindent）、Gleam、Shell（shfmt）、Nix（nixfmt）、PHP（pint）、Haskell（ormolu）、Clojure（cljfmt）、D（dfmt）与 ERB（htmlbeautifier）；通过项目配置或 PATH / `node_modules/.bin` / workspace 相对路径中的可执行文件探测启用（pint 还要求 composer.json 声明 `laravel/pint`）；写入后自动执行，失败只提示、不影响工具结果。
- 设置页可按扩展名覆盖格式化器（例如 `.ts=biome`），或设为 `none` 关闭该类型的自动格式化。
- 设置页提供开关与检测状态（可用语言服务器 / 检测到的格式化器）。

## 11. Web 工具

- `webfetch`：仅 http(s)；默认 30 秒超时；HTML 转 Markdown（turndown）或纯文本 / 原始 HTML；非 HTML 原样返回；5 MB 截断；回显最终 URL、状态码与 Content-Type。
- 安全与缓存：拒绝回环、私网、链路本地与云元数据地址，DNS 解析与每次重定向都校验；成功页面缓存 5 分钟（最多 20 条）。
- `websearch`：Tavily / Exa / Brave / Serper；API Key 以明文保存在 `agent/websearch.json`（文件权限 0600）并由主进程下发给 worker；结果格式化为标题、URL、摘要；未配置时给出明确提示。
- 权限：独立 `webfetch` / `websearch` 动作，默认允许，可配置为询问或拒绝。

## 12. 附件与 @ 文件引用

- 添加方式：回形针选择、拖拽到输入框、粘贴剪贴板文件；附件 chip 显示名称与大小，可单独移除。
- 类型与限制：文本 ≤200 KB（二进制拒绝）、图片 ≤5 MB（超过 1568px 自动等比缩放并转 PNG）、PDF ≤10 MB。
- 文本文件在发送时以 `File: name` + 代码块注入；PDF 优先用 unpdf 抽取文本注入，抽取失败时回退为原生文件输入；图片作为多模态输入；只有附件没有文字也可以发送。
- 历史消息中的图片附件显示缩略图（按会话目录校验路径后经 IPC 读取）。
- 附件保存在 `agent/attachments/<session>/`，消息持久化引用；删除会话时清理。
- `@` 触发文件搜索：空查询列出外部引用别名（插入 `@alias/`），输入 `alias/` 后搜索该引用目录；工作区文件继续按匹配度排序并插入 `@相对路径`。

## 13. 自定义命令与 Skills

### 命令

- 发现位置：用户 `agent/commands/*.md`、`agent/commands.json`；项目 `.opencode/command(s)`、`.claude/commands`。
- 来源：内置（`init` / `review`）、用户、项目、Skill、MCP；同名时内置 < 用户 < 项目逐级覆盖，Skill 命令与已有命令同名时跳过；菜单按名称统一排序并显示来源徽标。内置 `init` 分析仓库并创建 / 更新 `AGENTS.md`，`review` 默认以 subtask 方式在隐藏子会话审查改动。
- 支持 name / description / agent / model / subtask frontmatter；model 支持 `provider/model#variant`。
- 模板支持 `$ARGUMENTS`、`$1`–`$9`，无占位符时在末尾追加参数；参数支持单/双引号与反斜杠转义（MCP prompt 参数同样适用）。`!` 包裹的 shell 片段会在工作区执行并把 stdout 注入提示词（最多 5 段、每段 10 秒超时）；发送前会展示确认面板，列出将执行的片段，确认后才运行。
- `subtask: true` 的命令（frontmatter 或 `commands.json`）在隐藏子会话执行并绑定命令指定的 Agent / 模型；父会话只显示后台任务条，完成后以 `<background-result>` 注入并自动续跑；含 shell 片段的 subtask 命令仍需确认，运行需 `subagentDepth ≥ 1`。
- 输入框输入 `/` 弹出命令菜单（含 Skill 与 MCP prompts），插入 `/命令 `；发送时识别 `/命令 参数` 并展开为最终提示词，同时应用命令绑定的 Agent 与模型。

### Skills

- 发现位置：用户 `agent/skills`、项目 `.opencode/skill(s)`、`.claude/skills` 下的 `<name>/SKILL.md`；同名后者覆盖前者。
- 启动时加载，并把技能名称与描述注入 system prompt；`skill` 工具按名称加载全文，附带技能目录路径与资源文件清单（最多 50 个），纳入 `skill` 权限动作。
- 新增或修改 Skill 文件后需重启应用生效。

## 14. Todo 与 Question

### Todo

- `todowrite` 替换会话任务列表（内容、状态 pending/in_progress/completed/cancelled、优先级），`todoread` 读取。
- 输入框上方任务面板展示进度与状态，随会话持久化；plan 模式同样可用；工具本身不需要审批（与 OpenCode 一致）。

### Question

- `question` 工具支持单选、多选与自由输入，输入框上方展示问答卡片；答案回传给工具结果。
- 10 分钟未回答自动超时；停止运行会取消待回答问题；子代理发起的提问会路由到父会话展示，回答后继续子代理执行。

## 15. 设置页

| 分区     | 内容                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| 外观     | 内置主题（跟随系统 / 浅色 / 深色 / 日落橙 / 暖墨 / 石墨 / 奶油 / 冷雾）                                         |
| 语言     | 跟随系统 / 中文 / English                                                                                       |
| 权限     | 查看与删除已保存的权限规则                                                                                      |
| MCP      | 服务器增删改、启停、状态刷新、OAuth 授权 / 退出登录                                                             |
| 网页搜索 | 服务商选择、API Key（0600 明文）、配置状态                                                                      |
| Agent    | 快照 / LSP / 自动格式化开关、检测状态、自定义指令文件、外部引用；项目配置摘要入口（路径、诊断数、跳转项目分区） |
| 全局     | LSP / Formatters 三态（默认 / 仅开关 / 自定义列表 + 启用开关）、Commands 模板、Skills 路径与 Raw JSON 编辑      |
| 项目     | 概览（来源/生效值/诊断）、Providers、LSP、Formatters、Commands、Skills 结构化表单与 Raw JSONC 编辑              |
| 插件     | 安装 / 启用 / 移除、来源与加载错误、插件声明的登录方式、连接状态、授权与退出登录、OAuth 自动刷新                |

模型管理是独立页面：供应商与模型的增删改、默认模型、目录填充、上下文与能力元数据；选中会话工作区存在项目 providers 时，额外展示只读的项目 provider/模型覆盖。MCP 页按当前会话 workspace 加载，project server 显示来源并禁用编辑/启停，OAuth 授权仍可用。

## 16. 数据与存储布局

以下均位于 Electron `userData`（macOS 为 `~/Library/Application Support/ATeam`）：

```text
agent/
├── sessions/            # 会话与消息、索引
├── snapshots/           # 文件快照 blob 与索引
├── tool-output/         # 大工具输出完整内容（按会话分目录，7 天后清理）
├── attachments/<session>/
├── permissions.json     # 权限规则
├── policy.json          # 组织级权限策略（可选）
├── config.json          # 快照 / LSP / 格式化 / 输出截断 / 子代理深度等配置与额外指令
├── mcp.json             # MCP 服务器配置
├── mcp-auth.json        # MCP OAuth token 与客户端注册信息（明文，0600）
├── references/          # Git 引用的本地缓存
├── websearch.json       # 搜索服务商与 API Key（明文，0600）
├── model-catalog.json   # models.dev 目录缓存
├── plugins.json         # 已安装插件、启用状态与版本兼容信息
├── commands.json        # JSON 自定义命令
├── commands/            # Markdown 自定义命令
├── agents/              # 用户级 Markdown Agent
├── agents.json          # JSON 自定义 Agent
└── skills/              # 用户级 Skills
auth.json                # 供应商 API Key / OAuth token / client secret（明文，0600）
models/                  # 供应商 / 模型配置
```

## 17. 已知限制与后续方向

- 供应商 OAuth 为通用 OAuth 2.0（OpenAI / OpenAI-compatible）；ChatGPT、GitHub Copilot 等供应商使用未公开的专有登录与令牌交换流程，Ateam 内置流程不实现这类非公开认证。插件可以声明 `auth` 方法与提示项，由设置页动态渲染登录表单并调用插件自己的 `authorize` 流程；OAuth 方法还可声明 `refresh` 回调，未提供 token endpoint 的插件凭据会在过期前由主进程自动刷新并写回 `auth.json`。
- OpenAI 服务端压缩返回的 opaque compaction item 目前无法通过 AI SDK 回传，因此 `compaction` 仅对 Anthropic 生效；OpenAI 等其他供应商使用本地摘要压缩。
- ripgrep 已随应用打包（按平台可选依赖），缺失时仍回退 JS 遍历；LSP 查询依赖对应语言服务器可执行文件，可在配置中开启 npm 按需安装（见第 10 节）。
- 缓存指标与估算节省为 agent 进程内统计，重启清零；只统计聊天模型请求（标题生成、上下文压缩与模型连接测试不计入），且可能包含失败 / 重试尝试已上报的 usage，消息成本只按最终一次尝试计算。成本依赖供应商把 `inputTokens` 归一化为含缓存的总输入；异常上报会被下限保护为 0，可能少算普通输入。
- 分层配置已完成全局 + 项目 `ateam.json/jsonc`、来源/生效值/诊断展示、结构化 provider/LSP/formatter/commands/skills 管理表单、原始 JSONC 兜底编辑、项目模型进入选择器（带“项目”标识）、权限规则六层来源 UI 与完整配置矩阵 E2E。全局设置新增“全局配置”分区：LSP / Formatters 支持默认、仅开关（已有自定义列表时只写 `lspEnabled` / `formattersEnabled`，不丢列表）与自定义列表三种模式，Commands 编辑模板与元数据，Skills 按行维护路径，另有 Raw JSON 兜底；所有写入走路径级编辑，只改表单托管的顶层 key，未知顶层字段原样保留，保存后内存配置立即刷新。全局文件是严格 JSON：注释、尾随逗号与非对象根会被拒绝，前导 BOM 会被容忍并保留。主进程以目录监听 + 去抖 + mtime 兜底监视全局 `config.json`、`permissions.json`、`mcp.json` 与项目 `ateam.json(c)`，外部修改约 1 秒内刷新设置页与缓存；应用内保存与“始终允许”回复通过内容摘要抑制自写事件；watcher 按会话 workspace 建立 Git 根租约，会话切换或删除时释放旧根（无会话占用的根关闭 watcher 并清理挂起事件，LRU 上限 32，`trackWorkspace` 的持久租约不释放）。全局 reload 同时重读权限规则与用户 MCP 服务器，MCP 只断开配置变化或被删除服务器的连接，未变化连接保持。边界：结构化表单只托管 `providers` / `lsp` / `lspEnabled` / `lspInstall` / `formatters` / `formattersEnabled` / `formatterOverrides` / `commands` / `skills` 顶层 key 的路径级 diff，数组或整对象替换会丢失节点内注释，JSONC 无效时结构化面板只读、需在 Raw 中修复，数组形式的 `commands` 仍需先在 Raw 中转成对象；`config.update` 会把已知顶层字段重写为规范化形式，已知值内部的未知键仍可能被丢弃；`policy.json` 为受管只读文件（界面只展示路径与错误，不承诺热重载），`mcp-auth.json` 不进入监听范围。
- P2 已全部落地：Code Mode、并行工具编排、worktree / 会话迁移、桌面浏览器自动化、Headless CLI、Server API / SDK、ACP、GitHub Action、References、组织策略与 SQLite 会话存储；后续方向见 `opencode-agent-alignment-todo.md`。
- 桌面安装包尚未配置代码签名与公证（macOS `notarize: false`）；正式分发前需提供证书、公证凭据并调整 `electron-builder.yml`。

## 18. 关键文件索引

- 运行时：[agent-runtime.ts](../packages/agent-core/src/runtime/agent-runtime.ts)、[types.ts](../packages/agent-core/src/runtime/types.ts)、[defaults.ts](../packages/agent-core/src/runtime/defaults.ts)、[subagents.ts](../packages/agent-core/src/runtime/subagents.ts)、[history-service.ts](../packages/agent-core/src/runtime/history-service.ts)、[plan-service.ts](../packages/agent-core/src/runtime/plan-service.ts)、[step-tracker.ts](../packages/agent-core/src/runtime/step-tracker.ts)、[command-service.ts](../packages/agent-core/src/runtime/command-service.ts)
- 会话：[sessions-store.ts](../packages/agent-core/src/sessions/sessions-store.ts)、[context.ts](../packages/agent-core/src/sessions/context.ts)、[snapshots.ts](../packages/agent-core/src/sessions/snapshots.ts)、[export.ts](../packages/agent-core/src/sessions/export.ts)（导出序列化、脱敏与结构校验）、[import.ts](../packages/agent-core/src/sessions/import.ts)（导入解析、清洗与 id 重映射）、[usage.ts](../packages/agent-core/src/sessions/usage.ts)（使用统计聚合：范围过滤、缺失用量与成本标注）
- 配置：[config-store.ts](../packages/agent-core/src/config/config-store.ts)（含 `readGlobalConfigFile` / `writeGlobalConfigFile` 与 `AgentConfigStore.edit`）、[project-config.ts](../packages/agent-core/src/config/project-config.ts)、[project-config-edit.ts](../packages/agent-core/src/config/project-config-edit.ts)、[instructions.ts](../packages/agent-core/src/config/instructions.ts)、[permissions.ts](../packages/agent-core/src/config/permissions.ts)、[agents.ts](../packages/agent-core/src/config/agents.ts)
- 集成：[mcp.ts](../packages/agent-core/src/integrations/mcp.ts)、[lsp.ts](../packages/agent-core/src/integrations/lsp.ts)、[formatters.ts](../packages/agent-core/src/integrations/formatters.ts)、[webfetch.ts](../packages/agent-core/src/integrations/webfetch.ts)、[websearch.ts](../packages/agent-core/src/integrations/websearch.ts)
- 工具与能力：[tools/index.ts](../packages/agent-core/src/tools/index.ts)、[worktrees.ts](../packages/agent-core/src/worktrees.ts)、[attachments.ts](../packages/agent-core/src/attachments.ts)、[commands.ts](../packages/agent-core/src/commands.ts)、[skills.ts](../packages/agent-core/src/skills.ts)、[todos.ts](../packages/agent-core/src/todos.ts)、[cost.ts](../packages/agent-core/src/cost.ts)
- 浏览器与控制台：[browser-controller.ts](../apps/desktop/src/main/browser/browser-controller.ts)、[cli/main.ts](../apps/headless/src/cli/main.ts)、[server/main.ts](../apps/headless/src/server/main.ts)、[acp/main.ts](../apps/headless/src/acp/main.ts)、[sdk/client.ts](../packages/client-sdk/src/client.ts)
- 会话存储：[storage/index.ts](../packages/agent-core/src/sessions/storage/index.ts)
- 主进程存储：[model-config-store.ts](../apps/desktop/src/main/settings/model-config-store.ts)、[websearch-config-store.ts](../apps/desktop/src/main/settings/websearch-config-store.ts)、[catalog.ts](../apps/desktop/src/main/providers/catalog.ts)
- 配置 UI：[ProjectConfigCard.tsx](../apps/desktop/src/renderer/src/components/settings/ProjectConfigCard.tsx)、[project/ProjectSettings.tsx](../apps/desktop/src/renderer/src/components/settings/project/ProjectSettings.tsx)、[project/useProjectConfig.ts](../apps/desktop/src/renderer/src/components/settings/project/useProjectConfig.ts)、[global/GlobalSettings.tsx](../apps/desktop/src/renderer/src/components/settings/global/GlobalSettings.tsx)、[global/useGlobalConfig.ts](../apps/desktop/src/renderer/src/components/settings/global/useGlobalConfig.ts)、[config-controller.ts](../apps/desktop/src/renderer/src/components/settings/config-controller.ts)、[config-watcher.ts](../apps/desktop/src/main/config-watcher.ts)

## 19. Headless CLI

- 入口：`pnpm cli -- [options] [prompt]`，直接复用 Agent 运行时，无需启动 Electron 窗口；第二个 `--` 之后的参数按字面 prompt 处理。
- 模型：`--provider anthropic|openai|google|openai-compatible`、`--model`、`--api-key`（或 `ATEAM_API_KEY`）、`--base-url`、`--context-window`、`--max-output`、`--reasoning`。
- 会话：默认在 `~/.ateam/cli`（可用 `--data` 修改）创建会话；`--session <id>` 继续已有会话，`--list-sessions` 列出 CLI 会话，`--restore-sessions` 将 `.migrated` 旧会话备份恢复并重新导入数据库后退出。
- 权限：`--permission plan|ask|acceptEdits|auto`；`ask` 模式在终端询问 y/a/N，非交互环境默认拒绝；Question 工具在终端按编号选择或输入自定义答案。
- 输出：默认将文本流式写到 stdout，工具调用摘要写到 stderr；`--json` 将完整 Agent 事件按 JSON Lines 输出，便于 CI 集成。
- 限制：凭据通过命令行或环境变量以明文传入；CLI 不读取桌面端 `auth.json`；已有独立 `apps/headless/dist` 构建，但尚未提供单一可执行文件。

## 20. Server API 与 SDK

- 入口：`pnpm serve -- [server options] [model options]`，复用 Agent 运行时并在本机启动 HTTP 服务（默认 `127.0.0.1:4096`）。
- 安全：默认仅监听回环地址并拒绝在无 token 时绑定非回环地址（`--allow-unauthenticated-remote` 可显式放宽）；`--token`（或 `ATEAM_SERVER_TOKEN`）启用 Bearer 鉴权；`/health` 无需鉴权。默认不发送 CORS 响应头，浏览器跨源页面无法读取或修改本机 API；确有需要时可在 `createApiServer` 传入 `corsOrigin`。
- REST：`GET/POST /sessions`、`GET/DELETE /sessions/:id`、`GET/POST /sessions/:id/messages`（`wait: true` 等待完成）、`POST /sessions/:id/stop|compact`、`GET /permissions`、`POST /permissions/:id`、`GET /questions`、`POST /questions/:id`。
- 实时事件：`GET /events?sessionId=...` 以 Server-Sent Events 推送完整 Agent 事件；SDK 也支持通过 Authorization 头订阅。
- SDK：`packages/client-sdk/src/client.ts` 提供 `AteamClient`（fetch 实现，支持自定义 fetch 注入），覆盖健康检查、会话、消息、停止、压缩、权限、提问与 SSE 事件流。
- 版本与安全：所有路由同时接受 `/` 与 `/v1` 前缀；绑定非回环地址且未设置 token 时默认拒绝启动（可用 `--allow-unauthenticated-remote` 显式放宽），默认不发送 CORS 头。
- 构建：`packages/client-sdk` 通过 tsup 生成 ESM + CJS + d.ts，当前仍为 private，尚未发布独立 npm 包。

## 21. 外部引用（References）

- 配置：用户级 `agent/config.json` 的 `references`（数组或对象形式），或项目级 `.opencode/references.json`；项目别名覆盖用户别名。
- 支持本地目录（`path`，绝对 / 相对 / `~`）与 Git 仓库（`repository` + 可选 `branch`，GitHub `owner/repo` 简写自动展开）；Git 仓库按分支缓存到 `agent/references/`。
- `description` 与引用路径会注入 system prompt，Agent 可直接用绝对路径和常规工具读取；输入框可用 `@alias/路径` 补全并引用外部文件，引用目录自动通过 `external_directory` 边界，但读 / 写 / shell 等工具权限仍然生效。
- 设置页“外部引用”按行编辑：`alias=path`、`alias=owner/repo#branch`，可在 `|` 后填写描述；`hidden` 仅支持配置文件。
- 会话快照同时捕获引用目录的文件（内部键前缀 `\0refs/<alias>/`），每个引用最多 5,000 个文件；对引用目录的写入可随 undo / redo 恢复，恢复写入会拒绝符号链接逃逸，跨目录 undo 会恢复到快照所属目录。

## 22. 组织级策略（Organization Policy）

- 来源：默认读取 `agent/policy.json`，或通过 `ATEAM_POLICY_FILE` 指定受管文件；由桌面端、CLI 与 API Server 共同使用。
- 格式：`{ "permissionRules": [{ "action": "shell", "resource": "git push *", "effect": "deny" }] }`；也接受 `rules` 字段，最多 200 条，非法规则会被跳过并在设置页提示。
- 生效顺序：在模式、全局、Agent 与会话规则之后追加，因此组织策略可覆盖用户配置；仍遵循“后匹配优先”。
- 设置页 Agent 分区展示策略文件路径、错误信息与规则列表，只读；文件本身的写保护需由部署方通过操作系统权限保证。

## 23. GitHub Action

- 根目录 [action.yml](../action.yml) 提供 composite action，安装 ATeam CLI 后在同一 runner 上运行 Headless Agent。
- 输入：`prompt`、`api-key`、`model`、`provider`、`base-url`、`workspace`（默认 `github.workspace`）、`permission`（默认 `auto`）、`reasoning`、`context-window`、`max-output`、`agent`、`data`、`node-version`、`pnpm-version`。
- 安装步骤使用 `pnpm install --frozen-lockfile --ignore-scripts`，执行 `pnpm rebuild esbuild` 并构建 `@ateam/headless`；prompt 通过 stdin 传入构建后的 `apps/headless/dist/cli.js`，避免以 `--` 开头的内容被当作参数，并支持多行 prompt。
- 使用示例：
  ```yaml
  - uses: actions/checkout@v4
  - uses: lxqddd/ATeam@master
    with:
      prompt: Review the changes and fix failing tests.
      provider: openai
      model: gpt-5
      api-key: ${{ secrets.OPENAI_API_KEY }}
      permission: auto
  ```
- 注意：`permission: auto` 允许自动改文件与执行命令；在 CI 中应仅用于受信任仓库，API Key 通过 Secrets 传入。Action 每次运行都会安装源码依赖，暂无独立二进制分发；运行器上的 CLI 会话默认不跨 job 保留。

## 24. ACP / 编辑器集成

- 入口：`pnpm acp -- [model options]`，通过 stdio 提供 Agent Client Protocol v1，供 Zed 等编辑器作为外部 Agent 启动。
- 支持的方法：`initialize`、`session/new`（按编辑器给出的 `cwd` 创建独立运行时）、`session/prompt`、`session/cancel`；文本以 `agent_message_chunk` 流式回传，工具调用以 `tool_call` / `tool_call_update` 通知更新。
- 权限：运行时权限请求会转发为 `session/request_permission`，客户端选择 allow once / always / reject；提问工具暂无可对应协议，自动取消并继续。
- 会话：每个工作目录复用独立的 Agent 运行时；模型、数据目录、权限模式等沿用 CLI 参数。
- Zed 配置示例（路径按实际安装位置替换）：
  ```json
  {
    "agent_servers": {
      "ATeam": {
        "command": "bash",
        "args": [
          "-lc",
          "cd /path/to/ATeam && pnpm acp -- --provider openai --api-key \"$OPENAI_API_KEY\" --model gpt-5 --permission ask"
        ]
      }
    }
  }
  ```
- 支持 `session/load` 历史回放与图片 prompt（转为附件）；初始化声明 `loadSession: true`、`promptCapabilities.image/embeddedContext: true`。
- 客户端在 `session/new` / `session/load` 中提供的 MCP server 会作为该会话的临时 server 接入（不写入用户配置）。
- 客户端声明 `clientCapabilities.elicitation.form` 时，`question` 工具会映射为 ACP `elicitation/create` 表单；未声明时自动取消。

## 25. Code Mode（`execute` 工具）

- 模型可调用 `execute`，用 JavaScript 在一个步骤内编排多次工具调用：`await tools.read({ path: 'a.ts' })`、`await tools.list({ ... })` 等，工具名与直接调用一致。
- 脚本可 `console.log` 输出，并通过 `return` 返回摘要；只有返回值与日志进入对话上下文，中间工具结果留在脚本内，适合批量搜索、跨文件汇总与 `Promise.all` 并行调用。
- 安全：运行脚本前按 `shell` 权限请求确认；脚本在独立子进程中执行，并启用 Node 权限模型（默认禁止文件读写、子进程、worker、addon）。用户代码运行在双层 VM 中，宿主对象只通过受控桥接传递，无法直接取得 `process`、`require`、网络 API 或宿主任意对象；无工具活动超过 10 秒会强制终止（`await` 后的死循环也能中断）。脚本内可用的工具目录与当前 Agent/模型实际可见的工具一致（含 MCP，不含被过滤的 write/edit 等），每次调用仍走各自的权限检查。
- 仍建议只批准可信来源触发的代码模式；沙箱不能替代对提示注入的警惕。
- 单个操作仍应直接调用对应工具；`execute` 面向多步编排。

## 26. 并行工具调用与结果聚合

- 模型在一步中返回多个工具调用时，运行时并发执行它们；每个调用拥有独立的 toolCallId 与消息 part，流式更新互不覆盖。
- 权限按调用分别请求，同类权限选择 "always" 会同时放行同批请求；单个调用失败或拒绝只标记自身，不影响其他调用。
- 所有结果按调用聚合后随下一步请求回传模型；`execute` 脚本内也可用 `Promise.all` 主动并行编排。

## 27. Git Worktree 与会话迁移

- 新增 `worktree_create` / `worktree_list` / `worktree_remove` 工具：为当前 Git 项目创建独立分支的工作树、列出主检出与链接工作树、删除 ATeam 管理的工作树（`force` 可丢弃未提交改动）。
- 默认目录为应用数据目录下的 `worktrees/<仓库名>-<路径哈希>/<名称>`，不会污染仓库，也不会与同名但不同路径的仓库冲突；名称会规范化为分支名，目录名使用安全 slug；同名分支会直接复用；`base` 不允许以 `-` 开头，避免参数注入。
- `session_move` 将当前会话迁移到新目录（通常是刚创建的工作树）；迁移在下一轮对话生效，当前运行继续使用原目录，避免中途切换导致工具与快照不一致。`worktree_create` 需要 `shell` 权限，`session_move` 需要 `edit` 权限，plan 模式或组织策略拒绝时不会执行。
- 允许的目标：当前工作区内、ATEAM 管理的 worktree 根目录下，或同一仓库的其他 worktree；其他绝对路径会被拒绝。新会话在创建时固定记录自己的工作目录，避免多个运行时（CLI / Server / ACP）共用数据目录时串用工作区。
- `worktree_remove` 需要 `edit` 权限，且不能删除主检出、非 ATeam 管理工作树，或仍被运行中/已绑定会话使用的工作树。工作区不是 Git 仓库时，工具返回明确提示。
- MCP server 按会话实际工作区创建独立连接；会话迁移后会使用新目录启动对应 MCP 进程。
- 快照记录自己的根目录，跨目录 undo / redo 会恢复到快照所属目录，而不是写入当前工作树；桌面端使用 worktree 工具需要工作区位于 Git 仓库内。

## 28. 桌面浏览器自动化

- 桌面应用为每个会话维护最多 8 个隐藏的 Chromium 标签页（独立会话分区、禁用弹窗与站点权限），代理可通过工具操作页面：
  - `browser_open`：打开 HTTP/HTTPS 页面，按 `webfetch` 权限确认；`newTab` 可新建标签页并返回 tab id；
  - `browser_tabs`：列出标签页及其 tab id；
  - `browser_snapshot`：返回标题、URL、可见文本、控制台输出和带编号的可交互元素；
  - `browser_click` / `browser_type`：按快照 ref 点击或输入，可提交表单；
  - `browser_screenshot`：返回 PNG 截图并作为图片内容交给模型；
  - `browser_eval`：在页面执行 JavaScript，按 `shell` 权限确认；
  - `browser_network`：列出最近的网络请求与状态码；
  - `browser_upload`：把工作区文件附加到 file input（按 `read` 权限确认）；
  - `browser_close`：关闭指定标签页，未指定 tabId 时关闭整个浏览器。
- 每个会话使用独立的临时浏览器分区（不共享 cookie / localStorage，关闭后不落盘）；同一会话的浏览器操作串行执行，排队超过请求时限的操作会被放弃。导航 30 秒、页面脚本 20 秒、执行 JavaScript 15 秒超时；页面无响应会销毁并重置窗口，避免队列永久卡死。
- 页面内容、控制台与执行结果均视为不可信数据，不构成指令；页面导航与重定向限制在 HTTP/HTTPS，`file://` 等协议会被拦截；下载与站点权限请求一律拒绝。会话删除时关闭其浏览器窗口。
- 除 `browser_open`/`browser_tabs` 外的工具都接受可选 `tabId`，默认操作当前活动标签页。
- 限制：仅桌面应用可用（CLI / Server / ACP 会返回不可用）。

## 29. SQLite 会话存储

- 会话与消息默认存入应用数据目录的 `agent/sessions.db`：`sessions` 表保存会话元数据与 redo/压缩状态，`messages` 表按位置保存消息；WAL 模式、同步写入，进程重启后自动恢复。
- 首次启动时若数据库尚未迁移，会在单个事务中导入旧的 `agent/sessions/*.json` 会话文件并记录迁移标记；导入成功后旧文件改名为 `.migrated` 保留备份。损坏的旧文件隔离为 `.corrupt-*`，不会阻塞其他会话；损坏的数据库行移入 `corrupt_sessions` / `corrupt_messages` 表而不是直接丢弃。
- 数据库文件及 WAL/SHM 权限为 `0600`。存储层可切换：`new SessionsStore(path, { backend: 'json' | 'sqlite' | 'auto' })`，`auto`（默认）使用 SQLite；若 Node 不支持 `node:sqlite` 且已有数据库文件，会明确报错而不是静默回退导致会话“消失”，仅在尚未创建数据库时回退 JSON。
- 兼容原有修复逻辑：启动时恢复 running/waiting-permission 状态、补齐缺失字段、重置中断的工具调用。
- 持久化按消息位置增量写入：仅更新内容变化的行，删除被 undo 截断的尾部行。
- 事件溯源：`session_events` 追加记录会话创建/更新、消息 upsert 与删除；状态表作为物化视图。状态行损坏或缺失时，启动会自动从事件日志事务化重建；既有数据库首次加载也会补写基线事件。
- 事件日志每 2,000 条写入一次 `session.checkpoint`（含完整状态与消息）并清理更早事件，避免无限增长。
- 导入后的 `.migrated` 备份不会自动重新导入；运行 `pnpm cli -- --restore-sessions --data <dir>` 可把备份恢复为 `.json`、清除迁移标记并立即重新导入。

## 30. 打包与发行验收

- `pnpm --filter @ateam/desktop build:unpack` 生成当前平台的未打包应用；`CSC_IDENTITY_AUTO_DISCOVERY=false` 可在无签名证书的环境跳过 macOS 签名。
- `pnpm --filter @ateam/desktop smoke:packaged` 启动打包产物（临时用户数据目录与调试端口），验证渲染窗口、Agent worker、会话创建/持久化，并通过本地 OpenAI-compatible mock 模型完成一次 `grep` 工具调用对话。
- `.github/workflows/package.yml` 在 macOS / Linux / Windows 上构建未打包应用、运行冒烟测试（Linux 使用 `xvfb-run`），并把 `.app` / `linux-unpacked` / `win-unpacked` 打包为 zip / tar.gz 直接上传到 GitHub Release 草稿；不使用 Actions Artifacts。推送 `v*` 标签时额外构建 macOS arm64 + x64 dmg、nsis exe、AppImage + deb，全部平台成功后才把草稿 Release 发布。
- 冒烟脚本只依赖 Node 内置模块与打包产物，不需要安装 Playwright 浏览器；Linux 需要 `xvfb`，脚本自动传入 `--no-sandbox --disable-gpu`。
- 当前产包未签名、未公证；正式发布需配置 Apple Developer ID / Windows 代码签名，并为 macOS 增加公证步骤。
- Linux/Windows 产物架构跟随 runner；macOS 在 arm64 runner 上同时交叉构建 arm64 与 x64 安装包，但 x64 包未在 CI 实机启动验证。
- 发布：更新 `apps/desktop/package.json` 版本并推送 `vX.Y.Z` 标签；工作流校验标签与版本一致后构建安装包，并创建/更新 GitHub Release。

## 31. 应用更新检查

- 设置 → 更新：显示当前版本，自动检查 GitHub `releases/latest`，展示新版本号、发布时间与 release notes；支持手动重新检查。
- 版本比较使用语义化版本规则（支持 `v` 前缀与预发布标识）；只有远端版本高于当前版本时才提示更新。
- 下载：按平台选择资产（macOS dmg/zip、Windows exe/msi、Linux AppImage/deb），优先匹配当前 CPU 架构；主进程下载到系统下载目录并通过进度事件实时显示已下载字节与百分比，校验 GitHub 提供的 sha256 digest 与文件大小，随后打开安装包。
- 安全：下载地址必须来自 GitHub 允许的域名（`github.com` / GitHub release assets 域名），拒绝任意 URL；不会静默执行下载内容。
- 仓库默认为 `lxqddd/ATeam`，可用 `ATEAM_GITHUB_REPO` 覆盖；`ATEAM_GITHUB_TOKEN` 可提高 GitHub API 限额，`ATEAM_GITHUB_API_URL` 用于测试或 GitHub Enterprise。
- 当前不做应用内静默升级：更新由用户下载并运行安装包完成；未签名/未公证的安装包可能触发 Gatekeeper 或 SmartScreen 提示。
