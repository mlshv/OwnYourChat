import type { WebContentsView, Rectangle } from 'electron'
import { getMainWindow } from './index'
import { getUserPreferences } from './db/operations'
import { store } from './store'

const CONNECTION_BAR_HEIGHT = 40
const DEBUG_TOOLBAR_HEIGHT = 40

type ProviderName = 'chatgpt' | 'claude' | 'perplexity'

/**
 * Manages WebContentsView bounds for provider login views.
 * Centralizes the logic for calculating view bounds based on UI state.
 * Automatically handles resize events for all attached views.
 */
class ViewBoundsManager {
  private debugPanelVisible = false
  private managedViews = new Map<WebContentsView, { resizeHandler: () => void; provider: ProviderName }>()
  private initialized = false

  /**
   * Initialize the manager by reading debug panel state from database.
   * Should be called once during app startup.
   */
  async init(): Promise<void> {
    if (this.initialized) return

    const prefs = await getUserPreferences()
    this.debugPanelVisible = prefs.showDebugPanel
    this.initialized = true
  }

  /**
   * Update the debug panel visibility state.
   * Call this when user preferences change.
   * Automatically updates bounds of all attached views.
   */
  setDebugPanelVisible(visible: boolean): void {
    if (this.debugPanelVisible === visible) return

    this.debugPanelVisible = visible
    this.updateAllViews()
  }

  /**
   * Get the current view bounds based on main window size and UI state.
   * Accounts for connection bar at top and debug panel at bottom.
   */
  getViewBounds(): Rectangle {
    const mainWindow = getMainWindow()
    if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 }

    const contentBounds = mainWindow.getContentBounds()
    const topOffset = CONNECTION_BAR_HEIGHT
    const bottomOffset = this.debugPanelVisible ? DEBUG_TOOLBAR_HEIGHT : 0

    return {
      x: 0,
      y: topOffset,
      width: contentBounds.width,
      height: contentBounds.height - topOffset - bottomOffset
    }
  }

  /**
   * Attach a view to the main window with correct bounds.
   * Automatically registers a resize handler to keep bounds updated.
   * Updates the store to track which provider is connecting.
   */
  attachView(view: WebContentsView, provider: ProviderName): void {
    const mainWindow = getMainWindow()
    if (!mainWindow) return

    mainWindow.contentView.addChildView(view)
    view.setBounds(this.getViewBounds())

    // Update store to show connection bar
    store.getState().setConnectingProvider(provider)

    // Create and store resize handler for this view
    const resizeHandler = (): void => {
      view.setBounds(this.getViewBounds())
    }
    this.managedViews.set(view, { resizeHandler, provider })
    mainWindow.on('resize', resizeHandler)
  }

  /**
   * Detach a view from the main window.
   * Automatically removes the resize handler.
   * Clears the connecting provider state if this was the active view.
   */
  detachView(view: WebContentsView): void {
    const mainWindow = getMainWindow()
    if (!mainWindow) return

    mainWindow.contentView.removeChildView(view)

    // Clean up resize handler and update store
    const viewInfo = this.managedViews.get(view)
    if (viewInfo) {
      mainWindow.off('resize', viewInfo.resizeHandler)
      this.managedViews.delete(view)

      // Clear connecting provider state
      store.getState().setConnectingProvider(null)
    }
  }

  /**
   * Cancel the current connection attempt.
   * Hides the view for the currently connecting provider.
   */
  cancelConnection(): void {
    const connectingProvider = store.getState().ui.connectingProvider
    if (!connectingProvider) return

    // Find and detach the view for this provider
    for (const [view, info] of this.managedViews.entries()) {
      if (info.provider === connectingProvider) {
        this.detachView(view)
        break
      }
    }
  }

  /**
   * Update bounds of all currently attached views.
   * Called when debug panel visibility changes.
   */
  private updateAllViews(): void {
    const bounds = this.getViewBounds()
    for (const view of this.managedViews.keys()) {
      view.setBounds(bounds)
    }
  }
}

// Singleton instance
export const viewBoundsManager = new ViewBoundsManager()
