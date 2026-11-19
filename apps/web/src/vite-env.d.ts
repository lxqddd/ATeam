/// <reference types="vite/client" />

interface Window {
  ateam?: {
    platform: string
    version: string
    kernel?: {
      status(): Promise<import('@ateam/shared').KernelState>
      sessions(): Promise<import('@ateam/shared').KernelSession[]>
      createSession(title: string): Promise<import('@ateam/shared').KernelSession>
      prompt(sessionId: string, text: string): Promise<void>
      messages(sessionId: string): Promise<import('@ateam/shared').KernelMessage[]>
      interrupt(sessionId: string): Promise<void>
      restart(): Promise<import('@ateam/shared').KernelState>
      models(): Promise<import('@ateam/shared').KernelModel[]>
      switchModel(sessionId: string, model: { id: string; providerID: string }): Promise<void>
      onEvent(callback: (event: import('@ateam/shared').KernelEvent) => void): () => void
    }
    provider?: {
      get(): Promise<import('@ateam/shared').ProviderConfig | null>
      set(input: {
        kind: import('@ateam/shared').ProviderKind
        model: string
        apiKey?: string
      }): Promise<import('@ateam/shared').ProviderConfig>
      test(): Promise<import('@ateam/shared').ProviderTestResult>
    }
    projects?: {
      list(): Promise<import('@ateam/shared').ProjectList>
      choose(): Promise<import('@ateam/shared').Project | null>
      select(id: string): Promise<import('@ateam/shared').ProjectList>
      remove(id: string): Promise<import('@ateam/shared').ProjectList>
      rename(id: string, name: string): Promise<import('@ateam/shared').ProjectList>
    }
  }
}
