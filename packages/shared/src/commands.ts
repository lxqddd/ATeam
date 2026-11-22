/**
 * Expand a custom command template.
 *
 * - `$ARGUMENTS` is replaced with the full argument string.
 * - `$1` … `$9` are replaced with positional arguments.
 * - Without any placeholder the arguments are appended as a new paragraph.
 */
export function expandCommand(template: string, args: string): string {
  const trimmed = args.trim()
  const tokens = splitArguments(trimmed)
  let expanded = template.replace(/\$ARGUMENTS/g, trimmed)
  expanded = expanded.replace(/\$([1-9])/g, (_match, index: string) => {
    return tokens[Number(index) - 1] ?? ''
  })
  if (trimmed && !template.includes('$ARGUMENTS') && !/\$[1-9]/.test(template)) {
    expanded = `${expanded}\n\n${trimmed}`
  }
  return expanded
}

/** Split a command argument string with single/double quotes and backslash escapes. */
export function splitArguments(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const character of input) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (escaped) current += '\\'
  if (current) args.push(current)
  return args
}

export const COMMAND_SNIPPET_PATTERN = /!`([^`\n]+)`/g

export function commandShellSnippets(template: string): string[] {
  return [...template.matchAll(COMMAND_SNIPPET_PATTERN)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}
