<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div :class="cn('animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-hover)]', $props.class)" />
</template>
