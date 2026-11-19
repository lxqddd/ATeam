import type { Run, RunEvent, RunSnapshot } from '@ateam/shared'
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

  static steer(runId: string, message: string): Promise<{ accepted: boolean; runId: string }> {
    return HttpClient.post<{ accepted: boolean; runId: string }>(`/runs/${runId}/steer`, { message })
  }
}

export class RunDetailApi {
  static get(runId: string): Promise<Run> {
    return HttpClient.get<Run>(`/runs/${runId}`)
  }

  static snapshot(runId: string): Promise<RunSnapshot> {
    return HttpClient.get<RunSnapshot>(`/runs/${runId}/snapshot`)
  }
}
