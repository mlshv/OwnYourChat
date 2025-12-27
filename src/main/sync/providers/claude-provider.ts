import { WebContentsView, session } from 'electron'
import { BaseProvider, type SyncResult, type ProviderName } from './base.js'
import type { IStorage } from '../../storage/interface.js'
import type { ClaudeMetadata } from './types'
import { getMainWindow } from '../../index.js'
import { IPC_CHANNELS } from '../../../shared/types'
import { findCachedFile, getExtensionFromMimeType } from '../attachment-utils.js'
import { getAttachmentsPath } from '../../settings.js'
import {
  transformClaudeMessageToParts,
  type ClaudeContentBlock as UtilsClaudeContentBlock
} from './claude/utils'
import fs from 'fs'
import path from 'path'

const TOOLBAR_HEIGHT = 40

// ============================================================================
// TYPES - Exported for external use
// ============================================================================

export type ClaudeApiHeaders = Record<string, string>

export interface ClaudeConversationListItem {
  uuid: string
  name: string
  summary: string
  created_at: string
  updated_at: string
  current_leaf_message_uuid: string | null
}

export interface ClaudeContentBlock {
  type: string
  text: string
  start_timestamp?: string
  stop_timestamp?: string
}

export interface ClaudeFileAsset {
  url: string
  file_variant: string
  primary_color?: string
  image_width?: number
  image_height?: number
  page_count?: number
}

export interface ClaudeFile {
  success?: boolean
  file_uuid: string
  file_name: string
  file_kind: 'image' | 'document' | 'video' | 'audio' | string
  created_at: string
  thumbnail_url?: string
  preview_url?: string
  thumbnail_asset?: ClaudeFileAsset
  preview_asset?: ClaudeFileAsset
  document_asset?: ClaudeFileAsset
}

export interface ClaudeMessage {
  uuid: string
  text: string
  content: ClaudeContentBlock[]
  sender: 'human' | 'assistant'
  index: number
  created_at: string
  updated_at: string
  parent_message_uuid: string | null
  attachments: unknown[]
  files: ClaudeFile[]
  files_v2: ClaudeFile[]
}

export interface ClaudeConversation {
  uuid: string
  name: string
  summary: string
  created_at: string
  updated_at: string
  current_leaf_message_uuid: string | null
  chat_messages: ClaudeMessage[]
}

interface FetchConversationsOptions {
  stopBeforeTimestamp?: number | null
  onPage?: (conversations: ClaudeConversationListItem[], pageNumber: number) => Promise<void>
}

// ============================================================================
// PROVIDER CLASS
// ============================================================================

export class ClaudeProvider extends BaseProvider<ClaudeMetadata> {
  readonly name: ProviderName = 'claude'

  private view: WebContentsView | null = null
  private capturedHeaders: ClaudeApiHeaders | null = null
  private organizationId: string | null = null
  private lastApiAuthSuccess: boolean = false
  private isViewVisible: boolean = false
  private loginCheckInterval: NodeJS.Timeout | null = null

  constructor(storage: IStorage, pollingIntervalMs: number = 60000) {
    super(storage, pollingIntervalMs)
  }

  protected getDefaultMetadata(): ClaudeMetadata {
    return {
      lastCompletedOffset: 0,
      isFullSyncComplete: false,
      lastSyncPageSize: 30
    }
  }

  async initialize(): Promise<void> {
    await this.loadPersistedState()
    this.createView()
    // Update Zustand store with loaded state
    this.updateStoreState()
  }

  isConnected(): boolean {
    return this.capturedHeaders !== null && this.organizationId !== null
  }

  getView(): WebContentsView | null {
    return this.view
  }

  getHeaders(): Record<string, string> | null {
    return this.capturedHeaders
  }

