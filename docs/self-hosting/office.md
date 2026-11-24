# Office document previews

Office previews are optional. The standard image excludes LibreOffice. Without conversion, DOCX/XLSX/PPTX/ODT/ODS/ODP/CSV retain their type icon and
original download. CSV and XLSX grid previews and first-sheet-to-table work without conversion.

## The worker image

Every tag from 0.8.0 on also exists with the suffix `-office` (`ghcr.io/inkadra/inkadra:0.10.0-office`,
`latest-office`, `edge-office`…): the standard image plus LibreOffice (Writer, Calc, Impress),
fonts, Poppler, bubblewrap and `prlimit`, everything the converter needs. It is built, attested
and published like the other variants, for linux/amd64 and linux/arm64. Pin the version you run,
with `-office`.

To build the worker image:

```sh
docker build --build-arg OFFICE=true -t inkadra-office-worker .
```

From 0.10.0, Office images also include all media tools. Use the image for an extra **worker** role
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
**fails closed** (the original stays usable). The fix is a seccomp profile (shipped as `deploy/office-seccomp.json`) that adds
only those calls to Docker's default one, never `seccomp=unconfined`, `--privileged` or
extra capabilities.

## Turn it on

`deploy/compose.office.yaml` adds the worker, with the profile below ready in
`deploy/office-seccomp.json`. Run it from the folder of `compose.yaml`, with the `deploy` folder
next to it:

```sh
docker compose -f compose.yaml -f deploy/compose.office.yaml up -d
```

It starts an `office-worker` service (command `worker`) on the same version as the other roles
with `-office` added (`INKADRA_TAG` stays without suffix, for example `0.10.0`; `INKADRA_IMAGE`
works as usual), with the same database, Redis, storage and data volume, and sets
`OFFICE_PREVIEWS=true` on it and on `inkadra`. The worker waits for `inkadra` to be healthy,
drops every capability, keeps `no-new-privileges`, and has its own limits and log rotation:
`INKADRA_OFFICE_MEM_LIMIT` (4g), `INKADRA_OFFICE_CPUS` (no limit) and
`INKADRA_OFFICE_PIDS_LIMIT` (1024), and `LOG_MAX_SIZE`/`LOG_MAX_FILES` as in `compose.yaml`.
The `inkadra` container keeps its ordinary image and makes every other preview.

With the split layout, add both files that carry the worker role's variable:

```sh
docker compose -f compose.yaml -f deploy/compose.split.yaml -f deploy/compose.office.yaml \
  -f deploy/compose.office.split.yaml up -d
```

The ordinary `worker` then only sends Office documents to the queue the `office-worker` reads.
Other stack layouts: set `OFFICE_PREVIEWS=true` for every container that runs workers (in `.env`
with the bundled compose files) and add the `-office` worker as above.

`deploy/office-seccomp.json` is Docker's default seccomp profile at a fixed commit of
[moby/profiles](https://github.com/moby/profiles/blob/7b5ccfab2d6b4e0aa64c6cce401a2705788eafeb/seccomp/default.json)
(SHA-256 `15434cc9c9037d85b35027a60721bf45f381782b4283b01d94663366e71569f8`) with one rule
added that allows `clone`, `clone3`, `unshare`, `setns`, `mount`, `umount2`, `pivot_root`,
`sethostname` and `setdomainname`. CI regenerates it and fails if the file differs. To rebuild
it yourself (needs `curl`, `sha256sum` and `jq`; on macOS `shasum -a 256 -c -`):

```sh
curl -fsSL -o docker-default-seccomp.json \
  https://raw.githubusercontent.com/moby/profiles/7b5ccfab2d6b4e0aa64c6cce401a2705788eafeb/seccomp/default.json
echo "15434cc9c9037d85b35027a60721bf45f381782b4283b01d94663366e71569f8  docker-default-seccomp.json" \
  | sha256sum -c - &&
jq '.syscalls += [{"names": ["clone", "clone3", "unshare", "setns", "mount", "umount2",
    "pivot_root", "sethostname", "setdomainname"], "action": "SCMP_ACT_ALLOW"}]' \
  docker-default-seccomp.json > deploy/office-seccomp.json
```

`cap_drop: [ALL]`, `no-new-privileges` and a read-only root file system all work with it
(checked on Docker 29 with bubblewrap 0.12, and by CI: before an `-office` image is tagged,
`scripts/test-office.sh` converts a Word document in it with these options, on amd64 and arm64). The extra calls are allowed to the worker's
processes, so only the worker gets this profile, and inside, the converter is sandboxed again
by a second filter that denies them (and `io_uring`, the kernel keyring, `ptrace`, mounts, eBPF…)
and its own user namespaces are forbidden: bubblewrap's `--disable-userns` when the container
lets it, and otherwise that same filter, which refuses `clone` with `CLONE_NEWUSER`.
`--disable-userns` needs a writable `/proc/sys`: it is skipped on a default container, and used
if you uncomment `systempaths=unconfined` in the overlay (optional, not needed for safety).

Check the sandbox before enabling conversion for users, as the user the worker runs as and
without the image's entrypoint, which only accepts Inkadra roles (add the same `-f` files as
for `up`):

