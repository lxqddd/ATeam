import { createClient } from '@ateam/api-client'

export const api = createClient(import.meta.env.VITE_API_BASE ?? '/api')
