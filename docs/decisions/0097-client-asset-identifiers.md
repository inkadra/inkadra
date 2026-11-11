# 0097 — Client asset ids for resumable uploads

Status: accepted. Follows [0096](0096-authenticated-client-compatibility.md).

## Context

A card made offline needs the id of its file before the upload reaches the server, and a
client that lost the answer to a tus creation must be able to retry it without a second
asset. Asset ids are global and appear in board documents that collaborators sync, so an id
the client chooses outright could be taken first by someone else (blocking the real upload
for good) or probed (a 409 would tell that it exists).

## Decision

A tus creation may carry `clientAssetId` (a UUID) in `Upload-Metadata`. The server does not
use it as the asset id: it derives

    assetId = UUIDv5(namespace = the uploader's user id, name = lowercase clientAssetId)

(`clientAssetUploadId` in `packages/shared`, with a test vector). The client computes the
same id offline. Another account sending the same `clientAssetId` gets a different asset, so
nobody can occupy or probe someone else's id, and no answer depends on other people's files.

The creation goes through tus like any other, so tus checks the protocol first (version,
headers, lengths, maximum size) on every attempt, retries included; a refusal there makes
nothing. Then, in tus's creation hook and under a short PostgreSQL lock on the asset id:

- **New id**: the pending asset (with the storage reservation of decision 0081), a
  `client_asset` row and the stored upload are made together, so no step can be left half
  done. The lock and transaction end there; tus streams any body with none held.
- **Existing, unfinished**: answered as tus answers a creation (201, `Location`,
  `Upload-Expires`, plus `Upload-Offset`), the stored bytes left alone; the client resumes with
  HEAD and PATCH. A row whose stored upload went missing (a crash between the two) gets it
  made again, empty.
- **Existing, finished** (processing, ready or failed): answered the same way with the full
  offset. It is never written, replaced or processed again.
- **Deleted** (the asset row is gone but `client_asset` remains: trash emptied, card or
  logo removed, upload cancelled): refused with 409 and `details.reason:
  client_asset_deleted`. A blind retry never makes it again, so a new upload can never meet
  the media jobs of an old one (they are keyed by asset id and kept for a while); the client
  makes a new `clientAssetId`.
- The same `clientAssetId` for another project, file name or `Upload-Length`: 409. Both
  refusals are reachable only by the id's own uploader, after the access check.

The purge of unfinished uploads takes the same lock and checks the row again before removing
it, so it can never remove a newer upload with the same id. It removes the `client_asset`
row with the asset: an upload that never finished may start again at offset zero. A
cancellation (tus DELETE) takes the lock too and keeps `client_asset`.

Creations without `clientAssetId` keep a random server id and their behaviour. The server
advertises the `client-asset-ids` capability (0096).

## Consequences

Migration `0039_client_asset_ids` adds `client_asset` (id, user, created), removed with the
account; one row per finished client-id upload. A client must know its user id (from `/me`)
to compute asset ids offline, and must mint a new `clientAssetId` after
`client_asset_deleted`.
