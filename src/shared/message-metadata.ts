export type MessageMetadata = {
  selectedModel?: string
  mode?: string
  searchFocus?: string
  finishReason?: string
}

export function metadataText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// Only retain display fields, never the full provider payload (which can contain credentials).
export function parseMessageMetadata(value: unknown): MessageMetadata {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const result: MessageMetadata = {}
  for (const key of ['selectedModel', 'mode', 'searchFocus', 'finishReason'] as const) {
    const text = metadataText(input[key])
    if (text) result[key] = text
  }
  return result
}

export function metadataDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
