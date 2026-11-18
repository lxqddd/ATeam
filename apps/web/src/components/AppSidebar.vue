<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Grid, Cpu, DataLine, Setting, Monitor } from '@element-plus/icons-vue'

const route = useRoute()
</script>

<template>
  <aside class="w-60 shrink-0 border-r border-border bg-panel flex flex-col">
    <div class="h-14 flex items-center gap-2.5 px-4 border-b border-border">
      <el-icon :size="20" color="var(--cd-color-accent-2)"><Monitor /></el-icon>
      <div class="leading-tight">
        <div class="text-body font-semibold">ATeam</div>
        <div class="text-caption text-fg-subtle">{{ $t('sidebar.tagline') }}</div>
      </div>
    </div>

    <el-menu :default-active="route.path" router class="ateam-menu flex-1">
      <el-menu-item index="/">
        <el-icon><Grid /></el-icon>
        <span>{{ $t('sidebar.nav.board') }}</span>
      </el-menu-item>
      <el-menu-item index="/agents">
        <el-icon><Cpu /></el-icon>
        <span>{{ $t('sidebar.nav.agents') }}</span>
      </el-menu-item>
      <el-menu-item index="/runs">
        <el-icon><DataLine /></el-icon>
        <span>{{ $t('sidebar.nav.runs') }}</span>
      </el-menu-item>
      <el-menu-item index="/settings">
        <el-icon><Setting /></el-icon>
        <span>{{ $t('sidebar.nav.settings') }}</span>
      </el-menu-item>
    </el-menu>

    <div class="p-3 border-t border-border text-caption text-fg-subtle">
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full bg-success" />
        {{ $t('sidebar.localFirst') }}
      </div>
      <div class="mt-1">v0.1.0</div>
    </div>
  </aside>
</template>
