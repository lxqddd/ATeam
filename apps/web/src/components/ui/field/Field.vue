<script setup lang="ts">
defineProps<{ label?: string; hint?: string; error?: string; for?: string }>()
</script>

<template>
  <div class="field">
    <label v-if="label" class="field__label" :for="$props.for">{{ label }}</label>
    <slot />
    <p v-if="error" class="field__error">{{ error }}</p>
    <p v-else-if="hint" class="field__hint">{{ hint }}</p>
  </div>
</template>
