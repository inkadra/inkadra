// Tests only: every answer under /api/v1 is checked against the contract of @inkadra/shared
// (decision 0003), so a handler cannot drift from what installed clients parse without a test
// failing. Installed on every Fastify instance by test-setup.ts; never loaded in production.
// The schemas apply as declared: a plain z.object lets fields it does not list through, as
// clients parsing it do, and a .strict() one refuses them. Enums stay closed: a server sends only
// values of its own contract; the open enums of decision 0013 are about clients reading newer servers.
// What it cannot see: answers written on the raw socket after `reply.hijack()` skip onSend, so
// the tus protocol (POST, PATCH, DELETE and OPTIONS on /uploads, and HEAD, which is never
// checked) is out of its reach; its tests assert those answers with contractMismatch directly.
// Who fails (test-setup.ts): a mismatch belongs to whoever sent the request, one attempt of one
// test (by Vitest's task id and the attempt) or the suite hooks of the file. A test fails on its
// own mismatches; what belongs to the suite hooks, or arrives after its test ended, fails the
// file in the setup's last afterAll, which first waits up to 2 s for requests still answering.
// Guaranteed only with serial cases (no it.concurrent: one owner at a time) and awaited
// requests; an answer arriving after that last afterAll is not seen at all.
import { setTimeout as sleep } from 'node:timers/promises';
import { API_PREFIX } from '@inkadra/shared/constants';
import { apiOperations } from '@inkadra/shared/openapi';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/** `/a/:id` and `/a/{boardId}` both become `/a/{}`: parameter names differ between the two. */
const shape = (path: string) =>
  path
    .replace(/:[^/]+/g, '{}')
    .replace(/\{[^}]+\}/g, '{}')
    .replace(/\/$/, '');

type Operation = ReturnType<typeof apiOperations>[number];
let operations: Map<string, Operation> | undefined;
/**
 * By route pattern; a wildcard route (`hls/*`) by the path that was asked instead, and only when
 * the path's parameters pass the operation's own schema (`live/999/init.mp4` is no rung).
 */
function operation(method: string, route: string, path: string) {
  operations ??= new Map(
    apiOperations().map((op) => [`${op.method.toUpperCase()} ${shape(op.path)}`, op]),
  );
  if (!route.includes('*')) return operations.get(`${method} ${shape(route)}`);
  for (const op of operations.values()) {
    if (op.method.toUpperCase() !== method) continue;
    const names = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string);
    const pattern = op.path
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{[^}\\]+\\\}/g, '([^/]+)');
    const found = new RegExp(`^${pattern}$`).exec(path);
    if (!found) continue;
    const values = Object.fromEntries(names.map((name, i) => [name, found[i + 1]]));
    if (op.request?.params?.safeParse(values).success === false) continue;
    return op;
  }
}

interface Exception {
  method: string;
  /** Contract spelling, `{name}` for parameters. */
  path: string;
  /** Every status when omitted. */
  status?: number;
  reason: string;
}

/**
 * Answers the gate lets through although the contract does not describe them: drift that
 * cannot be fixed on either side without breaking installed clients, each with its reason and
 * a decision left to the maintainers. Empty: the one legacy body found (the live HLS 503) is
 * declared in the contract as what it is, LiveSegmentNotReady.
 * Not needed here: Better Auth (`/api/auth`), calendar feeds, guest pages and the web app live
 * outside /api/v1 and are never checked.
 */
export const EXCEPTIONS: readonly Exception[] = [];

/** The error shape of decision 0003. */
const apiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const internal = {
  'application/json': {
    schema: z.object({ error: z.object({ code: z.literal('internal'), message: z.string() }) }),
  },
};

const excepted = (method: string, path: string, status: number) =>
  EXCEPTIONS.some(
    (e) =>
      e.method === method &&
      shape(e.path) === shape(path) &&
      (e.status === undefined || e.status === status),
  );

/** What is wrong with one answer, or null when the contract describes it. */
export function contractMismatch(
  method: string,
  route: string,
  status: number,
  contentType: string,
  /** '' when the answer has no body, null for a stream (not read). */
  body: string | null,
  path = route,
): string | null {
  const where = `${method} ${route} → ${status}`;
  const op = operation(method, route, path);
  if (!op) {
    // A wildcard route answers names it does not serve with its own 404 (an unknown HLS file).
    if (route.includes('*') && status === 404) return checkJson(where, apiError, contentType, body);
    return `${where}: the contract has no such operation`;
  }
  if (excepted(method, op.path, status)) return null;
  const responses = op.responses;
  const response =
    responses[status] ??
    responses[`${String(status)[0]}XX`] ??
    responses.default ??
    // An unexpected failure can happen on any route; it still has the error shape of
    // decision 0003, which is all a client can rely on.
    (status === 500 ? { description: 'Internal error', content: internal } : undefined);
  if (!response) return `${where}: the contract does not describe this status`;
  // What the status declares decides the check. Nothing declared (204, 304, 413…): any body.
  const declared = 'content' in response ? (response.content ?? {}) : {};
  const types = Object.keys(declared);
  if (types.length === 0) return null;
  const media = declared['application/json'];
  const answered = contentType.split(';')[0]?.trim() || 'no body';
  if (!/^application\/([a-z.+-]+\+)?json$/.test(answered)) {
    // Files and playlists: only JSON bodies are read, other media types are left to the route.
    if (!media) return null;
    const fits = types.some(
      (t) => t === answered || (t.endsWith('/*') && answered.startsWith(t.slice(0, -1))),
    );
    if (fits) return null;
    return `${where}: the contract declares a JSON body, the answer has ${answered}`;
  }
  if (!media || !('schema' in media))
    return `${where}: answers JSON, the contract describes ${types.join(', ')}`;
  if (!(media.schema instanceof z.ZodType)) return null;
  return checkJson(where, media.schema, contentType, body);
}

