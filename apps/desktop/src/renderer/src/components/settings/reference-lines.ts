import type { AgentReference } from '@ateam/shared'

function looksLikeRepository(value: string): boolean {
  const base = value.split('#')[0]
  if (base.startsWith('git@') || base.includes('://')) return true
  return (
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(base) &&
    !base.startsWith('.') &&
    !base.startsWith('/')
  )
}

export function parseReferenceLines(text: string): AgentReference[] {
  const references: AgentReference[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const [definition, description] = line.split('|').map((part) => part.trim())
    const separator = definition.indexOf('=')
    if (separator <= 0) continue
    const alias = definition.slice(0, separator).trim()
    const value = definition.slice(separator + 1).trim()
    if (!alias || !value) continue
    const reference: AgentReference = { alias }
    if (looksLikeRepository(value)) {
      const hash = value.indexOf('#')
      reference.repository = hash === -1 ? value : value.slice(0, hash)
      if (hash !== -1) reference.branch = value.slice(hash + 1) || null
    } else {
      reference.path = value
    }
    if (description) reference.description = description
    references.push(reference)
  }
  return references
}

export function formatReferenceLines(references: AgentReference[]): string {
  return references
    .map((reference) => {
      const value = reference.repository
        ? `${reference.repository}${reference.branch ? `#${reference.branch}` : ''}`
        : (reference.path ?? '')
      if (!value) return ''
      return `${reference.alias}=${value}${reference.description ? ` | ${reference.description}` : ''}`
    })
    .filter(Boolean)
    .join('\n')
}
