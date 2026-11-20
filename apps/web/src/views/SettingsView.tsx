import { CheckCircleFilled } from '@ant-design/icons'
import { Button, Input } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderConfig, ProviderTestResult } from '@ateam/shared'
import { LANGUAGES, currentLanguage, setLanguage } from '../i18n'
import { THEMES, useTheme } from '../theme'

const DEFAULT_GO_MODEL = 'deepseek-v4.1-flash'

const providerBridge = () => window.ateam?.provider

function ProviderSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ProviderConfig | null>(null)
  const [model, setModel] = useState(DEFAULT_GO_MODEL)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void providerBridge()
      ?.get()
      .then((value) => {
        if (!value) return
        setConfig(value)
        setModel(value.model)
      })
  }, [])

  const save = async () => {
    setBusy('save')
    setStatus(null)
    try {
      const saved = await providerBridge()?.set({
        kind: 'opencode-go',
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      if (saved) {
        setConfig(saved)
        setApiKey('')
        setStatus({ ok: true, text: t('settings.provider.saved') })
      }
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setStatus(null)
    try {
      const result: ProviderTestResult | undefined = await providerBridge()?.test()
      if (result) setStatus({ ok: result.ok, text: result.message })
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="settings-provider" className="cd-card p-5">
      <h2 className="cd-subtitle">{t('settings.provider.title')}</h2>
      <p className="cd-caption mt-1 text-faint">{t('settings.provider.desc')}</p>
      <div className="mt-4 grid max-w-xl gap-3">
        <label className="grid gap-1.5">
          <span className="cd-label">{t('settings.provider.model')}</span>
          <Input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={DEFAULT_GO_MODEL}
            aria-label={t('settings.provider.model')}
          />
          <span className="text-[11px] leading-[17px] text-faint">{t('settings.provider.modelHint')}</span>
        </label>
        <label className="grid gap-1.5">
          <span className="cd-label">{t('settings.provider.apiKey')}</span>
          <Input.Password
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={config?.hasApiKey ? t('settings.provider.apiKeySaved') : t('settings.provider.apiKeyPlaceholder')}
            aria-label={t('settings.provider.apiKey')}
          />
          <span className="text-[11px] leading-[17px] text-faint">{t('settings.provider.apiKeyHint')}</span>
        </label>
        <div className="flex items-center gap-2">
          <Button type="primary" loading={busy === 'save'} onClick={save}>
            {t('settings.provider.save')}
          </Button>
          <Button loading={busy === 'test'} disabled={!config} onClick={test}>
            {t('settings.provider.test')}
          </Button>
        </div>
        {status && (
          <p
            className="text-[12px] leading-[18px]"
            style={{ color: status.ok ? 'var(--cd-color-success)' : 'var(--cd-color-danger)' }}
            role="status"
          >
            {status.text}
          </p>
        )}
      </div>
    </section>
  )
}

export function SettingsView() {
  const { t } = useTranslation()
  const { pref, setPref } = useTheme()
  const language = currentLanguage()

  return (
    <div className="space-y-4">
      <ProviderSection />
      <section id="settings-appearance" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.appearance.title')}</h2>
        <p className="cd-caption mt-1 text-faint">{t('settings.appearance.desc')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((theme) => {
            const active = pref === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPref(theme.id)}
                className={`cd-card p-3 text-left transition-colors ${
                  active ? 'ring-2 ring-accent' : 'hover:border-accent/40'
                }`}
              >
                <span className="flex h-9 overflow-hidden rounded-md border border-line">
                  {theme.swatch.map((color, index) => (
                    <span key={index} className="flex-1" style={{ background: color }} />
                  ))}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="cd-label">{t(theme.nameKey)}</span>
                  {active && <CheckCircleFilled className="text-accent" />}
                </span>
                <span className="mt-0.5 block text-[11px] leading-[17px] text-faint">
                  {t(theme.descKey)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section id="settings-language" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.language.title')}</h2>
        <p className="cd-caption mt-1 text-faint">{t('settings.language.desc')}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {LANGUAGES.map((item) => {
            const active = language === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setLanguage(item.id)}
                className={`cd-card flex items-center justify-between gap-3 p-3 text-left transition-colors ${
                  active ? 'ring-2 ring-accent' : 'hover:border-accent/40'
                }`}
              >
                <span className="min-w-0">
                  <span className="cd-label block">{t(item.labelKey)}</span>
                  <span className="mt-0.5 block text-[11px] text-faint">{item.id}</span>
                </span>
                {active && <CheckCircleFilled className="text-accent" />}
              </button>
            )
          })}
        </div>
      </section>

      <section id="settings-kernel" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.kernel.title')}</h2>
        <p className="mt-1 text-[13px] leading-[20px] text-muted">{t('settings.kernel.desc')}</p>
        <div className="mt-3">
          <Button onClick={() => void window.ateam?.kernel?.openLogs()}>{t('settings.kernel.openLogs')}</Button>
        </div>
      </section>

      <section id="settings-permissions" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.permissions.title')}</h2>
        <p className="mt-1 text-[13px] leading-[20px] text-muted">{t('settings.permissions.desc')}</p>
      </section>
    </div>
  )
}
