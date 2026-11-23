import { randomUUID } from 'node:crypto';
import { type AddressInfo, createServer, type Socket } from 'node:net';
import pino from 'pino';
import { expect, it, vi } from 'vitest';
import { startBoardWorker } from './queues.ts';

it('closes the board worker in bounded time when Valkey stopped answering (F-24)', async () => {
  // A network partition: connections are accepted, nothing ever answers.
  const sockets: Socket[] = [];
  const blackhole = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
  const { port } = blackhole.address() as AddressInfo;
  const worker = startBoardWorker(
    `redis://127.0.0.1:${port}`,
    { addCard: vi.fn() } as never,
    pino({ level: 'silent' }),
    { prefix: `inkadra-blackhole-${randomUUID()}`, closeMs: 300 },
  );
  try {
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    const started = Date.now();
    await worker.close();
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    for (const s of sockets) s.destroy();
    blackhole.close();
  }
});
