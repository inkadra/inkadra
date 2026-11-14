import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportedNames, openapiBreaks, packageBreaks } from './contract-check.mjs';

const doc = (settings, extra = {}) => ({
  paths: {
    '/a': {
      patch: {
        parameters: extra.parameters ?? [],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Update' } } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/View' } } },
          },
        },
      },
    },
    ...extra.paths,
  },
  components: { schemas: { Update: settings, View: extra.view ?? settings } },
});

test('flags what an old client meets, not what it can ignore', () => {
  const before = doc(
    {
      type: 'object',
      properties: { a: { type: 'string', enum: ['x', 'y'] }, b: { type: 'number' } },
    },
    { paths: { '/gone': { get: { responses: {} } } } },
  );
  const after = doc(
    {
      type: 'object',
      properties: { a: { type: 'string', enum: ['x'] }, c: {} },
      required: ['a', 'c'],
    },
    {
      parameters: [{ in: 'query', name: 'q', required: true }],
      view: before.components.schemas.Update,
    },
  );
  assert.deepEqual(openapiBreaks(before, after).sort(), [
    'openapi: GET /gone removed',
    'openapi: PATCH /a new required query parameter q',
    'openapi: Update.a no longer accepts "y"',
    'openapi: Update.a now required',
    'openapi: Update.b removed',
    'openapi: Update.c now required',
  ]);
  // A response gaining a field or a required one breaks nobody.
  const view = { type: 'object', properties: { a: {} } };
  const grown = { type: 'object', properties: { a: {}, b: {} }, required: ['a', 'b'] };
  assert.deepEqual(openapiBreaks(doc(view, { view }), doc(view, { view: grown })), []);
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
