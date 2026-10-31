// Builds a minimal DNG: IFD0 is a JPEG preview (as cameras and Adobe write them), its SubIFD
// an 8×8 CFA raw image. Usage: node make-dng.mjs preview.jpg out.dng
import { readFileSync, writeFileSync } from 'node:fs';

const [jpegPath, out] = process.argv.slice(2);
const jpeg = readFileSync(jpegPath);
const dims = (() => {
  for (let i = 2; i < jpeg.length; ) {
    const marker = jpeg[i + 1];
    const len = jpeg.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3)
      return [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error('no SOF');
})();

const SHORT = 3,
  LONG = 4,
  RATIONAL = 5,
  BYTE = 1,
  ASCII = 2;
const size = { [BYTE]: 1, [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8 };
const chunks = [];
let end = 8;
const alloc = (buf) => {
  const at = end;
  chunks.push({ at, buf });
  end += buf.length + (buf.length % 2);
  return at;
};

function ifd(entries) {
  entries.sort((a, b) => a[0] - b[0]);
  const buf = Buffer.alloc(2 + entries.length * 12 + 4);
  buf.writeUInt16LE(entries.length, 0);
  const at = alloc(buf);
  entries.forEach(([tag, type, values], i) => {
    const o = 2 + i * 12;
    const data =
      type === ASCII
        ? Buffer.from(`${values}\0`)
        : (() => {
            const b = Buffer.alloc(values.length * size[type]);
            values.forEach((v, j) => {
              if (type === BYTE) b.writeUInt8(v, j);
              if (type === SHORT) b.writeUInt16LE(v, j * 2);
              if (type === LONG) b.writeUInt32LE(v, j * 4);
              if (type === RATIONAL) {
                b.writeUInt32LE(v[0], j * 8);
                b.writeUInt32LE(v[1], j * 8 + 4);
              }
            });
            return b;
          })();
    buf.writeUInt16LE(tag, o);
    buf.writeUInt16LE(type, o + 2);
    buf.writeUInt32LE(type === ASCII ? data.length : values.length, o + 4);
    if (data.length <= 4) data.copy(buf, o + 8);
    else buf.writeUInt32LE(alloc(data), o + 8);
  });
  return { at, buf };
}

// Placeholders patched once the offsets are known.
const jpegAt = alloc(jpeg);
const raw = Buffer.alloc(8 * 8 * 2, 0x40);
const rawAt = alloc(raw);
const exif = ifd([
  [33434, RATIONAL, [[1, 250]]],
  [33437, RATIONAL, [[28, 10]]],
  [34855, SHORT, [400]],
  [37386, RATIONAL, [[50, 1]]],
]);
const sub = ifd([
  [254, LONG, [0]],
  [256, SHORT, [8]],
  [257, SHORT, [8]],
  [258, SHORT, [16]],
  [259, SHORT, [1]],
  [262, SHORT, [32803]],
  [273, LONG, [rawAt]],
  [277, SHORT, [1]],
  [278, SHORT, [8]],
  [279, LONG, [raw.length]],
  [33421, SHORT, [2, 2]],
  [33422, BYTE, [0, 1, 1, 2]],
]);
const ifd0 = ifd([
  [254, LONG, [1]],
  [256, SHORT, [dims[0]]],
  [257, SHORT, [dims[1]]],
  [258, SHORT, [8, 8, 8]],
  [259, SHORT, [7]],
  [262, SHORT, [6]],
  [271, ASCII, 'Inkadra'],
  [272, ASCII, 'Test DNG'],
  [273, LONG, [jpegAt]],
  [274, SHORT, [6]],
  [277, SHORT, [3]],
  [278, LONG, [dims[1]]],
  [279, LONG, [jpeg.length]],
  [330, LONG, [sub.at]],
  [34665, LONG, [exif.at]],
  [50706, BYTE, [1, 4, 0, 0]],
  [50708, ASCII, 'Inkadra Test DNG'],
]);
const file = Buffer.alloc(end);
file.write('II', 0);
file.writeUInt16LE(42, 2);
file.writeUInt32LE(ifd0.at, 4);
for (const c of chunks) c.buf.copy(file, c.at);
writeFileSync(out, file);
console.log(out, file.length, dims);
