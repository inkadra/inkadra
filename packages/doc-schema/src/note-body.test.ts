// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  appendParagraph,
  fitsContent,
  formatText,
  inlineLength,
  insertBlock,
  insertInline,
  joinBackward,
  NOTE_BODY_CONTENT,
  noteStructureIssues,
  removeNode,
  replaceText,
  setTaskChecked,
  setTextBlock,
  splitBlock,
  taskItemOf,
  toggleList,
} from './note-body.ts';
import { checkNoteBody, NOTE_BODY_SCHEMA } from './strict.ts';

type Spec = string | [string, Record<string, unknown>] | Y.XmlElement;

/** `el('paragraph', {}, 'plain', ['bold text', { bold: {} }], el('mention', …))` */
function el(name: string, attrs: Record<string, unknown>, ...children: Spec[]): Y.XmlElement {
  const node = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v as string);
  node.insert(
    0,
    children.map((c) => {
      if (c instanceof Y.XmlElement) return c;
      const t = new Y.XmlText();
      if (typeof c === 'string') t.insert(0, c);
      else t.insert(0, c[0], c[1]);
      return t;
    }),
  );
  return node;
}
const p = (...c: Spec[]) => el('paragraph', {}, ...c);
const task = (checked: boolean, ...c: Spec[]) => el('taskItem', { checked }, p(...c));
const item = (...c: Spec[]) => el('listItem', {}, p(...c));

function body(...blocks: Y.XmlElement[]): Y.XmlFragment {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('body');
  fragment.insert(0, blocks);
  return fragment;
}
const at = (parent: Y.XmlFragment | Y.XmlElement, ...path: number[]) =>
  path.reduce<unknown>((n, i) => (n as Y.XmlElement).get(i), parent) as Y.XmlElement;
/** XML with the node names as stored (Yjs's own `toString` lower-cases them). */
function show(node: Y.XmlFragment | Y.XmlElement): string {
  return node
    .toArray()
    .map((c) => {
      if (c instanceof Y.XmlText) return c.toString();
      const e = c as Y.XmlElement;
      const attrs = Object.entries(e.getAttributes())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ` ${k}="${v}"`)
        .join('');
      return `<${e.nodeName}${attrs}>${show(e)}</${e.nodeName}>`;
    })
    .join('');
}

function expectValid(fragment: Y.XmlFragment) {
  expect(noteStructureIssues(fragment)).toEqual([]);
  expect(checkNoteBody(fragment)).toEqual([]);
}

describe('the content model of a note body', () => {
  it('covers the nodes the strict check knows, and only those', () => {
    expect(Object.keys(NOTE_BODY_CONTENT).sort()).toEqual(
      [...Object.keys(NOTE_BODY_SCHEMA.nodes), 'doc', 'text'].sort(),
    );
  });

  it('matches content expressions as ProseMirror does for these forms', () => {
    expect(fitsContent('paragraph block*', ['paragraph', 'bulletList', 'noteImage'])).toBe(true);
    expect(fitsContent('paragraph block*', ['heading'])).toBe(false);
    expect(fitsContent('paragraph block*', [])).toBe(false);
    expect(fitsContent('taskItem+', ['taskItem', 'listItem'])).toBe(false);
    expect(fitsContent('inline*', ['text', 'mention', 'hardBreak'])).toBe(true);
    expect(fitsContent('inline*', ['paragraph'])).toBe(false);
    expect(fitsContent('text*', ['text', 'hardBreak'])).toBe(false);
    expect(fitsContent('', [])).toBe(true);
  });

  it('lists what the web editor would delete', () => {
    const fragment = body(
      p('fine'),
      el('taskList', {}, el('taskItem', { checked: false }, el('heading', { level: 1 }, 'x'))),
      el('codeBlock', {}, ['f/2.8', { bold: {} }]),
      el('bulletList', {}),
    );
    expect(noteStructureIssues(fragment)).toEqual([
      { path: [1, 0], node: 'taskItem', reason: 'content' },
      { path: [2, 0], node: 'codeBlock', reason: 'marks' },
      { path: [3], node: 'bulletList', reason: 'content' },
    ]);
    expect(noteStructureIssues(body())).toEqual([]);
  });
});

