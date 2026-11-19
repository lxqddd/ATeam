# ATeam Web UI 对齐 nomi-ai 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ATeam Web UI 的主题、外壳布局与全部页面视觉对齐 nomi-ai 最新样式（7 套主题 + Codex 式卡片外壳），保持现有功能与信息架构不变。

**Architecture:** 先建立与 nomi `packages/ui/src/tokens.css` 同构的设计令牌层（结构令牌 + 7 套调色板），再用 Pinia 主题 store 在挂载前把 `data-theme` / `html.dark` 写到根元素；Element Plus 通过变量层重主题；外壳改为「导轨 + 面板与工作区拼成一张 16px 圆角卡」；共享组件与 7 个页面逐层替换为 SectionCard + 紧凑行 + 语义徽章。

**Tech Stack:** Vue 3 + TypeScript + Vite 8 + Pinia + Tailwind CSS 4 + shadcn-vue/reka-ui + Element Plus（仅复杂控件）+ vue-i18n。

**Spec:** `docs/superpowers/specs/2026-11-18-nomi-ui-alignment-design.md`

## Global Constraints

- 只改 `apps/web`；不改 Go 后端、API、路由与数据结构。
- 不新增 npm 依赖；复用已有 shadcn-vue / reka-ui / lucide / Element Plus。
- 主题 id 固定为：`light | dark | sunset | cream | mist | ink | graphite`；偏好额外支持 `system`，默认 `system`，存储键 `ateam.theme`。
- 深色主题集合固定为 `dark | ink | graphite`，仅这三者给 `<html>` 加 `class="dark"`。
- 组件内不得写死颜色（`#xxxxxx` / `rgb(...)`），一律使用 `--cd-*` 变量或 `@theme` 语义工具类；唯一例外是 `tokens.css` 与 `ThemeSwatch.vue` 中的数据色板。
- 圆角只用 `--cd-radius-*`；间距走 4px 栅格；侧栏/时间线行高 32px；表格行 40px；标题栏 44px。
- 所有新增可见文案必须同时写入 `zh-CN.ts` 与 `en-US.ts`，`pnpm --filter @ateam/web check:i18n` 必须通过。
- 保留 `.app-titlebar` 的 `-webkit-app-region` / `--wails-draggable` 拖动能力。
- 每个任务结束运行 `pnpm -r typecheck`；提交信息使用 conventional commits，并在消息末尾追加一行 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。
- 验证用预览工具（preview_start / preview_eval / preview_inspect / preview_screenshot）；开发服务器已在 `127.0.0.1:5173` 运行，后端在 `127.0.0.1:8787`。

---

## File Structure

**新建**

| 路径 | 职责 |
|---|---|
| `apps/web/src/styles/tokens.css` | 结构令牌 + 7 套主题调色板（改编自 nomi，MIT） |
| `apps/web/src/stores/theme.ts` | 主题偏好、系统跟随、持久化、启动应用 |
| `apps/web/src/stores/ui.ts` | 侧栏收起状态与持久化 |
| `apps/web/src/components/SectionCard.vue` | 分区卡片容器 |
| `apps/web/src/components/ThemeSwatch.vue` | 主题选择卡（微型界面预览） |
| `apps/web/src/components/ui/input/Input.vue` + `index.ts` | 文本输入 |
| `apps/web/src/components/ui/textarea/Textarea.vue` + `index.ts` | 多行输入 |
| `apps/web/src/components/ui/field/Field.vue` + `index.ts` | 表单行 |
| `apps/web/src/components/ui/badge/Badge.vue` + `index.ts` | 语义徽章 |
| `apps/web/src/components/ui/skeleton/Skeleton.vue` + `index.ts` | 骨架屏 |

**重写**

`apps/web/index.html`、`apps/web/src/main.ts`、`apps/web/src/styles/main.css`、`apps/web/src/styles/_tokens.scss`、`apps/web/src/styles/element-theme.css`、`apps/web/src/App.vue`、`apps/web/src/components/AppTitleBar.vue`、`apps/web/src/components/AppSidebar.vue`、`apps/web/src/components/TaskCard.vue`、`apps/web/src/components/StatusBadge.vue`、`apps/web/src/components/EmptyState.vue`、`apps/web/src/components/Modal.vue`、`apps/web/src/views/BoardView.vue`、`TaskView.vue`、`AgentsView.vue`、`AgentWorkView.vue`、`RunsView.vue`、`RunDetailView.vue`、`SettingsView.vue`、`apps/web/src/i18n/locales/zh-CN.ts`、`en-US.ts`。

**微调**

`apps/web/src/components/ui/button/index.ts`（补充 `xl` 尺寸）。

---

### Task 1: 设计令牌与 Tailwind 映射

**Files:**
- Create: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/main.css`（整文件重写）
- Modify: `apps/web/src/styles/_tokens.scss`（整文件重写）

**Interfaces:**
- Produces: CSS 变量 `--cd-radius-xs|sm|md|lg|xl|full`、`--cd-space-0-5|1|1-5|2|3|4|5|6|8`、`--cd-control-h-2xs|xs|sm|ms|md|lg`、7 套 `[data-theme]` 下的 `--cd-color-*` / `--cd-shadow-*`；Tailwind 语义色 `bg-bg/panel/surface/surface-raised/sunken/hover/selected`、`text-fg-muted/fg-subtle`、`border-border-subtle/border-strong`、`bg-success|warning|danger|info` 及 `*-soft` / `border-*-border`。

- [ ] **Step 1: 生成 tokens.css**

```bash
cp /tmp/nomi-tokens.css apps/web/src/styles/tokens.css
```

若 `/tmp/nomi-tokens.css` 不存在：

```bash
gh api "repos/lxqddd/nomi-ai/contents/packages/ui/src/tokens.css?ref=8f1be8d" --jq '.content' | base64 -d > apps/web/src/styles/tokens.css
```

然后编辑该文件：
1. 把文件头注释替换为：
```css
/*
 * Design tokens adapted from lxqddd/nomi-ai
 * packages/ui/src/tokens.css (MIT), commit 8f1be8d.
 * Theme palettes: light, dark, sunset, cream, mist, ink, graphite.
 */
