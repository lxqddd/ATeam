<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Health } from '@ateam/shared'
import { HealthApi } from '../api'

const health = ref<Health | null>(null)
const error = ref('')

async function check() {
  try {
    health.value = await HealthApi.get()
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
        <h1 class="text-sm font-semibold">Settings</h1>
        <p class="text-[11px] text-zinc-500">Runtime and workspace configuration</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-5 space-y-4 max-w-3xl">
      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400">API CONNECTION</span>
        </template>
        <div class="flex items-center gap-3">
          <el-button @click="check">Check health</el-button>
          <el-tag v-if="health" type="success">OK · v{{ health.version }}</el-tag>
          <el-tag v-if="error" type="danger">{{ error }}</el-tag>
        </div>
        <p class="mt-3 text-[11px] text-zinc-500">
          The web UI calls <code class="text-zinc-300">/api</code>; Vite proxies it to the Go
          server in development.
        </p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400">WORKSPACE</span>
        </template>
        <p class="text-xs text-zinc-400">
          Each run gets a directory under
          <code class="text-zinc-300">~/.ateam/workspaces/runs/&lt;run-id&gt;</code>. Git worktree
          isolation is the next milestone.
        </p>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <span class="text-xs font-semibold text-zinc-400">ABOUT</span>
        </template>
        <p class="text-xs text-zinc-400">
          ATeam is an original, local-first implementation. It does not include third-party
          product code, docs, UI assets, or trademarks.
        </p>
      </el-card>
    </div>
  </div>
</template>
