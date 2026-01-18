/**
 * Export Worker Manager
 *
 * Manages the lifecycle of the export worker thread.
 * Coordinates between main process (attachment downloads) and worker (export logic).
 */
import { Worker } from 'worker_threads'
import path from 'path'
import { app } from 'electron'
import { getDbPath } from '../db'
import type { ExportProgress } from '../../shared/types'
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  ExportPayload,
  ExportAllPayload
} from './worker'

type ProgressCallback = (progress: ExportProgress) => void
type AttachmentDownloadCallback = (request: {
  conversationId: string
  attachmentId: string
  fileId: string
  filename: string
}) => Promise<string>

// Active worker instance
let activeWorker: Worker | null = null

// Pending export promise resolve/reject functions
let pendingResolve: ((result: { success: boolean; path?: string; error?: string }) => void) | null =
  null
let pendingReject: ((error: Error) => void) | null = null

/**
 * Get the path to the bundled worker file.
 * In development, it's in out/main; in production, it's in resources/app.asar/out/main.
 */
function getWorkerPath(): string {
  // In development, electron-vite outputs to 'out/main'
  // In production, it's bundled in resources
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'export-worker.js')
  } else {
    // Development path - electron-vite outputs to 'out/main'
    return path.join(app.getAppPath(), 'out', 'main', 'export-worker.js')
  }
}

/**
 * Start an export worker for a single conversation.
 */
export function startExportWorker(
  payload: ExportPayload,
  onProgress: ProgressCallback,
  onDownloadAttachment: AttachmentDownloadCallback
): Promise<{ success: boolean; path?: string; error?: string }> {
  return startWorker({ type: 'export', payload }, onProgress, onDownloadAttachment)
}

/**
 * Start an export worker for all conversations.
 */
export function startExportAllWorker(
  payload: ExportAllPayload,
  onProgress: ProgressCallback,
  onDownloadAttachment: AttachmentDownloadCallback
): Promise<{ success: boolean; path?: string; error?: string }> {
  return startWorker({ type: 'exportAll', payload }, onProgress, onDownloadAttachment)
}

/**
 * Internal function to start a worker with the given initial message.
 */
function startWorker(
  initialMessage: WorkerInboundMessage,
  onProgress: ProgressCallback,
  onDownloadAttachment: AttachmentDownloadCallback
): Promise<{ success: boolean; path?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    // If there's already an active worker, reject
    if (activeWorker) {
      reject(new Error('Export already in progress'))
      return
    }

    const workerPath = getWorkerPath()
    const dbPath = getDbPath()

    console.log('[Export Manager] Starting worker:', workerPath)
    console.log('[Export Manager] DB path:', dbPath)

    try {
      activeWorker = new Worker(workerPath, {
        workerData: { dbPath }
      })
    } catch (error) {
      console.error('[Export Manager] Failed to create worker:', error)
      reject(error)
      return
    }

    pendingResolve = resolve
    pendingReject = reject

    activeWorker.on('message', async (msg: WorkerOutboundMessage) => {
      try {
        if (msg.type === 'progress') {
          onProgress(msg.payload)
          return
        }

        if (msg.type === 'downloadAttachment') {
          // Download the attachment in the main process
          try {
            const localPath = await onDownloadAttachment({
              conversationId: msg.conversationId,
              attachmentId: msg.attachmentId,
              fileId: msg.fileId,
              filename: msg.filename
            })

            // Send the result back to the worker
            activeWorker?.postMessage({
              type: 'attachmentDownloaded',
              attachmentId: msg.attachmentId,
              localPath
            } satisfies WorkerInboundMessage)
          } catch (error) {
            console.error('[Export Manager] Attachment download failed:', error)
            // Send empty path on failure - worker will handle gracefully
            activeWorker?.postMessage({
              type: 'attachmentDownloaded',
              attachmentId: msg.attachmentId,
              localPath: ''
            } satisfies WorkerInboundMessage)
          }
          return
        }

        if (msg.type === 'complete') {
          cleanup()
          pendingResolve?.({ success: true, path: msg.payload.path })
          return
        }

        if (msg.type === 'error') {
          cleanup()
          pendingResolve?.({ success: false, error: msg.payload.message })
          return
        }

        if (msg.type === 'cancelled') {
          cleanup()
          pendingResolve?.({ success: false, error: 'Export cancelled' })
          return
        }
      } catch (error) {
        console.error('[Export Manager] Error handling worker message:', error)
      }
    })

    activeWorker.on('error', (error) => {
      console.error('[Export Manager] Worker error:', error)
      cleanup()
      pendingReject?.(error)
    })

    activeWorker.on('exit', (code) => {
      console.log('[Export Manager] Worker exited with code:', code)
      if (code !== 0 && pendingResolve) {
        cleanup()
        pendingResolve({ success: false, error: `Worker exited with code ${code}` })
      }
    })

    // Send the initial message to start the export
    activeWorker.postMessage(initialMessage)
  })
}

/**
 * Cancel the current export operation.
 */
export function cancelExport(): void {
  if (activeWorker) {
    activeWorker.postMessage({ type: 'cancel' } satisfies WorkerInboundMessage)
  }
}

/**
 * Check if an export is currently in progress.
 */
export function isExportInProgress(): boolean {
  return activeWorker !== null
}

/**
 * Clean up worker resources.
 */
function cleanup(): void {
  if (activeWorker) {
    activeWorker.removeAllListeners()
    activeWorker = null
  }
  pendingResolve = null
  pendingReject = null
}
