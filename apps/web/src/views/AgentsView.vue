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
        <h1 class="text-sm font-semibold">Agents</h1>
        <p class="text-[11px] text-zinc-500">Reusable work profiles for tasks</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="showCreate = true">New agent</el-button>
    </header>

    <div class="flex-1 overflow-y-auto p-5">
      <EmptyState
        v-if="agents.items.length === 0"
        title="No agents yet"
        description="Create a role agent for UI design, frontend, backend, or DevOps work."
      />

      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <el-card v-for="agent in agents.items" :key="agent.id" shadow="hover">
          <template #header>
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold">{{ agent.name }}</h2>
                <p class="text-[11px] text-zinc-500 mt-0.5">
                  {{ agent.description || 'No description' }}
                </p>
              </div>
              <el-tag size="small" effect="dark">{{ agent.runtime }}</el-tag>
            </div>
          </template>
          <p class="text-xs text-zinc-400 line-clamp-3 whitespace-pre-wrap">
            {{ agent.instructions || 'No instructions yet.' }}
          </p>
          <div class="mt-3 flex items-center gap-3 text-[10px] text-zinc-500">
            <span>concurrency {{ agent.maxConcurrency }}</span>
            <span>timeout {{ agent.timeoutMinutes }}m</span>
            <span>{{ agent.workspaceMode }}</span>
          </div>
        </el-card>
      </div>
    </div>

    <Modal :open="showCreate" title="New agent" @close="showCreate = false">
      <el-form label-position="top">
        <el-form-item label="Name">
          <el-input v-model="form.name" placeholder="Frontend Agent" />
        </el-form-item>
        <el-form-item label="Description">
          <el-input v-model="form.description" placeholder="Implements UI from a design spec" />
        </el-form-item>
        <el-form-item label="Instructions">
          <el-input
            v-model="form.instructions"
            type="textarea"
            :rows="4"
            placeholder="Responsibilities, boundaries, checks, reporting format..."
          />
        </el-form-item>
        <div class="grid grid-cols-2 gap-3">
          <el-form-item label="Runtime">
            <el-select v-model="form.runtime" style="width: 100%">
              <el-option
                v-for="runtime in RUNTIMES"
                :key="runtime.value"
                :label="runtime.label"
                :value="runtime.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="Model (optional)">
            <el-input v-model="form.model" placeholder="default" />
          </el-form-item>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <el-form-item label="Max concurrency">
            <el-input-number v-model="form.maxConcurrency" :min="1" style="width: 100%" />
          </el-form-item>
          <el-form-item label="Timeout (minutes)">
            <el-input-number v-model="form.timeoutMinutes" :min="1" style="width: 100%" />
          </el-form-item>
        </div>
        <el-form-item label="Allowed paths (comma separated)">
          <el-input v-model="form.allowedPaths" placeholder="web/, packages/ui/" />
        </el-form-item>
      </el-form>
      <div class="flex justify-end gap-2">
        <el-button @click="showCreate = false">Cancel</el-button>
        <el-button type="primary" @click="createAgent">Create</el-button>
      </div>
    </Modal>
  </div>
</template>
