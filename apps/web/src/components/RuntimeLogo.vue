<script setup lang="ts">
import { computed } from 'vue'
import { siClaude, siCursor, siGooglegemini, siOpencode, siQwen } from 'simple-icons'
import { BotIcon, FlaskConicalIcon, HexagonIcon, WrenchIcon } from '@lucide/vue'

const props = defineProps<{ name: string }>()

// Official marks come from the simple-icons package (CC0 SVG path data)
// instead of vendoring brand assets into the repository (PRD PROD-014).
const officialIcons: Record<string, { title: string; hex: string; path: string }> = {
  claude: siClaude,
  opencode: siOpencode,
  'cursor-agent': siCursor,
  gemini: siGooglegemini,
  qwen: siQwen,
}

const fallbackIcons: Record<string, unknown> = {
  mock: FlaskConicalIcon,
  codex: HexagonIcon,
  aider: WrenchIcon,
}

const officialIcon = computed(() => officialIcons[props.name])
const fallbackIcon = computed(() => fallbackIcons[props.name] ?? BotIcon)

// Black marks (OpenCode, Cursor) would disappear on the dark theme tile, so
// they follow the theme text color instead of the literal brand hex.
const logoStyle = computed(() => {
  const icon = officialIcon.value
  if (!icon) {
    return undefined
  }
  const value = Number.parseInt(icon.hex, 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance < 0.25 ? undefined : { color: `#${icon.hex}` }
})
</script>

<template>
  <span class="runtime-logo" :style="logoStyle">
    <svg
      v-if="officialIcon"
      viewBox="0 0 24 24"
      role="img"
      :aria-label="officialIcon.title"
    >
      <path :d="officialIcon.path" fill="currentColor" />
    </svg>
    <component :is="fallbackIcon" v-else class="size-4" aria-hidden="true" />
  </span>
</template>

<style scoped>
.runtime-logo {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  color: var(--cd-color-text);
  background: color-mix(in srgb, currentColor 8%, var(--cd-color-surface-raised));
  border: 1px solid var(--cd-color-border-subtle);
  border-radius: var(--cd-radius-md);
}

.runtime-logo svg {
  width: 1.15rem;
  height: 1.15rem;
}
</style>
