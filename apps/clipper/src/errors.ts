// SPDX-License-Identifier: MPL-2.0

/** What went wrong, in terms the interface can explain and act on. */
export type ErrorKind =
  | 'not_connected'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'too_large'
  | 'offline'
  | 'rate_limited'
  | 'invalid_server'
  | 'auth_cancelled'
  | 'auth_failed'
  | 'permission_denied'
  | 'no_board'
  | 'bad_request'
  | 'server'
  /** A clip the server failed to confirm: the card may be on the board all the same. */
  | 'clip_unconfirmed';

export class ClipperError extends Error {
  readonly kind: ErrorKind;

  readonly status?: number;
  readonly reason?: string;
  readonly uploadMaxBytes?: number;

  constructor(
    kind: ErrorKind,
    message?: string,
    details: {
      status?: number;
      reason?: string;
      uploadMaxBytes?: number;
    } = {},
  ) {
    super(message ?? kind);
    this.name = 'ClipperError';
    this.kind = kind;
    this.status = details.status;
    this.reason = details.reason;
    this.uploadMaxBytes = details.uploadMaxBytes;
  }
}

export interface SerializedError {
  kind: ErrorKind;
  message: string;
  status?: number;
  reason?: string;
  uploadMaxBytes?: number;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof ClipperError)
    return {
      kind: err.kind,
      message: err.message,
      status: err.status,
      reason: err.reason,
      uploadMaxBytes: err.uploadMaxBytes,
    };
  return { kind: 'server', message: err instanceof Error ? err.message : String(err) };
}

/** chrome.i18n key of the message shown for each kind. */
export function errorMessageKey(kind: ErrorKind): string {
  return `error_${kind}`;
}
