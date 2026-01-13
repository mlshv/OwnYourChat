# Electron QA/Debug Agent

## Overview

A Claude Code subagent that provides automated QA testing and debugging capabilities for the OwnYourChat Electron application. This agent acts as a "virtual user" - performing UI interactions, capturing screenshots, and reading console output without requiring human involvement.

**Purpose**: Isolate debugging/QA functionality from the main coding agent to preserve context window space while providing on-demand app inspection.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Claude Code Agent                       │
│  - Code exploration, editing, implementation                     │
│  - Delegates QA/debug tasks to subagent                         │
│  - Does NOT have electron-mcp-server access                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Task delegation (foreground)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Electron QA/Debug Agent                         │
│  .claude/agents/electron-qa-debug.md                            │
│                                                                  │
│  Capabilities:                                                   │
│  - UI automation (click, input, form filling)                   │
│  - Screenshot capture → .context/screenshots/                   │
│  - Renderer console log capture                                 │
│  - Main process log capture                                     │
│  - Element inspection and DOM analysis                          │
│                                                                  │
│  Tools: Read, Glob, Grep, Write (screenshots only)              │
│  MCP: electron-mcp-server (exclusive access)                    │
│  Model: Sonnet                                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Chrome DevTools Protocol
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OwnYourChat Electron App                       │
│  - Must have CDP enabled in main process                        │
│  - Running via `pnpm dev`                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Use Cases

### 1. UI Verification
Main agent asks: *"Go to the Settings page and verify the MCP toggle is visible"*

The QA agent:
1. Navigates to Settings
2. Inspects DOM for MCP toggle element
3. Reports visibility status and any console errors

### 2. Screenshot Capture
Main agent asks: *"Take a screenshot of the conversation list with the sidebar open"*

The QA agent:
1. Ensures sidebar is open
2. Captures screenshot via CDP
3. Saves to `.context/screenshots/` with contextual name
4. Returns file path to main agent

### 3. Console Debugging
Main agent asks: *"What errors appear in the console when clicking the sync button?"*

The QA agent:
1. Clears/notes current console state
2. Clicks sync button
3. Captures any new console errors/warnings
4. Returns formatted log output

### 4. Regression Testing
Main agent asks: *"Test the login flow for ChatGPT provider"*

The QA agent:
1. Opens provider login
2. Verifies login window appears
3. Checks for console errors
4. Reports overall flow status

### 5. State Inspection
Main agent asks: *"Check what's in the Zustand store after syncing"*

The QA agent:
1. Executes console command to dump store state
2. Returns relevant state snapshot

## Configuration

### Subagent File Location

```
.claude/agents/electron-qa-debug.md
```

Project-level placement ensures:
- Team members can use it (via version control)
- MCP server configuration is project-specific
- Screenshot paths are relative to project

### MCP Server Setup

The agent requires `electron-mcp-server` configured as an MCP server. This must be added to Claude Code's MCP configuration for the project:

```bash
# Add MCP server to project (run once)
claude mcp add electron npx electron-mcp-server
```

**Security Tier**: `development` (full access for comprehensive debugging)

### App Requirement

The Electron app must have CDP (Chrome DevTools Protocol) enabled. Add to `src/main/index.ts`:

```typescript
mainWindow.webContents.debugger.attach('1.3');
```

## Agent Specification

### Frontmatter

```yaml
---
name: electron-qa-debug
description: >
  Electron QA and debugging specialist with exclusive access to the running app.
  Use proactively for UI verification, screenshot capture, console log analysis,
  and debugging runtime issues. Runs in foreground (required for MCP access).
  Cannot modify source code.
tools: Read, Glob, Grep, Write
disallowedTools: Edit
model: sonnet
---
```

### Tool Restrictions

| Tool | Access | Purpose |
|------|--------|---------|
| Read | Yes | Read source code for context during debugging |
| Glob | Yes | Find files when diagnosing issues |
| Grep | Yes | Search code for relevant patterns |
| Write | Yes | Save screenshots to `.context/screenshots/` only |
| Edit | No | Cannot modify source code |
| Bash | No | Uses MCP for app interaction instead |

### MCP Tools Available

From `electron-mcp-server`:

| Tool | Purpose |
|------|---------|
| `click` | Click elements by selector |
| `input` | Fill form fields |
| `screenshot` | Capture current window state |
| `get_console_logs` | Retrieve renderer console output |
| `get_main_logs` | Retrieve main process logs |
| `evaluate` | Execute JS in renderer context |
| `get_element` | Inspect DOM elements |

## Behavior Specification

### Trigger Conditions

Claude should delegate to this agent when:
- Discussing UI bugs or visual issues
- Needing to verify a change worked
- Debugging console errors
- Capturing screenshots for documentation/bug reports
- Testing user flows without human involvement

### Execution Mode

- **Foreground**: Blocks main conversation while running (required for MCP tool access)
- **Permission inheritance**: Uses parent's approved permissions
- **Interactive**: Can prompt for permissions if needed

**Why foreground?** MCP tools are not available to background subagents. Since this agent's primary purpose is interacting with the Electron app via `electron-mcp-server`, it must run in foreground mode.

### Error Handling

When errors occur, the agent should:

1. **App not running**: Report "Electron app is not running. Start with `pnpm dev`" and stop
2. **Element not found**: Attempt to diagnose (check if page loaded, inspect DOM, look for similar selectors)
3. **CDP connection failed**: Report connection issue and suggest checking if app has CDP enabled
4. **MCP timeout**: Retry once, then report failure with context

### Output Format

Adaptive based on request:

**Concise** (for simple checks):
```
Settings page loaded. MCP toggle visible and enabled. No console errors.
```

**Detailed** (for debugging):
```
## Console Output Analysis

### Errors (2)
1. [TypeError] Cannot read property 'id' of undefined
   - Source: src/renderer/src/components/ConversationList.tsx:45
   - Occurred when: Clicking conversation item

2. [NetworkError] Failed to fetch
   - Source: src/main/sync/providers/chatgpt/api.ts:123
   - Context: During sync attempt

### Warnings (1)
- React DevTools: Component update cycle detected
```

### Screenshot Handling

Screenshots saved to: `.context/screenshots/`

Naming convention (agent decides contextually):
- `settings-mcp-toggle-2024-01-12.png` - Feature-specific
- `error-state-conversation-list.png` - Error documentation
- `regression-login-flow-step-3.png` - Test sequence

## Integration with Main Agent

### Example Delegation Patterns

```
# Simple verification
"Use the QA agent to check if the sidebar renders correctly"

# Screenshot request
"Have the QA agent screenshot the conversation detail view"

# Debug request
"Ask the QA agent what console errors appear when syncing Claude"

# Flow testing
"Use the QA agent to test the complete onboarding flow"
```

### Result Consumption

The main agent receives:
- Summary of findings
- Screenshot file paths (can read with Read tool if needed)
- Specific error details for fixing
- Suggested areas to investigate

## Limitations

1. **Cannot modify code**: Read-only access to source files
2. **Requires running app**: Cannot start the app itself
3. **CDP dependency**: App must have debugger attached
4. **Single window**: Operates on main window only
5. **No subagent spawning**: Cannot delegate to other subagents

## Related Documentation

- [Sub-agent Guide](/.context/sub-agent.md) - Official Claude Code subagent documentation
- [Architecture](./architecture.md) - OwnYourChat architecture overview
- [electron-mcp-server](https://github.com/anthropics/electron-mcp-server) - MCP server for Electron apps
