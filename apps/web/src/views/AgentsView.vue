<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { RUNTIMES } from '@ateam/shared'
import { useAgentsStore } from '../stores/agents'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'

const agents = useAgentsStore()
const showCreate = ref(false)
const form = reactive({
  name: '',
  description: '',
  instructions: '',
  runtime: 'mock',
  model: '',
  maxConcurrency: 1,
  timeoutMinutes: 60,
  allowedPaths: '',
})

onMounted(() => {
  void agents.fetchAll()
})

async function createAgent() {
  if (!form.name.trim()) {
    return
  }
  await agents.create({
    name: form.name,
    description: form.description,
    instructions: form.instructions,
    runtime: form.runtime,
    model: form.model,
    maxConcurrency: form.maxConcurrency,
    timeoutMinutes: form.timeoutMinutes,
    allowedPaths: form.allowedPaths
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  })
  form.name = ''
  form.description = ''
  form.instructions = ''
  form.runtime = 'mock'
  form.model = ''
  form.allowedPaths = ''
  showCreate.value = false
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="h-14 shrink-0 border-b border-border flex items-center justify-between px-5">
      <div>
        <h1 class="text-sm font-semibold">{{ $t('agents.title') }}</h1>
        <p class="text-[11px] text-zinc-500">{{ $t('agents.subtitle') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="showCreate = true">{{ $t('agents.newAgent') }}</el-button>
    </header>

    <div class="flex-1 overflow-y-auto p-5">
      <EmptyState
        v-if="agents.items.length === 0"
        :title="$t('agents.emptyTitle')"
        :description="$t('agents.emptyDesc')"
      />

      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <el-card v-for="agent in agents.items" :key="agent.id" shadow="hover">
          <template #header>
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold">{{ agent.name }}</h2>
                <p class="text-[11px] text-zinc-500 mt-0.5">
                  {{ agent.description || $t('agents.noDescription') }}
                </p>
              </div>
              <el-tag size="small" effect="dark">{{ agent.runtime }}</el-tag>
            </div>
          </template>
          <p class="text-xs text-zinc-400 line-clamp-3 whitespace-pre-wrap">
            {{ agent.instructions || $t('agents.noInstructions') }}
          </p>
          <div class="mt-3 flex items-center gap-3 text-[10px] text-zinc-500">
            <span>{{ $t('agents.card.concurrency', { n: agent.maxConcurrency }) }}</span>
            <span>{{ $t('agents.card.timeout', { n: agent.timeoutMinutes }) }}</span>
            <span>{{ agent.workspaceMode }}</span>
          </div>
        </el-card>
      </div>
    </div>

    <Modal :open="showCreate" :title="$t('agents.newAgent')" @close="showCreate = false">
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
            <el-select v-model="form.runtime" style="width: 100%">
              <el-option
                v-for="runtime in RUNTIMES"
                :key="runtime.value"
                :label="runtime.label"
                :value="runtime.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('agents.form.model')">
            <el-input v-model="form.model" :placeholder="$t('agents.form.modelPlaceholder')" />
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
        <el-button type="primary" @click="createAgent">{{ $t('common.create') }}</el-button>
      </div>
    </Modal>
  </div>
</template>
