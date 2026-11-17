<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
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
        <h1 class="text-sm font-600">Agents</h1>
        <p class="text-[11px] text-zinc-500">Reusable work profiles for tasks</p>
      </div>
      <button class="btn-primary" @click="showCreate = true">+ New agent</button>
    </header>

    <div class="flex-1 overflow-y-auto p-5">
      <EmptyState
        v-if="agents.items.length === 0"
        title="No agents yet"
        description="Create a role agent for UI design, frontend, backend, or DevOps work."
      />

      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="agent in agents.items" :key="agent.id" class="card p-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="text-sm font-600">{{ agent.name }}</h2>
              <p class="text-[11px] text-zinc-500 mt-0.5">
                {{ agent.description || 'No description' }}
              </p>
            </div>
            <span
              class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
            >
              {{ agent.runtime }}
            </span>
          </div>
          <p class="mt-3 text-xs text-zinc-400 line-clamp-3 whitespace-pre-wrap">
            {{ agent.instructions || 'No instructions yet.' }}
          </p>
          <div class="mt-3 flex items-center gap-3 text-[10px] text-zinc-500">
            <span>concurrency {{ agent.maxConcurrency }}</span>
            <span>timeout {{ agent.timeoutMinutes }}m</span>
            <span>{{ agent.workspaceMode }}</span>
          </div>
        </article>
      </div>
    </div>

    <Modal :open="showCreate" title="New agent" @close="showCreate = false">
      <div class="space-y-3">
        <div>
          <label class="label">Name</label>
          <input v-model="form.name" class="input" placeholder="Frontend Agent" />
        </div>
        <div>
          <label class="label">Description</label>
          <input v-model="form.description" class="input" placeholder="Implements UI from a design spec" />
        </div>
        <div>
          <label class="label">Instructions</label>
          <textarea
            v-model="form.instructions"
            class="input min-h-28 resize-y"
            placeholder="Responsibilities, boundaries, checks, reporting format..."
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Runtime</label>
            <select v-model="form.runtime" class="input">
              <option v-for="runtime in RUNTIMES" :key="runtime.value" :value="runtime.value">
                {{ runtime.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="label">Model (optional)</label>
            <input v-model="form.model" class="input" placeholder="default" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Max concurrency</label>
            <input v-model.number="form.maxConcurrency" type="number" min="1" class="input" />
          </div>
          <div>
            <label class="label">Timeout (minutes)</label>
            <input v-model.number="form.timeoutMinutes" type="number" min="1" class="input" />
          </div>
        </div>
        <div>
          <label class="label">Allowed paths (comma separated)</label>
          <input v-model="form.allowedPaths" class="input" placeholder="web/, packages/ui/" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" @click="createAgent">Create</button>
        </div>
      </div>
    </Modal>
  </div>
</template>
