import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { QuestionAnswer, QuestionRequest } from '@ateam/shared'
import { chatStore } from '../../chat/store'

interface QuestionCardProps {
  question: QuestionRequest
}

function QuestionCard({ question }: QuestionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = selected.length > 0 || custom.trim().length > 0

  function toggle(label: string): void {
    if (question.multiple) {
      setSelected((current) =>
        current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label]
      )
    } else {
      setSelected([label])
    }
  }

  async function reply(answer: QuestionAnswer): Promise<void> {
    setSending(true)
    setError(null)
    try {
      await chatStore.replyQuestion(question.id, answer)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSending(false)
    }
  }

  return (
    <section aria-label={t('chat.question')} className="mx-auto w-full max-w-[768px] px-4 py-2">
      <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5">
        <p className="m-0 text-caption font-medium text-accent-strong">{question.header}</p>
        <p className="mt-1 mb-2 text-label leading-[1.6] text-foreground">{question.question}</p>

        <div className="flex flex-col gap-1.5">
          {question.options.map((option) =>
            question.multiple ? (
              <label
                key={option.label}
                className="flex items-start gap-2 rounded px-2 py-1.5 text-label transition-colors hover:bg-hover"
              >
                <input
                  type="checkbox"
                  aria-label={option.label}
                  checked={selected.includes(option.label)}
                  onChange={() => toggle(option.label)}
                  className="mt-1 h-4 w-4 flex-none accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-foreground">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-caption text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ) : (
              <button
                key={option.label}
                type="button"
                aria-pressed={selected.includes(option.label)}
                onClick={() => toggle(option.label)}
                className={`rounded border px-2 py-1.5 text-left text-label transition-colors ${
                  selected.includes(option.label)
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border-subtle text-foreground hover:bg-hover'
                }`}
              >
                <span className="block">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-caption text-muted">{option.description}</span>
                )}
              </button>
            )
          )}
        </div>

        {question.allowCustom && (
          <textarea
            aria-label={t('chat.questionCustom')}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            rows={2}
            className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-caption text-foreground outline-none placeholder:text-subtle"
          />
        )}

        {error && (
          <p role="alert" className="m-0 mt-2 text-caption text-danger">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void reply({ selected: [], custom: null, cancelled: true })
            }}
            className="h-8 rounded-md px-3 text-label font-medium text-muted transition-colors hover:bg-hover disabled:opacity-55"
          >
            {t('chat.questionCancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit || sending}
            onClick={() => {
              void reply({ selected, custom: custom.trim() || null })
            }}
            className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55"
          >
            {t('chat.questionSubmit')}
          </button>
        </div>
      </div>
    </section>
  )
}

export default QuestionCard
