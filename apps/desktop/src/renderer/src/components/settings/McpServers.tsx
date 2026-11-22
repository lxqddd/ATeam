import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpServerConfig, McpServerInput, McpServerStatus, McpServerType } from '@ateam/shared'

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseKeyValue(text: string, separator: ':' | '='): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf(separator)
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    if (key) result[key] = value
  }
  return result
}

const STATUS_CLASS: Record<string, string> = {
  idle: 'bg-background-subtle text-muted',
  connecting: 'bg-warning-soft text-warning',
  connected: 'bg-success-soft text-success',
  failed: 'bg-danger/10 text-danger'
}

function McpServers(): React.JSX.Element {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpServerConfig[] | null>(null)
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<McpServerType>('local')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [envText, setEnvText] = useState('')
  const [enabled, setEnabled] = useState(true)

  async function reload(): Promise<void> {
    const next = await window.api.agent.mcp.list()
    setServers(next.servers)
    setStatuses(next.statuses)
  }

  useEffect(() => {
    let active = true
    window.api.agent.mcp
      .list()
      .then((next) => {
        if (!active) return
        setServers(next.servers)
        setStatuses(next.statuses)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      active = false
    }
  }, [])

  function resetForm(): void {
    setEditingId(null)
    setName('')
    setType('local')
    setCommand('')
    setArgsText('')
    setUrl('')
    setHeadersText('')
    setEnvText('')
    setEnabled(true)
  }

  function startEdit(server: McpServerConfig): void {
    setEditingId(server.id)
    setName(server.name)
    setType(server.type)
    setCommand(server.command ?? '')
    setArgsText(server.args.join('\n'))
    setUrl(server.url ?? '')
    setHeadersText(
      Object.entries(server.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
    )
    setEnvText(
      Object.entries(server.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    )
    setEnabled(server.enabled)
  }

  function buildInput(): McpServerInput {
    return {
      name: name.trim(),
      type,
      command: type === 'local' ? command.trim() : null,
      args: type === 'local' ? parseLines(argsText) : [],
      url: type === 'remote' ? url.trim() : null,
      headers: type === 'remote' ? parseKeyValue(headersText, ':') : {},
      env: type === 'local' ? parseKeyValue(envText, '=') : {},
      enabled
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        const updated = await window.api.agent.mcp.update(editingId, buildInput())
        setServers((current) =>
          current
            ? current.map((server) => (server.id === updated.id ? updated : server))
            : [updated]
        )
      } else {
        await window.api.agent.mcp.add(buildInput())
        await reload()
      }
      resetForm()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  async function toggle(server: McpServerConfig, next: boolean): Promise<void> {
    setError(null)
    try {
      const updated = await window.api.agent.mcp.update(server.id, { enabled: next })
      setServers((current) =>
        current ? current.map((entry) => (entry.id === updated.id ? updated : entry)) : null
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function remove(server: McpServerConfig): Promise<void> {
    setRemoving(server.id)
    setError(null)
    try {
      await window.api.agent.mcp.remove(server.id)
      setServers((current) => current?.filter((entry) => entry.id !== server.id) ?? null)
      setStatuses((current) => current.filter((entry) => entry.id !== server.id))
      if (editingId === server.id) resetForm()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRemoving(null)
    }
  }

  async function refreshStatuses(): Promise<void> {
    setProbing(true)
    setError(null)
    try {
      setStatuses(await window.api.agent.mcp.statuses({ probe: true }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setProbing(false)
    }
  }

  function statusLabel(status: McpServerStatus | undefined): string {
    if (!status || status.state === 'idle') return t('settings.mcpStatusIdle')
    if (status.state === 'connecting') return t('settings.mcpStatusConnecting')
    if (status.state === 'failed') return t('settings.mcpStatusFailed')
    const parts = [
      t('settings.mcpStatusConnected'),
      t('settings.mcpToolsCount', { count: status.toolCount })
    ]
    if (status.promptCount > 0) {
      parts.push(t('settings.mcpPromptsCount', { count: status.promptCount }))
    }
    if (status.resourceCount > 0) {
      parts.push(t('settings.mcpResourcesCount', { count: status.resourceCount }))
    }
    return parts.join(' · ')
  }

  if (!servers) {
    return <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={probing}
          onClick={() => {
            void refreshStatuses()
          }}
          className="h-7 rounded-md border border-border px-2 text-caption font-medium text-foreground transition-colors hover:bg-background-subtle disabled:opacity-55"
        >
          {probing ? t('settings.mcpRefreshing') : t('settings.mcpRefreshStatus')}
        </button>
      </div>

      {servers.length === 0 ? (
        <p className="m-0 py-2 text-caption text-muted">{t('settings.mcpEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {servers.map((server) => {
            const status = statuses.find((entry) => entry.id === server.id)
            return (
              <li
                key={server.id}
                className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label font-medium text-foreground">{server.name}</span>
                  <span className="inline-flex h-[18px] items-center rounded-full bg-surface px-1.5 text-[12px] leading-none font-medium text-muted">
                    {server.type === 'local'
                      ? t('settings.mcpTypeLocal')
                      : t('settings.mcpTypeRemote')}
                  </span>
                  <span
                    className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[12px] leading-none font-medium ${
                      STATUS_CLASS[status?.state ?? 'idle'] ?? STATUS_CLASS.idle
                    }`}
                  >
                    {statusLabel(status)}
                  </span>
                  <code
                    className="min-w-0 flex-1 truncate font-mono text-caption text-muted"
                    title={server.type === 'local' ? (server.command ?? '') : (server.url ?? '')}
                  >
                    {server.type === 'local' ? server.command : server.url}
                  </code>
                  <label className="flex flex-none items-center gap-1.5 text-caption text-muted">
                    <input
                      type="checkbox"
                      aria-label={`${t('settings.mcpEnabled')}: ${server.name}`}
                      checked={server.enabled}
                      onChange={(event) => {
                        void toggle(server, event.target.checked)
                      }}
                      className="h-4 w-4 accent-accent"
                    />
                    {t('settings.mcpEnabled')}
                  </label>
                  <button
                    type="button"
                    onClick={() => startEdit(server)}
                    className="h-7 flex-none rounded-md px-2 text-caption font-medium text-foreground transition-colors hover:bg-background-subtle"
                  >
                    {t('settings.mcpEdit')}
                  </button>
                  <button
                    type="button"
                    disabled={removing === server.id}
                    onClick={() => {
                      void remove(server)
                    }}
                    className="h-7 flex-none rounded-md px-2 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                  >
                    {t('settings.mcpDelete')}
                  </button>
                </div>
                {status?.state === 'failed' && status.error && (
                  <p className="m-0 text-caption text-danger">{status.error}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void submit(event)}>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-caption text-muted">
          {t('settings.mcpName')}
          <input
            aria-label={t('settings.mcpName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-full rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {t('settings.mcpType')}
          <select
            aria-label={t('settings.mcpType')}
            value={type}
            onChange={(event) => setType(event.target.value as McpServerType)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none"
          >
            <option value="local">{t('settings.mcpTypeLocal')}</option>
            <option value="remote">{t('settings.mcpTypeRemote')}</option>
          </select>
        </label>

        {type === 'local' ? (
          <>
            <label className="flex min-w-[140px] flex-col gap-1 text-caption text-muted">
              {t('settings.mcpCommand')}
              <input
                aria-label={t('settings.mcpCommand')}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                className="h-8 rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle"
              />
            </label>
            <label className="flex min-w-[220px] flex-[2] flex-col gap-1 text-caption text-muted">
              {t('settings.mcpArgs')}
              <textarea
                aria-label={t('settings.mcpArgs')}
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                rows={2}
                placeholder={t('settings.mcpArgsPlaceholder')}
                className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-caption text-foreground outline-none placeholder:text-subtle"
              />
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-caption text-muted">
              {t('settings.mcpEnv')}
              <textarea
                aria-label={t('settings.mcpEnv')}
                value={envText}
                onChange={(event) => setEnvText(event.target.value)}
                rows={2}
                placeholder={t('settings.mcpEnvPlaceholder')}
                className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-caption text-foreground outline-none placeholder:text-subtle"
              />
            </label>
          </>
        ) : (
          <>
            <label className="flex min-w-[220px] flex-[2] flex-col gap-1 text-caption text-muted">
              {t('settings.mcpUrl')}
              <input
                aria-label={t('settings.mcpUrl')}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle"
              />
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-caption text-muted">
              {t('settings.mcpHeaders')}
              <textarea
                aria-label={t('settings.mcpHeaders')}
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                rows={2}
                placeholder={t('settings.mcpHeadersPlaceholder')}
                className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-caption text-foreground outline-none placeholder:text-subtle"
              />
            </label>
          </>
        )}

        <label className="flex h-8 items-center gap-1.5 text-caption text-muted">
          <input
            type="checkbox"
            aria-label={t('settings.mcpEnabled')}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          {t('settings.mcpEnabled')}
        </label>

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
        >
          {saving ? t('settings.saving') : editingId ? t('settings.mcpSave') : t('settings.mcpAdd')}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={resetForm}
            className="h-8 rounded-md px-3 text-label font-medium text-muted transition-colors hover:bg-background-subtle"
          >
            {t('settings.mcpCancel')}
          </button>
        )}
      </form>
    </div>
  )
}

export default McpServers
