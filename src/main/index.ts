import { app, BrowserWindow, protocol, net, Menu } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.png?asset'
import { IPC_CHANNELS } from '../shared/types'
import { getAttachmentsPath, getSettings } from './settings'
import { pathToFileURL } from 'url'
import { initDatabase } from './db'
import { setupIpcHandlers } from './ipc'
import { stopSyncScheduler } from './sync/scheduler'
import { shell } from 'electron'
import { providerRegistry } from './sync/providers/registry'
import { store } from './store'
import { createZustandBridge } from '@zubridge/electron/main'
import { startMcpServer, stopMcpServer } from './mcp/server'

let mainWindow: BrowserWindow | null = null

function createApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    // File menu
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const }
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const }
            ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    // Export menu
    {
      label: 'Export',
      submenu: [
        {
          label: 'Export Conversations...',
          accelerator: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU_EXPORT_CLICK)
          }
        }
      ]
    },
    // Settings menu
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Preferences...',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU_SETTINGS_CLICK)
          }
        }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = await import('electron')
            await shell.openExternal('https://github.com/ownyourchat')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Register custom protocol for serving attachment files
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'attachment',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Create application menu
  createApplicationMenu()

  // Set app user model id for windows
  electronApp.setAppUserModelId('ownyourchat')

  // Register protocol handler for attachment:// URLs
  // Format: attachment://conversationId/filename
  protocol.handle('attachment', (request) => {
    // Parse the URL: attachment://conversationId/filename
    // Note: URL parser treats conversationId as host, not path
    const url = new URL(request.url)
    const conversationId = url.host
    const filename = decodeURIComponent(url.pathname.slice(1)) // Remove leading /

    if (!conversationId || !filename) {
      return new Response('Invalid attachment URL', { status: 400 })
    }
    const filePath = join(getAttachmentsPath(), conversationId, filename)

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`[Attachment] File not found: ${filePath}`)
      return new Response('File not found', { status: 404 })
    }

    // Return the file using net.fetch with file:// URL
    return net.fetch(pathToFileURL(filePath).toString())
  })

  // Initialize database
  await initDatabase()

  // Set up IPC handlers
  setupIpcHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Initialize Zubridge
  if (mainWindow) {
    console.log('[App] Initializing Zubridge...')
    const bridge = createZustandBridge(store)
    bridge.subscribe([mainWindow])
    console.log('[App] Zubridge subscribed to main window')
  }

  // Initialize MCP server if enabled
  const settings = getSettings()
  if (settings.mcpEnabled) {
    console.log('[App] Starting MCP server...')
    try {
      await startMcpServer(settings.mcpPort)
      console.log(`[App] MCP server started on port ${settings.mcpPort}`)
    } catch (error) {
      console.error('[App] Failed to start MCP server:', error)
    }
  }

  // Initialize provider registry and start connected providers
  console.log('[App] Initializing provider registry...')
  await providerRegistry.init()

  const connectedProviders = providerRegistry.getConnectedProviders()
  console.log(`[App] Found ${connectedProviders.length} connected provider(s)`)

  if (connectedProviders.length > 0) {
    console.log('[App] Starting polling for connected providers...')
    await providerRegistry.startAll()

    // Notify renderer about auth status
    mainWindow?.webContents.send(IPC_CHANNELS.AUTH_STATUS_CHANGED, {
      isLoggedIn: true,
      errorReason: null
    })
  } else {
    console.log('[App] No providers connected')
    // Notify renderer that user needs to log in
    mainWindow?.webContents.send(IPC_CHANNELS.AUTH_STATUS_CHANGED, {
      isLoggedIn: false,
      errorReason: null
    })
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Export provider registry and store for direct access
export { providerRegistry, store }

// Export main window for other modules
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
// Handle app quit
app.on('before-quit', async () => {
  await providerRegistry.stopAll()
  stopSyncScheduler()
  await stopMcpServer()
})
