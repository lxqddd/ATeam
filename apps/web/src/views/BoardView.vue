<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { TASK_STATUSES, type Task, type TaskStatus } from '@ateam/shared'
import { useTasksStore } from '../stores/tasks'
import TaskCard from '../components/TaskCard.vue'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const tasks = useTasksStore()

const showCreate = ref(false)
const dragging = ref<Task | null>(null)
const draft = ref({
  title: '',
  description: '',
  status: 'backlog' as TaskStatus,
})

const columns = computed(() =>
  TASK_STATUSES.map((status) => ({
    ...status,
    tasks: tasks.items.filter((task) => task.status === status.value),
  })),
)

onMounted(() => {
  void tasks.fetchAll()
})

async function createTask() {
  if (!draft.value.title.trim()) {
    return
  }
  await tasks.create({
    title: draft.value.title,
    description: draft.value.description,
    status: draft.value.status,
  })
  draft.value = { title: '', description: '', status: 'backlog' }
  showCreate.value = false
}

async function drop(status: TaskStatus) {
  const task = dragging.value
  dragging.value = null
  if (!task || task.status === status) {
    return
  }
  await tasks.update(task.id, { status })
}

function openTask(task: Task) {
  void router.push(`/tasks/${task.id}`)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="h-14 shrink-0 border-b border-border flex items-center justify-between px-5">
      <div>
        <h1 class="text-sm font-600">Board</h1>
        <p class="text-[11px] text-zinc-500">Tasks and their current execution state</p>
      </div>
      <button class="btn-primary" @click="showCreate = true">+ New task</button>
    </header>

    <div class="flex-1 overflow-x-auto p-5">
      <div class="flex gap-4 min-w-max h-full">
        <section
          v-for="column in columns"
          :key="column.value"
          class="w-64 shrink-0 flex flex-col"
          @dragover.prevent
          @drop="drop(column.value)"
        >
          <div class="flex items-center justify-between mb-2 px-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-600 text-zinc-300">{{ column.label }}</span>
              <span class="text-[10px] text-zinc-500">{{ column.tasks.length }}</span>
            </div>
            <span class="text-[10px] text-zinc-600">{{ column.hint }}</span>
          </div>

          <div
            class="flex-1 space-y-2 overflow-y-auto rounded-lg border border-dashed border-border/70 p-2"
          >
            <TaskCard
              v-for="task in column.tasks"
              :key="task.id"
              :task="task"
              @open="openTask"
              @dragstart="dragging = $event"
            />
            <EmptyState
              v-if="column.tasks.length === 0"
              title="No tasks"
              description="Drag a card here or create a new one."
            />
          </div>
        </section>
      </div>
    </div>

    <Modal :open="showCreate" title="New task" @close="showCreate = false">
      <div class="space-y-3">
        <div>
          <label class="label">Title</label>
          <input
            v-model="draft.title"
            class="input"
            placeholder="Fix the login redirect loop"
            @keydown.enter="createTask"
          />
        </div>
        <div>
          <label class="label">Description</label>
          <textarea
            v-model="draft.description"
            class="input min-h-24 resize-y"
            placeholder="Context, scope, acceptance criteria..."
          />
        </div>
        <div>
          <label class="label">Status</label>
          <select v-model="draft.status" class="input">
            <option v-for="status in TASK_STATUSES" :key="status.value" :value="status.value">
              {{ status.label }}
            </option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" @click="createTask">Create</button>
        </div>
      </div>
    </Modal>
  </div>
</template>
