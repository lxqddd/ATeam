import { errorMessage } from '../../lib/errors'
import SettingsLoadError from './SettingsLoadError'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentDefinition,
  PermissionEffect,
  PermissionRuleGroupView,
  PermissionRuleSource,
  PermissionRuleView,
  PermissionRuleAction,
  PermissionRulesOverview
} from '@ateam/shared'
import { useChatStore } from '../../chat/store'

const ACTION_LABEL_KEYS: Record<PermissionRuleAction, string> = {
  read: 'chat.permissionRead',
  list: 'chat.permissionList',
  glob: 'settings.permissionActionGlob',
  grep: 'chat.permissionGrep',
  write: 'chat.permissionWrite',
  edit: 'chat.permissionEdit',
  shell: 'chat.permissionShell',
  external_directory: 'settings.permissionActionExternalDirectory',
  mcp: 'settings.permissionActionMcp',
  webfetch: 'settings.permissionActionWebfetch',
  websearch: 'settings.permissionActionWebsearch',
  lsp: 'settings.permissionActionLsp',
  skill: 'settings.permissionActionSkill',
  subagent: 'settings.permissionActionSubagent',
  plugin: 'settings.permissionActionPlugin',
  '*': 'settings.permissionActionAll'
}

const EFFECT_LABEL_KEYS: Record<PermissionEffect, string> = {
  allow: 'settings.permissionEffectAllow',
  ask: 'settings.permissionEffectAsk',
  deny: 'settings.permissionEffectDeny'
}

const EFFECT_CLASS: Record<PermissionEffect, string> = {
  allow: 'bg-success-soft text-success',
  ask: 'bg-warning-soft text-warning',
  deny: 'bg-danger/10 text-danger'
}

const SOURCE_LABEL_KEYS: Record<PermissionRuleSource, string> = {
  'global-persisted': 'settings.permissionSourceGlobalPersisted',
  'global-config': 'settings.permissionSourceGlobalConfig',
  'project-config': 'settings.permissionSourceProjectConfig',
  agent: 'settings.permissionSourceAgent',
  'session-persisted': 'settings.permissionSourceSessionPersisted',
  policy: 'settings.permissionSourcePolicy'
}

const AGENT_SOURCE_LABEL_KEYS: Record<AgentDefinition['source'], string> = {
  builtin: 'settings.permissionAgentBuiltin',
  user: 'settings.permissionAgentUser',
  project: 'settings.permissionAgentProject'
}

const ACTIONS = Object.keys(ACTION_LABEL_KEYS) as PermissionRuleAction[]
const EFFECTS = Object.keys(EFFECT_LABEL_KEYS) as PermissionEffect[]

