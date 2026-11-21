import { useTranslation } from 'react-i18next'
import type { BackgroundResult } from '@ateam/shared'
import { chatStore } from '../../chat/store'

interface BackgroundNoticesProps {
  results: BackgroundResult[]
}

function BackgroundNotices({ results }: BackgroundNoticesProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (results.length === 0) return null

  return (
    <div className="mx-auto flex w-full max-w-[768px] flex-col gap-1 px-4 pb-2">
      {results.map((result) => (
        <div
          key={result.toolCallId}
          className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success-soft px-3 py-1.5 text-caption text-success"
        >
          <span className="font-medium">{t('chat.backgroundFinished')}</span>
          <code className="max-w-[280px] truncate text-muted" title={result.command}>
            {result.command}
          </code>
          {result.exitCode !== null && (
            <span>{t('chat.backgroundExit', { code: result.exitCode })}</span>
          )}
          {result.outputPath && (
            <span className="min-w-0 max-w-[260px] truncate text-muted" title={result.outputPath}>
              {result.outputPath}
            </span>
          )}
          <button
            type="button"
            aria-label={t('chat.dismiss')}
            onClick={() => chatStore.dismissBackgroundResult(result.toolCallId)}
            className="ml-auto rounded px-1 text-caption transition-colors hover:bg-success/10"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default BackgroundNotices
