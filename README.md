# OwnYourChat

A desktop application that syncs your ChatGPT and Claude conversations to a local SQLite database, giving you complete ownership and offline access to your AI chat history.

## Features

- **🔄 Automatic Sync** - Syncs conversations from ChatGPT and Claude to a local SQLite database
- **🔍 Search & Browse** - Search across all conversations and browse your chat history
- **🌳 Branch Navigation** - Navigate through conversation branches (for chats with multiple response variations)
- **📤 Export** - Export conversations to JSON or Markdown format
- **💾 Offline Access** - Access all synced conversations without an internet connection
- **🖼️ Attachment Support** - Preserves images and files from conversations

## Installation

There are no downloadable builds available yet. Sign up for the waitlist at [ownyour.chat](https://ownyour.chat) to be notified when builds are ready.

To use the app now, you'll need to clone the repository and run it locally:

```bash
# Clone the repository
git clone https://github.com/mlshv/ownyourchat.git
cd ownyourchat

# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

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

## License

MIT

## Author

Misha Malyshev

- Website: [ownyour.chat](https://ownyour.chat)
- GitHub: [github.com/mlshv/ownyourchat](https://github.com/mlshv/ownyourchat)
