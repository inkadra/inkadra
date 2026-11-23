import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  baseTag,
  danglingRefs,
  exportedNames,
  judge,
  openapiBreaks,
  packageBreaks,
  parseJson,
  shown,
} from './contract-check.mjs';

const S = { type: 'string' };
const ok = { description: 'ok' };
/** A document with these paths and schema components. */
const api = (paths = {}, schemas = {}, more = {}) => ({
  openapi: '3.1.0',
  info: { title: 'x', version: '1' },
  paths,
  components: { schemas },
  ...more,
});
const answer = (schema) => ({ content: { 'application/json': { schema } } });
const get = (schema = S) => ({ get: { responses: { 200: answer(schema) } } });
const diff = (a, b) => openapiBreaks(a, b);
const schemaOf = (A) => api({}, { A });
const real = parseJson(
  readFileSync(new URL('../packages/shared/openapi.json', import.meta.url), 'utf8'),
);

test('the real document compared with itself has nothing to report', () => {
  assert.deepEqual(diff(real, real), []);
  assert.deepEqual(danglingRefs(real), []);
});

test('nothing passes by itself', () => {
  // New paths, overlapping or not, a new component, a container appearing or going.
  assert.deepEqual(
    diff(api({ '/items/latest': get() }), api({ '/items/latest': get(), '/items/{id}': get() })),
    [
      'openapi: #/paths/~1items~1{id}: (absent) → {"get":{"responses":{"200":{"content":{"application/json":{"schema":{"type":"string"}}}}}}}',
    ],
  );
  assert.deepEqual(
    diff(api({ '/a/other/{y}': get() }), api({ '/a/other/{y}': get(), '/a/{x}/fixed': get() })),
    [
      'openapi: #/paths/~1a~1{x}~1fixed: (absent) → {"get":{"responses":{"200":{"content":{"application/json":{"schema":{"type":"string"}}}}}}}',
    ],
  );
  const pet = {
    oneOf: [{ $ref: '#/components/schemas/Dog' }],
    discriminator: { propertyName: 'kind' },
  };
  assert.deepEqual(diff(api({}, { Pet: pet, Dog: S }), api({}, { Pet: pet, Dog: S, Cat: S })), [
    'openapi: #/components/schemas/Cat: (absent) → {"type":"string"}',
  ]);
  const withHeaders = { ...api(), components: { schemas: {}, headers: { H: { schema: S } } } };
  assert.deepEqual(diff(api(), withHeaders), [
    'openapi: #/components/headers: (absent) → {"H":{"schema":{"type":"string"}}}',
  ]);
  const { paths: _gone, ...noPaths } = api();
  assert.deepEqual(diff(api(), noPaths), ['openapi: #/paths: {} → (absent)']);
  assert.deepEqual(diff(api({}, { toString: S }), api()), [
    'openapi: #/components/schemas/toString: {"type":"string"} → (absent)',
  ]);
});

test('what is data is compared exactly', () => {
  // An enum member is data, even its `description`; so are security requirements.
  assert.deepEqual(
    diff(
      schemaOf({ enum: [{ a: 1, description: 'x' }] }),
      schemaOf({ enum: [{ a: 1, description: 'y' }] }),
    ),
    ['openapi: #/components/schemas/A/enum/0/description: "x" → "y"'],
  );
  assert.deepEqual(
    diff(api({}, {}, { security: [{ session: [] }] }), api({}, {}, { security: [{ bearer: [] }] })),
    ['openapi: #/security/0/bearer: (absent) → []', 'openapi: #/security/0/session: [] → (absent)'],
  );
  // `__proto__` is a property like any other.
  const proto = (props) =>
    parseJson(`{"components":{"schemas":{"A":{"type":"object","properties":{${props}}}}}}`);
  assert.deepEqual(diff(proto(''), proto('"__proto__":{"type":"string"}')), [
    'openapi: #/components/schemas/A/properties/__proto__: (absent) → {"type":"string"}',
  ]);
  // Two integers a double cannot tell apart; equal values written differently.
  const big = (n) => parseJson(`{"components":{"schemas":{"A":{"maximum":${n}}}}}`);
  assert.deepEqual(diff(big('9007199254740992'), big('9007199254740993')), [
    'openapi: #/components/schemas/A/maximum: 9007199254740992 → 9007199254740993',
  ]);
  assert.deepEqual(diff(big('100'), big('1e2')), []);
  // A newline in a property name stays on one line.
  const lines = diff(schemaOf({ properties: {} }), schemaOf({ properties: { 'a\nb': S } }));
  assert.deepEqual(lines, [
    'openapi: #/components/schemas/A/properties/a\\nb: (absent) → {"type":"string"}',
  ]);
  assert.ok(!lines[0].includes('\n'));
});

