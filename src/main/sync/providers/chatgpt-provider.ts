import { WebContentsView, session } from 'electron'
import { BaseProvider, type SyncResult, type ProviderName } from './base'
import type { IStorage } from '../../storage/interface'
import type { ChatGPTMetadata } from './types'
import { getMainWindow } from '../../index'
import { IPC_CHANNELS } from '@shared/types'
import { findCachedFile, getExtensionFromMimeType } from '../attachment-utils.js'
import { getAttachmentsPath } from '../../settings.js'
import { transformChatGPTMessageToParts } from './chatgpt/utils'
import fs from 'fs'
import path from 'path'

const TOOLBAR_HEIGHT = 40

// ============================================================================
// TYPES - Exported for external use
// ============================================================================

export type ApiHeaders = Record<string, string>

export interface ConversationListItem {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export interface ExtractedAttachment {
  type: 'image' | 'file'
  fileId: string
  filename: string | null
  mimeType: string | null
  width?: number
  height?: number
  size?: number
}

export interface ExtractedContentReference {
  matched_text: string
  type: 'webpage' | 'webpage_extended' | 'image_inline'
  title?: string
  url?: string
  snippet?: string
  attribution?: string
}

export interface ExtractedMessage {
  id: string
  nodeId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  contentType?: string
  createdAt?: Date
  modelSlug?: string
  attachments?: ExtractedAttachment[]
  contentReferences?: ExtractedContentReference[]
  parentNodeId: string | null
  siblingNodeIds: string[]
  siblingIndex: number
}

export interface ExtractedConversation {
  title: string
  currentNode: string | null
  messages: ExtractedMessage[]
}

export interface DownloadedFile {
  data: Buffer
  mimeType: string
}

interface FetchConversationsOptions {
  stopBeforeTimestamp?: number | null
  onPage?: (conversations: ConversationListItem[], pageNumber: number) => Promise<void>
}

// ============================================================================
// PROVIDER CLASS
// ============================================================================

export class ChatGPTProvider extends BaseProvider<ChatGPTMetadata> {
  readonly name: ProviderName = 'chatgpt'

  private view: WebContentsView | null = null
  private capturedHeaders: ApiHeaders | null = null
  private lastApiAuthSuccess: boolean = false
  private isViewVisible: boolean = false
  private loginCheckInterval: NodeJS.Timeout | null = null
  private syncingConversations = new Set<string>() // In-memory tracking of conversations being synced

  constructor(storage: IStorage, pollingIntervalMs: number = 60000) {
    super(storage, pollingIntervalMs)
  }

  protected getDefaultMetadata(): ChatGPTMetadata {
    return {
      lastCompletedOffset: 0,
      isFullSyncComplete: false,
      lastSyncPageSize: 50
    }
  }

  async initialize(): Promise<void> {
    await this.loadPersistedState()
    this.createView()
    // Update Zustand store with loaded state
    this.updateStoreState()
  }

  isConnected(): boolean {
    return this.capturedHeaders !== null
  }

  getView(): WebContentsView | null {
    return this.view
  }

  getHeaders(): Record<string, string> | null {
    return this.capturedHeaders
  }

  toggleView(): boolean {
    if (this.isViewVisible) {
      this.hideView()
      return false
    } else {
      this.showLogin()
      return true
    }
  }

  showLogin(): void {
    const mainWindow = getMainWindow()
    if (!mainWindow || !this.view) return

    mainWindow.contentView.addChildView(this.view)

    const bounds = mainWindow.getContentBounds()
    this.view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height - TOOLBAR_HEIGHT
    })

    this.isViewVisible = true
    this.view.webContents.loadURL('https://chatgpt.com/')

