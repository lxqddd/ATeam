import './styles/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
// 必须晚于 Element Plus 的变量，才能覆盖其主题映射
import './styles/element-theme.css'

import i18n from './i18n'
import App from './App.vue'
import { router } from './router'
import { initTheme, useThemeStore } from './stores/theme'

initTheme()

const pinia = createPinia()
const app = createApp(App)
app.use(pinia).use(router).use(i18n).use(ElementPlus)

// Instantiate the theme store so its prefers-color-scheme listener is active
useThemeStore(pinia)

app.mount('#app')
