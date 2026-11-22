// SPDX-License-Identifier: MPL-2.0

// Google Fonts' TTFs leave some glyphs at an odd length. fontkit 1.1.1 copies each glyph as it
// is into a subset and gives a small subset the short `loca` table, which stores every offset
// divided by two: after an odd glyph every offset is truncated and most letters print blank
// (decision 0038). Padding each glyph of the font to an even length before pdf-lib subsets it
// keeps the subset's offsets exact, without patching fontkit, so the fix travels with this
// package to every app that uses it.

const tag = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

// The sum of the table's big-endian 32-bit words, zero-padded to a multiple of four.
function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

/**
 * The font with every glyph padded to an even length, its `loca` in the long format; the same
 * bytes when no glyph is odd or the font has no TrueType outlines.
 * shortcut: TrueType files only; a WOFF is passed as given (the heading fonts' WOFFs have no odd
 * glyph today). Decode WOFF here too if one with odd glyphs is ever embedded.
 */
export function evenGlyphs(font: Uint8Array): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  if (font.length < 12) return font;
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565 /* 'true' */) return font;
  const count = view.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  const order: string[] = [];
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    order.push(tag(view, record));
    tables.set(tag(view, record), font.subarray(offset, offset + length));
  }
  const [head, loca, glyf, maxp] = ['head', 'loca', 'glyf', 'maxp'].map((t) => tables.get(t));
  if (!head || !loca || !glyf || !maxp) return font;
  const local = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const glyphs = local(maxp).getUint16(4);
  const long = local(head).getInt16(50) === 1;
  const offsets = Array.from({ length: glyphs + 1 }, (_, i) =>
    long ? local(loca).getUint32(i * 4) : local(loca).getUint16(i * 2) * 2,
  );
  const lengths = offsets.slice(1).map((end, i) => end - (offsets[i] ?? 0));
  if (lengths.every((length) => length % 2 === 0)) return font;

  const evenGlyf = new Uint8Array(lengths.reduce((sum, length) => sum + length + (length % 2), 0));
  const evenLoca = new Uint8Array((glyphs + 1) * 4);
  let at = 0;
  for (let i = 0; i < glyphs; i++) {
    local(evenLoca).setUint32(i * 4, at);
    const start = offsets[i] ?? 0;
    evenGlyf.set(glyf.subarray(start, start + (lengths[i] ?? 0)), at);
    at += (lengths[i] ?? 0) + ((lengths[i] ?? 0) % 2);
  }
  local(evenLoca).setUint32(glyphs * 4, at);
  const evenHead = head.slice();
  local(evenHead).setUint32(8, 0); // checksumAdjustment, set again below
  local(evenHead).setInt16(50, 1); // indexToLocFormat: long
  tables.set('head', evenHead);
  tables.set('loca', evenLoca);
  tables.set('glyf', evenGlyf);

  // The same table directory, each table at a 4-byte boundary with its new checksum.
  const directory = 12 + count * 16;
  const size = order.reduce((sum, t) => sum + (((tables.get(t)?.length ?? 0) + 3) & ~3), directory);
  const out = new Uint8Array(size);
  const write = new DataView(out.buffer);
  out.set(font.subarray(0, 12));
  let offset = directory;
  order.forEach((t, i) => {
    const bytes = tables.get(t) ?? new Uint8Array();
    const record = 12 + i * 16;
    out.set(font.subarray(record, record + 4), record);
    write.setUint32(record + 4, checksum(bytes));
    write.setUint32(record + 8, offset);
    write.setUint32(record + 12, bytes.length);
    out.set(bytes, offset);
    offset += (bytes.length + 3) & ~3;
  });
  const headAt = write.getUint32(12 + order.indexOf('head') * 16 + 8);
  write.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
