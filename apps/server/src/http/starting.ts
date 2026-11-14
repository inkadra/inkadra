import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A bare HTTP listener for the time before the real server listens: the backup before an
 * upgrade (#805), the migrations, a role waiting for them. It answers liveness (`live` paths:
 * 200) so the container health check does not get a long start restarted, and 503 with
 * `reason` to everything else, `/readyz` and `/api/v1/health` included: alive, not ready.
 */
export async function startingListener(opts: {
  host?: string;
  port: number;
  reason: string;
  live: string[];
}) {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const live = opts.live.includes(path);
    res.writeHead(live ? 200 : 503, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(live ? {} : { 'retry-after': '30' }),
    });
    res.end(JSON.stringify(live ? { status: 'ok' } : { status: 'starting', reason: opts.reason }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
