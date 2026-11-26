import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Field,
  FormActions,
  PanelError,
  PanelHint,
  dangerButtonClass,
  monoInputClass,
  primaryButtonClass,
  textButtonClass
} from './ProjectFields'
import {
  fieldEdits,
  asRecord,
  numberText,
  recordEntries,
  setBoolean,
  setNumber,
  setString
} from './project-editors'
import type { JsonRecord } from './project-editors'
import type { ProjectConfigController } from './useProjectConfig'

/** Mirrors CONFIG_KEY / MODEL_KEY in agent-core's config normalizer. */
const CONFIG_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/
const PROVIDER_TYPES = ['anthropic', 'openai', 'google', 'openai-compatible'] as const

interface ProviderModelForm {
  id: string
  name: string
  contextWindow: string
  maxOutputTokens: string
  reasoning: boolean
  attachment: boolean
  applyPatch: boolean
  compaction: boolean
}

interface ProviderForm {
  originalId: string | null
  id: string
  name: string
  type: string
  baseURL: string
  apiKeyEnv: string
  models: ProviderModelForm[]
}

function emptyModel(): ProviderModelForm {
  return {
    id: '',
    name: '',
    contextWindow: '',
    maxOutputTokens: '',
    reasoning: false,
    attachment: false,
    applyPatch: false,
    compaction: false
  }
}

function emptyForm(): ProviderForm {
  return { originalId: null, id: '', name: '', type: '', baseURL: '', apiKeyEnv: '', models: [] }
}

function formFromProvider(id: string, value: JsonRecord): ProviderForm {
  const models = recordEntries(value.models).map(([modelId, model]) => ({
    id: modelId,
    name: typeof model.name === 'string' ? model.name : '',
    contextWindow: numberText(model.contextWindow),
    maxOutputTokens: numberText(model.maxOutputTokens),
    reasoning: model.reasoning === true,
    attachment: model.attachment === true,
    applyPatch: model.applyPatch === true,
    compaction: model.compaction === true
  }))
  return {
    originalId: id,
    id,
    name: typeof value.name === 'string' ? value.name : '',
    type: typeof value.type === 'string' ? value.type : '',
    baseURL: typeof value.baseURL === 'string' ? value.baseURL : '',
    apiKeyEnv: typeof value.apiKeyEnv === 'string' ? value.apiKeyEnv : '',
    models
  }
}

