'use client'

import { useState } from 'react'
import { useProvidersState } from '@/lib/store'
import { AI_PROVIDERS } from '@/constants'
import { Button } from '@/components/ui/button'

type ProvidersListProps = {
  showTitle?: boolean
  onConnect?: (accountId: 'chatgpt' | 'claude' | 'perplexity') => void
}

export function ProvidersList({ showTitle = true, onConnect }: ProvidersListProps) {
  // Get provider states from store
  const providersState = useProvidersState()
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

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

  const handleDisconnect = async (providerId: 'chatgpt' | 'claude' | 'perplexity') => {
    try {
      setDisconnecting(providerId)
      await window.api!.auth.logout(providerId)
    } catch (error) {
      console.error(`Failed to disconnect ${providerId}:`, error)
    } finally {
      setDisconnecting(null)
    }
  }

  return (
    <div>
      {showTitle && <h3 className="text-base font-medium mb-3">Connected Accounts</h3>}
      <div className="space-y-2">
        {accounts.map((account) => {
          const Icon = AI_PROVIDERS[account.id].icon
          const isDisconnecting = disconnecting === account.id
          return (
            <div
              key={account.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
            >
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">
                  <Icon size={24} />
                </div>
                <div className="text-sm font-medium">{account.name}</div>
              </div>
              {account.status === 'connected' && (
                <Button
                  onClick={() => handleDisconnect(account.id)}
                  size="xs"
                  variant="outline"
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              )}
              {account.status === 'disconnected' && (
                <Button onClick={() => handleConnect(account.id)} size="xs">
                  Connect
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
