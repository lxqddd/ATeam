<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Refresh } from '@element-plus/icons-vue'
import type { Run } from '@ateam/shared'
import { useRunsStore } from '../stores/runs'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'

const runs = useRunsStore()
const tasks = useTasksStore()
const router = useRouter()
const { t, d } = useI18n()

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
        <h1 class="text-subtitle font-semibold tracking-tight">{{ $t('runs.title') }}</h1>
        <p class="text-caption text-fg-subtle">{{ $t('runs.subtitle') }}</p>
      </div>
      <el-button :icon="Refresh" @click="runs.fetchAll()">{{ $t('common.refresh') }}</el-button>
    </header>

    <div class="flex-1 overflow-y-auto p-5">
      <el-empty v-if="runs.items.length === 0" :description="$t('runs.empty')" />

      <el-table v-else :data="runs.items" style="width: 100%" @row-click="openTask">
        <el-table-column :label="t('runs.columns.status')" width="130">
          <template #default="{ row }">
            <StatusBadge :status="row.status" kind="run" />
          </template>
        </el-table-column>
        <el-table-column :label="t('runs.columns.task')" min-width="220">
          <template #default="{ row }">
            <span class="text-fg-muted">{{ taskTitle(row.taskId) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('runs.columns.trigger')" prop="trigger" width="120" />
        <el-table-column :label="t('runs.columns.created')" width="190">
          <template #default="{ row }">
            <span class="text-fg-subtle">{{ d(new Date(row.createdAt), 'long') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('runs.columns.summary')" min-width="260">
          <template #default="{ row }">
            <span class="text-fg-muted">{{ row.summary || row.error || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
