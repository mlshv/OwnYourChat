# Export

## Overview

Export conversations to Markdown or JSON files, with optional attachments.

**Files**:

- `src/main/export/index.ts` - Main export logic
- `src/main/export/markdown.ts` - Markdown formatter
- `src/main/export/json.ts` - JSON formatter
- `src/main/export/utils.ts` - Helpers (date formatting, filename sanitization)

## Export Options

```typescript
interface ExportOptions {
  format: 'markdown' | 'json'
  includeAttachments: boolean
  prefixTimestamp: boolean // YYYY-MM-DD prefix for sorting
  outputPath: string
}
```

## Filename Format

**Decision (Jan 7, 2026)**: Use `YYYY-MM-DD_Title` format when `prefixTimestamp` enabled.

```
2026-01-07_My Conversation Title.md
```

**Why this format**:

- Alphabetically sortable (year first with zero-padding)
- Works across all file systems
- Easy to find conversations by date

Without timestamp: `My Conversation Title.md`

Filename sanitization (`sanitizeFilename`):

- Replace `\/:*?"<>|` with `-`
- Collapse whitespace
- Remove leading dots
- Max 100 characters

## Export Flow

```
ExportModal (Renderer)
        │
        │ export:conversation / export:all
        ▼
IPC Handler (Main)
        │
        ├─► Get conversation from DB
        │
        ├─► Download missing attachments (if enabled)
        │   └─► provider.downloadAttachment()
        │
        ├─► Format (Markdown or JSON)
        │
        └─► Write to outputPath
```

## Missing Attachment Download

Before export, downloads any attachments not yet cached locally:

```typescript
async function downloadMissingAttachments(messages, conversationId, context) {
  for (const msg of messages) {
    for (const att of msg.attachments) {
      if (att.localPath && fs.existsSync(att.localPath)) continue
      const localPath = await context.provider.downloadAttachment(...)
      await db.updateAttachmentLocalPath(att.id, localPath)
    }
  }
}
```

**Stale-while-revalidate**: If download fails, export continues with available attachments. Error logged but not fatal.

## Markdown Format

```markdown
# Conversation Title

**Provider**: chatgpt
**Created**: 2026-01-07

---

## User

Message content...

---

## Assistant

Response content...

![Image](attachments/file-123_image.png)

[Document.pdf](attachments/file-456_Document.pdf)
```

Attachments embedded as Markdown links/images.

## JSON Format

OpenAI Chat API-compatible format for interoperability with other tools.

```json
{
  "id": "conv-abc123",
  "title": "My Conversation",
  "provider": "chatgpt",
  "created_at": 1704621600,
  "updated_at": 1704621700,
  "exported_at": "2026-01-07T10:00:00Z",
  "message_count": 10,
  "messages": [
    {
      "id": "msg-xyz789",
      "role": "user",
      "content": "What is the capital of France?",
      "created_at": 1704621600,
      "parent_id": null
    },
    {
      "id": "msg-abc456",
      "role": "assistant",
      "content": "The capital of France is Paris.",
      "created_at": 1704621605,
      "parent_id": "msg-xyz789",
      "sources": [{ "title": "Wikipedia - Paris", "url": "https://en.wikipedia.org/wiki/Paris" }],
      "attachments": [
        {
          "type": "image",
          "filename": "paris.png",
          "local_path": "./attachments/paris.png",
          "original_url": "https://..."
        }
      ]
    }
  ]
}
```

**Field mapping**:

- `created_at` / `updated_at`: Unix timestamps (seconds)
- `content`: Flattened text from message parts
- `parent_id`: Message tree structure (null for root messages)
- `sources`: Extracted from `source-url` parts (Perplexity citations, etc.)
- `attachments`: Only present when `includeAttachments` enabled

## IPC Channels

| Channel               | Purpose                             |
| --------------------- | ----------------------------------- |
| `export:conversation` | Export single conversation          |
| `export:all`          | Batch export all (up to 10k)        |
| `export:progress`     | Progress updates (renderer listens) |
| `export:cancel`       | Abort in-progress export            |

### Progress Event

```typescript
type ExportProgress = {
  phase: 'downloading' | 'exporting'
  current: number
  total: number
  conversationTitle?: string
}
```

## UI

`ExportModal` component:

- Format selection (Markdown/JSON)
- "Include attachments" checkbox with warning about download time
- "Prefix with timestamp" checkbox
- Output folder picker (`dialog:pick-folder`)
- Progress bar during export (attachment downloads + conversation count)
- Cancel button aborts in-progress export immediately

Settings persisted in `user_preferences.exportSettings`.

### Progress UI

During export, modal shows:

- Phase label ("Downloading attachments..." / "Exporting conversations...")
- Progress bar with current/total count
- Current conversation title (for batch exports)
- "Cancel Export" button (replaces "Cancel")

### Cancellation

Cancel triggers immediate abort:

- Stops current attachment download
- Cleans up partial files
- Returns to ready state

IPC: `export:cancel` signals abort to main process.
