import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type {
  GitHubContextResult,
  GitHubItemContext,
  GitHubItemKind,
  GitHubItemSummary,
  GitHubRepoInfo,
  GitHubTokenStatus
} from '@ateam/shared'
import { chatStore } from '../../chat/store'
import { errorMessage } from '../../lib/errors'
import { githubErrorMessage } from '../../lib/github-errors'

interface GitHubImportDialogProps {
  initialDirectory: string | null
  onClose: () => void
  onImported: (sessionId: string, title: string) => void
}

const MAX_TITLE_CHARS = 60

function itemRef(context: GitHubItemContext): string {
  return `${context.owner}/${context.repo}#${context.number}`
}

function sessionTitle(context: GitHubItemContext): string {
  const title = context.title.replace(/\s+/g, ' ').trim()
  return (title || itemRef(context)).slice(0, MAX_TITLE_CHARS)
}

function GitHubImportDialog({
  initialDirectory,
  onClose,
  onImported
}: GitHubImportDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [directory, setDirectory] = useState<string | null>(initialDirectory)
  const [status, setStatus] = useState<GitHubTokenStatus | null>(null)
  const [repo, setRepo] = useState<GitHubRepoInfo | null>(null)
  const [repoLoading, setRepoLoading] = useState(true)
  const [kind, setKind] = useState<GitHubItemKind>('issue')
  const [items, setItems] = useState<GitHubItemSummary[] | null>(null)
  const [refInput, setRefInput] = useState('')
  const [preview, setPreview] = useState<GitHubContextResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.github
      .status()
      .then((next) => {
        if (active) setStatus(next)
      })
      .catch(() => {
        if (active) setStatus(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    window.api.agent.github
      .repo(directory)
      .then((next) => {
        if (active) setRepo(next)
      })
      .catch(() => {
        if (active) setRepo(null)
      })
      .finally(() => {
        if (active) setRepoLoading(false)
      })
    return () => {
      active = false
    }
  }, [directory])

  const hasToken = status?.hasToken === true

  useEffect(() => {
    if (!repo || status === null || !status.hasToken) return undefined
    let active = true
    window.api.agent.github
      .list({ repo: `${repo.owner}/${repo.repo}`, kind })
      .then((next) => {
        if (active) setItems(next)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setItems([])
        setError(githubErrorMessage(caught, t))
      })
    return () => {
      active = false
    }
  }, [repo, kind, status, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function chooseDirectory(): Promise<void> {
    const picked = await window.api.workspace
      .pickDirectory(directory ?? undefined)
      .catch(() => null)
    if (!picked) return
    setDirectory(picked)
    setRepoLoading(true)
    setRepo(null)
    setItems(null)
    setPreview(null)
    setRefInput('')
    setError(null)
  }

  async function loadContext(ref: string): Promise<void> {
    const trimmed = ref.trim()
    if (!trimmed || previewing || busy) return
    setPreviewing(true)
    setError(null)
    try {
      setPreview(await window.api.agent.github.context(trimmed))
    } catch (caught) {
      setPreview(null)
      setError(githubErrorMessage(caught, t))
    } finally {
      setPreviewing(false)
    }
  }

  async function importItem(): Promise<void> {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const context = preview.context
      const title = sessionTitle(context)
      const session = await chatStore.createSession(directory)
      chatStore.setGitHubRef(session.id, itemRef(context))
      chatStore.setDraftPrompt(preview.prompt)
      try {
        await chatStore.renameSession(session.id, title)
      } catch {
        // The import still succeeds with the default session title.
      }
      onImported(session.id, title)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function stateLabel(resource: GitHubItemContext): string {
    if (resource.kind === 'pull' && resource.pull?.merged) return t('chat.githubStateMerged')
    return resource.state === 'open' ? t('chat.githubStateOpen') : t('chat.githubStateClosed')
  }

  const files = preview?.context.pull?.files ?? []
  const visibleFiles = files.slice(0, 8)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div
        aria-hidden
        onClick={() => {
          if (!busy) onClose()
        }}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.githubImportTitle')}
        data-testid="github-import-dialog"
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <header className="flex flex-none items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-title font-semibold text-foreground">
            {t('chat.githubImportTitle')}
          </h2>
          <button
            type="button"
            aria-label={t('chat.cancel')}
            disabled={busy}
            onClick={onClose}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M7 7l10 10M17 7 7 17"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
          {status && !status.hasToken && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
              <span>{t('chat.githubTokenMissing')}</span>
              <Link
                to="/settings?section=github"
                className="font-medium text-warning underline underline-offset-2"
              >
                {t('chat.githubOpenSettings')}
              </Link>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-caption font-medium text-muted">{t('chat.githubDirectory')}</span>
            <div className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-caption text-foreground"
                title={directory ?? undefined}
              >
                {directory ?? t('chat.githubDefaultDirectory')}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void chooseDirectory()
                }}
                className="h-7 flex-none rounded-md border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50"
              >
                {t('chat.githubChooseFolder')}
              </button>
            </div>
            <span className="text-caption text-subtle">
              {repoLoading
                ? t('chat.githubRepoLoading')
                : repo
                  ? t('chat.githubRepoDetected', {
                      repo: `${repo.owner}/${repo.repo}`,
                      branch: repo.branch ?? '—'
                    })
                  : t('chat.githubRepoUnknown')}
            </span>
            {!repoLoading && !repo && (
              <span className="text-caption text-subtle">{t('chat.githubRepoUnknownHint')}</span>
            )}
          </div>

          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              void loadContext(refInput)
            }}
          >
            <label className="flex flex-col gap-1 text-caption font-medium text-muted">
              {t('chat.githubRef')}
              <input
                value={refInput}
                onChange={(event) => setRefInput(event.target.value)}
                disabled={busy}
                placeholder={t('chat.githubRefPlaceholder')}
                aria-label={t('chat.githubRef')}
                className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
              />
            </label>
            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={previewing || busy || !refInput.trim()}
                className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-55"
              >
                {previewing ? t('chat.githubPreviewing') : t('chat.githubPreview')}
              </button>
            </div>
          </form>

          {repo && hasToken && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-medium text-muted">
                  {t('chat.githubRecent')}
                </span>
                <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
                  {(['issue', 'pull'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={kind === value}
                      disabled={busy}
                      onClick={() => {
                        setKind(value)
                        setItems(null)
                      }}
                      className={`h-6 rounded px-2 text-caption transition-colors ${
                        kind === value
                          ? 'bg-selected text-selected-foreground'
                          : 'text-muted hover:bg-hover hover:text-foreground'
                      }`}
                    >
                      {value === 'issue' ? t('chat.githubIssues') : t('chat.githubPulls')}
                    </button>
                  ))}
                </div>
              </div>
              {items === null ? (
                <p className="m-0 text-caption text-subtle">{t('chat.githubListLoading')}</p>
              ) : items.length > 0 ? (
                <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                  {items.map((item) => (
                    <button
                      key={item.number}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void loadContext(`${item.owner}/${item.repo}#${item.number}`)
                      }}
                      className="flex flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover disabled:opacity-55"
                    >
                      <span className="block truncate text-label text-foreground">
                        #{item.number} {item.title}
                      </span>
                      <span className="block truncate text-caption text-subtle">
                        {[item.author ? `@${item.author}` : null, item.state]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="m-0 text-caption text-subtle">{t('chat.githubListEmpty')}</p>
              )}
            </div>
          )}

          {preview && (
            <div
              data-testid="github-import-preview"
              className="flex flex-col gap-2 rounded-md border border-border-subtle bg-hover/40 px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-label font-medium text-foreground">
                  #{preview.context.number} {preview.context.title}
                </span>
                <span className="text-caption text-muted">
                  {[
                    preview.context.kind === 'pull'
                      ? t('chat.githubKindPull')
                      : t('chat.githubKindIssue'),
                    stateLabel(preview.context),
                    preview.context.author ? `@${preview.context.author}` : null,
                    t('chat.githubCommentCount', { count: preview.context.comments })
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {preview.context.labels.length > 0 && (
                  <span className="text-caption text-subtle">
                    {t('chat.githubLabels')}: {preview.context.labels.join(', ')}
                  </span>
                )}
              </div>

              {preview.context.pull && (
                <div className="flex flex-col gap-0.5 text-caption text-muted">
                  <span>
                    {t('chat.githubPullBranches', {
                      head: preview.context.pull.headBranch,
                      base: preview.context.pull.baseBranch
                    })}
                  </span>
                  <span>
                    {t('chat.githubPullStats', {
                      files: preview.context.pull.changedFiles,
                      additions: preview.context.pull.additions,
                      deletions: preview.context.pull.deletions,
                      commits: preview.context.pull.commits
                    })}
                  </span>
                  {visibleFiles.length > 0 && (
                    <span className="flex flex-col font-mono text-caption text-subtle">
                      {visibleFiles.map((file) => (
                        <span key={file.filename} className="truncate">
                          {file.filename} +{file.additions} −{file.deletions}
                        </span>
                      ))}
                      {preview.context.pull.filesTruncated && (
                        <span>{t('chat.githubPullFilesTruncated')}</span>
                      )}
                    </span>
                  )}
                </div>
              )}

              {preview.context.body && (
                <pre className="m-0 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-muted">
                  {preview.context.body}
                </pre>
              )}
              {preview.context.bodyTruncated && (
                <span className="text-caption text-subtle">{t('chat.githubBodyTruncated')}</span>
              )}
              <span className="text-caption text-subtle">{t('chat.githubImportHint')}</span>
            </div>
          )}

          {error && (
            <p role="alert" className="m-0 text-caption text-danger">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-none items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-55"
          >
            {t('chat.cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !preview}
            onClick={() => {
              void importItem()
            }}
            className="flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {busy && (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {busy ? t('chat.githubImporting') : t('chat.githubImportConfirm')}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default GitHubImportDialog
