import { useState } from 'react'
import type { FileCitation } from '../../../shared/types'
import { isWebSourceUrl } from '../../../shared/citations'

interface FileCitationPillProps {
  marker: string
  reference?: FileCitation
  messageId?: string
}

export function FileCitationPill({ marker, reference, messageId }: FileCitationPillProps) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string>()
  const lines = marker
    .slice(0, -1)
    .split('\uE202')
    .filter((field) => /^L\d+(?:[-–]L?\d+)?$/.test(field))
    .map((field) => field.replace(/L/g, '').replace(/[-–]/g, '–'))

  const label = `${reference?.filename || 'File'}${lines.length ? ` · lines ${lines.join(', ')}` : reference?.filename ? '' : ' reference'}`
  const canOpen =
    messageId &&
    reference &&
    (reference.fileId?.match(/^file[_-][a-zA-Z0-9_-]+$/) || isWebSourceUrl(reference.url))
  const open = async () => {
    if (!messageId || opening) return
    setOpening(true)
    setError(undefined)
    try {
      const result = await window.api?.attachments.openCitation(messageId, marker)
      if (!result?.success) setError(result?.error || 'Could not open file')
    } catch {
      setError('Could not open file. Try again.')
    } finally {
      setOpening(false)
    }
  }
  if (canOpen) {
    return (
      <span className="inline-flex items-center gap-1 ms-1">
        <button
          type="button"
          disabled={opening}
          onClick={open}
          title={`Open ${reference.filename || 'original file'}`}
          className="rounded-xl bg-accent px-2 text-xs text-muted-foreground hover:underline disabled:opacity-50"
        >
          {opening ? 'Opening…' : label}
        </button>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center rounded-xl bg-accent px-2 text-xs text-muted-foreground ms-1"
      title="Reference to an uploaded file. The original file is not linked to this citation in the local archive."
    >
      {label}
    </span>
  )
}
