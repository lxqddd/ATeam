# ATeam Web UI 对齐 nomi-ai 最新样式 — 设计文档

| 项 | 内容 |
|---|---|
| 状态 | 已与用户确认（2026-11-18） |
| 范围 | `apps/web` 全部页面与外壳；不改后端、不改信息架构、不新增产品功能 |
| 参考 | [lxqddd/nomi-ai](https://github.com/lxqddd/nomi-ai) `main@8f1be8d`（2026-11-09，MIT） |
| 关键来源文件 | `packages/ui/src/tokens.css`、`packages/ui/src/styles/theme.css`、`packages/ai-chat/src/App.css`、`packages/ai-chat/src/components/Sidebar/index.module.css` |

## 1. 背景与目标

ATeam 现有主题对齐的是旧版 nomi（仅石墨深色，圆角 6/8/10/14/20，工作区为左上/右下 20px 浮卡）。nomi-ai 最新版已经演进为：

- **7 套调色板 + 跟随系统**：中性 `light` / `dark`、暖色 `sunset` / `cream` / `ink`、冷色 `mist`、技术感 `graphite`；
- **结构令牌变化**：圆角 4/6/8/12/16（+full）、控件高度 20–40、语义 soft/border 色；
- **Codex 式外壳**：导轨与标题栏在窗口底色上，侧栏面板（`bg`) 与工作区（`surface`）拼成一张 16px 圆角卡片，8px 外边距，无硬分割线；
- **紧凑列表**：32px 行高、浅色圆角选中底、无左侧强调条、可折叠分区标题、悬停才出现的滚动条。

本次目标：让 ATeam 的 Web UI 在**主题、布局、组件观感**上与 nomi-ai 最新样式一致，同时保留 ATeam 自身的信息架构与全部现有功能。

### 已确认的决策

1. **完整对齐 7 套主题 + 跟随系统**（比最初设想的 5 套多出中性 light/dark，用于「跟随系统」解析）；默认 `system`，持久化到 localStorage。
2. **全部页面逐页对齐**：看板、任务详情、Agents、Agent 工作页、Runs、运行详情、设置。
3. **结构与交互都对齐**：Codex 式卡片几何、可收起侧栏导轨、方块入口、紧凑行、分区标题、悬停滚动条、设置分区卡片。
4. **混合组件路径**：外壳与高频元素用 shadcn-vue + Tailwind + 令牌；复杂控件（Select/Dialog/Message/Tooltip）保留 Element Plus 并重主题。

### 非目标

- 不引入 nomi 的 `image` 背景主题、2D/3D 角色、对话/端点等产品专属结构。
- 不变更 ATeam 路由、导航项、看板列定义、任务/Agent 字段与 API。
- 不做 Wails 原生窗口按钮（红绿灯/自绘控制）适配；保留现有拖动区行为。
- 不新增单元/E2E 测试框架；沿用 typecheck + i18n 扫描 + build + 预览走查。

## 2. 主题系统

### 2.1 令牌文件结构

新增 `apps/web/src/styles/tokens.css`，按 nomi `tokens.css` 结构移植：

1. `:root` 结构令牌（与主题无关）：
   - 圆角：`--cd-radius-xs 4 / sm 6 / md 8 / lg 12 / xl 16 / full 9999`
   - 间距：`0-5 2 / 1 4 / 1-5 6 / 2 8 / 3 12 / 4 16 / 5 20 / 6 24 / 8 32`
   - 字体与排版阶梯：12/13/14/16/18/22，行高 18/20/22/24/26/30，字重 400/500/600；语义 `--cd-text-*` font 简写
   - 控件高度：2xs 20 / xs 24 / sm 28 / ms 32 / md 36 / lg 40
   - 动效、层级、面板别名（`--cd-panel-*`、`--cd-modal-bg`、`--cd-settings-card-bg` 等）
