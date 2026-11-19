# Runtime 独立管理页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 新增独立的 `/runtimes` 管理页：检测运行时、维护模型目录、选择 runtime 默认模型、测试连接；Agent 创建/编辑只选择 runtime，运行时按默认模型解析。

**Architecture:** 后端为 `runtime_model_configs` 增加 `default_model`，API 的模型保存接口同时接收默认模型；调度器在 Agent 未固定模型时解析 runtime 默认模型，并写入 Run 配置快照。前端新增运行时 store 与页面，侧栏增加「运行时」入口，设置页移除模型目录，Agent 表单移除模型选择。

**Tech Stack:** Go + SQLite（modernc）、Vue 3 + Pinia + Element Plus + Tailwind 令牌体系。

**Spec:** `docs/superpowers/specs/2026-11-18-nomi-ui-alignment-design.md`（视觉体系）；本文件定义 runtime 管理需求。

## Global Constraints

- 迁移只允许新增列，不改旧数据；`default_model` 允许为空（空 = 由 runtime CLI 决定）。
- 旧 Agent 的非空 `model` 继续生效；只有空 `model` 才解析 runtime 默认模型。
- 新 API 字段向后兼容：`PUT /api/v1/runtimes/{name}/models` 的 `defaultModel` 可选。
- 不新增 npm/Go 依赖。
- 前端沿用现有令牌、SectionCard/Badge/Button/Field/Input 与 i18n 规则；中英文案同步。
- Go 验证使用 `GOPROXY=https://goproxy.cn,direct`；前端 `pnpm -r typecheck`、`check:i18n`、`build`。
- 提交信息末尾：`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。

---

### Task 1: 后端默认模型与调度解析

**Files:**
- Create: `internal/store/migrations/0006_runtime_default_models.sql`
- Modify: `internal/domain/domain.go`（RuntimeModelConfig）
- Modify: `internal/store/runtime_models.go`
- Modify: `internal/api/runtimes.go`
- Modify: `internal/scheduler/scheduler.go`
- Test: `internal/store/runtime_models_test.go`、`internal/api/runtimes_test.go`（如存在）、`internal/scheduler/scheduler_test.go`

**Interfaces:**
- `domain.RuntimeModelConfig` 增加 `DefaultModel string`
- `store.SetRuntimeModelConfig(ctx, name string, models []domain.RuntimeModel, defaultModel string) (*domain.RuntimeModelConfig, error)`
- `runtimeView` 增加 `DefaultModel string \`json:"defaultModel"\``
- `runtimeModelsInput` 增加 `DefaultModel string \`json:"defaultModel"\``
- scheduler 新增 `resolveRunModel(ctx, agent *domain.Agent) string`

- [ ] **Step 1: 迁移**

```sql
-- Runtime default model for the runtime management page.
ALTER TABLE runtime_model_configs ADD COLUMN default_model TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: domain + store**

`RuntimeModelConfig`:
```go
type RuntimeModelConfig struct {
    Runtime      string
    Models       []RuntimeModel
    DefaultModel string
    CreatedAt    time.Time
    UpdatedAt    time.Time
}
```
`Get` 查询增加 `default_model` 并 Scan；`Set` 签名增加 `defaultModel`，写入/更新该列。

- [ ] **Step 3: API**

`runtimeView` 增加 `DefaultModel`，从 `config.DefaultModel` 填充。
`runtimeModelsInput` 增加 `DefaultModel`；保存前校验：非空时必须在“探测模型 + 本次提交模型”的合并目录中，否则 400 `VALIDATION_FAILED`。保存时传 `defaultModel`。

- [ ] **Step 4: 调度解析**

在 `scheduler.execute` 读取 agent 后：
```go
model := strings.TrimSpace(agent.Model)
if model == "" {
    if cfg, cfgErr := s.store.GetRuntimeModelConfig(ctx, agent.Runtime); cfgErr == nil {
        model = strings.TrimSpace(cfg.DefaultModel)
    }
}
```
把 `model` 用于 `configJSON` 的 `"model"` 与 `runtime.Request.Model`。保持旧 agent 固定模型行为不变。
抽出 `resolveRunModel(ctx, agent)` 以便测试。

- [ ] **Step 5: 测试**

- store：默认模型 round-trip（空值、非空值、更新）。
- API：PUT `{models:[{id:"m1"}], defaultModel:"m1"}` 返回 `defaultModel:"m1"`；`defaultModel:"nope"` 返回 400。
- scheduler：agent.Model 为空时 `resolveRunModel` 返回配置默认；非空时返回 agent.Model；无配置返回空。

运行（项目根目录）：

```bash
GOPROXY=https://goproxy.cn,direct go test ./internal/store ./internal/api ./internal/scheduler
GOPROXY=https://goproxy.cn,direct go build ./...
```

- [ ] **Step 6: 提交**

```bash
git add internal/store/migrations/0006_runtime_default_models.sql internal/domain/domain.go internal/store/runtime_models.go internal/api/runtimes.go internal/scheduler/scheduler.go internal/store/runtime_models_test.go internal/api/runtimes_test.go internal/scheduler/scheduler_test.go
git commit -m "feat(runtime): add per-runtime default model resolution" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 运行时 store、页面与导航