```
2. 删除文件末尾从 `html[data-chat-bg] {` 到文件结尾的整段（nomi 的图片背景主题，本项目不使用）。

- [ ] **Step 2: 重写 main.css**

```css
@import 'tailwindcss';
@import "tw-animate-css";
@import "shadcn-vue/tailwind.css";
@import './tokens.css';

@custom-variant dark (&:is(.dark *));

/* ATeam 兼容别名：导航悬停底（旧版主题令牌，nomi 最新 tokens 未包含） */
:root {
  --cd-color-nav-bg: color-mix(in srgb, var(--cd-color-hover) 60%, var(--cd-color-selected-bg));
}

@theme inline {
  --font-sans: var(--cd-font-sans);
  --font-mono: var(--cd-font-mono);

  --text-caption: var(--cd-font-size-xs);
  --text-caption--line-height: var(--cd-line-height-xs);
  --text-label: var(--cd-font-size-sm);
  --text-label--line-height: var(--cd-line-height-sm);
  --text-body: var(--cd-font-size-md);
  --text-body--line-height: var(--cd-line-height-md);
  --text-subtitle: var(--cd-font-size-lg);
  --text-subtitle--line-height: var(--cd-line-height-lg);
  --text-title: var(--cd-font-size-xl);
  --text-title--line-height: var(--cd-line-height-xl);
  --text-display: var(--cd-font-size-2xl);
  --text-display--line-height: var(--cd-line-height-2xl);

  --color-bg: var(--cd-color-bg);
  --color-panel: var(--cd-panel-bg);
  --color-surface: var(--cd-color-surface);
  --color-surface-raised: var(--cd-color-surface-raised);
  --color-sunken: var(--cd-color-surface-sunken);
  --color-hover: var(--cd-color-hover);
  --color-selected: var(--cd-color-selected-bg);
  --color-fg-muted: var(--cd-color-text-muted);
  --color-fg-subtle: var(--cd-color-text-subtle);
  --color-border-subtle: var(--cd-color-border-subtle);
  --color-border-strong: var(--cd-color-border-strong);
  --color-brand: var(--cd-color-accent);
  --color-success: var(--cd-color-success);
  --color-success-soft: var(--cd-color-success-soft);
  --color-success-border: var(--cd-color-success-border);
  --color-warning: var(--cd-color-warning);
  --color-warning-soft: var(--cd-color-warning-soft);
  --color-warning-border: var(--cd-color-warning-border);
  --color-danger: var(--cd-color-danger);
  --color-danger-soft: var(--cd-color-danger-soft);
  --color-danger-border: var(--cd-color-danger-border);
  --color-info: var(--cd-color-info);
  --color-info-soft: var(--cd-color-info-soft);
  --color-info-border: var(--cd-color-info-border);

  --background: var(--cd-color-bg);
  --foreground: var(--cd-color-text);
  --card: var(--cd-color-surface);
  --card-foreground: var(--cd-color-text);
  --popover: var(--cd-color-surface-raised);
  --popover-foreground: var(--cd-color-text);
  --primary: var(--cd-color-accent);
  --primary-foreground: var(--cd-color-text-on-accent);
  --secondary: var(--cd-color-surface-raised);
  --secondary-foreground: var(--cd-color-text);
  --muted: var(--cd-color-surface-raised);
  --muted-foreground: var(--cd-color-text-subtle);
  --accent: var(--cd-color-hover);
  --accent-foreground: var(--cd-color-text);
  --destructive: var(--cd-color-danger-fill);
  --border: var(--cd-color-border);
  --input: var(--cd-color-input-bg);
  --ring: var(--cd-color-border-focus);
  --sidebar: var(--cd-color-bg-subtle);
  --sidebar-foreground: var(--cd-color-text);
  --sidebar-primary: var(--cd-color-accent);
  --sidebar-primary-foreground: var(--cd-color-text-on-accent);
  --sidebar-accent: var(--cd-color-surface-raised);
  --sidebar-accent-foreground: var(--cd-color-text);
  --sidebar-border: var(--cd-color-border);
  --sidebar-ring: var(--cd-color-border-focus);
  --radius: var(--cd-radius-md);
  --radius-sm: calc(var(--radius) * 0.75);
  --radius-md: var(--radius);
  --radius-lg: var(--cd-radius-lg);
  --radius-xl: var(--cd-radius-xl);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

html, body, #app { height: 100%; }

body {
  margin: 0;
  font-family: var(--cd-font-sans);
  font-size: var(--cd-font-size-md);
  line-height: var(--cd-line-height);
  background: var(--cd-color-bg);
  color: var(--cd-color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

* { box-sizing: border-box; }

::selection { background: var(--cd-color-accent-soft); }

/* 悬停才出现的滚动条（nomi：滚动条不再常驻） */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
:hover::-webkit-scrollbar-thumb,
:focus-within::-webkit-scrollbar-thumb { background: var(--cd-color-border); }
::-webkit-scrollbar-thumb:hover { background: var(--cd-color-border-strong); }
::-webkit-scrollbar-track { background: transparent; }
* { scrollbar-width: thin; scrollbar-color: transparent transparent; }
*:hover, *:focus-within { scrollbar-color: var(--cd-color-border) transparent; }

button, input, textarea, select { font: inherit; }
code, pre { font-family: var(--cd-font-mono); }

:where(button, a[href], [role='button'], [role='tab'], [role='option'], [role='menuitem'], [tabindex]:not([tabindex='-1'])):focus-visible {
  outline: 2px solid var(--cd-color-accent-strong);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

/* 外壳几何 */
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--cd-panel-bg-subtle);
  overflow: hidden;
}
.app-body { flex: 1; min-height: 0; display: flex; }
.app-titlebar {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--cd-space-2);
  padding: 0 var(--cd-space-2) 0 var(--cd-space-3);
  -webkit-app-region: drag;
  app-region: drag;
  --wails-draggable: drag;
}
.app-titlebar button { -webkit-app-region: no-drag; app-region: no-drag; --wails-draggable: no-drag; }
.app-titlebar__title {
  font: var(--cd-text-label);
  font-weight: 600;
  color: var(--cd-color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-titlebar__spacer { flex: 1; min-width: var(--cd-space-2); }
.workspace-card {
  flex: 1;
  min-width: 0;
  margin: var(--cd-space-2) var(--cd-space-2) var(--cd-space-2) 0;
  border: 1px solid var(--cd-panel-border);
  border-radius: var(--cd-radius-xl);
  background: var(--cd-color-surface);
  box-shadow: var(--cd-shadow-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.workspace-card--joined {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.lane {
  background: var(--cd-color-surface-sunken);
  border-radius: var(--cd-radius-lg);
}

/* 表单基础件 */
.input-control {
  width: 100%;
  height: var(--cd-control-h-md);
  padding: 0 var(--cd-space-3);
  color: var(--cd-color-text);
  background: var(--cd-color-input-bg);
  border: 1px solid var(--cd-color-border);
  border-radius: var(--cd-radius-md);
  font-size: var(--cd-font-size-sm);
  transition: border-color var(--cd-duration-fast) var(--cd-ease), box-shadow var(--cd-duration-fast) var(--cd-ease);
}
.input-control::placeholder { color: var(--cd-color-disabled-text); }
.input-control:hover { border-color: var(--cd-color-border-strong); }
.input-control:focus {
  outline: none;
  border-color: var(--cd-color-border-focus);
  box-shadow: var(--cd-input-ring);
}
.textarea-control {
  width: 100%;
  min-height: 88px;
  padding: var(--cd-space-2) var(--cd-space-3);
  color: var(--cd-color-text);
  background: var(--cd-color-input-bg);
  border: 1px solid var(--cd-color-border);
  border-radius: var(--cd-radius-md);
  font-size: var(--cd-font-size-sm);
  line-height: var(--cd-line-height);
  resize: vertical;
  transition: border-color var(--cd-duration-fast) var(--cd-ease), box-shadow var(--cd-duration-fast) var(--cd-ease);
}
.textarea-control:hover { border-color: var(--cd-color-border-strong); }
.textarea-control:focus {
  outline: none;
  border-color: var(--cd-color-border-focus);
  box-shadow: var(--cd-input-ring);
}
.field { display: flex; flex-direction: column; gap: var(--cd-space-1); }
.field__label { font: var(--cd-text-label); font-weight: 500; color: var(--cd-color-text); }
.field__hint { font: var(--cd-text-caption); color: var(--cd-color-text-subtle); margin: 0; }
.field__error { font: var(--cd-text-caption); color: var(--cd-color-danger); margin: 0; }

/* 徽章 */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--cd-space-1);
  height: 20px;
  padding: 0 var(--cd-space-2);
  border-radius: var(--cd-radius-full);
  font-size: var(--cd-font-size-xs);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.badge[data-tone='neutral'] { color: var(--cd-color-neutral); background: var(--cd-color-neutral-soft); border: 1px solid var(--cd-color-neutral-border); }
.badge[data-tone='success'] { color: var(--cd-color-success); background: var(--cd-color-success-soft); border: 1px solid var(--cd-color-success-border); }
.badge[data-tone='warning'] { color: var(--cd-color-warning); background: var(--cd-color-warning-soft); border: 1px solid var(--cd-color-warning-border); }
.badge[data-tone='danger'] { color: var(--cd-color-danger); background: var(--cd-color-danger-soft); border: 1px solid var(--cd-color-danger-border); }
.badge[data-tone='info'] { color: var(--cd-color-info); background: var(--cd-color-info-soft); border: 1px solid var(--cd-color-info-border); }
.badge[data-tone='brand'] { color: var(--cd-color-accent-strong); background: var(--cd-color-accent-soft); border: 1px solid var(--cd-color-accent); }
.badge[data-soft='false'] { background: transparent; }

/* 分区卡片 */
.section-card {
  background: var(--cd-color-surface);
  border: 1px solid var(--cd-color-border-subtle);
  border-radius: var(--cd-radius-lg);
  overflow: hidden;
}
.section-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cd-space-3);
  padding: var(--cd-space-3) var(--cd-space-4) 0;
}
.section-card__title { font: var(--cd-text-label); font-weight: 600; margin: 0; }
.section-card__desc { font: var(--cd-text-caption); color: var(--cd-color-text-subtle); margin: 2px 0 0; }
.section-card__body { padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4); }
```

- [ ] **Step 3: 同步 _tokens.scss**

```scss
// ATeam 设计令牌（Sass 镜像）— 与 styles/tokens.css 保持一致。
// 仅在 <style lang="scss"> 中需要变量时使用；优先用 CSS 变量。

$color-bg: var(--cd-color-bg);
$color-panel: var(--cd-panel-bg);
$color-surface: var(--cd-color-surface);
$color-surface-raised: var(--cd-color-surface-raised);
$color-text: var(--cd-color-text);
$color-text-muted: var(--cd-color-text-muted);
$color-text-subtle: var(--cd-color-text-subtle);
$color-border: var(--cd-color-border);
$color-border-strong: var(--cd-color-border-strong);
$color-accent: var(--cd-color-accent);
$color-accent-soft: var(--cd-color-accent-soft);
$color-danger: var(--cd-color-danger);
$color-success: var(--cd-color-success);
$color-warning: var(--cd-color-warning);

$font-sans: var(--cd-font-sans);
$font-mono: var(--cd-font-mono);

$font-size-xs: var(--cd-font-size-xs);
$font-size-sm: var(--cd-font-size-sm);
$font-size-md: var(--cd-font-size-md);
$font-size-lg: var(--cd-font-size-lg);
$font-size-xl: var(--cd-font-size-xl);
$font-size-2xl: var(--cd-font-size-2xl);

$radius-xs: var(--cd-radius-xs);
$radius-sm: var(--cd-radius-sm);
$radius-md: var(--cd-radius-md);
$radius-lg: var(--cd-radius-lg);
$radius-xl: var(--cd-radius-xl);

$breakpoint-sm: 640px;
$breakpoint-md: 768px;
$breakpoint-lg: 1024px;
$breakpoint-xl: 1280px;

@mixin respond-to($breakpoint) {
  @media (min-width: $breakpoint) { @content; }
}

@mixin text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: 验证构建与令牌**

```bash
pnpm --filter @ateam/web build
```
Expected: 构建成功（可能仍提示 chunk 过大，可忽略）。

在预览中执行：

```js
getComputedStyle(document.documentElement).getPropertyValue('--cd-radius-xl').trim()
```
Expected: `16px`。

```js
document.documentElement.dataset.theme = 'sunset';
getComputedStyle(document.documentElement).getPropertyValue('--cd-color-bg').trim()
```
Expected: `#fff8f1`；完成后把 dataset.theme 设回 `graphite` 或 `light`。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/styles/main.css apps/web/src/styles/_tokens.scss
git commit -m "style(web): add nomi design tokens and tailwind mapping" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 主题运行时与启动引导

**Files:**
- Create: `apps/web/src/stores/theme.ts`
- Create: `apps/web/src/stores/ui.ts`
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/main.ts`

**Interfaces:**
- Produces:
  - `THEMES: ThemeInfo[]`（含 `id: ThemePref`、`nameKey`、`descKey`、`swatch: [string,string,string,string]`）
  - `useThemeStore(): { pref: ThemePref; resolved: ThemeId; themes: ThemeInfo[]; setTheme(pref: ThemePref): void }`
  - `initTheme(): void`（在 `createApp` 前调用）
  - `useUiStore(): { sidebarCollapsed: boolean; toggleSidebar(): void; setSidebarCollapsed(value: boolean): void }`

- [ ] **Step 1: 写 theme store**

```ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const THEME_IDS = ['light', 'dark', 'sunset', 'cream', 'mist', 'ink', 'graphite'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export type ThemePref = ThemeId | 'system'

export interface ThemeInfo {
  id: ThemePref
  nameKey: string
  descKey: string
  swatch: [string, string, string, string]
}

export const THEMES: ThemeInfo[] = [
  { id: 'system', nameKey: 'settings.theme.system', descKey: 'settings.theme.systemDesc', swatch: ['#f7f7f7', '#141414', '#f08a5d', '#ffffff'] },
  { id: 'light', nameKey: 'settings.theme.light', descKey: 'settings.theme.lightDesc', swatch: ['#f7f7f7', '#ffffff', '#141414', '#c45425'] },
  { id: 'dark', nameKey: 'settings.theme.dark', descKey: 'settings.theme.darkDesc', swatch: ['#141414', '#1f1f1f', '#f2f2f2', '#f08a5d'] },
  { id: 'sunset', nameKey: 'settings.theme.sunset', descKey: 'settings.theme.sunsetDesc', swatch: ['#fff8f1', '#ffffff', '#3f332d', '#c45425'] },
  { id: 'cream', nameKey: 'settings.theme.cream', descKey: 'settings.theme.creamDesc', swatch: ['#fffcf6', '#ffffff', '#403126', '#ab653e'] },
  { id: 'mist', nameKey: 'settings.theme.mist', descKey: 'settings.theme.mistDesc', swatch: ['#f5f8f9', '#ffffff', '#20343d', '#4f7182'] },
  { id: 'ink', nameKey: 'settings.theme.ink', descKey: 'settings.theme.inkDesc', swatch: ['#201a17', '#302722', '#f5ede6', '#f08a5d'] },
  { id: 'graphite', nameKey: 'settings.theme.graphite', descKey: 'settings.theme.graphiteDesc', swatch: ['#13161b', '#20252d', '#f0f2f6', '#7887f5'] },
]

const STORAGE_KEY = 'ateam.theme'
const DARK_THEMES: ThemeId[] = ['dark', 'ink', 'graphite']

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || THEME_IDS.includes(value as ThemeId)
}

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemePref(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePref, dark: boolean): ThemeId {
  return pref === 'system' ? (dark ? 'dark' : 'light') : pref
}

function applyTheme(pref: ThemePref): ThemeId {
  const resolved = resolveTheme(pref, prefersDark())
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themePref = pref
  root.classList.toggle('dark', DARK_THEMES.includes(resolved))
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) {
    meta.setAttribute('content', DARK_THEMES.includes(resolved) ? 'dark' : 'light')
  }
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    /* ignore */
  }
  return resolved
}

export function initTheme(): void {
  applyTheme(readPref())
}

export const useThemeStore = defineStore('theme', () => {
  const pref = ref<ThemePref>(readPref())
  const resolved = ref<ThemeId>(applyTheme(pref.value))
  const themes = THEMES
  const dark = computed(() => DARK_THEMES.includes(resolved.value))

  if (typeof matchMedia === 'function') {
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', () => {
      if (pref.value === 'system') {
        resolved.value = applyTheme('system')
      }
    })
  }

  function setTheme(next: ThemePref): void {
    pref.value = next
    resolved.value = applyTheme(next)
  }

  return { pref, resolved, dark, themes, setTheme }
})
```

- [ ] **Step 2: 写 ui store**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'ateam.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(readCollapsed())

  function setSidebarCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  function toggleSidebar(): void {
    setSidebarCollapsed(!sidebarCollapsed.value)
  }

  return { sidebarCollapsed, setSidebarCollapsed, toggleSidebar }
})
```

