# ATeam 已实现功能模块说明

> 更新日期：2026-11-21。覆盖当前 `master` 上已实现并对齐 OpenCode 语义的 Agent 功能；文末列出已知遗留项。
>
> 运行架构：Electron 主进程负责窗口、IPC、模型 / 搜索配置的加密存储；Agent 运行在独立 utilityProcess（`apps/desktop/src/main/agent`）；渲染进程只通过 `window.api` 的窄接口与主进程通信。

## 1. 会话与消息

### 1.1 会话管理

- 创建、重命名、删除会话；删除会话时同时清理权限规则、文件快照、附件与子会话。
- 会话持久化为单个 JSON 文件，索引文件按更新时间排序；应用重启时修复中断状态（运行中 → 空闲、流式消息 → interrupted、未结算工具 → failed）。
- 会话元数据：模型、推理强度、权限模式、当前 Agent、压缩摘要、上下文占用、任务列表、隐藏标记与父会话。

### 1.2 流式对话

- 文本、推理过程、工具调用与工具输出均以增量事件推送；Markdown 渲染，工具行展示输入、输出与状态。
- 支持停止（中断当前运行）、重试最后一条失败 / 中断消息、错误信息持久化。
- 每轮最多 25 个模型步骤（Agent 可覆盖），达到上限以 `max-steps` 结束。

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
- 会话头部展示累计成本与上下文占用进度条（上下文 token / 模型窗口）。

## 2. 模型与供应商

### 2.1 供应商

- 支持 Anthropic、OpenAI、Google 与 OpenAI-compatible 四类供应商；可配置名称、Base URL 与 API Key。
- OpenAI 与 OpenAI-compatible 供应商可选择 OAuth 2.0 认证：填写授权地址、Token 地址、Client ID / Secret、Scope 与回调地址，在供应商卡片完成授权 / 重新授权 / 退出登录；access token 作为 Bearer 凭据使用，过期前自动刷新。
- API Key 与 OAuth 客户端密钥、access / refresh token 使用 Electron `safeStorage` 加密后保存在主进程；渲染层只能看到配置状态。
- 支持从供应商接口拉取模型列表并批量添加。

### 2.2 模型元数据

- 上下文窗口、最大输出 token、是否支持推理、是否支持附件、输入 / 输出价格（USD / 百万 token）。
- 工具与压缩能力：`applyPatch`（用多文件 patch 替代 edit / write）与 `compaction`（供应商侧压缩，当前支持 Anthropic）。
- 运行时使用上下文窗口做压缩判断、最大输出限制单次生成；推理与附件控件按能力显隐。
- 每条消息按实际用量与模型价格计算成本。
- 模型变体（variants）：每个模型可定义命名预设（推理强度、温度、最大输出），在输入框选择；选择结果保存为 `provider/model#variant`，运行时按“Agent 设置 > 变体 > 模型默认”应用。

### 2.3 模型目录（models.dev）

- 拉取 `https://models.dev/api.json` 并缓存 24 小时；离线或请求失败时回退到缓存。
- 供应商表单可按名称搜索并填充名称、类型与 Base URL；模型表单可按模型搜索并填充上下文、最大输出、能力与价格。
- 推理强度（minimal / low / medium / high）按会话保存，默认跟随模型。

## 3. Agent 与子代理

### 3.1 内置 Agent

| Agent     | 模式     | 工具范围                                                           |
| --------- | -------- | ------------------------------------------------------------------ |
| `build`   | primary  | 全部工具                                                           |
| `plan`    | primary  | 只读工具（含 LSP 查询）+ todo + question（不能改文件、不能执行命令、不能用 MCP） |
| `general` | subagent | 全部工具（不能再创建子代理）                                       |
| `explore` | subagent | 只读工具（含 LSP 查询）                                            |

### 3.2 自定义 Agent