2. 主题调色板（全部 `--cd-color-*`）：
   - `:root, [data-theme='light']`：中性浅色（WorkBuddy 灰阶 + 日落橙强调）
   - `[data-theme='dark']`：中性深色（同上暖橙强调）
   - `[data-theme='sunset']`、`[data-theme='cream']`、`[data-theme='mist']`、`[data-theme='ink']`、`[data-theme='graphite']`
   - 每套都包含：bg/bg-subtle/surface(-raised/-sunken)/hover/active/selected、text/text-muted/text-subtle、border(-\*-strong)/focus、accent/-\*-hover/pressed/2/3/strong/soft、brand、success/warning/danger/info/neutral 及各自 soft/border、disabled、input、overlay、chart/viz、shadow-sm/md/lg/glow、focus-ring/input-ring、bubble 系列。
3. `[data-theme-pref]` 仅用于调试，不参与样式。

数值以 nomi 文件为准（其已按 WCAG AA 微调）。文件头保留来源注释：`Adapted from lxqddd/nomi-ai packages/ui/src/tokens.css (MIT)`。

### 2.2 主题运行时

新增 `apps/web/src/stores/theme.ts`（Pinia store，与 tasks/agents/runs 的 store 风格一致）：

- `ThemeId = 'light' | 'dark' | 'sunset' | 'cream' | 'mist' | 'ink' | 'graphite'`
- `ThemePref = ThemeId | 'system'`
- 默认 `system`；存储键 `ateam.theme`；非法值回退 `system`
- `resolveTheme(pref, prefersDark)`：`system` → `dark` / `light`；其余原样
- 应用：`document.documentElement.dataset.theme = resolved`；深色主题（dark/ink/graphite）同步 `classList.add('dark')`，浅色主题移除；更新 `<meta name="color-scheme">` 内容为 `dark` / `light`
- 监听 `matchMedia('(prefers-color-scheme: dark)')` 的 change，仅在 `pref === 'system'` 时重新解析
- 暴露 `useTheme()`：`pref`、`resolved`、`themes`（id/nameKey/descKey/swatch）、`setTheme(pref)`；`swatch` 取每套的 bg/surface/text/accent

**防闪烁**：`index.html` 移除 `class="dark"`；在 `<head>` 加入内联脚本（读 `ateam.theme` + `matchMedia`，写入 `data-theme`、`dark` 类、`color-scheme`），主 bundle 加载后由 store 接管。

### 2.3 Element Plus 主题层

重写 `apps/web/src/styles/element-theme.css`：

- 变量全部指向 `--cd-*`：`--el-color-primary` 及 light/dark 派生、success/warning/danger/info、bg/text/border/fill/input/mask、圆角、阴影、卡片背景
- 基础映射写在 `:root`（晚于 EP 样式引入，同特异性后写生效）；深色补充写在 `html.dark`
- 组件级样式保持现有覆盖范围（按钮、输入/选择/文本域、卡片、对话框、标签、表格），数值改用新令牌（控件高 28/36/40、圆角 md 8、阴影 sm/md、按压 `scale(.985)`）
- 浅色主题下不依赖 `html.dark` 的 EP 默认浅色变量，仅做轻量覆盖
- `_tokens.scss` 同步新颜色/圆角/字号，供 `<style lang="scss">` 使用

### 2.4 i18n

在 `zh-CN` / `en-US` 增加：

- `settings.appearance`、`settings.theme`、`settings.themeSystem` 与 7 套主题的名称/描述
- 侧栏收起/展开、方块入口、分区展开/收起、滚动区等新增可访问性文案
- 满足 `pnpm --filter @ateam/web check:i18n`

## 3. 外壳布局

### 3.1 根布局

- 背景：`--cd-panel-bg-subtle`（窗口底色）
- 44px 一体化标题栏：整行可拖动（保留 `.app-titlebar` 的 `--wails-draggable`）
  - 左：侧栏收起/展开按钮 + 当前页标题（任务/运行详情显示实体标题）
  - 右：页面级操作（由路由注入，例如看板「新建任务」、运行详情「刷新」）
- 主区域：侧栏（导轨 + 面板）+ 工作区卡片

### 3.2 卡片几何

