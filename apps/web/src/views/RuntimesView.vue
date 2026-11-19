<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { ChevronDownIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@lucide/vue'
import type { CLIHarnessInfo, RuntimeInfo, RuntimeModel, Workspace } from '@ateam/shared'
import { RuntimeApi, WorkspaceApi } from '../api'
import { useRuntimesStore } from '../stores/runtimes'
import EmptyState from '../components/EmptyState.vue'
import RuntimeLogo from '../components/RuntimeLogo.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Loader } from '../components/ai-elements/loader'

interface LocalModelDraft {
  id: string
  label: string
}

interface RuntimeDraft {
  locals: LocalModelDraft[]
  defaultModel: string
  error: string
}

interface TestState {
  status: 'testing' | 'success' | 'error'
  message: string
}

const { t } = useI18n()
const runtimes = useRuntimesStore()

const drafts = ref<Record<string, RuntimeDraft>>({})
const saving = ref<Record<string, boolean>>({})
const tests = ref<Record<string, TestState>>({})
const testEpochs = ref<Record<string, number>>({})
const expanded = ref<Record<string, boolean>>({})
const clis = ref<CLIHarnessInfo[]>([])
const clisLoading = ref(false)
const clisError = ref('')
const workspace = ref<Workspace | null>(null)
const accountDraft = ref<Record<string, string>>({})
const accountSaving = ref<Record<string, boolean>>({})
const accountError = ref<Record<string, string>>({})
const newAccountName = ref<Record<string, string>>({})
const accountCreating = ref<Record<string, boolean>>({})

function cliFor(runtimeId: string): CLIHarnessInfo | undefined {
  return clis.value.find((cli) => cli.id === runtimeId)
}

function selectedProfile(runtimeId: string) {
  const name = accountDraft.value[runtimeId]
  return cliFor(runtimeId)?.accountProfiles?.find((profile) => profile.name === name)
}

async function loadWorkspace() {
  try {
    const items = await WorkspaceApi.list()
    workspace.value = items.find((item) => item.id === 'default') ?? items[0] ?? null
    accountDraft.value = { ...(workspace.value?.settings.accountProfiles ?? {}) }
  } catch (error) {
    clisError.value = error instanceof Error ? error.message : String(error)
  }
}

async function saveAccount(runtimeId: string, value: string) {
  if (!workspace.value) {
    return
  }
  accountSaving.value = { ...accountSaving.value, [runtimeId]: true }
  accountError.value = { ...accountError.value, [runtimeId]: '' }
  try {
    const profiles = { ...(workspace.value.settings.accountProfiles ?? {}) }
    if (value) {
      profiles[runtimeId] = value
    } else {
      delete profiles[runtimeId]
    }
    const updated = await WorkspaceApi.update(workspace.value.id, {
      settings: { ...workspace.value.settings, accountProfiles: profiles },
    })
    workspace.value = updated
    accountDraft.value = { ...(updated.settings.accountProfiles ?? {}) }
  } catch (error) {
    accountError.value = {
      ...accountError.value,
      [runtimeId]: error instanceof Error ? error.message : String(error),
    }
  } finally {
    accountSaving.value = { ...accountSaving.value, [runtimeId]: false }
  }
}

async function createAccount(runtimeId: string) {
  const name = (newAccountName.value[runtimeId] ?? '').trim()
  if (!name || accountCreating.value[runtimeId]) {
    return
  }
  accountCreating.value = { ...accountCreating.value, [runtimeId]: true }
  accountError.value = { ...accountError.value, [runtimeId]: '' }
  try {
    await RuntimeApi.createCLIAccount(runtimeId, name)
    newAccountName.value = { ...newAccountName.value, [runtimeId]: '' }
    await loadCLIs()
    await saveAccount(runtimeId, name)
  } catch (error) {
    accountError.value = {
      ...accountError.value,
      [runtimeId]: error instanceof Error ? error.message : String(error),
    }
  } finally {
    accountCreating.value = { ...accountCreating.value, [runtimeId]: false }
  }
}

async function loadCLIs() {
  clisLoading.value = true
  clisError.value = ''
  try {
    clis.value = await RuntimeApi.cliHarnesses()
  } catch (error) {
    clisError.value = error instanceof Error ? error.message : String(error)
  } finally {
    clisLoading.value = false
  }
}

function panelId(runtimeName: string): string {
  return `runtime-panel-${runtimeName.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function isExpanded(runtime: RuntimeInfo): boolean {
  return expanded.value[runtime.name] ?? false
}

function togglePanel(runtime: RuntimeInfo) {
  expanded.value = { ...expanded.value, [runtime.name]: !isExpanded(runtime) }
}

function createDraft(runtime: RuntimeInfo): RuntimeDraft {
  return {
    locals: runtime.models
      .filter((model) => model.source === 'settings')
      .map((model) => ({ id: model.id, label: model.label || '' })),
    defaultModel: runtime.defaultModel || '',
    error: '',
  }
}

// Keep unsaved edits: existing drafts survive a refresh, new runtimes get a
// fresh draft, and drafts for runtimes that disappeared are dropped.
function syncDrafts(items: RuntimeInfo[]) {
  const next: Record<string, RuntimeDraft> = {}
  for (const runtime of items) {
    next[runtime.name] = drafts.value[runtime.name] ?? createDraft(runtime)
  }
  drafts.value = next
}

// Pure getter; drafts are materialized by the watcher before render.
function draftFor(runtime: RuntimeInfo): RuntimeDraft {
  return drafts.value[runtime.name] ?? createDraft(runtime)
}

watch(() => runtimes.items, syncDrafts, { immediate: true })

async function refresh() {
  await runtimes.fetchAll()
  if (runtimes.error) {
    return
  }
  // The catalog was just replaced; results from the previous one are stale.
  for (const runtime of runtimes.items) {
    clearTests(runtime.name)
  }
}

onMounted(() => {
  void refresh()
  void loadCLIs()
  void loadWorkspace()
})

const showError = computed(() => !runtimes.loading && !!runtimes.error && runtimes.items.length === 0)
const showEmpty = computed(() => !runtimes.loading && !runtimes.error && runtimes.items.length === 0)

function probeModels(runtime: RuntimeInfo): RuntimeModel[] {
  return runtime.models.filter((model) => model.source === 'runtime')
}

function catalogModels(runtime: RuntimeInfo): RuntimeModel[] {
  const probe = probeModels(runtime)
  const seen = new Set(probe.map((model) => model.id))
  const locals: RuntimeModel[] = []
  for (const model of draftFor(runtime).locals) {
    const id = model.id.trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    locals.push({
      id,
      label: model.label.trim() || undefined,
      source: 'settings',
      default: false,
      status: 'unverified',
    })
  }
  return [...probe, ...locals]
}

function capabilitiesLabel(runtime: RuntimeInfo): string {
  const enabled = Object.entries(runtime.capabilities ?? {})
    .filter(([, value]) => value)
    .map(([key]) => key)
  return enabled.length ? `${t('runtimes.capabilities')}: ${enabled.join(' · ')}` : ''
}

function isProbeDefault(runtime: RuntimeInfo, modelId: string): boolean {
  const id = modelId.trim()
  return !!id && runtime.models.some((model) => model.id === id && model.default)
}

function addLocalModel(runtime: RuntimeInfo) {
  draftFor(runtime).locals.push({ id: '', label: '' })
}

function hasAddableModels(runtime: RuntimeInfo): boolean {
  return modelIdOptions(runtime, draftFor(runtime).locals.length).length > 0
}

// Model IDs and display labels are chosen from the runtime's own catalog so
// a saved entry always matches a model the runtime can actually resolve.
function modelIdOptions(runtime: RuntimeInfo, index: number): RuntimeModel[] {
  const draft = draftFor(runtime)
  const used = new Set(
    draft.locals
      .filter((_, position) => position !== index)
      .map((model) => model.id.trim())
      .filter(Boolean),
  )
  const options: RuntimeModel[] = []
  const seen = new Set<string>()
  for (const model of runtime.models) {
    if (!model.id || used.has(model.id) || seen.has(model.id)) {
      continue
    }
    seen.add(model.id)
    options.push(model)
  }
  const current = draft.locals[index]?.id.trim()
  if (current && !seen.has(current)) {
    options.unshift({
      id: current,
      label: draft.locals[index].label.trim() || current,
      source: 'settings',
      default: false,
      status: 'unverified',
    })
  }
  return options
}

function modelLabelOptions(runtime: RuntimeInfo): string[] {
  const labels = new Set<string>()
  for (const model of runtime.models) {
    const label = (model.label || '').trim()
    if (label) {
      labels.add(label)
    }
  }
  return [...labels]
}

function onModelIdChange(runtime: RuntimeInfo, index: number, modelId: string) {
  const draft = draftFor(runtime)
  const model = runtime.models.find((candidate) => candidate.id === modelId)
  draft.locals[index].id = modelId
  if (model) {
    const label = (model.label || '').trim()
    draft.locals[index].label = label && label !== model.id ? label : ''
  }
  clearTests(runtime.name)
}

function removeLocalModel(runtime: RuntimeInfo, index: number) {
  const draft = draftFor(runtime)
  const [removed] = draft.locals.splice(index, 1)
  const id = removed?.id.trim()
  if (id && draft.defaultModel === id && !catalogModels(runtime).some((model) => model.id === id)) {
    draft.defaultModel = ''
  }
  clearTests(runtime.name)
}

function testKey(runtimeName: string, modelId: string): string {
  return `${runtimeName}::${modelId}`
}

function testState(runtimeName: string, modelId: string): TestState | undefined {
  return tests.value[testKey(runtimeName, modelId)]
}

function defaultModelHeadingId(runtimeName: string): string {
  return `default-model-${runtimeName.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

// Drop stale test results for one runtime; bumping its epoch also discards
// results from test requests that are still in flight.
function clearTests(runtimeName: string) {
  testEpochs.value = {
    ...testEpochs.value,
    [runtimeName]: (testEpochs.value[runtimeName] ?? 0) + 1,
  }
  const prefix = `${runtimeName}::`
  tests.value = Object.fromEntries(
    Object.entries(tests.value).filter(([key]) => !key.startsWith(prefix)),
  )
}

// Only models already in the saved/probe catalog can be tested; an unsaved
// local model id would always fail server-side validation.
function isTestableModel(runtime: RuntimeInfo, modelId: string): boolean {
  const id = modelId.trim()
  return !!id && runtime.models.some((model) => model.id === id)
}

async function testModel(runtime: RuntimeInfo, modelId: string) {
  const id = modelId.trim()
  if (!isTestableModel(runtime, id)) {
    return
  }
  const key = testKey(runtime.name, id)
  const epoch = testEpochs.value[runtime.name] ?? 0
  tests.value = { ...tests.value, [key]: { status: 'testing', message: '' } }
  try {
    const result = await runtimes.testModel(runtime.name, id)
    if ((testEpochs.value[runtime.name] ?? 0) !== epoch) {
      return
    }
    const next: TestState = result.ok
      ? {
          status: 'success',
          message: `${t('runtimes.testSuccess')} · ${t('runtimes.latency', { ms: result.latencyMs })}`,
        }
      : { status: 'error', message: result.error || t('runtimes.testFailed') }
    tests.value = { ...tests.value, [key]: next }
  } catch (err) {
    if ((testEpochs.value[runtime.name] ?? 0) !== epoch) {
      return
    }
    tests.value = {
      ...tests.value,
      [key]: { status: 'error', message: err instanceof Error ? err.message : String(err) },
    }
  }
}

async function save(runtime: RuntimeInfo) {
  // Re-entry guard: a fast double-click can fire before the disabled state
  // re-renders, which would send two PUTs.
  if (saving.value[runtime.name]) {
    return
  }
  const draft = draftFor(runtime)
  const models = draft.locals.map((model) => ({ id: model.id.trim(), label: model.label.trim() }))
  if (models.some((model) => !model.id)) {
    draft.error = t('runtimes.modelIdRequired')
    return
  }
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    draft.error = t('runtimes.modelIdDuplicate')
    return
  }
  const available = new Set(catalogModels(runtime).map((model) => model.id))
  if (draft.defaultModel && !available.has(draft.defaultModel)) {
    draft.error = t('runtimes.defaultInvalid')
    return
  }
  saving.value = { ...saving.value, [runtime.name]: true }
  try {
    const updated = await runtimes.saveModels(runtime.name, models, draft.defaultModel)
    drafts.value = { ...drafts.value, [runtime.name]: createDraft(updated) }
    clearTests(runtime.name)
    ElMessage.success(t('runtimes.saved'))
  } catch (err) {
    draft.error = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = { ...saving.value, [runtime.name]: false }
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="sm" variant="outline" :disabled="runtimes.loading" @click="refresh">
        <RefreshCwIcon class="size-4" />
        {{ $t('common.refresh') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <div class="mx-auto max-w-[880px] space-y-4">
        <p class="text-caption text-fg-subtle">{{ $t('runtimes.subtitle') }}</p>

        <div v-if="runtimes.loading && runtimes.items.length === 0" class="flex items-center gap-2 text-caption text-fg-subtle">
          <Loader :size="14" />
          {{ $t('runtimes.loading') }}
        </div>
        <EmptyState v-else-if="showError" :title="$t('runtimes.error')" :description="runtimes.error" />
        <EmptyState v-else-if="showEmpty" :title="$t('runtimes.empty')" :description="$t('runtimes.emptyDesc')" />

        <p v-if="runtimes.error && runtimes.items.length" class="text-caption text-danger">
          {{ runtimes.error }}
        </p>

        <section v-for="runtime in runtimes.items" :key="runtime.name" class="section-card runtime-panel">
          <h2 class="runtime-panel__heading">
            <button
              type="button"
              class="runtime-panel__trigger"
              :aria-expanded="isExpanded(runtime)"
              :aria-controls="panelId(runtime.name)"
              @click="togglePanel(runtime)"
            >
              <RuntimeLogo :name="runtime.name" />
              <span class="min-w-0 flex-1 text-left">
                <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span class="truncate text-subtitle font-semibold tracking-tight">{{ runtime.name }}</span>
                  <span class="flex flex-wrap items-center gap-1.5">
                    <Badge v-if="runtime.version">{{ $t('runtimes.version') }} {{ runtime.version }}</Badge>
                    <Badge v-if="runtime.installed" class="hidden sm:inline-flex" tone="success">
                      {{ $t('runtimes.installed') }}
                    </Badge>
                    <Badge v-else tone="neutral">{{ $t('runtimes.notInstalled') }}</Badge>
                    <Badge class="hidden md:inline-flex" :tone="runtime.available ? 'success' : 'warning'">
                      {{ runtime.available ? $t('runtimes.available') : $t('runtimes.unavailable') }}
                    </Badge>
                    <Badge :tone="runtime.supported ? 'info' : 'warning'">
                      {{ runtime.supported ? $t('runtimes.supported') : $t('runtimes.unsupported') }}
                    </Badge>
                  </span>
                </span>
                <span v-if="capabilitiesLabel(runtime)" class="mt-1 block truncate text-caption text-fg-subtle">
                  {{ capabilitiesLabel(runtime) }}
                </span>
              </span>
              <ChevronDownIcon
                class="runtime-panel__chevron size-4 shrink-0"
                :class="{ 'runtime-panel__chevron--open': isExpanded(runtime) }"
                aria-hidden="true"
              />
            </button>
          </h2>

          <div v-show="isExpanded(runtime)" :id="panelId(runtime.name)" class="section-card__body">
          <p v-if="runtime.detail" class="text-caption text-fg-subtle">{{ runtime.detail }}</p>

          <template v-if="!runtime.supported">
            <p class="text-caption text-fg-subtle">{{ $t('runtimes.unsupportedHint') }}</p>
            <p v-if="runtime.modelsError" class="text-caption text-fg-subtle opacity-70">
              {{ runtime.modelsError }}
            </p>
          </template>

          <div v-else class="flex flex-col gap-5">
            <section>
              <h3 class="text-label font-semibold">{{ $t('runtimes.models') }}</h3>
              <p v-if="runtime.modelsError" class="mt-1 text-caption text-fg-subtle">
                {{ runtime.modelsError }}
              </p>

              <div v-if="probeModels(runtime).length" class="mt-1">
                <div
                  v-for="model in probeModels(runtime)"
                  :key="model.id"
                  class="flex flex-wrap items-center gap-2 border-b border-border-subtle/60 py-1.5 last:border-0"
                >
                  <span class="text-label">{{ model.label || model.id }}</span>
                  <span v-if="model.label && model.label !== model.id" class="text-caption text-fg-subtle">
                    {{ model.id }}
                  </span>
                  <Badge tone="info">{{ $t('runtimes.probe') }}</Badge>
                  <Badge v-if="model.default" tone="brand">{{ $t('runtimes.default') }}</Badge>
                  <div class="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      :disabled="testState(runtime.name, model.id)?.status === 'testing'"
                      @click="testModel(runtime, model.id)"
                    >
                      <Loader v-if="testState(runtime.name, model.id)?.status === 'testing'" :size="12" />
                      {{
                        testState(runtime.name, model.id)?.status === 'testing'
                          ? $t('runtimes.testing')
                          : $t('runtimes.test')
                      }}
                    </Button>
                    <span
                      v-if="testState(runtime.name, model.id)"
                      class="text-caption"
                      :class="
                        testState(runtime.name, model.id)?.status === 'success' ? 'text-success' : 'text-danger'
                      "
                    >
                      {{ testState(runtime.name, model.id)?.message }}
                    </span>
                  </div>
                </div>
              </div>
              <p v-else-if="!catalogModels(runtime).length" class="mt-1 text-caption text-fg-subtle">
                {{ $t('runtimes.noProbeModels') }}
              </p>

              <h4 class="mt-4 text-caption font-semibold uppercase tracking-wide text-fg-subtle">
                {{ $t('runtimes.localModels') }}
              </h4>
              <div v-for="(model, index) in draftFor(runtime).locals" :key="`${runtime.name}-local-${index}`" class="mt-2">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center">
                  <el-select
                    :model-value="model.id"
                    filterable
                    :placeholder="$t('runtimes.modelIdPlaceholder')"
                    :aria-label="`${$t('runtimes.modelId')} ${index + 1}`"
                    style="width: 100%"
                    @update:model-value="(value: string) => onModelIdChange(runtime, index, value)"
                  >
                    <el-option
                      v-for="option in modelIdOptions(runtime, index)"
                      :key="option.id"
                      :label="option.label && option.label !== option.id ? `${option.label} · ${option.id}` : option.id"
                      :value="option.id"
                    />
                  </el-select>
                  <el-select
                    v-model="model.label"
                    filterable
                    :placeholder="$t('runtimes.modelLabelPlaceholder')"
                    :aria-label="`${$t('runtimes.modelLabel')} ${index + 1}`"
                    style="width: 100%"
                    @update:model-value="clearTests(runtime.name)"
                  >
                    <el-option :label="$t('runtimes.useModelId')" value="" />
                    <el-option
                      v-for="label in modelLabelOptions(runtime)"
                      :key="label"
                      :label="label"
                      :value="label"
                    />
                  </el-select>
                  <div class="flex items-center gap-2 sm:contents">
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      :title="$t('runtimes.remove')"
                      :aria-label="$t('runtimes.remove')"
                      @click="removeLocalModel(runtime, index)"
                    >
                      <Trash2Icon class="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      :disabled="
                        !isTestableModel(runtime, model.id) ||
                        testState(runtime.name, model.id.trim())?.status === 'testing'
                      "
                      :title="
                        model.id.trim() && !isTestableModel(runtime, model.id)
                          ? $t('runtimes.saveBeforeTest')
                          : undefined
                      "
                      @click="testModel(runtime, model.id)"
                    >
                      <Loader
                        v-if="testState(runtime.name, model.id.trim())?.status === 'testing'"
                        :size="12"
                      />
                      {{
                        testState(runtime.name, model.id.trim())?.status === 'testing'
                          ? $t('runtimes.testing')
                          : $t('runtimes.test')
                      }}
                    </Button>
                  </div>
                </div>
                <div
                  v-if="
                    isProbeDefault(runtime, model.id) ||
                    testState(runtime.name, model.id.trim()) ||
                    (model.id.trim() && !isTestableModel(runtime, model.id))
                  "
                  class="mt-1 flex flex-wrap items-center gap-2"
                >
                  <Badge v-if="isProbeDefault(runtime, model.id)" tone="brand">
                    {{ $t('runtimes.default') }}
                  </Badge>
                  <span
                    v-if="testState(runtime.name, model.id.trim())"
                    class="text-caption"
                    :class="
                      testState(runtime.name, model.id.trim())?.status === 'success' ? 'text-success' : 'text-danger'
                    "
                  >
                    {{ testState(runtime.name, model.id.trim())?.message }}
                  </span>
                  <span v-if="model.id.trim() && !isTestableModel(runtime, model.id)" class="text-caption text-fg-subtle">
                    {{ $t('runtimes.saveBeforeTest') }}
                  </span>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="!hasAddableModels(runtime)"
                  :title="hasAddableModels(runtime) ? undefined : $t('runtimes.noMoreModels')"
                  @click="addLocalModel(runtime)"
                >
                  <PlusIcon class="size-3.5" />
                  {{ $t('runtimes.addModel') }}
                </Button>
                <span v-if="!hasAddableModels(runtime)" class="text-caption text-fg-subtle">
                  {{ $t('runtimes.noMoreModels') }}
                </span>
              </div>
            </section>

            <section>
              <h3 :id="defaultModelHeadingId(runtime.name)" class="text-label font-semibold">
                {{ $t('runtimes.defaultModel') }}
              </h3>
              <el-radio-group
                v-model="draftFor(runtime).defaultModel"
                class="runtime-default-model mt-2 flex flex-col items-start gap-2"
                :aria-labelledby="defaultModelHeadingId(runtime.name)"
              >
                <el-radio value="">{{ $t('runtimes.defaultNone') }}</el-radio>
                <el-radio v-for="model in catalogModels(runtime)" :key="model.id" :value="model.id">
                  {{ model.label || model.id }}
                  <span v-if="model.label && model.label !== model.id" class="ml-2 text-caption text-fg-subtle">
                    {{ model.id }}
                  </span>
                </el-radio>
              </el-radio-group>
            </section>

            <section v-if="cliFor(runtime.name)">
              <h3 class="text-label font-semibold">{{ $t('runtimes.accountTitle') }}</h3>
              <p class="mt-1 text-caption text-fg-subtle">{{ $t('runtimes.accountHint') }}</p>
              <el-select
                :model-value="accountDraft[runtime.name] || ''"
                :aria-label="$t('runtimes.accountTitle')"
                style="width: 100%"
                :disabled="accountSaving[runtime.name]"
                @update:model-value="(value: string) => saveAccount(runtime.name, value)"
              >
                <el-option :label="$t('runtimes.accountDefault')" value="" />
                <el-option
                  v-for="profile in cliFor(runtime.name)?.accountProfiles || []"
                  :key="profile.name"
                  :label="profile.name"
                  :value="profile.name"
                />
              </el-select>
              <p v-if="selectedProfile(runtime.name)" class="mt-2 text-caption text-fg-subtle">
                {{ $t('runtimes.accountLoginHint') }}:
                <code class="font-mono">{{ selectedProfile(runtime.name)?.loginCommand }}</code>
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  v-model="newAccountName[runtime.name]"
                  :placeholder="$t('runtimes.accountNamePlaceholder')"
                  class="max-w-[220px]"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="accountCreating[runtime.name] || !newAccountName[runtime.name]?.trim()"
                  @click="createAccount(runtime.name)"
                >
                  <Loader v-if="accountCreating[runtime.name]" :size="14" />
                  {{ $t('runtimes.accountCreate') }}
                </Button>
                <span v-if="accountError[runtime.name]" class="text-caption text-danger">
                  {{ accountError[runtime.name] }}
                </span>
              </div>
            </section>

            <div class="flex flex-wrap items-center gap-3">
              <Button :disabled="saving[runtime.name]" @click="save(runtime)">
                <Loader v-if="saving[runtime.name]" :size="14" />
                {{ $t('runtimes.save') }}
              </Button>
              <span v-if="draftFor(runtime).error" class="text-caption text-danger">
                {{ draftFor(runtime).error }}
              </span>
            </div>
          </div>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card__body flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-subtitle font-semibold tracking-tight">{{ $t('runtimes.cliEnvTitle') }}</h2>
              <Button variant="ghost" size="sm" :disabled="clisLoading" @click="loadCLIs">
                <RefreshCwIcon class="size-3.5" />
                {{ $t('common.refresh') }}
              </Button>
            </div>
            <p class="text-caption text-fg-subtle">{{ $t('runtimes.cliEnvHint') }}</p>
            <p v-if="clisError" class="text-caption text-danger">{{ clisError }}</p>
            <div v-for="cli in clis" :key="cli.id" class="flex items-start gap-3 border-t border-border-subtle pt-3">
              <RuntimeLogo :name="cli.id" />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-label font-semibold">{{ cli.displayName }}</span>
                  <Badge :tone="cli.installed ? 'success' : 'neutral'">
                    {{ cli.installed ? $t('runtimes.installed') : $t('runtimes.notInstalled') }}
                  </Badge>
                  <Badge v-if="cli.version" tone="neutral">{{ cli.version }}</Badge>
                  <Badge :tone="cli.supported ? 'info' : 'warning'">
                    {{ cli.supported ? $t('runtimes.supported') : $t('runtimes.unsupported') }}
                  </Badge>
                  <Badge :tone="cli.authPresent || cli.configPresent ? 'success' : 'neutral'">
                    {{ cli.authPresent || cli.configPresent ? $t('runtimes.authPresent') : $t('runtimes.authMissing') }}
                  </Badge>
                  <Badge v-if="cli.loginChecked" :tone="cli.loggedIn ? 'success' : 'neutral'">
                    {{ cli.loggedIn ? $t('runtimes.loggedIn') : $t('runtimes.loggedOut') }}
                  </Badge>
                  <Badge v-else tone="neutral">{{ $t('runtimes.loginUnknown') }}</Badge>
                </div>
                <p v-if="cli.path" class="mt-1 truncate font-mono text-caption text-fg-subtle">{{ cli.path }}</p>
                <p v-if="cli.configPath" class="mt-1 truncate text-caption text-fg-subtle">
                  {{ $t('runtimes.configPath') }}: <span class="font-mono">{{ cli.configPath }}</span>
                </p>
                <p v-if="cli.providers?.length" class="mt-1 truncate text-caption text-fg-subtle">
                  {{ $t('runtimes.providers') }}: <span class="font-mono">{{ cli.providers.join(' · ') }}</span>
                </p>
                <p v-if="cli.loginChecked && !cli.loggedIn && cli.loginCommand" class="mt-1 text-caption text-fg-muted">
                  {{ $t('runtimes.loginCommand') }}:
                  <code class="font-mono">{{ cli.loginCommand }}</code>
                </p>
                <p v-if="!cli.installed && cli.installCommand" class="mt-1 text-caption text-fg-muted">
                  {{ $t('runtimes.installCommand') }}:
                  <code class="font-mono">{{ cli.installCommand }}</code>
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.runtime-panel__heading {
  margin: 0;
  font: inherit;
}

.runtime-panel__trigger {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--cd-space-3);
  padding: var(--cd-space-3) var(--cd-space-4);
  color: inherit;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.runtime-panel__trigger:hover {
  background: color-mix(in srgb, var(--cd-color-surface-raised) 55%, transparent);
}

.runtime-panel__trigger:focus-visible {
  outline: 2px solid var(--cd-color-accent);
  outline-offset: -2px;
}

.runtime-panel__chevron {
  color: var(--cd-color-text-subtle);
  transition: transform 150ms ease;
}

.runtime-panel__chevron--open {
  transform: rotate(180deg);
}

.runtime-default-model :deep(.el-radio) {
  height: auto;
  margin-right: 0;
  align-items: flex-start;
  white-space: normal;
}

.runtime-default-model :deep(.el-radio__label) {
  white-space: normal;
  word-break: break-all;
}

@media (prefers-reduced-motion: reduce) {
  .runtime-panel__chevron {
    transition: none;
  }
}
</style>
