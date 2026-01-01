import type { SyncStatus } from '../../shared/types'
import { providerRegistry } from './providers/registry.js'
import { getSettings } from '../settings.js'
import { indexAllConversations } from '../hindsight/indexer.js'

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
  let result

  if (!provider) {
    // Sync all providers
    const syncResult = await providerRegistry.syncAll()
    const totalChats = syncResult.results.reduce((sum, r) => sum + (r.newChatsFound || 0), 0)
    result = {
      success: syncResult.success,
      error: syncResult.success
        ? undefined
        : syncResult.results
            .map((r) => r.error)
            .filter(Boolean)
            .join('; '),
      newChatsFound: totalChats
    }
  } else {
    // Sync specific provider
    const providerInstance = providerRegistry.getProvider(provider)
    if (!providerInstance) {
      return { success: false, error: `Provider ${provider} not found` }
    }

    result = await providerInstance.sync()
  }

  // Auto-index to hindsight if enabled and sync was successful
  if (result.success && result.newChatsFound && result.newChatsFound > 0) {
    const settings = getSettings()
    if (settings.hindsightEnabled && settings.hindsightAutoIndex) {
      // Run indexing in background - don't block sync completion
      indexAllConversations()
        .then((indexResult) => {
          if (indexResult.success) {
            console.log(
              `[Hindsight] Auto-indexed: ${indexResult.analyzed} analyzed, ${indexResult.retained} retained`
            )
          } else {
            console.error('[Hindsight] Auto-index failed:', indexResult.error)
          }
        })
        .catch((error) => {
          console.error('[Hindsight] Auto-index error:', error)
        })
    }
  }

  return result
}

export function stopSync(): { success: boolean } {
  // Note: Stopping sync is now handled per-provider
  // This function is kept for backward compatibility
  return { success: true }
}
