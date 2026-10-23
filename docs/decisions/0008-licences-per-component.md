# 0008 · Licence per component and DCO

Accepted, 2026-10. Extends [0007](0007-licence.md).

**Context.** The mobile app and the browser extension are distributed through app stores,
which do not mix well with the AGPL. They share types, schemas and geometry with the web app.

**Decision.**

| Component                                                                       | Licence       |
| ------------------------------------------------------------------------------- | ------------- |
| `apps/server`, `apps/web`, the Docker image                                     | AGPL-3.0-only |
| `apps/mobile`, `apps/clipper`                                                   | MPL-2.0       |
| `packages/shared`, `packages/doc-schema`, `packages/canvas-core`, `packages/ui` | MPL-2.0       |

Each MPL-2.0 package carries its own `LICENSE`, `"license": "MPL-2.0"` in `package.json` and
an `SPDX-License-Identifier: MPL-2.0` line at the top of every source file. Code that an
MPL-2.0 component imports must be MPL-2.0 or more permissive: never import from `apps/server`
or `apps/web` into a package. A new shared package starts as MPL-2.0.

Contributions are accepted under the Developer Certificate of Origin
(<https://developercertificate.org>): every commit carries a `Signed-off-by` line
(`git commit -s`). There is no contributor licence agreement.

**Consequences.** MPL-2.0 is file-level copyleft and compatible with the AGPL, so the server
and web app keep using the packages. Changes to a package's files stay open; apps built on
them can ship through the stores.
