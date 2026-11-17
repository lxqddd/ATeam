import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { ApiError, normalizeBody } from './error'

export interface HttpClientOptions {
  baseUrl?: string
  timeoutMs?: number
  onUnauthorized?: () => void
}

const DEFAULT_TIMEOUT_MS = 30_000
const FALLBACK_BASE_URL = '/api'

/**
 * Resolve the API base URL. Explicit options win, then VITE_API_BASE, then
 * the same-origin default. Vite statically replaces `import.meta.env`, so
 * this is inlined at build time rather than read at runtime.
 */
export function resolveBaseUrl(explicit?: string): string {
  if (explicit) {
    return explicit
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE
  }
  return FALLBACK_BASE_URL
}

/**
 * Resolve the request timeout. Explicit options win, then
 * VITE_API_TIMEOUT_MS (milliseconds), then 30s. Invalid or non-positive
 * values fall back to the default instead of disabling the timeout.
 */
export function resolveTimeoutMs(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_TIMEOUT_MS : undefined
  if (raw) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_TIMEOUT_MS
}

/**
 * Resolve the 401 handler. A callback cannot come from an env file, so
 * VITE_API_UNAUTHORIZED_REDIRECT supplies the behaviour: on 401 the browser
 * navigates to that path. An explicit callback always wins.
 */
export function resolveUnauthorizedHandler(explicit?: () => void): (() => void) | undefined {
  if (explicit) {
    return explicit
  }
  const redirect =
    typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_API_UNAUTHORIZED_REDIRECT
      : undefined
  if (!redirect) {
    return undefined
  }
  return () => {
    if (typeof window !== 'undefined') {
      window.location.assign(redirect)
    }
  }
}

/**
 * Shared axios instance and request helpers. Modules call `HttpClient.request`
 * with a full config so `responseType` stays a per-request decision.
 * Calling any method without prior configuration initializes lazily from
 * VITE_API_BASE.
 */
export class HttpClient {
  private static instance: AxiosInstance | null = null
  private static baseUrl = FALLBACK_BASE_URL

  static configure(options: string | HttpClientOptions = {}): AxiosInstance {
    const resolved: HttpClientOptions =
      typeof options === 'string' ? { baseUrl: options } : options
    const onUnauthorized = resolveUnauthorizedHandler(resolved.onUnauthorized)

    HttpClient.baseUrl = resolveBaseUrl(resolved.baseUrl)
    HttpClient.instance = axios.create({
      baseURL: HttpClient.baseUrl,
      timeout: resolveTimeoutMs(resolved.timeoutMs),
      headers: { 'Content-Type': 'application/json' },
    })

    HttpClient.instance.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const status = error.response?.status ?? 0
        const body = normalizeBody(error.response?.data)
        if (status === 401) {
          onUnauthorized?.()
        }
        const message = body || error.message || (status ? `HTTP ${status}` : 'network error')
        return Promise.reject(new ApiError(message, status, body))
      },
    )

    return HttpClient.instance
  }

  static get client(): AxiosInstance {
    if (!HttpClient.instance) {
      HttpClient.configure()
    }
    return HttpClient.instance as AxiosInstance
  }

  static get base(): string {
    return HttpClient.baseUrl
  }

  static async request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await HttpClient.client.request<T>(config)
    if (response.status === 204) {
      return undefined as T
    }
    return response.data
  }

  static get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return HttpClient.request<T>({ ...config, url, method: 'GET' })
  }

  static post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return HttpClient.request<T>({ ...config, url, method: 'POST', data })
  }

  static patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return HttpClient.request<T>({ ...config, url, method: 'PATCH', data })
  }

  static delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return HttpClient.request<T>({ ...config, url, method: 'DELETE' })
  }

  /**
   * Download a file or binary body. `responseType` is overridden per call so
   * JSON stays the default for everything else.
   */
  static download<T = Blob>(
    url: string,
    responseType: AxiosRequestConfig['responseType'] = 'blob',
  ): Promise<T> {
    return HttpClient.request<T>({ url, method: 'GET', responseType })
  }

  static resolveUrl(path: string): string {
    if (/^https?:\/\//.test(path)) {
      return path
    }
    const base = HttpClient.baseUrl.replace(/\/$/, '')
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `${base}${suffix}`
  }
}
