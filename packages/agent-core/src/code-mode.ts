import { spawn } from 'node:child_process'
import type { ToolSet } from 'ai'

const MAX_OUTPUT = 200_000
const MAX_LOGS = 200
const MAX_LOG_CHARS = 20_000
const STARTUP_TIMEOUT_MS = 8_000

const RUNNER_SOURCE = `
const vm = require('node:vm')
const send = process.send && process.send.bind(process)
if (!send) process.exit(2)

const MAX_LOGS = 200
const MAX_LOG_CHARS = 20000
let logCount = 0
let logChars = 0
let truncated = false
const forwardLog = (level, text) => {
  if (logCount >= MAX_LOGS || logChars >= MAX_LOG_CHARS) {
    if (!truncated) {
      truncated = true
      send({ type: 'log-truncated' })
    }
    return
  }
  logCount += 1
  logChars += String(text).length
  send({ type: 'log', level, text: String(text).slice(0, 4000) })
}

const bridgeBootstrap = \`
(() => {
  let seq = 0
  const pending = new Map()
  const parse = (text) => {
    if (text === undefined) return undefined
    try { return JSON.parse(text) } catch { return undefined }
  }
  globalThis.__resolve = (id, ok, payload) => {
    const call = pending.get(id)
    if (!call) return
    pending.delete(id)
    if (ok) call.resolve(parse(payload))
    else call.reject(new Error(String(payload)))
  }
  const format = (value) => {
    if (value === undefined) return ''
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'object' && 'image' in value) {
      return '[image: ' + (value.summary || 'attached image') + ']'
    }
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  const text = (args) => args.map(format).join(' ')
  const tools = new Proxy(Object.create(null), {
    get(_target, name) {
      if (typeof name !== 'string' || name === 'execute') {
        return async () => { throw new Error('Unknown tool: ' + String(name)) }
      }
      return (input) => new Promise((resolve, reject) => {
        const id = String(++seq)
        pending.set(id, { resolve, reject })
        try {
          __send({ type: 'tool', id, name, input: input === undefined ? {} : input })
        } catch {
          pending.delete(id)
          reject(new Error('Tool input is not serializable'))
        }
      })
    }
  })
  const consoleProxy = {
    log: (...args) => __send({ type: 'log', level: 'log', text: text(args) }),
    info: (...args) => __send({ type: 'log', level: 'info', text: text(args) }),
    warn: (...args) => __send({ type: 'log', level: 'warn', text: text(args) }),
    error: (...args) => __send({ type: 'log', level: 'error', text: text(args) }),
    debug: (...args) => __send({ type: 'log', level: 'debug', text: text(args) })
  }
  globalThis.__bridge = { tools, console: consoleProxy }
})()
\`

const bridgeContext = vm.createContext(
  { __send: (message) => send(message) },
  { codeGeneration: { strings: false, wasm: false } }
)
vm.runInContext(bridgeBootstrap, bridgeContext, { timeout: 2000 })
const bridge = bridgeContext.__bridge

const userContext = vm.createContext(
  { tools: bridge.tools, console: bridge.console },
  { codeGeneration: { strings: false, wasm: false } }
)
vm.runInContext(
  \`globalThis.__serialize = (value) => {
    try {
      if (value === undefined) return ''
      if (value === null) return 'null'
      if (typeof value === 'string') return value
      if (typeof value === 'object' && 'image' in value) {
        return '[image: ' + (value.summary || 'attached image') + ']'
      }
      return JSON.stringify(value)
    } catch {
      return '[unserializable result]'
    }
  }\`,
  userContext,
  { timeout: 2000 }
)

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'tool-result') {
    bridgeContext.__resolve(message.id, message.ok, message.ok ? message.payload : message.error)
    return
  }
  if (message.type !== 'run') return
  const errorText = (error) =>
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
  try {
    const script = new vm.Script(
      '(async () => { const __value = await (async () => {\\n' +
        message.code +
        '\\n})(); return __serialize(__value) })()'
    )
    script.runInContext(userContext).then(
      (value) => send({ type: 'done', result: typeof value === 'string' ? value : String(value) }),
      (error) => send({ type: 'error', error: errorText(error) })
    )
  } catch (error) {
    send({ type: 'error', error: errorText(error) })
  }
})
send({ type: 'ready' })
`

interface ToolMessage {
  type: 'tool'
  id: string
  name: string
  input: unknown
}

interface LogMessage {
  type: 'log'
  level: string
  text: string
}

interface DoneMessage {
  type: 'done'
  result?: string
}

interface ErrorMessage {
  type: 'error'
  error: string
}