- [ ] **Step 3: 改 index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>ATeam</title>
    <script>
      ;(() => {
        try {
          const ids = ['light', 'dark', 'sunset', 'cream', 'mist', 'ink', 'graphite']
          let pref = localStorage.getItem('ateam.theme') || 'system'
          if (pref !== 'system' && ids.indexOf(pref) === -1) pref = 'system'
          const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
          const resolved = pref === 'system' ? (dark ? 'dark' : 'light') : pref
          const isDark = ['dark', 'ink', 'graphite'].indexOf(resolved) !== -1
          document.documentElement.dataset.theme = resolved
          document.documentElement.dataset.themePref = pref
          document.documentElement.classList.toggle('dark', isDark)
          document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
          document.querySelector('meta[name="color-scheme"]').content = isDark ? 'dark' : 'light'
        } catch (error) {
          /* ignore */
        }
      })()
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: 改 main.ts**

```ts
import './styles/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
// 必须晚于 Element Plus 的变量，才能覆盖其主题映射
import './styles/element-theme.css'

import i18n from './i18n'
import App from './App.vue'
import { router } from './router'
import { initTheme } from './stores/theme'

initTheme()

createApp(App).use(createPinia()).use(router).use(i18n).use(ElementPlus).mount('#app')
```

- [ ] **Step 5: 验证**

```bash
pnpm -r typecheck
```
Expected: 通过。

预览中依次执行：

```js
localStorage.setItem('ateam.theme', 'graphite'); location.reload()
```
重载后：
```js
[document.documentElement.dataset.theme, document.documentElement.classList.contains('dark')]
```
Expected: `['graphite', true]`。

```js
localStorage.setItem('ateam.theme', 'sunset'); location.reload()
```
重载后：`['sunset', false]`。

设为 `system` 后重载：`document.documentElement.dataset.theme` 等于 `light` 或 `dark`（取决于系统）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/index.html apps/web/src/main.ts apps/web/src/stores/theme.ts apps/web/src/stores/ui.ts
git commit -m "feat(web): add theme and ui stores with boot-time application" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Element Plus 跨主题映射

**Files:**
- Modify: `apps/web/src/styles/element-theme.css`（整文件重写）

**Interfaces:**
- Consumes: Task 1 的 `--cd-*` 变量。
- Produces: EP 在 7 套主题下与令牌一致的按钮/输入/卡片/对话框/标签/表格观感。

- [ ] **Step 1: 重写 element-theme.css**

```css
/* Element Plus × nomi 令牌（7 套主题）。
 * 基础映射放 :root（与 EP 同特异性、后写生效）；深色补充放 html.dark。
 */

:root {
  --el-color-primary: var(--cd-color-accent);
  --el-color-primary-light-3: color-mix(in srgb, var(--cd-color-accent) 72%, var(--cd-color-bg));
  --el-color-primary-light-5: color-mix(in srgb, var(--cd-color-accent) 52%, var(--cd-color-bg));
  --el-color-primary-light-7: color-mix(in srgb, var(--cd-color-accent) 32%, var(--cd-color-bg));
  --el-color-primary-light-8: color-mix(in srgb, var(--cd-color-accent) 22%, var(--cd-color-bg));
  --el-color-primary-light-9: color-mix(in srgb, var(--cd-color-accent) 14%, var(--cd-color-bg));
  --el-color-primary-dark-2: var(--cd-color-accent-hover);
  --el-color-success: var(--cd-color-success);
  --el-color-warning: var(--cd-color-warning);
  --el-color-danger: var(--cd-color-danger);
  --el-color-error: var(--cd-color-danger);
  --el-color-info: var(--cd-color-info);
  --el-color-success-light-9: var(--cd-color-success-soft);
  --el-color-warning-light-9: var(--cd-color-warning-soft);
  --el-color-danger-light-9: var(--cd-color-danger-soft);
  --el-color-error-light-9: var(--cd-color-danger-soft);
  --el-color-info-light-9: var(--cd-color-info-soft);

  --el-bg-color-page: var(--cd-color-bg);
  --el-bg-color: var(--cd-color-surface);
  --el-bg-color-overlay: var(--cd-color-surface-raised);
  --el-text-color-primary: var(--cd-color-text);
  --el-text-color-regular: var(--cd-color-text-muted);
  --el-text-color-secondary: var(--cd-color-text-subtle);
  --el-text-color-placeholder: var(--cd-color-disabled-text);
  --el-text-color-disabled: var(--cd-color-disabled-text);
  --el-border-color: var(--cd-color-border);
  --el-border-color-light: var(--cd-color-border-subtle);
  --el-border-color-lighter: var(--cd-color-border-subtle);
  --el-border-color-extra-light: var(--cd-color-border-subtle);
  --el-border-color-dark: var(--cd-color-border-strong);
  --el-border-color-darker: var(--cd-color-border-strong);
  --el-fill-color: var(--cd-color-hover);
  --el-fill-color-light: var(--cd-color-surface-raised);
  --el-fill-color-lighter: var(--cd-color-surface);
  --el-fill-color-extra-light: var(--cd-color-bg-subtle);
  --el-fill-color-dark: var(--cd-color-hover);
  --el-fill-color-darker: var(--cd-color-border);
  --el-fill-color-blank: var(--cd-color-surface);
  --el-input-bg-color: var(--cd-color-input-bg);
  --el-mask-color: var(--cd-color-overlay);
  --el-disabled-bg-color: var(--cd-color-disabled-bg);
  --el-disabled-text-color: var(--cd-color-disabled-text);
  --el-disabled-border-color: var(--cd-color-border-subtle);

  --el-border-radius-base: var(--cd-radius-md);
  --el-border-radius-small: var(--cd-radius-sm);
  --el-border-radius-round: var(--cd-radius-full);
  --el-box-shadow: var(--cd-shadow-lg);
  --el-box-shadow-light: var(--cd-shadow-md);
  --el-box-shadow-lighter: var(--cd-shadow-sm);
  --el-box-shadow-dark: var(--cd-shadow-lg);
  --el-card-bg-color: var(--cd-color-surface);
}

html.dark {
  --el-color-info: var(--cd-color-info);
  --el-fill-color-blank: var(--cd-color-surface);
}

/* 按钮：28（small）/ 36（默认与 large）/ 40（xl 自定义类） */
.el-button {
  height: var(--cd-control-h-md);
  padding: 0 var(--cd-space-4);
  border-radius: var(--cd-radius-md);
  font: var(--cd-text-label);
  font-weight: 500;
  transition:
    background-color var(--cd-duration-fast) var(--cd-ease),
    border-color var(--cd-duration-fast) var(--cd-ease),
    color var(--cd-duration-fast) var(--cd-ease),
    box-shadow var(--cd-duration-fast) var(--cd-ease),
    transform var(--cd-duration-fast) var(--cd-ease);
}
.el-button--small { height: var(--cd-control-h-sm); padding: 0 var(--cd-space-3); font-size: var(--cd-font-size-xs); }
.el-button--large { height: var(--cd-control-h-lg); padding: 0 var(--cd-space-5); }
.el-button:not(.is-text):not(.is-link):not(.is-disabled):active { transform: scale(0.985); }
.el-button--primary:not(.is-plain):not(.is-text):not(.is-link) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), var(--cd-shadow-sm);
}
.el-button--default:not(.is-plain):not(.is-text):not(.is-link) {
  --el-button-bg-color: var(--cd-color-btn-secondary-bg);
  --el-button-border-color: var(--cd-color-btn-secondary-border);
  --el-button-text-color: var(--cd-color-btn-secondary-text);
  --el-button-hover-bg-color: var(--cd-color-hover);
  --el-button-hover-border-color: var(--cd-color-border-strong);
  --el-button-hover-text-color: var(--cd-color-text);
  box-shadow: var(--cd-shadow-sm);
}

/* 输入 / 选择 / 文本域 */
.el-input__wrapper,
.el-select__wrapper,
.el-textarea__inner {
  border-radius: var(--cd-radius-md);
  background: var(--cd-color-input-bg);
  box-shadow: 0 0 0 1px var(--cd-color-border) inset;
  transition: box-shadow var(--cd-duration-fast) var(--cd-ease);
}
.el-input__wrapper:hover,
.el-select__wrapper:hover,
.el-textarea__inner:hover { box-shadow: 0 0 0 1px var(--cd-color-border-strong) inset; }
.el-input__wrapper.is-focus,
.el-select__wrapper.is-focused,
.el-textarea__inner:focus {
  box-shadow: 0 0 0 1px var(--cd-color-border-focus) inset, var(--cd-input-ring);
}
.el-input__inner, .el-textarea__inner, .el-select__placeholder { font-size: var(--cd-font-size-sm); }

/* 卡片（若仍有页面使用） */
.el-card {
  --el-card-bg-color: var(--cd-color-surface);
  border: 1px solid var(--cd-color-border-subtle);
  border-radius: var(--cd-radius-lg);
}
.el-card.is-never-shadow { box-shadow: none; }
.el-card__header { border-bottom: 1px solid var(--cd-color-border-subtle); padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-2); }
.el-card__body { padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4); }

/* 对话框 */
.el-dialog {
  border: 1px solid var(--cd-color-border);
  border-radius: var(--cd-radius-xl);
  background: var(--cd-color-surface-raised);
  box-shadow: var(--cd-shadow-lg);
}
.el-overlay { background-color: var(--cd-color-overlay); }
.el-dialog__title { font-size: var(--cd-font-size-lg); font-weight: 600; letter-spacing: var(--cd-tracking-tight); color: var(--cd-color-text); }

/* 标签 */
.el-tag { border-radius: var(--cd-radius-xs); font-weight: 500; }

/* 表格 */
.el-table {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-border-color: var(--cd-color-border-subtle);
  --el-table-row-hover-bg-color: var(--cd-color-hover);
  --el-table-header-text-color: var(--cd-color-text-subtle);
  --el-table-text-color: var(--cd-color-text-muted);
}
.el-table th.el-table__cell { font-size: var(--cd-font-size-xs); font-weight: 600; letter-spacing: var(--cd-tracking-wide); }
```

