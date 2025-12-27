import fs from 'fs'
import path from 'path'
import { getAttachmentsPath } from '../settings.js'

/**
 * Find an existing cached file by fileId in the conversation's attachments folder.
 * Files are named: {fileId}_{filename}.{ext}
 */
export function findCachedFile(conversationId: string, fileId: string): string | null {
  const attachmentsPath = getAttachmentsPath()
  const conversationDir = path.join(attachmentsPath, conversationId)

  if (!fs.existsSync(conversationDir)) {
    return null
  }

  // Look for files starting with the fileId
  const files = fs.readdirSync(conversationDir)
  const match = files.find((f) => f.startsWith(fileId + '_'))

  if (match) {
    const fullPath = path.join(conversationDir, match)
    // Verify file exists and has content
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0) {
      return fullPath
    }
  }

  return null
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json'
  }
  return mimeToExt[mimeType] || '.bin'
}
