import { HealthApi } from './modules/health'
import { TaskApi } from './modules/tasks'
import { AgentApi } from './modules/agents'
import { RunApi } from './modules/runs'
import { EventApi } from './modules/events'
import { HttpClient, type HttpClientOptions } from './http/client'
import { ApiError } from './http/error'
import type { SseHandle, SseHandlers, SseMessage } from './http/sse'

export { HealthApi, TaskApi, AgentApi, RunApi, EventApi, HttpClient, ApiError }
export type { HttpClientOptions, SseHandle, SseHandlers, SseMessage }
export type { CreateTaskInput } from './modules/tasks'
export type { CreateAgentInput } from './modules/agents'
export type { StartRunInput } from './modules/runs'

/** Configure the shared HTTP client (base URL, timeout, 401 hook). */
export function configureApi(options: string | HttpClientOptions = '/api') {
  HttpClient.configure(options)
}
