// Lets Node load src/worker.js: `cloudflare:workers` exists only on Cloudflare, so the tests map it
// to a stand-in DurableObject base class (it just keeps ctx and env, like the real one).
import { register } from 'node:module';

const stub = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
