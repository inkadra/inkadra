/**
 * Work the HTTP layer hands to the worker. The BullMQ implementation lives in queues.ts;
 * tests and installs without Redis use a stand-in.
 */
export interface Jobs {
  /** Thumbnails, EXIF, palette and checksum of an uploaded asset. */
  processAsset(assetId: string): Promise<void>;
  /** Remove files from storage after their rows are gone. */
  deleteFiles(keys: string[]): Promise<void>;
  /** A queued project export or import (decision 0037); missing where transfers are off. */
  runTransfer?(transferId: string): Promise<void>;
  /** A backup row already started by `startBackup`. */
  runBackup?(backupId: string): Promise<void>;
  /** Moves the nightly backup to the time of the settings, or stops it. */
  scheduleBackups?(settings: import('@inkadra/shared').BackupSettings): Promise<void>;
}
