<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { GatewayProvider, GatewayStatus, Health, RuntimeInfo, Workspace } from '@ateam/shared'
import { GatewayApi, HealthApi, RuntimeApi, WorkspaceApi } from '../api'
import { setAppLocale, type AppLocale } from '../i18n'
import { useThemeStore } from '../stores/theme'
import SectionCard from '../components/SectionCard.vue'
import ThemeSwatch from '../components/ThemeSwatch.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Loader } from '../components/ai-elements/loader'

interface ModelDraft {
  id: string
  label: string
}

const { t, locale } = useI18n()
const themeStore = useThemeStore()
const health = ref<Health | null>(null)
const error = ref('')
const runtimes = ref<RuntimeInfo[]>([])
const modelDrafts = ref<Record<string, ModelDraft[]>>({})
const modelErrors = ref<Record<string, string>>({})
const savingRuntime = ref('')
const supportedRuntimes = computed(() => runtimes.value.filter((runtime) => runtime.supported))
const workspace = ref<Workspace | null>(null)
const sandboxMode = ref<'none' | 'seatbelt'>('none')
const allowSandboxFallback = ref(false)
const useGateway = ref(false)
const sandboxSaving = ref(false)
const sandboxError = ref('')
const gateway = ref<GatewayStatus | null>(null)
const gatewayProviders = ref<GatewayProvider[]>([])
const gatewayError = ref('')
const gatewayBusy = ref(false)
const providerDraft = reactive({ name: '', baseUrl: '', apiKey: '', model: '', default: true })

async function loadGateway() {
  try {
    gateway.value = await GatewayApi.status()
    gatewayProviders.value = await GatewayApi.list()
  } catch (err) {
    gatewayError.value = err instanceof Error ? err.message : String(err)
  }
}

async function saveGatewayToggle() {
  if (!workspace.value) {
    return
  }
  gatewayBusy.value = true
  gatewayError.value = ''
  try {
    const updated = await WorkspaceApi.update(workspace.value.id, {
      settings: { ...workspace.value.settings, useGateway: useGateway.value },
    })
    workspace.value = updated
  } catch (err) {
    gatewayError.value = err instanceof Error ? err.message : String(err)
  } finally {
    gatewayBusy.value = false
  }
}

async function addGatewayProvider() {
  if (!providerDraft.name.trim() || !providerDraft.baseUrl.trim()) {
    return
  }
  gatewayBusy.value = true
  gatewayError.value = ''
  try {
    await GatewayApi.create({
      name: providerDraft.name.trim(),
      baseUrl: providerDraft.baseUrl.trim(),
      apiKey: providerDraft.apiKey.trim() || undefined,
      model: providerDraft.model.trim() || undefined,
      default: providerDraft.default,
    })
    providerDraft.name = ''
    providerDraft.baseUrl = ''
    providerDraft.apiKey = ''
    providerDraft.model = ''
    providerDraft.default = gatewayProviders.value.length === 0
    await loadGateway()
    ElMessage.success(t('settings.gateway.saved'))
  } catch (err) {
    gatewayError.value = err instanceof Error ? err.message : String(err)
  } finally {
    gatewayBusy.value = false
  }
}

async function setDefaultProvider(provider: GatewayProvider) {
  gatewayBusy.value = true
  gatewayError.value = ''
  try {
    await GatewayApi.update(provider.id, {
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model || undefined,
      default: true,
    })
    await loadGateway()
  } catch (err) {
    gatewayError.value = err instanceof Error ? err.message : String(err)
  } finally {
    gatewayBusy.value = false
  }
}

async function removeGatewayProvider(provider: GatewayProvider) {
  gatewayBusy.value = true
  gatewayError.value = ''
  try {
    await GatewayApi.remove(provider.id)
    await loadGateway()
  } catch (err) {
    gatewayError.value = err instanceof Error ? err.message : String(err)
  } finally {
    gatewayBusy.value = false
  }
}

async function rotateGatewayToken() {
  gatewayBusy.value = true
  gatewayError.value = ''
  try {
    await GatewayApi.rotateToken()
    await loadGateway()
    ElMessage.success(t('settings.gateway.tokenRotated'))
  } catch (err) {
    gatewayError.value = err instanceof Error ? err.message : String(err)
  } finally {
    gatewayBusy.value = false
  }
}

async function copyGatewayValue(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(t('settings.gateway.copied'))
  } catch {
    gatewayError.value = t('settings.gateway.copyFailed')
  }
}

async function loadWorkspace() {
  try {
    const items = await WorkspaceApi.list()
    const current = items.find((item) => item.id === 'default') ?? items[0]
    if (!current) {
      return
    }
    workspace.value = current
    sandboxMode.value = current.settings.sandboxMode === 'seatbelt' ? 'seatbelt' : 'none'
    allowSandboxFallback.value = current.settings.allowSandboxFallback === true
    useGateway.value = current.settings.useGateway === true
  } catch (err) {
    sandboxError.value = err instanceof Error ? err.message : String(err)
  }
}

async function saveSandbox() {
  if (!workspace.value) {
    return
  }
  sandboxSaving.value = true
  sandboxError.value = ''
  try {
    const updated = await WorkspaceApi.update(workspace.value.id, {
      settings: {
        ...workspace.value.settings,
        sandboxMode: sandboxMode.value,
        allowSandboxFallback: allowSandboxFallback.value,
      },
    })
    workspace.value = updated
    ElMessage.success(t('settings.sandbox.saved'))
  } catch (err) {
    sandboxError.value = err instanceof Error ? err.message : String(err)
  } finally {
    sandboxSaving.value = false
  }
}

