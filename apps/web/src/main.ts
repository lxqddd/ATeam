import 'virtual:uno.css'
import './styles/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { configureApi } from '@ateam/api-client'

import App from './App.vue'
import { router } from './router'

configureApi(import.meta.env.VITE_API_BASE ?? '/api')

createApp(App).use(createPinia()).use(router).mount('#app')
