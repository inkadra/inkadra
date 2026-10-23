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
  | 'server';

export class ClipperError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'ClipperError';
    this.kind = kind;
  }
}

export interface SerializedError {
  kind: ErrorKind;
  message: string;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof ClipperError) return { kind: err.kind, message: err.message };
  return { kind: 'server', message: err instanceof Error ? err.message : String(err) };
}

/** chrome.i18n key of the message shown for each kind. */
export function errorMessageKey(kind: ErrorKind): string {
  return `error_${kind}`;
}
