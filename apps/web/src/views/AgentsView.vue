<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import type { Agent, RuntimeInfo } from '@ateam/shared'
import { RuntimeApi } from '../api'
import { useAgentsStore } from '../stores/agents'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'

const { t } = useI18n()
const DEFAULT_MODEL = '__default__'
const agents = useAgentsStore()
const showCreate = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const runtimes = ref<RuntimeInfo[]>([])
const runtimeLoading = ref(false)
const runtimeError = ref('')
const testState = ref<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({
  status: 'idle',
  message: '',
})
const form = reactive({
  name: '',
  description: '',
  instructions: '',
  runtime: 'mock',
  model: DEFAULT_MODEL,
  maxConcurrency: 1,
  timeoutMinutes: 60,
  allowedPaths: '',
})

const selectedRuntime = computed(() => runtimes.value.find((runtime) => runtime.name === form.runtime))
const modelOptions = computed(() => selectedRuntime.value?.models ?? [])
const unavailableModel = computed(() =>
  form.model !== DEFAULT_MODEL && !modelOptions.value.some((model) => model.id === form.model)
    ? form.model
    : '',
)

function runtimeLabel(runtime: RuntimeInfo): string {
  const version = runtime.version ? ` · ${runtime.version}` : ''
  return runtime.supported ? `${runtime.name}${version}` : `${runtime.name}${version} · ${t('agents.form.runtimeUnsupported')}`
}

async function loadRuntimes() {
  runtimeLoading.value = true
  try {
    runtimes.value = await RuntimeApi.list()
    runtimeError.value = ''
  } catch (err) {
    runtimeError.value = err instanceof Error ? err.message : String(err)
  } finally {
    runtimeLoading.value = false
  }
}

function resetForm() {
  form.name = ''
  form.description = ''
  form.instructions = ''
  form.runtime = 'mock'
  form.model = DEFAULT_MODEL
  form.maxConcurrency = 1
  form.timeoutMinutes = 60
  form.allowedPaths = ''
  testState.value = { status: 'idle', message: '' }
}

function openCreate() {
  editingId.value = null
  resetForm()
  showCreate.value = true
}

function openEdit(agent: Agent) {
  editingId.value = agent.id
  form.name = agent.name
  form.description = agent.description
  form.instructions = agent.instructions
  form.runtime = agent.runtime
  form.model = agent.model || DEFAULT_MODEL
  form.maxConcurrency = agent.maxConcurrency
  form.timeoutMinutes = agent.timeoutMinutes
  form.allowedPaths = agent.allowedPaths.join(', ')
  testState.value = { status: 'idle', message: '' }
  showCreate.value = true
}

watch(
  () => form.runtime,
  () => {
    if (form.model === DEFAULT_MODEL) {
      return
    }
    if (!modelOptions.value.some((model) => model.id === form.model)) {
      form.model = DEFAULT_MODEL
      ElMessage.warning(t('agents.form.modelReset'))
    }
  },
)

watch([() => form.runtime, () => form.model], () => {
  testState.value = { status: 'idle', message: '' }
})

onMounted(() => {
  void agents.fetchAll()
  void loadRuntimes()
})

