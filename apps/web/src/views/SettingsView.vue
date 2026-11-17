<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Health } from '@ateam/shared'
import { api } from '../api'

const health = ref<Health | null>(null)
const error = ref('')

async function check() {
  try {
    health.value = await api.health()
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => {
  void check()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="h-14 shrink-0 border-b border-border flex items-center px-5">
      <div>
        <h1 class="text-sm font-600">Settings</h1>
        <p class="text-[11px] text-zinc-500">Runtime and workspace configuration</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-5 space-y-4 max-w-3xl">
      <section class="card p-4">
        <h2 class="text-xs font-600 text-zinc-400 mb-3">API CONNECTION</h2>
        <div class="flex items-center gap-2">
          <button class="btn-ghost" @click="check">Check health</button>
          <span v-if="health" class="text-xs text-emerald-300">OK · v{{ health.version }}</span>
          <span v-if="error" class="text-xs text-rose-300">{{ error }}</span>
        </div>
        <p class="mt-2 text-[11px] text-zinc-500">
          The web UI calls <code class="text-zinc-300">/api</code>; Vite proxies it to the Go
          server in development.
        </p>
      </section>

      <section class="card p-4">
        <h2 class="text-xs font-600 text-zinc-400 mb-3">WORKSPACE</h2>
        <p class="text-xs text-zinc-400">
          Each run gets a directory under
          <code class="text-zinc-300">~/.ateam/workspaces/runs/&lt;run-id&gt;</code>. Git worktree
          isolation is the next milestone.
        </p>
      </section>

      <section class="card p-4">
        <h2 class="text-xs font-600 text-zinc-400 mb-3">ABOUT</h2>
        <p class="text-xs text-zinc-400">
          ATeam is an original, local-first implementation. It does not include third-party
          product code, docs, UI assets, or trademarks.
        </p>
      </section>
    </div>
  </div>
</template>
