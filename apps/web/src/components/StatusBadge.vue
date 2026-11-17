<script setup lang="ts">
import { computed } from 'vue'
import {
  RUN_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type RunStatus,
  type TaskStatus,
} from '@ateam/shared'

const props = withDefaults(
  defineProps<{
    status: TaskStatus | RunStatus
    kind?: 'task' | 'run'
  }>(),
  { kind: 'task' },
)

const label = computed(() => {
  if (props.kind === 'run') {
    return RUN_STATUS_LABELS[props.status as RunStatus]
  }
  return TASK_STATUS_LABELS[props.status as TaskStatus]
})

const tone = computed(() => {
  const status = props.status
  if (status === 'done' || status === 'completed') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
  }
  if (status === 'in_progress' || status === 'running') {
    return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20'
  }
  if (status === 'failed') {
    return 'bg-rose-500/15 text-rose-300 border-rose-500/20'
  }
  if (status === 'blocked' || status === 'cancelled') {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/20'
  }
  if (status === 'in_review' || status === 'queued' || status === 'preparing') {
    return 'bg-sky-500/15 text-sky-300 border-sky-500/20'
  }
  return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20'
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-500"
    :class="tone"
  >
    <span class="w-1.5 h-1.5 rounded-full bg-current" />
    {{ label }}
  </span>
</template>
