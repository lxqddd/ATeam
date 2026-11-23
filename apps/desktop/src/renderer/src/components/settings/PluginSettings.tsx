import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginEntry } from '@ateam/shared'
import { errorMessage } from '../../lib/errors'

interface PluginSettingsProps {
  defaultDirectory?: string
}

function PluginSettings({ defaultDirectory }: PluginSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState<PluginEntry[] | null>(null)
  const [spec, setSpec] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.plugins
      .list()
      .then((entries) => {
        if (active) setPlugins(entries)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [])

  async function install(): Promise<void> {
    if (!spec.trim()) return
    setBusy(true)
    setError(null)
    try {
      setPlugins(
        await window.api.agent.plugins.install({
          spec: spec.trim(),
          directory: defaultDirectory ?? null
        })
      )
      setSpec('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(plugin: PluginEntry, enabled: boolean): Promise<void> {
    setPendingId(plugin.id)
    setError(null)
    try {
      setPlugins(await window.api.agent.plugins.update(plugin.id, { enabled }))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPendingId(null)
    }
  }

  async function remove(plugin: PluginEntry): Promise<void> {
    setPendingId(plugin.id)
    setError(null)
    try {
      setPlugins(await window.api.agent.plugins.remove(plugin.id))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-border p-4">
      <div>
        <h3 className="m-0 text-title font-semibold text-foreground">{t('settings.plugins')}</h3>
        <p className="m-0 mt-1 text-caption text-muted">{t('settings.pluginsDescription')}</p>
      </div>

      <div className="flex gap-2">
        <input
          value={spec}
          onChange={(event) => setSpec(event.target.value)}
          placeholder={t('settings.pluginSpecPlaceholder')}
          aria-label={t('settings.pluginSpec')}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
        />
        <button
          type="button"
          disabled={busy || !spec.trim()}
          onClick={() => {
            void install()
          }}
          className="h-8 flex-none rounded-md bg-accent px-3 text-caption font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t('settings.pluginInstalling') : t('settings.pluginInstall')}
        </button>
      </div>
      <p className="m-0 text-caption text-subtle">{t('settings.pluginSpecHint')}</p>

      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      {plugins === null ? (
        <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
      ) : plugins.length === 0 ? (
        <p className="m-0 py-2 text-caption text-muted">{t('settings.pluginEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {plugins.map((plugin) => (
            <li
              key={plugin.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
            >
              <span className="text-label font-medium text-foreground">{plugin.name}</span>
              {plugin.version && <span className="text-caption text-muted">{plugin.version}</span>}
              <span className="inline-flex h-[18px] items-center rounded-full bg-surface px-1.5 text-[12px] leading-none font-medium text-muted">
                {plugin.source === 'local'
                  ? t('settings.pluginSourceLocal')
                  : t('settings.pluginSourceNpm')}
              </span>
              <span
                className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[12px] leading-none font-medium ${
                  plugin.compatibility === 'compatible'
                    ? 'bg-success-soft text-success'
                    : plugin.compatibility === 'incompatible'
                      ? 'bg-danger/10 text-danger'
                      : 'bg-background-subtle text-subtle'
                }`}
              >
                {plugin.compatibility === 'compatible'
                  ? t('settings.pluginCompatible')
                  : plugin.compatibility === 'incompatible'
                    ? t('settings.pluginIncompatible')
                    : t('settings.pluginCompatibilityUnknown')}
              </span>
              <code
                className="min-w-0 flex-1 truncate font-mono text-caption text-muted"
                title={plugin.spec}
              >
                {plugin.spec}
              </code>
              <label className="flex flex-none items-center gap-1.5 text-caption text-muted">
                <input
                  type="checkbox"
                  aria-label={`${t('settings.pluginEnabled')}: ${plugin.name}`}
                  checked={plugin.enabled}
                  disabled={pendingId === plugin.id}
                  onChange={(event) => {
                    void toggle(plugin, event.target.checked)
                  }}
                  className="h-4 w-4 accent-accent"
                />
                {t('settings.pluginEnabled')}
              </label>
              <button
                type="button"
                disabled={pendingId === plugin.id}
                onClick={() => {
                  void remove(plugin)
                }}
                className="h-7 flex-none rounded-md px-2 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
              >
                {t('settings.pluginRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default PluginSettings