- 位置：用户目录 `agent/agents/*.md` 与 `agent/agents.json`，项目 `.opencode/agent(s)/*.md`；项目覆盖用户、用户覆盖内置。
- 字段：description（必填）、mode（primary / subagent / all）、model（支持 `provider/model#variant`）、tools、permission、steps、temperature（0–2）、prompt（正文）。
- Markdown 的 `permission` 使用 `action|resource|effect` 列表（逗号分隔），例如 `permission: edit|*|deny, shell|git *|ask`；JSON Agent 使用对象数组 `{ action, resource, effect }`。agent 权限在全局规则之后、会话规则之前生效，可收紧或放宽全局策略。
- 会话头部（输入框上方）可选择主 Agent；选择结果持久化到会话。
- 温度按 Agent 覆盖模型默认值；未配置时沿用模型 / 变体设置。

### 3.3 子代理工具

- `subagent` 工具创建隐藏子会话，在独立上下文中运行指定子 Agent，完成后把结果与子会话 id 返回主对话。
- 传 `sessionId` 可继续已有子会话；子会话的权限请求上抛到父会话审批；禁止子代理再嵌套（深度 1）。
- 支持后台运行：工具立即返回子会话 id，完成后主会话收到 `subagent.finished` 通知（可在提示条中查看结果并关闭）。
- 子代理发起的 Question 会以父会话身份展示，回答后继续子代理执行。
- 隐藏子会话不出现在会话列表、不向 UI 推送事件（完成通知除外）；删除父会话级联清理。
- `subagent` 工具纳入权限动作 `subagent`，资源为请求的 Agent 名称，默认允许。

## 4. 工具集

| 工具        | 作用                                                               | 权限 action        |
| ----------- | ------------------------------------------------------------------ | ------------------ |
| `read`      | 读取文本（行号、offset / limit）；图片作为图像内容、PDF 抽取文本 | `read`             |
| `list`      | 列目录（深度限制）                                                 | `list`             |
| `grep`      | 正则 / 字面量搜索，include、大小写、结果上限；优先使用 ripgrep    | `grep`             |
| `glob`      | 按 glob 模式找文件，hidden、数量上限、10 秒超时                    | `list`             |
| `write`     | 创建 / 覆盖文件（≤1 MB），写后格式化并附带诊断                     | `write`            |
| `edit`      | 精确字符串替换，唯一匹配或 replaceAll（`applyPatch` 模型不暴露）   | `edit`             |
| `patch`     | 单次多文件新增 / 更新 / 删除，逐文件审批（仅 `applyPatch` 模型）   | `edit`             |
| `shell`     | 执行命令，超时、流式输出、后台运行与完成通知                       | `shell`            |
| `webfetch`  | 抓取网页，markdown / text / html；私网拦截、重定向校验、5 分钟缓存 | `webfetch`         |
| `websearch` | Tavily / Exa / Brave / Serper 搜索，结果格式化                     | `websearch`        |
| `skill`     | 按名称加载 Skill 全文与附带资源清单                                | `skill`            |
| `subagent`  | 委派子任务到子代理（可后台运行）                                   | `subagent`         |
| `mcp_prompt` | 列出 / 获取 MCP prompts 并展开为提示词                            | `mcp`              |
| `mcp_resource` | 列出 / 读取 MCP resources                                      | `mcp`              |
| `lsp_hover` | 查询符号的类型与文档                                               | `read`             |
| `lsp_definition` | 查询符号定义位置                                              | `read`             |
| `todowrite` | 替换会话任务列表                                                   | 不需要审批         |
| `todoread`  | 读取任务列表                                                       | 不需要审批         |
| `question`  | 向用户提出结构化问题                                               | 不需要审批         |
| MCP 工具    | 动态注册为 `mcp_<server>_<tool>`                                   | `mcp`              |

- 大输出统一截断（200k 字符），再经输出存储落盘（30k 展示上限，完整内容保存在 `agent/tool-outputs/`）。
- 工作区外路径先触发 `external_directory` 审批；只读工具默认允许。

## 5. 权限系统

### 5.1 权限模式

