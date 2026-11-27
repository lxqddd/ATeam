import { emitKeypressEvents, type Key } from 'node:readline'
import type { TuiKey } from './controller'

export interface TuiTerminal {
  /** Current terminal size; falls back to 80×24 when unknown. */
  size(): { rows: number; columns: number }
  enter(): void
  leave(): void
  render(frame: string): void
  onKey(handler: (key: TuiKey) => void): void
  onResize(handler: () => void): void
}

export interface TuiTerminalOptions {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
}

/**
 * Owns the alternate screen, raw mode and cursor. `leave` is idempotent and
 * always runs before the process exits, so an interrupted TUI does not leave a
 * hidden cursor or a stuck terminal behind.
 */
export function createTerminal(options: TuiTerminalOptions = {}): TuiTerminal {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const rawInput = input as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => void
  }
  const keys = new Set<(key: TuiKey) => void>()
  const resizes = new Set<() => void>()
  let entered = false

  const handleKeypress = (sequence: string | undefined, key: Key): void => {
    const event: TuiKey = {
      sequence: sequence ?? key.sequence,
      name: key.name,
      ctrl: key.ctrl,
      meta: key.meta,
      shift: key.shift
    }
    for (const handler of keys) handler(event)
  }

  const handleResize = (): void => {
    for (const handler of resizes) handler()
  }

  return {
    size: () => ({
      rows: output.rows || 24,
      columns: output.columns || 80
    }),
    enter: () => {
      if (entered) return
      entered = true
      emitKeypressEvents(input)
      input.setEncoding('utf8')
      input.resume()
      rawInput.setRawMode?.(true)
      input.on('keypress', handleKeypress)
      output.on('resize', handleResize)
      // Alternate screen, hidden cursor, autowrap off, then clear.
      output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[H')
    },
    leave: () => {
      if (!entered) return
      entered = false
      input.off('keypress', handleKeypress)
      output.off('resize', handleResize)
      rawInput.setRawMode?.(false)
      input.pause()
      // Restore autowrap, show cursor, leave the alternate screen.
      output.write('\x1b[?7h\x1b[?25h\x1b[?1049l')
    },
    render: (frame: string) => {
      output.write(`\x1b[H${frame}\x1b[J`)
    },
    onKey: (handler) => {
      keys.add(handler)
    },
    onResize: (handler) => {
      resizes.add(handler)
    }
  }
}
