# Attachments

## Overview

Attachments (images, files) are downloaded from providers and cached locally. Served to renderer via `attachment://` custom protocol.

## Storage

Local cache: `~/.config/ownyourchat/attachments/{conversationId}/{fileId}_{filename}`

Database table `attachments`:
- `originalUrl` - Provider's remote URL
- `localPath` - Cached local path (null if not downloaded)
- `type` - 'image' | 'file'

## Download Flow

```
Renderer                     Main                         Provider
   │                           │                              │
   │  attachment:download      │                              │
   ├──────────────────────────►│                              │
   │                           │  provider.downloadAttachment │
   │                           ├─────────────────────────────►│
   │                           │                              │
   │                           │  Write to disk               │
   │                           │  Update localPath in DB      │
   │                           │◄─────────────────────────────┤
   │  localPath                │                              │
   │◄──────────────────────────┤                              │
   │                           │                              │
   │  attachment://{path}      │                              │
   ├──────────────────────────►│  Custom protocol serves file │
```

## Provider-Specific Downloads

Each provider implements `downloadAttachment(fileId, filename, conversationId)`:

### ChatGPT (`chatgpt-provider.ts`)

Uses WebContentsView JavaScript execution:
```typescript
const result = await this.view.webContents.executeJavaScript(`
  (async () => {
    const response = await fetch('${downloadUrl}', { headers })
    return { data: await response.arrayBuffer() }
  })()
`)
```

### Claude (`claude-provider.ts`)

Similar to ChatGPT - JavaScript execution in WebContentsView.

### Perplexity (`perplexity-provider.ts`)

**Decision (Jan 7, 2026)**: Uses Electron's `net` module instead of WebContentsView fetch.

**Why**: Perplexity files hosted on S3 (`ppl-ai-file-upload.s3.amazonaws.com`) blocked by CORS when using WebContentsView. Electron's `net` module bypasses browser security restrictions.

```typescript
import { net } from 'electron'

const request = net.request(downloadUrl)
request.on('response', (response) => {
  // Read chunks, write to disk
})
request.end()
```

## Custom Protocol

`attachment://` registered in `src/main/index.ts`:

```typescript
protocol.handle('attachment', async (request) => {
  const filePath = request.url.replace('attachment://', '')
  const data = await fs.readFile(filePath)
  return new Response(data, {
    headers: { 'Content-Type': getMimeType(filePath) }
  })
})
```

Renderer uses: `<img src="attachment://${localPath}" />`

## Auto-Download

`AssistantMessage` component auto-downloads images on render:

```typescript
useEffect(() => {
  if (!attachment.localPath) {
    window.api.attachments.download(attachment.fileId, ...)
  }
}, [])
```

Files: user clicks to download on demand.

## File Type Handling

`AssistantMessage` renders file attachments with:
- Type-specific colors (PDF=red, Word=blue, Excel=green, etc.)
- Icons from Hugeicons library
- Click to open in default app (`shell:open-external`)

## IPC Channels

| Channel | Purpose |
|---------|---------|
| `attachment:download` | Download file to local cache |
| `attachment:open` | Open file in default app |
| `attachment:exists` | Check if already cached |

## Caching Strategy

- Check local cache first (`findCachedFile`)
- Download only if not cached
- Update `localPath` in DB after download
- Cache persists across app restarts
