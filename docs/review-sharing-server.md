# Team comments, reviews and notifications

The team endpoints implement [decision 0013](decisions/0013-review-and-sharing.md) using the
existing wave-3 API and database contracts. Guest endpoints are implemented separately.

## Access and lists

Every board read and write uses `access.ts`, including closest board grants. Team readers see
all comment audiences and all guest review sources, with attribution. An audience on a new
thread must be an active link that can reach the board through visible board cards, with
editor access for its creator at each hop. Team replies carry no link and inherit their
thread's visibility. Removed cards retain their existing threads and replies.

Thread, reply, review-history and notification cursors preserve PostgreSQL's timestamp
microseconds. Notification lists filter access after paging; an empty page may still have a
next cursor. The badge and read/unread operations use the same access rules. Excerpts use the
current comment body, and mentions are rendered only while the mentioned person can read the
board.

Card existence, authorship and board-card reachability are read from the persisted board
document. Changes to a live document become available after its normal collaboration-store
debounce (currently two seconds); a request about a newly added card may need to be retried
once it has synced. These endpoints never write board documents directly.

## Stateless board notices

In `all` mode the HTTP routes send `comments` and `review` notices through the local
Hocuspocus document, including to read-only clients. They contain only invalidation metadata;
clients reload the REST endpoint with their own permissions.

In split mode, `web` enqueues a `notice` job on the existing `collab` BullMQ queue and
`collab` broadcasts it. This uses the same single-collab-process deployment model as
[decision 0014](decisions/0014-server-side-board-edits.md). It is not a fan-out mechanism for
multiple independent collaboration processes. Without Redis, a separate web process cannot
send notices. A notice is best effort, not retried, and discarded after 30 seconds: REST is
always the source of truth, and reloading recovers from a missed notice. Failed notice jobs
expire after one hour and successful ones are removed immediately.

## Notification workers

The existing `worker` role (also started in `all` mode) registers three BullMQ schedulers:
- `email:notifications`: checks every minute, grouping immediate mail for three minutes from
  the first eligible unread notification.
- `email:digest`: checks every hour; daily preferences receive at most one digest per 24 hours.
- `maintenance:purge-notifications`: removes notifications older than 90 days once a day.

Each mail contains at most 50 notifications per person; remaining unread entries are eligible
for the next run or daily digest. Pending rows are paged in bounded batches past boards the
person cannot access, so those rows cannot starve later eligible notifications. Preferences,
unread state and board access are checked at send time. The actor is excluded and a recipient
gets only one notification per event, with mentions taking priority over replies or card
comments. Email is disabled without SMTP. SMTP failures release claimed notification rows and
failed digest claims for the next scheduled run. As with any SMTP send, a worker crash between
claiming rows and recording the external outcome cannot provide exactly-once delivery.

## Cross-site writes

One `onRequest` hook in `http/app.ts` covers unsafe account-cookie requests under `/api/v1`
and every unsafe guest request, including unauthenticated session creation. `Origin` must
match `PUBLIC_URL`'s origin; if absent, `Sec-Fetch-Site` must be `same-origin`. Bearer-authenticated
account requests are exempt and invalid bearer credentials still fail authentication. The
hook exports `checkSameOrigin(req: FastifyRequest, publicUrl: string): boolean` for the guest
implementation to reuse.
