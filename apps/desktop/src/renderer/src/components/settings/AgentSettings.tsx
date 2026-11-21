import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig, AgentInfo } from '@ateam/shared'

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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.config
      .get()
      .then((next) => {
        if (!active) return
        setConfig(next)
        setInstructions(next.instructions.join('\n'))
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught))
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
  }, [])

  async function updateConfig(patch: Partial<AgentConfig>): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      setConfig(await window.api.agent.config.update(patch))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  async function saveInstructions(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const entries = instructions
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)
      const next = await window.api.agent.config.update({ instructions: entries })
      setConfig(next)
      setInstructions(next.instructions.join('\n'))
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
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
          <p className="m-0">
            {t('settings.availableLspServers')}: {list(info.lspServers)}
          </p>
          <p className="m-0">
            {t('settings.detectedFormatters')}: {list(info.formatters)}
          </p>
        </div>
      )}

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
            setSaved(false)
          }}
          rows={6}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
          placeholder={t('settings.instructionsPlaceholder')}
        />
        <p className="m-0 text-caption text-muted">{t('settings.instructionsDescription')}</p>
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-caption text-success">{t('settings.saved')}</span>}
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