describe('text', () => {
  it('types into a run with the marks given, the text around untouched', () => {
    const fragment = body(p('Leaves ', ['at 08:55', { bold: {} }]));
    const block = at(fragment, 0);
    replaceText(block, 10, 10, '!', { bold: {} });
    replaceText(block, 0, 0, 'It ');
    expect(show(fragment)).toBe('<paragraph>It Leaves <bold>at !08:55</bold></paragraph>');
    expect(inlineLength(block)).toBe(19);
  });

  it('deletes across a mention, which goes whole', () => {
    const mention = el('mention', { id: 'u1', label: 'Anna' });
    const fragment = body(p('Ask ', mention, ' today'));
    replaceText(at(fragment, 0), 3, 6, '');
    expect(show(fragment)).toBe('<paragraph>Asktoday</paragraph>');
  });

  it('never touches a mark it does not know, around or inside the edit', () => {
    const fragment = body(p(['abcdef', { future: { x: 1 } }]));
    const block = at(fragment, 0);
    replaceText(block, 2, 4, 'Z', { future: { x: 1 } });
    formatText(block, 0, 4, 'bold', {});
    formatText(block, 0, 4, 'code', {});
    const delta = (block.get(0) as Y.XmlText).toDelta();
    expect(delta).toEqual([
      { insert: 'abZe', attributes: { future: { x: 1 }, code: {} } },
      { insert: 'f', attributes: { future: { x: 1 } } },
    ]);
  });

  it('sets and takes away marks; code excludes the others, as in the web editor', () => {
    const fragment = body(p('one two three'));
    const block = at(fragment, 0);
    formatText(block, 0, 7, 'bold', {});
    formatText(block, 4, 7, 'code', {});
    formatText(block, 0, 13, 'italic', {});
    formatText(block, 0, 3, 'bold', null);
    expect(show(fragment)).toBe(
      '<paragraph><italic>one</italic><bold><italic> </italic></bold><code>two</code><italic> three</italic></paragraph>',
    );
  });

  it('inserts a mention and a line break, splitting the run they fall in', () => {
    const fragment = body(p(['Ask today', { italic: {} }]));
    const block = at(fragment, 0);
    insertInline(block, 4, 'mention', { id: 'u1', label: 'Anna' });
    insertInline(block, 5, 'hardBreak');
    expect(show(fragment)).toBe(
      '<paragraph><italic>Ask </italic><mention id="u1" label="Anna"></mention><hardBreak></hardBreak><italic>today</italic></paragraph>',
    );
    expect(insertInline(el('codeBlock', {}), 0, 'hardBreak')).toBe(false);
    expectValid(fragment);
  });
});

