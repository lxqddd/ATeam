import './styles/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
// 必须晚于 Element Plus 的深色变量，才能覆盖其主题映射
import './styles/element-theme.css'

import i18n from './i18n'
import App from './App.vue'
import { router } from './router'

createApp(App).use(createPinia()).use(router).use(i18n).use(ElementPlus).mount('#app')
