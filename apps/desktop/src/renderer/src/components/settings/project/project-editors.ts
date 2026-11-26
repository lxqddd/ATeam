import { diffJsonEdits, type ProjectConfigEdit } from '@ateam/shared'

export type JsonRecord = Record<string, unknown>

/** Narrows an unknown JSON value to a plain object. */
export function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as JsonRecord
}

/** Returns the object entries whose values are plain objects, skipping malformed entries. */
export function recordEntries(value: unknown): Array<[string, JsonRecord]> {
  const record = asRecord(value)
  if (!record) return []
  const entries: Array<[string, JsonRecord]> = []
  for (const [key, entry] of Object.entries(record)) {
    const parsed = asRecord(entry)
    if (parsed) entries.push([key, parsed])
  }
  return entries
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function arrayToLines(value: unknown): string {
  return stringArray(value).join('\n')
}

/**
 * Edits that set one top-level field, or delete it when `value` is `undefined`.
 * Objects are diffed by key so unrelated keys (and their comments) survive.
 */
export function fieldEdits(
  raw: JsonRecord | null,
  key: string,
  value: unknown
): ProjectConfigEdit[] {
  const base = raw !== null && key in raw ? { [key]: raw[key] } : {}
  const next = value === undefined ? {} : { [key]: value }
  return diffJsonEdits(base, next)
}

/** Writes a trimmed non-empty string, otherwise removes the key. */
export function setString(target: JsonRecord, key: string, value: string): void {
  const trimmed = value.trim()
  if (trimmed) target[key] = trimmed
  else delete target[key]
}

/** Writes a finite number parsed from text, otherwise removes the key. */
export function setNumber(target: JsonRecord, key: string, value: string): void {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  if (trimmed && Number.isFinite(parsed)) target[key] = parsed
  else delete target[key]
}

/** Writes `true` when enabled and removes the key otherwise (config defaults are false). */
export function setBoolean(target: JsonRecord, key: string, value: boolean): void {
  if (value) target[key] = true
  else delete target[key]
}

/** Writes a non-empty string array, otherwise removes the key. */
export function setArray(target: JsonRecord, key: string, values: string[]): void {
  if (values.length > 0) target[key] = values
  else delete target[key]
}

/** Writes a non-empty string map, otherwise removes the key. */
export function setRecord(target: JsonRecord, key: string, value: Record<string, string>): void {
  if (Object.keys(value).length > 0) target[key] = value
  else delete target[key]
}
