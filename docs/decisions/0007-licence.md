# 0007 · AGPL-3.0 and allowed dependency licences

Accepted, 2026-10.

**Decision.** Inkadra is licensed under AGPL-3.0-only. Production dependencies must use a
licence compatible with distributing under it: MIT, ISC, BSD, Apache-2.0, MPL-2.0, LGPL,
CC0, OFL and similar permissive licences. `pnpm licenses` (in CI) enforces the list in
`scripts/check-licenses.mjs`; an exception needs a new decision record.

**Consequences.** Anyone who runs a modified Inkadra for others over a network must offer
the source of their version. The app shows the licence on the sign-in screen.
