import type { ChatMessage, MessagePart, PermissionRequest, SessionMeta } from '@ateam/shared'

let sequence = 0

function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

export type ToolPart = Extract<MessagePart, { type: 'tool' }>

export function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  const timestamp = new Date().toISOString()
  return {
    id: nextId('session'),
    title: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    model: null,
    status: 'idle',
    reasoningEffort: null,
    permissionMode: 'ask',
    compaction: null,
    redoAvailable: false,
    contextTokens: null,
    contextWindow: null,
    ...overrides
  }
}

export function makeTextPart(text: string): MessagePart {
  return { type: 'text', text }
}

export function makeReasoningPart(text: string): MessagePart {
  return { type: 'reasoning', text }
}

export function makeToolPart(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: 'tool',
    toolCallId: nextId('call'),
    toolName: 'read',
    input: {},
    state: 'completed',
    ...overrides
  }
}

export function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const timestamp = new Date().toISOString()
  return {
    id: nextId('message'),
    sessionId: 'session-1',
    role: 'assistant',
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'complete',
    ...overrides
  }
}

export function makePermission(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: nextId('permission'),
    sessionId: 'session-1',
    messageId: 'message-1',
    toolCallId: 'call-1',
    action: 'write',
    resource: 'a.txt',
    toolName: 'write',
    createdAt: new Date().toISOString(),
    ...overrides
  }
}
