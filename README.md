# ATeam

AI Agent 桌面应用的基础工程骨架。当前包含项目结构、构建配置、路由、主题与语言设置以及占位页面，不包含业务功能。

## 技术栈

- Monorepo：pnpm workspaces
- 桌面端：Electron 44 + electron-vite 6
- 前端：React 19 + TypeScript 5 + Vite 8 + Tailwind CSS 4 + React Router 8

## 目录结构

```text
ATeam/
├── apps/
│   └── desktop/          # Electron 桌面应用（main / preload / renderer）
├── packages/
│   └── shared/           # 跨进程、跨包共享的常量与类型
├── package.json          # 根脚本与 workspace 入口
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
| `pnpm build:mac`    | 构建 macOS 安装包            |
| `pnpm build:win`    | 构建 Windows 安装包          |
| `pnpm build:linux`  | 构建 Linux 安装包            |

## 约定

- ESLint 和 Prettier 配置位于仓库根目录，统一覆盖 `apps/` 与 `packages/`。
- 渲染进程多语言基于 i18next / react-i18next，支持跟随系统、中文和 English；语言偏好保存在 localStorage（`ateam.language`）。
- 渲染进程样式使用 Tailwind CSS 4（`@tailwindcss/vite`），语义化设计令牌参考 nomi-ai 的最新 UI，支持浅色、深色和跟随系统。
- 设置页（`/settings`）采用左侧分区导航 + 内容区布局，提供主题和语言切换；主题偏好保存在 localStorage（`ateam.theme`）。
- 桌面窗口使用一体化标题栏：macOS 内嵌红绿灯，Windows/Linux 使用窗口控件 overlay；标题栏可拖动。
- 渲染进程路由使用 React Router 8 的 Hash 路由，兼容 Electron 的 `file://` 加载方式；路由定义在 `apps/desktop/src/renderer/src/router.tsx`。
- `@ateam/shared` 直接导出 TypeScript 源码，由 electron-vite / Vite 在构建时打包，因此在桌面端作为开发依赖引入。
- Electron 二进制默认通过 npmmirror 下载（见 `apps/desktop/scripts/install-electron.mjs`），可用 `ELECTRON_MIRROR` 环境变量覆盖。
- 后续可以在 `packages/` 下继续拆分 agent 核心、工具层、UI 组件等模块。
