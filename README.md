# ATeam

ATeam 是一个基于 Electron 的 AI Agent 桌面应用。当前版本包含完整的会话核心：多会话管理、流式回复、Markdown 渲染、工具调用、权限审批和模型供应商配置。

## 技术栈

- Monorepo：pnpm workspaces
- 桌面端：Electron 44 + electron-vite 6
- 前端：React 19 + TypeScript 5 + Vite 8 + Tailwind CSS 4 + React Router 8
- Agent：Vercel AI SDK 7 + Anthropic / OpenAI / Google / OpenAI-compatible Provider
- 文案：i18next / react-i18next（跟随系统、中文、English）

## 目录结构

```text
ATeam/
├── apps/
│   └── desktop/
│       └── src/
│           ├── main/
│           │   ├── agent/        # utilityProcess Agent、会话持久化、工具、Provider
│           │   ├── models/       # 模型配置与 safeStorage 密钥
│           │   └── ipc/          # 类型化 IPC、入参校验
│           ├── preload/          # 窄接口 window.api
│           └── renderer/src/
│               ├── chat/         # 会话事件 store
│               ├── components/   # AppRail、会话页、设置页
│               └── pages/        # ChatPage、SettingsPage
├── packages/
│   └── shared/                   # 跨进程共享的事件、模型、协议类型
├── package.json
└── pnpm-workspace.yaml
```

## 环境要求

- Node.js >= 22.12
- pnpm >= 11

## 快速开始

```bash
pnpm install
pnpm dev
```

首次使用需要在 **设置 → 模型** 中添加一个供应商和模型，并填写真实 API Key，然后回到会话页开始对话。

## 常用命令

| 命令                | 说明                         |
| ------------------- | ---------------------------- |
| `pnpm dev`          | 启动桌面应用开发模式         |
| `pnpm start`        | 预览已构建的应用             |
| `pnpm build`        | 类型检查并构建桌面应用       |
| `pnpm typecheck`    | 对全部包执行 TypeScript 检查 |
| `pnpm lint`         | 对全部包执行 ESLint          |
| `pnpm format`       | 对全部包执行 Prettier        |
| `pnpm format:check` | 检查全部文件格式             |
| `pnpm build:unpack` | 构建未打包的 macOS 应用目录  |
| `pnpm build:mac`    | 构建 macOS 安装包            |
| `pnpm build:win`    | 构建 Windows 安装包          |
| `pnpm build:linux`  | 构建 Linux 安装包            |

## 架构约定

- **进程隔离**：模型密钥、safeStorage 和 IPC 在主进程；Agent 运行在 Electron `utilityProcess`；渲染进程只通过 preload 暴露的 `window.api` 通信，不接触 Node、网络或密钥。
- **模型配置**：支持 Anthropic、OpenAI、Google 和 OpenAI-compatible Provider。API Key 使用 `safeStorage` 加密后写入 `userData/models/secrets.json`，渲染进程只能看到 `hasApiKey`。
- **会话持久化**：会话和消息以原子 JSON 写入 `userData/agent/sessions/`；启动时会把遗留的 streaming/未结算工具状态修复为 interrupted/failed。
- **工作区**：V1 固定为 `userData/agent-workspace`。`read`、`list`、`grep` 自动执行；`write`、`edit`、`shell` 需要用户授权；路径解析会阻止 `..` 和 symlink 逃逸。
- **工具循环**：AI SDK `streamText` + `stepCountIs(25)`；工具结果按 `toolCallId` 归并，文本/推理按 `partIndex` 归并，事件带单调 `seq`。
- **权限**：`once`、`always`、`reject` 三种决定；`always` 仅当前会话内有效；停止运行会取消流并拒绝未完成的权限请求。
- **UI**：会话页对齐 nomi-ai 的布局（52px AppRail、260px 会话栏、768px 聊天列、20px 圆角工作区卡片）；主题和语言设置继续使用设置页。
- **路由**：React Router 8 Hash 路由，兼容 Electron 的 `file://` 加载方式。
- **共享类型**：`@ateam/shared` 直接导出 TypeScript 源码，由 electron-vite / Vite 在构建时打包，因此作为开发依赖引入。
- **Electron 二进制**：默认通过 npmmirror 下载（见 `apps/desktop/scripts/install-electron.mjs`），可用 `ELECTRON_MIRROR` 覆盖。`electron-builder.yml` 的 `electronDownload.mirror` 同样使用 npmmirror；`pnpm-workspace.yaml` 通过 override 将 electron-builder 使用的 `@electron/get` 固定到兼容版本。

## V1 范围

已实现：会话列表/新建/切换/重命名/删除、流式文本与推理、Markdown、工具卡片、权限审批、停止、重试、模型供应商与默认模型、连接测试、工作区打开、浅色/深色/跟随系统、中英文。

暂不包含：附件、项目目录选择、多模型自动路由、MCP、子 Agent、上下文压缩、跨会话的 always 权限。