- [ ] **Step 2: 验证**

```bash
pnpm --filter @ateam/web build
```
Expected: 成功。

预览中切到 `light` 主题并打开任务详情的新建/编辑弹窗（Agents 页），确认输入框、按钮、对话框为浅色且文字可读；再切到 `graphite` 确认深色不回归。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/styles/element-theme.css
git commit -m "style(web): map element plus onto the shared theme tokens" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Codex 式外壳与可收起侧栏

**Files:**
- Modify: `apps/web/src/App.vue`（整文件重写）
- Modify: `apps/web/src/components/AppTitleBar.vue`（整文件重写）
- Modify: `apps/web/src/components/AppSidebar.vue`（整文件重写）
- Modify: `apps/web/src/i18n/locales/zh-CN.ts`、`en-US.ts`（新增 sidebar 文案）

**Interfaces:**
- Consumes: `useUiStore()`（Task 2）、`useTasksStore` / `useAgentsStore` / `useRunsStore`。
- Produces: DOM 挂载点 `#titlebar-actions`（页面用 `<Teleport to="#titlebar-actions">` 注入操作）；CSS 类 `.app-shell` / `.app-body` / `.app-titlebar` / `.workspace-card` / `.workspace-card--joined`（Task 1 已定义）。

- [ ] **Step 1: 重写 App.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import AppSidebar from './components/AppSidebar.vue'
import AppTitleBar from './components/AppTitleBar.vue'
import { useEventStream } from './composables/useEventStream'
import { useUiStore } from './stores/ui'

useEventStream()

const { locale } = useI18n()
const ui = useUiStore()
const elLocale = computed(() => (locale.value === 'zh-CN' ? zhCn : en))
</script>

<template>
  <el-config-provider :locale="elLocale">
    <div class="app-shell">
      <AppTitleBar />
      <div class="app-body">
        <AppSidebar />
        <main class="workspace-card" :class="{ 'workspace-card--joined': !ui.sidebarCollapsed }">
          <router-view />
        </main>
      </div>
    </div>
  </el-config-provider>
</template>
```

- [ ] **Step 2: 重写 AppTitleBar.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from '@lucide/vue'
import { useTasksStore } from '../stores/tasks'
import { useAgentsStore } from '../stores/agents'
import { useUiStore } from '../stores/ui'

const route = useRoute()
const tasks = useTasksStore()
const agents = useAgentsStore()
const ui = useUiStore()
const { t } = useI18n()

const PAGE_TITLE_KEYS: Record<string, string> = {
  board: 'board.title',
  agents: 'agents.title',
  runs: 'runs.title',
  run: 'runDetail.title',
  settings: 'settings.title',
}

const title = computed(() => {
  if (route.name === 'task') {
    const task = tasks.items.find((item) => item.id === String(route.params.id))
    return task?.title ?? t('task.pageTitle')
  }
  if (route.name === 'agent-work') {
    const agent = agents.items.find((item) => item.id === String(route.params.id))
    return agent?.name ?? t('agents.title')
  }
  const key = PAGE_TITLE_KEYS[String(route.name ?? '')]
  return key ? t(key) : 'ATeam'
})

const toggleLabel = computed(() =>
  ui.sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse'),
)
</script>

<template>
  <header class="app-titlebar">
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-[10px] text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
      :title="toggleLabel"
      :aria-label="toggleLabel"
      :aria-expanded="!ui.sidebarCollapsed"
      @click="ui.toggleSidebar()"
    >
      <PanelLeftOpenIcon v-if="ui.sidebarCollapsed" class="size-4" />
      <PanelLeftCloseIcon v-else class="size-4" />
    </button>
    <span class="app-titlebar__title">{{ title }}</span>
    <span class="app-titlebar__spacer" />
    <div id="titlebar-actions" class="flex items-center gap-2" />
  </header>
</template>
```

- [ ] **Step 3: 重写 AppSidebar.vue**

