import { AgentRuntime } from '../main/agent/runtime'
import { buildCliModels, CLI_HELP, parseCliArgs } from '../cli/args'
import { EventBus } from '../server/event-bus'
import { AcpServer } from './server'

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
  const runtimes = new Map<string, Promise<AgentRuntime>>()
  const runtimeFor = (cwd: string): Promise<AgentRuntime> => {
    let runtime = runtimes.get(cwd)
    if (!runtime) {
      runtime = (async () => {
        const instance = new AgentRuntime({
          userDataPath: options.dataDir,
          workspacePath: cwd,
          models,
          send: bus.publish
        })
        await instance.init()
        return instance
      })().catch((error) => {
        runtimes.delete(cwd)
        throw error
      })
      runtimes.set(cwd, runtime)
    }
    return runtime
  }

  const server = new AcpServer({
    bus,
    input: process.stdin,
    output: process.stdout,
    createRuntime: (cwd) => runtimeFor(cwd),
    configureSession: async (runtime, sessionId) => {
      const concrete = runtime as AgentRuntime
      await concrete.setSessionSettings(sessionId, {
        permissionMode: options.permissionMode,
        reasoningEffort: options.reasoning
      })
      if (options.agent) await concrete.setSessionAgent(sessionId, options.agent)
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
