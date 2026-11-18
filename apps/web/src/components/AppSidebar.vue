<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Grid, Cpu, DataLine, Setting, Monitor } from '@element-plus/icons-vue'

const route = useRoute()
</script>

<template>
  <aside class="w-[260px] shrink-0 flex flex-col">
    <div class="h-14 flex items-center gap-2.5 px-4">
      <div
        class="size-8 shrink-0 rounded-lg bg-[var(--cd-color-accent-soft)] flex items-center justify-center"
      >
        <el-icon :size="17" color="var(--cd-color-accent-2)"><Monitor /></el-icon>
      </div>
      <div class="leading-tight min-w-0">
        <div class="text-body font-semibold truncate">ATeam</div>
        <div class="text-caption text-fg-subtle truncate">{{ $t('sidebar.tagline') }}</div>
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

    <div class="p-3">
      <div class="rounded-lg border border-border-subtle bg-surface-raised/60 px-3 py-2.5">
        <div class="flex items-center gap-2 text-caption text-fg-muted">
          <span class="size-1.5 rounded-full bg-success" />
          {{ $t('sidebar.localFirst') }}
        </div>
        <div class="mt-0.5 text-caption text-fg-subtle">v0.1.0</div>
      </div>
    </div>
  </aside>
</template>
