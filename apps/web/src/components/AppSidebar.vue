<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Grid, Cpu, DataLine, Connection, Setting, Monitor } from '@element-plus/icons-vue'
import { ChevronRightIcon } from '@lucide/vue'
import { useTasksStore } from '../stores/tasks'
import { useAgentsStore } from '../stores/agents'
import { useRunsStore } from '../stores/runs'
import { useRuntimesStore } from '../stores/runtimes'
import { useUiStore } from '../stores/ui'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const tasks = useTasksStore()
const agents = useAgentsStore()
const runs = useRunsStore()
const runtimes = useRuntimesStore()
const ui = useUiStore()

const navItems: { path: string; icon: Component; labelKey: string }[] = [
  { path: '/', icon: Grid, labelKey: 'sidebar.nav.board' },
  { path: '/agents', icon: Cpu, labelKey: 'sidebar.nav.agents' },
  { path: '/runs', icon: DataLine, labelKey: 'sidebar.nav.runs' },
  { path: '/runtimes', icon: Connection, labelKey: 'sidebar.nav.runtimes' },
  { path: '/settings', icon: Setting, labelKey: 'sidebar.nav.settings' },
]

const settingsSections = [
  { id: 'settings-appearance', labelKey: 'settings.appearance' },
  { id: 'settings-language', labelKey: 'settings.language' },
  { id: 'settings-api', labelKey: 'settings.apiConnection' },
  { id: 'settings-workspace', labelKey: 'settings.workspace' },
  { id: 'settings-runtime-models', labelKey: 'settings.models.title' },
  { id: 'settings-about', labelKey: 'settings.about' },
]

type Section = 'tasks' | 'agents' | 'runs' | 'runtimes' | 'settings'

const section = computed<Section>(() => {
  if (route.path.startsWith('/agents')) return 'agents'
  if (route.path.startsWith('/runs')) return 'runs'
  if (route.path.startsWith('/runtimes')) return 'runtimes'
  if (route.path.startsWith('/settings')) return 'settings'
  return 'tasks'
})

const sectionTitleKey = computed(
  () =>
    ({
      tasks: 'sidebar.nav.board',
      agents: 'sidebar.nav.agents',
      runs: 'sidebar.nav.runs',
      runtimes: 'sidebar.nav.runtimes',
      settings: 'sidebar.nav.settings',
    })[section.value],
)

const panelCount = computed(() => {
  if (section.value === 'agents') return agents.items.length
  if (section.value === 'runs') return runs.items.length
  if (section.value === 'runtimes') return runtimes.items.length
  if (section.value === 'tasks') return tasks.items.length
  return settingsSections.length
})

const collapsedSections = ref(new Set<Section>())
const sectionOpen = computed({
  get: () => !collapsedSections.value.has(section.value),
  set: (open: boolean) => {
    const next = new Set(collapsedSections.value)
    if (open) next.delete(section.value)
    else next.add(section.value)
    collapsedSections.value = next
  },
})

async function ensureData() {
  if (section.value === 'tasks' && tasks.items.length === 0) await tasks.fetchAll()
  if (section.value === 'agents' && agents.items.length === 0) await agents.fetchAll()
  if (section.value === 'runtimes' && runtimes.items.length === 0) await runtimes.fetchAll()
  if (section.value === 'runs') {
    if (runs.items.length === 0) await runs.fetchAll()
    if (tasks.items.length === 0) await tasks.fetchAll()
  }
}

watch(section, () => { void ensureData() }, { immediate: true })

const TONE_CLASSES: Record<string, string> = {
  available: 'bg-success',
  unavailable: 'bg-fg-subtle/60',
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

const peek = ref<{ title: string; status: string; statusLabel: string; x: number; y: number } | null>(null)

function showPeek(entry: { title: string; status: string; statusLabel: string }, event: Event) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  peek.value = { ...entry, x: rect.right + 8, y: rect.top }
}

