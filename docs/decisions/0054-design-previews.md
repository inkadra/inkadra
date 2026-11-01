# 0054 · Design source file previews

Accepted, 2026-11. Extends media worker decision 0048 and file card family #325. Fixes #330.

Design files stay file assets and downloads always serve the original. Their cards reuse the
existing picture preview, footer and design badge tokens. No document schema or migration.

PSD/PSB use exiftool's PhotoshopThumbnail, under the existing tool runner (30 seconds,
2 GiB address space, 64 MiB output, nice 10). No layers are rendered. Zip-based Procreate,
Sketch and Affinity exports use the existing bounded archive reader: at most 10,000 entries,
2 GiB uncompressed total, compression ratio 200, and 64 MiB for the one selected preview.
Names are exact allowlisted lookups, never filesystem paths. Traversal, links, encryption,
duplicates and unsupported compression are rejected. The decoded preview is limited to
100 megapixels. Each job uses its own scratch directory, with the existing cleanup and
storage download space checks. Sources above 2 GiB keep their icon.

PDF-compatible AI files reuse the first-page poppler path, retaining their AI badge and
original MIME. Other AI files, absent tools, missing previews, corrupt archives and native
Affinity files without a zip preview keep an icon card. Native Affinity's proprietary binary
format is not decoded. No new dependencies or public settings.

Dimensions describe the embedded preview, not necessarily the full layered document. Layer
counts are omitted: no reliable cheap common field exists across these formats. Larger
composites, layer parsing and native Affinity decoding can follow a demonstrated need.
