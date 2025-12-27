'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'

interface ExportModalProps {
  conversationId?: string
  onClose: () => void
}

export function ExportModal({ conversationId, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown')
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [exportAll, setExportAll] = useState(!conversationId)
  const [isExporting, setIsExporting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleExport = async () => {
    const api = window.api
    if (!api) return

    setIsExporting(true)
    setResult(null)

    try {
      let response
      if (exportAll) {
        response = await api.export.all({
          format,
          includeAttachments,
          outputPath: '' // Will prompt for directory
        })
      } else if (conversationId) {
        response = await api.export.conversation(conversationId, {
          format,
          includeAttachments,
          outputPath: '' // Will prompt for directory
        })
      }

      if (response?.success) {
        setResult({
          success: true,
          message: `Exported to ${response.path}`
        })
      } else {
        setResult({
          success: false,
          message: response?.error || 'Export failed'
        })
      }
    } catch (error) {
      setResult({
        success: false,
        message: (error as Error).message
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-b1 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="p-4 border-b border-b3">
          <h2 className="text-lg font-semibold">Export Conversations</h2>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Export scope */}
          <div>
            <label className="block text-sm font-medium mb-2">Export</label>
            <div className="space-y-2">
              {conversationId && (
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={!exportAll}
                    onChange={() => setExportAll(false)}
                    className="accent-f1"
                  />
                  <span className="text-sm">Current conversation</span>
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={exportAll}
                  onChange={() => setExportAll(true)}
                  className="accent-f1"
                />
                <span className="text-sm">All conversations</span>
              </label>
            </div>
          </div>

          {/* Format */}
          <div>
            <label className="block text-sm font-medium mb-2">Format</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={format === 'markdown'}
                  onChange={() => setFormat('markdown')}
                  className="accent-f1"
                />
                <span className="text-sm">Markdown</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={format === 'json'}
                  onChange={() => setFormat('json')}
                  className="accent-f1"
                />
                <span className="text-sm">JSON</span>
              </label>
            </div>
          </div>

          {/* Options */}
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeAttachments}
                onChange={(e) => setIncludeAttachments(e.target.checked)}
                className="accent-f1 rounded"
              />
              <span className="text-sm">Include attachments</span>
            </label>
          </div>

          {/* Result message */}
          {result && (
            <div
              className={cn(
                'p-3 rounded text-sm',
                result.success ? 'bg-b3 text-f1' : 'bg-b3 text-f1'
              )}
            >
              {result.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-b3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-f2 active:bg-b2 rounded">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 text-sm bg-f1 text-b1 rounded active:bg-f2 disabled:opacity-50"
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
