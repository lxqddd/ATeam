<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '../stores/tasks'

const route = useRoute()
const tasks = useTasksStore()
const { t } = useI18n()

const PAGE_TITLE_KEYS: Record<string, string> = {
  board: 'board.title',
  agents: 'agents.title',
  runs: 'runs.title',
  run: 'runDetail.title',
  settings: 'settings.title',
}

// 顶栏居中显示当前页面标题（任务详情页显示任务标题，与 nomi 的文档标题一致）
const title = computed(() => {
  if (route.name === 'task') {
    const task = tasks.items.find((item) => item.id === String(route.params.id))
    return task?.title ?? t('task.pageTitle')
  }
  const key = PAGE_TITLE_KEYS[String(route.name ?? '')]
  return key ? t(key) : 'ATeam'
})
</script>

<template>
  <header class="app-titlebar h-11 shrink-0 flex items-center justify-center px-4 select-none">
    <span class="text-label text-foreground truncate max-w-[60%]">{{ title }}</span>
  </header>
</template>
