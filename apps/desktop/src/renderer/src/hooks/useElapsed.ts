import { useEffect, useState } from 'react'

export function useElapsed(startedAt: string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || !startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [active, startedAt])

  if (!active || !startedAt) return 0
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000))
}
