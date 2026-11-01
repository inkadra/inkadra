# 0063 — Optional, isolated Office previews

Status: accepted for #329. Number 0062 is reserved by #391; renumber on rebase if needed.

## Context

Treatments, budgets and decks need the file-card family and a paged viewer, without making
LibreOffice a mandatory dependency or allowing uploaded documents to access the network,
other originals, server secrets or the worker's home directory.

## Decision

Only `OFFICE_PREVIEWS=true` enables conversion. A Linux worker invokes LibreOffice through
bubblewrap, with all namespaces unshared (including network and PID), capabilities dropped,
read-only `/usr`, an isolated `/tmp` and only this job's mkdtemp directory mounted writable.
No server environment, network sockets or data volume enters the sandbox. No shell receives
filenames. Missing namespaces, bubblewrap, LibreOffice or prlimit fail closed to the icon card.

The worker accepts DOCX, XLSX, PPTX, ODT, ODS, ODP and CSV. It limits input to 32 MiB,
ZIP expansion to 128 MiB / 10,000 entries / 100:1, LibreOffice address space to 4 GiB,
output file size to 64 MiB, wall time to 60 seconds, and PDF output to 50 pages. Poppler
reuses PDF page rendering and page-1 thumbnails, with its existing memory, file and time caps.
Rendering has a 120-second deadline checked between pages and 32 MiB total WebP output.
A manifest is published only after conversion finishes; errors keep the untouched original.
The derivative pages and manifest live under the asset's existing variants prefix: no database
migration or document-schema change. Reprocessing overwrites derivatives.

CSV/XLSX preview does not require LibreOffice. The worker parses at most 16 MiB, 16 sheets,
500 rows, 20 columns, 2,000 characters per cell and 10,000 XLSX cells across the workbook.
XLSX uses the existing bounded ZIP reader and htmlparser2 XML mode, rejects DTD/entity
declarations and external or arbitrary relationship paths. It reads shared/inline strings and
cached cell values, never evaluates formulas or fetches links. CSV is a quoted-field state
machine (UTF-8, BOM, CRLF, multiline, comma/semicolon); malformed or oversized data is rejected.
Both viewer and table card render plain text. CSV formulas remain text and are never executed;
exporting that text to an external spreadsheet still requires that application's formula protections.

“Turn into table” always imports the first sheet in workbook order, even after selecting
another tab. It creates the existing table card beside the original as one undo transaction;
the existing six-second toast offers Show and Undo. The original is retained.

## Consequences

The default image size is unchanged. `--build-arg OFFICE=true` adds Debian LibreOffice Writer,
Calc, Impress, fonts, Poppler and bubblewrap: budget approximately 600–800 MiB extra uncompressed
(depending on architecture and Debian version); measure the exact tag in your registry.
Only the separate worker needs that image. Linux must permit unprivileged user namespaces;
operators must not run the application privileged or bypass a failed sandbox. See
[self-hosting](../self-hosting/office.md).

Font substitution and layout differences are expected and explained in the Info panel.
Large, encrypted, malformed or unsupported workbooks retain their original and icon. This is
an intentionally bounded planning preview, not a full spreadsheet editor. Guest share viewers
continue to use the existing file thumbnail/download path.
