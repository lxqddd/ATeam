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
- API Key 使用 Electron `safeStorage` 加密后保存在主进程；渲染层只能看到“是否已配置”，编辑时通过小眼睛按需解密回显。
- 支持从供应商接口拉取模型列表并批量添加。

### 2.2 模型元数据

- 上下文窗口、最大输出 token、是否支持推理、是否支持附件、输入 / 输出价格（USD / 百万 token）。
- 运行时使用上下文窗口做压缩判断、最大输出限制单次生成；推理与附件控件按能力显隐。
- 每条消息按实际用量与模型价格计算成本。

### 2.3 模型目录（models.dev）

- 拉取 `https://models.dev/api.json` 并缓存 24 小时；离线或请求失败时回退到缓存。
- 供应商表单可按名称搜索并填充名称、类型与 Base URL；模型表单可按模型搜索并填充上下文、最大输出、能力与价格。
- 推理强度（minimal / low / medium / high）按会话保存，默认跟随模型。

## 3. Agent 与子代理

### 3.1 内置 Agent

| Agent     | 模式     | 工具范围                                                           |
| --------- | -------- | ------------------------------------------------------------------ |
| `build`   | primary  | 全部工具                                                           |
| `plan`    | primary  | 只读工具 + todo + question（不能改文件、不能执行命令、不能用 MCP） |
| `general` | subagent | 全部工具（不能再创建子代理）                                       |
| `explore` | subagent | 只读工具                                                           |

### 3.2 自定义 Agent

- 位置：用户目录 `agent/agents/*.md` 与 `agent/agents.json`，项目 `.opencode/agent(s)/*.md`；项目覆盖用户、用户覆盖内置。
- 字段：description（必填）、mode（primary / subagent / all）、model、tools、permission、steps、prompt（正文）。
- Markdown 的 `permission` 使用 `action|resource|effect` 列表（逗号分隔），例如 `permission: edit|*|deny, shell|git *|ask`；JSON Agent 使用对象数组 `{ action, resource, effect }`。agent 权限在全局规则之后、会话规则之前生效，可收紧或放宽全局策略。
- 会话头部（输入框上方）可选择主 Agent；选择结果持久化到会话。

### 3.3 子代理工具

- `subagent` 工具创建隐藏子会话，在独立上下文中运行指定子 Agent，完成后把结果与子会话 id 返回主对话。
- 传 `sessionId` 可继续已有子会话；子会话的权限请求上抛到父会话审批；禁止子代理再嵌套（深度 1）。
- 隐藏子会话不出现在会话列表、不向 UI 推送事件；删除父会话级联清理。

## 4. 工具集

| 工具        | 作用                                                               | 权限 action        |
| ----------- | ------------------------------------------------------------------ | ------------------ |
| `read`      | 读取文本文件（行号、offset / limit、二进制拒绝、按需加载嵌套规则） | `read`             |
| `list`      | 列目录（深度限制）                                                 | `list`             |
| `grep`      | 正则 / 字面量搜索，include、大小写、结果上限                       | `grep`             |
| `glob`      | 按 glob 模式找文件，hidden、数量上限                               | `list`             |
| `write`     | 创建 / 覆盖文件（≤1 MB），写后格式化并附带诊断                     | `write`            |
| `edit`      | 精确字符串替换，唯一匹配或 replaceAll                              | `edit`             |
| `patch`     | 单次多文件新增 / 更新 / 删除，逐文件审批                           | `edit`             |
| `shell`     | 执行命令，超时、流式输出、后台运行与完成通知                       | `shell`            |
| `webfetch`  | 抓取网页，markdown / text / html，超时与 5 MB 截断                 | `webfetch`         |
| `websearch` | Tavily / Exa / Brave 搜索，结果格式化                              | `websearch`        |
| `skill`     | 按名称加载 Skill 全文                                              | `skill`            |
| `subagent`  | 委派子任务到子代理                                                 | 子代理内部工具权限 |
| `todowrite` | 替换会话任务列表                                                   | 不需要审批         |
| `todoread`  | 读取任务列表                                                       | 不需要审批         |
| `question`  | 向用户提出结构化问题                                               | 不需要审批         |
| MCP 工具    | 动态注册为 `mcp_<server>_<tool>`                                   | `mcp`              |

- 大输出统一截断（200k 字符），再经输出存储落盘（30k 展示上限，完整内容保存在 `agent/tool-outputs/`）。
- 工作区外路径先触发 `external_directory` 审批；只读工具默认允许。

## 5. 权限系统

### 5.1 权限模式

