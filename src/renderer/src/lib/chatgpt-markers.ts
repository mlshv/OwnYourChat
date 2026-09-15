import { isWebSourceUrl } from '../../../shared/citations'

type MarkerDescription = { kind: 'citation' | 'text'; label: string; url?: string }

// Render provider widgets as inert readable text. Never execute their payloads or
// turn internal turn… identifiers into guessed links. Original text stays saved.
export function describeChatGPTMarker(marker: string): MarkerDescription {
  if (/^[\uE203\uE204\uE206]$/.test(marker)) return { kind: 'text', label: '' }
  if (/^【|^[\uE142\uE600]cite/.test(marker)) return { kind: 'citation', label: '' }
  const [type, ...fields] = marker.slice(1, -1).split('\uE202')
  if (type === 'cite') return { kind: 'citation', label: '' }
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  let data: Record<string, unknown> | unknown[] = {}
  try {
    const parsed: unknown = JSON.parse(fields[0] || '{}')
    if (parsed && typeof parsed === 'object') data = parsed as typeof data
  } catch {
    /* Some widgets carry delimiter-separated text instead of JSON. */
  }
  const object = Array.isArray(data) ? {} : data
  let label = ''
  if (type === 'entity' || type === 'product_entity')
    label = Array.isArray(data) ? text(data[1]) : ''
  if (type === 'entity_metadata') label = Array.isArray(data) ? text(data[2]) : ''
  if (['url', 'link_title', 'video', 'navlist', 'summary'].includes(type)) {
    label = fields[0] && !/^turn\w+$/.test(fields[0]) ? fields[0] : ''
  }
  if (type === 'product') label = text(object.product_name)
  if (type === 'products' && Array.isArray(object.selections)) {
    label = object.selections
      .map((item) => (Array.isArray(item) ? text(item[1]) : ''))
      .filter(Boolean)
      .join(' · ')
  }
  if (type === 'image_group' && Array.isArray(object.query)) {
    label = `Images: ${object.query.map(text).filter(Boolean).join(' · ')}`
  }
  if (type === 'businesses_map') {
    label = fields
      .map((field) => {
        try {
          const item = JSON.parse(field)
          return [text(item.name), text(item.location)].filter(Boolean).join(' — ')
        } catch {
          return ''
        }
      })
      .filter(Boolean)
      .join(' · ')
  }
  if (type === 'genui') {
    const input = object.ask_user_input as
      | { questions?: { question?: string; options?: string[] }[] }
      | undefined
    if (Array.isArray(input?.questions)) {
      label = input.questions
        .filter((q) => q && typeof q === 'object')
        .map((q) =>
          [text(q.question), ...(Array.isArray(q.options) ? q.options.map(text) : [])]
            .filter(Boolean)
            .join(' / ')
        )
        .join(' · ')
    } else {
      const suggestion = object.suggest_automation as { label?: string } | undefined
      label = text(suggestion?.label)
    }
  }
  const fallback: Record<string, string> = {
    memcite: 'Memory reference',
    map: 'Map',
    businesses_map: 'Places',
    i: 'Images',
    image_group: 'Images',
    finance: 'Financial chart',
    forecast: 'Weather forecast',
    video: 'Video',
    link: 'Source link',
    url: 'Source link',
    link_title: 'Source link',
    entity: 'Place or entity',
    entity_metadata: 'Place or entity',
    product_entity: 'Product',
    product: 'Product',
    products: 'Products',
    navlist: 'Related sources',
    summary: 'Summary',
    genui: 'Interactive content'
  }
  return {
    kind: 'text',
    url: fields.find(isWebSourceUrl),
    label: label || `[${fallback[type] || 'Embedded content'} — available in ChatGPT]`
  }
}
