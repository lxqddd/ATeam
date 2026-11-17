<script setup lang="ts">
import { PRIORITY_LABELS, type Task } from '@ateam/shared'
import StatusBadge from './StatusBadge.vue'

defineProps<{ task: Task }>()
defineEmits<{ open: [task: Task]; dragstart: [task: Task] }>()
</script>

<template>
  <article
    draggable="true"
    class="card p-3 cursor-pointer hover:border-zinc-600 transition-colors"
    @click="$emit('open', task)"
    @dragstart="$emit('dragstart', task)"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-sm font-500 leading-snug">{{ task.title }}</h3>
      <span class="text-[10px] text-zinc-500 shrink-0">{{ task.id.slice(0, 4) }}</span>
    </div>
    <p v-if="task.description" class="mt-1.5 text-xs text-zinc-500 line-clamp-2">
      {{ task.description }}
    </p>
    <div class="mt-3 flex items-center justify-between gap-2">
      <StatusBadge :status="task.status" />
      <span class="text-[10px] text-zinc-500">{{ PRIORITY_LABELS[task.priority] ?? 'None' }}</span>
    </div>
  </article>
</template>
