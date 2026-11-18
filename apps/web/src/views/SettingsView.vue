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
    <header class="h-14 shrink-0 border-b border-border flex items-center px-5">
      <div>
        <h1 class="text-sm font-semibold">{{ $t('settings.title') }}</h1>
        <p class="text-[11px] text-zinc-500">{{ $t('settings.subtitle') }}</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-5 space-y-4 max-w-3xl">
      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400 uppercase">{{ $t('settings.language') }}</span>
        </template>
        <el-radio-group v-model="locale">
          <el-radio-button value="zh-CN">简体中文</el-radio-button>
          <el-radio-button value="en-US">English</el-radio-button>
        </el-radio-group>
        <p class="mt-3 text-[11px] text-zinc-500">{{ $t('settings.languageHint') }}</p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400 uppercase">{{ $t('settings.apiConnection') }}</span>
        </template>
        <div class="flex items-center gap-3">
          <el-button @click="check">{{ $t('settings.checkHealth') }}</el-button>
          <el-tag v-if="health" type="success">OK · v{{ health.version }}</el-tag>
          <el-tag v-if="error" type="danger">{{ error }}</el-tag>
        </div>
        <p class="mt-3 text-[11px] text-zinc-500">{{ $t('settings.apiNote') }}</p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400 uppercase">{{ $t('settings.workspace') }}</span>
        </template>
        <p class="text-xs text-zinc-400">
          {{ $t('settings.workspaceNote', { path: '~/.ateam/workspaces/runs/<run-id>' }) }}
        </p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400 uppercase">{{ $t('settings.about') }}</span>
        </template>
        <p class="text-xs text-zinc-400">{{ $t('settings.aboutNote') }}</p>
      </el-card>
    </div>
  </div>
</template>
