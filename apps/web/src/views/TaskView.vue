<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Run,
  type RunEvent,
  type Task,
  type TaskStatus,
} from '@ateam/shared'
import { api } from '../api'
import { useAgentsStore } from '../stores/agents'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const router = useRouter()
const tasks = useTasksStore()
const agents = useAgentsStore()

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

async function load() {
  loading.value = true
  try {
    task.value = await api.getTask(taskId.value)
    runs.value = await api.listRunsByTask(taskId.value)
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
  events.value = await api.listRunEvents(run.id)
}

async function refreshRuns() {
  runs.value = await api.listRunsByTask(taskId.value)
  if (selectedRun.value) {
    const updated = runs.value.find((run) => run.id === selectedRun.value?.id)
    if (updated) {
      selectedRun.value = updated
      events.value = await api.listRunEvents(updated.id)
    }
  }
}

async function startRun() {
  if (!task.value || !selectedAgentId.value) {
    return
  }
  const run = await api.createRun(task.value.id, { agentId: selectedAgentId.value })
  runs.value = [run, ...runs.value]
  await selectRun(run)
  task.value = await api.getTask(task.value.id)
  await tasks.fetchAll()
}

async function updateStatus(status: TaskStatus) {
  if (!task.value) {
    return
  }
  task.value = await api.updateTask(task.value.id, { status })
  await tasks.fetchAll()
}

function onStatusChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as TaskStatus
  void updateStatus(value)
}

async function cancelRun(run: Run) {
  await api.cancelRun(run.id)
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
  <div v-if="loading" class="p-6 text-sm text-zinc-500">Loading task...</div>

  <div v-else-if="!task" class="p-6">
    <p class="text-sm text-zinc-400">Task not found.</p>
    <button class="btn-ghost mt-3" @click="router.push('/')">Back to board</button>
  </div>

  <div v-else class="flex flex-col h-full">
    <header class="h-14 shrink-0 border-b border-border flex items-center justify-between px-5">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-zinc-500">{{ task.id }}</span>
          <StatusBadge :status="task.status" />
        </div>
        <h1 class="text-sm font-600 truncate">{{ task.title }}</h1>
      </div>
      <div class="flex items-center gap-2">
        <select class="input w-36" :value="task.status" @change="onStatusChange">
          <option v-for="status in TASK_STATUSES" :key="status.value" :value="status.value">
            {{ TASK_STATUS_LABELS[status.value] }}
          </option>
        </select>
        <button class="btn-ghost" @click="router.push('/')">Back</button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-5 space-y-5">
      <section class="card p-4">
        <h2 class="text-xs font-600 text-zinc-400 mb-2">DESCRIPTION</h2>
        <p class="text-sm text-zinc-300 whitespace-pre-wrap">
          {{ task.description || 'No description yet.' }}
        </p>
      </section>

      <section class="card p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-600 text-zinc-400">RUNS</h2>
          <div class="flex items-center gap-2">
            <select v-model="selectedAgentId" class="input w-44">
              <option value="" disabled>Select an agent</option>
              <option v-for="agent in agents.items" :key="agent.id" :value="agent.id">
                {{ agent.name }} · {{ agent.runtime }}
              </option>
            </select>
            <button class="btn-primary" :disabled="!canRun || !selectedAgentId" @click="startRun">
              Run
            </button>
          </div>
        </div>

        <p v-if="!canRun" class="text-[11px] text-amber-300/80 mb-3">
          Move the task to Todo or In Progress before starting a run.
        </p>

        <div v-if="runs.length === 0" class="text-xs text-zinc-500">No runs yet.</div>

        <div v-else class="space-y-2">
          <button
            v-for="run in runs"
            :key="run.id"
            class="w-full text-left card p-3 hover:border-zinc-600"
            :class="{ '!border-accent2/50': selectedRun?.id === run.id }"
            @click="selectRun(run)"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <StatusBadge :status="run.status" kind="run" />
                <span class="text-[10px] text-zinc-500">{{ run.trigger }}</span>
              </div>
              <span class="text-[10px] text-zinc-500">
                {{ new Date(run.createdAt).toLocaleString() }}
              </span>
            </div>
            <div v-if="run.summary" class="text-[11px] text-zinc-400 mt-1">{{ run.summary }}</div>
            <div v-if="run.error" class="text-[11px] text-rose-300 mt-1">{{ run.error }}</div>
          </button>
        </div>
      </section>

      <section v-if="selectedRun" class="card p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-600 text-zinc-400">
            RUN LOG · {{ selectedRun.id.slice(0, 8) }}
          </h2>
          <button
            v-if="['queued', 'preparing', 'running'].includes(selectedRun.status)"
            class="btn-ghost"
            @click="cancelRun(selectedRun)"
          >
            Cancel
          </button>
        </div>
        <pre
          class="bg-black/40 border border-border rounded-md p-3 text-[11px] leading-relaxed text-zinc-300 max-h-80 overflow-y-auto whitespace-pre-wrap"
          >{{
            events.length
              ? events.map((event) => `[${event.type}] ${event.message}`).join('\n')
              : 'Waiting for events...'
          }}</pre
        >
      </section>
    </div>
  </div>
</template>
