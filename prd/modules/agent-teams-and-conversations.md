# 模块：Agent Team 与会话（M2.3，新增）

> 状态：M2.3 新增需求（2026-11-18 产品决策）
> 权威边界：本模块定义 Agent 小组、团队会话、消息路由与「一键转任务」。实体字段与 API 细节引用 `api-and-data.md`，交付物与评审仍以 `collaboration-and-review.md` 为准。
> 命名区分：本模块的 **Agent Team（Agent 小组）** 是「多个 Agent 的讨论小组」；`security-and-permissions.md` 与 M3 中的 **Team Workspace（团队工作区）** 是「多个人类成员的团队」，两者不是同一实体，数据库与 API 不共用表。

## 1. 定位：讨论层，不是新的执行入口

ATeam 的交付链路保持不变：**Task → Run → 证据 → 评审 → 合并**。Agent Team 会话是这条链路之前的**讨论层**：

- 用户在小组会话里提出需求、澄清范围、比较方案；
- 消息默认自动路由给小组内**最合适的角色 Agent**，也可以 `@Agent` 定向提问；
- Agent 的回复**只是讨论内容**，不直接改代码、不创建 Run、不产生 Artifact；
- 讨论收敛后，用户可把任意消息**一键转为 Task**，再进入现有执行与评审链路。

与 `00-product-overview.md` §8.6「显式协作而非自由聊天」的关系：该原则约束的是**执行层**——Agent 之间不得通过自由聊天交接交付物；本模块允许**人类发起**的群组讨论，但明确规定「Agent 与 Agent 不得互相自动对话」（见 §2.4），路由只发生在用户消息上。

## 2. 实体与规则

### 2.1 AgentTeam（Agent 小组）

| 字段 | 说明 |
|---|---|
| `id` / `workspaceId` | 小组归属于一个 Workspace |
| `name` / `description` | 小组名称与用途说明（进入路由器上下文） |
| `status` | `active` / `archived` |
| `memberCount` | 派生字段 |
| `createdAt` / `updatedAt` / `revision` | 标准字段 |

规则：

- 一个 Agent 可以加入多个小组；同一小组内同一 Agent 只能出现一次。
- 小组成员只能来自同一 Workspace 的 Agent，且 Agent 必须处于可用状态（非归档）。
- 删除采用归档语义（`archived`），归档后只读，会话不可再发消息。
- 小组成员变更不影响历史会话与消息。

### 2.2 AgentTeamMember

| 字段 | 说明 |
|---|---|
| `teamId` / `agentId` | 成员关系 |
| `roleOverride` | 可选；用于小组内角色表述（如「前端负责人」），为空时展示 Agent 的 `role` |
| `joinedAt` / `position` | 加入时间与展示顺序 |

### 2.3 Conversation 与 ConversationMessage

**Conversation（会话）**：

| 字段 | 说明 |
|---|---|
| `id` / `workspaceId` / `teamId` | 归属小组 |
| `title` | 默认取首条用户消息前 60 字符，可重命名 |
| `status` | `active` / `archived` |
| `createdBy` | M2.3 固定 `local` |
| `lastMessageAt` / `messageCount` | 派生/维护字段 |
| `createdAt` / `revision` | 标准字段 |

**ConversationMessage（消息）**：

| 字段 | 说明 |
|---|---|
| `id` / `conversationId` / `seq` | 会话内唯一递增序号 |
| `senderType` | `user` / `agent` / `system` |
| `senderAgentId` | `agent` 消息必填 |
| `content` | Markdown 文本；用户内容不翻译、不重写 |
| `mentions` | 用户消息中的 `@` 目标 Agent ID 数组 |
| `routing` | 见 2.4；`agent` 消息携带导致其产生的那次路由决策 |
| `replyToMessageId` | 可选；回复某条用户消息 |
| `status` | `agent` 消息：`pending` / `streaming` / `completed` / `failed` / `cancelled`；`user` 与 `system` 恒为 `completed` |
| `usage` | Agent 回复的 token/费用摘要（仅记录 CLI 实际提供的数据） |
| `taskId` | 由该消息「转为任务」后回填；一条消息最多转一个 Task |
| `createdAt` / `truncated` | 标准字段 |

规则：

- 消息创建后**不可修改**；删除采用会话归档，不提供单条消息编辑。
- `seq` 在会话内唯一且单调递增；`(conversation_id, seq)` 唯一约束。
- `system` 消息用于：路由失败提示、成员变更、任务转换回执与链接；系统消息不参与路由。
- 单条消息正文上限 32 KiB，超出截断并标记 `truncated=true`。

### 2.4 路由（Routing）

路由只处理**用户消息**，为每条用户消息选择**至多一个**回复的 Agent（M2.3 单目标；多目标并行回复列为开放问题）。

| 字段 | 说明 |
|---|---|
| `mode` | `auto` / `mention` |
| `source` | `router_llm` / `router_rules` / `mention` |
| `candidates` | 参与选择的成员快照（agentId、name、role） |
| `selectedAgentId` | 选中的 Agent |
| `rationale` | 人类可读的选人依据（进入 UI 路由标签） |
| `createdAt` | 决策时间 |

