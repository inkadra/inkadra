import { updateElement } from '@inkadra/canvas-core';
import type { LinkPreview } from '@inkadra/shared';
import type * as Y from 'yjs';
import { api } from '../lib/api.ts';
import { LOCAL } from './store.ts';

/**
 * Asks the server for the title, description and image of a link and fills in the card.
 * A failure leaves the card as it is: it still shows the address.
 */
export async function fillLinkPreview(
  doc: Y.Doc,
  elementId: string,
  projectId: string,
  url: string,
) {
  let preview: LinkPreview;
  try {
    preview = await api.post<LinkPreview>('/link-previews', { projectId, url });
  } catch {
    return;
  }
  updateElement(
    doc,
    elementId,
    {
      title: preview.title?.slice(0, 500) || undefined,
      description: preview.description?.slice(0, 2000) || undefined,
      imageAssetId: preview.imageAssetId ?? undefined,
    },
    LOCAL,
  );
}