function PermissionRuleRow({
  rule,
  onRemove,
  removing
}: {
  rule: PermissionRuleView
  onRemove?: () => void
  removing: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2">
      <span className="text-label font-medium text-foreground">
        {t(ACTION_LABEL_KEYS[rule.action])}
      </span>
      <span
        className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[12px] leading-none font-medium ${EFFECT_CLASS[rule.effect]}`}
      >
        {t(EFFECT_LABEL_KEYS[rule.effect])}
      </span>
      <code
        className="min-w-0 flex-1 truncate font-mono text-caption text-muted"
        title={rule.resource}
      >
        {rule.resource}
      </code>
      {rule.sessionId && (
        <span className="flex-none text-caption text-subtle">
          {t('settings.permissionRuleSession')} · {rule.sessionId.slice(0, 8)}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          disabled={removing}
          aria-label={`${t('settings.removePermissionRule')}: ${rule.resource}`}
          onClick={onRemove}
          className="h-7 flex-none rounded-md px-2 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {t('settings.delete')}
        </button>
      )}
    </li>
  )
}

function PermissionLayer({
  group,
  index,
  removing,
  onRemove
}: {
  group: PermissionRuleGroupView
  index: number
  removing: string | null
  onRemove: (groupIndex: number, rule: PermissionRuleView) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-2 border-border-subtle pb-4 not-last:border-b">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-label font-semibold text-foreground">
          {t(SOURCE_LABEL_KEYS[group.source])}
        </h3>
        {!group.editable && (
          <span className="inline-flex h-[18px] items-center rounded-full bg-neutral-soft px-1.5 text-[11px] leading-none font-medium text-neutral">
            {t('settings.permissionReadOnly')}
          </span>
        )}
        {group.agentName && (
          <span className="text-caption text-muted">
            {group.agentName} · {t(AGENT_SOURCE_LABEL_KEYS[group.agentSource ?? 'builtin'])}
          </span>
        )}
        {group.path && (
          <code
            className="min-w-0 flex-1 truncate text-right font-mono text-caption text-subtle"
            title={group.path}
          >
            {group.path}
          </code>
        )}
      </header>
      {group.rules.length === 0 ? (
        <p className="m-0 text-caption text-subtle">{t('settings.permissionLayerEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {group.rules.map((rule) => (
            <PermissionRuleRow
              key={rule.id}
              rule={rule}
              removing={removing === rule.id}
              {...(group.editable ? { onRemove: () => onRemove(index, rule) } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function PermissionRules(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, configRevision } = useChatStore()
  const selected = sessions.find((session) => session.id === selectedSessionId)
  const [defaultDirectory, setDefaultDirectory] = useState<string | null>(null)
  const directory = selected?.directory ?? defaultDirectory
  const [overview, setOverview] = useState<PermissionRulesOverview | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [removing, setRemoving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [action, setAction] = useState<PermissionRuleAction>('write')
  const [effect, setEffect] = useState<PermissionEffect>('allow')
  const [resource, setResource] = useState('')

  useEffect(() => {
    let active = true
    window.api.agent.info().then(
      (info) => {
        if (active) setDefaultDirectory(info.workspacePath)
      },
      () => undefined
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    window.api.agent.permissions
      .overview(directory)
      .then((next) => {
        if (!active) return
        setOverview(next)
        setDegraded(false)
        setError(null)
      })
      .catch((caught: unknown) => {
        // An older worker without the overview method must still show the
        // rules the app can actually edit.
        window.api.agent.permissions
          .rules()
          .then((rules) => {
            if (!active) return
            setOverview({
              workspace: directory ?? '',
              groups: [
                {
                  source: 'global-persisted',
                  editable: true,
                  rules: rules.filter((rule) => rule.sessionId === null)
                },
                {
                  source: 'session-persisted',
                  editable: true,
                  rules: rules.filter((rule) => rule.sessionId !== null)
                }
              ]
            })
            setDegraded(true)
            setError(null)
          })
          .catch(() => {
            if (active) setError(errorMessage(caught))
          })
      })
    return () => {
      active = false
    }
  }, [directory, reloadKey, configRevision])

  function replaceGroupRules(
    state: PermissionRulesOverview,
    groupIndex: number,
    update: (rules: PermissionRuleView[]) => PermissionRuleView[]
  ): PermissionRulesOverview {
    return {
      ...state,
      groups: state.groups.map((group, index) =>
        index === groupIndex ? { ...group, rules: update(group.rules) } : group
      )
    }
  }

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const value = resource.trim()
    if (!value || adding) return
    setAdding(true)
    setError(null)
    try {
      const rule = await window.api.agent.permissions.addRule({
        action,
        resource: value,
        effect,
        sessionId: null
      })
      setOverview((current) => {
        if (!current) return current
        const index = current.groups.findIndex((group) => group.source === 'global-persisted')
        if (index < 0) return current
        return replaceGroupRules(current, index, (rules) => [
          ...rules,
          {
            id: rule.id,
            action: rule.action,
            resource: rule.resource,
            effect: rule.effect,
            sessionId: rule.sessionId
          }
        ])
      })
      setResource('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setAdding(false)
    }
  }

  async function remove(groupIndex: number, rule: PermissionRuleView): Promise<void> {
    setRemoving(rule.id)
    setError(null)
    try {
      await window.api.agent.permissions.removeRule(rule.id)
      setOverview((current) =>
        current
          ? replaceGroupRules(current, groupIndex, (rules) =>
              rules.filter((entry) => entry.id !== rule.id)
            )
          : current
      )
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setRemoving(null)
    }
  }

  if (!overview) {
    return error ? (
      <SettingsLoadError
        message={error}
        onRetry={() => {
          setError(null)
          setReloadKey((value) => value + 1)
        }}
      />
    ) : (
      <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      {degraded && (
        <p role="status" className="m-0 text-caption text-muted">
          {t('settings.permissionOverviewUnavailable')}
        </p>
      )}

      <div className="flex flex-col">
        {overview.groups.map((group, index) => (
          <PermissionLayer
            key={`${group.source}-${group.agentId ?? index}`}
            group={group}
            index={index}
            removing={removing}
            onRemove={(groupIndex, rule) => {
              void remove(groupIndex, rule)
            }}
          />
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void add(event)}>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {t('settings.permissionAction')}
          <select
            aria-label={t('settings.permissionAction')}
            value={action}
            onChange={(event) => setAction(event.target.value as PermissionRuleAction)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none"
          >
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {t(ACTION_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-caption text-muted">
          {t('settings.permissionResource')}
          <input
            aria-label={t('settings.permissionResource')}
            value={resource}
            onChange={(event) => setResource(event.target.value)}
            placeholder={t('settings.permissionResourcePlaceholder')}
            className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {t('settings.permissionEffect')}
          <select
            aria-label={t('settings.permissionEffect')}
            value={effect}
            onChange={(event) => setEffect(event.target.value as PermissionEffect)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none"
          >
            {EFFECTS.map((value) => (
              <option key={value} value={value}>
                {t(EFFECT_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={adding || !resource.trim()}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
        >
          {adding ? t('settings.saving') : t('settings.addPermissionRule')}
        </button>
      </form>
    </div>
  )
}

export default PermissionRules
