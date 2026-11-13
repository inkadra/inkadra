/**
 * Work the HTTP layer hands to the worker. The BullMQ implementation lives in queues.ts;
 * tests and installs without Redis use a stand-in.
 */
export interface Jobs {
  /** Thumbnails, EXIF, palette and checksum of an uploaded asset. */
  processAsset(assetId: string): Promise<void>;
  /**
   * The playable MP4 copy of a video browsers cannot play (decision 0048), queued by the
   * worker after the poster; missing where nothing makes them.
   */
  makeProxy?(assetId: string, opts?: { regenerate?: boolean }): Promise<void>;
  /** The next step of a regeneration of video copies (decision 0128). */
  runVideoBackfill?(delayMs?: number): Promise<void>;
  /** Drops the regenerations still waiting. */
  cancelRegenerations?(): Promise<void>;
  /** Regenerations waiting in the queue. */
  regenerationsWaiting?(): Promise<number>;
  /** Whether the copy of an asset is waiting or running in the queue (decision 0128). */
  proxyQueued?(assetId: string): Promise<boolean>;
  /**
   * The pages and grids of an Office document, made by a worker with LibreOffice (decision
   * 0065); missing where nothing makes them.
   */
  convertOffice?(assetId: string): Promise<void>;
  /** Remove files from storage after their rows are gone. */
  deleteFiles(keys: string[]): Promise<void>;
  /** A queued project export or import (decision 0037); missing where transfers are off. */
  runTransfer?(transferId: string): Promise<void>;
  /** A backup row already started by `startBackup`. */
  runBackup?(backupId: string): Promise<void>;
  /** Moves the nightly backup to the time of the settings, or stops it. */
  scheduleBackups?(settings: import('@inkadra/shared').BackupSettings): Promise<void>;
}