| 模式          | 读 / 列表 / 搜索 | 写 / 编辑 | shell | MCP  | Web / Skill |
| ------------- | ---------------- | --------- | ----- | ---- | ----------- |
| `plan`        | 允许             | 拒绝      | 拒绝  | 拒绝 | 允许        |
| `ask`（默认） | 允许             | 询问      | 询问  | 询问 | 允许        |
| `acceptEdits` | 允许             | 允许      | 询问  | 询问 | 允许        |
| `auto`        | 允许             | 允许      | 允许  | 允许 | 允许        |

### 5.2 规则

- 规则 = `action + resource + effect(allow/ask/deny) + sessionId`；全局规则与会话规则按顺序合并，**后匹配优先**。
- 求值顺序：模式基础规则 → 全局规则 → 当前 Agent 的规则 → 会话规则；子代理的 Agent 规则随权限请求上抛，由父会话统一裁决。
- 支持通配符（`*`）、shell 命令的 ` *` 后缀匹配、Windows 下大小写不敏感。
- “始终允许”持久化到 `agent/permissions.json`，重启后仍生效；设置页可查看与删除。
- 多资源操作（如 shell 命令中的多个路径）任一命中 `deny` 即拒绝。

## 6. 项目规则与自定义指令

- 发现顺序：全局 `AGENTS.md`（应用数据目录）→ 工作区 → 上层目录 → Git 项目根；同一目录 `AGENTS.md` 优先于 `CLAUDE.md`；无 Git 时向 home 方向查找。
- 读取或编辑更深层文件时，按需加载该目录的 `AGENTS.md`。
- 设置页可配置额外 instructions：相对路径、绝对路径、`~/`、glob 与远程 URL（5 秒超时）。

## 7. 上下文压缩

- 发送前按模型窗口估算 token（中英文分别估算），超过“窗口 − 15%（最少 16k）”时自动压缩。
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
- 遗留：OAuth 授权流程；prompts 作为命令、resources 提供给 Agent 读取。

## 10. LSP 诊断与自动格式化

- 内置语言服务器：TypeScript、Go、Python、Rust、C/C++；按工作区复用客户端，不可用时静默跳过。
- read / write / edit / patch 后附带诊断（最多 20 条，含行号、级别、来源与代码），便于 Agent 自我修正。
- 格式化器发现：prettier、biome、gofmt、rustfmt、ruff（配置文件、package.json 依赖、pyproject `[tool.ruff]`）；写入后自动执行，失败只提示、不影响工具结果。
- 设置页提供开关与检测状态（可用语言服务器 / 检测到的格式化器）。

## 11. Web 工具

- `webfetch`：仅 http(s)；默认 30 秒超时；HTML 转 Markdown（turndown）或纯文本 / 原始 HTML；非 HTML 原样返回；5 MB 截断；回显最终 URL、状态码与 Content-Type。
- `websearch`：Tavily / Exa / Brave；API Key 经 `safeStorage` 加密后由主进程下发给 worker；结果格式化为标题、URL、摘要；未配置时给出明确提示。
- 权限：独立 `webfetch` / `websearch` 动作，默认允许，可配置为询问或拒绝。

## 12. 附件与 @ 文件引用

- 添加方式：回形针选择、拖拽到输入框、粘贴剪贴板文件；附件 chip 显示名称与大小，可单独移除。
- 类型与限制：文本 ≤200 KB（二进制拒绝）、图片 ≤5 MB（超过 1568px 自动等比缩放并转 PNG）、PDF ≤10 MB。
- 文本文件在发送时以 `File: name` + 代码块注入；图片 / PDF 作为多模态输入；只有附件没有文字也可以发送。
- 附件保存在 `agent/attachments/<session>/`，消息持久化引用；删除会话时清理。
- `@` 触发工作区文件搜索（忽略依赖与构建目录、按匹配度排序），点击或回车插入 `@相对路径`。

## 13. 自定义命令与 Skills

### 命令

- 发现位置：用户 `agent/commands/*.md`、`agent/commands.json`；项目 `.opencode/command(s)`、`.claude/commands`。
- 支持 name / description frontmatter；模板支持 `$ARGUMENTS`、`$1`–`$9`，无占位符时在末尾追加参数。
- 输入框输入 `/` 弹出命令菜单（按名称 / 描述过滤），插入 `/命令 `；发送时识别 `/命令 参数` 并展开为最终提示词。

### Skills

- 发现位置：用户 `agent/skills`、项目 `.opencode/skill(s)`、`.claude/skills` 下的 `<name>/SKILL.md`；同名后者覆盖前者。
- 启动时加载，并把技能名称与描述注入 system prompt；`skill` 工具按名称加载全文，纳入 `skill` 权限动作。
- 新增或修改 Skill 文件后需重启应用生效。

