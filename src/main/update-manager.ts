import { autoUpdater } from 'electron-updater'
import { app } from 'electron'

let updateDownloaded = false
let onUpdateDownloadedCallback: (() => void) | null = null

/**
 * Initialize auto-updater and start checking for updates
 */
export function initAutoUpdater(): void {
  // Don't check for updates in development
  if (!app.isPackaged) {
    console.log('[Auto-Update] Skipping update checks in development mode')
    return
  }

  // Configure auto-updater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Listen for update events
  autoUpdater.on('checking-for-update', () => {
    console.log('[Auto-Update] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[Auto-Update] Update available:', info.version)
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Auto-Update] No updates available. Current version:', info.version)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    const msg = `Downloading: ${progressObj.percent.toFixed(1)}% (${progressObj.transferred}/${progressObj.total})`
    console.log('[Auto-Update]', msg)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Auto-Update] Update downloaded:', info.version)
    updateDownloaded = true

    // Notify the callback that update is ready
    if (onUpdateDownloadedCallback) {
      onUpdateDownloadedCallback()
    }
  })

  autoUpdater.on('error', (error) => {
    console.error('[Auto-Update] Error:', error)
  })

  // Check for updates immediately on startup
  autoUpdater.checkForUpdates()

  // Check for updates every 4 hours
  setInterval(
    () => {
      autoUpdater.checkForUpdates()
    },
    4 * 60 * 60 * 1000
  )
}

/**
 * Check if an update has been downloaded and is ready to install
 */
export function isUpdateAvailable(): boolean {
  return updateDownloaded
}

/**
 * Install the downloaded update and restart the app
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true)
}

/**
 * Set a callback to be called when an update is downloaded
 */
export function onUpdateDownloaded(callback: () => void): void {
  onUpdateDownloadedCallback = callback
}
