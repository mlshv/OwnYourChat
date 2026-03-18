![OwnYourChat](./hero.png)

# OwnYourChat

One app to sync all your AI chats — ChatGPT, Claude, Perplexity — into a local database you own.

Your data is scattered across multiple silos, each one hoping you'll never leave. OwnYourChat syncs them all into a local SQLite database you control. Open source. Extensible. Local-first.

## Why?

AI conversations are locked in corporate silos. You can't search across providers. You can't share context between them. When you're in Claude, it doesn't know what you researched in Perplexity yesterday.

We pay for these tools. We give them our data. And we get no practical way to access our own conversations together.

OwnYourChat is the fix. Think **Obsidian, but for AI chats** — open, hackable, and yours.

## This Fork

This fork is focused on one operational goal:

- Run OwnYourChat on macOS as a local background service.
- Keep local chat data synchronized on a schedule.
- Expose that local data over MCP so another AI agent can query it.

In practical terms, this lets me use one agent as my working assistant and give it access to my historical context synced from ChatGPT/Claude/Perplexity.

## Features

- **🔄 Automatic Sync** — Syncs conversations from ChatGPT, Claude, and Perplexity to a local SQLite database
- **🔍 Search & Browse** — Search across all conversations and browse your chat history
- **🌳 Branch Navigation** — Navigate through conversation branches (for chats with multiple response variations)
- **📤 Export** — Export conversations to JSON or Markdown format
- **💾 Offline Access** — Access all synced conversations without an internet connection
- **🖼️ Attachment Support** — Preserves images and files from conversations
- **🤖 MCP Server** — Expose your chats to AI assistants via [Model Context Protocol](https://modelcontextprotocol.io)

## MCP Integration

OwnYourChat includes a built-in MCP server that lets AI assistants (like Claude in Cursor) search and read your synced conversations. Available tools:

- `list_conversations` — List all synced conversations
- `get_conversation_with_messages` — Get a specific conversation with full message history
- `search_conversations` — Search conversations by keywords in titles
- `search_messages` — Search messages by keywords in content

Enable the MCP server from Settings in the app.

## Roadmap

**Coming soon:**

- [ ] Gemini support
- [ ] Grok support

**Future vision:**

- [ ] Plugin system — build and share extensions
- [ ] Cross-provider context — continue any chat with any model
- [ ] Native chat UI with BYOK (Bring Your Own API Keys)
- [ ] Voice mode
- [ ] Shared memory layer across all your AI chats

## Installation

There are no downloadable builds available yet. Sign up for the waitlist at [ownyour.chat](https://ownyour.chat) to be notified when builds are ready.

To use the app now, clone the repository and run it locally:

```bash
git clone https://github.com/mlshv/ownyourchat.git
cd ownyourchat
pnpm install
pnpm dev
```

## macOS Background Agent Setup

This setup starts OwnYourChat automatically when you log in and keeps it running in background mode.

### 1) Build once

```bash
pnpm build
```

### 2) Install launchd agent

```bash
./scripts/install-launchagent-mac.sh
```

What this does:

- Creates a LaunchAgent plist in `~/Library/LaunchAgents`.
- Starts OwnYourChat with `OYC_BACKGROUND=1` so no window is required.
- Sets `OYC_SYNC_INTERVAL_MS=1800000` (30 minutes) by default.
- Configures `RunAtLoad` so sync starts after each macOS login.

### 3) Verify MCP server from terminal

```bash
curl -i -sS http://localhost:37777/health | sed -n '1,20p'
```

### 4) Uninstall launchd agent

```bash
./scripts/uninstall-launchagent-mac.sh
```

### Notes

- If you want a different sync interval, edit `OYC_SYNC_INTERVAL_MS` in the install script and re-run it.
- If your MCP port is changed in app settings, update your client config and health-check command.

## Development

Run tests:

```bash
pnpm test
```

Type checking:

```bash
pnpm typecheck
```

## Building

```bash
# For macOS
pnpm build:mac

# For Windows
pnpm build:win

# For Linux
pnpm build:linux
```

## Database Management

Open Drizzle Studio to inspect the database:

```bash
pnpm db:studio
```

## Principles

- **Local-first** — Your data stays on your machine
- **No data collection** — We don't collect user data
- **No paywalls on essentials** — Core functionality is free
- **Open source** — Inspect, modify, contribute

## Links

- 🌐 Website: [ownyour.chat](https://ownyour.chat)
- 🐦 Twitter: [@ownyourchat](https://twitter.com/ownyourchat)
- 💻 GitHub: [github.com/mlshv/ownyourchat](https://github.com/mlshv/ownyourchat)

## License

MIT

## Author

Misha Malyshev
