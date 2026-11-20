# ATeam Vitest 接入与单元测试范围

> 状态：实施方案文档，仓库中尚未接入 Vitest。  
> 适用对象：接手 Vitest 接入与测试用例实现的工程师。  
> 当前基线：`feat/conversation-agent` 分支，提交 `516519d`。建议从该提交创建独立分支，例如 `test/vitest-unit-tests`，不要直接提交到 `master`。

## 1. 目标

为 ATeam 接入 Vitest，先覆盖**不依赖真实 Electron 窗口、真实模型网络请求和真实用户界面布局**的核心逻辑，形成可在本地和 CI 中快速、稳定运行的单元测试。

本阶段不追求覆盖率数字，而是先保证以下高风险区域有回归保护：

- Agent 历史消息重建、错误归一化和工具结果映射
- 工作区路径沙箱、文件工具和权限判断
- 会话持久化、启动修复和原子写入
- 模型配置、API Key 加密边界和默认模型回退
- 渲染进程 chat store 的事件合并与快照竞态
- 后续可选的 Agent 运行循环、权限状态机和 React 组件交互

## 2. 现状与兼容性

- Monorepo：pnpm workspaces，应用在 `apps/desktop`，共享类型在 `packages/shared`
- 构建：Electron 44 + electron-vite 6 + Vite 8.3.8
- 前端：React 19 + TypeScript 5.9 + Tailwind CSS 4
- Agent：AI SDK 7 + Electron `utilityProcess`
- 当前没有任何测试框架，也没有 `test` 脚本
- 当前 Node 版本为 24.18；根 `package.json` 的 `engines.node` 为 `>=22.12.0`

推荐版本：

| 包                            | 版本      | 说明                                                                    |
| ----------------------------- | --------- | ----------------------------------------------------------------------- |
| `vitest`                      | `5.1.1`   | peer 支持 Vite `^6.4 \|\| ^7 \|\| ^8`，Node `^22.12 \|\| ^24 \|\| >=26` |
| `@vitest/coverage-v8`         | `5.1.1`   | 必须与 Vitest 版本一致                                                  |
| `jsdom`                       | `28.0.0`  | 支持 Node `^20.19 \|\| ^22.12 \|\| >=24`，不抬高项目 Node 下限          |
| `@testing-library/react`      | `16.3.3`  | 支持 React 18/19                                                        |
| `@testing-library/dom`        | `10.4.2`  | RTL 16 的 peer                                                          |
| `@testing-library/jest-dom`   | `8.0.0`   | peer 要求 Vitest `>=5 <6`                                               |
| `@testing-library/user-event` | `14.6.13` | 表单和键盘交互                                                          |

注意：不要直接用 `jsdom@31`，它要求 Node 22.22.2 / 24.15 以上，会与当前声明的 Node 下限冲突。Vitest 5 已移除 `vitest.workspace.ts`，使用 `test.projects`。

## 3. 测试范围

### 3.1 必须覆盖（P0）

