<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { AGENT_ROLES, type Agent, type RuntimeInfo } from '@ateam/shared'
import { RuntimeApi } from '../api'
import { useAgentsStore } from '../stores/agents'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Loader } from '../components/ai-elements/loader'
import { workTone } from '../lib/status'

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
  role: 'general',
  permissionMode: 'controlled_edit',
  maxConcurrency: 1,
  timeoutMinutes: 60,
  allowedPaths: '',
  allowedCommands: '',
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
  form.role = 'general'
  form.permissionMode = 'controlled_edit'
  form.maxConcurrency = 1
  form.timeoutMinutes = 60
  form.allowedPaths = ''
  form.allowedCommands = ''
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
  form.role = agent.role || 'general'
  form.permissionMode = agent.permissionMode || 'controlled_edit'
  form.maxConcurrency = agent.maxConcurrency
  form.timeoutMinutes = agent.timeoutMinutes
  form.allowedPaths = agent.allowedPaths.join(', ')
  form.allowedCommands = agent.allowedCommands.join(', ')
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
    role: form.role,
    permissionMode: form.permissionMode,
    maxConcurrency: form.maxConcurrency,
    timeoutMinutes: form.timeoutMinutes,
    allowedPaths: form.allowedPaths
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    allowedCommands: form.allowedCommands
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
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <Button size="lg" @click="openCreate">
        <PlusIcon class="size-4" />
        {{ $t('agents.newAgent') }}
      </Button>
    </Teleport>

    <div class="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <EmptyState
        v-if="agents.items.length === 0"
        :title="$t('agents.emptyTitle')"
        :description="$t('agents.emptyDesc')"
      />

      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="agent in agents.items"
          :key="agent.id"
          class="agent-card section-card group cursor-pointer p-4 transition-[border-color,box-shadow] hover:shadow-[var(--cd-shadow-sm)]"
          @click="$router.push(`/agents/${agent.id}/work`)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate text-subtitle font-semibold tracking-tight">
                <router-link :to="`/agents/${agent.id}/work`">{{ agent.name }}</router-link>
              </h2>
              <p class="mt-0.5 truncate text-caption text-fg-subtle">
                {{ agent.description || $t('agents.noDescription') }}
              </p>
            </div>
            <div
              class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              @click.stop
              @keydown.stop
            >
              <Button
                variant="ghost"
                size="icon-sm"
                :title="$t('agents.edit')"
                :aria-label="$t('agents.edit')"
                @click="openEdit(agent)"
              >
                <PencilIcon class="size-4" />
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                :title="$t('agents.delete')"
                :aria-label="$t('agents.delete')"
                @click="deleteAgent(agent)"
              >
                <Trash2Icon class="size-4" />
              </Button>
            </div>
          </div>

          <p class="mt-3 line-clamp-3 whitespace-pre-wrap text-label text-fg-muted">
            {{ agent.instructions || $t('agents.noInstructions') }}
          </p>

          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-subtle">
            <span>{{ agent.runtime }}</span>
            <span v-if="agent.model">{{ agent.model }}</span>
            <span>{{ $t('agents.card.concurrency', { n: agent.maxConcurrency }) }}</span>
            <span>{{ $t('agents.card.timeout', { n: agent.timeoutMinutes }) }}</span>
            <Badge v-if="agent.modelStatus === 'unavailable'" tone="danger">
              {{ $t('agents.card.modelUnavailable') }}
            </Badge>
            <Badge v-if="agent.workStatus" :tone="workTone(agent.workStatus)" class="ml-auto">
              {{ $t(`work.status.${agent.workStatus}`) }}
            </Badge>
          </div>
        </article>
      </div>
    </div>

    <Modal
      :open="showCreate"
      :title="editingId ? $t('agents.editAgent') : $t('agents.newAgent')"
      @close="showCreate = false"
    >
      <div class="flex flex-col gap-4">
        <Field :label="$t('agents.form.name')" for="agent-name">
          <Input id="agent-name" v-model="form.name" :placeholder="$t('agents.form.namePlaceholder')" />
        </Field>
        <Field :label="$t('agents.form.description')" for="agent-description">
          <Input
            id="agent-description"
            v-model="form.description"
            :placeholder="$t('agents.form.descriptionPlaceholder')"
          />
        </Field>
        <Field :label="$t('agents.form.instructions')" for="agent-instructions">
          <Textarea
            id="agent-instructions"
            v-model="form.instructions"
            rows="4"
            :placeholder="$t('agents.form.instructionsPlaceholder')"
          />
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field :label="$t('agents.form.runtime')" for="agent-runtime">
            <el-select id="agent-runtime" v-model="form.runtime" :loading="runtimeLoading" style="width: 100%">
              <el-option
                v-for="runtime in runtimes"
                :key="runtime.name"
                :label="runtimeLabel(runtime)"
                :value="runtime.name"
                :disabled="!runtime.supported"
              />
            </el-select>
          </Field>
          <Field :label="$t('agents.form.role')" for="agent-role">
            <el-select id="agent-role" v-model="form.role" style="width: 100%">
              <el-option
                v-for="role in AGENT_ROLES"
                :key="role.value"
                :label="$t(role.labelKey)"
                :value="role.value"
              />
            </el-select>
          </Field>
        </div>

        <Field :label="$t('agents.form.model')" for="agent-model">
          <el-select
            id="agent-model"
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
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              :disabled="!selectedRuntime?.supported || runtimeLoading || testState.status === 'testing'"
              @click="testConnection"
            >
              <Loader v-if="testState.status === 'testing'" :size="12" />
              {{ $t('agents.form.testConnection') }}
            </Button>
            <span v-if="testState.status === 'success'" class="text-caption text-success">
              {{ testState.message }}
            </span>
            <span v-else-if="testState.status === 'error'" class="text-caption text-danger">
              {{ testState.message }}
            </span>
            <span v-else class="text-caption text-fg-subtle">{{ $t('agents.form.testHint') }}</span>
          </div>
          <p v-if="runtimeError" class="text-caption text-danger">{{ runtimeError }}</p>
          <p v-else-if="!modelOptions.length && selectedRuntime?.modelsError" class="text-caption text-fg-subtle">
            {{ selectedRuntime.modelsError }}
            <router-link class="underline" to="/settings">{{ $t('agents.form.configureModels') }}</router-link>
          </p>
          <p v-else-if="!modelOptions.length" class="text-caption text-fg-subtle">
            {{ $t('agents.form.noModels') }}
            <router-link class="underline" to="/settings">{{ $t('agents.form.configureModels') }}</router-link>
          </p>
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field :label="$t('agents.form.maxConcurrency')" for="agent-concurrency">
            <el-input-number id="agent-concurrency" v-model="form.maxConcurrency" :min="1" style="width: 100%" />
          </Field>
          <Field :label="$t('agents.form.timeoutMinutes')" for="agent-timeout">
            <el-input-number id="agent-timeout" v-model="form.timeoutMinutes" :min="1" style="width: 100%" />
          </Field>
        </div>

        <Field :label="$t('agents.form.permissionMode')" for="agent-permission-mode">
          <el-select id="agent-permission-mode" v-model="form.permissionMode" style="width: 100%">
            <el-option :label="$t('agents.form.permissionReadOnly')" value="read_only" />
            <el-option :label="$t('agents.form.permissionControlled')" value="controlled_edit" />
            <el-option :label="$t('agents.form.permissionFull')" value="full_access" />
          </el-select>
          <p v-if="form.permissionMode === 'full_access'" class="text-caption text-danger">
            {{ $t('agents.form.permissionFullWarning') }}
          </p>
        </Field>

        <Field
          :label="$t('agents.form.allowedPaths')"
          :hint="$t('agents.form.allowedPathsHint')"
          for="agent-allowed-paths"
        >
          <Input
            id="agent-allowed-paths"
            v-model="form.allowedPaths"
            :placeholder="$t('agents.form.allowedPathsPlaceholder')"
          />
        </Field>

        <Field
          :label="$t('agents.form.allowedCommands')"
          :hint="$t('agents.form.allowedCommandsHint')"
          for="agent-allowed-commands"
        >
          <Input
            id="agent-allowed-commands"
            v-model="form.allowedCommands"
            :placeholder="$t('agents.form.allowedCommandsPlaceholder')"
          />
        </Field>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="showCreate = false">{{ $t('common.cancel') }}</Button>
          <Button :disabled="saving" @click="submitAgent">
            <Loader v-if="saving" :size="14" />
            {{ editingId ? $t('common.save') : $t('common.create') }}
          </Button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.agent-card:hover {
  border-color: var(--cd-color-border-strong);
}
</style>
