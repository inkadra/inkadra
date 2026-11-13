// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { type BoardConnection, useBoardConnection } from './connection.ts';

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{
    document: Y.Doc;
    options: { onStateless: (event: { payload: string }) => void };
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: { id: 'limit-reader' } }) }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    document: Y.Doc;
    destroy = vi.fn();
    constructor(
      public options: { document: Y.Doc; onStateless: (event: { payload: string }) => void },
    ) {
      this.document = options.document;
      mocks.providers.push(this);
    }
    on() {}
    off() {}
  },
}));

let connection: BoardConnection | null = null;
function Board() {
  connection = useBoardConnection('limited-board', false);
  return null;
}

it('reopens confirmed state after a limit refusal, without caching rejected additions or disabling deletions', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Board />));
    const first = mocks.providers[0]!;
    first.document.getMap('elements').set('refused-addition', new Y.Map());
    await act(async () =>
      first.options.onStateless({
        payload: JSON.stringify({ type: 'writeRefused', reason: 'frozen' }),
      }),
    );
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(mocks.providers).toHaveLength(2);
    expect(mocks.providers[1]!.document.getMap('elements').has('refused-addition')).toBe(false);
    expect(connection).toMatchObject({ sizeLimited: true, readOnly: false });
  } finally {
    await act(async () => root.unmount());
  }
});
