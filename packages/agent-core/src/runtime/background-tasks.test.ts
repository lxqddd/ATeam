import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundTaskInfo } from '@ateam/shared'
import {
  BackgroundTaskRegistry,
  MAX_FINISHED_BACKGROUND_TASKS,
  backgroundTaskBody,
  backgroundTaskId,
  formatBackgroundResult,
  formatBackgroundTaskList,
  makeBackgroundResultMessage,
  truncateBackgroundResult,
  type BackgroundTaskStartInput
} from './background-tasks'

function startInput(overrides: Partial<BackgroundTaskStartInput> = {}): BackgroundTaskStartInput {
  return {
    id: 's1:call-1',
    kind: 'shell',
    sessionId: 's1',
    toolCallId: 'call-1',
    ownerMessageId: 'm1',
    title: 'sleep 1',
    ...overrides
  }
}

function shellTask(overrides: Partial<BackgroundTaskInfo> = {}): BackgroundTaskInfo {
  return {
    id: 's1:call-1',
    kind: 'shell',
    sessionId: 's1',
    toolCallId: 'call-1',
    title: 'printf hi',
    state: 'completed',
    startedAt: '2026-01-02T00:00:00.000Z',
    finishedAt: '2026-01-02T00:00:01.000Z',
    exitCode: 0,
    outputPath: '/tmp/bg.log',
    result: 'hi',
    ...overrides
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BackgroundTaskRegistry', () => {
  it('registers running tasks and lists them per session', () => {
    const registry = new BackgroundTaskRegistry()
    const task = registry.start(startInput())

    expect(task).toMatchObject({
      id: 's1:call-1',
      kind: 'shell',
      sessionId: 's1',
      toolCallId: 'call-1',
      title: 'sleep 1',
      state: 'running'
    })
    expect(task.startedAt).toBeTruthy()
    expect(registry.list('s1')).toEqual([task])
    expect(registry.list('other')).toEqual([])
    expect(registry.running('s1')).toHaveLength(1)
  })

  it('completes a task with its state, exit code and result', () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())

    const finished = registry.complete('s1:call-1', {
      state: 'failed',
      exitCode: 2,
      result: 'partial output',
      error: 'The command failed.'
    })

    expect(finished).toMatchObject({
      state: 'failed',
      exitCode: 2,
      result: 'partial output',
      error: 'The command failed.'
    })
    expect(finished?.finishedAt).toBeTruthy()
    expect(registry.get('s1:call-1')?.state).toBe('failed')
    expect(registry.running('s1')).toEqual([])
  })

  it('ignores completion for unknown or already finished tasks', () => {
    const registry = new BackgroundTaskRegistry()
    expect(registry.complete('missing', { state: 'completed' })).toBeNull()

    registry.start(startInput())
    expect(registry.complete('s1:call-1', { state: 'completed' })).not.toBeNull()
    expect(registry.complete('s1:call-1', { state: 'failed' })).toBeNull()
    expect(registry.get('s1:call-1')?.state).toBe('completed')
  })

  it('turns a cancelled task into cancelled even when the work reports failure', () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())
    registry.cancel('s1:call-1')

    expect(registry.complete('s1:call-1', { state: 'failed', exitCode: null })).toBeNull()
    expect(registry.get('s1:call-1')?.state).toBe('cancelled')
  })

  it('wait resolves when the task finishes and marks the result consumed', async () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())
    const pending = registry.wait('s1:call-1', 10_000)
    expect(registry.isConsumed('s1:call-1')).toBe(false)

    registry.complete('s1:call-1', { state: 'completed', exitCode: 0, result: 'done' })

    await expect(pending).resolves.toMatchObject({
      id: 's1:call-1',
      state: 'completed',
      result: 'done'
    })
    expect(registry.isConsumed('s1:call-1')).toBe(true)
  })

  it('wait returns finished tasks immediately without consuming them', async () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())
    registry.complete('s1:call-1', { state: 'completed' })

    await expect(registry.wait('s1:call-1', 10_000)).resolves.toMatchObject({
      state: 'completed'
    })
    expect(registry.isConsumed('s1:call-1')).toBe(false)
  })

  it('wait resolves null for unknown tasks', async () => {
    const registry = new BackgroundTaskRegistry()
    await expect(registry.wait('missing', 10)).resolves.toBeNull()
  })

  it('wait times out without consuming the result', async () => {
    vi.useFakeTimers()
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())

    const pending = registry.wait('s1:call-1', 1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toBeNull()
    expect(registry.isConsumed('s1:call-1')).toBe(false)
  })

  it('wait aborts without consuming the result', async () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())
    const controller = new AbortController()

    const pending = registry.wait('s1:call-1', 10_000, controller.signal)
    controller.abort()

    await expect(pending).resolves.toBeNull()
    expect(registry.isConsumed('s1:call-1')).toBe(false)
  })

  it('cancels a running task, stops it and resolves waiters', async () => {
    const registry = new BackgroundTaskRegistry()
    const cancel = vi.fn()
    registry.start(startInput({ cancel }))
    const pending = registry.wait('s1:call-1', 10_000)

    expect(registry.cancel('s1:call-1')).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(pending).resolves.toMatchObject({ state: 'cancelled' })
    expect(registry.get('s1:call-1')?.state).toBe('cancelled')
  })

  it('does not cancel finished tasks', () => {
    const registry = new BackgroundTaskRegistry()
    const cancel = vi.fn()
    registry.start(startInput({ cancel }))
    registry.complete('s1:call-1', { state: 'completed' })

    expect(registry.cancel('s1:call-1')).toBe(false)
    expect(registry.cancel('missing')).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
    expect(registry.get('s1:call-1')?.state).toBe('completed')
  })

  it('survives a cancel handler that throws', () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(
      startInput({
        cancel: () => {
          throw new Error('already gone')
        }
      })
    )

    expect(registry.cancel('s1:call-1')).toBe(true)
    expect(registry.get('s1:call-1')?.state).toBe('cancelled')
  })

  it('cancels every running task on shutdown', () => {
    const registry = new BackgroundTaskRegistry()
    const first = vi.fn()
    const second = vi.fn()
    registry.start(startInput({ id: 's1:a', toolCallId: 'a', cancel: first }))
    registry.start(startInput({ id: 's1:b', toolCallId: 'b', cancel: second }))
    registry.complete('s1:b', { state: 'completed' })

    registry.cancelAll()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(registry.get('s1:a')?.state).toBe('cancelled')
    expect(registry.get('s1:b')?.state).toBe('completed')
  })

  it('keeps running tasks and trims the oldest finished ones', () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput({ id: 's1:running', toolCallId: 'running' }))

    for (let index = 0; index < MAX_FINISHED_BACKGROUND_TASKS + 1; index += 1) {
      const id = `s1:call-${index}`
      registry.start(startInput({ id, toolCallId: `call-${index}` }))
      registry.complete(id, { state: 'completed', exitCode: 0 })
    }

    expect(registry.list('s1')).toHaveLength(MAX_FINISHED_BACKGROUND_TASKS + 1)
    expect(registry.get('s1:call-0')).toBeUndefined()
    expect(registry.get('s1:running')?.state).toBe('running')
    expect(registry.get(`s1:call-${MAX_FINISHED_BACKGROUND_TASKS}`)?.state).toBe('completed')
  })

  it('clears one session and resolves its waiters', async () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput({ id: 's1:a', toolCallId: 'a' }))
    registry.start(
      startInput({ id: 's2:b', sessionId: 's2', toolCallId: 'b', ownerMessageId: 'm2' })
    )
    const pending = registry.wait('s1:a', 10_000)

    registry.clearSession('s1')

    await expect(pending).resolves.toBeNull()
    expect(registry.list('s1')).toEqual([])
    expect(registry.get('s1:a')).toBeUndefined()
    expect(registry.list('s2')).toHaveLength(1)
  })

  it('removes a single task', () => {
    const registry = new BackgroundTaskRegistry()
    registry.start(startInput())

    registry.remove('s1:call-1')

    expect(registry.get('s1:call-1')).toBeUndefined()
    expect(registry.list('s1')).toEqual([])
  })
})

