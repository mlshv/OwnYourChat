'use client'

import { ProvidersList } from './ProvidersList'
import { useState, useEffect } from 'react'
import { CopyIcon, CheckIcon } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SettingsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpPort, setMcpPort] = useState(3000)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Load settings on mount
    window.api.settings.get().then((settings) => {
      setMcpEnabled(settings.mcpEnabled)
      setMcpPort(settings.mcpPort)
    })
  }, [])

  const handleConnect = () => {
    // Close settings modal to show login view
    onOpenChange(false)
  }

  const handleMcpEnabledChange = async (enabled: boolean) => {
    setMcpEnabled(enabled)
    await window.api.settings.set({ mcpEnabled: enabled })
  }

  const handleMcpPortChange = async (port: number) => {
    setMcpPort(port)
    await window.api.settings.set({ mcpPort: port })
  }

  const getMcpConfig = () => {
    return JSON.stringify(
      {
        mcpServers: {
          ownyourchat: {
            url: `http://localhost:${mcpPort}/mcp`
          }
        }
      },
      null,
      2
    )
  }

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(getMcpConfig())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <div className="p-4">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
        </div>

        <div className="space-y-6 overflow-y-auto max-h-[60vh] px-4 py-4 pr-3">
          {/* Connected Accounts Section */}
          <ProvidersList onConnect={handleConnect} />

          {/* MCP Server Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">MCP Server</h3>

            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="mcp-enabled">Enable MCP Server</Label>
              <Switch id="mcp-enabled" checked={mcpEnabled} onCheckedChange={handleMcpEnabledChange} />
            </div>

            {mcpEnabled && (
              <>
                {/* Port Input */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="mcp-port">Port</Label>
                  <Input
                    id="mcp-port"
                    type="number"
                    value={mcpPort}
                    onChange={(e) => handleMcpPortChange(parseInt(e.target.value) || 3000)}
                    className="w-24"
                  />
                </div>

                {/* Status Indicator */}
                <div className="flex items-center justify-between">
                  <Label>Status</Label>
                  <span className="text-sm text-green-500">Running</span>
                </div>

                {/* Configuration JSON */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>JSON Configuration</Label>
                    <Button onClick={handleCopyConfig} variant="outline" size="xs">
                      {copied ? (
                        <>
                          <CheckIcon size={14} />
                          Copied
                        </>
                      ) : (
                        <>
                          <CopyIcon size={14} />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <pre className="text-xs bg-muted border border-border rounded p-3 overflow-x-auto">
                    {getMcpConfig()}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
