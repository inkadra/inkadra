import { randomUUID } from 'node:crypto';
import { Board, Project, page, SearchResult } from '@inkadra/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { admitToken, registerScopeNarrowing } from './token-scope.ts';

const at = '2026-11-22T10:00:00.000Z';
const id = randomUUID();
const extra = { addedLater: 'not for the Clipper' };
const project = {
  id,
  name: 'Spot',
  icon: { shape: 'circle', color: 'blue', emoji: null, ...extra },
  rootBoardId: id,
  position: 'a0',
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
  myRole: 'editor',
  pinned: true,
  ...extra,
};
const board = {
  id,
  projectId: id,
  parentBoardId: null,
  kind: 'board',
  title: 'Refs',
  position: 'a0',
  coverAssetId: null,
  docSchemaVersion: 1,
  createdAt: at,
  updatedAt: at,
  myRole: 'owner',
  ...extra,
};
const hit = {
  kind: 'board',
  projectId: id,
  projectName: 'Spot',
  boardId: id,
  boardTitle: 'Refs',
  boardKind: 'board',
  elementId: null,
  elementType: null,
  title: 'Refs',
  snippet: null,
  assetId: null,
  tags: [],
  myRole: 'owner',
  ...extra,
};

describe('narrowed answers for a clip token (decision 0137)', () => {
  it('keeps only the listed fields, of the items and of the envelope', async () => {
    const app = Fastify();
    registerScopeNarrowing(app);
    const answer = (items: unknown[]) => async (req: Parameters<typeof admitToken>[0]) => {
      admitToken(req, 'clip', id);
      return { items, nextCursor: null, ...extra };
    };
    app.get('/api/v1/projects', answer([project]));
    app.get('/api/v1/projects/:projectId/boards', answer([board]));
    app.get('/api/v1/shared-boards', answer([board]));
    app.get('/api/v1/search', answer([hit]));
    for (const [url, schema] of [
      ['/api/v1/projects', page(Project)],
      [`/api/v1/projects/${id}/boards`, page(Board)],
      ['/api/v1/shared-boards', page(Board)],
      ['/api/v1/search', SearchResult],
    ] as const) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toContain('addedLater');
      expect(res.json().items, url).toHaveLength(1);
      schema.parse(res.json());
    }
    await app.close();
  });
});
