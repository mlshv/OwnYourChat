import { getSettings } from '../settings.js'
import { providerRegistry } from './providers/registry.js'
import { store } from '../store.js'

let syncInterval: NodeJS.Timeout | null = null

export function startSyncScheduler(): void {
  if (syncInterval) {
    console.log('[Scheduler] Already running')
    return
  }

  const settings = getSettings()
  if (!settings.autoSync) {
    console.log('[Scheduler] Auto-sync disabled')
    return
  }

  const intervalMs = settings.syncIntervalMinutes * 60 * 1000
  console.log(`[Scheduler] Starting with interval: ${settings.syncIntervalMinutes} minutes`)

  // Note: Providers handle their own polling now, so this scheduler is optional
  // It can be used for manual periodic syncs if needed
  // Run initial sync immediately
  runScheduledSync()

  // Set up periodic sync
  syncInterval = setInterval(() => {
    runScheduledSync()
  }, intervalMs)
}

export function stopSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
    console.log('[Scheduler] Stopped')
  }
}

export function restartSyncScheduler(): void {
  stopSyncScheduler()
  startSyncScheduler()
}

async function runScheduledSync(): Promise<void> {
  console.log('[Scheduler] Starting scheduled sync for all providers...')

  // Update store: sync started
  store.getState().updateSyncState({
    isRunning: true,
    error: null
  })

  try {
    const result = await providerRegistry.syncAll()
    if (result.success) {
      const totalChats = result.results.reduce((sum, r) => sum + (r.newChatsFound || 0), 0)
      console.log(`[Scheduler] Sync completed, found ${totalChats} new chats across all providers`)

      // Update store: sync completed successfully
      store.getState().updateSyncState({
        isRunning: false,
        lastSyncAt: new Date(),
        error: null
      })
    } else {
      console.log('[Scheduler] Sync failed:', result.results)

      // Update store: sync failed
      const errorMessage = result.results
        .filter((r) => !r.success)
        .map((r) => r.error)
        .join(', ')

      store.getState().updateSyncState({
        isRunning: false,
        error: errorMessage || 'Unknown error'
      })
    }
  } catch (error) {
    console.error('[Scheduler] Sync error:', error)

    // Update store: sync error
    store.getState().updateSyncState({
      isRunning: false,
      error: (error as Error).message
    })
  }
}
