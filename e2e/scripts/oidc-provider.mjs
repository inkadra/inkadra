// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in OpenID Connect provider for the end-to-end tests (audit F-20), on E2E_OIDC_PORT:
// discovery, a sign-in form at /authorize (the test types who it is), the code exchange with
// PKCE and the client secret, ID tokens signed with a key made at start (RS256, JWKS), and
// userinfo. Only node: modules, so the e2e run needs no container. One client, from
// E2E_OIDC_CLIENT_ID / E2E_OIDC_CLIENT_SECRET.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.E2E_OIDC_PORT ?? 3127);
const issuer = `http://127.0.0.1:${port}`;
const clientId = process.env.E2E_OIDC_CLIENT_ID ?? 'inkadra-e2e';
const clientSecret = process.env.E2E_OIDC_CLIENT_SECRET ?? 'inkadra-e2e-secret';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'e2e';
const codes = new Map();
const tokens = new Map();

const b64url = (value) => Buffer.from(value).toString('base64url');
function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64url(
    JSON.stringify({ iss: issuer, aud: clientId, iat: now, exp: now + 300, ...claims }),
  );
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

const html = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function form(params) {
  const hidden = [...params]
    .map(([k, v]) => `<input type="hidden" name="${html(k)}" value="${html(v)}">`)
    .join('');
  return `<!doctype html><title>E2E provider</title><form method="post" action="/authorize">${hidden}
<label>Subject <input name="sub" required></label>
<label>Email <input name="email" type="email" required></label>
<label>Name <input name="name" required></label>
<button>Sign in to the provider</button></form>`;
}

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return new URLSearchParams(text);
}

createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  const json = (status, value) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (url.pathname === '/.well-known/openid-configuration')
    return json(200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    });
  if (url.pathname === '/jwks')
    return json(200, {
      keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }],
    });
  if (url.pathname === '/authorize' && req.method === 'GET') {
    if (url.searchParams.get('client_id') !== clientId)
      return json(400, { error: 'unauthorized_client' });
    return res.writeHead(200, { 'content-type': 'text/html' }).end(form(url.searchParams));
  }
  if (url.pathname === '/authorize' && req.method === 'POST') {
    const p = await body(req);
    const code = randomBytes(16).toString('hex');
    codes.set(code, {
      redirectUri: p.get('redirect_uri'),
      challenge: p.get('code_challenge'),
      claims: {
        sub: p.get('sub'),
        email: p.get('email'),
        email_verified: true,
        name: p.get('name'),
        ...(p.get('nonce') ? { nonce: p.get('nonce') } : {}),
      },
    });
    const back = new URL(p.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    if (p.get('state')) back.searchParams.set('state', p.get('state'));
    back.searchParams.set('iss', issuer);
    return res.writeHead(302, { location: back.toString() }).end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const p = await body(req);
    const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const [id, secret] = basic
      ? Buffer.from(basic, 'base64').toString().split(':').map(decodeURIComponent)
      : [p.get('client_id'), p.get('client_secret')];
    if (id !== clientId || secret !== clientSecret) return json(401, { error: 'invalid_client' });
    const grant = codes.get(p.get('code') ?? '');
    codes.delete(p.get('code') ?? '');
    const verifier = p.get('code_verifier') ?? '';
    if (
      !grant ||
      grant.redirectUri !== p.get('redirect_uri') ||
      createHash('sha256').update(verifier).digest('base64url') !== grant.challenge
    )
      return json(400, { error: 'invalid_grant' });
    const accessToken = randomBytes(16).toString('hex');
    const { nonce: _, ...profile } = grant.claims;
    tokens.set(accessToken, profile);
    return json(200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken(grant.claims),
    });
  }
  if (url.pathname === '/userinfo') {
    const profile = tokens.get(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
    return profile ? json(200, profile) : json(401, { error: 'invalid_token' });
  }
  json(404, { error: 'not_found' });
}).listen(port, '127.0.0.1');
