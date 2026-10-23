# 0002 · One Docker image with several roles

Accepted, 2026-10.

**Context.** Small studios want one container; larger installs want to scale the WebSocket
server and the job workers separately.

**Decision.** One image, `ghcr.io/inkadra/inkadra`, whose command selects the role: `all`,
`web`, `collab`, `worker` or `migrate`. In `all` the collaboration WebSocket shares the web port
under `/collab`, so a proxy needs a single upstream. Images are built for amd64 and arm64.
Postgres 16 and Valkey 8 run as separate containers; nothing is embedded.

**Consequences.** Every role has the same version, which avoids skew between web and workers.
The image is larger than a per-role image would be; the Docker thread of wave 1 trims it.