```vue
<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Grid, Cpu, DataLine, Setting, Monitor } from '@element-plus/icons-vue'
import { ChevronRightIcon } from '@lucide/vue'
import { useTasksStore } from '../stores/tasks'
import { useAgentsStore } from '../stores/agents'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const tasks = useTasksStore()
const agents = useAgentsStore()
const runs = useRunsStore()
const ui = useUiStore()

const navItems: { path: string; icon: Component; labelKey: string }[] = [
  { path: '/', icon: Grid, labelKey: 'sidebar.nav.board' },
  { path: '/agents', icon: Cpu, labelKey: 'sidebar.nav.agents' },
  { path: '/runs', icon: DataLine, labelKey: 'sidebar.nav.runs' },
  { path: '/settings', icon: Setting, labelKey: 'sidebar.nav.settings' },
]

const settingsSections = [
  { id: 'settings-appearance', labelKey: 'settings.appearance' },
  { id: 'settings-language', labelKey: 'settings.language' },
  { id: 'settings-api', labelKey: 'settings.apiConnection' },
  { id: 'settings-runtime-models', labelKey: 'settings.models.title' },
  { id: 'settings-workspace', labelKey: 'settings.workspace' },
  { id: 'settings-about', labelKey: 'settings.about' },
]

type Section = 'tasks' | 'agents' | 'runs' | 'settings'

const section = computed<Section>(() => {
  if (route.path.startsWith('/agents')) return 'agents'
  if (route.path.startsWith('/runs')) return 'runs'
  if (route.path.startsWith('/settings')) return 'settings'
  return 'tasks'
})

const sectionTitleKey = computed(
  () =>
    ({
      tasks: 'sidebar.nav.board',
      agents: 'sidebar.nav.agents',
      runs: 'sidebar.nav.runs',
      settings: 'sidebar.nav.settings',
    })[section.value],
)

const panelCount = computed(() => {
  if (section.value === 'agents') return agents.items.length
  if (section.value === 'runs') return runs.items.length
  if (section.value === 'tasks') return tasks.items.length
  return settingsSections.length
})

const collapsedSections = ref(new Set<Section>())
const sectionOpen = computed({
  get: () => !collapsedSections.value.has(section.value),
  set: (open: boolean) => {
    const next = new Set(collapsedSections.value)
    if (open) next.delete(section.value)
    else next.add(section.value)
    collapsedSections.value = next
  },
})

async function ensureData() {
  if (section.value === 'tasks' && tasks.items.length === 0) await tasks.fetchAll()
  if (section.value === 'agents' && agents.items.length === 0) await agents.fetchAll()
  if (section.value === 'runs') {
    if (runs.items.length === 0) await runs.fetchAll()
    if (tasks.items.length === 0) await tasks.fetchAll()
  }
}

watch(section, () => { void ensureData() }, { immediate: true })

const TONE_CLASSES: Record<string, string> = {
  done: 'bg-success',
  completed: 'bg-success',
  failed: 'bg-danger',
  blocked: 'bg-warning',
  cancelled: 'bg-warning',
  in_progress: 'bg-brand',
  running: 'bg-brand',
  preparing: 'bg-brand',
  in_review: 'bg-warning',
}
function toneClass(status: string) {
  return TONE_CLASSES[status] ?? 'bg-fg-subtle/60'
}

function taskTitle(id: string) {
  return tasks.items.find((task) => task.id === id)?.title ?? id.slice(0, 8)
}

function openTask(id: string) {
  void router.push(`/tasks/${id}`)
}

const collapsedItems = computed(() => {
  if (section.value === 'agents') {
    return agents.items.slice(0, 8).map((agent) => ({
      id: agent.id, title: agent.name, status: '', path: '/agents',
    }))
  }
  if (section.value === 'runs') {
    return runs.items.slice(0, 8).map((run) => ({
      id: run.id, title: taskTitle(run.taskId), status: run.status, path: `/runs/${run.id}`,
    }))
  }
  if (section.value === 'tasks') {
    return tasks.items.slice(0, 8).map((task) => ({
      id: task.id, title: task.title, status: task.status, path: `/tasks/${task.id}`,
    }))
  }
  return []
})
const overflowCount = computed(() => Math.max(0, panelCount.value - collapsedItems.value.length))

async function goToSection(id: string) {
  if (route.path !== '/settings') {
    await router.push('/settings')
    await nextTick()
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const isTaskRoute = computed(() => route.name === 'task')
</script>

<template>
  <aside class="shrink-0 flex min-h-0">
    <nav class="w-[52px] shrink-0 flex flex-col items-center gap-1 px-2 py-[10px]">
      <div class="flex flex-col items-center gap-0.5 w-full mt-1">
        <button
          v-for="item in navItems"
          :key="item.path"
          type="button"
          class="size-8 inline-flex items-center justify-center rounded-[10px] transition-colors"
          :class="
            route.path === item.path
              ? 'bg-[var(--cd-color-nav-bg)] text-foreground'
              : 'text-fg-muted hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground'
          "
          :title="$t(item.labelKey)"
          :aria-label="$t(item.labelKey)"
          :aria-current="route.path === item.path ? 'page' : undefined"
          @click="router.push(item.path)"
        >
          <el-icon :size="18"><component :is="item.icon" /></el-icon>
        </button>
      </div>

      <div v-if="ui.sidebarCollapsed && collapsedItems.length" class="w-full mt-2 flex flex-col items-center gap-1">
        <router-link
          v-for="entry in collapsedItems"
          :key="entry.id"
          :to="entry.path"
          class="group relative size-8 rounded-[10px] bg-[var(--cd-color-surface-raised)] flex items-center justify-center text-caption text-fg-muted hover:bg-[var(--cd-color-hover)] hover:text-foreground"
          :title="entry.title"
        >
          {{ entry.title.slice(0, 1) }}
          <span class="absolute left-[44px] top-0 z-50 hidden group-hover:block group-focus-visible:block w-56 rounded-[10px] border border-border bg-[var(--cd-color-surface-raised)] px-3 py-2 shadow-[var(--cd-shadow-md)]">
            <span class="block text-caption text-foreground truncate">{{ entry.title }}</span>
            <span class="mt-1 flex items-center gap-1.5 text-caption text-fg-subtle">
              <span class="size-1.5 rounded-full" :class="toneClass(entry.status)" />
              {{ entry.status || '—' }}
            </span>
          </span>
        </router-link>
        <button
          v-if="overflowCount > 0"
          type="button"
          class="size-8 rounded-[10px] text-caption text-fg-subtle hover:bg-[var(--cd-color-hover)]"
          @click="ui.setSidebarCollapsed(false)"
        >
          +{{ overflowCount }}
        </button>
      </div>
    </nav>

    <div v-if="!ui.sidebarCollapsed" class="panel w-[260px] shrink-0 flex flex-col gap-1 px-2 min-h-0">
      <div class="h-11 flex items-center gap-2.5 px-1">
        <div class="size-8 shrink-0 rounded-lg bg-[var(--cd-color-accent-soft)] flex items-center justify-center">
          <el-icon :size="17" color="var(--cd-color-accent-2)"><Monitor /></el-icon>
        </div>
        <div class="leading-tight min-w-0">
          <div class="text-label font-semibold truncate">ATeam</div>
          <div class="text-caption text-fg-subtle truncate">{{ $t('sidebar.tagline') }}</div>
        </div>
      </div>

      <button
        type="button"
        class="h-8 flex items-center gap-1.5 px-1 text-caption text-fg-subtle hover:text-fg-muted"
        :aria-expanded="sectionOpen"
        @click="sectionOpen = !sectionOpen"
      >
        <ChevronRightIcon class="size-3 transition-transform duration-200" :class="{ 'rotate-90': sectionOpen }" />
        {{ $t(sectionTitleKey) }}
        <span class="ml-auto tabular-nums">{{ panelCount }}</span>
      </button>

      <div v-if="sectionOpen" class="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        <template v-if="section === 'tasks'">
          <button
            v-for="task in tasks.items"
            :key="task.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left transition-colors"
            :class="
              isTaskRoute && String(route.params.id) === task.id
                ? 'bg-[var(--cd-color-selected-bg)] text-foreground'
                : 'text-fg-muted hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground'
            "
            @click="openTask(task.id)"
          >
            <span class="size-1.5 shrink-0 rounded-full" :class="toneClass(task.status)" />
            <span class="text-label truncate">{{ task.title }}</span>
          </button>
        </template>

        <template v-else-if="section === 'agents'">
          <button
            v-for="agent in agents.items"
            :key="agent.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="router.push('/agents')"
          >
            <span class="size-1.5 shrink-0 rounded-full bg-brand" />
            <span class="text-label truncate">{{ agent.name }}</span>
            <span class="ml-auto text-caption text-fg-subtle shrink-0">{{ agent.runtime }}</span>
          </button>
        </template>

        <template v-else-if="section === 'runs'">
          <button
            v-for="run in runs.items"
            :key="run.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="router.push(`/runs/${run.id}`)"
          >
            <span class="size-1.5 shrink-0 rounded-full" :class="toneClass(run.status)" />
            <span class="text-label truncate">{{ taskTitle(run.taskId) }}</span>
          </button>
        </template>

        <template v-else>
          <button
            v-for="item in settingsSections"
            :key="item.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="goToSection(item.id)"
          >
            <span class="text-label truncate">{{ $t(item.labelKey) }}</span>
          </button>
        </template>

        <p
          v-if="(section === 'tasks' && tasks.items.length === 0) || (section === 'agents' && agents.items.length === 0) || (section === 'runs' && runs.items.length === 0)"
          class="px-2.5 py-2 text-caption text-fg-subtle"
        >
          {{ $t('common.empty') }}
        </p>
      </div>

      <div class="mt-auto rounded-lg border border-border-subtle bg-surface-raised/60 px-3 py-2.5">
        <div class="flex items-center gap-2 text-caption text-fg-muted">
          <span class="size-1.5 rounded-full bg-success" />
          {{ $t('sidebar.localFirst') }}
        </div>
        <div class="mt-0.5 text-caption text-fg-subtle">v0.1.0</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  margin: var(--cd-space-2) 0;
  background: var(--cd-panel-bg);
  border: 1px solid var(--cd-panel-border);
  border-right: none;
  border-radius: var(--cd-radius-xl) 0 0 var(--cd-radius-xl);
  padding: 10px var(--cd-space-2);
}
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: panel-in 0.18s var(--cd-ease); }
  @keyframes panel-in {
    from { margin-right: -260px; clip-path: inset(0 100% 0 0); }
    to { margin-right: 0; clip-path: inset(0 0 0 0); }
  }
}
</style>
```

说明：`settingsSections` 必须声明在 `panelCount` 之前，避免块级变量先用后声明。

- [ ] **Step 4: 补 i18n（侧栏）**

`zh-CN.ts` 的 `sidebar` 下新增：
```ts
collapse: '收起侧栏',
expand: '展开侧栏',
```
`en-US.ts`：
```ts
collapse: 'Collapse sidebar',
expand: 'Expand sidebar',
```

- [ ] **Step 5: 验证**

```bash
pnpm -r typecheck && pnpm --filter @ateam/web check:i18n
```
Expected: 通过。

预览检查（截图 + computed style）：
- `.workspace-card` 的 `border-top-left-radius` 为 `16px`（面板展开时为 `0px`）；
- 收起侧栏后面板消失、工作区左圆角变 16px、导轨出现方块入口；
- 刷新后收起状态保持；
- 标题栏右侧出现 `#titlebar-actions` 容器。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/App.vue apps/web/src/components/AppTitleBar.vue apps/web/src/components/AppSidebar.vue apps/web/src/i18n/locales/zh-CN.ts apps/web/src/i18n/locales/en-US.ts
git commit -m "feat(web): codex-style shell with collapsible sidebar" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 基础组件与共享组件

**Files:**
- Create: `apps/web/src/components/ui/input/{Input.vue,index.ts}`
- Create: `apps/web/src/components/ui/textarea/{Textarea.vue,index.ts}`
- Create: `apps/web/src/components/ui/field/{Field.vue,index.ts}`
- Create: `apps/web/src/components/ui/badge/{Badge.vue,index.ts}`
- Create: `apps/web/src/components/ui/skeleton/{Skeleton.vue,index.ts}`
- Create: `apps/web/src/components/SectionCard.vue`
- Create: `apps/web/src/components/ThemeSwatch.vue`
- Modify: `apps/web/src/components/ui/button/index.ts`（新增 `xl` 尺寸）
- Modify: `apps/web/src/components/EmptyState.vue`、`StatusBadge.vue`、`TaskCard.vue`、`Modal.vue`

**Interfaces:**
- Produces:
  - `Input` / `Textarea`：`v-model: string`，透传 `class`、`placeholder`、`type`、`disabled`
  - `Field`：props `label?`, `hint?`, `error?`, `for?`
  - `Badge`：props `tone?: 'neutral'|'success'|'warning'|'danger'|'info'|'brand'`、`soft?: boolean`（默认 true）
  - `Skeleton`：props `class?`，渲染 `.animate-pulse` 块
  - `SectionCard`：props `title?`, `description?`；slots `default`、`actions`
  - `ThemeSwatch`：props `theme: ThemeInfo`, `selected: boolean`；emit `select`
  - `StatusBadge`：改为使用 `Badge`，对外 props 不变
  - `TaskCard`：对外 props/emits 不变

- [ ] **Step 1: 新增基础组件**

