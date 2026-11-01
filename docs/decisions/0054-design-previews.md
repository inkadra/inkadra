# 0054 · Design source file previews

Accepted, 2026-11. Extends media worker decision 0048 and file card family #325. Fixes #330.

Design files stay file assets and downloads always serve the original. Their cards reuse the
existing picture preview, footer and design badge tokens. No document schema or migration.

PSD/PSB prefer the saved full-resolution composite, without rendering layers. The bundled
sharp/libvips has no PSD loader; ImageMagick is absent. The media image's FFmpeg decoder
accepts PSD v1 but rejects PSB v2 ([decoder](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/psd.c)).
A bounded reader handles both versions using the [Adobe specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/):
8/16-bit RGB or Grayscale, raw or PackBits RLE. It seeks past colour/resources/layer sections,
reads one row at a time and interleaves only colour channels; extra alpha is ignored for the
flattened preview. High bytes downsample 16-bit samples to 8-bit. Limits: 30,000 px per side,
100 MP total, 30 seconds, exact row and section bounds, and the existing 2 GiB source cap.
Unsupported modes, ZIP compression and malformed composites fall back to exiftool's
PhotoshopThumbnail under the existing runner (30 seconds, 2 GiB address space, 64 MiB output,
nice 10), then the icon. No apt packages or dependencies are added. Zip-based Procreate,
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

Dimensions describe the chosen composite or embedded preview. PSD/PSB layer counts come from
only the bounded Layer Info header (absolute signed count), stored as `exif.LayerCount` in
the existing extensible metadata field and translated in the shared footer. The metadata
stays available when a composite is unsupported. No layer records or pixels are rendered.
Native Affinity decoding and further Photoshop colour/compression modes remain out of scope.
