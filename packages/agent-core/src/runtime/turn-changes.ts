import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ChatMessage,
  SessionChangeFile,
  SessionChangesSummary,
  SessionChangeTurn,
  TurnChanges
} from '@ateam/shared'
import { attachmentDirectory, isPathInsideDirectory } from '../attachments'
import type { RevertState, SessionRecord, SessionsStore } from '../sessions/sessions-store'
import type { SnapshotStore } from '../sessions/snapshots'

const MAX_SUMMARY_TURNS = 50

export interface TurnChangesHost {
  readonly snapshots: SnapshotStore
  sessionBusy(sessionId: string): boolean
}

export interface ForkAttachmentsHost {
  readonly userDataPath: string
  readonly store: Pick<SessionsStore, 'getMessages' | 'rewriteAttachmentPaths'>
}

export function latestSnapshotMessage(messages: ChatMessage[]): ChatMessage | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  return lastAssistant?.snapshotBefore ? lastAssistant : undefined
}

export async function buildTurnChanges(
  host: TurnChangesHost,
  record: SessionRecord,
  message: ChatMessage,
  revert?: RevertState
): Promise<TurnChanges> {
  if (!message.snapshotBefore) throw new Error('NO_SNAPSHOT')
  const latest = latestSnapshotMessage(record.messages)?.id === message.id
  const afterId = message.snapshotAfter ?? message.snapshotSteps?.at(-1)?.after ?? null
  const fallbackPaths = [
    ...(message.changedFiles ?? []),
    ...(message.snapshotSteps ?? []).flatMap((step) => step.files)
  ]
  const result = await host.snapshots.changes(message.snapshotBefore, afterId, {
    current: latest,
    paths: afterId ? undefined : fallbackPaths
  })
  const revertedPaths =
    revert && revert.messageId === message.id ? [...new Set(revert.files)].sort() : []
  const idle = !host.sessionBusy(record.session.id) && message.status !== 'streaming'
  return {
    sessionId: record.session.id,
    messageId: message.id,
    latest,
    canRevert: latest && idle,
    canUnrevert: latest && idle && revertedPaths.length > 0,
    revertedPaths,
    truncated: result.truncated,
    files: result.files
  }
}

/**
 * Summarises the net file changes of each assistant turn that recorded
 * snapshots. Turns are newest first; hunk contents are omitted so the summary
 * stays small enough to load eagerly. Older turns and files beyond the diff
 * limits are reported through `truncated`.
 */
export async function buildSessionChanges(
  host: TurnChangesHost,
  record: SessionRecord
): Promise<SessionChangesSummary> {
  const candidates = record.messages.filter(
    (message) =>
      message.role === 'assistant' &&
      Boolean(message.snapshotBefore) &&
      Boolean(message.snapshotAfter ?? message.snapshotSteps?.length)
  )
  const selected = candidates.slice(-MAX_SUMMARY_TURNS).reverse()
  const turns: SessionChangeTurn[] = []
  const uniqueFiles = new Set<string>()
  let additions = 0
  let deletions = 0
  let truncated = candidates.length > selected.length

  for (const message of selected) {
    const afterId = message.snapshotAfter ?? message.snapshotSteps?.at(-1)?.after ?? null
    const fallbackPaths = [
      ...(message.changedFiles ?? []),
      ...(message.snapshotSteps ?? []).flatMap((step) => step.files)
    ]
    let result: Awaited<ReturnType<SnapshotStore['changes']>>
    try {
      result = await host.snapshots.changes(message.snapshotBefore as string, afterId, {
        paths: afterId ? undefined : fallbackPaths
      })
    } catch {
      truncated = true
      continue
    }
    if (result.truncated) truncated = true
    const files: SessionChangeFile[] = result.files.map((file) => ({
      path: file.path,
      snapshotPath: file.snapshotPath,
      status: file.status,
      binary: file.binary,
      truncated: file.truncated,
      additions: file.additions,
      deletions: file.deletions,
      error: file.error ?? null
    }))
    if (files.length === 0) continue
    const turnAdditions = files.reduce((total, file) => total + file.additions, 0)
    const turnDeletions = files.reduce((total, file) => total + file.deletions, 0)
    turns.push({
      messageId: message.id,
      createdAt: message.createdAt,
      status: message.status,
      files,
      additions: turnAdditions,
      deletions: turnDeletions
    })
    for (const file of files) uniqueFiles.add(file.snapshotPath)
    additions += turnAdditions
    deletions += turnDeletions
  }

  return {
    sessionId: record.session.id,
    turns,
    fileCount: uniqueFiles.size,
    additions,
    deletions,
    truncated
  }
}

export async function allowedChangePaths(
  host: TurnChangesHost,
  message: ChatMessage
): Promise<Set<string>> {
  const afterId = message.snapshotAfter ?? message.snapshotSteps?.at(-1)?.after ?? null
  const paths = new Set<string>([
    ...(message.changedFiles ?? []),
    ...(message.snapshotSteps ?? []).flatMap((step) => step.files)
  ])
  if (message.snapshotBefore && afterId) {
    const diff = await host.snapshots.diff(message.snapshotBefore, afterId)
    for (const path of diff.added) paths.add(path)
    for (const path of diff.modified) paths.add(path)
    for (const path of diff.deleted) paths.add(path)
  }
  return paths
}

export async function copyForkAttachments(
  host: ForkAttachmentsHost,
  sourceId: string,
  targetId: string
): Promise<void> {
  const sourceDirectory = attachmentDirectory(host.userDataPath, sourceId)
  const targetDirectory = attachmentDirectory(host.userDataPath, targetId)
  const copied = new Map<string, string>()
  for (const message of host.store.getMessages(targetId) ?? []) {
    for (const part of message.parts) {
      if (part.type !== 'attachment') continue
      const source = part.attachment.path
      if (!(await isPathInsideDirectory(sourceDirectory, source))) continue
      const target = path.join(targetDirectory, path.basename(source))
      try {
        await fs.mkdir(targetDirectory, { recursive: true })
        await fs.copyFile(source, target)
        copied.set(source, target)
      } catch {
        /* missing attachment files keep their original path */
      }
    }
  }
  if (copied.size === 0) return
  await host.store.rewriteAttachmentPaths(targetId, (oldPath) => copied.get(oldPath) ?? oldPath)
}