async function testConnection() {
  if (!selectedRuntime.value?.supported) {
    return
  }
  testState.value = { status: 'testing', message: '' }
  try {
    const result = await RuntimeApi.testModel(
      form.runtime,
      form.model === DEFAULT_MODEL ? '' : form.model,
    )
    if (result.ok) {
      testState.value = {
        status: 'success',
        message: t('agents.form.testSuccess', { ms: result.latencyMs }),
      }
    } else {
      testState.value = {
        status: 'error',
        message: result.error || t('agents.form.testFailed'),
      }
    }
  } catch (err) {
    testState.value = {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

async function submitAgent() {
  if (!form.name.trim()) {
    return
  }
  if (form.model !== DEFAULT_MODEL && !modelOptions.value.some((model) => model.id === form.model)) {
    ElMessage.error(t('agents.form.modelInvalid'))
    return
  }
  const input = {
    name: form.name,
    description: form.description,
    instructions: form.instructions,
    runtime: form.runtime,
    model: form.model === DEFAULT_MODEL ? '' : form.model,
    maxConcurrency: form.maxConcurrency,
    timeoutMinutes: form.timeoutMinutes,
    allowedPaths: form.allowedPaths
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  }
  saving.value = true
  try {
    if (editingId.value) {
      await agents.update(editingId.value, input)
      ElMessage.success(t('agents.updated'))
    } else {
      await agents.create(input)
      ElMessage.success(t('agents.created'))
    }
    showCreate.value = false
    resetForm()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}

function workTagType(status?: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'working':
      return 'warning'
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'info'
  }
}

async function deleteAgent(agent: Agent) {
  try {
    await ElMessageBox.confirm(
      t('agents.deleteConfirm', { name: agent.name }),
      t('agents.deleteTitle'),
      { type: 'warning', confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel') },
    )
  } catch {
    return
  }
  try {
    await agents.remove(agent.id)
    ElMessage.success(t('agents.deleted'))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="shrink-0 flex items-center justify-between px-6 pt-5 pb-4">
      <div>
        <h1 class="text-title font-semibold tracking-tight">{{ $t('agents.title') }}</h1>
        <p class="text-caption text-fg-subtle">{{ $t('agents.subtitle') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">{{ $t('agents.newAgent') }}</el-button>
    </header>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <EmptyState
        v-if="agents.items.length === 0"
        :title="$t('agents.emptyTitle')"
        :description="$t('agents.emptyDesc')"
      />

      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <el-card
          v-for="agent in agents.items"
          :key="agent.id"
          shadow="hover"
          class="cursor-pointer"
          @click="$router.push(`/agents/${agent.id}/work`)"
        >
          <template #header>
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="text-subtitle font-semibold tracking-tight">{{ agent.name }}</h2>
                <p class="text-caption text-fg-subtle mt-0.5">
                  {{ agent.description || $t('agents.noDescription') }}
                </p>
              </div>
              <div class="flex items-center gap-1" @click.stop>
                <el-button text :icon="Edit" @click="openEdit(agent)">{{ $t('agents.edit') }}</el-button>
                <el-button text type="danger" :icon="Delete" @click="deleteAgent(agent)">
                  {{ $t('agents.delete') }}
                </el-button>
              </div>
            </div>
          </template>
          <p class="text-label text-fg-muted line-clamp-3 whitespace-pre-wrap">
            {{ agent.instructions || $t('agents.noInstructions') }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-subtle">
            <span>{{ agent.runtime }}</span>
            <span v-if="agent.model">{{ agent.model }}</span>
            <span>{{ $t('agents.card.concurrency', { n: agent.maxConcurrency }) }}</span>
            <span>{{ $t('agents.card.timeout', { n: agent.timeoutMinutes }) }}</span>
            <el-tag v-if="agent.modelStatus === 'unavailable'" type="danger" size="small">
              {{ $t('agents.card.modelUnavailable') }}
            </el-tag>
            <el-tag
              v-if="agent.workStatus"
              :type="workTagType(agent.workStatus)"
              size="small"
              class="ml-auto"
            >
              {{ $t(`work.status.${agent.workStatus}`) }}
            </el-tag>
          </div>
        </el-card>
      </div>
    </div>

    <Modal
      :open="showCreate"
      :title="editingId ? $t('agents.editAgent') : $t('agents.newAgent')"
      @close="showCreate = false"
    >
      <el-form label-position="top">
        <el-form-item :label="$t('agents.form.name')">
          <el-input v-model="form.name" :placeholder="$t('agents.form.namePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('agents.form.description')">
          <el-input v-model="form.description" :placeholder="$t('agents.form.descriptionPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('agents.form.instructions')">
          <el-input
            v-model="form.instructions"
            type="textarea"
            :rows="4"
            :placeholder="$t('agents.form.instructionsPlaceholder')"
          />
        </el-form-item>
        <div class="grid grid-cols-2 gap-3">
          <el-form-item :label="$t('agents.form.runtime')">
            <el-select v-model="form.runtime" :loading="runtimeLoading" style="width: 100%">
              <el-option
                v-for="runtime in runtimes"
                :key="runtime.name"
                :label="runtimeLabel(runtime)"
                :value="runtime.name"
                :disabled="!runtime.supported"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('agents.form.model')">
            <el-select
              v-model="form.model"
              :loading="runtimeLoading"
              :disabled="!form.runtime || runtimeLoading"
              style="width: 100%"
            >
              <el-option :label="$t('agents.form.defaultModel')" :value="DEFAULT_MODEL" />
              <el-option
                v-for="model in modelOptions"
                :key="model.id"
                :label="model.label || model.id"
                :value="model.id"
              >
                <div class="flex items-center justify-between gap-3">
                  <span>{{ model.label || model.id }}</span>
                  <span class="text-caption text-fg-subtle">
                    {{
                      model.source === 'runtime'
                        ? $t('agents.form.modelSourceRuntime')
                        : $t('agents.form.modelSourceSettings')
                    }}
                  </span>
                </div>
              </el-option>
              <el-option
                v-if="unavailableModel"
                :key="unavailableModel"
                :label="`${unavailableModel} · ${$t('agents.card.modelUnavailable')}`"
                :value="unavailableModel"
                disabled
              />
            </el-select>
            <div class="mt-2 flex items-center gap-2">
              <el-button
                size="small"
                :loading="testState.status === 'testing'"
                :disabled="!selectedRuntime?.supported || runtimeLoading"
                @click="testConnection"
              >
                {{ $t('agents.form.testConnection') }}
              </el-button>
              <span v-if="testState.status === 'success'" class="text-caption text-success">
                {{ testState.message }}
              </span>
              <span v-else-if="testState.status === 'error'" class="text-caption text-danger">
                {{ testState.message }}
              </span>
              <span v-else class="text-caption text-fg-subtle">{{ $t('agents.form.testHint') }}</span>
            </div>
            <p v-if="runtimeError" class="mt-1 text-caption text-danger">{{ runtimeError }}</p>
            <p v-else-if="!modelOptions.length && selectedRuntime?.modelsError" class="mt-1 text-caption text-fg-subtle">
              {{ selectedRuntime.modelsError }}
              <router-link class="underline" to="/settings">{{ $t('agents.form.configureModels') }}</router-link>
            </p>
            <p v-else-if="!modelOptions.length" class="mt-1 text-caption text-fg-subtle">
              {{ $t('agents.form.noModels') }}
              <router-link class="underline" to="/settings">{{ $t('agents.form.configureModels') }}</router-link>
            </p>
          </el-form-item>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <el-form-item :label="$t('agents.form.maxConcurrency')">
            <el-input-number v-model="form.maxConcurrency" :min="1" style="width: 100%" />
          </el-form-item>
          <el-form-item :label="$t('agents.form.timeoutMinutes')">
            <el-input-number v-model="form.timeoutMinutes" :min="1" style="width: 100%" />
          </el-form-item>
        </div>
        <el-form-item :label="$t('agents.form.allowedPaths')">
          <el-input v-model="form.allowedPaths" :placeholder="$t('agents.form.allowedPathsPlaceholder')" />
        </el-form-item>
      </el-form>
      <div class="flex justify-end gap-2">
        <el-button @click="showCreate = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitAgent">
          {{ editingId ? $t('common.save') : $t('common.create') }}
        </el-button>
      </div>
    </Modal>
  </div>
</template>
