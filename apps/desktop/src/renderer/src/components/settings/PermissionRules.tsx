import { errorMessage } from '../../lib/errors'
import SettingsLoadError from './SettingsLoadError'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionEffect, PermissionRule, PermissionRuleAction } from '@ateam/shared'

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

const ACTIONS = Object.keys(ACTION_LABEL_KEYS) as PermissionRuleAction[]
const EFFECTS = Object.keys(EFFECT_LABEL_KEYS) as PermissionEffect[]

function PermissionRules(): React.JSX.Element {
  const { t } = useTranslation()
  const [rules, setRules] = useState<PermissionRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [removing, setRemoving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [action, setAction] = useState<PermissionRuleAction>('write')
  const [effect, setEffect] = useState<PermissionEffect>('allow')
  const [resource, setResource] = useState('')

  useEffect(() => {
    let active = true
    window.api.agent.permissions
      .rules()
      .then((next) => {
        if (active) setRules(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [reloadKey])

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
      setRules((current) => [...(current ?? []), rule])
      setResource('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setAdding(false)
    }
  }

  async function remove(rule: PermissionRule): Promise<void> {
    setRemoving(rule.id)
    setError(null)
    try {
      await window.api.agent.permissions.removeRule(rule.id)
      setRules((current) => current?.filter((entry) => entry.id !== rule.id) ?? null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setRemoving(null)
    }
  }

  if (!rules) {
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

      {rules.length === 0 ? (
        <p className="m-0 py-2 text-caption text-muted">{t('settings.noPermissionRules')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
            >
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
              <span className="flex-none text-caption text-subtle">
                {rule.sessionId
                  ? `${t('settings.permissionRuleSession')} · ${rule.sessionId.slice(0, 8)}`
                  : t('settings.permissionRuleGlobal')}
              </span>
              <button
                type="button"
                disabled={removing === rule.id}
                aria-label={`${t('settings.removePermissionRule')}: ${rule.resource}`}
                onClick={() => {
                  void remove(rule)
                }}
                className="h-7 flex-none rounded-md px-2 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
              >
                {t('settings.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

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
