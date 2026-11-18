<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { VideoPlay } from '@element-plus/icons-vue'
import {
  TASK_STATUSES,
  type Review,
  type Run,
  type RunEvent,
  type Task,
  type TaskArtifactsResponse,
  type TaskDependenciesResponse,
  type TaskStatus,
} from '@ateam/shared'
import { ArtifactApi, ReviewApi, RunApi, TaskApi } from '../api'
import { useAgentsStore } from '../stores/agents'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'
import SectionCard from '../components/SectionCard.vue'
import EmptyState from '../components/EmptyState.vue'
import { Skeleton } from '../components/ui/skeleton'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Loader } from '@/components/ai-elements/loader'

const route = useRoute()
const router = useRouter()
const tasks = useTasksStore()
const agents = useAgentsStore()
const { t, d } = useI18n()

const task = ref<Task | null>(null)
const runs = ref<Run[]>([])
const selectedRun = ref<Run | null>(null)
const events = ref<RunEvent[]>([])
const selectedAgentId = ref('')
const taskEvidence = ref<TaskArtifactsResponse | null>(null)
const latestReview = ref<Review | null>(null)
const dependencies = ref<TaskDependenciesResponse | null>(null)
const loading = ref(true)
let timer: number | undefined

const taskId = computed(() => String(route.params.id))
const readiness = computed(() => dependencies.value?.readiness ?? null)
const dependencyBlocked = computed(() => !!readiness.value && !readiness.value.ready)
const canRun = computed(
  () => !!task.value && ['todo', 'in_progress', 'in_review'].includes(task.value.status) && !dependencyBlocked.value,
)
const isRunActive = computed(
  () => !!selectedRun.value && ['queued', 'preparing', 'running'].includes(selectedRun.value.status),
)
const latestRun = computed(() => runs.value[0] ?? null)

async function loadReviewPanel() {
  taskEvidence.value = await ArtifactApi.listByTask(taskId.value).catch(() => null)
  latestReview.value = null
  if (latestRun.value) {
    const reviews = await ReviewApi.listByRun(latestRun.value.id).catch(() => [])
    latestReview.value =
      reviews.find((review) => review.status === 'approved' && !review.supersededBy) ??
      reviews[0] ??
      null
  }
}

async function load() {
  loading.value = true
  try {
    task.value = await TaskApi.get(taskId.value)
    runs.value = await RunApi.listByTask(taskId.value)
    dependencies.value = await TaskApi.dependencies(taskId.value).catch(() => null)
    if (tasks.items.length === 0 || !tasks.items.some((item) => item.id === taskId.value)) {
      await tasks.fetchAll()
    }
    if (agents.items.length === 0) {
      await agents.fetchAll()
    }
    if (!selectedAgentId.value) {
      selectedAgentId.value = agents.items[0]?.id ?? ''
    }
    if (!selectedRun.value && runs.value.length > 0) {
      await selectRun(runs.value[0])
    }
    await loadReviewPanel()
  } catch {
    task.value = null
  } finally {
    loading.value = false
  }
}

async function selectRun(run: Run) {
  selectedRun.value = run
  events.value = await RunApi.listEvents(run.id)
}

async function refreshRuns() {
  runs.value = await RunApi.listByTask(taskId.value)
  if (selectedRun.value) {
    const updated = runs.value.find((run) => run.id === selectedRun.value?.id)
    if (updated) {
      selectedRun.value = updated
      events.value = await RunApi.listEvents(updated.id)
    }
  }
}

async function startRun() {
  if (!task.value || !selectedAgentId.value) {
    return
  }
  const run = await RunApi.start(task.value.id, { agentId: selectedAgentId.value })
  runs.value = [run, ...runs.value]
  await selectRun(run)
  task.value = await TaskApi.get(task.value.id)
  await tasks.fetchAll()
  await loadReviewPanel()
}

async function updateStatus(status: TaskStatus) {
  if (!task.value) {
    return
  }
  task.value = await TaskApi.update(task.value.id, { status })
  await tasks.fetchAll()
}

function onStatusChange(value: TaskStatus) {
  void updateStatus(value)
}

async function cancelRun(run: Run | null) {
  if (!run) {
    return
  }
  await RunApi.cancel(run.id)
  await refreshRuns()
}

