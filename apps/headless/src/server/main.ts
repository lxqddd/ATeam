#!/usr/bin/env node
import { AgentRuntime } from '@ateam/agent-core'
import { buildCliModels } from '../cli/args'
import { createApiServer } from './api'
import { parseServerArgs, SERVER_HELP } from './args'
import { EventBus } from './event-bus'

async function main(): Promise<number> {
  let options
  try {
    options = parseServerArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  if (options.help) {
    process.stdout.write(SERVER_HELP)
    return 0
  }

  let models
  try {
    models = buildCliModels(options.cli)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const bus = new EventBus()
  const runtime = new AgentRuntime({
    userDataPath: options.cli.dataDir,
    workspacePath: options.cli.workspace,
    models,
    send: bus.publish
  })
  await runtime.init()

  const api = createApiServer({
    runtime,
    bus,
    token: options.token,
    host: options.host,
    allowUnauthenticatedRemote: options.allowUnauthenticatedRemote,
    port: options.port,
    defaults: {
      permissionMode: options.cli.permissionMode,
      reasoningEffort: options.cli.reasoning,
      agent: options.cli.agent
    }
  })
  const address = await api.listen()
  console.error(`ATeam API listening on http://${address.host}:${address.port}`)
  if (options.token) {
    console.error('Bearer token authentication is enabled.')
  } else if (address.host !== '127.0.0.1' && address.host !== 'localhost') {
    console.error(
      'WARNING: the API is reachable without authentication. Use --token on public interfaces.'
    )
  }

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    await runtime.shutdown().catch(() => undefined)
    await api.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
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
