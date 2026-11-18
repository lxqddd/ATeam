<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <el-empty :image-size="56">
    <template #description>
      <div class="text-body font-semibold">{{ title }}</div>
      <div v-if="description" class="text-caption text-fg-subtle mt-1">{{ description }}</div>
    </template>
  </el-empty>
</template>
