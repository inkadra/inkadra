# Office document previews

Office previews are optional. The ordinary image and the `-media` image do not install
LibreOffice. Without conversion, DOCX/XLSX/PPTX/ODT/ODS/ODP/CSV retain their type icon and
original download. CSV and XLSX grid previews and first-sheet-to-table work without conversion.

## Build the worker image

One build argument is enough: it adds LibreOffice (Writer, Calc, Impress), fonts, Poppler,
bubblewrap and `prlimit`, everything the converter needs.

```sh
docker build --build-arg OFFICE=true -t inkadra-office-worker .
```

Add `--build-arg MEDIA=true` only if the same worker should also make video, audio and RAW
previews. Use the image for the **worker** role only, with your existing database, Redis and
storage settings, and set `OFFICE_PREVIEWS=true` on that worker. The web/collab roles keep their
ordinary image. Do not expose a converter HTTP endpoint or mount the Docker socket. The worker
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

Then point the worker at it. With the split layout (`deploy/compose.split.yaml`):

```yaml
# compose.office.yaml — docker compose -f compose.yaml -f deploy/compose.split.yaml -f compose.office.yaml up -d
services:
  worker:
    image: inkadra-office-worker
    environment:
      OFFICE_PREVIEWS: "true"
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

Check the sandbox before enabling conversion for users:

```sh
docker compose run --rm --no-deps worker bwrap --unshare-all --unshare-user \
  --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --proc /proc --dev /dev /usr/bin/true && echo sandbox ok
```

Then upload a DOCX: its card should show the first page. If the card only shows an icon, the
worker log says `Office conversion unavailable` with the reason.

**Other hosts.** Ubuntu hosts with AppArmor (the default `docker-default` profile denies
`mount`, and 23.10+ restricts unprivileged user namespaces) need an AppArmor profile that allows
them for this container (or `apparmor=unconfined` for the worker alone); rootless Docker and
Podman need `kernel.unprivileged_userns_clone`/`user.max_user_namespaces` above zero. These were
not tested with this change. Do not enable privileged mode or remove sandboxing to make it work.
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

Only newly processed files gain previews. Requeue existing assets using your normal worker
operations if needed; pages of a reprocessed document get a new URL, so browsers never show the
old ones. Conversion errors, encrypted files, excessive pages and archive bombs leave the original
intact. Font/layout substitution may occur: the viewer's Info panel explains this and always
offers the original download.

CSV/XLSX grids are limited to 500 rows × 20 columns per sheet (10,000 cells and 16 sheets per
workbook). A bigger sheet is shown up to those limits with a "…" row and a note, and cannot be
turned into a table, so a budget is never imported in part; a sheet too big to read says so and
offers the original. Hidden sheets are not shown. CSV files in Windows-1252 or UTF-16 and with
semicolons or tabs, as Excel writes them, are read. Limits and rationale are in
[ADR 0065](../decisions/0065-office-previews.md).
