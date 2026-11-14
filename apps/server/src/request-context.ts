import { AsyncLocalStorage } from 'node:async_hooks';

/** The HTTP request being answered, for whatever it starts later (#817). */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** Job data carrying the id of the request that queued it, so the worker's logs can say it. */
export function withRequestId<T extends object>(data: T): T & { requestId?: string } {
  const requestId = requestContext.getStore()?.requestId;
  return requestId ? { ...data, requestId } : data;
}

/** A client's own request id, when it is a plain token; otherwise a new one. */
export function requestIdFrom(header: unknown, fresh: () => string): string {
  return typeof header === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : fresh();
}
