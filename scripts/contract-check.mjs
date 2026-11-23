// Fails CI on a breaking change to what clients use (#845): the /api/v1 contract against the last
// release, and the names packages/* export against the commit this one builds on. A break that was
// decided on purpose goes in contract-breaks.json, with the PR that decided it.
//
//   node scripts/contract-check.mjs openapi <released openapi.json | none> <current openapi.json>
//   node scripts/contract-check.mjs packages <base git revision>
//   <tags, one per line> | node scripts/contract-check.mjs base-tag <git ref being built>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// The OpenAPI check is a strict diff (maintainer's decision, 2026-11-23): it judges nothing. Both
// documents are canonicalised and compared position by position, and every difference is a line,
//   openapi: <JSON pointer>: <before> → <after>
// at the smallest position that differs: a new path, operation, status, component or property as
// much as a removed one. "(absent)" is a missing side; a value is its canonical JSON, and past 120
// characters a preview followed by the full sha256 of the whole, so an accepted line in
// scripts/contract-breaks.json covers exactly one change. A line never spans two physical lines.
//
// Canonical form. The document is walked as OpenAPI 3.1 (root, paths and webhooks, path items,
// operations, parameters, request bodies, responses, headers, media types, components, and inside
// Schema Objects the keywords holding sub-schemas). Only these annotations are dropped, and only
// there: `info`, `tags` and `externalDocs` at the root; `summary`, `description` on path items and
// Reference Objects; `summary`, `description`, `tags` on operations; `description`, `example`,
// `examples` on parameters and headers; `description` on request bodies and responses; `example`,
// `examples` on media types; `description`, `title`, `example`, `examples` on Schema Objects.
// `required` and `type` lists are sorted, `enum` members are sorted by their canonical JSON (each
// member left as it is). Everything else (`const`, `default`, `discriminator`, `security`, `x-*`,
// callbacks, links, any keyword the walk does not know) is data compared exactly, object keys
// sorted. Numbers keep their source text when it does not round-trip, so distinct numbers never
// compare equal. A `$ref` is a string; nothing is resolved.
//
// References. A separate pass reads each `$ref` at a reference position of the current document and
// reports one that does not resolve. Only local `#/…` JSON pointers (RFC 6901) are in scope: any
// other reference (`#anchor`, a URL) is reported as unsupported, a line to accept like the others.

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const isObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !JSON.isRawJSON(v);
const map = () => Object.create(null);
const sortedKeys = (o) => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const byJson = (a, b) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The canonical form of a decimal literal, to tell whether a parsed number kept its value. */
function decimal(text) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) return text;
  let digits = (m[2] + (m[3] ?? '')).replace(/^0+/, '');
  let exp = Number(m[4] ?? 0) - (m[3] ?? '').length;
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exp++;
  }
  return digits ? `${m[1]}${digits}e${exp}` : '0';
}

/** JSON.parse that keeps, as raw JSON, every number a double would change. */
export function parseJson(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    if (typeof context?.source !== 'string') {
      throw new Error('This Node.js does not give JSON.parse the source text of numbers.');
    }
    return decimal(String(value)) === decimal(context.source)
      ? value
      : JSON.rawJSON(context.source);
  });
}

/** Opaque data: object keys sorted, nothing dropped. */
function data(node) {
  if (Array.isArray(node)) return node.map(data);
  if (!isObject(node)) return node;
  const out = map();
  for (const k of sortedKeys(node)) out[k] = data(node[k]);
  return out;
}

/**
 * A walker for one kind of OpenAPI object: `drop` are its annotations, `kids` how to read its keys.
 * A node that is not an object is data.
 */
function walker(drop, kids = {}, ref = false) {
  return (node, at, refs) => {
    if (!isObject(node)) return data(node);
    const refObject = ref && Object.hasOwn(node, '$ref');
    const out = map();
    for (const k of sortedKeys(node)) {
      if (refObject ? k === 'summary' || k === 'description' : drop.includes(k)) continue;
      if (k === '$ref' && (refObject || kids.$ref) && typeof node[k] === 'string') {
        refs?.push([[...at, k], node[k]]);
      }
      const read =
        !refObject && typeof kids[k] === 'function' && Object.hasOwn(kids, k) ? kids[k] : null;
      out[k] = read ? read(node[k], [...at, k], refs) : data(node[k]);
    }
    return out;
  };
}
const mapOf = (read) => (node, at, refs) => {
  if (!isObject(node)) return data(node);
  const out = map();
  for (const k of sortedKeys(node)) out[k] = read(node[k], [...at, k], refs);
  return out;
};
/** A Paths or Responses Object: its `x-` keys are extensions, plain data, not entries. */
const entriesOf = (read) =>
  mapOf((node, at, refs) =>
    String(at.at(-1)).startsWith('x-') ? data(node) : read(node, at, refs),
  );
