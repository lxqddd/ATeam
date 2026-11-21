import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Modal, Popconfirm, Radio, Spin, Tag } from 'antd'
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
import ModelForm from '../components/settings/ModelForm'
import { modelErrorMessage } from '../components/settings/model-errors'
import ProviderForm from '../components/settings/ProviderForm'

interface TestState {
  running: boolean
  result?: ModelTestResult
}

interface ProviderFormState {
  provider?: ProviderPublic
}

interface ModelFormState {
  providerId: string
  model?: ModelPublic
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function providerInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" />
    </svg>
  )
}

function Chip({
  tone,
  children
}: {
  tone: 'neutral' | 'success' | 'warning'
  children: React.ReactNode
}): React.JSX.Element {
  const toneClass = {
    neutral: 'bg-neutral-soft text-neutral',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning'
  }[tone]

  return (
    <span
      className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[12px] leading-none font-medium ${toneClass}`}
    >
      {children}
    </span>
  )
}

function ModelsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ModelsConfigPublic | null>(null)
  const [info, setInfo] = useState<AgentInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(null)
  const [modelForm, setModelForm] = useState<ModelFormState | null>(null)
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
      setModelForm(null)
    } catch (error) {
      setMutationError(modelErrorMessage((key) => t(key), error))
    } finally {
      setBusyId(null)
    }
  }

  async function setDefaultModel(providerId: string, modelId: string): Promise<void> {
    setMutationError(null)
    try {
      await apply(() => window.api.models.setDefault({ providerId, modelId }))
    } catch (error) {
      setMutationError(modelErrorMessage((key) => t(key), error))
    }
  }

  async function clearDefault(): Promise<void> {
    setMutationError(null)
    try {
      await apply(() => window.api.models.setDefault(null))
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
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        {loadError ? (
          <Alert
            type="error"
            showIcon
            title={`${t('settings.loadFailed')} ${loadError}`}
            action={
              <Button
                size="small"
                onClick={() => {
                  void load()
                }}
              >
                {t('chat.retry')}
              </Button>
            }
          />
        ) : (
          <div className="flex items-center gap-2">
            <Spin size="small" />
            <span className="text-label text-muted">{t('settings.loading')}</span>
          </div>
        )}
      </div>
    )
  }

  const isDefaultModel = (model: ModelPublic): boolean =>
    config.defaultModel?.providerId === model.providerId &&
    config.defaultModel.modelId === model.modelId

  const providerHasDefault = (provider: ProviderPublic): boolean =>
    config.defaultModel?.providerId === provider.id &&
    config.models.some(
      (model) => model.providerId === provider.id && model.modelId === config.defaultModel?.modelId
    )

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto" data-testid="models-page">
      <div className="mx-auto w-full max-w-[1100px] px-8 py-7">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-display font-semibold tracking-[-0.01em] text-foreground">
              {t('settings.models')}
            </h1>
            <p className="mt-1.5 text-label text-muted">{t('settings.modelsDescription')}</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            {config.defaultModel && (
              <Button
                type="text"
                size="small"
                onClick={() => {
                  void clearDefault()
                }}
              >
                {t('modelsPage.clearDefault')}
              </Button>
            )}
            <button
              type="button"
              onClick={() => {
                setProviderForm({})
              }}
              title={t('settings.addProvider')}
              aria-label={t('settings.addProvider')}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[var(--shadow-sm),var(--highlight-inset)] transition-colors hover:bg-accent-hover"
            >
              <PlusIcon />
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-4">
          {!config.encryptionAvailable && (
            <Alert type="warning" showIcon title={t('settings.encryptionUnavailable')} />
          )}
          {mutationError && <Alert type="error" showIcon title={mutationError} />}

          {config.providers.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border px-6 py-10 text-center">
              <p className="m-0 text-label text-muted">{t('settings.noProviders')}</p>
              <Button
                type="primary"
                className="mt-4"
                onClick={() => {
                  setProviderForm({})
                }}
              >
                {t('settings.addProvider')}
              </Button>
            </div>
          ) : (
            config.providers.map((provider) => {
              const providerModels = config.models.filter(
                (model) => model.providerId === provider.id
              )
              return (
                <section
                  key={provider.id}
                  aria-label={provider.name}
                  className="rounded-[10px] border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow-sm)]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-border bg-background-subtle text-[15px] font-semibold text-foreground">
                      {providerInitial(provider.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="m-0 truncate text-subtitle font-semibold text-foreground">
                          {provider.name}
                        </h2>
                        <Chip tone="neutral">{t(`providerTypes.${provider.type}`)}</Chip>
                        <Chip tone={provider.hasApiKey ? 'success' : 'warning'}>
                          {provider.hasApiKey ? t('settings.hasApiKey') : t('settings.noApiKey')}
                        </Chip>
                        {providerHasDefault(provider) && (
                          <Chip tone="success">{t('modelsPage.defaultChip')}</Chip>
                        )}
                      </div>
                      <p
                        className={`m-0 mt-0.5 truncate font-mono text-caption ${
                          provider.baseURL ? 'text-accent-strong' : 'text-muted'
                        }`}
                        title={provider.baseURL}
                      >
                        {provider.baseURL ?? t('modelsPage.defaultEndpoint')}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-none items-center gap-1">
                      <Button
                        type="text"
                        size="small"
                        onClick={() => {
                          setProviderForm({ provider })
                        }}
                      >
                        {t('settings.editProvider')}
                      </Button>
                      <Popconfirm
                        title={t('settings.confirmDeleteProvider')}
                        onConfirm={() => removeProvider(provider.id)}
                        okButtonProps={{ loading: busyId === provider.id }}
                      >
                        <Button type="text" size="small" danger>
                          {t('settings.delete')}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>

                  <div className="mt-3">
                    {providerModels.length === 0 ? (
                      <p className="m-0 py-2 text-caption text-muted">{t('settings.noModels')}</p>
                    ) : (
                      <div className="divide-y divide-border-subtle">
                        {providerModels.map((model) => {
                          const test = tests[model.id]
                          const isDefault = isDefaultModel(model)
                          return (
                            <div
                              key={model.id}
                              role="group"
                              aria-label={model.name}
                              className="flex flex-wrap items-center gap-2 py-2"
                            >
                              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                <Radio
                                  checked={isDefault}
                                  aria-label={model.name}
                                  onChange={() => {
                                    void setDefaultModel(model.providerId, model.modelId)
                                  }}
                                />
                                <span className="truncate text-label font-medium text-foreground">
                                  {model.name}
                                </span>
                                <span className="max-w-[320px] truncate font-mono text-caption text-muted">
                                  {model.modelId}
                                </span>
                                {isDefault && (
                                  <Chip tone="success">{t('modelsPage.defaultChip')}</Chip>
                                )}
                                {test && (
                                  <Tag
                                    variant="outlined"
                                    color={
                                      test.running
                                        ? 'default'
                                        : test.result?.ok
                                          ? 'success'
                                          : 'error'
                                    }
                                    style={{ marginInlineEnd: 0 }}
                                  >
                                    {test.running
                                      ? t('settings.testing')
                                      : test.result?.ok
                                        ? `${t('settings.testSuccess')}${
                                            test.result.latencyMs
                                              ? ` · ${test.result.latencyMs}ms`
                                              : ''
                                          }`
                                        : `${t('settings.testFailure')}: ${test.result?.message ?? ''}`}
                                  </Tag>
                                )}
                              </div>
                              <div className="ml-auto flex flex-none items-center gap-1">
                                <Button
                                  type="text"
                                  size="small"
                                  loading={test?.running}
                                  onClick={() => {
                                    void testModel(model)
                                  }}
                                >
                                  {test?.running ? t('settings.testing') : t('settings.test')}
                                </Button>
                                <Button
                                  type="text"
                                  size="small"
                                  onClick={() => {
                                    setModelForm({ providerId: model.providerId, model })
                                  }}
                                >
                                  {t('settings.editModel')}
                                </Button>
                                <Popconfirm
                                  title={t('settings.confirmDeleteModel')}
                                  onConfirm={() => removeModel(model.id)}
                                  okButtonProps={{ loading: busyId === model.id }}
                                >
                                  <Button type="text" size="small" danger>
                                    {t('settings.deleteModel')}
                                  </Button>
                                </Popconfirm>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <Button
                      type="dashed"
                      size="small"
                      className="mt-2"
                      onClick={() => {
                        setModelForm({ providerId: provider.id })
                      }}
                    >
                      + {t('settings.addModel')}
                    </Button>
                  </div>
                </section>
              )
            })
          )}

          <section
            aria-label={t('settings.workspace')}
            className="rounded-[10px] border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow-sm)]"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-border bg-background-subtle text-muted">
                <FolderIcon />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-subtitle font-semibold text-foreground">
                  {t('settings.workspace')}
                </h2>
                <p className="m-0 mt-0.5 text-caption text-muted">
                  {t('settings.workspaceDescription')}
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <code className="max-w-[300px] truncate font-mono text-caption font-normal text-muted">
                  {info?.workspacePath ?? '—'}
                </code>
                <Button size="small" onClick={() => void openWorkspace()}>
                  {t('settings.openWorkspace')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={providerForm !== null}
        title={providerForm?.provider ? t('settings.editProvider') : t('settings.addProvider')}
        footer={null}
        destroyOnHidden
        onCancel={() => setProviderForm(null)}
      >
        {providerForm && (
          <ProviderForm
            provider={providerForm.provider}
            inModal
            onSubmit={saveProvider}
            onCancel={() => setProviderForm(null)}
          />
        )}
      </Modal>

      <Modal
        open={modelForm !== null}
        title={modelForm?.model ? t('settings.editModel') : t('settings.addModel')}
        footer={null}
        destroyOnHidden
        onCancel={() => setModelForm(null)}
      >
        {modelForm && (
          <ModelForm
            model={modelForm.model}
            providers={config.providers}
            inModal
            defaultProviderId={modelForm.providerId}
            onSubmit={saveModel}
            onCancel={() => setModelForm(null)}
          />
        )}
      </Modal>
    </div>
  )
}

export default ModelsPage