| 模块                            | 测试重点                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/agent/errors.ts`          | 401/403、404、429、网络、上下文超长、5xx、abort 的归一化；密钥和 Authorization 脱敏；长消息截断                                                                |
| `main/agent/message-history.ts` | 用户消息合并；assistant 文本；已结算工具调用与 tool result；failed/denied 工具；跳过 error/streaming；包含 interrupted；跳过 reasoning                         |
| `main/agent/atomic-json.ts`     | 写入/读取往返；无效 JSON 返回 `null`；覆盖写入；POSIX 下文件权限 0600                                                                                          |
| `main/agent/sessions-store.ts`  | 会话创建、排序、重命名、删除；首条用户消息生成标题；持久化后重新加载；启动修复 streaming/未结算工具；索引损坏回退扫描                                          |
| `main/models/store.ts`          | Provider/模型 CRUD；默认模型自动选择与回退；API Key 只存密文；safeStorage 不可用时拒绝保存；删除 Provider/模型后的关联清理；输入校验                           |
| `main/agent/tools.ts`           | 路径沙箱（`..`、symlink）；read 行号/offset/limit/二进制；list 深度和忽略目录；grep include/maxResults；write/edit 权限与内容；shell 权限、cwd 沙箱、超时/取消 |
| `renderer/chat/store.ts`        | 会话加载与排序；消息 upsert；文本/推理 delta；工具 part 更新；权限 asked/replied；run.finished；快照加载期间的事件缓冲；会话删除后的选择回退                   |
| `renderer/hooks/useElapsed.ts`  | fake timers 下的秒数计算；inactive 返回 0；卸载清理                                                                                                            |

### 3.2 建议覆盖（P1）

| 模块                                             | 测试重点                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `renderer/components/chat/PermissionCard.tsx`    | 三种决策的调用参数；busy/disabled；失败信息                                                                  |
| `renderer/components/chat/Composer.tsx`          | 空输入禁用；Enter 发送；Shift+Enter 换行；IME composing 不发送；运行中显示停止；无模型提示                   |
| `renderer/components/chat/SessionPanel.tsx`      | 新建会话；选中；内联重命名；两步删除；错误提示                                                               |
| `renderer/components/settings/ModelSettings.tsx` | 添加/编辑/删除 Provider；添加模型；默认模型；连接测试成功/失败；加密不可用提示                               |
| `renderer/components/chat/MessageList.tsx`       | 用户/assistant/tool/permission 渲染；重试按钮出现条件；不测试真实滚动布局                                    |
| `main/agent/runtime.ts`                          | 需要先做小幅依赖注入（见 7.3）：文本流、工具调用、权限 once/always/reject、停止、错误、重试、max steps、busy |

### 3.3 不作为本阶段单元测试范围

以下内容依赖 Electron 运行时、真实窗口或真实网络，建议用 mock 验证边界，或在后续 Playwright Electron E2E 中覆盖：

- `main/index.ts`：窗口创建、单实例锁、标题栏、导航守卫
- `main/ipc/*` 的 `ipcMain` 注册和 trusted sender（可做轻量 mock 测试，但不是首期目标）
- `main/agent/worker.ts` 的 `parentPort` 消息循环
- `main/agent/agent-manager.ts` 的真实 `utilityProcess` 生命周期（可 mock 测试状态机，优先级低）
- `preload/index.ts` 的真实 contextBridge 暴露
- `safeStorage` 的真实系统加密（单测只 mock）
- 真实 Provider、真实流式网络请求、真实 API Key
- Tailwind 视觉、字体、滚动、拖拽、红绿灯、窗口尺寸
- 打包/asar/签名
- `useStickToBottom`：依赖真实布局，jsdom 的 `scrollHeight = 0`，不适合单测

## 4. 依赖与安装

所有测试依赖放在 `apps/desktop`，与 Vite、React 处于同一包，避免根目录 peer 解析问题：

```bash
pnpm --filter @ateam/desktop add -D \
  vitest@5.1.1 \
  @vitest/coverage-v8@5.1.1 \
  jsdom@28.0.0 \
  @testing-library/react@16.3.3 \
  @testing-library/dom@10.4.2 \
  @testing-library/jest-dom@8.0.0 \
  @testing-library/user-event@14.6.13
```

安装后检查：

```bash
pnpm --filter @ateam/desktop exec vitest --version
pnpm typecheck
```

不要在测试里使用真实密钥。所有 Provider 测试使用假 key，并 mock `electron.safeStorage`。

## 5. 配置

### 5.1 新增 `apps/desktop/vitest.config.ts`

```ts
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test/setup.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 只纳入已经有测试的模块；后续随测试增加再扩展
      include: [
        'src/main/agent/errors.ts',
        'src/main/agent/message-history.ts',
        'src/main/agent/atomic-json.ts',
        'src/main/agent/sessions-store.ts',
        'src/main/agent/tools.ts',
        'src/main/models/store.ts',
        'src/renderer/src/chat/store.ts',
        'src/renderer/src/hooks/useElapsed.ts'
      ],
      exclude: ['**/*.test.{ts,tsx}', 'src/**/test/**']
    }
  }
})
```

Vitest 5 的 inline project 默认继承根配置（`extends: true`），因此 `plugins` 和 `resolve.alias` 会自动带给两个 project。

### 5.2 渲染进程 setup

`apps/desktop/src/renderer/src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

如果测试需要 i18n，建议在 `src/renderer/src/test/render.tsx` 里统一引入应用 i18n，避免每个用例重复初始化。不要把 setup 放到 `src` 之外，否则现有 `tsconfig.web.json` 不会自动包含它。

### 5.3 脚本

`apps/desktop/package.json`：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

根 `package.json`：

```json
{
  "scripts": {
    "test": "pnpm --filter @ateam/desktop test",
    "test:watch": "pnpm --filter @ateam/desktop test:watch",
    "test:coverage": "pnpm --filter @ateam/desktop test:coverage"
  }
}
```

### 5.4 类型检查与忽略文件

- 测试文件放在 `src/main/**/*.test.ts` 和 `src/renderer/src/**/*.test.{ts,tsx}`，会被现有 `tsconfig.node.json` / `tsconfig.web.json` 自动包含。
- 将 `vitest.config.ts` 加入 `apps/desktop/tsconfig.node.json` 的 `include`，否则 `pnpm typecheck` 不会检查该配置文件。
- `.gitignore` 已有 `coverage/`；新增 `.vitest/`（Vitest 5 的 blob/attachments/report 输出目录）。
- 使用显式导入（`import { describe, expect, it, vi } from 'vitest'`），不启用 `globals`，减少隐式全局。

## 6. 测试组织约定

- 文件名：`<module>.test.ts` / `*.test.tsx`，与被测模块同目录。
- 命名：`describe('<模块/函数>', ...)`，用例名描述行为，例如 `returns denied tool result as execution-denied`。
- 每个测试独立：临时目录、独立 store 实例、独立 mock；不要依赖执行顺序。
- 使用 `fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-'))`，在 `afterEach` 中 `fs.rm(dir, { recursive: true, force: true })`。
- 时间相关用例使用 `vi.useFakeTimers()` + `vi.setSystemTime()`，结束后恢复真实计时器。
- 测试 JSON 输出、日志或错误时，不要打印真实密钥；统一使用 `sk-test-*` 假 key。
- 测试不访问网络，不调用真实模型；Provider 构造和运行时全部使用 fake stream 或 mock。
- 不使用 `test.only`；提交前检查。
- 逻辑断言使用具体值，不为纯函数引入大范围快照。

