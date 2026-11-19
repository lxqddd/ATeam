<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { PlusIcon, RefreshCwIcon, Trash2Icon } from '@lucide/vue'
import type { RuntimeInfo, RuntimeModel } from '@ateam/shared'
import { useRuntimesStore } from '../stores/runtimes'
import SectionCard from '../components/SectionCard.vue'
import EmptyState from '../components/EmptyState.vue'
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
}

onMounted(() => {
  void refresh()
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

function runtimeHeadingId(runtimeName: string): string {
  return `runtime-heading-${runtimeName.replace(/[^A-Za-z0-9_-]/g, '-')}`
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

        <SectionCard
          v-for="runtime in runtimes.items"
          :key="runtime.name"
          :title="runtime.name"
          :description="capabilitiesLabel(runtime)"
        >
          <template #actions>
            <Badge v-if="runtime.version">{{ $t('runtimes.version') }} {{ runtime.version }}</Badge>
            <Badge :tone="runtime.installed ? 'success' : 'neutral'">
              {{ runtime.installed ? $t('runtimes.installed') : $t('runtimes.notInstalled') }}
            </Badge>
            <Badge :tone="runtime.available ? 'success' : 'warning'">
              {{ runtime.available ? $t('runtimes.available') : $t('runtimes.unavailable') }}
            </Badge>
            <Badge :tone="runtime.supported ? 'info' : 'warning'">
              {{ runtime.supported ? $t('runtimes.supported') : $t('runtimes.unsupported') }}
            </Badge>
          </template>

          <h2 :id="runtimeHeadingId(runtime.name)" class="sr-only">{{ runtime.name }}</h2>
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
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
                  <Input
                    v-model="model.id"
                    :placeholder="$t('runtimes.modelId')"
                    :aria-label="`${$t('runtimes.modelId')} ${index + 1}`"
                    @input="clearTests(runtime.name)"
                  />
                  <Input
                    v-model="model.label"
                    :placeholder="$t('runtimes.modelLabel')"
                    :aria-label="`${$t('runtimes.modelLabel')} ${index + 1}`"
                    @input="clearTests(runtime.name)"
                  />
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
                <Button variant="ghost" size="sm" @click="addLocalModel(runtime)">
                  <PlusIcon class="size-3.5" />
                  {{ $t('runtimes.addModel') }}
                </Button>
              </div>
            </section>

            <section>
              <h3 class="text-label font-semibold">{{ $t('runtimes.defaultModel') }}</h3>
              <el-radio-group
                v-model="draftFor(runtime).defaultModel"
                class="mt-2 flex flex-col items-start gap-2"
                :aria-labelledby="runtimeHeadingId(runtime.name)"
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
        </SectionCard>
      </div>
    </div>
  </div>
</template>
