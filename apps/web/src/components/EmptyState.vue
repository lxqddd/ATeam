<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-14 text-center">
    <div
      class="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-zinc-500 mb-3 text-lg"
    >
      ∅
    </div>
    <div class="text-sm font-500">{{ title }}</div>
    <div v-if="description" class="text-xs text-zinc-500 mt-1 max-w-sm">{{ description }}</div>
  </div>
</template>
