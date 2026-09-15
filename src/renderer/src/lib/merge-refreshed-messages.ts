import type { Message } from '@shared/types'

// Replace loaded messages even when their count stays the same (e.g. restored sources).
// Older pages stay unloaded; any pages loaded while the request ran stay visible.
export function mergeRefreshedMessages(loaded: Message[], refreshed: Message[]): Message[] {
  const loadedIds = new Set(loaded.map((message) => message.id))
  const newestOrder = loaded.reduce((max, message) => Math.max(max, message.orderIndex), -1)
  return refreshed
    .filter((message) => loadedIds.has(message.id) || message.orderIndex > newestOrder)
    .sort((a, b) => a.orderIndex - b.orderIndex)
}
