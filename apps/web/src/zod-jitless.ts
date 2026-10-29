import { config } from 'zod';

/**
 * Zod compiles object parsers with `new Function` unless told not to, and it probes for that
 * the first time an object schema is created. Under an enforced `script-src 'self'` the probe
 * fails quietly but still raises a CSP violation on every load, so the web app opts out before
 * any schema module runs. With the default report-only policy the probe succeeds, so this does
 * change production: Zod parses on its interpreted path, including Element.safeParse for every
 * board element (the Canvas performance CI job passed with it). main.tsx imports it first, and
 * the build puts it in Zod's chunk (vite.config.ts), which loads before the chunks that build
 * schemas.
 */
config({ jitless: true });
