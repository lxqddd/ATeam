<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Task } from '@ateam/shared'
import StatusBadge from './StatusBadge.vue'

defineProps<{ task: Task }>()
defineEmits<{ open: [task: Task]; dragstart: [task: Task] }>()
const { t } = useI18n()

const PRIORITY_KEYS: Record<number, string> = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' }
function priorityLabel(priority: number) {
  return t(`common.priority.${PRIORITY_KEYS[priority] ?? 'none'}`)
}
</script>

<template>
  <article
    draggable="true"
    class="cursor-pointer rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border-subtle)] bg-[var(--cd-color-surface)] p-3 transition-colors hover:border-[var(--cd-color-border-strong)] hover:shadow-[var(--cd-shadow-sm)]"
    @click="$emit('open', task)"
    @dragstart="$emit('dragstart', task)"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-body font-semibold leading-snug">{{ task.title }}</h3>
      <span class="shrink-0 text-caption text-fg-subtle">{{ task.id.slice(0, 4) }}</span>
    </div>
    <p v-if="task.description" class="mt-1.5 line-clamp-2 text-caption text-fg-subtle">{{ task.description }}</p>
    <div class="mt-3 flex items-center justify-between gap-2">
      <StatusBadge :status="task.status" />
      <span class="text-caption text-fg-subtle">{{ priorityLabel(task.priority) }}</span>
    </div>
  </article>
</template>