describe('blocks', () => {
  it('splits a paragraph and a heading; a heading split at its end goes on as text', () => {
    const fragment = body(el('heading', { level: 2, textAlign: 'center' }, 'Ferry timing'));
    const middle = splitBlock(at(fragment, 0), 5);
    expect(middle.block.nodeName).toBe('heading');
    const end = splitBlock(middle.block, inlineLength(middle.block));
    expect(show(fragment)).toBe(
      '<heading level="2" textAlign="center">Ferry</heading><heading level="2" textAlign="center"> timing</heading><paragraph textAlign="center"></paragraph>',
    );
    expect(end.block).toBe(at(fragment, 2));
    expectValid(fragment);
  });

  it('makes a new unticked task, and an empty last task leaves the list', () => {
    const fragment = body(el('taskList', {}, task(true, 'Radio the harbour')));
    const next = splitBlock(at(fragment, 0, 0, 0), 5);
    expect(show(fragment)).toBe(
      '<taskList><taskItem checked="true"><paragraph>Radio</paragraph></taskItem><taskItem checked="false"><paragraph> the harbour</paragraph></taskItem></taskList>',
    );
    const empty = splitBlock(next.block, inlineLength(next.block));
    const out = splitBlock(empty.block, 0);
    expect(out.block).toBe(at(fragment, 1));
    expect(fragment.length).toBe(2);
    expectValid(fragment);
  });

  it('splits a list around an empty item that leaves it', () => {
    const fragment = body(el('bulletList', {}, item('a'), item(''), item('c')));
    splitBlock(at(fragment, 0, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph></listItem></bulletList><paragraph></paragraph><bulletList><listItem><paragraph>c</paragraph></listItem></bulletList>',
    );
    expectValid(fragment);
  });

  it('adds a new line in code, and an empty line leaves a quote', () => {
    const fragment = body(el('codeBlock', {}, 'roll()'), el('blockquote', {}, p('said'), p('')));
    expect(splitBlock(at(fragment, 0), 4).offset).toBe(5);
    splitBlock(at(fragment, 1, 1), 0);
    expect(show(fragment)).toBe(
      '<codeBlock>roll\n()</codeBlock><blockquote><paragraph>said</paragraph></blockquote><paragraph></paragraph>',
    );
    expectValid(fragment);
  });

  it('joins backward into the text before, into lists, and lifts a first item', () => {
    const fragment = body(
      p(['one', { bold: {} }]),
      p('two'),
      el('taskList', {}, task(false, 'a'), task(true, 'b')),
      p('three'),
    );
    expect(joinBackward(at(fragment, 1))).toEqual({ block: at(fragment, 0), offset: 3 });
    // One text node, as the web's editor keeps a block (y-tiptap would rewrite two).
    expect(at(fragment, 0).length).toBe(1);
    expect((at(fragment, 0).get(0) as Y.XmlText).toDelta()).toEqual([
      { insert: 'one', attributes: { bold: {} } },
      { insert: 'two' },
    ]);
    const intoList = joinBackward(at(fragment, 2));
    expect(intoList?.offset).toBe(1);
    const intoItem = joinBackward(at(fragment, 1, 1, 0));
    expect(intoItem?.offset).toBe(1);
    expect(show(fragment)).toBe(
      '<paragraph><bold>one</bold>two</paragraph><taskList><taskItem checked="false"><paragraph>abthree</paragraph></taskItem></taskList>',
    );
    joinBackward(at(fragment, 1, 0, 0));
    expect(show(fragment)).toBe(
      '<paragraph><bold>one</bold>two</paragraph><paragraph>abthree</paragraph>',
    );
    expect(joinBackward(at(fragment, 0))).toBeNull();
    expectValid(fragment);
  });

  it('does not join over a picture or into code', () => {
    const fragment = body(
      el('noteImage', { assetId: 'a1' }),
      p('x'),
      el('codeBlock', {}, 'c'),
      p('y'),
    );
    expect(joinBackward(at(fragment, 1))).toBeNull();
    expect(joinBackward(at(fragment, 3))).toBeNull();
    replaceText(at(fragment, 3), 0, 1, '');
    expect(joinBackward(at(fragment, 3))).toEqual({ block: at(fragment, 2), offset: 1 });
    expectValid(fragment);
  });

  it('turns text into a heading and back, never first in an item', () => {
    const fragment = body(p(['Ferry', { italic: {} }]), el('bulletList', {}, item('a')));
    const heading = setTextBlock(at(fragment, 0), 'heading', 2, 3);
    expect(heading?.offset).toBe(3);
    expect(show(fragment).startsWith('<heading level="2"><italic>Ferry</italic></heading>')).toBe(
      true,
    );
    setTextBlock(at(fragment, 0), 'heading', 1);
    expect(at(fragment, 0).getAttribute('level')).toBe(1);
    expect(setTextBlock(at(fragment, 1, 0, 0), 'heading')).toBeNull();
    setTextBlock(at(fragment, 0), 'paragraph');
    expect(at(fragment, 0).nodeName).toBe('paragraph');
    expectValid(fragment);
  });

  it('wraps text in a list, joins the list before, takes an item out and converts a list', () => {
    const fragment = body(el('taskList', {}, task(true, 'a')), el('heading', { level: 1 }, 'b'));
    toggleList(at(fragment, 1), 'taskList');
    expect(show(fragment)).toBe(
      '<taskList><taskItem checked="true"><paragraph>a</paragraph></taskItem><taskItem checked="false"><paragraph>b</paragraph></taskItem></taskList>',
    );
    const bullets = toggleList(at(fragment, 0, 1, 0), 'bulletList', 1);
    expect(bullets?.offset).toBe(1);
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph></listItem><listItem><paragraph>b</paragraph></listItem></bulletList>',
    );
    const out = toggleList(at(fragment, 0, 0, 0), 'bulletList');
    expect(out?.block).toBe(at(fragment, 0));
    expect(toggleList(el('codeBlock', {}), 'taskList')).toBeNull();
    expectValid(fragment);
  });

  it('ticks a task', () => {
    const fragment = body(el('taskList', {}, task(false, 'a')));
    const taskItem = taskItemOf(at(fragment, 0, 0, 0));
    expect(taskItem).toBe(at(fragment, 0, 0));
    setTaskChecked(taskItem as Y.XmlElement, true);
    expect(at(fragment, 0, 0).getAttribute('checked')).toBe(true);
    expect(taskItemOf(at(fragment, 0, 0))).toBeNull();
  });

  it('inserts a picture in place of an empty paragraph, with text after it', () => {
    const fragment = body(p('a'), p(''));
    const caret = insertBlock(fragment, at(fragment, 1), 'noteImage', { assetId: 'a1' });
    expect(show(fragment)).toBe(
      '<paragraph>a</paragraph><noteImage assetId="a1"></noteImage><paragraph></paragraph>',
    );
    expect(caret.block).toBe(at(fragment, 2));
    insertBlock(fragment, at(fragment, 0), 'horizontalRule');
    expect(at(fragment, 1).nodeName).toBe('horizontalRule');
    expectValid(fragment);
  });

  it('removes a block and the containers it empties', () => {
    const fragment = body(
      el('bulletList', {}, el('listItem', {}, p('a'), el('noteImage', { assetId: 'x' }))),
      el('taskList', {}, task(false, '')),
    );
    removeNode(at(fragment, 1, 0, 0));
    removeNode(at(fragment, 0, 0, 0));
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph></paragraph><noteImage assetId="x"></noteImage></listItem></bulletList>',
    );
    expectValid(fragment);
  });

  it('gives an empty note its first paragraph, once', () => {
    const fragment = body();
    const first = appendParagraph(fragment);
    expect(appendParagraph(fragment).block).toBe(first.block);
    expect(fragment.length).toBe(1);
    expectValid(fragment);
  });
});

