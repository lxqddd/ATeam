/** Renderer → main channel used to keep native window chrome in sync with the UI theme. */
export const THEME_CHANNEL = 'ateam:theme-changed'

/** Main → renderer channel carrying agent events. */
export const AGENT_EVENT_CHANNEL = 'ateam:agent:event'

export const AGENT_CHANNELS = {
  status: 'ateam:agent:status',
  restart: 'ateam:agent:restart',
  info: 'ateam:agent:info',
  sessionsList: 'ateam:agent:sessions:list',
  sessionCreate: 'ateam:agent:sessions:create',
  sessionRename: 'ateam:agent:sessions:rename',
  sessionDelete: 'ateam:agent:sessions:delete',
  sessionSetModel: 'ateam:agent:sessions:set-model',
  sessionSetSettings: 'ateam:agent:sessions:set-settings',
  sessionCompact: 'ateam:agent:sessions:compact',
  sessionUndo: 'ateam:agent:sessions:undo',
  sessionRedo: 'ateam:agent:sessions:redo',
  messagesList: 'ateam:agent:messages:list',
  chatSend: 'ateam:agent:chat:send',
  chatStop: 'ateam:agent:chat:stop',
  chatRetry: 'ateam:agent:chat:retry',
  permissionsList: 'ateam:agent:permissions:list',
  permissionReply: 'ateam:agent:permissions:reply',
  permissionsRules: 'ateam:agent:permissions:rules',
  permissionRuleAdd: 'ateam:agent:permissions:add-rule',
  permissionRuleRemove: 'ateam:agent:permissions:remove-rule',
  agentConfig: 'ateam:agent:config:get',
  agentConfigUpdate: 'ateam:agent:config:update',
  workspaceOpen: 'ateam:workspace:open',
  openExternal: 'ateam:shell:open-external'
} as const

export const MODEL_CHANNELS = {
  get: 'ateam:models:get',
  providerAdd: 'ateam:models:providers:add',
  providerUpdate: 'ateam:models:providers:update',
  providerDelete: 'ateam:models:providers:delete',
  providerRevealKey: 'ateam:models:providers:reveal-key',
  modelAdd: 'ateam:models:models:add',
  modelUpdate: 'ateam:models:models:update',
  modelDelete: 'ateam:models:models:delete',
  defaultSet: 'ateam:models:default:set',
  test: 'ateam:models:test',
  providerModels: 'ateam:models:providers:models',
  providerModelsPreview: 'ateam:models:providers:preview-models'
} as const
