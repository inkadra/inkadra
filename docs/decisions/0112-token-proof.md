# 0112 — Token proof: the server proves it is the one that issued a token

Status: proposed. Builds on [0099](0099-invalid-token-reasons.md).

## Context

A self-hosted server on a local network is often reached over plain http
(`http://192.168.1.20:3000`, `http://nas.local`). The same address on another network (a café,
a hotel, an office, a carrier's network for `100.64/10`) is someone else's machine. A client
holding an app token for that server must not send it there, and app tokens do not expire. The
client can see that the network changed, but not whether the machine answering at the address
is the same one: Wi-Fi names need extra permissions on phones and are not unique, and a gateway
address is the same in most homes.

The server can tell, if it has something the client also has and an impostor does not: a key
bound to the token, given where the client trusts the connection.

## Decision

Servers advertise the capability `token-proof` on `GET /instance/version`.

- `POST /api/v1/me/token-proof-key` (bearer token only; a browser session gets 403) returns
  `{ instanceId, keyId, key }`. The key is 32 random bytes made at the first call and returned
  again while the token lives, so a client whose secure storage write failed can ask again. It
  is stored sealed with `AUTH_SECRET` (`sealer`, purpose `token-proof-key`) in two new columns of
  `personal_token`, `proof_key_id` (unique) and `proof_key`, and is deleted with the token. A
  key that no longer opens (the secret was rotated) is replaced at the next call. `keyId` is
  random, not the token id. Answers carry `Cache-Control: no-store`; nothing is logged.
- `POST /api/v1/token-proof` takes `{ keyId, nonce }` with no token, and answers
  `{ instanceId, purpose: "unlock-network", proof }` where
  `proof = base64url(HMAC-SHA256(key, "inkadra-token-proof/v1\n" + purpose + "\n" + instanceId +
  "\n" + keyId + "\n" + nonce))`. An unknown key, or one whose token was revoked, expired or
  whose account is deactivated, gets the same 404 from the same single query: the endpoint does
  not tell them apart. It is rate limited to 30 requests a minute per address and 10 a minute
  per `keyId`, and neither the key id nor the nonce is logged.
- `instanceId` is a random id the server makes once and keeps in `instance_setting`
  (`instance-id`).

The client asks for the key only on a connection it trusts because the person made it so (right
after sign-in, or after the person confirmed the network), never on one it opened because of a
proof, and keeps it like the token. On a network it has not confirmed, before
anything carries the token, it sends 32 fresh random bytes as the nonce and computes the HMAC
itself; only an answer that matches, names the `instanceId` it stored, and arrives within a few
seconds on the same network lets it send the token on that connection. The nonce is used once,
so a recorded answer is useless. The server keeps no nonces: freshness is the client's check.

## What it does not protect

- Someone listening on the network where the token is used over plain http sees the token, and
  the key when it is given. That is what plain http means; the proof only stops the token being
  sent to a different machine at the same address.
- A relay: an attacker on another network who can reach the real server (a port forward, a
  compromised machine on the home network) can pass the nonce to it and return its proof, then
  read the token the client sends next. The proof shows that the real server is reachable
  through whoever answers, not that the path is private.
- A client that falls back to asking the person (an older server, a 404) is only as safe as the
  person's answer.
- HTTPS with a certificate accepted at first use, and short-lived tokens for http clients, would
  cover more and may follow.

## Consequences

- One migration (two nullable columns and a unique constraint), two endpoints, one capability.
- Rotating `AUTH_SECRET` makes existing proof keys unusable: the proof answers 404 and clients
  fall back to asking their person, then fetch a new key.
- Clients must treat a wrong proof as "not this server" and never send the token after it.
