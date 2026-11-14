// Fails CI on a breaking change to what clients use (#845): the /api/v1 contract against the last
// release, and the names packages/* export against the commit this one builds on. A break that was
// decided on purpose goes in contract-breaks.json, with the PR that decided it.
//
//   node scripts/contract-check.mjs openapi <released openapi.json> <current openapi.json>
//   node scripts/contract-check.mjs packages <base git revision>
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const methods = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'];

/** The breaks an old client of `before` would meet against `after`. */
export function openapiBreaks(before, after) {
  const breaks = [];
  const requests = requestSchemas(before);
  for (const [path, item] of Object.entries(before.paths ?? {})) {
    for (const method of methods) {
      const old = item[method];
      if (!old) continue;
      const op = `${method.toUpperCase()} ${path}`;
      const now = after.paths?.[path]?.[method];
      if (!now) {
        breaks.push(`openapi: ${op} removed`);
        continue;
      }
      const had = new Set((old.parameters ?? []).map((p) => `${p.in}:${p.name}`));
      for (const p of now.parameters ?? []) {
        if (p.required && !had.has(`${p.in}:${p.name}`)) {
          breaks.push(`openapi: ${op} new required ${p.in} parameter ${p.name}`);
        }
      }
      const body = (o) => o.requestBody?.content?.['application/json']?.schema;
      if (body(old) && body(now)) compare(body(old), body(now), `${op} body`, true, breaks);
      for (const [status, response] of Object.entries(old.responses ?? {})) {
        const schema = (r) => r?.content?.['application/json']?.schema;
        const next = schema(now.responses?.[status]);
        if (schema(response) && next) {
          compare(schema(response), next, `${op} ${status}`, false, breaks);
        }
      }
    }
  }
  for (const [name, schema] of Object.entries(before.components?.schemas ?? {})) {
    const next = after.components?.schemas?.[name];
    if (!next) breaks.push(`openapi: schema ${name} removed`);
    else compare(schema, next, name, requests.has(name), breaks);
  }
  return breaks;
}

// Component schemas a request body reaches, directly or through other schemas.
function requestSchemas(doc) {
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const ref = typeof node.$ref === 'string' && node.$ref.split('/').at(-1);
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      visit(doc.components?.schemas?.[ref]);
    }
    for (const value of Object.values(node)) visit(value);
  };
  for (const item of Object.values(doc.paths ?? {})) {
    for (const method of methods) visit(item[method]?.requestBody);
  }
  return seen;
}

// A schema behind a $ref is compared once, under its own name.
function compare(old, now, where, request, breaks) {
  if (!old || !now || old.$ref || now.$ref) return;
  for (const key of Object.keys(old.properties ?? {})) {
    if (!now.properties?.[key]) breaks.push(`openapi: ${where}.${key} removed`);
    else compare(old.properties[key], now.properties[key], `${where}.${key}`, request, breaks);
  }
  if (old.items && now.items) compare(old.items, now.items, `${where}[]`, request, breaks);
  if (request) {
    const required = new Set(old.required ?? []);
    for (const key of now.required ?? []) {
      // A field the old schema did not know is new: old clients never send it.
      if (!required.has(key)) breaks.push(`openapi: ${where}.${key} now required`);
    }
    for (const value of old.enum ?? []) {
      if (now.enum && !now.enum.includes(value)) {
        breaks.push(`openapi: ${where} no longer accepts ${JSON.stringify(value)}`);
      }
    }
    for (const kind of ['anyOf', 'oneOf']) {
      const branches = new Set((now[kind] ?? []).map((b) => JSON.stringify(b)));
      for (const branch of old[kind] ?? []) {
        if (now[kind] && !branches.has(JSON.stringify(branch))) {
          breaks.push(`openapi: ${where} no longer accepts ${JSON.stringify(branch)}`);
        }
      }
    }
  }
}

/**
 * Names each entry point of a package exports, read from its source.
 * shortcut: names only, read with regexes, not the TypeScript checker (TypeScript 7 has no JS
 * API yet), so a changed signature or a removed interface field is not seen; the OpenAPI check
 * covers the wire. Upgrade to a declaration diff when the checker API ships.
 */
export function exportedNames(read, entry, seen = new Set()) {
  if (seen.has(entry)) return new Set();
  seen.add(entry);
  const source = read(entry)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const names = new Set();
  const from = (spec) => posix.join(posix.dirname(entry), spec);
  for (const [, ns, spec] of source.matchAll(
    /export\s+\*(?:\s+as\s+(\w+))?\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    if (ns) names.add(ns);
    else for (const name of exportedNames(read, from(spec), seen)) names.add(name);
  }
  for (const [, list] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const item of list.split(',')) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.replace(/^type\s+/, '');
      if (name) names.add(name);
    }
  }
  const declaration =
    /export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|namespace)\s+(\w+)/g;
  for (const [, name] of source.matchAll(declaration)) names.add(name);
  if (/export\s+default\s/.test(source)) names.add('default');
  return names;
}

function packageEntries(read) {
  const entries = [];
  for (const pkg of readdirSync(join(root, 'packages'))) {
    let manifest;
    try {
      manifest = JSON.parse(read(`packages/${pkg}/package.json`));
    } catch {
      continue; // The package is new in this change: nothing to break.
    }
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const file = typeof target === 'string' ? target : target?.default;
      if (/\.tsx?$/.test(file ?? '') && !subpath.includes('fixtures')) {
        entries.push({
          name: posix.join(manifest.name, subpath),
          file: posix.join(`packages/${pkg}`, file),
        });
      }
    }
  }
  return entries;
}

/** Exported names of `before` that `after` lost, as break ids. */
export function packageBreaks(readBefore, readAfter) {
  const breaks = [];
  const now = new Map(packageEntries(readAfter).map((e) => [e.name, e]));
  for (const entry of packageEntries(readBefore)) {
    const next = now.get(entry.name);
    if (!next) {
      breaks.push(`package: ${entry.name} removed`);
      continue;
    }
    const kept = exportedNames(readAfter, next.file);
    for (const name of exportedNames(readBefore, entry.file)) {
      if (!kept.has(name)) breaks.push(`package: ${entry.name} no longer exports ${name}`);
    }
  }
  return breaks;
}

function report(breaks) {
  const allowed = new Set(
    JSON.parse(readFileSync(join(root, 'scripts/contract-breaks.json'), 'utf8')).accepted.map(
      (a) => a.break,
    ),
  );
  const open = breaks.filter((b) => !allowed.has(b));
  for (const b of breaks) console.log(`${allowed.has(b) ? 'accepted' : 'BREAKING'}  ${b}`);
  if (open.length) {
    console.error(
      `\n${open.length} breaking change(s) for installed apps and API clients. Keep the old name or field ` +
        '(AGENTS.md, CONTRIBUTING.md), or, if the break is decided, add each line to ' +
        'scripts/contract-breaks.json with the PR that decides it.',
    );
    process.exit(1);
  }
  console.log(`No unaccepted breaking change (${breaks.length} accepted).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === 'openapi' && a && b) {
    report(openapiBreaks(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8'))));
  } else if (mode === 'packages' && a) {
    const readBefore = (file) =>
      execFileSync('git', ['show', `${a}:${file}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    const readAfter = (file) => readFileSync(join(root, file), 'utf8');
    report(packageBreaks(readBefore, readAfter));
  } else {
    console.error(
      'Usage: contract-check.mjs openapi <before.json> <after.json> | packages <base revision>',
    );
    process.exit(2);
  }
}