| 模式          | 读 / 列表 / 搜索 | 写 / 编辑 | shell | MCP  | Web / Skill / 子代理 |
| ------------- | ---------------- | --------- | ----- | ---- | -------------------- |
| `plan`        | 允许             | 拒绝      | 拒绝  | 拒绝 | 允许                 |
| `ask`（默认） | 允许             | 询问      | 询问  | 询问 | 允许                 |
| `acceptEdits` | 允许             | 允许      | 询问  | 询问 | 允许                 |
| `auto`        | 允许             | 允许      | 允许  | 允许 | 允许                 |

### 5.2 规则

- 规则 = `action + resource + effect(allow/ask/deny) + sessionId`；全局规则与会话规则按顺序合并，**后匹配优先**。
- 求值顺序：模式基础规则 → 全局规则 → 当前 Agent 的规则 → 会话规则 → 组织策略；组织策略最后生效，可强制执行 allow / ask / deny。子代理的 Agent 规则随权限请求上抛，由父会话统一裁决。
- 支持通配符（`*`）、shell 命令的 ` *` 后缀匹配、Windows 下大小写不敏感。
- “始终允许”持久化到 `agent/permissions.json`，重启后仍生效；设置页可查看与删除。
- 多资源操作（如 shell 命令中的多个路径）任一命中 `deny` 即拒绝。

## 6. 项目规则与自定义指令

- 发现顺序：全局 `AGENTS.md`（应用数据目录）→ 工作区 → 上层目录 → Git 项目根；同一目录 `AGENTS.md` 优先于 `CLAUDE.md`；无 Git 时向 home 方向查找。
- 读取或编辑更深层文件时，按需加载该目录的 `AGENTS.md`。
- 设置页可配置额外 instructions：相对路径、绝对路径、`~/`、glob 与远程 URL（5 秒超时）。

## 7. 上下文压缩

- 发送前估算上下文：优先使用最近一条完成 assistant 消息在**最后一步**的供应商 usage（避免多步工具循环的累计值高估），只估算其后的新消息；无 usage 时回退中英文启发式估算，图片附件与工具图片按固定 token 估算。超过“窗口 − 15%（最少 16k）”时自动压缩。
- 压缩后忽略压缩边界之前的旧 usage，避免刚压缩完又因历史用量触发重复压缩。
- 模型开启 `compaction` 且供应商为 Anthropic 时不进行本地预压缩，改为请求 Anthropic 的 `compact_20260112` 服务端压缩；供应商报告 context overflow 时仍强制本地压缩并重试一次。
- 保留最近约 15k token，其余替换为一条摘要消息（原始消息仍保留，仅影响发给模型的历史）；可在消息列表展开查看摘要。
- 支持手动压缩（头部按钮）与“强制压缩短历史”；达到 60% 占用时后台预生成摘要，压缩时复用。
- 供应商返回 context-length 类错误时自动压缩并重试一次，第二次失败如实报错。

## 8. 快照与撤销 / 重做

- 每个模型步骤结束时记录工作区快照（内容寻址 blob，不写入用户仓库），并记录步骤内改动的文件。
- 撤销：恢复该轮归属的文件、回滚对话、把用户 prompt 放回输入框；支持回滚到任意 assistant 轮次。
- 重做：恢复最近一次撤销的文件与消息。
- Git 仓库遵循 ignore 规则，未跟踪文件仅纳入 ≤2 MiB；非 Git 工作区直接遍历（跳过依赖目录）。
- 运行中禁止撤销 / 重做；会话删除时清理快照并按引用回收 blob；设置页提供快照开关。

## 9. MCP（Model Context Protocol）

