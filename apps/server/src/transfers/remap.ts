import { randomUUID } from 'node:crypto';
import { roots, VideoFrameSource } from '@inkadra/doc-schema';
import type * as Y from 'yjs';

export interface IdMaps {
  boards: ReadonlyMap<string, string>;
  /** Only files that were stored: a card of a skipped file is shown as a missing file. */
  assets: ReadonlyMap<string, string>;
  /** Archive person id to an account here (always the importer); null keeps no author. */
  person(id: string): string | null;
}

const ASSET_FIELDS = ['assetId', 'imageAssetId'] as const;
/** Where a picture is optional (a frame's reference, a link's preview, a portrait), a missing one goes. */
const OPTIONAL_ASSET: Record<string, string> = {
  frame: 'assetId',
  link: 'imageAssetId',
  character: 'assetId',
  location: 'assetId',
};

/**
 * Rewrites the ids a board document refers to (decision 0037). A reference to a file that was
 * not stored (missing, refused or damaged) is removed where the picture is optional; where it
 * is required (image and file cards) it gets a fresh id that matches nothing, so the card
 * stays and shows a missing file. Either way an imported card can never reach a file or board
 * of another project on this server. Element ids stay.
 */
export function remapDoc(doc: Y.Doc, boardId: string, maps: IdMaps): void {
  const { meta, elements } = roots(doc);
  const mapped = (map: ReadonlyMap<string, string>, id: unknown) =>
    (typeof id === 'string' && map.get(id)) || randomUUID();
  doc.transact(() => {
    meta.set('boardId', boardId);
    for (const el of elements.values()) {
      let pictureMissing = false;
      for (const field of ASSET_FIELDS) {
        if (!el.has(field)) continue;
        const to = maps.assets.get(el.get(field) as string);
        if (to) el.set(field, to);
        else if (OPTIONAL_ASSET[el.get('type') as string] === field) {
          el.delete(field);
          if (field === 'assetId') pictureMissing = true;
        } else el.set(field, randomUUID());
      }
      if (el.has('source')) {
        const source = VideoFrameSource.safeParse(el.get('source'));
        if (pictureMissing || !el.has('assetId') || !source.success) el.delete('source');
        else if (source.data.kind === 'uploaded-video') {
          const to = maps.assets.get(source.data.assetId);
          if (to) el.set('source', { ...source.data, assetId: to });
          else el.delete('source');
        } else el.set('source', source.data);
      }
      if (el.get('type') === 'board') el.set('boardId', mapped(maps.boards, el.get('boardId')));
      const by = el.get('createdBy');
      if (typeof by === 'string') el.set('createdBy', maps.person(by));
    }
  });
}

const MENTION = /@\{([0-9a-f-]{36})\}/gi;

/**
 * Mentions `@{id}` become plain `@Name` with the names of the archive: people are never
 * matched to accounts here (decision 0037), so the text reads the same and notifies nobody.
 */
export function remapMentions(body: string, names: ReadonlyMap<string, string>): string {
  return body.replace(MENTION, (_all, id: string) => `@${names.get(id.toLowerCase()) ?? '?'}`);
}
