import type { ProjectConfigEdit } from './agent-types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((entry, index) => deepEqual(entry, right[index]))
    )
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key])
      )
    )
  }
  return false
}

/**
 * Compares two JSON values and returns the edits that turn `base` into `next`.
 * Objects are diffed key by key so unrelated entries (and their comments) stay
 * untouched; arrays and primitives are replaced whole.
 */
export function diffJsonEdits(
  base: unknown,
  next: unknown,
  path: (string | number)[] = []
): ProjectConfigEdit[] {
  if (isPlainObject(base) && isPlainObject(next)) {
    const edits: ProjectConfigEdit[] = []
    const keys = new Set([...Object.keys(base), ...Object.keys(next)])
    for (const key of keys) {
      const hasBase = Object.prototype.hasOwnProperty.call(base, key)
      const hasNext = Object.prototype.hasOwnProperty.call(next, key)
      const child = [...path, key]
      if (hasBase && !hasNext) {
        edits.push({ path: child })
      } else if (!hasBase && hasNext) {
        edits.push({ path: child, value: next[key] })
      } else {
        edits.push(...diffJsonEdits(base[key], next[key], child))
      }
    }
    return edits
  }
  if (deepEqual(base, next)) return []
  return [{ path, value: next }]
}

export { deepEqual as jsonValuesEqual }
