import { ipcMain, dialog, shell } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { getMainWindow, providerRegistry } from './index.js'
import * as db from './db/operations'
import { exportConversation, exportAllConversations } from './export'
import { getSettings, updateSettings } from './settings'
import fs from 'fs'

export function setupIpcHandlers(): void {
  // Conversation handlers
  ipcMain.handle(IPC_CHANNELS.CONVERSATIONS_LIST, async (_event, options) => {
    return db.listConversations(options)
  })

  ipcMain.handle(
    IPC_CHANNELS.CONVERSATIONS_GET,
    async (_event, id: string, options?: { limit?: number }) => {
      return db.getConversationWithMessages(id, options)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONVERSATIONS_GET_MESSAGES_PAGE,
    async (
      _event,
      conversationId: string,
      options: { limit?: number; beforeOrderIndex?: number }
    ) => {
      return db.getMessagesPage(conversationId, options)
    }
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATIONS_SEARCH, async (_event, query: string) => {
    return db.searchConversations(query)
  })

  // Refresh a single conversation from provider API (for getting latest messages)
  // Uses stale-while-revalidate: returns existing data immediately if refresh fails
  ipcMain.handle(IPC_CHANNELS.CONVERSATIONS_REFRESH, async (_event, conversationId: string) => {
    try {
      // Get existing conversation to determine which provider to use
      const existing = await db.getConversation(conversationId)
      if (!existing) {
        return null
      }

      // Get the provider and delegate to its refreshAndPersistConversation method
      const provider = providerRegistry.getProvider(existing.provider as 'chatgpt' | 'claude')
      if (!provider) {
        // Provider not available, return stale data
        const result = await db.getConversationWithMessages(conversationId)
        return result ? { conversation: result.conversation, messages: result.messages } : null
      }

      // Provider handles all refresh logic and database persistence
      return await provider.refreshAndPersistConversation(conversationId)
    } catch (error) {
      console.error('[Refresh] Error refreshing conversation:', error)
      // On any error, return stale data
      const result = await db.getConversationWithMessages(conversationId)
      return result ? { conversation: result.conversation, messages: result.messages } : null
    }
  })

  // Export handlers
  ipcMain.handle(IPC_CHANNELS.EXPORT_CONVERSATION, async (_event, id: string, options) => {
    try {
      // Get conversation to determine provider
      const conversation = await db.getConversation(id)
      if (!conversation) {
        return { success: false, error: 'Conversation not found' }
      }

      // Get provider instance for downloading attachments
      const provider = providerRegistry.getProvider(conversation.provider as 'chatgpt' | 'claude')
      const context = {
        provider: provider ?? null
      }

      const result = await exportConversation(id, options, context)
      return { success: true, path: result }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXPORT_ALL, async (_event, options) => {
    try {
      // Let user pick export directory
      const mainWindow = getMainWindow()
      if (!mainWindow) {
        return { success: false, error: 'No main window' }
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Export Directory'
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Export cancelled' }
      }

      // For batch export, we'll use ChatGPT provider as fallback
      // Individual conversation exports will use their own provider
      const provider = providerRegistry.getProvider('chatgpt')
      const context = {
        provider: provider ?? null
      }

      const exportPath = await exportAllConversations(
        {
          ...options,
          outputPath: result.filePaths[0]
        },
        context
      )
      return { success: true, path: exportPath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, providerName: 'chatgpt' | 'claude') => {
    const provider = providerRegistry.getProvider(providerName)
    provider?.showLogin()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (_event, providerName?: 'chatgpt' | 'claude') => {
    if (providerName) {
      // Logout specific provider
      const provider = providerRegistry.getProvider(providerName)
      if (provider) {
        await provider.logout()
      }
      console.log(`[Auth] Logged out ${providerName}`)
    } else {
      // Logout all providers
      const providers = providerRegistry.getAllProviders()
      for (const provider of providers) {
        await provider.logout()
      }
      console.log('[Auth] Logged out all providers')
    }
    return { success: true }
  })

  // Settings handlers
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return getSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, settings) => {
    return updateSettings(settings)
  })

  // User preferences handlers
  ipcMain.handle(IPC_CHANNELS.USER_PREFERENCES_GET, async () => {
    return db.getUserPreferences()
  })

  ipcMain.handle(IPC_CHANNELS.USER_PREFERENCES_SET, async (_event, preferences) => {
    return db.setUserPreferences(preferences)
  })

  // Debug handlers
  ipcMain.handle(IPC_CHANNELS.DEBUG_TOGGLE_CHATGPT_VIEW, async () => {
    const provider = providerRegistry.getProvider('chatgpt')
    const isVisible = provider?.toggleView() ?? false
    return { isVisible }
  })

  ipcMain.handle(IPC_CHANNELS.DEBUG_OPEN_CHATGPT_DEVTOOLS, async () => {
    const provider = providerRegistry.getProvider('chatgpt')
    const view = provider?.getView()
    if (view) {
      view.webContents.openDevTools({ mode: 'detach' })
    }
  })

  ipcMain.handle(IPC_CHANNELS.DEBUG_TOGGLE_CLAUDE_VIEW, async () => {
    const provider = providerRegistry.getProvider('claude')
    const isVisible = provider?.toggleView() ?? false
    return { isVisible }
  })

  ipcMain.handle(IPC_CHANNELS.DEBUG_OPEN_CLAUDE_DEVTOOLS, async () => {
    const provider = providerRegistry.getProvider('claude')
    const view = provider?.getView()
    if (view) {
      view.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Attachment handlers
  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENT_DOWNLOAD,
    async (_event, attachmentId: string, conversationId: string) => {
      try {
        const attachment = await db.getAttachment(attachmentId)
        if (!attachment) {
          return { success: false, error: 'Attachment not found' }
        }

        // Need fileId to download
        if (!attachment.fileId) {
          return { success: false, error: 'No fileId for attachment' }
        }

        // Get conversation to determine provider
        const conversation = await db.getConversationFromAttachmentId(attachmentId)
        if (!conversation) {
          return { success: false, error: 'Conversation not found for attachment' }
        }

        // Get provider instance
        const provider = providerRegistry.getProvider(conversation.provider as 'chatgpt' | 'claude')
        if (!provider) {
          return { success: false, error: `${conversation.provider} provider not available` }
        }

        // Download the attachment using provider method
        const localPath = await provider.downloadAttachment(
          attachment.fileId,
          attachment.filename,
          conversationId
        )

        // Update the database
        await db.updateAttachmentLocalPath(attachmentId, localPath)

        return { success: true, localPath }
      } catch (error) {
        console.error('[Attachment] Download failed:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Open file in default system app
  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_OPEN, async (_event, localPath: string) => {
    try {
      const result = await shell.openPath(localPath)
      if (result) {
        // shell.openPath returns empty string on success, error message on failure
        return { success: false, error: result }
      }
      return { success: true }
    } catch (error) {
      console.error('[Attachment] Open failed:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Check if file exists on filesystem
  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_EXISTS, async (_event, localPath: string) => {
    try {
      return fs.existsSync(localPath)
    } catch {
      return false
    }
  })

  // Open URL
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(url)
  })
}
