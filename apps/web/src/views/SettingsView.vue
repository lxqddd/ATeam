<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { Health, RuntimeInfo } from '@ateam/shared'
import { HealthApi, RuntimeApi } from '../api'
import { setAppLocale, type AppLocale } from '../i18n'

interface ModelDraft {
  id: string
  label: string
}

const { t, locale } = useI18n()
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
  <div class="flex flex-col h-full">
    <header class="shrink-0 flex items-center px-6 pt-5 pb-4">
      <div>
        <h1 class="text-title font-semibold tracking-tight">{{ $t('settings.title') }}</h1>
        <p class="text-caption text-fg-subtle">{{ $t('settings.subtitle') }}</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <div class="grid max-w-[960px] items-start gap-4 lg:grid-cols-2">
      <el-card id="settings-language" shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('settings.language') }}</span>
        </template>
        <el-radio-group v-model="locale">
          <el-radio-button value="zh-CN">简体中文</el-radio-button>
          <el-radio-button value="en-US">English</el-radio-button>
        </el-radio-group>
        <p class="mt-3 text-caption text-fg-subtle">{{ $t('settings.languageHint') }}</p>
      </el-card>

      <el-card id="settings-api" shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('settings.apiConnection') }}</span>
        </template>
        <div class="flex items-center gap-3">
          <el-button @click="check">{{ $t('settings.checkHealth') }}</el-button>
          <el-tag v-if="health" type="success">OK · v{{ health.version }}</el-tag>
          <el-tag v-if="error" type="danger">{{ error }}</el-tag>
        </div>
        <p class="mt-3 text-caption text-fg-subtle">{{ $t('settings.apiNote') }}</p>
      </el-card>

      <el-card id="settings-workspace" shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('settings.workspace') }}</span>
        </template>
        <p class="text-label text-fg-muted">
          {{ $t('settings.workspaceNote', { path: '~/.ateam/workspaces/runs/<run-id>' }) }}
        </p>
      </el-card>

      <el-card id="settings-runtime-models" shadow="never" class="lg:col-span-2">
        <template #header>
          <span class="text-label font-semibold">{{ $t('settings.models.title') }}</span>
        </template>
        <p class="text-caption text-fg-subtle">{{ $t('settings.models.hint') }}</p>
        <div class="mt-4 flex flex-col gap-5">
          <section v-for="runtime in supportedRuntimes" :key="runtime.name">
            <div class="flex items-center gap-2">
              <span class="text-label font-semibold">{{ runtime.name }}</span>
              <el-tag v-if="runtime.version" size="small">{{ runtime.version }}</el-tag>
              <el-tag v-if="!runtime.available" size="small" type="warning">
                {{ $t('settings.models.unavailable') }}
              </el-tag>
            </div>
            <p v-if="runtime.modelsError" class="mt-1 text-caption text-fg-subtle">
              {{ runtime.modelsError }}
            </p>

            <div
              v-for="(model, index) in modelDrafts[runtime.name] || []"
              :key="`${runtime.name}-${index}`"
              class="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
            >
              <el-input v-model="model.id" :placeholder="$t('settings.models.modelId')" />
              <el-input v-model="model.label" :placeholder="$t('settings.models.modelLabel')" />
              <el-button text type="danger" @click="removeModel(runtime.name, index)">
                {{ $t('settings.models.remove') }}
              </el-button>
            </div>

            <div class="mt-2 flex items-center gap-2">
              <el-button text @click="addModel(runtime.name)">{{ $t('settings.models.add') }}</el-button>
              <el-button
                type="primary"
                size="small"
                :loading="savingRuntime === runtime.name"
                @click="saveModels(runtime.name)"
              >
                {{ $t('settings.models.save') }}
              </el-button>
            </div>
            <p v-if="modelErrors[runtime.name]" class="mt-1 text-caption text-danger">
              {{ modelErrors[runtime.name] }}
            </p>
          </section>
        </div>
      </el-card>

      <el-card id="settings-about" shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('settings.about') }}</span>
        </template>
        <p class="text-label text-fg-muted">{{ $t('settings.aboutNote') }}</p>
      </el-card>
      </div>
    </div>
  </div>
</template>
