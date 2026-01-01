import type { Message, MessagePart, Conversation } from '../../shared/types'

interface MessageTree {
  allMessages: Map<string, Message>
  childrenMap: Map<string, string[]>
  rootIds: string[]
}

function buildMessageTree(messages: Message[]): MessageTree {
  const allMessages = new Map<string, Message>()
  const childrenMap = new Map<string, string[]>()
  const rootIds: string[] = []

  // First pass: index all messages
  for (const msg of messages) {
    allMessages.set(msg.id, msg)
  }

  // Second pass: build children map and find roots
  for (const msg of messages) {
    const parentExists = msg.parentId && allMessages.has(msg.parentId)
    if (!msg.parentId || !parentExists) {
      rootIds.push(msg.id)
    } else {
      const siblings = childrenMap.get(msg.parentId) || []
      if (!siblings.includes(msg.id)) {
        siblings.push(msg.id)
        childrenMap.set(msg.parentId, siblings)
      }
    }
  }

  return { allMessages, childrenMap, rootIds }
}

function getPathToNode(tree: MessageTree, nodeId: string): Message[] {
  const path: Message[] = []
  let currentId: string | null = nodeId

  // Trace backwards from nodeId to root
  while (currentId) {
    const msg = tree.allMessages.get(currentId)
    if (!msg) break
    path.unshift(msg) // Add to front
    currentId = msg.parentId
  }

  return path
}

function extractTextFromParts(parts: MessagePart[]): string {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text
      } else if (part.type === 'source-url') {
        return `[Source: ${part.title || part.url}]${part.snippet ? ` ${part.snippet}` : ''}`
      }
      return ''
    })
    .join('\n')
    .trim()
}

/**
 * Format a conversation for LLM analysis by extracting the default branch path
 * and formatting messages in pseudo-XML format with timestamps.
 */
export function formatConversationForAnalysis(
  conversation: Conversation,
  messages: Message[]
): string {
  // Build tree and get default path
  const tree = buildMessageTree(messages)
  const defaultPath = conversation.currentNodeId
    ? getPathToNode(tree, conversation.currentNodeId)
    : messages // Fallback to all messages if no currentNodeId

  // Format each message in the path as pseudo-XML
  const formattedMessages = defaultPath.map((msg) => {
    const text = extractTextFromParts(msg.parts)
    const timestamp = msg.createdAt.toISOString()

    if (msg.role === 'user') {
      return `<message role="user" timestamp="${timestamp}">${text}</message>`
    } else if (msg.role === 'assistant') {
      return `<message role="assistant">${text}</message>`
    } else {
      return `<message role="system">${text}</message>`
    }
  })

  return formattedMessages.join('\n')
}

/**
 * Format a conversation for Hindsight retention (same as analysis format)
 */
export function formatConversationForRetention(
  conversation: Conversation,
  messages: Message[]
): string {
  return formatConversationForAnalysis(conversation, messages)
}

/**
 * Get the latest message ID in the default path
 */
export function getLatestMessageIdInPath(
  conversation: Conversation,
  messages: Message[]
): string | null {
  if (messages.length === 0) return null

  const tree = buildMessageTree(messages)
  const defaultPath = conversation.currentNodeId
    ? getPathToNode(tree, conversation.currentNodeId)
    : messages

  return defaultPath.length > 0 ? defaultPath[defaultPath.length - 1].id : null
}
