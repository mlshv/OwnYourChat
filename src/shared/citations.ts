// ChatGPT's original citation syntax and its current private-use Unicode markers.
export const CHATGPT_CITATION_PATTERN = /【\d+†[^】]+】|\uE200cite\uE202[^\uE200\uE201]*\uE201/g

// Display all embedded ChatGPT markers, including old encodings and annotation wrappers.
// Do not remove arbitrary private-use characters: fonts and logos use that range too.
export const CHATGPT_DISPLAY_CITATION_PATTERN =
  /【\d+†[^】]+】|\uE200[^\uE200\uE201]*\uE201|\uE600[^\uE600\uE601]*\uE601|\uE142cite\uE142[^\uE141]*\uE141|[\uE203\uE204\uE206]/g

export function isWebSourceUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
