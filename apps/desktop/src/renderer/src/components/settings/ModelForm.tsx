import { useEffect, useRef, useState } from 'react'
import { Alert, AutoComplete, Button, Checkbox, Form, Input, InputNumber, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  AvailableModel,
  ModelCatalogEntry,
  ModelCreateInput,
  ModelPublic,
  ModelUpdateInput,
  ModelVariantInput,
  ProviderPublic,
  VariantReasoningEffort
} from '@ateam/shared'
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
  contextWindow?: number | null
  maxOutputTokens?: number | null
  reasoning?: boolean
  attachment?: boolean
  costInput?: number | null
  costOutput?: number | null
  costCacheRead?: number | null
  costCacheWrite?: number | null
  applyPatch?: boolean
  compaction?: boolean
  variants?: Array<{
    name?: string
    reasoningEffort?: VariantReasoningEffort | null
    temperature?: number | null
    maxOutputTokens?: number | null
  }>
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
  const [available, setAvailable] = useState<AvailableModel[]>([])
  const [modelsError, setModelsError] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([])
  const [form] = Form.useForm<ModelFormValues>()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const providerId = Form.useWatch('providerId', form)

  useEffect(() => {
    containerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (model || !providerId) return
    let active = true
    window.api.models
      .listModels(providerId)
      .then((models) => {
        if (!active) return
        setAvailable(models)
        setModelsError(false)
      })
      .catch(() => {
        if (!active) return
        setAvailable([])
        setModelsError(true)
      })
    return () => {
      active = false
    }
  }, [model, providerId])

  useEffect(() => {
    if (model) return
    let active = true
    window.api.models
      .catalog()
      .then((entries) => {
        if (active) setCatalog(entries)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [model])

  function variantInputs(values: ModelFormValues): ModelVariantInput[] {
    return (values.variants ?? [])
      .filter((variant) => variant.name?.trim())
      .map((variant) => ({
        name: (variant.name ?? '').trim(),
        settings: {
          ...(variant.reasoningEffort ? { reasoningEffort: variant.reasoningEffort } : {}),
          ...(variant.temperature != null ? { temperature: variant.temperature } : {}),
          ...(variant.maxOutputTokens != null ? { maxOutputTokens: variant.maxOutputTokens } : {})
        }
      }))
  }

  async function handleFinish(values: ModelFormValues): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (model) {
        await onSubmit({
          id: model.id,
          name: values.name?.trim() || model.modelId,
          contextWindow: values.contextWindow ?? null,
          maxOutputTokens: values.maxOutputTokens ?? null,
          reasoning: values.reasoning ?? false,
          attachment: values.attachment ?? false,
          costInput: values.costInput ?? null,
          costOutput: values.costOutput ?? null,
          costCacheRead: values.costCacheRead ?? null,
          costCacheWrite: values.costCacheWrite ?? null,
          applyPatch: values.applyPatch ?? false,
          compaction: values.compaction ?? false,
          variants: variantInputs(values)
        })
      } else {
        const input: ModelCreateInput = {
          providerId: values.providerId,
          modelId: values.modelId,
          name: values.name?.trim() || undefined,
          contextWindow: values.contextWindow ?? undefined
        }
        if (values.maxOutputTokens != null) input.maxOutputTokens = values.maxOutputTokens
        if (values.reasoning) input.reasoning = true
        if (values.attachment) input.attachment = true
        if (values.costInput != null) input.costInput = values.costInput
        if (values.costOutput != null) input.costOutput = values.costOutput
        if (values.costCacheRead != null) input.costCacheRead = values.costCacheRead
        if (values.costCacheWrite != null) input.costCacheWrite = values.costCacheWrite
        if (values.applyPatch) input.applyPatch = true
        if (values.compaction) input.compaction = true
        const variants = variantInputs(values)
        if (variants.length > 0) input.variants = variants
        await onSubmit(input)
      }
    } catch (caught) {
      setError(modelErrorMessage((key) => t(key), caught))
    } finally {
      setSaving(false)
    }
  }

  function applyCatalog(value: string): void {
    const entry = catalog.find(
      (candidate) => `${candidate.providerId}:${candidate.modelId}` === value
    )
    if (!entry) return
    form.setFieldsValue({
      modelId: entry.modelId,
      name: entry.name,
      contextWindow: entry.contextWindow ?? undefined,
      maxOutputTokens: entry.maxOutputTokens ?? undefined,
      reasoning: entry.reasoning,
      attachment: entry.attachment,
      costInput: entry.costInput ?? undefined,
      costOutput: entry.costOutput ?? undefined,
      costCacheRead: entry.costCacheRead ?? undefined,
      costCacheWrite: entry.costCacheWrite ?? undefined
    })
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
          name: model?.name ?? '',
          contextWindow: model?.contextWindow,
          maxOutputTokens: model?.maxOutputTokens,
          reasoning: model?.reasoning ?? false,
          attachment: model?.attachment ?? false,
          costInput: model?.costInput,
          costOutput: model?.costOutput,
          costCacheRead: model?.costCacheRead,
          costCacheWrite: model?.costCacheWrite,
          applyPatch: model?.applyPatch ?? false,
          compaction: model?.compaction ?? false,
          variants: (model?.variants ?? []).map((variant) => ({
            name: variant.name,
            reasoningEffort: variant.settings.reasoningEffort ?? null,
            temperature: variant.settings.temperature ?? null,
            maxOutputTokens: variant.settings.maxOutputTokens ?? null
          }))
        }}
        onFinish={(values) => {
          void handleFinish(values)
        }}
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          {!model && (
            <div className="sm:col-span-2">
              <Form.Item label={t('settings.catalog')} extra={t('settings.catalogHint')}>
                <Select
                  aria-label={t('settings.catalog')}
                  showSearch
                  allowClear
                  placeholder={t('settings.catalogPlaceholder')}
                  options={catalog.map((entry) => ({
                    value: `${entry.providerId}:${entry.modelId}`,
                    label: `${entry.providerName} · ${entry.name}`,
                    title: `${entry.providerName} · ${entry.name}`
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
            extra={modelsError ? t('settings.modelListUnavailable') : undefined}
          >
            <AutoComplete
              options={available.map((entry) => ({
                value: entry.id,
                label: entry.name ? `${entry.id} · ${entry.name}` : entry.id
              }))}
              placeholder={t('settings.modelIdPlaceholder')}
              disabled={Boolean(model)}
              autoFocus={!model}
              filterOption={(input, option) =>
                String(option?.value ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              onSelect={(value: string) => {
                const found = available.find((entry) => entry.id === value)
                if (found?.name && !form.getFieldValue('name')) {
                  form.setFieldValue('name', found.name)
                }
              }}
            />
          </Form.Item>
          <div className="sm:col-span-2">
            <Form.Item name="name" label={t('settings.modelName')}>
              <Input placeholder={t('settings.modelNamePlaceholder')} autoFocus={Boolean(model)} />
            </Form.Item>
          </div>
          <div className="sm:col-span-2">
            <Form.Item
              name="contextWindow"
              label={t('settings.contextWindow')}
              extra={t('settings.contextWindowHint')}
            >
              <InputNumber
                min={1_000}
                max={10_000_000}
                step={1_000}
                style={{ width: '100%' }}
                placeholder={t('settings.contextWindowPlaceholder')}
              />
            </Form.Item>
          </div>
          <div className="sm:col-span-2">
            <Form.Item name="maxOutputTokens" label={t('settings.maxOutputTokens')}>
              <InputNumber min={1} max={1_000_000} step={1_000} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="reasoning" label={t('settings.modelReasoning')} valuePropName="checked">
            <Checkbox />
          </Form.Item>
          <Form.Item
            name="attachment"
            label={t('settings.modelAttachment')}
            valuePropName="checked"
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            name="applyPatch"
            label={t('settings.modelApplyPatch')}
            valuePropName="checked"
            extra={t('settings.modelApplyPatchHint')}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item
            name="compaction"
            label={t('settings.modelCompaction')}
            valuePropName="checked"
            extra={t('settings.modelCompactionHint')}
          >
            <Checkbox />
          </Form.Item>
          <Form.Item name="costInput" label={t('settings.costInput')}>
            <InputNumber min={0} max={1_000} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="costOutput" label={t('settings.costOutput')}>
            <InputNumber min={0} max={1_000} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="costCacheRead" label={t('settings.costCacheRead')}>
            <InputNumber min={0} max={1_000} step={0.001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="costCacheWrite" label={t('settings.costCacheWrite')}>
            <InputNumber min={0} max={1_000} step={0.001} style={{ width: '100%' }} />
          </Form.Item>
          <p className="m-0 text-caption text-subtle sm:col-span-2">
            {t('settings.costCacheHint')}
          </p>
        </div>

        <Form.List name="variants">
          {(fields, { add, remove }) => (
            <div className="mt-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-label font-medium text-foreground">
                  {t('settings.modelVariants')}
                </span>
                <Button size="small" onClick={() => add({ reasoningEffort: null })}>
                  {t('settings.addVariant')}
                </Button>
              </div>
              {fields.length === 0 ? (
                <p className="mb-0 text-caption text-muted">{t('settings.modelVariantsHint')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {fields.map(({ key, name, ...rest }) => (
                    <div key={key} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_0.8fr_1fr_auto]">
                      <Form.Item {...rest} name={[name, 'name']} className="mb-0">
                        <Input aria-label={t('settings.variantName')} placeholder="high" />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'reasoningEffort']} className="mb-0">
                        <Select
                          aria-label={t('settings.variantReasoning')}
                          virtual={false}
                          allowClear
                          placeholder={t('settings.variantReasoning')}
                          options={['minimal', 'low', 'medium', 'high'].map((effort) => ({
                            value: effort,
                            label: effort
                          }))}
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'temperature']} className="mb-0">
                        <InputNumber
                          aria-label={t('settings.variantTemperature')}
                          min={0}
                          max={2}
                          step={0.1}
                          style={{ width: '100%' }}
                          placeholder="0.7"
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'maxOutputTokens']} className="mb-0">
                        <InputNumber
                          aria-label={t('settings.variantMaxOutput')}
                          min={1}
                          max={1_000_000}
                          step={1_000}
                          style={{ width: '100%' }}
                          placeholder="8192"
                        />
                      </Form.Item>
                      <Button
                        danger
                        size="small"
                        aria-label={t('settings.removeVariant')}
                        onClick={() => remove(name)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Form.List>

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
