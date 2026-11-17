import type { Task } from '@ateam/shared'
import { HttpClient } from '../http/client'

export interface CreateTaskInput {
  title: string
  description?: string
  status?: Task['status']
  priority?: number
  assigneeType?: Task['assigneeType']
  assigneeId?: string
  parentId?: string
  labels?: string[]
}

export class TaskApi {
  static list(): Promise<Task[]> {
    return HttpClient.get<Task[]>('/tasks')
  }

  static get(id: string): Promise<Task> {
    return HttpClient.get<Task>(`/tasks/${id}`)
  }

  static create(input: CreateTaskInput): Promise<Task> {
    return HttpClient.post<Task>('/tasks', input)
  }

  static update(id: string, patch: Partial<Task>): Promise<Task> {
    return HttpClient.patch<Task>(`/tasks/${id}`, patch)
  }

  static delete(id: string): Promise<void> {
    return HttpClient.delete<void>(`/tasks/${id}`)
  }
}
