import type { Agent, AgentWork } from '@ateam/shared'
import { HttpClient } from '../http/client'

export interface CreateAgentInput {
  name: string
  description?: string
  instructions?: string
  runtime?: string
  model?: string
  workspaceMode?: string
  maxConcurrency?: number
  timeoutMinutes?: number
  allowedPaths?: string[]
  allowedCommands?: string[]
}

export type UpdateAgentInput = Partial<CreateAgentInput>

export class AgentApi {
  static list(): Promise<Agent[]> {
    return HttpClient.get<Agent[]>('/agents')
  }

  static listWithWorkStatus(): Promise<(Agent & { workStatus?: string; activeRunCount?: number })[]> {
    return HttpClient.get<(Agent & { workStatus?: string; activeRunCount?: number })[]>('/agents', {
      params: { include: 'workStatus' },
    })
  }

  static work(id: string): Promise<AgentWork> {
    return HttpClient.get<AgentWork>(`/agents/${id}/work`)
  }

  static create(input: CreateAgentInput): Promise<Agent> {
    return HttpClient.post<Agent>('/agents', input)
  }

  static update(id: string, input: UpdateAgentInput): Promise<Agent> {
    return HttpClient.patch<Agent>(`/agents/${id}`, input)
  }

  static delete(id: string): Promise<void> {
    return HttpClient.delete<void>(`/agents/${id}`)
  }
}
