// Tests only: every answer under /api/v1 is checked against the contract of @inkadra/shared
// (decision 0003), so a handler cannot drift from what installed clients parse without a test
// failing. Installed on every Fastify instance by test-setup.ts; never loaded in production.
// The schemas apply as declared: a plain z.object lets fields it does not list through, as
// clients parsing it do, and a .strict() one refuses them. Enums stay closed: a server sends only
// values of its own contract; the open enums of decision 0013 are about clients reading newer servers.
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

type Responses = ReturnType<typeof apiOperations>[number]['responses'];
let operations: Map<string, Responses> | undefined;
/** By route pattern; a wildcard route (`hls/*`) by the path that was asked instead. */
function operation(method: string, route: string, path: string) {
  operations ??= new Map(
    apiOperations().map((op) => [`${op.method.toUpperCase()} ${shape(op.path)}`, op.responses]),
  );
  if (!route.includes('*')) return operations.get(`${method} ${shape(route)}`);
  for (const [key, responses] of operations) {
    const [m, template = ''] = key.split(' ');
    const pattern = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\{\\}', '[^/]+');
    if (m === method && new RegExp(`^${pattern}$`).test(path)) return responses;
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
 * a decision left to the maintainers. Empty: every mismatch found so far was fixed.
 * Not needed here: Better Auth (`/api/auth`), calendar feeds, guest pages and the web app live
 * outside /api/v1 and are never checked; uploads (tus), HLS and file downloads are described.
 */
export const EXCEPTIONS: readonly Exception[] = [];

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
  body: string | null,
  path = route,
): string | null {
  const where = `${method} ${route} → ${status}`;
  if (excepted(method, route, status)) return null;
  const responses = operation(method, route, path);
  if (!responses) return `${where}: the contract has no such operation`;
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
  // shortcut: a JSON stream is not read here; no route streams JSON today.
  if (body === null) return null;
  if (!(media.schema instanceof z.ZodType)) return null;
  const schema: z.ZodType = media.schema;
  let value: unknown;
  try {
    value = body === '' ? undefined : JSON.parse(body);
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

const mismatches: string[] = [];

/** The mismatches seen since the last call, emptied. */
export function takeMismatches(): string[] {
  return mismatches.splice(0);
}

const unchecked = new WeakSet<object>();

/**
 * For a test whose app stands in fake routes under /api/v1 to exercise something around them
 * (CSRF, compression): their answers are fixtures, not the server's.
 */
export function uncheckedResponses(app: FastifyInstance) {
  unchecked.add(app);
}

export function checkResponses(app: FastifyInstance) {
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const route = req.routeOptions.url;
    // Unknown paths answer the generic 404 of the not-found handler; HEAD carries no body.
    if (!route?.startsWith(API_PREFIX) || req.method === 'HEAD' || unchecked.has(app))
      return payload;
    const body =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : null;
    const problem = contractMismatch(
      req.method,
      route,
      reply.statusCode,
      String(reply.getHeader('content-type') ?? ''),
      body,
      req.url.split('?')[0],
    );
    if (problem) mismatches.push(problem);
    return payload;
  });
}
