import { tool, type Tool } from 'ai'
import { parsePatch } from 'diff'
import { z } from 'zod'
import type {
  FileChangeStatus,
  VcsDiffResult,
  VcsFileDiff,
  VcsInfo,
  VcsStatus
} from '@ateam/shared'
import { safeError } from './helpers'
import type { ToolContext } from './types'

const STATUS_LETTER: Record<FileChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D'
}

function formatInfo(info: VcsInfo): string {
  if (!info.isRepository) return 'Not a Git repository.'
  const lines = [`Repository: ${info.root}`, `Branch: ${info.branch ?? '(detached)'}`]
  if (info.defaultBranch) lines.push(`Default branch: ${info.defaultBranch}`)
  return lines.join('\n')
}

function formatStatus(status: VcsStatus): string {
  if (!status.info.isRepository) return 'Not a Git repository.'
  if (status.files.length === 0) return 'Working tree clean.'
  const lines = status.files.map((file) => `${STATUS_LETTER[file.status]} ${file.path}`)
  if (status.truncated) lines.push('... (more files omitted)')
  return lines.join('\n')
}

function formatFileDiff(file: VcsFileDiff): string[] {
  const lines = [
    `${STATUS_LETTER[file.status]} ${file.path} (+${file.additions} -${file.deletions})`
  ]
  if (file.binary) return [...lines, 'Binary file; diff preview is not available.']
  if (file.truncated) return [...lines, 'Diff too large; preview omitted.']
  if (file.hunks.length === 0) return [...lines, 'No diff available.']
  for (const hunk of file.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    lines.push(...hunk.lines)
  }
  return lines
}

function formatDiff(result: VcsDiffResult): string {
  if (!result.isRepository) return 'Not a Git repository.'
  const header = `Mode: ${result.mode}${result.base ? ` (base ${result.base})` : ''}`
  if (result.files.length === 0) return `${header}\nNo changes.`
  const additions = result.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = result.files.reduce((sum, file) => sum + file.deletions, 0)
  const lines = [header, `Files: ${result.files.length} (+${additions} -${deletions})`, '']
  for (const file of result.files) lines.push(...formatFileDiff(file), '')
  if (result.truncated) {
    lines.push(
      result.reason === 'bytes' ? '... (diff truncated by size)' : '... (more files omitted)'
    )
  }
  return lines.join('\n').trimEnd()
}

function patchPaths(patch: string): { paths: string[] } | { error: string } {
  const paths = new Set<string>()
  for (const parsed of parsePatch(patch)) {
    for (const name of [parsed.oldFileName, parsed.newFileName]) {
      if (!name || name === '/dev/null') continue
      if (!name.startsWith('a/') && !name.startsWith('b/')) {
        return { error: 'Error: patches must use a/ and b/ path prefixes.' }
      }
      paths.add(name.slice(2))
    }
  }
  if (paths.size === 0) return { error: 'Error: the patch does not change any files.' }
  return { paths: [...paths] }
}

export function createVcsTool(context: ToolContext): Tool {
  return tool({
    description:
      'Inspect the Git repository of the workspace. Actions: info (root, branch, default branch), status (changed files), diff (working tree, branch vs merge base, or the last commit), apply (apply a unified Git patch to the working tree). Paths are relative to the repository root; apply only changes the working tree and requires approval per file.',
    inputSchema: z.object({
      action: z.enum(['info', 'status', 'diff', 'apply']).describe('Operation to run'),
      mode: z
        .enum(['working', 'branch', 'committed'])
        .optional()
        .describe('Diff baseline; defaults to working'),
      base: z
        .string()
        .max(200)
        .optional()
        .describe('Base revision for branch mode; defaults to the default branch'),
      path: z.string().max(2_000).optional().describe('Repository-relative path filter'),
      patch: z
        .string()
        .optional()
        .describe('Unified Git patch for apply, with a/ and b/ path prefixes')
    }),
    execute: async (input, options) => {
      try {
        if (!context.vcs) return 'Error: Git integration is not available.'
        if (input.action === 'info') {
          const allowed = await context.askPermission('read', 'git info', 'vcs', options.toolCallId)
          if (!allowed) return 'Permission denied; Git info was not read.'
          return formatInfo(await context.vcs.info())
        }
        if (input.action === 'status') {
          const allowed = await context.askPermission(
            'read',
            'git status',
            'vcs',
            options.toolCallId
          )
          if (!allowed) return 'Permission denied; Git status was not read.'
          return formatStatus(await context.vcs.status())
        }
        if (input.action === 'diff') {
          const mode = input.mode ?? 'working'
          const allowed = await context.askPermission(
            'read',
            `git diff ${mode}`,
            'vcs',
            options.toolCallId
          )
          if (!allowed) return 'Permission denied; the Git diff was not read.'
          return formatDiff(await context.vcs.diff({ mode, base: input.base, path: input.path }))
        }
        if (!input.patch) return 'Error: apply requires a patch.'
        const parsed = patchPaths(input.patch)
        if ('error' in parsed) return parsed.error
        for (const file of parsed.paths) {
          const allowed = await context.askPermission('edit', file, 'vcs', options.toolCallId)
          if (!allowed) return 'Permission denied; the patch was not applied.'
        }
        const applied = await context.vcs.apply(input.patch)
        return [
          `Applied patch to ${applied.files.length} file(s):`,
          ...applied.files.map((file) => `- ${file}`)
        ].join('\n')
      } catch (error) {
        return safeError(error)
      }
    }
  })
}
