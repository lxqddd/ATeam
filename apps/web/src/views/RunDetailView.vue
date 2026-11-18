<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeftIcon, RefreshCwIcon } from '@lucide/vue'
import type { Artifact, Review, Run, RunEvent, RunWorkspace, Task } from '@ateam/shared'
import { ArtifactApi, ReviewApi, RunApi, RunDetailApi, TaskApi, WorkspaceApi } from '../api'
import StatusBadge from '../components/StatusBadge.vue'
import SectionCard from '../components/SectionCard.vue'
import EmptyState from '../components/EmptyState.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Textarea } from '../components/ui/textarea'
import { Loader } from '../components/ai-elements/loader'

const router = useRouter()
const { t, d } = useI18n()

const props = defineProps<{ id: string }>()

const runId = computed(() => props.id)
const run = ref<Run | null>(null)
const task = ref<Task | null>(null)
const events = ref<RunEvent[]>([])
const artifacts = ref<Artifact[]>([])
const workspace = ref<RunWorkspace | null>(null)
const reviews = ref<Review[]>([])
const dod = ref<{ required: string[]; present: Record<string, boolean>; satisfied: boolean; missing: string[] } | null>(null)
const loading = ref(true)
const failed = ref(false)

const previewId = ref('')
const previewText = ref('')
const previewLoading = ref(false)

const comment = ref('')
const reviewBusy = ref(false)
const reviewPending = ref<'approve' | 'request_changes' | ''>('')
const reviewError = ref('')

const mergeTarget = ref('main')
const mergeStrategy = ref<'squash' | 'merge'>('squash')
const mergeConfirm = ref(false)
const mergeBusy = ref(false)
const mergeError = ref('')
const mergeDone = ref('')

let timer: number | undefined

const approvedReview = computed(
  () => reviews.value.find((review) => review.status === 'approved' && !review.supersededBy) ?? null,
)
const isActive = computed(
  () => !!run.value && ['queued', 'preparing', 'running'].includes(run.value.status),
)
const canMerge = computed(
  () =>
    !!run.value &&
    run.value.status === 'completed' &&
    !!approvedReview.value &&
    !!run.value.headCommit &&
    mergeConfirm.value,
)

async function load() {
  try {
    const current = await RunDetailApi.get(runId.value)
    run.value = current
    task.value = await TaskApi.get(current.taskId).catch(() => null)
    events.value = await RunApi.listEvents(runId.value).catch(() => [])
    artifacts.value = await ArtifactApi.listByRun(runId.value).catch(() => [])
    workspace.value = await ReviewApi.workspace(runId.value).catch(() => null)
    reviews.value = await ReviewApi.listByRun(runId.value).catch(() => [])
    const evidence = await ArtifactApi.listByTask(current.taskId).catch(() => null)
    dod.value = evidence?.dod ?? null
    if (!mergeTargetTouched.value) {
      const workspaceRecord = await WorkspaceApi.get(current.workspaceId ?? 'default').catch(() => null)
      if (workspaceRecord?.defaultBranch) {
        mergeTarget.value = workspaceRecord.defaultBranch
      }
    }
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

const mergeTargetTouched = ref(false)

async function preview(artifact: Artifact) {
  previewId.value = artifact.id
  previewLoading.value = true
  try {
    previewText.value = await ArtifactApi.content(artifact.id)
  } catch {
    previewText.value = ''
  } finally {
    previewLoading.value = false
  }
}

async function submitReview(decision: 'approve' | 'request_changes') {
  reviewBusy.value = true
  reviewPending.value = decision
  reviewError.value = ''
  try {
    await ReviewApi.create(runId.value, { decision, comment: comment.value.trim() })
    comment.value = ''
    await load()
  } catch (error) {
    reviewError.value = error instanceof Error ? error.message : String(error)
  } finally {
    reviewBusy.value = false
    reviewPending.value = ''
  }
}

async function merge() {
  if (mergeBusy.value) {
    return
  }
  if (!run.value || !approvedReview.value || !run.value.headCommit) {
    return
  }
  mergeBusy.value = true
  mergeError.value = ''
  mergeDone.value = ''
  try {
    const record = await ReviewApi.merge(runId.value, {
      reviewId: approvedReview.value.id,
      expectedHeadCommit: run.value.headCommit,
      targetBranch: mergeTarget.value,
      strategy: mergeStrategy.value,
      confirm: true,
    })
    mergeDone.value = t('runDetail.mergeDone', { branch: record.targetBranch, commit: record.commit.slice(0, 8) })
    await load()
  } catch (error) {
    mergeError.value = error instanceof Error ? error.message : String(error)
  } finally {
    mergeBusy.value = false
  }
}

function reviewTone(status: string): 'success' | 'warning' | 'info' {
  if (status === 'approved') {
    return 'success'
  }
  if (status === 'changes_requested') {
    return 'warning'
  }
  return 'info'
}

function payloadSummary(payload: Record<string, unknown> | undefined) {
  if (!payload) {
    return ''
  }
  const keys = Object.keys(payload)
  return keys.length > 0 ? keys.join(', ') : '{}'
}

function payloadBody(payload: Record<string, unknown> | undefined) {
  return payload ? JSON.stringify(payload, null, 2) : ''
}

watch(runId, () => {
  loading.value = true
  void load()
})

onMounted(() => {
  void load()
  timer = window.setInterval(() => {
    if (isActive.value) {
      void load()
    }
  }, 2000)
})

onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer)
  }
})
</script>

