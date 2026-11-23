import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { ripgrepSearch } from '../integrations/ripgrep'
import {
  ensureExternalAccess,
  escapeRegExp,
  escapesWorkspace,
  globExpression,
  matchesInclude,
  readFileText,
  resolvePath,
  safeError,
  truncate,
  walk
} from './helpers'
import { GLOB_TIMEOUT_MS, IGNORED_DIRS, MAX_GREP_MATCHES } from './types'
import type { ToolContext } from './types'

export function createGrepTool(context: ToolContext): Tool {
  return tool({
    description: 'Search text files in the workspace with a JavaScript regular expression.',
    inputSchema: z.object({
      pattern: z.string().describe('JavaScript regular expression'),
      path: z.string().optional().describe('Directory relative to the workspace'),
      include: z.string().optional().describe('Optional filename filter, e.g. *.ts'),
      literal: z.boolean().optional().describe('Treat the pattern as literal text'),
      caseSensitive: z.boolean().optional().describe('Use case-sensitive matching'),
      maxResults: z.number().int().min(1).max(500).optional()
    }),
    execute: async (
      {
        pattern,
        path: inputPath = '.',
        include = '',
        literal = false,
        caseSensitive = false,
        maxResults = MAX_GREP_MATCHES
      },
      options
    ) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'grep', options.toolCallId))
        ) {
          return 'Permission denied; the search was not run.'
        }
        const allowed = await context.askPermission('grep', pattern, 'grep', options.toolCallId)
        if (!allowed) return 'Permission denied; the search was not run.'
        const expression = new RegExp(
          literal ? escapeRegExp(pattern) : pattern,
          caseSensitive ? '' : 'i'
        )
        const root = await resolvePath(context.workspace, inputPath, false, external)
        const base = path.resolve(context.workspace)
        const matches: string[] = []
        let stop = false
        let usedRipgrep = false
        if (context.grepEngine !== 'js') {
          const results = await ripgrepSearch({
            cwd: root,
            pattern,
            literal,
            caseSensitive,
            include: include || undefined,
            maxResults,
            signal: context.signal
          }).catch(() => null)
          if (results) {
            usedRipgrep = true
            for (const match of results) {
              matches.push(
                `${path.relative(base, path.resolve(root, match.path))}:${match.line}: ${match.text}`
              )
            }
            stop = matches.length >= maxResults
          }
        }
        if (!usedRipgrep)
          await walk(
            root,
            async (filePath) => {
              if (!matchesInclude(filePath, include)) return false
              let text: string
              try {
                text = await readFileText(filePath)
              } catch {
                return false
              }
              for (const [index, line] of text.split(/\r?\n/).entries()) {
                if (!expression.test(line)) continue
                matches.push(`${path.relative(base, filePath)}:${index + 1}: ${line}`)
                if (matches.length >= maxResults) {
                  stop = true
                  return true
                }
              }
              return false
            },
            0,
            8
          )
        const header = stop ? `[stopped at ${maxResults} matches]\n` : ''
        const matchesText = header + (matches.join('\n') || 'No matches')
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        return truncate(`${matchesText}${nested ? `\n\n${nested}` : ''}`)
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createGlobTool(context: ToolContext): Tool {
  return tool({
    description:
      'Find files in the workspace by glob pattern such as **/*.ts. Skips ignored directories by default.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern relative to the workspace'),
      path: z.string().optional().describe('Directory to search from'),
      hidden: z.boolean().optional().describe('Include hidden files and directories'),
      limit: z.number().int().min(1).max(1_000).optional()
    }),
    execute: async ({ pattern, path: inputPath = '.', hidden = false, limit = 100 }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'glob', options.toolCallId))
        ) {
          return 'Permission denied; the file search was not run.'
        }
        const allowed = await context.askPermission('list', pattern, 'glob', options.toolCallId)
        if (!allowed) return 'Permission denied; the file search was not run.'
        const base = await resolvePath(context.workspace, inputPath, false, external)
        const root = path.resolve(context.workspace)
        const matcher = globExpression(pattern)
        const matches: string[] = []
        let stopped = false
        let timedOut = false
        const deadline = Date.now() + (context.globTimeoutMs ?? GLOB_TIMEOUT_MS)

        const walk = async (directory: string, depth: number): Promise<void> => {
          if (depth > 12 || stopped) return
          if (Date.now() >= deadline) {
            timedOut = true
            stopped = true
            return
          }
          const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
          for (const entry of entries) {
            if (stopped) return
            if (IGNORED_DIRS.has(entry.name)) continue
            if (!hidden && entry.name.startsWith('.')) continue
            const absolute = path.join(directory, entry.name)
            if (entry.isDirectory()) {
              await walk(absolute, depth + 1)
            } else if (entry.isFile()) {
              const relative = path.relative(root, absolute).split(path.sep).join('/')
              const relativeToBase = path.relative(base, absolute).split(path.sep).join('/')
              if (!matcher.test(relativeToBase)) continue
              matches.push(relative)
              if (matches.length >= limit) {
                stopped = true
                return
              }
            }
          }
        }

        await walk(base, 0)
        matches.sort()
        const header = timedOut
          ? '[glob timed out]\n'
          : stopped
            ? `[stopped at ${limit} results]\n`
            : ''
        const listed = header + (matches.join('\n') || 'No matches')
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        return truncate(`${listed}${nested ? `\n\n${nested}` : ''}`)
      } catch (error) {
        return safeError(error)
      }
    }
  })
}
