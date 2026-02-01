import { XIcon } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { AI_PROVIDERS } from '../constants'

type ConnectionBarProps = {
  provider: 'chatgpt' | 'claude' | 'perplexity'
  onCancel: () => void
}

export function ConnectionBar({ provider, onCancel }: ConnectionBarProps) {
  const providerInfo = AI_PROVIDERS[provider]

  return (
    <div className="h-10 flex items-center justify-center px-4 bg-muted border-b border-border relative">
      <div className="flex items-center gap-2">
        <providerInfo.icon size={16} />
        <span className="text-sm">Connecting to {providerInfo.name}...</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="h-7 px-2 absolute right-4"
      >
        <XIcon size={16} />
        <span className="ml-1">Cancel</span>
      </Button>
    </div>
  )
}
