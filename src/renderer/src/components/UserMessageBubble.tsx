'use client'

import { memo, useState, useEffect } from 'react'
import type { Message, Attachment } from '../../../shared/types'
import { cn } from '@/lib/cn'
import { FileIcon, ArrowLineDownIcon } from '@phosphor-icons/react'

const FILE_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  pdf: { color: '#FA423E', label: 'PDF' },
  doc: { color: '#2B579A', label: 'Word' },
  docx: { color: '#2B579A', label: 'Word' },
  xls: { color: '#217346', label: 'Excel' },
  xlsx: { color: '#217346', label: 'Excel' },
  ppt: { color: '#D24726', label: 'PowerPoint' },
  pptx: { color: '#D24726', label: 'PowerPoint' },
  txt: { color: '#6B7280', label: 'Text' },
  csv: { color: '#217346', label: 'CSV' },
  json: { color: '#F59E0B', label: 'JSON' },
  zip: { color: '#8B5CF6', label: 'Archive' },
  rar: { color: '#8B5CF6', label: 'Archive' },
  default: { color: '#6B7280', label: 'File' }
}

function getFileTypeConfig(filename: string): { color: string; label: string } {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return FILE_TYPE_CONFIG[ext] || FILE_TYPE_CONFIG.default
}

interface UserMessageBubbleProps {
  message: Message
  conversationId: string
  downloadedPaths: Record<string, string>
  onDownloaded: (attachmentId: string, localPath: string) => void
}

export const UserMessageBubble = memo(function UserMessageBubble({
  message,
  conversationId,
  downloadedPaths,
  onDownloaded
}: UserMessageBubbleProps) {
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set())
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

  // Check which files actually exist on filesystem
  useEffect(() => {
    const checkFileExistence = async () => {
      const fileAtts = message.attachments?.filter((att) => att.type === 'file') || []
      const existing = new Set<string>()

      for (const att of fileAtts) {
        const localPath = att.localPath || downloadedPaths[att.id]
        if (localPath) {
          const exists = await window.api?.attachments.exists(localPath)
          if (exists) {
            existing.add(att.id)
          }
        }
      }

      setExistingFiles(existing)
    }

    checkFileExistence()
  }, [message.attachments, downloadedPaths])

  const getAttachmentUrl = (localPath: string): string => {
    const parts = localPath.split('/')
    const filename = parts.pop() || ''
    const convId = parts.pop() || ''
    return `attachment://${convId}/${encodeURIComponent(filename)}`
  }

  const getLocalPath = (att: Attachment): string | null => {
    return att.localPath || downloadedPaths[att.id] || null
  }

  const handleFileClick = async (att: Attachment) => {
    if (downloadingFiles.has(att.id)) return

    const localPath = getLocalPath(att)

    if (localPath && existingFiles.has(att.id)) {
      await window.api?.attachments.open(localPath)
      return
    }

    setDownloadingFiles((prev) => new Set(prev).add(att.id))
    try {
      const result = await window.api?.attachments.download(att.id, conversationId)
      if (result?.success && result.localPath) {
        onDownloaded(att.id, result.localPath)
        setExistingFiles((prev) => new Set(prev).add(att.id))
        await window.api?.attachments.open(result.localPath)
      }
    } finally {
      setDownloadingFiles((prev) => {
        const next = new Set(prev)
        next.delete(att.id)
        return next
      })
    }
  }

  const imageAttachments = message.attachments?.filter((att) => att.type === 'image') || []
  const fileAttachments = message.attachments?.filter((att) => att.type === 'file') || []

  const renderImageAttachments = () => {
    if (imageAttachments.length === 0) return null
    return (
      <div className="mb-3 flex flex-wrap gap-2 justify-end">
        {imageAttachments.map((att) => {
          const localPath = getLocalPath(att)
          const maxW = 400
          const maxH = 320
          const origW = att.width || 200
          const origH = att.height || 150
          const scale = Math.min(maxW / origW, maxH / origH, 1)
          const displayW = Math.round(origW * scale)
          const displayH = Math.round(origH * scale)

          return (
            <div
              key={att.id}
              className="relative overflow-hidden rounded-xl bg-b4"
              style={{ width: displayW, height: displayH }}
            >
              {localPath ? (
                <img
                  src={getAttachmentUrl(localPath)}
                  alt={att.filename || 'Attached image'}
                  width={displayW}
                  height={displayH}
                  className="w-full h-full object-cover rounded-xl"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                  <span className="text-xs text-f2">Loading...</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const renderFileAttachments = () => {
    if (fileAttachments.length === 0) return null
    return (
      <div className="flex gap-2 flex-wrap mt-1 max-w-[80%] justify-end">
        {fileAttachments.map((att) => {
          const isDownloading = downloadingFiles.has(att.id)
          const fileExists = existingFiles.has(att.id)
          const { color, label } = getFileTypeConfig(att.filename)
          const IconComponent = fileExists ? FileIcon : ArrowLineDownIcon

          return (
            <button
              key={att.id}
              onClick={() => handleFileClick(att)}
              disabled={isDownloading}
              className={cn(
                'text-left border border-b4 bg-b2 rounded-xl overflow-hidden w-72',
                !isDownloading && 'active:bg-b3',
                isDownloading && 'opacity-50'
              )}
            >
              <div className="p-2">
                <div className="flex flex-row items-center gap-2">
                  <div
                    className="flex items-center justify-center rounded-lg h-10 w-10 shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    <IconComponent className="h-5 w-5 text-white" />
                  </div>
                  <div className="overflow-hidden min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{att.filename}</div>
                    <div className="text-f3 truncate text-sm">
                      {isDownloading ? 'Downloading...' : label}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {renderImageAttachments()}
      {renderFileAttachments()}
      <div className="max-w-[80%] rounded-[1.125rem] rounded-tr-[0.5rem] px-4 py-1.5 bg-f1 text-b1">
        {message.parts.length > 0 && (
          <div className="prose prose-sm max-w-none prose-invert whitespace-pre-wrap">
            {message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}
          </div>
        )}
      </div>
    </div>
  )
})
