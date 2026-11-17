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

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

const label = computed(() => {
  if (props.kind === 'run') {
    return RUN_STATUS_LABELS[props.status as RunStatus]
  }
  return TASK_STATUS_LABELS[props.status as TaskStatus]
})

const tagType = computed<TagType>(() => {
  const status = props.status
  if (status === 'done' || status === 'completed') {
    return 'success'
  }
  if (status === 'in_progress' || status === 'running') {
    return 'primary'
  }
  if (status === 'failed') {
    return 'danger'
  }
  if (status === 'blocked' || status === 'cancelled') {
    return 'warning'
  }
  return 'info'
})
</script>

<template>
  <el-tag :type="tagType" effect="dark" size="small" round>{{ label }}</el-tag>
</template>
