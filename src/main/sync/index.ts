import type { SyncStatus } from '../../shared/types'
import { providerRegistry } from './providers/registry.js'

export type SyncProvider = 'chatgpt' | 'claude'

export function getSyncStatus(): SyncStatus {
  // Aggregate status from all providers
  const states = providerRegistry.getAllStates()
  const anySyncing = states.some((s) => s.isSyncing)
  const latestSync =
    states
      .filter((s) => s.lastSyncAt)
      .sort((a, b) => (b.lastSyncAt?.getTime() || 0) - (a.lastSyncAt?.getTime() || 0))[0]
      ?.lastSyncAt || null
  const firstError = states.find((s) => s.errorMessage)?.errorMessage || null

  return {
    isRunning: anySyncing,
    lastSyncAt: latestSync,
    conversationCount: 0, // Will be populated from DB if needed
    error: firstError
  }
}

// Legacy sync functions - delegate to provider registry
export async function startSync(
  provider?: SyncProvider
): Promise<{ success: boolean; error?: string; newChatsFound?: number }> {
  if (!provider) {
    // Sync all providers
    const result = await providerRegistry.syncAll()
    const totalChats = result.results.reduce((sum, r) => sum + (r.newChatsFound || 0), 0)
    return {
      success: result.success,
      error: result.success
        ? undefined
        : result.results
            .map((r) => r.error)
            .filter(Boolean)
            .join('; '),
      newChatsFound: totalChats
    }
  }

  // Sync specific provider
  const providerInstance = providerRegistry.getProvider(provider)
  if (!providerInstance) {
    return { success: false, error: `Provider ${provider} not found` }
  }

  return providerInstance.sync()
}

export function stopSync(): { success: boolean } {
  // Note: Stopping sync is now handled per-provider
  // This function is kept for backward compatibility
  return { success: true }
}