## 14. Todo 与 Question

### Todo

- `todowrite` 替换会话任务列表（内容、状态 pending/in_progress/completed/cancelled、优先级），`todoread` 读取。
- 输入框上方任务面板展示进度与状态，随会话持久化；plan 模式同样可用；工具本身不需要审批（与 OpenCode 一致）。

### Question

- `question` 工具支持单选、多选与自由输入，输入框上方展示问答卡片；答案回传给工具结果。
- 10 分钟未回答自动超时；停止运行会取消待回答问题；子代理发起的提问暂不上抛。

## 15. 设置页

| 分区     | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 外观     | 内置主题（跟随系统 / 浅色 / 深色 / 日落橙 / 暖墨 / 石墨 / 奶油 / 冷雾） |
| 语言     | 跟随系统 / 中文 / English                                               |
| 权限     | 查看与删除已保存的权限规则                                              |
| MCP      | 服务器增删改、启停、状态刷新                                            |
| 网页搜索 | 服务商选择、加密 API Key、配置状态                                      |
| Agent    | 快照 / LSP / 自动格式化开关、检测状态、自定义指令文件                   |

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
├── config.json          # 快照 / LSP / 格式化开关与额外指令
├── mcp.json             # MCP 服务器配置
├── websearch.json       # 搜索服务商与加密 Key
├── model-catalog.json   # models.dev 目录缓存
├── commands.json        # JSON 自定义命令
├── commands/            # Markdown 自定义命令
├── agents/              # 用户级 Markdown Agent
├── agents.json          # JSON 自定义 Agent
└── skills/              # 用户级 Skills
models/                  # 供应商 / 模型配置与加密密钥
```

## 17. 已知限制与后续方向

- MCP：OAuth 授权；prompts 作为命令、resources 供 Agent 读取；更多传输细节（重连退避、分页）。
- 子代理：后台运行与完成通知、按 Agent 的采样参数；子代理的 Question 上抛。
- 模型：模型 variants（不同推理配置）、OAuth 供应商认证、一键导入供应商及全部模型。
- 附件：缩略图预览、PDF 文本抽取；私有地址访问策略与 webfetch 缓存。
- 命令 / Skills：命令绑定 Agent / 模型、命令中的 shell 片段、Skill 附带资源。
- 权限：Web / Skill 之外的 URL、MCP 等更细的资源匹配已支持，按 agent 的覆盖仍待补。
- P2 方向：Code Mode、worktree、浏览器自动化、Headless CLI、Server API / SDK、ACP 集成等尚未开始。

## 18. 关键文件索引

- 运行时：[agent-runtime.ts](../apps/desktop/src/main/agent/runtime/agent-runtime.ts)、[types.ts](../apps/desktop/src/main/agent/runtime/types.ts)、[defaults.ts](../apps/desktop/src/main/agent/runtime/defaults.ts)、[subagents.ts](../apps/desktop/src/main/agent/runtime/subagents.ts)
- 会话：[sessions-store.ts](../apps/desktop/src/main/agent/sessions/sessions-store.ts)、[context.ts](../apps/desktop/src/main/agent/sessions/context.ts)、[snapshots.ts](../apps/desktop/src/main/agent/sessions/snapshots.ts)
- 配置：[instructions.ts](../apps/desktop/src/main/agent/config/instructions.ts)、[permissions.ts](../apps/desktop/src/main/agent/config/permissions.ts)、[agents.ts](../apps/desktop/src/main/agent/config/agents.ts)
- 集成：[mcp.ts](../apps/desktop/src/main/agent/integrations/mcp.ts)、[lsp.ts](../apps/desktop/src/main/agent/integrations/lsp.ts)、[formatters.ts](../apps/desktop/src/main/agent/integrations/formatters.ts)、[webfetch.ts](../apps/desktop/src/main/agent/integrations/webfetch.ts)、[websearch.ts](../apps/desktop/src/main/agent/integrations/websearch.ts)
- 工具与能力：[tools.ts](../apps/desktop/src/main/agent/tools.ts)、[attachments.ts](../apps/desktop/src/main/agent/attachments.ts)、[commands.ts](../apps/desktop/src/main/agent/commands.ts)、[skills.ts](../apps/desktop/src/main/agent/skills.ts)、[todos.ts](../apps/desktop/src/main/agent/todos.ts)、[cost.ts](../apps/desktop/src/main/agent/cost.ts)
- 主进程存储：[stores/models.ts](../apps/desktop/src/main/stores/models.ts)、[stores/websearch.ts](../apps/desktop/src/main/stores/websearch.ts)、[models/catalog.ts](../apps/desktop/src/main/models/catalog.ts)