  getOrganizationId(): string | null {
    return this.organizationId
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

    this.view.webContents.loadURL('https://claude.ai/')
    this.isViewVisible = true

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
    const claudeSession = session.fromPartition('persist:claude')
    await claudeSession.clearStorageData()
    this.hideView()
    this.capturedHeaders = null
    this.organizationId = null
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

  async restoreConnection(): Promise<void> {
    if (!this.view) {
      console.log(`[${this.name}] Cannot restore connection: view not initialized`)
      return
    }

    console.log(`[${this.name}] Restoring connection by loading provider page in background...`)

    return new Promise((resolve) => {
      this.view!.webContents.loadURL('https://claude.ai/')

      const timeout = setTimeout(() => {
        if (this.capturedHeaders && this.organizationId) {
          console.log(`[${this.name}] Connection restored successfully`)
        } else {
          console.log(
            `[${this.name}] Connection restoration timed out, but session may still be valid`
          )
        }
        resolve()
      }, 10000)

      const checkInterval = setInterval(() => {
        if (this.capturedHeaders && this.organizationId) {
          clearInterval(checkInterval)
          clearTimeout(timeout)
          console.log(`[${this.name}] Connection restored successfully`)
          resolve()
        }
      }, 500)
    })
  }

  // ============================================================================
  // PUBLIC API METHODS - For external use (ipc.ts, etc.)
  // ============================================================================

  /**
   * Refresh a single conversation from the Claude API
   * Used by ipc.ts for CONVERSATIONS_REFRESH handler
   */
  async refreshConversation(conversationId: string): Promise<ClaudeConversation | null> {
    if (!this.view || !this.capturedHeaders || !this.organizationId) {
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
   * Download an attachment from Claude using the files API.
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

    if (!this.view || !this.organizationId) {
      throw new Error('Claude provider not initialized')
    }

    // Get attachment metadata from database to determine download URL
    const conversationData = await this.storage.getConversationWithMessages(conversationId)
    if (!conversationData) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    let downloadUrl: string | null = null
    let mimeType = 'application/octet-stream'

    // Find the attachment in the messages
    for (const message of conversationData.messages) {
      if (!message.attachments) continue
      for (const att of message.attachments) {
        if (att.fileId === fileId) {
          downloadUrl = att.originalUrl
          mimeType = att.mimeType || mimeType
          break
        }
      }
      if (downloadUrl) break
    }

    if (!downloadUrl) {
      throw new Error(`Could not find attachment metadata for fileId ${fileId}`)
    }

    // Build full download URL if relative
    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `https://claude.ai${downloadUrl}`

    console.log(`[Attachments] Downloading Claude file ${fileId} from ${fullUrl}`)

    // Download via webContents (uses session cookies)
    const downloaded = await this.downloadFileViaScript(fullUrl)

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
      const ext = getExtensionFromMimeType(mimeType)
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

  /**
   * Download a file via webContents and return as Buffer
   */
  private async downloadFileViaScript(
    downloadUrl: string
  ): Promise<{ data: Buffer; mimeType: string }> {
    if (!this.view) {
      throw new Error('View not initialized')
    }

    const url = this.view.webContents.getURL()
    if (!url.includes('claude.ai')) {
      await this.view.webContents.loadURL('https://claude.ai/')
      await new Promise((r) => setTimeout(r, 2000))
    }

    const script = `
(async function() {
  const response = await fetch(${JSON.stringify(downloadUrl)}, {
    credentials: 'include',
  });

  if (!response.ok) {
    console.error('[Claude API] Failed to download file:', response.status);
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
    const result = await this.view.webContents.executeJavaScript(script)

    if (result.error) {
      throw new Error(result.error)
    }

    return {
      data: Buffer.from(result.data, 'base64'),
      mimeType: result.mimeType
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
      if (!this.view || !this.capturedHeaders || !this.organizationId) {
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
        title: content.name || existing.title,
        provider: 'claude',
        createdAt: existing.createdAt,
        updatedAt: new Date(content.updated_at),
        syncedAt: new Date(),
        messageCount: content.chat_messages.length,
        currentNodeId: content.current_leaf_message_uuid
      })

      // Upsert messages
      const messageInserts = content.chat_messages.map((msg) => {
        const parts = transformClaudeMessageToParts({
          content: msg.content as UtilsClaudeContentBlock[]
        })

        return {
          id: msg.uuid,
          conversationId,
          role: msg.sender === 'human' ? ('user' as const) : ('assistant' as const),
          parts: JSON.stringify(parts),
          createdAt: msg.created_at ? new Date(msg.created_at) : undefined,
          orderIndex: msg.index,
          parentId: msg.parent_message_uuid,
          siblingIds: JSON.stringify([]),
          siblingIndex: 0
        }
      })

      await this.storage.upsertMessages(messageInserts)

      // Upsert attachments (use deterministic ID based on messageId + file_uuid)
      const allAttachments = content.chat_messages.flatMap((msg) => {
        // Deduplicate files (Claude returns same file in both files and files_v2)
        const allFiles = this.deduplicateClaudeFiles(msg.files || [], msg.files_v2 || [])
        if (allFiles.length === 0) return []
        return allFiles.map((file: ClaudeFile) => {
          // Determine best URL to use (prefer preview for images, document for PDFs)
          let originalUrl = ''
          let width: number | undefined
          let height: number | undefined

          if (file.preview_asset) {
            originalUrl = this.buildClaudeFileUrl(file.preview_asset.url)
            width = file.preview_asset.image_width
            height = file.preview_asset.image_height
          } else if (file.document_asset) {
            originalUrl = this.buildClaudeFileUrl(file.document_asset.url)
          } else if (file.thumbnail_asset) {
            originalUrl = this.buildClaudeFileUrl(file.thumbnail_asset.url)
            width = file.thumbnail_asset.image_width
            height = file.thumbnail_asset.image_height
          } else if (file.preview_url) {
            originalUrl = this.buildClaudeFileUrl(file.preview_url)
          } else if (file.thumbnail_url) {
            originalUrl = this.buildClaudeFileUrl(file.thumbnail_url)
          }

          return {
            id: `${msg.uuid}-att-${file.file_uuid}`,
            messageId: msg.uuid,
            type: this.getAttachmentType(file.file_kind),
            fileId: file.file_uuid,
            originalUrl,
            localPath: '',
            filename: file.file_name,
            mimeType: this.getMimeType(file.file_kind, file.file_name),
            size: 0, // Claude doesn't provide file size
            width,
            height
          }
        })
      })

      if (allAttachments.length > 0) {
        await this.storage.upsertAttachments(allAttachments)
      }

      // Return updated data
      const result = await this.storage.getConversationWithMessages(conversationId)
      return result ? { conversation: result.conversation, messages: result.messages } : null
    } catch (error) {
      console.error('[Claude] Error in refreshAndPersistConversation:', error)
      // On any error, return stale data
      const result = await this.storage.getConversationWithMessages(conversationId)
      return result ? { conversation: result.conversation, messages: result.messages } : null
    }
  }

  // ============================================================================
  // HELPER METHODS - Attachment processing
  // ============================================================================

  /**
   * Deduplicate Claude files - prefer files_v2 over files
   * Claude API returns the same file in both arrays for backward compatibility
   */
  private deduplicateClaudeFiles(files: ClaudeFile[], files_v2: ClaudeFile[]): ClaudeFile[] {
    // Prefer files_v2 (it's the newer format and has success field)
    if (files_v2.length > 0) {
      return files_v2
    }
    return files
  }

  /**
   * Map Claude file_kind to our attachment type
   */
  private getAttachmentType(fileKind: string): 'image' | 'file' {
    return fileKind === 'image' ? 'image' : 'file'
  }

  /**
   * Map Claude file_kind to mime type
   */
  private getMimeType(fileKind: string, fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase()

    if (fileKind === 'image') {
      if (ext === 'png') return 'image/png'
      if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
      if (ext === 'gif') return 'image/gif'
      if (ext === 'webp') return 'image/webp'
      if (ext === 'svg') return 'image/svg+xml'
      return 'image/png' // default
    }

    if (fileKind === 'document') {
      if (ext === 'pdf') return 'application/pdf'
      if (ext === 'txt') return 'text/plain'
      if (ext === 'md') return 'text/markdown'
      return 'application/pdf' // default
    }

    return 'application/octet-stream'
  }

  /**
   * Build full Claude file URL from relative path
   */
  private buildClaudeFileUrl(relativePath: string): string {
    if (!relativePath) return ''
    if (relativePath.startsWith('http')) return relativePath
    return `https://claude.ai${relativePath}`
  }

  // ============================================================================
  // SYNC METHOD
  // ============================================================================

  async sync(): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders || !this.organizationId) {
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

  private async fullSync(metadata: ClaudeMetadata): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders || !this.organizationId) {
      return { success: false, error: 'Not connected' }
    }

    let offset = metadata.lastCompletedOffset
    let newChatsFound = 0
    const PAGE_SIZE = 30

    try {
      // Fetch total count first
      const total = await this.fetchTotalConversations()

      while (true) {
        console.log(`[${this.name}] Fetching page at offset ${offset}...`)

        const result = await this.view.webContents.executeJavaScript(
          this.makeFetchConversationPageScript(
            this.organizationId,
            this.capturedHeaders,
            PAGE_SIZE,
            offset
          )
        )

        if (result.error) {
          console.error(`[${this.name}] API error at offset ${offset}:`, result.error)
          throw new Error(`API error: ${result.error}`)
        }

        const pageConversations: ClaudeConversationListItem[] = result.items.map(
          (item: ClaudeConversationListItem) => ({
            uuid: item.uuid,
            name: item.name || 'Untitled',
            summary: item.summary || '',
            created_at: item.created_at,
            updated_at: item.updated_at,
            current_leaf_message_uuid: item.current_leaf_message_uuid || null
          })
        )

        console.log(
          `[${this.name}] Processing ${pageConversations.length} conversations at offset ${offset}`
        )

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

        console.log(`[${this.name}] Completed offset ${offset}, total: ${total}`)

        // Check if last page
        if (offset >= total) {
          console.log(
            `[${this.name}] Reached end of pagination (offset ${offset} >= total ${total})`
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
  // INCREMENTAL SYNC - Keep existing timestamp logic
  // ============================================================================

  private async incrementalSync(): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders || !this.organizationId) {
      return { success: false, error: 'Not connected' }
    }

    try {
      const maxLocalUpdatedAt = await this.storage.getMaxUpdatedAt(this.name)
      console.log(
        `[${this.name}] Max local updated_at: ${maxLocalUpdatedAt?.toISOString() ?? 'none'}`
      )

      let newChatsFound = 0

      const truncateToSeconds = (date: Date): number => {
        return Math.floor(date.getTime() / 1000) * 1000
      }

      await this.extractConversationList(this.capturedHeaders, {
        stopBeforeTimestamp: maxLocalUpdatedAt ? truncateToSeconds(maxLocalUpdatedAt) : null,
        onPage: async (pageConversations, pageNumber) => {
          console.log(
            `[${this.name}] Processing page ${pageNumber} with ${pageConversations.length} conversations`
          )

          for (const conv of pageConversations) {
            newChatsFound++
            console.log(`[${this.name}] Syncing conversation ${newChatsFound}: ${conv.name}`)

            try {
              await this.syncConversationWithRetry(conv)
            } catch (err) {
              console.error(`[${this.name}] Error syncing conversation ${conv.uuid}:`, err)
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
    conv: ClaudeConversationListItem,
    maxRetries = 3
  ): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.syncConversation(conv)

        // Clear error on success
        await this.storage.updateConversationSyncError(conv.uuid, null, 0)
        return
      } catch (error) {
        if (attempt === maxRetries - 1) {
          // Final failure - persist error
          console.error(
            `[${this.name}] Failed to sync conversation ${conv.uuid} after ${maxRetries} attempts:`,
            error
          )
          await this.storage.updateConversationSyncError(
            conv.uuid,
            (error as Error).message,
            attempt + 1
          )
          throw error
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt) * 1000
        console.log(
          `[${this.name}] Retry ${attempt + 1}/${maxRetries} for conversation ${conv.uuid} after ${backoffMs}ms`
        )
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }

  // ============================================================================
  // TOTAL COUNT FETCHER
  // ============================================================================

  private async fetchTotalConversations(): Promise<number> {
    if (!this.view || !this.organizationId) {
      throw new Error('View or organization ID not initialized')
    }

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('claude.ai')) {
        await this.view.webContents.loadURL('https://claude.ai/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log(`[${this.name}] Fetching total conversation count...`)
      const result = await this.view.webContents.executeJavaScript(
        this.makeFetchTotalCountScript(this.organizationId, this.capturedHeaders!)
      )

      if (result.error) {
        throw new Error(`Failed to fetch total count: ${result.error}`)
      }

      console.log(`[${this.name}] Total conversations: ${result.count}`)
      return result.count
    } catch (error) {
      console.error(`[${this.name}] Error fetching total conversation count:`, error)
      throw error
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS - API interaction
  // ============================================================================

  private async extractConversationList(
    headers: ClaudeApiHeaders,
    options?: FetchConversationsOptions
  ): Promise<ClaudeConversationListItem[]> {
    if (!this.view || !this.organizationId) throw new Error('View not initialized')

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('claude.ai')) {
        await this.view.webContents.loadURL('https://claude.ai/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log(`[${this.name}] Fetching conversations via API...`)

      const allConversations: ClaudeConversationListItem[] = []
      const stopBeforeTimestamp = options?.stopBeforeTimestamp ?? null
      const pageSize = 30
      let offset = 0
      let hasMore = true
      let pageNumber = 0

      while (hasMore) {
        const result = await this.view.webContents.executeJavaScript(
          this.makeFetchConversationPageScript(this.organizationId, headers, pageSize, offset)
        )

        if (result.error) {
          console.error(`[${this.name}] API error on page ${pageNumber}:`, result.error)
          break
        }

        const pageConversations: ClaudeConversationListItem[] = []

        for (const item of result.items) {
          const conv: ClaudeConversationListItem = {
            uuid: item.uuid,
            name: item.name || 'Untitled',
            summary: item.summary || '',
            created_at: item.created_at,
            updated_at: item.updated_at,
            current_leaf_message_uuid: item.current_leaf_message_uuid || null
          }

          const convTimestamp = new Date(conv.updated_at).getTime()
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
          hasMore = result.has_more
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
    headers: ClaudeApiHeaders
  ): Promise<ClaudeConversation> {
    if (!this.view || !this.organizationId) throw new Error('View not initialized')

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('claude.ai')) {
        await this.view.webContents.loadURL('https://claude.ai/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      const conversation = await this.storage.getConversation(conversationId)

      console.log(
        `[${this.name}] Fetching conversation "${conversation?.title ?? conversationId}" via API...`
      )
      const result = await this.view.webContents.executeJavaScript(
        this.makeFetchConversationScript(this.organizationId, conversationId, headers)
      )

      if (!result) {
        console.warn(`[${this.name}] Failed to fetch conversation from API`)
        return {
          uuid: conversationId,
          name: 'Untitled',
          summary: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          current_leaf_message_uuid: null,
          chat_messages: []
        }
      }

      console.log(
        `[${this.name}] Fetched conversation "${conversation?.title ?? conversationId}" with ${result.chat_messages?.length || 0} messages`
      )

      return {
        uuid: result.uuid,
        name: result.name || 'Untitled',
        summary: result.summary || '',
        created_at: result.created_at,
        updated_at: result.updated_at,
        current_leaf_message_uuid: result.current_leaf_message_uuid || null,
        chat_messages: (result.chat_messages || []).map((msg: ClaudeMessage) => ({
          uuid: msg.uuid,
          text: msg.text || '',
          content: msg.content || [],
          sender: msg.sender,
          index: msg.index,
          created_at: msg.created_at,
          updated_at: msg.updated_at,
          parent_message_uuid: msg.parent_message_uuid || null,
          attachments: msg.attachments || [],
          files: msg.files || [],
          files_v2: msg.files_v2 || []
        }))
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching conversation content:`, error)
      throw error
    }
  }

  private async syncConversation(conv: ClaudeConversationListItem): Promise<void> {
    if (!this.view || !this.capturedHeaders || !this.organizationId) {
      throw new Error('Not connected')
    }

    const content = await this.extractConversationContent(conv.uuid, this.capturedHeaders)

    const existing = await this.storage.getConversation(conv.uuid)
    if (existing) {
      await this.storage.deleteMessagesForConversation(conv.uuid)
    }

    await this.storage.upsertConversation({
      id: conv.uuid,
      title: conv.name || 'Untitled',
      provider: 'claude',
      createdAt: new Date(conv.created_at),
      updatedAt: new Date(conv.updated_at),
      syncedAt: new Date(),
      messageCount: content.chat_messages.length,
      currentNodeId: content.current_leaf_message_uuid
    })

    const messageInserts = content.chat_messages.map((msg) =>
      this.convertClaudeMessage(msg, conv.uuid)
    )

    await this.storage.upsertMessages(messageInserts)

    for (const msg of content.chat_messages) {
      // Deduplicate files (Claude returns same file in both files and files_v2)
      const allFiles = this.deduplicateClaudeFiles(msg.files || [], msg.files_v2 || [])
      if (allFiles.length > 0) {
        const attachmentInserts = allFiles.map((file: ClaudeFile) => {
          // Determine best URL to use (prefer preview for images, document for PDFs)
          let originalUrl = ''
          let width: number | undefined
          let height: number | undefined

          if (file.preview_asset) {
            originalUrl = this.buildClaudeFileUrl(file.preview_asset.url)
            width = file.preview_asset.image_width
            height = file.preview_asset.image_height
          } else if (file.document_asset) {
            originalUrl = this.buildClaudeFileUrl(file.document_asset.url)
          } else if (file.thumbnail_asset) {
            originalUrl = this.buildClaudeFileUrl(file.thumbnail_asset.url)
            width = file.thumbnail_asset.image_width
            height = file.thumbnail_asset.image_height
          } else if (file.preview_url) {
            originalUrl = this.buildClaudeFileUrl(file.preview_url)
          } else if (file.thumbnail_url) {
            originalUrl = this.buildClaudeFileUrl(file.thumbnail_url)
          }

          return {
            id: `${msg.uuid}-att-${file.file_uuid}`,
            messageId: msg.uuid,
            type: this.getAttachmentType(file.file_kind),
            fileId: file.file_uuid,
            originalUrl,
            localPath: '',
            filename: file.file_name,
            mimeType: this.getMimeType(file.file_kind, file.file_name),
            size: 0, // Claude doesn't provide file size
            width,
            height
          }
        })
        await this.storage.upsertAttachments(attachmentInserts)
      }
    }
  }

  private convertClaudeMessage(msg: ClaudeMessage, conversationId: string) {
    const parts = transformClaudeMessageToParts({
      content: msg.content as UtilsClaudeContentBlock[]
    })

    return {
      id: msg.uuid,
      conversationId,
      role: msg.sender === 'human' ? ('user' as const) : ('assistant' as const),
      parts: JSON.stringify(parts),
      createdAt: msg.created_at ? new Date(msg.created_at) : undefined,
      orderIndex: msg.index,
      parentId: msg.parent_message_uuid,
      siblingIds: JSON.stringify([]),
      siblingIndex: 0
    }
  }

  // ============================================================================
  // JAVASCRIPT INJECTION SCRIPTS
  // ============================================================================

  private makeFetchConversationPageScript(
    organizationId: string,
    headers: ClaudeApiHeaders,
    limit: number = 30,
    offset: number = 0
  ): string {
    return `
(async function() {
  const headers = ${JSON.stringify({
    ...headers,
    'content-type': 'application/json'
  })};

  const response = await fetch(
    'https://claude.ai/api/organizations/${organizationId}/chat_conversations?limit=${limit}&offset=${offset}&consistency=eventual',
    {
      credentials: 'include',
      headers: headers,
    }
  );

  if (!response.ok) {
    console.error('[Claude API] Failed to fetch conversations:', response.status);
    return { items: [], has_more: false, error: response.status };
  }

  const data = await response.json();

  return {
    items: data || [],
    has_more: data.length === ${limit},
  };
})();
`
  }

  private makeFetchConversationScript(
    organizationId: string,
    conversationId: string,
    headers: ClaudeApiHeaders
  ): string {
    return `
(async function() {
  const headers = ${JSON.stringify({
    ...headers,
    'content-type': 'application/json'
  })};

  const response = await fetch(
    'https://claude.ai/api/organizations/${organizationId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=eventual',
    {
      credentials: 'include',
      headers: headers,
    }
  );

  if (!response.ok) {
    console.error('[Claude API] Failed to fetch conversation:', response.status);
    return null;
  }

  const data = await response.json();
  return data;
})();
`
  }

  private makeFetchTotalCountScript(organizationId: string, headers: ClaudeApiHeaders): string {
    return `
(async function() {
  const headers = ${JSON.stringify({
    ...headers,
    'content-type': 'application/json'
  })};

  const response = await fetch(
    'https://claude.ai/api/organizations/${organizationId}/chat_conversations/count_all',
    {
      credentials: 'include',
      headers: headers,
    }
  );

  if (!response.ok) {
    console.error('[Claude API] Failed to fetch conversation count:', response.status);
    return { error: response.status };
  }

  const data = await response.json();
  return data;
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
        partition: 'persist:claude'
      }
    })

    const claudeSession = session.fromPartition('persist:claude')

    claudeSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://claude.ai/api/*'] },
      (details, callback) => {
        if (details.requestHeaders['Cookie'] || details.requestHeaders['cookie']) {
          const hadHeaders = this.capturedHeaders !== null
          this.capturedHeaders = details.requestHeaders
          if (!hadHeaders) {
            console.log(`[${this.name}] Captured API headers (cookies)`)
          }

          this.extractOrganizationId()
        }
        callback({ requestHeaders: details.requestHeaders })
      }
    )

    claudeSession.webRequest.onCompleted(
      { urls: ['*://claude.ai/api/account_profile', '*://claude.ai/api/organizations/*'] },
      (details) => {
        if (details.statusCode === 200) {
          this.lastApiAuthSuccess = true
        }
      }
    )
  }

  private extractOrganizationId(): void {
    if (!this.capturedHeaders) return

    try {
      const cookies = (this.capturedHeaders['Cookie'] || this.capturedHeaders['cookie']).split(';')
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=')
        if (name === 'lastActiveOrg') {
          this.organizationId = value
          return
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error extracting organization ID:`, error)
    }
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
    return this.lastApiAuthSuccess
  }
}
