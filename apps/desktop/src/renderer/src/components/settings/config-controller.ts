import type { ConfigFileSnapshot, ProjectConfigEdit } from '@ateam/shared'

/**
 * Narrow surface the structured config editors need. Both the project and the
 * global controllers implement it, so the same panels serve either file.
 */
export interface ConfigDocumentController {
  file: ConfigFileSnapshot | null
  /** True when the file exists but its JSON could not be parsed. */
  invalidJson: boolean
  saving: boolean
  saveError: string | null
  /** Applies path-level edits; untouched fields and comments survive. */
  saveEdits(edits: ProjectConfigEdit[]): Promise<boolean>
}

/** Controller that also allows replacing the whole file (raw editor). */
export interface ConfigFileController extends ConfigDocumentController {
  saveContent(content: string): Promise<boolean>
}

/** Controller a settings page needs: load state, retry, and both save paths. */
export interface ConfigPageController extends ConfigFileController {
  loading: boolean
  error: string | null
  reload(): void
}

/** Which file a shared editor panel is bound to. */
export type ConfigScope = 'project' | 'global'