/** The body as another client receives it: the same, and no character turned into U+FFFD. */
function expectSameElsewhere(fragment: Y.XmlFragment) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(fragment.doc as Y.Doc));
  const there = show(copy.getXmlFragment('body'));
  expect(there).toBe(show(fragment));
  expect(there).not.toContain('\uFFFD');
}
const textOf = (block: Y.XmlElement) =>
  block
    .toArray()
    .map((c) => (c instanceof Y.XmlText ? c.toString() : `[${(c as Y.XmlElement).nodeName}]`))
    .join('');

describe('whole characters (two UTF-16 units: emoji)', () => {
  it('replaces 👍 with 👎 when the edit was worked out unit by unit', () => {
    const fragment = body(p('ok 👍'));
    // A common-prefix diff of "ok 👍" and "ok 👎" replaces only the second unit.
    replaceText(at(fragment, 0), 4, 5, '\uDC4E');
    expect(textOf(at(fragment, 0))).toBe('ok 👎');
    expectSameElsewhere(fragment);
  });

  it('deletes an emoji whole, types before it, formats it whole, never half', () => {
    const fragment = body(p('ok 👍 go'));
    const block = at(fragment, 0);
    replaceText(block, 4, 4, 'x');
    expect(textOf(block)).toBe('ok x👍 go');
    formatText(block, 0, 5, 'bold', {});
    expect(show(fragment)).toBe('<paragraph><bold>ok x👍</bold> go</paragraph>');
    replaceText(block, 5, 6, '');
    expect(textOf(block)).toBe('<bold>ok x</bold> go');
    expectSameElsewhere(fragment);
  });

  it('splits and joins at an emoji without cutting it', () => {
    const fragment = body(p(['ok 👍', { italic: {} }], ' go'));
    const tail = splitBlock(at(fragment, 0), 4).block;
    expect(textOf(at(fragment, 0))).toBe('<italic>ok </italic>');
    expect(textOf(tail)).toBe('<italic>👍</italic> go');
    expectSameElsewhere(fragment);
    expect(joinBackward(tail)).toEqual({ block: at(fragment, 0), offset: 3 });
    expect(at(fragment, 0).length).toBe(1);
    expect(textOf(at(fragment, 0))).toBe('<italic>ok 👍</italic> go');
    expectSameElsewhere(fragment);
  });

  it('puts a mention before an emoji, not inside it', () => {
    const fragment = body(p('hi 👋'));
    insertInline(at(fragment, 0), 4, 'mention', { id: 'u1', label: 'Anna' });
    expect(textOf(at(fragment, 0))).toBe('hi [mention]👋');
    expectSameElsewhere(fragment);
  });

  it('keeps a ZWJ sequence readable wherever it is split and joined', () => {
    const word = '👩‍💻 dev';
    for (let i = 0; i <= word.length; i++) {
      const fragment = body(p(word));
      const tail = splitBlock(at(fragment, 0), i).block;
      expectSameElsewhere(fragment);
      joinBackward(tail);
      expect(textOf(at(fragment, 0))).toBe(word);
      expectSameElsewhere(fragment);
    }
  });
});