建议的测试目录：

```text
apps/desktop/src/main/agent/
├── atomic-json.test.ts
├── errors.test.ts
├── message-history.test.ts
├── sessions-store.test.ts
├── tools.test.ts
└── test/
    └── factories.ts
apps/desktop/src/main/models/
└── store.test.ts
apps/desktop/src/renderer/src/chat/
└── store.test.ts
apps/desktop/src/renderer/src/hooks/
└── useElapsed.test.ts
apps/desktop/src/renderer/src/components/
├── chat/
│   ├── Composer.test.tsx
│   ├── PermissionCard.test.tsx
│   └── SessionPanel.test.tsx
└── settings/
    └── ModelSettings.test.tsx
apps/desktop/src/renderer/src/test/
├── setup.ts
├── api-mock.ts
└── factories.ts
```

## 7. 各模块测试清单

### 7.1 P0：纯逻辑与存储

#### `errors.test.ts`

- `AbortError` → `Request interrupted`
- 401/403/`Forbidden` → 认证失败提示
- 404 / model not found → 模型 ID 提示
- 429 / rate limit → 限流提示
- context / too long → 上下文提示
- `fetch failed` / `ENOTFOUND` → 网络提示
- 5xx → 服务端错误提示
- `sk-...`、`oc_sk-...`、`Authorization:`、server password 被脱敏
- 超长错误被截断到 1000 字符
- 非 Error 输入有可读兜底

#### `message-history.test.ts`

- 用户纯文本 → user message
- 连续用户消息合并
- assistant 文本 + 已完成工具调用 → assistant + tool message
- completed 工具 → `{ type: 'text' }`
- failed 工具 → `{ type: 'error-text' }`
- denied 工具 → `{ type: 'execution-denied' }`
- pending/running/awaiting-approval 工具不进入历史
- error/streaming assistant 跳过
- interrupted assistant 应进入历史（当前行为）
- reasoning 不进入历史
- 空 assistant 不产生空消息

#### `atomic-json.test.ts`

- 写入后读取往返
- 中文/嵌套对象保持不变
- 覆盖已有文件
- 无效 JSON 返回 null
- 文件不存在返回 null
- POSIX 下权限为 0600（Windows 跳过该断言）

#### `sessions-store.test.ts`

