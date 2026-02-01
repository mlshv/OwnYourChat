import * as React from 'react'
import { cn } from '@/lib/cn'
import { ChatTextIcon } from '@phosphor-icons/react'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'

type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  caseSensitive?: boolean
  onCaseSensitiveChange?: (value: boolean) => void
  searchInMessages?: boolean
  onSearchInMessagesChange?: (value: boolean) => void
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  caseSensitive = false,
  onCaseSensitiveChange,
  searchInMessages = false,
  onSearchInMessagesChange,
  className
}: SearchInputProps) {
  const [isFocused, setIsFocused] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleContainerClick = () => {
    inputRef.current?.focus()
  }

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        // Base styles from Input component
        'flex items-center gap-1 h-8 rounded-lg border px-1 w-full min-w-0 cursor-text',
        // Background and border
        'dark:bg-input/30 border-input bg-transparent',
        // Focus styles
        isFocused && 'border-foreground',
        // Invalid state (if needed later)
        'aria-invalid:border-destructive dark:aria-invalid:border-destructive/50',
        className
      )}
    >
      {/* Transparent input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className={cn(
          'flex-1 min-w-0 h-full px-1.5 bg-transparent outline-none',
          'text-base md:text-sm placeholder:text-muted-foreground'
        )}
      />

      {/* Toggle buttons */}
      <div className="flex items-center gap-0.5 shrink-0">
        {onCaseSensitiveChange && (
          <Tooltip disableHoverablePopup>
            <TooltipTrigger
              onClick={(e) => {
                e.stopPropagation()
                onCaseSensitiveChange(!caseSensitive)
              }}
              className={cn(
                'size-6 rounded-sm corner-round flex items-center justify-center font-mono text-[10px] border',
                caseSensitive
                  ? 'text-foreground border-foreground bg-foreground/10'
                  : 'text-muted-foreground border-transparent hover:text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              Aa
            </TooltipTrigger>
            <TooltipContent side="bottom">Match Case</TooltipContent>
          </Tooltip>
        )}
        {onSearchInMessagesChange && (
          <Tooltip disableHoverablePopup>
            <TooltipTrigger
              onClick={(e) => {
                e.stopPropagation()
                onSearchInMessagesChange(!searchInMessages)
              }}
              className={cn(
                'size-6 rounded-sm corner-round flex items-center justify-center border',
                searchInMessages
                  ? 'text-foreground border-foreground bg-foreground/10'
                  : 'text-muted-foreground border-transparent hover:text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <ChatTextIcon size={12} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Search in Messages</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
