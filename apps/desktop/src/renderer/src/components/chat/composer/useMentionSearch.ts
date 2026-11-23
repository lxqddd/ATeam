import { useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { SessionMeta } from '@ateam/shared'

export interface MentionState {
  query: string
  start: number
  items: string[]
}

interface UseMentionSearchOptions {
  session: SessionMeta | undefined
  text: string
  setText: Dispatch<SetStateAction<string>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export interface MentionSearchState {
  mention: MentionState | null
  setMention: Dispatch<SetStateAction<MentionState | null>>
  activeMention: number
  setActiveMention: Dispatch<SetStateAction<number>>
  detectMention: (value: string, cursor: number) => void
  applyMention: (filePath: string) => void
}

export function useMentionSearch({
  session,
  text,
  setText,
  textareaRef
}: UseMentionSearchOptions): MentionSearchState {
  const [mention, setMention] = useState<MentionState | null>(null)
  const [activeMention, setActiveMention] = useState(0)
  const mentionSeq = useRef(0)

  function detectMention(value: string, cursor: number): void {
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, cursor))
    const sequence = ++mentionSeq.current
    setMention(null)
    setActiveMention(0)
    if (!match) return
    const query = match[2]
    const start = cursor - query.length - 1
    window.api.agent.files
      .search(query, session?.directory ?? undefined)
      .then((items) => {
        if (sequence !== mentionSeq.current) return
        setMention(items.length > 0 ? { query, start, items } : null)
      })
      .catch(() => {
        if (sequence === mentionSeq.current) setMention(null)
      })
  }

  function applyMention(filePath: string): void {
    if (!mention) return
    const after = text.slice(mention.start + mention.query.length + 1)
    const spacer = filePath.endsWith('/') ? '' : ' '
    const next = `${text.slice(0, mention.start)}@${filePath}${spacer}${after.replace(/^\s*/, '')}`
    setText(next)
    setMention(null)
    textareaRef.current?.focus()
  }

  return {
    mention,
    setMention,
    activeMention,
    setActiveMention,
    detectMention,
    applyMention
  }
}