- 侧栏面板（展开）：`width: 260px`、`margin: 8px 0`、`background: var(--cd-panel-bg)`、`border: 1px solid var(--cd-panel-border)`、`border-right: none`、左圆角 `--cd-radius-xl`
- 工作区：`margin: 8px 8px 8px 0`、`background: var(--cd-color-surface)`、`border: 1px solid var(--cd-panel-border)`、圆角 `--cd-radius-xl`、`box-shadow: var(--cd-shadow-sm)`、`overflow: hidden`
- 面板展开时工作区左角为 0（拼成一张卡）；收起时面板滑出，工作区恢复四角圆角并占满宽度
- 面板出现动画：0.18s，裁剪 + 负 margin 滑出；`prefers-reduced-motion` 时禁用

### 3.3 侧栏

**导轨（52px）**

- 4 个页面入口：36px 按钮、圆角 10、选中 `nav-bg` + 前景色、悬停 `nav-bg`
- 收起时在页面入口下方展示当前页面区块的前 8 个条目方块（任务页取任务、Agents 页取 Agent、Runs 页取 Run；设置页不展示）+ `+N`：
  - 方块 36×36，内含状态点与首字/图标；悬停或键盘聚焦弹出信息卡（标题、状态、时间/分支）
  - 点击进入对应任务/Agent/Run；`+N` 展开侧栏
- 收起按钮固定在标题栏；状态持久化 `ateam.sidebar.collapsed`

**面板（260px）**

- 顶部 44px 品牌行（ATeam 标志 + 名称 + tagline）
- 可折叠分区标题：caption 灰色文字 + `>` 旋转；点击收起整段
- 行：32px 高、`padding 0 10px`、圆角 10；默认 `text-fg-muted`；悬停 `nav-bg`；选中 `selected-bg` + 前景色；不再使用左侧强调条
- 分组：保持 ATeam 现有结构——面板只显示当前页面对应的一个列表（任务 / Agent / 运行 / 设置锚点），上方一个可折叠分区标题；不按状态二次分组
- 底部本地状态卡：surface-raised 底、圆角 8、状态点 + 「本地优先」+ 版本
- 滚动条贴面板右边缘，悬停才显示

### 3.4 全局交互细节

- 滚动条：默认 thumb 透明，容器 `:hover`/`:focus-within` 时显示；宽度 8、圆角 4
- 焦点：`:focus-visible` 统一 `outline: 2px solid var(--cd-color-accent-strong)`，offset 2（面板内 offset -2）
- 动效：`--cd-duration-fast 0.2s`、`--cd-ease`；按钮按压位移/缩放；尊重 reduced-motion
- 选择文本、输入框 ring、禁用态用令牌

## 4. 页面规格

所有页面统一：

- 页面标题与主操作进入标题栏（看板/Agents/Runs 等列表页）；详情页标题显示实体名称，页内保留返回按钮或面包屑
- 内容容器：`padding: 0 24px 24px`，最大宽度按现状；纵向滚动容器加悬停滚动条类
- 分区卡片：`background: surface`、`border: 1px solid border-subtle`、`radius-lg`、`padding 16px`；区块标题 `text-label font-semibold` + 可选右侧动作
- 列表行 32px（侧栏/时间线/证据），表格行 40px

### 4.1 看板 `BoardView`

- 标题栏：页面名 +「新建任务」主按钮
- 7 条泳道（backlog/todo/in_progress/in_review/blocked/done/cancelled）：宽 280、无边框、`surface-sunken` 底、圆角 12、内边距 8；列头 caption + 数量徽章 + 提示文字
- 任务卡：surface 底、subtle 边框、圆角 10、12px 内边距；标题 13px/500、描述 12px 2 行截断；底部状态点/优先级/标签；悬停 `border-strong` + `shadow-sm`；拖拽时强调色 2px 描边 + 轻微透明度
- 空列：轻量空态（图标 + 一句说明），不是大插画
- 新建任务弹窗：见 4.8 弹窗规范

### 4.2 任务详情 `TaskView`

- 标题栏：返回 + 任务 ID/状态 + 标题；右侧状态下拉（EP Select 主题化）
- 三栏网格（lg 起）：左「上下文/描述」、中「执行与依赖」、右「事件/产物」
- 各区块用 section card；元信息为 32px 定义行（label subtle / value muted）
- 启动 Run 主按钮；取消/重试次级按钮；依赖状态用徽章
- 事件时间线：12px 等宽、序号 + 类型徽章 + 消息，长文本换行

