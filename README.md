# ATeam

ATeam 是一个基于 Electron 的 AI Agent 桌面应用。当前版本包含完整的会话核心：多会话管理、流式回复、Markdown 渲染、工具调用、权限审批、模型供应商配置，以及项目规则、上下文压缩、快照回滚、MCP、子代理、LSP 诊断、自动格式化与 Web 工具。

各功能的详细说明见 [docs/features.md](docs/features.md)。

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
│           ├── main/                 # 主进程（只有这里能用 Electron API）
│           │   ├── agent/            # Agent utilityProcess 侧
│           │   │   ├── runtime/      # 运行循环、子代理、默认依赖、策略
│           │   │   ├── sessions/     # 会话存储、压缩、快照、工具输出
│           │   │   ├── config/       # 指令、权限规则、Agent 定义
│           │   │   ├── integrations/ # MCP、LSP、格式化、Web 抓取与搜索
│           │   │   ├── tools.ts      # 内置工具
│           │   │   └── worker.ts / agent-manager.ts
│           │   ├── stores/           # 主进程配置存储（模型 / 搜索，safeStorage 密钥）
│           │   ├── models/           # 供应商模型目录查询
│           │   └── ipc/              # 类型化 IPC、入参校验
│           ├── preload/              # 窄接口 window.api
│           └── renderer/src/
│               ├── chat/             # 会话事件 store
│               ├── components/       # AppRail、会话页、设置页
│               └── pages/            # ChatPage、SettingsPage
├── packages/
│   └── shared/                       # 跨进程共享的事件、模型、协议类型
├── docs/                             # 对齐 TODO 与归档文档
├── package.json
└── pnpm-workspace.yaml
```

`main/agent` 运行在 Agent utilityProcess 中；`main/stores` 只在主进程运行（需要 `safeStorage`），解密后的配置通过 worker 请求下发给 Agent。

## 环境要求

- Node.js >= 22.13
- pnpm >= 11

## 快速开始

```bash
pnpm install
pnpm dev
```

首次使用需要在 **设置 → 模型** 中添加一个供应商和模型，并填写真实 API Key，然后回到会话页开始对话。

## 常用命令

| 命令                                          | 说明                         |
| --------------------------------------------- | ---------------------------- |
| `pnpm dev`                                    | 启动桌面应用开发模式         |
| `pnpm start`                                  | 预览已构建的应用             |
| `pnpm build`                                  | 类型检查并构建桌面应用       |
| `pnpm typecheck`                              | 对全部包执行 TypeScript 检查 |
| `pnpm lint`                                   | 对全部包执行 ESLint          |
| `pnpm format`                                 | 对全部包执行 Prettier        |
| `pnpm format:check`                           | 检查全部文件格式             |
| `pnpm build:unpack`                           | 构建未打包的 macOS 应用目录  |
| `pnpm build:mac`                              | 构建 macOS 安装包            |
| `pnpm build:win`                              | 构建 Windows 安装包          |
| `pnpm build:linux`                            | 构建 Linux 安装包            |
| `pnpm --filter @ateam/desktop build:unpack`   | 构建当前平台未打包目录       |
| `pnpm --filter @ateam/desktop smoke:packaged` | 启动打包产物并跑冒烟验收     |
| `pnpm cli -- ...`                             | 运行 Headless CLI            |
| `pnpm serve -- ...`                           | 启动本地 HTTP API 服务       |
| `pnpm acp -- ...`                             | 以 ACP 协议供编辑器接入      |

## 架构约定

- **进程隔离**：模型密钥、safeStorage 和 IPC 在主进程；Agent 运行在 Electron `utilityProcess`；渲染进程只通过 preload 暴露的 `window.api` 通信，不接触 Node、网络或密钥。
- **模型配置**：支持 Anthropic、OpenAI、Google 和 OpenAI-compatible Provider。API Key 使用 `safeStorage` 加密后写入 `userData/models/secrets.json`，渲染进程只能看到 `hasApiKey`。
- **会话持久化**：默认使用 SQLite（`userData/agent/sessions.db`，事件日志 + 检查点），旧 JSON 会话自动迁移；启动时会把遗留的 streaming/未结算工具状态修复为 interrupted/failed。
- **工作区**：新会话默认使用 `userData/agent-workspace`，可在会话页标题栏切换为默认工作区、最近目录或任意本地目录；目录随会话持久化。`read`、`list`、`grep` 自动执行；`write`、`edit`、`shell` 需要用户授权；路径解析会阻止 `..` 和 symlink 逃逸。
- **工具循环**：AI SDK `streamText` + `stepCountIs(25)`；工具结果按 `toolCallId` 归并，文本/推理按 `partIndex` 归并，事件带单调 `seq`。
- **权限**：`once`、`always`、`reject` 三种决定；`always` 仅当前会话内有效；停止运行会取消流并拒绝未完成的权限请求。
- **UI**：会话页对齐 nomi-ai 的布局（52px AppRail、260px 会话栏、768px 聊天列、20px 圆角工作区卡片）；主题和语言设置继续使用设置页。
- **路由**：React Router 8 Hash 路由，兼容 Electron 的 `file://` 加载方式。
- **共享类型**：`@ateam/shared` 直接导出 TypeScript 源码，由 electron-vite / Vite 在构建时打包，因此作为开发依赖引入。
- **Electron 二进制**：默认通过 npmmirror 下载（见 `apps/desktop/scripts/install-electron.mjs`），可用 `ELECTRON_MIRROR` 覆盖。`electron-builder.yml` 的 `electronDownload.mirror` 同样使用 npmmirror；`pnpm-workspace.yaml` 通过 override 将 electron-builder 使用的 `@electron/get` 固定到兼容版本。

## 打包与发行验收

本地可用 `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @ateam/desktop build:unpack` 生成当前平台的未打包应用；随后运行 `pnpm --filter @ateam/desktop smoke:packaged`，脚本会以临时用户数据目录启动打包产物，验证窗口、Agent worker、会话持久化，并通过本地 mock 模型完成一次带 `grep` 工具调用的对话。

仓库的 `Package` 工作流在 macOS / Linux / Windows 上构建未打包应用并执行同一冒烟测试，Linux 使用 `xvfb-run`；产物会打包为 zip / tar.gz 上传。更新 `apps/desktop/package.json` 的版本并推送 `vX.Y.Z` 标签后，工作流会校验标签与版本一致，构建 dmg / nsis exe / AppImage + deb，并创建或更新对应的 GitHub Release。应用内“设置 → 更新”会检查 `releases/latest`，下载当前平台的安装包到下载目录并打开。当前产物未做代码签名或公证，正式分发需要另外配置证书与公证凭据。

## 功能范围

已实现：多会话与工作目录、流式文本/推理/工具调用、Markdown、附件与 `@` 文件引用、权限审批、停止/重试/撤销/重做、上下文压缩、模型供应商与 OAuth、项目规则与自定义 Agent、子代理、MCP、Skills 与自定义命令、LSP 诊断与自动格式化、Web 抓取与搜索、快照与引用、Git worktree、桌面浏览器自动化、SQLite 事件溯源存储，以及 Headless CLI、Server API / SDK、ACP、GitHub Action。

已知限制与后续方向见 [docs/features.md](docs/features.md) 第 17 节。
