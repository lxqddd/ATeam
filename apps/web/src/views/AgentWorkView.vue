<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftIcon, RefreshCwIcon } from '@lucide/vue'
import type { AgentWork, RunEvent, RunSnapshot, RunSummary } from '@ateam/shared'
import { AgentApi, RunApi, RunDetailApi } from '../api'
import SectionCard from '../components/SectionCard.vue'
import EmptyState from '../components/EmptyState.vue'
import { Badge, type BadgeTone } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'

const props = defineProps<{ id: string }>()

const { t } = useI18n()
const work = ref<AgentWork | null>(null)
const loadError = ref('')
const loading = ref(true)
const selectedRunId = ref('')
const events = ref<RunEvent[]>([])
const eventsLoading = ref(false)
const typeFilter = ref('all')
const snapshot = ref<RunSnapshot | null>(null)
const snapshotMissing = ref(false)

const activeRuns = computed(() => work.value?.activeRuns ?? [])
const recentRuns = computed(() => work.value?.recentRuns ?? [])
const selectedRun = computed<RunSummary | null>(() => {
  for (const run of activeRuns.value) {
    if (run.id === selectedRunId.value) return run
  }
  return recentRuns.value.find((run) => run.id === selectedRunId.value) ?? null
})

const workTone = computed<BadgeTone>(() => {
  switch (work.value?.workStatus) {
    case 'working':
      return 'brand'
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
})

const eventTypes = computed(() => {
  const counts = new Map<string, number>()
  for (const event of events.value) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }))
})

const filteredEvents = computed(() => {
  if (typeFilter.value === 'all') {
    return events.value
  }
  return events.value.filter((event) => event.type === typeFilter.value)
})

