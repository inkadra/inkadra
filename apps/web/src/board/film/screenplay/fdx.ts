import {
  clean,
  finishScript,
  parseHeading,
  type Script,
  type ScriptBlock,
  ScriptError,
  type ScriptScene,
  splitCue,
} from './script.ts';

/**
 * Reads a Final Draft file (.fdx, XML). Documents with a DOCTYPE or entity declarations are
 * refused before parsing, so nothing is expanded or fetched; the browser's DOMParser does the
 * rest and never loads external resources for XML.
 */
export function parseFdx(source: string): Script {
  const xml = source.replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ScriptError('unsafe');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length > 0 || root?.nodeName !== 'FinalDraft')
    throw new ScriptError('invalid');

  const scenes: ScriptScene[] = [];
  let scene: ScriptScene | null = null;
  let section: string | undefined;
  const prelude: ScriptBlock[] = [];
  const push = (block: ScriptBlock) => (scene ? scene.blocks : prelude).push(block);
  const content = child(root, 'Content');
  for (const p of content ? paragraphs(content) : []) {
    const type = p.getAttribute('Type') ?? 'Action';
    const text = textOf(p);
    if (type === 'Scene Heading') {
      if (!text) continue;
      const number = p.getAttribute('Number')?.trim();
      scene = { ...parseHeading(text), blocks: [], characters: [] };
      if (number && !scene.number) scene.number = number.slice(0, 12);
      if (section) scene.section = section;
      scenes.push(scene);
      const props = child(p, 'SceneProperties');
      const summary = props && child(props, 'Summary');
      for (const s of summary ? [...summary.getElementsByTagName('Paragraph')] : []) {
        const t = textOf(s);
        if (t) push({ kind: 'synopsis', text: t });
      }
      continue;
    }
    if (!text) continue;
    const last = (scene ? scene.blocks : prelude).at(-1);
    if (type === 'Character') push({ kind: 'dialogue', ...splitCue(text), lines: [] });
    else if (type === 'Dialogue' || type === 'Parenthetical') {
      const line = type === 'Parenthetical' ? { text, parenthetical: true } : { text };
      if (last?.kind === 'dialogue') last.lines.push(line);
      else push({ kind: 'action', text });
    } else if (type === 'Transition') push({ kind: 'transition', text });
    else if (type === 'New Act' || type === 'End of Act' || type === 'Outline 1') section = text;
    else if (type !== 'Cast List') push({ kind: 'action', text });
  }
  if (prelude.some((b) => b.kind === 'action' || b.kind === 'dialogue'))
    scenes.unshift({ heading: '', prelude: true, blocks: prelude, characters: [] });
  return finishScript('fdx', titlePage(root), scenes);
}

/**
 * Final Draft keeps the title page as free paragraphs: the first one is the title, the one
 * after "by" or "written by" the credit and the author.
 */
function titlePage(root: Element): Record<string, string> {
  const page = child(root, 'TitlePage');
  const content = page && child(page, 'Content');
  const texts = (content ? [...content.getElementsByTagName('Paragraph')] : [])
    .map(textOf)
    .filter(Boolean);
  const fields: Record<string, string> = {};
  const [title] = texts;
  if (title) fields.title = title;
  const by = texts.findIndex((t) =>
    /^(?:(?:written|screenplay|scritto|sceneggiatura)\s+)?(?:by|di|da)$/i.test(t),
  );
  const author = by >= 0 ? texts[by + 1] : undefined;
  if (by >= 0 && author) {
    fields.credit = texts[by] ?? '';
    fields.author = author;
  }
  return fields;
}

/** The script's paragraphs in order. Dual dialogue wraps its own in another paragraph. */
function* paragraphs(content: Element): Generator<Element> {
  for (const p of content.children) {
    if (p.nodeName !== 'Paragraph') continue;
    const dual = child(p, 'DualDialogue');
    if (dual) {
      for (const inner of dual.children) if (inner.nodeName === 'Paragraph') yield inner;
    } else yield p;
  }
}

function child(el: Element, name: string): Element | null {
  for (const c of el.children) if (c.nodeName === name) return c;
  return null;
}

/** The paragraph's own text runs, joined: formatting splits a line into several <Text>. */
function textOf(p: Element): string {
  let text = '';
  for (const c of p.children) if (c.nodeName === 'Text') text += c.textContent ?? '';
  return clean(text);
}