describe('whole characters in code and attributes', () => {
  it('Enter inside an emoji in code puts the new line before it and the caret after the new line', () => {
    const fragment = body(el('codeBlock', {}, 'go 👍'));
    const caret = splitBlock(at(fragment, 0), 4);
    expect(textOf(at(fragment, 0))).toBe('go \n👍');
    expect(caret).toEqual({ block: at(fragment, 0), offset: 4 });
    expectSameElsewhere(fragment);
  });

  it('keeps a mention label and a picture alt on whole characters, cut to their longest', () => {
    const fragment = body(p('hi'));
    insertInline(at(fragment, 0), 2, 'mention', {
      id: 'u1',
      label: `A\uD83D${'é'.repeat(198)}👍👍`,
    });
    const label = String(at(fragment, 0, 1).getAttribute('label'));
    expect(label).toBe(`A${'é'.repeat(198)}👍`.slice(0, 199));
    expect(label.length).toBeLessThanOrEqual(200);
    insertBlock(fragment, at(fragment, 0), 'noteImage', {
      assetId: 'a1',
      alt: `${'x'.repeat(499)}👍`,
    });
    expect(at(fragment, 1).getAttribute('alt')).toBe('x'.repeat(499));
    expectSameElsewhere(fragment);
    expectValid(fragment);
  });

  it('never cuts or changes an id: one that does not fit its schema refuses the insert, nothing changed', () => {
    const fragment = body(p('hi'));
    const before = show(fragment);
    for (const id of ['u'.repeat(65), 'u\uD83D', ''])
      expect(() => insertInline(at(fragment, 0), 2, 'mention', { id, label: 'Ana' })).toThrow(
        RangeError,
      );
    expect(() =>
      insertBlock(fragment, at(fragment, 0), 'noteImage', { assetId: 'a'.repeat(65) }),
    ).toThrow(RangeError);
    expect(show(fragment)).toBe(before);
    // At its longest it is kept exactly.
    insertInline(at(fragment, 0), 2, 'mention', { id: 'u'.repeat(64), label: 'Ana' });
    expect(at(fragment, 0, 1).getAttribute('id')).toBe('u'.repeat(64));
    expectValid(fragment);
  });

  it('a mention or a picture without its id refuses the insert, nothing changed', () => {
    const fragment = body(p('hi'));
    const before = show(fragment);
    expect(() => insertInline(at(fragment, 0), 2, 'mention', { label: 'x' })).toThrow(RangeError);
    expect(() => insertInline(at(fragment, 0), 2, 'mention', { id: null, label: 'x' })).toThrow(
      RangeError,
    );
    expect(() => insertBlock(fragment, at(fragment, 0), 'noteImage', { assetId: null })).toThrow(
      RangeError,
    );
    expect(() => insertBlock(fragment, at(fragment, 0), 'noteImage', {})).toThrow(RangeError);
    expect(show(fragment)).toBe(before);
    // A mention whose label is null goes in without one.
    insertInline(at(fragment, 0), 2, 'mention', { id: 'u1', label: null });
    expect(at(fragment, 0, 1).getAttributes()).toEqual({ id: 'u1' });
  });

  it('a picture whose alt is null (an untyped caller) goes in without one', () => {
    const fragment = body(p(''));
    insertBlock(fragment, at(fragment, 0), 'noteImage', { assetId: 'a1', alt: null });
    expect(at(fragment, 0).getAttributes()).toEqual({ assetId: 'a1' });
    expectValid(fragment);
  });
});

