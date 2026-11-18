import type { Workspace } from '@ateam/shared'
import { HttpClient } from '../http/client'

export class WorkspaceApi {
  static list(): Promise<Workspace[]> {
    return HttpClient.get<Workspace[]>('/v1/workspaces')
  }

  static get(id: string): Promise<Workspace> {
    return HttpClient.get<Workspace>(`/v1/workspaces/${id}`)
  }
}
