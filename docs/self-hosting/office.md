# Office document previews

Office previews are optional. The standard image excludes LibreOffice. Without conversion, DOCX/XLSX/PPTX/ODT/ODS/ODP/CSV retain their type icon and
original download. CSV and XLSX grid previews and first-sheet-to-table work without conversion.

## The worker image

Every tag from 0.8.0 on also exists with the suffix `-office` (`ghcr.io/inkadra/inkadra:0.9.0-office`,
`latest-office`, `edge-office`…): the standard image plus LibreOffice (Writer, Calc, Impress),
fonts, Poppler, bubblewrap and `prlimit`, everything the converter needs. It is built, attested
and published like the other variants, for linux/amd64 and linux/arm64. Pin the version you run,
with `-office`.

To build the worker image:

```sh
docker build --build-arg OFFICE=true -t inkadra-office-worker .
```

After 0.9.0, Office images also include all media tools. Use the image for an extra **worker** role
only, with your existing database, Redis and storage settings. The web/collab roles keep their
ordinary image.

Office documents travel on their own `office` queue, which only a worker with
`OFFICE_PREVIEWS=true` **and** LibreOffice reads. With `OFFICE_PREVIEWS=true` in `.env`, every
container gets it: the ones that run workers without LibreOffice (the single `all` container, or
each `worker` of the split layout) only send Office documents to that queue and never convert
them themselves. A container without `OFFICE_PREVIEWS` reads
Office documents itself, with CSV/XLSX grids and icon cards only, so leave the variable off
everywhere if you run no `-office` worker: with it on and no such worker, Office cards stay
"processing" until one starts.

Do not expose a converter HTTP endpoint or mount the Docker socket. The worker
needs network access to its queue/storage; its LibreOffice child has a separate network
namespace with no interfaces.

LibreOffice adds roughly 600–800 MiB uncompressed depending on architecture/version; the
base image is unchanged. Allocate at least 4 GiB address space and adequate worker memory,
plus scratch disk for the 32 MiB input, 64 MiB PDF and page renders. Keep worker concurrency
low. Conversion lasts at most 60 seconds, followed by a bounded Poppler pass (50 pages maximum,
32 MiB of WebP pages, 120-second deadline checked between individually timed page renders).

## Let Docker create namespaces, without `seccomp=unconfined`

The converter runs inside bubblewrap, which needs unprivileged user, mount, PID and network
namespaces. Docker's default seccomp profile refuses `unshare`, `setns`, `mount` and `clone`
with namespace flags, so on a default container the sandbox cannot start and conversion
**fails closed** (the original stays usable). The fix is a seccomp profile of your own that adds
only those calls to Docker's default one, never `seccomp=unconfined`, `--privileged` or
extra capabilities.

Create the profile next to your compose file (needs `curl` and `jq`; without `jq`, append the
same object to the `syscalls` array of the default profile by hand):

```sh
curl -fsSL https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json \
  | jq '.syscalls += [{"names": ["clone", "clone3", "unshare", "setns", "mount", "umount2",
      "pivot_root", "sethostname", "setdomainname"], "action": "SCMP_ACT_ALLOW"}]' \
  > inkadra-office-seccomp.json
```

Set `OFFICE_PREVIEWS=true` in `.env`, then add the worker next to the single container of the
default install (`command: all`):

```yaml
# compose.office.yaml: docker compose -f compose.yaml -f compose.office.yaml up -d
services:
  office-worker:
    extends: # same database, Redis, storage and volume settings
      file: compose.yaml
      service: inkadra
    # Same version as the other roles; set INKADRA_TAG without a suffix (for example 0.9.0).
    image: ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-latest}-office # or inkadra-office-worker
    command: worker
    user: "1000:1000" # the main container has already prepared /data
    cap_add: !reset []
    ports: !reset []
    depends_on:
      inkadra:
        condition: service_healthy
    security_opt:
      - seccomp=./inkadra-office-seccomp.json
    cap_drop: [ALL]
```

The `inkadra` container keeps its ordinary image and keeps making every other preview. With the
split layout (`deploy/compose.split.yaml`), give the `worker` role the image instead:

