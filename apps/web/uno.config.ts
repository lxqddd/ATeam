import { defineConfig, presetAttributify, presetIcons, presetUno } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.1,
      warn: true,
    }),
  ],
  theme: {
    colors: {
      bg: '#09090b',
      panel: '#111113',
      panel2: '#17171a',
      border: '#27272a',
      muted: '#a1a1aa',
      accent: '#818cf8',
      accent2: '#6366f1',
    },
  },
  shortcuts: {
    btn: 'inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-500 transition-colors cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-accent2 text-white hover:bg-accent',
    'btn-ghost': 'btn text-zinc-300 hover:bg-white/5 border border-transparent hover:border-border',
    card: 'bg-panel border border-border rounded-lg',
    input:
      'w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent transition-colors',
    label: 'block text-[11px] font-500 text-zinc-400 mb-1.5 uppercase tracking-wide',
  },
})