- 配置存储与设置页：新增 / 编辑 / 启停 / 删除 / 状态探测；本地服务器记录命令、参数、环境变量，远程服务器记录 URL 与自定义 headers。
- 传输：本地 stdio（按行 JSON-RPC）与远程 Streamable HTTP（JSON / SSE、`Mcp-Session-Id` 复用、错误转 JSON-RPC 错误）。
- 连接后读取 tools / prompts / resources；工具注册为 `mcp_<server>_<tool>`，执行前走 `mcp` 权限动作（资源为 `server/tool`）。
- 工具列表变更自动刷新；单个服务器失败不影响其他服务器，下次运行或状态探测时重连。
- OAuth：远程服务器支持授权发现（`WWW-Authenticate` / well-known）、动态客户端注册、PKCE S256、本地浏览器回调与 token 自动刷新；token 使用 Electron `safeStorage` 加密保存，设置页可授权 / 重新授权 / 退出登录，并可为需要预注册的服务器填写 OAuth Client ID、Scope 与回调地址。
- prompts 会作为斜杠命令出现在输入框菜单（命令发现最多等待 3 秒），按声明的参数顺序展开并返回渲染后的提示词；展开失败会在输入框显示错误而不是发送原始模板；`mcp_prompt` / `mcp_resource` 工具供 Agent 列出与读取 prompts / resources（资源为 `server/prompts/<name>`、`server/resources/<uri>`）。
- 状态为“需要授权”时，设置页提供 OAuth 授权入口；token 过期会在下次连接时自动刷新并持久化。

## 10. LSP 诊断与自动格式化

- 内置语言服务器：TypeScript、Go、Python、Rust、C/C++；按工作区复用客户端，不可用时静默跳过。
- read / write / edit / patch 后附带诊断（最多 20 条，含行号、级别、来源与代码），便于 Agent 自我修正。
- `lsp_hover` / `lsp_definition` 工具可在指定行列查询类型、文档与定义位置。
- 格式化器发现：prettier、biome、gofmt、rustfmt、ruff（配置文件、package.json 依赖、pyproject `[tool.ruff]`）；写入后自动执行，失败只提示、不影响工具结果。
- 设置页可按扩展名覆盖格式化器（例如 `.ts=biome`），或设为 `none` 关闭该类型的自动格式化。
- 设置页提供开关与检测状态（可用语言服务器 / 检测到的格式化器）。

## 11. Web 工具

- `webfetch`：仅 http(s)；默认 30 秒超时；HTML 转 Markdown（turndown）或纯文本 / 原始 HTML；非 HTML 原样返回；5 MB 截断；回显最终 URL、状态码与 Content-Type。
- 安全与缓存：拒绝回环、私网、链路本地与云元数据地址，DNS 解析与每次重定向都校验；成功页面缓存 5 分钟（最多 20 条）。
- `websearch`：Tavily / Exa / Brave / Serper；API Key 经 `safeStorage` 加密后由主进程下发给 worker；结果格式化为标题、URL、摘要；未配置时给出明确提示。
- 权限：独立 `webfetch` / `websearch` 动作，默认允许，可配置为询问或拒绝。

## 12. 附件与 @ 文件引用

- 添加方式：回形针选择、拖拽到输入框、粘贴剪贴板文件；附件 chip 显示名称与大小，可单独移除。
- 类型与限制：文本 ≤200 KB（二进制拒绝）、图片 ≤5 MB（超过 1568px 自动等比缩放并转 PNG）、PDF ≤10 MB。
- 文本文件在发送时以 `File: name` + 代码块注入；PDF 优先用 unpdf 抽取文本注入，抽取失败时回退为原生文件输入；图片作为多模态输入；只有附件没有文字也可以发送。
- 历史消息中的图片附件显示缩略图（按会话目录校验路径后经 IPC 读取）。
- 附件保存在 `agent/attachments/<session>/`，消息持久化引用；删除会话时清理。
- `@` 触发工作区文件搜索（忽略依赖与构建目录、按匹配度排序），点击或回车插入 `@相对路径`。

## 13. 自定义命令与 Skills

### 命令

