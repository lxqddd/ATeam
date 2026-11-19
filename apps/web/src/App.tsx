import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiOutlined,
  AppstoreOutlined,
  ArrowUpOutlined,
  BugOutlined,
  CheckCircleFilled,
  CodeOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LayoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import { Avatar, Button, Empty, Progress, Tag, Tooltip } from 'antd'
import { APP_NAME } from '@ateam/shared'
import { SettingsView } from './views/SettingsView'

type NavKey = 'sessions' | 'overview' | 'projects' | 'settings'

const navItems: { key: NavKey; labelKey: string; icon: ReactNode }[] = [
  { key: 'sessions', labelKey: 'nav.sessions', icon: <MessageOutlined /> },
  { key: 'overview', labelKey: 'nav.overview', icon: <AppstoreOutlined /> },
  { key: 'projects', labelKey: 'nav.projects', icon: <FolderOpenOutlined /> },
]

const pageMeta: Record<NavKey, { titleKey: string; subtitleKey: string }> = {
  sessions: { titleKey: 'page.sessions.title', subtitleKey: 'page.sessions.subtitle' },
  overview: { titleKey: 'page.overview.title', subtitleKey: 'page.overview.subtitle' },
  projects: { titleKey: 'page.projects.title', subtitleKey: 'page.projects.subtitle' },
  settings: { titleKey: 'page.settings.title', subtitleKey: 'page.settings.subtitle' },
}

const stats = [
  { labelKey: 'overview.stats.sessions.label', hintKey: 'overview.stats.sessions.hint' },
  { labelKey: 'overview.stats.projects.label', hintKey: 'overview.stats.projects.hint' },
  { labelKey: 'overview.stats.approvals.label', hintKey: 'overview.stats.approvals.hint' },
]

const kernelChecks = [
  { labelKey: 'overview.kernel.checks.electron', done: true },
  { labelKey: 'overview.kernel.checks.react', done: true },
  { labelKey: 'overview.kernel.checks.design', done: true },
  { labelKey: 'overview.kernel.checks.opencode', done: false },
]

const suggestions = [
  {
    icon: <CodeOutlined />,
    titleKey: 'sessions.suggestions.feature.title',
    descKey: 'sessions.suggestions.feature.desc',
  },
  {
    icon: <BugOutlined />,
    titleKey: 'sessions.suggestions.fix.title',
    descKey: 'sessions.suggestions.fix.desc',
  },
  {
    icon: <FileTextOutlined />,
    titleKey: 'sessions.suggestions.explain.title',
    descKey: 'sessions.suggestions.explain.desc',
  },
  {
    icon: <SafetyCertificateOutlined />,
    titleKey: 'sessions.suggestions.review.title',
    descKey: 'sessions.suggestions.review.desc',
  },
]

