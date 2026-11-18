<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

const props = withDefaults(
  defineProps<{
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'
    soft?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { tone: 'neutral', soft: true },
)
</script>

<template>
  <span class="badge" :class="cn(props.class)" :data-tone="props.tone" :data-soft="props.soft">
    <slot />
  </span>
</template>
