import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessagePart, ToolState } from '@ateam/shared'

type ToolPart = Extract<MessagePart, { type: 'tool' }>

const STATE_LABEL: Record<ToolState, string> = {
  pending: 'chat.toolPending',
  'awaiting-approval': 'chat.toolWaiting',
  running: 'chat.toolRunning',
  completed: 'chat.toolCompleted',
  failed: 'chat.toolFailed',
  denied: 'chat.toolDenied'
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  if (typeof record.command === 'string') return record.command
  if (typeof record.path === 'string') return record.path
  if (typeof record.pattern === 'string') return record.pattern
  try {
    return JSON.stringify(input).slice(0, 160)
  } catch {
    return ''
  }
}

function formatInput(input: unknown): string {
  if (input === undefined) return ''
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function StateIcon({ state }: { state: ToolState }): React.JSX.Element {
  if (state === 'running') {
    return (
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
      />
    )
  }
  if (state === 'completed') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="m5 12.5 4.2 4L19 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (state === 'failed' || state === 'denied') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 7l10 10M17 7 7 17"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v4.4l2.6 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function stateColor(state: ToolState): string {
  if (state === 'completed') return 'text-success'
  if (state === 'failed' || state === 'denied') return 'text-danger'
  if (state === 'awaiting-approval') return 'text-warning'
  return 'text-muted'
}

interface ToolRowProps {
  part: ToolPart
}

function ToolRow({ part }: ToolRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const autoOpen = part.state === 'failed' || part.state === 'denied'
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? autoOpen

  const summary = summarize(part.input)
  const inputText = formatInput(part.input)
  const output = part.output ?? part.error
  const images = part.images ?? []
  const isError = part.state === 'failed' || part.state === 'denied'

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride((value) => !(value ?? autoOpen))}
        className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-caption text-muted transition-colors hover:bg-hover hover:text-foreground"
      >
        <span className={`flex-none ${stateColor(part.state)}`}>
          <StateIcon state={part.state} />
        </span>
        <span className="flex-none font-medium text-foreground">{part.toolName}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">
            {summary}
          </span>
        )}
        <span className={`flex-none text-caption ${stateColor(part.state)}`}>
          {t(STATE_LABEL[part.state])}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={`flex-none text-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (inputText || output || images.length > 0) && (
        <div className="mt-1.5 ml-2 flex flex-col gap-2 border-l border-border-subtle pl-3 pb-1">
          {inputText && (
            <div className="min-w-0">
              <div className="text-caption text-subtle">{t('chat.toolInput')}</div>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 font-mono text-[11px] leading-[1.5] text-muted whitespace-pre-wrap">
                {inputText}
              </pre>
            </div>
          )}
          {images.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-2">
              {images.map((image, index) => (
                <img
                  key={index}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={t('chat.toolImage')}
                  className="max-h-40 rounded-md border border-border-subtle object-contain"
                />
              ))}
            </div>
          )}
          {output && (
            <div className="min-w-0">
              <div className={`text-caption ${isError ? 'text-danger' : 'text-subtle'}`}>
                {t('chat.toolOutput')}
              </div>
              <pre
                className={`mt-1 max-h-72 overflow-auto rounded-md border px-2.5 py-2 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap ${
                  isError
                    ? 'border-danger/30 bg-danger/5 text-danger'
                    : 'border-border-subtle bg-surface-sunken text-muted'
                }`}
              >
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolRow
