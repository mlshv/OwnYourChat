import type { IProvider, ProviderName, ProviderState } from './base.js'
import { ChatGPTProvider } from './chatgpt-provider.js'
import { ClaudeProvider } from './claude-provider.js'
import { DrizzleStorageAdapter } from '../../storage/drizzle-adapter.js'
import type { IStorage } from '../../storage/interface.js'

class ProviderRegistry {
  private providers: Map<ProviderName, IProvider> = new Map()
  private storage: IStorage
  private initialized: boolean = false

  constructor() {
    this.storage = new DrizzleStorageAdapter()
  }

  async init(): Promise<void> {
    if (this.initialized) {
      console.log('[ProviderRegistry] Already initialized')
      return
    }

    console.log('[ProviderRegistry] Initializing providers...')

    // Create provider instances
    const chatgptProvider = new ChatGPTProvider(this.storage, 60000) // 1 minute polling
    const claudeProvider = new ClaudeProvider(this.storage, 60000)

    // Initialize each provider
    await chatgptProvider.initialize()
    await claudeProvider.initialize()

    // Register providers
    this.providers.set('chatgpt', chatgptProvider)
    this.providers.set('claude', claudeProvider)

    // Restore connections for providers that were previously connected
    console.log('[ProviderRegistry] Checking for providers to restore...')
    for (const provider of this.getAllProviders()) {
      if (provider.shouldRestoreConnection()) {
        console.log(`[ProviderRegistry] Restoring connection for ${provider.name}...`)
        await provider.restoreConnection()
      }
    }

    this.initialized = true
    console.log('[ProviderRegistry] Initialized with providers:', Array.from(this.providers.keys()))
  }

  getProvider(name: ProviderName): IProvider | undefined {
    return this.providers.get(name)
  }

  getAllProviders(): IProvider[] {
    return Array.from(this.providers.values())
  }

  getConnectedProviders(): IProvider[] {
    return this.getAllProviders().filter((p) => p.isConnected())
  }

  async startAll(): Promise<void> {
    const connectedProviders = this.getConnectedProviders()
    console.log(
      `[ProviderRegistry] Starting ${connectedProviders.length} connected provider(s):`,
      connectedProviders.map((p) => p.name)
    )

    for (const provider of connectedProviders) {
      await provider.start()
    }
  }

  async stopAll(): Promise<void> {
    console.log('[ProviderRegistry] Stopping all providers...')
    for (const provider of this.getAllProviders()) {
      await provider.stop()
    }
  }

  async syncAll(): Promise<{
    success: boolean
    results: { provider: ProviderName; success: boolean; error?: string; newChatsFound?: number }[]
  }> {
    const connectedProviders = this.getConnectedProviders()
    const results: {
      provider: ProviderName
      success: boolean
      error?: string
      newChatsFound?: number
    }[] = []

    console.log(`[ProviderRegistry] Syncing ${connectedProviders.length} provider(s)...`)

    for (const provider of connectedProviders) {
      console.log(`[ProviderRegistry] Syncing ${provider.name}...`)
      const result = await provider.sync()
      results.push({
        provider: provider.name,
        ...result
      })
    }

    const anySuccess = results.some((r) => r.success)
    return { success: anySuccess, results }
  }

  getAllStates(): ProviderState[] {
    return this.getAllProviders().map((p) => p.getState())
  }

  getState(name: ProviderName): ProviderState | undefined {
    const provider = this.getProvider(name)
    return provider?.getState()
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry()
