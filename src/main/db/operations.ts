import { eq, desc, max, lt, and, asc, ne, count, or, sql } from 'drizzle-orm'
import { getDatabase } from './index'
import { conversations, messages, attachments, syncState, userPreferences } from './schema'
import type { NewConversation, NewMessage, NewAttachment } from './schema'
import type { Conversation, Message, Attachment, MessagePart } from '../../shared/types'

// Conversation operations
export async function countConversations(): Promise<number> {
  const db = getDatabase()
  const [result] = await db.select({ count: count() }).from(conversations)
  return result?.count ?? 0
}

export async function listConversations(options?: {
  limit?: number
  offset?: number
}): Promise<{ items: Conversation[]; total: number; hasMore: boolean }> {
  const db = getDatabase()
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  const [results, total] = await Promise.all([
    db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset),
    countConversations()
  ])

  return {
    items: results.map(mapConversation),
    total,
    hasMore: offset + results.length < total
  }
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = getDatabase()
  const [result] = await db.select().from(conversations).where(eq(conversations.id, id))
  return result ? mapConversation(result) : null
}

export async function getMaxUpdatedAt(provider: string): Promise<Date | null> {
  const db = getDatabase()
  const [result] = await db
    .select({ maxUpdatedAt: max(conversations.updatedAt) })
    .from(conversations)
    .where(eq(conversations.provider, provider))
  return result?.maxUpdatedAt ?? null
}

export async function getConversationWithMessages(
  id: string,
  options?: { limit?: number }
): Promise<{
  conversation: Conversation
  messages: Message[]
  hasMoreMessages: boolean
  oldestLoadedOrderIndex: number | null
} | null> {
  const db = getDatabase()

  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id))
  if (!conversation) return null

  // If limit is provided, load most recent messages (highest orderIndex)
  // Otherwise load all messages
  let msgs
  let hasMoreMessages = false

  if (options?.limit) {
    // Fetch limit + 1 to check if there are more
    const fetchLimit = options.limit + 1
    const results = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.orderIndex))
      .limit(fetchLimit)

    hasMoreMessages = results.length > options.limit
    msgs = hasMoreMessages ? results.slice(0, options.limit) : results
    // Reverse to get ascending order (oldest first for display)
    msgs.reverse()
  } else {
    msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.orderIndex))
  }

  // Fetch attachments for each message
  const messagesWithAttachments = await Promise.all(
    msgs.map(async (msg) => {
      const msgAttachments = await db
        .select()
        .from(attachments)
        .where(eq(attachments.messageId, msg.id))
      return mapMessage(msg, msgAttachments.map(mapAttachment))
    })
  )

  return {
    conversation: mapConversation(conversation),
    messages: messagesWithAttachments,
    hasMoreMessages,
    oldestLoadedOrderIndex: msgs.length > 0 ? msgs[0].orderIndex : null
  }
}

export async function getMessagesPage(
  conversationId: string,
  options: { limit?: number; beforeOrderIndex?: number }
): Promise<{
  messages: Message[]
  hasMore: boolean
  oldestOrderIndex: number | null
}> {
  const db = getDatabase()
  const limit = options.limit ?? 15

  // Build query - fetch messages before the given orderIndex
  let results
  if (options.beforeOrderIndex !== undefined) {
    results = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          lt(messages.orderIndex, options.beforeOrderIndex)
        )
      )
      .orderBy(desc(messages.orderIndex))
      .limit(limit + 1) // Fetch one extra to check hasMore
  } else {
    results = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.orderIndex))
      .limit(limit + 1)
  }

  const hasMore = results.length > limit
  const msgs = hasMore ? results.slice(0, limit) : results

  // Reverse to get oldest-first order for display
  msgs.reverse()

  // Fetch attachments for each message
  const messagesWithAttachments = await Promise.all(
    msgs.map(async (msg) => {
      const msgAttachments = await db
        .select()
        .from(attachments)
        .where(eq(attachments.messageId, msg.id))
      return mapMessage(msg, msgAttachments.map(mapAttachment))
    })
  )

  return {
    messages: messagesWithAttachments,
    hasMore,
    oldestOrderIndex: msgs.length > 0 ? msgs[0].orderIndex : null
  }
}

