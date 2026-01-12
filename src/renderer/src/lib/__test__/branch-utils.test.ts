import { describe, it, expect } from 'vitest'
import { updateBranchSelection, type MessageTree } from '../branch-utils'
import type { Message } from '../../../../shared/types'

describe('updateBranchSelection', () => {
  it('should update selection and clear descendants of old branch', () => {
    // Create a message tree with branching structure:
    //     root
    //      |
    //    msg1
    //    /  \
    // msg2  msg3
    //   |
    // msg4
    const messages: Message[] = [
      {
        id: 'root',
        conversationId: 'conv1',
        role: 'user',
        parts: [{ type: 'text', text: 'root' }],
        parentId: null,
        siblingIds: [],
        siblingIndex: 0,
        orderIndex: 0,
        createdAt: new Date('2024-01-01')
      },
      {
        id: 'msg1',
        conversationId: 'conv1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'msg1' }],
        parentId: 'root',
        siblingIds: [],
        siblingIndex: 0,
        orderIndex: 1,
        createdAt: new Date('2024-01-01')
      },
      {
        id: 'msg2',
        conversationId: 'conv1',
        role: 'user',
        parts: [{ type: 'text', text: 'msg2' }],
        parentId: 'msg1',
        siblingIds: ['msg3'],
        siblingIndex: 0,
        orderIndex: 2,
        createdAt: new Date('2024-01-01')
      },
      {
        id: 'msg3',
        conversationId: 'conv1',
        role: 'user',
        parts: [{ type: 'text', text: 'msg3' }],
        parentId: 'msg1',
        siblingIds: ['msg2'],
        siblingIndex: 1,
        orderIndex: 3,
        createdAt: new Date('2024-01-01')
      },
      {
        id: 'msg4',
        conversationId: 'conv1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'msg4' }],
        parentId: 'msg2',
        siblingIds: [],
        siblingIndex: 0,
        orderIndex: 4,
        createdAt: new Date('2024-01-01')
      }
    ]

    const tree: MessageTree = {
      allMessages: new Map(messages.map((m) => [m.id, m])),
      childrenMap: new Map([
        ['root', ['msg1']],
        ['msg1', ['msg2', 'msg3']],
        ['msg2', ['msg4']]
      ]),
      rootIds: ['root']
    }

    // Current selections: msg1 -> msg2, msg2 -> msg4
    const currentSelections = {
      msg1: 'msg2',
      msg2: 'msg4'
    }

    // Switch from msg2 to msg3 at the msg1 branch point
    const result = updateBranchSelection(currentSelections, 'msg1', 'msg3', tree)

    // Should update msg1's selection to msg3
    expect(result.msg1).toBe('msg3')

    // Should clear msg2's selection (msg4) since msg2 is a descendant of the old branch
    expect(result.msg2).toBeUndefined()

    // Should not have msg4 in selections
    expect(result.msg4).toBeUndefined()

    // Should only have the new selection
    expect(Object.keys(result)).toEqual(['msg1'])
  })
})
