/** Renderer → main channel used to keep native window chrome in sync with the UI theme. */
export const THEME_CHANNEL = 'ateam:theme-changed'

/** Main → renderer channel carrying agent events. */
export const AGENT_EVENT_CHANNEL = 'ateam:agent:event'

export const AGENT_CHANNELS = {
  status: 'ateam:agent:status',
  restart: 'ateam:agent:restart',
  info: 'ateam:agent:info',
  agentsList: 'ateam:agent:agents:list',
  sessionsList: 'ateam:agent:sessions:list',
  sessionCreate: 'ateam:agent:sessions:create',
  sessionRename: 'ateam:agent:sessions:rename',
  sessionDelete: 'ateam:agent:sessions:delete',
  sessionSetModel: 'ateam:agent:sessions:set-model',
  sessionSetSettings: 'ateam:agent:sessions:set-settings',
  sessionSetDirectory: 'ateam:agent:sessions:set-directory',
  sessionSetAgent: 'ateam:agent:sessions:set-agent',
  sessionCompact: 'ateam:agent:sessions:compact',
  sessionUndo: 'ateam:agent:sessions:undo',
  sessionRedo: 'ateam:agent:sessions:redo',
  sessionFork: 'ateam:agent:sessions:fork',
  sessionSearch: 'ateam:agent:sessions:search',
  messagesList: 'ateam:agent:messages:list',
  chatSend: 'ateam:agent:chat:send',
  chatStop: 'ateam:agent:chat:stop',
  chatRetry: 'ateam:agent:chat:retry',
  permissionsList: 'ateam:agent:permissions:list',
  permissionReply: 'ateam:agent:permissions:reply',
  questionsList: 'ateam:agent:questions:list',
  questionReply: 'ateam:agent:questions:reply',
  permissionsRules: 'ateam:agent:permissions:rules',
  permissionRuleAdd: 'ateam:agent:permissions:add-rule',
  permissionRuleRemove: 'ateam:agent:permissions:remove-rule',
  agentConfig: 'ateam:agent:config:get',
  agentConfigUpdate: 'ateam:agent:config:update',
  mcpList: 'ateam:agent:mcp:list',
  mcpStatuses: 'ateam:agent:mcp:statuses',
  mcpAdd: 'ateam:agent:mcp:add',
  mcpUpdate: 'ateam:agent:mcp:update',
  mcpRemove: 'ateam:agent:mcp:remove',
  mcpPrompt: 'ateam:agent:mcp:prompt',
  mcpAuthStatuses: 'ateam:agent:mcp:auth-statuses',
  mcpAuthorize: 'ateam:agent:mcp:authorize',
  mcpLogout: 'ateam:agent:mcp:logout',
  webSearchGet: 'ateam:agent:websearch:get',
  webSearchUpdate: 'ateam:agent:websearch:update',
  attachmentsImport: 'ateam:agent:attachments:import',
  attachmentRemove: 'ateam:agent:attachments:remove',
  attachmentPreview: 'ateam:agent:attachments:preview',
  filesSearch: 'ateam:agent:files:search',
  commandsList: 'ateam:agent:commands:list',
  commandExpand: 'ateam:agent:commands:expand',
  workspaceOpen: 'ateam:workspace:open',
  workspacePick: 'ateam:workspace:pick',
  openExternal: 'ateam:shell:open-external'
} as const

export const UPDATE_CHANNELS = {
  check: 'ateam:updates:check',
  download: 'ateam:updates:download'
} as const

export const UPDATE_EVENT_CHANNEL = 'ateam:updates:progress'

export const MODEL_CHANNELS = {
  get: 'ateam:models:get',
  providerAdd: 'ateam:models:providers:add',
  providerUpdate: 'ateam:models:providers:update',
  providerDelete: 'ateam:models:providers:delete',
  providerRevealKey: 'ateam:models:providers:reveal-key',
  providerAuthStatuses: 'ateam:models:providers:auth-statuses',
  providerOAuthAuthorize: 'ateam:models:providers:oauth-authorize',
  providerOAuthLogout: 'ateam:models:providers:oauth-logout',
  modelAdd: 'ateam:models:models:add',
  modelUpdate: 'ateam:models:models:update',
  modelDelete: 'ateam:models:models:delete',
  defaultSet: 'ateam:models:default:set',
  test: 'ateam:models:test',
  providerModels: 'ateam:models:providers:models',
  providerModelsPreview: 'ateam:models:providers:preview-models',
  catalog: 'ateam:models:catalog'
} as const
