import type { ModelTestResult, RuntimeInfo, RuntimeModel } from '@ateam/shared'
import { HttpClient } from '../http/client'

interface RuntimeListResponse {
  runtimes: RuntimeInfo[]
}

export class RuntimeApi {
  static async list(): Promise<RuntimeInfo[]> {
    const response = await HttpClient.get<RuntimeListResponse>('/runtimes')
    return response.runtimes
  }

  static updateModels(name: string, models: Pick<RuntimeModel, 'id' | 'label'>[]): Promise<RuntimeInfo> {
    return HttpClient.put<RuntimeInfo>(`/runtimes/${encodeURIComponent(name)}/models`, {
      models: models.map((model) => ({ id: model.id, label: model.label || undefined })),
    })
  }

  static testModel(name: string, model: string): Promise<ModelTestResult> {
    return HttpClient.post<ModelTestResult>(`/runtimes/${encodeURIComponent(name)}/test`, { model })
  }
}
