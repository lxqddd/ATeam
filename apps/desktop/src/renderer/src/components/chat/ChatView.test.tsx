import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView from './ChatView'
import type { ChatStoreState } from '../../chat/store'
import { makeMessage, makeSession, makeTextPart } from '../../test/factories'

const storeState = vi.hoisted(() => ({ current: {} as unknown }))

vi.mock('../../chat/store', () => ({
  chatStore: { dismissSubagentResult: vi.fn(), loadMessages: vi.fn() },
  useChatStore: () => storeState.current
}))
vi.mock('./MessageList', () => ({ default: () => <div>message-list</div> }))
vi.mock('./Composer', () => ({ default: () => <div>composer</div> }))
vi.mock('./TodoPanel', () => ({ default: () => <div>todos</div> }))
vi.mock('./BackgroundNotices', () => ({ default: () => null }))
vi.mock('./SubagentNotices', () => ({ default: () => null }))
vi.mock('./QuestionCard', () => ({ default: () => null }))

function state(): ChatStoreState {
  return {
    status: { status: 'ready' },
    info: null,
    models: null,
    agents: [],
    commands: [],
    sessions: [makeSession({ id: 's1', title: 'Chat' })],
    selectedSessionId: 's1',
    messagesBySession: {
      s1: [makeMessage({ id: 'm1', sessionId: 's1', role: 'user', parts: [makeTextPart('hi')] })]
    },
    loadedBySession: { s1: true },
    permissions: [],
    questions: [],
    runOutcomes: {},
    backgroundResults: [],
    subagentResults: [],
    actionError: null,
    restarting: false,
    revertPrompt: null
  }
}

beforeEach(() => {
  storeState.current = state()
})

describe('ChatView', () => {
  it('uses unique keys for session-scoped children', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<ChatView />)

    const duplicate = error.mock.calls.some((args) => String(args[0] ?? '').includes('same key'))
    expect(duplicate).toBe(false)
    error.mockRestore()
  })
})
