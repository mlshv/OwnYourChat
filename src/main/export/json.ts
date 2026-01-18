import fs from 'fs'
import path from 'path'
import type {
  Conversation,
  Message,
  ExportOptions,
  MessagePart,
  SourceUrlPart
} from '../../shared/types'
import { formatDate, sanitizeFilename } from './utils.js'

/**
 * Flatten message parts to a single content string.
 * Extracts text parts and concatenates them.
 */
function flattenPartsToContent(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/**
 * Extract source URLs from message parts.
 * Returns an array of { title?, url } objects.
 */
function extractSources(parts: MessagePart[]): Array<{ title?: string; url: string }> {
  return parts
    .filter((part): part is SourceUrlPart => part.type === 'source-url')
    .map((part) => ({
      ...(part.title && { title: part.title }),
      url: part.url
    }))
}

/**
 * Convert a Date to Unix timestamp (seconds since epoch).
 */
function toUnixTimestamp(date: Date | undefined | null): number | null {
  if (!date) return null
  return Math.floor(date.getTime() / 1000)
}

export async function exportToJson(
  conversation: Conversation,
  messages: Message[],
  options: ExportOptions
): Promise<string> {
  // Create conversation folder
  const safeTitle = sanitizeFilename(conversation.title)
  const folderName = options.prefixTimestamp
    ? `${formatDate(conversation.createdAt)} ${safeTitle}`
    : safeTitle
  const folderPath = path.join(options.outputPath, folderName)

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true })
  }

  // Create attachments folder if needed
  const attachmentsFolder = path.join(folderPath, 'attachments')

  if (options.includeAttachments) {
    let hasAttachments = false
    for (const msg of messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        hasAttachments = true
        break
      }
    }

    if (hasAttachments && !fs.existsSync(attachmentsFolder)) {
      fs.mkdirSync(attachmentsFolder, { recursive: true })
    }
  }

  // Build JSON structure with processed messages in OpenAI-compatible format
  const processedMessages = messages.map((msg) => {
    // Extract sources from message parts
    const sources = extractSources(msg.parts)

    // Process attachments if enabled
    const processedAttachments: Array<{
      type: string
      filename: string
      local_path: string
      original_url: string
    }> = []

    if (options.includeAttachments && msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        if (att.localPath && fs.existsSync(att.localPath)) {
          const destFilename = path.basename(att.localPath)
          const destPath = path.join(attachmentsFolder, destFilename)

          // Copy attachment
          fs.copyFileSync(att.localPath, destPath)

          processedAttachments.push({
            type: att.type,
            filename: att.filename,
            local_path: `./attachments/${destFilename}`,
            original_url: att.originalUrl
          })
        }
      }
    }

    // Build message object in OpenAI-compatible format
    const messageObj: Record<string, unknown> = {
      id: msg.id,
      role: msg.role,
      content: flattenPartsToContent(msg.parts),
      created_at: toUnixTimestamp(msg.createdAt),
      parent_id: msg.parentId
    }

    // Only include sources if there are any
    if (sources.length > 0) {
      messageObj.sources = sources
    }

    // Only include attachments if there are any
    if (processedAttachments.length > 0) {
      messageObj.attachments = processedAttachments
    }

    return messageObj
  })

  // Build export data in OpenAI-compatible format
  const exportData = {
    id: conversation.id,
    title: conversation.title,
    provider: conversation.provider,
    created_at: toUnixTimestamp(conversation.createdAt),
    updated_at: toUnixTimestamp(conversation.updatedAt),
    exported_at: new Date().toISOString(),
    message_count: messages.length,
    messages: processedMessages
  }

  // Write file
  const filePath = path.join(folderPath, 'conversation.json')
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8')

  return filePath
}
