// SPDX-License-Identifier: MPL-2.0
import { zodToOpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { describe, expect, it } from 'vitest';
import { z } from './common.ts';
import * as shared from './index.ts';
import { buildOpenApiDocument } from './openapi.ts';

type Schema = Record<string, unknown> & {
  $ref?: string;
  type?: string | string[];
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: boolean | Schema;
};

const doc = buildOpenApiDocument() as unknown as {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, Schema> };
};
const components = doc.components.schemas;
const resolve = (s: Schema): Schema =>
  s.$ref ? resolve(components[s.$ref.split('/').at(-1) as string] as Schema) : s;
/** Whether a JSON Schema value admits null, read the way a validator does. */
const acceptsNull = (s: Schema): boolean => {
  if (s.$ref) return acceptsNull(resolve(s));
  if (s.allOf) return s.allOf.every(acceptsNull);
  const union = s.anyOf ?? s.oneOf;
  if (union) return union.some(acceptsNull);
  return s.type === undefined || [s.type].flat().includes('null');
};
const properties = (s: Schema): Record<string, Schema> =>
  s.$ref
    ? properties(resolve(s))
    : Object.assign({}, s.properties, ...(s.allOf ?? []).map(properties));
const at = (name: string, key: string) => properties(components[name] as Schema)[key] as Schema;

// Every named Zod schema, by its OpenAPI name.
const named = new Map<string, z.ZodType>();
for (const value of Object.values(shared)) {
  if (!(value instanceof z.ZodType)) continue;
  const refId = (zodToOpenAPIRegistry.get(value) as { _internal?: { refId?: string } })?._internal
    ?.refId;
  if (refId && !named.has(refId)) named.set(refId, value);
}

describe('nullable references in the OpenAPI document', () => {
  it('keeps a component non-nullable when only some uses of it are', () => {
    for (const name of ['UserSummary', 'Asset', 'AssetProxy', 'AssetTrack', 'CommentPin']) {
      expect(acceptsNull(components[name] as Schema), name).toBe(false);
    }
    expect(acceptsNull(at('ProjectMember', 'user'))).toBe(false);
    expect(
      acceptsNull(
        at('Author', 'user') ?? (components.Author?.oneOf?.[0]?.properties?.user as Schema),
      ),
    ).toBe(false);
    expect(acceptsNull(at('Comment', 'mentions').items as Schema)).toBe(false);
  });

  it('lets the uses that are nullable accept null', () => {
    for (const [name, key] of [
      ['CrewMember', 'account'],
      ['Invitation', 'invitedBy'],
      ['ShareLink', 'createdBy'],
      ['BoardVersion', 'createdBy'],
      ['Notification', 'actor'],
      ['CommentThread', 'resolvedBy'],
      ['GuestCommentThread', 'resolvedBy'],
    ] as const) {
      const schema = at(name, key);
      expect(acceptsNull(schema), `${name}.${key}`).toBe(true);
      expect(schema.anyOf, `${name}.${key}`).toEqual([
        expect.objectContaining({ $ref: expect.any(String) }),
        { type: 'null' },
      ]);
    }
    const session = doc.paths['/api/auth/get-session']?.get?.responses['200'] as {
      content: { 'application/json': { schema: Schema } };
    };
    expect(acceptsNull(session.content['application/json'].schema)).toBe(true);
  });

  it('admits null exactly where the Zod schema does', () => {
    const mismatches: string[] = [];
    for (const [name, component] of Object.entries(components)) {
      const zod = named.get(name);
      if (!zod) continue;
      const nullable = (s: z.ZodType) => s.safeParse(null).success;
      if (nullable(zod) !== acceptsNull(component)) mismatches.push(name);
      const shape = (zod as unknown as { shape?: Record<string, z.ZodType> }).shape;
      for (const [key, field] of Object.entries(shape ?? {})) {
        const schema = properties(component)[key];
        if (!schema) continue;
        if (nullable(field) !== acceptsNull(schema)) mismatches.push(`${name}.${key}`);
        const inner = field instanceof z.ZodOptional ? field.unwrap() : field;
        if (inner instanceof z.ZodArray && schema.items) {
          if (nullable(inner.element as z.ZodType) !== acceptsNull(schema.items)) {
            mismatches.push(`${name}.${key}[]`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('writes no allOf that a validator reads differently from the Zod schema', () => {
    const found: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const schema = node as Schema;
      // A nullable sibling of a $ref admits no null; a strict half closes out the other half.
      for (const part of schema.allOf ?? []) {
        if (!part.$ref && [part.type].flat().includes('null')) found.push(`${path} null`);
        if (resolve(part).additionalProperties === false) found.push(`${path} strict`);
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${path}/${key}`);
    };
    walk(doc, '');
    expect(found).toEqual([]);
  });
});
