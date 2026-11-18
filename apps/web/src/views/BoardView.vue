<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { PlusIcon } from '@lucide/vue'
import { TASK_STATUSES, type Task, type TaskStatus } from '@ateam/shared'
import { useTasksStore } from '../stores/tasks'
import TaskCard from '../components/TaskCard.vue'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Field } from '../components/ui/field'

const router = useRouter()
const { t } = useI18n()
const tasks = useTasksStore()

const showCreate = ref(false)
const dragging = ref<Task | null>(null)
const draft = ref({
  title: '',
  description: '',
  status: 'backlog' as TaskStatus,
})

const columns = computed(() =>
  TASK_STATUSES.map((status) => ({
    value: status.value,
    label: t(`common.status.task.${status.value}`),
    hint: t(`board.hints.${status.value}`),
    tasks: tasks.items.filter((task) => task.status === status.value),
  })),
)

onMounted(() => {
  void tasks.fetchAll()
})

async function createTask() {
  if (!draft.value.title.trim()) {
    return
  }
  await tasks.create({
    title: draft.value.title,
    description: draft.value.description,
    status: draft.value.status,
  })
  draft.value = { title: '', description: '', status: 'backlog' }
  showCreate.value = false
}

async function drop(status: TaskStatus) {
  const task = dragging.value
  dragging.value = null
  if (!task || task.status === status) {
    return
  }
  await tasks.update(task.id, { status })
}

function openTask(task: Task) {
  void router.push(`/tasks/${task.id}`)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="lg" @click="showCreate = true">
        <PlusIcon class="size-4" />
        {{ $t('board.newTask') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6 pt-4">
      <div class="flex h-full min-w-max gap-4">
        <section
          v-for="column in columns"
          :key="column.value"
          class="flex w-[280px] shrink-0 flex-col"
          @dragover.prevent
          @drop="drop(column.value)"
        >
          <div class="mb-2 flex items-center gap-2 px-1">
            <span class="text-label font-semibold text-fg-muted">{{ column.label }}</span>
            <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--cd-color-surface-raised)] px-1.5 text-caption text-fg-subtle tabular-nums">
              {{ column.tasks.length }}
            </span>
            <span class="ml-auto text-caption text-fg-subtle">{{ column.hint }}</span>
          </div>

          <div class="lane flex-1 space-y-2 overflow-y-auto p-2">
            <TaskCard
              v-for="task in column.tasks"
              :key="task.id"
              :task="task"
              @open="openTask"
              @dragstart="dragging = $event"
            />
            <EmptyState
              v-if="column.tasks.length === 0"
              :title="$t('board.emptyTitle')"
              :description="$t('board.emptyDesc')"
            />
          </div>
        </section>
      </div>
    </div>

    <Modal :open="showCreate" :title="$t('board.newTask')" @close="showCreate = false">
      <div class="flex flex-col gap-4">
        <Field :label="$t('board.form.title')" for="board-title">
          <Input id="board-title" v-model="draft.title" :placeholder="$t('board.form.titlePlaceholder')" @keydown.enter="createTask" />
        </Field>
        <Field :label="$t('board.form.description')" for="board-description">
          <Textarea id="board-description" v-model="draft.description" :placeholder="$t('board.form.descriptionPlaceholder')" />
        </Field>
        <Field :label="$t('board.form.status')">
          <el-select v-model="draft.status" style="width: 100%">
            <el-option
              v-for="status in TASK_STATUSES"
              :key="status.value"
              :label="$t(`common.status.task.${status.value}`)"
              :value="status.value"
            />
          </el-select>
        </Field>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="showCreate = false">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" @click="createTask">{{ $t('common.create') }}</el-button>
        </div>
      </template>
    </Modal>
  </div>
</template>
