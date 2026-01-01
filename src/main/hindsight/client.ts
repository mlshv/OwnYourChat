import { HindsightClient } from '@vectorize-io/hindsight-client'
import { getSettings } from '../settings.js'

let hindsightClient: HindsightClient | null = null
let isConnected = false

export function getHindsightClient(): HindsightClient | null {
  const settings = getSettings()

  if (!settings.hindsightEnabled) {
    return null
  }

  if (!hindsightClient) {
    try {
      hindsightClient = new HindsightClient({
        baseUrl: settings.hindsightServerUrl
      })
    } catch (error) {
      console.error('Failed to initialize Hindsight client:', error)
      return null
    }
  }

  return hindsightClient
}

export async function checkConnection(): Promise<boolean> {
  const client = getHindsightClient()
  if (!client) {
    isConnected = false
    return false
  }

  try {
    // Try a simple operation to check if server is responding
    // The hindsight client doesn't expose a health check endpoint,
    // so we'll just verify the client exists and settings are valid
    const settings = getSettings()
    isConnected = settings.hindsightEnabled && !!settings.hindsightServerUrl
    return isConnected
  } catch (error) {
    console.error('Hindsight connection check failed:', error)
    isConnected = false
    return false
  }
}

export function isHindsightConnected(): boolean {
  return isConnected
}

export function resetClient(): void {
  hindsightClient = null
  isConnected = false
}

export function getBankId(): string {
  const settings = getSettings()
  return settings.hindsightBankId
}