- `init` 空目录
- `create` 产生空标题、idle 状态
- 首条 user 消息生成最多 60 字标题
- `list` 按 `updatedAt` 降序
- `rename`、`setModel`、`setStatus`
- `delete` 移除文件和索引项
- 新建 store 重新加载后数据一致
- 启动修复：streaming → interrupted；pending/running/awaiting-approval 工具 → failed；running/waiting-permission → idle
- `index.json` 缺失时扫描 session 文件
- 损坏 session 文件被重命名为 `.corrupt-*` 且不阻塞其他会话
- 原子写入后的文件是合法 JSON

#### `models/store.test.ts`

`electron.safeStorage` 必须 mock，示例：

```ts
const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^enc:/, ''))
}))

vi.mock('electron', () => ({ safeStorage }))
```

用例：

- 空配置初始化
- 添加 Anthropic/OpenAI/Google Provider 需要 API Key
- OpenAI-compatible 需要 baseURL，可无 Key
- `publicConfig` 只暴露 `hasApiKey`，不暴露 key
- `runtimeConfig` 解密出 key
- `config.json` 不含明文 key，`secrets.json` 可被 mock 解密
- safeStorage 不可用时，保存 key 抛 `ENCRYPTION_UNAVAILABLE`
- 更新 Provider 名称/类型/baseURL
- `clearApiKey` 在非 compatible Provider 上被拒绝且不破坏已存 key（事务性）
- 删除 Provider 同时删除其模型、密钥和默认模型指向
- 添加第一个模型自动成为默认模型
- 重复 providerId/modelId 抛 `MODEL_EXISTS`
- 删除默认模型后回退到第一个剩余模型
- 删除最后一个模型后默认模型为 null
- `setDefault` 拒绝不存在的模型
- init 时修复指向不存在模型的默认模型

#### `tools.test.ts`

使用临时 workspace，`askPermission` 用 `vi.fn()`：

- `read` 返回带行号内容；offset/limit 生效；二进制文件返回错误字符串
- `read`/`list`/`grep` 阻止 `../outside`（POSIX 下也测 symlink 逃逸）
- `list` 深度 1 和 2；目录带 `/`；忽略 `.git`、`node_modules`；排序稳定
- `grep` 匹配行号、include 过滤、maxResults 截断；无匹配返回 `No matches`
- `write` 未授权时返回拒绝文本，不创建文件；授权后创建父目录并写入
- `edit` 唯一替换；多次匹配且未 `replaceAll` 时报错；`replaceAll` 全部替换；找不到时报错
- `write`/`edit` 权限回调收到正确 action、resource、toolName、toolCallId
- `shell` 未授权不执行；授权后在 workspace 内执行并返回输出；cwd 逃逸被拒绝
- shell 超时/取消：可用 fake spawn 或 POSIX 条件测试，避免真实长等待
- 工具错误以字符串返回，不抛出裸异常

#### `chat/store.test.ts`

在 `jsdom` 环境中 mock `window.api`。`ChatStore` 已导出 class，使用 `new ChatStore()` 隔离，不要复用单例。

建议准备：

- `createApiMock()`：实现 `AteamApi` 的 status/info/models/agent.sessions/chat/permissions；`onEvent` 保存 listener 并返回取消函数
- `emit(envelope)`：测试中主动触发事件
- `deferred<T>()`：控制 `messages.list` 的返回时机

用例：

- `init` 读取 status/info/models/sessions/permissions，并选中最近的会话
- 无会话时不自动创建
- `createSession` 插入列表、选中、空消息
- `session.upsert` 排序；`session.deleted` 删除并回退选择
- `message.upsert` 新增/替换
- `message.part.upsert` 在正确 partIndex 更新
- `message.part.delta` 追加 text/reasoning；错误 kind 不破坏已有 part
- `permission.asked` 去重添加；`permission.replied` 移除；`run.finished` 清理该会话权限
- `run.started` 清理旧 outcome；`run.finished` 记录 outcome
- 快照加载期间事件先缓冲，快照返回后只重放 `seq > snapshot.seq`
- `selectSession` 已加载不重复请求；未加载时请求快照
- `send` 在 agent 未 ready 时拒绝；动作调用正确的 IPC 参数
- rename/delete/setModel/stop/retry 调用正确参数
- 动作失败写入 `actionError`
- agent 从非 ready 变为 ready 时触发重载

#### `useElapsed.test.ts`