- 发现位置：用户 `agent/commands/*.md`、`agent/commands.json`；项目 `.opencode/command(s)`、`.claude/commands`。
- 支持 name / description / agent / model frontmatter；model 支持 `provider/model#variant`。
- 模板支持 `$ARGUMENTS`、`$1`–`$9`，无占位符时在末尾追加参数；`!` 包裹的 shell 片段会在工作区执行并把 stdout 注入提示词（最多 5 段、每段 10 秒超时）。
- 输入框输入 `/` 弹出命令菜单（含 MCP prompts），插入 `/命令 `；发送时识别 `/命令 参数` 并展开为最终提示词，同时应用命令绑定的 Agent 与模型。

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

| 分区     | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 外观     | 内置主题（跟随系统 / 浅色 / 深色 / 日落橙 / 暖墨 / 石墨 / 奶油 / 冷雾） |
| 语言     | 跟随系统 / 中文 / English                                               |
| 权限     | 查看与删除已保存的权限规则                                              |
| MCP      | 服务器增删改、启停、状态刷新、OAuth 授权 / 退出登录                      |
| 网页搜索 | 服务商选择、加密 API Key、配置状态                                      |
| Agent    | 快照 / LSP / 自动格式化开关、检测状态、自定义指令文件、外部引用          |

模型管理是独立页面：供应商与模型的增删改、默认模型、目录填充、上下文与能力元数据。

## 16. 数据与存储布局

以下均位于 Electron `userData`（macOS 为 `~/Library/Application Support/ATeam`）：

```text
agent/
├── sessions/            # 会话与消息、索引
├── snapshots/           # 文件快照 blob 与索引
├── tool-outputs/        # 大工具输出完整内容
├── attachments/<session>/
├── permissions.json     # 权限规则
├── policy.json          # 组织级权限策略（可选）
├── config.json          # 快照 / LSP / 格式化开关与额外指令
├── mcp.json             # MCP 服务器配置
├── mcp-auth.json        # 加密的 MCP OAuth token 与客户端注册信息
├── references/          # Git 引用的本地缓存
├── websearch.json       # 搜索服务商与加密 Key
├── model-catalog.json   # models.dev 目录缓存
├── commands.json        # JSON 自定义命令
├── commands/            # Markdown 自定义命令
├── agents/              # 用户级 Markdown Agent
├── agents.json          # JSON 自定义 Agent
└── skills/              # 用户级 Skills
models/                  # 供应商 / 模型配置、加密密钥与 OAuth token
```

## 17. 已知限制与后续方向

- 供应商 OAuth 为通用 OAuth 2.0（OpenAI / OpenAI-compatible），未内置 ChatGPT、GitHub Copilot 等供应商专属 OAuth 流程；模型一键导入与 MCP prompts 命令已完成。
- 外部引用尚未接入 `@别名` 自动补全；对引用目录的写入不在会话快照 / undo 范围内。
- 上下文估算使用真实 usage + 启发式回退；尚未按模型接入独立 tokenizer。
- 供应商侧压缩目前仅接入 Anthropic；其他供应商仍使用本地摘要压缩。
- ripgrep 未安装时 grep 回退 JS 遍历；LSP 查询依赖对应语言服务器可执行文件。
- 命令模板中的 shell 片段会在发送时直接执行（与 OpenCode 一致），只应信任来自可信来源的命令文件。
- MCP prompt 参数按声明的参数顺序以空格分词传入，暂不支持带空格的单个参数。
- P2 已全部落地：Code Mode、并行工具编排、worktree / 会话迁移、桌面浏览器自动化、Headless CLI、Server API / SDK、ACP、GitHub Action、References、组织策略与 SQLite 会话存储；后续方向见 `opencode-agent-alignment-todo.md`。

## 18. 关键文件索引