function ProjectProvidersPanel({
  controller,
  onOpenRaw
}: {
  controller: ProjectConfigController
  onOpenRaw: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<ProviderForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingRename, setPendingRename] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const file = controller.file
  if (!file) return <PanelHint>{t('settings.loading')}</PanelHint>
  const rawRecord = asRecord(file.raw)
  const providersRaw = rawRecord?.providers
  const providersArray = Array.isArray(providersRaw)
  const providers = asRecord(providersRaw) ?? {}
  const entries = recordEntries(providersRaw)
  const readOnly = controller.invalidJson

  function updateForm(patch: Partial<ProviderForm>): void {
    setForm((current) => (current ? { ...current, ...patch } : current))
    setFormError(null)
    setPendingRename(false)
  }

  function updateModel(index: number, patch: Partial<ProviderModelForm>): void {
    setForm((current) => {
      if (!current) return current
      return {
        ...current,
        models: current.models.map((model, position) =>
          position === index ? { ...model, ...patch } : model
        )
      }
    })
    setFormError(null)
  }

  async function save(): Promise<void> {
    if (!form) return
    const id = form.id.trim()
    if (!id) {
      setFormError(t('settings.projectProviderIdRequired'))
      return
    }
    if (!CONFIG_KEY.test(id)) {
      setFormError(t('settings.projectProviderIdInvalid'))
      return
    }
    const seenModels = new Set<string>()
    for (const model of form.models) {
      if (!model.id.trim()) continue
      const modelId = model.id.trim()
      if (!MODEL_KEY.test(modelId)) {
        setFormError(t('settings.projectModelIdInvalid'))
        return
      }
      if (seenModels.has(modelId)) {
        setFormError(t('settings.projectModelIdDuplicate'))
        return
      }
      seenModels.add(modelId)
      for (const value of [model.contextWindow, model.maxOutputTokens]) {
        if (value.trim() && !(Number.isFinite(Number(value)) && Number(value) > 0)) {
          setFormError(t('settings.projectModelNumberInvalid'))
          return
        }
      }
    }
    if (form.originalId && form.originalId !== id && !pendingRename) {
      setPendingRename(true)
      setFormError(t('settings.projectRenameConfirm', { from: form.originalId, to: id }))
      return
    }

    const existing = form.originalId !== null ? asRecord(providers[form.originalId]) : undefined
    const value: JsonRecord = { ...(existing ?? {}) }
    setString(value, 'name', form.name)
    setString(value, 'type', form.type)
    setString(value, 'baseURL', form.baseURL)
    setString(value, 'apiKeyEnv', form.apiKeyEnv)
    const existingModels = asRecord(existing?.models) ?? {}
    const models: JsonRecord = {}
    for (const model of form.models) {
      const modelId = model.id.trim()
      if (!modelId) continue
      const entry: JsonRecord = { ...(asRecord(existingModels[modelId]) ?? {}) }
      setString(entry, 'name', model.name)
      setNumber(entry, 'contextWindow', model.contextWindow)
      setNumber(entry, 'maxOutputTokens', model.maxOutputTokens)
      setBoolean(entry, 'reasoning', model.reasoning)
      setBoolean(entry, 'attachment', model.attachment)
      setBoolean(entry, 'applyPatch', model.applyPatch)
      setBoolean(entry, 'compaction', model.compaction)
      models[modelId] = entry
    }
    if (Object.keys(models).length > 0) value.models = models
    else delete value.models

    const nextProviders: JsonRecord = { ...providers }
    if (form.originalId && form.originalId !== id) delete nextProviders[form.originalId]
    nextProviders[id] = value
    const saved = await controller.saveEdits(fieldEdits(rawRecord, 'providers', nextProviders))
    if (saved) {
      setForm(null)
      setFormError(null)
      setPendingRename(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const nextProviders: JsonRecord = { ...providers }
    delete nextProviders[id]
    const saved = await controller.saveEdits(fieldEdits(rawRecord, 'providers', nextProviders))
    if (saved) {
      setPendingDelete(null)
      if (form?.originalId === id) setForm(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelHint>{t('settings.projectProvidersHint')}</PanelHint>
        {!providersArray && !readOnly && !form && (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm())
              setFormError(null)
              setPendingRename(false)
            }}
            className={primaryButtonClass}
          >
            {t('settings.projectAddProvider')}
          </button>
        )}
      </div>

      {readOnly && <PanelError tone="warning">{t('settings.projectInvalidJson')}</PanelError>}
      {controller.saveError && <PanelError>{controller.saveError}</PanelError>}

      {providersArray ? (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
          <p className="m-0 text-caption text-warning">{t('settings.projectProvidersArrayHint')}</p>
          <button type="button" onClick={onOpenRaw} className={`${textButtonClass} self-start`}>
            {t('settings.projectTabRaw')}
          </button>
        </div>
      ) : (
        <>
          {entries.length === 0 ? (
            <PanelHint>{t('settings.projectProvidersEmpty')}</PanelHint>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {entries.map(([id, value]) => {
                const models = recordEntries(value.models)
                return (
                  <li
                    key={id}
                    className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-label font-medium text-foreground">{id}</span>
                      {typeof value.name === 'string' && value.name && (
                        <span className="text-caption text-muted">{value.name}</span>
                      )}
                      {typeof value.type === 'string' && value.type && (
                        <span className="inline-flex h-[18px] items-center rounded-full bg-surface px-1.5 text-[12px] leading-none font-medium text-muted">
                          {value.type}
                        </span>
                      )}
                      {typeof value.baseURL === 'string' && value.baseURL && (
                        <code className="min-w-0 flex-1 truncate font-mono text-caption text-muted">
                          {value.baseURL}
                        </code>
                      )}
                      {typeof value.apiKeyEnv === 'string' && value.apiKeyEnv && (
                        <code className="font-mono text-caption text-subtle">
                          ${value.apiKeyEnv}
                        </code>
                      )}
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setForm(formFromProvider(id, value))
                              setFormError(null)
                              setPendingRename(false)
                            }}
                            className={textButtonClass}
                          >
                            {t('settings.projectEditProvider')}
                          </button>
                          {pendingDelete === id ? (
                            <>
                              <button
                                type="button"
                                disabled={controller.saving}
                                onClick={() => void remove(id)}
                                className={dangerButtonClass}
                              >
                                {t('settings.projectDeleteConfirm')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                className={textButtonClass}
                              >
                                {t('settings.cancel')}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(id)}
                              className={dangerButtonClass}
                            >
                              {t('settings.delete')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <p className="m-0 text-caption text-muted">
                      {models.length > 0
                        ? models.map(([modelId]) => modelId).join(' · ')
                        : t('settings.projectProviderNoModels')}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {form && !readOnly && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background-subtle p-3">
          <p className="m-0 text-label font-medium text-foreground">
            {form.originalId ? t('settings.projectEditProvider') : t('settings.projectAddProvider')}
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <Field
              label={t('settings.projectProviderId')}
              hint={t('settings.projectProviderIdHint')}
            >
              <input
                aria-label={t('settings.projectProviderId')}
                value={form.id}
                onChange={(event) => updateForm({ id: event.target.value })}
                className={monoInputClass}
              />
            </Field>
            <Field label={t('settings.providerName')}>
              <input
                aria-label={t('settings.providerName')}
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
                className={monoInputClass}
              />
            </Field>
            <Field label={t('settings.providerType')}>
              <select
                aria-label={t('settings.providerType')}
                value={form.type}
                onChange={(event) => updateForm({ type: event.target.value })}
                className="h-8 rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none"
              >
                <option value="">{t('settings.projectProviderTypeDefault')}</option>
                {PROVIDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('settings.baseURL')}>
              <input
                aria-label={t('settings.baseURL')}
                value={form.baseURL}
                onChange={(event) => updateForm({ baseURL: event.target.value })}
                placeholder="https://api.example.com/v1"
                className={monoInputClass}
              />
            </Field>
            <Field label={t('settings.projectApiKeyEnv')} hint={t('settings.projectApiKeyEnvHint')}>
              <input
                aria-label={t('settings.projectApiKeyEnv')}
                value={form.apiKeyEnv}
                onChange={(event) => updateForm({ apiKeyEnv: event.target.value })}
                placeholder="OPENAI_API_KEY"
                className={monoInputClass}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-caption font-medium text-foreground">
                {t('settings.modelsList')}
              </p>
              <button
                type="button"
                onClick={() =>
                  setForm((current) =>
                    current ? { ...current, models: [...current.models, emptyModel()] } : current
                  )
                }
                className={textButtonClass}
              >
                {t('settings.projectAddModel')}
              </button>
            </div>
            {form.models.length === 0 ? (
              <PanelHint>{t('settings.projectProviderNoModels')}</PanelHint>
            ) : (
              form.models.map((model, index) => (
                <div
                  key={index}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-border-subtle bg-surface px-2 py-2"
                >
                  <Field label={t('settings.modelId')}>
                    <input
                      aria-label={`${t('settings.modelId')} ${index + 1}`}
                      value={model.id}
                      onChange={(event) => updateModel(index, { id: event.target.value })}
                      className={monoInputClass}
                    />
                  </Field>
                  <Field label={t('settings.modelName')}>
                    <input
                      aria-label={`${t('settings.modelName')} ${index + 1}`}
                      value={model.name}
                      onChange={(event) => updateModel(index, { name: event.target.value })}
                      className={monoInputClass}
                    />
                  </Field>
                  <Field label={t('settings.contextWindow')}>
                    <input
                      type="number"
                      min={1}
                      aria-label={`${t('settings.contextWindow')} ${index + 1}`}
                      value={model.contextWindow}
                      onChange={(event) =>
                        updateModel(index, { contextWindow: event.target.value })
                      }
                      className={monoInputClass}
                    />
                  </Field>
                  <Field label={t('settings.maxOutputTokens')}>
                    <input
                      type="number"
                      min={1}
                      aria-label={`${t('settings.maxOutputTokens')} ${index + 1}`}
                      value={model.maxOutputTokens}
                      onChange={(event) =>
                        updateModel(index, { maxOutputTokens: event.target.value })
                      }
                      className={monoInputClass}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2 pb-1">
                    {(
                      [
                        ['reasoning', t('settings.modelReasoning')],
                        ['attachment', t('settings.modelAttachment')],
                        ['applyPatch', t('settings.modelApplyPatch')],
                        ['compaction', t('settings.modelCompaction')]
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1 text-caption text-muted">
                        <input
                          type="checkbox"
                          aria-label={`${label} ${index + 1}`}
                          checked={model[key]}
                          onChange={(event) => updateModel(index, { [key]: event.target.checked })}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={`${t('settings.projectRemoveModel')} ${index + 1}`}
                    onClick={() =>
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              models: current.models.filter((_, position) => position !== index)
                            }
                          : current
                      )
                    }
                    className={dangerButtonClass}
                  >
                    {t('settings.projectRemoveModel')}
                  </button>
                </div>
              ))
            )}
          </div>

          {formError && <PanelError>{formError}</PanelError>}
          <FormActions
            saving={controller.saving}
            onSave={() => void save()}
            onCancel={() => {
              setForm(null)
              setFormError(null)
              setPendingRename(false)
            }}
            saveLabel={t('settings.save')}
            cancelLabel={t('settings.cancel')}
          />
        </div>
      )}
    </div>
  )
}

export default ProjectProvidersPanel
