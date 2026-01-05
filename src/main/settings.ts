import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export interface Settings {
  syncIntervalMinutes: number
  autoSync: boolean
  exportPath: string
  mcpEnabled: boolean
  mcpPort: number
}

const defaultSettings: Settings = {
  syncIntervalMinutes: 1,
  autoSync: true,
  exportPath: path.join(app.getPath('documents'), 'OwnYourChat'),
  mcpEnabled: false,
  mcpPort: 37777
}

let currentSettings: Settings | null = null

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (currentSettings) {
    return currentSettings
  }

  const settingsPath = getSettingsPath()

  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8')
      currentSettings = { ...defaultSettings, ...JSON.parse(data) }
    } else {
      currentSettings = { ...defaultSettings }
    }
  } catch {
    currentSettings = { ...defaultSettings }
  }

  return currentSettings!
}

export function updateSettings(updates: Partial<Settings>): Settings {
  const settings = getSettings()
  const newSettings = { ...settings, ...updates }

  const settingsPath = getSettingsPath()
  fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2))

  currentSettings = newSettings
  return newSettings
}

export function getDataPath(): string {
  return app.getPath('userData')
}

export function getAttachmentsPath(): string {
  const attachmentsPath = path.join(app.getPath('userData'), 'attachments')
  if (!fs.existsSync(attachmentsPath)) {
    fs.mkdirSync(attachmentsPath, { recursive: true })
  }
  return attachmentsPath
}
