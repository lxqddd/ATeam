import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView from './ChatView'
import type { ChatStoreState } from '../../chat/store'
import { makeMessage, makeSession, makeTextPart } from '../../test/factories'

const storeState = vi.hoisted(() => ({ current: {} as unknown }))

vi.mock('../../chat/store', () => ({
  chatStore: {
    dismissSubagentResult: vi.fn(),
    loadMessages: vi.fn(),
    closeChanges: vi.fn(),
    setChangesTab: vi.fn()
  },
  useChatStore: () => storeState.current
}))
vi.mock('./MessageList', () => ({ default: () => <div>message-list</div> }))
vi.mock('./Composer', () => ({ default: () => <div>composer</div> }))
vi.mock('./TodoPanel', () => ({ default: () => <div>todos</div> }))
vi.mock('./BackgroundNotices', () => ({ default: () => null }))
vi.mock('./SubagentNotices', () => ({ default: () => null }))
vi.mock('./QuestionCard', () => ({ default: () => null }))
vi.mock('./ChangesPanel', () => ({
  default: ({
    sessionId,
    messageId,
    tab
  }: {
    sessionId: string
    messageId: string | null
    tab: string
  }) => <div>{`changes-panel ${sessionId}:${messageId ?? 'summary'}:${tab}`}</div>
}))

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
    queuesBySession: {},
    permissions: [],
    questions: [],
    runOutcomes: {},
    backgroundTasksBySession: {},
    subagentResults: [],
    actionError: null,
    restarting: false,
    revertPrompt: null,
    changesPanel: null,
    configRevision: 0
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

  it('renders the changes panel for the stored target', async () => {
    storeState.current = {
      ...state(),
      changesPanel: { sessionId: 's1', messageId: 'm1', tab: 'session' }
    }

    render(<ChatView />)

    expect(await screen.findByText('changes-panel s1:m1:session')).toBeInTheDocument()
  })

  it('renders the workspace Git tab for the stored target', async () => {
    storeState.current = {
      ...state(),
      changesPanel: { sessionId: 's1', messageId: null, tab: 'git' }
    }

    render(<ChatView />)

    expect(await screen.findByText('changes-panel s1:summary:git')).toBeInTheDocument()
  })
})
