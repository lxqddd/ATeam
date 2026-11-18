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
    <div class="h-screen w-screen flex bg-panel text-foreground overflow-hidden">
      <AppSidebar />
      <!-- 工作区：surface 卡片浮在 bg-subtle 底上（对齐 nomi 的 workspace-card 几何：
           上/右/下 8/2/2px 留边，左上与右下 20px 圆角，工作区双向阴影） -->
      <main
        class="flex-1 min-w-0 flex flex-col mt-2 mr-0.5 mb-0.5 rounded-tl-[20px] rounded-br-[20px] bg-surface shadow-[var(--cd-shadow-workspace)] overflow-hidden"
      >
        <router-view />
      </main>
    </div>
  </el-config-provider>
</template>
