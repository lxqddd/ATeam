import type { Workspace, WorkspaceSettings } from '@ateam/shared'
import { HttpClient } from '../http/client'

export interface UpdateWorkspaceInput {
  settings?: WorkspaceSettings
}

export class WorkspaceApi {
  static list(): Promise<Workspace[]> {
    return HttpClient.get<Workspace[]>('/v1/workspaces')
  }

  static get(id: string): Promise<Workspace> {
    return HttpClient.get<Workspace>(`/v1/workspaces/${id}`)
  }

  static update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    return HttpClient.patch<Workspace>(`/v1/workspaces/${id}`, input)
  }
}
