import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionExportFormat, SessionExportResult } from '@ateam/shared'
import { errorMessage } from '../../lib/errors'

type ExportScope = 'current' | 'all'

interface ExportDialogProps {
  initialScope: ExportScope
  sessionId: string | null
  onClose: () => void
  onExported: (result: SessionExportResult) => void
}

const FORMATS: SessionExportFormat[] = ['json', 'jsonl', 'markdown']

function ExportDialog({
  initialScope,
  sessionId,
  onClose,
  onExported
}: ExportDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [scope, setScope] = useState<ExportScope>(sessionId ? initialScope : 'all')
  const [format, setFormat] = useState<SessionExportFormat>('json')
  const [redactPaths, setRedactPaths] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function runExport(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.agent.sessions.export({
        sessionId: scope === 'current' ? sessionId : null,
        format,
        redactPaths
      })
      // A cancelled save dialog keeps this dialog open so options stay editable.
      if (result.saved) onExported(result)
    } catch (caught) {
      setError(errorMessage(caught))
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
        aria-label={t('chat.exportDialogTitle')}
        data-testid="export-dialog"
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <header className="flex flex-none items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-title font-semibold text-foreground">
            {t('chat.exportDialogTitle')}
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

        <div className="flex flex-col gap-4 px-4 py-3">
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 text-caption font-medium text-muted">
              {t('chat.exportScope')}
            </legend>
            <label className="flex items-center gap-2 text-label text-foreground">
              <input
                type="radio"
                name="export-scope"
                checked={scope === 'current'}
                disabled={!sessionId || busy}
                onChange={() => setScope('current')}
              />
              {t('chat.exportScopeCurrent')}
            </label>
            <label className="flex items-center gap-2 text-label text-foreground">
              <input
                type="radio"
                name="export-scope"
                checked={scope === 'all'}
                disabled={busy}
                onChange={() => setScope('all')}
              />
              {t('chat.exportScopeAll')}
            </label>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 text-caption font-medium text-muted">
              {t('chat.exportFormat')}
            </legend>
            {FORMATS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-label text-foreground">
                <input
                  type="radio"
                  name="export-format"
                  checked={format === value}
                  disabled={busy}
                  onChange={() => setFormat(value)}
                />
                {t(`chat.exportFormat_${value}`)}
              </label>
            ))}
          </fieldset>

          <label className="flex items-start gap-2 text-label text-foreground">
            <input
              type="checkbox"
              checked={redactPaths}
              disabled={busy}
              onChange={(event) => setRedactPaths(event.target.checked)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              {t('chat.exportRedactPaths')}
              <span className="text-caption text-subtle">{t('chat.exportRedactPathsHint')}</span>
            </span>
          </label>

          <p className="m-0 rounded-md bg-hover px-2.5 py-2 text-caption text-muted">
            {t('chat.exportNotice')}
          </p>

          {error && (
            <p className="m-0 text-caption text-danger">
              {t('chat.exportFailed')}: {error}
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
            disabled={busy}
            onClick={() => {
              void runExport()
            }}
            className="flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {busy && (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {busy ? t('chat.exportBusy') : t('chat.exportConfirm')}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ExportDialog