规则：

1. **@ 覆盖**：用户消息包含 `@` 时跳过自动路由，`mentions` 中的 Agent 直接成为目标；若 `mentions` 含非成员或未知 Agent，返回 `409 AGENT_NOT_IN_TEAM`，消息不落库。
2. **自动路由**：路由器输入为用户消息、小组名称/描述与成员名册（agentId、name、role、description、instructions 摘要），输出唯一 `selectedAgentId` 与 `rationale`。
3. **路由器不得执行代码**、不得写仓库、不得创建 Task/Run；只做选择。
4. **无匹配**：成员均不适配时返回 `409 ROUTING_NO_MATCH`，UI 提示用户 `@` 指定或调整小组成员。
5. **歧义**：多个候选并列且无法区分时返回 `409 ROUTING_AMBIGUOUS`，`details.candidates` 供 UI 展示选择；用户 `@` 后重发即视为新消息。
6. **Agent 之间不得互相触发**：`agent` 消息不参与路由、不被其他 Agent 自动回复；用户在会话中回复某条 Agent 消息时，路由仍按用户消息处理（可用 `@` 锁定）。
7. 路由决策随消息持久化，UI 必须在 Agent 回复旁展示「路由至 X · 依据」标签，保证可解释。

### 2.5 会话执行边界（关键约束）

Agent 在会话中的回复是**只读讨论**：

- 运行模式固定 `permission_mode=read_only`；禁止写工具（Write/Edit/NotebookEdit/Bash）；
- 工作目录为独立临时草稿目录，不是任何仓库或 worktree；
- **不创建 Run、不产生 Artifact、不修改 Task 状态**；用量写入消息的 `usage`；
- 会话中的 Agent 调用同样受 `security-and-permissions.md` §6.4 的环境变量与凭据隔离、`runtime-and-workspace.md` 的 Runtime 探测与进程组取消约束；
- 会话上下文：小组名称/描述 + 路由到的 Agent instructions + 最近 N 条消息（默认 20 条、预算截断），不注入其他小组或工作区内容。

### 2.6 一键转任务

- 任意用户消息或 Agent 回复可执行「转为任务」；
- 创建 `status=backlog` 的 Task，`workspaceId` 与会话一致；标题默认取消息首行（≤120 字符），描述包含消息全文、会话链接与路由上下文；
- Task 增加 `origin_conversation_id` 与 `origin_message_id` 追溯字段；同一消息重复转换返回已创建的 Task（幂等）；
- 转任务不自动启动 Run；用户仍走原有 Task → Run → 证据 → 评审 → 合并链路；
- 转换后在会话中追加一条 `system` 消息，包含任务链接。

### 2.7 会话生命周期

`active → archived`（单向；归档后只读，消息不可追加）。会话不提供硬删除；保留期与消息上限见 `non-functional-requirements.md`。

## 3. API（唯一契约见 `api-and-data.md` §5.15）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/v1/agent-teams` | 列表 / 创建小组（同一 Workspace） |
| GET/PATCH | `/api/v1/agent-teams/{id}` | 详情 / 重命名与描述 |
| POST | `/api/v1/agent-teams/{id}/archive` | 归档 |
| GET/POST | `/api/v1/agent-teams/{id}/members` | 成员列表 / 添加成员 |
| DELETE | `/api/v1/agent-teams/{id}/members/{agentId}` | 移除成员 |
| GET/POST | `/api/v1/agent-teams/{id}/conversations` | 小组会话列表 / 创建会话 |
| GET/PATCH | `/api/v1/conversations/{id}` | 会话详情 / 重命名或归档 |
| GET | `/api/v1/conversations/{id}/messages` | 消息列表（`afterSeq` 增量） |
| POST | `/api/v1/conversations/{id}/messages` | 发送用户消息；服务端路由并以流式事件返回 Agent 回复 |
| POST | `/api/v1/conversations/{id}/messages/{messageId}/cancel` | 取消进行中的 Agent 回复 |
| POST | `/api/v1/messages/{id}/convert-to-task` | 一键转任务（幂等） |

## 4. 事件

| 事件 | 载荷 |
|---|---|
| `agent_team.created` / `updated` / `archived` | 小组快照或 `{id}` |
| `conversation.created` / `updated` / `archived` | 会话快照或 `{id}` |
| `conversation.message.created` | 完整消息 |
| `conversation.routing.decided` | 路由决策（`messageId`、`selectedAgentId`、`rationale`） |
| `conversation.reply.started` / `delta` / `completed` / `failed` / `cancelled` | `{conversationId, messageId, agentId, delta?}` |
| `conversation.task_created` | `{conversationId, messageId, taskId}` |

## 5. UI（M2.3，参考 nomi 最新会话页）

