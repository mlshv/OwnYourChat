import { WebContentsView, session, net } from 'electron'
import { join } from 'path'
import { WEBAUTHN_INJECTION_SCRIPT } from '../../webauthn/inject'
import { BaseProvider, type SyncResult, type ProviderName } from './base.js'
import type { IStorage } from '../../storage/interface.js'
import type { PerplexityMetadata } from './types'
import { getMainWindow } from '../../index.js'
import { IPC_CHANNELS } from '../../../shared/types'
import { findCachedFile, getExtensionFromMimeType } from '../attachment-utils.js'
import { getAttachmentsPath } from '../../settings.js'
import {
  transformPerplexityMessageToParts,
  type PerplexityWebResult
} from './perplexity/utils'
import fs from 'fs'
import path from 'path'

const TOOLBAR_HEIGHT = 40

// ============================================================================
// TYPES - Exported for external use
// ============================================================================

export type PerplexityApiHeaders = Record<string, string>

export interface PerplexityThreadListItem {
  thread_number: number
  last_query_datetime: string
  mode: string
  context_uuid: string
  uuid: string
  frontend_uuid: string
  frontend_context_uuid: string
  slug: string
  title: string
  first_answer: string
  thread_access: number
  has_next_page: boolean
  status: string
  first_entry_model_preference: string
  display_model: string
  expiry_time: string | null
  source: string
  source_metadata: unknown
  thread_status: string
  is_personal_intent: boolean
  is_mission_control: boolean
  stream_created_at: string | null
  unread: boolean
  query_count: number
  search_focus: string
  search_recency_filter: string | null
  sources: string[]
  featured_images: string[]
  read_write_token: string
  total_threads: number
  social_info: {
    view_count: number
    fork_count: number
    like_count: number
    user_likes: boolean
  }
}

export interface PerplexityBlock {
  intended_usage: string
  plan_block?: {
    progress: string
    goals: Array<{
      id: string
      description: string
      final: boolean
      todo_task_status: string
    }>
    final: boolean
  }
  markdown_block?: {
    progress: string
    chunks: string[]
    chunk_starting_offset: number
    answer: string
  }
  web_result_block?: {
    progress: string
    web_results: PerplexityWebResult[]
  }
}

export interface PerplexityEntry {
  backend_uuid: string
  context_uuid: string
  uuid: string
  frontend_context_uuid: string
  frontend_uuid: string
  status: string
  thread_title: string
  related_queries: string[]
  display_model: string
  user_selected_model: string
  personalized: boolean
  mode: string
  query_str: string
  search_focus: string
  source: string
  attachments: string[]
  updated_datetime: string
  read_write_token: string
  is_pro_reasoning_mode: boolean
  step_type: string
  author_id: string
  author_username: string
  author_image: string
  bookmark_state: string
  s3_social_preview_url: string
  thread_access: number
  thread_url_slug: string
  query_source: string
  privacy_state: string
  gpt4: boolean
  sources: {
    sources: string[]
  }
  entry_updated_datetime: string
  blocks: PerplexityBlock[]
}

export interface PerplexityThread {
  status: string
  entries: PerplexityEntry[]
}

interface FetchThreadsOptions {
  stopBeforeTimestamp?: number | null
  onPage?: (threads: PerplexityThreadListItem[], pageNumber: number) => Promise<void>
}

// ============================================================================
// PROVIDER CLASS
// ============================================================================

export class PerplexityProvider extends BaseProvider<PerplexityMetadata> {
  readonly name: ProviderName = 'perplexity'

  private view: WebContentsView | null = null
  private capturedHeaders: PerplexityApiHeaders | null = null
  private lastApiAuthSuccess: boolean = false
  private isViewVisible: boolean = false
  private loginCheckInterval: NodeJS.Timeout | null = null

  constructor(storage: IStorage, pollingIntervalMs: number = 60000) {
    super(storage, pollingIntervalMs)
  }

