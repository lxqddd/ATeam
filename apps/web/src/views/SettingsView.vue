<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Health } from '@ateam/shared'
import { HealthApi } from '../api'
import { setAppLocale, type AppLocale } from '../i18n'

const { t, locale } = useI18n()
const health = ref<Health | null>(null)
const error = ref('')

async function check() {
  try {
    health.value = await HealthApi.get()
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// 语言选择器直接绑定 vue-i18n 的 locale；任何变更（含本组件）统一走
// setAppLocale 完成持久化与 <html lang> 同步。
watch(locale, (value) => {
  setAppLocale(value as AppLocale)
})

onMounted(() => {
  void check()
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
