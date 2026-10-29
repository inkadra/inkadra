# 0032 — Public instance metadata and administrator policy storage

## Context

Issue #225 requests removal of software versions from unauthenticated health and instance
responses for 0.4.2. The existing administration row already stores validated JSON settings.

## Decision

Remove `version` from Health and Instance, including their OpenAPI definitions. This is an
explicit security-driven v1 field removal requested for 0.4.2; consumers must tolerate the
absence rather than fail server discovery. The clipper does not read this field. The web
settings footer obtains it from authenticated GET /instance/version; diagnostics retain it.
Old web builds can temporarily display an empty version until refreshed.

Add `requireAdminTwoFactor`, default false, to the administration settings contract. Store
it in the existing JSON row with no SQL migration. Enforcement is in the independent auth
PR, decision 0031. Review and land the contract before enabling the policy. Do not enable it
on a server without that enforcement.

## Consequences

Health checks remain usable anonymously without disclosing the release. Old installations
interpret an absent policy as false. Maintainers must approve this contract change before
shipping the accompanying auth behavior. No bearer token or diagnostic schema changes.

## Review follow-up

`InstanceSettings` responses always include the effective policy, including false on
older installations; OpenAPI therefore requires the field. Its read-time default lives in
the server, while PATCH omissions remain optional and never reset the stored value.
Activation is rejected unless the current database row of the requesting administrator
has verified 2FA. The UI disables activation until enrollment and refreshes its session
after every successful setting change. Release and upgrade notes explicitly describe the
public version-field removal.

## Maintainer approval — 2026-10-29

Contract exception **approved by the maintainer on 2026-10-29**: remove `version` from
`GET /api/v1/health` and `GET /api/v1/instance` in v1 **without a deprecation period**.
This explicit approval is limited to these public software-version fields. Operators must
update monitors and dashboards that read the version from `/health`; the public health
response continues to provide status and dependency checks, but no release identifier.
