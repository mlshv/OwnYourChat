import type { Conversation, Message } from '../../shared/types'
import type { ProviderName, ProviderStatus } from '../sync/providers/base.js'
import type { NewConversation, NewMessage, NewAttachment } from '../db/schema.js'

export interface ProviderStateRecord<TMetadata = Record<string, unknown>> {
  providerName: ProviderName
  isOnline: boolean
  lastSyncAt: Date | null
  status: ProviderStatus
  errorMessage: string | null
  metadata?: TMetadata
}

export interface IStorage {
  // Conversation operations
  listConversations(options?: {
    limit?: number
    offset?: number
  }): Promise<{ items: Conversation[]; total: number; hasMore: boolean }>
  getConversation(id: string): Promise<Conversation | null>
  getConversationWithMessages(
    id: string,
    options?: { limit?: number }
  ): Promise<{
    conversation: Conversation
    messages: Message[]
    hasMoreMessages: boolean
    oldestLoadedOrderIndex: number | null
  } | null>
  upsertConversation(data: NewConversation): Promise<void>
  deleteConversation(id: string): Promise<void>
  getMaxUpdatedAt(provider: string): Promise<Date | null>

  // Message operations
  upsertMessages(data: NewMessage[]): Promise<void>
  deleteMessagesForConversation(conversationId: string): Promise<void>

  // Attachment operations
  upsertAttachments(data: NewAttachment[]): Promise<void>

  // Provider state operations
  getProviderState<TMetadata = Record<string, unknown>>(
    providerName: ProviderName
  ): Promise<ProviderStateRecord<TMetadata> | null>
  setProviderState<TMetadata = Record<string, unknown>>(
    state: ProviderStateRecord<TMetadata>
  ): Promise<void>
  getAllProviderStates(): Promise<ProviderStateRecord[]>

  // Conversation sync tracking
  updateConversationSyncError(id: string, error: string | null, retryCount: number): Promise<void>
  getFailedConversations(provider: string, maxRetries: number): Promise<Conversation[]>

  // Sync state operations
  getSyncState(key: string): Promise<string | null>
  setSyncState(key: string, value: string): Promise<void>
}
