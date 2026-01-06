'use client'

import { useProvidersState } from '@/lib/store'
import { AI_PROVIDERS } from '@/constants'

interface ProvidersListProps {
  showTitle?: boolean
  onConnect?: (accountId: 'chatgpt' | 'claude' | 'perplexity') => void
}

export function ProvidersList({ showTitle = true, onConnect }: ProvidersListProps) {
  // Get provider states from store
  const providersState = useProvidersState()

  // Build accounts list from store state
  const accounts = Object.values(AI_PROVIDERS).map((provider) => ({
    id: provider.id,
    name: provider.name,
    status: providersState[provider.id].isOnline ? 'connected' : 'disconnected',
    icon: provider.icon
  }))

  const handleConnect = async (providerId: 'chatgpt' | 'claude' | 'perplexity') => {
    try {
      await window.api!.auth.login(providerId)

      // Call optional callback
      if (onConnect) {
        onConnect(providerId)
      }
    } catch (error) {
      console.error(`Failed to initiate ${providerId} login:`, error)
    }
  }

  return (
    <div>
      {showTitle && <h3 className="text-sm font-medium mb-3">Connected Accounts</h3>}
      <div className="space-y-2">
        {accounts.map((account) => {
          const Icon = AI_PROVIDERS[account.id].icon
          return (
            <div
              key={account.id}
              className="flex items-center justify-between p-3 rounded-lg bg-b2 border border-b3"
            >
              <div className="flex items-center gap-3">
                <div className="text-xs text-f2">
                  <Icon size={24} />
                </div>
                <div className="text-sm font-medium">{account.name}</div>
              </div>
              {account.status === 'connected' && (
                <div className="text-xs text-f2 bg-b3 px-2 py-1 rounded">Connected</div>
              )}
              {account.status === 'disconnected' && (
                <button
                  onClick={() => handleConnect(account.id)}
                  className="text-xs bg-f1 text-b1 px-3 py-1 rounded active:bg-f2"
                >
                  Connect
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
