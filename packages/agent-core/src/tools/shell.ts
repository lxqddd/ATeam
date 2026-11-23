import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { ensureExternalAccess, escapesWorkspace, resolvePath, safeError, truncate } from './helpers'
import { MAX_TOOL_OUTPUT } from './types'
import type { ToolContext } from './types'

export function createShellTool(context: ToolContext): Tool {
  return tool({
    description:
      'Run a shell command inside the workspace. Requires approval. Use for commands, tests, and git; avoid interactive commands.',
    inputSchema: z.object({
      command: z.string().describe('Shell command'),
      cwd: z.string().optional().describe('Working directory relative to the workspace'),
      timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
      background: z.boolean().optional().describe('Run in the background and return immediately')
    }),
    execute: async ({ command, cwd = '.', timeoutMs = 120_000, background = false }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, cwd)
        if (external && !(await ensureExternalAccess(context, cwd, 'shell', options.toolCallId))) {
          return 'Permission denied; the command was not run.'
        }
        const allowed = await context.askPermission('shell', command, 'shell', options.toolCallId)
        if (!allowed) return 'Permission denied; the command was not run.'
        const workdir = await resolvePath(context.workspace, cwd, false, external)
        const env = { ...process.env, ...(await context.shellEnv?.()) }

        if (background) {
          const outputPath = context.backgroundOutputPath
            ? await context.backgroundOutputPath(options.toolCallId)
            : null
          const handle = outputPath ? await fs.open(outputPath, 'a') : null
          const descriptor = handle?.fd ?? null
          const child = spawn(command, {
            cwd: workdir,
            shell: true,
            detached: process.platform !== 'win32',
            env,
            stdio: descriptor === null ? 'ignore' : ['ignore', descriptor, descriptor]
          })
          let finished = false
          const finish = (code: number | null): void => {
            if (finished) return
            finished = true
            if (handle) void handle.close()
            context.onBackgroundFinished?.({
              toolCallId: options.toolCallId,
              command,
              exitCode: code,
              outputPath
            })
          }
          child.on('error', () => finish(null))
          child.on('close', (code) => finish(code))
          child.unref()
          return `Started background command (pid ${child.pid ?? 'unknown'}).${
            outputPath ? ` Output: ${outputPath}` : ''
          }`
        }

        return await new Promise<string>((resolve) => {
          const child = spawn(command, {
            cwd: workdir,
            shell: true,
            detached: process.platform !== 'win32',
            env
          })
          let output = ''
          let settled = false
          const finish = (result: string): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            options.abortSignal?.removeEventListener('abort', onAbort)
            resolve(truncate(result))
          }
          const kill = (): void => {
            try {
              if (process.platform !== 'win32' && child.pid) {
                process.kill(-child.pid, 'SIGKILL')
              } else {
                child.kill('SIGKILL')
              }
            } catch {
              /* already gone */
            }
          }
          const onAbort = (): void => {
            kill()
            finish(`${output}\n[command interrupted]`)
          }
          const append = (chunk: Buffer): void => {
            if (output.length >= MAX_TOOL_OUTPUT) return
            const text = chunk.toString('utf8')
            const remaining = Math.max(0, MAX_TOOL_OUTPUT - output.length)
            output += text
            const delta = text.slice(0, remaining)
            if (delta) context.onToolOutput?.(options.toolCallId, delta)
          }
          const timer = setTimeout(() => {
            kill()
            finish(`${output}\n[command timed out after ${timeoutMs}ms]`)
          }, timeoutMs)
          options.abortSignal?.addEventListener('abort', onAbort, { once: true })
          child.stdout.on('data', append)
          child.stderr.on('data', append)
          child.on('error', (error) => finish(`Error: ${error.message}`))
          child.on('close', (code) => {
            finish(`${output}${code && code !== 0 ? `\n[exit ${code}]` : ''}` || '(no output)')
          })
        })
      } catch (error) {
        return safeError(error)
      }
    }
  })
}
