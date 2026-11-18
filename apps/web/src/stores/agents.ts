import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Agent } from '@ateam/shared'
import { AgentApi, type CreateAgentInput, type UpdateAgentInput } from '../api'

export const useAgentsStore = defineStore('agents', () => {
  const items = ref<Agent[]>([])

  async function fetchAll() {
    try {
      items.value = await AgentApi.list()
    } catch {
      // Keep the last known list; the next SSE event or manual refresh retries.
    }
  }

  async function create(input: CreateAgentInput) {
    const agent = await AgentApi.create(input)
    items.value = [agent, ...items.value]
    return agent
  }

  async function update(id: string, input: UpdateAgentInput) {
    const agent = await AgentApi.update(id, input)
    items.value = items.value.map((item) => (item.id === id ? agent : item))
    return agent
  }

  async function remove(id: string) {
    await AgentApi.delete(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, fetchAll, create, update, remove }
})