function checkJson(where: string, schema: z.ZodType, contentType: string, body: string | null) {
  if (!/^application\/([a-z.+-]+\+)?json/.test(contentType))
    return `${where}: the contract declares a JSON body, the answer has ${contentType || 'no body'}`;
  // shortcut: a JSON stream (null) is not read here; no route streams JSON today.
  if (body === null) return null;
  if (body === '') return `${where}: the contract declares a JSON body, the answer has none`;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return `${where}: the body is not JSON`;
  }
  const result = schema.safeParse(value);
  if (result.success) return null;
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `  at ${i.path.length ? i.path.join('.') : '(body)'}: ${i.message}`);
  return `${where}: the body does not match the contract\n${issues.join('\n')}`;
}

/** Who answers for a mismatch: one attempt of one test, or the suite hooks of the file. */
export interface Owner {
  id: string;
  label: string;
}
const SUITE: Owner = { id: 'suite', label: 'the suite hooks (beforeAll or afterAll)' };
let current: Owner = SUITE;

/** Set by test-setup.ts around each test; null gives the answers back to the suite hooks. */
export function setOwner(owner: Owner | null) {
  current = owner ?? SUITE;
}
export function currentOwner(): Owner {
  return current;
}

const mismatches: Array<{ owner: Owner; problem: string }> = [];

/** The mismatches of one owner, or all of them, taken out of the queue. */
export function takeMismatches(owner?: Owner): string[] {
  const taken: string[] = [];
  for (let i = mismatches.length - 1; i >= 0; i--) {
    const found = mismatches[i];
    if (found && (!owner || found.owner.id === owner.id)) {
      taken.unshift(found.problem);
      mismatches.splice(i, 1);
    }
  }
  return taken;
}

let inFlight = 0;
/**
 * Waits, within a short bound, for the requests still being answered. Real timers and a
 * monotonic clock: a test left with fake timers cannot stall it.
 */
export async function settled(boundMs = 2000) {
  const deadline = monotonic() + BigInt(boundMs) * 1_000_000n;
  while (inFlight > 0 && monotonic() < deadline) await pause(50);
}
// Taken when the module loads, before a test can install fake timers over them.
const monotonic = process.hrtime.bigint;
const pause = sleep;

/** Apps whose answers are not checked: all of them (true), or those of some routes. */
const unchecked = new WeakMap<object, true | Set<string>>();

/**
 * For a test whose app stands in fake routes under /api/v1 to exercise something around them
 * (CSRF, compression): their answers are fixtures, not the server's. With `route`, only that
 * route pattern of an otherwise real app is left out.
 */
export function uncheckedResponses(app: FastifyInstance, route?: string) {
  const routes = unchecked.get(app);
  if (route === undefined) unchecked.set(app, true);
  else if (routes !== true) unchecked.set(app, new Set([...(routes ?? []), route]));
}

const isUnchecked = (app: object, route: string) => {
  const routes = unchecked.get(app);
  return routes === true || routes?.has(route) === true;
};

/**
 * The path asked, from the route pattern and the parameters Fastify already decoded, so that
 * `/hls/live/%34%38%30/init.mp4` is matched as rung 480, as its handler reads it.
 */
const decodedPath = (route: string, params: unknown) => {
  const values = (params ?? {}) as Record<string, unknown>;
  return route
    .replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => String(values[name] ?? ''))
    .replace('*', String(values['*'] ?? ''));
};

const printed = (error: unknown) => {
  try {
    return String(error);
  } catch {
    return 'an error that cannot be printed';
  }
};

export function checkResponses(app: FastifyInstance, check = contractMismatch) {
  const sentBy = new WeakMap<object, Owner>();
  app.addHook('onRequest', async (req, reply) => {
    sentBy.set(req, current);
    inFlight += 1;
    let done = false;
    const end = () => {
      if (!done) inFlight -= 1;
      done = true;
    };
    reply.raw.once('finish', end);
    reply.raw.once('close', end);
  });
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    // The hook only observes: whatever happens or is thrown here, the answer leaves as it was.
    try {
      const route = req.routeOptions.url;
      // Unknown paths answer the generic 404 of the not-found handler; HEAD carries no body.
      if (!route?.startsWith(API_PREFIX) || req.method === 'HEAD' || isUnchecked(app, route))
        return payload;
      let problem: string | null;
      try {
        // No payload at all is an empty body; only a stream is left unread (null).
        const body =
          payload === undefined || payload === null
            ? ''
            : typeof payload === 'string'
              ? payload
              : Buffer.isBuffer(payload)
                ? payload.toString('utf8')
                : null;
        problem = check(
          req.method,
          route,
          reply.statusCode,
          String(reply.getHeader('content-type') ?? ''),
          body,
          decodedPath(route, req.params),
        );
      } catch (error) {
        problem = `${req.method} ${route} → ${reply.statusCode}: the check threw: ${printed(error)}`;
      }
      if (!problem) return payload;
      const owner = sentBy.get(req) ?? current;
      if (owner.id !== current.id)
        problem += `\n  (sent by ${owner.label}, answered during ${current.label}: await every request)`;
      else if (owner === SUITE) problem += `\n  (in ${SUITE.label})`;
      mismatches.push({ owner, problem });
    } catch {
      // Recording failed: the answer still leaves untouched.
    }
    return payload;
  });
}
