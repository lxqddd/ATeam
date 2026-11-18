<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import AppSidebar from './components/AppSidebar.vue'
import AppTitleBar from './components/AppTitleBar.vue'
import { useEventStream } from './composables/useEventStream'
import { useUiStore } from './stores/ui'

useEventStream()

const { locale } = useI18n()
const ui = useUiStore()
const elLocale = computed(() => (locale.value === 'zh-CN' ? zhCn : en))
</script>

<template>
  <el-config-provider :locale="elLocale">
    <div class="app-shell">
      <AppTitleBar />
      <div class="app-body">
        <AppSidebar />
        <main class="workspace-card" :class="{ 'workspace-card--joined': !ui.sidebarCollapsed }">
          <router-view />
        </main>
      </div>
    </div>
  </el-config-provider>
</template>
