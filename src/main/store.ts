import { create } from 'zustand'
import type { AppState } from '../shared/types'

export const store = create<AppState>((set) => ({
  // Initial state
  providers: {
    chatgpt: {
      isOnline: false,
      status: 'disconnected',
      lastSyncAt: null,
      errorMessage: null,
      isSyncing: false
    },
    claude: {
      isOnline: false,
      status: 'disconnected',
      lastSyncAt: null,
      errorMessage: null,
      isSyncing: false
    }
  },

  auth: {
    isLoggedIn: false,
    errorReason: null
  },

  sync: {
    isRunning: false,
    lastSyncAt: null,
    error: null,
    progress: null
  },

  settings: {
    syncIntervalMinutes: 1,
    autoSync: true,
    exportPath: ''
  },

  // Actions
  updateProviderState: (provider, providerState) => {
    set((state) => {
      const updated = {
        ...state,
        providers: {
          ...state.providers,
          [provider]: {
            ...state.providers[provider],
            ...providerState
          }
        }
      }

      // Update auth state based on provider connections
      const anyConnected = updated.providers.chatgpt.isOnline || updated.providers.claude.isOnline
      updated.auth = {
        isLoggedIn: anyConnected,
        errorReason: anyConnected ? null : state.auth.errorReason
      }

      return updated
    })
  },

  updateSyncState: (syncState) => {
    set((state) => ({
      ...state,
      sync: {
        ...state.sync,
        ...syncState
      }
    }))
  },

  updateSettings: (newSettings) => {
    set((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ...newSettings
      }
    }))
  },

  setAuthState: (auth) => {
    set((state) => ({
      ...state,
      auth: {
        ...state.auth,
        ...auth
      }
    }))
  }
}))
