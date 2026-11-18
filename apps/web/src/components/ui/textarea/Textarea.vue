<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'

const model = defineModel<string>({ default: '' })
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <textarea v-model="model" :class="cn('textarea-control', props.class)" />
</template>