export async function searchConversations(
  query: string,
  options?: { caseInsensitive?: boolean }
): Promise<{ items: Conversation[]; total: number; hasMore: boolean }> {
  const db = getDatabase()
  const caseInsensitive = options?.caseInsensitive ?? true

  // unicode_lower is a custom SQLite function that uses JS toLowerCase() for proper Unicode support
  // INSTR does binary comparison for substring matching
  const condition = caseInsensitive
    ? sql`INSTR(unicode_lower(${conversations.title}), ${query.toLowerCase()}) > 0`
    : sql`INSTR(${conversations.title}, ${query}) > 0`

  const results = await db
    .select()
    .from(conversations)
    .where(condition)
    .orderBy(desc(conversations.updatedAt))
    .limit(50)

  return {
    items: results.map(mapConversation),
    total: results.length,
    hasMore: false // Search is always limited to 50
  }
}

export async function searchConversationsByKeywords(
  keywords: string[],
  options?: { limit?: number; caseInsensitive?: boolean }
): Promise<{ items: Conversation[]; total: number }> {
  const db = getDatabase()
  const limit = options?.limit ?? 50
  const caseInsensitive = options?.caseInsensitive ?? true

  if (keywords.length === 0) {
    return { items: [], total: 0 }
  }

  // unicode_lower is a custom SQLite function that uses JS toLowerCase() for proper Unicode support
  // INSTR does binary comparison for substring matching
  const conditions = keywords.map((kw) =>
    caseInsensitive
      ? sql`INSTR(unicode_lower(${conversations.title}), ${kw.toLowerCase()}) > 0`
      : sql`INSTR(${conversations.title}, ${kw}) > 0`
  )

  const results = await db
    .select()
    .from(conversations)
    .where(or(...conditions))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)

  return {
    items: results.map(mapConversation),
    total: results.length
  }
}

export async function searchMessagesByKeywords(
  keywords: string[],
  options?: { limit?: number; caseInsensitive?: boolean }
): Promise<{
  items: Array<{
    message: Message
    conversation: Conversation
    matchedKeywords: string[]
  }>
  total: number
}> {
  const db = getDatabase()
  const limit = options?.limit ?? 50
  const caseInsensitive = options?.caseInsensitive ?? true

  if (keywords.length === 0) {
    return { items: [], total: 0 }
  }

  // unicode_lower is a custom SQLite function that uses JS toLowerCase() for proper Unicode support
  // INSTR does binary comparison for substring matching
  const conditions = keywords.map((kw) =>
    caseInsensitive
      ? sql`INSTR(unicode_lower(${messages.parts}), ${kw.toLowerCase()}) > 0`
      : sql`INSTR(${messages.parts}, ${kw}) > 0`
  )

  const results = await db
    .select({
      message: messages,
      conversation: conversations
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(or(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)

  const items = await Promise.all(
    results.map(async (row) => {
      const msgAttachments = await db
        .select()
        .from(attachments)
        .where(eq(attachments.messageId, row.message.id))

      const partsText = row.message.parts?.toLowerCase() ?? ''
      const matchedKeywords = keywords.filter((kw) => partsText.includes(kw.toLowerCase()))

      return {
        message: mapMessage(row.message, msgAttachments.map(mapAttachment)),
        conversation: mapConversation(row.conversation),
        matchedKeywords
      }
    })
  )

  return {
    items,
    total: items.length
  }
}

export async function upsertConversation(data: NewConversation): Promise<void> {
  const db = getDatabase()

  await db
    .insert(conversations)
    .values(data)
    .onConflictDoUpdate({
      target: conversations.id,
      set: {
        title: data.title,
        provider: data.provider,
        updatedAt: data.updatedAt,
        syncedAt: data.syncedAt,
        messageCount: data.messageCount,
        currentNodeId: data.currentNodeId
      }
    })
}

export async function deleteConversation(id: string): Promise<void> {
  const db = getDatabase()
  await db.delete(conversations).where(eq(conversations.id, id))
}

// Message operations
export async function upsertMessages(data: NewMessage[]): Promise<void> {
  const db = getDatabase()
  if (data.length === 0) return

  // SQLite upsert: insert or replace on conflict
  for (const message of data) {
    await db
      .insert(messages)
      .values(message)
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          role: message.role,
          parts: message.parts,
          createdAt: message.createdAt,
          orderIndex: message.orderIndex,
          parentId: message.parentId,
          siblingIds: message.siblingIds,
          siblingIndex: message.siblingIndex
        }
      })
  }
}

