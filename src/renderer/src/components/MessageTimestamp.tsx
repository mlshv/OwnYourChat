type MessageTimestampProps = {
  createdAt: Date | string | null
  isUpdatedTime: boolean
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

const tooltipFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'long'
})

export function MessageTimestamp({ createdAt, isUpdatedTime }: MessageTimestampProps) {
  const date = createdAt == null ? null : new Date(createdAt)

  if (!date || Number.isNaN(date.getTime())) {
    return <span className="text-xs text-muted-foreground">Date unknown</span>
  }

  return (
    <time
      className="text-xs text-muted-foreground"
      dateTime={date.toISOString()}
      title={`${isUpdatedTime ? 'Updated' : 'Created'}: ${tooltipFormatter.format(date)}`}
    >
      {isUpdatedTime && 'Updated: '}
      {dateFormatter.format(date)}
    </time>
  )
}
