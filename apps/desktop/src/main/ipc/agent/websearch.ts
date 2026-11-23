import { AGENT_CHANNELS, type WebSearchProviderPublic } from '@ateam/shared'
import { webSearchUpdateSchema } from '../websearch-schema'
import type { AgentIpcContext } from './context'

/** Registers web search provider configuration channels. */
export function registerWebSearchHandlers(ctx: AgentIpcContext): void {
  const { manager, webSearchStore, handle } = ctx

  handle(AGENT_CHANNELS.webSearchGet, (): WebSearchProviderPublic => webSearchStore.get())

  handle(AGENT_CHANNELS.webSearchUpdate, async (payload): Promise<WebSearchProviderPublic> => {
    const input = webSearchUpdateSchema.parse(payload)
    const result = await webSearchStore.update(input)
    await manager.setWebSearch(webSearchStore.runtimeConfig())
    return result
  })
}