`ui/input/Input.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

const model = defineModel<string>({ default: '' })
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <input v-model="model" :class="cn('input-control', props.class)" />
</template>
```
`ui/input/index.ts`:
```ts
export { default as Input } from './Input.vue'
```

`ui/textarea/Textarea.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

const model = defineModel<string>({ default: '' })
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <textarea v-model="model" :class="cn('textarea-control', props.class)" />
</template>
```
`ui/textarea/index.ts`:
```ts
export { default as Textarea } from './Textarea.vue'
```

`ui/field/Field.vue`:
```vue
<script setup lang="ts">
defineProps<{ label?: string; hint?: string; error?: string; for?: string }>()
</script>

<template>
  <div class="field">
    <label v-if="label" class="field__label" :for="$props.for">{{ label }}</label>
    <slot />
    <p v-if="error" class="field__error">{{ error }}</p>
    <p v-else-if="hint" class="field__hint">{{ hint }}</p>
  </div>
</template>
```
`ui/field/index.ts`:
```ts
export { default as Field } from './Field.vue'
```

`ui/badge/Badge.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

const props = withDefaults(
  defineProps<{
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'
    soft?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { tone: 'neutral', soft: true },
)
</script>

<template>
  <span class="badge" :class="cn(props.class)" :data-tone="props.tone" :data-soft="props.soft">
    <slot />
  </span>
</template>
```
`ui/badge/index.ts`:
```ts
export { default as Badge } from './Badge.vue'
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'
```

`ui/skeleton/Skeleton.vue`:
```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div :class="cn('animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-hover)]', $props.class)" />
</template>
```
`ui/skeleton/index.ts`:
```ts
export { default as Skeleton } from './Skeleton.vue'
```

- [ ] **Step 2: 新增共享组件**

`SectionCard.vue`:
```vue
<script setup lang="ts">
defineProps<{ title?: string; description?: string }>()
</script>

<template>
  <section class="section-card">
    <header v-if="title || $slots.actions" class="section-card__header">
      <div>
        <h2 v-if="title" class="section-card__title">{{ title }}</h2>
        <p v-if="description" class="section-card__desc">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div class="section-card__body">
      <slot />
    </div>
  </section>
</template>
```

`ThemeSwatch.vue`:
```vue
<script setup lang="ts">
import { CheckIcon } from '@lucide/vue'
import type { ThemeInfo } from '../stores/theme'

defineProps<{ theme: ThemeInfo; selected: boolean }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="group flex flex-col gap-2 rounded-[var(--cd-radius-lg)] border p-3 text-left transition-colors"
    :class="
      selected
        ? 'border-[var(--cd-color-accent)] bg-[var(--cd-color-accent-soft)]'
        : 'border-[var(--cd-color-border-subtle)] bg-[var(--cd-color-surface)] hover:border-[var(--cd-color-border-strong)]'
    "
    role="radio"
    :aria-checked="selected"
    @click="$emit('select')"
  >
    <span
      class="relative block h-16 w-full overflow-hidden rounded-[var(--cd-radius-sm)] border border-black/5"
      :style="{ background: theme.swatch[0] }"
    >
      <span class="absolute inset-x-2 top-2 h-2 rounded-sm" :style="{ background: theme.swatch[1] }" />
      <span class="absolute inset-x-2 top-5 h-1.5 w-2/3 rounded-sm" :style="{ background: theme.swatch[2], opacity: 0.7 }" />
      <span class="absolute inset-x-2 bottom-2 h-3 w-1/3 rounded-sm" :style="{ background: theme.swatch[3] }" />
      <span
        v-if="selected"
        class="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--cd-color-accent)] text-[var(--cd-color-text-on-accent)]"
      >
        <CheckIcon class="size-3" />
      </span>
    </span>
    <span class="text-label font-medium">{{ $t(theme.nameKey) }}</span>
  </button>
</template>
```

- [ ] **Step 3: 重写共享组件**

`StatusBadge.vue`：
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RunStatus, TaskStatus } from '@ateam/shared'
import { Badge } from './ui/badge'
import type { BadgeTone } from './ui/badge'

const props = withDefaults(
  defineProps<{ status: TaskStatus | RunStatus; kind?: 'task' | 'run' }>(),
  { kind: 'task' },
)
const { t } = useI18n()

const label = computed(() =>
  props.kind === 'run'
    ? t(`common.status.run.${props.status}`)
    : t(`common.status.task.${props.status}`),
)

const tone = computed<BadgeTone>(() => {
  const status = props.status
  if (status === 'done' || status === 'completed') return 'success'
  if (status === 'in_progress' || status === 'running' || status === 'preparing') return 'brand'
  if (status === 'failed') return 'danger'
  if (status === 'blocked' || status === 'cancelled' || status === 'in_review') return 'warning'
  return 'neutral'
})
</script>

<template>
  <Badge :tone="tone">{{ label }}</Badge>
</template>
```

`EmptyState.vue`：
```vue
<script setup lang="ts">
import { InboxIcon } from '@lucide/vue'

defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
    <span class="flex size-9 items-center justify-center rounded-full bg-[var(--cd-color-surface-raised)] text-fg-subtle">
      <InboxIcon class="size-4" />
    </span>
    <p class="text-body font-semibold">{{ title }}</p>
    <p v-if="description" class="text-caption text-fg-subtle">{{ description }}</p>
    <slot />
  </div>
</template>
```

`TaskCard.vue`（替换 `el-card` 与 `el-tag`，props/emits 不变）：
```vue
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Task } from '@ateam/shared'
import StatusBadge from './StatusBadge.vue'

defineProps<{ task: Task }>()
defineEmits<{ open: [task: Task]; dragstart: [task: Task] }>()
const { t } = useI18n()

const PRIORITY_KEYS: Record<number, string> = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' }
function priorityLabel(priority: number) {
  return t(`common.priority.${PRIORITY_KEYS[priority] ?? 'none'}`)
}
</script>

<template>
  <article
    draggable="true"
    class="cursor-pointer rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border-subtle)] bg-[var(--cd-color-surface)] p-3 transition-colors hover:border-[var(--cd-color-border-strong)] hover:shadow-[var(--cd-shadow-sm)]"
    @click="$emit('open', task)"
    @dragstart="$emit('dragstart', task)"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-body font-semibold leading-snug">{{ task.title }}</h3>
      <span class="shrink-0 text-caption text-fg-subtle">{{ task.id.slice(0, 4) }}</span>
    </div>
    <p v-if="task.description" class="mt-1.5 line-clamp-2 text-caption text-fg-subtle">{{ task.description }}</p>
    <div class="mt-3 flex items-center justify-between gap-2">
      <StatusBadge :status="task.status" />
      <span class="text-caption text-fg-subtle">{{ priorityLabel(task.priority) }}</span>
    </div>
  </article>
</template>
```

`Modal.vue`（EP 对话框，宽度改为 prop，默认 640）：
```vue
<script setup lang="ts">
withDefaults(defineProps<{ open: boolean; title: string; width?: string }>(), { width: '640px' })
defineEmits<{ close: [] }>()
</script>

<template>
  <el-dialog :model-value="open" :title="title" :width="width" append-to-body @close="$emit('close')">
    <slot />
    <template #footer>
      <slot name="footer" />
    </template>
  </el-dialog>
</template>
```

- [ ] **Step 4: 扩展 Button 尺寸**

在 `apps/web/src/components/ui/button/index.ts` 的 `size` 中新增：
```ts
'xl': 'h-10 gap-2 px-4 text-sm',
```
（与已有 `lg` 并存；页面主按钮使用 `size="lg"`，紧凑按钮使用 `sm`。）同时把 `buttonVariants` 基础类中的 `rounded-lg` 改为 `rounded-[var(--cd-radius-md)]`，让按钮圆角为 8px。

- [ ] **Step 5: 验证**

```bash
pnpm -r typecheck && pnpm --filter @ateam/web build
```
Expected: 通过。若 `Badge.vue` 的 `export type` 在 `<script setup>` 中报错，把类型移到 `ui/badge/index.ts` 并在此处 import。

预览检查：Agents 页卡片、看板任务卡、空态、状态徽章在 `light` 与 `graphite` 下均正常。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components
git commit -m "feat(web): add nomi ui primitives and restyle shared components" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: 看板

**Files:**
- Modify: `apps/web/src/views/BoardView.vue`（模板与样式）

**Interfaces:**
- Consumes: `SectionCard` 不用于泳道；`TaskCard`、`EmptyState`、`Modal`、`Button`、`Input`、`Textarea`、`Field`；`#titlebar-actions`。

- [ ] **Step 1: 重写模板**

保留 `<script setup>` 全部逻辑（`columns`、`dragging`、`drop`、`createTask`、`draft`、`showCreate`）。把模板替换为：

```vue
<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="lg" @click="showCreate = true">
        <PlusIcon class="size-4" />
        {{ $t('board.newTask') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6 pt-4">
      <div class="flex h-full min-w-max gap-4">
        <section
          v-for="column in columns"
          :key="column.value"
          class="flex w-[280px] shrink-0 flex-col"
          @dragover.prevent
          @drop="drop(column.value)"
        >
          <div class="mb-2 flex items-center gap-2 px-1">
            <span class="text-label font-semibold text-fg-muted">{{ column.label }}</span>
            <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--cd-color-surface-raised)] px-1.5 text-caption text-fg-subtle tabular-nums">
              {{ column.tasks.length }}
            </span>
            <span class="ml-auto text-caption text-fg-subtle">{{ column.hint }}</span>
          </div>

          <div class="lane flex-1 space-y-2 overflow-y-auto p-2">
            <TaskCard
              v-for="task in column.tasks"
              :key="task.id"
              :task="task"
              @open="openTask"
              @dragstart="dragging = $event"
            />
            <EmptyState
              v-if="column.tasks.length === 0"
              :title="$t('board.emptyTitle')"
              :description="$t('board.emptyDesc')"
            />
          </div>
        </section>
      </div>
    </div>

    <Modal :open="showCreate" :title="$t('board.newTask')" @close="showCreate = false">
      <div class="flex flex-col gap-4">
        <Field :label="$t('board.form.title')" for="board-title">
          <Input id="board-title" v-model="draft.title" :placeholder="$t('board.form.titlePlaceholder')" @keydown.enter="createTask" />
        </Field>
        <Field :label="$t('board.form.description')" for="board-description">
          <Textarea id="board-description" v-model="draft.description" :placeholder="$t('board.form.descriptionPlaceholder')" />
        </Field>
        <Field :label="$t('board.form.status')">
          <el-select v-model="draft.status" style="width: 100%">
            <el-option
              v-for="status in TASK_STATUSES"
              :key="status.value"
              :label="$t(`common.status.task.${status.value}`)"
              :value="status.value"
            />
          </el-select>
        </Field>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="showCreate = false">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" @click="createTask">{{ $t('common.create') }}</el-button>
        </div>
      </template>
    </Modal>
  </div>
</template>
```

