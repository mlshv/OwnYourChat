import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    provider: text('provider').notNull(), // 'chatgpt' | 'claude'
    createdAt: integer('created_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
    syncedAt: integer('synced_at', { mode: 'timestamp' }),
    messageCount: integer('message_count').default(0),
    currentNodeId: text('current_node_id'), // Default branch endpoint for navigation
    syncError: text('sync_error'), // Last sync error message (null if no error)
    syncRetryCount: integer('sync_retry_count').default(0) // Number of retry attempts
  },
  (table) => ({
    providerIdx: index('provider_idx').on(table.provider)
  })
)

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id, {
    onDelete: 'cascade'
  }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  parts: text('parts').notNull(), // JSON array of MessagePart objects
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
  orderIndex: integer('order_index').notNull(),
  // Branch/tree structure fields
  parentId: text('parent_id'), // Parent message ID (null for root)
  siblingIds: text('sibling_ids'), // JSON array of sibling message IDs
  siblingIndex: integer('sibling_index') // 0-based index among siblings
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'image' | 'file'
  fileId: text('file_id'), // ChatGPT/Claude file ID
  originalUrl: text('original_url'),
  localPath: text('local_path'),
  filename: text('filename'),
  mimeType: text('mime_type'),
  size: integer('size'),
  width: integer('width'), // Image width
  height: integer('height'), // Image height
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
})

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
})

export const providerState = sqliteTable('provider_state', {
  providerName: text('provider_name').primaryKey(),
  isConnected: integer('is_connected', { mode: 'boolean' }).notNull().default(false),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  status: text('status').notNull(), // 'connected' | 'syncing' | 'timeout' | 'logged_out' | 'error' | 'disconnected'
  errorMessage: text('error_message'),
  metadata: text('metadata'), // JSON for provider-specific data
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
})

export const userPreferences = sqliteTable('user_preferences', {
  id: text('id').primaryKey().default('default'),
  hasCompletedOnboarding: integer('has_completed_onboarding', { mode: 'boolean' })
    .notNull()
    .default(false),
  showDebugPanel: integer('show_debug_panel', { mode: 'boolean' })
    .notNull()
    .default(false),
  exportSettings: text('export_settings'), // JSON: { format, includeAttachments, prefixTimestamp, outputPath }
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
})

// Type exports for convenience
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Attachment = typeof attachments.$inferSelect
export type NewAttachment = typeof attachments.$inferInsert
export type ProviderState = typeof providerState.$inferSelect
export type NewProviderState = typeof providerState.$inferInsert
export type UserPreferences = typeof userPreferences.$inferSelect
export type NewUserPreferences = typeof userPreferences.$inferInsert
