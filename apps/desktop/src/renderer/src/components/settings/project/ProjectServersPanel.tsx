import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Field,
  FormActions,
  PanelError,
  PanelHint,
  dangerButtonClass,
  monoInputClass,
  monoTextareaClass,
  primaryButtonClass,
  subtleButtonClass,
  textButtonClass
} from './ProjectFields'
import { parseKeyValue, formatKeyValue } from '../config-lines'
import {
  asRecord,
  arrayToLines,
  fieldEdits,
  linesToArray,
  recordEntries,
  setArray,
  setBoolean,
  setRecord,
  stringArray
} from './project-editors'
import type { JsonRecord } from './project-editors'
import type { ConfigDocumentController, ConfigScope } from '../config-controller'

/** Mirrors CONFIG_KEY in agent-core's config normalizer. */
const CONFIG_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

type ServerMode = 'inherit' | 'toggle' | 'servers'
type ServerKind = 'lsp' | 'formatters'

interface ServerForm {
  originalId: string | null
  id: string
  command: string
  extensions: string
  rootMarkers: string
  npmPackages: string
  configFiles: string
  envText: string
  initialization: string
  disabled: boolean
}

function emptyForm(): ServerForm {
  return {
    originalId: null,
    id: '',
    command: '',
    extensions: '',
    rootMarkers: '',
    npmPackages: '',
    configFiles: '',
    envText: '',
    initialization: '',
    disabled: false
  }
}

function recordText(value: unknown): string {
  const record = asRecord(value)
  if (!record) return ''
  const entries: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') entries[key] = entry
  }
  return formatKeyValue(entries, '=')
}

function formFromServer(id: string, value: JsonRecord, kind: ServerKind): ServerForm {
  return {
    originalId: id,
    id,
    command: arrayToLines(value.command),
    extensions: arrayToLines(value.extensions),
    rootMarkers: arrayToLines(value.rootMarkers),
    npmPackages: arrayToLines(value.npmPackages),
    configFiles: arrayToLines(value.configFiles),
    envText: recordText(kind === 'lsp' ? value.env : value.environment),
    initialization:
      value.initialization !== undefined ? JSON.stringify(value.initialization, null, 2) : '',
    disabled: value.disabled === true
  }
}

