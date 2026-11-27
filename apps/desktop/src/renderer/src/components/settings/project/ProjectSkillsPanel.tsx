import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FormActions,
  PanelError,
  PanelHint,
  monoTextareaClass,
  primaryButtonClass
} from './ProjectFields'
import { asRecord, fieldEdits, linesToArray, stringArray } from './project-editors'
import type { ConfigDocumentController, ConfigScope } from '../config-controller'

function ProjectSkillsPanel({
  controller,
  scope = 'project'
}: {
  controller: ConfigDocumentController
  scope?: ConfigScope
}): React.JSX.Element {
  const { t } = useTranslation()
  const isGlobal = scope === 'global'
  const text = {
    hint: t(isGlobal ? 'settings.globalSkillsHint' : 'settings.projectSkillsHint'),
    empty: t(isGlobal ? 'settings.globalSkillsEmpty' : 'settings.projectSkillsEmpty'),
    replaceHint: t(
      isGlobal ? 'settings.globalSkillsReplaceHint' : 'settings.projectSkillsReplaceHint'
    ),
    invalidJson: t(isGlobal ? 'settings.globalInvalidJson' : 'settings.projectInvalidJson')
  }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const file = controller.file
  if (!file) return <PanelHint>{t('settings.loading')}</PanelHint>
  const rawRecord = asRecord(file.raw)
  const skills = stringArray(rawRecord?.skills)
  const readOnly = controller.invalidJson

  async function save(): Promise<void> {
    const next = linesToArray(draft)
    const saved = await controller.saveEdits(
      fieldEdits(rawRecord, 'skills', next.length > 0 ? next : undefined)
    )
    if (saved) setEditing(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelHint>{text.hint}</PanelHint>
        {!readOnly && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(skills.join('\n'))
              setEditing(true)
            }}
            className={primaryButtonClass}
          >
            {t('settings.projectEditSkills')}
          </button>
        )}
      </div>

      {readOnly && <PanelError tone="warning">{text.invalidJson}</PanelError>}
      {controller.saveError && <PanelError>{controller.saveError}</PanelError>}

      {editing && !readOnly ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background-subtle p-3">
          <textarea
            aria-label={t('settings.projectSkillsEditorLabel')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={t('settings.projectSkillsPlaceholder')}
            className={monoTextareaClass}
          />
          <PanelHint>{text.replaceHint}</PanelHint>
          <FormActions
            saving={controller.saving}
            onSave={() => void save()}
            onCancel={() => setEditing(false)}
            saveLabel={t('settings.save')}
            cancelLabel={t('settings.cancel')}
          />
        </div>
      ) : skills.length === 0 ? (
        <PanelHint>{text.empty}</PanelHint>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {skills.map((skill) => (
            <li
              key={skill}
              className="rounded-md border border-border-subtle bg-background-subtle px-2.5 py-1.5 font-mono text-caption text-foreground"
            >
              {skill}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectSkillsPanel
