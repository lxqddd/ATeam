import type { Artifact, TaskArtifactsResponse } from '@ateam/shared'
import { HttpClient } from '../http/client'

export class ArtifactApi {
  static listByRun(runId: string): Promise<Artifact[]> {
    return HttpClient.get<Artifact[]>(`/v1/runs/${runId}/artifacts`)
  }

  static get(id: string): Promise<Artifact> {
    return HttpClient.get<Artifact>(`/v1/artifacts/${id}`)
  }

  static content(id: string, maxBytes = 200_000): Promise<string> {
    return HttpClient.get<string>(`/v1/artifacts/${id}/content`, {
      params: { maxBytes },
      responseType: 'text',
    })
  }

  static listByTask(taskId: string): Promise<TaskArtifactsResponse> {
    return HttpClient.get<TaskArtifactsResponse>(`/v1/tasks/${taskId}/artifacts`)
  }
}
