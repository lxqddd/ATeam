import fs from 'node:fs/promises'
import { applyEdits, modify, type FormattingOptions } from 'jsonc-parser'
import type { ProjectConfigEdit, ProjectConfigFile } from '@ateam/shared'
import {
  findProjectConfig,
  parseProjectConfigDocument,
  readProjectConfigFile,
  writeProjectConfigFile
} from './project-config'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const BOM = String.fromCharCode(0xfeff)

function assertSafePath(path: (string | number)[]): void {
  if (path.length === 0) {
    throw new Error('INVALID_PROJECT_CONFIG_EDIT: path must not be empty')
  }
  for (const segment of path) {
    if (typeof segment === 'number') continue
    if (!segment || FORBIDDEN_KEYS.has(segment)) {
      throw new Error(`INVALID_PROJECT_CONFIG_EDIT: unsafe path segment "${segment}"`)
    }
  }
}

interface ContentFormat extends FormattingOptions {
  bom: boolean
}

/** Matches the indentation and line endings already used by the file. */
function detectFormat(content: string): ContentFormat {
  const bom = content.startsWith(BOM)
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const indented = content.match(/^([ \t]+)\S/m)
  const insertSpaces = !(indented?.[1]?.startsWith('\t') ?? false)
  const tabSize = insertSpaces && indented ? indented[1].length : 2
  return { bom, eol, insertSpaces, tabSize }
}

/**
 * Applies JSONC edits while keeping comments, indentation and untouched fields.
 * The result is validated before it is returned so a bad edit can never replace
 * a readable file.
 */
export function applyProjectConfigEdits(content: string, edits: ProjectConfigEdit[]): string {
  if (edits.length === 0) return content
  const format = detectFormat(content)
  const body = format.bom ? content.slice(BOM.length) : content
  const formattingOptions: FormattingOptions = {
    insertSpaces: format.insertSpaces,
    tabSize: format.tabSize,
    eol: format.eol
  }
  let text = body
  for (const edit of edits) {
    assertSafePath(edit.path)
    const hasValue = Object.prototype.hasOwnProperty.call(edit, 'value')
    text = applyEdits(
      text,
      modify(text, edit.path, hasValue ? edit.value : undefined, { formattingOptions })
    )
  }
  if (text !== body) {
    const parsed = parseProjectConfigDocument(text, '<project-config-edit>')
    const error = parsed.diagnostics.find((entry) => entry.severity === 'error')
    if (error) throw new Error(`INVALID_PROJECT_CONFIG: ${error.message}`)
  }
  return format.bom ? `${BOM}${text}` : text
}

/** Edits the project file in place; creates `ateam.json` when none exists. */
export async function editProjectConfigFile(
  workspacePath: string,
  edits: ProjectConfigEdit[]
): Promise<ProjectConfigFile> {
  const existing = await findProjectConfig(workspacePath)
  if (!existing) {
    return writeProjectConfigFile(workspacePath, applyProjectConfigEdits('{}\n', edits))
  }
  const content = await fs.readFile(existing, 'utf8')
  const next = applyProjectConfigEdits(content, edits)
  if (next === content) return readProjectConfigFile(workspacePath)
  return writeProjectConfigFile(workspacePath, next)
}
