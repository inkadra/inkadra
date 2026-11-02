# 0065 — Optional, isolated Office previews

Status: accepted for #329.

## Context

Treatments, budgets and decks need the file-card family and a paged viewer, without making
LibreOffice a mandatory dependency or allowing uploaded documents to access the network,
other originals, server secrets or the worker's home directory.

## Decision

Only `OFFICE_PREVIEWS=true` enables conversion. A Linux worker invokes LibreOffice through
bubblewrap. The converter gets:

- all namespaces unshared (network, PID, IPC, UTS, cgroup) and a **required** user namespace
  (`--unshare-user`, not "if possible"), capabilities dropped, no new session;
- **no nested user namespaces**: bubblewrap's `--disable-userns` when the host lets it (it
  needs a writable `/proc/sys/user`, which Docker hides by default), and always a seccomp
  filter that does the same job (see below);
- a **seccomp-bpf filter** loaded from standard input (`--seccomp 0`): `io_uring_*`, the kernel
  keyring (`keyctl`, `add_key`, `request_key`), `ptrace` and `process_vm_*`, mounting
  (`mount`, `umount2`, `pivot_root` and the new mount API), `unshare`, `setns`, `bpf`,
  `perf_event_open` and `userfaultfd` fail with EPERM; `clone` with `CLONE_NEWUSER` too, and
  `clone3` answers ENOSYS so libc falls back to `clone`; other architectures' and x32 numbers
  are refused. Only x86-64 and arm64 have a filter, and elsewhere conversion stays off;
- read-only `/usr`, fonts and LibreOffice configuration; a **read-only `in/`** with the document;
  a writable `out/` for the PDF and `profile/` for LibreOffice's settings; a 256 MiB memory
  `/tmp`. Nothing else of the job folder is mounted: the host's own copies and renders can
  not be reached or replaced from inside;
- `prlimit`: 4 GiB of address space, 64 MiB per file and **1,024 tasks** (`--nproc`) so a fork
  bomb fails inside the sandbox; 60 seconds of wall time;
- a pre-seeded profile (`registrymodifications.xcu`): macro security level 3 and macro
  execution disabled, links never updated. (`--safe-mode` is not used: it starts from a clean profile and
  discards this one.) The sandbox has no network either way.

No server environment, network sockets or data volume enter the sandbox. No shell receives
filenames. Missing namespaces, bubblewrap, LibreOffice, prlimit or a filter for the
architecture fail closed to the icon card.

The host never trusts what the sandbox wrote. The PDF name belongs to the converter, so it is
opened with `O_NOFOLLOW | O_NONBLOCK` (a link to a host file and a FIFO are refused, the second
without hanging), checked with `fstat` (regular file, at most 64 MiB), its `%PDF-` header is
read through the handle, and the bytes are copied to a file the sandbox never saw. Poppler
reads that copy and writes its pages in a folder of ours.

The worker accepts DOCX, XLSX, PPTX, ODT, ODS, ODP and CSV. It limits input to 32 MiB,
ZIP expansion to 128 MiB / 10,000 entries / 100:1 and PDF output to 50 pages. Poppler reuses
PDF page rendering and page-1 thumbnails, with its existing memory, file and time caps.
Rendering has a 120-second deadline checked between pages and 32 MiB total WebP output.
A manifest is published only after conversion finishes; errors keep the untouched original.
The derivative pages and manifest live under the asset's existing variants prefix: no database
migration or document-schema change. Reprocessing overwrites derivatives and removes pages
of an earlier, longer conversion. The manifest carries a `revision` (a hash of the pages and
sheets); the viewer puts it on page URLs (`?v=`). With it a page is cached for a year, since a
reprocess changes the URL; without it the server sends `no-store`. Deleting a project or an
account removes the derivative keys of its Office assets only (other assets cost no requests).

CSV/XLSX preview does not require LibreOffice. The worker parses at most 16 MiB, 16 sheets,
500 rows, 20 columns, 2,000 characters per cell and 10,000 XLSX cells across the workbook.
XLSX uses the existing bounded ZIP reader and htmlparser2 XML mode, rejects DTD/entity
declarations and external or arbitrary relationship paths. It reads shared/inline strings and
cached cell values, never evaluates formulas or fetches links. Cached values are shown as the
sheet shows them, using the number formats of `styles.xml`: dates and times as ISO text
(1900 and 1904 date systems), percentages with their decimals, and doubles rounded to the 15
digits spreadsheets display (`1080.5000000000002` is `1080.5`); whole numbers are kept exactly.
Hidden and very hidden sheets are not shown and are never "the first sheet".
CSV is a tolerant state machine: UTF-8 (BOM), UTF-16 with a BOM or Windows-1252, comma,
semicolon or tab, CRLF, multiline cells; a quote inside a field is a letter, spaces may precede
an opening quote, text after a closing quote is kept, an unclosed quote runs to the end.

Whatever is over the limits is left out and **said**: the sheet gets `truncated`, the viewer
shows a row of "…" and a note, and "Turn into table" is disabled for it, so a partial budget
never reaches the board. A workbook too big to read at all shows one empty, `truncated` sheet
with a "too large to preview" message. Structure that cannot be trusted (XXE, malformed
coordinates, ZIP bombs) still rejects the file. Both viewer and table card render plain text.
Formulas remain text and are never executed; copying a table puts an apostrophe before cells
a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, but not plain numbers), as the shot
list CSV does, and pasting into Inkadra takes it off again.

“Turn into table” always imports the first visible sheet in workbook order, even after
selecting another tab. It creates the existing table card beside the original as one undo
transaction; the existing six-second toast offers Show and Undo. The original is retained.

Guests keep the thumbnail and download viewer of the share link: the account viewer does not
treat files as Office documents in guest mode, and asks for no account derivative.

## Consequences

The default image size is unchanged. `--build-arg OFFICE=true` adds Debian LibreOffice Writer,
Calc, Impress, fonts, Poppler and bubblewrap: budget approximately 600–800 MiB extra uncompressed
(depending on architecture and Debian version); measure the exact tag in your registry.
Only the separate worker needs that image. Linux must permit unprivileged user namespaces;
under Docker that takes a custom seccomp profile, never `seccomp=unconfined` nor a privileged
container; operators must not bypass a failed sandbox. See [self-hosting](../self-hosting/office.md).

Font substitution and layout differences are expected and explained in the Info panel.
Large, encrypted, malformed or unsupported workbooks retain their original and icon. This is
an intentionally bounded planning preview, not a full spreadsheet editor. The manifest gains
two optional fields (`revision`, and `truncated` on sheets) and pages an optional `v` query:
additive within API v1.
