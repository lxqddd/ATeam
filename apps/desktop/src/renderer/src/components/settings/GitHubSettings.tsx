import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubTokenStatus } from '@ateam/shared'
import { githubErrorMessage } from '../../lib/github-errors'
import SettingsLoadError from './SettingsLoadError'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=ATeam'

function GitHubSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<GitHubTokenStatus | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    window.api.agent.github
      .status()
      .then((next) => {
        if (active) setStatus(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(githubErrorMessage(caught, t))
      })
    return () => {
      active = false
    }
  }, [reloadKey, t])

  async function save(): Promise<void> {
    if (saving || !token.trim()) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const next = await window.api.agent.github.updateToken(token.trim())
      setStatus(next)
      setToken('')
      setSaved(true)
    } catch (caught) {
      setError(githubErrorMessage(caught, t))
    } finally {
      setSaving(false)
    }
  }

  async function clear(): Promise<void> {
    if (clearing) return
    setClearing(true)
    setError(null)
    setSaved(false)
    try {
      setStatus(await window.api.agent.github.clearToken())
    } catch (caught) {
      setError(githubErrorMessage(caught, t))
    } finally {
      setClearing(false)
    }
  }

  if (!status) {
    return error ? (
      <SettingsLoadError
        message={error}
        onRetry={() => {
          setError(null)
          setReloadKey((value) => value + 1)
        }}
      />
    ) : (
      <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
    )
  }

  const stored = status.source === 'store'
  const statusText = status.hasToken
    ? stored
      ? t('settings.githubConnected', { login: status.login ?? 'GitHub' })
      : t('settings.githubEnvToken')
    : t('settings.githubNotConfigured')

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      <p className="m-0 text-caption text-muted">
        {t('settings.githubStatus')}: {statusText}
      </p>

      {status.source === 'env' && (
        <p className="m-0 text-caption text-subtle">{t('settings.githubEnvHint')}</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-caption text-muted">
          {t('settings.githubToken')}
          <input
            type="password"
            aria-label={t('settings.githubToken')}
            value={token}
            onChange={(event) => {
              setToken(event.target.value)
              setSaved(false)
            }}
            placeholder={
              stored ? t('settings.githubTokenKeep') : t('settings.githubTokenPlaceholder')
            }
            className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle"
          />
        </label>
        <button
          type="button"
          disabled={saving || !token.trim()}
          onClick={() => {
            void save()
          }}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
        >
          {saving ? t('settings.saving') : t('settings.githubSave')}
        </button>
        {stored && (
          <button
            type="button"
            disabled={clearing}
            onClick={() => {
              void clear()
            }}
            className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-55"
          >
            {clearing ? t('settings.saving') : t('settings.githubClear')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void window.api.openExternal(TOKEN_URL).catch(() => undefined)
          }}
          className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover"
        >
          {t('settings.githubCreateToken')}
        </button>
        {saved && <span className="pb-1.5 text-caption text-success">{t('settings.saved')}</span>}
      </div>

      <p className="m-0 text-caption text-muted">{t('settings.githubHint')}</p>
    </div>
  )
}

export default GitHubSettings
