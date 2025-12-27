'use client'

import { useProvidersState } from '@/lib/store'
import { ProvidersList } from './ProvidersList'

interface OnboardingScreenProps {
  onComplete: () => void
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  // Subscribe directly to global provider state
  const providersState = useProvidersState()

  // Derive connection status from global state
  const hasAnyConnected = Object.values(providersState).some((provider) => provider.isOnline)

  return (
    <div className="fixed inset-0 bg-b1 z-50 overflow-y-auto">
      <div className="w-full max-w-md px-4 mx-auto py-12">
        {/* Header */}
        <p className="text-f1 mb-4">Connect your AI accounts</p>

        {/* Providers */}
        <div className="mb-6">
          <ProvidersList showTitle={false} />
        </div>

        {/* Continue button */}
        <div>
          <button
            onClick={onComplete}
            disabled={!hasAnyConnected}
            className="w-full px-6 py-3 bg-f1 text-b1 rounded-lg font-medium active:bg-f2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hasAnyConnected ? 'Continue' : 'Connect at least one provider to continue'}
          </button>

          <div className="text-center mt-4">
            <p className="text-f2 text-xs">
              Data is stored on your own computer and never shared with anyone
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