function hidePeek() {
  peek.value = null
}

function taskTitle(id: string) {
  return tasks.items.find((task) => task.id === id)?.title ?? id.slice(0, 8)
}

function openTask(id: string) {
  void router.push(`/tasks/${id}`)
}

const RAIL_ITEM_LIMIT = 8

const collapsedItems = computed(() => {
  if (section.value === 'agents') {
    return agents.items.slice(0, RAIL_ITEM_LIMIT).map((agent) => ({
      id: agent.id,
      title: agent.name,
      status: '' as const,
      statusLabel: '',
      path: `/agents/${agent.id}/work`,
      active: route.path === `/agents/${agent.id}/work`,
    }))
  }
  if (section.value === 'runs') {
    return runs.items.slice(0, RAIL_ITEM_LIMIT).map((run) => ({
      id: run.id,
      title: taskTitle(run.taskId),
      status: run.status,
      statusLabel: t(`common.status.run.${run.status}`),
      path: `/runs/${run.id}`,
      active: route.path === `/runs/${run.id}`,
    }))
  }
  if (section.value === 'runtimes') {
    return runtimes.items.slice(0, RAIL_ITEM_LIMIT).map((runtime) => ({
      id: runtime.name,
      title: runtime.name,
      status: runtime.available ? 'available' : 'unavailable',
      statusLabel: runtime.available ? t('runtimes.available') : t('runtimes.unavailable'),
      path: '/runtimes',
      // Every runtime entry opens the same page; the nav icon already marks
      // the section, so the rail does not single one out as current.
      active: false,
    }))
  }
  if (section.value === 'tasks') {
    return tasks.items.slice(0, RAIL_ITEM_LIMIT).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      statusLabel: t(`common.status.task.${task.status}`),
      path: `/tasks/${task.id}`,
      active: route.path === `/tasks/${task.id}`,
    }))
  }
  return []
})
const overflowCount = computed(() => Math.max(0, panelCount.value - collapsedItems.value.length))

