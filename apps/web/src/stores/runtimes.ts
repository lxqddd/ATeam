import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelTestResult, RuntimeInfo, RuntimeModel } from '@ateam/shared'
import { RuntimeApi } from '../api'

export const useRuntimesStore = defineStore('runtimes', () => {
  const items = ref<RuntimeInfo[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchAll() {
    loading.value = true
    try {
      items.value = await RuntimeApi.list()
      error.value = ''
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function saveModels(
    name: string,
    models: Pick<RuntimeModel, 'id' | 'label'>[],
    defaultModel: string,
  ) {
    const updated = await RuntimeApi.updateModels(name, models, defaultModel)
    const index = items.value.findIndex((item) => item.name === name)
    if (index >= 0) {
      items.value[index] = updated
    }
    return updated
  }

  function testModel(name: string, model: string): Promise<ModelTestResult> {
    return RuntimeApi.testModel(name, model)
  }

  return { items, loading, error, fetchAll, saveModels, testModel }
})
