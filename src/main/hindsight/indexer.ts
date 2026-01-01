import { getHindsightClient, getBankId } from './client.js'
import {
  getConversationWithMessages,
  getHindsightIndexRecord,
  upsertHindsightIndexRecord,
  listConversations
} from '../db/operations.js'
import { getSettings } from '../settings.js'
import { analyzeConversation } from './analyzer.js'
import { formatConversationForRetention, getLatestMessageIdInPath } from './formatter.js'

export async function indexConversation(conversationId: string): Promise<{
  success: boolean
  analyzed?: boolean
  retained?: boolean
  skipped?: boolean
  error?: string
}> {
  const client = getHindsightClient()
  if (!client) {
    return { success: false, error: 'Hindsight is not enabled or client not initialized' }
  }

  try {
    const result = await getConversationWithMessages(conversationId)
    if (!result) {
      return { success: false, error: 'Conversation not found' }
    }

    const { conversation, messages } = result
    if (messages.length === 0) {
      return { success: true, skipped: true }
    }

    // Get latest message ID in the default path
    const latestMessageId = getLatestMessageIdInPath(conversation, messages)
    if (!latestMessageId) {
      return { success: true, skipped: true }
    }

    // Check if we need to analyze
    const indexRecord = await getHindsightIndexRecord(conversationId)
    let memoryValueConfidence: number
    let primaryTopic: string

    if (indexRecord && indexRecord.latestMessageId === latestMessageId) {
      // Use cached analysis
      if (indexRecord.memoryValueConfidence === null || indexRecord.primaryTopic === null) {
        return { success: false, error: 'Invalid cached analysis data' }
      }
      memoryValueConfidence = indexRecord.memoryValueConfidence / 100
      primaryTopic = indexRecord.primaryTopic
    } else {
      // Run LLM analysis
      console.log(`[Hindsight] Analyzing conversation ${conversationId}...`)
      const analysis = await analyzeConversation(conversation, messages)
      memoryValueConfidence = analysis.memoryValueConfidence
      primaryTopic = analysis.primaryTopic

      // Save analysis to database
      await upsertHindsightIndexRecord({
        conversationId: conversation.id,
        memoryValueConfidence: Math.round(memoryValueConfidence * 100),
        primaryTopic,
        latestMessageId,
        analyzedAt: new Date(),
        retainedAt: null,
        retainSuccess: null,
        retainError: null
      })
    }

    // Check if confidence meets threshold
    const settings = getSettings()
    const minConfidence = settings.hindsightMinConfidence

    if (memoryValueConfidence < minConfidence) {
      console.log(
        `[Hindsight] Skipping conversation ${conversationId} (confidence: ${memoryValueConfidence.toFixed(2)}, topic: ${primaryTopic})`
      )
      return { success: true, analyzed: true, skipped: true }
    }

    // Retain to Hindsight
    console.log(
      `[Hindsight] Retaining conversation ${conversationId} (confidence: ${memoryValueConfidence.toFixed(2)}, topic: ${primaryTopic})`
    )
    const bankId = getBankId()
    const content = formatConversationForRetention(conversation, messages)

    try {
      await client.retain(bankId, content, {
        documentId: conversation.id, // Use conversation ID for upsert behavior
        context: primaryTopic,
        timestamp: conversation.createdAt
      })

      // Update database with successful retain
      await upsertHindsightIndexRecord({
        conversationId: conversation.id,
        memoryValueConfidence: Math.round(memoryValueConfidence * 100),
        primaryTopic,
        latestMessageId,
        analyzedAt: indexRecord?.analyzedAt || new Date(),
        retainedAt: new Date(),
        retainSuccess: true,
        retainError: null
      })

      return { success: true, analyzed: true, retained: true }
    } catch (retainError) {
      const errorMessage = retainError instanceof Error ? retainError.message : 'Unknown error'

      // Update database with failed retain
      await upsertHindsightIndexRecord({
        conversationId: conversation.id,
        memoryValueConfidence: Math.round(memoryValueConfidence * 100),
        primaryTopic,
        latestMessageId,
        analyzedAt: indexRecord?.analyzedAt || new Date(),
        retainedAt: null,
        retainSuccess: false,
        retainError: errorMessage
      })

      return { success: false, analyzed: true, error: `Retain failed: ${errorMessage}` }
    }
  } catch (error) {
    console.error('Failed to index conversation:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function indexAllConversations(): Promise<{
  success: boolean
  analyzed?: number
  retained?: number
  skipped?: number
  failed?: number
  error?: string
}> {
  const client = getHindsightClient()
  if (!client) {
    return { success: false, error: 'Hindsight is not enabled or client not initialized' }
  }

  try {
    let totalAnalyzed = 0
    let totalRetained = 0
    let totalSkipped = 0
    let totalFailed = 0

    let offset = 0
    const limit = 50
    const batchSize = 5 // Process 5 conversations at a time to avoid rate limits

    while (true) {
      const { items, hasMore } = await listConversations({ limit, offset })

      // Process in batches
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        const batchResults = await Promise.allSettled(
          batch.map((conversation) => indexConversation(conversation.id))
        )

        // Count results
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            const value = result.value
            if (value.success) {
              if (value.analyzed) totalAnalyzed++
              if (value.retained) totalRetained++
              if (value.skipped) totalSkipped++
            } else {
              totalFailed++
              console.error(`Failed to index conversation:`, value.error)
            }
          } else {
            totalFailed++
            console.error(`Failed to index conversation:`, result.reason)
          }
        }

        // Small delay between batches to avoid rate limits
        if (i + batchSize < items.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

      if (!hasMore) {
        break
      }

      offset += limit
    }

    console.log(
      `[Hindsight] Indexing complete: ${totalAnalyzed} analyzed, ${totalRetained} retained, ${totalSkipped} skipped, ${totalFailed} failed`
    )

    return {
      success: true,
      analyzed: totalAnalyzed,
      retained: totalRetained,
      skipped: totalSkipped,
      failed: totalFailed
    }
  } catch (error) {
    console.error('Failed to index all conversations:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function indexConversations(conversationIds: string[]): Promise<{
  success: boolean
  analyzed?: number
  retained?: number
  skipped?: number
  failed?: number
  error?: string
}> {
  const client = getHindsightClient()
  if (!client) {
    return { success: false, error: 'Hindsight is not enabled or client not initialized' }
  }

  try {
    let totalAnalyzed = 0
    let totalRetained = 0
    let totalSkipped = 0
    let totalFailed = 0

    const batchSize = 5

    // Process in batches
    for (let i = 0; i < conversationIds.length; i += batchSize) {
      const batch = conversationIds.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(batch.map((id) => indexConversation(id)))

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const value = result.value
          if (value.success) {
            if (value.analyzed) totalAnalyzed++
            if (value.retained) totalRetained++
            if (value.skipped) totalSkipped++
          } else {
            totalFailed++
            console.error(`Failed to index conversation:`, value.error)
          }
        } else {
          totalFailed++
          console.error(`Failed to index conversation:`, result.reason)
        }
      }

      // Small delay between batches
      if (i + batchSize < conversationIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    return {
      success: true,
      analyzed: totalAnalyzed,
      retained: totalRetained,
      skipped: totalSkipped,
      failed: totalFailed
    }
  } catch (error) {
    console.error('Failed to index conversations:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