function ProjectServersPanel({
  controller,
  kind,
  scope = 'project'
}: {
  controller: ConfigDocumentController
  kind: ServerKind
  scope?: ConfigScope
}): React.JSX.Element {
  const { t } = useTranslation()
  const isGlobal = scope === 'global'
  const serverKey = kind
  const enabledKey = kind === 'lsp' ? 'lspEnabled' : 'formattersEnabled'
  const [modeOverride, setModeOverride] = useState<ServerMode | null>(null)
  const [toggleOverride, setToggleOverride] = useState<boolean | null>(null)
  const [form, setForm] = useState<ServerForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingRename, setPendingRename] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const file = controller.file
  if (!file) return <PanelHint>{t('settings.loading')}</PanelHint>
  const rawRecord = asRecord(file.raw)
  const serverValue = rawRecord?.[serverKey]
  const enabledValue = rawRecord?.[enabledKey]
  const servers = asRecord(serverValue) ?? {}
  const entries = recordEntries(serverValue)
  const derivedMode: ServerMode =
    asRecord(serverValue) !== null
      ? 'servers'
      : typeof serverValue === 'boolean' || typeof enabledValue === 'boolean'
        ? 'toggle'
        : 'inherit'
  const mode = modeOverride ?? derivedMode
  const derivedEnabled =
    typeof serverValue === 'boolean'
      ? serverValue
      : typeof enabledValue === 'boolean'
        ? enabledValue
        : true
  const enabled = toggleOverride ?? derivedEnabled
  const readOnly = controller.invalidJson

  function selectMode(next: ServerMode): void {
    setModeOverride(next)
    setFormError(null)
    setForm(null)
  }

  async function saveToggle(): Promise<void> {
    let saved: boolean
    if (isGlobal) {
      saved =
        asRecord(serverValue) !== null
          ? // A custom list exists: keep it and only flip the enabled flag.
            await controller.saveEdits(
              fieldEdits(rawRecord, enabledKey, enabled ? undefined : false)
            )
          : await controller.saveEdits([
              ...fieldEdits(rawRecord, serverKey, enabled),
              ...fieldEdits(rawRecord, enabledKey, undefined)
            ])
    } else {
      saved = await controller.saveEdits([
        ...fieldEdits(rawRecord, enabledKey, enabled),
        ...fieldEdits(rawRecord, serverKey, undefined)
      ])
    }
    if (saved) {
      setModeOverride(null)
      setToggleOverride(null)
    }
  }

  async function removeOverride(): Promise<void> {
    const saved = await controller.saveEdits([
      ...fieldEdits(rawRecord, serverKey, undefined),
      ...fieldEdits(rawRecord, enabledKey, undefined)
    ])
    if (saved) {
      setModeOverride(null)
      setToggleOverride(null)
    }
  }

  function updateForm(patch: Partial<ServerForm>): void {
    setForm((current) => (current ? { ...current, ...patch } : current))
    setFormError(null)
    setPendingRename(false)
  }

  async function saveServer(): Promise<void> {
    if (!form) return
    const id = form.id.trim()
    if (!id) {
      setFormError(t('settings.projectServerIdRequired'))
      return
    }
    if (!CONFIG_KEY.test(id)) {
      setFormError(t('settings.projectServerIdInvalid'))
      return
    }
    let initialization: JsonRecord | undefined
    if (kind === 'lsp' && form.initialization.trim()) {
      try {
        const parsed: unknown = JSON.parse(form.initialization)
        const record = asRecord(parsed)
        if (!record) throw new Error('not an object')
        initialization = record
      } catch {
        setFormError(t('settings.projectServerInvalidJson'))
        return
      }
    }
    if (form.originalId && form.originalId !== id && !pendingRename) {
      setPendingRename(true)
      setFormError(t('settings.projectRenameConfirm', { from: form.originalId, to: id }))
      return
    }

    const existing = form.originalId !== null ? asRecord(servers[form.originalId]) : undefined
    const entry: JsonRecord = { ...(existing ?? {}) }
    setArray(entry, 'command', linesToArray(form.command))
    setArray(entry, 'extensions', linesToArray(form.extensions))
    if (kind === 'lsp') {
      setArray(entry, 'rootMarkers', linesToArray(form.rootMarkers))
      setArray(entry, 'npmPackages', linesToArray(form.npmPackages))
      setRecord(entry, 'env', parseKeyValue(form.envText, '='))
      if (initialization) entry.initialization = initialization
      else delete entry.initialization
    } else {
      setArray(entry, 'configFiles', linesToArray(form.configFiles))
      setRecord(entry, 'environment', parseKeyValue(form.envText, '='))
    }
    setBoolean(entry, 'disabled', form.disabled)

    const next: JsonRecord = { ...servers }
    if (form.originalId && form.originalId !== id) delete next[form.originalId]
    next[id] = entry
    const saved = await controller.saveEdits([
      ...fieldEdits(rawRecord, serverKey, Object.keys(next).length > 0 ? next : undefined),
      // Global: adding a list keeps the feature in its current on/off state.
      ...fieldEdits(rawRecord, enabledKey, isGlobal && !enabled ? false : undefined)
    ])
    if (saved) {
      setForm(null)
      setFormError(null)
      setPendingRename(false)
      setModeOverride(null)
    }
  }

  async function removeServer(id: string): Promise<void> {
    const next: JsonRecord = { ...servers }
    delete next[id]
    const remaining = Object.keys(next).length > 0
    const edits = fieldEdits(rawRecord, serverKey, remaining ? next : undefined)
    if (isGlobal && !remaining) {
      // Removing the last global server returns to the default state.
      edits.push(...fieldEdits(rawRecord, enabledKey, undefined))
    }
    const saved = await controller.saveEdits(edits)
    if (saved) {
      setPendingDelete(null)
      if (form?.originalId === id) setForm(null)
    }
  }

  async function saveEnabled(nextEnabled: boolean): Promise<void> {
    await controller.saveEdits(fieldEdits(rawRecord, enabledKey, nextEnabled ? undefined : false))
  }

  const labels = {
    lsp: {
      toggle: t('settings.projectLspToggle'),
      add: t('settings.projectAddLspServer'),
      edit: t('settings.projectEditLspServer'),
      empty: t(isGlobal ? 'settings.globalLspEmpty' : 'settings.projectLspEmpty')
    },
    formatters: {
      toggle: t('settings.projectFormattersToggle'),
      add: t('settings.projectAddFormatter'),
      edit: t('settings.projectEditFormatter'),
      empty: t(isGlobal ? 'settings.globalFormattersEmpty' : 'settings.projectFormattersEmpty')
    }
  }[kind]

  const text = {
    modeInherit: t(isGlobal ? 'settings.globalServersDefault' : 'settings.projectServersInherit'),
    modeToggle: t(isGlobal ? 'settings.globalServersToggle' : 'settings.projectServersToggle'),
    modeServers: t(isGlobal ? 'settings.globalServersList' : 'settings.projectServersList'),
    inheritHint: t(
      isGlobal ? 'settings.globalServersDefaultHint' : 'settings.projectServersInheritHint'
    ),
    toggleHint: t(
      isGlobal ? 'settings.globalServersToggleHint' : 'settings.projectServersToggleHint'
    ),
    serversHint: t(isGlobal ? 'settings.globalServersListHint' : 'settings.projectServersListHint'),
    removeOverride: t(
      isGlobal ? 'settings.globalRemoveOverride' : 'settings.projectRemoveOverride'
    ),
    invalidJson: t(isGlobal ? 'settings.globalInvalidJson' : 'settings.projectInvalidJson')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div role="radiogroup" aria-label={labels.toggle} className="flex flex-wrap gap-1">
          {(
            [
              ['inherit', text.modeInherit],
              ['toggle', text.modeToggle],
              ['servers', text.modeServers]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={readOnly}
              onClick={() => selectMode(value)}
              className={`h-7 rounded-md border px-2 text-caption font-medium transition-colors disabled:opacity-55 ${
                mode === value
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border text-muted hover:bg-background-subtle'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {readOnly && <PanelError tone="warning">{text.invalidJson}</PanelError>}
      {controller.saveError && <PanelError>{controller.saveError}</PanelError>}

      {mode === 'inherit' && (
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2">
          <PanelHint>{text.inheritHint}</PanelHint>
          {derivedMode !== 'inherit' && !readOnly && (
            <button
              type="button"
              disabled={controller.saving}
              onClick={() => void removeOverride()}
              className={`${subtleButtonClass} self-start`}
            >
              {text.removeOverride}
            </button>
          )}
        </div>
      )}

      {mode === 'toggle' && (
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2">
          <PanelHint>{text.toggleHint}</PanelHint>
          <label className="flex items-center gap-2 text-label text-foreground">
            <input
              type="checkbox"
              aria-label={labels.toggle}
              checked={enabled}
              disabled={readOnly}
              onChange={(event) => setToggleOverride(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            {labels.toggle}
          </label>
          {!readOnly && (
            <button
              type="button"
              disabled={controller.saving}
              onClick={() => void saveToggle()}
              className={`${primaryButtonClass} self-start`}
            >
              {controller.saving ? t('settings.saving') : t('settings.save')}
            </button>
          )}
        </div>
      )}

      {mode === 'servers' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <PanelHint>{text.serversHint}</PanelHint>
            {!readOnly && !form && (
              <button
                type="button"
                onClick={() => {
                  setForm(emptyForm())
                  setFormError(null)
                  setPendingRename(false)
                }}
                className={primaryButtonClass}
              >
                {labels.add}
              </button>
            )}
          </div>

          {isGlobal && derivedMode === 'servers' && (
            <label className="flex items-center gap-2 text-label text-foreground">
              <input
                type="checkbox"
                aria-label={t('settings.globalServersEnabled')}
                checked={enabled}
                disabled={readOnly || controller.saving}
                onChange={(event) => void saveEnabled(event.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              {t('settings.globalServersEnabled')}
            </label>
          )}

          {entries.length === 0 ? (
            <PanelHint>{labels.empty}</PanelHint>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {entries.map(([id, value]) => (
                <li
                  key={id}
                  className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-label font-medium text-foreground">{id}</span>
                    {value.disabled === true && (
                      <span className="inline-flex h-[18px] items-center rounded-full bg-warning-soft px-1.5 text-[12px] leading-none font-medium text-warning">
                        {t('settings.disabled')}
                      </span>
                    )}
                    <code className="min-w-0 flex-1 truncate font-mono text-caption text-muted">
                      {stringArray(value.command).join(' ') || '—'}
                    </code>
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setForm(formFromServer(id, value, kind))
                            setFormError(null)
                            setPendingRename(false)
                          }}
                          className={textButtonClass}
                        >
                          {labels.edit}
                        </button>
                        {pendingDelete === id ? (
                          <>
                            <button
                              type="button"
                              disabled={controller.saving}
                              onClick={() => void removeServer(id)}
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
                  {stringArray(value.extensions).length > 0 && (
                    <p className="m-0 font-mono text-caption text-subtle">
                      {stringArray(value.extensions).join(' ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            disabled={readOnly || controller.saving || form !== null}
            onClick={() => void removeOverride()}
            className={`${subtleButtonClass} self-start`}
            hidden={derivedMode === 'inherit'}
          >
            {text.removeOverride}
          </button>

          {form && !readOnly && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-background-subtle p-3">
              <p className="m-0 text-label font-medium text-foreground">
                {form.originalId ? labels.edit : labels.add}
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <Field label={t('settings.projectServerId')}>
                  <input
                    aria-label={t('settings.projectServerId')}
                    value={form.id}
                    onChange={(event) => updateForm({ id: event.target.value })}
                    className={monoInputClass}
                  />
                </Field>
                <Field label={t('settings.projectServerCommand')}>
                  <textarea
                    aria-label={t('settings.projectServerCommand')}
                    value={form.command}
                    onChange={(event) => updateForm({ command: event.target.value })}
                    rows={3}
                    spellCheck={false}
                    className={monoTextareaClass}
                  />
                </Field>
                <Field label={t('settings.projectServerExtensions')}>
                  <textarea
                    aria-label={t('settings.projectServerExtensions')}
                    value={form.extensions}
                    onChange={(event) => updateForm({ extensions: event.target.value })}
                    rows={3}
                    spellCheck={false}
                    placeholder=".ts"
                    className={monoTextareaClass}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {kind === 'lsp' ? (
                  <>
                    <Field label={t('settings.projectServerRootMarkers')}>
                      <textarea
                        aria-label={t('settings.projectServerRootMarkers')}
                        value={form.rootMarkers}
                        onChange={(event) => updateForm({ rootMarkers: event.target.value })}
                        rows={2}
                        spellCheck={false}
                        placeholder="package.json"
                        className={monoTextareaClass}
                      />
                    </Field>
                    <Field label={t('settings.projectServerNpmPackages')}>
                      <textarea
                        aria-label={t('settings.projectServerNpmPackages')}
                        value={form.npmPackages}
                        onChange={(event) => updateForm({ npmPackages: event.target.value })}
                        rows={2}
                        spellCheck={false}
                        placeholder="typescript-language-server"
                        className={monoTextareaClass}
                      />
                    </Field>
                    <Field label={t('settings.projectServerEnv')}>
                      <textarea
                        aria-label={t('settings.projectServerEnv')}
                        value={form.envText}
                        onChange={(event) => updateForm({ envText: event.target.value })}
                        rows={2}
                        spellCheck={false}
                        placeholder="KEY=VALUE"
                        className={monoTextareaClass}
                      />
                    </Field>
                    <Field label={t('settings.projectServerInitialization')}>
                      <textarea
                        aria-label={t('settings.projectServerInitialization')}
                        value={form.initialization}
                        onChange={(event) => updateForm({ initialization: event.target.value })}
                        rows={2}
                        spellCheck={false}
                        placeholder='{ "typescript": { "tsdk": "./node_modules/typescript/lib" } }'
                        className={monoTextareaClass}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={t('settings.projectServerConfigFiles')}>
                      <textarea
                        aria-label={t('settings.projectServerConfigFiles')}
                        value={form.configFiles}
                        onChange={(event) => updateForm({ configFiles: event.target.value })}
                        rows={2}
                        spellCheck={false}
                        placeholder=".prettierrc"
                        className={monoTextareaClass}
                      />
                    </Field>
                    <Field label={t('settings.projectServerEnvironment')}>
                      <textarea
                        aria-label={t('settings.projectServerEnvironment')}
                        value={form.envText}
                        onChange={(event) => updateForm({ envText: event.target.value })}
                        rows={2}
                        spellCheck={false}
                        placeholder="KEY=VALUE"
                        className={monoTextareaClass}
                      />
                    </Field>
                  </>
                )}
                <label className="flex h-8 items-center gap-1.5 text-caption text-muted">
                  <input
                    type="checkbox"
                    aria-label={t('settings.projectServerDisabled')}
                    checked={form.disabled}
                    onChange={(event) => updateForm({ disabled: event.target.checked })}
                    className="h-4 w-4 accent-accent"
                  />
                  {t('settings.projectServerDisabled')}
                </label>
              </div>
              {formError && <PanelError>{formError}</PanelError>}
              <FormActions
                saving={controller.saving}
                onSave={() => void saveServer()}
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
      )}
    </div>
  )
}

export default ProjectServersPanel
