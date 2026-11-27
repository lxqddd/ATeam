# 架构说明

本文描述 ATeam 的分层、进程边界、运行时组成与扩展方式。功能面说明见 [features.md](./features.md)，与 opencode 的逐项对齐计划见 [opencode-agent-alignment-todo.md](./opencode-agent-alignment-todo.md)。

## 1. 分层与依赖方向

```
apps/desktop ─┐
apps/headless ─┼──> packages/agent-core ──> packages/shared
apps/desktop ─┴──> packages/shared          (零第三方依赖)

packages/client-sdk ──> HTTP API (apps/headless server)
```

| 包                    | 职责                                                              | 允许依赖                                  |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| `packages/shared`     | 公共类型、通道常量、消息 part 纯 helper（`message-parts.ts`）     | 无                                        |
| `packages/agent-core` | 与 Electron 无关的 Agent 运行时：会话、工具、模型、MCP、快照、VCS | `@ateam/shared`、AI SDK、Node 内置模块    |
| `apps/desktop`        | Electron 壳：主进程、preload、渲染进程                            | `agent-core`（仅主进程/worker）、`shared` |
| `apps/headless`       | CLI、HTTP server、ACP 三个无界面入口                              | `agent-core`、`shared`                    |
| `packages/client-sdk` | HTTP API 的客户端 SDK                                             | `shared`（类型）                          |

硬性规则：

- 依赖只能自上而下，`shared` 不依赖任何工作区包。
- `agent-core` 不导入 `electron`，也不感知 BrowserWindow / IPC。
- 渲染进程（`apps/desktop/src/renderer`）与 preload **不得**导入 `agent-core`；它们只通过 `window.ateam`（`packages/shared/src/preload-api.ts` 中的 `AteamApi`）访问能力。
- 新增跨进程数据一律先加到 `shared`，再由两端引用。

## 2. 进程与安全边界

```
┌────────────────────────── Electron main ──────────────────────────┐
│ BrowserWindow (renderer)  ⇄  preload (contextBridge)              │
│        ▲ ipcRenderer.invoke / 事件订阅                             │
│        │ trusted-sender 校验 + zod schema                          │
│   ipc/agent/* 注册器 ──> AgentManager ──utilityProcess.fork──┐     │
└───────────────────────────────────────────────────────────────┼────┘
                                                                ▼
                                          agent-host/worker.ts（AgentRuntime）
```

| 边界              | 机制                                                                                                             | 位置                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 渲染进程 → 主进程 | `ipcMain.handle` + `isTrustedSender` 门禁 + zod schema 解析                                                      | `apps/desktop/src/main/ipc/`                                                 |
| 渲染进程 API      | `contextBridge.exposeInMainWorld('ateam', …)`，窄接口 `AteamApi`                                                 | `apps/desktop/src/preload/index.ts`、`packages/shared/src/preload-api.ts`    |
| 主进程 → Agent    | `WorkerRequest` / `WorkerMessage` 判别联合，`utilityProcess` 承载                                                | `packages/shared/src/agent-protocol.ts`、`apps/desktop/src/main/agent-host/` |
| 浏览器自动化      | worker 发起 `browser` 消息，主进程回 `browser.result`                                                            | `agent-manager.ts`、`worker.ts`                                              |
| 密钥              | `safeStorage` 加密后落盘，仅主进程解密后随 `init` 注入 worker；GitHub PAT 存在独立的 0600 JSON 中且不注入 worker | `apps/desktop/src/main/credentials/`、`providers/`、`github/`                |

安全约定：

- 通道名集中在 `packages/shared/src/channels.ts`（`AGENT_CHANNELS`、`MODEL_CHANNELS`、`UPDATE_CHANNELS`、`AGENT_EVENT_CHANNEL`）。新增通道必须同时更新 `ipc/agent/register.test.ts` 的完整性断言。
- 所有 handler 输入经 zod 解析；`sessionUndoSchema` 与 `sessionForkSchema` 分开，避免未声明字段被静默丢弃。
- 主进程不把明文凭据写入项目配置；诊断日志不得回显密钥。

## 3. AgentRuntime 的组成

