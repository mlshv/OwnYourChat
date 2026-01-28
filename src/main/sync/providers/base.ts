import type { WebContentsView } from 'electron'
import type { IStorage } from '../../storage/interface.js'
import { store } from '../../store.js'
import type { Conversation, Message } from '../../../shared/types'

export type ProviderName = 'chatgpt' | 'claude' | 'perplexity'

export type ProviderStatus =
  | 'connected'
  | 'syncing'
  | 'timeout'
  | 'logged_out'
  | 'error'
  | 'disconnected'

export interface ProviderState {
  name: ProviderName
  status: ProviderStatus
  isOnline: boolean
  lastSyncAt: Date | null
  errorMessage: string | null
  isSyncing: boolean
}

export interface SyncResult {
  success: boolean
  error?: string
  newChatsFound?: number
}

export interface IProvider {
  readonly name: ProviderName

  // Lifecycle methods
  start(): Promise<void>
  stop(): Promise<void>

  // Sync operations
  sync(): Promise<SyncResult>

  // State queries
  getState(): ProviderState
  isConnected(): boolean
  shouldRestoreConnection(): boolean

  // Connection restoration
  restoreConnection(): Promise<void>

  // Login/logout
  showLogin(): void
  logout(): Promise<void>

  // View and data access
  getView(): WebContentsView | null
  getHeaders(): Record<string, string> | null
  hideView(): void
  toggleView(): boolean

  // Conversation refresh
  refreshAndPersistConversation(
    conversationId: string
  ): Promise<{ conversation: Conversation; messages: Message[] } | null>

  // Attachment download
  downloadAttachment(
    fileId: string,
    filename: string | null,
    conversationId: string
  ): Promise<string>
}

export abstract class BaseProvider<TMetadata = Record<string, unknown>> implements IProvider {
  abstract readonly name: ProviderName

  protected storage: IStorage
  protected pollingInterval: NodeJS.Timeout | null = null
  protected pollingIntervalMs: number
  protected _isSyncing: boolean = false
  protected _status: ProviderStatus = 'disconnected'
  protected _lastSyncAt: Date | null = null
  protected _errorMessage: string | null = null
  protected _isConnectedFromDb: boolean = false

  constructor(storage: IStorage, pollingIntervalMs: number = 60000) {
    this.storage = storage
    this.pollingIntervalMs = pollingIntervalMs
  }

  abstract sync(): Promise<SyncResult>
  abstract showLogin(): void
  abstract logout(): Promise<void>
  abstract getView(): WebContentsView | null
  abstract getHeaders(): Record<string, string> | null
  abstract hideView(): void
  abstract toggleView(): boolean
  abstract isConnected(): boolean
  abstract restoreConnection(): Promise<void>
  abstract refreshAndPersistConversation(
    conversationId: string
  ): Promise<{ conversation: Conversation; messages: Message[] } | null>
  abstract downloadAttachment(
    fileId: string,
    filename: string | null,
    conversationId: string
  ): Promise<string>

  /**
   * Get default metadata for this provider.
   * Subclasses should override this to provide provider-specific defaults.
   */
  protected abstract getDefaultMetadata(): TMetadata

  /**
   * Get current metadata from database, or default if not found.
   */
  protected async getMetadata(): Promise<TMetadata> {
    const state = await this.storage.getProviderState<TMetadata>(this.name)
    return state?.metadata || this.getDefaultMetadata()
  }

  /**
   * Update metadata in database while preserving other provider state fields.
   */
  protected async setMetadata(metadata: TMetadata): Promise<void> {
    await this.storage.setProviderState({
      providerName: this.name,
      isOnline: this.isConnected(),
      lastSyncAt: this._lastSyncAt,
      status: this._status,
      errorMessage: this._errorMessage,
      metadata
    })
  }

  shouldRestoreConnection(): boolean {
    return this._isConnectedFromDb && !this.isConnected()
  }

  async start(): Promise<void> {
    if (this.pollingInterval) {
      console.log(`[${this.name}] Polling already started`)
      return
    }

    console.log(`[${this.name}] Starting polling with interval ${this.pollingIntervalMs}ms`)

    // Run initial sync
    this.runSync()

    // Set up periodic polling
    this.pollingInterval = setInterval(() => {
      this.runSync()
    }, this.pollingIntervalMs)
  }

  async stop(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
      console.log(`[${this.name}] Polling stopped`)
    }
  }

  getState(): ProviderState {
    return {
      name: this.name,
      status: this._status,
      isOnline: this.isConnected(),
      lastSyncAt: this._lastSyncAt,
      errorMessage: this._errorMessage,
      isSyncing: this._isSyncing
    }
  }

  protected async runSync(): Promise<void> {
    if (this._isSyncing) {
      return
    }

    if (!this.isConnected()) {
      console.log(`[${this.name}] Not connected, skipping sync`)
      return
    }

    console.log(`[${this.name}] Starting sync...`)
    this._isSyncing = true
    this._status = 'syncing'

    // Update store
    this.updateStoreState()

    try {
      const result = await this.sync()

      if (result.success) {
        this._status = 'connected'
        this._lastSyncAt = new Date()
        this._errorMessage = null
        console.log(`[${this.name}] Sync completed: ${result.newChatsFound} new chats`)

        // Persist state
        await this.storage.setProviderState({
          providerName: this.name,
          isOnline: true,
          lastSyncAt: this._lastSyncAt,
          status: this._status,
          errorMessage: null
        })

        // Update store
        this.updateStoreState()
      } else {
        // Check if error indicates logged out (401/403)
        if (
          result.error?.includes('401') ||
          result.error?.includes('403') ||
          result.error?.includes('unauthorized')
        ) {
          this._status = 'logged_out'
          console.log(`[${this.name}] Sync failed: logged out`)

          // Persist logged out state
          await this.storage.setProviderState({
            providerName: this.name,
            isOnline: false,
            lastSyncAt: this._lastSyncAt,
            status: this._status,
            errorMessage: result.error
          })

          // Update store
          this.updateStoreState()

          // Stop polling when logged out
          await this.stop()
        } else {
          // Timeout or other transient error - keep polling
          this._status = 'timeout'
          this._errorMessage = result.error || 'Unknown error'
          console.log(`[${this.name}] Sync failed (will retry): ${result.error}`)

          // Update store
          this.updateStoreState()
        }
      }
    } catch (error) {
      this._status = 'error'
      this._errorMessage = (error as Error).message
      console.error(`[${this.name}] Sync error:`, error)

      // Update store
      this.updateStoreState()
    } finally {
      this._isSyncing = false

      // Update store
      this.updateStoreState()
    }
  }

  protected updateStoreState(): void {
    store.getState().updateProviderState(this.name, {
      isOnline: this.isConnected(),
      status: this._status,
      lastSyncAt: this._lastSyncAt,
      errorMessage: this._errorMessage,
      isSyncing: this._isSyncing
    })
  }

  /**
   * Update sync progress in the global store.
   * Call this during sync to report current/total conversations and new chats found.
   */
  protected updateSyncProgress(current: number, total: number, newChatsFound: number = 0): void {
    store.getState().updateSyncState({
      progress: { current, total, newChatsFound }
    })
  }

  protected async loadPersistedState(): Promise<void> {
    const state = await this.storage.getProviderState(this.name)
    if (state) {
      this._status = state.status
      this._lastSyncAt = state.lastSyncAt
      this._errorMessage = state.errorMessage
      this._isConnectedFromDb = state.isOnline
      console.log(
        `[${this.name}] Loaded persisted state: isOnline=${state.isOnline}, status=${state.status}`
      )
    }
  }
}
