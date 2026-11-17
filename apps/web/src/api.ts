import { configureApi } from '@ateam/api-client'

configureApi(import.meta.env.VITE_API_BASE ?? '/api')
