/**
 * Unit tests never talk to a server. The DOM environments resolve "/api/v1/..." against
 * http://localhost:3000, so a request nobody mocked (a card asking for its asset, a poller)
 * opened a real socket and failed with "AggregateError: connect ECONNREFUSED ::1:3000 /
 * 127.0.0.1:3000", sometimes after the test had finished. It now fails at once, with the
 * address in the message. Tests that need an answer stub fetch themselves (vi.stubGlobal,
 * vi.spyOn), which replaces this.
 */
function refuse(input: Parameters<typeof fetch>[0]): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  return Promise.reject(
    new TypeError(`fetch failed: unit tests do not reach the network (${url})`),
  );
}

globalThis.fetch = refuse;
if (typeof window !== 'undefined') window.fetch = refuse;
