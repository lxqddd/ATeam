import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Task } from '@ateam/shared'
import type { CreateTaskInput } from '@ateam/api-client'
import { api } from '../api'

export const useTasksStore = defineStore('tasks', () => {
  const items = ref<Task[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchAll() {
    loading.value = true
    try {
      items.value = await api.listTasks()
      error.value = ''
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function create(input: CreateTaskInput) {
    const task = await api.createTask(input)
    items.value = [task, ...items.value]
    return task
  }

  async function update(id: string, patch: Partial<Task>) {
    const task = await api.updateTask(id, patch)
    const index = items.value.findIndex((item) => item.id === id)
    if (index >= 0) {
      items.value[index] = task
    }
    return task
  }

  async function remove(id: string) {
    await api.deleteTask(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, loading, error, fetchAll, create, update, remove }
})
