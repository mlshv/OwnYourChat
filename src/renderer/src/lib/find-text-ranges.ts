/** Literal, case-insensitive matches in visible message text, across inline markup. */
export function findTextRanges(root: HTMLElement, query: string): Range[] {
  if (!query.trim()) return []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(escaped, 'giu')
  const ranges: Range[] = []
  for (const message of root.querySelectorAll('[data-search-message]')) {
    // Keep paragraph boundaries separate, but allow inline emphasis and links.
    const blocks = message.querySelectorAll(
      'p, pre, li, h1, h2, h3, h4, h5, h6, td, th, [data-search-text]'
    )
    for (const block of blocks) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement
          if (!parent || parent.closest('button, [aria-hidden="true"], .katex-mathml'))
            return NodeFilter.FILTER_REJECT
          // Nested blocks are searched independently, avoiding duplicate matches.
          const owner = parent.closest(
            'p, pre, li, h1, h2, h3, h4, h5, h6, td, th, [data-search-text]'
          )
          return owner === block ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        }
      })
      const nodes: { node: Text; start: number; end: number }[] = []
      let text = ''
      let node: Node | null
      while ((node = walker.nextNode())) {
        const start = text.length
        text += node.textContent ?? ''
        nodes.push({ node: node as Text, start, end: text.length })
      }
      for (const match of text.matchAll(pattern)) {
        const start = match.index
        const end = start + match[0].length
        const first = nodes.find((entry) => entry.end > start)
        const last = nodes.find((entry) => entry.end >= end)
        if (!first || !last) continue
        const range = document.createRange()
        range.setStart(first.node, start - first.start)
        range.setEnd(last.node, end - last.start)
        ranges.push(range)
      }
    }
  }
  return ranges
}