describe('marks', () => {
  it('stores code alone, as formatText: other known marks go, unknown ones stay', () => {
    const fragment = body(p('a'));
    const block = at(fragment, 0);
    replaceText(block, 1, 1, 'b', { code: {}, bold: {}, future: { x: 1 } });
    expect((block.get(0) as Y.XmlText).toDelta()).toEqual([
      { insert: 'a' },
      { insert: 'b', attributes: { code: {}, future: { x: 1 } } },
    ]);
  });

  it('keeps the marks of a task item through a split and a join', () => {
    const fragment = body(el('taskList', {}, task(true, ['Radio', { bold: {} }], ' the harbour')));
    const second = splitBlock(at(fragment, 0, 0, 0), 3).block;
    expect(textOf(at(fragment, 0, 0, 0))).toBe('<bold>Rad</bold>');
    expect(textOf(second)).toBe('<bold>io</bold> the harbour');
    joinBackward(second);
    expect(at(fragment, 0).length).toBe(1);
    expect(at(fragment, 0, 0, 0).length).toBe(1);
    expect(textOf(at(fragment, 0, 0, 0))).toBe('<bold>Radio</bold> the harbour');
    expectValid(fragment);
  });

  it('splits and joins across a mark it does not know, keeping it', () => {
    const fragment = body(p(['abcdef', { future: { x: 1 } }]));
    const tail = splitBlock(at(fragment, 0), 3).block;
    expect((tail.get(0) as Y.XmlText).toDelta()).toEqual([
      { insert: 'def', attributes: { future: { x: 1 } } },
    ]);
    joinBackward(tail);
    expect((at(fragment, 0).get(0) as Y.XmlText).toDelta()).toEqual([
      { insert: 'abcdef', attributes: { future: { x: 1 } } },
    ]);
  });
});

