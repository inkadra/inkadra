// SPDX-License-Identifier: MPL-2.0
import { roots } from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { createElement, DEFAULT_WIDTH } from './board.ts';
import { addFrame, addScene } from './film.ts';
import type { Point } from './geometry.ts';

/**
 * Starting layouts offered on an empty board. They are plain edits on the document, so they
 * work offline and need nothing from the server; the client passes the translated titles.
 */
export const TEMPLATE_IDS = ['moodboard', 'storyboard', 'production'] as const;
/** Layouts only the project setup seeds (Film pre-production); never offered on a board. */
export const SETUP_TEMPLATE_IDS = ['brief', 'locations', 'casting'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number] | (typeof SETUP_TEMPLATE_IDS)[number];

export interface TemplateLabels {
  moodboard: { refs: string; light: string; locations: string; palette: string };
  storyboard: { scene: string };
  production: { todo: string; doing: string; done: string };
  brief: { column: string; logline: string; synopsis: string; tone: string };
  locations: { column: string; location: string };
  casting: { column: string; role: string };
}

const GAP = 40;
const SWATCHES = ['#1C1C1E', '#6E6E73', '#C7C7CC', '#F2F2F7'];

/** Adds the template with its top-left corner at `at`; returns the ids of the new top cards. */
export function applyTemplate(
  doc: Y.Doc,
  id: TemplateId,
  at: Point,
  labels: TemplateLabels,
  opts: { userId: string | null; origin?: unknown },
): string[] {
  const ids: string[] = [];
  const column = (i: number, title: string) => {
    const col = createElement(
      doc,
      'column',
      { x: at.x + i * (DEFAULT_WIDTH.column + GAP), y: at.y },
      { title },
      opts,
    );
    ids.push(col.id);
    return col.id;
  };
  const addNote = (parent: string, text: string) => {
    const note = createElement(doc, 'note', at, { parent }, opts);
    const body = roots(doc).elements.get(note.id)?.get('body');
    if (body instanceof Y.XmlFragment && text) {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText(text)]);
      body.insert(0, [p]);
    }
    return note.id;
  };
  doc.transact(() => {
    if (id === 'moodboard') {
      const l = labels.moodboard;
      column(0, l.refs);
      column(1, l.light);
      column(2, l.locations);
      const palette = column(3, l.palette);
      for (const hex of SWATCHES) createElement(doc, 'color', at, { hex, parent: palette }, opts);
    } else if (id === 'storyboard') {
      const scene = addScene(doc, { number: '1', title: labels.storyboard.scene }, opts, at);
      ids.push(scene.id);
      for (let i = 0; i < 3; i++) addFrame(doc, scene.id, null, {}, opts);
    } else if (id === 'production') {
      const l = labels.production;
      column(0, l.todo);
      column(1, l.doing);
      column(2, l.done);
    } else if (id === 'brief') {
      const l = labels.brief;
      const col = column(0, l.column);
      addNote(col, l.logline);
      addNote(col, l.synopsis);
      addNote(col, l.tone);
    } else if (id === 'locations') {
      const l = labels.locations;
      const col = column(0, l.column);
      addNote(col, l.location);
    } else if (id === 'casting') {
      const l = labels.casting;
      const col = column(0, l.column);
      addNote(col, l.role);
    }
  }, opts.origin);
  return ids;
}
