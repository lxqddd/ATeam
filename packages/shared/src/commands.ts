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
  let expanded = template.replace(/\$ARGUMENTS/g, () => trimmed)
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
  let started = false
  let quote: '"' | "'" | null = null
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quote) {
      if (character === quote) {
        quote = null
        started = true
        continue
      }
      if (character === '\\' && quote === '"' && index + 1 < input.length) {
        const next = input[index + 1]
        if (next === '"' || next === '\\') {
          current += next
          started = true
          index += 1
          continue
        }
      }
      current += character
      started = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === '\\' && index + 1 < input.length) {
      const next = input[index + 1]
      if (/\s/.test(next) || next === '\\' || next === '"' || next === "'") {
        current += next
        started = true
        index += 1
        continue
      }
      current += '\\'
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }
  if (started) args.push(current)
  return args
}

export const COMMAND_SNIPPET_PATTERN = /!`([^`\n]+)`/g

export function commandShellSnippets(template: string): string[] {
  return [...template.matchAll(COMMAND_SNIPPET_PATTERN)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}
