import { useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { MessageAttachment } from '@ateam/shared'
import { chatStore } from '../../../chat/store'
import { errorMessage } from '../../../lib/errors'

interface UseComposerAttachmentsOptions {
  sessionId: string | null
  disabled: boolean
  onError: (message: string | null) => void
}

export interface ComposerAttachmentsState {
  attachments: MessageAttachment[]
  setAttachments: Dispatch<SetStateAction<MessageAttachment[]>>
  attaching: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  addFiles: (files: File[]) => Promise<void>
  removeAttachment: (attachment: MessageAttachment) => Promise<void>
}

export function useComposerAttachments({
  sessionId,
  disabled,
  onError
}: UseComposerAttachmentsOptions): ComposerAttachmentsState {
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function addFiles(files: File[]): Promise<void> {
    if (files.length === 0 || disabled) return
    setAttaching(true)
    onError(null)
    try {
      const target = await chatStore.ensureSession()
      const added: MessageAttachment[] = []
      for (const file of files) {
        const data = new Uint8Array(await file.arrayBuffer())
        added.push(
          await window.api.agent.attachments.import(target.id, {
            name: file.name,
            mimeType: file.type,
            data
          })
        )
      }
      setAttachments((current) => [...current, ...added])
    } catch (caught) {
      onError(errorMessage(caught))
    } finally {
      setAttaching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function removeAttachment(attachment: MessageAttachment): Promise<void> {
    setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))
    if (!sessionId) return
    await window.api.agent.attachments.remove(sessionId, attachment.id).catch(() => undefined)
  }

  return { attachments, setAttachments, attaching, fileInputRef, addFiles, removeAttachment }
}
