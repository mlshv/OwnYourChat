'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/cn'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon, Folder01Icon } from '@hugeicons/core-free-icons'
import type { ExportSettings, ExportProgress } from '@shared/types'

interface ExportModalProps {
  conversationId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  preferredScope?: 'current' | 'all'
}

export function ExportModal({
  conversationId,
  open,
  onOpenChange,
  preferredScope
}: ExportModalProps) {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown')
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [prefixTimestamp, setPrefixTimestamp] = useState(false)
  const [outputPath, setOutputPath] = useState('')
  const [exportAll, setExportAll] = useState(!conversationId)
  const [isExporting, setIsExporting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true)
  const [progress, setProgress] = useState<ExportProgress | null>(null)

  // Load settings from preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      const api = window.api
      if (!api) return

      try {
        const prefs = await api.userPreferences.get()
        if (prefs.exportSettings) {
          setFormat(prefs.exportSettings.format)
          setIncludeAttachments(prefs.exportSettings.includeAttachments)
          setPrefixTimestamp(prefs.exportSettings.prefixTimestamp)
          setOutputPath(prefs.exportSettings.outputPath)
        }
      } catch (error) {
        console.error('Failed to load export settings:', error)
      } finally {
        setIsLoadingPrefs(false)
      }
    }

    if (open) {
      loadPreferences()
    }
  }, [open])

  useEffect(() => {
    if (!open || !preferredScope) return
    if (preferredScope === 'all') {
      setExportAll(true)
      return
    }
    if (conversationId) {
      setExportAll(false)
    }
  }, [open, preferredScope, conversationId])

  // Subscribe to progress events
  useEffect(() => {
    const api = window.api
    if (!api) return

    const unsubscribe = api.export.onProgress((progressData) => {
      setProgress(progressData)
    })

    return unsubscribe
  }, [])

  // Save settings to preferences (debounced)
  const saveSettings = useCallback(async (settings: ExportSettings) => {
    const api = window.api
    if (!api) return

    try {
      await api.userPreferences.set({ exportSettings: settings })
    } catch (error) {
      console.error('Failed to save export settings:', error)
    }
  }, [])

  // Save settings whenever they change (debounced)
  useEffect(() => {
    if (isLoadingPrefs) return

    const timeoutId = setTimeout(() => {
      saveSettings({
        format,
        includeAttachments,
        prefixTimestamp,
        outputPath
      })
    }, 500)

    return () => clearTimeout(timeoutId)
  }, [format, includeAttachments, prefixTimestamp, outputPath, saveSettings, isLoadingPrefs])

  // Reset result and progress when modal closes
  useEffect(() => {
    if (!open) {
      setResult(null)
      setProgress(null)
    }
  }, [open])

  const handlePickFolder = async () => {
    const api = window.api
    if (!api) return

    const path = await api.dialog.pickFolder()
    if (path) {
      setOutputPath(path)
    }
  }

  const handleExport = async () => {
    const api = window.api
    if (!api || !outputPath) return

    setIsExporting(true)
    setResult(null)
    setProgress(null)

    try {
      let response: { success: boolean; path?: string; error?: string } | undefined
      if (exportAll) {
        response = await api.export.all({
          format,
          includeAttachments,
          prefixTimestamp,
          outputPath
        })
      } else if (conversationId) {
        response = await api.export.conversation(conversationId, {
          format,
          includeAttachments,
          prefixTimestamp,
          outputPath
        })
      }

      if (response?.success) {
        setResult({
          success: true,
          message: 'Exported successfully'
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
      setProgress(null)
    }
  }

  const handleCancel = async () => {
    if (isExporting) {
      const api = window.api
      if (api) {
        await api.export.cancel()
      }
    } else {
      onOpenChange(false)
    }
  }

  // Truncate path for display
  const displayPath = (path: string) => {
    if (path.length <= 40) return path
    return '...' + path.slice(-37)
  }

  // Calculate progress percentage
  const progressPercent =
    progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  // Get phase label
  const getPhaseLabel = () => {
    if (!progress) return ''
    if (progress.phase === 'counting') return 'Preparing export...'
    if (progress.phase === 'downloading') return 'Downloading attachments...'
    return 'Exporting conversations...'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <div className="p-4">
          <DialogHeader>
            <DialogTitle>Export conversations</DialogTitle>
          </DialogHeader>
        </div>

        <div className="space-y-6 overflow-y-auto max-h-[60vh] px-4 py-2 pb-6 pr-3">
          {/* Progress UI during export */}
          {isExporting && progress && (
            <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-border">
              <div className="text-sm font-medium">{getPhaseLabel()}</div>
              <Progress value={progressPercent} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {progress.current} / {progress.total}
                </span>
                {progress.conversationTitle && (
                  <span className="truncate max-w-[200px]">{progress.conversationTitle}</span>
                )}
              </div>
            </div>
          )}

          {/* Export scope */}
          {!isExporting && (
            <>
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

              {/* Export folder */}
              <div className="space-y-3">
                <Label className="text-base font-medium">Export folder</Label>
                <Button
                  variant="outline"
                  className="w-full justify-start font-normal text-sm h-auto py-2 px-3"
                  onClick={handlePickFolder}
                >
                  <HugeiconsIcon icon={Folder01Icon} className="w-4 h-4 mr-2 flex-shrink-0" />
                  <span className="truncate">
                    {outputPath ? displayPath(outputPath) : 'Select folder'}
                  </span>
                </Button>
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
              <div className="space-y-3">
                <div className="space-y-1">
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
                    Including attachments will slow down export as all files need to be downloaded
                    from exported chats.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="timestamp"
                      checked={prefixTimestamp}
                      onCheckedChange={(checked) => setPrefixTimestamp(checked as boolean)}
                    />
                    <Label htmlFor="timestamp" className="font-normal">
                      Prefix with date
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground pl-6">
                    Adds date prefix to folder names (e.g., &quot;2026-01-07 My Conversation&quot;)
                    for easier file sorting.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Result message */}
          {result && (
            <div
              className={cn(
                'p-3 rounded-lg text-sm flex gap-2 border',
                result.success
                  ? 'bg-muted/50 text-foreground border-border'
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
          <Button variant="outline" onClick={handleCancel}>
            {isExporting ? 'Cancel Export' : 'Cancel'}
          </Button>
          {!isExporting && (
            <Button onClick={handleExport} disabled={isExporting || !outputPath}>
              Export
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
