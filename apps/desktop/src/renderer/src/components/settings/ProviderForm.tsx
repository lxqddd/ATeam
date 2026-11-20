import { useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd'
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

interface ProviderFormValues {
  name: string
  type: ProviderType
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
}

function ProviderForm({ provider, onSubmit, onCancel }: ProviderFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm<ProviderFormValues>()
  const type = Form.useWatch('type', form) ?? provider?.type ?? 'anthropic'
  const apiKey = Form.useWatch('apiKey', form) ?? ''

  async function handleFinish(values: ProviderFormValues): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (provider) {
        const input: ProviderUpdateInput = {
          id: provider.id,
          name: values.name,
          type: values.type,
          baseURL: values.baseURL?.trim() ?? '',
          clearApiKey: values.clearApiKey ?? false,
          apiKey: values.apiKey?.trim() || undefined
        }
        await onSubmit(input)
      } else {
        const input: ProviderCreateInput = {
          name: values.name,
          type: values.type,
          baseURL: values.baseURL?.trim() || undefined,
          apiKey: values.apiKey?.trim() || undefined
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
    <div className="settings-form rounded-lg border border-border-subtle bg-background-subtle p-3.5">
      <Form
        form={form}
        name="provider"
        layout="vertical"
        initialValues={{
          name: provider?.name ?? '',
          type: provider?.type ?? 'anthropic',
          baseURL: provider?.baseURL ?? '',
          apiKey: '',
          clearApiKey: false
        }}
        onValuesChange={(changed) => {
          if (changed.apiKey) form.setFieldValue('clearApiKey', false)
        }}
        onFinish={(values) => {
          void handleFinish(values)
        }}
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Form.Item
            name="name"
            label={t('settings.providerName')}
            rules={[{ required: true, message: t('settings.nameRequired') }]}
          >
            <Input placeholder={t('settings.providerNamePlaceholder')} autoFocus />
          </Form.Item>
          <Form.Item name="type" label={t('settings.providerType')}>
            <Select
              options={PROVIDER_TYPES.map((providerType) => ({
                value: providerType,
                label: t(`providerTypes.${providerType}`)
              }))}
            />
          </Form.Item>
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
                  <Checkbox disabled={Boolean(apiKey)}>{t('settings.clearApiKey')}</Checkbox>
                </Form.Item>
              )}
              {type === 'openai-compatible' && <span>{t('settings.apiKeyOptional')}</span>}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3">
            <Alert type="error" showIcon title={error} />
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button onClick={onCancel} disabled={saving}>
            {t('settings.cancel')}
          </Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('settings.save')}
          </Button>
        </div>
      </Form>
    </div>
  )
}

export default ProviderForm
