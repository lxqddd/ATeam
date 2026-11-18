# ATeam Web 中英双语支持 — 设计文档

- 日期：2026-11-18
- 状态：已确认（用户批准）
- 对齐 PRD：`prd/modules/non-functional-requirements.md` §6.6（NFR-I18N-001~009、011）
- 范围决策：全量改造前端；后端错误码本地化（NFR-I18N-004）后置，不在本期

## 1. 目标

ATeam Web 界面支持简体中文（zh-CN）与英文（en-US）双语：所有用户可见产品文案来自资源文件，可在设置中即时切换并持久化，默认跟随系统语言。产品内容（用户输入、日志、模型输出）保持原文，不翻译（NFR-I18N-011）。

## 2. 架构

### 2.1 依赖与实例

- 依赖：`vue-i18n@11`（Composition API 模式，`legacy: false`）。
- 新增 `apps/web/src/i18n/index.ts`：`createI18n` 实例，`fallbackLocale: 'en-US'`；缺失键回退到 en-US 并输出控制台告警（NFR-I18N-002）。
- 新增 `apps/web/src/i18n/locales/en-US.ts` 与 `zh-CN.ts`：TypeScript 类型化消息对象，两个文件互为同构类型（`typeof enUS` 约束 zh 文件），漏键/错键在编译期报错。
- 在 `main.ts` 中 `app.use(i18n)`。

### 2.2 语言解析顺序（NFR-I18N-003）

1. `localStorage['ateam.locale']`（用户显式选择，优先级最高）；
2. 系统语言：`navigator.language` 以 `zh` 开头 → `zh-CN`；
3. 兜底 `en-US`。

### 2.3 切换与生效（NFR-I18N-002）

`SettingsView` 新增 LANGUAGE 卡片，提供「简体中文 / English」两选项。切换时联动：

1. `i18n.global.locale.value` → 所有视图与组件文案即时刷新，无需重启；
2. `document.documentElement.lang` → `zh-CN` 或 `en`；
3. Element Plus 内置文案（分页、空状态、消息框等）：`App.vue` 顶层以 `<el-config-provider :locale>` 绑定响应式 locale（`element-plus/es/locale/lang/zh-cn` / `en`）。

持久化写入 `localStorage['ateam.locale']`；刷新后保持。

### 2.4 HTML lang 修正

`index.html` 的静态 `lang="zh-CN"` 与英文界面不符。静态默认改为 `en`（PRD `ui-ux.md` 的 M1 要求），应用启动后由 JS 按 2.2 的解析结果动态更新。

## 3. 翻译覆盖（全量当前 UI）

| 范围 | 内容 |
|---|---|
| 5 个视图 | `BoardView` / `TaskView` / `RunsView` / `AgentsView` / `SettingsView` 全部文案 |
| 共享组件 | `AppSidebar`、`Modal`、`EmptyState`、`StatusBadge`、`TaskCard`、`ai-elements/*`（复制按钮、加载文案等） |
| 键组织 | 按模块命名：`board.*`、`task.*`、`runs.*`、`agents.*`、`settings.*`，跨视图共享文案放 `common.*`（保存/取消/删除/状态标签等） |
| 不翻译 | 品牌名 ATeam、API 错误原文、用户内容、日志、模型输出 |

## 4. 格式化（NFR-I18N-006 / 008）

- `RunsView` 与 `TaskView` 中两处 `new Date(...).toLocaleString()` 改为 vue-i18n 的 `d()`（跟随应用语言而非运行时默认 locale）。
- 当前 UI 无复数与数字格式化诉求；vue-i18n 的 `t()` 复数语法与 `n()` 直接可用，后续新页面按 PRD 使用，不在本期单独引入。

## 5. 硬编码防护（NFR-I18N-001）

仓库尚无 ESLint，引入完整 lint 插件属于范围膨胀。本期采用轻量扫描：

- 新增 `apps/web/scripts/check-i18n.mjs`：扫描 `.vue` 模板中未被 `{{ }}` 包裹的裸文本节点，以及 `title` / `placeholder` / `label` 等常见文案属性中的字面量；发现疑似硬编码文案时以非零退出码报告。
- 接入方式：在 `apps/web/package.json` 增加 `check:i18n` 脚本；待仓库引入 ESLint 后以 `eslint-plugin-vue-i18n` 替换。

## 6. 验证方式

- `pnpm --filter @ateam/web typecheck`：locale 文件类型互检，漏键编译期报错；
- `pnpm --filter @ateam/web build` 通过；
- 手动验证：切换语言后所有视图、Element Plus 组件文案、时间格式即时变化；`document.documentElement.lang` 同步；刷新后保持；英文态下检查按钮/标签无溢出（NFR-I18N-009 的 40% 长度余量由现有布局弹性承担）；
- 单元测试（切换逻辑、缺失键告警）待仓库引入 vitest 后补齐，本期不搭测试基建。

## 7. 代价与后续优化

- bundle 约增加 25KB gzip（vue-i18n 含运行时消息编译器），远低于 NFR-RES-005 的 Web 资源 5MB gzip 预算；
- 后续可选 `unplugin-vue-i18n` 预编译优化，本期不做；
- 后端错误码本地化（NFR-I18N-004）依赖 API 契约变更，留待 M1 后端工作推进时另行设计。