<template>
  <Teleport to="#titlebar-actions">
    <Button size="sm" variant="outline" @click="load">
      <RefreshCwIcon class="size-4" />
      {{ $t('runDetail.reload') }}
    </Button>
  </Teleport>

  <div v-if="loading" class="p-6">
    <div class="flex flex-col gap-3">
      <Skeleton class="h-6 w-64" />
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-40 w-full" />
    </div>
  </div>

  <div v-else-if="failed || !run" class="flex flex-1 items-center justify-center p-6">
    <EmptyState :title="$t('runDetail.notFound')">
      <Button size="lg" @click="router.push('/runs')">{{ $t('runDetail.backToRuns') }}</Button>
    </EmptyState>
  </div>

  <div v-else class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
    <div class="space-y-4">
      <header class="min-w-0">
        <router-link
          to="/runs"
          class="inline-flex items-center gap-1 text-caption text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <ArrowLeftIcon class="size-3.5" />
          {{ $t('runDetail.backToRuns') }}
        </router-link>
        <div class="mt-1 flex min-w-0 items-center gap-2">
          <h1 class="min-w-0 truncate text-title font-semibold tracking-tight">
            <router-link
              v-if="task"
              :to="`/tasks/${task.id}`"
              class="block truncate transition-colors hover:text-fg-muted"
            >
              {{ task.title }}
            </router-link>
            <span v-else class="font-mono">{{ run.id }}</span>
          </h1>
          <StatusBadge :status="run.status" kind="run" />
          <span v-if="task" class="shrink-0 font-mono text-caption text-fg-subtle">{{ run.id }}</span>
        </div>
      </header>

      <SectionCard :title="$t('runDetail.title')">
        <dl class="grid gap-x-6 text-label sm:grid-cols-2">
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.branch') }}</dt>
            <dd class="truncate font-mono text-fg-muted">{{ run.branch || '—' }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.baseCommit') }}</dt>
            <dd class="truncate font-mono text-fg-muted">{{ run.baseCommit?.slice(0, 12) || '—' }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.headCommit') }}</dt>
            <dd class="truncate font-mono text-fg-muted">{{ run.headCommit?.slice(0, 12) || '—' }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.created') }}</dt>
            <dd class="min-w-0 truncate text-right text-fg-muted">{{ d(new Date(run.createdAt), 'long') }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.started') }}</dt>
            <dd class="min-w-0 truncate text-right text-fg-muted">{{ run.startedAt ? d(new Date(run.startedAt), 'long') : '—' }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.ended') }}</dt>
            <dd class="min-w-0 truncate text-right text-fg-muted">{{ run.endedAt ? d(new Date(run.endedAt), 'long') : '—' }}</dd>
          </div>
          <div v-if="run.errorCode" class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.errorCode') }}</dt>
            <dd class="truncate text-fg-muted">{{ run.errorCode }} · {{ run.failureDetail }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.workspaceState') }}</dt>
            <dd class="truncate text-fg-muted">{{ workspace?.state ?? '—' }} · {{ workspace?.cleanupState ?? '—' }}</dd>
          </div>
          <div class="flex h-8 items-center justify-between gap-3">
            <dt class="shrink-0 text-fg-subtle">{{ $t('runDetail.workspace') }}</dt>
            <dd class="truncate font-mono text-fg-muted">{{ workspace?.path || $t('runDetail.workspaceNone') }}</dd>
          </div>
          <div v-if="run.error" class="whitespace-pre-wrap py-1 text-label text-fg-muted sm:col-span-2">
            {{ run.error }}
          </div>
        </dl>
      </SectionCard>

      <SectionCard :title="$t('runDetail.evidence')">
        <template #actions>
          <Badge v-if="dod" :tone="dod.satisfied ? 'success' : 'warning'">
            {{ dod.satisfied ? $t('runDetail.dodSatisfied') : $t('runDetail.dodMissing') }}
          </Badge>
        </template>

        <div v-if="dod" class="mb-3 flex flex-wrap items-center gap-2 text-caption text-fg-subtle">
          <span>{{ $t('runDetail.dod') }}</span>
          <Badge
            v-for="required in dod.required"
            :key="required"
            :tone="dod.present[required] ? 'success' : 'danger'"
          >
            {{ required }}
          </Badge>
        </div>

        <EmptyState v-if="artifacts.length === 0" :title="$t('runDetail.evidenceEmpty')" />
        <div v-else class="flex flex-wrap gap-1.5">
          <button
            v-for="artifact in artifacts"
            :key="artifact.id"
            type="button"
            class="flex h-8 max-w-full items-center gap-2 rounded-[var(--cd-radius-sm)] border px-2.5 text-caption transition-colors"
            :class="previewId === artifact.id
              ? 'border-[var(--cd-color-accent)] bg-[var(--cd-color-accent-soft)] text-foreground'
              : 'border-[var(--cd-color-border-subtle)] text-fg-muted hover:border-[var(--cd-color-border-strong)]'"
            :aria-pressed="previewId === artifact.id"
            @click="preview(artifact)"
          >
            <span class="font-mono text-fg-subtle">{{ artifact.type }}</span>
            <span class="max-w-[220px] truncate">{{ artifact.name }}</span>
            <span class="text-fg-subtle">{{ artifact.origin }}</span>
            <Badge v-if="artifact.redactionState === 'redacted'" tone="warning">
              {{ $t('runDetail.redacted') }}
            </Badge>
            <Badge v-if="artifact.truncated" tone="info">
              {{ $t('runDetail.truncated') }}
            </Badge>
            <span class="text-fg-subtle">{{ $t('runDetail.bytes', { n: artifact.sizeBytes }) }}</span>
          </button>
        </div>

        <div class="mt-3">
          <div class="mb-1 text-caption text-fg-subtle">{{ $t('runDetail.preview') }}</div>
          <div v-if="previewLoading" class="text-label text-fg-subtle">{{ $t('runDetail.loading') }}</div>
          <pre
            v-else
            class="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[var(--cd-radius-md)] border border-border-subtle bg-sunken p-3 text-label text-fg-muted"
          >{{ previewText || $t('runDetail.previewEmpty') }}</pre>
        </div>
      </SectionCard>

      <SectionCard :title="$t('runDetail.reviews')">
        <EmptyState v-if="reviews.length === 0" :title="$t('runDetail.reviewsEmpty')" />
        <div v-else class="space-y-2">
          <div
            v-for="review in reviews"
            :key="review.id"
            class="rounded-[var(--cd-radius-md)] border border-border-subtle px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <Badge :tone="reviewTone(review.status)">{{ review.status }}</Badge>
              <span class="text-caption text-fg-subtle">{{ review.reviewerId }}</span>
              <span v-if="review.decidedAt" class="ml-auto text-caption text-fg-subtle">
                {{ d(new Date(review.decidedAt), 'long') }}
              </span>
            </div>
            <p v-if="review.decisionNote" class="mt-1 whitespace-pre-wrap text-label text-fg-muted">
              {{ review.decisionNote }}
            </p>
          </div>
        </div>

        <div class="mt-3 space-y-2">
          <Textarea v-model="comment" rows="2" :placeholder="$t('runDetail.reviewCommentPlaceholder')" />
          <p class="text-caption text-fg-subtle">{{ $t('runDetail.reviewHint') }}</p>
          <div class="flex items-center gap-2">
            <Button :disabled="reviewBusy || run.status !== 'completed'" @click="submitReview('approve')">
              <Loader v-if="reviewPending === 'approve'" :size="14" />
              {{ $t('runDetail.approve') }}
            </Button>
            <Button
              variant="outline"
              :disabled="reviewBusy || run.status !== 'completed'"
              @click="submitReview('request_changes')"
            >
              <Loader v-if="reviewPending === 'request_changes'" :size="14" />
              {{ $t('runDetail.requestChanges') }}
            </Button>
            <span v-if="reviewError" class="text-caption text-danger">{{ reviewError }}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard :title="$t('runDetail.merge')">
        <div class="grid gap-3 sm:grid-cols-2">
          <Field :label="$t('runDetail.mergeTarget')" for="merge-target">
            <Input id="merge-target" v-model="mergeTarget" @input="mergeTargetTouched = true" />
          </Field>
          <Field :label="$t('runDetail.mergeStrategy')" for="merge-strategy">
            <el-select id="merge-strategy" v-model="mergeStrategy" style="width: 100%">
              <el-option :label="$t('runDetail.strategySquash')" value="squash" />
              <el-option :label="$t('runDetail.strategyMerge')" value="merge" />
            </el-select>
          </Field>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <el-checkbox v-model="mergeConfirm">{{ $t('runDetail.mergeConfirm') }}</el-checkbox>
          <Button size="lg" :disabled="!canMerge || mergeBusy" @click="merge">
            <Loader v-if="mergeBusy" :size="14" />
            {{ $t('runDetail.merge') }}
          </Button>
          <span v-if="!approvedReview" class="text-caption text-fg-subtle">{{ $t('runDetail.mergeNeedsReview') }}</span>
        </div>
        <p v-if="mergeError" class="mt-2 text-caption text-danger">{{ mergeError }}</p>
        <p v-if="mergeDone" class="mt-2 text-caption text-success">{{ mergeDone }}</p>
      </SectionCard>

      <SectionCard :title="$t('runDetail.events')">
        <EmptyState v-if="events.length === 0" :title="$t('runDetail.eventsEmpty')" />
        <div
          v-else
          class="max-h-[360px] overflow-y-auto rounded-[var(--cd-radius-md)] border border-border-subtle bg-sunken px-3 py-1"
        >
          <div
            v-for="event in events"
            :key="`${event.runId}-${event.seq}`"
            class="border-b border-border-subtle/60 py-2 last:border-0"
          >
            <div class="flex items-start gap-2">
              <span class="w-8 shrink-0 text-right font-mono text-caption text-fg-subtle tabular-nums">{{ event.seq }}</span>
              <span class="shrink-0"><Badge :tone="event.level === 'error' ? 'danger' : 'neutral'">{{ event.type }}</Badge></span>
              <span v-if="event.level && event.level !== 'info'" class="shrink-0 text-caption text-fg-subtle">{{ event.level }}</span>
              <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-fg-muted">{{ event.message }}</span>
            </div>
            <details v-if="event.payload" class="mt-1 pl-10">
              <summary class="cursor-pointer font-mono text-caption text-fg-subtle transition-colors hover:text-fg-muted">
                {{ payloadSummary(event.payload) }}
              </summary>
              <pre
                class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[var(--cd-radius-sm)] border border-border-subtle bg-surface p-2 font-mono text-caption text-fg-muted"
              >{{ payloadBody(event.payload) }}</pre>
            </details>
          </div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>
