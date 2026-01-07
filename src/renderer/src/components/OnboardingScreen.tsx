'use client'

import { useProvidersState } from '@/lib/store'
import { ProvidersList } from './ProvidersList'
import { Button } from './ui/button'

interface OnboardingScreenProps {
  onComplete: () => void
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  // Subscribe directly to global provider state
  const providersState = useProvidersState()

  // Derive connection status from global state
  const hasAnyConnected = Object.values(providersState).some((provider) => provider.isOnline)

  return (
    <div className="fixed inset-0 bg-background z-50 overflow-y-auto">
      <div className="w-full max-w-md px-4 mx-auto py-12">
        {/* Header */}
        <p className="text-foreground mb-4">Connect your AI accounts</p>

        {/* Providers */}
        <div className="mb-6">
          <ProvidersList showTitle={false} />
        </div>

        {/* Continue button */}
        <div>
          <Button
            onClick={onComplete}
            disabled={!hasAnyConnected}
            className="w-full"
            size="lg"
          >
            {hasAnyConnected ? 'Continue' : 'Connect at least one provider to continue'}
          </Button>

          <div className="text-center mt-4">
            <p className="text-muted-foreground text-xs">
              Data is stored on your own computer and never shared with anyone
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