test('pairs: absent, null, false, kinds, arrays, parameter order', () => {
  const v = (value) => schemaOf(value === undefined ? {} : { default: value });
  assert.deepEqual(diff(v(undefined), v(null)), [
    'openapi: #/components/schemas/A/default: (absent) → null',
  ]);
  assert.deepEqual(diff(v(false), v(undefined)), [
    'openapi: #/components/schemas/A/default: false → (absent)',
  ]);
  assert.deepEqual(diff(v({}), v([])), ['openapi: #/components/schemas/A/default: {} → []']);
  assert.deepEqual(diff(v([]), v(0)), ['openapi: #/components/schemas/A/default: [] → 0']);
  assert.deepEqual(diff(v([1, 2]), v([1])), [
    'openapi: #/components/schemas/A/default/1: 2 → (absent)',
  ]);
  const params = (...names) =>
    api({
      '/a': { get: { parameters: names.map((name) => ({ in: 'query', name })), responses: {} } },
    });
  assert.deepEqual(diff(params('a', 'b'), params('b', 'a')), [
    'openapi: #/paths/~1a/get/parameters/0/name: "a" → "b"',
    'openapi: #/paths/~1a/get/parameters/1/name: "b" → "a"',
  ]);
  // required, type and enum are sets; oneOf branches are not.
  assert.deepEqual(
    diff(
      schemaOf({ required: ['a', 'b'], type: ['null', 'object'], enum: ['x', 'y'] }),
      schemaOf({ required: ['b', 'a'], type: ['object', 'null'], enum: ['y', 'x'] }),
    ),
    [],
  );
  assert.deepEqual(
    diff(
      schemaOf({ oneOf: [S, { type: 'number' }] }),
      schemaOf({ oneOf: [{ type: 'number' }, S] }),
    ),
    [
      'openapi: #/components/schemas/A/oneOf/0/type: "string" → "number"',
      'openapi: #/components/schemas/A/oneOf/1/type: "number" → "string"',
    ],
  );
});

test('annotations are ignored only where they are annotations', () => {
  const doc = (n) => ({
    openapi: '3.1.0',
    info: { title: `t${n}` },
    tags: [{ name: `t${n}` }],
    externalDocs: { url: `u${n}` },
    paths: {
      '/a': {
        summary: `s${n}`,
        description: `d${n}`,
        get: {
          summary: `s${n}`,
          description: `d${n}`,
          tags: [`t${n}`],
          parameters: [
            {
              in: 'query',
              name: 'q',
              description: `d${n}`,
              example: n,
              examples: { e: n },
              schema: S,
            },
          ],
          requestBody: {
            description: `d${n}`,
            content: { 'text/plain': { example: n, examples: {}, schema: S } },
          },
          responses: {
            200: {
              description: `d${n}`,
              headers: { H: { description: `d${n}`, example: n, schema: S } },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/A', description: `d${n}` },
                },
              },
            },
            404: { $ref: '#/components/responses/R', description: `d${n}`, summary: `s${n}` },
          },
        },
      },
    },
    components: {
      schemas: {
        A: {
          type: 'object',
          title: `t${n}`,
          description: `d${n}`,
          example: n,
          examples: [n],
          properties: { b: { ...S, description: `d${n}` } },
        },
      },
      responses: { R: { description: `d${n}` } },
    },
  });
  assert.deepEqual(diff(doc(1), doc(2)), []);
  // The same names as properties, parameters or media data are compared.
  const props = (n) =>
    schemaOf({
      type: 'object',
      properties: Object.fromEntries(
        ['description', 'title', 'example', 'examples', 'summary', 'tags'].map((k) => [
          k,
          { maxLength: n },
        ]),
      ),
    });
  assert.equal(diff(props(1), props(2)).length, 6);
  const enc = (n) =>
    api({
      '/a': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': { encoding: { f: { contentType: `x/${n}` } }, schema: S },
            },
          },
          responses: {},
        },
      },
    });
  assert.deepEqual(diff(enc(1), enc(2)), [
    'openapi: #/paths/~1a/post/requestBody/content/multipart~1form-data/encoding/f/contentType: "x/1" → "x/2"',
  ]);
});