- 运行时：[agent-runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)、[types.ts](../apps/desktop/src/main/agent/runtime/types.ts)、[defaults.ts](../apps/desktop/src/main/agent/runtime/defaults.ts)、[subagents.ts](../apps/desktop/src/main/agent/runtime/subagents.ts)
- 会话：[sessions-store.ts](../apps/desktop/src/main/agent/sessions/sessions-store.ts)、[context.ts](../apps/desktop/src/main/agent/sessions/context.ts)、[snapshots.ts](../apps/desktop/src/main/agent/sessions/snapshots.ts)
- 配置：[instructions.ts](../apps/desktop/src/main/agent/config/instructions.ts)、[permissions.ts](../apps/desktop/src/main/agent/config/permissions.ts)、[agents.ts](../apps/desktop/src/main/agent/config/agents.ts)
- 集成：[mcp.ts](../apps/desktop/src/main/agent/integrations/mcp.ts)、[lsp.ts](../apps/desktop/src/main/agent/integrations/lsp.ts)、[formatters.ts](../apps/desktop/src/main/agent/integrations/formatters.ts)、[webfetch.ts](../apps/desktop/src/main/agent/integrations/webfetch.ts)、[websearch.ts](../apps/desktop/src/main/agent/integrations/websearch.ts)
- 工具与能力：[tools.ts](../apps/desktop/src/main/agent/tools.ts)、[worktrees.ts](../apps/desktop/src/main/agent/worktrees.ts)、[attachments.ts](../apps/desktop/src/main/agent/attachments.ts)、[commands.ts](../apps/desktop/src/main/agent/commands.ts)、[skills.ts](../apps/desktop/src/main/agent/skills.ts)、[todos.ts](../apps/desktop/src/main/agent/todos.ts)、[cost.ts](../apps/desktop/src/main/agent/cost.ts)
- 浏览器与控制台：[browser-controller.ts](../apps/desktop/src/main/browser/browser-controller.ts)、[cli/main.ts](../apps/desktop/src/cli/main.ts)、[server/main.ts](../apps/desktop/src/server/main.ts)、[acp/main.ts](../apps/desktop/src/acp/main.ts)、[sdk/client.ts](../apps/desktop/src/sdk/client.ts)
- 会话存储：[session-storage.ts](../apps/desktop/src/main/agent/sessions/session-storage.ts)
- 主进程存储：[stores/models.ts](../apps/desktop/src/main/stores/models.ts)、[stores/websearch.ts](../apps/desktop/src/main/stores/websearch.ts)、[models/catalog.ts](../apps/desktop/src/main/models/catalog.ts)

## 19. Headless CLI

- 入口：`pnpm cli -- [options] [prompt]`，直接复用 Agent 运行时，无需启动 Electron 窗口。
- 模型：`--provider anthropic|openai|google|openai-compatible`、`--model`、`--api-key`（或 `ATEAM_API_KEY`）、`--base-url`、`--context-window`、`--max-output`、`--reasoning`。
- 会话：默认在 `~/.ateam/cli`（可用 `--data` 修改）创建会话；`--session <id>` 继续已有会话，`--list-sessions` 列出 CLI 会话。
- 权限：`--permission plan|ask|acceptEdits|auto`；`ask` 模式在终端询问 y/a/N，非交互环境默认拒绝；Question 工具在终端按编号选择或输入自定义答案。
- 输出：默认将文本流式写到 stdout，工具调用摘要写到 stderr；`--json` 将完整 Agent 事件按 JSON Lines 输出，便于 CI 集成。
- 限制：凭据通过命令行或环境变量以明文传入，不能解密桌面端 `safeStorage` 配置；尚未提供独立打包的二进制。

## 20. Server API 与 SDK

