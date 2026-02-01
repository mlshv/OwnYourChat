import { createUseStore } from '@zubridge/electron'
import type { AppState } from '@shared/types'

// Create the store hook connected to the main process store via Zubridge
export const useStore = createUseStore<AppState>()

// Typed selectors for convenience
export const useProvidersState = () => useStore<AppState['providers']>((state) => state.providers)

export const useAuthState = () => useStore<AppState['auth']>((state) => state.auth)

export const useSyncState = () => useStore<AppState['sync']>((state) => state.sync)

export const useSettings = () => useStore<AppState['settings']>((state) => state.settings)

export const useUIState = () => useStore<AppState['ui']>((state) => state.ui)

// Actions
export const useUpdateProviderState = () =>
  useStore<AppState['updateProviderState']>((state) => state.updateProviderState)

export const useUpdateSyncState = () =>
  useStore<AppState['updateSyncState']>((state) => state.updateSyncState)

export const useUpdateSettings = () =>
  useStore<AppState['updateSettings']>((state) => state.updateSettings)

export const useSetAuthState = () =>
  useStore<AppState['setAuthState']>((state) => state.setAuthState)
