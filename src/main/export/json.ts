import fs from 'fs'
import path from 'path'
import type { Conversation, Message, ExportOptions } from '../../shared/types'
import { formatDate, sanitizeFilename } from './utils.js'

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

  // Build JSON structure with processed messages
  const processedMessages = messages.map((msg) => {
    const processedAttachments: Array<{
      type: string
      filename: string
      localPath: string
      originalUrl: string
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
            localPath: `./attachments/${destFilename}`,
            originalUrl: att.originalUrl
          })
        }
      }
    }

    return {
      id: msg.id,
      role: msg.role,
      parts: msg.parts,
      createdAt: msg.createdAt?.toISOString(),
      orderIndex: msg.orderIndex,
      attachments: processedAttachments.length > 0 ? processedAttachments : undefined
    }
  })

  const exportData = {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt?.toISOString(),
    updatedAt: conversation.updatedAt?.toISOString(),
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: processedMessages
  }

  // Write file
  const filePath = path.join(folderPath, 'conversation.json')
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8')

  return filePath
}

