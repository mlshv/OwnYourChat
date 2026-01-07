// Shared types between main and renderer processes

export type AuthErrorReason = 'timeout' | 'unauthorized' | null

export interface AuthStatus {
  isLoggedIn: boolean
  errorReason: AuthErrorReason
}

export type ProviderStatus =
  | 'connected'
  | 'syncing'
  | 'timeout'
  | 'logged_out'
  | 'error'
  | 'disconnected'

export interface ProviderState {
  isOnline: boolean
  status: ProviderStatus
  lastSyncAt: Date | null
  errorMessage: string | null
  isSyncing: boolean
}

export interface AppState {
  // Provider states
  providers: {
    chatgpt: ProviderState
    claude: ProviderState
    perplexity: ProviderState
  }

  // Auth state (derived from providers)
  auth: {
    isLoggedIn: boolean
    errorReason: AuthErrorReason
  }

  // Sync state
  sync: {
    isRunning: boolean
    lastSyncAt: Date | null
    error: string | null
    progress: {
      current: number
      total: number
      newChatsFound: number
    } | null
  }

  // Settings
  settings: {
    syncIntervalMinutes: number
    autoSync: boolean
    exportPath: string
    mcpEnabled: boolean
    mcpPort: number
  }

  // Actions
  updateProviderState: (
    provider: 'chatgpt' | 'claude' | 'perplexity',
    state: Partial<ProviderState>
  ) => void
  updateSyncState: (state: Partial<AppState['sync']>) => void
  updateSettings: (settings: Partial<AppState['settings']>) => void
  setAuthState: (auth: Partial<AppState['auth']>) => void
}

export interface Conversation {
  id: string
  title: string
  provider: 'chatgpt' | 'claude' | 'perplexity'
  createdAt: Date
  updatedAt: Date
  syncedAt: Date
  messageCount: number
  currentNodeId: string | null // Default branch endpoint for navigation
}

// Vercel AI SDK compatible message parts
export type MessagePart = TextPart | SourceUrlPart

export type TextPart = {
  type: 'text'
  text: string
}

export type SourceUrlPart = {
  type: 'source-url'
  sourceId: string
  url: string
  title?: string
  attribution?: string
  icon_url?: string
  snippet?: string
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  parts: MessagePart[]
  createdAt: Date
  orderIndex: number
  attachments?: Attachment[]
  // Branch/tree structure fields
  parentId: string | null // Parent message ID (null for root)
  siblingIds: string[] // All siblings including self
  siblingIndex: number // 0-based index among siblings
}

export interface Attachment {
  id: string
  messageId: string
  type: 'image' | 'file'
  fileId?: string // ChatGPT file ID (e.g., 'file_00000000ce18722fa2804568ed11e30f')
  originalUrl: string
  localPath: string
  filename: string
  mimeType: string
  size: number
  width?: number // Image width
  height?: number // Image height
}

export interface SyncStatus {
  isRunning: boolean
  lastSyncAt: Date | null
  conversationCount: number
  error: string | null
}

export type ExportSettings = {
  format: 'markdown' | 'json'
  includeAttachments: boolean
  prefixTimestamp: boolean
  outputPath: string
}

export interface ExportOptions {
  format: 'markdown' | 'json'
  includeAttachments: boolean
  prefixTimestamp?: boolean
  outputPath: string
}

// IPC channel names
export const enum IPC_CHANNELS {
  // Sync
  SYNC_STATUS = 'sync:status',

  // Conversations
  CONVERSATIONS_LIST = 'conversations:list',
  CONVERSATIONS_GET = 'conversations:get',
  CONVERSATIONS_GET_MESSAGES_PAGE = 'conversations:get-messages-page',
  CONVERSATIONS_SEARCH = 'conversations:search',
  CONVERSATIONS_REFRESH = 'conversations:refresh',

  // Export
  EXPORT_CONVERSATION = 'export:conversation',
  EXPORT_ALL = 'export:all',

  // Auth
  AUTH_STATUS = 'auth:status',
  AUTH_STATUS_CHANGED = 'auth:status-changed',
  AUTH_LOGIN = 'auth:login',
  AUTH_LOGOUT = 'auth:logout',

  // Debug
  DEBUG_TOGGLE_CHATGPT_VIEW = 'debug:toggle-chatgpt-view',
  DEBUG_OPEN_CHATGPT_DEVTOOLS = 'debug:open-chatgpt-devtools',
  DEBUG_TOGGLE_CLAUDE_VIEW = 'debug:toggle-claude-view',
  DEBUG_OPEN_CLAUDE_DEVTOOLS = 'debug:open-claude-devtools',
  DEBUG_TOGGLE_PERPLEXITY_VIEW = 'debug:toggle-perplexity-view',
  DEBUG_OPEN_PERPLEXITY_DEVTOOLS = 'debug:open-perplexity-devtools',

  // Settings
  SETTINGS_GET = 'settings:get',
  SETTINGS_SET = 'settings:set',

  // User Preferences
  USER_PREFERENCES_GET = 'user-preferences:get',
  USER_PREFERENCES_SET = 'user-preferences:set',

  // Attachments
  ATTACHMENT_DOWNLOAD = 'attachment:download',
  ATTACHMENT_OPEN = 'attachment:open',
  ATTACHMENT_EXISTS = 'attachment:exists',

  // Dialog
  DIALOG_PICK_FOLDER = 'dialog:pick-folder',

  // Shell
  SHELL_OPEN_EXTERNAL = 'shell:open-external',

  // Menu events
  MENU_EXPORT_CLICK = 'menu:export-click',
  MENU_SETTINGS_CLICK = 'menu:settings-click',
  MENU_DEBUG_PANEL_TOGGLE = 'menu:debug-panel-toggle'
}

