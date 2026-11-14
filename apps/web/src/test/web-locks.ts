/**
 * happy-dom has no Web Locks: a minimal LockManager, shared and exclusive, granted in order as
 * a browser grants them, for the board copies on the device (#791).
 */
export function installWebLocks(): void {
  if (typeof navigator === 'undefined' || navigator.locks) return;
  const held = new Map<string, { mode: LockMode; count: number }>();
  const waiting: Array<() => boolean> = [];
  const next = () => {
    for (let i = 0; i < waiting.length; ) {
      if (waiting[i]?.()) waiting.splice(i, 1);
      else i += 1;
    }
  };
  const locks = {
    request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
      const mode = options.mode ?? 'exclusive';
      return new Promise((resolve, reject) => {
        const grant = () => {
          const now = held.get(name);
          if (now && (mode === 'exclusive' || now.mode === 'exclusive')) return false;
          held.set(name, { mode, count: (now?.count ?? 0) + 1 });
          Promise.resolve()
            .then(() => callback({ name, mode }))
            .then(resolve, reject)
            .finally(() => {
              const lock = held.get(name);
              if (lock && --lock.count === 0) held.delete(name);
              next();
            });
          return true;
        };
        if (grant()) return;
        if (options.ifAvailable)
          Promise.resolve()
            .then(() => callback(null))
            .then(resolve, reject);
        else waiting.push(grant);
      });
    },
    query: async () => ({ held: [], pending: [] }),
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}