- 入口：`pnpm serve -- [server options] [model options]`，复用 Agent 运行时并在本机启动 HTTP 服务（默认 `127.0.0.1:4096`）。
- 安全：默认仅监听回环地址；`--token`（或 `ATEAM_SERVER_TOKEN`）启用 Bearer 鉴权，非回环地址且无 token 时会打印警告；`/health` 无需鉴权。
- REST：`GET/POST /sessions`、`GET/DELETE /sessions/:id`、`GET/POST /sessions/:id/messages`（`wait: true` 等待完成）、`POST /sessions/:id/stop|compact`、`GET /permissions`、`POST /permissions/:id`、`GET /questions`、`POST /questions/:id`。
- 实时事件：`GET /events?sessionId=...` 以 Server-Sent Events 推送完整 Agent 事件；SDK 也支持通过 Authorization 头订阅。
- SDK：`apps/desktop/src/sdk/client.ts` 提供 `AteamClient`（fetch 实现，支持自定义 fetch 注入），覆盖健康检查、会话、消息、停止、压缩、权限、提问与 SSE 事件流。
- 限制：未实现 API 版本前缀与远程部署加固；SDK 目前以源码形式提供，尚未发布独立 npm 包。

## 21. 外部引用（References）

- 配置：用户级 `agent/config.json` 的 `references`（数组或对象形式），或项目级 `.opencode/references.json`；项目别名覆盖用户别名。
- 支持本地目录（`path`，绝对 / 相对 / `~`）与 Git 仓库（`repository` + 可选 `branch`，GitHub `owner/repo` 简写自动展开）；Git 仓库按分支缓存到 `agent/references/`。
- `description` 与引用路径会注入 system prompt，Agent 可直接用绝对路径和常规工具读取；引用目录自动通过 `external_directory` 边界，但读 / 写 / shell 等工具权限仍然生效。
- 设置页“外部引用”按行编辑：`alias=path`、`alias=owner/repo#branch`，可在 `|` 后填写描述；`hidden` 仅支持配置文件。

## 22. 组织级策略（Organization Policy）

- 来源：默认读取 `agent/policy.json`，或通过 `ATEAM_POLICY_FILE` 指定受管文件；由桌面端、CLI 与 API Server 共同使用。
- 格式：`{ "permissionRules": [{ "action": "shell", "resource": "git push *", "effect": "deny" }] }`；也接受 `rules` 字段，最多 200 条，非法规则会被跳过并在设置页提示。
- 生效顺序：在模式、全局、Agent 与会话规则之后追加，因此组织策略可覆盖用户配置；仍遵循“后匹配优先”。
- 设置页 Agent 分区展示策略文件路径、错误信息与规则列表，只读；文件本身的写保护需由部署方通过操作系统权限保证。

## 23. GitHub Action

