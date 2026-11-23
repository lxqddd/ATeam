import { describe, expect, it } from 'vitest'
import { EventBus } from './event-bus'

describe('EventBus', () => {
  it('fans out to subscribers and unsubscribes', () => {
    const bus = new EventBus()
    const received: string[] = []
    const unsubscribe = bus.subscribe((envelope) => received.push(envelope.event.type))

    bus.publish({
      seq: 1,
      at: '2026-01-01T00:00:00.000Z',
      event: { type: 'agent.status', status: { status: 'ready' } }
    })
    unsubscribe()
    bus.publish({
      seq: 2,
      at: '2026-01-01T00:00:00.000Z',
      event: { type: 'agent.status', status: { status: 'stopped' } }
    })

    expect(received).toEqual(['agent.status'])
  })

  it('resolves a matching event and ignores others', async () => {
    const bus = new EventBus()
    const pending = bus.waitFor(
      'run.finished',
      (event) => event.type === 'run.finished' && event.sessionId === 's1',
      1_000
    )

    bus.publish({
      seq: 1,
      at: '2026-01-01T00:00:00.000Z',
      event: { type: 'run.finished', sessionId: 's2', messageId: 'm2', status: 'completed' }
    })
    bus.publish({
      seq: 2,
      at: '2026-01-01T00:00:00.000Z',
      event: { type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'completed' }
    })

    await expect(pending).resolves.toMatchObject({
      event: { type: 'run.finished', sessionId: 's1' }
    })
  })

  it('times out', async () => {
    const bus = new EventBus()
    await expect(bus.waitFor('run.finished', () => true, 10)).rejects.toThrow('Timed out')
  })
})
