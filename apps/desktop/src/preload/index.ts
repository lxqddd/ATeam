import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  AGENT_CHANNELS,
  AGENT_EVENT_CHANNEL,
  CONFIG_CHANGE_CHANNEL,
  MODEL_CHANNELS,
  THEME_CHANNEL,
  UPDATE_CHANNELS,
  UPDATE_EVENT_CHANNEL,
  type AgentEventEnvelope,
  type AteamApi,
  type ConfigFileChange,
  type DesktopPlatform,
  type UpdateProgress
} from '@ateam/shared'

const api: AteamApi = {
  platform: process.platform as DesktopPlatform,
  versions: { electron: process.versions.electron ?? '' },
  theme: {
    set: (theme) => {
      ipcRenderer.send(THEME_CHANNEL, theme)
    }
  },
  updates: {
    check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
    download: (version) => ipcRenderer.invoke(UPDATE_CHANNELS.download, { version }),
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, progress: UpdateProgress): void => {
        callback(progress)
      }
      ipcRenderer.on(UPDATE_EVENT_CHANNEL, listener)
      return () => {
        ipcRenderer.removeListener(UPDATE_EVENT_CHANNEL, listener)
      }
    }
  },
  agent: {
    status: () => ipcRenderer.invoke(AGENT_CHANNELS.status),
    restart: () => ipcRenderer.invoke(AGENT_CHANNELS.restart),
    info: () => ipcRenderer.invoke(AGENT_CHANNELS.info),
    agents: (directory?: string | null) =>
      ipcRenderer.invoke(AGENT_CHANNELS.agentsList, { directory }),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, envelope: AgentEventEnvelope): void => {
        callback(envelope)
      }
      ipcRenderer.on(AGENT_EVENT_CHANNEL, listener)
      return () => {
        ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, listener)
      }
    },
    sessions: {
      list: () => ipcRenderer.invoke(AGENT_CHANNELS.sessionsList),
      create: (directory?: string | null) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionCreate, { directory }),
      setDirectory: (id, directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionSetDirectory, { id, directory }),
      rename: (id, title) => ipcRenderer.invoke(AGENT_CHANNELS.sessionRename, { id, title }),
      remove: (id) => ipcRenderer.invoke(AGENT_CHANNELS.sessionDelete, { id }),
      setModel: (id, model) => ipcRenderer.invoke(AGENT_CHANNELS.sessionSetModel, { id, model }),
      setSettings: (id, settings) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionSetSettings, { id, settings }),
      setAgent: (id, agent) => ipcRenderer.invoke(AGENT_CHANNELS.sessionSetAgent, { id, agent }),
      plan: (id) => ipcRenderer.invoke(AGENT_CHANNELS.sessionPlan, { id }),
      compact: (id) => ipcRenderer.invoke(AGENT_CHANNELS.sessionCompact, { id }),
      undo: (id, messageId, stepIndex) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionUndo, { id, messageId, stepIndex }),
      redo: (id) => ipcRenderer.invoke(AGENT_CHANNELS.sessionRedo, { id }),
      fork: (id, messageId) => ipcRenderer.invoke(AGENT_CHANNELS.sessionFork, { id, messageId }),
      search: (query) => ipcRenderer.invoke(AGENT_CHANNELS.sessionSearch, { query }),
      export: (options) => ipcRenderer.invoke(AGENT_CHANNELS.sessionExport, options),
      import: () => ipcRenderer.invoke(AGENT_CHANNELS.sessionImport),
      usage: (range) => ipcRenderer.invoke(AGENT_CHANNELS.sessionUsage, { range }),
      changes: (sessionId, messageId) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionChanges, { sessionId, messageId }),
      changesSummary: (sessionId) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionChangesSummary, { sessionId }),
      revertFiles: (sessionId, messageId, paths) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionRevertFiles, { sessionId, messageId, paths }),
      unrevertFiles: (sessionId, paths) =>
        ipcRenderer.invoke(AGENT_CHANNELS.sessionUnrevertFiles, { sessionId, paths })
    },
    messages: {
      list: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.messagesList, { sessionId })
    },
    vcs: {
      status: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.vcsStatus, { sessionId }),
      diff: (sessionId, options) =>
        ipcRenderer.invoke(AGENT_CHANNELS.vcsDiff, {
          sessionId,
          mode: options?.mode,
          base: options?.base,
          path: options?.path
        })
    },
    chat: {
      send: (input) => ipcRenderer.invoke(AGENT_CHANNELS.chatSend, input),
      stop: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.chatStop, { sessionId }),
      retry: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.chatRetry, { sessionId }),
      steer: (input) => ipcRenderer.invoke(AGENT_CHANNELS.chatSteer, input),
      removeQueued: (sessionId, id) =>
        ipcRenderer.invoke(AGENT_CHANNELS.chatQueueRemove, { sessionId, id })
    },
    background: {
      list: (sessionId) =>
        ipcRenderer.invoke(AGENT_CHANNELS.backgroundTasksList, sessionId ? { sessionId } : {}),
      cancel: (taskId) => ipcRenderer.invoke(AGENT_CHANNELS.backgroundTaskCancel, { taskId })
    },
    permissions: {
      list: () => ipcRenderer.invoke(AGENT_CHANNELS.permissionsList),
      reply: (requestId, decision) =>
        ipcRenderer.invoke(AGENT_CHANNELS.permissionReply, { requestId, decision }),
      rules: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.permissionsRules, { sessionId }),
      overview: (directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.permissionsOverview, { directory }),
      addRule: (input) => ipcRenderer.invoke(AGENT_CHANNELS.permissionRuleAdd, input),
      removeRule: (id) => ipcRenderer.invoke(AGENT_CHANNELS.permissionRuleRemove, { id })
    },
    questions: {
      list: () => ipcRenderer.invoke(AGENT_CHANNELS.questionsList),
      reply: (questionId, answer) =>
        ipcRenderer.invoke(AGENT_CHANNELS.questionReply, { questionId, answer })
    },
    config: {
      get: () => ipcRenderer.invoke(AGENT_CHANNELS.agentConfig),
      update: (patch) => ipcRenderer.invoke(AGENT_CHANNELS.agentConfigUpdate, patch),
      resolve: (directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.agentConfigResolve, {
          directory: directory ?? undefined
        }),
      onExternalChange: (callback) => {
        const listener = (_event: IpcRendererEvent, change: ConfigFileChange): void => {
          callback(change)
        }
        ipcRenderer.on(CONFIG_CHANGE_CHANNEL, listener)
        return () => {
          ipcRenderer.removeListener(CONFIG_CHANGE_CHANNEL, listener)
        }
      },
      project: {
        get: (directory) =>
          ipcRenderer.invoke(AGENT_CHANNELS.agentConfigProjectGet, {
            directory: directory ?? undefined
          }),
        update: (input) =>
          ipcRenderer.invoke(AGENT_CHANNELS.agentConfigProjectUpdate, {
            directory: input.directory ?? undefined,
            content: input.content
          }),
        edit: (input) =>
          ipcRenderer.invoke(AGENT_CHANNELS.agentConfigProjectEdit, {
            directory: input.directory ?? undefined,
            edits: input.edits
          })
      },
      global: {
        get: () => ipcRenderer.invoke(AGENT_CHANNELS.agentConfigGlobalGet),
        update: (input) =>
          ipcRenderer.invoke(AGENT_CHANNELS.agentConfigGlobalUpdate, {
            content: input.content
          }),
        edit: (input) =>
          ipcRenderer.invoke(AGENT_CHANNELS.agentConfigGlobalEdit, {
            edits: input.edits
          })
      }
    },
    plugins: {
      list: () => ipcRenderer.invoke(AGENT_CHANNELS.pluginsList),
      install: (input) => ipcRenderer.invoke(AGENT_CHANNELS.pluginsInstall, input),
      update: (id, input) => ipcRenderer.invoke(AGENT_CHANNELS.pluginsUpdate, { id, input }),
      remove: (id) => ipcRenderer.invoke(AGENT_CHANNELS.pluginsRemove, { id }),
      authMethods: (directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.pluginsAuthMethods, {
          directory: directory ?? undefined
        }),
      authorizeAuth: (input) => ipcRenderer.invoke(AGENT_CHANNELS.pluginsAuthorizeAuth, input),
      completeAuth: (input) => ipcRenderer.invoke(AGENT_CHANNELS.pluginsCompleteAuth, input),
      logoutAuth: (provider, directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.pluginsAuthLogout, {
          provider,
          directory: directory ?? undefined
        })
    },
    mcp: {
      list: (directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.mcpList, { directory: directory ?? undefined }),
      statuses: (options) =>
        ipcRenderer.invoke(AGENT_CHANNELS.mcpStatuses, {
          ...(options ?? {}),
          directory: options?.directory ?? undefined
        }),
      add: (input) => ipcRenderer.invoke(AGENT_CHANNELS.mcpAdd, input),
      update: (id, input) => ipcRenderer.invoke(AGENT_CHANNELS.mcpUpdate, { id, input }),
      remove: (id) => ipcRenderer.invoke(AGENT_CHANNELS.mcpRemove, { id }),
      prompt: (server, prompt, args, directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.mcpPrompt, {
          server,
          prompt,
          arguments: args,
          directory
        }),
      authStatuses: (directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.mcpAuthStatuses, { directory: directory ?? undefined }),
      authorize: (id, directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.mcpAuthorize, {
          id,
          directory: directory ?? undefined
        }),
      logout: (id, directory) =>
        ipcRenderer.invoke(AGENT_CHANNELS.mcpLogout, {
          id,
          directory: directory ?? undefined
        })
    },
    websearch: {
      get: () => ipcRenderer.invoke(AGENT_CHANNELS.webSearchGet),
      update: (input) => ipcRenderer.invoke(AGENT_CHANNELS.webSearchUpdate, input)
    },
    github: {
      status: () => ipcRenderer.invoke(AGENT_CHANNELS.githubStatus),
      updateToken: (token) => ipcRenderer.invoke(AGENT_CHANNELS.githubTokenUpdate, { token }),
      clearToken: () => ipcRenderer.invoke(AGENT_CHANNELS.githubTokenClear),
      repo: (directory?: string | null) =>
        ipcRenderer.invoke(AGENT_CHANNELS.githubRepo, { directory }),
      list: (input) => ipcRenderer.invoke(AGENT_CHANNELS.githubList, input),
      context: (ref) => ipcRenderer.invoke(AGENT_CHANNELS.githubContext, { ref }),
      comment: (input) => ipcRenderer.invoke(AGENT_CHANNELS.githubComment, input),
      createPull: (input) => ipcRenderer.invoke(AGENT_CHANNELS.githubCreatePull, input)
    },
    attachments: {
      import: (sessionId, input) =>
        ipcRenderer.invoke(AGENT_CHANNELS.attachmentsImport, { sessionId, ...input }),
      remove: (sessionId, attachmentId) =>
        ipcRenderer.invoke(AGENT_CHANNELS.attachmentRemove, { sessionId, attachmentId }),
      preview: (sessionId, path) =>
        ipcRenderer.invoke(AGENT_CHANNELS.attachmentPreview, { sessionId, path })
    },
    files: {
      search: (query: string, directory?: string | null) =>
        ipcRenderer.invoke(AGENT_CHANNELS.filesSearch, { query, directory })
    },
    commands: {
      list: (directory?: string | null) =>
        ipcRenderer.invoke(AGENT_CHANNELS.commandsList, { directory }),
      expand: (input) => ipcRenderer.invoke(AGENT_CHANNELS.commandExpand, input),
      run: (input) => ipcRenderer.invoke(AGENT_CHANNELS.commandsRun, input)
    }
  },
  models: {
    get: () => ipcRenderer.invoke(MODEL_CHANNELS.get),
    addProvider: (input) => ipcRenderer.invoke(MODEL_CHANNELS.providerAdd, input),
    updateProvider: (input) => ipcRenderer.invoke(MODEL_CHANNELS.providerUpdate, input),
    deleteProvider: (id) => ipcRenderer.invoke(MODEL_CHANNELS.providerDelete, { id }),
    revealApiKey: (id) => ipcRenderer.invoke(MODEL_CHANNELS.providerRevealKey, { id }),
    oauthStatuses: () => ipcRenderer.invoke(MODEL_CHANNELS.providerAuthStatuses),
    authorizeOAuth: (id) => ipcRenderer.invoke(MODEL_CHANNELS.providerOAuthAuthorize, { id }),
    logoutOAuth: (id) => ipcRenderer.invoke(MODEL_CHANNELS.providerOAuthLogout, { id }),
    addModel: (input) => ipcRenderer.invoke(MODEL_CHANNELS.modelAdd, input),
    updateModel: (input) => ipcRenderer.invoke(MODEL_CHANNELS.modelUpdate, input),
    deleteModel: (id) => ipcRenderer.invoke(MODEL_CHANNELS.modelDelete, { id }),
    setDefault: (model) => ipcRenderer.invoke(MODEL_CHANNELS.defaultSet, model),
    test: (providerId, modelId) => ipcRenderer.invoke(MODEL_CHANNELS.test, { providerId, modelId }),
    listModels: (providerId) =>
      ipcRenderer.invoke(MODEL_CHANNELS.providerModels, { id: providerId }),
    previewModels: (input) => ipcRenderer.invoke(MODEL_CHANNELS.providerModelsPreview, input),
    catalog: (refresh) => ipcRenderer.invoke(MODEL_CHANNELS.catalog, { refresh })
  },
  workspace: {
    open: (path?: string | null) => ipcRenderer.invoke(AGENT_CHANNELS.workspaceOpen, { path }),
    pickDirectory: (defaultPath?: string) =>
      ipcRenderer.invoke(AGENT_CHANNELS.workspacePick, { defaultPath })
  },
  openExternal: (url) => ipcRenderer.invoke(AGENT_CHANNELS.openExternal, url)
}

contextBridge.exposeInMainWorld('api', api)
