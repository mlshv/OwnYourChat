import { useState, useCallback, type FormEvent } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { LockKeyIcon } from '@phosphor-icons/react'

type UnlockScreenProps = {
  isNewDatabase: boolean
  onUnlocked: () => void
}

export function UnlockScreen({ isNewDatabase, onUnlocked }: UnlockScreenProps) {
  const [key, setKey] = useState('')
  const [confirmKey, setConfirmKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      if (!key) {
        setError('Please enter an encryption key')
        return
      }

      if (isNewDatabase && key !== confirmKey) {
        setError('Keys do not match')
        return
      }

      setIsUnlocking(true)

      try {
        const result = await window.api!.database.unlock(key)

        if (result.success) {
          onUnlocked()
        } else {
          setError(result.error ?? 'Failed to unlock database')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unexpected error')
      } finally {
        setIsUnlocking(false)
      }
    },
    [key, confirmKey, isNewDatabase, onUnlocked]
  )

  return (
    <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Icon and header */}
          <div className="text-center space-y-2">
            <LockKeyIcon className="mx-auto text-muted-foreground" size={40} weight="duotone" />
            <h1 className="text-lg font-semibold text-foreground">
              {isNewDatabase ? 'Set Encryption Key' : 'Unlock Database'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isNewDatabase
                ? 'Choose an encryption key to protect your conversations. You will need this key every time you open the app.'
                : 'Enter your encryption key to access your conversations.'}
            </p>
          </div>

          {/* Key input */}
          <div className="space-y-3">
            <Input
              type="password"
              placeholder={isNewDatabase ? 'Choose encryption key' : 'Encryption key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
              disabled={isUnlocking}
            />

            {isNewDatabase && (
              <Input
                type="password"
                placeholder="Confirm encryption key"
                value={confirmKey}
                onChange={(e) => setConfirmKey(e.target.value)}
                disabled={isUnlocking}
              />
            )}
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isUnlocking || !key || (isNewDatabase && !confirmKey)}
          >
            {isUnlocking
              ? 'Unlocking...'
              : isNewDatabase
                ? 'Create Encrypted Database'
                : 'Unlock'}
          </Button>

          <p className="text-center text-muted-foreground text-xs">
            Your data is encrypted locally with SQLCipher
          </p>
        </form>
      </div>
    </div>
  )
}
