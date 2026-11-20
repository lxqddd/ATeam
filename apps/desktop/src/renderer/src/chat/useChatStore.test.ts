import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { chatStore, useChatStore } from './store'
import { createApiMock } from '../test/api-mock'
import { makeSession } from '../test/factories'

describe('useChatStore', () => {
  it('reads the singleton store state', async () => {
    const mock = createApiMock()
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })

    await chatStore.init()
    const { result, unmount } = renderHook(() => useChatStore())

    expect(result.current.selectedSessionId).toBe('s1')

    unmount()
    chatStore.dispose()
  })
})
