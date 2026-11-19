import type { CLIHarnessInfo, ModelTestResult, RuntimeInfo, RuntimeModel } from '@ateam/shared'
import { HttpClient } from '../http/client'

interface RuntimeListResponse {
  runtimes: RuntimeInfo[]
}

interface CLIHarnessListResponse {
  harnesses: CLIHarnessInfo[]
}

export class RuntimeApi {
  static async list(): Promise<RuntimeInfo[]> {
    const response = await HttpClient.get<RuntimeListResponse>('/runtimes')
    return response.runtimes
  }

  static updateModels(
    name: string,
    models: Pick<RuntimeModel, 'id' | 'label'>[],
    defaultModel?: string,
  ): Promise<RuntimeInfo> {
    const body: {
      models: { id: string; label?: string }[]
      defaultModel?: string
    } = {
      models: models.map((model) => ({ id: model.id, label: model.label || undefined })),
    }
    // Omit the field entirely when the caller does not manage the default
    // model: the backend then preserves the stored value. An explicit empty
    // string clears it.
    if (defaultModel !== undefined) {
      body.defaultModel = defaultModel
    }
    return HttpClient.put<RuntimeInfo>(`/runtimes/${encodeURIComponent(name)}/models`, body)
  }

  static testModel(name: string, model: string): Promise<ModelTestResult> {
    return HttpClient.post<ModelTestResult>(`/runtimes/${encodeURIComponent(name)}/test`, { model })
  }

  static async cliHarnesses(): Promise<CLIHarnessInfo[]> {
    const response = await HttpClient.get<CLIHarnessListResponse>('/cli-harnesses')
    return response.harnesses
  }

  static createCLIAccount(
    runtimeId: string,
    name: string,
  ): Promise<{ profile: { name: string; path: string; loginCommand: string } }> {
    return HttpClient.post<{ profile: { name: string; path: string; loginCommand: string } }>(
      `/cli-harnesses/${encodeURIComponent(runtimeId)}/accounts`,
      { name },
    )
  }
}
