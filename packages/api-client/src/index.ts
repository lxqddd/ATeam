import { HealthApi } from './modules/health'
import { TaskApi } from './modules/tasks'
import { AgentApi } from './modules/agents'
import { RunApi } from './modules/runs'
import { EventApi } from './modules/events'
import { HttpClient, resolveBaseUrl, type HttpClientOptions } from './http/client'
import { ApiError } from './http/error'
import type { SseHandle, SseHandlers, SseMessage } from './http/sse'

export { HealthApi, TaskApi, AgentApi, RunApi, EventApi, HttpClient, ApiError, resolveBaseUrl }
export type { HttpClientOptions, SseHandle, SseHandlers, SseMessage }
export type { CreateTaskInput } from './modules/tasks'
export type { CreateAgentInput } from './modules/agents'
export type { StartRunInput } from './modules/runs'

/**
 * Optional. The client initializes lazily from VITE_API_BASE, so this is only
 * needed to override the base URL, timeout, or 401 handling.
 */
export function configureApi(options: string | HttpClientOptions = {}) {
  HttpClient.configure(options)
}
