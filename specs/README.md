# Specifications

Detailed documentation including engineering decisions and rationale.

| Spec                                                                         | Description                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [architecture.md](architecture.md)                                           | System overview, 3-process Electron model, directory structure |
| [providers.md](providers.md)                                                 | ChatGPT/Claude/Perplexity sync, authentication, polling        |
| [database.md](database.md)                                                   | SQLite schema, message tree structure, upsert patterns         |
| [ipc.md](ipc.md)                                                             | IPC channels, stale-while-revalidate, preload bridge           |
| [state-management.md](state-management.md)                                   | Zustand + Zubridge, cross-process state sync                   |
| [mcp-server.md](mcp-server.md)                                               | MCP server for AI assistants, HTTP transport                   |
| [frontend.md](frontend.md)                                                   | React components, branch navigation, virtualization            |
| [attachments.md](attachments.md)                                             | File downloading, caching, custom protocol                     |
| [export.md](export.md)                                                       | Markdown/JSON export, attachment handling                      |
| [electron-qa-debug-agent.md](electron-qa-debug-agent.md)                     | QA/debug subagent spec, MCP integration                        |
| [electron-qa-debug-agent-implementation-plan.md](electron-qa-debug-agent-implementation-plan.md) | Step-by-step setup guide                                       |
