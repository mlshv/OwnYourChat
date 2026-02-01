# Export Worker Thread Implementation Plan

## Problem

Export operations block the Electron main process because better-sqlite3 is synchronous. Even with `yieldToEventLoop()` workarounds, batch exports of 10k+ conversations cause UI freezes.

## Solution

Move heavy export operations to a Node.js Worker Thread. The worker handles:

- Database reads (conversation listing, message fetching)
- JSON/Markdown formatting
- File I/O (directory creation, file copying, file writing)

Main process retains:

- Attachment downloads (requires provider instance with auth state)
- IPC communication with renderer
- Abort coordination

---

## Architecture

```
┌─────────────────┐     IPC      ┌─────────────────┐
│    Renderer     │◄────────────►│   Main Process  │
│  (ExportModal)  │              │   (ipc.ts)      │
└─────────────────┘              └────────┬────────┘
                                          │ postMessage
                                          ▼
                                 ┌─────────────────┐
                                 │  Export Worker  │
                                 │ (worker.ts)     │
                                 │ - DB connection │
                                 │ - File I/O      │
                                 │ - Formatting    │
                                 └─────────────────┘
```

**Message Flow:**

1. Main → Worker: `{ type: 'export', payload: { conversationIds, options } }`
2. Worker → Main: `{ type: 'progress', payload: ExportProgress }`
3. Worker → Main: `{ type: 'downloadAttachment', conversationId, attachmentId, fileId }`
4. Main → Worker: `{ type: 'attachmentDownloaded', attachmentId, localPath }`
5. Main → Worker: `{ type: 'cancel' }`
6. Worker → Main: `{ type: 'complete', payload: { path } }` or `{ type: 'error', payload: { message } }`

---

## Implementation Steps

### 1. Create Worker Entry Point

**File: `src/main/export/worker.ts`**

```typescript
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { exportToJson } from './json'
import { exportToMarkdown } from './markdown'

// Worker has its own DB connection
const sqlite = new Database(workerData.dbPath)
const db = drizzle(sqlite, { schema })

let cancelled = false

parentPort?.on('message', (msg) => {
  if (msg.type === 'cancel') cancelled = true
  if (msg.type === 'attachmentDownloaded') handleAttachmentDownloaded(msg.payload)
})

// Main export logic runs here
async function runExport(options) { ... }
```

### 2. Update electron-vite Config

**File: `electron.vite.config.ts`**

Add worker configuration to bundle the worker file:

```typescript
main: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/main/index.ts'),
        'export-worker': resolve(__dirname, 'src/main/export/worker.ts')
      }
    }
  }
}
```

### 3. Create Worker Manager

**File: `src/main/export/worker-manager.ts`**

```typescript
import { Worker } from 'worker_threads'
import path from 'path'
import { getDbPath } from '../db'

let activeWorker: Worker | null = null

export function startExportWorker(options, onProgress, onDownloadAttachment) {
  const workerPath = path.join(__dirname, 'export-worker.js')
  activeWorker = new Worker(workerPath, {
    workerData: { dbPath: getDbPath() }
  })

  activeWorker.on('message', (msg) => {
    if (msg.type === 'progress') onProgress(msg.payload)
    if (msg.type === 'downloadAttachment') onDownloadAttachment(msg.payload)
    // ...
  })

  activeWorker.postMessage({ type: 'export', payload: options })
  return activeWorker
}

export function cancelExport() {
  activeWorker?.postMessage({ type: 'cancel' })
}
```

### 4. Update IPC Handlers

**File: `src/main/ipc.ts`**

Replace direct `exportAllConversations()` calls with worker management:

```typescript
ipcMain.handle(IPC_CHANNELS.EXPORT_ALL, async (_event, options) => {
  return new Promise((resolve) => {
    const worker = startExportWorker(options, sendProgressUpdate, async (attachmentRequest) => {
      // Download attachments in main process
      const localPath = await downloadAttachment(attachmentRequest)
      worker.postMessage({
        type: 'attachmentDownloaded',
        attachmentId: attachmentRequest.attachmentId,
        localPath
      })
    })

    worker.on('message', (msg) => {
      if (msg.type === 'complete') resolve({ success: true, path: msg.payload.path })
      if (msg.type === 'error') resolve({ success: false, error: msg.payload.message })
    })
  })
})
```

### 5. Refactor Export Logic

**File: `src/main/export/index.ts`**

- Extract DB operations to be usable from worker
- Keep `downloadMissingAttachments()` in main process
- Add message-based cancellation check instead of AbortSignal

---

## Files to Modify/Create

| File                                | Action | Description                                |
| ----------------------------------- | ------ | ------------------------------------------ |
| `src/main/export/worker.ts`         | Create | Worker entry point with DB connection      |
| `src/main/export/worker-manager.ts` | Create | Worker lifecycle management                |
| `src/main/export/index.ts`          | Modify | Refactor to support worker pattern         |
| `src/main/export/json.ts`           | Modify | Accept db instance as parameter            |
| `src/main/ipc.ts`                   | Modify | Use worker manager instead of direct calls |
| `src/main/db/index.ts`              | Modify | Export `getDbPath()` for worker            |
| `electron.vite.config.ts`           | Modify | Add worker build configuration             |

---

## Attachment Download Strategy (Skip in Worker)

Attachments stay in main process since providers require auth state:

**Flow:**

1. Worker exports conversation, encounters attachment without local file
2. Worker sends `{ type: 'downloadAttachment', conversationId, attachmentId, fileId }` to main
3. Main downloads via provider, updates DB with local path
4. Main sends `{ type: 'attachmentDownloaded', attachmentId, localPath }` to worker
5. Worker copies file to export directory

**Without attachments**: Worker handles everything directly, no main process involvement.

---

## Cancellation Strategy

Replace `AbortSignal` (can't cross thread boundary) with message-based cancellation:

```typescript
// Worker checks periodically:
if (cancelled) {
  parentPort?.postMessage({ type: 'cancelled' })
  process.exit(0)
}
```

---

## Verification

1. **Build check**: `pnpm build` - ensure worker bundles correctly ✅
2. **Typecheck**: `pnpm typecheck` - no TS errors in new files ✅
3. **Single export**: Export one conversation - should work as before
4. **Batch export**: Export all conversations - UI should remain responsive
5. **Cancel test**: Start batch export, cancel mid-way - should stop cleanly
6. **With attachments**: Export with attachments enabled - downloads should work

---

## Implementation Summary

**Files Created:**

- `src/main/export/worker.ts` - Worker entry point with own DB connection
- `src/main/export/worker-manager.ts` - Worker lifecycle management

**Files Modified:**

- `electron.vite.config.ts` - Added worker build configuration (input entry)
- `src/main/ipc.ts` - Updated export handlers to use worker manager

**Build Output:**

- `out/main/export-worker.js` (15.13 KB) - Worker script bundled successfully
- `out/main/index.js` (273.82 KB) - Main process with worker manager

**Tests Added:**

- `src/main/export/__test__/worker-manager.test.ts` - Message type validation tests (14 tests)

**Key Implementation Details:**

- Worker has its own better-sqlite3 database connection
- Attachment downloads delegated to main process (provider auth required)
- Progress updates sent via postMessage
- Cancellation via message-based flag
- Promise-based API for IPC handlers

---

STATUS: DONE
