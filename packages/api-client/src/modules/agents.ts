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

export class AgentApi {
  static list(): Promise<Agent[]> {
    return HttpClient.get<Agent[]>('/agents')
  }

  static get(id: string): Promise<Agent> {
    return HttpClient.get<Agent>(`/agents/${id}`)
  }

  static create(input: CreateAgentInput): Promise<Agent> {
    return HttpClient.post<Agent>('/agents', input)
  }

  static update(id: string, patch: Partial<Agent>): Promise<Agent> {
    return HttpClient.patch<Agent>(`/agents/${id}`, patch)
  }

  static delete(id: string): Promise<void> {
    return HttpClient.delete<void>(`/agents/${id}`)
  }
}
