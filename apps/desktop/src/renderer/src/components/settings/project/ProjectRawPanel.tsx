import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FormActions,
  PanelError,
  PanelHint,
  monoTextareaClass,
  subtleButtonClass
} from './ProjectFields'
import type { ConfigFileController, ConfigScope } from '../config-controller'

function ProjectRawPanel({
  controller,
  scope = 'project'
}: {
  controller: ConfigFileController
  scope?: ConfigScope
}): React.JSX.Element {
  const { t } = useTranslation()
  const isGlobal = scope === 'global'
  const text = {
    hint: t(isGlobal ? 'settings.globalRawHint' : 'settings.projectConfigEditorHint'),
    invalidHint: t(isGlobal ? 'settings.globalRawInvalidHint' : 'settings.projectRawInvalidHint'),
    editorLabel: t(isGlobal ? 'settings.globalRawEditorLabel' : 'settings.projectRawEditorLabel'),
    saveLabel: t(isGlobal ? 'settings.globalSaveConfig' : 'settings.saveProjectConfig'),
    placeholder: isGlobal ? '{\n  "commands": {}\n}\n' : '{\n  // ateam.jsonc\n}\n'
  }
  const [draft, setDraft] = useState<string | null>(null)
  const file = controller.file
  const value = draft ?? file?.content ?? ''
  const dirty = draft !== null && draft !== (file?.content ?? '')

  async function save(): Promise<void> {
    if (draft === null) return
    const saved = await controller.saveContent(draft)
    if (saved) setDraft(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <PanelHint>{text.hint}</PanelHint>
      {controller.invalidJson && <PanelError tone="warning">{text.invalidHint}</PanelError>}
      {controller.saveError && <PanelError>{controller.saveError}</PanelError>}
      {file && file.diagnostics.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2">
          <p className="m-0 text-caption font-medium text-warning">
            {t('settings.projectConfigErrors')}
          </p>
          <ul className="m-0 mt-1 list-disc pl-4 text-caption text-warning">
            {file.diagnostics.slice(0, 8).map((diagnostic, index) => (
              <li key={`${diagnostic.source}:${diagnostic.path}:${index}`}>
                <span className="font-mono">{diagnostic.path}</span>: {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <textarea
        aria-label={text.editorLabel}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        rows={20}
        spellCheck={false}
        placeholder={text.placeholder}
        className={monoTextareaClass}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 break-all font-mono text-caption text-subtle">{file?.path}</p>
        <div className="flex flex-none items-center gap-2">
          {draft !== null && (
            <button type="button" onClick={() => setDraft(null)} className={subtleButtonClass}>
              {t('settings.projectRawReset')}
            </button>
          )}
          <FormActions
            saving={controller.saving}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
            saveLabel={text.saveLabel}
            cancelLabel={t('settings.cancel')}
            disabled={!dirty}
          />
        </div>
      </div>
    </div>
  )
}

export default ProjectRawPanel
