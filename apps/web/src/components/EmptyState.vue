<script setup lang="ts">
import { InboxIcon } from '@lucide/vue'

defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
    <span class="flex size-9 items-center justify-center rounded-full bg-[var(--cd-color-surface-raised)] text-fg-subtle">
      <InboxIcon class="size-4" />
    </span>
    <p class="text-body font-semibold">{{ title }}</p>
    <p v-if="description" class="text-caption text-fg-subtle">{{ description }}</p>
    <slot />
  </div>
</template>
