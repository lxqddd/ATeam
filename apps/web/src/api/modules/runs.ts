import type { Run, RunEvent } from '@ateam/shared'
import { HttpClient } from '../http/client'

export interface StartRunInput {
  agentId: string
  trigger?: string
}

export class RunApi {
  static list(): Promise<Run[]> {
    return HttpClient.get<Run[]>('/runs')
  }

  static listByTask(taskId: string): Promise<Run[]> {
    return HttpClient.get<Run[]>(`/tasks/${taskId}/runs`)
  }

  static start(taskId: string, input: StartRunInput): Promise<Run> {
    return HttpClient.post<Run>(`/tasks/${taskId}/runs`, input)
  }

  static listEvents(runId: string): Promise<RunEvent[]> {
    return HttpClient.get<RunEvent[]>(`/runs/${runId}/events`)
  }

  static cancel(runId: string): Promise<Run> {
    return HttpClient.post<Run>(`/runs/${runId}/cancel`)
  }
}