### 4.3 Agents `AgentsView`

- 标题栏：页面名 +「新建 Agent」
- 卡片网格（md 2 列 / xl 3 列）：surface 卡、subtle 边框、圆角 12；标题 16px/600、描述 caption；运行时/模型/并发/超时 caption 行；工作状态徽章右上
- 编辑/删除：卡片右上悬停显示图标按钮；删除仍二次确认
- 创建/编辑弹窗：宽 640，顶部标签表单；运行时/模型为 EP Select；允许路径/命令为标签输入；页脚右对齐「取消/保存」；连接测试结果内联在模型行下方

### 4.4 Agent 工作页 `AgentWorkView`

- 标题栏：返回 + Agent 名 + 工作状态徽章；副标题 runtime · model · 活跃数
- 两列 section card：当前工作（活跃 Run）、工作上下文（Task/分支/commit/权限模式/prompt hash）、最近工作列表（32px 行）、完成过程时间线
- 空态：无活跃 Run / 无历史 Run 分别给说明与下一步

### 4.5 Runs `RunsView`

- 标题栏：页面名 + 刷新
- 单张 section card 内的列表：表头 caption 吸顶；行 40px、悬停 `hover` 底、整行可点；列：状态点+文本、任务、触发、创建时间、摘要/错误
- 空态：说明 + 去创建任务

### 4.6 运行详情 `RunDetailView`

- 标题栏：返回 + Run ID/状态 + 任务标题（可点回任务）；右侧刷新
- 五张 section card：
  1. **运行详情**：分支/base/head（等宽）、时间、错误码、工作区状态与路径
  2. **证据**：DoD 徽章（完整 success / 缺失 warning）+ artifact 芯片列表 + 选中预览（代码块/文本/图片），预览区 sunken 底
  3. **评审**：当前评审状态、结论说明、批准/要求修改按钮、评论列表与新增评论
  4. **合并**：目标分支、策略（squash/merge）、确认勾选、合并按钮；已合并显示 merge record
  5. **事件**：等宽时间线，级别色点，payload 折叠
- 危险/警告动作沿用 danger/warning 令牌；确认流程不变

### 4.7 设置 `SettingsView`

- 标题栏：页面名
- 分区卡片纵向排列，锚点导航保留在侧栏：
  1. **外观**：主题选择器（跟随系统 + 7 套），卡片网格（2/3 列），每张卡为微型界面示意（背景/表面/文字/强调 4 色），选中显示 accent 2px 描边 + 勾选；点击即时生效并持久化
  2. **语言**：中/英切换（现有）
  3. **API 连接**：健康状态、版本
  4. **运行时与模型**：现有运行时列表 + 模型目录编辑（EP 表单主题化）
  5. **工作区**：仓库绑定信息（只读展示现有数据）
  6. **关于**：版本、许可证、仓库链接
- 主题卡片的名称/描述走 i18n；选中态 aria-checked

### 4.8 弹窗与反馈

- `Modal.vue`：遮罩 `overlay`、面板 `surface-raised` + `radius-xl` + `shadow-lg`；标题 18px/600；页脚右对齐按钮；关闭按钮 32px 图标按钮
- `el-dialog` 如仍使用，按同一规范覆盖
- `ElMessage`：成功/错误用语义色，圆角 8
- 空态组件 `EmptyState`：36px 圆形图标容器（surface-raised 底）+ 标题 14/600 + 说明 caption + 可选操作按钮

## 5. 组件与文件变更

### 5.1 新增

| 文件 | 说明 |
|---|---|
| `apps/web/src/styles/tokens.css` | 结构令牌 + 7 套主题调色板 |
| `apps/web/src/stores/theme.ts` | 主题偏好、系统跟随、持久化、启动应用 |
| `apps/web/src/components/ui/input/Input.vue` | 文本输入 |
| `apps/web/src/components/ui/textarea/Textarea.vue` | 多行输入 |
| `apps/web/src/components/ui/field/Field.vue` | 表单行（label + hint + error） |
| `apps/web/src/components/ui/badge/Badge.vue` | 语义徽章（soft/border 变体） |
| `apps/web/src/components/ui/skeleton/Skeleton.vue` | 骨架屏 |
| `apps/web/src/components/SectionCard.vue` | 分区卡片容器 |
| `apps/web/src/components/SectionHeader.vue` | 可折叠分区标题 |
| `apps/web/src/components/ThemeSwatch.vue` | 主题选择卡 |

