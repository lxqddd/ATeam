import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LanguageModel } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, RuntimeModelsConfig } from '@ateam/shared'

const aiMock = vi.hoisted(() => {
  let captured: Record<string, unknown> | null = null
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'text-start', id: 't1' }
      yield { type: 'text-delta', id: 't1', text: 'default' }
      yield { type: 'finish', finishReason: 'stop', totalUsage: { totalTokens: 1 } }
    }
  }
  const streamText = vi.fn((options: Record<string, unknown>) => {
    captured = options
    return { stream }
  })
  return {
    streamText,
    generateText: vi.fn(async () => ({ text: 'OK' })),
    stepCountIs: vi.fn(() => () => true),
    tool: vi.fn(),
    captured: () => captured
  }
})

vi.mock('ai', () => ({
  streamText: aiMock.streamText,
  generateText: aiMock.generateText,
  stepCountIs: aiMock.stepCountIs,
  tool: aiMock.tool
}))

import { AgentRuntime } from './index'

const MODELS: RuntimeModelsConfig = {
  providers: [{ id: 'provider-1', name: 'Test', type: 'anthropic', apiKey: 'sk-test' }],
  models: [
    {
      id: 'model-1',
      providerId: 'provider-1',
      modelId: 'model-1',
      name: 'Test Model',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  defaultModel: { providerId: 'provider-1', modelId: 'model-1' }
}

let directory: string
let envelopes: AgentEventEnvelope[]
let runtime: AgentRuntime
let sessionId: string

beforeEach(async () => {
  aiMock.streamText.mockClear()
  aiMock.generateText.mockClear()
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-runtime-')))
  envelopes = []
  runtime = new AgentRuntime({
    userDataPath: directory,
    workspacePath: path.join(directory, 'workspace'),
    models: MODELS,
    send: (envelope) => envelopes.push(envelope),
    dependencies: {
      createLanguageModel: () => ({}) as unknown as LanguageModel,
      createTools: () => ({})
    }
  })
  await runtime.init()
  sessionId = (await runtime.createSession()).id
})

afterEach(async () => {
  await runtime.shutdown()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('AgentRuntime default dependencies', () => {
  it('streams through the default streamText factory', async () => {
    await runtime.sendChat(sessionId, 'hi')

    await vi.waitFor(() =>
      expect(envelopes.some((entry) => entry.event.type === 'run.finished')).toBe(true)
    )
    const finished = envelopes.find((entry) => entry.event.type === 'run.finished')
    expect(finished?.event).toMatchObject({ status: 'completed' })

    const options = aiMock.captured()
    expect(options).toMatchObject({ maxRetries: 0, maxOutputTokens: 8_192 })
    expect(typeof options?.system).toBe('string')
    expect(aiMock.stepCountIs).toHaveBeenCalledWith(25)

    const onError = options?.onError
    expect(typeof onError).toBe('function')
    if (typeof onError === 'function') onError()
  })

  it('tests model connections with generateText', async () => {
    const ok = await runtime.testModel('provider-1', 'model-1')
    expect(ok).toMatchObject({ ok: true, message: 'Connection succeeded' })
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0)

    aiMock.generateText.mockRejectedValueOnce(new Error('401 Unauthorized'))
    await expect(runtime.testModel('provider-1', 'model-1')).resolves.toEqual({
      ok: false,
      message: 'Model authentication failed. Check the provider API key.'
    })
  })
})