test('the review cases on the white-list each give a line', () => {
  // A new status, a request property, an inline parameter next to an inherited $ref one, an enum value.
  assert.deepEqual(
    diff(api({ '/a': get() }), api({ '/a': { get: { responses: { 200: answer(S), 409: ok } } } })),
    ['openapi: #/paths/~1a/get/responses/409: (absent) → {}'],
  );
  assert.deepEqual(diff(schemaOf({ properties: {} }), schemaOf({ properties: { x: S } })), [
    'openapi: #/components/schemas/A/properties/x: (absent) → {"type":"string"}',
  ]);
  const inherited = (parameters) =>
    api({
      '/a': {
        parameters: [{ $ref: '#/components/parameters/Q' }],
        get: { ...(parameters && { parameters }), responses: {} },
      },
    });
  assert.deepEqual(diff(inherited(), inherited([{ in: 'query', name: 'q', required: true }])), [
    'openapi: #/paths/~1a/get/parameters: (absent) → [{"in":"query","name":"q","required":true}]',
  ]);
  assert.deepEqual(diff(schemaOf({ enum: ['a'] }), schemaOf({ enum: ['a', 'b'] })), [
    'openapi: #/components/schemas/A/enum/1: (absent) → "b"',
  ]);
});

test('a long value is previewed with its full sha256, so an accepted line covers one change', () => {
  const big = (last) =>
    schemaOf({
      properties: {
        x: { enum: [...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => c.repeat(5)), last] },
      },
    });
  const base = schemaOf({ properties: {} });
  const [accepted] = diff(base, big('z1'));
  assert.match(accepted, /…#[0-9a-f]{64}$/);
  const [changed] = diff(base, big('z2'));
  assert.notEqual(changed, accepted);
  assert.equal(accepted.slice(0, 150), changed.slice(0, 150));
  assert.deepEqual(judge([changed], [accepted], 'openapi: ').open, [changed]);
  assert.equal(shown(undefined), '(absent)');
});

test('references: only $ref positions, local RFC 6901 pointers, own properties', () => {
  const doc = api(
    {
      '/a': get({ $ref: '#/components/schemas/toString' }),
      '/b': get({ $ref: '#/components/schemas/A%20B' }),
      '/c': get({ $ref: '#/components/schemas/x~1y' }),
      '/d': get({ $ref: '#/components/schemas/E/enum/length' }),
      '/e': get({ $ref: '#/components/schemas/E/enum/0' }),
      '/f': get({ $ref: '#/components/schemas/x~2y' }),
      '/g': get({ $ref: '#anchor' }),
      '/h': get({ const: { $ref: '#/nowhere' }, enum: [{ $ref: '#/nowhere' }] }),
      '/i': get({ $ref: '#/components/schemas/E/enum/01' }),
    },
    { 'A B': S, 'x/y': S, E: { enum: ['a'] } },
  );
  const at = (p) =>
    `openapi: #/paths/~1${p}/get/responses/200/content/application~1json/schema/$ref`;
  assert.deepEqual(danglingRefs(doc), [
    `${at('a')}: $ref "#/components/schemas/toString" does not resolve`,
    `${at('d')}: $ref "#/components/schemas/E/enum/length" does not resolve`,
    `${at('f')}: $ref "#/components/schemas/x~2y" does not resolve`,
    `${at('g')}: $ref "#anchor" is an unsupported reference (only local #/ pointers are checked)`,
    `${at('i')}: $ref "#/components/schemas/E/enum/01" does not resolve`,
  ]);
});