`packages/agent-core/src/runtime/agent-runtime.ts` 是编排层：持有运行中的 `Run`、队列、事件与各领域服务，负责 `sendChat` → `runAgent` → 结束状态的主循环。领域逻辑在 `runtime/` 下的服务中：

| 服务                     | 文件                    | 职责                                                                    |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------- |
| `SessionService`         | `session-service.ts`    | 会话 CRUD、fork、搜索、模型/设置校验                                    |
| `PermissionService`      | `permission-service.ts` | 权限询问与提问（question）队列                                          |
| `CompactionService`      | `compaction-service.ts` | 上下文压缩与溢出重试准备                                                |
| `WorkspaceServices`      | `workspace-services.ts` | 工作区配置、MCP、插件、LSP、格式化、web 抓取                            |
| `HistoryService`         | `history-service.ts`    | 整轮 undo/redo、步骤回退、改动审查、文件级 revert/unrevert、VCS 查询    |
| `PlanService`            | `plan-service.ts`       | plan 文件路径/内容、退出 plan 模式                                      |
| `StepTracker`            | `step-tracker.ts`       | 写入 `step-start / step-finish / patch / snapshot` part，维护步骤回退点 |
| `CommandService`         | `command-service.ts`    | 斜杠命令、技能命令、MCP prompt 与模板展开                               |
| `BackgroundTaskRegistry` | `background-tasks.ts`   | 后台 shell / 子代理任务注册表                                           |
| `RunPreparation`         | `run-preparation.ts`    | 组装 system prompt、历史、工具与参数                                    |
| `TurnChanges`            | `turn-changes.ts`       | 由消息 part 推导单轮/会话改动                                           |
| `Subagents`              | `subagents.ts`          | 子代理任务执行与结果投影                                                |

服务统一采用「host 接口 + 构造函数注入」模式：服务不直接访问 `AgentRuntime` 的私有字段，需要的能力由 host 回调提供（见 `SessionHost`、`HistoryHost`、`PlanHost`、`StepTrackerHost`、`CommandHost`）。

运行时数据流（一次提问）：

1. `sendChat` 校验并保留会话 → 创建快照与 assistant 消息 → `beginRun`。
2. `runAgent` 装配模型/历史/工具，消费 AI SDK 流；`StepTracker` 在 `start-step` / `finish-step` 写入步骤 part。
3. 工具调用经 `tool-context.ts` 的 `ToolContextHost` 路由到权限、后台任务、工作区服务等。
4. 成功/失败/中断都经 `recordAfterSnapshot` 收尾，随后 `run.finished` 事件、队列排空与后台唤醒。

## 4. 跨进程协议

`WorkerRequest` 是主进程 → worker 的唯一请求形态（判别联合，方法名即通道语义，如 `sessions.undo`、`chat.send`）。新增方法时类型链自动生效：

- `AgentManager.request<M extends WorkerMethod>(method, params)` 的 `params` 由 `WorkerRequest` 推导。
- `worker.ts` 的 `switch` 使用 `const unhandled: never = request` 做穷尽检查，漏接 handler 会直接 typecheck 失败。
- `worker.ts` 不负责 IPC 语义，只做方法分发与浏览器请求桥接。

## 5. 目录约定

- 测试与源码同目录（`*.test.ts`），不放独立的 `tests/` 目录；纯类型包（`shared`）只在确有逻辑时加测试。
- `packages/agent-core` 的子路径导出在 `package.json` 的 `exports` 中显式声明；barrel 文件位于目录内（如 `src/tools/index.ts`），不再保留与目录同名的顶层 `xxx.ts`。
- 桌面端 IPC 按域拆分在 `apps/desktop/src/main/ipc/agent/`（chat、sessions、mcp、plugins、permissions、vcs、workspace、config、websearch、github、attachments、info），由 `register.ts` 串联。GitHub 请求全部在主进程完成（`main/github/`），渲染进程只拿已构建好的上下文与 prompt。
- 渲染进程的状态集中在 `renderer/src/chat/store.ts` 与 `components/`，事件合并以 `partIndex` 为准；元数据 part 不渲染但保持索引对齐。

## 6. 扩展清单

**新增一个 worker 方法**