- 根目录 [action.yml](../action.yml) 提供 composite action，安装 ATeam CLI 后在同一 runner 上运行 Headless Agent。
- 输入：`prompt`、`api-key`、`model`、`provider`、`base-url`、`workspace`（默认 `github.workspace`）、`permission`（默认 `auto`）、`reasoning`、`context-window`、`max-output`、`agent`、`data`、`node-version`、`pnpm-version`。
- 安装步骤使用 `pnpm install --ignore-scripts` 跳过 Electron 等桌面依赖脚本，仅执行 `pnpm rebuild esbuild` 供 CLI 使用；随后通过安全的 bash 数组传参调用 `pnpm cli`，支持多行 prompt。
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
          "cd /path/to/ATeam/apps/desktop && pnpm acp -- --provider openai --api-key \"$OPENAI_API_KEY\" --model gpt-5 --permission ask"
        ]
      }
    }
  }
  ```
- 限制：仅实现核心 ACP 子集，不支持 `session/load`、客户端提供的 MCP server 配置、图片 / 音频 prompt；`question` 工具会自动取消。

## 25. Code Mode（`execute` 工具）

- 模型可调用 `execute`，用 JavaScript 在一个步骤内编排多次工具调用：`await tools.read({ path: 'a.ts' })`、`await tools.list({ ... })` 等，工具名与直接调用一致。
- 脚本可 `console.log` 输出，并通过 `return` 返回摘要；只有返回值与日志进入对话上下文，中间工具结果留在脚本内，适合批量搜索、跨文件汇总与 `Promise.all` 并行调用。
- 安全：运行脚本前按 `shell` 权限请求确认；脚本内的每次工具调用仍走各自的权限检查（读写、外部目录、MCP 等）；脚本在受限 VM 中执行，禁用动态代码生成，同步执行默认 10 秒超时。
- 单个操作仍应直接调用对应工具；`execute` 面向多步编排。

## 26. 并行工具调用与结果聚合

- 模型在一步中返回多个工具调用时，运行时并发执行它们；每个调用拥有独立的 toolCallId 与消息 part，流式更新互不覆盖。
- 权限按调用分别请求，同类权限选择 "always" 会同时放行同批请求；单个调用失败或拒绝只标记自身，不影响其他调用。
- 所有结果按调用聚合后随下一步请求回传模型；`execute` 脚本内也可用 `Promise.all` 主动并行编排。

## 27. Git Worktree 与会话迁移

- 新增 `worktree_create` / `worktree_list` / `worktree_remove` 工具：为当前 Git 项目创建独立分支的工作树、列出主检出与链接工作树、删除 ATeam 管理的工作树（`force` 可丢弃未提交改动）。
- 默认目录为应用数据目录下的 `worktrees/<仓库名>/<名称>`，不会污染仓库；名称会规范化为分支名，目录名则使用安全 slug；同名分支会直接复用。
- `session_move` 将当前会话迁移到新目录（通常是刚创建的工作树）；迁移在下一轮对话生效，当前运行继续使用原目录，避免中途切换导致工具与快照不一致。
- 允许的目标：当前工作区内、ATEAM 管理的 worktree 根目录下，或同一仓库的其他 worktree；其他绝对路径会被拒绝。
- `worktree_remove` 需要 `edit` 权限，且不能删除主检出或非 ATeam 管理工作树。工作区不是 Git 仓库时，工具返回明确提示。
- 限制：桌面端默认工作区若不包含 Git 仓库则无法使用；MCP server 仍以应用启动时的工作区运行。

## 28. 桌面浏览器自动化

- 桌面应用为每个会话维护一个隐藏的 Chromium 窗口（独立权限、禁用弹窗与站点权限），代理可通过工具操作页面：
  - `browser_open`：打开 HTTP/HTTPS 页面，按 `webfetch` 权限确认；
  - `browser_snapshot`：返回标题、URL、可见文本、控制台输出和带编号的可交互元素；
  - `browser_click` / `browser_type`：按快照 ref 点击或输入，可提交表单；
  - `browser_screenshot`：返回 PNG 截图并作为图片内容交给模型；
  - `browser_eval`：在页面执行 JavaScript，按 `shell` 权限确认；
  - `browser_close`：关闭窗口。
- 同一会话的浏览器操作串行执行；导航 30 秒超时，执行脚本 15 秒超时；控制台保留最近 50 条并随快照返回。
- 页面内容、控制台与执行结果均视为不可信数据，不构成指令。
- 限制：仅桌面应用可用（CLI / Server / ACP 会返回不可用）；一个会话同时只有一个页面；不提供多标签、网络面板或文件上传。

## 29. SQLite 会话存储

- 会话与消息默认存入应用数据目录的 `agent/sessions.db`：`sessions` 表保存会话元数据与 redo/压缩状态，`messages` 表按位置保存消息；WAL 模式、同步写入，进程重启后自动恢复。
- 首次启动时若数据库尚未迁移，会自动导入旧的 `agent/sessions/*.json` 会话文件并记录迁移标记；损坏的旧文件按原逻辑隔离为 `.corrupt-*`，不会阻塞其他会话。
- 存储层可切换：`new SessionsStore(path, { backend: 'json' | 'sqlite' | 'auto' })`，`auto`（默认）使用 SQLite；测试与迁移场景可显式使用 JSON 后端。
- 兼容原有修复逻辑：启动时恢复 running/waiting-permission 状态、补齐缺失字段、重置中断的工具调用。
- 限制：当前为 SQLite 状态存储而非完整事件溯源；每次持久化重写该会话的消息行，超大历史会话的写入成本随消息数增长（后续可改为增量消息写入）。