export function App() {
  const { t } = useTranslation()
  const [active, setActive] = useState<NavKey>('sessions')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const meta = pageMeta[active]
  const pageTitle = t(meta.titleKey)

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <div className="cd-titlebar app-drag flex shrink-0 items-center px-3">
        <div className="w-[68px] shrink-0" />
        <div className="app-no-drag">
          <Button
            type="text"
            size="small"
            icon={sidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label={sidebarOpen ? t('titlebar.collapse') : t('titlebar.expand')}
          />
        </div>
        <div className="pointer-events-none flex flex-1 items-center justify-center gap-2 text-[12px] text-faint">
          <span className="size-1.5 rounded-full bg-accent" />
          {APP_NAME} · {pageTitle}
        </div>
        <div className="app-no-drag flex items-center gap-1">
          <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('titlebar.more')} />
          <Button type="text" size="small" icon={<LayoutOutlined />} aria-label={t('titlebar.panel')} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="cd-rail flex shrink-0 flex-col items-center py-2" aria-label={t('nav.main')}>
          <div className="mb-3 grid size-8 place-items-center rounded-[10px] bg-[var(--cd-color-text)] text-[13px] font-semibold text-[var(--cd-color-bg)]">
            A
          </div>
          <div className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Tooltip key={item.key} title={t(item.labelKey)} placement="right">
                <button
                  type="button"
                  className="cd-rail-item"
                  data-active={active === item.key}
                  aria-label={t(item.labelKey)}
                  aria-current={active === item.key ? 'page' : undefined}
                  onClick={() => setActive(item.key)}
                >
                  {item.icon}
                </button>
              </Tooltip>
            ))}
          </div>
          <div className="mt-auto flex flex-col items-center gap-1">
            <Tooltip title={t('nav.gateway')} placement="right">
              <button type="button" className="cd-rail-item" aria-label={t('nav.gateway')}>
                <ApiOutlined />
              </button>
            </Tooltip>
            <Tooltip title={t('nav.settings')} placement="right">
              <button
                type="button"
                className="cd-rail-item"
                data-active={active === 'settings'}
                aria-label={t('nav.settings')}
                onClick={() => setActive('settings')}
              >
                <SettingOutlined />
              </button>
            </Tooltip>
            <Avatar
              size={24}
              className="mt-1 !bg-[var(--cd-color-selected-bg)] !text-[11px] !text-[var(--cd-color-selected-text)]"
            >
              L
            </Avatar>
          </div>
        </nav>

        {sidebarOpen && <Sidebar active={active} />}

        <main className="flex min-w-0 flex-1 flex-col bg-workspace">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line-subtle px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="cd-title truncate">{pageTitle}</h1>
                <Tag className="!m-0 !rounded-full !border-line !bg-subtle !px-2 !text-[11px] !text-muted">
                  {t('common.local')}
                </Tag>
              </div>
              <p className="cd-caption truncate text-faint">{t(meta.subtitleKey)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Tag className="!m-0 hidden !rounded-full !border-[var(--cd-color-warning-border)] !bg-warning-soft !px-2.5 !py-0.5 !text-[11px] !text-warning lg:inline-flex">
                <span className="mr-1 inline-block size-1.5 rounded-full bg-warning align-middle" />
                {t('header.kernelDisconnected')}
              </Tag>
              <Button
                type="text"
                icon={<SettingOutlined />}
                aria-label={t('nav.settings')}
                onClick={() => setActive('settings')}
              />
              <Button type="primary" icon={<PlusOutlined />}>
                {t('common.newSession')}
              </Button>
            </div>
          </header>

          <div className={`min-h-0 flex-1 ${active === 'sessions' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {active === 'sessions' ? (
              <SessionsView />
            ) : (
              <div className="mx-auto w-full max-w-[1080px] px-6 py-5">
                {active === 'overview' ? (
                  <Overview />
                ) : active === 'settings' ? (
                  <SettingsView />
                ) : (
                  <PlaceholderPage page={pageTitle} />
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function Sidebar({ active }: { active: NavKey }) {
  const { t } = useTranslation()
  const settingsItems = [
    { labelKey: 'sidebar.appearance', target: 'settings-appearance' },
    { labelKey: 'sidebar.kernelModels', target: 'settings-kernel' },
    { labelKey: 'sidebar.permissionsSandbox', target: 'settings-permissions' },
  ]

  return (
    <aside className="cd-sidebar flex shrink-0 flex-col">
      <div className="flex h-12 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="cd-subtitle truncate">{t('sidebar.title')}</span>
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">
            {t('sidebar.beta')}
          </span>
        </div>
        <Button type="text" size="small" icon={<SearchOutlined />} aria-label={t('common.search')} />
      </div>

      <div className="px-2">
        <div className="flex items-center justify-between px-2 py-1">
          <button type="button" className="flex items-center gap-1 text-[12px] text-faint hover:text-ink">
            {t('sidebar.workspace')} <DownOutlined className="text-[9px]" />
          </button>
          <button type="button" className="text-faint hover:text-ink" aria-label={t('sidebar.newWorkspace')}>
            <PlusOutlined className="text-[12px]" />
          </button>
        </div>
        <button type="button" className="cd-sidebar-item" data-active="true">
          <FolderOutlined className="text-[13px]" />
          <span className="truncate">{t('sidebar.noProject')}</span>
        </button>
      </div>

      <div className="mt-4 px-2">
        <div className="px-2 py-1 text-[12px] text-faint">
          {active === 'settings'
            ? t('sidebar.settings')
            : active === 'sessions'
              ? t('sidebar.recentSessionsAlt')
              : t('sidebar.recentSessions')}
        </div>
        {active === 'settings' ? (
          <div className="space-y-0.5">
            {settingsItems.map((item) => (
              <button
                key={item.labelKey}
                type="button"
                className="cd-sidebar-item"
                onClick={() =>
                  document.getElementById(item.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                <SettingOutlined className="text-[13px]" />
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-2 py-3 text-[13px] text-faint">
            {active === 'sessions' ? t('sidebar.noSessions') : t('sidebar.noRecentSessions')}
          </div>
        )}
      </div>

      <div className="mt-auto p-2">
        <div className="cd-card p-3">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className="size-1.5 rounded-full bg-warning" />
            {t('sidebar.kernelDisconnected')}
          </div>
          <p className="mt-1 text-[12px] leading-[18px] text-faint">{t('sidebar.kernelHint')}</p>
          <Button block size="small" className="mt-2">
            {t('sidebar.configureKernel')}
          </Button>
        </div>
      </div>
    </aside>
  )
}

function SessionsView() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center px-6 py-10 text-center">
            <div className="grid size-11 place-items-center rounded-[12px] bg-[var(--cd-color-text)] text-[17px] font-semibold text-[var(--cd-color-bg)]">
              A
            </div>
            <h2 className="cd-display mt-4">{t('sessions.title')}</h2>
            <p className="cd-body mt-2 max-w-[440px] text-muted">{t('sessions.description')}</p>
            <div className="mt-6 grid w-full max-w-[620px] gap-2.5 sm:grid-cols-2">
              {suggestions.map((item) => (
                <button
                  key={item.titleKey}
                  type="button"
                  className="cd-card group flex items-start gap-3 p-3 text-left transition hover:border-accent/40 hover:bg-canvas"
                  onClick={() => setPrompt(t(item.titleKey) + ': ')}
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px] bg-accent-soft text-[14px] text-accent-strong">
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{t(item.titleKey)}</span>
                    <span className="mt-0.5 block text-[12px] leading-[18px] text-faint">{t(item.descKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 pb-4">
          <div className="mx-auto max-w-[760px] rounded-[14px] border border-line bg-surface p-3 shadow-[var(--cd-shadow-md)]">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={2}
              placeholder={t('sessions.composerPlaceholder')}
              className="w-full resize-none border-0 bg-transparent px-1 py-1 text-[14px] leading-[22px] text-ink outline-none placeholder:text-faint"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button type="text" size="small" icon={<PlusOutlined />} aria-label={t('sessions.attach')} />
                <Button type="text" size="small" icon={<FolderOpenOutlined />}>
                  {t('sessions.autoEdit')}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-faint">
                  <span className="size-1.5 rounded-full bg-warning" />
                  {t('sessions.kernelDisconnected')}
                </span>
                <Button
                  type="primary"
                  shape="circle"
                  size="small"
                  icon={<ArrowUpOutlined />}
                  disabled={!prompt.trim()}
                  aria-label={t('sessions.send')}
                />
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-faint">{t('sessions.footer')}</p>
        </div>
      </div>

      <aside className="hidden w-[280px] shrink-0 flex-col border-l border-line-subtle xl:flex">
        <div className="flex h-11 items-center justify-between border-b border-line-subtle px-3">
          <span className="cd-label">{t('sessions.changes')}</span>
          <span className="text-[12px] text-faint">0</span>
        </div>
        <div className="grid flex-1 place-items-center p-4">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div className="space-y-1 text-center">
                <div className="text-[12px] text-muted">{t('sessions.noChanges')}</div>
                <div className="text-[11px] text-faint">{t('sessions.noChangesDesc')}</div>
              </div>
            }
          />
        </div>
      </aside>
    </div>
  )
}

function Overview() {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <section className="cd-card flex flex-wrap items-center justify-between gap-5 p-5">
        <div className="min-w-0 max-w-[560px]">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent-strong">
            <ThunderboltFilled />
            {t('overview.eyebrow')}
          </div>
          <h2 className="cd-display mt-2">{t('overview.title')}</h2>
          <p className="cd-body mt-1 text-muted">{t('overview.description')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="primary" icon={<PlusOutlined />}>
              {t('common.newSession')}
            </Button>
            <Button icon={<FolderOpenOutlined />}>{t('common.openProject')}</Button>
          </div>
        </div>
        <div className="hidden shrink-0 rounded-xl border border-line-subtle bg-sunken p-4 xl:block">
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <span className="size-1.5 rounded-full bg-accent" />
            {t('overview.kernelBadgeTitle')}
          </div>
          <div className="mt-2 font-mono text-[20px] font-semibold tracking-tight">ATeam</div>
          <div className="mt-1 text-[11px] text-faint">{t('overview.stack')}</div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.labelKey} className="cd-card p-4">
            <div className="cd-caption text-faint">{t(stat.labelKey)}</div>
            <div className="mt-1 text-[22px] font-semibold leading-[28px]">0</div>
            <div className="mt-1 text-[12px] text-faint">{t(stat.hintKey)}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="cd-card flex min-h-[248px] flex-col">
          <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
            <span className="cd-label">{t('overview.recent.title')}</span>
            <Button type="link" size="small">
              {t('common.viewAll')}
            </Button>
          </div>
          <div className="grid flex-1 place-items-center p-5">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div className="space-y-1">
                  <div className="text-[13px] text-muted">{t('overview.recent.empty')}</div>
                  <div className="text-[12px] text-faint">{t('overview.recent.emptyDesc')}</div>
                </div>
              }
            >
              <Button type="primary" ghost icon={<PlusOutlined />}>
                {t('common.newSession')}
              </Button>
            </Empty>
          </div>
        </div>

        <div className="cd-card p-4">
          <div className="flex items-center justify-between">
            <span className="cd-label">{t('overview.kernel.title')}</span>
            <span className="text-[12px] text-faint">3 / 4</span>
          </div>
          <Progress percent={75} showInfo={false} size={['100%', 6]} className="!mt-2" />
          <div className="mt-3 space-y-2">
            {kernelChecks.map((check) => (
              <div key={check.labelKey} className="flex items-center gap-2 text-[12px]">
                {check.done ? (
                  <CheckCircleFilled className="text-success" />
                ) : (
                  <span className="size-[13px] rounded-full border border-line-strong" />
                )}
                <span className={check.done ? 'text-muted' : 'text-faint'}>{t(check.labelKey)}</span>
                {!check.done && (
                  <Tag className="!m-0 !ml-auto !rounded-full !border-line !bg-subtle !px-1.5 !text-[10px] !text-faint">
                    {t('common.next')}
                  </Tag>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-sunken p-2.5 text-[11px] leading-[17px] text-faint">
            {t('overview.kernel.note')}
          </p>
        </div>
      </section>

      <section className="cd-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="!bg-accent-soft !text-accent-strong" size={32} icon={<ApiOutlined />} />
          <div>
            <div className="cd-label">{t('overview.gateway.title')}</div>
            <div className="text-[12px] text-faint">{t('overview.gateway.desc')}</div>
          </div>
        </div>
        <Button size="small" icon={<SettingOutlined />}>
          {t('common.configure')}
        </Button>
      </section>
    </div>
  )
}

function PlaceholderPage({ page }: { page: string }) {
  const { t } = useTranslation()

  return (
    <div className="cd-card grid min-h-[420px] place-items-center p-8">
      <Empty
        description={
          <div className="space-y-1">
            <div className="text-[14px] font-medium text-ink">{t('placeholder.title', { page })}</div>
            <div className="text-[12px] text-faint">{t('placeholder.desc')}</div>
          </div>
        }
      />
    </div>
  )
}
