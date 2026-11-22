import { z } from 'zod'
import { WEB_SEARCH_PROVIDERS } from '@ateam/shared'

export const webSearchUpdateSchema = z.object({
  provider: z.enum(WEB_SEARCH_PROVIDERS),
  apiKey: z.string().max(500).optional()
})
