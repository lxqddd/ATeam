import { useState } from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ProviderCreateInput,
  ProviderPublic,
  ProviderType,
  ProviderUpdateInput
} from '@ateam/shared'
import { modelErrorMessage } from './model-errors'

const PROVIDER_TYPES: ProviderType[] = ['anthropic', 'openai', 'google', 'openai-compatible']

interface ProviderFormProps {
  provider?: ProviderPublic
  onSubmit: (input: ProviderCreateInput | ProviderUpdateInput) => Promise<void>
  onCancel: () => void
}

const inputClass =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-body text-foreground placeholder:text-subtle focus-visible:border-accent-strong'

function ProviderForm({ provider, onSubmit, onCancel }: ProviderFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const prefix = useId()
  const [name, setName] = useState(provider?.name ?? '')
  const [type, setType] = useState<ProviderType>(provider?.type ?? 'anthropic')
  const [baseURL, setBaseURL] = useState(provider?.baseURL ?? '')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (provider) {
        const input: ProviderUpdateInput = {
          id: provider.id,
          name,
          type,
          baseURL: baseURL.trim(),
          clearApiKey,
          apiKey: apiKey.trim() || undefined
        }
        await onSubmit(input)
      } else {
        const input: ProviderCreateInput = {
          name,
          type,
          baseURL: baseURL.trim() || undefined,
          apiKey: apiKey.trim() || undefined
        }
        await onSubmit(input)
      }
    } catch (caught) {
      setError(modelErrorMessage((key) => t(key), caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      className="mb-3 rounded-md border border-border-subtle bg-background-subtle p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-name`} className="text-label font-medium text-foreground">
            {t('settings.providerName')}
          </label>
          <input
            id={`${prefix}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('settings.providerNamePlaceholder')}
            className={inputClass}
            required
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-type`} className="text-label font-medium text-foreground">
            {t('settings.providerType')}
          </label>
          <select
            id={`${prefix}-type`}
            value={type}
            onChange={(event) => setType(event.target.value as ProviderType)}
            className={inputClass}
          >
            {PROVIDER_TYPES.map((providerType) => (
              <option key={providerType} value={providerType}>
                {t(`providerTypes.${providerType}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={`${prefix}-base-url`} className="text-label font-medium text-foreground">
            {t('settings.baseURL')}
          </label>
          <input
            id={`${prefix}-base-url`}
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
            placeholder={t('settings.baseURLPlaceholder')}
            className={inputClass}
            type="url"
            required={type === 'openai-compatible'}
          />
          <p className="text-caption text-muted">{t('settings.baseURLHint')}</p>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={`${prefix}-api-key`} className="text-label font-medium text-foreground">
            {t('settings.apiKey')}
          </label>
          <input
            id={`${prefix}-api-key`}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              if (event.target.value) setClearApiKey(false)
            }}
            placeholder={
              provider?.hasApiKey
                ? t('settings.apiKeyKeepPlaceholder')
                : t('settings.apiKeyPlaceholder')
            }
            className={inputClass}
            type="password"
            autoComplete="off"
            required={!provider && type !== 'openai-compatible'}
          />
          <div className="flex flex-wrap items-center gap-3 text-caption text-muted">
            {provider?.hasApiKey && <span>{t('settings.apiKeyStored')}</span>}
            {provider?.hasApiKey && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  disabled={Boolean(apiKey)}
                  onChange={(event) => setClearApiKey(event.target.checked)}
                />
                {t('settings.clearApiKey')}
              </label>
            )}
            {type === 'openai-compatible' && <span>{t('settings.apiKeyOptional')}</span>}
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-caption text-danger">{error}</p>}

      <div className="mt-3.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-md px-3 text-label font-medium text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
        >
          {t('settings.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  )
}

export default ProviderForm
