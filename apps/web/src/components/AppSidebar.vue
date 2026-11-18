<script setup lang="ts">
import { computed, nextTick, onMounted, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Grid, Cpu, DataLine, Setting, Monitor } from '@element-plus/icons-vue'
import { useTasksStore } from '../stores/tasks'
import { useAgentsStore } from '../stores/agents'
import { useRunsStore } from '../stores/runs'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const tasks = useTasksStore()
const agents = useAgentsStore()
const runs = useRunsStore()

const navItems: { path: string; icon: Component; labelKey: string }[] = [
  { path: '/', icon: Grid, labelKey: 'sidebar.nav.board' },
  { path: '/agents', icon: Cpu, labelKey: 'sidebar.nav.agents' },
  { path: '/runs', icon: DataLine, labelKey: 'sidebar.nav.runs' },
  { path: '/settings', icon: Setting, labelKey: 'sidebar.nav.settings' },
]

type Section = 'tasks' | 'agents' | 'runs' | 'settings'

// 面板内容跟随当前页面（对齐 nomi 的上下文侧栏）
const section = computed<Section>(() => {
  if (route.path.startsWith('/agents')) {
    return 'agents'
  }
  if (route.path.startsWith('/runs')) {
    return 'runs'
  }
  if (route.path.startsWith('/settings')) {
    return 'settings'
  }
  return 'tasks'
})

const sectionTitleKey = computed(
  () =>
    ({
      tasks: 'sidebar.nav.board',
      agents: 'sidebar.nav.agents',
      runs: 'sidebar.nav.runs',
      settings: 'sidebar.nav.settings',
    })[section.value],
)

const panelCount = computed(() => {
  if (section.value === 'agents') {
    return agents.items.length
  }
  if (section.value === 'runs') {
    return runs.items.length
  }
  if (section.value === 'tasks') {
    return tasks.items.length
  }
  return 0
})

async function ensureData() {
  if (section.value === 'tasks' && tasks.items.length === 0) {
    await tasks.fetchAll()
  }
  if (section.value === 'agents' && agents.items.length === 0) {
    await agents.fetchAll()
  }
  if (section.value === 'runs') {
    if (runs.items.length === 0) {
      await runs.fetchAll()
    }
    if (tasks.items.length === 0) {
      await tasks.fetchAll()
    }
  }
}

onMounted(() => {
  void ensureData()
})

// 路由切换时补全面板所需数据（视图自己也会拉取，这里兜底）
watch(section, () => {
  void ensureData()
})

const TONE_CLASSES: Record<string, string> = {
  done: 'bg-success',
  completed: 'bg-success',
  failed: 'bg-danger',
  blocked: 'bg-warning',
  cancelled: 'bg-warning',
  in_progress: 'bg-brand',
  running: 'bg-brand',
  preparing: 'bg-brand',
  in_review: 'bg-warning',
}

function toneClass(status: string) {
  return TONE_CLASSES[status] ?? 'bg-fg-subtle/60'
}

function taskTitle(id: string) {
  return tasks.items.find((task) => task.id === id)?.title ?? id.slice(0, 8)
}

function openTask(id: string) {
  void router.push(`/tasks/${id}`)
}

