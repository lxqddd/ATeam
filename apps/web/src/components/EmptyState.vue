<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <el-empty :image-size="56">
    <template #description>
      <div class="text-sm font-medium">{{ title }}</div>
      <div v-if="description" class="text-xs text-zinc-500 mt-1">{{ description }}</div>
    </template>
  </el-empty>
</template>