export async function deleteMessagesForConversation(conversationId: string): Promise<void> {
  const db = getDatabase()
  await db.delete(messages).where(eq(messages.conversationId, conversationId))
}

// Attachment operations
export async function upsertAttachments(data: NewAttachment[]): Promise<void> {
  const db = getDatabase()
  if (data.length === 0) return

  // SQLite upsert: insert or replace on conflict
  for (const attachment of data) {
    await db
      .insert(attachments)
      .values(attachment)
      .onConflictDoUpdate({
        target: attachments.id,
        set: {
          messageId: attachment.messageId,
          type: attachment.type,
          fileId: attachment.fileId,
          originalUrl: attachment.originalUrl,
          localPath: attachment.localPath,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          width: attachment.width,
          height: attachment.height
        }
      })
  }
}

export async function getAttachmentsForMessage(messageId: string): Promise<Attachment[]> {
  const db = getDatabase()
  const results = await db.select().from(attachments).where(eq(attachments.messageId, messageId))
  return results.map(mapAttachment)
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  const db = getDatabase()
  const [result] = await db.select().from(attachments).where(eq(attachments.id, id))
  return result ? mapAttachment(result) : null
}

export async function getConversationFromAttachmentId(
  attachmentId: string
): Promise<Conversation | null> {
  const db = getDatabase()
  const [attachment] = await db.select().from(attachments).where(eq(attachments.id, attachmentId))
  if (!attachment?.messageId) return null

  const [message] = await db.select().from(messages).where(eq(messages.id, attachment.messageId))
  if (!message?.conversationId) return null

  return getConversation(message.conversationId)
}

export async function updateAttachmentLocalPath(id: string, localPath: string): Promise<void> {
  const db = getDatabase()
  await db.update(attachments).set({ localPath }).where(eq(attachments.id, id))
}

// Find an attachment with the same fileId that has already been downloaded
export async function findDownloadedAttachmentByFileId(fileId: string): Promise<Attachment | null> {
  const db = getDatabase()
  const [result] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.fileId, fileId), ne(attachments.localPath, '')))
    .limit(1)
  return result ? mapAttachment(result) : null
}

// Sync state operations
export async function getSyncState(key: string): Promise<string | null> {
  const db = getDatabase()
  const [result] = await db.select().from(syncState).where(eq(syncState.key, key))
  return result?.value ?? null
}

export async function setSyncState(key: string, value: string): Promise<void> {
  const db = getDatabase()
  await db.insert(syncState).values({ key, value }).onConflictDoUpdate({
    target: syncState.key,
    set: { value }
  })
}

// Mappers
function mapConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider as 'chatgpt' | 'claude',
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(),
    syncedAt: row.syncedAt ?? new Date(),
    messageCount: row.messageCount ?? 0,
    currentNodeId: row.currentNodeId ?? null
  }
}

