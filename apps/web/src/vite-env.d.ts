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
      onEvent(callback: (event: import('@ateam/shared').KernelEvent) => void): () => void
    }
  }
}
