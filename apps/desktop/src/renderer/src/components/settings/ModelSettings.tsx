import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentInfo,
  ModelCreateInput,
  ModelPublic,
  ModelsConfigPublic,
  ModelTestResult,
  ModelUpdateInput,
  ProviderCreateInput,
  ProviderPublic,
  ProviderUpdateInput
} from '@ateam/shared'
import ModelForm from './ModelForm'
import { modelErrorMessage } from './model-errors'
import ProviderForm from './ProviderForm'
import { SettingsGroup } from './SettingsGroup'

interface TestState {
  running: boolean
  result?: ModelTestResult
}

interface ProviderFormState {
  provider?: ProviderPublic
}

interface ModelFormState {
  model?: ModelPublic
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ModelSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ModelsConfigPublic | null>(null)
  const [info, setInfo] = useState<AgentInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(null)
  const [modelForm, setModelForm] = useState<ModelFormState | null>(null)
  const [deletingProvider, setDeletingProvider] = useState<string | null>(null)
  const [deletingModel, setDeletingModel] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const [nextConfig, nextInfo] = await Promise.all([
        window.api.models.get(),
        window.api.agent.info()
      ])
      setConfig(nextConfig)
      setInfo(nextInfo)
    } catch (error) {
      setLoadError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function apply(operation: () => Promise<ModelsConfigPublic>): Promise<void> {
    setMutationError(null)
    const next = await operation()
    setConfig(next)
  }

  async function saveProvider(input: ProviderCreateInput | ProviderUpdateInput): Promise<void> {
    const editing = providerForm?.provider
    await apply(() =>
      editing
        ? window.api.models.updateProvider(input as ProviderUpdateInput)
        : window.api.models.addProvider(input as ProviderCreateInput)
    )
    setProviderForm(null)
  }

  async function saveModel(input: ModelCreateInput | ModelUpdateInput): Promise<void> {
    const editing = modelForm?.model
    await apply(() =>
      editing
        ? window.api.models.updateModel(input as ModelUpdateInput)
        : window.api.models.addModel(input as ModelCreateInput)
    )
    setModelForm(null)
  }

  async function removeProvider(id: string): Promise<void> {
    setBusyId(id)
    setMutationError(null)
    try {
      await apply(() => window.api.models.deleteProvider(id))
      setDeletingProvider(null)
      setProviderForm(null)
      setModelForm(null)
    } catch (error) {
      setMutationError(modelErrorMessage((key) => t(key), error))
    } finally {
      setBusyId(null)
    }
  }

  async function removeModel(id: string): Promise<void> {
    setBusyId(id)
    setMutationError(null)
    try {
      await apply(() => window.api.models.deleteModel(id))
      setDeletingModel(null)
      setModelForm(null)
    } catch (error) {
      setMutationError(modelErrorMessage((key) => t(key), error))
    } finally {
      setBusyId(null)
    }
  }

  async function changeDefault(value: string): Promise<void> {
    setMutationError(null)
    try {
      if (!value) {
        await apply(() => window.api.models.setDefault(null))
        return
      }
      const [providerId, modelId] = value.split('\u0000')
      await apply(() => window.api.models.setDefault({ providerId, modelId }))
    } catch (error) {
      setMutationError(modelErrorMessage((key) => t(key), error))
    }
  }

  async function testModel(model: ModelPublic): Promise<void> {
    setTests((current) => ({ ...current, [model.id]: { running: true } }))
    try {
      const result = await window.api.models.test(model.providerId, model.modelId)
      setTests((current) => ({ ...current, [model.id]: { running: false, result } }))
    } catch (error) {
      setTests((current) => ({
        ...current,
        [model.id]: { running: false, result: { ok: false, message: errorMessage(error) } }
      }))
    }
  }

  async function openWorkspace(): Promise<void> {
    try {
      await window.api.workspace.open()
    } catch (error) {
      setMutationError(errorMessage(error))
    }
  }

  if (!config) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised px-5 py-4">
        {loadError ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-label text-danger">
              {t('settings.loadFailed')} {loadError}
            </p>
            <button
              type="button"
              onClick={() => {
                void load()
              }}
              className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground hover:bg-accent-hover"
            >
              {t('chat.retry')}
            </button>
          </div>
        ) : (
          <p className="text-label text-muted">{t('settings.loading')}</p>
        )}
      </div>
    )
  }

  const defaultValue = config.defaultModel
    ? `${config.defaultModel.providerId}\u0000${config.defaultModel.modelId}`
    : ''
  const providerName = (providerId: string): string =>
    config.providers.find((provider) => provider.id === providerId)?.name ?? providerId

  const addButtonClass =
    'h-7 rounded-md border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50'
  const rowButtonClass =
    'h-7 rounded-md px-2 text-caption font-medium text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50'

  return (
    <div className="flex flex-col gap-5">
      {!config.encryptionAvailable && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
          {t('settings.encryptionUnavailable')}
        </div>
      )}

      {mutationError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
          {mutationError}
        </div>
      )}

      <SettingsGroup
        title={t('settings.defaultModel')}
        description={t('settings.defaultModelDescription')}
      >
        <select
          aria-label={t('settings.defaultModel')}
          value={defaultValue}
          onChange={(event) => {
            void changeDefault(event.target.value)
          }}
          disabled={config.models.length === 0}
          className="h-9 w-full max-w-md rounded-md border border-border bg-surface px-3 text-body text-foreground disabled:opacity-60"
        >
          <option value="">{t('settings.noDefaultModel')}</option>
          {config.providers.map((provider) => {
            const models = config.models.filter((model) => model.providerId === provider.id)
            if (models.length === 0) return null
            return (
              <optgroup key={provider.id} label={provider.name}>
                {models.map((model) => (
                  <option key={model.id} value={`${provider.id}\u0000${model.modelId}`}>
                    {model.name} ({model.modelId})
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.providers')}
        description={t('settings.providersDescription')}
        actions={
          <button
            type="button"
            className={addButtonClass}
            onClick={() => {
              setProviderForm({})
              setDeletingProvider(null)
            }}
          >
            + {t('settings.addProvider')}
          </button>
        }
      >
        {providerForm && (
          <ProviderForm
            provider={providerForm.provider}
            onSubmit={saveProvider}
            onCancel={() => setProviderForm(null)}
          />
        )}
        {config.providers.length === 0 ? (
          <p className="py-2 text-label text-muted">{t('settings.noProviders')}</p>
        ) : (
          <ul className="flex flex-col">
            {config.providers.map((provider) => (
              <li
                key={provider.id}
                className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-body font-medium text-foreground">
                      {provider.name}
                    </span>
                    <span className="rounded-full border border-border bg-background-subtle px-2 py-0.5 text-caption text-muted">
                      {t(`providerTypes.${provider.type}`)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
                    {provider.baseURL && (
                      <span className="max-w-[420px] truncate font-mono text-[11px]">
                        {provider.baseURL}
                      </span>
                    )}
                    <span>
                      {provider.hasApiKey ? t('settings.hasApiKey') : t('settings.noApiKey')}
                    </span>
                  </div>
                </div>
                <div className="flex flex-none items-center gap-1">
                  {deletingProvider === provider.id ? (
                    <>
                      <span className="text-caption text-danger">
                        {t('settings.confirmDeleteProvider')}
                      </span>
                      <button
                        type="button"
                        disabled={busyId === provider.id}
                        onClick={() => {
                          void removeProvider(provider.id)
                        }}
                        className="h-7 rounded-md bg-danger/10 px-2 text-caption font-medium text-danger hover:bg-danger/15 disabled:opacity-50"
                      >
                        {t('settings.delete')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingProvider(null)}
                        className={rowButtonClass}
                      >
                        {t('settings.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setProviderForm({ provider })
                          setDeletingProvider(null)
                        }}
                        className={rowButtonClass}
                      >
                        {t('settings.editProvider')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingProvider(provider.id)
                          setDeletingModel(null)
                        }}
                        className={rowButtonClass}
                      >
                        {t('settings.delete')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.modelsList')}
        description={t('settings.modelsListDescription')}
        actions={
          <button
            type="button"
            className={addButtonClass}
            onClick={() => {
              setModelForm({})
              setDeletingModel(null)
            }}
          >
            + {t('settings.addModel')}
          </button>
        }
      >
        {modelForm && (
          <ModelForm
            model={modelForm.model}
            providers={config.providers}
            onSubmit={saveModel}
            onCancel={() => setModelForm(null)}
          />
        )}
        {config.models.length === 0 ? (
          <p className="py-2 text-label text-muted">{t('settings.noModels')}</p>
        ) : (
          <ul className="flex flex-col">
            {config.models.map((model) => {
              const test = tests[model.id]
              return (
                <li
                  key={model.id}
                  className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body font-medium text-foreground">
                        {model.name}
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted">
                        {model.modelId}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-muted">
                      <span>{providerName(model.providerId)}</span>
                      {test && (
                        <span
                          className={
                            test.running
                              ? 'text-muted'
                              : test.result?.ok
                                ? 'text-success'
                                : 'text-danger'
                          }
                        >
                          {test.running
                            ? t('settings.testing')
                            : test.result?.ok
                              ? `${t('settings.testSuccess')}${
                                  test.result.latencyMs ? ` · ${test.result.latencyMs}ms` : ''
                                }`
                              : `${t('settings.testFailure')}: ${test.result?.message ?? ''}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    {deletingModel === model.id ? (
                      <>
                        <span className="text-caption text-danger">
                          {t('settings.confirmDeleteModel')}
                        </span>
                        <button
                          type="button"
                          disabled={busyId === model.id}
                          onClick={() => {
                            void removeModel(model.id)
                          }}
                          className="h-7 rounded-md bg-danger/10 px-2 text-caption font-medium text-danger hover:bg-danger/15 disabled:opacity-50"
                        >
                          {t('settings.delete')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingModel(null)}
                          className={rowButtonClass}
                        >
                          {t('settings.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={test?.running}
                          onClick={() => {
                            void testModel(model)
                          }}
                          className={rowButtonClass}
                        >
                          {test?.running ? t('settings.testing') : t('settings.test')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModelForm({ model })
                            setDeletingModel(null)
                          }}
                          className={rowButtonClass}
                        >
                          {t('settings.editModel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeletingModel(model.id)
                            setDeletingProvider(null)
                          }}
                          className={rowButtonClass}
                        >
                          {t('settings.deleteModel')}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.workspace')}
        description={t('settings.workspaceDescription')}
        actions={
          <button type="button" className={addButtonClass} onClick={() => void openWorkspace()}>
            {t('settings.openWorkspace')}
          </button>
        }
      >
        <code className="block truncate rounded-md border border-border-subtle bg-background-subtle px-3 py-2 font-mono text-[11px] text-muted">
          {info?.workspacePath ?? '—'}
        </code>
      </SettingsGroup>
    </div>
  )
}

export default ModelSettings