async function goToSection(id: string) {
  if (route.path !== '/settings') {
    await router.push('/settings')
    await nextTick()
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const settingsSections = [
  { id: 'settings-language', labelKey: 'settings.language' },
  { id: 'settings-api', labelKey: 'settings.apiConnection' },
  { id: 'settings-workspace', labelKey: 'settings.workspace' },
  { id: 'settings-about', labelKey: 'settings.about' },
]

const isTaskRoute = computed(() => route.name === 'task')
</script>

<template>
  <aside class="shrink-0 flex min-h-0">
    <!-- 52px 图标导轨：全局页面切换（对齐 nomi 的 SidebarRail；
         首个图标用 6px 上边距与右侧面板 44px 顶行居中对齐） -->
    <nav class="w-[52px] shrink-0 flex flex-col items-center gap-1 px-2 py-[10px] mt-1.5">
      <button
        v-for="item in navItems"
        :key="item.path"
        type="button"
        class="size-8 inline-flex items-center justify-center rounded-[10px] transition-colors"
        :class="
          route.path === item.path
            ? 'bg-[var(--cd-color-nav-bg)] text-foreground'
            : 'text-fg-muted hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground'
        "
        :title="$t(item.labelKey)"
        :aria-label="$t(item.labelKey)"
        :aria-current="route.path === item.path ? 'page' : undefined"
        @click="router.push(item.path)"
      >
        <el-icon :size="18"><component :is="item.icon" /></el-icon>
      </button>
    </nav>

    <!-- 260px 上下文面板：当前页面的列表与底部状态 -->
    <div class="w-[260px] shrink-0 flex flex-col gap-1 px-2 py-[10px] min-h-0">
      <div class="h-11 flex items-center gap-2.5 px-1">
        <div
          class="size-8 shrink-0 rounded-lg bg-[var(--cd-color-accent-soft)] flex items-center justify-center"
        >
          <el-icon :size="17" color="var(--cd-color-accent-2)"><Monitor /></el-icon>
        </div>
        <div class="leading-tight min-w-0">
          <div class="text-label font-semibold truncate">ATeam</div>
          <div class="text-caption text-fg-subtle truncate">{{ $t('sidebar.tagline') }}</div>
        </div>
      </div>

      <div class="h-8 flex items-center justify-between px-1">
        <span class="text-caption text-fg-subtle">{{ $t(sectionTitleKey) }}</span>
        <span class="text-caption text-fg-subtle tabular-nums">
          {{ section === 'settings' ? settingsSections.length : panelCount }}
        </span>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        <template v-if="section === 'tasks'">
          <button
            v-for="task in tasks.items"
            :key="task.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left transition-colors"
            :class="
              isTaskRoute && String(route.params.id) === task.id
                ? 'bg-[var(--cd-color-selected-bg)] text-foreground'
                : 'text-fg-muted hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground'
            "
            @click="openTask(task.id)"
          >
            <span class="size-1.5 shrink-0 rounded-full" :class="toneClass(task.status)" />
            <span class="text-label truncate">{{ task.title }}</span>
          </button>
        </template>

        <template v-else-if="section === 'agents'">
          <button
            v-for="agent in agents.items"
            :key="agent.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="router.push('/agents')"
          >
            <span class="size-1.5 shrink-0 rounded-full bg-brand" />
            <span class="text-label truncate">{{ agent.name }}</span>
            <span class="ml-auto text-caption text-fg-subtle shrink-0">{{ agent.runtime }}</span>
          </button>
        </template>

        <template v-else-if="section === 'runs'">
          <button
            v-for="run in runs.items"
            :key="run.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="router.push(`/runs/${run.id}`)"
          >
            <span class="size-1.5 shrink-0 rounded-full" :class="toneClass(run.status)" />
            <span class="text-label truncate">{{ taskTitle(run.taskId) }}</span>
          </button>
        </template>

        <template v-else>
          <button
            v-for="item in settingsSections"
            :key="item.id"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="goToSection(item.id)"
          >
            <span class="text-label truncate">{{ $t(item.labelKey) }}</span>
          </button>
        </template>

        <p
          v-if="
            (section === 'tasks' && tasks.items.length === 0) ||
            (section === 'agents' && agents.items.length === 0) ||
            (section === 'runs' && runs.items.length === 0)
          "
          class="px-2.5 py-2 text-caption text-fg-subtle"
        >
          {{ $t('common.empty') }}
        </p>
      </div>

      <div class="rounded-lg border border-border-subtle bg-surface-raised/60 px-3 py-2.5">
        <div class="flex items-center gap-2 text-caption text-fg-muted">
          <span class="size-1.5 rounded-full bg-success" />
          {{ $t('sidebar.localFirst') }}
        </div>
        <div class="mt-0.5 text-caption text-fg-subtle">v0.1.0</div>
      </div>
    </div>
  </aside>
</template>
