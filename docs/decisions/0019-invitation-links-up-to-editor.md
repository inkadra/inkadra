# 0019 · Invitation links give at most the editor role

Accepted, 2026-10. Amends the invitations part of [0011](0011-collaboration-and-access.md)
and, for this restriction only, the compatibility policy of [0003](0003-api-contract.md).

**Context.** A `link` invitation works for anyone who has the link until it expires or is
revoked, and it can be forwarded without the person who made it knowing. Under 0011 an owner
could make a link with the `owner` role, so whoever opened it could change members, remove
the other owners and delete the project. Owners are a short, named list; a link is not.

**Decision.** `link` invitations give `viewer`, `commenter` or `editor`
(`InvitationLinkRole` in `@inkadra/shared`). `POST /invitations` with `kind: "link"` and
`role: "owner"` is a validation error (400). Owners are named from the people of a project
(`PUT /projects/{id}/members/{userId}`) or with an `email` invitation, which works only for
its address. Links made with `owner` before API 0.6.0 stay in the database untouched: the
server reports them as `editor` and accepting one gives at most `editor`, so nobody's link
stops working and none becomes an owner. The API version goes to 0.6.0 because the change
narrows accepted values.

**Compatibility.** The maintainer-approved restriction takes effect on `/api/v1` without a
deprecation period: continuing to grant owner through links would preserve the access risk
this decision removes. This is a narrow exception to 0003's requirement for `/api/v2` or a
deprecation period for breaking changes. `API_VERSION` 0.6.0 identifies the changed contract;
the metadata bump does not create a new endpoint version or make old owner-link requests
compatible. Email invitations and member role changes retain their existing roles.

**Consequences.** Clients for older servers may still offer `owner` for links; they get a 400
from 0.6.0 servers. The share dialog offers only the roles below owner for links. No migration
is needed: the cap is applied when links are read and accepted.
