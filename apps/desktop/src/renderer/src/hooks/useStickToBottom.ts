import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD = 48

export interface StickToBottom {
  ref: React.RefObject<HTMLDivElement | null>
  atBottom: boolean
  onScroll: () => void
  scrollToBottom: () => void
}

export function useStickToBottom(dependency: unknown): StickToBottom {
  const ref = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToBottom = useCallback((): void => {
    const element = ref.current
    if (!element) return
    stick.current = true
    setAtBottom(true)
    element.scrollTop = element.scrollHeight
  }, [])

  const onScroll = useCallback((): void => {
    const element = ref.current
    if (!element) return
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD
    stick.current = nearBottom
    setAtBottom(nearBottom)
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !stick.current) return
    element.scrollTop = element.scrollHeight
  }, [dependency])

  return { ref, atBottom, onScroll, scrollToBottom }
}
