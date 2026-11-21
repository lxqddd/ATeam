import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ModelCreateInput, ModelPublic, ModelUpdateInput, ProviderPublic } from '@ateam/shared'
import { modelErrorMessage } from './model-errors'

interface ModelFormProps {
  model?: ModelPublic
  providers: ProviderPublic[]
  inModal?: boolean
  defaultProviderId?: string
  onSubmit: (input: ModelCreateInput | ModelUpdateInput) => Promise<void>
  onCancel: () => void
}

interface ModelFormValues {
  providerId: string
  modelId: string
  name?: string
}

function ModelForm({
  model,
  providers,
  inModal = false,
  defaultProviderId,
  onSubmit,
  onCancel
}: ModelFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm<ModelFormValues>()
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    containerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  async function handleFinish(values: ModelFormValues): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (model) {
        await onSubmit({ id: model.id, name: values.name?.trim() || model.modelId })
      } else {
        await onSubmit({
          providerId: values.providerId,
          modelId: values.modelId,
          name: values.name?.trim() || undefined
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
      <div
        className={
          inModal
            ? 'settings-form'
            : 'settings-form rounded-lg border border-border-subtle bg-background-subtle p-3.5'
        }
      >
        <p className="m-0 text-label text-muted">{t('settings.providerRequired')}</p>
        {!inModal && (
          <div className="mt-3 flex justify-end">
            <Button onClick={onCancel}>{t('settings.cancel')}</Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={
        inModal
          ? 'settings-form'
          : 'settings-form rounded-lg border border-border-subtle bg-background-subtle p-3.5'
      }
    >
      <Form
        form={form}
        name="model"
        layout="vertical"
        initialValues={{
          providerId: model?.providerId ?? defaultProviderId ?? providers[0]?.id ?? '',
          modelId: model?.modelId ?? '',
          name: model?.name ?? ''
        }}
        onFinish={(values) => {
          void handleFinish(values)
        }}
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Form.Item name="providerId" label={t('settings.modelProvider')}>
            <Select
              disabled={Boolean(model)}
              options={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
            />
          </Form.Item>
          <Form.Item
            name="modelId"
            label={t('settings.modelId')}
            rules={[{ required: true, message: t('settings.modelIdRequired') }]}
          >
            <Input
              placeholder={t('settings.modelIdPlaceholder')}
              disabled={Boolean(model)}
              autoFocus={!model}
            />
          </Form.Item>
          <div className="sm:col-span-2">
            <Form.Item name="name" label={t('settings.modelName')}>
              <Input placeholder={t('settings.modelNamePlaceholder')} autoFocus={Boolean(model)} />
            </Form.Item>
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

export default ModelForm
