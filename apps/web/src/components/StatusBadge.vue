<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RunStatus, TaskStatus } from '@ateam/shared'

const props = withDefaults(
  defineProps<{
    status: TaskStatus | RunStatus
    kind?: 'task' | 'run'
  }>(),
  { kind: 'task' },
)

const { t } = useI18n()

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

const label = computed(() => {
  if (props.kind === 'run') {
    return t(`common.status.run.${props.status}`)
  }
  return t(`common.status.task.${props.status}`)
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
