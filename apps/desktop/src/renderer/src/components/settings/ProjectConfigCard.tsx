import { useTranslation } from 'react-i18next'
import { PanelError, PanelHint, primaryButtonClass } from './project/ProjectFields'
import { useProjectConfig } from './project/useProjectConfig'

/** Compact entry point shown in Agent settings; the full editor lives in Settings → Project. */
function ProjectConfigCard({ defaultDirectory }: { defaultDirectory?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const controller = useProjectConfig(defaultDirectory)
  const file = controller.file

  if (controller.error) {
    return (
      <div
        data-testid="project-config-card"
        className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
      >
        <p className="m-0 text-label font-medium text-foreground">
          {t('settings.projectConfiguration')}
        </p>
        <PanelError>{controller.error}</PanelError>
      </div>
    )
  }

  if (!file) {
    return (
      <div
        data-testid="project-config-card"
        className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2 text-caption text-muted"
      >
        {t('settings.loading')}
      </div>
    )
  }

  const errorCount =
    file.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length +
    (controller.resolved?.diagnostics.length ?? 0)
  const warnings = file.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length

  return (
    <div
      data-testid="project-config-card"
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-label font-medium text-foreground">
            {t('settings.projectConfiguration')}
          </p>
          <p className="m-0 mt-0.5 text-caption text-muted">
            {t('settings.projectConfigurationDescription')}
          </p>
        </div>
        <a
          href="#/settings?section=project"
          className={`${primaryButtonClass} inline-flex items-center`}
        >
          {t('settings.projectOpenSettings')}
        </a>
      </div>
      <p className="m-0 break-all font-mono text-caption text-muted">{file.path}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[12px] leading-none font-medium ${
            file.exists ? 'bg-accent-soft text-accent' : 'bg-background-subtle text-muted'
          }`}
        >
          {file.exists ? t('settings.projectFileExists') : t('settings.projectFileMissing')}
        </span>
        {errorCount > 0 && (
          <span className="inline-flex h-[18px] items-center rounded-full bg-danger/10 px-1.5 text-[12px] leading-none font-medium text-danger">
            {t('settings.projectDiagnosticsCount', { count: errorCount })}
          </span>
        )}
        {errorCount === 0 && warnings > 0 && (
          <span className="inline-flex h-[18px] items-center rounded-full bg-warning-soft px-1.5 text-[12px] leading-none font-medium text-warning">
            {t('settings.projectDiagnosticsCount', { count: warnings })}
          </span>
        )}
      </div>
      {file.diagnostics.length === 0 && !file.exists && (
        <PanelHint>{t('settings.projectFileMissingHint')}</PanelHint>
      )}
    </div>
  )
}

export default ProjectConfigCard