const dependencyCandidate = ref('')
const dependencyCandidates = computed(() =>
  tasks.items.filter(
    (candidate) =>
      candidate.id !== taskId.value &&
      !dependencies.value?.outgoing.some((dependency) => dependency.dependsOnTaskId === candidate.id),
  ),
)

function taskTitle(id: string): string {
  return tasks.items.find((task) => task.id === id)?.title ?? ''
}

function taskStatus(id: string): string {
  return tasks.items.find((task) => task.id === id)?.status ?? ''
}

async function addDependency() {
  if (!task.value || !dependencyCandidate.value) {
    return
  }
  const current = (dependencies.value?.outgoing ?? []).map((dependency) => ({
    dependsOnTaskId: dependency.dependsOnTaskId,
  }))
  dependencies.value = await TaskApi.replaceDependencies(task.value.id, [
    ...current,
    { dependsOnTaskId: dependencyCandidate.value },
  ])
  dependencyCandidate.value = ''
  await tasks.fetchAll()
}

async function removeDependency(dependsOnTaskId: string) {
  if (!task.value) {
    return
  }
  const remaining = (dependencies.value?.outgoing ?? [])
    .filter((dependency) => dependency.dependsOnTaskId !== dependsOnTaskId)
    .map((dependency) => ({ dependsOnTaskId: dependency.dependsOnTaskId }))
  dependencies.value = await TaskApi.replaceDependencies(task.value.id, remaining)
  await tasks.fetchAll()
}

watch(
  () => route.params.id,
  () => {
    selectedRun.value = null
    events.value = []
    void load()
  },
)

onMounted(() => {
  void load()
  timer = window.setInterval(() => {
    if (runs.value.some((run) => ['queued', 'preparing', 'running'].includes(run.status))) {
      void refreshRuns()
    }
  }, 1500)
})

onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer)
  }
})
</script>

