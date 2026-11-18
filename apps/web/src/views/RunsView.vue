<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RefreshCwIcon } from '@lucide/vue'
import type { Run } from '@ateam/shared'
import { useRunsStore } from '../stores/runs'
import { useTasksStore } from '../stores/tasks'
import StatusBadge from '../components/StatusBadge.vue'
import SectionCard from '../components/SectionCard.vue'
import EmptyState from '../components/EmptyState.vue'
import { Button } from '../components/ui/button'

const runs = useRunsStore()
const tasks = useTasksStore()
const router = useRouter()
const { d } = useI18n()

onMounted(() => {
  void runs.fetchAll()
  void tasks.fetchAll()
})

function taskTitle(id: string) {
  return tasks.items.find((task) => task.id === id)?.title ?? id
}

function openRun(row: Run) {
  void router.push(`/runs/${row.id}`)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="sm" variant="outline" @click="runs.fetchAll()">
        <RefreshCwIcon class="size-4" />
        {{ $t('common.refresh') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <SectionCard>
        <div v-if="runs.items.length === 0">
          <EmptyState :title="$t('runs.empty')" />
        </div>
        <div v-else class="overflow-hidden">
          <div class="grid grid-cols-[130px_minmax(0,1.2fr)_100px_170px_minmax(0,1.5fr)] items-center gap-3 border-b border-border-subtle px-2 py-2 text-caption font-semibold uppercase tracking-wide text-fg-subtle">
            <span>{{ $t('runs.columns.status') }}</span>
            <span>{{ $t('runs.columns.task') }}</span>
            <span>{{ $t('runs.columns.trigger') }}</span>
            <span>{{ $t('runs.columns.created') }}</span>
            <span>{{ $t('runs.columns.summary') }}</span>
          </div>
          <button
            v-for="run in runs.items"
            :key="run.id"
            type="button"
            class="grid w-full grid-cols-[130px_minmax(0,1.2fr)_100px_170px_minmax(0,1.5fr)] items-center gap-3 border-b border-border-subtle/60 px-2 text-left text-label transition-colors last:border-0 hover:bg-[var(--cd-color-hover)]"
            style="height: 40px"
            @click="openRun(run)"
          >
            <StatusBadge :status="run.status" kind="run" />
            <span class="truncate text-fg-muted">{{ taskTitle(run.taskId) }}</span>
            <span class="truncate text-fg-subtle">{{ run.trigger }}</span>
            <span class="truncate text-fg-subtle">{{ d(new Date(run.createdAt), 'long') }}</span>
            <span class="truncate text-fg-muted">{{ run.summary || run.error || '—' }}</span>
          </button>
        </div>
      </SectionCard>
    </div>
  </div>
</template>
