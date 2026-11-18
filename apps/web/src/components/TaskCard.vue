<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Task } from '@ateam/shared'
import StatusBadge from './StatusBadge.vue'

defineProps<{ task: Task }>()
defineEmits<{ open: [task: Task]; dragstart: [task: Task] }>()

const { t } = useI18n()

// shared 包 PRIORITY_LABELS 的数字键 → locale 键名
const PRIORITY_KEYS: Record<number, string> = {
  0: 'none',
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'urgent',
}

function priorityLabel(priority: number) {
  return t(`common.priority.${PRIORITY_KEYS[priority] ?? 'none'}`)
}
</script>

<template>
  <el-card
    shadow="hover"
    :body-style="{ padding: '12px' }"
    class="cursor-pointer"
    draggable="true"
    @click="$emit('open', task)"
    @dragstart="$emit('dragstart', task)"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-sm font-medium leading-snug">{{ task.title }}</h3>
      <span class="text-[10px] text-zinc-500 shrink-0">{{ task.id.slice(0, 4) }}</span>
    </div>
    <p v-if="task.description" class="mt-1.5 text-xs text-zinc-500 line-clamp-2">
      {{ task.description }}
    </p>
    <div class="mt-3 flex items-center justify-between gap-2">
      <StatusBadge :status="task.status" />
      <el-tag size="small" effect="plain" type="info">
        {{ priorityLabel(task.priority) }}
      </el-tag>
    </div>
  </el-card>
</template>
