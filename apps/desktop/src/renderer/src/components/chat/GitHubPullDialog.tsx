import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubCreatePullResult } from '@ateam/shared'
import { githubErrorCode, githubErrorMessage } from '../../lib/github-errors'

interface GitHubPullDialogProps {
  directory: string | null
  defaultTitle: string
  defaultBody: string
  onClose: () => void
}

function GitHubPullDialog({
  directory,
  defaultTitle,
  defaultBody,
  onClose
}: GitHubPullDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [repository, setRepository] = useState('')
  const [base, setBase] = useState('main')
  const [head, setHead] = useState('')
  const [title, setTitle] = useState(defaultTitle)
  const [body, setBody] = useState(defaultBody)
  const [draft, setDraft] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<GitHubCreatePullResult | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.github
      .repo(directory)
      .then((info) => {
        if (!active || !info) return
        setRepository(`${info.owner}/${info.repo}`)
        setBase(info.defaultBranch ?? 'main')
        setHead(info.branch ?? '')
      })
      .catch(() => {
        // Repository detection is best-effort; the fields stay editable.
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [directory])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(): Promise<void> {
    if (busy) return
    if (!repository.trim() || !base.trim() || !head.trim() || !title.trim()) {
      setError(t('chat.githubPullRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      setCreated(
        await window.api.agent.github.createPull({
          repo: repository.trim(),
          title: title.trim(),
          body,
          base: base.trim(),
          head: head.trim(),
          draft
        })
      )
    } catch (caught) {
      setError(
        githubErrorCode(caught) === 'GITHUB_UNPROCESSABLE'
          ? t('chat.githubPullUnprocessable')
          : githubErrorMessage(caught, t)
      )
    } finally {
      setBusy(false)
    }
  }

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
        aria-label={t('chat.githubPullTitle')}
        data-testid="github-pull-dialog"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <header className="flex flex-none items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-title font-semibold text-foreground">{t('chat.githubPullTitle')}</h2>
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

        {created ? (
          <div className="flex flex-col gap-3 px-4 py-3">
            <p className="m-0 text-label text-foreground">
              {t('chat.githubPullDone', { number: created.number })}
            </p>
            <p className="m-0 break-all font-mono text-caption text-muted">{created.url}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {loading ? (
              <p className="m-0 text-caption text-subtle">{t('settings.loading')}</p>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-caption font-medium text-muted">
                  {t('chat.githubPullRepo')}
                  <input
                    value={repository}
                    onChange={(event) => setRepository(event.target.value)}
                    disabled={busy}
                    placeholder="owner/repo"
                    aria-label={t('chat.githubPullRepo')}
                    className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
                  />
                </label>

                <div className="flex gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption font-medium text-muted">
                    {t('chat.githubPullBase')}
                    <input
                      value={base}
                      onChange={(event) => setBase(event.target.value)}
                      disabled={busy}
                      aria-label={t('chat.githubPullBase')}
                      className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none focus:border-border-strong"
                    />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption font-medium text-muted">
                    {t('chat.githubPullHead')}
                    <input
                      value={head}
                      onChange={(event) => setHead(event.target.value)}
                      disabled={busy}
                      aria-label={t('chat.githubPullHead')}
                      className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none focus:border-border-strong"
                    />
                  </label>
                </div>
                <p className="m-0 text-caption text-subtle">{t('chat.githubPullHeadHint')}</p>

                <label className="flex flex-col gap-1 text-caption font-medium text-muted">
                  {t('chat.githubPullTitleField')}
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={busy}
                    aria-label={t('chat.githubPullTitleField')}
                    className="h-8 w-full rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none focus:border-border-strong"
                  />
                </label>

                <label className="flex flex-col gap-1 text-caption font-medium text-muted">
                  {t('chat.githubPullBody')}
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    disabled={busy}
                    rows={6}
                    aria-label={t('chat.githubPullBody')}
                    className="min-h-[120px] w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-caption leading-relaxed text-foreground outline-none focus:border-border-strong"
                  />
                </label>

                <label className="flex items-center gap-2 text-label text-foreground">
                  <input
                    type="checkbox"
                    checked={draft}
                    disabled={busy}
                    onChange={(event) => setDraft(event.target.checked)}
                  />
                  {t('chat.githubPullDraft')}
                </label>

                {error && (
                  <p role="alert" className="m-0 text-caption text-danger">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <footer className="flex flex-none items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          {created ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void window.api.openExternal(created.url).catch(() => undefined)
                }}
                className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover"
              >
                {t('chat.githubPullOpen')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                {t('chat.planClose')}
              </button>
            </>
          ) : (
            <>
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
                disabled={busy || loading}
                onClick={() => {
                  void submit()
                }}
                className="flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
              >
                {busy && (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {busy ? t('chat.githubPullSubmitting') : t('chat.githubPullSubmit')}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

export default GitHubPullDialog
