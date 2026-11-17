import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Agent } from '@ateam/shared'
import { AgentApi, type CreateAgentInput } from '../api'

export const useAgentsStore = defineStore('agents', () => {
  const items = ref<Agent[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchAll() {
    loading.value = true
    try {
      items.value = await AgentApi.list()
      error.value = ''
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function create(input: CreateAgentInput) {
    const agent = await AgentApi.create(input)
    items.value = [agent, ...items.value]
    return agent
  }

  async function remove(id: string) {
    await AgentApi.delete(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, loading, error, fetchAll, create, remove }
})