// ElectronAPI type definition for window.api
export interface ElectronAPI {
  conversations: {
    list: (options?: { limit?: number; offset?: number }) => Promise<{
      items: Conversation[]
      total: number
      hasMore: boolean
    }>
    get: (
      id: string,
      options?: { limit?: number }
    ) => Promise<{
      conversation: Conversation
      messages: Message[]
      hasMoreMessages: boolean
      oldestLoadedOrderIndex: number | null
    } | null>
    getMessagesPage: (
      conversationId: string,
      options: { limit?: number; beforeOrderIndex?: number }
    ) => Promise<{
      messages: Message[]
      hasMore: boolean
      oldestOrderIndex: number | null
    }>
    search: (query: string) => Promise<{
      items: Conversation[]
      total: number
      hasMore: boolean
    }>
    refresh: (id: string) => Promise<{ conversation: Conversation; messages: Message[] } | null>
  }
  export: {
    conversation: (
      id: string,
      options: ExportOptions
    ) => Promise<{ success: boolean; path?: string; error?: string }>
    all: (options: ExportOptions) => Promise<{ success: boolean; path?: string; error?: string }>
  }
  auth: {
    login: (provider: 'chatgpt' | 'claude' | 'perplexity') => Promise<{ success: boolean }>
    logout: (provider?: 'chatgpt' | 'claude' | 'perplexity') => Promise<{ success: boolean }>
  }
  settings: {
    get: () => Promise<{
      syncIntervalMinutes: number
      autoSync: boolean
      exportPath: string
      mcpEnabled: boolean
      mcpPort: number
    }>
    set: (settings: {
      syncIntervalMinutes?: number
      autoSync?: boolean
      exportPath?: string
      mcpEnabled?: boolean
      mcpPort?: number
    }) => Promise<{
      syncIntervalMinutes: number
      autoSync: boolean
      exportPath: string
      mcpEnabled: boolean
      mcpPort: number
    }>
  }
  userPreferences: {
    get: () => Promise<{
      hasCompletedOnboarding: boolean
      showDebugPanel: boolean
      exportSettings: ExportSettings | null
    }>
    set: (preferences: {
      hasCompletedOnboarding?: boolean
      showDebugPanel?: boolean
      exportSettings?: ExportSettings | null
    }) => Promise<{
      hasCompletedOnboarding: boolean
      showDebugPanel: boolean
      exportSettings: ExportSettings | null
    }>
  }
  debug: {
    toggleChatGPTView: () => Promise<{ isVisible: boolean }>
    toggleClaudeView: () => Promise<{ isVisible: boolean }>
    togglePerplexityView: () => Promise<{ isVisible: boolean }>
    openChatGPTDevTools: () => Promise<void>
    openClaudeDevTools: () => Promise<void>
    openPerplexityDevTools: () => Promise<void>
  }
  attachments: {
    download: (
      attachmentId: string,
      conversationId: string
    ) => Promise<{ success: boolean; localPath?: string; error?: string }>
    open: (localPath: string) => Promise<{ success: boolean; error?: string }>
    exists: (localPath: string) => Promise<boolean>
  }
  dialog: {
    pickFolder: () => Promise<string | null>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  menu: {
    onExportClick: (callback: () => void) => () => void
    onSettingsClick: (callback: () => void) => () => void
    onDebugPanelToggle: (callback: () => void) => () => void
  }
}
