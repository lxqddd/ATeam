import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  AGENT_CHANNELS,
  AGENT_EVENT_CHANNEL,
  MODEL_CHANNELS,
  THEME_CHANNEL,
  type AgentEventEnvelope,
  type AteamApi,
  type DesktopPlatform
} from '@ateam/shared'

const api: AteamApi = {
  platform: process.platform as DesktopPlatform,
  versions: { electron: process.versions.electron ?? '' },
  theme: {
    set: (theme) => {
      ipcRenderer.send(THEME_CHANNEL, theme)
    }
  },
  agent: {
    status: () => ipcRenderer.invoke(AGENT_CHANNELS.status),
    restart: () => ipcRenderer.invoke(AGENT_CHANNELS.restart),
    info: () => ipcRenderer.invoke(AGENT_CHANNELS.info),
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
      create: () => ipcRenderer.invoke(AGENT_CHANNELS.sessionCreate),
      rename: (id, title) => ipcRenderer.invoke(AGENT_CHANNELS.sessionRename, { id, title }),
      remove: (id) => ipcRenderer.invoke(AGENT_CHANNELS.sessionDelete, { id }),
      setModel: (id, model) => ipcRenderer.invoke(AGENT_CHANNELS.sessionSetModel, { id, model })
    },
    messages: {
      list: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.messagesList, { sessionId })
    },
    chat: {
      send: (input) => ipcRenderer.invoke(AGENT_CHANNELS.chatSend, input),
      stop: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.chatStop, { sessionId }),
      retry: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.chatRetry, { sessionId })
    },
    permissions: {
      list: () => ipcRenderer.invoke(AGENT_CHANNELS.permissionsList),
      reply: (requestId, decision) =>
        ipcRenderer.invoke(AGENT_CHANNELS.permissionReply, { requestId, decision })
    }
  },
  models: {
    get: () => ipcRenderer.invoke(MODEL_CHANNELS.get),
    addProvider: (input) => ipcRenderer.invoke(MODEL_CHANNELS.providerAdd, input),
    updateProvider: (input) => ipcRenderer.invoke(MODEL_CHANNELS.providerUpdate, input),
    deleteProvider: (id) => ipcRenderer.invoke(MODEL_CHANNELS.providerDelete, { id }),
    revealApiKey: (id) => ipcRenderer.invoke(MODEL_CHANNELS.providerRevealKey, { id }),
    addModel: (input) => ipcRenderer.invoke(MODEL_CHANNELS.modelAdd, input),
    updateModel: (input) => ipcRenderer.invoke(MODEL_CHANNELS.modelUpdate, input),
    deleteModel: (id) => ipcRenderer.invoke(MODEL_CHANNELS.modelDelete, { id }),
    setDefault: (model) => ipcRenderer.invoke(MODEL_CHANNELS.defaultSet, model),
    test: (providerId, modelId) => ipcRenderer.invoke(MODEL_CHANNELS.test, { providerId, modelId }),
    listModels: (providerId) =>
      ipcRenderer.invoke(MODEL_CHANNELS.providerModels, { id: providerId }),
    previewModels: (input) => ipcRenderer.invoke(MODEL_CHANNELS.providerModelsPreview, input)
  },
  workspace: {
    open: () => ipcRenderer.invoke(AGENT_CHANNELS.workspaceOpen)
  },
  openExternal: (url) => ipcRenderer.invoke(AGENT_CHANNELS.openExternal, url)
}

contextBridge.exposeInMainWorld('api', api)
