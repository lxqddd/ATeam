import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Run } from '@ateam/shared'
import { api } from '../api'

export const useRunsStore = defineStore('runs', () => {
  const items = ref<Run[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchAll() {
    loading.value = true
    try {
      items.value = await api.listRuns()
      error.value = ''
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  return { items, loading, error, fetchAll }
})
