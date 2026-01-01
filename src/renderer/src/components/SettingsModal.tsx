'use client'

import { ProvidersList } from './ProvidersList'
import { useState, useEffect } from 'react'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState({
    hindsightEnabled: false,
    hindsightServerUrl: 'http://localhost:8888',
    hindsightBankId: 'ownyourchat',
    hindsightAutoIndex: true
  })
  const [hindsightStatus, setHindsightStatus] = useState({
    connected: false,
    enabled: false
  })
  const [isIndexing, setIsIndexing] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      const currentSettings = await window.api.settings.get()
      setSettings({
        hindsightEnabled: currentSettings.hindsightEnabled,
        hindsightServerUrl: currentSettings.hindsightServerUrl,
        hindsightBankId: currentSettings.hindsightBankId,
        hindsightAutoIndex: currentSettings.hindsightAutoIndex
      })

      const status = await window.api.hindsight.getStatus()
      setHindsightStatus(status)
    }
    loadSettings()
  }, [])

  const handleConnect = () => {
    // Close settings modal to show login view
    onClose()
  }

  const handleSaveHindsightSettings = async () => {
    await window.api.settings.set(settings)
    const status = await window.api.hindsight.getStatus()
    setHindsightStatus(status)
  }

  const handleIndexAll = async () => {
    setIsIndexing(true)
    try {
      const result = await window.api.hindsight.indexAll()
      if (result.success) {
        alert(`Successfully indexed ${result.indexed} conversations`)
      } else {
        alert(`Failed to index: ${result.error}`)
      }
    } catch (error) {
      alert(`Error: ${error}`)
    } finally {
      setIsIndexing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-b1 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-b3">
          <h2 className="text-lg font-semibold">Settings</h2>
        </div>

        {/* Body */}
        <div className="p-4 space-y-6">
          {/* Connected Accounts Section */}
          <ProvidersList onConnect={handleConnect} />

          {/* Hindsight Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-f1">Hindsight Memory</h3>
            <div className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.hindsightEnabled}
                  onChange={(e) =>
                    setSettings({ ...settings, hindsightEnabled: e.target.checked })
                  }
                  className="rounded"
                />
                <span>Enable Hindsight integration</span>
              </label>

              {settings.hindsightEnabled && (
                <>
                  <div>
                    <label className="block text-f2 mb-1">Server URL</label>
                    <input
                      type="text"
                      value={settings.hindsightServerUrl}
                      onChange={(e) =>
                        setSettings({ ...settings, hindsightServerUrl: e.target.value })
                      }
                      className="w-full px-2 py-1 bg-b2 border border-b3 rounded text-f1"
                      placeholder="http://localhost:8888"
                    />
                  </div>

                  <div>
                    <label className="block text-f2 mb-1">Bank ID</label>
                    <input
                      type="text"
                      value={settings.hindsightBankId}
                      onChange={(e) =>
                        setSettings({ ...settings, hindsightBankId: e.target.value })
                      }
                      className="w-full px-2 py-1 bg-b2 border border-b3 rounded text-f1"
                      placeholder="ownyourchat"
                    />
                  </div>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.hindsightAutoIndex}
                      onChange={(e) =>
                        setSettings({ ...settings, hindsightAutoIndex: e.target.checked })
                      }
                      className="rounded"
                    />
                    <span>Auto-index after sync</span>
                  </label>

                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveHindsightSettings}
                      className="px-3 py-1 text-sm bg-f1 text-b1 rounded active:bg-f2"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleIndexAll}
                      disabled={isIndexing || !hindsightStatus.connected}
                      className="px-3 py-1 text-sm bg-b2 border border-b3 rounded active:bg-b3 disabled:opacity-50"
                    >
                      {isIndexing ? 'Indexing...' : 'Index All Chats'}
                    </button>
                  </div>

                  <div className="text-xs text-f2">
                    Status:{' '}
                    <span
                      className={hindsightStatus.connected ? 'text-green-500' : 'text-red-500'}
                    >
                      {hindsightStatus.connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </>
              )}
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
