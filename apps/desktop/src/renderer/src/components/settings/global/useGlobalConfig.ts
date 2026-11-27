import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GlobalConfigFile, ProjectConfigEdit } from '@ateam/shared'
import { useChatStore } from '../../../chat/store'
import { errorMessage } from '../../../lib/errors'
import type { ConfigPageController } from '../config-controller'

/**
 * Loads the global config file and saves it through path-level edits, so
 * unknown top-level fields survive. Refreshes whenever the watcher bumps
 * `configRevision`.
 */
export function useGlobalConfig(): ConfigPageController {
  const { configRevision } = useChatStore()
  const [file, setFile] = useState<GlobalConfigFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    window.api.agent.config.global
      .get()
      .then((next) => {
        if (!active) return
        setFile(next)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [configRevision, reloadKey])

  const saveEdits = useCallback(async (edits: ProjectConfigEdit[]): Promise<boolean> => {
    if (edits.length === 0) return true
    setSaving(true)
    setSaveError(null)
    try {
      setFile(await window.api.agent.config.global.edit({ edits }))
      return true
    } catch (caught) {
      setSaveError(errorMessage(caught))
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const saveContent = useCallback(async (content: string): Promise<boolean> => {
    setSaving(true)
    setSaveError(null)
    try {
      setFile(await window.api.agent.config.global.update({ content }))
      return true
    } catch (caught) {
      setSaveError(errorMessage(caught))
      return false
    } finally {
      setSaving(false)
    }
  }, [])

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
    file,
    loading: file === null && error === null,
    error,
    invalidJson,
    saving,
    saveError,
    reload,
    saveEdits,
    saveContent
  }
}
