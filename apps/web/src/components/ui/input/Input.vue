<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

const model = defineModel<string>({ default: '' })
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <input v-model="model" :class="cn('input-control', props.class)" />
</template>
