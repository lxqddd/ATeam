<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div class="absolute inset-0 bg-black/60" @click="$emit('close')" />
      <div class="relative w-full max-w-lg card p-5 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-600">{{ title }}</h2>
          <button class="btn-ghost !px-2" @click="$emit('close')">✕</button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