function mapMessage(
  row: typeof messages.$inferSelect,
  messageAttachments: Attachment[] = []
): Message {
  // Parse siblingIds from JSON string
  let siblingIds: string[] = []
  if (row.siblingIds) {
    try {
      siblingIds = JSON.parse(row.siblingIds)
    } catch {
      siblingIds = []
    }
  }

  // Parse parts from JSON string
  let parts: MessagePart[] = []
  if (row.parts) {
    try {
      const parsed = JSON.parse(row.parts)
      if (Array.isArray(parsed)) {
        parts = parsed
      }
    } catch {
      parts = []
    }
  }

  return {
    id: row.id,
    conversationId: row.conversationId ?? '',
    role: row.role as 'user' | 'assistant' | 'system',
    parts,
    createdAt: row.createdAt ?? new Date(),
    orderIndex: row.orderIndex,
    attachments: messageAttachments,
    // Branch/tree structure fields
    parentId: row.parentId ?? null,
    siblingIds: siblingIds,
    siblingIndex: row.siblingIndex ?? 0
  }
}

function mapAttachment(row: typeof attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    messageId: row.messageId ?? '',
    type: row.type as 'image' | 'file',
    fileId: row.fileId ?? undefined,
    originalUrl: row.originalUrl ?? '',
    localPath: row.localPath ?? '',
    filename: row.filename ?? '',
    mimeType: row.mimeType ?? '',
    size: row.size ?? 0,
    width: row.width ?? undefined,
    height: row.height ?? undefined
  }
}

// User preferences operations
export async function getUserPreferences(): Promise<{
  hasCompletedOnboarding: boolean
  showDebugPanel: boolean
  exportSettings: import('../../shared/types').ExportSettings | null
}> {
  const db = getDatabase()
  const [result] = await db.select().from(userPreferences).where(eq(userPreferences.id, 'default'))

  if (!result) {
    // Create default preferences if they don't exist
    await db.insert(userPreferences).values({
      id: 'default',
      hasCompletedOnboarding: false,
      showDebugPanel: false,
      exportSettings: null
    })
    return { hasCompletedOnboarding: false, showDebugPanel: false, exportSettings: null }
  }

  let exportSettings: import('../../shared/types').ExportSettings | null = null
  if (result.exportSettings) {
    try {
      exportSettings = JSON.parse(result.exportSettings)
    } catch {
      exportSettings = null
    }
  }

  return {
    hasCompletedOnboarding: result.hasCompletedOnboarding,
    showDebugPanel: result.showDebugPanel,
    exportSettings
  }
}

export async function setUserPreferences(prefs: {
  hasCompletedOnboarding?: boolean
  showDebugPanel?: boolean
  exportSettings?: import('../../shared/types').ExportSettings | null
}): Promise<{
  hasCompletedOnboarding: boolean
  showDebugPanel: boolean
  exportSettings: import('../../shared/types').ExportSettings | null
}> {
  const db = getDatabase()

  // Get current preferences
  const current = await getUserPreferences()

  // Handle exportSettings
  const newExportSettings =
    prefs.exportSettings !== undefined ? prefs.exportSettings : current.exportSettings
  const exportSettingsJson = newExportSettings ? JSON.stringify(newExportSettings) : null

  // Update with new values
  const updated = {
    id: 'default' as const,
    hasCompletedOnboarding: prefs.hasCompletedOnboarding ?? current.hasCompletedOnboarding,
    showDebugPanel: prefs.showDebugPanel ?? current.showDebugPanel,
    exportSettings: exportSettingsJson
  }

  await db
    .insert(userPreferences)
    .values(updated)
    .onConflictDoUpdate({
      target: userPreferences.id,
      set: {
        hasCompletedOnboarding: updated.hasCompletedOnboarding,
        showDebugPanel: updated.showDebugPanel,
        exportSettings: updated.exportSettings
      }
    })

  return {
    hasCompletedOnboarding: updated.hasCompletedOnboarding,
    showDebugPanel: updated.showDebugPanel,
    exportSettings: newExportSettings
  }
}
