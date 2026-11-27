import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelError, PanelHint, subtleButtonClass } from '../project/ProjectFields'
import ProjectCommandsPanel from '../project/ProjectCommandsPanel'
import ProjectFormattersPanel from '../project/ProjectFormattersPanel'
import ProjectLspPanel from '../project/ProjectLspPanel'
import ProjectRawPanel from '../project/ProjectRawPanel'
import ProjectSkillsPanel from '../project/ProjectSkillsPanel'
import { useGlobalConfig } from './useGlobalConfig'

type GlobalTab = 'lsp' | 'formatters' | 'commands' | 'skills' | 'raw'

const TABS: Array<{ id: GlobalTab; labelKey: string }> = [
  { id: 'lsp', labelKey: 'settings.projectTabLsp' },
  { id: 'formatters', labelKey: 'settings.projectTabFormatters' },
  { id: 'commands', labelKey: 'settings.projectTabCommands' },
  { id: 'skills', labelKey: 'settings.projectTabSkills' },
  { id: 'raw', labelKey: 'settings.globalTabRaw' }
]

/** Structured editors for the global config file, shared with the project panels. */
function GlobalSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<GlobalTab>('lsp')
  const controller = useGlobalConfig()

  const file = controller.file
  const diagnosticCount =
    file?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length ?? 0

  return (
    <div className="flex flex-col gap-3" data-testid="global-settings">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-settings-card-bg px-5 py-3 [box-shadow:var(--shadow-sm),var(--highlight-inset)]">
        <div className="min-w-0">
          <p className="m-0 break-all font-mono text-caption text-foreground">
            {file?.path ?? t('settings.globalConfigMissing')}
          </p>
          <p className="m-0 mt-0.5 break-all text-caption text-muted">
            {t('settings.globalConfigHint')}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span
            className={`inline-flex h-[20px] items-center rounded-full px-2 text-[12px] leading-none font-medium ${
              file?.exists ? 'bg-accent-soft text-accent' : 'bg-background-subtle text-muted'
            }`}
          >
            {file?.exists ? t('settings.globalFileExists') : t('settings.globalFileMissing')}
          </span>
          {controller.invalidJson && (
            <span className="inline-flex h-[20px] items-center rounded-full bg-danger/10 px-2 text-[12px] leading-none font-medium text-danger">
              {t('settings.globalInvalidJsonBadge')}
            </span>
          )}
          {diagnosticCount > 0 && !controller.invalidJson && (
            <span className="inline-flex h-[20px] items-center rounded-full bg-warning-soft px-2 text-[12px] leading-none font-medium text-warning">
              {t('settings.projectDiagnosticsCount', { count: diagnosticCount })}
            </span>
          )}
          <button type="button" onClick={controller.reload} className={subtleButtonClass}>
            {t('settings.projectReload')}
          </button>
        </div>
      </div>

      {controller.error ? (
        <div className="flex flex-col items-start gap-2">
          <PanelError>{controller.error}</PanelError>
          <button type="button" onClick={controller.reload} className={subtleButtonClass}>
            {t('settings.retry')}
          </button>
        </div>
      ) : !file ? (
        <PanelHint>{t('settings.loading')}</PanelHint>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t('settings.global')}
            className="flex flex-wrap gap-1 border-b border-border-subtle pb-1"
          >
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`h-8 rounded-md px-2.5 text-caption font-medium transition-colors ${
                  tab === item.id
                    ? 'bg-accent-soft text-accent'
                    : 'text-muted hover:bg-background-subtle hover:text-foreground'
                }`}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>

          {tab === 'lsp' && <ProjectLspPanel controller={controller} scope="global" />}
          {tab === 'formatters' && (
            <ProjectFormattersPanel controller={controller} scope="global" />
          )}
          {tab === 'commands' && (
            <ProjectCommandsPanel
              controller={controller}
              scope="global"
              onOpenRaw={() => setTab('raw')}
            />
          )}
          {tab === 'skills' && <ProjectSkillsPanel controller={controller} scope="global" />}
          {tab === 'raw' && <ProjectRawPanel controller={controller} scope="global" />}
        </>
      )}
    </div>
  )
}

export default GlobalSettings