async function check() {
  try {
    health.value = await HealthApi.get()
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadRuntimes() {
  try {
    runtimes.value = await RuntimeApi.list()
    const drafts: Record<string, ModelDraft[]> = {}
    for (const runtime of runtimes.value) {
      drafts[runtime.name] = runtime.models
        .filter((model) => model.source === 'settings')
        .map((model) => ({ id: model.id, label: model.label || '' }))
    }
    modelDrafts.value = drafts
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function addModel(runtimeName: string) {
  modelDrafts.value[runtimeName] = [...(modelDrafts.value[runtimeName] || []), { id: '', label: '' }]
}

function removeModel(runtimeName: string, index: number) {
  modelDrafts.value[runtimeName] = (modelDrafts.value[runtimeName] || []).filter((_, i) => i !== index)
}

async function saveModels(runtimeName: string) {
  const draft = modelDrafts.value[runtimeName] || []
  const models = draft.map((model) => ({ id: model.id.trim(), label: model.label.trim() }))
  if (models.some((model) => !model.id)) {
    modelErrors.value[runtimeName] = t('settings.models.modelIdRequired')
    return
  }
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    modelErrors.value[runtimeName] = t('settings.models.modelIdDuplicate')
    return
  }
  savingRuntime.value = runtimeName
  try {
    await RuntimeApi.updateModels(runtimeName, models)
    modelErrors.value[runtimeName] = ''
    await loadRuntimes()
    ElMessage.success(t('settings.models.saved'))
  } catch (err) {
    modelErrors.value[runtimeName] = err instanceof Error ? err.message : String(err)
  } finally {
    savingRuntime.value = ''
  }
}

// 语言选择器直接绑定 vue-i18n 的 locale；任何变更（含本组件）统一走
// setAppLocale 完成持久化与 <html lang> 同步。
watch(locale, (value) => {
  setAppLocale(value as AppLocale)
})

onMounted(() => {
  void check()
  void loadRuntimes()
  void loadWorkspace()
  void loadGateway()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 items-center px-6 pb-4 pt-5">
      <div>
        <h1 class="text-title font-semibold tracking-tight">{{ $t('settings.title') }}</h1>
        <p class="text-caption text-fg-subtle">{{ $t('settings.subtitle') }}</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <div class="mx-auto max-w-[880px] space-y-4">
        <SectionCard
          id="settings-appearance"
          :title="$t('settings.appearance')"
          :description="$t('settings.appearanceHint')"
        >
          <div
            class="grid grid-cols-2 gap-3 md:grid-cols-4"
            role="radiogroup"
            :aria-label="$t('settings.appearance')"
          >
            <ThemeSwatch
              v-for="item in themeStore.themes"
              :key="item.id"
              :theme="item"
              :selected="themeStore.pref === item.id"
              @select="themeStore.setTheme(item.id)"
            />
          </div>
        </SectionCard>

        <SectionCard id="settings-language" :title="$t('settings.language')">
          <el-radio-group v-model="locale">
            <el-radio-button value="zh-CN">简体中文</el-radio-button>
            <el-radio-button value="en-US">English</el-radio-button>
          </el-radio-group>
          <p class="mt-3 text-caption text-fg-subtle">{{ $t('settings.languageHint') }}</p>
        </SectionCard>

        <SectionCard id="settings-api" :title="$t('settings.apiConnection')">
          <div class="flex flex-wrap items-center gap-3">
            <Button variant="outline" @click="check">{{ $t('settings.checkHealth') }}</Button>
            <Badge v-if="health" tone="success">OK · v{{ health.version }}</Badge>
          </div>
          <p v-if="error" class="mt-2 text-caption text-danger">{{ error }}</p>
          <p class="mt-3 text-caption text-fg-subtle">{{ $t('settings.apiNote') }}</p>
        </SectionCard>

        <SectionCard id="settings-workspace" :title="$t('settings.workspace')">
          <p class="text-label text-fg-muted">
            {{ $t('settings.workspaceNote', { path: '~/.ateam/workspaces/runs/<run-id>' }) }}
          </p>
          <div class="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
            <label class="flex items-start justify-between gap-4">
              <span class="min-w-0">
                <span class="block text-label font-semibold">{{ $t('settings.sandbox.title') }}</span>
                <span class="mt-1 block text-caption text-fg-subtle">{{ $t('settings.sandbox.hint') }}</span>
              </span>
              <el-switch
                v-model="sandboxMode"
                active-value="seatbelt"
                inactive-value="none"
                :disabled="sandboxSaving || !workspace"
                @change="saveSandbox"
              />
            </label>
            <label v-if="sandboxMode === 'seatbelt'" class="flex items-start justify-between gap-4">
              <span class="min-w-0">
                <span class="block text-label font-semibold">{{ $t('settings.sandbox.fallback') }}</span>
                <span class="mt-1 block text-caption text-fg-subtle">{{ $t('settings.sandbox.fallbackHint') }}</span>
              </span>
              <el-switch
                v-model="allowSandboxFallback"
                :disabled="sandboxSaving || !workspace"
                @change="saveSandbox"
              />
            </label>
            <p v-if="sandboxError" class="text-caption text-danger">{{ sandboxError }}</p>
          </div>
        </SectionCard>

        <SectionCard id="settings-runtime-models" :title="$t('settings.models.title')">
          <p class="text-caption text-fg-subtle">{{ $t('settings.models.hint') }}</p>
          <div class="mt-4 flex flex-col gap-5">
            <section v-for="runtime in supportedRuntimes" :key="runtime.name">
              <div class="flex items-center gap-2">
                <span class="text-label font-semibold">{{ runtime.name }}</span>
                <Badge v-if="runtime.version">{{ runtime.version }}</Badge>
                <Badge v-if="!runtime.available" tone="warning">
                  {{ $t('settings.models.unavailable') }}
                </Badge>
              </div>
              <p v-if="runtime.modelsError" class="mt-1 text-caption text-fg-subtle">
                {{ runtime.modelsError }}
              </p>

              <div
                v-for="(model, index) in modelDrafts[runtime.name] || []"
                :key="`${runtime.name}-${index}`"
                class="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
              >
                <Input v-model="model.id" :placeholder="$t('settings.models.modelId')" />
                <Input v-model="model.label" :placeholder="$t('settings.models.modelLabel')" />
                <Button variant="destructive" size="sm" @click="removeModel(runtime.name, index)">
                  {{ $t('settings.models.remove') }}
                </Button>
              </div>

              <div class="mt-2 flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="addModel(runtime.name)">
                  {{ $t('settings.models.add') }}
                </Button>
                <Button
                  size="sm"
                  :disabled="savingRuntime === runtime.name"
                  @click="saveModels(runtime.name)"
                >
                  <Loader v-if="savingRuntime === runtime.name" :size="14" />
                  {{ $t('settings.models.save') }}
                </Button>
              </div>
              <p v-if="modelErrors[runtime.name]" class="mt-1 text-caption text-danger">
                {{ modelErrors[runtime.name] }}
              </p>
            </section>
          </div>
        </SectionCard>

        <SectionCard id="settings-gateway" :title="$t('settings.gateway.title')">
          <p class="text-caption text-fg-subtle">{{ $t('settings.gateway.hint') }}</p>
          <label class="mt-3 flex items-start justify-between gap-4 border-t border-border-subtle pt-3">
            <span class="min-w-0">
              <span class="block text-label font-semibold">{{ $t('settings.gateway.useForClaude') }}</span>
              <span class="mt-1 block text-caption text-fg-subtle">{{ $t('settings.gateway.useForClaudeHint') }}</span>
            </span>
            <el-switch v-model="useGateway" :disabled="gatewayBusy || !workspace" @change="saveGatewayToggle" />
          </label>
          <p v-if="gatewayError" class="mt-2 text-caption text-danger">{{ gatewayError }}</p>
          <div class="mt-4 flex flex-col gap-3">
            <div>
              <span class="text-label font-semibold">{{ $t('settings.gateway.baseUrl') }}</span>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <Input :model-value="gateway?.baseUrl || ''" readonly class="min-w-[240px] flex-1" />
                <Button size="sm" variant="ghost" :disabled="!gateway?.baseUrl" @click="copyGatewayValue(gateway?.baseUrl || '')">
                  {{ $t('settings.gateway.copy') }}
                </Button>
              </div>
            </div>
            <div>
              <span class="text-label font-semibold">{{ $t('settings.gateway.token') }}</span>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <Input :model-value="gateway?.token || ''" readonly type="password" class="min-w-[240px] flex-1" />
                <Button size="sm" variant="ghost" :disabled="!gateway?.token" @click="copyGatewayValue(gateway?.token || '')">
                  {{ $t('settings.gateway.copy') }}
                </Button>
                <Button size="sm" variant="ghost" :disabled="gatewayBusy" @click="rotateGatewayToken">
                  {{ $t('settings.gateway.rotate') }}
                </Button>
              </div>
            </div>
          </div>

          <div class="mt-5 border-t border-border-subtle pt-4">
            <h3 class="text-label font-semibold">{{ $t('settings.gateway.providers') }}</h3>
            <p v-if="gatewayProviders.length === 0" class="mt-1 text-caption text-fg-subtle">
              {{ $t('settings.gateway.empty') }}
            </p>
            <div
              v-for="provider in gatewayProviders"
              :key="provider.id"
              class="mt-2 flex flex-wrap items-start justify-between gap-2 rounded-md border border-border-subtle px-3 py-2"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-label font-semibold">{{ provider.name }}</span>
                  <Badge v-if="provider.default" tone="success">{{ $t('settings.gateway.defaultProvider') }}</Badge>
                </div>
                <p class="truncate font-mono text-caption text-fg-subtle">{{ provider.baseUrl }}</p>
                <p v-if="provider.model" class="truncate font-mono text-caption text-fg-subtle">{{ provider.model }}</p>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  v-if="!provider.default"
                  size="sm"
                  variant="ghost"
                  :disabled="gatewayBusy"
                  @click="setDefaultProvider(provider)"
                >
                  {{ $t('settings.gateway.setDefault') }}
                </Button>
                <Button size="sm" variant="ghost" :disabled="gatewayBusy" @click="removeGatewayProvider(provider)">
                  {{ $t('settings.gateway.remove') }}
                </Button>
              </div>
            </div>

            <div class="mt-4 grid gap-2 sm:grid-cols-2">
              <Input v-model="providerDraft.name" :placeholder="$t('settings.gateway.namePlaceholder')" />
              <Input v-model="providerDraft.baseUrl" :placeholder="$t('settings.gateway.baseUrlPlaceholder')" />
              <Input v-model="providerDraft.apiKey" type="password" :placeholder="$t('settings.gateway.apiKeyPlaceholder')" />
              <Input v-model="providerDraft.model" :placeholder="$t('settings.gateway.modelPlaceholder')" />
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <el-checkbox v-model="providerDraft.default">{{ $t('settings.gateway.defaultProvider') }}</el-checkbox>
              <Button
                size="sm"
                :disabled="gatewayBusy || !providerDraft.name.trim() || !providerDraft.baseUrl.trim()"
                @click="addGatewayProvider"
              >
                {{ $t('settings.gateway.add') }}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard id="settings-about" :title="$t('settings.about')">
          <p class="text-label text-fg-muted">{{ $t('settings.aboutNote') }}</p>
        </SectionCard>
      </div>
    </div>
  </div>
</template>