参考 [nomi-ai](https://github.com/Cookieboty/nomi-ai) 最新代码的会话页（commit `a65cf86`；截图 `docs/screenshots/coding-agent.webp`；组件 `packages/ai-chat/src/components/Conversation/*`、`MessageInput/*`、`Fleet/*`）：

- **布局**：左侧为小组与会话列表（沿用现有 260px 上下文面板），主区为居中最大宽度的消息流（nomi 的 `--cd-chat-content-w` 居中列），底部为输入栏；
- **消息流**：用户消息右侧气泡（nomi：最大 640px / 82%，非对称圆角）；Agent 回复左侧、带头像与角色标签、支持流式输出与 Markdown；系统/路由消息以低强调行内提示展示；
- **路由可视化**：每个 Agent 回复上方显示「路由至 Frontend Agent · 依据…」小标签，可展开候选成员；
- **@ 提及**：输入框输入 `@` 弹出小组内成员选择器（参考 nomi 的 `AtPathPalette` 交互），支持多选；已选 `@` 以 chip 形式显示在输入框内；
- **输入栏**：多行输入、附件入口占位、发送快捷键；回复进行中显示停止按钮（nomi 子代理卡片同款「停止」模式）；
- **成员侧栏**：小组成员及工作状态（复用 M2.4 的 `workStatus`：空闲 / 工作中 / 已完成 / 失败待处理；对话回复进行中额外显示临时「回复中」标记，不改变 `workStatus`；参考 nomi `Fleet` 看板的状态与「要你处理」角标）；
- **一键转任务**：用户消息与 Agent 回复悬浮操作「转为任务」，转换后显示任务链接；
- **状态**：空会话欢迎区（引导「提需求或 @ 一位成员」）、路由歧义选择器、Agent 失败重试、流式断线提示、归档只读态。

## 6. 功能需求

| ID | 需求 | 优先级 | 验收 |
|---|---|---|---|
| AGTEAM-001 | 创建/重命名/归档 Agent Team；成员增删；成员必须同 Workspace 且非归档 | P0 | CRUD 测试；跨 Workspace 成员返回 409 |
| AGTEAM-002 | 一个 Agent 可属于多个小组；组内唯一 | P1 | 重复添加返回 409 |
| CONV-001 | 创建会话、列表、重命名、归档；归档后拒绝新消息 | P0 | 会话生命周期测试 |
| CONV-002 | 消息不可变、`(conversation_id, seq)` 唯一；增量拉取 `afterSeq` | P0 | 并发发送 100 条无重号 |
| CONV-003 | 每条用户消息产生一个路由决策并持久化 | P0 | 决策可查询、UI 可见 |
| CONV-004 | Agent 回复只读：无写工具、无 Run/Artifact、无仓库写入 | P0 | 负向用例：尝试写文件被拒绝且无仓库变化 |
| CONV-005 | Agent 回复流式推送与取消；取消后 5 秒内停止产生 delta | P0 | 停止按钮实测 |
| CONV-006 | 一键转任务，幂等，回填来源字段并在会话中回执 | P0 | 重复转换返回同一 Task |
| ROUTE-001 | 自动路由选中唯一成员并记录 rationale；无匹配/歧义返回稳定错误码与候选 | P0 | 路由夹具（单候选/多候选/歧义/无匹配） |
| ROUTE-002 | `@` 覆盖自动路由；非成员 `@` 拒绝 | P0 | 定向用例 |
| ROUTE-003 | Agent 消息不触发其他 Agent（无自动对话） | P0 | 300 秒观察无自动连锁回复 |
| ROUTE-004 | 路由器不执行代码、不写仓库 | P0 | 代码审查 + 负向测试 |

## 7. 非功能

- 首 token 延迟 p95 ≤ 4 秒（本地 Claude CLI，不含模型排队）；流式 delta 到 UI p95 ≤ 1 秒；
- 单会话消息上限 5,000 条或 20 MB，超出后拒绝新消息并提示新建会话；
- 单次 Agent 回复上下文预算默认 20 条消息、16 KiB，超出截断；
- 会话消息保留 90 天（本地配置），归档会话只读不自动删除；
- 会话内容与消息参与脱敏扫描（与 Artifact 相同规则）；不写入插件遥测。

## 8. 开放问题

1. 路由实现：LLM 路由器 vs 规则引擎 vs 混合（建议 M2.3 首版：规则优先 + LLM 兜底，可配置）。
2. 多 Agent 并行回复（一条消息路由给多个 Agent）是否在 M2.3 提供（当前单目标）。
3. 会话结果是否自动回帖（Task 完成/合并后系统消息），或仅手动分享链接。
4. Agent 在会话中是否允许提交「建议补丁」作为消息附件（只读文本，不落地），需要与 Artifact 模型对齐。

## 9. 里程碑

M2.3（在 M2.1 角色 Agent 之后、M3 团队模式之前交付，本地优先）。依赖：M2.1 的角色字段、Workspace 归属、Runtime 适配器；不依赖登录、Postgres 或远程 Runner。详细范围与退出标准见 `prd/milestones/M2.3-agent-teams.md`。
