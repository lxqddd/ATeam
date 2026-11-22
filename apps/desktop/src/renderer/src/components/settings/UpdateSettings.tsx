import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { UpdateDownloadResult, UpdateInfo } from '@ateam/shared'
import { errorMessage } from '../../lib/errors'

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function updateError(t: TFunction, caught: unknown): string {
  const message = errorMessage(caught)
  switch (message) {
    case 'UPDATE_RATE_LIMITED':
      return t('settings.updateRateLimited')
    case 'UPDATE_NOT_FOUND':
      return t('settings.updateNotFound')
    case 'UPDATE_ASSET_NOT_FOUND':
      return t('settings.updateAssetNotFound')
    case 'UPDATE_ASSET_UNTRUSTED':
    case 'UPDATE_ASSET_DIGEST_MISMATCH':
    case 'UPDATE_ASSET_INCOMPLETE':
    case 'UPDATE_ASSET_TOO_LARGE':
      return t('settings.updateAssetInvalid')
    case 'UPDATE_VERSION_CHANGED':
      return t('settings.updateChanged')
    default:
      return message.startsWith('UPDATE_') ? t('settings.updateFailed') : message
  }
}

function UpdateSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState<UpdateDownloadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.api.updates
      .check()
      .then((next) => {
        if (active) setInfo(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(updateError(t, caught))
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [t])

  async function check(): Promise<void> {
    setChecking(true)
    setError(null)
    setDownloaded(null)
    try {
      setInfo(await window.api.updates.check())
    } catch (caught) {
      setError(updateError(t, caught))
    } finally {
      setChecking(false)
    }
  }

  async function download(): Promise<void> {
    if (!info?.asset || downloading) return
    setDownloading(true)
    setError(null)
    setDownloaded(null)
    try {
      setDownloaded(await window.api.updates.download(info.latestVersion))
    } catch (caught) {
      setError(updateError(t, caught))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 text-label text-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted">{t('settings.currentVersion')}</span>
        <span className="font-mono">v{info?.currentVersion ?? '—'}</span>
        <button
          type="button"
          disabled={checking || downloading}
          onClick={() => {
            void check()
          }}
          className="h-7 rounded-md border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50"
        >
          {checking ? t('settings.checkingForUpdates') : t('settings.checkForUpdates')}
        </button>
      </div>

      {error && (
        <p role="alert" className="m-0 text-caption text-danger">
          {error}
        </p>
      )}

      {info && !checking && (
        <div className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2.5">
          {info.available ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {t('settings.updateAvailable', { version: info.latestVersion })}
                </span>
                {info.publishedAt && (
                  <span className="text-caption text-subtle">
                    {new Date(info.publishedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              {info.releaseNotes && (
                <div>
                  <div className="mb-1 text-caption text-muted">{t('settings.releaseNotes')}</div>
                  <pre className="m-0 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-caption leading-[1.6] text-muted">
                    {info.releaseNotes}
                  </pre>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {info.asset ? (
                  <button
                    type="button"
                    disabled={downloading}
                    onClick={() => {
                      void download()
                    }}
                    className="h-8 rounded-md bg-accent px-3 text-caption font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    {downloading
                      ? t('settings.downloadingUpdate')
                      : t('settings.downloadAndInstall')}
                  </button>
                ) : (
                  <span className="text-caption text-muted">
                    {t('settings.updateAssetNotFound')}
                  </span>
                )}
                {info.asset && (
                  <span className="text-caption text-subtle">
                    {info.asset.name} · {formatBytes(info.asset.size)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void window.api.openExternal(info.releaseUrl).catch(() => undefined)
                  }}
                  className="h-8 rounded-md border border-border bg-surface px-3 text-caption font-medium text-foreground transition-colors hover:bg-hover"
                >
                  {t('settings.openRelease')}
                </button>
              </div>
              {downloaded && (
                <p className="m-0 text-caption text-muted">
                  {t(
                    downloaded.opened
                      ? 'settings.updateDownloadedOpened'
                      : 'settings.updateDownloaded',
                    { path: downloaded.path }
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('settings.upToDate')}</span>
              <button
                type="button"
                onClick={() => {
                  void check()
                }}
                className="h-7 rounded-md border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-hover"
              >
                {t('settings.checkAgain')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default UpdateSettings
