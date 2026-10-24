// SPDX-License-Identifier: MPL-2.0
import type {
  ApiError,
  AppToken,
  Board,
  ClipRequest,
  ClipResult,
  ExchangeAppCode,
  Instance,
  Project,
  SearchHit,
} from '@inkadra/shared';
import { API_PREFIX } from '@inkadra/shared/constants';
import { ClipperError, type ErrorKind } from './errors.ts';

export interface ApiOptions {
  /** Server address from parseServerUrl, without a trailing slash. */
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

/** Fields of a multipart clip, next to the `file` part (see POST /api/v1/clip). */
export interface ClipFileFields {
  boardId: string;
  columnId?: string;
  sourceUrl?: string;
  note?: string;
}

const STATUS_KINDS: Record<number, ErrorKind> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'too_large',
  429: 'rate_limited',
};

/** Client for the few endpoints the clipper uses. Every failure becomes a ClipperError. */
export class InkadraApi {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  instance(): Promise<Instance> {
    return this.request<Instance>('GET', '/instance', { auth: false });
  }

  exchangeCode(body: ExchangeAppCode): Promise<AppToken> {
    return this.request<AppToken>('POST', '/app-authorizations/token', { auth: false, json: body });
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.request<void>('DELETE', `/me/tokens/${encodeURIComponent(tokenId)}`);
  }

  async projects(): Promise<Project[]> {
    const page = await this.request<{ items: Project[] }>('GET', '/projects?limit=200');
    return page.items;
  }

  async projectBoards(projectId: string): Promise<Board[]> {
    const page = await this.request<{ items: Board[] }>(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/boards`,
    );
    return page.items;
  }

  async sharedBoards(): Promise<Board[]> {
    const page = await this.request<{ items: Board[] }>('GET', '/shared-boards');
    return page.items;
  }

  async search(q: string, limit = 20): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    const result = await this.request<{ items: SearchHit[] }>('GET', `/search?${params}`);
    return result.items;
  }

  clip(body: ClipRequest): Promise<ClipResult> {
    return this.sendClip({ json: body });
  }

  clipFile(fields: ClipFileFields, file: Blob, filename: string): Promise<ClipResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields))
      if (value !== undefined) form.append(key, value);
    // The file goes last so a streaming parser has the fields before the bytes.
    form.append('file', file, filename);
    return this.sendClip({ form });
  }

  /**
   * A server error on a clip does not mean the card is missing: the server may have written it
   * and failed to say so. Retried blindly, it would be saved twice.
   */
  private async sendClip(options: { json?: ClipRequest; form?: FormData }): Promise<ClipResult> {
    try {
      return await this.request<ClipResult>('POST', '/clip', options);
    } catch (err) {
      if (err instanceof ClipperError && err.kind === 'server')
        throw new ClipperError('clip_unconfirmed', err.message);
      throw err;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: { auth?: boolean; json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.auth !== false) {
      if (!this.token) throw new ClipperError('not_connected');
      headers.Authorization = `Bearer ${this.token}`;
    }
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${API_PREFIX}${path}`, {
        method,
        headers,
        body,
        credentials: 'omit',
      });
    } catch (err) {
      // fetch only rejects when no answer arrived: no network, DNS, TLS or a refused connection.
      throw new ClipperError('offline', err instanceof Error ? err.message : undefined);
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      try {
        return (await res.json()) as T;
      } catch {
        throw new ClipperError('invalid_server', 'The answer is not JSON.');
      }
    }
    throw await toError(res);
  }
}

async function toError(res: Response): Promise<ClipperError> {
  let payload: ApiError | undefined;
  try {
    payload = (await res.json()) as ApiError;
  } catch {
    payload = undefined;
  }
  const code = payload?.error?.code;
  const kind: ErrorKind =
    code === 'payload_too_large'
      ? 'too_large'
      : (STATUS_KINDS[res.status] ?? (res.status >= 500 ? 'server' : 'bad_request'));
  return new ClipperError(kind, payload?.error?.message ?? `HTTP ${res.status}`);
}
