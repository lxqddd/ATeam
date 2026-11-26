import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentInfo } from '@ateam/shared'
import { PanelError, PanelHint, subtleButtonClass } from './ProjectFields'
import ProjectCommandsPanel from './ProjectCommandsPanel'
import ProjectFormattersPanel from './ProjectFormattersPanel'
import ProjectLspPanel from './ProjectLspPanel'
import ProjectOverviewPanel from './ProjectOverviewPanel'
import ProjectProvidersPanel from './ProjectProvidersPanel'
import ProjectRawPanel from './ProjectRawPanel'
import ProjectSkillsPanel from './ProjectSkillsPanel'
import { useProjectConfig } from './useProjectConfig'
import type { ProjectTab } from './types'

const TABS: Array<{ id: ProjectTab; labelKey: string }> = [
  { id: 'overview', labelKey: 'settings.projectTabOverview' },
  { id: 'providers', labelKey: 'settings.projectTabProviders' },
  { id: 'lsp', labelKey: 'settings.projectTabLsp' },
  { id: 'formatters', labelKey: 'settings.projectTabFormatters' },
  { id: 'commands', labelKey: 'settings.projectTabCommands' },
  { id: 'skills', labelKey: 'settings.projectTabSkills' },
  { id: 'raw', labelKey: 'settings.projectTabRaw' }
]

function ProjectSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AgentInfo | null>(null)
  const [tab, setTab] = useState<ProjectTab>('overview')
  const controller = useProjectConfig(info?.workspacePath)

  useEffect(() => {
    let active = true
    window.api.agent
      .info()
      .then((next) => {
        if (active) setInfo(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const file = controller.file
  const diagnosticCount =
    (file?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length ?? 0) +
    (controller.resolved?.diagnostics.length ?? 0)

  return (
    <div className="flex flex-col gap-3" data-testid="project-settings">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-settings-card-bg px-5 py-3 [box-shadow:var(--shadow-sm),var(--highlight-inset)]">
        <div className="min-w-0">
          <p className="m-0 break-all font-mono text-caption text-foreground">
            {file?.path ?? t('settings.projectConfigMissing')}
          </p>
          <p className="m-0 mt-0.5 break-all text-caption text-muted">
            {t('settings.projectWorkspaceHint', {
              directory:
                file?.root ??
                controller.resolved?.sources.projectRoot ??
                controller.directory ??
                '—'
            })}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span
            className={`inline-flex h-[20px] items-center rounded-full px-2 text-[12px] leading-none font-medium ${
              file?.exists ? 'bg-accent-soft text-accent' : 'bg-background-subtle text-muted'
            }`}
          >
            {file?.exists ? t('settings.projectFileExists') : t('settings.projectFileMissing')}
          </span>
          {controller.invalidJson && (
            <span className="inline-flex h-[20px] items-center rounded-full bg-danger/10 px-2 text-[12px] leading-none font-medium text-danger">
              {t('settings.projectInvalidJsonBadge')}
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
      ) : controller.loading ? (
        <PanelHint>{t('settings.loading')}</PanelHint>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t('settings.project')}
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

          {tab === 'overview' && (
            <ProjectOverviewPanel controller={controller} onOpenTab={setTab} />
          )}
          {tab === 'providers' && (
            <ProjectProvidersPanel controller={controller} onOpenRaw={() => setTab('raw')} />
          )}
          {tab === 'lsp' && <ProjectLspPanel controller={controller} />}
          {tab === 'formatters' && <ProjectFormattersPanel controller={controller} />}
          {tab === 'commands' && (
            <ProjectCommandsPanel controller={controller} onOpenRaw={() => setTab('raw')} />
          )}
          {tab === 'skills' && <ProjectSkillsPanel controller={controller} />}
          {tab === 'raw' && <ProjectRawPanel controller={controller} />}
        </>
      )}
    </div>
  )
}

export default ProjectSettings
