# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OwnYourChat is an Electron desktop application that syncs AI conversations from ChatGPT, Claude, and Perplexity into a local SQLite database. Built with Electron + React + TypeScript, using Drizzle ORM for database management.

## Development Commands

```bash
# Development
pnpm dev                    # Start app in dev mode with hot reload
pnpm test                   # Run tests in watch mode
pnpm test:run               # Run tests once
pnpm typecheck              # Type check all code (main + renderer)
pnpm typecheck:node         # Type check main process only
pnpm typecheck:web          # Type check renderer process only
pnpm lint                   # Run ESLint
pnpm format                 # Format code with Prettier

# Database
pnpm db:studio              # Open Drizzle Studio to inspect database

# Building
pnpm build                  # Type check and build
pnpm build:mac              # Build for macOS
pnpm build:win              # Build for Windows
pnpm build:linux            # Build for Linux

# UI Components
pnpm ui:add [component]     # Add shadcn component (e.g., pnpm ui:add button)
```

## Architecture

### Three-Process Electron Architecture

1. **Main Process** (`src/main/`): Node.js process managing app lifecycle, providers, database, and MCP server
2. **Renderer Process** (`src/renderer/`): React UI running in browser context
3. **Preload** (`src/preload/`): Bridge exposing IPC to renderer via `window.api`

Communication flows Main ← IPC → Renderer, defined in `src/shared/types.ts` (IPC_CHANNELS enum).

### Provider System

**Provider Registry** (`src/main/sync/providers/registry.ts`): Singleton managing all sync providers (ChatGPT, Claude, Perplexity).

Each provider extends `BaseProvider` (`src/main/sync/providers/base.ts`) and implements:
- `sync()`: Fetch conversations from provider API and persist to database
- `showLogin()` / `logout()`: Authentication via WebContentsView
- `restoreConnection()`: Re-authenticate on app restart
- `refreshAndPersistConversation()`: Update single conversation with latest messages
- `downloadAttachment()`: Download files/images from provider

Providers run periodic polling (default 60s interval) when connected. State persisted in `provider_state` table.

### Database Schema

Drizzle ORM with SQLite (`src/main/db/schema.ts`):

- `conversations`: Chat threads with provider, title, timestamps
- `messages`: Message tree with `parentId`/`siblingIds` for branch navigation
- `attachments`: Files/images with local paths and provider metadata
- `provider_state`: Connection status, last sync time, errors per provider
- `user_preferences`: App settings like onboarding completion

**Message Tree Structure**: Messages form a tree via `parentId`/`siblingIds`/`siblingIndex`. Frontend uses `buildMessageTree()` and `getDisplayPath()` (`src/renderer/src/lib/branch-utils.ts`) to navigate branches and render selected path.

### State Management

- **Main Process**: Zustand store (`src/main/store.ts`) synced to renderer via `@zubridge/electron`
- **Renderer**: React hooks consume store via `useAuthState()`, `useSyncState()`, etc. (`src/renderer/src/lib/store.ts`)

Store holds provider states, sync status, settings. Updates flow Main → Zustand → Renderer.

### MCP Server

Built-in Model Context Protocol server (`src/main/mcp/server.ts`) exposes conversation data to AI assistants:

- `list_conversations`: Paginated conversation list
- `get_conversation_with_messages`: Full conversation with messages
- `search_conversations`: Search by title keywords
- `search_messages`: Search message content

Runs on HTTP (default port 37777) with StreamableHTTPServerTransport. Enable in Settings UI.

## Path Aliases

Configured in `electron.vite.config.ts`:

- Main process: `@/` → `src/main/`, `@shared/` → `src/shared/`
- Renderer: `@/` or `@renderer/` → `src/renderer/src/`, `@shared/` → `src/shared/`

## Testing

Uses Vitest. Provider utilities have test files in `__test__/` subdirectories (e.g., `src/main/sync/providers/chatgpt/__test__/utils.test.ts`).

## Icon Imports

Always use `-Icon` suffix for Phosphor icons: `AppleLogoIcon` not `AppleLogo`.

## TypeScript Conventions

Use `type` for type aliases, not `interface` (unless defining OOP interfaces intended for class implementation).

## Development Workflow

**IMPORTANT: Always run `pnpm typecheck` after making code changes to catch TypeScript errors before completing the task.**

## UI & Styling

### Squircle Border Radiuses

All elements have `corner-shape: squircle` applied globally (`src/renderer/src/globals.css`). This makes rounded corners use squircle shapes instead of circular arcs.

**For elements that must be truly circular (not squircle):**
```css
.round-element {
  corner-shape: round;
}
```

Common cases requiring `corner-shape: round`:
- Radio button indicators
- Checkbox indicators (when using `rounded-full`)
- Avatar/profile images
- Loading spinners
- Circular badges or dots

## Build System

- **electron-vite**: Dev server and build tool
- **electron-builder**: Creates distributable packages
- Custom pnpm config restricts building to electron and esbuild only (`onlyBuiltDependencies`)
