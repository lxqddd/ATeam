<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const nav = [
  { to: '/', label: 'Board', icon: 'i-lucide-layout-dashboard' },
  { to: '/agents', label: 'Agents', icon: 'i-lucide-bot' },
  { to: '/runs', label: 'Runs', icon: 'i-lucide-activity' },
  { to: '/settings', label: 'Settings', icon: 'i-lucide-settings' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <aside class="w-60 shrink-0 border-r border-border bg-panel flex flex-col">
    <div class="h-14 flex items-center gap-2.5 px-4 border-b border-border">
      <div class="w-7 h-7 rounded-md bg-accent2 flex items-center justify-center text-white font-700">
        A
      </div>
      <div class="leading-tight">
        <div class="text-sm font-600">ATeam</div>
        <div class="text-[10px] text-zinc-500">multi-agent cockpit</div>
      </div>
    </div>

    <nav class="flex-1 p-2 space-y-1">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
        :class="{ '!text-zinc-100 !bg-white/10': isActive(item.to) }"
      >
        <span :class="item.icon" class="text-[16px] w-4 h-4" />
        {{ item.label }}
      </RouterLink>
    </nav>

    <div class="p-3 border-t border-border text-[11px] text-zinc-500">
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        local-first
      </div>
      <div class="mt-1">v0.1.0</div>
    </div>
  </aside>
</template>
