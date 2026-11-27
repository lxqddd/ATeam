import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { TuiKey } from './controller'
import { createTerminal } from './terminal'

class FakeInput extends EventEmitter {
  readonly rawModes: boolean[] = []
  encoding: BufferEncoding | null = null
  resumed = false
  paused = false

  setRawMode(mode: boolean): void {
    this.rawModes.push(mode)
  }

  setEncoding(encoding: BufferEncoding): this {
    this.encoding = encoding
    return this
  }

  resume(): this {
    this.resumed = true
    return this
  }

  pause(): this {
    this.paused = true
    return this
  }
}

class FakeOutput extends EventEmitter {
  rows = 30
  columns = 120
  readonly chunks: string[] = []

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }
}

function setup(): {
  input: FakeInput
  output: FakeOutput
  terminal: ReturnType<typeof createTerminal>
} {
  const input = new FakeInput()
  const output = new FakeOutput()
  const terminal = createTerminal({
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream
  })
  return { input, output, terminal }
}

describe('createTerminal', () => {
  it('reports the output size with a fallback', () => {
    const { output, terminal } = setup()
    expect(terminal.size()).toEqual({ rows: 30, columns: 120 })
    output.rows = 0
    output.columns = 0
    expect(terminal.size()).toEqual({ rows: 24, columns: 80 })
  })

  it('enters the alternate screen, uses raw mode and restores once', () => {
    const { input, output, terminal } = setup()
    terminal.enter()
    terminal.enter()
    expect(input.encoding).toBe('utf8')
    expect(input.resumed).toBe(true)
    expect(input.rawModes).toEqual([true])
    expect(output.chunks).toEqual(['\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[H'])

    terminal.render('hello')
    expect(output.chunks.at(-1)).toBe('\x1b[Hhello\x1b[J')

    terminal.leave()
    terminal.leave()
    expect(input.rawModes).toEqual([true, false])
    expect(input.paused).toBe(true)
    expect(output.chunks.at(-1)).toBe('\x1b[?7h\x1b[?25h\x1b[?1049l')
    expect(output.chunks).toHaveLength(3)
  })

  it('forwards keypress and resize events until it leaves', () => {
    const { input, output, terminal } = setup()
    const keys: TuiKey[] = []
    let resizes = 0
    terminal.onKey((key) => keys.push(key))
    terminal.onResize(() => {
      resizes += 1
    })
    terminal.enter()

    input.emit('keypress', 'x', { name: 'x', ctrl: true, meta: false, shift: false })
    output.emit('resize')
    expect(keys).toEqual([{ sequence: 'x', name: 'x', ctrl: true, meta: false, shift: false }])
    expect(resizes).toBe(1)

    terminal.leave()
    input.emit('keypress', 'y', { name: 'y' })
    output.emit('resize')
    expect(keys).toHaveLength(1)
    expect(resizes).toBe(1)
  })
})
