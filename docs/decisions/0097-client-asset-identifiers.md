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

The pending asset row is made in its own short transaction (with the storage reservation of
decision 0081) before tus reads any of the body; tus then streams the bytes with no
transaction or lock held, and finishing works as for any upload. The asset primary key is
the only claim: no reservation table, nothing to expire.

When the row exists already (a retry, or a concurrent creation that won the primary key),
the creation is answered like tus answers one (201, `Location`, `Inkadra-Asset-Id`, and
`Upload-Offset` when bytes are stored), without touching them; the client resumes with HEAD
and PATCH. The same `clientAssetId` with another project, file name or `Upload-Length`
returns 409, which only its own uploader can reach. Access to the project is checked on
every attempt. After the purge of unfinished uploads the row is gone and the same
`clientAssetId` starts the upload again at offset zero. When tus refuses a creation before
storing anything (size, headers), the pending row made for it is removed.

Creations without `clientAssetId` keep a random server id and their behaviour. The server
advertises the `client-asset-ids` capability (0096).

## Consequences

No migration. A client must know its user id (from `/me`) to compute asset ids offline. A
finished asset that was deleted can be uploaded again under the same id by retrying.
