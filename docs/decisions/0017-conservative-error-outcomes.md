# 0017 · Missing error reasons leave mutation outcomes unknown

Accepted, 2026-10. Supersedes the retry semantics of decision 0016.

**Context.** Existing servers return `internal` without `details` even after
`CardOutcomeUnknown` during clip creation, version saving and version restoration.
Therefore the absence of `outcome_unknown` cannot prove that a change was not made.

**Decision.** For these mutations, clients treat a 500 as an uncertain outcome whether
`details.reason` is `outcome_unknown`, missing, malformed or unrecognized. They must
reconcile board/version state before retrying. If reconciliation cannot establish the
outcome, they keep it uncertain and do not automatically retry. Failure to parse
`OutcomeUnknown` is not evidence of a certain failure. Neither the presence of a different
reason nor the API document version proves that a retry is safe.

No certain-failure reason or server capability is introduced here. Such a guarantee would
require a separately defined contract and a server implementation that can verify it.
Other unknown error reasons continue to fall back to status and code, without inferring
that a mutation is safe to retry.

**Consequences.** `error.code` and the permissive optional `error.details` remain unchanged.
Old payloads still parse and old clients remain compatible. New clients can use the explicit
reason to explain uncertainty, but must use the conservative fallback with older servers.
No endpoint implementation changes are required by this contract correction.