async function loadWork() {
  loading.value = true
  try {
    work.value = await AgentApi.work(props.id)
    loadError.value = ''
    const preferred = activeRuns.value[0]?.id ?? work.value.lastRun?.id ?? recentRuns.value[0]?.id ?? ''
    if (preferred) {
      await selectRun(preferred)
    } else {
      selectedRunId.value = ''
      events.value = []
      snapshot.value = null
      snapshotMissing.value = false
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function selectRun(runId: string) {
  selectedRunId.value = runId
  snapshot.value = null
  snapshotMissing.value = false
  eventsLoading.value = true
  try {
    const [eventList, snapshotResult] = await Promise.allSettled([
      RunApi.listEvents(runId),
      RunDetailApi.snapshot(runId),
    ])
    events.value = eventList.status === 'fulfilled' ? eventList.value : []
    if (snapshotResult.status === 'fulfilled') {
      snapshot.value = snapshotResult.value
      snapshotMissing.value = false
    } else {
      snapshot.value = null
      snapshotMissing.value = true
    }
  } finally {
    eventsLoading.value = false
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-[var(--cd-color-success)]'
    case 'running':
    case 'preparing':
    case 'queued':
      return 'bg-[var(--cd-color-accent)]'
    case 'failed':
    case 'cancelled':
      return 'bg-[var(--cd-color-danger)]'
    default:
      return 'bg-[var(--cd-color-neutral)]'
  }
}

function runCaption(run: RunSummary): string {
  return [run.phase, run.branch].filter(Boolean).join(' · ') || '—'
}

function formatDuration(run: RunSummary): string {
  if (!run.durationMs || run.durationMs <= 0) return '—'
  const seconds = Math.round(run.durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

watch(
  () => props.id,
  () => {
    void loadWork()
  },
)

onMounted(() => {
  void loadWork()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="sm" variant="outline" @click="loadWork">
        <RefreshCwIcon class="size-4" />
        {{ $t('common.refresh') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <div v-if="loading && !work" class="flex flex-col gap-3">
        <Skeleton class="h-7 w-64" />
        <div class="grid gap-4 xl:grid-cols-2">
          <Skeleton class="h-40 w-full" />
          <Skeleton class="h-40 w-full" />
          <Skeleton class="h-40 w-full" />
          <Skeleton class="h-40 w-full" />
        </div>
      </div>

      <EmptyState
        v-else-if="!loading && loadError"
        :title="$t('work.loadFailed')"
        :description="loadError"
      />
      <EmptyState
        v-else-if="!loading && work && work.counts.active === 0 && recentRuns.length === 0"
        :title="$t('work.emptyTitle')"
        :description="$t('work.emptyDesc')"
      />

      <div v-else class="space-y-4">
        <header class="min-w-0">
          <router-link
            to="/agents"
            class="inline-flex items-center gap-1 text-caption text-fg-subtle transition-colors hover:text-fg-muted"
          >
            <ArrowLeftIcon class="size-3.5" />
            {{ $t('work.back') }}
          </router-link>
          <div class="mt-1 flex items-center gap-2">
            <h1 class="truncate text-title font-semibold tracking-tight">
              {{ work?.agent.name || props.id }}
            </h1>
            <Badge v-if="work" :tone="workTone">{{ $t(`work.status.${work.workStatus}`) }}</Badge>
          </div>
          <p class="mt-0.5 text-caption text-fg-subtle">
            <span>{{ work?.agent.runtime }}</span>
            <span v-if="work?.agent.model"> · {{ work.agent.model }}</span>
            <span v-if="work"> · {{ $t('work.activeCount', { n: work.counts.active }) }}</span>
          </p>
        </header>

        <div class="grid items-start gap-4 xl:grid-cols-2">
          <SectionCard :title="$t('work.currentWork')">
            <EmptyState v-if="activeRuns.length === 0" :title="$t('work.noActiveWork')" />
            <div v-else class="flex flex-col">
              <router-link
                v-for="run in activeRuns"
                :key="run.id"
                :to="`/runs/${run.id}`"
                class="-mx-2 flex h-8 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2 transition-colors hover:bg-[var(--cd-color-hover)]"
              >
                <span class="size-2 shrink-0 rounded-full" :class="statusDotClass(run.status)" />
                <span class="sr-only">{{ $t(`common.status.run.${run.status}`) }}</span>
                <span class="min-w-0 flex-1 truncate text-label">{{ run.taskTitle || run.taskId }}</span>
                <span class="max-w-[45%] shrink-0 truncate text-caption text-fg-subtle">
                  {{ runCaption(run) }}
                </span>
              </router-link>
            </div>
          </SectionCard>

          <SectionCard :title="$t('work.context')">
            <p v-if="!selectedRun" class="text-caption text-fg-subtle">{{ $t('work.selectRunHint') }}</p>
            <template v-else>
              <dl class="text-label">
                <div class="flex h-8 items-center justify-between gap-3">
                  <dt class="shrink-0 text-fg-subtle">{{ $t('work.task') }}</dt>
                  <dd class="truncate text-fg-muted">{{ selectedRun.taskTitle || selectedRun.taskId }}</dd>
                </div>
                <div class="flex h-8 items-center justify-between gap-3">
                  <dt class="shrink-0 text-fg-subtle">{{ $t('work.branch') }}</dt>
                  <dd class="truncate font-mono text-caption text-fg-muted">{{ selectedRun.branch || '—' }}</dd>
                </div>
                <div class="flex h-8 items-center justify-between gap-3">
                  <dt class="shrink-0 text-fg-subtle">{{ $t('work.headCommit') }}</dt>
                  <dd class="truncate font-mono text-caption text-fg-muted">{{ selectedRun.headCommit || '—' }}</dd>
                </div>
                <div v-if="snapshot" class="flex h-8 items-center justify-between gap-3">
                  <dt class="shrink-0 text-fg-subtle">{{ $t('work.permissionMode') }}</dt>
                  <dd class="truncate text-fg-muted">{{ snapshot.permissionMode }}</dd>
                </div>
                <div v-if="snapshot" class="flex h-8 items-center justify-between gap-3">
                  <dt class="shrink-0 text-fg-subtle">{{ $t('work.promptHash') }}</dt>
                  <dd class="truncate font-mono text-caption text-fg-muted">{{ snapshot.promptHash || '—' }}</dd>
                </div>
              </dl>
              <p v-if="snapshotMissing" class="mt-2 text-caption text-fg-subtle">{{ $t('work.snapshotMissing') }}</p>
            </template>
          </SectionCard>

          <SectionCard :title="$t('work.timeline')">
            <template #actions>
              <el-select v-model="typeFilter" size="small" style="width: 160px">
                <el-option :label="$t('work.filterAll')" value="all" />
                <el-option
                  v-for="item in eventTypes"
                  :key="item.type"
                  :label="`${item.type} (${item.count})`"
                  :value="item.type"
                />
              </el-select>
            </template>
            <p v-if="!selectedRun" class="text-caption text-fg-subtle">{{ $t('work.selectRunHint') }}</p>
            <p v-else-if="eventsLoading" class="text-caption text-fg-subtle">{{ $t('work.loadingEvents') }}</p>
            <p v-else-if="filteredEvents.length === 0" class="text-caption text-fg-subtle">{{ $t('work.noEvents') }}</p>
            <div
              v-else
              class="max-h-72 overflow-y-auto rounded-[var(--cd-radius-md)] border border-border-subtle bg-sunken px-3 py-1"
            >
              <div
                v-for="event in filteredEvents"
                :key="`${event.seq}-${event.id}`"
                class="flex items-start gap-2 border-b border-border-subtle/60 py-2 last:border-0"
              >
                <span class="w-8 shrink-0 text-right font-mono text-caption text-fg-subtle tabular-nums">{{ event.seq }}</span>
                <span class="shrink-0"><Badge :tone="event.level === 'error' ? 'danger' : 'neutral'">{{ event.type }}</Badge></span>
                <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-fg-muted">{{ event.message || '—' }}</span>
              </div>
            </div>
            <router-link
              v-if="selectedRun"
              class="mt-2 inline-block text-caption text-fg-muted underline underline-offset-4 transition-colors hover:text-foreground"
              :to="`/runs/${selectedRun.id}`"
            >
              {{ $t('work.openRunDetail') }}
            </router-link>
          </SectionCard>

          <SectionCard :title="$t('work.history')">
            <EmptyState v-if="recentRuns.length === 0" :title="$t('work.noHistory')" />
            <div v-else class="flex flex-col">
              <button
                v-for="run in recentRuns"
                :key="run.id"
                type="button"
                class="-mx-2 flex h-8 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2 text-left transition-colors hover:bg-[var(--cd-color-hover)]"
                :class="{ 'bg-[var(--cd-color-selected-bg)]': run.id === selectedRunId }"
                :aria-pressed="run.id === selectedRunId"
                @click="selectRun(run.id)"
              >
                <span class="size-2 shrink-0 rounded-full" :class="statusDotClass(run.status)" />
                <span class="sr-only">{{ $t(`common.status.run.${run.status}`) }}</span>
                <span class="min-w-0 flex-1 truncate text-label">{{ run.taskTitle || run.taskId }}</span>
                <span class="hidden max-w-[40%] shrink-0 truncate text-caption text-fg-subtle sm:block">
                  {{ runCaption(run) }}
                </span>
                <span class="shrink-0 text-caption text-fg-subtle tabular-nums">{{ formatDuration(run) }}</span>
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  </div>
</template>
