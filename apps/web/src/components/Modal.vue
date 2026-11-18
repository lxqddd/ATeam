<script setup lang="ts">
withDefaults(defineProps<{ open: boolean; title: string; width?: string }>(), { width: '640px' })
defineEmits<{ close: [] }>()
</script>

<template>
  <el-dialog :model-value="open" :title="title" :width="width" append-to-body @close="$emit('close')">
    <slot />
    <template #footer>
      <slot name="footer" />
    </template>
  </el-dialog>
</template>
