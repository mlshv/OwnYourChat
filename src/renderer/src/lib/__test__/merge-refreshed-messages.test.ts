import { describe, expect, it } from 'vitest'
import type { Message } from '@shared/types'
import { mergeRefreshedMessages } from '../merge-refreshed-messages'

const message = (orderIndex: number): Message => ({
  id: `m${orderIndex}`,
  conversationId: 'conversation',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Answer' }],
  createdAt: new Date(0),
  orderIndex,
  parentId: null,
  siblingIds: [],
  siblingIndex: 0
})

describe('mergeRefreshedMessages', () => {
  it('updates content and metadata without requiring a new message', () => {
    const old = message(1)
    const refreshed: Message = {
      ...old,
      model: 'gpt-4o',
      metadata: { finishReason: 'stop' },
      parts: [{ type: 'source-url', sourceId: 'source', url: 'https://example.com' }]
    }
    expect(mergeRefreshedMessages([old], [refreshed])).toEqual([refreshed])
  })
  it('keeps loaded pages and appends new messages without loading the entire history', () => {
    const result = mergeRefreshedMessages([message(2), message(3)], [0, 1, 2, 3, 4].map(message))
    expect(result.map((m) => m.orderIndex)).toEqual([2, 3, 4])
  })
})
