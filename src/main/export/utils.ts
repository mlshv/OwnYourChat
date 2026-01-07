export function formatDate(date: Date | null | undefined): string {
  if (!date) return 'Unknown'
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .slice(0, 100)
      .trim() || 'Untitled'
  )
}
