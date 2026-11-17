import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { ApiError, normalizeBody } from './error'

const DEFAULT_TIMEOUT_MS = 30_000
const FALLBACK_BASE_URL = '/api'

/**
 * Shared axios instance and request helpers. Configuration comes from Vite
 * env vars, which are inlined at build time; there is no runtime setter.
 * Modules call `HttpClient.request` with a full config so `responseType`
 * stays a per-request decision.
 */
export class HttpClient {
  private static instance: AxiosInstance | null = null
  private static baseUrl = FALLBACK_BASE_URL

  private static configure(): AxiosInstance {
    const env = import.meta.env
    const timeout = Number(env?.VITE_API_TIMEOUT_MS)
    const unauthorizedRedirect = env?.VITE_API_UNAUTHORIZED_REDIRECT

    HttpClient.baseUrl = env?.VITE_API_BASE || FALLBACK_BASE_URL
    HttpClient.instance = axios.create({
      baseURL: HttpClient.baseUrl,
      timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    })

    HttpClient.instance.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const status = error.response?.status ?? 0
        const body = normalizeBody(error.response?.data)
        if (status === 401 && unauthorizedRedirect && typeof window !== 'undefined') {
          window.location.assign(unauthorizedRedirect)
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

  static resolveUrl(path: string): string {
    if (/^https?:\/\//.test(path)) {
      return path
    }
    const base = HttpClient.baseUrl.replace(/\/$/, '')
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `${base}${suffix}`
  }
}