describe('nested lists', () => {
  const nested = () =>
    body(
      el(
        'bulletList',
        {},
        el('listItem', {}, p('a'), el('bulletList', {}, item('b'), item(''), item('c'))),
      ),
    );

  it('Enter on an empty item in the middle of a nested list: an empty paragraph of the item around it, the list split (Tiptap 3.32)', () => {
    const fragment = nested();
    const caret = splitBlock(at(fragment, 0, 0, 1, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph>' +
        '<bulletList><listItem><paragraph>b</paragraph></listItem></bulletList>' +
        '<paragraph></paragraph>' +
        '<bulletList><listItem><paragraph>c</paragraph></listItem></bulletList></listItem></bulletList>',
    );
    expect(caret.block).toBe(at(fragment, 0, 0, 2));
    expectValid(fragment);
  });

  it('Enter on the empty last item of a nested list lifts it one level', () => {
    const fragment = body(
      el('bulletList', {}, el('listItem', {}, p('a'), el('bulletList', {}, item('b'), item('')))),
    );
    const caret = splitBlock(at(fragment, 0, 0, 1, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph><bulletList><listItem><paragraph>b</paragraph></listItem></bulletList></listItem>' +
        '<listItem><paragraph></paragraph></listItem></bulletList>',
    );
    expect(caret.block).toBe(at(fragment, 0, 1, 0));
    expectValid(fragment);
  });

  it('splits a nested item into a new nested item', () => {
    const fragment = nested();
    const caret = splitBlock(at(fragment, 0, 0, 1, 0, 0), 1);
    expect(at(fragment, 0, 0, 1).length).toBe(4);
    expect(caret.block).toBe(at(fragment, 0, 0, 1, 1, 0));
    expectValid(fragment);
  });

  it('Backspace at a first nested item lifts it; at a later one joins the item before', () => {
    const fragment = nested();
    joinBackward(at(fragment, 0, 0, 1, 2, 0));
    expect(show(at(fragment, 0, 0, 1) as unknown as Y.XmlFragment)).toBe(
      '<listItem><paragraph>b</paragraph></listItem><listItem><paragraph>c</paragraph></listItem>',
    );
    joinBackward(at(fragment, 0, 0, 1, 0, 0));
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph></listItem>' +
        '<listItem><paragraph>b</paragraph><bulletList><listItem><paragraph>c</paragraph></listItem></bulletList></listItem></bulletList>',
    );
    expectValid(fragment);
  });

  it('the list buttons turn a nested list into the other kind; then an item of it leaves the list into the bullet item around it', () => {
    const fragment = nested();
    toggleList(at(fragment, 0, 0, 1, 0, 0), 'taskList');
    expect(at(fragment, 0, 0, 1).nodeName).toBe('taskList');
    expect(at(fragment, 0, 0, 1, 0).getAttribute('checked')).toBe(false);
    // A task list in a bullet item: its item is not lifted into the bullet list as a new item
    // (that is only between items of the same type); its blocks go into the bullet item, where
    // the task was, the task list split around it.
    const caret = toggleList(at(fragment, 0, 0, 1, 0, 0), 'taskList');
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph><paragraph>b</paragraph>' +
        '<taskList><taskItem checked="false"><paragraph></paragraph></taskItem>' +
        '<taskItem checked="false"><paragraph>c</paragraph></taskItem></taskList></listItem></bulletList>',
    );
    expect(caret?.block).toBe(at(fragment, 0, 0, 1));
    expectValid(fragment);
  });
});

