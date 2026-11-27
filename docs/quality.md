# 质量基线

本页说明四类质量基线（覆盖率、打包体积、可访问性、视觉回归）的检查内容、本地运行方式与更新流程。CI 在 `.github/workflows/ci.yml` 的 `checks` 任务中依次执行 typecheck、lint、format、test、coverage、build、bundle:check、SDK 打包检查与 headless 冒烟测试。

## 1. 单元测试与覆盖率

```bash
pnpm test                 # 全部包
pnpm run test:coverage    # 带覆盖率；低于阈值时命令以非零状态退出
pnpm --filter @ateam/desktop test   # 单包
```

覆盖率使用 Vitest 的 v8 provider。各包只统计约定的生产文件（见各自的 `vitest.config`），测试文件不计入。阈值是**全局百分比**：

| 包                    | statements | branches | functions | lines |
| --------------------- | ---------- | -------- | --------- | ----- |
| `packages/client-sdk` | 80         | 80       | 62        | 80    |
| `packages/agent-core` | 82         | 74       | 80        | 87    |
| `apps/headless`       | 70         | 65       | 72        | 73    |
| `apps/desktop`        | 85         | 79       | 83        | 87    |

阈值略低于当前实测值，留出小幅波动的空间：

- client-sdk：83.3 / 84.9 / 65.5 / 84.7
- agent-core：85.4 / 77.9 / 83.3 / 90.0
- headless：73.7 / 68.2 / 75.3 / 76.9
- desktop：88.2 / 82.8 / 86.7 / 90.6

维护约定：阈值只随测试补充上调；确需下调时在 PR 描述中说明原因。新增被覆盖的生产文件时，同步检查 `coverage.include`，避免新文件默认落在统计之外。

## 2. 渲染进程打包体积

```bash
pnpm --filter @ateam/desktop build
pnpm --filter @ateam/desktop bundle:report                 # 人读报告
pnpm --filter @ateam/desktop bundle:check                  # 超出预算时失败
pnpm --filter @ateam/desktop bundle:report -- --write-baseline  # 更新基线
```

`apps/desktop/scripts/bundle-report.mjs` 从 `out/renderer/index.html` 读取入口脚本和 `modulepreload`，按 gzip（level 9）统计三类预算：

| 预算                                                  | 容差 | 说明                          |
| ----------------------------------------------------- | ---- | ----------------------------- |
| 首屏 JS（入口 + modulepreload）                       | 2%   | 打开聊天页首帧必须加载的 JS   |
| 按需 JS 总量                                          | 5%   | 全部路由 chunk 与懒加载面板   |
| 关键路由 chunk：ModelsPage / SettingsPage / UsagePage | 5%   | 只匹配 chunk 名，忽略构建哈希 |

基线保存在 `apps/desktop/scripts/bundle-baseline.json`，`history` 保留最近 10 次快照。拆分或重命名关键路由 chunk 会让检查失败，此时应确认体积变化合理后用 `--write-baseline` 有意更新基线，并在 PR 中记录前后数值。

## 3. 可访问性

```bash
pnpm --filter @ateam/desktop test src/renderer/src/pages/a11y.test.tsx
```

`src/renderer/src/pages/a11y.test.tsx` 用 `axe-core` 渲染并检查聊天、模型、用量、设置四个页面，只保留 **serious / critical** 级别的违规作为阻断项；另有自检用例保证检查器本身不会空跑通过。`color-contrast` 一类依赖布局与画布的规则在 jsdom 中不可用，已禁用，对比度需要靠视觉走查覆盖。

新增页面时，在同一文件的 `PAGES` 中加入路由与“页面就绪”定位器（例如唯一的标题或 region），否则新页面不会被检查。

## 4. 截图回归

```bash
pnpm --filter @ateam/desktop exec playwright install chromium   # 首次
pnpm --filter @ateam/desktop visual:test                        # 与实际截图比对
pnpm --filter @ateam/desktop visual:update                      # 有意更新基线
pnpm --filter @ateam/desktop visual:serve   # 手动打开 harness 调样式
```

- Harness 根目录为 `apps/desktop/visual`，复用渲染进程的 `routes`、i18n、AntdProvider 与 `src/renderer/src/test/api-mock.ts`；固定一个 provider/model fixture、light 主题、`en-US`、1280×800、DPR 1、UTC，禁用动画与滚动条。
- 基线位于 `visual/pages.spec.ts-snapshots/<page>-<platform>.png`。Playwright 默认按平台命名；**不要跨平台复制基线**，字体与抗锯齿差异会造成误报。目前仓库提交了 darwin 基线，Linux/Windows 需在本机先执行 `visual:update` 生成对应平台基线。
- 视觉测试不进入 CI：GitHub 的 Linux runner 缺少与 darwin 基线一致的字体渲染。改动界面后至少在本机跑一次 `visual:test`；更新基线时在 PR 中附上截图差异说明。
- 页面必须有可等待的“就绪”元素（`pages.spec.ts` 中的 `ready`），数据来自固定 mock，避免时间、随机数与真实网络进入截图。

## 5. 提交前检查

与 CI 保持一致：

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm run test:coverage
pnpm --filter @ateam/desktop bundle:check
```

涉及界面的改动再补 `pnpm --filter @ateam/desktop visual:test`。
