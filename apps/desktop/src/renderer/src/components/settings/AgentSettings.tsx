import { errorMessage } from '../../lib/errors'
import SettingsLoadError from './SettingsLoadError'
import ProjectConfigCard from './ProjectConfigCard'
import PluginSettings from './PluginSettings'
import PluginAuthSettings from './PluginAuthSettings'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_RETRY_CONFIG, type AgentConfig, type AgentInfo } from '@ateam/shared'
import { formatReferenceLines, parseReferenceLines } from './reference-lines'

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange
}: ToggleRowProps): React.JSX.Element {
  return (
    <label className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-label font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-caption text-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 flex-none accent-accent"
      />
    </label>
  )
}

function AgentSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [info, setInfo] = useState<AgentInfo | null>(null)
  const [instructions, setInstructions] = useState('')
  const [formatterOverrides, setFormatterOverrides] = useState('')
  const [referencesText, setReferencesText] = useState('')
  const [retryRetries, setRetryRetries] = useState('')
  const [retryDelaySeconds, setRetryDelaySeconds] = useState('')
  const [retryTimeoutSeconds, setRetryTimeoutSeconds] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<'instructions' | 'overrides' | 'references' | 'retry' | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    window.api.agent.config
      .get()
      .then((next) => {
        if (!active) return
        setConfig(next)
        setInstructions(next.instructions.join('\n'))
        setFormatterOverrides(
          Object.entries(next.formatterOverrides)
            .map(([extension, formatter]) => `${extension}=${formatter}`)
            .join('\n')
        )
        setReferencesText(formatReferenceLines(next.references ?? []))
        const retry = next.retry ?? DEFAULT_RETRY_CONFIG
        setRetryRetries(String(retry.maxRetries))
        setRetryDelaySeconds(String(Math.round(retry.maxDelayMs / 1_000)))
        setRetryTimeoutSeconds(String(Math.round(retry.timeoutMs / 1_000)))
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    window.api.agent
      .info()
      .then((next) => {
        if (active) setInfo(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [reloadKey])

  async function updateConfig(patch: Partial<AgentConfig>): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      setConfig(await window.api.agent.config.update(patch))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function saveInstructions(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const entries = instructions
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)
      const next = await window.api.agent.config.update({ instructions: entries })
      setConfig(next)
      setInstructions(next.instructions.join('\n'))
      setSaved('instructions')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function saveFormatterOverrides(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const overrides: Record<string, string> = {}
      for (const line of formatterOverrides.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const separator = trimmed.indexOf('=')
        if (separator <= 0) continue
        const extension = trimmed.slice(0, separator).trim()
        const formatter = trimmed.slice(separator + 1).trim()
        if (extension && formatter) overrides[extension] = formatter
      }
      const next = await window.api.agent.config.update({ formatterOverrides: overrides })
      setConfig(next)
      setFormatterOverrides(
        Object.entries(next.formatterOverrides)
          .map(([extension, formatter]) => `${extension}=${formatter}`)
          .join('\n')
      )
      setSaved('overrides')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function saveReferences(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const next = await window.api.agent.config.update({
        references: parseReferenceLines(referencesText)
      })
      setConfig(next)
      setReferencesText(formatReferenceLines(next.references ?? []))
      setSaved('references')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function saveRetry(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const maxRetries = Number.parseInt(retryRetries, 10)
      const maxDelaySeconds = Number.parseInt(retryDelaySeconds, 10)
      const timeoutSeconds = Number.parseInt(retryTimeoutSeconds, 10)
      if (
        !Number.isInteger(maxRetries) ||
        maxRetries < 0 ||
        maxRetries > 10 ||
        !Number.isInteger(maxDelaySeconds) ||
        maxDelaySeconds < 0 ||
        maxDelaySeconds > 600 ||
        !Number.isInteger(timeoutSeconds) ||
        timeoutSeconds < 0 ||
        timeoutSeconds > 3_600
      ) {
        throw new Error(t('settings.retryInvalid'))
      }
      const next = await window.api.agent.config.update({
        retry: {
          maxRetries,
          maxDelayMs: maxDelaySeconds * 1_000,
          timeoutMs: timeoutSeconds * 1_000
        }
      })
      setConfig(next)
      const retry = next.retry ?? DEFAULT_RETRY_CONFIG
      setRetryRetries(String(retry.maxRetries))
      setRetryDelaySeconds(String(Math.round(retry.maxDelayMs / 1_000)))
      setRetryTimeoutSeconds(String(Math.round(retry.timeoutMs / 1_000)))
      setSaved('retry')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  const policy = info?.policy
  const policyEffectLabels: Record<string, string> = {
    allow: t('settings.permissionEffectAllow'),
    ask: t('settings.permissionEffectAsk'),
    deny: t('settings.permissionEffectDeny')
  }

  if (!config) {
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

  const list = (values: string[]): string =>
    values.length > 0 ? values.join(', ') : t('settings.noneDetected')

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      <ProjectConfigCard defaultDirectory={info?.workspacePath} />
      <PluginSettings defaultDirectory={info?.workspacePath} />
      <PluginAuthSettings defaultDirectory={info?.workspacePath} />

      <ToggleRow
        label={t('settings.snapshots')}
        description={t('settings.snapshotsDescription')}
        checked={config.snapshots}
        disabled={saving}
        onChange={(checked) => {
          void updateConfig({ snapshots: checked })
        }}
      />

      <ToggleRow
        label={t('settings.lsp')}
        description={t('settings.lspDescription')}
        checked={config.lsp}
        disabled={saving}
        onChange={(checked) => {
          void updateConfig({ lsp: checked })
        }}
      />

      <ToggleRow
        label={t('settings.formatters')}
        description={t('settings.formattersDescription')}
        checked={config.formatters}
        disabled={saving}
        onChange={(checked) => {
          void updateConfig({ formatters: checked })
        }}
      />

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-3">
        <div>
          <p className="m-0 text-label font-medium text-foreground">
            {t('settings.retrySettings')}
          </p>
          <p className="m-0 mt-0.5 text-caption text-muted">
            {t('settings.retrySettingsDescription')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-caption text-muted">
            <span>{t('settings.retryMaxRetries')}</span>
            <input
              type="number"
              min={0}
              max={10}
              aria-label={t('settings.retryMaxRetries')}
              value={retryRetries}
              disabled={saving}
              onChange={(event) => {
                setRetryRetries(event.target.value)
                setSaved(null)
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none focus:border-border-strong"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            <span>{t('settings.retryMaxDelay')}</span>
            <input
              type="number"
              min={0}
              max={600}
              aria-label={t('settings.retryMaxDelay')}
              value={retryDelaySeconds}
              disabled={saving}
              onChange={(event) => {
                setRetryDelaySeconds(event.target.value)
                setSaved(null)
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none focus:border-border-strong"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            <span>{t('settings.retryTimeout')}</span>
            <input
              type="number"
              min={0}
              max={3_600}
              aria-label={t('settings.retryTimeout')}
              value={retryTimeoutSeconds}
              disabled={saving}
              onChange={(event) => {
                setRetryTimeoutSeconds(event.target.value)
                setSaved(null)
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none focus:border-border-strong"
            />
          </label>
        </div>
        <p className="m-0 text-caption text-subtle">{t('settings.retryTimeoutHint')}</p>
        <div className="flex items-center justify-end gap-2">
          {saved === 'retry' && (
            <span className="text-caption text-success">{t('settings.saved')}</span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void saveRetry()
            }}
            className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {saving ? t('settings.saving') : t('settings.saveRetry')}
          </button>
        </div>
      </div>

      {info && (
        <div className="flex flex-col gap-1 text-caption text-muted">
          {info.retryMetrics && (
            <div className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2">
              <p className="m-0 text-label font-medium text-foreground">
                {t('settings.retryMetrics')}
              </p>
              {info.retryMetrics.retries === 0 ? (
                <p className="m-0 mt-0.5 text-caption text-subtle">
                  {t('settings.retryMetricsEmpty')}
                </p>
              ) : (
                <>
                  <p className="m-0 mt-0.5 text-caption text-muted">
                    {t('settings.retryMetricsSummary', {
                      retries: info.retryMetrics.retries,
                      rate:
                        info.retryMetrics.successRate === null
                          ? '—'
                          : Math.round(info.retryMetrics.successRate * 100),
                      seconds: (info.retryMetrics.averageDelayMs / 1_000).toFixed(1)
                    })}
                  </p>
                  {info.retryMetrics.lastReason && (
                    <p
                      className="m-0 mt-0.5 truncate font-mono text-caption text-subtle"
                      title={info.retryMetrics.lastReason}
                    >
                      {t('settings.retryMetricsLastReason', {
                        reason: info.retryMetrics.lastReason
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {info.cacheMetrics && (
            <div className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2">
              <p className="m-0 text-label font-medium text-foreground">
                {t('settings.cacheMetrics')}
              </p>
              {info.cacheMetrics.requests === 0 ? (
                <p className="m-0 mt-0.5 text-caption text-subtle">
                  {t('settings.cacheMetricsEmpty')}
                </p>
              ) : (
                <p className="m-0 mt-0.5 text-caption text-muted">
                  {t('settings.cacheMetricsSummary', {
                    requests: info.cacheMetrics.requests,
                    rate:
                      info.cacheMetrics.hitRate === null
                        ? '—'
                        : Math.round(info.cacheMetrics.hitRate * 100),
                    read: info.cacheMetrics.cacheReadTokens,
                    write: info.cacheMetrics.cacheWriteTokens
                  })}
                </p>
              )}
            </div>
          )}
          <div className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2">
            <p className="m-0 text-label font-medium text-foreground">{t('settings.orgPolicy')}</p>
            {policy?.path ? (
              <>
                <p className="m-0 mt-0.5 break-all font-mono text-caption text-muted">
                  {policy.path}
                </p>
                {policy.error && <p className="m-0 text-caption text-danger">{policy.error}</p>}
                {policy.rules.length === 0 ? (
                  <p className="m-0 text-caption text-subtle">{t('settings.noPolicyRules')}</p>
                ) : (
                  <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                    {policy.rules.map((rule, index) => (
                      <li key={index} className="font-mono text-caption text-muted">
                        {rule.action} · {rule.resource} · {policyEffectLabels[rule.effect]}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="m-0 text-caption text-muted">{t('settings.noOrgPolicy')}</p>
            )}
          </div>
          <p className="m-0">
            {t('settings.availableLspServers')}: {list(info.lspServers)}
          </p>
          <p className="m-0">
            {t('settings.detectedFormatters')}: {list(info.formatters)}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="formatter-overrides" className="text-label font-medium text-foreground">
          {t('settings.formatterOverrides')}
        </label>
        <textarea
          id="formatter-overrides"
          aria-label={t('settings.formatterOverrides')}
          value={formatterOverrides}
          onChange={(event) => {
            setFormatterOverrides(event.target.value)
            setSaved(null)
          }}
          rows={3}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
          placeholder={t('settings.formatterOverridesPlaceholder')}
        />
        <p className="m-0 text-caption text-muted">{t('settings.formatterOverridesDescription')}</p>
        <div className="flex items-center justify-end gap-2">
          {saved === 'overrides' && (
            <span className="text-caption text-success">{t('settings.saved')}</span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void saveFormatterOverrides()
            }}
            className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {saving ? t('settings.saving') : t('settings.saveOverrides')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="agent-references" className="text-label font-medium text-foreground">
          {t('settings.references')}
        </label>
        <textarea
          id="agent-references"
          aria-label={t('settings.references')}
          value={referencesText}
          onChange={(event) => {
            setReferencesText(event.target.value)
            setSaved(null)
          }}
          rows={3}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
          placeholder={t('settings.referencesPlaceholder')}
        />
        <p className="m-0 text-caption text-muted">{t('settings.referencesDescription')}</p>
        <div className="flex items-center justify-end gap-2">
          {saved === 'references' && (
            <span className="text-caption text-success">{t('settings.saved')}</span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void saveReferences()
            }}
            className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {saving ? t('settings.saving') : t('settings.saveReferences')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="agent-instructions" className="text-label font-medium text-foreground">
          {t('settings.instructions')}
        </label>
        <textarea
          id="agent-instructions"
          aria-label={t('settings.instructions')}
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value)
            setSaved(null)
          }}
          rows={6}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
          placeholder={t('settings.instructionsPlaceholder')}
        />
        <p className="m-0 text-caption text-muted">{t('settings.instructionsDescription')}</p>
        <div className="flex items-center justify-end gap-2">
          {saved === 'instructions' && (
            <span className="text-caption text-success">{t('settings.saved')}</span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void saveInstructions()
            }}
            className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {saving ? t('settings.saving') : t('settings.saveInstructions')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AgentSettings