  protected getDefaultMetadata(): PerplexityMetadata {
    return {
      lastCompletedOffset: 0,
      isFullSyncComplete: false,
      lastSyncPageSize: 20
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

    this.view.webContents.loadURL('https://www.perplexity.ai/')
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
    const perplexitySession = session.fromPartition('persist:perplexity')
    await perplexitySession.clearStorageData()
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

  async restoreConnection(): Promise<void> {
    if (!this.view) {
      console.log(`[${this.name}] Cannot restore connection: view not initialized`)
      return
    }

    console.log(`[${this.name}] Restoring connection by loading provider page in background...`)

    return new Promise((resolve) => {
      this.view!.webContents.loadURL('https://www.perplexity.ai/')

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

  // ============================================================================
  // PUBLIC API METHODS - For external use (ipc.ts, etc.)
  // ============================================================================

  /**
   * Refresh a single thread from the Perplexity API
   * Used by ipc.ts for CONVERSATIONS_REFRESH handler
   */
  async refreshThread(threadSlug: string): Promise<PerplexityThread | null> {
    if (!this.view || !this.capturedHeaders) {
      return null
    }

    try {
      return await this.extractThreadContent(threadSlug)
    } catch (error) {
      console.error(`[${this.name}] Error refreshing thread:`, error)
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

      // For Perplexity, we need to fetch by slug, not by conversationId
      // The conversationId we store is context_uuid, but we need the slug
      // We'll need to store the slug somewhere or derive it

      // For now, return stale data if we can't refresh
      // TODO: Store slug in conversation metadata
      return this.storage.getConversationWithMessages(conversationId)
    } catch (error) {
      console.error('[Perplexity] Error in refreshAndPersistConversation:', error)
      // On any error, return stale data
      const result = await this.storage.getConversationWithMessages(conversationId)
      return result ? { conversation: result.conversation, messages: result.messages } : null
    }
  }

  /**
   * Download an attachment from Perplexity (S3 URLs)
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

    if (!this.view) {
      throw new Error('Perplexity provider not initialized')
    }

    // Get attachment metadata from database to determine download URL
    const conversationData = await this.storage.getConversationWithMessages(conversationId)
    if (!conversationData) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    let downloadUrl: string | null = null

    // Find the attachment in the messages
    for (const message of conversationData.messages) {
      if (!message.attachments) continue
      for (const att of message.attachments) {
        if (att.fileId === fileId) {
          downloadUrl = att.originalUrl
          break
        }
      }
      if (downloadUrl) break
    }

    if (!downloadUrl) {
      throw new Error(`Could not find attachment metadata for fileId ${fileId}`)
    }

    console.log(`[Attachments] Downloading Perplexity file ${fileId} from ${downloadUrl}`)

    // Download directly (S3 URLs are public with signed tokens)
    const downloaded = await this.downloadFileViaScript(downloadUrl)

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

  /**
   * Download a file directly using Electron's net module (bypasses CORS)
   */
  private async downloadFileViaScript(
    downloadUrl: string
  ): Promise<{ data: Buffer; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const request = net.request(downloadUrl)

      request.on('response', (response) => {
        const chunks: Buffer[] = []
        const mimeType = response.headers['content-type']?.[0] || 'application/octet-stream'

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`))
          return
        }

        response.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          const data = Buffer.concat(chunks)
          resolve({ data, mimeType: mimeType as string })
        })

        response.on('error', (error) => {
          reject(error)
        })
      })

      request.on('error', (error) => {
        reject(error)
      })

      request.end()
    })
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

  private async fullSync(metadata: PerplexityMetadata): Promise<SyncResult> {
    if (!this.view || !this.capturedHeaders) {
      return { success: false, error: 'Not connected' }
    }

    let offset = metadata.lastCompletedOffset
    let newChatsFound = 0
    const PAGE_SIZE = 20
    let totalThreads: number | null = null

    try {
      while (true) {
        console.log(`[${this.name}] Fetching page at offset ${offset}...`)

        const result = await this.view.webContents.executeJavaScript(
          this.makeFetchThreadListScript(offset, PAGE_SIZE)
        )

        if (result.error) {
          console.error(`[${this.name}] API error at offset ${offset}:`, result.error)
          throw new Error(`API error: ${result.error}`)
        }

        const pageThreads: PerplexityThreadListItem[] = result.threads

        // Get total from first page
        if (totalThreads === null && pageThreads.length > 0) {
          totalThreads = pageThreads[0].total_threads
        }

        console.log(
          `[${this.name}] Processing ${pageThreads.length} threads at offset ${offset}`
        )

        // Report progress
        this.updateSyncProgress(offset, totalThreads ?? 0, newChatsFound)

        // Process entire page atomically
        for (const thread of pageThreads) {
          await this.syncThreadWithRetry(thread)
          newChatsFound++
        }

        // Only mark offset complete after ALL threads succeed
        offset += PAGE_SIZE
        const currentMetadata = await this.getMetadata()
        await this.setMetadata({
          ...currentMetadata,
          lastCompletedOffset: offset
        })

        console.log(`[${this.name}] Completed offset ${offset}, total: ${totalThreads}`)

        // Check if last page
        if (pageThreads.length < PAGE_SIZE || (totalThreads && offset >= totalThreads)) {
          console.log(`[${this.name}] Reached end of pagination`)
          const finalMetadata = await this.getMetadata()
          await this.setMetadata({
            ...finalMetadata,
            lastCompletedOffset: offset,
            isFullSyncComplete: true
          })
          break
        }

        // Safety limit
        if (offset > 10000) {
          console.warn(`[${this.name}] Reached safety limit of 10000 threads`)
          break
        }
      }

      console.log(`[${this.name}] Full sync complete! Synced ${newChatsFound} threads`)
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
    if (!this.view || !this.capturedHeaders) {
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

      await this.extractThreadList({
        stopBeforeTimestamp: maxLocalUpdatedAt ? truncateToSeconds(maxLocalUpdatedAt) : null,
        onPage: async (pageThreads, pageNumber) => {
          console.log(
            `[${this.name}] Processing page ${pageNumber} with ${pageThreads.length} threads`
          )

          for (const thread of pageThreads) {
            newChatsFound++
            console.log(`[${this.name}] Syncing thread ${newChatsFound}: ${thread.title}`)

            try {
              await this.syncThreadWithRetry(thread)
            } catch (err) {
              console.error(`[${this.name}] Error syncing thread ${thread.context_uuid}:`, err)
            }
          }
        }
      })

      console.log(`[${this.name}] Incremental sync complete! Synced ${newChatsFound} threads`)
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

  private async syncThreadWithRetry(
    thread: PerplexityThreadListItem,
    maxRetries = 3
  ): Promise<void> {
    const threadId = this.extractThreadId(thread.slug)

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.syncThread(thread)

        // Clear error on success
        await this.storage.updateConversationSyncError(threadId, null, 0)
        return
      } catch (error) {
        if (attempt === maxRetries - 1) {
          // Final failure - persist error
          console.error(
            `[${this.name}] Failed to sync thread ${threadId} after ${maxRetries} attempts:`,
            error
          )
          await this.storage.updateConversationSyncError(
            threadId,
            (error as Error).message,
            attempt + 1
          )
          throw error
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt) * 1000
        console.log(
          `[${this.name}] Retry ${attempt + 1}/${maxRetries} for thread ${threadId} after ${backoffMs}ms`
        )
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS - API interaction
  // ============================================================================

  private async extractThreadList(
    options?: FetchThreadsOptions
  ): Promise<PerplexityThreadListItem[]> {
    if (!this.view) throw new Error('View not initialized')

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('perplexity.ai')) {
        await this.view.webContents.loadURL('https://www.perplexity.ai/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log(`[${this.name}] Fetching threads via API...`)

      const allThreads: PerplexityThreadListItem[] = []
      const stopBeforeTimestamp = options?.stopBeforeTimestamp ?? null
      const pageSize = 20
      let offset = 0
      let hasMore = true
      let pageNumber = 0

      while (hasMore) {
        const result = await this.view.webContents.executeJavaScript(
          this.makeFetchThreadListScript(offset, pageSize)
        )

        if (result.error) {
          console.error(`[${this.name}] API error on page ${pageNumber}:`, result.error)
          break
        }

        const pageThreads: PerplexityThreadListItem[] = []

        for (const item of result.threads) {
          const thread: PerplexityThreadListItem = item

          const threadTimestamp = new Date(thread.last_query_datetime).getTime()
          if (stopBeforeTimestamp && threadTimestamp <= stopBeforeTimestamp) {
            console.log(`[${this.name}] Reached timestamp threshold, stopping pagination`)
            hasMore = false
            break
          }

          pageThreads.push(thread)
          allThreads.push(thread)
        }

        if (pageThreads.length > 0 && options?.onPage) {
          await options.onPage(pageThreads, pageNumber)
        }

        console.log(
          `[${this.name}] Page ${pageNumber}: fetched ${pageThreads.length} threads (total: ${allThreads.length})`
        )

        if (hasMore) {
          hasMore = pageThreads.length === pageSize
        }
        offset += pageSize
        pageNumber++

        if (offset > 10000) break
      }

      console.log(`[${this.name}] Finished fetching ${allThreads.length} threads`)
      return allThreads
    } catch (error) {
      console.error(`[${this.name}] Error fetching thread list:`, error)
      throw error
    }
  }

  private async extractThreadContent(threadSlug: string): Promise<PerplexityThread> {
    if (!this.view) throw new Error('View not initialized')

    try {
      const url = this.view.webContents.getURL()
      if (!url.includes('perplexity.ai')) {
        await this.view.webContents.loadURL('https://www.perplexity.ai/')
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log(`[${this.name}] Fetching thread "${threadSlug}" via API...`)
      const result = await this.view.webContents.executeJavaScript(
        this.makeFetchThreadScript(threadSlug)
      )

      if (!result || result.status !== 'success') {
        console.warn(`[${this.name}] Failed to fetch thread from API`)
        return {
          status: 'error',
          entries: []
        }
      }

      console.log(
        `[${this.name}] Fetched thread "${threadSlug}" with ${result.entries?.length || 0} entries`
      )

      return result as PerplexityThread
    } catch (error) {
      console.error(`[${this.name}] Error fetching thread content:`, error)
      throw error
    }
  }

  private async syncThread(thread: PerplexityThreadListItem): Promise<void> {
    if (!this.view || !this.capturedHeaders) {
      throw new Error('Not connected')
    }

    const content = await this.extractThreadContent(thread.slug)

    // Extract ID from thread_url_slug (part after last dash)
    // Example: "what-is-this-cat-7zu8oWH.T1eHHROfJKh1jg" -> "7zu8oWH.T1eHHROfJKh1jg"
    const threadId = this.extractThreadId(thread.slug)

    const existing = await this.storage.getConversation(threadId)
    if (existing) {
      await this.storage.deleteMessagesForConversation(threadId)
    }

    await this.storage.upsertConversation({
      id: threadId,
      title: thread.title || 'Untitled',
      provider: 'perplexity',
      createdAt: new Date(thread.last_query_datetime),
      updatedAt: new Date(thread.last_query_datetime),
      syncedAt: new Date(),
      messageCount: content.entries.length * 2, // Each entry has query + answer
      currentNodeId: null // Perplexity doesn't have branching
    })

    // Convert entries to messages (user query + assistant response pairs)
    const messageInserts: Array<{
      id: string
      conversationId: string
      role: 'user' | 'assistant'
      parts: string
      createdAt: Date | undefined
      orderIndex: number
      parentId: string | null
      siblingIds: string
      siblingIndex: number
    }> = []

    const attachmentInserts: Array<{
      id: string
      messageId: string
      type: 'image' | 'file'
      fileId: string
      originalUrl: string
      localPath: string
      filename: string | null
      mimeType: string | null
      size: number
      width?: number
      height?: number
    }> = []

    let orderIndex = 0
    for (const entry of content.entries) {
      // User query message
      const userMessageId = `${entry.uuid}-query`
      messageInserts.push({
        id: userMessageId,
        conversationId: threadId,
        role: 'user',
        parts: JSON.stringify([{ type: 'text', text: entry.query_str }]),
        createdAt: new Date(entry.updated_datetime),
        orderIndex: orderIndex++,
        parentId: null,
        siblingIds: JSON.stringify([]),
        siblingIndex: 0
      })

      // Process attachments in user query
      if (entry.attachments && entry.attachments.length > 0) {
        for (const attUrl of entry.attachments) {
          // Extract fileId from URL
          const fileId = this.extractFileIdFromUrl(attUrl)
          attachmentInserts.push({
            id: `${userMessageId}-att-${fileId}`,
            messageId: userMessageId,
            type: 'image', // Perplexity attachments are typically images
            fileId: fileId,
            originalUrl: attUrl,
            localPath: '',
            filename: null,
            mimeType: 'image/jpeg',
            size: 0,
            width: undefined,
            height: undefined
          })
        }
      }

      // Assistant answer message
      const answerBlock = entry.blocks.find((b) => b.intended_usage === 'ask_text')
      const webResultBlock = entry.blocks.find((b) => b.intended_usage === 'web_results')

      if (answerBlock?.markdown_block) {
        const parts = transformPerplexityMessageToParts({
          markdown: answerBlock.markdown_block.answer,
          webResults: webResultBlock?.web_result_block?.web_results || []
        })

        messageInserts.push({
          id: `${entry.uuid}-answer`,
          conversationId: threadId,
          role: 'assistant',
          parts: JSON.stringify(parts),
          createdAt: new Date(entry.updated_datetime),
          orderIndex: orderIndex++,
          parentId: null,
          siblingIds: JSON.stringify([]),
          siblingIndex: 0
        })
      }
    }

    await this.storage.upsertMessages(messageInserts)

    if (attachmentInserts.length > 0) {
      await this.storage.upsertAttachments(attachmentInserts)
    }
  }

  /**
   * Extract thread ID from thread_url_slug
   * Example: "what-is-this-cat-7zu8oWH.T1eHHROfJKh1jg" -> "7zu8oWH.T1eHHROfJKh1jg"
   */
  private extractThreadId(threadUrlSlug: string): string {
    const lastDashIndex = threadUrlSlug.lastIndexOf('-')
    if (lastDashIndex === -1) {
      return threadUrlSlug
    }
    return threadUrlSlug.substring(lastDashIndex + 1)
  }

  /**
   * Extract file ID from Perplexity S3 URL
   */
  private extractFileIdFromUrl(url: string): string {
    // URL format: https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/images/{userId}/{fileId}/image.jpg?...
    const match = url.match(/\/([^/]+)\/[^/?]+\.(jpg|jpeg|png|gif|webp)/i)
    if (match) {
      return match[1]
    }
    // Fallback: use hash of URL
    return Buffer.from(url).toString('base64').substring(0, 16)
  }

  // ============================================================================
  // JAVASCRIPT INJECTION SCRIPTS
  // ============================================================================

  private makeFetchThreadListScript(offset: number, limit: number = 20): string {
    return `
(async function() {
  const headers = {
    'accept': '*/*',
    'content-type': 'application/json',
    'x-app-apiclient': 'default',
    'x-app-apiversion': '2.18'
  };

  const response = await fetch(
    'https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.18&source=default',
    {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify({
        limit: ${limit},
        ascending: false,
        offset: ${offset},
        search_term: ""
      })
    }
  );

  if (!response.ok) {
    console.error('[Perplexity API] Failed to fetch threads:', response.status);
    return { threads: [], error: response.status };
  }

  const data = await response.json();

  return {
    threads: data || []
  };
})();
`
  }

  private makeFetchThreadScript(threadSlug: string): string {
    return `
(async function() {
  const headers = {
    'accept': '*/*',
    'x-app-apiclient': 'default',
    'x-app-apiversion': '2.18'
  };

  const response = await fetch(
    'https://www.perplexity.ai/rest/thread/${threadSlug}?with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=10&offset=0&from_first=true',
    {
      credentials: 'include',
      headers: headers
    }
  );

  if (!response.ok) {
    console.error('[Perplexity API] Failed to fetch thread:', response.status);
    return null;
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
        partition: 'persist:perplexity',
        preload: join(__dirname, '../preload/provider-webauthn.js')
      }
    })

    // Inject WebAuthn bridge override when DOM is ready
    this.view.webContents.on('dom-ready', () => {
      this.view?.webContents.executeJavaScript(WEBAUTHN_INJECTION_SCRIPT).catch((err) => {
        console.error(`[${this.name}] Failed to inject WebAuthn bridge:`, err)
      })
    })

    const perplexitySession = session.fromPartition('persist:perplexity')

    // Enable WebAuthn/passkey support by allowing required permissions
    perplexitySession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowedPermissions = ['hid', 'usb', 'clipboard-read', 'clipboard-sanitized-write']
      callback(allowedPermissions.includes(permission))
    })

    perplexitySession.setPermissionCheckHandler((_webContents, permission) => {
      const allowedPermissions = ['hid', 'usb', 'clipboard-read', 'clipboard-sanitized-write']
      return allowedPermissions.includes(permission)
    })

    perplexitySession.webRequest.onBeforeSendHeaders(
      { urls: ['*://www.perplexity.ai/rest/*'] },
      (details, callback) => {
        // Perplexity uses cookie-based auth, capture headers for API calls
        if (details.requestHeaders['Cookie'] || details.requestHeaders['cookie']) {
          const hadHeaders = this.capturedHeaders !== null
          this.capturedHeaders = {
            'x-app-apiclient': 'default',
            'x-app-apiversion': '2.18',
            'content-type': 'application/json'
          }
          if (!hadHeaders) {
            console.log(`[${this.name}] Captured API headers (cookies)`)
          }
        }
        callback({ requestHeaders: details.requestHeaders })
      }
    )

    perplexitySession.webRequest.onCompleted(
      { urls: ['*://www.perplexity.ai/rest/user/settings*'] },
      (details) => {
        if (details.statusCode === 200) {
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
    return this.lastApiAuthSuccess
  }
}
