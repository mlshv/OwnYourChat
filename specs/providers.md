# Providers

## Overview

Three sync providers: ChatGPT, Claude, Perplexity. Each extends `BaseProvider` and follows the same lifecycle.

**Files**:
- `src/main/sync/providers/base.ts` - Abstract base class
- `src/main/sync/providers/types.ts` - Metadata types
- `src/main/sync/providers/registry.ts` - Singleton managing all providers
- `src/main/sync/providers/chatgpt-provider.ts`
- `src/main/sync/providers/claude-provider.ts`
- `src/main/sync/providers/perplexity-provider.ts`

## Provider Interface

```typescript
interface IProvider {
  start(): Promise<void>
  stop(): Promise<void>
  sync(): Promise<SyncResult>
  showLogin(): void
  logout(): Promise<void>
  restoreConnection(): Promise<void>
  refreshAndPersistConversation(id: string): Promise<{...} | null>
  downloadAttachment(fileId, filename, conversationId): Promise<string>
}
```

## Provider States

| Status | Meaning |
|--------|---------|
| `connected` | Authenticated, ready to sync |
| `syncing` | Currently syncing |
| `timeout` | Sync timed out |
| `logged_out` | No valid auth |
| `error` | Sync error |
| `disconnected` | Not started |

## Sync Strategy

### Full Sync vs Incremental Sync

**Decision (Dec 19, 2025)**: Use `lastCompletedOffset` + `isFullSyncComplete` pattern.

```typescript
type ChatGPTMetadata = {
  lastCompletedOffset: number    // Resume point for interrupted syncs
  isFullSyncComplete: boolean    // Switch to incremental when true
  lastSyncPageSize: number       // Detect API pagination changes
}
```

**Why this pattern**:
- `maxLocalUpdatedAt` alone fails for initial sync (interruption loses older conversations)
- `lastCompletedOffset` enables resumable pagination
- Once `isFullSyncComplete = true`, use `maxLocalUpdatedAt` for incremental updates

### Sync Flow

1. **Full sync** (until `isFullSyncComplete`):
   - Paginate from offset 0
   - Track `lastCompletedOffset` per page
   - Stop when `total <= offset + pageSize`
   - Set `isFullSyncComplete = true`

2. **Incremental sync** (after full sync):
   - Use `maxLocalUpdatedAt` to fetch only newer conversations
   - Much faster, single page usually sufficient

## Authentication

Each provider uses a hidden `WebContentsView` to:
1. Load provider website (chat.openai.com, claude.ai, perplexity.ai)
2. Capture auth headers via network inspection
3. Store headers in provider state

**Connection restoration**: On app restart, validate stored headers. If still valid, mark as connected.

## Provider-Specific Details

### ChatGPT
- API: Internal ChatGPT API (captured from web)
- Message format: Nested parts with author roles
- Supports content references (web citations)
- `src/main/sync/providers/chatgpt/utils.ts` - Message transformation

### Claude
- API: Claude.ai internal API
- UUID-based conversations
- File assets with thumbnails/previews
- `src/main/sync/providers/claude/utils.ts` - Message transformation

### Perplexity
- API: Perplexity.ai internal API
- **Linear messages** (no tree structure, all `parentId: null`)
- Web search integration with sources
- Thread URL slug for IDs (extract after last dash)
- `src/main/sync/providers/perplexity/utils.ts` - Message transformation

**Decision (Jan 6, 2026)**: Perplexity messages are linear, not tree-structured. Required fix to `branch-utils.ts` to handle both patterns.

## OOP Refactoring

**Decision (Dec 17, 2025)**: Moved giant if/else logic from IPC handlers into provider methods.

Before:
```typescript
// ipc.ts - bad
if (provider === 'chatgpt') { /* chatgpt logic */ }
else if (provider === 'claude') { /* claude logic */ }
```

After:
```typescript
// ipc.ts - good
const provider = registry.getProvider(name)
await provider.refreshAndPersistConversation(id)
```

## Polling

Default 60 seconds (`pollingIntervalMs` in `BaseProvider` constructor). Configurable via settings.

Scheduler (`src/main/sync/scheduler.ts`) orchestrates periodic syncs across all connected providers.
