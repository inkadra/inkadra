import type { ApiError } from '@inkadra/shared';
import { API_PREFIX, AUTH_PREFIX } from '@inkadra/shared/constants';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, binary = false): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.ok && binary) return new Uint8Array(await res.arrayBuffer()) as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // REST errors follow ApiError; Better Auth answers with { code, message }.
    const err = (body as ApiError | null)?.error ?? (body as { code?: string; message?: string });
    throw new RequestError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? res.statusText,
      (body as ApiError | null)?.error?.details,
    );
  }
  return body as T;
}

export const api = {
  bytes: (path: string) => request<Uint8Array>(`${API_PREFIX}${path}`, {}, true),
  get: <T>(path: string) => request<T>(`${API_PREFIX}${path}`),
  post: <T>(path: string, body: unknown) =>
    request<T>(`${API_PREFIX}${path}`, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(`${API_PREFIX}${path}`, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(`${API_PREFIX}${path}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(`${API_PREFIX}${path}`, {
      method: 'DELETE',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
};

const auth = <T>(path: string, body?: unknown) =>
  request<T>(`${AUTH_PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Starts Google or OIDC sign-in: the browser leaves for the provider and comes back. */
async function redirectTo(path: string, body: unknown) {
  const { url } = await auth<{ url: string }>(path, body);
  window.location.assign(url);
}

export const authApi = {
  social: (provider: string, callbackURL: string) =>
    redirectTo('/sign-in/social', {
      provider,
      callbackURL,
      errorCallbackURL: `/login?next=${encodeURIComponent(callbackURL)}`,
    }),
  linkSocial: (provider: string, callbackURL: string) =>
    redirectTo('/link-social', { provider, callbackURL, errorCallbackURL: callbackURL }),
  magicLink: (email: string, callbackURL: string) =>
    auth('/sign-in/magic-link', { email, callbackURL }),
  verifyTotp: (code: string, trustDevice: boolean) =>
    auth('/two-factor/verify-totp', { code, trustDevice }),
  verifyBackupCode: (code: string) => auth('/two-factor/verify-backup-code', { code }),
  enableTwoFactor: (password: string) =>
    auth<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password }),
  disableTwoFactor: (password: string) => auth('/two-factor/disable', { password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    auth('/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
  requestPasswordReset: (email: string) =>
    auth('/request-password-reset', { email, redirectTo: '/reset-password' }),
  resetPassword: (token: string, newPassword: string) =>
    auth('/reset-password', { token, newPassword }),
  revokeOtherSessions: () => auth('/revoke-other-sessions', {}),
  listAccounts: () => auth<Array<{ id: string; providerId: string }>>('/list-accounts'),
  unlinkAccount: (providerId: string) => auth('/unlink-account', { providerId }),
  signIn: (email: string, password: string) =>
    request<{ twoFactorRedirect?: boolean }>(`${AUTH_PREFIX}/sign-in/email`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signUp: (name: string, email: string, password: string) =>
    request(`${AUTH_PREFIX}/sign-up/email`, {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  signOut: () => request(`${AUTH_PREFIX}/sign-out`, { method: 'POST', body: '{}' }),
};
