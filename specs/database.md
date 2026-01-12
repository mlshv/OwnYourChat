# Database

## Overview

SQLite database via Drizzle ORM. Location: `~/Library/Application Support/ownyourchat/ownyourchat.db`

**Files**:
- `src/main/db/schema.ts` - Drizzle schema
- `src/main/db/operations.ts` - CRUD operations
- `src/main/db/index.ts` - DB initialization
- `src/main/db/migrations/` - Migration history

## Tables

### conversations

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Provider's conversation ID |
| `title` | TEXT | Conversation title |
| `provider` | TEXT | 'chatgpt' \| 'claude' \| 'perplexity' |
| `createdAt` | INTEGER | Unix timestamp |
| `updatedAt` | INTEGER | Unix timestamp |
| `syncedAt` | INTEGER | Last sync timestamp |
| `messageCount` | INTEGER | Total messages |
| `currentNodeId` | TEXT | Default branch endpoint |
| `syncError` | TEXT | Last error message |
| `syncRetryCount` | INTEGER | Retry attempts |

Index on `provider` for filtering.

### messages

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Message ID |
| `conversationId` | TEXT FK | References conversations |
| `role` | TEXT | 'user' \| 'assistant' \| 'system' |
| `parts` | TEXT | JSON array of MessagePart objects |
| `orderIndex` | INTEGER | Position in conversation |
| `parentId` | TEXT | Parent message (null for root) |
| `siblingIds` | TEXT | JSON array of sibling IDs |
| `siblingIndex` | INTEGER | Position among siblings |

Cascade delete on conversation deletion.

### attachments

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Attachment ID |
| `messageId` | TEXT FK | References messages |
| `type` | TEXT | 'image' \| 'file' |
| `fileId` | TEXT | Provider file ID |
| `originalUrl` | TEXT | Remote URL |
| `localPath` | TEXT | Cached local path |
| `filename` | TEXT | Original filename |
| `mimeType` | TEXT | MIME type |
| `size` | INTEGER | File size bytes |
| `width`/`height` | INTEGER | Image dimensions |

### provider_state

| Column | Type | Purpose |
|--------|------|---------|
| `providerName` | TEXT PK | 'chatgpt' \| 'claude' \| 'perplexity' |
| `isConnected` | BOOLEAN | Connection status |
| `lastSyncAt` | INTEGER | Last successful sync |
| `status` | TEXT | Provider status |
| `metadata` | TEXT | JSON (offset, fullSyncComplete, etc.) |

### user_preferences

Single row (`id = 'default'`) storing:
- `hasCompletedOnboarding`
- `showDebugPanel`
- `exportSettings` (JSON)

## Message Tree Structure

Messages form a tree via `parentId`/`siblingIds`/`siblingIndex`.

```
Message A (root, parentId: null)
├── Message B (siblingIndex: 0)
│   └── Message C
└── Message B' (siblingIndex: 1)  ← Alternative response
    └── Message C'
```

**ChatGPT/Claude**: Full tree structure with branching (alternative responses).

**Perplexity**: Linear structure - all messages have `parentId: null` (no branching).

**Decision (Jan 6, 2026)**: Frontend `branch-utils.ts` handles both patterns.

## Upsert Strategy

**Decision (Dec 25, 2025)**: Use upsert over insert everywhere.

```typescript
// Good - idempotent, handles retries
await storage.upsertMessages(messages)
await storage.upsertAttachments(attachments)

// Bad - fails on retry with duplicate key
await storage.insertMessages(messages)  // REMOVED
```

**Why**:
- Idempotent - safe to retry without errors
- Handles partial failures gracefully
- Removed `insertMessages` and `insertAttachments` entirely

## Key Operations

| Function | Purpose |
|----------|---------|
| `listConversations(limit, offset)` | Paginated list, returns `{items, total, hasMore}` |
| `getConversationWithMessages(id)` | Full conversation with all messages |
| `searchConversations(keywords, limit)` | Search titles (max 50 results) |
| `searchMessages(keywords, limit)` | Search message content |
| `upsertConversation(conv)` | Insert or update conversation |
| `upsertMessages(msgs)` | Batch upsert messages |
| `upsertAttachments(atts)` | Batch upsert attachments |
| `getProviderState(name)` | Get provider metadata |
| `setProviderState(name, state)` | Update provider metadata |

## Migrations

Drizzle migrations in `src/main/db/migrations/`. Generate with:
```bash
pnpm drizzle-kit generate
```

Migrations auto-run on app start via `db/index.ts`.
