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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertSafePath(path: (string | number)[], errorPrefix: string): void {
  if (path.length === 0) {
    throw new Error(`${errorPrefix}: path must not be empty`)
  }
  for (const segment of path) {
    if (typeof segment === 'number') continue
    if (!segment || FORBIDDEN_KEYS.has(segment)) {
      throw new Error(`${errorPrefix}: unsafe path segment "${segment}"`)
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Rejects path traversal through primitives before `jsonc-parser` runs, so a
 * boolean/string parent surfaces as a config error instead of a parser throw.
 * Missing intermediate objects are allowed: `modify` creates them.
 */
function assertEditableParent(
  content: string,
  path: (string | number)[],
  errorPrefix: string
): void {
  let current: unknown = JSON.parse(content)
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!
    if (Array.isArray(current)) {
      if (typeof segment !== 'number') {
        throw new Error(`${errorPrefix}: cannot use key "${segment}" on an array`)
      }
      current = current[segment]
    } else if (isPlainObject(current)) {
      current = current[segment as string]
    } else if (current === undefined) {
      return
    } else {
      throw new Error(`${errorPrefix}: cannot edit below a non-object value`)
    }
  }
  const last = path[path.length - 1]!
  if (current === undefined) return
  if (Array.isArray(current)) {
    if (typeof last !== 'number') {
      throw new Error(`${errorPrefix}: cannot use key "${last}" on an array`)
    }
  } else if (!isPlainObject(current)) {
    throw new Error(`${errorPrefix}: cannot edit below a non-object value`)
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

interface JsonEditOptions {
  /** Prefix of the errors thrown for unsafe paths or failed parser edits. */
  errorPrefix: string
  /** Throws when the text is not a valid document for this file format. */
  validate: (text: string) => void
  /** Runs before each edit against the current text. */
  beforeEdit?: (text: string, edit: ProjectConfigEdit) => void
}

function applyJsonEdits(
  content: string,
  edits: ProjectConfigEdit[],
  options: JsonEditOptions
): string {
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
    assertSafePath(edit.path, options.errorPrefix)
    options.beforeEdit?.(text, edit)
    const hasValue = Object.prototype.hasOwnProperty.call(edit, 'value')
    const before = text
    try {
      text = applyEdits(
        text,
        modify(text, edit.path, hasValue ? edit.value : undefined, { formattingOptions })
      )
    } catch (error) {
      throw new Error(`${options.errorPrefix}: ${errorMessage(error)}`)
    }
    if (text !== before) options.validate(text)
  }
  return format.bom ? `${BOM}${text}` : text
}

/**
 * Applies JSONC edits while keeping comments, indentation and untouched fields.
 * The result is validated before it is returned so a bad edit can never replace
 * a readable file.
 */
export function applyProjectConfigEdits(content: string, edits: ProjectConfigEdit[]): string {
  return applyJsonEdits(content, edits, {
    errorPrefix: 'INVALID_PROJECT_CONFIG_EDIT',
    validate: (text) => {
      const parsed = parseProjectConfigDocument(text, '<project-config-edit>')
      const error = parsed.diagnostics.find((entry) => entry.severity === 'error')
      if (error) throw new Error(`INVALID_PROJECT_CONFIG: ${error.message}`)
    }
  })
}

function parseStrictGlobal(text: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(text)
  if (!isPlainObject(raw)) {
    throw new Error('the config root must be a JSON object')
  }
  return raw
}

/**
 * Applies edits to the strict-JSON global config. Comments, trailing commas and
 * a non-object root are rejected; a leading BOM is kept. `content` must already
 * be the seeded body (`'{}'` for a missing file).
 */
export function applyGlobalConfigEdits(content: string, edits: ProjectConfigEdit[]): string {
  if (edits.length === 0) return content
  const hasBom = content.startsWith(BOM)
  const body = hasBom ? content.slice(BOM.length) : content
  try {
    parseStrictGlobal(body)
  } catch (error) {
    throw new Error(`INVALID_GLOBAL_CONFIG: ${errorMessage(error)}`)
  }
  return applyJsonEdits(content, edits, {
    errorPrefix: 'INVALID_GLOBAL_CONFIG_EDIT',
    beforeEdit: (text, edit) => {
      try {
        assertEditableParent(text, edit.path, 'INVALID_GLOBAL_CONFIG_EDIT')
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`INVALID_GLOBAL_CONFIG: ${error.message}`)
        }
        throw error
      }
    },
    validate: (text) => {
      try {
        parseStrictGlobal(text)
      } catch (error) {
        throw new Error(`INVALID_GLOBAL_CONFIG: ${errorMessage(error)}`)
      }
    }
  })
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
