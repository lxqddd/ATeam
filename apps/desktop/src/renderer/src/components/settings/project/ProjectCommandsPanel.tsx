import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Field,
  FormActions,
  PanelError,
  PanelHint,
  dangerButtonClass,
  inputClass,
  monoInputClass,
  monoTextareaClass,
  primaryButtonClass,
  textButtonClass
} from './ProjectFields'
import { asRecord, fieldEdits, recordEntries, setBoolean, setString } from './project-editors'
import type { JsonRecord } from './project-editors'
import type { ConfigDocumentController, ConfigScope } from '../config-controller'

/** Mirrors CONFIG_KEY in agent-core's config normalizer. */
const CONFIG_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

interface CommandForm {
  originalName: string | null
  name: string
  description: string
  agent: string
  model: string
  subtask: boolean
  template: string
}

function emptyForm(): CommandForm {
  return {
    originalName: null,
    name: '',
    description: '',
    agent: '',
    model: '',
    subtask: false,
    template: ''
  }
}

function formFromCommand(name: string, value: JsonRecord): CommandForm {
  return {
    originalName: name,
    name,
    description: typeof value.description === 'string' ? value.description : '',
    agent: typeof value.agent === 'string' ? value.agent : '',
    model: typeof value.model === 'string' ? value.model : '',
    subtask: value.subtask === true,
    template: typeof value.template === 'string' ? value.template : ''
  }
}

