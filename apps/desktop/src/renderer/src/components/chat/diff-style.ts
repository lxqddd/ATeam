import type { FileChangeStatus } from '@ateam/shared'

export const STATUS_CLASS: Record<FileChangeStatus, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger'
}

export const STATUS_KEY: Record<FileChangeStatus, string> = {
  added: 'chat.changesAdded',
  modified: 'chat.changesModified',
  deleted: 'chat.changesDeleted'
}

export function lineClass(line: string): string {
  if (line.startsWith('+')) return 'bg-success/10 text-success'
  if (line.startsWith('-')) return 'bg-danger/10 text-danger'
  if (line.startsWith('@@')) return 'text-accent-strong'
  return 'text-muted'
}