const listOf = (read) => (node, at, refs) =>
  Array.isArray(node) ? node.map((v, i) => read(v, [...at, i], refs)) : data(node);
const sortedList = (node) => (Array.isArray(node) ? node.map(data).sort(byJson) : data(node));

const schemaKids = {};
const schema = (node, at, refs) => {
  if (!isObject(node)) return data(node);
  return walker(['description', 'title', 'example', 'examples'], schemaKids)(node, at, refs);
};
Object.assign(schemaKids, {
  $ref: true,
  required: sortedList,
  type: sortedList,
  enum: sortedList,
  ...Object.fromEntries(
    ['properties', 'patternProperties', '$defs', 'dependentSchemas'].map((k) => [k, mapOf(schema)]),
  ),
  ...Object.fromEntries(
    [
      'items',
      'additionalProperties',
      'not',
      'if',
      'then',
      'else',
      'contains',
      'propertyNames',
      'unevaluatedItems',
      'unevaluatedProperties',
    ].map((k) => [k, schema]),
  ),
  ...Object.fromEntries(['allOf', 'anyOf', 'oneOf', 'prefixItems'].map((k) => [k, listOf(schema)])),
});
const media = walker(['example', 'examples'], { schema });
const content = mapOf(media);
const parameter = walker(['description', 'example', 'examples'], { schema, content }, true);
const header = parameter;
const requestBody = walker(['description'], { content }, true);
const response = walker(['description'], { content, headers: mapOf(header) }, true);
const operation = walker(['summary', 'description', 'tags'], {
  parameters: listOf(parameter),
  requestBody,
  responses: entriesOf(response),
});
const pathItem = walker(
  ['summary', 'description'],
  {
    parameters: listOf(parameter),
    ...Object.fromEntries(methods.map((m) => [m, operation])),
  },
  true,
);
const components = walker([], {
  schemas: mapOf(schema),
  parameters: mapOf(parameter),
  requestBodies: mapOf(requestBody),
  responses: mapOf(response),
  headers: mapOf(header),
  pathItems: mapOf(pathItem),
});
const openapiRoot = walker(['info', 'tags', 'externalDocs'], {
  paths: entriesOf(pathItem),
  webhooks: mapOf(pathItem),
  components,
});

/** The canonical form of an OpenAPI document; `refs` collects [pointer parts, $ref] pairs. */
export function canonical(doc, refs) {
  return openapiRoot(doc, [], refs);
}

const oneLine = (text) =>
  text.replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const pointer = (parts) =>
  oneLine(
    JSON.stringify(
      `#${parts.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('')}`,
    ).slice(1, -1),
  );

/** A canonical value for a line: whole when short, else a preview and the sha256 of the whole. */
export function shown(value) {
  if (value === undefined) return '(absent)';
  const json = oneLine(JSON.stringify(value));
  if (json.length <= 120) return json;
  return `${json.slice(0, 120)}…#${createHash('sha256').update(json).digest('hex')}`;
}

/** One line per smallest position where `a` and `b` differ. */
function diff(a, b, parts, out) {
  if (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b)) return;
  if (isObject(a) && isObject(b)) {
    for (const k of sortedKeys(Object.assign(map(), a, b))) {
      diff(
        Object.hasOwn(a, k) ? a[k] : undefined,
        Object.hasOwn(b, k) ? b[k] : undefined,
        [...parts, k],
        out,
      );
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff(i < a.length ? a[i] : undefined, i < b.length ? b[i] : undefined, [...parts, i], out);
    }
  } else out.push(`openapi: ${pointer(parts)}: ${shown(a)} → ${shown(b)}`);
}

/** The lines an old client of `before` may meet against `after`. */
export function openapiBreaks(before, after) {
  const out = [];
  diff(canonical(before), canonical(after), [], out);
  return out;
}

/** Every `$ref` at a reference position of `doc` that is not a local pointer resolving in it. */
export function danglingRefs(doc) {
  const refs = [];
  canonical(doc, refs);
  const found = [];
  for (const [parts, ref] of refs) {
    const at = `openapi: ${pointer(parts)}: $ref ${oneLine(JSON.stringify(ref))}`;
    if (ref !== '#' && !ref.startsWith('#/')) {
      found.push(`${at} is an unsupported reference (only local #/ pointers are checked)`);
    } else if (!resolves(doc, ref)) found.push(`${at} does not resolve`);
  }
  return found;
}

