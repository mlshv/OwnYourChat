# State Management

## Overview

Zustand store in main process, synced to renderer via `@zubridge/electron`.

**Files**:

- `src/main/store.ts` - Main process Zustand store (source of truth)
- `src/renderer/src/lib/store.ts` - Renderer hooks

## Architecture

```
Main Process                    Renderer Process
┌─────────────────┐            ┌──────────────────┐
│  Zustand Store  │ ◄─────────►│  Zubridge Hooks  │
│  (source of     │  IPC sync  │  (read-only)     │
│   truth)        │            │                  │
└─────────────────┘            └──────────────────┘
```

## Store Shape

```typescript
type AppState = {
  providers: {
    chatgpt: ProviderStateSlice
    claude: ProviderStateSlice
    perplexity: ProviderStateSlice
  }
  auth: {
    isLoggedIn: boolean // true if ANY provider connected
    errorReason: string | null
  }
  sync: {
    isRunning: boolean
    lastSyncAt: Date | null
    error: string | null
    progress: number | null
  }
  settings: {
    syncIntervalMinutes: number
    autoSync: boolean
    exportPath: string
    mcpEnabled: boolean
    mcpPort: number
  }
  // Actions
  updateProviderState: (provider, state) => void
  updateSyncState: (state) => void
  updateSettings: (settings) => void
  setAuthState: (auth) => void
}
```

## Renderer Hooks

| Hook                       | Returns                     |
| -------------------------- | --------------------------- |
| `useProvidersState()`      | All provider states         |
| `useAuthState()`           | `{isLoggedIn, errorReason}` |
| `useSettings()`            | App settings                |
| `useUpdateProviderState()` | Action to update provider   |
| `useUpdateSyncState()`     | Action to update sync       |
| `useUpdateSettings()`      | Action to update settings   |
| `useSetAuthState()`        | Action to update auth       |

## What's NOT in Zustand

**Decision (Dec 20, 2025)**: Conversations list kept in React component state, not Zustand.

**Why**:

- Conversations are large (10k+ items possible)
- Need pagination + virtualization anyway
- Zubridge overhead for large arrays
- Simpler to manage locally with `useState`

**Zubridge is used for**:

- Auth state (small, needs real-time sync)
- Provider states (small, needs real-time sync)
- Settings (small, needs persistence)
- Sync status (small, real-time updates)

## Auto-Update Behavior

**Decision (Dec 20, 2025)**: Don't auto-update conversation list if user has scrolled.

```typescript
// App.tsx
const isAtTop = useRef(true)

useEffect(() => {
  if (isAtTop.current) {
    fetchConversations() // Only refresh if at top
  }
}, [lastSyncAt])
```

**Why**: Jarring UX when list refreshes while user is scrolling through old conversations.

## Provider → Auth Derivation

`auth.isLoggedIn` is derived from provider states:

```typescript
updateProviderState: (provider, providerState) => {
  // ... update provider ...
  const anyConnected =
    updated.providers.chatgpt.isOnline ||
    updated.providers.claude.isOnline ||
    updated.providers.perplexity.isOnline
  updated.auth.isLoggedIn = anyConnected
}
```

Single provider connecting = logged in. All providers disconnected = logged out.
