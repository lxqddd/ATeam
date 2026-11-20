import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelCreateInput, ModelPublic, ModelUpdateInput, ProviderPublic } from '@ateam/shared'
import { modelErrorMessage } from './model-errors'

interface ModelFormProps {
  model?: ModelPublic
  providers: ProviderPublic[]
  onSubmit: (input: ModelCreateInput | ModelUpdateInput) => Promise<void>
  onCancel: () => void
}

const inputClass =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-body text-foreground placeholder:text-subtle focus-visible:border-accent-strong'

function ModelForm({ model, providers, onSubmit, onCancel }: ModelFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const prefix = useId()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [providerId, setProviderId] = useState(model?.providerId ?? providers[0]?.id ?? '')
  const [modelId, setModelId] = useState(model?.modelId ?? '')
  const [name, setName] = useState(model?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (model) {
        await onSubmit({ id: model.id, name: name.trim() || model.modelId })
      } else {
        await onSubmit({
          providerId,
          modelId,
          name: name.trim() || undefined
        })
      }
    } catch (caught) {
      setError(modelErrorMessage((key) => t(key), caught))
    } finally {
      setSaving(false)
    }
  }

  if (providers.length === 0) {
    return (
      <div className="mb-3 rounded-md border border-border-subtle bg-background-subtle p-3.5">
        <p className="text-label text-muted">{t('settings.providerRequired')}</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md px-3 text-label font-medium text-muted transition-colors hover:bg-hover hover:text-foreground"
          >
            {t('settings.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      className="mb-3 rounded-md border border-border-subtle bg-background-subtle p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-provider`} className="text-label font-medium text-foreground">
            {t('settings.modelProvider')}
          </label>
          <select
            id={`${prefix}-provider`}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className={inputClass}
            disabled={Boolean(model)}
            required
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-model-id`} className="text-label font-medium text-foreground">
            {t('settings.modelId')}
          </label>
          <input
            id={`${prefix}-model-id`}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder={t('settings.modelIdPlaceholder')}
            className={inputClass}
            required
            disabled={Boolean(model)}
            autoFocus={!model}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label
            htmlFor={`${prefix}-model-name`}
            className="text-label font-medium text-foreground"
          >
            {t('settings.modelName')}
          </label>
          <input
            id={`${prefix}-model-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('settings.modelNamePlaceholder')}
            className={inputClass}
            autoFocus={Boolean(model)}
          />
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

export default ModelForm
