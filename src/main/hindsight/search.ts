import { getHindsightClient, getBankId } from './client.js'

export async function recallMemories(query: string): Promise<{
  success: boolean
  results?: Array<{
    content: string
    score: number
    metadata?: Record<string, unknown>
  }>
  error?: string
}> {
  const client = getHindsightClient()
  if (!client) {
    return { success: false, error: 'Hindsight is not enabled or client not initialized' }
  }

  try {
    const bankId = getBankId()
    const response = await client.recall(bankId, query)

    // Transform hindsight response to our format
    const results = response.results?.map((result) => ({
      content: result.text || '',
      score: 1.0, // Hindsight doesn't return scores in RecallResult
      metadata: {
        id: result.id,
        type: result.type,
        context: result.context,
        entities: result.entities
      } as Record<string, unknown>
    }))

    return {
      success: true,
      results: results || []
    }
  } catch (error) {
    console.error('Failed to recall memories:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function reflectOnTopic(query: string): Promise<{
  success: boolean
  reflection?: string
  error?: string
}> {
  const client = getHindsightClient()
  if (!client) {
    return { success: false, error: 'Hindsight is not enabled or client not initialized' }
  }

  try {
    const bankId = getBankId()
    const response = await client.reflect(bankId, query)

    return {
      success: true,
      reflection: response.text || ''
    }
  } catch (error) {
    console.error('Failed to reflect on topic:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
