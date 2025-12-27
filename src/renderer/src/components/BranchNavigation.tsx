import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import type { Message } from '../../../shared/types'

interface BranchNavigationProps {
  message: Message
  onSelectSibling: (siblingId: string) => void
}

/**
 * Branch navigation component that shows left/right arrows for switching
 * between message variants (siblings with the same parent).
 *
 * Only renders when there are multiple siblings (branches).
 */
export function BranchNavigation({ message, onSelectSibling }: BranchNavigationProps) {
  const { siblingIds, siblingIndex } = message

  // Only show if there are multiple siblings
  if (!siblingIds || siblingIds.length <= 1) {
    return null
  }

  const hasPrev = siblingIndex > 0
  const hasNext = siblingIndex < siblingIds.length - 1

  const handlePrev = () => {
    if (hasPrev) {
      onSelectSibling(siblingIds[siblingIndex - 1])
    }
  }

  const handleNext = () => {
    if (hasNext) {
      onSelectSibling(siblingIds[siblingIndex + 1])
    }
  }

  return (
    <div className="flex items-center text-xs text-f2 select-none">
      <button
        onClick={handlePrev}
        disabled={!hasPrev}
        className="flex py-1.5 px-0.5 items-center justify-center rounded active:bg-b3 disabled:opacity-30 disabled:cursor-default"
        aria-label="Previous variant"
      >
        <CaretLeftIcon className="w-5 h-5" />
      </button>
      <span className="px-0.5 text-sm font-semibold tabular-nums">
        {siblingIndex + 1}/{siblingIds.length}
      </span>
      <button
        onClick={handleNext}
        disabled={!hasNext}
        className="flex py-1.5 px-0.5 items-center justify-center rounded active:bg-b3 disabled:opacity-30 disabled:cursor-default"
        aria-label="Next variant"
      >
        <CaretRightIcon className="w-5 h-5" />
      </button>
    </div>
  )
}
