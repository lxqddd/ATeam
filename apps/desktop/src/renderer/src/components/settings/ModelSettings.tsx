import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Popconfirm, Select, Spin, Tag, Typography } from 'antd'
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
import { SettingsRow } from './SettingsRow'

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
      <SettingsGroup>
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
          <div className="flex items-center justify-center gap-2 py-4">
            <Spin size="small" />
            <Typography.Text type="secondary">{t('settings.loading')}</Typography.Text>
          </div>
        )}
      </SettingsGroup>
    )
  }

  const defaultValue = config.defaultModel
    ? `${config.defaultModel.providerId}\u0000${config.defaultModel.modelId}`
    : ''
  const providerName = (providerId: string): string =>
    config.providers.find((provider) => provider.id === providerId)?.name ?? providerId

  const defaultOptions = [
    { label: t('settings.noDefaultModel'), value: '' },
    ...config.providers
      .map((provider) => ({
        label: provider.name,
        options: config.models
          .filter((model) => model.providerId === provider.id)
          .map((model) => ({
            label: `${model.name} (${model.modelId})`,
            value: `${provider.id}\u0000${model.modelId}`
          }))
      }))
      .filter((group) => group.options.length > 0)
  ]

  return (
    <div className="flex flex-col gap-4">
      {!config.encryptionAvailable && (
        <Alert type="warning" showIcon title={t('settings.encryptionUnavailable')} />
      )}
      {mutationError && <Alert type="error" showIcon title={mutationError} />}

      <SettingsGroup>
        <SettingsRow
          title={t('settings.defaultModel')}
          description={t('settings.defaultModelDescription')}
        >
          <label htmlFor="default-model" className="sr-only">
            {t('settings.defaultModel')}
          </label>
          <Select
            id="default-model"
            value={defaultValue}
            onChange={(value) => {
              void changeDefault(value)
            }}
            options={defaultOptions}
            disabled={config.models.length === 0}
            className="w-[280px] max-w-full"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.providers')}
        description={t('settings.providersDescription')}
        actions={
          <Button
            size="small"
            onClick={() => {
              setProviderForm({})
            }}
          >
            + {t('settings.addProvider')}
          </Button>
        }
      >
        {providerForm && (
          <ProviderForm
            provider={providerForm.provider}
            onSubmit={saveProvider}
            onCancel={() => setProviderForm(null)}
          />
        )}
        <div role="list" className="settings-list flex flex-col">
          {config.providers.length === 0 ? (
            <p className="m-0 py-2 text-label text-muted">{t('settings.noProviders')}</p>
          ) : (
            config.providers.map((provider) => (
              <div
                key={provider.id}
                role="listitem"
                className="settings-list-row flex flex-wrap items-center gap-x-4 gap-y-2 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-label font-medium text-foreground">
                      {provider.name}
                    </span>
                    <Tag style={{ marginInlineEnd: 0 }}>{t(`providerTypes.${provider.type}`)}</Tag>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
                    {provider.baseURL && (
                      <span className="max-w-[420px] truncate font-mono">{provider.baseURL}</span>
                    )}
                    <span>
                      {provider.hasApiKey ? t('settings.hasApiKey') : t('settings.noApiKey')}
                    </span>
                  </div>
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
            ))
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.modelsList')}
        description={t('settings.modelsListDescription')}
        actions={
          <Button
            size="small"
            onClick={() => {
              setModelForm({})
            }}
          >
            + {t('settings.addModel')}
          </Button>
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
        <div role="list" className="settings-list flex flex-col">
          {config.models.length === 0 ? (
            <p className="m-0 py-2 text-label text-muted">{t('settings.noModels')}</p>
          ) : (
            config.models.map((model) => {
              const test = tests[model.id]
              return (
                <div
                  key={model.id}
                  role="listitem"
                  className="settings-list-row flex flex-wrap items-center gap-x-4 gap-y-2 py-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-label font-medium text-foreground">
                        {model.name}
                      </span>
                      <span className="truncate font-mono text-caption text-muted">
                        {model.modelId}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-caption text-muted">
                      <span>{providerName(model.providerId)}</span>
                      {test && (
                        <Tag
                          color={test.running ? 'default' : test.result?.ok ? 'success' : 'error'}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {test.running
                            ? t('settings.testing')
                            : test.result?.ok
                              ? `${t('settings.testSuccess')}${
                                  test.result.latencyMs ? ` · ${test.result.latencyMs}ms` : ''
                                }`
                              : `${t('settings.testFailure')}: ${test.result?.message ?? ''}`}
                        </Tag>
                      )}
                    </div>
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
                        setModelForm({ model })
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
            })
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          title={t('settings.workspace')}
          description={t('settings.workspaceDescription')}
        >
          <code className="max-w-[340px] truncate font-mono text-caption font-normal text-muted">
            {info?.workspacePath ?? '—'}
          </code>
          <Button size="small" onClick={() => void openWorkspace()}>
            {t('settings.openWorkspace')}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  )
}

export default ModelSettings