注意：`Modal.vue` 当前没有 `footer` 插槽；如直接使用 `#footer`，需在 Task 5 的 Modal 中加入 `<template #footer><slot name="footer" /></template>`。若不加，则把按钮放在默认插槽底部。

- [ ] **Step 2: 引入新组件**

在 `<script setup>` 顶部补充：

```ts
import { PlusIcon } from '@lucide/vue'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Field } from '../components/ui/field'
```
（保留已有的 `TaskCard`、`EmptyState`、`Modal`、`TASK_STATUSES` 等导入。）

- [ ] **Step 3: 验证**

```bash
pnpm -r typecheck
```

预览：看板 7 条泳道无边框、圆角 12、背景 sunken；任务卡悬停有边框与阴影；点击「新建任务」弹窗在标题栏下方居中、输入框主题正确；拖拽任务到另一列后状态更新；在 `light` 与 `graphite` 下截图对比。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/BoardView.vue
git commit -m "style(web): restyle board with compact nomi lanes" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: 任务详情

**Files:**
- Modify: `apps/web/src/views/TaskView.vue`（模板与样式）

**Interfaces:**
- Consumes: `SectionCard`、`Skeleton`、`EmptyState`、`Button`、`Input`、`Select`（EP）、`StatusBadge`、`#titlebar-actions`；保留全部现有 script 逻辑（`load`、`startRun`、`cancelRun`、`refreshRuns`、依赖编辑、评审面板、事件轮询）。

- [ ] **Step 1: 模板重排**

1. 删除页内 `<header>`（标题/返回/状态下拉）。
2. 在模板顶部加入：

```vue
<Teleport to="#titlebar-actions">
  <el-select :model-value="task?.status" style="width: 144px" @change="onStatusChange">
    <el-option
      v-for="status in TASK_STATUSES"
      :key="status.value"
      :label="$t(`common.status.task.${status.value}`)"
      :value="status.value"
    />
  </el-select>
</Teleport>
```

3. loading 分支改为：

```vue
<div v-if="loading" class="p-6">
  <div class="flex flex-col gap-3">
    <Skeleton class="h-6 w-64" />
    <Skeleton class="h-40 w-full" />
    <Skeleton class="h-40 w-full" />
  </div>
</div>
```

4. 未找到分支：`EmptyState` + `<Button size="lg" @click="router.push('/')">`。
5. 主体容器：

```vue
<div class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
  <div class="grid max-w-[1440px] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
    <!-- 左栏：上下文 + 描述 -->
    <section class="space-y-4">
      <SectionCard :title="$t('task.context')"> …原 dl 内容，行改为 32px… </SectionCard>
      <SectionCard :title="$t('task.description')"> …原描述… </SectionCard>
    </section>
    <!-- 中栏：Run 启动器 + Run 列表 + 依赖 -->
    <section class="space-y-4">
      <SectionCard :title="$t('task.runs')"> …现有 Agent 选择、开始/取消按钮… </SectionCard>
      <SectionCard :title="$t('task.dependencies')"> …现有依赖编辑器… </SectionCard>
    </section>
    <!-- 右栏：事件 + 评审 -->
    <section class="space-y-4">
      <SectionCard :title="$t('task.runLog')"> …现有事件列表… </SectionCard>
      <SectionCard :title="$t('task.reviewPanel')"> …现有评审面板… </SectionCard>
    </section>
  </div>
</div>
```

6. 所有 `el-card` 删除；`el-skeleton` 删除；`el-empty` 删除；`el-descriptions`（如有）改为 `<dl class="space-y-2 text-label">` + 32px 行。
7. 元信息行统一为：

```vue
<div class="flex h-8 items-center justify-between gap-3">
  <dt class="text-fg-subtle">{{ $t('task.idLabel') }}</dt>
  <dd class="truncate font-mono text-fg-muted">{{ task.id }}</dd>
</div>
```

8. 事件行：

```vue
<div class="flex items-start gap-2 border-b border-border-subtle/60 py-2 last:border-0">
  <span class="w-8 shrink-0 text-right font-mono text-caption text-fg-subtle tabular-nums">{{ event.seq }}</span>
  <span class="shrink-0"><Badge :tone="event.level === 'error' ? 'danger' : 'neutral'">{{ event.type }}</Badge></span>
  <span class="min-w-0 flex-1 text-caption text-fg-muted break-words">{{ event.message }}</span>
</div>
```

- [ ] **Step 2: 引入新组件**

```ts
import { SectionCard } from '../components/SectionCard.vue'
import { Skeleton } from '../components/ui/skeleton'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
```

- [ ] **Step 3: 验证**

```bash
pnpm -r typecheck
```

预览：任务详情三栏卡片、状态切换仍在标题栏；启动 mock Run 后事件实时出现、Run 列表更新；依赖添加/删除可用；评审面板可用；`light`/`graphite` 截图。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/TaskView.vue
git commit -m "style(web): restyle task detail with section cards" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Agents 与 Agent 工作页

**Files:**
- Modify: `apps/web/src/views/AgentsView.vue`
- Modify: `apps/web/src/views/AgentWorkView.vue`

**Interfaces:**
- Consumes: `SectionCard`、`Button`、`Input`、`Textarea`、`Field`、`Badge`、`EmptyState`、`Modal`、`#titlebar-actions`；保留全部表单逻辑（`openCreate`、`openEdit`、`deleteAgent`、`save`、模型测试、`loadWork`）。

- [ ] **Step 1: AgentsView**

0. 在 `<script setup>` 顶部补充导入：`import { PlusIcon, RefreshCwIcon } from '@lucide/vue'`、`import { SectionCard } from '../components/SectionCard.vue'`、`import { Button } from '../components/ui/button'`、`import { Input } from '../components/ui/input'`、`import { Textarea } from '../components/ui/textarea'`、`import { Field } from '../components/ui/field'`、`import { Badge } from '../components/ui/badge'`、`import { EmptyState } from '../components/EmptyState.vue'`。

1. 删除页内 `<header>`；加入：

```vue
<Teleport to="#titlebar-actions">
  <Button size="lg" @click="openCreate">
    <PlusIcon class="size-4" />
    {{ $t('agents.newAgent') }}
  </Button>
</Teleport>
```

2. 卡片：`el-card` → `<article class="section-card">`，卡片体 `p-4`；标题区保持「名称/描述 + 编辑/删除图标按钮（悬停显示：`opacity-0 group-hover:opacity-100 focus-within:opacity-100`）」。
3. 状态徽章：`el-tag` → `<Badge :tone="...">`，工作状态映射：idle→neutral、working→brand、completed→success、failed→danger。
4. 元信息 caption 行保持。
5. 表单：`el-form`/`el-form-item` 保留（校验需要），但 `el-input` → `Input`/`Textarea`，外层用 `Field`；布局改为单列 + 两列混合（运行时分两列），页脚按钮右对齐。
6. 说明文字统一 `text-caption text-fg-subtle`。

- [ ] **Step 2: AgentWorkView**

1. 删除页内 `<header>`；标题栏操作：

```vue
<Teleport to="#titlebar-actions">
  <Button size="sm" variant="outline" @click="loadWork">
    <RefreshCwIcon class="size-4" />
    {{ $t('common.refresh') }}
  </Button>
</Teleport>
```

2. 页内保留实体头：Agent 名（title 级）+ 工作状态 `Badge` + runtime/model caption + 返回链接（`router-link` 文本按钮）。
3. 所有 `el-card` → `SectionCard`；`el-tag` → `Badge`；`el-descriptions` → 32px 定义行。
4. Run 行：32px、状态点 + 任务标题 + 阶段/分支 caption，整行 `router-link`。
5. 事件/时间线沿用 TaskView 的事件行样式。

- [ ] **Step 3: 验证**

```bash
pnpm -r typecheck
```

预览：Agents 卡片网格与编辑弹窗在浅/深主题正常；创建 Agent 选择 runtime/model 正常；连接测试结果内联；工作页两列卡片与 Run 行正常。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/AgentsView.vue apps/web/src/views/AgentWorkView.vue
git commit -m "style(web): restyle agents and agent work pages" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Runs 列表与运行详情

**Files:**
- Modify: `apps/web/src/views/RunsView.vue`
- Modify: `apps/web/src/views/RunDetailView.vue`

**Interfaces:**
- Consumes: `SectionCard`、`Badge`、`Skeleton`、`EmptyState`、`Button`、`#titlebar-actions`；保留 `RunApi` 全部交互与轮询。

- [ ] **Step 1: RunsView 改为列表**

0. 在 `<script setup>` 顶部补充导入：`import { RefreshCwIcon } from '@lucide/vue'`、`import { SectionCard } from '../components/SectionCard.vue'`、`import { Button } from '../components/ui/button'`、`import { EmptyState } from '../components/EmptyState.vue'`；运行详情另需 `Skeleton`、`Badge`。

