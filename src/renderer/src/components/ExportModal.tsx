'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/cn'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon } from '@hugeicons/core-free-icons'

interface ExportModalProps {
  conversationId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExportModal({ conversationId, open, onOpenChange }: ExportModalProps) {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown')
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [exportAll, setExportAll] = useState(!conversationId)
  const [isExporting, setIsExporting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!open) {
      setResult(null)
    }
  }, [open])

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <div className="p-4">
          <DialogHeader />
        </div>

        <div className="space-y-6 px-4 pb-4">
          {/* Export scope */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Export</Label>
            <RadioGroup
              value={exportAll ? 'all' : 'current'}
              onValueChange={(value) => setExportAll(value === 'all')}
            >
              {conversationId && (
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="current" id="current" />
                  <Label htmlFor="current" className="font-normal">
                    Current conversation
                  </Label>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="all" />
                <Label htmlFor="all" className="font-normal">
                  All conversations
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Format */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) => setFormat(value as 'markdown' | 'json')}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="markdown" id="markdown" />
                <Label htmlFor="markdown" className="font-normal">
                  Markdown
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="json" id="json" />
                <Label htmlFor="json" className="font-normal">
                  JSON
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="attachments"
                checked={includeAttachments}
                onCheckedChange={(checked) => setIncludeAttachments(checked as boolean)}
              />
              <Label htmlFor="attachments" className="font-normal">
                Include attachments
              </Label>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Including attachments will slow down export as all files need to be downloaded from
              exported chats.
            </p>
          </div>

          {/* Result message */}
          {result && (
            <div
              className={cn(
                'p-3 rounded-lg text-sm flex gap-2 border',
                result.success
                  ? 'bg-accent text-foreground border-border'
                  : 'bg-destructive/10 text-destructive border-destructive/20'
              )}
            >
              {result.success && (
                <HugeiconsIcon icon={Tick02Icon} className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              {result.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
