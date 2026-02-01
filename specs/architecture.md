# Architecture

## Overview

OwnYourChat is an Electron desktop app that syncs AI conversations from ChatGPT, Claude, and Perplexity into a local SQLite database.

**Tech Stack**: Electron 39 + React 19 + TypeScript + Drizzle ORM + Zustand

## Three-Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process                             │
│  src/main/index.ts                                          │
│  - App lifecycle, window management                         │
│  - Provider registry & sync                                 │
│  - Database (SQLite + Drizzle)                              │
│  - MCP server                                               │
│  - Zustand store (source of truth)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC (contextBridge)
┌─────────────────────┴───────────────────────────────────────┐
│                    Preload Script                            │
│  src/preload/index.ts                                       │
│  - Exposes window.api to renderer                           │
│  - Zubridge handlers for state sync                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────┐
│                   Renderer Process                           │
│  src/renderer/src/App.tsx                                   │
│  - React UI                                                 │
│  - Consumes state via Zubridge hooks                        │
└─────────────────────────────────────────────────────────────┘
```

## Key Entry Points

| Process  | Entry                       | Purpose                              |
| -------- | --------------------------- | ------------------------------------ |
| Main     | `src/main/index.ts`         | App lifecycle, creates BrowserWindow |
| Preload  | `src/preload/index.ts`      | Bridges IPC to renderer              |
| Renderer | `src/renderer/src/main.tsx` | React root                           |

## Directory Structure

```
src/
├── main/
│   ├── index.ts           # Entry, app lifecycle, menus
│   ├── ipc.ts             # IPC handlers (60+ channels)
│   ├── store.ts           # Zustand store
│   ├── settings.ts        # Persisted settings (~/.config/ownyourchat)
│   ├── update-manager.ts  # electron-updater
│   ├── db/                # Drizzle schema, operations, migrations
│   ├── sync/              # Provider system
│   │   ├── providers/     # ChatGPT, Claude, Perplexity
│   │   └── scheduler.ts   # Periodic sync
│   ├── mcp/               # MCP server
│   ├── export/            # Markdown/JSON export
│   └── storage/           # Storage adapter interface
├── renderer/src/
│   ├── App.tsx            # Main React component
│   ├── components/        # UI components
│   └── lib/               # Utilities (store hooks, branch-utils)
├── preload/
│   └── index.ts           # contextBridge API
└── shared/
    └── types.ts           # Shared types, IPC_CHANNELS enum
```

## Key Dependencies

| Package                          | Purpose             |
| -------------------------------- | ------------------- |
| `drizzle-orm` + `better-sqlite3` | Database            |
| `zustand` + `@zubridge/electron` | Cross-process state |
| `@modelcontextprotocol/sdk`      | MCP server          |
| `electron-updater`               | Auto-updates        |
| `virtua`                         | Virtual scrolling   |
| `shadcn` + `tailwindcss`         | UI components       |

## Custom Protocol

`attachment://` protocol registered in main process (`index.ts:108`) serves local attachment files to renderer.

## Path Aliases

Configured in `electron.vite.config.ts`:

- Main: `@/` → `src/main/`, `@shared/` → `src/shared/`
- Renderer: `@/` → `src/renderer/src/`, `@shared/` → `src/shared/`
