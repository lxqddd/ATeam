import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  AvailableModel,
  ModelCatalogEntry,
  ProviderCreateInput,
  ProviderPublic,
  ProviderType,
  ProviderUpdateInput
} from '@ateam/shared'
import { modelErrorMessage } from './model-errors'

const PROVIDER_TYPES: ProviderType[] = ['anthropic', 'openai', 'google', 'openai-compatible']

interface ProviderFormProps {
  provider?: ProviderPublic
  inModal?: boolean
  onSubmit: (
    input: ProviderCreateInput | ProviderUpdateInput,
    selectedModels?: AvailableModel[]
  ) => Promise<void>
  onCancel: () => void
}

interface ProviderFormValues {
  name: string
  type: ProviderType
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
  authMode?: 'apiKey' | 'oauth'
  oauthAuthorizationEndpoint?: string
  oauthTokenEndpoint?: string
  oauthClientId?: string
  oauthScope?: string
  oauthRedirectUri?: string
  oauthClientSecret?: string
  clearOAuthClientSecret?: boolean
}

function ProviderForm({
  provider,
  inModal = false,
  onSubmit,
  onCancel
}: ProviderFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [available, setAvailable] = useState<AvailableModel[] | null>(null)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [catalogProviders, setCatalogProviders] = useState<
    Array<{
      id: string
      name: string
      api: string | null
      type: ProviderType | null
    }>
  >([])
  const [form] = Form.useForm<ProviderFormValues>()
  const type = Form.useWatch('type', form) ?? provider?.type ?? 'anthropic'
  const authMode = Form.useWatch('authMode', form) ?? provider?.authMode ?? 'apiKey'
  const supportsOAuth = type === 'openai' || type === 'openai-compatible'
  const apiKey = Form.useWatch('apiKey', form) ?? ''
  const baseURL = Form.useWatch('baseURL', form) ?? ''
  const requiresApiKey = type !== 'openai-compatible'

  useEffect(() => {
    if (!provider) return
    let active = true
    window.api.models
      .revealApiKey(provider.id)
      .then((key) => {
        if (!active || !key) return
        setLoadedKey(key)
        if (!form.getFieldValue('apiKey')) {
          form.setFieldValue('apiKey', key)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [provider, form])

  useEffect(() => {
    if (provider) return
    let active = true
    window.api.models
      .catalog()
      .then((entries: ModelCatalogEntry[]) => {
        if (!active) return
        const byId = new Map<
          string,
          { id: string; name: string; api: string | null; type: ProviderType | null }
        >()
        for (const entry of entries) {
          if (byId.has(entry.providerId)) continue
          byId.set(entry.providerId, {
            id: entry.providerId,
            name: entry.providerName,
            api: entry.providerApi,
            type: entry.providerType
          })
        }
        setCatalogProviders([...byId.values()])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [provider])

  function applyCatalog(providerId: string): void {
    const entry = catalogProviders.find((candidate) => candidate.id === providerId)
    if (!entry) return
    form.setFieldsValue({
      name: entry.name,
      type: entry.type ?? 'openai-compatible',
      baseURL: entry.api ?? ''
    })
  }

  async function fetchModels(): Promise<void> {
    setFetching(true)
    setFetchError(null)
    try {
      const models = await window.api.models.previewModels({
        providerId: provider?.id,
        type,
        baseURL: baseURL.trim() || undefined,
        apiKey: apiKey.trim() || undefined
      })
      setAvailable(models)
      setSelectedModels([])
    } catch (caught) {
      setFetchError(modelErrorMessage((key) => t(key), caught))
    } finally {
      setFetching(false)
    }
  }

  async function handleFinish(values: ProviderFormValues): Promise<void> {
    setSaving(true)
    setError(null)
    const models = available?.filter((model) => selectedModels.includes(model.id)) ?? []
    try {
      const mode = values.authMode ?? 'apiKey'
      const oauth =
        mode === 'oauth'
          ? {
              authorizationEndpoint: values.oauthAuthorizationEndpoint?.trim() ?? '',
              tokenEndpoint: values.oauthTokenEndpoint?.trim() ?? '',
              clientId: values.oauthClientId?.trim() ?? '',
              scope: values.oauthScope?.trim() || null,
              redirectUri: values.oauthRedirectUri?.trim() || null
            }
          : undefined
      if (provider) {
        const input: ProviderUpdateInput = {
          id: provider.id,
          name: values.name,
          type: values.type,
          baseURL: values.baseURL?.trim() ?? '',
          ...(mode === 'oauth' || provider.authMode === 'oauth' ? { authMode: mode } : {}),
          ...(mode === 'oauth'
            ? {
                oauth,
                oauthClientSecret: values.oauthClientSecret?.trim() || undefined,
                clearOAuthClientSecret: values.clearOAuthClientSecret ?? false
              }
            : {
                clearApiKey: values.clearApiKey ?? false,
                apiKey: values.apiKey?.trim() || undefined
              })
        }
        await onSubmit(input, models)
      } else {
        const input: ProviderCreateInput = {
          name: values.name,
          type: values.type,
          baseURL: values.baseURL?.trim() || undefined,
          ...(mode === 'oauth' ? { authMode: mode } : {}),
          ...(mode === 'oauth'
            ? { oauth, oauthClientSecret: values.oauthClientSecret?.trim() || undefined }
            : { apiKey: values.apiKey?.trim() || undefined })
        }
        await onSubmit(input, models)
      }
    } catch (caught) {
      setError(modelErrorMessage((key) => t(key), caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={
        inModal
          ? 'settings-form'
          : 'settings-form rounded-lg border border-border-subtle bg-background-subtle p-3.5'
      }
    >
      <Form
        form={form}
        name="provider"
        layout="vertical"
        initialValues={{
          name: provider?.name ?? '',
          type: provider?.type ?? 'anthropic',
          baseURL: provider?.baseURL ?? '',
          apiKey: '',
          clearApiKey: false,
          authMode: provider?.authMode ?? 'apiKey',
          oauthAuthorizationEndpoint: provider?.oauth?.authorizationEndpoint ?? '',
          oauthTokenEndpoint: provider?.oauth?.tokenEndpoint ?? '',
          oauthClientId: provider?.oauth?.clientId ?? '',
          oauthScope: provider?.oauth?.scope ?? '',
          oauthRedirectUri: provider?.oauth?.redirectUri ?? '',
          oauthClientSecret: '',
          clearOAuthClientSecret: false
        }}
        onValuesChange={(changed) => {
          if (changed.apiKey && changed.apiKey !== loadedKey) {
            form.setFieldValue('clearApiKey', false)
          }
        }}
        onFinish={(values) => {
          void handleFinish(values)
        }}
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          {!provider && (
            <div className="sm:col-span-2">
              <Form.Item
                label={t('settings.providerCatalog')}
                extra={t('settings.providerCatalogHint')}
              >
                <Select
                  aria-label={t('settings.providerCatalog')}
                  showSearch
                  allowClear
                  placeholder={t('settings.providerCatalogPlaceholder')}
                  options={catalogProviders.map((entry) => ({
                    value: entry.id,
                    label: entry.name,
                    title: entry.name
                  }))}
                  filterOption={(input, option) =>
                    String(option?.label ?? '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  onChange={(value: string | undefined) => {
                    if (value) applyCatalog(value)
                  }}
                />
              </Form.Item>
            </div>
          )}
          <Form.Item
            name="name"
            label={t('settings.providerName')}
            rules={[{ required: true, message: t('settings.nameRequired') }]}
          >
            <Input placeholder={t('settings.providerNamePlaceholder')} autoFocus />
          </Form.Item>
          <Form.Item name="type" label={t('settings.providerType')}>
            <Select
              aria-label={t('settings.providerType')}
              options={PROVIDER_TYPES.map((providerType) => ({
                value: providerType,
                label: t(`providerTypes.${providerType}`)
              }))}
            />
          </Form.Item>
          {supportsOAuth && (
            <Form.Item name="authMode" label={t('settings.providerAuthMode')}>
              <Select
                aria-label={t('settings.providerAuthMode')}
                options={[
                  { value: 'apiKey', label: t('settings.authModeApiKey') },
                  { value: 'oauth', label: t('settings.authModeOAuth') }
                ]}
              />
            </Form.Item>
          )}
          <div className="sm:col-span-2">
            <Form.Item
              name="baseURL"
              label={t('settings.baseURL')}
              rules={[
                ...(type === 'openai-compatible'
                  ? [{ required: true, message: t('settings.baseURLRequired') }]
                  : []),
                { type: 'url', message: t('settings.invalidBaseURL') }
              ]}
              extra={t('settings.baseURLHint')}
            >
              <Input placeholder={t('settings.baseURLPlaceholder')} />
            </Form.Item>
          </div>
          {authMode === 'apiKey' && (
            <div className="sm:col-span-2">
              <Form.Item
                name="apiKey"
                label={t('settings.apiKey')}
                rules={
                  !provider && type !== 'openai-compatible'
                    ? [{ required: true, message: t('settings.apiKeyRequired') }]
                    : []
                }
              >
                <Input.Password
                  placeholder={
                    provider?.hasApiKey
                      ? t('settings.apiKeyKeepPlaceholder')
                      : t('settings.apiKeyPlaceholder')
                  }
                  autoComplete="off"
                />
              </Form.Item>
              <div className="flex flex-wrap items-center gap-3 text-caption text-muted">
                {provider?.hasApiKey && <span>{t('settings.apiKeyStored')}</span>}
                {provider?.hasApiKey && (
                  <Form.Item name="clearApiKey" valuePropName="checked" noStyle>
                    <Checkbox
                      disabled={requiresApiKey || (Boolean(apiKey) && apiKey !== loadedKey)}
                    >
                      {t('settings.clearApiKey')}
                    </Checkbox>
                  </Form.Item>
                )}
                {type === 'openai-compatible' && <span>{t('settings.apiKeyOptional')}</span>}
              </div>
            </div>
          )}
          {authMode === 'oauth' && (
            <div className="sm:col-span-2 grid gap-x-3 sm:grid-cols-2">
              <Form.Item
                name="oauthAuthorizationEndpoint"
                label={t('settings.oauthAuthorizationEndpoint')}
                rules={[{ required: true, message: t('settings.oauthFieldRequired') }]}
              >
                <Input placeholder="https://provider.example.com/oauth/authorize" />
              </Form.Item>
              <Form.Item
                name="oauthTokenEndpoint"
                label={t('settings.oauthTokenEndpoint')}
                rules={[{ required: true, message: t('settings.oauthFieldRequired') }]}
              >
                <Input placeholder="https://provider.example.com/oauth/token" />
              </Form.Item>
              <Form.Item
                name="oauthClientId"
                label={t('settings.oauthClientId')}
                rules={[{ required: true, message: t('settings.oauthFieldRequired') }]}
              >
                <Input placeholder={t('settings.oauthClientId')} />
              </Form.Item>
              <Form.Item name="oauthScope" label={t('settings.oauthScope')}>
                <Input placeholder="models.read" />
              </Form.Item>
              <Form.Item name="oauthRedirectUri" label={t('settings.oauthRedirectUri')}>
                <Input placeholder="http://127.0.0.1:19877/provider/oauth/callback" />
              </Form.Item>
              <Form.Item name="oauthClientSecret" label={t('settings.oauthClientSecret')}>
                <Input.Password
                  autoComplete="off"
                  placeholder={
                    provider?.hasOAuthClientSecret
                      ? t('settings.apiKeyKeepPlaceholder')
                      : t('settings.oauthClientSecretPlaceholder')
                  }
                />
              </Form.Item>
              {provider?.hasOAuthClientSecret && (
                <Form.Item
                  name="clearOAuthClientSecret"
                  valuePropName="checked"
                  className="sm:col-span-2 mb-0"
                >
                  <Checkbox disabled={Boolean(form.getFieldValue('oauthClientSecret'))}>
                    {t('settings.clearOAuthClientSecret')}
                  </Checkbox>
                </Form.Item>
              )}
              <p className="sm:col-span-2 m-0 text-caption text-muted">
                {t('settings.oauthProviderHint')}
              </p>
            </div>
          )}
          <div className="sm:col-span-2 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  void fetchModels()
                }}
                loading={fetching}
                disabled={saving || (authMode === 'oauth' && !provider)}
              >
                {t('settings.fetchModels')}
              </Button>
              {fetchError && <span className="text-caption text-danger">{fetchError}</span>}
            </div>
            {available && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 text-caption text-muted">
                  <span>{t('settings.modelsFound', { count: available.length })}</span>
                  {available.length > 0 && (
                    <Checkbox
                      checked={selectedModels.length === available.length}
                      indeterminate={
                        selectedModels.length > 0 && selectedModels.length < available.length
                      }
                      onChange={(event) => {
                        setSelectedModels(
                          event.target.checked ? available.map((model) => model.id) : []
                        )
                      }}
                    >
                      {t('settings.selectAllModels')}
                    </Checkbox>
                  )}
                </div>
                {available.length === 0 ? (
                  <span className="text-caption text-subtle">{t('settings.noModelsFound')}</span>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border-subtle bg-surface p-2">
                    <Checkbox.Group
                      value={selectedModels}
                      onChange={(values) => setSelectedModels(values as string[])}
                      className="flex flex-col gap-1"
                    >
                      {available.map((model) => (
                        <Checkbox key={model.id} value={model.id} className="me-0!">
                          <span className="font-mono text-caption text-foreground">{model.id}</span>
                          {model.name && (
                            <span className="ms-2 text-caption text-muted">{model.name}</span>
                          )}
                        </Checkbox>
                      ))}
                    </Checkbox.Group>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3">
            <Alert type="error" showIcon title={error} />
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          {!inModal && (
            <Button onClick={onCancel} disabled={saving}>
              {t('settings.cancel')}
            </Button>
          )}
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('settings.save')}
          </Button>
        </div>
      </Form>
    </div>
  )
}

export default ProviderForm
