# Frontend

## Overview

React 19 UI with TailwindCSS + shadcn components.

**Entry**: `src/renderer/src/main.tsx` → `App.tsx`

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `App` | `App.tsx` | Root, state management |
| `ChatList` | `components/ChatList.tsx` | Conversation sidebar |
| `ChatView` | `components/ChatView.tsx` | Message display |
| `ExportModal` | `components/ExportModal.tsx` | Export dialog |
| `SettingsModal` | `components/SettingsModal.tsx` | Settings UI |
| `OnboardingScreen` | `components/OnboardingScreen.tsx` | First-run flow |
| `AssistantMessage` | `components/AssistantMessage.tsx` | AI message rendering |
| `UserMessageBubble` | `components/UserMessageBubble.tsx` | User message rendering |
| `PartsRenderer` | `components/PartsRenderer.tsx` | Message parts (text, sources) |
| `BranchNavigation` | `components/BranchNavigation.tsx` | Branch selector UI |

## Branch Navigation

**File**: `src/renderer/src/lib/branch-utils.ts`

Handles message tree traversal for conversations with branches (ChatGPT/Claude) and linear conversations (Perplexity).

### Message Tree Structure

```typescript
interface MessageTree {
  allMessages: Map<string, Message>
  childrenMap: Map<string, string[]>  // parentId -> childIds
  rootIds: string[]                    // Messages with no parent
}
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `buildMessageTree(messages)` | Create tree from flat array |
| `getDisplayPath(tree, selections, defaultEndpoint)` | Get visible message sequence |
| `getPathToNode(tree, nodeId)` | Trace path from root to node |
| `updateBranchSelection(selections, parentId, newChildId, tree)` | Update selection, clear invalid downstream |

### Tree vs Linear Handling

**Decision (Jan 6, 2026)**: `getDisplayPath` handles both patterns.

**Tree structure (ChatGPT/Claude)**:
- Messages have `parentId` linking to parent
- Multiple children = branching (alternative responses)
- Navigate via `currentNodeId` (default) or `selections`

**Linear structure (Perplexity)**:
- All messages have `parentId: null`
- All messages are "roots"
- Detection: `hasOnlyIndependentRoots && rootIds.length > 1`
- Returns all roots sorted by `orderIndex`

```typescript
// Special case for linear conversations
if (hasOnlyIndependentRoots && tree.rootIds.length > 1) {
  return tree.rootIds
    .map((id) => tree.allMessages.get(id))
    .sort((a, b) => a.orderIndex - b.orderIndex)
}
```

## Virtualization

**Library**: `virtua`

ChatList and ChatView use virtualized scrolling for performance with 10k+ conversations.

**Decision (Dec 20, 2025)**: Pagination + virtualization both required.
- Pagination: Don't load all 10k into memory
- Virtualization: Only render visible items

## Message Rendering

### AssistantMessage

- Markdown rendering via `react-markdown`
- Math equations via KaTeX (`$$...$$`)
- Image attachments (auto-download)
- File attachments with type-specific icons
- Source citations (Perplexity)

### PartsRenderer

Renders `MessagePart[]` from message content:
- `TextPart`: Markdown text
- `SourceUrlPart`: Citation with URL (Perplexity sources)

## Styling

| Tech | Purpose |
|------|---------|
| TailwindCSS 4 | Utility classes |
| shadcn | Component library |
| `corner-shape: squircle` | Global squircle borders |

**Squircle exception**: Use `corner-shape: round` for truly circular elements (radio buttons, avatars, spinners).

## State Flow

```
Zubridge hooks (auth, sync, settings)
          │
          ▼
      App.tsx
          │
          ├── conversations (useState)
          ├── selectedConversation
          ├── allMessages
          ├── branchSelections
          └── displayedMessages (derived)
                    │
                    ▼
              ChatView
```

Conversations in React state, not Zustand (see state-management.md).