test('accepted lines: exact, and stale once the base has them', () => {
  const min = (n) => schemaOf({ minimum: n });
  const accepted = ['openapi: #/components/schemas/A/minimum: 1 → 2'];
  assert.deepEqual(judge(diff(min(1), min(3)), accepted, 'openapi: ').open, [
    'openapi: #/components/schemas/A/minimum: 1 → 3',
  ]);
  assert.deepEqual(judge(diff(min(1), min(2)), accepted, 'openapi: ').open, []);
  const later = judge(diff(min(2), min(2)), accepted, 'openapi: ');
  assert.deepEqual(later.stale, accepted);
  assert.deepEqual(later.lines, [`STALE     ${accepted[0]}`]);
  // Package lines compare with the parent commit; without a base nothing is stale.
  assert.deepEqual(judge([], ['package: x no longer exports y'], 'openapi: ').stale, []);
  assert.deepEqual(judge([], accepted).stale, []);
});

test('the base release', () => {
  const tags = ['v0.9.0', 'v0.10.0', 'v0.10.1', 'v0.11.0-rc.2', 'v0.2.0'];
  assert.equal(baseTag(tags, 'refs/pull/991/merge'), 'v0.10.1');
  assert.equal(baseTag(tags, 'refs/heads/main'), 'v0.10.1');
  // A stable release tag compares with the stable release before it.
  assert.equal(baseTag([...tags, 'v0.11.0'], 'refs/tags/v0.11.0'), 'v0.10.1');
  assert.equal(baseTag(tags, 'refs/tags/v0.10.1'), 'v0.10.0');
  // A release candidate compares with the highest stable tag, even a newer one.
  assert.equal(
    baseTag(['v0.10.1', 'v0.11.0', 'v0.11.0-rc.2'], 'refs/tags/v0.11.0-rc.2'),
    'v0.11.0',
  );
  // The first release has no base; a branch then compares with it.
  assert.equal(baseTag(['v0.1.0'], 'refs/tags/v0.1.0'), undefined);
  assert.equal(baseTag(['v0.1.0'], 'refs/heads/main'), 'v0.1.0');
  assert.equal(baseTag([], 'refs/heads/main'), undefined);
});

test('reads exported names through re-exports, types and lists', () => {
  const files = {
    'p/index.ts':
      "export * from './a.ts';\nexport * as tokens from './t.ts';\n// export const commented = 1;",
    'p/a.ts':
      'export const one = 1;\nexport type Two = 2;\nexport interface Three {}\nexport {\n  four,\n  five as six,\n  type Seven,\n} from "./b.ts";\nexport async function eight() {}',
  };
  const read = (file) => files[file];
  assert.deepEqual([...exportedNames(read, 'p/index.ts')].sort(), [
    'Seven',
    'Three',
    'Two',
    'eight',
    'four',
    'one',
    'six',
    'tokens',
  ]);
});

test('a package that drops a name breaks, one that adds a name does not', () => {
  const tree = (index) => (file) =>
    file === 'packages/shared/package.json'
      ? JSON.stringify({ name: '@inkadra/shared', exports: { '.': './src/index.ts' } })
      : file === 'packages/shared/src/index.ts'
        ? index
        : (() => {
            throw new Error(`missing ${file}`);
          })();
  const before = tree('export const a = 1;\nexport const b = 2;');
  const after = tree('export const a = 1;\nexport const c = 3;');
  assert.deepEqual(packageBreaks(before, after), ['package: @inkadra/shared no longer exports b']);
  assert.deepEqual(packageBreaks(before, before), []);
});

test('an extension of the paths or of the responses is data, not a path or a response', () => {
  const doc = (meta, status) => ({
    paths: {
      'x-meta': { description: meta, summary: meta },
      '/a': {
        get: { responses: { 'x-note': { description: status }, 200: { description: 'ok' } } },
      },
    },
  });
  assert.deepEqual(openapiBreaks(doc('a', 'b'), doc('a', 'b')), []);
  assert.deepEqual(openapiBreaks(doc('a', 'b'), doc('c', 'b')), [
    'openapi: #/paths/x-meta/description: "a" → "c"',
    'openapi: #/paths/x-meta/summary: "a" → "c"',
  ]);
  assert.deepEqual(openapiBreaks(doc('a', 'b'), doc('a', 'd')), [
    'openapi: #/paths/~1a/get/responses/x-note/description: "b" → "d"',
  ]);
});
