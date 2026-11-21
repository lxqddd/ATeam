/**
 * Expand a custom command template.
 *
 * - `$ARGUMENTS` is replaced with the full argument string.
 * - `$1` … `$9` are replaced with positional arguments.
 * - Without any placeholder the arguments are appended as a new paragraph.
 */
export function expandCommand(template: string, args: string): string {
  const trimmed = args.trim()
  const tokens = trimmed ? trimmed.split(/\s+/) : []
  let expanded = template.replace(/\$ARGUMENTS/g, trimmed)
  expanded = expanded.replace(/\$([1-9])/g, (_match, index: string) => {
    return tokens[Number(index) - 1] ?? ''
  })
  if (trimmed && !template.includes('$ARGUMENTS') && !/\$[1-9]/.test(template)) {
    expanded = `${expanded}\n\n${trimmed}`
  }
  return expanded
}
