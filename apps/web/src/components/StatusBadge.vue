<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RunStatus, TaskStatus } from '@ateam/shared'
import { Badge } from './ui/badge'
import type { BadgeTone } from './ui/badge'

const props = withDefaults(
  defineProps<{ status: TaskStatus | RunStatus; kind?: 'task' | 'run' }>(),
  { kind: 'task' },
)
const { t } = useI18n()

const label = computed(() =>
  props.kind === 'run'
    ? t(`common.status.run.${props.status}`)
    : t(`common.status.task.${props.status}`),
)

const tone = computed<BadgeTone>(() => {
  const status = props.status
  if (status === 'done' || status === 'completed') return 'success'
  if (status === 'in_progress' || status === 'running' || status === 'preparing') return 'brand'
  if (status === 'failed') return 'danger'
  if (status === 'blocked' || status === 'cancelled' || status === 'in_review') return 'warning'
  return 'neutral'
})
</script>

<template>
  <Badge :tone="tone">{{ label }}</Badge>
</template>
