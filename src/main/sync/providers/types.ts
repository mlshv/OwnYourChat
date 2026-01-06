/**
 * Provider-specific metadata types
 *
 * Each provider can define its own metadata schema for tracking
 * sync state and other provider-specific information.
 */

export type ChatGPTMetadata = {
  /**
   * Highest offset that has been fully processed during full sync.
   * Used to resume interrupted full syncs.
   */
  lastCompletedOffset: number

  /**
   * Whether we've completed a full sync (reached the end where total <= offset).
   * Once true, we switch to incremental sync mode.
   */
  isFullSyncComplete: boolean

  /**
   * The page size used in the last sync.
   * If API changes page size, we can detect and handle it.
   */
  lastSyncPageSize: number
}

export type ClaudeMetadata = {
  /**
   * Highest offset that has been fully processed during full sync.
   * Used to resume interrupted full syncs.
   */
  lastCompletedOffset: number

  /**
   * Whether we've completed a full sync (reached the end of pagination).
   * Once true, we switch to incremental sync mode.
   */
  isFullSyncComplete: boolean

  /**
   * The page size used in the last sync.
   * If API changes page size, we can detect and handle it.
   */
  lastSyncPageSize: number
}

export type PerplexityMetadata = {
  /**
   * Highest offset that has been fully processed during full sync.
   * Used to resume interrupted full syncs.
   */
  lastCompletedOffset: number

  /**
   * Whether we've completed a full sync (reached the end of pagination).
   * Once true, we switch to incremental sync mode.
   */
  isFullSyncComplete: boolean

  /**
   * The page size used in the last sync.
   * If API changes page size, we can detect and handle it.
   */
  lastSyncPageSize: number
}
