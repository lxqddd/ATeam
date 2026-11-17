<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import type { Run } from '@ateam/shared'
import { useRunsStore } from '../stores/runs'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'

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

function openTask(row: Run) {
  void router.push(`/tasks/${row.taskId}`)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="h-14 shrink-0 border-b border-border flex items-center justify-between px-5">
      <div>
        <h1 class="text-sm font-semibold">Runs</h1>
        <p class="text-[11px] text-zinc-500">Every agent execution</p>
      </div>
      <el-button :icon="Refresh" @click="runs.fetchAll()">Refresh</el-button>
    </header>

    <div class="flex-1 overflow-y-auto p-5">
      <el-empty v-if="runs.items.length === 0" description="No runs yet" />

      <el-table v-else :data="runs.items" style="width: 100%" @row-click="openTask">
        <el-table-column label="Status" width="130">
          <template #default="{ row }">
            <StatusBadge :status="row.status" kind="run" />
          </template>
        </el-table-column>
        <el-table-column label="Task" min-width="220">
          <template #default="{ row }">
            <span class="text-zinc-300">{{ taskTitle(row.taskId) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Trigger" prop="trigger" width="120" />
        <el-table-column label="Created" width="190">
          <template #default="{ row }">
            <span class="text-zinc-500">{{ new Date(row.createdAt).toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Summary" min-width="260">
          <template #default="{ row }">
            <span class="text-zinc-400">{{ row.summary || row.error || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