<template>
  <Teleport to="#titlebar-actions">
    <el-select
      v-if="task && !loading"
      :model-value="task.status"
      :aria-label="$t('runDetail.status')"
      style="width: 144px"
      @change="onStatusChange"
    >
      <el-option
        v-for="status in TASK_STATUSES"
        :key="status.value"
        :label="$t(`common.status.task.${status.value}`)"
        :value="status.value"
      />
    </el-select>
  </Teleport>

  <div v-if="loading" class="p-6">
    <div class="flex flex-col gap-3">
      <Skeleton class="h-6 w-64" />
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-40 w-full" />
    </div>
  </div>

  <div v-else-if="!task" class="flex flex-1 items-center justify-center p-6">
    <EmptyState :title="$t('task.notFound')">
      <Button size="lg" @click="router.push('/')">{{ $t('task.backToBoard') }}</Button>
    </EmptyState>
  </div>

  <div v-else class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
    <div class="grid max-w-[1440px] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
      <!-- 左栏：上下文 + 描述 -->
      <section class="space-y-4">
        <SectionCard :title="$t('task.context')">
          <dl class="text-label">
            <div class="flex h-8 items-center justify-between gap-3">
              <dt class="text-fg-subtle">{{ $t('task.idLabel') }}</dt>
              <dd class="truncate font-mono text-fg-muted">{{ task.id }}</dd>
            </div>
            <div class="flex h-8 items-center justify-between gap-3">
              <dt class="text-fg-subtle">{{ $t('runDetail.status') }}</dt>
              <dd><StatusBadge :status="task.status" /></dd>
            </div>
            <div class="flex h-8 items-center justify-between gap-3">
              <dt class="text-fg-subtle">{{ $t('runDetail.created') }}</dt>
              <dd class="text-fg-muted">{{ d(new Date(task.createdAt), 'long') }}</dd>
            </div>
            <div class="flex h-8 items-center justify-between gap-3">
              <dt class="text-fg-subtle">{{ $t('task.assigneeLabel') }}</dt>
              <dd class="truncate text-fg-muted">{{ task.assigneeId || '—' }}</dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard :title="$t('task.description')">
          <p class="whitespace-pre-wrap text-body text-fg-muted">
            {{ task.description || $t('task.noDescription') }}
          </p>
        </SectionCard>
      </section>

      <!-- 中栏：Run 启动器 + Run 列表 + 依赖 -->
      <section class="space-y-4">
        <SectionCard :title="$t('task.runs')">
          <div class="flex flex-wrap items-center gap-2">
            <el-select v-model="selectedAgentId" style="width: 220px" :placeholder="$t('task.selectAgent')">
              <el-option
                v-for="agent in agents.items"
                :key="agent.id"
                :label="`${agent.name} · ${agent.runtime}`"
                :value="agent.id"
              />
            </el-select>
            <Button :disabled="!canRun || !selectedAgentId" @click="startRun">
              <VideoPlay />
              {{ $t('common.run') }}
            </Button>
            <Button v-if="isRunActive" variant="destructive" @click="cancelRun(selectedRun)">
              {{ $t('common.cancel') }}
            </Button>
          </div>

          <p
            v-if="!canRun && !dependencyBlocked"
            class="mt-3 rounded-[var(--cd-radius-md)] border border-warning-border bg-warning-soft px-3 py-2 text-caption text-warning"
          >
            {{ $t('task.moveHint') }}
          </p>
          <p
            v-if="dependencyBlocked && readiness"
            class="mt-3 rounded-[var(--cd-radius-md)] border border-warning-border bg-warning-soft px-3 py-2 text-caption text-warning"
          >
            {{ $t('task.dependenciesNotSatisfied') }}
            <span class="mt-0.5 block text-fg-subtle">{{ readiness.reasons.join('；') }}</span>
          </p>

          <EmptyState v-if="runs.length === 0" :title="$t('task.noRuns')" class="mt-2" />
          <div v-else class="mt-3 space-y-2">
            <div
              v-for="run in runs"
              :key="run.id"
              role="button"
              tabindex="0"
              class="cursor-pointer rounded-[var(--cd-radius-md)] border border-border-subtle px-3 py-2 transition-colors hover:border-border-strong"
              :class="{ 'ring-1 ring-primary/40': selectedRun?.id === run.id }"
              @click="selectRun(run)"
              @keydown.enter="selectRun(run)"
              @keydown.space.prevent="selectRun(run)"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <StatusBadge :status="run.status" kind="run" />
                  <Badge tone="neutral">{{ run.trigger }}</Badge>
                  <Button variant="ghost" size="xs" @click.stop="router.push(`/runs/${run.id}`)" @keydown.stop>
                    {{ $t('runDetail.title') }}
                  </Button>
                </div>
                <span class="shrink-0 text-caption text-fg-subtle">
                  {{ d(new Date(run.createdAt), 'long') }}
                </span>
              </div>
              <div v-if="run.summary" class="mt-1 text-caption text-fg-muted">{{ run.summary }}</div>
              <div v-if="run.error" class="mt-1 text-caption text-danger">{{ run.error }}</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard :title="$t('task.dependencies')">
          <template #actions>
            <Badge v-if="readiness" :tone="readiness.ready ? 'success' : 'warning'">
              {{ readiness.ready ? $t('task.dependenciesReady') : $t('task.dependenciesWaiting') }}
            </Badge>
          </template>

          <p v-if="!dependencies || dependencies.outgoing.length === 0" class="text-caption text-fg-subtle">
            {{ $t('task.noDependencies') }}
          </p>
          <div v-else class="space-y-1">
            <div
              v-for="dependency in dependencies.outgoing"
              :key="dependency.dependsOnTaskId"
              class="flex h-8 items-center gap-2"
            >
              <Badge :tone="taskStatus(dependency.dependsOnTaskId) === 'done' ? 'success' : 'warning'">
                {{ $t('common.status.task.' + taskStatus(dependency.dependsOnTaskId)) }}
              </Badge>
              <span class="min-w-0 flex-1 truncate text-label">
                {{ taskTitle(dependency.dependsOnTaskId) || dependency.dependsOnTaskId }}
              </span>
              <Button variant="destructive" size="xs" @click="removeDependency(dependency.dependsOnTaskId)">
                {{ $t('common.delete') }}
              </Button>
            </div>
          </div>

          <div class="mt-3 flex items-center gap-2">
            <el-select
              v-model="dependencyCandidate"
              size="small"
              style="width: 200px"
              clearable
              filterable
              :placeholder="$t('task.addDependencyPlaceholder')"
            >
              <el-option
                v-for="candidate in dependencyCandidates"
                :key="candidate.id"
                :label="candidate.title"
                :value="candidate.id"
              />
            </el-select>
            <Button size="sm" variant="outline" :disabled="!dependencyCandidate" @click="addDependency">
              {{ $t('task.addDependency') }}
            </Button>
          </div>

          <template v-if="dependencies && dependencies.incoming.length > 0">
            <p class="mt-3 text-caption text-fg-subtle">{{ $t('task.incomingDependencies') }}</p>
            <p v-for="dependency in dependencies.incoming" :key="dependency.taskId" class="text-caption">
              {{ taskTitle(dependency.taskId) || dependency.taskId }}
            </p>
          </template>
        </SectionCard>
      </section>

      <!-- 右栏：事件 + 评审 -->
      <section class="space-y-4">
        <SectionCard :title="$t('task.runLog')" :description="selectedRun ? selectedRun.id.slice(0, 8) : undefined">
          <EmptyState
            v-if="!selectedRun"
            :title="$t('task.noEventsTitle')"
            :description="$t('task.noEventsDesc')"
          />
          <div v-else class="h-[360px] overflow-y-auto rounded-[var(--cd-radius-md)] border border-border-subtle bg-sunken px-3 py-1">
            <div
              v-if="events.length === 0 && !isRunActive"
              class="flex size-full flex-col items-center justify-center gap-2 p-8 text-center"
            >
              <h3 class="text-body font-semibold">{{ $t('task.noEventsTitle') }}</h3>
              <p class="text-label text-fg-subtle">{{ $t('task.noEventsDesc') }}</p>
            </div>
            <div
              v-for="event in events"
              :key="`${event.runId}-${event.seq}`"
              class="flex items-start gap-2 border-b border-border-subtle/60 py-2 last:border-0"
            >
              <span class="w-8 shrink-0 text-right font-mono text-caption text-fg-subtle tabular-nums">{{ event.seq }}</span>
              <span class="shrink-0"><Badge :tone="event.level === 'error' ? 'danger' : 'neutral'">{{ event.type }}</Badge></span>
              <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-fg-muted">{{ event.message }}</span>
            </div>
            <div v-if="isRunActive" class="flex items-center gap-2 py-2">
              <Loader :size="14" />
            </div>
          </div>
        </SectionCard>

        <SectionCard :title="$t('task.reviewPanel')">
          <div v-if="taskEvidence" class="space-y-2 text-label">
            <div class="flex h-8 items-center justify-between gap-3">
              <span class="text-fg-subtle">{{ $t('task.dodLabel') }}</span>
              <Badge :tone="taskEvidence.dod.satisfied ? 'success' : 'warning'">
                {{ taskEvidence.dod.satisfied ? $t('runDetail.dodSatisfied') : $t('runDetail.dodMissing') }}
              </Badge>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Badge
                v-for="required in taskEvidence.dod.required"
                :key="required"
                :tone="taskEvidence.dod.present[required] ? 'success' : 'danger'"
              >
                {{ required }}
              </Badge>
            </div>
          </div>
          <p v-else class="text-caption text-fg-subtle">{{ $t('runDetail.evidenceEmpty') }}</p>

          <div class="mt-3 space-y-1 text-label">
            <div class="flex h-8 items-center justify-between gap-3">
              <span class="text-fg-subtle">{{ $t('task.reviewStatus') }}</span>
              <Badge v-if="latestReview" tone="neutral">{{ latestReview.status }}</Badge>
              <span v-else class="text-caption text-fg-subtle">—</span>
            </div>
            <p v-if="latestReview?.decisionNote" class="whitespace-pre-wrap text-caption text-fg-muted">
              {{ latestReview.decisionNote }}
            </p>
          </div>

          <Button v-if="latestRun" variant="outline" class="mt-3" @click="router.push(`/runs/${latestRun.id}`)">
            {{ $t('task.openRun') }}
          </Button>
          <p v-else class="mt-3 text-caption text-fg-subtle">{{ $t('task.noRuns') }}</p>
        </SectionCard>
      </section>
    </div>
  </div>
</template>
