import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionAction, PermissionDecision, PermissionRequest } from '@ateam/shared'
import { chatStore } from '../../chat/store'

const ACTION_LABEL: Record<PermissionAction, string> = {
  read: 'chat.permissionRead',
  list: 'chat.permissionList',
  grep: 'chat.permissionGrep',
  write: 'chat.permissionWrite',
  edit: 'chat.permissionEdit',
  shell: 'chat.permissionShell',
  external_directory: 'chat.permissionExternalDirectory'
}

interface PermissionCardProps {
  request: PermissionRequest
}

function PermissionCard({ request }: PermissionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<PermissionDecision | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reply(decision: PermissionDecision): Promise<void> {
    setBusy(decision)
    setError(null)
    try {
      await chatStore.replyPermission(request.id, decision)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-warning/45 bg-warning/10 px-3.5 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="text-warning"
        >
          <path
            d="M12 3.5 21 20H3L12 3.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M12 9.5v4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="17" r="0.9" fill="currentColor" />
        </svg>
        <span className="text-body font-semibold text-foreground">{t('chat.permissionTitle')}</span>
        <span className="text-caption text-warning">{t(ACTION_LABEL[request.action])}</span>
        <span className="ml-auto text-caption text-subtle">{request.toolName}</span>
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-warning/30 bg-surface/70 px-2.5 py-1.5">
        <span className="flex-none text-caption text-subtle">{t('chat.toolInput')}</span>
        <code
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
          title={request.resource}
        >
          {request.resource}
        </code>
      </div>

      {error && <p className="mt-2 text-caption text-danger">{error}</p>}

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void reply('reject')
          }}
          className="h-8 rounded-md px-3 text-label font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {t('chat.permissionDeny')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void reply('always')
          }}
          className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50"
        >
          {t('chat.permissionAlways')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void reply('once')
          }}
          className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === 'once' ? t('settings.loading') : t('chat.permissionAllow')}
        </button>
      </div>
    </div>
  )
}

export default PermissionCard