/** Whether a local `#/…` reference names a value of `doc` (RFC 6901, own properties only). */
function resolves(doc, ref) {
  let fragment;
  try {
    fragment = decodeURIComponent(ref.slice(1));
  } catch {
    return false;
  }
  if (fragment === '') return true;
  let node = doc;
  for (const token of fragment.slice(1).split('/')) {
    if (/~(?![01])/.test(token)) return false;
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length) return false;
      node = node[Number(key)];
    } else if (isObject(node) && Object.hasOwn(node, key)) node = node[key];
    else return false;
  }
  return true;
}

/**
 * The stable release the API is compared with. On a stable release tag (`refs/tags/vX.Y.Z`), the
 * highest stable tag below it, so the tag's own accepted lines are still reported; on anything else
 * (a branch, a pull request, a release candidate), the highest stable tag. Undefined when there is
 * none (the first release).
 */
export function baseTag(tags, ref = '') {
  const stable = /^v(\d+)\.(\d+)\.(\d+)$/;
  const version = (t) => stable.exec(t).slice(1, 4).map(BigInt);
  const order = (a, b) => {
    const [x, y] = [version(a), version(b)];
    const at = [0, 1, 2].find((i) => x[i] !== y[i]);
    return at === undefined ? 0 : x[at] < y[at] ? -1 : 1;
  };
  const own = ref.replace(/^refs\/tags\//, '');
  const releaseTag = ref.startsWith('refs/tags/') && stable.test(own);
  return tags
    .filter((t) => stable.test(t))
    .filter((t) => !releaseTag || order(t, own) < 0)
    .sort(order)
    .at(-1);
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

/**
 * The lines to print for `breaks` against the accepted ones. An accepted line starting with `stale`
 * that the check no longer produces is stale: it would hide nothing today and must go, so the list
 * shrinks when the base release moves.
 */
export function judge(breaks, accepted, stale) {
  const allowed = new Set(accepted);
  const produced = new Set(breaks);
  const old = stale ? accepted.filter((a) => a.startsWith(stale) && !produced.has(a)) : [];
  return {
    lines: [
      ...breaks.map((b) => `${allowed.has(b) ? 'accepted' : 'BREAKING'}  ${b}`),
      ...old.map((a) => `STALE     ${a}`),
    ],
    open: breaks.filter((b) => !allowed.has(b)),
    stale: old,
  };
}

function report(breaks, stale) {
  const accepted = JSON.parse(
    readFileSync(join(root, 'scripts/contract-breaks.json'), 'utf8'),
  ).accepted.map((a) => a.break);
  const { lines, open, stale: old } = judge(breaks, accepted, stale);
  for (const line of lines) console.log(line);
  if (open.length) {
    console.error(
      `\n${open.length} breaking change(s) for installed apps and API clients. Keep the old name or field ` +
        '(AGENTS.md, CONTRIBUTING.md), or, if the break is decided, add each line to ' +
        'scripts/contract-breaks.json with the PR that decides it.',
    );
  }
  if (old.length) {
    console.error(
      `\n${old.length} accepted line(s) no longer reported: remove them from scripts/contract-breaks.json.`,
    );
  }
  if (open.length || old.length) process.exit(1);
  console.log(`No unaccepted breaking change (${breaks.length} accepted).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === 'openapi' && a && b) {
    const after = parseJson(readFileSync(b, 'utf8'));
    if (a === 'none') {
      // The first release has nothing to compare with: only the references are checked.
      console.log('No earlier stable release: the diff is skipped, references are still checked.');
      report(danglingRefs(after));
    } else {
      const breaks = [
        ...openapiBreaks(parseJson(readFileSync(a, 'utf8')), after),
        ...danglingRefs(after),
      ];
      // Accepted openapi lines are measured against the release, so one no longer reported is stale.
      report(breaks, 'openapi: ');
    }
  } else if (mode === 'base-tag') {
    // Prints nothing when there is no stable release yet.
    const tag = baseTag(readFileSync(0, 'utf8').split(/\s+/), a);
    if (tag) console.log(tag);
  } else if (mode === 'packages' && a) {
    const readBefore = (file) =>
      execFileSync('git', ['show', `${a}:${file}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    const readAfter = (file) => readFileSync(join(root, file), 'utf8');
    // Package lines are measured against the parent commit: they are reported only once.
    report(packageBreaks(readBefore, readAfter));
  } else {
    console.error(
      'Usage: contract-check.mjs openapi <before.json> <after.json> | packages <base revision> | base-tag <ref>',
    );
    process.exit(2);
  }
}
