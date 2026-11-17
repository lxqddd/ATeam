import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Agent } from '@ateam/shared'
import { AgentApi, type CreateAgentInput } from '../api'

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

  return { items, fetchAll, create }
})
