# 0016 · Error reasons go in `details`, not in new codes

Accepted, 2026-10.

**Context.** Clients need to tell apart answers that share a status: the two 409s about
versions (too many named versions, a version saved by a newer Inkadra), and a 500 that means
"not done, retry" from one that means "maybe done, check first" (a clip, a version save or a
restore the board did not confirm in time). Decision 0003 fixes the list of `error.code` values,
and installed clients already compare `code` with `conflict` and `internal`.

**Decision.**
- `error.code` keeps its fixed list and keeps the value it had for these answers. The new
  information goes in `error.details` as `{ reason }`, as `GuestDenied` already does for guests:
  `BoardVersionConflict` (`named_versions_limit`, `newer_schema`) on 409s about versions, and
  `OutcomeUnknown` (`outcome_unknown`) on a 500 whose outcome is unknown. A 500 without it means
  the change was not made.
- A new `reason` value is an additive change; clients treat a reason they do not know, or none,
  by the status and `code` alone, as they do today.
- Changing the `code` of an existing answer, or adding a code, would break clients that compare
  it, so it is not done within v1.

**Consequences.** Old clients keep working unchanged; new clients read `details.reason`. The
`ErrorCode` enum and the server's status table stay as they are.
