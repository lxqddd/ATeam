<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import type { Artifact, Review, Run, RunEvent, RunWorkspace, Task } from '@ateam/shared'
import { ArtifactApi, ReviewApi, RunApi, RunDetailApi, TaskApi, WorkspaceApi } from '../api'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const router = useRouter()
const { t, d } = useI18n()

const runId = computed(() => String(route.params.id))
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
  reviewError.value = ''
  try {
    await ReviewApi.create(runId.value, { decision, comment: comment.value.trim() })
    comment.value = ''
    await load()
  } catch (error) {
    reviewError.value = error instanceof Error ? error.message : String(error)
  } finally {
    reviewBusy.value = false
  }
}

async function merge() {
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

watch(
  () => route.params.id,
  () => {
    loading.value = true
    void load()
  },
)

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
  <div v-if="loading" class="p-6">
    <el-skeleton :rows="4" animated />
  </div>

  <div v-else-if="failed || !run" class="p-6">
    <el-empty :description="$t('runDetail.notFound')">
      <el-button @click="router.push('/runs')">{{ $t('runDetail.backToRuns') }}</el-button>
    </el-empty>
  </div>

  <div v-else class="flex flex-col h-full">
    <header class="shrink-0 flex items-center justify-between px-6 pt-4 pb-3 gap-3">
      <div class="min-w-0 flex-1 flex items-center gap-3">
        <el-button :icon="ArrowLeft" text @click="router.push('/runs')">{{ $t('runDetail.back') }}</el-button>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-caption text-fg-subtle">{{ run.id }}</span>
            <StatusBadge :status="run.status" kind="run" />
          </div>
          <h1 class="text-body font-semibold truncate">
            <el-button v-if="task" text class="!p-0 !h-auto" @click="router.push(`/tasks/${task.id}`)">
              {{ task.title }}
            </el-button>
          </h1>
        </div>
      </div>
      <el-button :icon="Refresh" @click="load">{{ $t('runDetail.reload') }}</el-button>
    </header>

    <div class="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('runDetail.title') }}</span>
        </template>
        <dl class="grid gap-x-6 gap-y-2 text-label sm:grid-cols-2">
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.branch') }}</dt>
            <dd class="font-mono text-fg-muted truncate">{{ run.branch || '—' }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.baseCommit') }}</dt>
            <dd class="font-mono text-fg-muted truncate">{{ run.baseCommit?.slice(0, 12) || '—' }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.headCommit') }}</dt>
            <dd class="font-mono text-fg-muted truncate">{{ run.headCommit?.slice(0, 12) || '—' }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.created') }}</dt>
            <dd class="text-fg-muted">{{ d(new Date(run.createdAt), 'long') }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.started') }}</dt>
            <dd class="text-fg-muted">{{ run.startedAt ? d(new Date(run.startedAt), 'long') : '—' }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.ended') }}</dt>
            <dd class="text-fg-muted">{{ run.endedAt ? d(new Date(run.endedAt), 'long') : '—' }}</dd>
          </div>
          <div v-if="run.errorCode" class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.errorCode') }}</dt>
            <dd class="text-fg-muted">{{ run.errorCode }} · {{ run.failureDetail }}</dd>
          </div>
          <div v-if="run.error" class="sm:col-span-2 text-fg-muted">{{ run.error }}</div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.workspaceState') }}</dt>
            <dd class="text-fg-muted">{{ workspace?.state ?? '—' }} · {{ workspace?.cleanupState ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-fg-subtle">{{ $t('runDetail.workspace') }}</dt>
            <dd class="font-mono text-fg-muted truncate">{{ workspace?.path || $t('runDetail.workspaceNone') }}</dd>
          </div>
        </dl>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="text-label font-semibold">{{ $t('runDetail.evidence') }}</span>
            <el-tag v-if="dod" size="small" :type="dod.satisfied ? 'success' : 'warning'" effect="plain">
              {{ dod.satisfied ? $t('runDetail.dodSatisfied') : $t('runDetail.dodMissing') }}
            </el-tag>
          </div>
        </template>

        <div v-if="dod" class="mb-3 flex flex-wrap items-center gap-2 text-caption text-fg-subtle">
          <span>{{ $t('runDetail.dod') }}:</span>
          <el-tag
            v-for="required in dod.required"
            :key="required"
            size="small"
            effect="plain"
            :type="dod.present[required] ? 'success' : 'danger'"
          >
            {{ required }}
          </el-tag>
        </div>

        <el-empty v-if="artifacts.length === 0" :description="$t('runDetail.evidenceEmpty')" :image-size="48" />
        <div v-else class="space-y-1.5">
          <button
            v-for="artifact in artifacts"
            :key="artifact.id"
            type="button"
            class="w-full flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors"
            :class="previewId === artifact.id ? 'bg-[var(--cd-color-selected-bg)]' : 'hover:bg-[var(--cd-color-nav-bg)]'"
            @click="preview(artifact)"
          >
            <el-tag size="small" effect="plain">{{ artifact.type }}</el-tag>
            <span class="text-label text-fg-muted truncate">{{ artifact.name }}</span>
            <span class="ml-auto text-caption text-fg-subtle">{{ artifact.origin }}</span>
            <el-tag v-if="artifact.redactionState === 'redacted'" size="small" type="warning" effect="plain">
              {{ $t('runDetail.redacted') }}
            </el-tag>
            <el-tag v-if="artifact.truncated" size="small" type="info" effect="plain">
              {{ $t('runDetail.truncated') }}
            </el-tag>
            <span class="text-caption text-fg-subtle">{{ $t('runDetail.bytes', { n: artifact.sizeBytes }) }}</span>
          </button>
        </div>

        <div class="mt-3">
          <div class="text-caption text-fg-subtle mb-1">{{ $t('runDetail.preview') }}</div>
          <div v-if="previewLoading" class="text-label text-fg-subtle">{{ $t('runDetail.loading') }}</div>
          <pre
            v-else
            class="max-h-[320px] overflow-auto rounded-lg border border-border-subtle bg-sunken p-3 text-label text-fg-muted whitespace-pre-wrap"
          >{{ previewText || $t('runDetail.previewEmpty') }}</pre>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('runDetail.reviews') }}</span>
        </template>

        <el-empty v-if="reviews.length === 0" :description="$t('runDetail.reviewsEmpty')" :image-size="48" />
        <div v-else class="space-y-2">
          <div
            v-for="review in reviews"
            :key="review.id"
            class="rounded-lg border border-border-subtle px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <el-tag
                size="small"
                effect="plain"
                :type="review.status === 'approved' ? 'success' : review.status === 'changes_requested' ? 'warning' : 'info'"
              >
                {{ review.status }}
              </el-tag>
              <span class="text-caption text-fg-subtle">{{ review.reviewerId }}</span>
              <span v-if="review.decidedAt" class="ml-auto text-caption text-fg-subtle">
                {{ d(new Date(review.decidedAt), 'long') }}
              </span>
            </div>
            <p v-if="review.decisionNote" class="mt-1 text-label text-fg-muted whitespace-pre-wrap">
              {{ review.decisionNote }}
            </p>
          </div>
        </div>

        <div class="mt-3 space-y-2">
          <el-input
            v-model="comment"
            type="textarea"
            :rows="2"
            :placeholder="$t('runDetail.reviewCommentPlaceholder')"
          />
          <p class="text-caption text-fg-subtle">{{ $t('runDetail.reviewHint') }}</p>
          <div class="flex items-center gap-2">
            <el-button type="primary" :loading="reviewBusy" :disabled="run.status !== 'completed'" @click="submitReview('approve')">
              {{ $t('runDetail.approve') }}
            </el-button>
            <el-button :loading="reviewBusy" :disabled="run.status !== 'completed'" @click="submitReview('request_changes')">
              {{ $t('runDetail.requestChanges') }}
            </el-button>
            <span v-if="reviewError" class="text-caption text-danger">{{ reviewError }}</span>
          </div>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('runDetail.merge') }}</span>
        </template>

        <div class="grid gap-3 sm:grid-cols-2">
          <el-form-item :label="$t('runDetail.mergeTarget')" class="!mb-0">
            <el-input v-model="mergeTarget" @input="mergeTargetTouched = true" />
          </el-form-item>
          <el-form-item :label="$t('runDetail.mergeStrategy')" class="!mb-0">
            <el-select v-model="mergeStrategy" style="width: 100%">
              <el-option :label="$t('runDetail.strategySquash')" value="squash" />
              <el-option :label="$t('runDetail.strategyMerge')" value="merge" />
            </el-select>
          </el-form-item>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <el-checkbox v-model="mergeConfirm">{{ $t('runDetail.mergeConfirm') }}</el-checkbox>
          <el-button type="primary" :loading="mergeBusy" :disabled="!canMerge" @click="merge">
            {{ $t('runDetail.merge') }}
          </el-button>
          <span v-if="!approvedReview" class="text-caption text-fg-subtle">{{ $t('runDetail.mergeNeedsReview') }}</span>
        </div>
        <p v-if="mergeError" class="mt-2 text-caption text-danger">{{ mergeError }}</p>
        <p v-if="mergeDone" class="mt-2 text-caption text-success">{{ mergeDone }}</p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-label font-semibold">{{ $t('runDetail.events') }}</span>
        </template>
        <el-empty v-if="events.length === 0" :description="$t('runDetail.eventsEmpty')" :image-size="48" />
        <div v-else class="max-h-[360px] overflow-y-auto space-y-1.5">
          <div v-for="event in events" :key="`${event.runId}-${event.seq}`" class="flex gap-2 text-label">
            <span class="text-caption text-fg-subtle shrink-0 w-14">{{ event.seq }}</span>
            <el-tag size="small" effect="plain">{{ event.type }}</el-tag>
            <span v-if="event.level && event.level !== 'info'" class="text-caption text-fg-subtle">{{ event.level }}</span>
            <span class="text-fg-muted break-all whitespace-pre-wrap">{{ event.message }}</span>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>
