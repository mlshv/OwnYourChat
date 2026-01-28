import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  type Conversation,
  type Message,
  type ExportOptions,
  type ExportProgress,
  type ElectronAPI,
  type AppState
} from '@shared/types'
import { preloadBridge } from '@zubridge/electron/preload'

// Custom APIs for renderer
// Expose protected methods to the renderer process
const api: ElectronAPI = {
  // Conversation operations
  conversations: {
    list: (options?: {
      limit?: number
      offset?: number
      provider?: 'chatgpt' | 'claude' | 'perplexity'
    }) =>
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
    search: (query: string, options?: { provider?: 'chatgpt' | 'claude' | 'perplexity' }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_SEARCH, query, options) as Promise<{
        items: Conversation[]
        total: number
        hasMore: boolean
      }>,
    getProviderCounts: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_PROVIDER_COUNTS) as Promise<{
        chatgpt: number
        claude: number
        perplexity: number
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
      }>,
    onProgress: (callback: (progress: ExportProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) =>
        callback(progress)
      ipcRenderer.on(IPC_CHANNELS.EXPORT_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EXPORT_PROGRESS, handler)
    },
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CANCEL) as Promise<void>
  },

  // Auth operations
  auth: {
    login: (provider: 'chatgpt' | 'claude' | 'perplexity') =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, provider),
    logout: (provider?: 'chatgpt' | 'claude' | 'perplexity') =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT, provider)
  },

  // Settings operations
  settings: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET) as Promise<{
        syncIntervalMinutes: number
        autoSync: boolean
        exportPath: string
        mcpEnabled: boolean
        mcpPort: number
      }>,
    set: (settings: Partial<{
      syncIntervalMinutes: number
      autoSync: boolean
      exportPath: string
      mcpEnabled: boolean
      mcpPort: number
    }>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings)
  },

  // User preferences operations
  userPreferences: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.USER_PREFERENCES_GET) as Promise<{
        hasCompletedOnboarding: boolean
        showDebugPanel: boolean
        exportSettings: import('@shared/types').ExportSettings | null
      }>,
    set: (preferences: {
      hasCompletedOnboarding?: boolean
      showDebugPanel?: boolean
      exportSettings?: import('@shared/types').ExportSettings | null
    }) =>
      ipcRenderer.invoke(IPC_CHANNELS.USER_PREFERENCES_SET, preferences) as Promise<{
        hasCompletedOnboarding: boolean
        showDebugPanel: boolean
        exportSettings: import('@shared/types').ExportSettings | null
      }>
  },

  // Debug operations
  debug: {
    toggleChatGPTView: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TOGGLE_CHATGPT_VIEW) as Promise<{ isVisible: boolean }>,
    openChatGPTDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.DEBUG_OPEN_CHATGPT_DEVTOOLS),
    toggleClaudeView: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TOGGLE_CLAUDE_VIEW) as Promise<{ isVisible: boolean }>,
    openClaudeDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.DEBUG_OPEN_CLAUDE_DEVTOOLS),
    togglePerplexityView: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TOGGLE_PERPLEXITY_VIEW) as Promise<{
        isVisible: boolean
      }>,
    openPerplexityDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.DEBUG_OPEN_PERPLEXITY_DEVTOOLS)
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

  // Dialog operations
  dialog: {
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_FOLDER) as Promise<string | null>
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
    },
    onDebugPanelToggle: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.MENU_DEBUG_PANEL_TOGGLE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_DEBUG_PANEL_TOGGLE, handler)
    }
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
