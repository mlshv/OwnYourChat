import { Fragment } from 'react'
import { Popover } from '@base-ui/react/popover'
import { InfoIcon } from '@phosphor-icons/react'
import type { Conversation, Message } from '@shared/types'
import { metadataDate } from '../../../shared/message-metadata'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

function formatDate(value: Date | string | null | undefined): string {
  const date = metadataDate(value)
  return date
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(date)
    : 'Unknown'
}

function MetadataRows({ rows }: { rows: [string, string | number | undefined][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
      {rows
        .filter(([, value]) => value !== undefined)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words select-text">{value}</dd>
          </Fragment>
        ))}
    </dl>
  )
}

function formatBytes(size: number): string | undefined {
  if (!Number.isFinite(size) || size <= 0) return undefined
  const unit = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 3)
  return `${(size / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB'][unit]}`
}

export function MessageDetails({
  message,
  provider
}: {
  message: Message
  provider: Conversation['provider']
}) {
  const metadata = message.metadata ?? {}
  const sourceCount = new Set(
    message.parts.flatMap((part) => (part.type === 'source-url' ? [part.url] : []))
  ).size
  const variants = message.siblingIds?.length ?? 0
  const rows: [string, string | number | undefined][] = [
    ['Provider', provider],
    ['Role', message.role],
    ['Model', message.role === 'assistant' ? message.model || 'Not recorded' : undefined],
    ['Selected model', metadata.selectedModel],
    [provider === 'perplexity' ? 'Entry updated' : 'Created', formatDate(message.createdAt)],
    ['Updated', message.updatedAt ? formatDate(message.updatedAt) : undefined],
    ['Mode', metadata.mode],
    ['Search focus', metadata.searchFocus],
    ['Finish reason', metadata.finishReason],
    ['Variant', variants > 1 ? `${message.siblingIndex + 1} of ${variants}` : undefined],
    ['Sources', sourceCount || undefined],
    ['Attachments', message.attachments?.length || undefined]
  ]

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Message details"
        title={message.model ? `Model: ${message.model} · Message details` : 'Message details'}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <InfoIcon size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={6}
          align={message.role === 'user' ? 'end' : 'start'}
          className="z-50"
        >
          <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none">
            <Popover.Title className="mb-3 text-sm font-semibold">Message details</Popover.Title>
            <MetadataRows rows={rows} />
            {message.role === 'assistant' && !message.model && (
              <p className="mt-3 text-xs text-muted-foreground">
                Model information may become available when this chat refreshes, if the provider
                supplies it.
              </p>
            )}
            {provider === 'perplexity' && (
              <p className="mt-3 text-xs text-muted-foreground">
                Entry time is shared by the question and answer. Model is the provider’s display
                label.
              </p>
            )}
            {message.attachments?.map((attachment) => (
              <div key={attachment.id} className="mt-3 border-t border-border pt-2 text-xs">
                <div className="break-words">{attachment.filename || 'Attachment'}</div>
                <div className="mt-1 text-muted-foreground">
                  {[
                    attachment.mimeType || attachment.type,
                    formatBytes(attachment.size),
                    attachment.width && attachment.height
                      ? `${attachment.width} × ${attachment.height}`
                      : undefined
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ConversationDetails({
  conversation,
  open,
  onOpenChange
}: {
  conversation: Conversation
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Chat details</DialogTitle>
        <MetadataRows
          rows={[
            ['Provider', conversation.provider],
            [
              'Created',
              conversation.provider === 'perplexity'
                ? undefined
                : formatDate(conversation.createdAt)
            ],
            [
              conversation.provider === 'perplexity' ? 'Last query' : 'Updated',
              formatDate(conversation.updatedAt)
            ],
            ['Synced', formatDate(conversation.syncedAt)],
            ['Messages (all branches)', conversation.messageCount]
          ]}
        />
      </DialogContent>
    </Dialog>
  )
}
