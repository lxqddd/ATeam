<script setup lang="ts">
import { CheckIcon } from '@lucide/vue'
import type { ThemeInfo } from '../stores/theme'

defineProps<{ theme: ThemeInfo; selected: boolean }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="group flex flex-col gap-2 rounded-[var(--cd-radius-lg)] border p-3 text-left transition-colors"
    :class="
      selected
        ? 'border-[var(--cd-color-accent)] bg-[var(--cd-color-accent-soft)]'
        : 'border-[var(--cd-color-border-subtle)] bg-[var(--cd-color-surface)] hover:border-[var(--cd-color-border-strong)]'
    "
    role="radio"
    :aria-checked="selected"
    :title="$t(theme.descKey)"
    @click="$emit('select')"
  >
    <span
      class="relative block h-16 w-full overflow-hidden rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border-subtle)]"
      :style="{ background: theme.swatch[0] }"
    >
      <span class="absolute inset-x-2 top-2 h-2 rounded-sm" :style="{ background: theme.swatch[1] }" />
      <span class="absolute inset-x-2 top-5 h-1.5 w-2/3 rounded-sm" :style="{ background: theme.swatch[2], opacity: 0.7 }" />
      <span class="absolute inset-x-2 bottom-2 h-3 w-1/3 rounded-sm" :style="{ background: theme.swatch[3] }" />
      <span
        v-if="selected"
        class="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--cd-color-accent)] text-[var(--cd-color-text-on-accent)]"
      >
        <CheckIcon class="size-3" />
      </span>
    </span>
    <span class="text-label font-medium">{{ $t(theme.nameKey) }}</span>
  </button>
</template>