- 初始为 0
- 1 秒后为 1
- inactive 为 0
- startedAt 变化后基于新时间计算
- 卸载后不再 setState

### 7.2 P1：React 组件

统一使用 `@testing-library/react` + `user-event`，通过 helper 渲染 i18n。组件测试不要断言 Tailwind 具体 class，优先断言 role/text/aria 状态。

- `PermissionCard`：Allow/Always/Deny 分别调用 `once`/`always`/`reject`；请求进行中禁用它；失败显示错误
- `Composer`：Enter/Shift+Enter/IME；无模型禁用发送；运行中显示停止；发送失败显示错误并保留文本
- `SessionPanel`：新建按钮、选中、重命名 Enter/Escape、删除两步确认
- `ModelSettings`：mock `window.api.models` 和 `window.api.agent.info`；添加/编辑/删除、默认模型、测试连接成功/失败、加密不可用 banner
- `MessageList`：渲染用户气泡、Markdown、工具行、权限卡；错误/中断/重试按钮的出现条件；不测试滚动位置

### 7.3 P1：Agent 运行循环（需要小幅重构）

`runtime.ts` 直接 import `streamText`、`createLanguageModel` 和 `createTools`。有两种方案：

1. **推荐：依赖注入**（需要单独评审，不改变行为）
   - 在 `AgentRuntimeOptions` 增加可选的 stream/model/tools 工厂，默认使用现有实现
   - 测试注入 fake `AsyncIterable<TextStreamPart>`，精确控制 text/tool/finish/error/abort
2. **模块 mock**
   - 在测试文件顶层 `vi.mock('ai', ...)`，mock `streamText` 和 `stepCountIs`
   - 容易受 AI SDK 内部结构变化影响，不建议作为首期方案

用例（注入方案）：

- 纯文本流 → assistant complete、usage、duration、run.finished completed
- tool-call → permission.asked；reply once → 工具执行 → 下一步文本
- reply always → 同一会话后续同名 action 不再询问
- reply reject → 工具 denied，模型收到拒绝结果
- stop → partial 文本保留、assistant interrupted、未结算工具 failed
- 模型错误 → assistant error、session error、可 retry
- retry → 追加新 assistant，不重复用户消息，跳过上一条失败 assistant
- max steps → outcome `max-steps`
- 同一会话运行中再次 send → `SESSION_BUSY`
- 权限超时/worker shutdown 时 pending 全部拒绝
- 删除运行中的会话 → abort

## 8. Mock 与夹具

### 8.1 `window.api` mock

渲染进程测试通过 `Object.defineProperty(window, 'api', { value: api, configurable: true })` 注入；类型使用 `AteamApi`。`onEvent` 需要保存 callback，测试里主动发送 `AgentEventEnvelope`，不要依赖真实 IPC。

### 8.2 Electron mock

只有 `models/store.ts` 等直接依赖 `electron` 的模块需要 mock。Vitest 5 要求 `vi.mock` 在文件顶层；如果 mock 工厂要引用变量，使用 `vi.hoisted`。不要 mock 全局 `electron` 后让所有测试共享，避免影响其他模块。

### 8.3 数据工厂

在 `src/main/agent/test/factories.ts` 中创建：

- `makeSession(overrides)`
- `makeMessage(overrides)`
- `makeTextPart` / `makeToolPart` / `makeReasoningPart`
- `makePermission(overrides)`
- `makeModelsConfig(overrides)`

全部使用 `@ateam/shared` 的类型，不用 `any`。工厂只生成测试数据，不执行 I/O。

### 8.4 临时目录

```ts
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-'))
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
```

Windows 上不要断言 0600 文件权限；相关用例用 `process.platform !== 'win32'` 条件跳过。

## 9. 实施顺序

