import type { Message } from '../../../shared/types'

export interface MessageTree {
  allMessages: Map<string, Message>
  childrenMap: Map<string, string[]> // parentId -> childIds (node IDs)
  rootIds: string[] // Messages with no parent (usually just one)
}

/**
 * Build a tree structure from a flat array of messages.
 * Messages are keyed by their ID (which matches nodeId from ChatGPT).
 */
export function buildMessageTree(messages: Message[]): MessageTree {
  const allMessages = new Map<string, Message>()
  const childrenMap = new Map<string, string[]>()
  const rootIds: string[] = []

  // First pass: index all messages
  for (const msg of messages) {
    allMessages.set(msg.id, msg)
  }

  // Second pass: build children map and find roots
  // A message is a root if it has no parentId OR if its parent doesn't exist in our messages
  // (parent could be a filtered-out system node)
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

/**
 * Get the path from root to a specific node (used for default path).
 * Returns messages in order from root to the target node.
 */
export function getPathToNode(tree: MessageTree, nodeId: string): Message[] {
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

/**
 * Get the display path based on branch selections.
 * If no selections made, uses defaultEndpoint to determine the default path.
 *
 * @param tree - The message tree
 * @param selections - Map of parentId -> selected childId
 * @param defaultEndpoint - The default endpoint node (current_node from ChatGPT)
 */
export function getDisplayPath(
  tree: MessageTree,
  selections: Record<string, string>,
  defaultEndpoint: string | null
): Message[] {
  // If no selections and we have a default endpoint, trace back from there
  if (Object.keys(selections).length === 0 && defaultEndpoint) {
    return getPathToNode(tree, defaultEndpoint)
  }

  // No default endpoint and no selections - walk from root using first child at each branch
  if (Object.keys(selections).length === 0 && tree.rootIds.length === 0) {
    return []
  }

  // Start from root and follow selections (or first child when no selection)
  const path: Message[] = []
  let currentId: string | null = tree.rootIds[0] || null

  while (currentId) {
    const msg = tree.allMessages.get(currentId)
    if (!msg) break
    path.push(msg)

    // Get children of this message
    const children = tree.childrenMap.get(currentId) || []
    if (children.length === 0) break

    // Use selection if exists, otherwise use first child (or follow default path)
    if (selections[currentId]) {
      currentId = selections[currentId]
    } else if (defaultEndpoint) {
      // Try to find a child that leads to defaultEndpoint
      const pathToDefault = getPathToNode(tree, defaultEndpoint)
      const childOnPath = children.find((childId) => pathToDefault.some((m) => m.id === childId))
      currentId = childOnPath || children[0]
    } else {
      currentId = children[0]
    }
  }

  return path
}

/**
 * When switching branches, we need to update selections and potentially
 * clear downstream selections that are no longer valid.
 *
 * @param currentSelections - Current branch selections
 * @param parentId - The parent whose child selection is changing
 * @param newChildId - The new selected child
 * @param tree - The message tree
 * @returns Updated selections
 */
export function updateBranchSelection(
  currentSelections: Record<string, string>,
  parentId: string,
  newChildId: string,
  tree: MessageTree
): Record<string, string> {
  const newSelections = { ...currentSelections }

  // Set the new selection
  newSelections[parentId] = newChildId

  // Clear any selections that are descendants of the old selection at this branch point
  // (they may no longer be valid on the new branch)
  const oldChildId = currentSelections[parentId]
  if (oldChildId && oldChildId !== newChildId) {
    // Find all descendants of oldChildId and remove their selections
    const toRemove = new Set<string>()
    const queue = [oldChildId]

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      toRemove.add(nodeId)
      const children = tree.childrenMap.get(nodeId) || []
      queue.push(...children)
    }

    for (const nodeId of toRemove) {
      delete newSelections[nodeId]
    }
  }

  return newSelections
}
