import type { ApiError } from '@inkadra/shared';
import { API_PREFIX, AUTH_PREFIX } from '@inkadra/shared/constants';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // REST errors follow ApiError; Better Auth answers with { code, message }.
    const err = (body as ApiError | null)?.error ?? (body as { code?: string; message?: string });
    throw new RequestError(res.status, err?.code ?? 'unknown', err?.message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(`${API_PREFIX}${path}`),
  post: <T>(path: string, body: unknown) =>
    request<T>(`${API_PREFIX}${path}`, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(`${API_PREFIX}${path}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(`${API_PREFIX}${path}`, { method: 'DELETE' }),
};

export const authApi = {
  signIn: (email: string, password: string) =>
    request(`${AUTH_PREFIX}/sign-in/email`, {
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