```yaml
# compose.office.yaml: docker compose -f compose.yaml -f deploy/compose.split.yaml -f compose.office.yaml up -d
services:
  worker:
    user: "1000:1000" # /data must already belong to this user
    cap_add: !reset []
    # Same version as the other roles; set INKADRA_TAG without a suffix (for example 0.9.0).
    image: ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-latest}-office # or inkadra-office-worker
    security_opt:
      - seccomp=./inkadra-office-seccomp.json
    cap_drop: [ALL]
```

`cap_drop: [ALL]`, `no-new-privileges` and a read-only root file system all work with it
(checked on Docker 29 with bubblewrap 0.12). The extra calls are allowed to the worker's
processes, so only the worker gets this profile, and inside, the converter is sandboxed again
by a second filter that denies them (and `io_uring`, the kernel keyring, `ptrace`, mounts, eBPF…)
and its own user namespaces are forbidden: bubblewrap's `--disable-userns` when the container
lets it, and otherwise that same filter, which refuses `clone` with `CLONE_NEWUSER`.
`--disable-userns` needs a writable `/proc/sys`: it is skipped on a default container, and used
if you add `systempaths=unconfined` to `security_opt` (optional, not needed for safety).

Check the sandbox before enabling conversion for users, as the user the worker runs as and
without the image's entrypoint, which only accepts Inkadra roles (the service is `office-worker`
with the single-container layout, `worker` with the split one; add the same `-f` files as for
`up`):

```sh
docker compose run --rm --no-deps --user node --entrypoint bwrap office-worker \
  --unshare-all --unshare-user \
  --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --proc /proc --dev /dev /usr/bin/true && echo sandbox ok
```

Then upload a DOCX: its card should show the first page. If the card only shows an icon, the
worker log says `Office conversion unavailable` with the reason.

**Other hosts.** The worker log says what the sandbox hit. On a Linux host where Docker applies
AppArmor, the seccomp profile is not enough, and these two lines of the log each have one fix, for
the worker alone:

| Worker log                                                  | Add to the worker's `security_opt` |
| ----------------------------------------------------------- | ---------------------------------- |
| `bwrap: Failed to make / slave: Permission denied`          | `apparmor=unconfined`              |
| `bwrap: Can't mount proc on /proc: Operation not permitted` | `systempaths=unconfined`           |

Both were checked on such a host, together, with `cap_drop: [ALL]` and `no-new-privileges`. They
take protections off that container, which holds your database credentials, while the converter
inside stays sandboxed: if you prefer, write an AppArmor profile that allows only these calls.
Ubuntu 23.10+ also restricts unprivileged user namespaces. Rootless Docker and Podman need
`kernel.unprivileged_userns_clone`/`user.max_user_namespaces` above zero; those were not tested.
Do not enable privileged mode or remove sandboxing to make it work.
Without `bubblewrap`, `prlimit`, LibreOffice, a permitted namespace or a supported architecture
(x86-64 and arm64) the worker keeps the icon card.

## What the converter can reach

The converter sees system binaries, fonts and LibreOffice's configuration read-only, the
document in a read-only folder, a folder for its PDF and its settings, and a 256 MiB memory
`/tmp`. It cannot see other uploads, the data volume or the server's environment variables, and
it has no network. It runs with 4 GiB of address space, 64 MiB per file, 1,024 tasks and 60
seconds. Macros never run and links are never refreshed (a settings file is placed in its
profile for that). What it writes is not trusted: the worker accepts only a regular `%PDF-` file
of at most 64 MiB, and copies it before Poppler reads it.

## Operating notes

Only newly processed files gain Office previews; enabling the worker does not reprocess
existing documents. Pages of a reprocessed document get a new URL. Conversion errors, encrypted files, excessive pages and archive bombs leave the original
intact. Font/layout substitution may occur: the viewer's Info panel explains this and always
offers the original download.

CSV/XLSX grids are limited to 500 rows × 20 columns per sheet (10,000 cells and 16 sheets per
workbook). A bigger sheet is shown up to those limits with a "…" row and a note, and cannot be
turned into a table, so a budget is never imported in part; a sheet too big to read says so and
offers the original. Hidden sheets are not shown. CSV files in Windows-1252 or UTF-16 and with
semicolons or tabs, as Excel writes them, are read. Limits and rationale are in
[ADR 0065](../decisions/0065-office-previews.md).
