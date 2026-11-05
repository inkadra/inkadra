# 0069 — In-app reports with a private GitHub relay

Accepted design: #338, its approved mockup and the eleven decisions approved on 4 November 2026.

Updated 4 November 2026 by Matteo: this supersedes the 31 October self-hoster restriction.
Every installation without a saved choice, new or already running, sends to the Inkadra developers
by default through the public, credential-free inkadra-report-relay, as Matteo decided: an instance
that never opened these settings changes on upgrade, and the release notes say so. An empty
FEEDBACK_RELAY_URL disables it. Saved admin choices always win: existing own-repository
installations keep the direct path. The dialog sends the destination it showed, and the relay route
refuses a report that was told something else (409). A Settings switch turns developer
reporting off into Inbox; Inbox, own GitHub and Off remain available. Mandatory preview and the
report dialog disclose the private destination, readers and departure of logs and attachments.
The relay receives no reporter identity or instance URL; installation/network keys are HMACs.
It repeats #420 text neutralisation at the trust boundary and applies ticket/PoW before reading the
body, single use, per-network and per-install quotas, daily caps in reports and bytes, and names
files from a closed list of types. Selected files are committed to feedback-assets on the private
inkadra/inkadra-feedback repository, so they outlive any deletion: nothing leaves with its GPS.
TIFF, AVIF and HEIC are converted, GIF rewritten, device videos stripped with ffmpeg or refused
where there is none, and PDFs leave whole with an explicit warning. Videos are 25 MiB (direct path:
100 MiB), other files 10 MiB, reports 32 MiB total. The durable instance queue remains authoritative.
Relay faults, GitHub refusals included, are retried and never refuse a report; an ambiguous write
becomes uncertain and an administrator can retry it, because the relay recognises the requestId. GitHub attachment retention is independent
of instance retention. Deploy is manual, performed separately by the coordinator.

For the direct GitHub path:
Guests are disabled by default. The GitHub credential stays in a server environment variable;
the token belongs to a service account with Issues read/write and Metadata read on one private
repository. Visibility is checked before configuration and delivery. There are no public issues;
the direct path uses expiring instance attachment links. Destination GitHub without a token keeps
reports local until the token exists, as the approved mockup shows.

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
