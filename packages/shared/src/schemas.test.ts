import { describe, expect, it } from 'vitest';
import { ClipRequest, CreateProject } from './index.ts';
import { buildOpenApiDocument } from './openapi.ts';

describe('contracts', () => {
  it('trims project names and rejects empty ones', () => {
    expect(CreateProject.parse({ name: '  Ultima corsa ' }).name).toBe('Ultima corsa');
    expect(CreateProject.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('requires something to clip', () => {
    const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
    expect(ClipRequest.safeParse({ boardId }).success).toBe(false);
    expect(ClipRequest.safeParse({ boardId, text: 'ciao' }).success).toBe(true);
  });

  it('builds an OpenAPI 3.1 document with every path', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths ?? {})).toContain('/api/v1/projects/{projectId}/boards');
  });
});
