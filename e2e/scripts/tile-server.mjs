// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in map tile server for the end-to-end tests (decision 0053): every tile is the same
// pale 256 px square with two roads, so no test ever reaches OpenStreetMap.
import { createServer } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';

const port = Number(process.env.E2E_TILE_PORT ?? 3190);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

function tile() {
  const size = 256;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const road = Math.abs(x - 96) < 3 || Math.abs(y - 170) < 3;
      const [r, g, b] = road ? [255, 255, 255] : [228, 232, 221];
      rows.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = tile();
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length }).end(png);
}).listen(port, '127.0.0.1');
