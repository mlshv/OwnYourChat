# IPC Communication

## Overview

Main ↔ Renderer communication via Electron IPC. All channels defined in `src/shared/types.ts` (`IPC_CHANNELS` enum).

**Files**:

- `src/shared/types.ts` - Channel definitions, `ElectronAPI` type
- `src/main/ipc.ts` - Handler implementations
- `src/preload/index.ts` - `contextBridge` exposure

## Channel Categories

### Conversations

| Channel                           | Purpose                                    |
| --------------------------------- | ------------------------------------------ |
| `conversations:list`              | Paginated list → `{items, total, hasMore}` |
| `conversations:get`               | Full conversation with messages            |
| `conversations:get-messages-page` | Load older messages (pagination)           |
| `conversations:search`            | Search by title keywords                   |
| `conversations:refresh`           | Fetch latest from API                      |

### Export

| Channel               | Purpose                        |
| --------------------- | ------------------------------ |
| `export:conversation` | Export single conversation     |
| `export:all`          | Batch export all conversations |

### Auth

| Channel               | Purpose                   |
| --------------------- | ------------------------- |
| `auth:login`          | Initiate provider login   |
| `auth:logout`         | Logout provider(s)        |
| `auth:status`         | Query current auth state  |
| `auth:status-changed` | Event: auth state changed |

### Attachments

| Channel               | Purpose                      |
| --------------------- | ---------------------------- |
| `attachment:download` | Download file to local disk  |
| `attachment:open`     | Open in default app          |
| `attachment:exists`   | Check if file cached locally |

### Settings

| Channel                | Purpose                 |
| ---------------------- | ----------------------- |
| `settings:get`         | Get app settings        |
| `settings:set`         | Update app settings     |
| `user-preferences:get` | Get user preferences    |
| `user-preferences:set` | Update user preferences |

### Debug

| Channel                          | Purpose                   |
| -------------------------------- | ------------------------- |
| `debug:toggle-{provider}-view`   | Show/hide WebContentsView |
| `debug:open-{provider}-devtools` | Open DevTools             |

### Menu Events

| Channel                   | Purpose               |
| ------------------------- | --------------------- |
| `menu:export-click`       | Export menu clicked   |
| `menu:settings-click`     | Settings menu clicked |
| `menu:debug-panel-toggle` | Debug panel toggled   |

### Utilities

| Channel               | Purpose                 |
| --------------------- | ----------------------- |
| `dialog:pick-folder`  | Folder selection dialog |
| `shell:open-external` | Open URL in browser     |

## Stale-While-Revalidate

**Decision (Dec 17, 2025)**: `conversations:refresh` handler implements stale-while-revalidate.

**Before (problematic)**:

```typescript
// Delete messages first, then fetch
await db.deleteMessages(conversationId) // ← Data loss if fetch fails!
const fresh = await provider.fetch(id)
```

**After (robust)**:

```typescript
// Fetch first, only replace on success
const fresh = await provider.refreshAndPersistConversation(id)
if (!fresh) {
  return existingData // Return cached data on failure
}
```

**Why**: Desktop app must work offline. Switching conversations while offline should show cached messages, not empty state.

## Preload Bridge

`src/preload/index.ts` exposes `window.api`:

```typescript
contextBridge.exposeInMainWorld('api', {
  conversations: {
    list: (opts) => ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_LIST, opts),
    get: (id, opts) => ipcRenderer.invoke(IPC_CHANNELS.CONVERSATIONS_GET, id, opts)
    // ...
  },
  auth: {
    login: (provider) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, provider)
    // ...
  },
  menu: {
    onExportClick: (cb) => ipcRenderer.on(IPC_CHANNELS.MENU_EXPORT_CLICK, cb),
    onSettingsClick: (cb) => ipcRenderer.on(IPC_CHANNELS.MENU_SETTINGS_CLICK, cb)
    // ...
  }
})
```

## Type Safety

`ElectronAPI` interface in `src/shared/types.ts` provides full TypeScript coverage:

```typescript
declare global {
  interface Window {
    api: ElectronAPI
  }
}
```

Renderer uses `window.api.conversations.list()` with full type inference.
