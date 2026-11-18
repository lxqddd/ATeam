<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import AppSidebar from './components/AppSidebar.vue'
import { useEventStream } from './composables/useEventStream'

useEventStream()

const { locale } = useI18n()
const elLocale = computed(() => (locale.value === 'zh-CN' ? zhCn : en))
</script>

<template>
  <el-config-provider :locale="elLocale">
    <div class="h-screen w-screen flex bg-bg text-foreground overflow-hidden">
      <AppSidebar />
      <main class="flex-1 min-w-0 flex flex-col">
        <router-view />
      </main>
    </div>
  </el-config-provider>
</template>
