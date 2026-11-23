import { useEffect, useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PluginAuthMethodInfo, PluginAuthResult } from '@ateam/shared'
import { errorMessage } from '../../lib/errors'

interface PluginAuthSettingsProps {
  defaultDirectory?: string
}

type PendingAuth = Extract<PluginAuthResult, { status: 'pending' }>

function PluginAuthSettings({ defaultDirectory }: PluginAuthSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [methods, setMethods] = useState<PluginAuthMethodInfo[] | null>(null)
  const [selected, setSelected] = useState<PluginAuthMethodInfo | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<PendingAuth | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.agent.plugins
      .authMethods(defaultDirectory ?? null)
      .then((entries) => {
        if (active) setMethods(entries)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(errorMessage(caught))
        setMethods([])
      })
    return () => {
      active = false
    }
  }, [defaultDirectory])

  function open(method: PluginAuthMethodInfo): void {
    setSelected(method)
    setAnswers({})
    setPending(null)
    setCode('')
    setError(null)
  }

  function close(): void {
    if (busy) return
    setSelected(null)
    setPending(null)
    setError(null)
  }

  function handleResult(result: PluginAuthResult): void {
    if (result.status === 'failed') {
      setError(result.message)
      return
    }
    if (result.status === 'pending') {
      setPending(result)
      setError(null)
      return
    }
    setSuccess(
      t('settings.pluginAuthConnected', { provider: selected?.providerName ?? result.provider })
    )
    setSelected(null)
    setPending(null)
    setError(null)
  }

  async function authorize(): Promise<void> {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.agent.plugins.authorizeAuth({
        id: selected.id,
        answers,
        directory: defaultDirectory ?? null
      })
      handleResult(result)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function complete(): Promise<void> {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.agent.plugins.completeAuth({
        requestId: pending.requestId,
        code: code.trim() || undefined,
        directory: defaultDirectory ?? null
      })
      handleResult(result)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const missingPrompt =
    selected?.prompts.some((prompt) => prompt.required !== false && !answers[prompt.key]?.trim()) ??
    false
  const canAuthorize = Boolean(selected) && !missingPrompt && !busy
  const canComplete =
    Boolean(pending) && (!pending?.codeRequired || code.trim().length > 0) && !busy

  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-border p-4">
      <div>
        <h3 className="m-0 text-title font-semibold text-foreground">{t('settings.pluginAuth')}</h3>
        <p className="m-0 mt-1 text-caption text-muted">{t('settings.pluginAuthDescription')}</p>
      </div>

      {success && (
        <Alert type="success" showIcon title={success} closable onClose={() => setSuccess(null)} />
      )}
      {error && !selected && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      {methods === null ? (
        <p className="m-0 py-2 text-caption text-muted">{t('settings.loading')}</p>
      ) : methods.length === 0 ? (
        <p className="m-0 py-2 text-caption text-muted">{t('settings.pluginAuthEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {methods.map((method) => (
            <li
              key={method.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
            >
              <span className="text-label font-medium text-foreground">{method.providerName}</span>
              <span className="text-caption text-muted">{method.label}</span>
              <span className="inline-flex h-[18px] items-center rounded-full bg-surface px-1.5 text-[12px] leading-none font-medium text-muted">
                {method.type === 'api'
                  ? t('settings.pluginAuthTypeApi')
                  : t('settings.pluginAuthTypeOAuth')}
              </span>
              {method.description && (
                <span className="basis-full text-caption text-muted">{method.description}</span>
              )}
              <code
                className="min-w-0 flex-1 truncate font-mono text-caption text-subtle"
                title={method.plugin}
              >
                {method.plugin}
              </code>
              <button
                type="button"
                aria-label={`${t('settings.pluginAuthSignIn')}: ${method.label}`}
                onClick={() => open(method)}
                className="h-7 flex-none rounded-md bg-accent px-2.5 text-caption font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                {t('settings.pluginAuthSignIn')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(selected)}
        title={
          selected ? t('settings.pluginAuthTitle', { provider: selected.providerName }) : undefined
        }
        onCancel={close}
        footer={null}
        destroyOnHidden
      >
        {selected && (
          <div className="flex flex-col gap-3">
            {selected.description && (
              <p className="m-0 text-caption text-muted">{selected.description}</p>
            )}
            {!pending &&
              selected.prompts.map((prompt) => (
                <label key={prompt.key} className="flex flex-col gap-1">
                  <span className="text-caption font-medium text-foreground">{prompt.message}</span>
                  {prompt.type === 'select' ? (
                    <select
                      aria-label={prompt.message}
                      value={answers[prompt.key] ?? ''}
                      onChange={(event) =>
                        setAnswers((current) => ({ ...current, [prompt.key]: event.target.value }))
                      }
                      className="h-8 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none focus:border-border-strong"
                    >
                      <option value="">{t('settings.pluginAuthSelectPlaceholder')}</option>
                      {(prompt.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={prompt.message}
                      type={prompt.secret ? 'password' : 'text'}
                      value={answers[prompt.key] ?? ''}
                      placeholder={prompt.placeholder}
                      autoComplete="off"
                      onChange={(event) =>
                        setAnswers((current) => ({ ...current, [prompt.key]: event.target.value }))
                      }
                      className="h-8 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
                    />
                  )}
                </label>
              ))}

            {pending && (
              <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background-subtle p-3">
                <p className="m-0 text-caption text-foreground">
                  {pending.instructions ?? t('settings.pluginAuthBrowserHint')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void window.api.openExternal(pending.url)
                  }}
                  className="w-fit text-caption font-medium text-accent underline"
                >
                  {t('settings.pluginAuthOpenUrl')}
                </button>
                {pending.codeRequired && (
                  <label className="flex flex-col gap-1">
                    <span className="text-caption font-medium text-foreground">
                      {t('settings.pluginAuthCode')}
                    </span>
                    <input
                      aria-label={t('settings.pluginAuthCode')}
                      value={code}
                      autoComplete="off"
                      onChange={(event) => setCode(event.target.value)}
                      className="h-8 rounded-md border border-border bg-surface px-2 text-caption text-foreground outline-none focus:border-border-strong"
                    />
                  </label>
                )}
              </div>
            )}

            {error && <Alert type="error" showIcon title={error} />}

            <div className="flex justify-end gap-2">
              <Button onClick={close} disabled={busy}>
                {t('settings.cancel')}
              </Button>
              {pending ? (
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!canComplete}
                  onClick={() => void complete()}
                >
                  {t('settings.pluginAuthComplete')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!canAuthorize}
                  onClick={() => void authorize()}
                >
                  {t('settings.pluginAuthAuthorize')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}

export default PluginAuthSettings
