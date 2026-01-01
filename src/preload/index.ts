import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  type Conversation,
  type Message,
  type ExportOptions,
  type ElectronAPI,
  type AppState
} from '@shared/types'
import { preloadBridge } from '@zubridge/electron/preload'

// Custom APIs for renderer
// Expose protected methods to the renderer process
const api: ElectronAPI = {
  // Conversation operations
  conversations: {
    list: (options?: { limit?: number; offset?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_LIST, options) as Promise<{
        items: Conversation[]
        total: number
        hasMore: boolean
      }>,
    get: (id: string, options?: { limit?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_GET, id, options) as Promise<{
        conversation: Conversation
        messages: Message[]
        hasMoreMessages: boolean
        oldestLoadedOrderIndex: number | null
      } | null>,
    getMessagesPage: (
      conversationId: string,
      options: { limit?: number; beforeOrderIndex?: number }
    ) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.CONVERSATIONS_GET_MESSAGES_PAGE,
        conversationId,
        options
      ) as Promise<{
        messages: Message[]
        hasMore: boolean
        oldestOrderIndex: number | null
      }>,
    search: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_SEARCH, query) as Promise<{
        items: Conversation[]
        total: number
        hasMore: boolean
      }>,
    refresh: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_REFRESH, id) as Promise<{
        conversation: Conversation
        messages: Message[]
      } | null>
  },

  // Export operations
  export: {
    conversation: (id: string, options: ExportOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CONVERSATION, id, options) as Promise<{
        success: boolean
        path?: string
        error?: string
      }>,
    all: (options: ExportOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_ALL, options) as Promise<{
        success: boolean
        path?: string
        error?: string
      }>
  },

  // Auth operations
  auth: {
    login: (provider: 'chatgpt' | 'claude') =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, provider),
    logout: (provider?: 'chatgpt' | 'claude') =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT, provider)
  },

  // Settings operations
  settings: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET) as Promise<{
        syncIntervalMinutes: number
        autoSync: boolean
        exportPath: string
        hindsightEnabled: boolean
        hindsightServerUrl: string
        hindsightBankId: string
        hindsightAutoIndex: boolean
      }>,
    set: (settings: Partial<{
      syncIntervalMinutes: number
      autoSync: boolean
      exportPath: string
      hindsightEnabled: boolean
      hindsightServerUrl: string
      hindsightBankId: string
      hindsightAutoIndex: boolean
    }>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings)
  },

  // User preferences operations
  userPreferences: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.USER_PREFERENCES_GET) as Promise<{
        hasCompletedOnboarding: boolean
      }>,
    set: (preferences: { hasCompletedOnboarding?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.USER_PREFERENCES_SET, preferences) as Promise<{
        hasCompletedOnboarding: boolean
      }>
  },

  // Debug operations
  debug: {
    toggleChatGPTView: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TOGGLE_CHATGPT_VIEW) as Promise<{ isVisible: boolean }>,
    openChatGPTDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.DEBUG_OPEN_CHATGPT_DEVTOOLS),
    toggleClaudeView: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TOGGLE_CLAUDE_VIEW) as Promise<{ isVisible: boolean }>,
    openClaudeDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.DEBUG_OPEN_CLAUDE_DEVTOOLS)
  },

  // Attachment operations
  attachments: {
    download: (attachmentId: string, conversationId: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.ATTACHMENT_DOWNLOAD,
        attachmentId,
        conversationId
      ) as Promise<{
        success: boolean
        localPath?: string
        error?: string
      }>,
    open: (localPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ATTACHMENT_OPEN, localPath) as Promise<{
        success: boolean
        error?: string
      }>,
    exists: (localPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ATTACHMENT_EXISTS, localPath) as Promise<boolean>
  },

  // Shell operations
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url)
  },

  // Menu events
  menu: {
    onExportClick: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.MENU_EXPORT_CLICK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_EXPORT_CLICK, handler)
    },
    onSettingsClick: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.MENU_SETTINGS_CLICK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_SETTINGS_CLICK, handler)
    }
  },

  // Hindsight operations
  hindsight: {
    indexConversation: (conversationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.HINDSIGHT_INDEX_CONVERSATION, conversationId) as Promise<{
        success: boolean
        error?: string
      }>,
    indexAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.HINDSIGHT_INDEX_ALL) as Promise<{
        success: boolean
        indexed?: number
        error?: string
      }>,
    recall: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.HINDSIGHT_RECALL, query) as Promise<{
        success: boolean
        results?: Array<{
          content: string
          score: number
          metadata?: Record<string, unknown>
        }>
        error?: string
      }>,
    reflect: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.HINDSIGHT_REFLECT, query) as Promise<{
        success: boolean
        reflection?: string
        error?: string
      }>,
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.HINDSIGHT_STATUS) as Promise<{
        connected: boolean
        enabled: boolean
        serverUrl: string
        bankId: string
      }>
  }
}

// Create Zubridge IPC handler for store
const { handlers: storeHandlers } = preloadBridge<AppState>()

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('zubridge', storeHandlers)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.zubridge = storeHandlers
}
