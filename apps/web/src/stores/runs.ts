import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Run } from '@ateam/shared'
import { RunApi } from '../api'

export const useRunsStore = defineStore('runs', () => {
  const items = ref<Run[]>([])

  async function fetchAll() {
    try {
      items.value = await RunApi.list()
    } catch {
      // Keep the last known list; the next SSE event or manual refresh retries.
    }
  }

  return { items, fetchAll }
})
