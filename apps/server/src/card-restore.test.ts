import { type Connection, Document } from '@hocuspocus/server';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createCardRestore } from './card-restore.ts';
import type { Database } from './db/client.ts';

const requestId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const request = (id = requestId) =>
  JSON.stringify({
    type: 'restoreCards',
    requestId: id,
    clipboard: { version: 1, elements: [], bodies: {} },
    at: { x: 0, y: 0 },
  });

function setup(refusal: () => null | 'role' = () => null) {
  const sent: unknown[] = [];
  const connection = {
    context: { actor: { id: 'u1', role: 'member' }, boardId: 'b1' },
    webSocket: { readyState: 1 },
    sendStateless: (payload: string) => sent.push(JSON.parse(payload)),
  } as unknown as Connection;
  const document = new Document('board');
  document.addConnection(connection);
  const restorer = createCardRestore({
    db: {} as Database,
    log: pino({ level: 'silent' }),
    refusal,
    admit: () => null,
    writersOf: () => new Map(),
  });
  return { sent, connection, document, restorer };
}

describe('conditional restore requests', () => {
  it('leaves other stateless messages to others', () => {
    const { restorer, connection, document, sent } = setup();
    expect(restorer.handle(connection, document, '{"type":"other"}')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('answers an error inside the handler `busy`, without rejecting', async () => {
    const { restorer, connection, document, sent } = setup(() => {
      throw new Error('boom');
    });
    await expect(restorer.handle(connection, document, request())).resolves.toBeUndefined();
    expect(sent).toEqual([
      { type: 'restoreCardsResult', requestId, outcome: 'refused', reason: 'busy' },
    ]);
  });

  it('answers a malformed request whose id it can read, and only that one', async () => {
    const { restorer, connection, document, sent } = setup();
    await restorer.handle(connection, document, '{"type":"restoreCards","requestId":"x"}');
    await restorer.handle(
      connection,
      document,
      `{"type":"restoreCards","requestId":"${requestId}"}`,
    );
    expect(sent).toEqual([
      { type: 'restoreCardsResult', requestId, outcome: 'refused', reason: 'invalid' },
    ]);
  });

  it('answers `busy` past the requests one connection may send in a minute', async () => {
    const { restorer, connection, document, sent } = setup(() => 'role');
    for (let i = 0; i < 31; i++) await restorer.handle(connection, document, request());
    const reasons = sent.map((a) => (a as { reason: string }).reason);
    expect(reasons.slice(0, 30).every((r) => r === 'role')).toBe(true);
    expect(reasons[30]).toBe('busy');
  });
});
