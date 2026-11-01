# Office document previews

Office previews are optional. The ordinary image and the `-media` image do not install
LibreOffice. Without conversion, DOCX/XLSX/PPTX/ODT/ODS/ODP/CSV retain their type icon and
original download. CSV and XLSX grid previews and first-sheet-to-table work without conversion.

Build a dedicated worker image from the same revision as the web application:

```sh
docker build --build-arg OFFICE=true --build-arg MEDIA=true -t inkadra-office-worker .
```

Use it for the **worker** role only, with your existing database, Redis and storage settings,
and set `OFFICE_PREVIEWS=true` on that worker. The web/collab roles keep their ordinary image.
Do not expose a converter HTTP endpoint or mount the Docker socket. The worker needs network
access to its queue/storage; its LibreOffice child has a separate network namespace with no
interfaces. The converter sees only system binaries, its private job directory and an empty
temporary filesystem. It cannot see other uploads or the server's environment variables.

LibreOffice adds roughly 300–600 MiB uncompressed depending on architecture/version; the
base image is unchanged. Allocate at least 4 GiB address space and adequate worker memory,
plus scratch disk for the 32 MiB input, 64 MiB PDF and page renders. Keep worker concurrency
low. Conversion lasts at most 60 seconds, followed by a bounded Poppler pass (50 pages maximum,
32 MiB of WebP pages, 120-second deadline checked between individually timed page renders).

The host/container policy must support bubblewrap's unprivileged user, PID, mount and network
namespaces. If your host AppArmor, seccomp or kernel policy denies them, conversion fails
closed: the original remains usable. **Do not enable privileged mode or remove sandboxing to
make it work.** Use a dedicated worker host with a policy permitting the required namespaces.
Test your deployment with a generated sample before enabling conversion for users.

Only newly processed files gain previews. Requeue existing assets using your normal worker
operations if needed. Conversion errors, encrypted files, excessive pages and archive bombs
leave the original intact. Font/layout substitution may occur: the viewer's Info panel explains
this and always offers the original download. CSV/XLSX parsing rejects oversized sheets rather
than silently truncating a budget. Limits and rationale are in [ADR 0063](../decisions/0063-office-previews.md).
