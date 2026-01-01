import { generateObject } from 'ai'
import { createCerebras } from '@ai-sdk/cerebras'
import { z } from 'zod'
import { formatConversationForAnalysis } from './formatter.js'
import type { Conversation, Message } from '../../shared/types'

const AnalysisSchema = z.object({
  memoryValueConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'A number from 0.0 to 1.0 indicating whether this chat contains valuable long-term information about the user (biographical facts, preferences, project details, life events). Score 0.1 for pure noise like "What is the capital of France?" or generic troubleshooting. Score 0.9+ for conversations where the user reveals personal information, career details, stylistic preferences, or discusses their projects/relationships.'
    ),
  primaryTopic: z
    .string()
    .max(50)
    .describe(
      'A short 2-5 word label describing the conversation\'s domain (e.g., "React Performance", "Career Planning", "Vim Configuration").'
    )
})

export type ConversationAnalysis = z.infer<typeof AnalysisSchema>

function getCerebrasApiKey(): string {
  const apiKey = process.env.CEREBRAS_API_KEY
  if (!apiKey) {
    throw new Error('CEREBRAS_API_KEY not found in environment variables')
  }
  return apiKey
}

/**
 * Analyze a conversation using Cerebras LLM to determine if it contains
 * valuable long-term information worth indexing into Hindsight memory.
 */
export async function analyzeConversation(
  conversation: Conversation,
  messages: Message[]
): Promise<ConversationAnalysis> {
  const apiKey = getCerebrasApiKey()
  const cerebras = createCerebras({ apiKey })

  const conversationText = formatConversationForAnalysis(conversation, messages)

  const { object } = await generateObject({
    model: cerebras('gpt-oss-120b'),
    schema: AnalysisSchema,
    temperature: 0.7,
    prompt: `Analyze the following conversation to determine if it contains valuable long-term information about the user that should be stored in their personal memory bank.

Consider:
- Does the user share biographical facts, preferences, or personal details?
- Does the conversation reveal information about the user's projects, career, interests, hobbies, or life events?
- Does the user express stylistic preferences or opinions worth remembering?
- Is this just generic Q&A (e.g., "What is the capital of France?") or troubleshooting?

Conversation:
${conversationText}

Extract:
1. memoryValueConfidence: How valuable is this conversation for long-term memory (0.0-1.0)?
2. primaryTopic: A brief 2-5 word topic label`
  })

  return object
}
