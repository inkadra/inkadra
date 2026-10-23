// SPDX-License-Identifier: MPL-2.0
/** PKCE (RFC 7636) helpers for the connect flow. Only S256 is used: the server rejects plain. */

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** 32 random bytes give a 43-character verifier, the shortest RFC 7636 allows. */
export function createVerifier(): string {
  return randomBase64Url(32);
}

export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Random `state`, checked on the redirect so an unrelated code is never exchanged. */
export function createState(): string {
  return randomBase64Url(16);
}
