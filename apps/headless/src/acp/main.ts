#!/usr/bin/env node
import { removeAttachment, saveAttachment } from '@ateam/agent-core/attachments'
import { createHeadlessRuntime } from '../runtime'
import { buildCliModels, CLI_HELP, parseCliArgs } from '../cli/args'
import { EventBus } from '../server/event-bus'
import { AcpServer, type AcpRuntime } from './server'
import { version } from '../version'

const ACP_HELP = `Usage: pnpm acp -- [model options]

Starts an Agent Client Protocol (ACP) agent over stdio for editors such as Zed.

Model options (same as the headless CLI):
  --provider, --base-url, --api-key, --model, --context-window,
  --max-output, --reasoning, --permission, --agent, --data, --workspace

The editor provides the session working directory via session/new.
`

async function main(): Promise<number> {
  let options
  try {
    options = parseCliArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  if (options.help) {
    process.stdout.write(ACP_HELP || CLI_HELP)
    return 0
  }

  let models
  try {
    models = buildCliModels(options)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const bus = new EventBus()
  const runtimes = new Map<string, Promise<AcpRuntime>>()
  const runtimeFor = (cwd: string, runtimeKey = 'default'): Promise<AcpRuntime> => {
    const cacheKey = `${cwd}\u0000${runtimeKey}`
    let runtime = runtimes.get(cacheKey)
    if (!runtime) {
      runtime = (async () => {
        const instance = createHeadlessRuntime({
          dataDir: options.dataDir,
          workspace: cwd,
          models,
          send: bus.publish
        })
        await instance.init()
        return Object.assign(instance, {
          attachImage: (sessionId: string, mimeType: string, data: Uint8Array) => {
            const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
            return saveAttachment(options.dataDir, sessionId, {
              name: `image-${Date.now()}.${extension}`,
              mimeType,
              data
            })
          },
          removeAttachment: (sessionId: string, attachmentId: string) =>
            removeAttachment(options.dataDir, sessionId, attachmentId)
        })
      })().catch((error) => {
        runtimes.delete(cacheKey)
        throw error
      })
      runtimes.set(cacheKey, runtime)
    }
    return runtime
  }

  const server = new AcpServer({
    version,
    bus,
    models,
    input: process.stdin,
    output: process.stdout,
    createRuntime: (cwd) => runtimeFor(cwd),
    configureSession: async (runtime, sessionId) => {
      if (runtime.setSessionSettings) {
        await runtime.setSessionSettings(sessionId, {
          permissionMode: options.permissionMode,
          reasoningEffort: options.reasoning
        })
      }
      if (options.agent && runtime.setSessionAgent) {
        await runtime.setSessionAgent(sessionId, options.agent)
      }
    }
  })
  server.start()

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    await server.close().catch(() => undefined)
    await Promise.all(
      [...runtimes.values()].map((runtime) =>
        runtime.then((instance) => instance.shutdown()).catch(() => undefined)
      )
    )
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.stdin.on('end', () => {
    void shutdown()
  })

  await new Promise<void>(() => undefined)
  return 0
}

void main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
