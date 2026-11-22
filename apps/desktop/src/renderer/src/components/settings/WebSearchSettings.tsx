import { errorMessage } from '../../lib/errors'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WEB_SEARCH_PROVIDERS } from '@ateam/shared'
import type { WebSearchProvider, WebSearchProviderPublic } from '@ateam/shared'

function WebSearchSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [config, setConfig] = useState<WebSearchProviderPublic | null>(null)
  const [provider, setProvider] = useState<WebSearchProvider>('tavily')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.websearch
      .get()
      .then((next) => {
        if (!active) return
        setConfig(next)
        setProvider(next.provider)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [])

  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const key = apiKey.trim()
      const next = await window.api.agent.websearch.update({
        provider,
        ...(key ? { apiKey: key } : {})
      })
      setConfig(next)
      setApiKey('')
      setSaved(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return error ? (
      <p role="alert" className="m-0 py-2 text-caption text-danger">
        {error}
      </p>
    ) : (
      <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      <p className="m-0 text-caption text-muted">
        {t('settings.webStatus')}:{' '}
        {config.hasApiKey ? t('settings.webConfigured') : t('settings.webNotConfigured')}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-caption text-muted">
          {t('settings.webProvider')}
          <select
            aria-label={t('settings.webProvider')}
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as WebSearchProvider)
              setSaved(false)
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none"
          >
            {WEB_SEARCH_PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {value === 'tavily'
                  ? 'Tavily'
                  : value === 'exa'
                    ? 'Exa'
                    : value === 'serper'
                      ? 'Serper'
                      : 'Brave Search'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-caption text-muted">
          {t('settings.webApiKey')}
          <input
            type="password"
            aria-label={t('settings.webApiKey')}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              setSaved(false)
            }}
            placeholder={
              config.hasApiKey ? t('settings.webApiKeyKeep') : t('settings.webApiKeyPlaceholder')
            }
            className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            void save()
          }}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
        >
          {saving ? t('settings.saving') : t('settings.webSave')}
        </button>
        {saved && <span className="pb-1.5 text-caption text-success">{t('settings.saved')}</span>}
      </div>

      <p className="m-0 text-caption text-muted">{t('settings.webHint')}</p>
    </div>
  )
}

export default WebSearchSettings
