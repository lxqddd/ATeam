import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubCommentResult } from '@ateam/shared'
import { githubErrorMessage } from '../../lib/github-errors'

interface GitHubCommentDialogProps {
  defaultRef: string | null
  defaultBody: string
  onClose: () => void
}

function GitHubCommentDialog({
  defaultRef,
  defaultBody,
  onClose
}: GitHubCommentDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [ref, setRef] = useState(defaultRef ?? '')
  const [body, setBody] = useState(defaultBody)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<GitHubCommentResult | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(): Promise<void> {
    if (busy) return
    if (!ref.trim() || !body.trim()) {
      setError(t('chat.githubCommentRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      setPosted(await window.api.agent.github.comment({ ref: ref.trim(), body }))
    } catch (caught) {
      setError(githubErrorMessage(caught, t))
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
        aria-label={t('chat.githubCommentTitle')}
        data-testid="github-comment-dialog"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <header className="flex flex-none items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-title font-semibold text-foreground">
            {t('chat.githubCommentTitle')}
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

        {posted ? (
          <div className="flex flex-col gap-3 px-4 py-3">
            <p className="m-0 text-label text-foreground">{t('chat.githubCommentDone')}</p>
            <p className="m-0 break-all font-mono text-caption text-muted">{posted.url}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            <label className="flex flex-col gap-1 text-caption font-medium text-muted">
              {t('chat.githubRef')}
              <input
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                disabled={busy}
                placeholder={t('chat.githubRefPlaceholder')}
                aria-label={t('chat.githubCommentRef')}
                className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-label text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
              />
            </label>

            <label className="flex flex-col gap-1 text-caption font-medium text-muted">
              {t('chat.githubCommentBody')}
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy}
                rows={8}
                aria-label={t('chat.githubCommentBody')}
                className="min-h-[160px] w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-caption leading-relaxed text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
              />
            </label>
            {!defaultBody && (
              <p className="m-0 text-caption text-subtle">{t('chat.githubCommentEmpty')}</p>
            )}
            {error && (
              <p role="alert" className="m-0 text-caption text-danger">
                {error}
              </p>
            )}
          </div>
        )}

        <footer className="flex flex-none items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          {posted ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void window.api.openExternal(posted.url).catch(() => undefined)
                }}
                className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover"
              >
                {t('chat.githubCommentOpen')}
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
                disabled={busy}
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
                {busy ? t('chat.githubCommentSubmitting') : t('chat.githubCommentSubmit')}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

export default GitHubCommentDialog
