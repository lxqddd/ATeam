import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Task } from '@ateam/shared'
import { TaskApi, type CreateTaskInput } from '../api'

export const useTasksStore = defineStore('tasks', () => {
  const items = ref<Task[]>([])

  async function fetchAll() {
    try {
      items.value = await TaskApi.list()
    } catch {
      // Keep the last known list; the next SSE event or manual refresh retries.
    }
  }

  async function create(input: CreateTaskInput) {
    const task = await TaskApi.create(input)
    items.value = [task, ...items.value]
    return task
  }

  async function update(id: string, patch: Partial<Task>) {
    const task = await TaskApi.update(id, patch)
    const index = items.value.findIndex((item) => item.id === id)
    if (index >= 0) {
      items.value[index] = task
    }
    return task
  }

  return { items, fetchAll, create, update }
})