1. **接入基础**
   - 创建 `test/vitest-unit-tests` 分支
   - 安装依赖
   - 添加 `vitest.config.ts`、setup、脚本、`.vitest/` ignore
   - 将 `vitest.config.ts` 加入 node tsconfig
   - 跑通一个最小的 `errors.test.ts`，确认 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`
2. **P0 逻辑**
   - `message-history`、`errors`、`atomic-json`、`sessions-store`
   - `models/store`（先 mock safeStorage）
   - `tools`（先 read/list/grep，再 write/edit/shell）
3. **P0 渲染状态**
   - `chat/store` + `useElapsed`
4. **P1 组件**
   - `PermissionCard`、`Composer`、`SessionPanel`
   - `ModelSettings`
5. **P1 运行循环**
   - 先提交依赖注入重构（单独提交，行为不变），再加 runtime 测试
6. **可选**
   - Playwright Electron E2E；不在本单元测试范围内

每个阶段保持 `pnpm test` 可通过后再进入下一阶段。

## 10. 验收标准

- `pnpm install` 后 `pnpm test` 可运行，不访问网络、不依赖真实 API Key
- `pnpm test:coverage` 生成 `coverage/`，覆盖报告中包含本文列出的 P0 模块
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过
- 测试之间互相隔离，临时目录清理干净；连续运行两次结果一致
- 不存在 `.only`、真实密钥、真实模型请求和长时间 `sleep`
- 平台相关断言（文件权限、shell）有明确条件或说明
- 不改变生产代码行为；若为 runtime 测试做依赖注入，单独提交并说明默认行为不变
- PR 描述中列出覆盖的模块、未覆盖项和已知限制

## 11. 风险与注意事项

- **Electron 模块**：在 Node 测试环境中直接 `import 'electron'` 得到的是二进制路径而不是 API；依赖 Electron 的模块必须 mock。
- **safeStorage**：单测只验证“是否调用加密/是否写入密文”，不验证真实系统 Keychain。
- **AI SDK**：Provider 包为 ESM；`vi.mock('ai')` 必须顶层，且容易和工具执行耦合，优先依赖注入。
- **jsdom 布局限制**：`scrollHeight`、`clientHeight`、真实滚动、剪贴板都不可靠，不要为这些写单测。
- **shell 工具**：真实子进程受平台/CI 影响；首期用 stub spawn 或仅 POSIX 条件测试，避免挂起。
- **Vitest 5 配置**：使用 `test.projects`，不要创建 `vitest.workspace.ts`；`poolOptions` 已移除。
- **jsdom 版本**：使用 28，不要用 31；否则需要同步提高 Node 下限。
- **RTL cleanup**：未启用 globals 时，setup 中显式 `afterEach(cleanup)`。
- **单例 store**：`chatStore` 是单例，测试中应 `new ChatStore()`，避免测试间状态泄漏。
- **文件模式**：Windows 不支持 POSIX 0600 断言。
- **时间**：权限 10 分钟超时、1 秒持久化节流等，使用 fake timers，避免真实等待。

## 12. 未决事项（需要负责人确认）

1. 是否接受 runtime 的小幅依赖注入重构；如果接受，建议作为单独提交先合并。
2. 是否设置覆盖率阈值；建议先完成 P0 并观察基线，再决定是否加阈值。
3. 是否在 CI 中跑 Windows；如果跑，shell 测试和文件权限测试需要调整。
4. 是否把 Playwright Electron E2E 纳入后续阶段；本文件不包含。
5. 是否将 `packages/shared` 未来新增的纯逻辑纳入独立的 node project。

## 13. 交付物

- `apps/desktop/vitest.config.ts`
- `apps/desktop/src/renderer/src/test/setup.ts`
- `apps/desktop/src/main/agent/test/factories.ts`
- `apps/desktop/src/renderer/src/test/api-mock.ts`
- 第 6 节列出的测试文件
- `apps/desktop/package.json` 与根 `package.json` 的 test 脚本
- `.gitignore` 的 `.vitest/`
- 一份说明“已覆盖 / 未覆盖 / 平台限制”的 PR 描述

## 14. 命令速查

```bash
# 安装测试依赖
pnpm --filter @ateam/desktop add -D \
  vitest@5.1.1 @vitest/coverage-v8@5.1.1 jsdom@28.0.0 \
  @testing-library/react@16.3.3 @testing-library/dom@10.4.2 \
  @testing-library/jest-dom@8.0.0 @testing-library/user-event@14.6.13

# 运行全部单元测试
pnpm test

# 只运行 main（node）project
pnpm --filter @ateam/desktop exec vitest run --project main

# 只运行 renderer（jsdom）project
pnpm --filter @ateam/desktop exec vitest run --project renderer

# 监听模式
pnpm test:watch

# 覆盖率
pnpm test:coverage

# 提交前检查
pnpm typecheck && pnpm lint && pnpm format:check
```
