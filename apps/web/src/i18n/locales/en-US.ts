const enUS = {
  common: {
    local: 'Local',
    newSession: 'New session',
    openProject: 'Open project',
    configure: 'Configure',
    viewAll: 'View all',
    next: 'Next',
    search: 'Search',
  },
  nav: {
    main: 'Main navigation',
    sessions: 'Sessions',
    overview: 'Overview',
    projects: 'Projects',
    settings: 'Settings',
    gateway: 'Model gateway',
  },
  titlebar: {
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    more: 'More',
    panel: 'Panels',
  },
  page: {
    sessions: { title: 'Sessions', subtitle: 'Every collaboration with an agent' },
    overview: { title: 'Overview', subtitle: 'Local workspace, sessions and model gateway' },
    projects: { title: 'Projects', subtitle: 'Open and manage local repositories' },
    settings: { title: 'Settings', subtitle: 'Kernel, models and interface preferences' },
  },
  header: {
    kernelDisconnected: 'Kernel offline',
    newSession: 'New session',
  },
  sidebar: {
    title: 'ATeam Studio',
    beta: 'beta',
    workspace: 'Workspace',
    noProject: 'No project opened',
    newWorkspace: 'New workspace',
    recentSessions: 'Recent sessions',
    recentSessionsAlt: 'Recent sessions',
    noRecentSessions: 'No recent sessions',
    noSessions: 'No sessions yet',
    settings: 'Settings',
    appearance: 'Appearance',
    kernelModels: 'Kernel & models',
    permissionsSandbox: 'Permissions & sandbox',
    kernelDisconnected: 'Kernel offline',
    kernelHint: 'Configure the OpenCode kernel and a model to start a local session',
    configureKernel: 'Configure kernel',
  },
  sessions: {
    title: 'Start a new session',
    description:
      'Let the agent work in an isolated worktree. Discuss first, then act — every change is yours to review.',
    suggestions: {
      feature: {
        title: 'Implement a small feature',
        desc: 'Describe the change and let the agent edit the worktree',
      },
      fix: {
        title: 'Fix failing tests',
        desc: 'Locate the failure, patch it and add a regression test',
      },
      explain: {
        title: 'Explain the codebase',
        desc: 'Map module boundaries and the important call paths',
      },
      review: {
        title: 'Review uncommitted changes',
        desc: 'Check for risks, omissions and edge cases',
      },
    },
    composerPlaceholder: 'Type a message…',
    attach: 'Attach',
    autoEdit: 'Auto-edit files',
    kernelDisconnected: 'Kernel offline',
    send: 'Send',
    footer: 'Enter to send · Shift + Enter for a new line',
    changes: 'Changes',
    noChanges: 'No changes yet',
    noChangesDesc: 'Open a project and run a session to see file changes here',
  },
  overview: {
    eyebrow: 'Local-first · Electron + OpenCode kernel',
    title: 'Hand the task to a local agent',
    description:
      'Open a repository, start a session and let the agent work in an isolated worktree. Review every change before it lands.',
    kernelBadgeTitle: 'Local kernel',
    stack: 'Electron 45 · React 19 · Vite 8',
    stats: {
      sessions: { label: 'Active sessions', hint: 'No agent is running' },
      projects: { label: 'Projects', hint: 'Open a local repository to begin' },
      approvals: { label: 'Pending approvals', hint: 'Nothing needs your review' },
    },
    recent: {
      title: 'Recent sessions',
      empty: 'No sessions yet',
      emptyDesc: 'Open a project to create your first agent session',
    },
    kernel: {
      title: 'Kernel readiness',
      checks: {
        electron: 'Electron shell',
        react: 'React + Vite renderer',
        design: 'Ant Design + Tailwind',
        opencode: 'OpenCode kernel adapter',
      },
      note: 'The OpenCode adapter is the next milestone: run the agent in an isolated utility process and stream tool events into this UI.',
    },
    gateway: {
      title: 'Local model gateway',
      desc: 'Route sessions through OpenAI-compatible providers',
    },
  },
  settings: {
    appearance: {
      title: 'Appearance',
      desc: 'Pick an interface theme. Themes only change colors, not layout or type. Follow system switches with macOS light and dark.',
    },
    language: {
      title: 'Language',
      desc: 'Switch the interface language. Takes effect immediately and persists.',
      zh: '简体中文',
      en: 'English',
    },
    kernel: {
      title: 'Kernel & models',
      desc: 'The OpenCode kernel, model providers and local gateway arrive in later milestones. This UI uses nomi 2.4.0 tokens and is not connected to a real agent yet.',
    },
    permissions: {
      title: 'Permissions & sandbox',
      desc: 'Each Run is isolated in its own worktree, with per-tool approvals. Sandbox and permission policy will be configured here once the kernel is connected.',
    },
  },
  themes: {
    light: { name: 'Light', desc: 'Warm white canvas with terracotta, the default' },
    dark: { name: 'Dark', desc: 'Neutral charcoal for low light' },
    sunset: { name: 'Sunset', desc: 'Warm cream with the signature sunset orange' },
    ink: { name: 'Warm ink', desc: 'Deep coffee with warm orange, a warm dark theme' },
    graphite: { name: 'Graphite', desc: 'Neutral charcoal with indigo, a technical dark theme' },
    cream: { name: 'Cream', desc: 'Clean warm white with soft peach, the lightest theme' },
    mist: { name: 'Mist', desc: 'Cool grey with mist blue, calm and restrained' },
    system: { name: 'Follow system', desc: 'Switch with macOS light and dark' },
  },
  placeholder: {
    title: 'No {{page}} content yet',
    desc: 'This page will fill in once the OpenCode kernel is connected.',
  },
} as const

export default enUS