**Files:**
- Create: `apps/web/src/stores/runtimes.ts`
- Create: `apps/web/src/views/RuntimesView.vue`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/components/AppSidebar.vue`
- Modify: `apps/web/src/components/AppTitleBar.vue`
- Modify: `packages/shared/src/index.ts`（RuntimeInfo.defaultModel）
- Modify: `apps/web/src/api/modules/runtimes.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN.ts`、`en-US.ts`

**Interfaces:**
- `useRuntimesStore()`：`items: RuntimeInfo[]`、`loading`、`error`、`fetchAll()`、`saveModels(name, models, defaultModel)`、`testModel(name, model)`。
- `RuntimeApi.updateModels(name, models, defaultModel?)`；`RuntimeInfo.defaultModel?: string`。

- [ ] **Step 1: 共享类型与 API 客户端**

`RuntimeInfo` 增加 `defaultModel?: string`。
`updateModels` 请求体 `{ models, defaultModel }`。

- [ ] **Step 2: runtimes store**

封装 `RuntimeApi.list/updateModels/testModel`，提供加载状态与错误。

- [ ] **Step 3: RuntimesView**

- 标题栏：刷新 Button teleport 到 `#titlebar-actions`。
- 每个 runtime 一张 SectionCard：名称、版本、installed/available/supported Badge、capabilities caption；`supported=false` 显示「暂不支持执行」Badge。
- 模型目录：探测模型（只读 Badge，标记 default）与本地模型（可删除）；每行可「测试连接」并显示耗时/错误；本地模型添加（id/label）与保存。
- 默认模型：单选列表（探测 + 本地模型 + 「不指定（由 Runtime 决定）」），保存时与模型目录一起提交。
- 空态/错误态用 EmptyState；所有文案走 i18n。

- [ ] **Step 4: 路由与导航**

- `router.ts` 增加 `{ path: '/runtimes', name: 'runtimes', component: RuntimesView }`。
- 侧栏导航增加「运行时」；`section` 支持 `runtimes`，面板显示 runtime 列表（名称 + 可用状态点），点击进入页面。
- `AppTitleBar` 的 `PAGE_TITLE_KEYS` 增加 `runtimes: 'runtimes.title'`。

- [ ] **Step 5: i18n**

新增 `sidebar.nav.runtimes` 与 `runtimes.*`（title/subtitle/version/capabilities/unsupported/models/defaultModel/defaultNone/test/testing/latency/addModel/save/saved/empty/error 等），中英同步。

- [ ] **Step 6: 验证**

```bash
pnpm -r typecheck && pnpm --filter @ateam/web check:i18n && pnpm --filter @ateam/web build
```
预览：`/runtimes` 显示本机 runtime（含未支持适配器的 CLI）、模型目录、默认模型保存后刷新保持；测试连接返回结果；7 套主题下样式正常。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/stores/runtimes.ts apps/web/src/views/RuntimesView.vue apps/web/src/router.ts apps/web/src/components/AppSidebar.vue apps/web/src/components/AppTitleBar.vue packages/shared/src/index.ts apps/web/src/api/modules/runtimes.ts apps/web/src/i18n/locales/zh-CN.ts apps/web/src/i18n/locales/en-US.ts
git commit -m "feat(web): add runtime management page" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Agent 表单简化与设置页清理

**Files:**
- Modify: `apps/web/src/views/AgentsView.vue`
- Modify: `apps/web/src/views/SettingsView.vue`
- Modify: `apps/web/src/components/AppSidebar.vue`

- [ ] **Step 1: Agent 表单**

移除模型下拉与模型校验提示；Agent 只选择 runtime。保留运行时/角色/权限/并发/超时/路径/命令等字段。`Agent.model` 不再由表单提交（编辑旧 Agent 时若已有 model，保留原值不动，除非运行时切换导致需要清空——切换 runtime 时把 model 置空，交给 runtime 默认模型）。卡片不再展示 model；如需展示，显示 runtime 名称。

- [ ] **Step 2: 设置页清理**

移除「运行时与模型」SectionCard 与 `settings-runtime-models` 锚点；侧栏设置分区同步移除该项。其余设置保留。

- [ ] **Step 3: 验证**

```bash
pnpm -r typecheck && pnpm --filter @ateam/web check:i18n && pnpm --filter @ateam/web build
```
预览：创建 Agent 只选 runtime；已有 Agent 编辑不丢其他字段；设置页无模型分区；侧栏锚点正常。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/views/AgentsView.vue apps/web/src/views/SettingsView.vue apps/web/src/components/AppSidebar.vue
git commit -m "feat(web): simplify agent runtime selection" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: 全量验证

- [ ] **Step 1:** `GOPROXY=https://goproxy.cn,direct go test ./...`（排除 desktop）与 `go build ./...`。
- [ ] **Step 2:** `pnpm -r typecheck`、`check:i18n`、`build`。
- [ ] **Step 3:** 预览功能回归：runtime 页面保存默认模型 → 新建 Agent 只选 runtime → 启动 mock run（`model` 为空时快照记录默认模型）→ 运行详情快照可见；旧 Agent 固定模型仍生效；设置页与侧栏无回归；7 套主题抽查。
- [ ] **Step 4:** 清理测试数据，提交任何修复。
