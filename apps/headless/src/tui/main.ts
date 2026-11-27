#!/usr/bin/env node
import { ModelConfigStore } from '@ateam/agent-core'
import type { ModelRef, RuntimeModelsConfig } from '@ateam/shared'
import { buildCliModels } from '../cli/args'
import { parseTuiArgs, TUI_HELP, type TuiOptions } from './args'
import { AttachTuiBackend } from './attach'
import { LocalTuiBackend, type TuiBackend } from './backend'
import { TuiController } from './controller'
import { renderView } from './render'
import { createTerminal } from './terminal'

interface ResolvedModels {
  models: RuntimeModelsConfig
  model: ModelRef
  label: string
}

/**
 * Resolves the model used for new local sessions. Explicit CLI flags win;
 * otherwise the provider store shared with the desktop app is used.
 */
async function resolveLocalModels(options: TuiOptions): Promise<ResolvedModels> {
  if (options.model.trim()) {
    const models = buildCliModels(options)
    const model = models.defaultModel
    if (!model) throw new Error('模型配置不可用')
    return { models, model, label: models.models[0]?.name ?? options.model }
  }

  const store = new ModelConfigStore(options.userData)
  await store.init()
  const models = store.runtimeConfig()
  const model = models.defaultModel
  if (!model || models.models.length === 0) {
    throw new Error(
      '未找到模型配置。请先运行 "pnpm cli -- providers add"，或在命令行传入 --model 与 --api-key。'
    )
  }
  const provider = models.providers.find((candidate) => candidate.id === model.providerId)
  if (provider && provider.type !== 'openai-compatible' && !provider.apiKey) {
    throw new Error(
      `提供方 ${provider.name} 缺少 API key。请运行 "pnpm cli -- providers add" 重新配置。`
    )
  }
  const entry = models.models.find(
    (candidate) => candidate.providerId === model.providerId && candidate.modelId === model.modelId
  )
  return { models, model, label: entry?.name ?? model.modelId }
}

async function main(): Promise<number> {
  let options: TuiOptions
  try {
    options = parseTuiArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  if (options.help) {
    process.stdout.write(TUI_HELP)
    return 0
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('TUI 需要交互式终端：stdin 与 stdout 都必须是 TTY。')
    return 2
  }

  let backend: TuiBackend
  let model: ModelRef | null = null
  let label: string
  try {
    if (options.attachUrl) {
      backend = new AttachTuiBackend({ baseUrl: options.attachUrl, token: options.token })
      label = options.attachUrl
    } else {
      const resolved = await resolveLocalModels(options)
      backend = new LocalTuiBackend({
        dataDir: options.dataDir,
        workspace: options.workspace,
        models: resolved.models,
        model: resolved.model,
        permissionMode: options.permissionMode,
        reasoningEffort: options.reasoning,
        agent: options.agent
      })
      model = resolved.model
      label = resolved.label
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  const terminal = createTerminal()
  let exitCode = 0
  let finished: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })
  let quitting = false
  let renderQueued = false
  let controller: TuiController | null = null

  const render = (): void => {
    renderQueued = false
    if (!controller) return
    const size = terminal.size()
    controller.setViewport(size.rows, size.columns)
    const view = renderView(controller.state, {
      rows: size.rows,
      columns: size.columns,
      color: options.color
    })
    controller.setScrollLimit(view.scrollLimit)
    terminal.render(view.frame)
  }

  const scheduleRender = (): void => {
    if (renderQueued) return
    renderQueued = true
    queueMicrotask(render)
  }

  const quit = async (code: number): Promise<void> => {
    if (quitting) return
    quitting = true
    exitCode = code
    terminal.leave()
    try {
      await controller?.shutdown()
    } catch {
      // Shutdown is best effort; the terminal is already restored.
    }
    finished?.()
  }

  controller = new TuiController({
    backend,
    sessionId: options.sessionId,
    permissionMode: options.permissionMode,
    reasoningEffort: options.reasoning,
    agent: options.agent,
    model,
    label,
    workspace: options.workspace,
    rows: terminal.size().rows,
    columns: terminal.size().columns,
    onChange: scheduleRender,
    onQuit: () => {
      void quit(0)
    }
  })
  const active = controller

  terminal.onKey((key) => active.handleKey(key))
  terminal.onResize(render)
  process.once('SIGTERM', () => {
    void quit(143)
  })
  process.once('SIGINT', () => {
    void quit(130)
  })

  terminal.enter()
  render()
  try {
    await active.start()
  } catch (error) {
    terminal.leave()
    await active.shutdown().catch(() => undefined)
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  await done
  return exitCode
}

void main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
