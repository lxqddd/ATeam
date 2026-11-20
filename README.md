# ATeam

AI Agent 桌面应用的基础工程骨架。当前只包含项目结构、构建配置和一条最小占位界面，不包含业务功能。

## 技术栈

- Monorepo：pnpm workspaces
- 桌面端：Electron 44 + electron-vite 6
- 前端：React 19 + TypeScript 5 + Vite 8 + Tailwind CSS 4

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
- 渲染进程多语言基于 i18next / react-i18next，语言资源位于 `apps/desktop/src/renderer/src/i18n/locales`，当前支持 `zh-CN` 与 `en-US`。
- 渲染进程样式使用 Tailwind CSS 4（`@tailwindcss/vite`），入口为 `apps/desktop/src/renderer/src/assets/index.css`。
- `@ateam/shared` 直接导出 TypeScript 源码，由 electron-vite / Vite 在构建时打包，因此在桌面端作为开发依赖引入。
- Electron 二进制默认通过 npmmirror 下载（见 `apps/desktop/scripts/install-electron.mjs`），可用 `ELECTRON_MIRROR` 环境变量覆盖。
- 后续可以在 `packages/` 下继续拆分 agent 核心、工具层、UI 组件等模块。
