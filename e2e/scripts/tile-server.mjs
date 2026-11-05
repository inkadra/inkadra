// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in map tile server for the end-to-end tests (decision 0053): every tile is the same
// pale 256 px square with two roads, so no test ever reaches OpenStreetMap. Under /satellite/ the
// ground is dark green, so screenshots tell the two sources apart.
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

function tile(ground) {
  const size = 256;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const road = Math.abs(x - 96) < 3 || Math.abs(y - 170) < 3;
      const [r, g, b] = road ? [255, 255, 255] : ground;
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

const png = tile([228, 232, 221]);
const satellite = tile([46, 74, 52]);
createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/geocode') {
    const query = url.searchParams.get('q') ?? '';
    res.setHeader('content-type', 'application/json');
    if (query === 'unavailable') {
      res.writeHead(503).end('{}');
      return;
    }
    const items =
      query === 'unknown'
        ? []
        : [
            { lat: '45.4642', lon: '9.19', display_name: 'Via Roma, Milano' },
            { lat: '46.1699', lon: '9.8788', display_name: 'Via Roma, Sondrio' },
          ];
    res.end(JSON.stringify(items.slice(0, Number(url.searchParams.get('limit') ?? 5))));
    return;
  }
  const body = url.pathname.startsWith('/satellite/') ? satellite : png;
  res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length }).end(body);
}).listen(port, '127.0.0.1');