```vue
<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="sm" variant="outline" @click="runs.fetchAll()">
        <RefreshCwIcon class="size-4" />
        {{ $t('common.refresh') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <SectionCard>
        <div v-if="runs.items.length === 0">
          <EmptyState :title="$t('runs.empty')" />
        </div>
        <div v-else class="overflow-hidden">
          <div class="grid grid-cols-[130px_minmax(0,1.2fr)_100px_170px_minmax(0,1.5fr)] items-center gap-3 border-b border-border-subtle px-2 py-2 text-caption font-semibold uppercase tracking-wide text-fg-subtle">
            <span>{{ $t('runs.columns.status') }}</span>
            <span>{{ $t('runs.columns.task') }}</span>
            <span>{{ $t('runs.columns.trigger') }}</span>
            <span>{{ $t('runs.columns.created') }}</span>
            <span>{{ $t('runs.columns.summary') }}</span>
          </div>
          <button
            v-for="run in runs.items"
            :key="run.id"
            type="button"
            class="grid w-full grid-cols-[130px_minmax(0,1.2fr)_100px_170px_minmax(0,1.5fr)] items-center gap-3 border-b border-border-subtle/60 px-2 text-left text-label transition-colors last:border-0 hover:bg-[var(--cd-color-hover)]"
            style="height: 40px"
            @click="openRun(run)"
          >
            <StatusBadge :status="run.status" kind="run" />
            <span class="truncate text-fg-muted">{{ taskTitle(run.taskId) }}</span>
            <span class="truncate text-fg-subtle">{{ run.trigger }}</span>
            <span class="truncate text-fg-subtle">{{ d(new Date(run.createdAt), 'long') }}</span>
            <span class="truncate text-fg-muted">{{ run.summary || run.error || '—' }}</span>
          </button>
        </div>
      </SectionCard>
    </div>
  </div>
</template>
```

保留现有 `taskTitle`、`openRun`、`d` 等函数；删除 `el-table`/`el-empty`/页内 header。引入 `SectionCard`、`Button`、`StatusBadge`、`EmptyState`、`RefreshCw`。

- [ ] **Step 2: RunDetailView**

1. 删除页内 `<header>`；标题栏操作放刷新按钮；页内顶部放返回链接与 Run ID/状态行。
2. loading 用 `Skeleton`；未找到用 `EmptyState` + `Button`。
3. 五张 `SectionCard`（运行详情 / 证据 / 评审 / 合并 / 事件），把现有各 `el-card` 内容整体搬入；`el-tag` → `Badge`；`el-empty` → `EmptyState`；DoD 状态：完整 `Badge tone="success"`，缺失 `Badge tone="warning"`。
4. artifact 芯片列表：

```vue
<button
  v-for="artifact in artifacts"
  :key="artifact.id"
  type="button"
  class="flex h-8 items-center gap-2 rounded-[var(--cd-radius-sm)] border px-2.5 text-caption transition-colors"
  :class="selectedArtifact?.id === artifact.id
    ? 'border-[var(--cd-color-accent)] bg-[var(--cd-color-accent-soft)] text-foreground'
    : 'border-[var(--cd-color-border-subtle)] text-fg-muted hover:border-[var(--cd-color-border-strong)]'"
  @click="selectArtifact(artifact)"
>
  <span class="font-mono text-fg-subtle">{{ artifact.type }}</span>
  <span class="truncate">{{ artifact.name }}</span>
</button>
```

5. 事件行使用 TaskView 同一套 32px 时间线样式；payload `<details>` 折叠。
6. 评审/合并按钮使用 `Button`（合并主按钮 `size="lg"`，危险动作 `variant="destructive"`）。

- [ ] **Step 3: 验证**

```bash
pnpm -r typecheck
```

预览：Runs 列表无 el-table、40px 行、整行可点；运行详情五张卡片、证据预览、评审与合并按钮可用；在 `light`/`graphite` 截图。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/RunsView.vue apps/web/src/views/RunDetailView.vue
git commit -m "style(web): restyle runs list and run detail" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: 设置页与主题选择器

**Files:**
- Modify: `apps/web/src/views/SettingsView.vue`
- Modify: `apps/web/src/i18n/locales/zh-CN.ts`、`en-US.ts`（主题名称/描述）

**Interfaces:**
- Consumes: `useThemeStore()`、`ThemeSwatch`、`SectionCard`、`Button`、`Input`、`Badge`、`#titlebar-actions`。
- Produces: 设置页锚点 `settings-appearance`（侧栏已引用）。

- [ ] **Step 1: 主题选择器**

模板顶部加入外观区：

```vue
<SectionCard id="settings-appearance" :title="$t('settings.appearance')" :description="$t('settings.appearanceHint')">
  <div class="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" :aria-label="$t('settings.theme')">
    <ThemeSwatch
      v-for="item in themeStore.themes"
      :key="item.id"
      :theme="item"
      :selected="themeStore.pref === item.id"
      @select="themeStore.setTheme(item.id)"
    />
  </div>
</SectionCard>
```

脚本补充：

```ts
import { useThemeStore } from '../stores/theme'
import { ThemeSwatch } from '../components/ThemeSwatch.vue'
const themeStore = useThemeStore()
```

- [ ] **Step 2: 分区卡片化**

把 SettingsView 的 5 张 `el-card` 全部替换为 `SectionCard`（`id` 保留），布局改为单列 `max-w-[880px] space-y-4`；语言切换保留 `el-radio-group`；健康检查按钮用 `Button`；模型目录表单用 `Input` + `Button`；错误文字 `text-danger`；成功 `Badge tone="success"`。

- [ ] **Step 3: 补 i18n**

`zh-CN.ts` 的 `settings` 下新增：

```ts
appearance: '外观',
appearanceHint: '选择界面主题。跟随系统会根据操作系统在浅色与深色之间切换。',
theme: {
  system: '跟随系统',
  systemDesc: '跟随操作系统的浅色 / 深色设置',
  light: '明亮',
  lightDesc: '中性浅灰，日落橙强调',
  dark: '深色',
  darkDesc: '中性深灰，日落橙强调',
  sunset: '日落橙',
  sunsetDesc: '暖奶油底与日落橙',
  cream: '奶油',
  creamDesc: '最轻盈的暖白主题',
  mist: '冷雾',
  mistDesc: '清爽的冷灰蓝',
  ink: '暖墨',
  inkDesc: '深咖啡与暖橙的深色主题',
  graphite: '石墨',
  graphiteDesc: '中性炭黑与靛蓝的技术深色',
},
```

`en-US.ts` 对应英文文案：

```ts
appearance: 'Appearance',
appearanceHint: 'Pick an interface theme. Follow system switches between light and dark with your OS.',
theme: {
  system: 'Follow system',
  systemDesc: 'Match the OS light / dark setting',
  light: 'Light',
  lightDesc: 'Neutral grey with sunset orange',
  dark: 'Dark',
  darkDesc: 'Neutral charcoal with sunset orange',
  sunset: 'Sunset',
  sunsetDesc: 'Warm cream with sunset orange',
  cream: 'Cream',
  creamDesc: 'The lightest warm-white theme',
  mist: 'Mist',
  mistDesc: 'Cool grey-blue, calm and clear',
  ink: 'Warm ink',
  inkDesc: 'Deep coffee with warm orange',
  graphite: 'Graphite',
  graphiteDesc: 'Neutral charcoal with indigo',
},
```

- [ ] **Step 4: 验证**

```bash
pnpm -r typecheck && pnpm --filter @ateam/web check:i18n && pnpm --filter @ateam/web build
```
Expected: 通过。

预览：设置页 6 个分区卡片；主题选择器 8 张卡，点击即时换肤并持久化；刷新后保持；`system` 在系统深/浅下解析正确；侧栏「外观」锚点可跳转。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/views/SettingsView.vue apps/web/src/i18n/locales/zh-CN.ts apps/web/src/i18n/locales/en-US.ts
git commit -m "feat(web): add appearance settings with theme picker" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: 全量验证与清理

**Files:**
- Modify: 任意需要修复的文件（仅限验证中发现的问题）

- [ ] **Step 1: 静态检查**

```bash
pnpm -r typecheck
pnpm --filter @ateam/web check:i18n
pnpm --filter @ateam/web build
```
Expected: 全部通过，无 TS 错误、i18n 扫描 0 命中、构建成功。

- [ ] **Step 2: 残留检查**

```bash
grep -rn "<el-card\|<el-table\|<el-descriptions\|<el-empty\|<el-skeleton\|<el-tag" apps/web/src/views apps/web/src/components || true
grep -rEn "#[0-9a-fA-F]{6}\b" apps/web/src/views apps/web/src/components | grep -v ThemeSwatch || true
```
Expected: 两条命令均无输出（`ThemeSwatch` 与 `tokens.css` 除外）。若有残留，替换为 SectionCard/自定义列表/EmptyState/令牌色。

- [ ] **Step 3: 视觉矩阵**

对 7 套主题逐一执行（`localStorage.setItem('ateam.theme', theme); location.reload()`），截图核对看板、任务详情、Agents、工作页、Runs、运行详情、设置；再对 `light` 与 `graphite` 全页面细查。检查项：卡片几何 8px/16px、32px 行、选中态、悬停态、焦点环、滚动条 hover、空态、对比度、无颜色回退。

- [ ] **Step 4: 功能回归**

按序走查并记录结果：
1. 新建任务 → 拖拽到「待办」→ 启动 mock Run → 事件流出现 → Run 详情打开。
2. 评审批准（DoD 缺失时填写例外理由）→ 合并按钮可用。
3. 创建/编辑/删除 Agent；模型连接测试返回耗时或错误。
4. 语言切换；主题切换后刷新持久化；系统主题变化实时跟随（预览中用 `preview_resize` 的 `colorScheme` 模拟）。
5. 侧栏收起/展开、刷新保持；标题栏拖动区仍在（`getComputedStyle(document.querySelector('.app-titlebar')).getPropertyValue('--wails-draggable')` 为 `drag`）。

- [ ] **Step 5: 清理与提交**

```bash
git status --short
git add -A apps/web
git commit -m "chore(web): final nomi ui verification and cleanup" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** 主题系统（Task 1–3、10）、外壳（Task 4）、共享组件（Task 5）、7 个页面（Task 6–10）、验证（Task 11）均有对应任务；spec 中「设置页分区」「事件时间线」「DoD 徽章」「artifact 芯片」「主题持久化」均落实。
- **Placeholder scan:** 无 TBD/TODO；页面任务给出模板骨架与精确类名，script 逻辑明确要求保留。
- **Type consistency:** `ThemeInfo`/`ThemePref`/`ThemeId`、`BadgeTone`、`useUiStore`、`SectionCard` props 在各任务中命名一致；`#titlebar-actions` 挂载点与 Teleport 使用一致。
