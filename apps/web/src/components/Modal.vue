<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="520px"
    append-to-body
    @close="$emit('close')"
  >
    <slot />
  </el-dialog>
</template>
