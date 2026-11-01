# 0059 · Bounded model metadata and browser font specimens

Accepted, 2026-11. Extends decision 0048 and the approved #325 card family.

**Context.** Models and fonts are untrusted uploads. The approved card uses a cube for
models and an Aa specimen for fonts. No new document, database or API schema is needed:
`asset.exif.filePreview` holds optional metadata within the existing metadata record.

**Decision.** Read at most a 1 MiB prefix through storage range reads. Parse it in a separate
Node process, in a per-job scratch directory, with a 64 MiB heap, five second timeout,
4 KiB output cap, nice 10 and prlimit (16 GiB address space for V8's virtual reservations,
64 KiB file output) on Linux. GLB JSON chunks must fit entirely in the prefix; glTF files
must fit entirely. Count triangles from accessors only, never load buffers or follow URIs.
Counts describe mesh definitions, not scene instances. Unsupported or corrupt inputs keep
the cube card and download. OBJ, FBX, USDZ and STL have no parser or orbit renderer in this
change. Geometry thumbnails and the issue's orbit viewer remain future work.

Read SFNT name, OS/2 and maxp tables with strict directory, offset and string bounds.
WOFF inflates only those three tables with Node zlib; output must match each directory
entry's original length, at most 1 MiB per selected table. WOFF2 has one Brotli stream:
decompress it within the existing sandbox, capped at 8 MiB, and retain only those three
untransformed tables. Never reconstruct glyf/loca/hmtx or decode outlines. The header's
uncompressed SFNT size and all directory lengths are independently capped at 8 MiB;
WOFF2's exact Brotli output length must match the sum of stored table lengths. Its
header size is advisory for transformed tables, per the [WOFF2 specification](https://www.w3.org/TR/WOFF2/).
WOFF requires an exact header/directory size match. Compressed input must fit the 1 MiB
read cap; malformed directories, transforms, duplicate tags, overlaps and truncated data
are rejected. Font collections are unsupported. The five second process timeout also
bounds decompression. No new dependency.

Use browser FontFace with bytes fetched from the same-origin authenticated original URL,
not SVG embedded fonts rasterised through libvips: this avoids another server binary parser
and relies on the browser's font sanitiser. Names never enter CSS; each mounted specimen
gets its own generated font family, removed on unmount. Fetches abort after ten seconds,
stop at 8 MiB regardless of declared size, and abort on unmount. Oversized, invalid and
unsupported fonts show the serif fallback. Fonts are never installed. The viewer offers
editable sample text (at most 2000 characters).

**Consequences.** No new dependency, migration or native renderer. Specimens require a
browser supporting FontFace and re-fetch the original when mounted (HTTP cache applies).
Fonts above these input/output caps keep their fallback; the three metadata tables must fit the prefix. The cube
fallback follows the approved mockup but does not fulfil the issue's orbit-preview request.
