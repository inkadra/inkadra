// SPDX-License-Identifier: MPL-2.0
/**
 * Writes the board fixture of a release (#849) with the code of that release: copy this file
 * into packages/doc-schema/scripts/ of a checkout of the tag and run
 *   pnpm --filter @inkadra/doc-schema exec tsx scripts/release-fixture.ts --tag v0.9.0 --out <dir>
 * Commit the two files it writes to packages/doc-schema/src/fixtures/ and never regenerate them:
 * they stand for documents stored by that release. It must keep working on old tags, so it only
 * uses what every release exports: Element, addElement, createBoardDoc, readElement, roots.
 *
 * Every card type the release knows is written twice (first and last value of each enumeration),
 * with every field filled: each value is the first candidate the release's own schema accepts.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as Y from 'yjs';
import * as schema from '../src/index.ts';

const { values } = parseArgs({
  options: { tag: { type: 'string' }, out: { type: 'string', default: '.' } },
});
if (!values.tag) throw new Error('--tag is the release, e.g. v0.9.0');

// biome-ignore lint/suspicious/noExplicitAny: walks the zod definitions of any release
type Zod = any;
const def = (t: Zod) => t._zod.def;
const ok = (t: Zod, v: unknown) => t.safeParse(v).success;
const BOARD = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const uuid = (n: number) => `0193f0a4-6c1e-7b9a-9c51-${String(n).padStart(12, '0')}`;
const TEXTS = (key: string, n: number) => [
  ...(/ids?$/i.test(key) ? [uuid(n), `el_fixture_${String(n).padStart(4, '0')}`] : []),
  /url/i.test(key) ? 'https://example.com/ref' : `${key} ${n}`,
  'Luce al neon',
  'https://example.com/ref',
  '#C9A36A',
  '2026-03-14',
  '09:30',
  `el_fixture_${String(n).padStart(4, '0')}`,
  uuid(n),
  'a0',
  'x',
];
const NUMBERS = [120, 1, 0.25, 0, 2, 24, 1000];

/** A value the schema accepts, or undefined; `last` picks the last value of enumerations. */
function sample(t: Zod, key: string, last: boolean, n: number): unknown {
  const d = def(t);
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
      return sample(d.innerType, key, last, n);
    case 'pipe': {
      // A lenient list (array of unknown, read item by item): its item schema is not in the
      // definition, so it is taken from the exports named after the field (icons: PlanIcon).
      const inner = def(d.in);
      if (inner.type === 'array' && def(inner.element).type === 'unknown') {
        const name = key.replace(/s$/, '').replace(/^./, (c) => c.toUpperCase());
        for (const item of [`Plan${name}`, name, `Frame${name}`]) {
          const found = (schema as Zod)[item];
          const value = found?._zod ? [sample(found, key, last, n)] : null;
          if (value && t.safeParse(value).data?.length > 0) return value;
        }
      }
      return sample(d.in, key, last, n);
    }
    case 'lazy':
      return sample(d.getter(), key, last, n);
    case 'string':
      return TEXTS(key, n).find((v) => ok(t, v));
    case 'number':
    case 'int':
      return NUMBERS.find((v) => ok(t, v));
    case 'boolean':
      return !last;
    case 'literal':
      return d.values[0];
    case 'enum': {
      const all = Object.values(d.entries);
      return last ? all.at(-1) : all[0];
    }
    case 'array': {
      const item = sample(d.element, key.replace(/s$/, ''), last, n + 1);
      // Points and other lists that need several items: the same item repeated.
      for (const count of item === undefined ? [] : [1, 2, 4]) {
        const value = Array.from({ length: count }, () => item);
        if (ok(t, value)) return value;
      }
      return ok(t, []) ? [] : undefined;
    }
    case 'tuple': {
      const value = d.items.map((i: Zod, k: number) => sample(i, key, last, n + k));
      return ok(t, value) ? value : undefined;
    }
    case 'record': {
      const value = { [String(sample(d.keyType, 'id', last, n))]: sample(d.valueType, key, last, n) };
      return ok(t, value) ? value : {};
    }
    case 'object':
      return object(t, last, n);
    case 'union':
      for (const option of last ? [...d.options].reverse() : d.options) {
        const v = sample(option, key, last, n);
        if (v !== undefined && ok(t, v)) return v;
      }
      return undefined;
    default:
      return undefined;
  }
}

/** Every field filled, then the ones the schema refuses dropped until it accepts the object. */
function object(t: Zod, last: boolean, n: number): Record<string, unknown> | undefined {
  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(def(t).shape as Record<string, Zod>)) {
    const v = sample(field, key, last, n);
    if (v !== undefined) value[key] = v;
  }
  for (let i = 0; i < 50; i++) {
    const parsed = t.safeParse(value);
    if (parsed.success) return value;
    const key = parsed.error.issues[0]?.path[0];
    if (typeof key !== 'string' || !(key in value) || !ok(def(t).shape[key], undefined))
      return undefined;
    delete value[key];
  }
  return undefined;
}

const doc = schema.createBoardDoc(BOARD);
doc.clientID = 4242;
const element = (schema as Zod).Element;
const skipped: string[] = [];
let n = 0;
for (const option of def(element).options as Zod[]) {
  const type = def(def(option).shape.type).values[0] as string;
  for (const last of [false, true]) {
    n += 1;
    const fields = object(option, last, n * 10);
    if (!fields) {
      skipped.push(type);
      continue;
    }
    const card = {
      ...fields,
      id: `${type}_${last ? 'last' : 'first'}_fixture`,
      type,
      x: n * 300,
      y: last ? 400 : 0,
      w: 240,
      z: `a${n}`,
      parent: null,
      createdBy: null,
      createdAt: 1_760_000_000_000,
    };
    const map = schema.addElement(doc, card);
    const body = map.get('body');
    if (body instanceof Y.XmlFragment) {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('Luce al neon')]);
      body.insert(0, [paragraph]);
    }
  }
}
const elements = Object.fromEntries(
  [...schema.roots(doc).elements.entries()].map(([id, map]) => [
    id,
    schema.readElement(map as Y.Map<unknown>),
  ]),
);
const version = schema.roots(doc).meta.get('schemaVersion');
const name = join(resolve(values.out), `board-${values.tag}`);
writeFileSync(`${name}.ybin`, Y.encodeStateAsUpdate(doc));
writeFileSync(
  `${name}.json`,
  `${JSON.stringify({ tag: values.tag, schemaVersion: version, elements }, null, 2)}\n`,
);
console.log(
  `${name}: schema ${version}, ${Object.keys(elements).length} cards` +
    (skipped.length ? `, could not fill: ${[...new Set(skipped)].join(', ')}` : ''),
);
