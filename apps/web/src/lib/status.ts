export type WorkTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

/**
 * Shared status → tone mapping. Mirrors `StatusBadge.vue` so badges and dots
 * rendered from raw status strings stay visually consistent across views.
 */
export function workTone(status: string): WorkTone {
  if (status === 'done' || status === 'completed') return 'success'
  if (status === 'in_progress' || status === 'running' || status === 'preparing') return 'brand'
  if (status === 'failed') return 'danger'
  if (status === 'blocked' || status === 'cancelled' || status === 'in_review') return 'warning'
  return 'neutral'
}

/** `bg-*` utility for a status dot matching `workTone`. */
export function statusDotClass(status: string): string {
  switch (workTone(status)) {
    case 'success':
      return 'bg-success'
    case 'brand':
      return 'bg-brand'
    case 'danger':
      return 'bg-danger'
    case 'warning':
      return 'bg-warning'
    default:
      return 'bg-fg-subtle/60'
  }
}