```sh
docker compose run --rm --no-deps --user node --entrypoint sh office-worker -c \
  'bwrap --unshare-all --unshare-user \
    --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
    --proc /proc --dev /dev /usr/bin/true' && echo sandbox ok
```

The shell starts bubblewrap from inside the container, as the worker does. Do not make `bwrap`
the entrypoint or run it with `docker exec`: Docker then starts it itself, and on hosts where an
AppArmor profile lets bubblewrap use user namespaces (below) that profile does not apply to it.
Such a check stops at `bwrap: loopback: Failed RTM_NEWADDR` even though the worker converts
(seen on Ubuntu 26.04 with Docker 29.1.3 and runc 1.4).

Then upload a DOCX: its card should show the first page. If the card only shows an icon, the
worker log says `Office conversion unavailable` with the reason.

**Other hosts.** The worker log says what the sandbox hit. On a Linux host where Docker applies
AppArmor, the seccomp profile is not enough, and these two lines of the log each have one fix, for
the worker alone:

| Worker log                                                  | Add to the worker's `security_opt` |
| ----------------------------------------------------------- | ---------------------------------- |
| `bwrap: Failed to make / slave: Permission denied`          | `apparmor=unconfined`              |
| `bwrap: Can't mount proc on /proc: Operation not permitted` | `systempaths=unconfined`           |

Uncomment the matching line in `deploy/compose.office.yaml`. Both were checked together, with
`cap_drop: [ALL]` and `no-new-privileges`, on Ubuntu 24.04 (CI) and on Ubuntu 26.04 with
Docker 29.1.3, where the default worker logs the first line and the worker with
`apparmor=unconfined` alone the second. They
take protections off that container, which holds your database credentials, while the converter
inside stays sandboxed: if you prefer, write an AppArmor profile that allows only these calls.

**`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.** The host restricts
unprivileged user namespaces for unconfined processes (Ubuntu 23.10+), and no AppArmor profile
lets bubblewrap use them: it gets its namespaces but no capabilities inside, so it cannot set up
the sandbox's network. With `apparmor=unconfined` the worker is such a process. Check on the
host: `sysctl kernel.apparmor_restrict_unprivileged_userns` says `1`, and `sudo aa-status | grep
bwrap` shows nothing. Ubuntu 24.10 and later ship the profile that allows it (`bwrap-userns-restrict`,
in the `apparmor` package, loaded by default on Ubuntu 26.04). A loaded one also applies to the
`/usr/bin/bwrap` that the worker starts inside its container, but not to a `bwrap` that Docker
starts itself as the entrypoint or with `docker exec`: check with the command above. Two ways out:

- **Load Ubuntu's `bwrap-userns-restrict` profile** (recommended): `scripts/bwrap-apparmor.sh`
  does it with `sudo`, and on Ubuntu 24.04, which does not ship it, takes it from Ubuntu
  25.04's `apparmor` package, checked by checksum, and installs it in `/etc/apparmor.d/`, so it
  is loaded again after a reboot; CI does the same. The host keeps its restriction: only
  `/usr/bin/bwrap` may use user namespaces with capabilities, and what it starts has none.
- **Set `kernel.apparmor_restrict_unprivileged_userns=0`**: this re-opens unprivileged user
  namespaces to every process of the host, a protection Ubuntu turned on against kernel
  exploits. Only if you cannot load the profile.

Rootless Docker and Podman need
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
