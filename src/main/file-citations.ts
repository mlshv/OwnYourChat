import path from 'node:path'
import type { MessagePart } from '../shared/types'
import { isWebSourceUrl } from '../shared/citations'

interface CitationDependencies {
  loadMessage: (id: string) => Promise<{
    conversationId: string
    provider: string
    parts: MessagePart[]
  } | null>
  downloadFile: (fileId: string, filename: string, conversationId: string) => Promise<string>
  openPath: (localPath: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
}

// Resolve the reference from saved message data, never from a renderer-supplied path or URL.
export async function openFileCitation(
  messageId: string,
  marker: string,
  deps: CitationDependencies
): Promise<{ success: boolean; error?: string }> {
  try {
    const message = await deps.loadMessage(messageId)
    if (!message || message.provider !== 'chatgpt') throw new Error('Source message not found')
    const reference = message.parts
      .flatMap((part) =>
        part.type === 'text' && part.text.includes(marker) ? part.fileCitations || [] : []
      )
      .find((ref) => ref.marker === marker)
    if (!reference) throw new Error('File reference not saved. Refresh this conversation first.')

    if (reference.fileId && /^file[_-][a-zA-Z0-9_-]+$/.test(reference.fileId)) {
      const filename = path.basename(reference.filename || 'attachment').replace(/[\\/]/g, '_')
      const localPath = await deps.downloadFile(reference.fileId, filename, message.conversationId)
      const error = await deps.openPath(localPath)
      if (error) throw new Error(error)
    } else if (isWebSourceUrl(reference.url)) {
      await deps.openExternal(reference.url)
    } else {
      throw new Error('The original file is unavailable')
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not open file' }
  }
}
