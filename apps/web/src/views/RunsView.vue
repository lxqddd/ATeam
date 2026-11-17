<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRunsStore } from '../stores/runs'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'

const runs = useRunsStore()
const tasks = useTasksStore()
const router = useRouter()

onMounted(() => {
  void runs.fetchAll()
  void tasks.fetchAll()
})

function taskTitle(id: string) {
  return tasks.items.find((task) => task.id === id)?.title ?? id
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="h-14 shrink-0 border-b border-border flex items-center justify-between px-5">
      <div>
        <h1 class="text-sm font-600">Runs</h1>
        <p class="text-[11px] text-zinc-500">Every agent execution</p>
      </div>
      <button class="btn-ghost" @click="runs.fetchAll()">Refresh</button>
    </header>

    <div class="flex-1 overflow-y-auto p-5">
      <EmptyState
        v-if="runs.items.length === 0"
        title="No runs yet"
        description="Open a task and run it with an agent."
      />

      <div v-else class="card overflow-hidden">
        <table class="w-full text-left text-xs">
          <thead class="bg-white/5 text-zinc-500">
            <tr>
              <th class="px-4 py-2 font-500">Status</th>
              <th class="px-4 py-2 font-500">Task</th>
              <th class="px-4 py-2 font-500">Trigger</th>
              <th class="px-4 py-2 font-500">Created</th>
              <th class="px-4 py-2 font-500">Summary</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in runs.items"
              :key="run.id"
              class="border-t border-border hover:bg-white/5 cursor-pointer"
              @click="router.push(`/tasks/${run.taskId}`)"
            >
              <td class="px-4 py-2.5"><StatusBadge :status="run.status" kind="run" /></td>
              <td class="px-4 py-2.5 text-zinc-300 max-w-72 truncate">{{ taskTitle(run.taskId) }}</td>
              <td class="px-4 py-2.5 text-zinc-500">{{ run.trigger }}</td>
              <td class="px-4 py-2.5 text-zinc-500">
                {{ new Date(run.createdAt).toLocaleString() }}
              </td>
              <td class="px-4 py-2.5 text-zinc-400 max-w-80 truncate">
                {{ run.summary || run.error || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
