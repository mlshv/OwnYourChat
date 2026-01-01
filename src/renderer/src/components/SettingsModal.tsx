'use client'

import { ProvidersList } from './ProvidersList'
import { useState, useEffect } from 'react'
import { CopyIcon, CheckIcon } from '@phosphor-icons/react'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
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
    onClose()
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-b1 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-b3">
          <h2 className="text-lg font-semibold">Settings</h2>
        </div>

        {/* Body - Scrollable */}
        <div className="p-4 space-y-6 overflow-y-auto">
          {/* Connected Accounts Section */}
          <ProvidersList onConnect={handleConnect} />

          {/* MCP Server Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">MCP Server</h3>

            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-f2">Enable MCP Server</label>
              <button
                onClick={() => handleMcpEnabledChange(!mcpEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  mcpEnabled ? 'bg-f1' : 'bg-b3'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    mcpEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Port Input */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-f2">Port</label>
              <input
                type="number"
                value={mcpPort}
                onChange={(e) => handleMcpPortChange(parseInt(e.target.value) || 3000)}
                disabled={!mcpEnabled}
                className="w-24 px-2 py-1 text-sm bg-b2 border border-b3 rounded focus:outline-none focus:border-f2 disabled:opacity-50"
              />
            </div>

            {/* Status Indicator */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-f2">Status</span>
              <span className={`text-sm ${mcpEnabled ? 'text-green-500' : 'text-f3'}`}>
                {mcpEnabled ? 'Running' : 'Stopped'}
              </span>
            </div>

            {/* Configuration JSON */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-f2">Cursor Configuration</label>
                <button
                  onClick={handleCopyConfig}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-b2 hover:bg-b3 rounded transition-colors"
                >
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
                </button>
              </div>
              <pre className="text-xs bg-b2 border border-b3 rounded p-3 overflow-x-auto">
                {getMcpConfig()}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-b3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-f1 text-b1 rounded active:bg-f2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
