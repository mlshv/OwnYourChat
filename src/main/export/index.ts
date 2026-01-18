import fs from 'fs'
import type { ExportOptions, Message, ExportProgress } from '../../shared/types'
import * as db from '../db/operations.js'
import { exportToMarkdown } from './markdown.js'
import { exportToJson } from './json.js'
import type { IProvider } from '../sync/providers/base.js'

/**
 * Yield to the event loop to prevent blocking the main process.
 * Call this periodically in long-running loops with synchronous DB operations.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export type ProgressCallback = (progress: ExportProgress) => void

export interface ExportContext {
  provider: IProvider | null
  signal?: AbortSignal
  onProgress?: ProgressCallback
}

/**
 * Count missing attachments in messages that need to be downloaded.
 */
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

/**
 * Download any attachments that haven't been downloaded yet.
 * This ensures all attachments are available locally before export.
 *
 * @param cumulativeProgress - For batch exports, tracks progress across all conversations
 */
async function downloadMissingAttachments(
  messages: Message[],
  conversationId: string,
  conversationTitle: string,
  context: ExportContext | undefined,
  cumulativeProgress?: { downloaded: number; total: number }
): Promise<void> {
  // Can't download without provider
  if (!context?.provider) {
    console.log('[Export] No provider available, skipping attachment download')
    return
  }

  // Count total attachments to download
  const attachmentsToDownload: Array<{ msg: Message; att: NonNullable<Message['attachments']>[0] }> =
    []
  for (const msg of messages) {
    if (!msg.attachments || msg.attachments.length === 0) continue
    for (const att of msg.attachments) {
      // Skip if already downloaded and file exists
      if (att.localPath && fs.existsSync(att.localPath)) continue
      // Need fileId to download
      if (!att.fileId) {
        console.log(`[Export] Skipping attachment ${att.id}: no fileId`)
        continue
      }
      attachmentsToDownload.push({ msg, att })
    }
  }

  if (attachmentsToDownload.length === 0) return

  for (const { att } of attachmentsToDownload) {
    // Check for abort signal
    if (context.signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError')
    }

    // Report progress (use cumulative if available, otherwise per-conversation)
    if (cumulativeProgress) {
      context.onProgress?.({
        phase: 'downloading',
        current: cumulativeProgress.downloaded,
        total: cumulativeProgress.total,
        conversationTitle
      })
    }

    try {
      console.log(`[Export] Downloading attachment ${att.fileId}...`)
      const localPath = await context.provider.downloadAttachment(
        att.fileId!,
        att.filename,
        conversationId
      )

      // Update the database with the new local path
      await db.updateAttachmentLocalPath(att.id, localPath)

      // Update the in-memory attachment object so export uses it
      att.localPath = localPath

      console.log(`[Export] Downloaded attachment to ${localPath}`)
    } catch (error) {
      // Re-throw abort errors
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      // Log error but continue with other attachments
      console.error(`[Export] Failed to download attachment ${att.fileId}:`, error)
    }

    // Increment cumulative counter
    if (cumulativeProgress) {
      cumulativeProgress.downloaded++
    }
  }
}

export async function exportConversation(
  id: string,
  options: ExportOptions,
  context?: ExportContext,
  cumulativeProgress?: { downloaded: number; total: number }
): Promise<string> {
  // Check for abort signal
  if (context?.signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError')
  }

  const data = await db.getConversationWithMessages(id)
  if (!data) {
    throw new Error(`Conversation not found: ${id}`)
  }

  // Download missing attachments if requested
  if (options.includeAttachments) {
    await downloadMissingAttachments(
      data.messages,
      id,
      data.conversation.title,
      context,
      cumulativeProgress
    )
  }

  // Check for abort signal before export
  if (context?.signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError')
  }

  if (options.format === 'markdown') {
    return exportToMarkdown(data.conversation, data.messages, options)
  } else {
    return exportToJson(data.conversation, data.messages, options)
  }
}

export async function exportAllConversations(
  options: ExportOptions,
  context?: ExportContext
): Promise<string> {
  const conversations = await db.listConversations({ limit: 10000 })

  const total = conversations.items.length
  let current = 0

  // Pre-count all attachments to download for cumulative progress tracking
  let cumulativeProgress: { downloaded: number; total: number } | undefined
  if (options.includeAttachments) {
    // Report counting phase
    context?.onProgress?.({
      phase: 'counting',
      current: 0,
      total: conversations.items.length,
      conversationTitle: undefined
    })

    let totalAttachments = 0
    for (let i = 0; i < conversations.items.length; i++) {
      const conv = conversations.items[i]

      // Yield to event loop every 10 iterations to keep UI responsive
      if (i % 10 === 0) {
        await yieldToEventLoop()
      }

      // Check for abort signal during counting
      if (context?.signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError')
      }

      const data = await db.getConversationWithMessages(conv.id)
      if (data) {
        totalAttachments += countMissingAttachments(data.messages)
      }
    }
    cumulativeProgress = { downloaded: 0, total: totalAttachments }
  }

  for (let i = 0; i < conversations.items.length; i++) {
    const conv = conversations.items[i]

    // Yield to event loop every 5 iterations to keep UI responsive
    if (i % 5 === 0) {
      await yieldToEventLoop()
    }

    // Check for abort signal
    if (context?.signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError')
    }

    // Report progress
    context?.onProgress?.({
      phase: 'exporting',
      current,
      total,
      conversationTitle: conv.title
    })

    await exportConversation(conv.id, options, context, cumulativeProgress)
    current++
  }

  // Report final progress
  context?.onProgress?.({
    phase: 'exporting',
    current: total,
    total,
    conversationTitle: undefined
  })

  return options.outputPath
}
