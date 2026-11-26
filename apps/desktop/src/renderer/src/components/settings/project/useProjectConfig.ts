import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EffectiveAgentConfig, ProjectConfigEdit, ProjectConfigFile } from '@ateam/shared'
import { useChatStore } from '../../../chat/store'
import { errorMessage } from '../../../lib/errors'

export interface ProjectConfigController {
  /** Workspace whose project config is being edited. */
  directory?: string
  file: ProjectConfigFile | null
  resolved: EffectiveAgentConfig | null
  loading: boolean
  error: string | null
  saveError: string | null
  saving: boolean
  /** True when the file exists but its JSONC could not be parsed. */
  invalidJson: boolean
  reload: () => void
  /** Applies path-level edits (JSONC comments outside the edited nodes survive). */
  saveEdits: (edits: ProjectConfigEdit[]) => Promise<boolean>
  /** Replaces the whole file content (raw editor). */
  saveContent: (content: string) => Promise<boolean>
}

/**
 * Loads the project config file and its effective (merged) config for the
 * selected session's workspace, refreshing whenever the watcher bumps
 * `configRevision`.
 */
export function useProjectConfig(defaultDirectory?: string): ProjectConfigController {
  const { sessions, selectedSessionId, configRevision } = useChatStore()
  const directory =
    sessions.find((session) => session.id === selectedSessionId)?.directory ?? defaultDirectory
  const [file, setFile] = useState<ProjectConfigFile | null>(null)
  const [resolved, setResolved] = useState<EffectiveAgentConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    Promise.all([
      window.api.agent.config.project.get(directory),
      window.api.agent.config.resolve(directory)
    ])
      .then(([nextFile, nextResolved]) => {
        if (!active) return
        setFile(nextFile)
        setResolved(nextResolved)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [directory, configRevision, reloadKey])

  const applyFile = useCallback(
    async (next: ProjectConfigFile): Promise<void> => {
      setFile(next)
      setResolved(await window.api.agent.config.resolve(directory))
    },
    [directory]
  )

  const saveEdits = useCallback(
    async (edits: ProjectConfigEdit[]): Promise<boolean> => {
      if (edits.length === 0) return true
      setSaving(true)
      setSaveError(null)
      try {
        const next = await window.api.agent.config.project.edit({ directory, edits })
        await applyFile(next)
        return true
      } catch (caught) {
        setSaveError(errorMessage(caught))
        return false
      } finally {
        setSaving(false)
      }
    },
    [directory, applyFile]
  )

  const saveContent = useCallback(
    async (content: string): Promise<boolean> => {
      setSaving(true)
      setSaveError(null)
      try {
        const next = await window.api.agent.config.project.update({ directory, content })
        await applyFile(next)
        return true
      } catch (caught) {
        setSaveError(errorMessage(caught))
        return false
      } finally {
        setSaving(false)
      }
    },
    [directory, applyFile]
  )

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1)
  }, [])

  const invalidJson = useMemo(
    () =>
      file?.diagnostics.some(
        (diagnostic) => diagnostic.severity === 'error' && diagnostic.path === '$'
      ) ?? false,
    [file]
  )

  return {
    directory,
    file,
    resolved,
    loading: file === null && error === null,
    error,
    saveError,
    saving,
    invalidJson,
    reload,
    saveEdits,
    saveContent
  }
}
