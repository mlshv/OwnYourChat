/**
 * Export Worker Thread
 *
 * Runs heavy export operations off the main process to keep UI responsive.
 * Has its own database connection for reading conversation data.
 *
 * Main process retains:
 * - Attachment downloads (requires provider auth state)
 * - IPC communication with renderer
 * - Abort coordination
 */
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, desc, asc, count } from 'drizzle-orm'
import fs from 'fs'
import * as schema from '../db/schema'
import { exportToMarkdown } from './markdown'
import { exportToJson } from './json'
import type {
  ExportOptions,
  Conversation,
  Message,
  Attachment,
  MessagePart,
  ExportProgress
} from '../../shared/types'

// Worker message types
export type WorkerInboundMessage =
  | { type: 'export'; payload: ExportPayload }
  | { type: 'exportAll'; payload: ExportAllPayload }
  | { type: 'cancel' }
  | { type: 'attachmentDownloaded'; attachmentId: string; localPath: string }

export type WorkerOutboundMessage =
  | { type: 'progress'; payload: ExportProgress }
  | {
      type: 'downloadAttachment'
      conversationId: string
      attachmentId: string
      fileId: string
      filename: string
    }
  | { type: 'complete'; payload: { path: string } }
  | { type: 'error'; payload: { message: string } }
  | { type: 'cancelled' }

export type ExportPayload = {
  conversationId: string
  options: ExportOptions
}

export type ExportAllPayload = {
  options: ExportOptions
}

// Worker initialization
const dbPath = workerData?.dbPath as string
if (!dbPath) {
  parentPort?.postMessage({ type: 'error', payload: { message: 'No database path provided' } })
  process.exit(1)
}

const sqlite = new Database(dbPath)
const db = drizzle(sqlite, { schema })

// Cancellation flag
let cancelled = false

// Pending attachment downloads (waiting for main process response)
const pendingAttachments = new Map<
  string,
  { resolve: (localPath: string) => void; reject: (error: Error) => void }
>()

// Send message to main process
function send(message: WorkerOutboundMessage): void {
  parentPort?.postMessage(message)
}

// Report progress to main process
function reportProgress(progress: ExportProgress): void {
  send({ type: 'progress', payload: progress })
}

// Check if cancelled and throw if so
function checkCancelled(): void {
  if (cancelled) {
    throw new Error('Export cancelled')
  }
}

// DB Operations (replicates operations.ts for worker context)
function mapConversation(row: typeof schema.conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider as 'chatgpt' | 'claude' | 'perplexity',
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(),
    syncedAt: row.syncedAt ?? new Date(),
    messageCount: row.messageCount ?? 0,
    currentNodeId: row.currentNodeId ?? null
  }
}

function mapAttachment(row: typeof schema.attachments.$inferSelect): Attachment {
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

function mapMessage(
  row: typeof schema.messages.$inferSelect,
  messageAttachments: Attachment[] = []
): Message {
  let siblingIds: string[] = []
  if (row.siblingIds) {
    try {
      siblingIds = JSON.parse(row.siblingIds)
    } catch {
      siblingIds = []
    }
  }

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
    parentId: row.parentId ?? null,
    siblingIds: siblingIds,
    siblingIndex: row.siblingIndex ?? 0
  }
}

function countConversations(): number {
  const result = db.select({ count: count() }).from(schema.conversations).get()
  return result?.count ?? 0
}

function listConversations(options?: { limit?: number; offset?: number }): {
  items: Conversation[]
  total: number
  hasMore: boolean
} {
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  const results = db
    .select()
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(limit)
    .offset(offset)
    .all()

  const total = countConversations()

  return {
    items: results.map(mapConversation),
    total,
    hasMore: offset + results.length < total
  }
}

function getConversationWithMessages(id: string): {
  conversation: Conversation
  messages: Message[]
} | null {
  const [conversation] = db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .all()

  if (!conversation) return null

  const msgs = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(asc(schema.messages.orderIndex))
    .all()

  // Fetch attachments for each message
  const messagesWithAttachments = msgs.map((msg) => {
    const msgAttachments = db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.messageId, msg.id))
      .all()
    return mapMessage(msg, msgAttachments.map(mapAttachment))
  })

  return {
    conversation: mapConversation(conversation),
    messages: messagesWithAttachments
  }
}

function updateAttachmentLocalPath(id: string, localPath: string): void {
  db.update(schema.attachments).set({ localPath }).where(eq(schema.attachments.id, id)).run()
}

// Count missing attachments for progress tracking
function countMissingAttachments(messages: Message[]): number {
  let count = 0
  for (const msg of messages) {
    if (!msg.attachments || msg.attachments.length === 0) continue
    for (const att of msg.attachments) {
      if (att.localPath && fs.existsSync(att.localPath)) continue
      if (!att.fileId) continue
      count++
    }
  }
  return count
}

// Request attachment download from main process and wait for response
async function requestAttachmentDownload(
  conversationId: string,
  attachment: Attachment
): Promise<string> {
  return new Promise((resolve, reject) => {
    pendingAttachments.set(attachment.id, { resolve, reject })
    send({
      type: 'downloadAttachment',
      conversationId,
      attachmentId: attachment.id,
      fileId: attachment.fileId!,
      filename: attachment.filename
    })
  })
}