1. `packages/shared/src/agent-protocol.ts` 增加 `WorkerRequest` 分支（含 `params` 类型）。
2. `apps/desktop/src/main/agent-host/worker.ts` 增加 case（穷尽检查会强制）。
3. 如需 UI 调用：`channels.ts` 加通道 → `main/ipc/agent/<domain>.ts` 注册 handler 与 zod schema → `shared/preload-api.ts` → `preload/index.ts` → `renderer` 调用。
4. 补 `ipc/agent/register.test.ts` 的通道完整性断言（若新增通道）。

**新增一个运行时服务**

1. 在 `packages/agent-core/src/runtime/` 新建文件，定义 `XxxHost` 接口与 `XxxService` 类。
2. `AgentRuntime` 增加字段并在构造函数注入 host 回调；公共方法只做薄委托。
3. 行为通过 `agent-runtime.test.ts` 的公共 API 覆盖；服务内部纯逻辑可单独加测试。

**新增一个工具**

1. `packages/agent-core/src/tools/` 下实现，或在 `runtime/tool-context.ts` 的 `ToolContextHost` 增加能力。
2. 需要权限的动作走 `askPermission`；长输出走 `storeOutput`；后台执行走 `registerBackgroundShell`。
3. 在 `runtime/defaults.ts` / `registry.ts` 注册，并补测试。

**新增一个 headless 入口**

复用 `apps/headless/src/` 中的 runtime 装配 helper（`dataDir`、`workspace`、`models`、`send`），不要在入口里直接散写 `new AgentRuntime`。

## 7. 验证

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test            # shared/client-sdk/agent-core/headless/desktop
pnpm build
```

当前测试规模：agent-core 65 个测试文件（1171 用例）、desktop 71 个（674 用例）、headless 12 个（131 用例）、client-sdk 1 个（6 用例）。跨进程协议、IPC 注册、消息 part 迁移与运行时主循环均有覆盖。覆盖率阈值、打包体积预算、可访问性与截图回归的检查方式见 [quality.md](./quality.md)。

## 8. 渲染进程打包

- 首屏只保留聊天页（`ChatPage`）。`#/models`、`#/usage`、`#/settings` 使用 `React.lazy` + `Suspense` 按路由加载；加载期间在内容区显示 `app.loading` 占位，应用外壳与侧边导航保持可见。
- 聊天页内部的按需面板同样懒加载：`ChangesPanel`（diff 视图）与 `ExportDialog`（导出）只在用户打开时拉取。
- `apps/desktop/scripts/bundle-report.mjs` 从 `out/renderer/index.html` 读取入口脚本与 `modulepreload`，统计首屏 JS 的 raw/gzip 体积。`pnpm --filter @ateam/desktop bundle:report` 查看报告，`bundle:check` 在首屏 JS 超出基线 2%、按需 JS 总量或关键路由 chunk（ModelsPage / SettingsPage / UsagePage）超出基线 5% 时以非零状态退出；CI 在构建后执行同一检查。
- 体积基线存放在 `apps/desktop/scripts/bundle-baseline.json`，用 `bundle:report -- --write-baseline` 更新；文件内的 `history` 保留最近几次快照。完整质量基线（覆盖率、打包、a11y、截图）见 [quality.md](./quality.md)。
- 记录（2026-11-27，issue #20）：拆分前首屏 JS 3848620 B raw / 808633 B gzip；拆分后 2439550 B raw / 525099 B gzip（-36.6% / -35.1%）。各按需 chunk 合计约 297 kB gzip，只在访问对应页面或打开面板时加载。

新增页面时默认走路由级懒加载；只有确认属于首屏交互路径的组件才保留静态导入。

## 9. 已知边界

- `AgentRuntime` 仍保留主循环（`sendChat` / `beginRun` / `runAgent` / `consumeTurnStream`）与后台唤醒逻辑；这些与 `Run` 生命周期强耦合，暂不拆分为独立服务。
- 渲染进程只消费事件与快照，不做业务推导；改动计数、步骤回退点等均来自 `packages/shared/src/message-parts.ts` 的纯函数。
- 桌面端的 `AgentManager` 是唯一持有 worker 生命周期的对象；渲染进程无法直接重启或注入 worker 参数。
