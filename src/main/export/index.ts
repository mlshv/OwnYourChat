import fs from 'fs'
import type { ExportOptions, Message } from '../../shared/types'
import * as db from '../db/operations.js'
import { exportToMarkdown } from './markdown.js'
import { exportToJson } from './json.js'
import type { IProvider } from '../sync/providers/base.js'

export interface ExportContext {
  provider: IProvider | null
}

/**
 * Download any attachments that haven't been downloaded yet.
 * This ensures all attachments are available locally before export.
 */
async function downloadMissingAttachments(
  messages: Message[],
  conversationId: string,
  context: ExportContext | undefined
): Promise<void> {
  // Can't download without provider
  if (!context?.provider) {
    console.log('[Export] No provider available, skipping attachment download')
    return
  }

  for (const msg of messages) {
    if (!msg.attachments || msg.attachments.length === 0) continue

    for (const att of msg.attachments) {
      // Skip if already downloaded and file exists
      if (att.localPath && fs.existsSync(att.localPath)) {
        continue
      }

      // Need fileId to download
      if (!att.fileId) {
        console.log(`[Export] Skipping attachment ${att.id}: no fileId`)
        continue
      }

      try {
        console.log(`[Export] Downloading attachment ${att.fileId}...`)
        const localPath = await context.provider.downloadAttachment(
          att.fileId,
          att.filename,
          conversationId
        )

        // Update the database with the new local path
        await db.updateAttachmentLocalPath(att.id, localPath)

        // Update the in-memory attachment object so export uses it
        att.localPath = localPath

        console.log(`[Export] Downloaded attachment to ${localPath}`)
      } catch (error) {
        // Log error but continue with other attachments
        console.error(`[Export] Failed to download attachment ${att.fileId}:`, error)
      }
    }
  }
}

export async function exportConversation(
  id: string,
  options: ExportOptions,
  context?: ExportContext
): Promise<string> {
  const data = await db.getConversationWithMessages(id)
  if (!data) {
    throw new Error(`Conversation not found: ${id}`)
  }

  // Download missing attachments if requested
  if (options.includeAttachments) {
    await downloadMissingAttachments(data.messages, id, context)
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

  for (const conv of conversations.items) {
    await exportConversation(conv.id, options, context)
  }

  return options.outputPath
}
