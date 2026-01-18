# Export Update Implementation Plan

## Overview

Update JSON export format to OpenAI Chat API compatibility and add progress/cancellation UI.

**User request**: "I need backup chats for export to another platform or API. JSON with a standard API structure will be very helpful (id, creation_time, parent_id, role, context)."

---

## 1. JSON Format Changes

**Current format** (`src/main/export/json.ts:67-85`):
```json
{
  "id": "...",
  "title": "...",
  "createdAt": "2026-01-07T10:00:00Z",
  "messages": [{
    "id": "...",
    "role": "user",
    "parts": [{"type": "text", "text": "Hello"}],
    "createdAt": "...",
    "orderIndex": 0
  }]
}
```

**New OpenAI-compatible format**:
```json
{
  "id": "...",
  "title": "...",
  "provider": "chatgpt",
  "created_at": 1704621600,
  "updated_at": 1704621700,
  "exported_at": "2026-01-07T10:00:00Z",
  "message_count": 10,
  "messages": [{
    "id": "...",
    "role": "user",
    "content": "Hello, here's what I found...",
    "created_at": 1704621600,
    "parent_id": null,
    "sources": [
      {"title": "Wikipedia Article", "url": "https://en.wikipedia.org/..."},
      {"url": "https://example.com/page"}
    ],
    "attachments": [...]
  }]
}
```

**Changes**:
- `createdAt` → `created_at` (snake_case, Unix timestamp for API compat)
- `parts` → `content` (flattened text parts to string)
- `source-url` parts → `sources` array (extracted from parts, `{title?, url}`)
- Add `parent_id` from DB schema (`src/main/db/schema.ts:33`)
- Add `provider` field from conversation
- Remove `orderIndex` (redundant with parent_id tree)

**Files to modify**:
- `src/main/export/json.ts` - Format transformation
- `src/shared/types.ts` - Export type definitions (if needed)

---

## 2. Progress Tracking

**Current state**: No progress feedback during export (`src/main/export/index.ts:65-85`).

**Implementation**:

- Add progress callback to `exportConversation()` and `downloadMissingAttachments()` in `src/main/export/index.ts:16-63`
- Track: `{ phase: 'downloading' | 'exporting', current: number, total: number, conversationTitle?: string }`
- Send progress via IPC to renderer

**New IPC channel**:
```typescript
// src/shared/types.ts - add to IPC_CHANNELS enum
EXPORT_PROGRESS = 'export:progress'

// Progress event type
type ExportProgress = {
  phase: 'downloading' | 'exporting'
  current: number
  total: number
  conversationTitle?: string
}
```

**Files to modify**:
- `src/shared/types.ts` - Add IPC channel and progress type
- `src/main/export/index.ts` - Add progress callbacks
- `src/main/ipc/export.ts` (or wherever IPC handlers live) - Emit progress events
- `src/preload/index.ts` - Expose progress listener

---

## 3. Export Cancellation

**Current state**: No way to cancel in-progress export (`ExportModal.tsx:110-154`).

**Implementation**:

- Use `AbortController` pattern in export functions
- Add `export:cancel` IPC channel
- Clean up partial files on abort
- Signal abort via shared controller reference

**Abort flow**:
```
ExportModal clicks Cancel
        │
        ▼
IPC: export:cancel
        │
        ▼
Main process: abortController.abort()
        │
        ├─► downloadMissingAttachments() checks signal, throws AbortError
        │
        └─► exportConversation() checks signal, cleans up partial files
```

**Files to modify**:
- `src/shared/types.ts` - Add `EXPORT_CANCEL` IPC channel
- `src/main/export/index.ts` - Accept AbortSignal, check before each operation
- `src/main/ipc/export.ts` - Store AbortController, handle cancel channel
- `src/preload/index.ts` - Expose cancel method

---

## 4. UI Changes

**Current state** (`src/renderer/src/components/ExportModal.tsx`):
- Simple "Exporting..." text during export (line 294)
- Cancel button closes modal (line 290-291)

**New UI during export**:
```
┌─────────────────────────────────────┐
│ Export conversations                │
├─────────────────────────────────────┤
│                                     │
│ Downloading attachments...          │
│ ████████████░░░░░░░░░  12/25        │
│                                     │
│ "My Conversation Title"             │
│                                     │
├─────────────────────────────────────┤
│                      [Cancel Export]│
└─────────────────────────────────────┘
```

**Components**:
- Progress bar (use existing shadcn Progress or custom)
- Phase text ("Downloading attachments..." / "Exporting...")
- Current/total counter
- Conversation title (for batch export context)
- Cancel button transforms to "Cancel Export" during export

**Files to modify**:
- `src/renderer/src/components/ExportModal.tsx` - Add progress UI, cancel handler

---

## Implementation Order

