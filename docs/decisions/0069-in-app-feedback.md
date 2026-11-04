# 0069 — In-app reports with a private GitHub relay

Accepted design: #338, its approved mockup and the eleven decisions approved on 4 November 2026.

Reports are disabled until an administrator chooses Inbox only or a private GitHub repository.
Guests are disabled by default. The GitHub credential stays in a server environment variable;
the token belongs to a service account with Issues read/write and Metadata read on one private
repository. Visibility is checked before configuration and delivery. There is no automatic
public destination and no attachment commits. Destination GitHub without a token keeps reports
local until the token exists, as the approved mockup shows.

The browser rasterizes the current page, with the approved new `html-to-image` dependency.
Cross-origin embeds and video may be blank; capture failure does not prevent text reporting.
The capture leaves out password and read-only fields and anything marked `data-feedback-secret`:
every new place that shows a secret on screen needs that attribute.
Screenshot redaction replaces pixels with an opaque mosaic before upload. Optional desktop
recording uses getDisplayMedia and MediaRecorder, never requests audio, stops after 60 seconds,
and is reviewed before attachment. Unsupported mobile browsers attach a system recording.

The person must preview the selected diagnostics and attachments before sending. Console
warnings/errors use a 50-entry, ten-minute buffer. No request bodies, headers or unrelated
page content are collected. Secrets, email addresses, share credentials, URLs and identifiers
are scrubbed on collection and again on the server. Text drafts stay locally; reconnecting
does not send anything. Video and screenshot editing source stay in tab memory.

The authenticated instance endpoint saves a durable local report and binds validated uploads
before delivery. Administrators receive a content-free in-app Inbox notification, opening the local report list; no report notification is emailed. Per-person and
per-instance submission limits are enforced under a database lock. Uploads have a separate
bounded budget and strict byte and type checks. Reports with the same error signature comment
on a known open issue. Requests have reporter-scoped idempotency keys. Remote writes with an
ambiguous result are marked uncertain for administrator reconciliation rather than repeated
blindly, and so are 5xx answers to a write; other failures retry with backoff. A refusal that
cannot change by itself (401, 404, 410, 422, a repository no longer private) stops, with its
reason shown to administrators, until they save the settings again.

All report text and filenames are untrusted. Characters a reader cannot see (format, control and
default-ignorable code points, tag characters included) are removed, so no hidden instruction
reaches whoever or whatever reads the issue. The fixed English issue template keeps the text as
written, with every ASCII punctuation character backslash-escaped so no Markdown or HTML is
active. Backslashes do not stop mentions: GitHub finds them after decoding Markdown, so `@`, `#`,
URL schemes and commit hashes also get an invisible separator (the method Renovate uses for
release notes). Logs sit in code fences longer than any run of backticks they contain. The issue
explicitly labels reports as data, never instructions. Reporter identity uses an abbreviated name
and role, never an email. Everyone receives a reference; only instance administrators receive the
GitHub URL.

Attachments are stored through the instance Storage abstraction, with 256-bit random bearer
URLs that expire after 90 days, or the 30 days or one year an administrator chose. Anyone holding the link can open it until expiry; the preview
and configuration explain this. Expired links stop serving immediately and a periodic sweep
removes the stored bytes. Orphan uploads expire after one day. Reports in the local database
remain for administrators; backup retention is the operator's responsibility. Embedded images
inside private GitHub issues remain unverified and require the instance to be reachable.