    mainWindow.on('resize', this.updateViewBounds)
    this.startLoginMonitor()
  }

  hideView(): void {
    const mainWindow = getMainWindow()
    if (!mainWindow || !this.view) return

    mainWindow.contentView.removeChildView(this.view)
    mainWindow.off('resize', this.updateViewBounds)
    this.isViewVisible = false
  }

  async logout(): Promise<void> {
    const chatGPTSession = session.fromPartition('persist:chatgpt')
    await chatGPTSession.clearStorageData()
    this.hideView()
    this.capturedHeaders = null
    this.lastApiAuthSuccess = false

    this._status = 'logged_out'
    await this.storage.setProviderState({
      providerName: this.name,
      isOnline: false,
      lastSyncAt: this._lastSyncAt,
      status: this._status,
      errorMessage: null
    })

    this.updateStoreState()
    console.log(`[${this.name}] Logged out, cleared session data`)
  }

  // ============================================================================
  // PUBLIC API METHODS - For external use (ipc.ts, attachments.ts, etc.)
  // ============================================================================

  /**
   * Refresh a single conversation from the ChatGPT API
   * Used by ipc.ts for CONVERSATIONS_REFRESH handler
   */
  async refreshConversation(conversationId: string): Promise<ExtractedConversation | null> {
    if (!this.view || !this.capturedHeaders) {
      return null
    }

    try {
      return await this.extractConversationContent(conversationId, this.capturedHeaders)
    } catch (error) {
      console.error(`[${this.name}] Error refreshing conversation:`, error)
      return null
    }
  }

  /**
   * Refresh and persist a conversation (stale-while-revalidate pattern)
   * Fetches from API and updates database only if successful
   */
  async refreshAndPersistConversation(conversationId: string) {
    try {
      // Get existing conversation to ensure it exists
      const existing = await this.storage.getConversation(conversationId)
      if (!existing) {
        return null
      }

      // If provider not available, return stale data
      if (!this.view || !this.capturedHeaders) {
        return this.storage.getConversationWithMessages(conversationId)
      }

      // Try to refresh from API
      const content = await this.refreshConversation(conversationId)
      if (!content) {
        // Refresh failed, return stale data
        return this.storage.getConversationWithMessages(conversationId)
      }

      // Refresh successful - update database
      await this.storage.upsertConversation({
        id: conversationId,
        title: content.title || existing.title,
        provider: 'chatgpt',
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        syncedAt: new Date(),
        messageCount: content.messages.length,
        currentNodeId: content.currentNode
      })

      // Upsert messages
      const messageInserts = content.messages.map((msg, index) => {
        const parts = transformChatGPTMessageToParts({
          content: msg.content,
          contentReferences: msg.contentReferences
        })
        return {
          id: msg.nodeId || msg.id || `${conversationId}-${index}`,
          conversationId: conversationId,
          role: msg.role,
          parts: JSON.stringify(parts),
          createdAt: msg.createdAt,
          orderIndex: index,
          parentId: msg.parentNodeId,
          siblingIds: JSON.stringify(msg.siblingNodeIds),
          siblingIndex: msg.siblingIndex
        }
      })

      await this.storage.upsertMessages(messageInserts)

      // Upsert attachments (use deterministic ID based on messageId + fileId)
      const allAttachments = content.messages.flatMap((msg) => {
        if (!msg.attachments || msg.attachments.length === 0) return []
        const messageId =
          msg.nodeId || msg.id || `${conversationId}-${content.messages.indexOf(msg)}`
        return msg.attachments.map((att, idx) => ({
          id: `${messageId}-att-${att.fileId || idx}`,
          messageId,
          type: att.type,
          fileId: att.fileId,
          originalUrl: '',
          localPath: '',
          filename: att.filename || att.fileId,
          mimeType: att.mimeType || '',
          size: att.size || 0,
          width: att.width,
          height: att.height
        }))
      })

      if (allAttachments.length > 0) {
        await this.storage.upsertAttachments(allAttachments)
      }

      // Return updated data
      const result = await this.storage.getConversationWithMessages(conversationId)
      return result ? { conversation: result.conversation, messages: result.messages } : null
    } catch (error) {
      console.error('[ChatGPT] Error in refreshAndPersistConversation:', error)
      // On any error, return stale data
      const result = await this.storage.getConversationWithMessages(conversationId)
      return result ? { conversation: result.conversation, messages: result.messages } : null
    }
  }

  /**
   * Get download URL for a file from ChatGPT files API
   * Used by attachments.ts
   */
  async getFileDownloadUrl(fileId: string): Promise<string | null> {
    if (!this.view || !this.capturedHeaders) {
      return null
    }

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) {
        await this.view.webContents.loadURL('https://chatgpt.com/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log(`[${this.name}] Getting download URL for file ${fileId}...`)
      const result = await this.view.webContents.executeJavaScript(
        this.makeGetFileDownloadUrlScript(fileId, this.capturedHeaders)
      )

      return result || null
    } catch (error) {
      console.error(`[${this.name}] Error getting file download URL:`, error)
      return null
    }
  }

  /**
   * Download a file via webContents and return as Buffer
   * Used by attachments.ts
   */
  async downloadFile(downloadUrl: string): Promise<DownloadedFile> {
    if (!this.view) {
      throw new Error('View not initialized')
    }

    const url = this.view.webContents.getURL()
    if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) {
      await this.view.webContents.loadURL('https://chatgpt.com/')
      await new Promise((r) => setTimeout(r, 2000))
    }

    const result = await this.view.webContents.executeJavaScript(
      this.makeDownloadFileScript(downloadUrl)
    )

    if (result.error) {
      throw new Error(result.error)
    }

    return {
      data: Buffer.from(result.data, 'base64'),
      mimeType: result.mimeType
    }
  }

  /**
   * Download an attachment from ChatGPT using the files API.
   * This uses a two-step process:
   * 1. Get signed download URL from /backend-api/files/download/{fileId}
   * 2. Download the file via webContents to use session cookies
   *
   * Files are cached by fileId - if the file already exists, returns the cached path.
   */
  async downloadAttachment(
    fileId: string,
    filename: string | null,
    conversationId: string
  ): Promise<string> {
    // Check if file is already cached
    const cachedPath = findCachedFile(conversationId, fileId)
    if (cachedPath) {
      return cachedPath
    }

    // Step 1: Get signed download URL from ChatGPT API
    const downloadUrl = await this.getFileDownloadUrl(fileId)
    if (!downloadUrl) {
      throw new Error(`Failed to get download URL for file ${fileId}`)
    }

    console.log(`[Attachments] Got download URL for ${fileId}`)

    // Step 2: Download via webContents (uses session cookies)
    const downloaded = await this.downloadFile(downloadUrl)

    // Ensure conversation directory exists
    const attachmentsPath = getAttachmentsPath()
    const conversationDir = path.join(attachmentsPath, conversationId)
    if (!fs.existsSync(conversationDir)) {
      fs.mkdirSync(conversationDir, { recursive: true })
    }

    // Generate filename: {fileId}_{displayName}.{ext}
    let displayName = filename || 'attachment'

    // Add extension based on mime type if missing
    if (!path.extname(displayName)) {
      const ext = getExtensionFromMimeType(downloaded.mimeType)
      displayName += ext
    }

    // Filename format: fileId_displayName (allows lookup by fileId prefix)
    const uniqueFilename = `${fileId}_${displayName}`
    const localPath = path.join(conversationDir, uniqueFilename)

    // Write file to disk
    fs.writeFileSync(localPath, downloaded.data)

    console.log(`[Attachments] Downloaded ${fileId} to ${localPath}`)
    return localPath
  }

  // ============================================================================
  // SYNC METHOD
  // ============================================================================

  async sync(): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders) {
      return { success: false, error: 'Not connected' }
    }

    try {
      const metadata = await this.getMetadata()

      // Choose sync mode based on whether we've completed a full sync
      if (!metadata.isFullSyncComplete) {
        console.log(`[${this.name}] Starting full sync from offset ${metadata.lastCompletedOffset}`)
        return await this.fullSync(metadata)
      } else {
        console.log(`[${this.name}] Starting incremental sync`)
        return await this.incrementalSync()
      }
    } catch (error) {
      const errorMessage = (error as Error).message
      console.error(`[${this.name}] Sync error:`, error)
      return { success: false, error: errorMessage }
    }
  }

  // ============================================================================
  // FULL SYNC - Resume from offset until pagination complete
  // ============================================================================

  private async fullSync(metadata: ChatGPTMetadata): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders) {
      return { success: false, error: 'Not connected' }
    }

    let offset = metadata.lastCompletedOffset
    let newChatsFound = 0
    const PAGE_SIZE = 50

    try {
      while (true) {
        console.log(`[${this.name}] Fetching page at offset ${offset}...`)

        const result = await this.view.webContents.executeJavaScript(
          this.makeFetchConversationPageScript(this.capturedHeaders, offset, PAGE_SIZE)
        )

        if (result.error) {
          console.error(`[${this.name}] API error at offset ${offset}:`, result.error)
          throw new Error(`API error: ${result.error}`)
        }

        const pageConversations: ConversationListItem[] = result.items.map((item) => ({
          id: item.id,
          title: item.title,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt)
        }))

        console.log(
          `[${this.name}] Processing ${pageConversations.length} conversations at offset ${offset}`
        )

        // Report progress (offset is current position, result.total is total)
        this.updateSyncProgress(offset, result.total, newChatsFound)

        // Process entire page atomically
        for (const conv of pageConversations) {
          await this.syncConversationWithRetry(conv)
          newChatsFound++
        }

        // Only mark offset complete after ALL conversations succeed
        offset += PAGE_SIZE
        await this.setMetadata({
          ...metadata,
          lastCompletedOffset: offset
        })

        console.log(`[${this.name}] Completed offset ${offset}, total: ${result.total}`)

        // Check if last page (your key insight!)
        if (result.total <= offset) {
          console.log(
            `[${this.name}] Reached end of pagination (total ${result.total} <= offset ${offset})`
          )
          await this.setMetadata({
            ...metadata,
            lastCompletedOffset: offset,
            isFullSyncComplete: true
          })
          break
        }

        // Safety limit
        if (offset > 10000) {
          console.warn(`[${this.name}] Reached safety limit of 10000 conversations`)
          break
        }
      }

      console.log(`[${this.name}] Full sync complete! Synced ${newChatsFound} conversations`)
      return { success: true, newChatsFound }
    } catch (error) {
      console.error(`[${this.name}] Full sync error:`, error)
      return { success: false, error: (error as Error).message }
    }
  }

  // ============================================================================
  // INCREMENTAL SYNC - Keep existing maxLocalUpdatedAt logic
  // ============================================================================

  private async incrementalSync(): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders) {
      return { success: false, error: 'Not connected' }
    }

    try {
      const maxLocalUpdatedAt = await this.storage.getMaxUpdatedAt(this.name)
      console.log(
        `[${this.name}] Max local updated_at: ${maxLocalUpdatedAt?.toISOString() ?? 'none'}`
      )

      let newChatsFound = 0
      let isFirstPage = true
      let shouldEarlyExit = false

      const truncateToSeconds = (date: Date): number => {
        return Math.floor(date.getTime() / 1000) * 1000
      }

      await this.extractConversationList(this.capturedHeaders, {
        stopBeforeTimestamp: maxLocalUpdatedAt ? truncateToSeconds(maxLocalUpdatedAt) : null,
        onPage: async (pageConversations, pageNumber) => {
          console.log('[ChatGPT] onPage', { pageConversations, pageNumber })
          if (isFirstPage && maxLocalUpdatedAt && pageConversations.length > 0) {
            const mostRecentApiChat = pageConversations[0]
            if (
              truncateToSeconds(mostRecentApiChat.updatedAt) ===
              truncateToSeconds(maxLocalUpdatedAt)
            ) {
              console.log(`[${this.name}] Timestamps match, syncing most recent conversation`)
              try {
                await this.syncConversationWithRetry(mostRecentApiChat)
                newChatsFound = 1
              } catch (err) {
                console.error(`[${this.name}] Error syncing most recent conversation:`, err)
              }
              shouldEarlyExit = true
              return
            }
            isFirstPage = false
          }

          if (shouldEarlyExit) return

          console.log(
            `[${this.name}] Processing page ${pageNumber} with ${pageConversations.length} conversations`
          )

          for (const conv of pageConversations) {
            newChatsFound++
            console.log(`[${this.name}] Syncing conversation ${newChatsFound}: ${conv.title}`)

            try {
              await this.syncConversationWithRetry(conv)
            } catch (err) {
              console.error(`[${this.name}] Error syncing conversation ${conv.id}:`, err)
            }
          }
        }
      })

      console.log(`[${this.name}] Incremental sync complete! Synced ${newChatsFound} conversations`)
      return { success: true, newChatsFound }
    } catch (error) {
      const errorMessage = (error as Error).message
      console.error(`[${this.name}] Incremental sync error:`, error)
      return { success: false, error: errorMessage }
    }
  }

  // ============================================================================
  // RETRY LOGIC - With exponential backoff
  // ============================================================================

  private async syncConversationWithRetry(
    conv: ConversationListItem,
    maxRetries = 3
  ): Promise<void> {
    this.syncingConversations.add(conv.id) // Track in-memory

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await this.syncConversation(conv)

          // Clear error on success
          await this.storage.updateConversationSyncError(conv.id, null, 0)
          return
        } catch (error) {
          if (attempt === maxRetries - 1) {
            // Final failure - persist error
            console.error(
              `[${this.name}] Failed to sync conversation ${conv.id} after ${maxRetries} attempts:`,
              error
            )
            await this.storage.updateConversationSyncError(
              conv.id,
              (error as Error).message,
              attempt + 1
            )
            throw error
          }

          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, attempt) * 1000
          console.log(
            `[${this.name}] Retry ${attempt + 1}/${maxRetries} for conversation ${conv.id} after ${backoffMs}ms`
          )
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    } finally {
      this.syncingConversations.delete(conv.id)
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS - API interaction
  // ============================================================================

  private async extractConversationList(
    headers: ApiHeaders,
    options?: FetchConversationsOptions
  ): Promise<ConversationListItem[]> {
    if (!this.view) throw new Error('View not initialized')

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) {
        await this.view.webContents.loadURL('https://chatgpt.com/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log(`[${this.name}] Fetching conversations via API...`)

      const allConversations: ConversationListItem[] = []
      const stopBeforeTimestamp = options?.stopBeforeTimestamp ?? null
      const pageSize = 50
      let offset = 0
      let hasMore = true
      let pageNumber = 0

      while (hasMore) {
        const result = await this.view.webContents.executeJavaScript(
          this.makeFetchConversationPageScript(headers, offset, pageSize)
        )

        if (result.error) {
          console.error(`[${this.name}] API error on page ${pageNumber}:`, result.error)
          break
        }

        const pageConversations: ConversationListItem[] = []

        for (const item of result.items) {
          const conv: ConversationListItem = {
            id: item.id,
            title: item.title,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt)
          }

          const convTimestamp = Math.floor(conv.updatedAt.getTime() / 1000) * 1000
          if (stopBeforeTimestamp && convTimestamp <= stopBeforeTimestamp) {
            console.log(`[${this.name}] Reached timestamp threshold, stopping pagination`)
            hasMore = false
            break
          }

          pageConversations.push(conv)
          allConversations.push(conv)
        }

        if (pageConversations.length > 0 && options?.onPage) {
          await options.onPage(pageConversations, pageNumber)
        }

        console.log(
          `[${this.name}] Page ${pageNumber}: fetched ${pageConversations.length} conversations (total: ${allConversations.length})`
        )

        if (hasMore) {
          hasMore = result.hasMore
        }
        offset += pageSize
        pageNumber++

        if (offset > 10000) break
      }

      console.log(`[${this.name}] Finished fetching ${allConversations.length} conversations`)
      return allConversations
    } catch (error) {
      console.error(`[${this.name}] Error fetching conversation list:`, error)
      throw error
    }
  }

  private async extractConversationContent(
    conversationId: string,
    headers: ApiHeaders
  ): Promise<ExtractedConversation> {
    if (!this.view) throw new Error('View not initialized')

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) {
        await this.view.webContents.loadURL('https://chatgpt.com/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      const conversation = await this.storage.getConversation(conversationId)

      console.log(
        `[${this.name}] Fetching conversation "${conversation?.title ?? conversationId}" via API...`
      )
      const result = await this.view.webContents.executeJavaScript(
        this.makeFetchConversationScript(conversationId, headers)
      )

      if (!result) {
        console.warn(`[${this.name}] Failed to fetch conversation from API`)
        return { title: 'Untitled', currentNode: null, messages: [] }
      }

      console.log(
        `[${this.name}] Fetched conversation "${conversation?.title ?? conversationId}" with ${result.messages.length} messages`
      )

      return {
        title: result.title || 'Untitled',
        currentNode: result.currentNode || null,
        messages: (result.messages || []).map((msg) => ({
          id: msg.id,
          nodeId: msg.nodeId,
          role: msg.role,
          content: msg.content,
          contentType: msg.contentType,
          createdAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
          modelSlug: msg.modelSlug,
          attachments: msg.attachments,
          contentReferences: msg.contentReferences,
          parentNodeId: msg.parentNodeId || null,
          siblingNodeIds: msg.siblingNodeIds || [],
          siblingIndex: msg.siblingIndex ?? 0
        }))
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching conversation content:`, error)
      throw error
    }
  }

  private async syncConversation(conv: ConversationListItem): Promise<void> {
    if (!this.view || !this.capturedHeaders) {
      throw new Error('Not connected')
    }

    const content = await this.extractConversationContent(conv.id, this.capturedHeaders)

    const existing = await this.storage.getConversation(conv.id)
    if (existing) {
      await this.storage.deleteMessagesForConversation(conv.id)
    }

    await this.storage.upsertConversation({
      id: conv.id,
      title: conv.title,
      provider: 'chatgpt',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      syncedAt: new Date(),
      messageCount: content.messages.length,
      currentNodeId: content.currentNode
    })

    const messageInserts = content.messages.map((msg, index) => {
      const parts = transformChatGPTMessageToParts({
        content: msg.content,
        contentReferences: msg.contentReferences
      })
      return {
        id: msg.nodeId || msg.id || `${conv.id}-${index}`,
        conversationId: conv.id,
        role: msg.role,
        parts: JSON.stringify(parts),
        createdAt: msg.createdAt,
        orderIndex: index,
        parentId: msg.parentNodeId,
        siblingIds: JSON.stringify(msg.siblingNodeIds),
        siblingIndex: msg.siblingIndex
      }
    })

    await this.storage.upsertMessages(messageInserts)

    for (const msg of content.messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        const messageId = msg.nodeId || msg.id || `${conv.id}-${content.messages.indexOf(msg)}`
        const attachmentInserts = msg.attachments.map((att, idx) => ({
          id: `${messageId}-att-${att.fileId || idx}`,
          messageId,
          type: att.type,
          fileId: att.fileId,
          originalUrl: '',
          localPath: '',
          filename: att.filename || att.fileId,
          mimeType: att.mimeType || '',
          size: att.size || 0,
          width: att.width,
          height: att.height
        }))
        await this.storage.upsertAttachments(attachmentInserts)
      }
    }
  }

  // ============================================================================
  // JAVASCRIPT INJECTION SCRIPTS
  // ============================================================================

  private makeFetchConversationPageScript(
    headers: ApiHeaders,
    offset: number,
    limit: number = 50
  ): string {
    return `
(async function() {
  const headers = ${JSON.stringify(headers)};

  const response = await fetch(
    'https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated&is_archived=false&is_starred=false',
    {
      credentials: 'include',
      headers: headers,
    }
  );

  if (!response.ok) {
    console.error('[ChatGPT API] Failed to fetch conversations:', response.status);
    return { items: [], hasMore: false, total: 0, offset: ${offset}, error: response.status };
  }

  const data = await response.json();
  const items = (data.items || []).map(item => ({
    id: item.id,
    title: item.title || 'Untitled',
    createdAt: item.create_time,
    updatedAt: item.update_time,
  }));

  return {
    items: items,
    hasMore: items.length === ${limit},
    total: data.total || 0,
    offset: ${offset}
  };
})();
`
  }

  private makeFetchConversationScript(conversationId: string, headers: ApiHeaders): string {
    return `
(async function() {
  const headers = ${JSON.stringify(headers)};

  const response = await fetch(
    'https://chatgpt.com/backend-api/conversation/${conversationId}',
    {
      credentials: 'include',
      headers: headers,
    }
  );

  if (!response.ok) {
    console.error('[ChatGPT API] Failed to fetch conversation:', response.status);
    return null;
  }

  const data = await response.json();
  const messages = [];
  const mapping = data.mapping || {};
  const messageNodes = Object.values(mapping);
  const sortedMessages = [];
  const currentNode = data.current_node;

  // Build a parent->children map
  const childrenMap = {};
  for (const node of messageNodes) {
    const parentId = node.parent;
    if (parentId) {
      if (!childrenMap[parentId]) childrenMap[parentId] = [];
      childrenMap[parentId].push(node.id);
    }
  }

  // Sort children by creation time
  for (const parentId of Object.keys(childrenMap)) {
    childrenMap[parentId].sort((a, b) => {
      const timeA = mapping[a]?.message?.create_time || 0;
      const timeB = mapping[b]?.message?.create_time || 0;
      return timeA - timeB;
    });
  }

  // Find root node
  let rootId = null;
  for (const node of messageNodes) {
    if (!node.parent || !mapping[node.parent]) {
      rootId = node.id;
      break;
    }
  }

  const seenImageFileIds = new Set();

  // Traverse from root to collect messages
  function traverse(nodeId) {
    const node = mapping[nodeId];
    if (!node) return;

    const msg = node.message;
    if (msg && msg.content) {
      if (msg.metadata?.is_visually_hidden_from_conversation) {
        const children = childrenMap[nodeId] || [];
        for (const childId of children) {
          traverse(childId);
        }
        return;
      }

      const contentType = msg.content.content_type;
      const role = msg.author?.role;

      if (contentType === 'user_editable_context' || contentType === 'model_editable_context') {
        const children = childrenMap[nodeId] || [];
        for (const childId of children) {
          traverse(childId);
        }
        return;
      }

      if (msg.recipient && msg.recipient !== 'all') {
        const children = childrenMap[nodeId] || [];
        for (const childId of children) {
          traverse(childId);
        }
        return;
      }

      if (role === 'tool' && contentType === 'multimodal_text') {
        const attachments = [];

        if (msg.content.parts) {
          for (const part of msg.content.parts) {
            if (part.content_type === 'image_asset_pointer') {
              let fileId = null;
              if (part.asset_pointer) {
                if (part.asset_pointer.startsWith('sediment://')) {
                  fileId = part.asset_pointer.replace('sediment://', '');
                } else if (part.asset_pointer.startsWith('file-service://')) {
                  fileId = part.asset_pointer.replace('file-service://', '');
                } else {
                  fileId = part.asset_pointer;
                }
              }
              if (fileId && !seenImageFileIds.has(fileId)) {
                seenImageFileIds.add(fileId);
                attachments.push({
                  type: 'image',
                  fileId: fileId,
                  width: part.width,
                  height: part.height,
                  size: part.size_bytes,
                  filename: msg.metadata?.image_gen_title || null,
                  mimeType: null,
                });
              }
            }
          }
        }

        if (attachments.length > 0) {
          const parentNodeId = node.parent;
          const siblings = parentNodeId ? (childrenMap[parentNodeId] || [nodeId]) : [nodeId];
          const siblingIndex = siblings.indexOf(nodeId);

          sortedMessages.push({
            id: msg.id,
            nodeId: nodeId,
            role: 'assistant',
            content: '',
            contentType: contentType,
            createdAt: msg.create_time ? msg.create_time * 1000 : null,
            modelSlug: undefined,
            attachments: attachments,
            contentReferences: undefined,
            parentNodeId: parentNodeId,
            siblingNodeIds: siblings,
            siblingIndex: siblingIndex,
          });
        }

        const children = childrenMap[nodeId] || [];
        for (const childId of children) {
          traverse(childId);
        }
        return;
      }

      if (role === 'user' || role === 'assistant') {
        const textParts = [];
        const attachments = [];

        if (msg.content.parts) {
          for (const part of msg.content.parts) {
            if (typeof part === 'string') {
              textParts.push(part);
            } else if (part.content_type === 'image_asset_pointer') {
              let fileId = null;
              if (part.asset_pointer) {
                if (part.asset_pointer.startsWith('sediment://')) {
                  fileId = part.asset_pointer.replace('sediment://', '');
                } else if (part.asset_pointer.startsWith('file-service://')) {
                  fileId = part.asset_pointer.replace('file-service://', '');
                } else {
                  fileId = part.asset_pointer;
                }
              }
              if (fileId) {
                attachments.push({
                  type: 'image',
                  fileId: fileId,
                  width: part.width,
                  height: part.height,
                  size: part.size_bytes,
                  filename: null,
                  mimeType: null,
                });
              }
            }
          }
        }

        const metaAttachments = msg.metadata?.attachments || [];
        for (const att of metaAttachments) {
          const existing = attachments.find(a => a.fileId === att.id);
          if (existing) {
            existing.filename = att.name;
            existing.mimeType = att.mime_type;
          } else {
            attachments.push({
              type: att.mime_type?.startsWith('image/') ? 'image' : 'file',
              fileId: att.id,
              filename: att.name,
              mimeType: att.mime_type,
              width: att.width,
              height: att.height,
              size: att.size,
            });
          }
        }

        const content = textParts.join('\\n');
        if (content.trim() || attachments.length > 0) {
          const parentNodeId = node.parent;
          const siblings = parentNodeId ? (childrenMap[parentNodeId] || [nodeId]) : [nodeId];
          const siblingIndex = siblings.indexOf(nodeId);

          let contentReferences = undefined;
          const rawRefs = msg.metadata?.content_references;
          if (rawRefs && Array.isArray(rawRefs) && rawRefs.length > 0) {
            contentReferences = rawRefs
              .filter(ref => ref.type === 'webpage' || ref.type === 'webpage_extended' || ref.type === 'image_inline')
              .map(ref => ({
                matched_text: ref.matched_text,
                type: ref.type,
                title: ref.title,
                url: ref.url,
                snippet: ref.snippet,
                attribution: ref.attribution,
              }));
            if (contentReferences.length === 0) contentReferences = undefined;
          }

          sortedMessages.push({
            id: msg.id,
            nodeId: nodeId,
            role: role,
            content: content,
            contentType: contentType,
            createdAt: msg.create_time ? msg.create_time * 1000 : null,
            modelSlug: msg.metadata?.model_slug,
            attachments: attachments.length > 0 ? attachments : undefined,
            contentReferences: contentReferences,
            parentNodeId: parentNodeId,
            siblingNodeIds: siblings,
            siblingIndex: siblingIndex,
          });
        }
      }
    }

    const children = childrenMap[nodeId] || [];
    for (const childId of children) {
      traverse(childId);
    }
  }

  if (rootId) {
    traverse(rootId);
  }

  // Post-process: fix parent references
  const collectedNodeIds = new Set(sortedMessages.map(m => m.nodeId));

  function findCollectedAncestor(nodeId) {
    let current = nodeId;
    while (current) {
      if (collectedNodeIds.has(current)) {
        return current;
      }
      current = mapping[current]?.parent;
    }
    return null;
  }

  for (const msg of sortedMessages) {
    const originalParent = msg.parentNodeId;
    msg.parentNodeId = originalParent ? findCollectedAncestor(originalParent) : null;
  }

  // Rebuild sibling information
  const correctedChildrenMap = {};
  for (const msg of sortedMessages) {
    const parent = msg.parentNodeId || '__root__';
    if (!correctedChildrenMap[parent]) correctedChildrenMap[parent] = [];
    correctedChildrenMap[parent].push(msg.nodeId);
  }

  for (const parent of Object.keys(correctedChildrenMap)) {
    correctedChildrenMap[parent].sort((a, b) => {
      const msgA = sortedMessages.find(m => m.nodeId === a);
      const msgB = sortedMessages.find(m => m.nodeId === b);
      return (msgA?.createdAt || 0) - (msgB?.createdAt || 0);
    });
  }

  for (const msg of sortedMessages) {
    const parent = msg.parentNodeId || '__root__';
    const siblings = correctedChildrenMap[parent] || [msg.nodeId];
    msg.siblingNodeIds = siblings;
    msg.siblingIndex = siblings.indexOf(msg.nodeId);
  }

  // Find valid currentNode
  let validCurrentNode = currentNode;
  if (currentNode && !collectedNodeIds.has(currentNode)) {
    let walkNode = currentNode;
    while (walkNode) {
      if (collectedNodeIds.has(walkNode)) {
        validCurrentNode = walkNode;
        break;
      }
      walkNode = mapping[walkNode]?.parent;
    }
    if (!validCurrentNode || !collectedNodeIds.has(validCurrentNode)) {
      validCurrentNode = sortedMessages.length > 0 ? sortedMessages[sortedMessages.length - 1].nodeId : null;
    }
  }

  return {
    title: data.title || 'Untitled',
    currentNode: validCurrentNode,
    messages: sortedMessages,
  };
})();
`
  }

  private makeGetFileDownloadUrlScript(fileId: string, headers: ApiHeaders): string {
    return `
(async function() {
  const headers = ${JSON.stringify(headers)};

  const response = await fetch(
    'https://chatgpt.com/backend-api/files/download/${fileId}?post_id=&inline=false',
    {
      credentials: 'include',
      headers: headers,
    }
  );

  if (!response.ok) {
    console.error('[ChatGPT API] Failed to get file download URL:', response.status);
    return null;
  }

  const data = await response.json();
  return data.status === 'success' ? data.download_url : null;
})();
`
  }

  private makeDownloadFileScript(url: string): string {
    return `
(async function() {
  const response = await fetch(${JSON.stringify(url)}, {
    credentials: 'include',
  });

  if (!response.ok) {
    console.error('[ChatGPT API] Failed to download file:', response.status);
    return { error: 'Failed to download: ' + response.status };
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return {
    data: btoa(binary),
    mimeType: response.headers.get('content-type') || 'application/octet-stream',
  };
})();
`
  }

  // ============================================================================
  // VIEW MANAGEMENT
  // ============================================================================

  private createView(): void {
    if (this.view) return

    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:chatgpt'
      }
    })

    const chatGPTSession = session.fromPartition('persist:chatgpt')

    chatGPTSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://chatgpt.com/backend-api/*', '*://chat.openai.com/backend-api/*'] },
      (details, callback) => {
        if (details.requestHeaders['Authorization'] || details.requestHeaders['authorization']) {
          const hadHeaders = this.capturedHeaders !== null
          this.capturedHeaders = {
            authorization:
              details.requestHeaders['Authorization'] || details.requestHeaders['authorization'],
            'oai-device-id':
              details.requestHeaders['oai-device-id'] || details.requestHeaders['OAI-Device-Id'],
            'oai-language':
              details.requestHeaders['oai-language'] ||
              details.requestHeaders['OAI-Language'] ||
              'en-US'
          }
          if (!hadHeaders) {
            console.log(`[${this.name}] Captured API headers`)
          }
        }
        callback({ requestHeaders: details.requestHeaders })
      }
    )

    chatGPTSession.webRequest.onCompleted(
      { urls: ['*://chatgpt.com/backend-api/*', '*://chat.openai.com/backend-api/*'] },
      (details) => {
        if (
          (details.url.includes('/backend-api/me') ||
            details.url.includes('/backend-api/accounts/check/')) &&
          details.statusCode === 200
        ) {
          this.lastApiAuthSuccess = true
        }
      }
    )
  }

  private updateViewBounds = (): void => {
    const mainWindow = getMainWindow()
    if (!mainWindow || !this.view || !this.isViewVisible) return

    const bounds = mainWindow.getContentBounds()
    this.view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height - TOOLBAR_HEIGHT
    })
  }

  private startLoginMonitor(): void {
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval)
    }

    console.log(`[${this.name}] Starting login monitor...`)

    this.loginCheckInterval = setInterval(async () => {
      const isLoggedIn = await this.checkLoggedIn()
      if (isLoggedIn) {
        console.log(`[${this.name}] Login detected! Hiding view...`)
        this.stopLoginMonitor()
        this.hideView()

        const mainWindow = getMainWindow()
        mainWindow?.webContents.send(IPC_CHANNELS.AUTH_STATUS_CHANGED, { isLoggedIn: true })

        await this.storage.setProviderState({
          providerName: this.name,
          isOnline: true,
          lastSyncAt: null,
          status: 'connected',
          errorMessage: null
        })

        this._status = 'connected'
        this.updateStoreState()
        await this.start()
      }
    }, 1000)
  }

  private stopLoginMonitor(): void {
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval)
      this.loginCheckInterval = null
      console.log(`[${this.name}] Stopped login monitor`)
    }
  }

  private async checkLoggedIn(): Promise<boolean> {
    if (!this.view) return false

    if (this.lastApiAuthSuccess) {
      return true
    }

    try {
      const isLoggedIn = await this.view.webContents.executeJavaScript(`
        (function() {
          const profileButton = document.querySelector('[data-testid="accounts-profile-button"]') ||
                                document.querySelector('[aria-label="Open profile menu"]');
          return !!profileButton;
        })();
      `)
      return !!isLoggedIn
    } catch {
      return false
    }
  }

  async restoreConnection(): Promise<void> {
    if (!this.view) {
      console.log(`[${this.name}] Cannot restore connection: view not initialized`)
      return
    }

    console.log(`[${this.name}] Restoring connection by loading provider page in background...`)

    return new Promise((resolve) => {
      this.view!.webContents.loadURL('https://chatgpt.com/')

      const timeout = setTimeout(() => {
        if (this.capturedHeaders) {
          console.log(`[${this.name}] Connection restored successfully`)
        } else {
          console.log(
            `[${this.name}] Connection restoration timed out, but session may still be valid`
          )
        }
        resolve()
      }, 10000)

      const checkInterval = setInterval(() => {
        if (this.capturedHeaders) {
          clearInterval(checkInterval)
          clearTimeout(timeout)
          console.log(`[${this.name}] Connection restored successfully`)
          resolve()
        }
      }, 500)
    })
  }
}
