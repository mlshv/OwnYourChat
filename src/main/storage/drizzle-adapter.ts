import { eq, and, isNotNull, lt } from 'drizzle-orm'
import type { Conversation, ProviderStatus } from '@shared/types'
import type { ProviderName } from '../sync/providers/base'
import * as dbOps from '../db/operations'
import { getDatabase } from '../db/index'
import { providerState, conversations } from '../db/schema'
import type { NewConversation, NewMessage, NewAttachment } from '../db/schema'
import type { IStorage, ProviderStateRecord } from './interface'

export class DrizzleStorageAdapter implements IStorage {
  // Delegate conversation operations to existing db operations
  async listConversations(options?: { limit?: number; offset?: number }) {
    return dbOps.listConversations(options)
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return dbOps.getConversation(id)
  }

  async getConversationWithMessages(id: string, options?: { limit?: number }) {
    return dbOps.getConversationWithMessages(id, options)
  }

  async upsertConversation(data: NewConversation): Promise<void> {
    return dbOps.upsertConversation(data)
  }

  async deleteConversation(id: string): Promise<void> {
    return dbOps.deleteConversation(id)
  }

  async getMaxUpdatedAt(provider: string): Promise<Date | null> {
    return dbOps.getMaxUpdatedAt(provider)
  }

  // Message operations
  async upsertMessages(data: NewMessage[]): Promise<void> {
    return dbOps.upsertMessages(data)
  }

  async deleteMessagesForConversation(conversationId: string): Promise<void> {
    return dbOps.deleteMessagesForConversation(conversationId)
  }

  // Attachment operations
  async upsertAttachments(data: NewAttachment[]): Promise<void> {
    return dbOps.upsertAttachments(data)
  }

  // Provider state operations
  async getProviderState<TMetadata = Record<string, unknown>>(
    providerName: ProviderName
  ): Promise<ProviderStateRecord<TMetadata> | null> {
    const db = getDatabase()
    const [result] = await db
      .select()
      .from(providerState)
      .where(eq(providerState.providerName, providerName))

    if (!result) return null

    return {
      providerName: result.providerName as ProviderName,
      isOnline: result.isConnected ?? false,
      lastSyncAt: result.lastSyncAt,
      status: result.status as ProviderStatus,
      errorMessage: result.errorMessage,
      metadata: result.metadata ? (JSON.parse(result.metadata) as TMetadata) : undefined
    }
  }

  async setProviderState<TMetadata = Record<string, unknown>>(
    state: ProviderStateRecord<TMetadata>
  ): Promise<void> {
    const db = getDatabase()

    const [existing] = await db
      .select()
      .from(providerState)
      .where(eq(providerState.providerName, state.providerName))

    const keepOrNew = <T>(value: T | undefined, existingValue: T): T =>
      value === undefined ? existingValue : value

    const mergedValues = {
      isConnected: keepOrNew(state.isOnline, existing?.isConnected ?? false),
      lastSyncAt: keepOrNew(state.lastSyncAt, existing?.lastSyncAt ?? null),
      status: keepOrNew(state.status, existing?.status),
      errorMessage: keepOrNew(state.errorMessage, existing?.errorMessage ?? null),
      metadata:
        state.metadata === undefined
          ? (existing?.metadata ?? null)
          : state.metadata === null
            ? null
            : JSON.stringify(state.metadata)
    }

    if (existing) {
      await db
        .update(providerState)
        .set(mergedValues)
        .where(eq(providerState.providerName, state.providerName))
      return
    }

    await db.insert(providerState).values({
      providerName: state.providerName,
      ...mergedValues
    })
  }

  async getAllProviderStates(): Promise<ProviderStateRecord[]> {
    const db = getDatabase()
    const results = await db.select().from(providerState)

    return results.map((result) => ({
      providerName: result.providerName as ProviderName,
      isOnline: result.isConnected ?? false,
      lastSyncAt: result.lastSyncAt,
      status: result.status as ProviderStatus,
      errorMessage: result.errorMessage,
      metadata: result.metadata ? JSON.parse(result.metadata) : undefined
    }))
  }

  // Conversation sync tracking
  async updateConversationSyncError(
    id: string,
    error: string | null,
    retryCount: number
  ): Promise<void> {
    const db = getDatabase()
    await db
      .update(conversations)
      .set({ syncError: error, syncRetryCount: retryCount })
      .where(eq(conversations.id, id))
  }

  async getFailedConversations(provider: string, maxRetries: number): Promise<Conversation[]> {
    const db = getDatabase()
    const results = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.provider, provider),
          isNotNull(conversations.syncError),
          lt(conversations.syncRetryCount, maxRetries)
        )
      )

    return results.map((row) => ({
      id: row.id,
      title: row.title,
      provider: row.provider as 'chatgpt' | 'claude',
      createdAt: row.createdAt || new Date(),
      updatedAt: row.updatedAt || new Date(),
      syncedAt: row.syncedAt || new Date(),
      messageCount: row.messageCount || 0,
      currentNodeId: row.currentNodeId
    }))
  }

  // Sync state operations
  async getSyncState(key: string): Promise<string | null> {
    return dbOps.getSyncState(key)
  }

  async setSyncState(key: string, value: string): Promise<void> {
    return dbOps.setSyncState(key, value)
  }
}
