import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useElapsed } from './useElapsed'

describe('useElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at zero', () => {
    const { result } = renderHook(() => useElapsed('2026-01-01T00:00:00.000Z', true))
    expect(result.current).toBe(0)
  })

  it('counts elapsed seconds while active', () => {
    const { result } = renderHook(() => useElapsed('2026-01-01T00:00:00.000Z', true))

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    expect(result.current).toBe(3)
  })

  it('returns zero when inactive', () => {
    const { result } = renderHook(() => useElapsed('2026-01-01T00:00:00.000Z', false))

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    expect(result.current).toBe(0)
  })

  it('returns zero without a start time', () => {
    const { result } = renderHook(() => useElapsed(undefined, true))
    expect(result.current).toBe(0)
  })

  it('recomputes when the start time changes', () => {
    const { result, rerender } = renderHook(
      ({ startedAt }: { startedAt: string }) => useElapsed(startedAt, true),
      { initialProps: { startedAt: '2026-01-01T00:00:00.000Z' } }
    )

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(result.current).toBe(2)

    rerender({ startedAt: '2026-01-01T00:00:01.000Z' })
    expect(result.current).toBe(1)
  })

  it('stops its interval after unmount', () => {
    const { unmount } = renderHook(() => useElapsed('2026-01-01T00:00:00.000Z', true))

    unmount()

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5_000)
      })
    }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
