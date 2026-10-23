import { createElement, listElements, type NewElement } from '@inkadra/canvas-core';
import { boardDocName, roots, UNSORTED } from '@inkadra/doc-schema';
import * as Y from 'yjs';
import type { CollabServer } from './collab.ts';

/**
 * Cards the server adds to a board document on someone's behalf (the clipper, the share
 * sheet). The edit runs where the document is live, so open boards see it at once, and is
 * stored and indexed like an edit from the web app (decision 0014).
 */

/** A paragraph of a note: quoted, plain, or a link whose text is `text`. */
export interface NoteBlock {
  kind: 'quote' | 'paragraph' | 'link';
  text: string;
  href?: string;
}

type CardType = 'note' | 'image' | 'file' | 'link';
export type NewCard = {
  [T in CardType]: { type: T; fields: Omit<NewElement<T>, 'parent'>; body?: NoteBlock[] };
}[CardType];

export interface AddCard {
  boardId: string;
  /** A column of the board; omitted = "Non ordinati". */
  columnId?: string;
  userId: string;
  card: NewCard;
}

export type AddCardResult = { ok: true; elementId: string } | { ok: false; reason: 'column' };

export interface BoardWriter {
  addCard(input: AddCard): Promise<AddCardResult>;
}

/** Transaction origin of edits made by the server. */
export const SERVER_ORIGIN = 'inkadra-server';

/**
 * Adds the card at the bottom of its column, or of "Non ordinati", in one transaction.
 * Pure Yjs: the caller decides where the document lives.
 */
export function placeCard(doc: Y.Doc, input: Omit<AddCard, 'boardId'>): AddCardResult {
  const parent = input.columnId ?? UNSORTED;
  if (input.columnId) {
    const column = listElements(doc).find((e) => e.id === input.columnId);
    if (column?.type !== 'column') return { ok: false, reason: 'column' };
  }
  const { card } = input;
  let elementId = '';
  doc.transact(() => {
    const el = createElement(
      doc,
      card.type,
      { x: 0, y: 0 },
      { ...card.fields, parent } as NewElement,
      { userId: input.userId, origin: SERVER_ORIGIN },
    );
    elementId = el.id;
    const body = roots(doc).elements.get(el.id)?.get('body');
    if (card.body && body instanceof Y.XmlFragment) fillNote(body, card.body);
  }, SERVER_ORIGIN);
  return { ok: true, elementId };
}

/** One ProseMirror paragraph per line, as the note editor (Tiptap) stores them. */
function paragraphs(text: string): Y.XmlElement[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const p = new Y.XmlElement('paragraph');
      if (line) p.insert(0, [new Y.XmlText(line)]);
      return p;
    });
}

function fillNote(fragment: Y.XmlFragment, blocks: NoteBlock[]) {
  const nodes: Y.XmlElement[] = [];
  for (const block of blocks) {
    if (block.kind === 'quote') {
      const quote = new Y.XmlElement('blockquote');
      quote.insert(0, paragraphs(block.text));
      nodes.push(quote);
    } else if (block.kind === 'link') {
      const p = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      // Marks are formatting attributes named after the mark, holding its attributes.
      text.insert(0, block.text, { link: { href: block.href } });
      p.insert(0, [text]);
      nodes.push(p);
    } else {
      nodes.push(...paragraphs(block.text));
    }
  }
  fragment.insert(fragment.length, nodes);
}

/**
 * Writes through a collaboration server in the same process (`all`, `collab`). Disconnecting
 * stores the document and rebuilds its search index straight away.
 */
export function directBoardWriter(collab: CollabServer): BoardWriter {
  return {
    async addCard({ boardId, ...input }) {
      const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
      let result: AddCardResult = { ok: false, reason: 'column' };
      try {
        await connection.transact((doc) => {
          result = placeCard(doc, input);
        });
      } finally {
        await connection.disconnect();
      }
      return result;
    },
  };
}
