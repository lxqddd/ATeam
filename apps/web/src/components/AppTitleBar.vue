<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from '@lucide/vue'
import { useTasksStore } from '../stores/tasks'
import { useAgentsStore } from '../stores/agents'
import { useUiStore } from '../stores/ui'

const route = useRoute()
const tasks = useTasksStore()
const agents = useAgentsStore()
const ui = useUiStore()
const { t } = useI18n()

const PAGE_TITLE_KEYS: Record<string, string> = {
  board: 'board.title',
  agents: 'agents.title',
  runs: 'runs.title',
  run: 'runDetail.title',
  runtimes: 'runtimes.title',
  settings: 'settings.title',
}

const title = computed(() => {
  if (route.name === 'task') {
    const task = tasks.items.find((item) => item.id === String(route.params.id))
    return task?.title ?? t('task.pageTitle')
  }
  if (route.name === 'agent-work') {
    const agent = agents.items.find((item) => item.id === String(route.params.id))
    return agent?.name ?? t('agents.title')
  }
  const key = PAGE_TITLE_KEYS[String(route.name ?? '')]
  return key ? t(key) : 'ATeam'
})

const toggleLabel = computed(() =>
  ui.sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse'),
)
</script>

<template>
  <header class="app-titlebar">
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-[10px] text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
      :title="toggleLabel"
      :aria-label="toggleLabel"
      :aria-expanded="!ui.sidebarCollapsed"
      @click="ui.toggleSidebar()"
    >
      <PanelLeftOpenIcon v-if="ui.sidebarCollapsed" class="size-4" />
      <PanelLeftCloseIcon v-else class="size-4" />
    </button>
    <span class="app-titlebar__title">{{ title }}</span>
    <span class="app-titlebar__spacer" />
    <div id="titlebar-actions" class="flex items-center gap-2" />
  </header>
</template>
