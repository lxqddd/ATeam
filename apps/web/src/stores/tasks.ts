import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Task } from '@ateam/shared'
import { TaskApi, type CreateTaskInput } from '@ateam/api-client'

export const useTasksStore = defineStore('tasks', () => {
  const items = ref<Task[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchAll() {
    loading.value = true
    try {
      items.value = await TaskApi.list()
      error.value = ''
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
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

  async function remove(id: string) {
    await TaskApi.delete(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, loading, error, fetchAll, create, update, remove }
})
