<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, VideoPlay } from '@element-plus/icons-vue'
import {
  TASK_STATUSES,
  type Run,
  type RunEvent,
  type Task,
  type TaskStatus,
} from '@ateam/shared'
import { RunApi, TaskApi } from '../api'
import { useAgentsStore } from '../stores/agents'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'
import Message from '@/components/ai-elements/message/Message.vue'
import MessageContent from '@/components/ai-elements/message/MessageContent.vue'
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
const loading = ref(true)
let timer: number | undefined

const taskId = computed(() => String(route.params.id))
const canRun = computed(
  () => !!task.value && ['todo', 'in_progress', 'in_review'].includes(task.value.status),
)
const isRunActive = computed(
  () => !!selectedRun.value && ['queued', 'preparing', 'running'].includes(selectedRun.value.status),
)

async function load() {
  loading.value = true
  try {
    task.value = await TaskApi.get(taskId.value)
    runs.value = await RunApi.listByTask(taskId.value)
    if (agents.items.length === 0) {
      await agents.fetchAll()
    }
    if (!selectedAgentId.value) {
      selectedAgentId.value = agents.items[0]?.id ?? ''
    }
    if (!selectedRun.value && runs.value.length > 0) {
      await selectRun(runs.value[0])
    }
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

watch(
  () => route.params.id,
  () => {
    selectedRun.value = null
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
  <div v-if="loading" class="p-6">
    <el-skeleton :rows="4" animated />
  </div>

  <div v-else-if="!task" class="p-6">
    <el-empty :description="$t('task.notFound')">
      <el-button @click="router.push('/')">{{ $t('task.backToBoard') }}</el-button>
    </el-empty>
  </div>

  <div v-else class="flex flex-col h-full">
    <header class="shrink-0 flex items-center justify-between px-6 pt-4 pb-3 gap-3">
      <div class="min-w-0 flex-1 flex items-center gap-3">
        <el-button :icon="ArrowLeft" text @click="router.push('/')">{{ $t('task.back') }}</el-button>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-caption text-fg-subtle">{{ task.id }}</span>
            <StatusBadge :status="task.status" />
          </div>
          <h1 class="text-body font-semibold truncate">{{ task.title }}</h1>
        </div>
      </div>
      <el-select :model-value="task.status" style="width: 144px" @change="onStatusChange">
        <el-option
          v-for="status in TASK_STATUSES"
          :key="status.value"
          :label="$t(`common.status.task.${status.value}`)"
          :value="status.value"
        />
      </el-select>
    </header>

    <div class="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('task.description') }}</span>
        </template>
        <p class="text-body text-fg-muted whitespace-pre-wrap">
          {{ task.description || $t('task.noDescription') }}
        </p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span class="text-label font-semibold">{{ $t('task.runs') }}</span>
            <div class="flex items-center gap-2">
              <el-select v-model="selectedAgentId" style="width: 220px" :placeholder="$t('task.selectAgent')">
                <el-option
                  v-for="agent in agents.items"
                  :key="agent.id"
                  :label="`${agent.name} · ${agent.runtime}`"
                  :value="agent.id"
                />
              </el-select>
              <el-button
                type="primary"
                :icon="VideoPlay"
                :disabled="!canRun || !selectedAgentId"
                @click="startRun"
              >
                {{ $t('common.run') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-alert
          v-if="!canRun"
          :title="$t('task.moveHint')"
          type="warning"
          :closable="false"
          show-icon
          class="mb-3"
        />

        <el-empty v-if="runs.length === 0" :description="$t('task.noRuns')" :image-size="48" />

        <div v-else class="space-y-2">
          <el-card
            v-for="run in runs"
            :key="run.id"
            shadow="hover"
            :body-style="{ padding: '10px' }"
            class="cursor-pointer"
            :class="{ 'ring-1 ring-primary/40': selectedRun?.id === run.id }"
            @click="selectRun(run)"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <StatusBadge :status="run.status" kind="run" />
                <el-tag size="small" effect="plain" type="info">{{ run.trigger }}</el-tag>
              </div>
              <span class="text-caption text-fg-subtle">
                {{ d(new Date(run.createdAt), 'long') }}
              </span>
            </div>
            <div v-if="run.summary" class="text-caption text-fg-muted mt-1">
              {{ run.summary }}
            </div>
            <div v-if="run.error" class="text-caption text-danger mt-1">{{ run.error }}</div>
          </el-card>
        </div>
      </el-card>

      <el-card v-if="selectedRun" shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="text-label font-semibold">
              {{ $t('task.runLog') }} · {{ selectedRun.id.slice(0, 8) }}
            </span>
            <el-button
              v-if="isRunActive"
              type="danger"
              plain
              size="small"
              @click="cancelRun(selectedRun)"
            >
              {{ $t('common.cancel') }}
            </el-button>
          </div>
        </template>

        <div class="h-[360px] overflow-y-auto rounded-md border border-border bg-sunken p-3 space-y-2">
          <div
            v-if="events.length === 0 && !isRunActive"
            class="flex size-full flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <h3 class="text-body font-semibold">{{ $t('task.noEventsTitle') }}</h3>
            <p class="text-label text-fg-subtle">{{ $t('task.noEventsDesc') }}</p>
          </div>
          <Message v-for="event in events" :key="`${event.runId}-${event.seq}`" from="assistant">
            <MessageContent>
              <div class="text-caption uppercase tracking-wide text-fg-subtle">
                {{ event.type }}
              </div>
              <pre class="whitespace-pre-wrap text-label text-fg-muted">{{ event.message }}</pre>
            </MessageContent>
          </Message>
          <Message v-if="isRunActive" from="assistant">
            <MessageContent>
              <Loader :size="14" />
            </MessageContent>
          </Message>
        </div>
      </el-card>
    </div>
  </div>
</template>
