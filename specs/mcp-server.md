# MCP Server

## Overview

Built-in Model Context Protocol (MCP) server exposes conversation data to AI assistants like Claude Code and Cursor.

**File**: `src/main/mcp/server.ts`

## Architecture

**Decision (Jan 2, 2026)**: HTTP transport instead of stdio.

```
┌─────────────────────────────────────────────────────────┐
│                    OwnYourChat                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │              MCP Server (HTTP)                   │    │
│  │   http://localhost:37777/mcp                     │    │
│  │                                                  │    │
│  │   Tools:                                         │    │
│  │   - list_conversations                           │    │
│  │   - get_conversation_with_messages               │    │
│  │   - search_conversations                         │    │
│  │   - search_messages                              │    │
│  └─────────────────────────────────────────────────┘    │
│              │                                           │
│              ▼                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │              SQLite Database                     │    │
│  │              (via db/operations.ts)              │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
             │
             │ HTTP + SSE
             ▼
    ┌──────────────────┐
    │   Claude Code    │
    │   or Cursor      │
    └──────────────────┘
```

**Why HTTP over stdio**:
- Stateless connections - simpler for desktop apps
- No Express dependency - just Node's `http` module + MCP SDK
- Multiple clients can connect simultaneously
- Easy configuration (just a URL)

## Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/mcp` | POST | Initialize session, send requests |
| `/mcp` | GET | SSE stream for responses |
| `/mcp` | DELETE | Close session |
| `/health` | GET | Health check |

## Tools

### list_conversations

```typescript
{
  limit?: number   // default: 50
  offset?: number  // default: 0
}
→ { items: Conversation[], total: number, hasMore: boolean }
```

### get_conversation_with_messages

```typescript
{
  id: string       // required
  limit?: number
}
→ { conversation: Conversation, messages: Message[], ... } | error
```

### search_conversations

```typescript
{
  keywords: string[]  // required
  limit?: number      // default: 50
}
→ { items: Conversation[], total: number, hasMore: boolean }
```

Case-insensitive, matches ANY keyword in title.

### search_messages

```typescript
{
  keywords: string[]  // required
  limit?: number      // default: 50
}
→ { messages: MessageWithConversation[], ... }
```

Returns messages with parent conversation context.

## Session Management

Uses `StreamableHTTPServerTransport` with UUID sessions:

1. **Initialize** (POST without session): Creates new session, returns session ID
2. **Query** (POST/GET with session): Routes to existing transport
3. **Close** (DELETE with session): Terminates session

```typescript
const transports: Map<string, StreamableHTTPServerTransport> = new Map()
```

Sessions stored in memory, cleaned up on close or transport disconnect.

## Configuration

Default port: **37777** (configurable via settings)

Enable/disable in Settings UI. JSON configuration shown for copy-paste:

```json
{
  "mcpServers": {
    "ownyourchat": {
      "url": "http://localhost:37777/mcp"
    }
  }
}
```

## API

| Function | Purpose |
|----------|---------|
| `startMcpServer(port)` | Start HTTP server |
| `stopMcpServer()` | Stop server, close all transports |
| `isMcpServerRunning()` | Check if running |

Called from main process based on `settings.mcpEnabled`.

## CORS

Enabled for all origins:
```typescript
res.setHeader('Access-Control-Allow-Origin', '*')
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id')
```
