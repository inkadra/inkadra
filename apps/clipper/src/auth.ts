// SPDX-License-Identifier: MPL-2.0
import { InkadraApi } from './api.ts';
import { ClipperError } from './errors.ts';
import { challengeS256, createState, createVerifier } from './pkce.ts';
import { type Connection, clearConnection, getConnection, setConnection } from './storage.ts';

export const CLIENT_ID = 'clipper';

export interface AuthorizeRequest {
  url: string;
  verifier: string;
  state: string;
  redirectUri: string;
}

/** Address of the /authorize page of the web app (see POST /app-authorizations). */
export async function buildAuthorizeRequest(
  serverUrl: string,
  redirectUri: string,
  deviceName: string,
): Promise<AuthorizeRequest> {
  const verifier = createVerifier();
  const state = createState();
  const url = new URL(`${serverUrl}/authorize`);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    code_challenge: await challengeS256(verifier),
    code_challenge_method: 'S256',
    device_name: deviceName.slice(0, 80),
  }).toString();
  return { url: url.toString(), verifier, state, redirectUri };
}

/** Reads the code from the redirect, after checking it answers our own request. */
export function readAuthorizationCode(responseUrl: string, expectedState: string): string {
  let url: URL;
  try {
    url = new URL(responseUrl);
  } catch {
    throw new ClipperError('auth_failed', 'Unreadable redirect.');
  }
  const params = url.searchParams;
  if (params.get('state') !== expectedState)
    throw new ClipperError('auth_failed', 'The state does not match.');
  if (params.get('error')) throw new ClipperError('auth_cancelled', params.get('error') ?? '');
  const code = params.get('code');
  if (!code) throw new ClipperError('auth_failed', 'No code in the redirect.');
  return code;
}

/** "Chrome · Linux", shown on the /authorize page and in the list of tokens. */
export function deviceName(): string {
  const data = (
    navigator as Navigator & {
      userAgentData?: { brands?: { brand: string }[]; platform?: string };
    }
  ).userAgentData;
  const brand =
    data?.brands?.map((b) => b.brand).find((b) => !/not.?a.?brand|chromium/i.test(b)) ?? 'Chromium';
  const platform = data?.platform || navigator.platform || '';
  return `Inkadra Clipper · ${brand}${platform ? ` · ${platform}` : ''}`;
}

/**
 * Signs in on the server and keeps an app token. Host permission for the server must already
 * be granted: chrome.permissions.request needs the click, so the page asks before calling this.
 */
export async function connect(serverUrl: string): Promise<Connection> {
  const anonymous = new InkadraApi({ baseUrl: serverUrl });
  let uploadMaxBytes = 0;
  try {
    const instance = await anonymous.instance();
    uploadMaxBytes = instance.limits?.uploadMaxBytes ?? 0;
  } catch (err) {
    if (err instanceof ClipperError && err.kind === 'offline') throw err;
    throw new ClipperError('invalid_server', err instanceof Error ? err.message : undefined);
  }

  const request = await buildAuthorizeRequest(
    serverUrl,
    chrome.identity.getRedirectURL('auth'),
    deviceName(),
  );
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: request.url, interactive: true });
  } catch (err) {
    // Closing the window and refusing on the page both end here.
    throw new ClipperError('auth_cancelled', err instanceof Error ? err.message : undefined);
  }
  if (!responseUrl) throw new ClipperError('auth_cancelled');
  const code = readAuthorizationCode(responseUrl, request.state);

  const issued = await anonymous.exchangeCode({
    clientId: CLIENT_ID,
    code,
    codeVerifier: request.verifier,
    redirectUri: request.redirectUri,
  });
  const connection: Connection = {
    serverUrl,
    token: issued.token,
    tokenId: issued.tokenId,
    user: { name: issued.user.name, email: issued.user.email },
    uploadMaxBytes,
  };
  const previous = await getConnection();
  // Switching server: the boards remembered for the old one mean nothing here.
  if (previous && previous.serverUrl !== serverUrl) {
    await clearConnection();
    const oldOrigin = new URL(previous.serverUrl).origin;
    if (oldOrigin !== new URL(serverUrl).origin)
      await chrome.permissions.remove({ origins: [`${oldOrigin}/*`] }).catch(() => {});
  }
  await setConnection(connection);
  return connection;
}

/** Revokes the token on the server when it can, then forgets everything locally. */
export async function disconnect(): Promise<void> {
  const connection = await getConnection();
  if (connection?.token && connection.tokenId) {
    try {
      await new InkadraApi({ baseUrl: connection.serverUrl, token: connection.token }).revokeToken(
        connection.tokenId,
      );
    } catch {
      // Offline or already revoked: the token still leaves this browser.
    }
  }
  await clearConnection();
  if (connection) {
    try {
      await chrome.permissions.remove({
        origins: [`${new URL(connection.serverUrl).origin}/*`],
      });
    } catch {
      // Nothing to remove.
    }
  }
}
