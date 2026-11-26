/** Splits a textarea value into non-empty trimmed lines. */
export function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Parses `KEY: VALUE` or `KEY=VALUE` lines into a record, skipping malformed lines. */
export function parseKeyValue(text: string, separator: ':' | '='): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf(separator)
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/** Formats a string record as `KEY: VALUE` or `KEY=VALUE` lines. */
export function formatKeyValue(record: Record<string, string>, separator: ':' | '='): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}${separator === ':' ? ': ' : '='}${value}`)
    .join('\n')
}
