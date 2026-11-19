import type { GatewayProvider, GatewayProviderInput, GatewayStatus } from '@ateam/shared'
import { HttpClient } from '../http/client'

export class GatewayApi {
  static status(): Promise<GatewayStatus> {
    return HttpClient.get<GatewayStatus>('/gateway/status')
  }

  static async list(): Promise<GatewayProvider[]> {
    const response = await HttpClient.get<{ providers: GatewayProvider[] }>('/gateway/providers')
    return response.providers
  }

  static create(input: GatewayProviderInput): Promise<GatewayProvider> {
    return HttpClient.post<GatewayProvider>('/gateway/providers', input)
  }

  static update(id: string, input: GatewayProviderInput): Promise<GatewayProvider> {
    return HttpClient.put<GatewayProvider>(`/gateway/providers/${encodeURIComponent(id)}`, input)
  }

  static remove(id: string): Promise<void> {
    return HttpClient.delete<void>(`/gateway/providers/${encodeURIComponent(id)}`)
  }

  static rotateToken(): Promise<{ token: string }> {
    return HttpClient.post<{ token: string }>('/gateway/token/rotate')
  }
}