function ProjectCommandsPanel({
  controller,
  onOpenRaw,
  scope = 'project'
}: {
  controller: ConfigDocumentController
  onOpenRaw?: () => void
  scope?: ConfigScope
}): React.JSX.Element {
  const { t } = useTranslation()
  const isGlobal = scope === 'global'
  const text = {
    hint: t(isGlobal ? 'settings.globalCommandsHint' : 'settings.projectCommandsHint'),
    arrayHint: t(
      isGlobal ? 'settings.globalCommandsArrayHint' : 'settings.projectCommandsArrayHint'
    ),
    rawTab: t(isGlobal ? 'settings.globalTabRaw' : 'settings.projectTabRaw'),
    empty: t(isGlobal ? 'settings.globalCommandsEmpty' : 'settings.projectCommandsEmpty'),
    invalidJson: t(isGlobal ? 'settings.globalInvalidJson' : 'settings.projectInvalidJson')
  }
  const [form, setForm] = useState<CommandForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const file = controller.file
  if (!file) return <PanelHint>{t('settings.loading')}</PanelHint>
  const rawRecord = asRecord(file.raw)
  const commandsRaw = rawRecord?.commands
  const commandsArray = Array.isArray(commandsRaw)
  const commands = asRecord(commandsRaw) ?? {}
  const entries = recordEntries(commandsRaw)
  const readOnly = controller.invalidJson

  function updateForm(patch: Partial<CommandForm>): void {
    setForm((current) => (current ? { ...current, ...patch } : current))
    setFormError(null)
  }

  async function save(): Promise<void> {
    if (!form) return
    const name = form.name.trim()
    if (!name) {
      setFormError(t('settings.projectCommandNameRequired'))
      return
    }
    if (!CONFIG_KEY.test(name)) {
      setFormError(t('settings.projectCommandNameInvalid'))
      return
    }
    if (!form.template.trim()) {
      setFormError(t('settings.projectCommandTemplateRequired'))
      return
    }
    const existing = form.originalName !== null ? asRecord(commands[form.originalName]) : undefined
    const value: JsonRecord = { ...(existing ?? {}) }
    value.template = form.template
    setString(value, 'description', form.description)
    setString(value, 'agent', form.agent)
    setString(value, 'model', form.model)
    setBoolean(value, 'subtask', form.subtask)
    const nextCommands: JsonRecord = { ...commands }
    if (form.originalName && form.originalName !== name) delete nextCommands[form.originalName]
    nextCommands[name] = value
    const saved = await controller.saveEdits(fieldEdits(rawRecord, 'commands', nextCommands))
    if (saved) {
      setForm(null)
      setFormError(null)
    }
  }

  async function remove(name: string): Promise<void> {
    const nextCommands: JsonRecord = { ...commands }
    delete nextCommands[name]
    const saved = await controller.saveEdits(fieldEdits(rawRecord, 'commands', nextCommands))
    if (saved) {
      setPendingDelete(null)
      if (form?.originalName === name) setForm(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelHint>{text.hint}</PanelHint>
        {!commandsArray && !readOnly && !form && (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm())
              setFormError(null)
            }}
            className={primaryButtonClass}
          >
            {t('settings.projectAddCommand')}
          </button>
        )}
      </div>

      {readOnly && <PanelError tone="warning">{text.invalidJson}</PanelError>}
      {controller.saveError && <PanelError>{controller.saveError}</PanelError>}

      {commandsArray ? (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
          <p className="m-0 text-caption text-warning">{text.arrayHint}</p>
          {onOpenRaw && (
            <button type="button" onClick={onOpenRaw} className={`${textButtonClass} self-start`}>
              {text.rawTab}
            </button>
          )}
        </div>
      ) : entries.length === 0 ? (
        <PanelHint>{text.empty}</PanelHint>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {entries.map(([name, value]) => (
            <li
              key={name}
              className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-label font-medium text-foreground">/{name}</span>
                {typeof value.description === 'string' && value.description && (
                  <span className="min-w-0 flex-1 truncate text-caption text-muted">
                    {value.description}
                  </span>
                )}
                {typeof value.agent === 'string' && value.agent && (
                  <span className="inline-flex h-[18px] items-center rounded-full bg-surface px-1.5 text-[12px] leading-none font-medium text-muted">
                    {t('settings.projectCommandAgent')}: {value.agent}
                  </span>
                )}
                {value.subtask === true && (
                  <span className="inline-flex h-[18px] items-center rounded-full bg-accent-soft px-1.5 text-[12px] leading-none font-medium text-accent">
                    {t('settings.projectCommandSubtask')}
                  </span>
                )}
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setForm(formFromCommand(name, value))
                        setFormError(null)
                      }}
                      className={textButtonClass}
                    >
                      {t('settings.projectEditCommand')}
                    </button>
                    {pendingDelete === name ? (
                      <>
                        <button
                          type="button"
                          disabled={controller.saving}
                          onClick={() => void remove(name)}
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
                        onClick={() => setPendingDelete(name)}
                        className={dangerButtonClass}
                      >
                        {t('settings.delete')}
                      </button>
                    )}
                  </>
                )}
              </div>
              <code className="line-clamp-1 font-mono text-caption text-subtle">
                {typeof value.template === 'string' ? value.template.split('\n')[0] : ''}
              </code>
            </li>
          ))}
        </ul>
      )}

      {form && !readOnly && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background-subtle p-3">
          <p className="m-0 text-label font-medium text-foreground">
            {form.originalName ? t('settings.projectEditCommand') : t('settings.projectAddCommand')}
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <Field label={t('settings.projectCommandName')}>
              <input
                aria-label={t('settings.projectCommandName')}
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
                className={monoInputClass}
              />
            </Field>
            <Field label={t('settings.projectCommandDescription')}>
              <input
                aria-label={t('settings.projectCommandDescription')}
                value={form.description}
                onChange={(event) => updateForm({ description: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label={t('settings.projectCommandAgent')}>
              <input
                aria-label={t('settings.projectCommandAgent')}
                value={form.agent}
                onChange={(event) => updateForm({ agent: event.target.value })}
                className={monoInputClass}
              />
            </Field>
            <Field label={t('settings.projectCommandModel')}>
              <input
                aria-label={t('settings.projectCommandModel')}
                value={form.model}
                onChange={(event) => updateForm({ model: event.target.value })}
                className={monoInputClass}
              />
            </Field>
            <label className="flex h-8 items-center gap-1.5 text-caption text-muted">
              <input
                type="checkbox"
                aria-label={t('settings.projectCommandSubtask')}
                checked={form.subtask}
                onChange={(event) => updateForm({ subtask: event.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              {t('settings.projectCommandSubtask')}
            </label>
          </div>
          <Field
            label={t('settings.projectCommandTemplate')}
            hint={t('settings.projectCommandTemplateHint')}
          >
            <textarea
              aria-label={t('settings.projectCommandTemplate')}
              value={form.template}
              onChange={(event) => updateForm({ template: event.target.value })}
              rows={8}
              spellCheck={false}
              className={monoTextareaClass}
            />
          </Field>
          {formError && <PanelError>{formError}</PanelError>}
          <FormActions
            saving={controller.saving}
            onSave={() => void save()}
            onCancel={() => {
              setForm(null)
              setFormError(null)
            }}
            saveLabel={t('settings.save')}
            cancelLabel={t('settings.cancel')}
          />
        </div>
      )}
    </div>
  )
}

export default ProjectCommandsPanel
