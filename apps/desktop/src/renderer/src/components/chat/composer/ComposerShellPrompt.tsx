import { useTranslation } from 'react-i18next'
import type { PendingShell } from './useCommandMenu'

interface ComposerShellPromptProps {
  pending: PendingShell
  sending: boolean
  onRun: () => void
  onCancel: () => void
}

function ComposerShellPrompt({
  pending,
  sending,
  onRun,
  onCancel
}: ComposerShellPromptProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      role="alertdialog"
      aria-label={t('chat.commandShellTitle')}
      className="mb-2 rounded-md border border-warning/40 bg-warning/10 p-3"
    >
      <p className="m-0 text-label font-medium text-foreground">{t('chat.commandShellTitle')}</p>
      <p className="mb-2 mt-1 text-caption text-muted">{t('chat.commandShellHint')}</p>
      <ul className="mb-2 max-h-32 list-none overflow-y-auto p-0 font-mono text-caption text-foreground">
        {pending.snippets.map((snippet, index) => (
          <li key={`${index}-${snippet}`} className="truncate">
            {snippet}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={sending}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {t('chat.commandShellRun')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover"
        >
          {t('chat.commandShellCancel')}
        </button>
      </div>
    </div>
  )
}

export default ComposerShellPrompt