// Download missing attachments (delegates to main process)
async function downloadMissingAttachments(
  messages: Message[],
  conversationId: string,
  conversationTitle: string,
  cumulativeProgress?: { downloaded: number; total: number }
): Promise<void> {
  const attachmentsToDownload: Array<{ msg: Message; att: Attachment }> = []

  for (const msg of messages) {
    if (!msg.attachments || msg.attachments.length === 0) continue
    for (const att of msg.attachments) {
      if (att.localPath && fs.existsSync(att.localPath)) continue
      if (!att.fileId) continue
      attachmentsToDownload.push({ msg, att })
    }
  }

  if (attachmentsToDownload.length === 0) return

  for (const { att } of attachmentsToDownload) {
    checkCancelled()

    if (cumulativeProgress) {
      reportProgress({
        phase: 'downloading',
        current: cumulativeProgress.downloaded,
        total: cumulativeProgress.total,
        conversationTitle
      })
    }

    try {
      console.log(`[Export Worker] Requesting download for attachment ${att.fileId}...`)
      const localPath = await requestAttachmentDownload(conversationId, att)

      // Update the database with the new local path
      updateAttachmentLocalPath(att.id, localPath)

      // Update the in-memory attachment object
      att.localPath = localPath

      console.log(`[Export Worker] Attachment downloaded to ${localPath}`)
    } catch (error) {
      if ((error as Error).message === 'Export cancelled') {
        throw error
      }
      console.error(`[Export Worker] Failed to download attachment ${att.fileId}:`, error)
    }

    if (cumulativeProgress) {
      cumulativeProgress.downloaded++
    }
  }
}

// Export a single conversation
async function exportConversation(
  id: string,
  options: ExportOptions,
  cumulativeProgress?: { downloaded: number; total: number }
): Promise<string> {
  checkCancelled()

  const data = getConversationWithMessages(id)
  if (!data) {
    throw new Error(`Conversation not found: ${id}`)
  }

  // Download missing attachments if requested
  if (options.includeAttachments) {
    await downloadMissingAttachments(data.messages, id, data.conversation.title, cumulativeProgress)
  }

  checkCancelled()

  // Format and export
  if (options.format === 'markdown') {
    return exportToMarkdown(data.conversation, data.messages, options)
  } else {
    return exportToJson(data.conversation, data.messages, options)
  }
}

// Export all conversations
async function exportAllConversations(options: ExportOptions): Promise<string> {
  const conversations = listConversations({ limit: 10000 })
  const total = conversations.items.length
  let current = 0

  // Pre-count all attachments for cumulative progress
  let cumulativeProgress: { downloaded: number; total: number } | undefined
  if (options.includeAttachments) {
    reportProgress({
      phase: 'counting',
      current: 0,
      total: conversations.items.length,
      conversationTitle: undefined
    })

    let totalAttachments = 0
    for (let i = 0; i < conversations.items.length; i++) {
      checkCancelled()

      const conv = conversations.items[i]
      const data = getConversationWithMessages(conv.id)
      if (data) {
        totalAttachments += countMissingAttachments(data.messages)
      }
    }
    cumulativeProgress = { downloaded: 0, total: totalAttachments }
  }

  // Export each conversation
  for (let i = 0; i < conversations.items.length; i++) {
    const conv = conversations.items[i]
    checkCancelled()

    reportProgress({
      phase: 'exporting',
      current,
      total,
      conversationTitle: conv.title
    })

    await exportConversation(conv.id, options, cumulativeProgress)
    current++
  }

  // Report final progress
  reportProgress({
    phase: 'exporting',
    current: total,
    total,
    conversationTitle: undefined
  })

  return options.outputPath
}

// Handle incoming messages from main process
parentPort?.on('message', async (msg: WorkerInboundMessage) => {
  try {
    if (msg.type === 'cancel') {
      cancelled = true
      // Reject all pending attachment downloads
      for (const [, { reject }] of pendingAttachments) {
        reject(new Error('Export cancelled'))
      }
      pendingAttachments.clear()
      send({ type: 'cancelled' })
      return
    }

    if (msg.type === 'attachmentDownloaded') {
      const pending = pendingAttachments.get(msg.attachmentId)
      if (pending) {
        pending.resolve(msg.localPath)
        pendingAttachments.delete(msg.attachmentId)
      }
      return
    }

    if (msg.type === 'export') {
      const result = await exportConversation(msg.payload.conversationId, msg.payload.options)
      send({ type: 'complete', payload: { path: result } })
      return
    }

    if (msg.type === 'exportAll') {
      const result = await exportAllConversations(msg.payload.options)
      send({ type: 'complete', payload: { path: result } })
      return
    }
  } catch (error) {
    if ((error as Error).message === 'Export cancelled') {
      send({ type: 'cancelled' })
    } else {
      send({ type: 'error', payload: { message: (error as Error).message } })
    }
  }
})

// Signal ready
console.log('[Export Worker] Worker initialized with DB path:', dbPath)