type RunnerMessage =
  | { type: 'ready' }
  | ToolMessage
  | LogMessage
  | { type: 'log-truncated' }
  | DoneMessage
  | ErrorMessage

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

function toolResultForScript(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const prepared =
    value && typeof value === 'object' && 'image' in value
      ? `[image: ${(value as { summary?: string }).summary ?? 'attached image'}]`
      : value
  try {
    return JSON.stringify(prepared)
  } catch {
    return JSON.stringify(String(prepared))
  }
}

function permissionFlag(): string {
  const major = Number(process.versions.node.split('.')[0])
  return major >= 23 ? '--permission' : '--experimental-permission'
}

export function runCodeScript(options: CodeScriptOptions): Promise<string> {
  return new Promise((resolve) => {
    if (options.signal.aborted) {
      resolve('Error: ABORTED')
      return
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    delete env.NODE_OPTIONS
    delete env.NODE_EXTRA_CA_CERTS

    const child = spawn(process.execPath, [permissionFlag(), '-e', RUNNER_SOURCE], {
      env,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true
    })

    let settled = false
    let timer: NodeJS.Timeout | undefined
    let callIndex = 0
    const logs: string[] = []
    let logChars = 0
    let logTruncated = false
    let stderr = ''

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
      child.kill('SIGKILL')
      resolve(truncate(text))
    }
    const arm = (): void => {
      disarm()
      timer = setTimeout(() => finish('Error: Code execution timed out'), options.timeoutMs)
    }
    const onAbort = (): void => finish('Error: ABORTED')
    options.signal.addEventListener('abort', onAbort, { once: true })
    const startup = setTimeout(
      () => finish('Error: Code execution timed out while starting'),
      STARTUP_TIMEOUT_MS
    )

    const sendToolResult = (
      id: string,
      ok: boolean,
      payload: string | undefined,
      error?: string
    ): void => {
      if (settled || !child.connected) return
      try {
        child.send(
          ok
            ? { type: 'tool-result', id, ok: true, payload }
            : { type: 'tool-result', id, ok: false, error: error ?? 'Tool failed' }
        )
      } catch {
        finish('Error: the code runner stopped unexpectedly')
      }
    }

    const runTool = async (message: ToolMessage): Promise<void> => {
      const definition = options.tools[message.name]
      const execute = (definition as { execute?: unknown } | undefined)?.execute
      try {
        if (typeof execute !== 'function') throw new Error(`Unknown tool: ${message.name}`)
        callIndex += 1
        const input = JSON.parse(JSON.stringify(message.input ?? {})) as unknown
        const result = await (
          execute as (input: unknown, executionOptions: unknown) => unknown
        ).call(definition, input, {
          toolCallId: `${options.toolCallId}-code-${callIndex}`,
          messages: [],
          abortSignal: options.signal,
          context: undefined
        })
        sendToolResult(message.id, true, toolResultForScript(result))
      } catch (error) {
        sendToolResult(
          message.id,
          false,
          undefined,
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        if (!settled) arm()
      }
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000)
    })
    child.on('error', (error) => finish(`Error: ${error.message}`))
    child.on('exit', (code) => {
      if (!settled) {
        const detail = stderr.trim() ? `: ${stderr.trim().split('\n').slice(-1)[0]}` : ''
        finish(`Error: the code runner exited (code ${code ?? 'unknown'})${detail}`)
      }
    })
    child.on('message', (message: RunnerMessage) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'ready') {
        if (startup) clearTimeout(startup)
        child.send({ type: 'run', code: options.code })
        arm()
        return
      }
      if (message.type === 'tool') {
        disarm()
        void runTool(message)
        return
      }
      if (message.type === 'log') {
        if (logs.length >= MAX_LOGS || logChars >= MAX_LOG_CHARS) {
          logTruncated = true
          return
        }
        const level = typeof message.level === 'string' ? message.level : 'log'
        const text = String(message.text ?? '').slice(0, 4_000)
        const line = level === 'log' ? text : `${level}: ${text}`
        logChars += line.length
        logs.push(line)
        return
      }
      if (message.type === 'log-truncated') {
        logTruncated = true
        return
      }
      if (message.type === 'done') {
        const parts = [...logs]
        if (logTruncated) parts.push('[console output truncated]')
        if (message.result) parts.push(`=> ${message.result}`)
        finish(parts.join('\n') || '(no output)')
        return
      }
      if (message.type === 'error') {
        const parts = [...logs]
        if (logTruncated) parts.push('[console output truncated]')
        parts.push(`Error: ${message.error}`)
        finish(parts.join('\n'))
      }
    })
  })
}