### 5.2 重写/调整

- `index.html`：去硬编码 dark，内联主题引导脚本
- `main.ts`：引入 `tokens.css`（顺序：tokens → main.css → EP css → element-theme.css）
- `styles/main.css`：删除旧 `:root` 主题块，改为 `@theme inline` 映射新令牌；全局滚动条/焦点/动效
- `styles/_tokens.scss`、`styles/element-theme.css`：同步/重写
- `App.vue`、`AppTitleBar.vue`、`AppSidebar.vue`：新外壳与收起逻辑
- `TaskCard.vue`、`StatusBadge.vue`、`EmptyState.vue`、`Modal.vue`：新视觉
- 7 个视图：按第 4 节重排
- i18n：`zh-CN.ts` / `en-US.ts` 新增文案

### 5.3 组件边界

- **继续使用 Element Plus**：`el-select`/`el-option`、`el-dialog`（若有）、`el-message`、`el-tooltip`、`el-form` 校验（如保留）
- **替换为自定义**：`el-card` → SectionCard、`el-table` → 列表、`el-descriptions` → 定义行、`el-empty`/`el-skeleton` → EmptyState/Skeleton、`el-tag` → Badge/StatusBadge、`el-button` 高频处 → `components/ui/button`
- 新代码优先使用 `components/ui` + Tailwind；不得新增不必要的 `el-*` 依赖

## 6. 验证

### 6.1 自动检查

```bash
pnpm -r typecheck
pnpm --filter @ateam/web check:i18n
pnpm --filter @ateam/web build
```

Go 侧不改动，无需重跑测试；如 CI 触发则保持通过。

### 6.2 视觉走查矩阵

- 主题：`light / dark / sunset / cream / mist / ink / graphite`，外加 `system` 在深/浅系统下的解析
- 页面：看板、任务详情、Agents、Agent 工作页、Runs、运行详情、设置
- 必查：7 套主题 × 看板全量；`light` 与 `graphite` 各跑全部页面；其余主题抽查看板 + 任务详情 + 设置
- 检查项：卡片几何（8px/16px）、32px 行高、选中态、悬停态、焦点环、滚动条 hover、空态、对比度（文字可读）、无硬编码颜色残留

### 6.3 功能回归

- 新建/编辑/拖拽任务；启动 mock Run、取消 Run；打开运行详情
- 评审批准/要求修改、合并确认
- Agent 创建/编辑/删除、连接测试
- 语言切换、主题切换后刷新持久化、系统主题变化实时跟随
- 侧栏收起/展开及刷新后状态保持
- Wails 壳内标题栏仍可拖动（人工确认）

## 7. 风险与应对

| 风险 | 应对 |
|---|---|
| 主题切换闪屏 | `index.html` 内联脚本先写 `data-theme`/`dark`，store 挂载后接管 |
| EP 深色变量残留 | 浅色主题强制移除 `html.dark`；`element-theme.css` 基础映射放 `:root` |
| 浅色主题对比度 | 直接采用 nomi 已按 WCAG AA 调整的值；走查时抽查正文/按钮/徽章 |
| i18n 扫描失败 | 所有新增文案先入 locale 文件，再引用 key |
| 视觉回归范围大 | 按交付顺序分 5 步，每步以预览截图验收后再进入下一步 |
| 组件双轨混乱 | 明确边界（5.3），评审时检查是否新增了不必要的 `el-*` |
| Wails 拖动区丢失 | 标题栏保留 `.app-titlebar` 类与 `--wails-draggable` |

## 8. 交付顺序

1. 令牌 + 主题 store + EP 主题层 + 外壳（含收起与方块入口）
2. 看板 + 任务详情
3. Agents + Agent 工作页 + Runs + 运行详情
4. 设置页 + 主题选择器
5. 全量视觉与功能验证、i18n/typecheck/build、清理旧样式

每一步结束都运行 typecheck 并在预览中核对至少 `light` 与 `graphite` 两套主题。
