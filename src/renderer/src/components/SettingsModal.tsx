'use client'

import { ProvidersList } from './ProvidersList'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const handleConnect = () => {
    // Close settings modal to show login view
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-b1 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="p-4 border-b border-b3">
          <h2 className="text-lg font-semibold">Settings</h2>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Connected Accounts Section */}
          <ProvidersList onConnect={handleConnect} />
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
