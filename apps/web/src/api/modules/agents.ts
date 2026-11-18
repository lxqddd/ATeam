import type { Agent } from '@ateam/shared'
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
