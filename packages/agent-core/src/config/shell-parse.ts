export interface ParsedShellCommand {
  /** Raw simple-command segments, split on shell control operators. */
  segments: string[]
  /** Unquoted tokens for each segment. */
  tokens: string[][]
  /** True when the command contains substitutions or variable-expanded paths. */
  dynamic: boolean
}

const SEPARATORS = new Set([';', '\n', '|', '&'])

function isSeparatorPair(command: string, index: number): boolean {
  const character = command[index]
  const next = command[index + 1]
  return (character === '&' || character === '|') && next === character
}

function isEscape(character: string, quote: string | null): boolean {
  return (character === '\\' && quote !== "'") || (character === '^' && quote === null)
}

/** Split a command into simple commands while respecting quotes and escapes. */
export function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (isEscape(character, quote)) {
      current += character
      escaped = true
      continue
    }
    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      current += character
      continue
    }
    if (SEPARATORS.has(character)) {
      const next = command[index + 1]
      const previous = command[index - 1]
      // Keep redirection operators such as 2>&1 and &>file in the segment.
      if (character === '&' && (previous === '>' || previous === '<' || next === '>')) {
        current += character
        continue
      }
      if (character === '|' && next === '&') {
        const segment = current.trim()
        if (segment) segments.push(segment)
        current = ''
        index += 1
        continue
      }
      const segment = current.trim()
      if (segment) segments.push(segment)
      current = ''
      if (isSeparatorPair(command, index)) index += 1
      continue
    }
    current += character
  }

  const segment = current.trim()
  if (segment) segments.push(segment)
  return segments
}

/** Tokenize one simple command, removing quotes and resolving escapes. */
export function tokenizeShellSegment(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false

  const flush = (): void => {
    if (!current) return
    tokens.push(current)
    current = ''
  }

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (isEscape(character, quote)) {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      flush()
      continue
    }
    current += character
  }

  flush()
  return tokens
}

/** Detect command substitution or variable-expanded paths. */
function hasDynamicContent(segment: string): boolean {
  return (
    /\$\(/.test(segment) ||
    /`/.test(segment) ||
    /\$\{?[A-Za-z_][A-Za-z0-9_]*/.test(segment) ||
    /\$env:[A-Za-z_]/i.test(segment) ||
    /%[A-Za-z_][A-Za-z0-9_]*%/.test(segment)
  )
}

export function parseShellCommand(command: string): ParsedShellCommand {
  const segments = splitShellSegments(command)
  const tokens = segments.map(tokenizeShellSegment)
  return {
    segments,
    tokens,
    dynamic: segments.some(hasDynamicContent)
  }
}
