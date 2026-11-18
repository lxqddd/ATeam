<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import type { AgentWork, RunEvent, RunSnapshot, RunSummary } from '@ateam/shared'
import { AgentApi, RunApi, RunDetailApi } from '../api'
import EmptyState from '../components/EmptyState.vue'

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

const statusTagType = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
  switch (work.value?.workStatus) {
    case 'working':
      return 'warning'
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'info'
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

function statusTagFor(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
    case 'preparing':
    case 'queued':
      return 'warning'
    case 'failed':
    case 'cancelled':
      return 'danger'
    default:
      return 'info'
  }
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
  <div class="flex flex-col h-full">
    <header class="shrink-0 flex items-center justify-between px-6 pt-5 pb-4">
      <div class="flex items-center gap-3">
        <el-button text :icon="ArrowLeft" @click="$router.push('/agents')">
          {{ $t('work.back') }}
        </el-button>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-title font-semibold tracking-tight">{{ work?.agent.name || props.id }}</h1>
            <el-tag v-if="work" :type="statusTagType" size="small">
              {{ $t(`work.status.${work.workStatus}`) }}
            </el-tag>
          </div>
          <p class="text-caption text-fg-subtle mt-0.5">
            <span>{{ work?.agent.runtime }}</span>
            <span v-if="work?.agent.model"> · {{ work.agent.model }}</span>
            <span v-if="work"> · {{ $t('work.activeCount', { n: work.counts.active }) }}</span>
          </p>
        </div>
      </div>
      <el-button text :icon="Refresh" @click="loadWork">{{ $t('common.refresh') }}</el-button>
    </header>

    <EmptyState
      v-if="!loading && loadError"
      :title="$t('work.loadFailed')"
      :description="loadError"
    />
    <EmptyState
      v-else-if="!loading && work && work.counts.active === 0 && recentRuns.length === 0"
      :title="$t('work.emptyTitle')"
      :description="$t('work.emptyDesc')"
    />

    <div v-else class="flex-1 overflow-y-auto px-6 pb-6 grid gap-4 xl:grid-cols-2">
      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('work.currentWork') }}</span>
        </template>
        <p v-if="activeRuns.length === 0" class="text-caption text-fg-subtle">
          {{ $t('work.noActiveWork') }}
        </p>
        <div v-for="run in activeRuns" :key="run.id" class="mb-2">
          <div class="flex items-center gap-2">
            <el-tag :type="statusTagFor(run.status)" size="small">{{ run.status }}</el-tag>
            <span class="text-label">{{ run.taskTitle || run.taskId }}</span>
          </div>
          <p class="text-caption text-fg-subtle mt-1">
            {{ run.phase }} · {{ run.branch || '—' }}
            <router-link class="underline ml-1" :to="`/runs/${run.id}`">{{ $t('work.openRun') }}</router-link>
          </p>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('work.context') }}</span>
        </template>
        <p v-if="!selectedRun" class="text-caption text-fg-subtle">{{ $t('work.selectRunHint') }}</p>
        <template v-else>
          <el-descriptions :column="1" size="small" class="mt-1">
            <el-descriptions-item :label="$t('work.task')">{{ selectedRun.taskTitle || selectedRun.taskId }}</el-descriptions-item>
            <el-descriptions-item :label="$t('work.branch')">{{ selectedRun.branch || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="$t('work.headCommit')">{{ selectedRun.headCommit || '—' }}</el-descriptions-item>
            <el-descriptions-item v-if="snapshot" :label="$t('work.permissionMode')">{{ snapshot.permissionMode }}</el-descriptions-item>
            <el-descriptions-item v-if="snapshot" :label="$t('work.promptHash')">
              <span class="font-mono text-caption">{{ snapshot.promptHash || '—' }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <p v-if="snapshotMissing" class="text-caption text-fg-subtle">{{ $t('work.snapshotMissing') }}</p>
        </template>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="text-label font-semibold">{{ $t('work.timeline') }}</span>
            <el-select v-model="typeFilter" size="small" style="width: 160px">
              <el-option :label="$t('work.filterAll')" value="all" />
              <el-option
                v-for="item in eventTypes"
                :key="item.type"
                :label="`${item.type} (${item.count})`"
                :value="item.type"
              />
            </el-select>
          </div>
        </template>
        <p v-if="!selectedRun" class="text-caption text-fg-subtle">{{ $t('work.selectRunHint') }}</p>
        <p v-else-if="eventsLoading" class="text-caption text-fg-subtle">{{ $t('work.loadingEvents') }}</p>
        <p v-else-if="filteredEvents.length === 0" class="text-caption text-fg-subtle">{{ $t('work.noEvents') }}</p>
        <div v-else class="max-h-72 overflow-y-auto">
          <div
            v-for="event in filteredEvents"
            :key="`${event.seq}-${event.id}`"
            class="flex items-start gap-2 py-1 border-b border-white/5 last:border-b-0"
          >
            <span class="text-caption text-fg-subtle w-16 shrink-0">{{ event.type }}</span>
            <span class="text-caption text-fg-muted flex-1 break-all">{{ event.message || '—' }}</span>
          </div>
        </div>
        <router-link
          v-if="selectedRun"
          class="underline text-caption mt-2 inline-block"
          :to="`/runs/${selectedRun.id}`"
        >
          {{ $t('work.openRunDetail') }}
        </router-link>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('work.history') }}</span>
        </template>
        <p v-if="recentRuns.length === 0" class="text-caption text-fg-subtle">{{ $t('work.noHistory') }}</p>
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="run in recentRuns"
            :key="run.id"
            type="button"
            class="text-left rounded-md px-2 py-1.5 hover:bg-white/5"
            :class="{ 'bg-white/10': run.id === selectedRunId }"
            @click="selectRun(run.id)"
          >
            <div class="flex items-center gap-2">
              <el-tag :type="statusTagFor(run.status)" size="small">{{ run.status }}</el-tag>
              <span class="text-label truncate">{{ run.taskTitle || run.taskId }}</span>
              <span class="text-caption text-fg-subtle ml-auto shrink-0">{{ formatDuration(run) }}</span>
            </div>
            <p class="text-caption text-fg-subtle mt-0.5">
              {{ $t('work.artifacts', { n: run.artifactCount }) }}
              <span v-if="run.reviewDone"> · {{ $t('work.reviewed') }}</span>
            </p>
          </button>
        </div>
      </el-card>
    </div>
  </div>
</template>