describe('lists nested in an item of the other type', () => {
  /** A bullet item holding a task list: `a > [b ✓, '' ✓, c]`, the empty task ticked. */
  const mixed = (...tasks: Y.XmlElement[]) =>
    body(el('bulletList', {}, el('listItem', {}, p('a'), el('taskList', {}, ...tasks))));

  it('Enter on the empty last task: an empty paragraph of the bullet item, after the task list', () => {
    const fragment = mixed(task(true, 'b'), task(true, ''));
    const caret = splitBlock(at(fragment, 0, 0, 1, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph>' +
        '<taskList><taskItem checked="true"><paragraph>b</paragraph></taskItem></taskList>' +
        '<paragraph></paragraph></listItem></bulletList>',
    );
    expect(caret).toEqual({ block: at(fragment, 0, 0, 2), offset: 0 });
    expectValid(fragment);
  });

  it('Enter on an empty task in the middle: an empty paragraph of the bullet item, the task list split', () => {
    const fragment = mixed(task(true, 'b'), task(true, ''), task(false, 'c'));
    const caret = splitBlock(at(fragment, 0, 0, 1, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph>' +
        '<taskList><taskItem checked="true"><paragraph>b</paragraph></taskItem></taskList>' +
        '<paragraph></paragraph>' +
        '<taskList><taskItem checked="false"><paragraph>c</paragraph></taskItem></taskList></listItem></bulletList>',
    );
    expect(caret.block).toBe(at(fragment, 0, 0, 2));
    expectValid(fragment);
  });

  it('Backspace at the first task: its blocks go into the bullet item, never a new bullet item', () => {
    const fragment = mixed(el('taskItem', { checked: true }, p('b'), p('more')), task(false, 'c'));
    const caret = joinBackward(at(fragment, 0, 0, 1, 0, 0));
    expect(show(fragment)).toBe(
      '<bulletList><listItem><paragraph>a</paragraph><paragraph>b</paragraph><paragraph>more</paragraph>' +
        '<taskList><taskItem checked="false"><paragraph>c</paragraph></taskItem></taskList></listItem></bulletList>',
    );
    expect(caret).toEqual({ block: at(fragment, 0, 0, 1), offset: 0 });
    expectValid(fragment);
  });

  it('a bullet list in a task item: Enter on its empty last item stays in the task item', () => {
    const fragment = body(
      el(
        'taskList',
        {},
        el('taskItem', { checked: true }, p('a'), el('bulletList', {}, item('b'), item(''))),
      ),
    );
    const caret = splitBlock(at(fragment, 0, 0, 1, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<taskList><taskItem checked="true"><paragraph>a</paragraph>' +
        '<bulletList><listItem><paragraph>b</paragraph></listItem></bulletList>' +
        '<paragraph></paragraph></taskItem></taskList>',
    );
    expect(caret.block).toBe(at(fragment, 0, 0, 2));
    expectValid(fragment);
  });
});

describe('a ticked task lifted out of a nested task list', () => {
  const ticked = () =>
    body(
      el(
        'taskList',
        {},
        el(
          'taskItem',
          { checked: false },
          p('a'),
          el('taskList', {}, task(true, 'b'), task(true, '')),
        ),
      ),
    );

  it('Enter on the empty last task starts a new task, unticked', () => {
    const fragment = ticked();
    const caret = splitBlock(at(fragment, 0, 0, 1, 1, 0), 0);
    expect(show(fragment)).toBe(
      '<taskList><taskItem checked="false"><paragraph>a</paragraph>' +
        '<taskList><taskItem checked="true"><paragraph>b</paragraph></taskItem></taskList></taskItem>' +
        '<taskItem checked="false"><paragraph></paragraph></taskItem></taskList>',
    );
    expect(caret.block).toBe(at(fragment, 0, 1, 0));
    expectValid(fragment);
  });

  it('Backspace and the list button move the same task: it keeps its tick', () => {
    const backspace = ticked();
    joinBackward(at(backspace, 0, 0, 1, 0, 0));
    expect(at(backspace, 0, 1).getAttribute('checked')).toBe(true);
    expect(textOf(at(backspace, 0, 1, 0))).toBe('b');
    expectValid(backspace);
    const button = ticked();
    toggleList(at(button, 0, 0, 1, 0, 0), 'taskList');
    expect(at(button, 0, 1).getAttribute('checked')).toBe(true);
    expectValid(button);
  });
});

describe('editing together', () => {
  it('keeps both people’s typing in the same paragraph', () => {
    const a = new Y.Doc();
    a.getXmlFragment('body').insert(0, [p('Leaves at 08:55')]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    replaceText(at(a.getXmlFragment('body'), 0), 0, 0, 'Ferry ');
    replaceText(at(b.getXmlFragment('body'), 0), 15, 15, ' sharp', { bold: {} });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(show(a.getXmlFragment('body'))).toBe(
      '<paragraph>Ferry Leaves at 08:55<bold> sharp</bold></paragraph>',
    );
    expect(show(b.getXmlFragment('body'))).toBe(show(a.getXmlFragment('body')));
  });
});
