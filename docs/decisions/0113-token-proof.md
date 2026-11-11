# 0113 — Token proof: the server proves it is the one that issued a token

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

- `POST /api/v1/me/token-proof-key` (an app token only: a browser session or a personal API
  token gets 403, since scripts have no network to confirm) returns `{ instanceId, keyId, key }`.
  The key is 32 random bytes made at the first call and returned again while the token lives, so
  a client whose secure storage write failed can ask again. It is stored sealed with
  `AUTH_SECRET` (`sealer`, purpose `token-proof-key`) in two new columns of `personal_token`,
  `proof_key_id` (unique) and `proof_key`, and is deleted with the token. A key that no longer
  opens (the secret was rotated) is replaced at the next call. `keyId` is random, not the token
  id. Answers carry `Cache-Control: no-store`; nothing is logged.
- `POST /api/v1/token-proof` takes `{ keyId, nonce }` with no token, and answers
  `{ instanceId, purpose: "unlock-network", proof }` where
  `proof = base64url(HMAC-SHA256(key, "inkadra-token-proof/v1\n" + purpose + "\n" + instanceId +
  "\n" + keyId + "\n" + nonce))`. An unknown key, or one whose token was revoked, expired or
  whose account is deactivated, or one that no longer opens, gets the same 404 with the same body
  from the same single query: the endpoint does not tell them apart. It only reads the database,
  accepts a body of at most 1 KiB, is rate limited to 30 requests a minute per address and 10 a
  minute per `keyId`, and neither the key id nor the nonce is logged.
- `instanceId` is a random id the server makes at the first enrolment (an authenticated request)
  and keeps in `instance_setting` (`instance-id`).

### What a client must do

The server cannot enforce these; the protection holds only if clients follow them.

1. **The capability is read only where the token may already go.** `GET /instance/version`
   needs the token, so a client reads it only on a connection it already trusts (right after
   sign-in, or after the person confirmed the network) and asks for the key there, never on a
   connection it opened because of a proof. Once it holds a key, **the key is the capability**:
   on a connection it has not confirmed, the first and only request is `POST /token-proof`.
2. **Fail closed.** A client that holds a key sends the token on an unconfirmed connection only
   after a valid proof: the HMAC it computes itself over its own fresh nonce (32 random bytes,
   used once), the `instanceId` it stored, an answer within a few seconds on the same network.
   Anything else (a wrong proof, 404, 400, 429, 5xx, a timeout, an unreadable body) leaves the
   token on the phone: "not this server" or "could not check, try again later". An impostor can
   answer any of these, so none of them may lead to the ordinary "is this your network?"
   question.
3. **Recovery is an exception, not a prompt.** When the real server lost the key (a rotated
   `AUTH_SECRET`, an instance restored without it), the person must take an explicit action for
   that account in the app's settings, worded as the exception it is; the client then trusts the
   connection and enrols again. Only clients of servers without the capability (that never got a
   key) ask the person on a new network.

## What it does not protect

- Someone listening on the network where the token is used over plain http sees the token, and
  the key when it is given. That is what plain http means; the proof only stops the token being
  sent to a different machine at the same address.
- A relay: an attacker on another network who can reach the real server (a port forward, a
  compromised machine on the home network) can pass the nonce to it and return its proof, then
  read the token the client sends next. The proof shows that the real server is reachable
  through whoever answers, not that the path is private.
- A restored copy. Instance backups contain `personal_token` (sealed keys) and
  `instance_setting` (`instance-id`). A copy restored on another machine with the **same**
  `AUTH_SECRET` (the old machine after a migration, a test restore on another network at the same
  address) proves itself as the original, and phones send it tokens that also work on the
  original. With a different secret the keys do not open: 404, and clients stay closed until the
  person recovers as above.
- Tracking: `keyId` is the same for the token's whole life and is sent, in clear, to whoever
  answers at the address on every unconfirmed network. A host that sees probes on several
  networks can recognise the device, and anyone who can also reach the real server can confirm a
  `keyId` is live and learn the `instanceId`.
- The database together with `AUTH_SECRET` lets anyone answer proofs. It is the first
  token-bound secret recoverable from them, but the two together already let anyone forge
  sessions on the instance.
- Rate limits behind a reverse proxy without `TRUST_PROXY`: every phone then shares the proxy's
  address and one budget of 30 a minute, so anyone can keep proofs at 429. Clients failing closed
  turn that into a denial ("could not check"), never into a bypass.
- Expired tokens are filtered, not deleted: their sealed keys stay in the database and its
  backups, like their hashes, until the token is revoked.
- HTTPS with a certificate accepted at first use, and short-lived tokens for http clients, would
  cover more and may follow.

## Consequences

- One migration (two nullable columns and a unique constraint), two endpoints, one capability.
- Rotating `AUTH_SECRET` makes existing proof keys unusable: the proof answers 404, clients stay
  closed until their person recovers explicitly, and then fetch a new key.
- Clients must treat anything but a valid proof as "not this server" or "could not check", and
  never send the token after it.
