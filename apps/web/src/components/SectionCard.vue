<script setup lang="ts">
defineProps<{ title?: string; description?: string }>()
</script>

<template>
  <section class="section-card">
    <header v-if="title || $slots.actions" class="section-card__header">
      <div>
        <h2 v-if="title" class="section-card__title">{{ title }}</h2>
        <p v-if="description" class="section-card__desc">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div class="section-card__body">
      <slot />
    </div>
  </section>
</template>
