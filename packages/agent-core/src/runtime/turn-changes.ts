import fs from 'node:fs/promises'
import path from 'node:path'
import type { ChatMessage, TurnChanges } from '@ateam/shared'
import { attachmentDirectory, isPathInsideDirectory } from '../attachments'
import type { SessionRecord, SessionsStore } from '../sessions/sessions-store'
import type { SnapshotStore } from '../sessions/snapshots'

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
  message: ChatMessage
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
  return {
    sessionId: record.session.id,
    messageId: message.id,
    latest,
    canRevert: latest && !host.sessionBusy(record.session.id) && message.status !== 'streaming',
    truncated: result.truncated,
    files: result.files
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
