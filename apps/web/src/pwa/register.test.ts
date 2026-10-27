import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Read the external store without mounting React; browser events drive it below.
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));

type Registration = typeof import('./register.ts');
let register: Registration;
let setBusy: typeof import('./busy.ts')['setBusy'];
let sw: EventTarget & { controller: Worker | null; register: ReturnType<typeof vi.fn> };
let registration: EventTarget & {
  waiting: Worker | null;
  installing: Worker | null;
  update: ReturnType<typeof vi.fn>;
};
const reload = vi.fn();

class Worker extends EventTarget {
  state = 'installed';
  constructor(readonly matches: boolean) {
    super();
  }
  postMessage = vi.fn((message: { type: string }, ports?: MessagePort[]) => {
    if (message.type === 'has') ports?.[0]?.postMessage(this.matches);
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const activate = (worker: Worker) => {
  sw.controller = worker;
  registration.waiting = null;
  sw.dispatchEvent(new Event('controllerchange'));
};
const offer = async (worker: Worker) => {
  registration.installing = worker;
  registration.waiting = worker;
  registration.dispatchEvent(new Event('updatefound'));
  worker.dispatchEvent(new Event('statechange'));
  await flush();
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  reload.mockClear();
  vi.stubEnv('PROD', true);
  registration = Object.assign(new EventTarget(), {
    waiting: null,
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  sw = Object.assign(new EventTarget(), {
    controller: new Worker(false),
    register: vi.fn().mockResolvedValue(registration),
  });
  vi.stubGlobal('navigator', { serviceWorker: sw });
  vi.stubGlobal('window', { isSecureContext: true, location: { reload } });
  vi.stubGlobal('location', {
    origin: 'https://inkadra.example',
    href: 'https://inkadra.example/',
  });
  vi.stubGlobal('document', {
    readyState: 'complete',
    querySelectorAll: () => [{ getAttribute: () => '/assets/index-current.js' }],
  });
  // Deterministic worker replies, with the same asynchronous delivery as MessageChannel.
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: (_event: { data: boolean }) => {} };
      port2 = {
        postMessage: (data: boolean) => queueMicrotask(() => this.port1.onmessage({ data })),
      };
    },
  );
  register = await import('./register.ts');
  ({ setBusy } = await import('./busy.ts'));
  register.registerServiceWorker();
  await flush();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('service worker updates across tabs', () => {
  it.each(['installing', 'waiting'] as const)(
    'handles late updatefound with an installed worker in %s',
    async (slot) => {
      const matching = new Worker(true);
      registration.installing = slot === 'installing' ? matching : null;
      registration.waiting = slot === 'waiting' ? matching : null;
      // Browser state can advance before the page handles updatefound. The statechange
      // notification has already happened; attaching a listener does not replay it.
      registration.dispatchEvent(new Event('updatefound'));
      await flush();
      expect(matching.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
      matching.dispatchEvent(new Event('statechange'));
      await flush();
      expect(
        matching.postMessage.mock.calls.filter(([m]) => m.type === 'skip-waiting'),
      ).toHaveLength(1);
      activate(matching);
      expect(register.useUpdate()).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it('keeps a requested update deferred when another tab activates the worker', async () => {
    const waiting = new Worker(false);
    await offer(waiting);
    setBusy('board', true);
    register.applyUpdate();
    expect(register.useUpdate()).toEqual({ deferred: true });
    activate(waiting);
    expect(register.useUpdate()).toEqual({ deferred: true });
    expect(reload).not.toHaveBeenCalled();
    setBusy('board', false);
    expect(reload).toHaveBeenCalledOnce();
    expect(waiting.postMessage).not.toHaveBeenCalledWith({ type: 'skip-waiting' });
  });

  it('offers a reload when a newer worker replaces a silently activated one', async () => {
    const matching = new Worker(true);
    await offer(matching);
    expect(matching.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
    expect(register.useUpdate()).toBeNull();
    matching.state = 'redundant';
    const newer = new Worker(false);
    // A different tab activates the replacement before this tab observes updatefound.
    activate(newer);
    expect(register.useUpdate()).toEqual({ deferred: false });
    register.applyUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('activates on request and waits again if the board becomes busy before activation', async () => {
    const waiting = new Worker(false);
    await offer(waiting);
    register.applyUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
    setBusy('board', true);
    activate(waiting);
    expect(register.useUpdate()).toEqual({ deferred: true });
    expect(reload).not.toHaveBeenCalled();
    setBusy('board', false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload the tab already running the silently activated version', async () => {
    const matching = new Worker(true);
    await offer(matching);
    activate(matching);
    expect(register.useUpdate()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('lets the user dismiss a deferred reload after another tab activates', async () => {
    const waiting = new Worker(false);
    await offer(waiting);
    setBusy('board', true);
    register.applyUpdate();
    activate(waiting);
    register.dismissUpdate();
    setBusy('board', false);
    expect(register.useUpdate()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
