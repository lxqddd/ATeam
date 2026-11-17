<script setup lang="ts">
import AppSidebar from './components/AppSidebar.vue'
import { useEventStream } from './composables/useEventStream'

useEventStream()
</script>

<template>
  <div class="h-screen w-screen flex bg-bg text-zinc-100 overflow-hidden">
    <AppSidebar />
    <main class="flex-1 min-w-0 flex flex-col">
      <router-view />
    </main>
  </div>
</template>
