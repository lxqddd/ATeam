<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { Health, RuntimeInfo } from '@ateam/shared'
import { HealthApi, RuntimeApi } from '../api'
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

        <SectionCard id="settings-about" :title="$t('settings.about')">
          <p class="text-label text-fg-muted">{{ $t('settings.aboutNote') }}</p>
        </SectionCard>
      </div>
    </div>
  </div>
</template>