describe('background task formatting', () => {
  it('builds deterministic task ids from the session and tool call', () => {
    expect(backgroundTaskId('s1', 'call-1')).toBe('s1:call-1')
  })

  it('truncates long results with a notice', () => {
    expect(truncateBackgroundResult('  short  ')).toBe('short')
    expect(truncateBackgroundResult('abcdefghijklmnop', 10)).toBe(
      'abcdefghij\n[truncated after 10 characters]'
    )
  })

  it('describes the shell body with exit code and output path', () => {
    expect(backgroundTaskBody(shellTask())).toBe('hi\nExit code: 0\nFull output: /tmp/bg.log')
  })

  it('describes failed and cancelled tasks without output', () => {
    expect(
      backgroundTaskBody(
        shellTask({
          state: 'failed',
          exitCode: null,
          result: undefined,
          error: 'The command exited with code unknown.'
        })
      )
    ).toContain('The command did not report an exit code.')
    expect(
      backgroundTaskBody(
        shellTask({
          state: 'cancelled',
          result: undefined,
          exitCode: undefined,
          outputPath: undefined
        })
      )
    ).toBe('Background task cancelled.')
    expect(
      backgroundTaskBody({
        ...shellTask({ kind: 'subagent', exitCode: undefined, outputPath: undefined }),
        result: undefined
      })
    ).toBe('(no output)')
  })

  it('formats a structured result block with escaped attributes', () => {
    const text = formatBackgroundResult(
      shellTask({ id: 's1:c<1>', title: 'echo "<hi>" & bye', state: 'failed', exitCode: 2 })
    )

    expect(text).toContain(
      '<background-result kind="shell" id="s1:c&lt;1&gt;" state="failed" ' +
        'command="echo &quot;&lt;hi&gt;&quot; &amp; bye" exit="2">'
    )
    expect(text).toContain('</background-result>')
    expect(text).toContain('Decide whether to retry it')
  })

  it('formats subagent results with the child session', () => {
    const text = formatBackgroundResult({
      ...shellTask({
        kind: 'subagent',
        title: 'Explore src',
        exitCode: undefined,
        childSessionId: 'sub-1'
      }),
      state: 'completed'
    })

    expect(text).toContain('description="Explore src"')
    expect(text).toContain('sessionID="sub-1"')
    expect(text).toContain('do not repeat work it already completed')
  })

  it('formats cancelled results with guidance not to wait again', () => {
    expect(
      formatBackgroundResult({
        ...shellTask({ state: 'cancelled', result: undefined, exitCode: undefined })
      })
    ).toContain('Do not wait for it again.')
  })

  it('builds a synthetic user message for the parent conversation', () => {
    const message = makeBackgroundResultMessage(shellTask())

    expect(message.role).toBe('user')
    expect(message.status).toBe('complete')
    expect(message.sessionId).toBe('s1')
    expect(message.synthetic).toEqual({
      source: 'background-task',
      taskId: 's1:call-1',
      kind: 'shell',
      state: 'completed',
      title: 'printf hi',
      body: 'hi\nExit code: 0\nFull output: /tmp/bg.log'
    })
    const part = message.parts[0]
    expect(part.type).toBe('text')
    if (part.type === 'text') expect(part.text).toContain('<background-result ')
  })

  it('lists tasks with their state and exit code', () => {
    expect(formatBackgroundTaskList([])).toBe('No background tasks.')
    expect(
      formatBackgroundTaskList([
        shellTask(),
        shellTask({
          id: 's1:call-2',
          kind: 'subagent',
          title: 'Explore',
          state: 'running',
          exitCode: undefined
        })
      ])
    ).toBe(
      [
        'Background tasks:',
        '- s1:call-1 · shell · completed (exit 0) · printf hi',
        '- s1:call-2 · subagent · running · Explore'
      ].join('\n')
    )
  })
})
