<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Plus } from '@element-plus/icons-vue'
import { TASK_STATUSES, type Task, type TaskStatus } from '@ateam/shared'
import { useTasksStore } from '../stores/tasks'
import TaskCard from '../components/TaskCard.vue'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'

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
  <div class="flex flex-col h-full">
    <header class="shrink-0 flex items-center justify-between px-6 pt-5 pb-4">
      <div>
        <h1 class="text-title font-semibold tracking-tight">{{ $t('board.title') }}</h1>
        <p class="text-caption text-fg-subtle">{{ $t('board.subtitle') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="showCreate = true">{{ $t('board.newTask') }}</el-button>
    </header>

    <div class="flex-1 overflow-x-auto px-6 pb-6">
      <div class="flex gap-4 min-w-max h-full">
        <section
          v-for="column in columns"
          :key="column.value"
          class="w-[280px] shrink-0 flex flex-col"
          @dragover.prevent
          @drop="drop(column.value)"
        >
          <div class="flex items-center justify-between mb-2 px-1">
            <div class="flex items-center gap-2">
              <span class="text-label font-semibold text-fg-muted">{{ column.label }}</span>
              <el-tag size="small" effect="plain" type="info">{{ column.tasks.length }}</el-tag>
            </div>
            <span class="text-caption text-fg-subtle">{{ column.hint }}</span>
          </div>

          <div
            class="flex-1 space-y-2 overflow-y-auto rounded-lg border border-border-subtle bg-sunken/60 p-2"
          >
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
      <el-form label-position="top" @submit.prevent>
        <el-form-item :label="$t('board.form.title')">
          <el-input
            v-model="draft.title"
            :placeholder="$t('board.form.titlePlaceholder')"
            @keydown.enter="createTask"
          />
        </el-form-item>
        <el-form-item :label="$t('board.form.description')">
          <el-input
            v-model="draft.description"
            type="textarea"
            :rows="3"
            :placeholder="$t('board.form.descriptionPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="$t('board.form.status')">
          <el-select v-model="draft.status" style="width: 100%">
            <el-option
              v-for="status in TASK_STATUSES"
              :key="status.value"
              :label="$t(`common.status.task.${status.value}`)"
              :value="status.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="flex justify-end gap-2">
        <el-button @click="showCreate = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="createTask">{{ $t('common.create') }}</el-button>
      </div>
    </Modal>
  </div>
</template>