async function goToSection(id: string) {
  if (route.path !== '/settings') {
    await router.push('/settings')
    await nextTick()
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const isTaskRoute = computed(() => route.name === 'task')
</script>

<template>
  <aside class="shrink-0 flex min-h-0">
    <nav class="w-[52px] shrink-0 flex flex-col items-center gap-1 px-2 py-[10px] min-h-0 overflow-y-auto">
      <div class="flex flex-col items-center gap-0.5 w-full mt-1">
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
      </div>

      <div v-if="ui.sidebarCollapsed && collapsedItems.length" class="w-full mt-2 flex flex-col items-center gap-1">
        <router-link
          v-for="entry in collapsedItems"
          :key="entry.id"
          :to="entry.path"
          class="size-8 rounded-[10px] flex items-center justify-center text-caption"
          :class="
            entry.active
              ? 'bg-[var(--cd-color-selected-bg)] text-foreground'
              : 'bg-[var(--cd-color-surface-raised)] text-fg-muted hover:bg-[var(--cd-color-hover)] hover:text-foreground'
          "
          :title="entry.title"
          :aria-label="entry.title"
          :aria-current="entry.active ? 'page' : undefined"
          @mouseenter="showPeek(entry, $event)"
          @mouseleave="hidePeek"
          @focus="showPeek(entry, $event)"
          @blur="hidePeek"
        >
          {{ entry.title.slice(0, 1) }}
        </router-link>
        <button
          v-if="overflowCount > 0"
          type="button"
          class="size-8 rounded-[10px] text-caption text-fg-subtle hover:bg-[var(--cd-color-hover)]"
          :aria-label="$t('sidebar.expand')"
          @click="ui.setSidebarCollapsed(false)"
        >
          +{{ overflowCount }}
        </button>
      </div>
    </nav>

    <div v-if="!ui.sidebarCollapsed" class="panel w-[260px] shrink-0 flex flex-col gap-1 min-h-0">
      <div class="h-11 flex items-center gap-2.5 px-1">
        <div class="size-8 shrink-0 rounded-lg bg-[var(--cd-color-accent-soft)] flex items-center justify-center">
          <el-icon :size="17" color="var(--cd-color-accent-2)"><Monitor /></el-icon>
        </div>
        <div class="leading-tight min-w-0">
          <div class="text-label font-semibold truncate">ATeam</div>
          <div class="text-caption text-fg-subtle truncate">{{ $t('sidebar.tagline') }}</div>
        </div>
      </div>

      <button
        type="button"
        class="h-8 flex items-center gap-1.5 px-1 text-caption text-fg-subtle hover:text-fg-muted"
        :aria-expanded="sectionOpen"
        @click="sectionOpen = !sectionOpen"
      >
        <ChevronRightIcon class="size-3 transition-transform duration-200" :class="{ 'rotate-90': sectionOpen }" />
        {{ $t(sectionTitleKey) }}
        <span class="ml-auto tabular-nums">{{ panelCount }}</span>
      </button>

      <div
        v-if="sectionOpen"
        class="flex-1 min-h-0 overflow-y-auto space-y-0.5"
        role="region"
        :aria-label="$t(sectionTitleKey)"
      >
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
            @click="router.push(`/agents/${agent.id}/work`)"
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

        <template v-else-if="section === 'runtimes'">
          <button
            v-for="runtime in runtimes.items"
            :key="runtime.name"
            type="button"
            class="w-full h-8 flex items-center gap-2 rounded-[10px] px-2.5 text-left text-fg-muted transition-colors hover:bg-[var(--cd-color-nav-bg)] hover:text-foreground"
            @click="router.push('/runtimes')"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="toneClass(runtime.available ? 'available' : 'unavailable')"
            />
            <span class="text-label truncate">{{ runtime.name }}</span>
            <span v-if="runtime.version" class="ml-auto text-caption text-fg-subtle shrink-0">
              {{ runtime.version }}
            </span>
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
            (section === 'runs' && runs.items.length === 0) ||
            (section === 'runtimes' && runtimes.items.length === 0)
          "
          class="px-2.5 py-2 text-caption text-fg-subtle"
        >
          {{ $t('common.empty') }}
        </p>
      </div>

      <div class="mt-auto rounded-lg border border-border-subtle bg-surface-raised/60 px-3 py-2.5">
        <div class="flex items-center gap-2 text-caption text-fg-muted">
          <span class="size-1.5 rounded-full bg-success" />
          {{ $t('sidebar.localFirst') }}
        </div>
        <div class="mt-0.5 text-caption text-fg-subtle">v0.1.0</div>
      </div>
    </div>

    <div
      v-if="peek"
      class="fixed z-50 w-56 rounded-[var(--cd-radius-md)] border border-border bg-[var(--cd-color-surface-raised)] px-3 py-2 shadow-[var(--cd-shadow-md)] pointer-events-none"
      :style="{ left: peek.x + 'px', top: peek.y + 'px' }"
    >
      <span class="block text-caption text-foreground truncate">{{ peek.title }}</span>
      <span class="mt-1 flex items-center gap-1.5 text-caption text-fg-subtle">
        <span class="size-1.5 rounded-full" :class="toneClass(peek.status)" />
        {{ peek.statusLabel || '—' }}
      </span>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  margin: var(--cd-space-2) 0;
  background: var(--cd-panel-bg);
  border: 1px solid var(--cd-panel-border);
  border-right: none;
  border-radius: var(--cd-radius-xl) 0 0 var(--cd-radius-xl);
  padding: 10px var(--cd-space-2);
}
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: panel-in 0.18s var(--cd-ease); }
  @keyframes panel-in {
    from { margin-right: -260px; clip-path: inset(0 100% 0 0); }
    to { margin-right: 0; clip-path: inset(0 0 0 0); }
  }
}
</style>
