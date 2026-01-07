import fs from 'fs'
import path from 'path'
import type { Conversation, Message, ExportOptions } from '../../shared/types'
import { formatDate, sanitizeFilename } from './utils.js'

export async function exportToMarkdown(
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
  let hasAttachments = false

  if (options.includeAttachments) {
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

  // Build markdown content
  const lines: string[] = []

  // Header
  lines.push(`# ${conversation.title}`)
  lines.push('')
  // Two trailing spaces create a line break in markdown
  lines.push(`**Created:** ${formatDateTime(conversation.createdAt)}  `)
  lines.push(`**Last updated:** ${formatDateTime(conversation.updatedAt)}  `)
  lines.push(`**Exported:** ${formatDateTime(new Date())}`)
  lines.push('')

  // Messages
  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${roleLabel}`)
    lines.push('')

    // Reconstruct content from parts
    const content = msg.parts
      .map((part) => {
        if (part.type === 'text') {
          return part.text
        } else if (part.type === 'source-url') {
          // Include source as a markdown link
          return part.title ? `[${part.title}](${part.url})` : part.url
        }
        return ''
      })
      .join('')

    if (content) {
      lines.push(content)
      lines.push('')
    }

    // Handle attachments
    if (options.includeAttachments && msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        if (att.localPath && fs.existsSync(att.localPath)) {
          const destFilename = path.basename(att.localPath)
          const destPath = path.join(attachmentsFolder, destFilename)

          // Copy attachment
          fs.copyFileSync(att.localPath, destPath)

          // Add markdown reference
          if (att.type === 'image') {
            lines.push(`![${att.filename}](./attachments/${destFilename})`)
          } else {
            lines.push(`[${att.filename}](./attachments/${destFilename})`)
          }
          lines.push('')
        }
      }
    }
  }

  // Write file
  const filePath = path.join(folderPath, 'conversation.md')
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')

  return filePath
}

function formatDateTime(date: Date | null | undefined): string {
  if (!date) return 'Unknown'
  const d = new Date(date)
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
