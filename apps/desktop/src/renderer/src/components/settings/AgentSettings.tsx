import { errorMessage } from '../../lib/errors'
import SettingsLoadError from './SettingsLoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig, AgentInfo } from '@ateam/shared'
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<'instructions' | 'overrides' | 'references' | null>(null)
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

      {info && (
        <div className="flex flex-col gap-1 text-caption text-muted">
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
