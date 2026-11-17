import type { Health } from '@ateam/shared'
import { HttpClient } from '../http/client'

export class HealthApi {
  static get(): Promise<Health> {
    return HttpClient.get<Health>('/health')
  }
}
