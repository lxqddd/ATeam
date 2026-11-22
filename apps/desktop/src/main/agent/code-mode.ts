import { Worker } from 'node:worker_threads'
import type { ToolSet } from 'ai'

const MAX_OUTPUT = 200_000

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const vm = require('node:vm')
const MAX_LOGS = 200
const MAX_LOG_CHARS = 20000
const logs = []
let logChars = 0
let truncated = false

const format = (value) => {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'image' in value) {
    return '[image: ' + (value.summary || 'attached image') + ']'
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const addLog = (level, args) => {
  if (logs.length >= MAX_LOGS || logChars >= MAX_LOG_CHARS) {
    truncated = true
    return
  }
  const text = args.map(format).join(' ').slice(0, 4000)
  const line = level === 'log' ? text : level + ': ' + text
  logChars += line.length
  logs.push(line)
}

let seq = 0
const pending = new Map()
const tools = new Proxy(Object.create(null), {
  get(_target, name) {
    if (typeof name !== 'string' || name === 'execute') {
      return async () => {
        throw new Error('Unknown tool: ' + String(name))
      }
    }
    return (input) =>
      new Promise((resolve, reject) => {
        const id = String(++seq)
        pending.set(id, { resolve, reject })
        parentPort.postMessage({
          type: 'tool',
          id,
          name,
          input: input === undefined ? {} : input
        })
      })
  }
})

parentPort.on('message', (message) => {
  if (!message || message.type !== 'tool-result') return
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  if (message.ok) call.resolve(message.result)
  else call.reject(new Error(message.error || 'Tool failed'))
})

const consoleProxy = {
  log: (...args) => addLog('log', args),
  info: (...args) => addLog('info', args),
  warn: (...args) => addLog('warn', args),
  error: (...args) => addLog('error', args),
  debug: (...args) => addLog('debug', args)
}

;(async () => {
  try {
    const script = new vm.Script('(async () => {\\n' + workerData.code + '\\n})()')
    const context = vm.createContext(
      { tools, console: consoleProxy },
      { codeGeneration: { strings: false, wasm: false } }
    )
    const value = await script.runInContext(context)
    parentPort.postMessage({ type: 'done', logs, truncated, result: format(value) })
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error)
    parentPort.postMessage({ type: 'error', logs, truncated, error: message })
  }
})()
`

interface ToolRequest {
  type: 'tool'
  id: string
  name: string
  input: unknown
}

interface DoneMessage {
  type: 'done'
  logs: string[]
  truncated?: boolean
  result?: string
}

interface ErrorMessage {
  type: 'error'
  logs: string[]
  truncated?: boolean
  error: string
}

type CodeWorkerMessage = ToolRequest | DoneMessage | ErrorMessage

export interface CodeScriptOptions {
  tools: ToolSet
  code: string
  timeoutMs: number
  toolCallId: string
  signal: AbortSignal
}

function truncate(value: string): string {
  if (value.length <= MAX_OUTPUT) return value
  return `${value.slice(0, MAX_OUTPUT)}\n[output truncated]`
}

function toolResultForWorker(value: unknown): unknown {
  if (value && typeof value === 'object' && 'image' in value) {
    const image = value as { summary?: string }
    return `[image: ${image.summary ?? 'attached image'}]`
  }
  return value
}

export function runCodeScript(options: CodeScriptOptions): Promise<string> {
  return new Promise((resolve) => {
    if (options.signal.aborted) {
      resolve('Error: ABORTED')
      return
    }

    let settled = false
    let timer: NodeJS.Timeout | undefined
    let callIndex = 0
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { code: options.code }
    })

    const disarm = (): void => {
      if (timer) clearTimeout(timer)
      timer = undefined
    }
    const finish = (text: string): void => {
      if (settled) return
      settled = true
      disarm()
      clearTimeout(startup)
      options.signal.removeEventListener('abort', onAbort)
      void worker.terminate().catch(() => undefined)
      resolve(truncate(text))
    }
    const arm = (): void => {
      disarm()
      timer = setTimeout(() => finish('Error: Code execution timed out'), options.timeoutMs)
    }
    const onAbort = (): void => finish('Error: ABORTED')
    options.signal.addEventListener('abort', onAbort, { once: true })
    const startup = setTimeout(
      () => finish('Error: Code execution timed out'),
      Math.max(options.timeoutMs * 5, 5_000)
    )

    const runTool = async (message: ToolRequest): Promise<void> => {
      const definition = options.tools[message.name]
      const execute = (definition as { execute?: unknown } | undefined)?.execute
      try {
        if (typeof execute !== 'function') throw new Error(`Unknown tool: ${message.name}`)
        callIndex += 1
        const result = await (
          execute as (input: unknown, executionOptions: unknown) => unknown
        ).call(definition, message.input ?? {}, {
          toolCallId: `${options.toolCallId}-code-${callIndex}`,
          messages: [],
          abortSignal: options.signal,
          context: undefined
        })
        if (settled) return
        worker.postMessage({
          type: 'tool-result',
          id: message.id,
          ok: true,
          result: toolResultForWorker(result)
        })
      } catch (error) {
        if (settled) return
        worker.postMessage({
          type: 'tool-result',
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        if (!settled) arm()
      }
    }

    worker.once('online', () => {
      clearTimeout(startup)
      arm()
    })
    worker.on('message', (message: CodeWorkerMessage) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'tool') {
        disarm()
        void runTool(message)
        return
      }
      if (message.type === 'done') {
        const parts = [...(message.logs ?? [])]
        if (message.truncated) parts.push('[console output truncated]')
        if (message.result) parts.push(`=> ${message.result}`)
        finish(parts.join('\n') || '(no output)')
        return
      }
      if (message.type === 'error') {
        const parts = [...(message.logs ?? [])]
        if (message.truncated) parts.push('[console output truncated]')
        parts.push(`Error: ${message.error}`)
        finish(parts.join('\n'))
      }
    })
    worker.on('error', (error) => finish(`Error: ${error.message}`))
    worker.on('exit', () => {
      if (!settled) finish('Error: code runner exited unexpectedly')
    })
  })
}
