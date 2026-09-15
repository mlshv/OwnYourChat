import { metadataDate, metadataText, parseMessageMetadata } from '../../../shared/message-metadata'

export function chatgptMessageMetadata(message: {
  role: string
  modelSlug?: unknown
  updatedAt?: unknown
  finishReason?: unknown
}) {
  return {
    model: message.role === 'assistant' ? metadataText(message.modelSlug) : undefined,
    updatedAt: metadataDate(message.updatedAt),
    metadata: JSON.stringify(parseMessageMetadata({ finishReason: message.finishReason }))
  }
}

export function claudeMessageMetadata(message: {
  sender: string
  model?: unknown
  updated_at?: unknown
  stop_reason?: unknown
}) {
  return {
    model: message.sender === 'assistant' ? metadataText(message.model) : undefined,
    updatedAt: metadataDate(message.updated_at),
    metadata: JSON.stringify(parseMessageMetadata({ finishReason: message.stop_reason }))
  }
}

export function perplexityMessageMetadata(
  entry: {
    display_model?: unknown
    user_selected_model?: unknown
    mode?: unknown
    search_focus?: unknown
  },
  role: 'user' | 'assistant'
) {
  return {
    model: role === 'assistant' ? metadataText(entry.display_model) : undefined,
    metadata: JSON.stringify(
      parseMessageMetadata({
        selectedModel: entry.user_selected_model,
        mode: entry.mode,
        searchFocus: entry.search_focus
      })
    )
  }
}