1. **Add IPC channels and types** (`src/shared/types.ts`)
   - `EXPORT_PROGRESS` channel
   - `EXPORT_CANCEL` channel
   - `ExportProgress` type

2. **Update export functions** (`src/main/export/index.ts`)
   - Add `AbortSignal` parameter
   - Add progress callback parameter
   - Check abort signal before each attachment download
   - Report progress during downloads

3. **Update JSON formatter** (`src/main/export/json.ts`)
   - Rename to snake_case
   - Flatten parts to content string
   - Add parent_id field
   - Add provider field

4. **Update IPC handlers** (find export IPC registration)
   - Store AbortController for active export
   - Handle cancel channel
   - Forward progress events to renderer

5. **Update preload bridge** (`src/preload/index.ts`)
   - Expose `onExportProgress` listener
   - Expose `cancelExport` method

6. **Update ExportModal** (`src/renderer/src/components/ExportModal.tsx`)
   - Add progress state
   - Subscribe to progress events
   - Add progress bar UI
   - Wire cancel button to abort

7. **Update spec** (`specs/export.md`)
   - Document new JSON format
   - Document progress/cancel IPC

---

## Testing Checklist

- [x] JSON export produces OpenAI-compatible format
- [x] parent_id correctly reflects message tree structure
- [x] content is flattened string (not parts array)
- [x] Progress bar updates during attachment download
- [x] Progress bar updates during batch export
- [x] Cancel immediately stops attachment download
- [ ] Partial files cleaned up on cancel (AbortError thrown, but folder/file cleanup not implemented)
- [x] Markdown export still works (unchanged)
- [x] **FIXED: Attachment count flickering** - cumulative progress tracking now implemented

---

## Implementation Summary (Jan 14, 2026)

### Files Modified:
1. `src/shared/types.ts` - Added `ExportProgress` type and `EXPORT_PROGRESS`, `EXPORT_CANCEL` IPC channels
2. `src/main/export/index.ts` - Added `AbortSignal` and progress callback support
3. `src/main/export/json.ts` - Complete rewrite to OpenAI-compatible format
4. `src/main/ipc.ts` - Added progress emission and cancel handler
5. `src/preload/index.ts` - Added `onProgress` listener and `cancel` method
6. `src/renderer/src/components/ExportModal.tsx` - Added progress bar UI and cancel functionality
7. `src/renderer/src/components/ui/progress.tsx` - New Progress component (shadcn)

### Files Added:
1. `src/main/export/__test__/json.test.ts` - 10 unit tests for JSON export format

### Dependencies Added:
1. `@radix-ui/react-progress` - For progress bar component

### Tests:
- All 52 tests pass (including 10 JSON export tests + 7 new cumulative progress tests)
- TypeScript compilation passes

---

## Bug: Attachment Count Flickering (FIXED)

**Symptom**: During batch export, attachment download progress resets per conversation instead of showing cumulative total.

**Root cause** (`src/main/export/index.ts`):
- `exportAllConversations` called `exportConversation` without cumulative progress tracking
- `exportConversation` called `downloadMissingAttachments` **without** `cumulativeProgress` parameter
- Each conversation counted attachments separately, so progress reset: "1/3" → "1/2" → "1/5" instead of "1/10" → "4/10" → "9/10"

**Fix implemented (Jan 14, 2026)**:

1. **Pre-count all attachments** in `exportAllConversations` before starting export (lines 165-180):
   ```typescript
   let cumulativeProgress: { downloaded: number; total: number } | undefined
   if (options.includeAttachments) {
     let totalAttachments = 0
     for (const conv of conversations.items) {
       if (context?.signal?.aborted) {
         throw new DOMException('Export cancelled', 'AbortError')
       }
       const data = await db.getConversationWithMessages(conv.id)
       if (data) {
         totalAttachments += countMissingAttachments(data.messages)
       }
     }
     cumulativeProgress = { downloaded: 0, total: totalAttachments }
   }
   ```

2. **Modified `exportConversation` signature** to accept optional `cumulativeProgress` (line 121):
   ```typescript
   export async function exportConversation(
     id: string,
     options: ExportOptions,
     context?: ExportContext,
     cumulativeProgress?: { downloaded: number; total: number }
   ): Promise<string>
   ```

3. **Forward `cumulativeProgress`** to `downloadMissingAttachments` (lines 134-141):
   ```typescript
   await downloadMissingAttachments(
     data.messages,
     id,
     data.conversation.title,
     context,
     cumulativeProgress
   )
   ```

4. **Pass from `exportAllConversations`** (line 196):
   ```typescript
   await exportConversation(conv.id, options, context, cumulativeProgress)
   ```

**Files modified**:
- `src/main/export/index.ts` - Added cumulative progress tracking

**Files added**:
- `src/main/export/__test__/cumulative-progress.test.ts` - 7 unit tests for cumulative progress

STATUS: DONE
