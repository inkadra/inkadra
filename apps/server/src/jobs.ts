/**
 * Work the HTTP layer hands to the worker. The BullMQ implementation lives in queues.ts;
 * tests and installs without Redis use a stand-in.
 */
export interface Jobs {
  /** Thumbnails, EXIF, palette and checksum of an uploaded asset. */
  processAsset(assetId: string): Promise<void>;
  /** Remove files from storage after their rows are gone. */
  deleteFiles(keys: string[]): Promise<void>;
}
