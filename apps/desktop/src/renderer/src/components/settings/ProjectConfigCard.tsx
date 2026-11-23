import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigFieldSource, ConfigProvenance, EffectiveAgentConfig } from '@ateam/shared'
import { useChatStore } from '../../chat/store'
import { errorMessage } from '../../lib/errors'

const FIELD_KEYS: Array<keyof ConfigProvenance> = [
  'snapshots',
  'instructions',
  'lsp',
  'formatters',
  'references',
  'permissions',
  'mcp',
  'agents',
  'providers',
  'plugins',
  'commands',
  'skills'
]

function sourceClass(source: ConfigFieldSource): string {
  return {
    global: 'bg-neutral-soft text-neutral',
    project: 'bg-accent-soft text-accent',
    merged: 'bg-warning-soft text-warning',
    default: 'bg-background-subtle text-muted'
  }[source]
}

function ProjectConfigCard({ defaultDirectory }: { defaultDirectory?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId } = useChatStore()
  const selected = sessions.find((session) => session.id === selectedSessionId)
  const directory = selected?.directory ?? defaultDirectory
  const [resolved, setResolved] = useState<EffectiveAgentConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.config
      .resolve(directory)
      .then((next) => {
        if (active) {
          setResolved(next)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [directory])

  if (error) {
    return (
      <div
        data-testid="project-config-card"
        className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
      >
        <p className="m-0 text-label font-medium text-foreground">
          {t('settings.projectConfiguration')}
        </p>
        <p role="alert" className="m-0 mt-1 text-caption text-danger">
          {error}
        </p>
      </div>
    )
  }

  if (!resolved) {
    return (
      <div
        data-testid="project-config-card"
        className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2 text-caption text-muted"
      >
        {t('settings.loading')}
      </div>
    )
  }

  const config = resolved.config
  const values: Record<keyof ConfigProvenance, string> = {
    snapshots: config.snapshots ? t('settings.enabled') : t('settings.disabled'),
    instructions: String(config.instructions.length),
    lsp: `${config.lsp ? t('settings.enabled') : t('settings.disabled')} · ${Object.keys(config.lspServers ?? {}).length}`,
    formatters: `${config.formatters ? t('settings.enabled') : t('settings.disabled')} · ${Object.keys(config.formatterServers ?? {}).length}`,
    references: (config.references ?? []).map((reference) => reference.alias).join(', ') || '—',
    permissions: String(config.permissionRules?.length ?? 0),
    mcp: (config.mcpServers ?? []).map((server) => server.name).join(', ') || '—',
    agents: String(config.agents?.length ?? 0),
    providers: Object.keys(config.providers ?? {}).join(', ') || '—',
    plugins: String(config.plugins?.length ?? 0),
    commands: (config.commands ?? []).map((command) => command.name).join(', ') || '—',
    skills: (config.skills ?? []).length > 0 ? String(config.skills?.length) : '—'
  }
  const labels: Record<keyof ConfigProvenance, string> = {
    snapshots: t('settings.snapshots'),
    instructions: t('settings.instructions'),
    lsp: t('settings.lsp'),
    formatters: t('settings.formatters'),
    references: t('settings.references'),
    permissions: t('settings.permissionRules'),
    mcp: t('settings.mcpServers'),
    agents: t('settings.agents'),
    providers: t('settings.configuredProviders'),
    plugins: t('settings.plugins'),
    commands: t('settings.configuredCommands'),
    skills: t('settings.configuredSkills')
  }
  const sourceLabels: Record<ConfigFieldSource, string> = {
    global: t('settings.sourceGlobal'),
    project: t('settings.sourceProject'),
    merged: t('settings.sourceMerged'),
    default: t('settings.sourceDefault')
  }
  const projectPath = resolved.sources.projectConfigPath

  return (
    <div
      data-testid="project-config-card"
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-3"
    >
      <div>
        <p className="m-0 text-label font-medium text-foreground">
          {t('settings.projectConfiguration')}
        </p>
        <p className="m-0 mt-0.5 text-caption text-muted">
          {t('settings.projectConfigurationDescription')}
        </p>
      </div>
      <div className="text-caption text-muted">
        <p className="m-0 break-all font-mono">
          {projectPath ?? t('settings.projectConfigMissing')}
        </p>
        <p className="m-0 mt-0.5 break-all">
          {t('settings.projectConfigRoot')}:{' '}
          <span className="font-mono">{resolved.sources.projectRoot}</span>
        </p>
      </div>
      {resolved.diagnostics.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2">
          <p className="m-0 text-caption font-medium text-warning">
            {t('settings.projectConfigErrors')}
          </p>
          <ul className="m-0 mt-1 list-disc pl-4 text-caption text-warning">
            {resolved.diagnostics.slice(0, 8).map((diagnostic, index) => (
              <li key={`${diagnostic.source}:${diagnostic.path}:${index}`}>
                <span className="font-mono">{diagnostic.path}</span>: {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-border-subtle">
        <table className="w-full text-caption">
          <thead className="bg-background-subtle text-muted">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-medium">{t('settings.configField')}</th>
              <th className="px-2.5 py-1.5 text-left font-medium">{t('settings.configSource')}</th>
              <th className="px-2.5 py-1.5 text-left font-medium">
                {t('settings.effectiveConfig')}
              </th>
            </tr>
          </thead>
          <tbody>
            {FIELD_KEYS.map((key) => (
              <tr key={key} className="border-t border-border-subtle">
                <td className="px-2.5 py-1.5 text-foreground">{labels[key]}</td>
                <td className="px-2.5 py-1.5">
                  <span
                    className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium ${sourceClass(resolved.provenance[key])}`}
                  >
                    {sourceLabels[resolved.provenance[key]]}
                  </span>
                </td>
                <td
                  className="max-w-[280px] truncate px-2.5 py-1.5 font-mono text-muted"
                  title={values[key]}
                >
                  {values[key]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ProjectConfigCard
