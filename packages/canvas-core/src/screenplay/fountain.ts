// SPDX-License-Identifier: MPL-2.0
import {
  clean,
  type DialogueLine,
  finishScript,
  HEADING,
  MAX_SCRIPT_BYTES,
  MAX_SCRIPT_SCENES,
  parseHeading,
  type Script,
  type ScriptBlock,
  ScriptError,
  type ScriptScene,
  splitCue,
} from './script.ts';

/** Title page keys of the Fountain syntax, and a few found in real files. */
const TITLE_KEYS =
  /^(title|credit|author|authors|written by|source|draft date|date|contact|copyright|notes|revision|episode|format|titolo|autore|autori)\s*:/i;
const TRANSITION =
  /^(?:[^a-z]*\bTO:|FADE (?:IN|OUT)[:.]?|FADE TO BLACK\.?|CUT TO BLACK\.?|DISSOLVENZA[^a-z]*:?|STACCO[^a-z]*:?)$/;
/** Private-use character marking where a note was taken out. */
const NOTE_MARK = '\uE000';
/** A note's mark, with its index; built once, not per line. */
const NOTE = new RegExp(`${NOTE_MARK}(\\d+)${NOTE_MARK}`, 'g');

/**
 * Reads a Fountain screenplay (fountain.io), also plain-text scripts that follow the usual
 * layout. Lenient where real files are: headings without a blank line after them, indented
 * lines, Windows line endings, stray emphasis marks.
 */
export function parseFountain(source: string): Script {
  if (source.length > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
  const notes: string[] = [];
  // The note mark is taken out of the text first: a mark written in the file must not stand
  // for a note, which it would repeat (one note a thousand times, a billion characters).
  const normalised = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replaceAll(NOTE_MARK, '');
  // Boneyard: text the writer left out. Notes may cross lines; a mark keeps their place so
  // they follow their paragraph. Both are found with indexOf, in linear time: an opening mark
  // without its closing one leaves the rest of the text as it is.
  const text = between(
    between(normalised, '/*', '*/', () => ''),
    '[[',
    ']]',
    (note) => {
      notes.push(clean(note.replace(/\n/g, ' ')));
      return `${NOTE_MARK}${notes.length - 1}${NOTE_MARK}`;
    },
  );
  let lines = text.split('\n');
  const titlePage: Record<string, string> = {};
  if (TITLE_KEYS.test(lines.find((l) => l.trim())?.trim() ?? '')) {
    const start = lines.findIndex((l) => l.trim());
    let end = start;
    let key = '';
    // Each field's lines are joined once at the end: appending to a string in a loop copies it
    // each time on engines without ropes (Hermes).
    const fields = new Map<string, string[]>();
    for (; end < lines.length; end++) {
      const line = lines[end] ?? '';
      if (!line.trim()) break;
      const field = /^([^\s:][^:]*):\s*(.*)$/.exec(line);
      if (field && !/^\s/.test(line)) {
        key = (field[1] ?? '').trim().toLowerCase();
        fields.set(key, [inline(field[2] ?? '')]);
      } else if (key) {
        const value = inline(line);
        const parts = fields.get(key) ?? [];
        // An empty field takes the line as its value, without a line break before it.
        if (parts.length === 1 && parts[0] === '') parts[0] = value;
        else parts.push(value);
      }
    }
    for (const [name, parts] of fields) titlePage[name] = parts.join('\n');
    lines = lines.slice(end);
  }

  const scenes: ScriptScene[] = [];
  const prelude: ScriptBlock[] = [];
  let section: string | undefined;
  let scene: ScriptScene | null = null;
  const push = (block: ScriptBlock) => (scene ? scene.blocks : prelude).push(block);
  /** Blocks the current scene took from the one before: they stay, so each moves only once. */
  let own = 0;
  const startScene = (heading: string) => {
    // Synopses written just before a heading describe the scene it opens.
    if (scenes.length >= MAX_SCRIPT_SCENES) throw new ScriptError('tooManyScenes');
    const previous = scene ? scene.blocks : prelude;
    let start = previous.length;
    while (start > Math.max(own, scene ? 1 : 0) && previous[start - 1]?.kind === 'synopsis')
      start--;
    const moved = previous.splice(start);
    own = moved.length;
    scene = { ...parseHeading(heading), blocks: moved, characters: [] };
    if (section) scene.section = section;
    scenes.push(scene);
  };

  for (const paragraph of paragraphs(lines)) {
    const found: string[] = [];
    const rows = paragraph
      .map((l) =>
        l.replace(NOTE, (_, i: string) => {
          // Each note is read once, whatever the text holds.
          found.push(notes[Number(i)] ?? '');
          notes[Number(i)] = '';
          return '';
        }),
      )
      .map((l) => l.trim())
      .filter(Boolean);
    const first = rows[0];
    if (first !== undefined) classify(rows, first);
    for (const note of found) if (note) push({ kind: 'note', text: note });
  }

  function classify(rows: string[], first: string) {
    if (/^\.[^.]/.test(first)) {
      startScene(first.slice(1));
      action(rows.slice(1));
    } else if (HEADING.test(first) && (first === first.toUpperCase() || rows.length === 1)) {
      startScene(first);
      action(rows.slice(1));
    } else if (first.startsWith('#')) {
      section = inline(first.replace(/^#+/, '')) || undefined;
      action(rows.slice(1));
    } else if (/^=(?!==)/.test(first)) {
      for (const row of rows) push({ kind: 'synopsis', text: inline(row.replace(/^=+/, '')) });
    } else if (/^={3,}$/.test(first)) {
      action(rows.slice(1));
    } else if (first.startsWith('>') && first.endsWith('<')) {
      // Sliced, not a regex: `\s*<$` backtracked quadratically on a long run of spaces.
      action(
        rows.map((r) => {
          const text = r.startsWith('>') ? r.slice(1).trimStart() : r;
          return text.endsWith('<') ? text.slice(0, -1).trimEnd() : text;
        }),
      );
    } else if (first.startsWith('>') || (rows.length === 1 && TRANSITION.test(first))) {
      push({ kind: 'transition', text: inline(first.replace(/^>/, '')) });
      action(rows.slice(1));
    } else if (first.startsWith('!')) {
      action([first.slice(1), ...rows.slice(1)]);
    } else if (first.startsWith('@') || (rows.length > 1 && isCue(first))) {
      dialogue(first.replace(/^@/, ''), rows.slice(1));
    } else {
      action(rows);
    }
  }

  function action(rows: string[]) {
    const body = rows
      .filter((r) => !/^={3,}$/.test(r))
      .map((r) => inline(r.replace(/^[!~]/, '')))
      .filter(Boolean)
      .join('\n');
    if (body) push({ kind: 'action', text: body });
  }

  function dialogue(cue: string, rows: string[]) {
    // Rows of one spoken line are joined once, not appended to a string row by row.
    const parts: Array<{ text: string[]; parenthetical?: boolean }> = [];
    for (const row of rows) {
      const text = inline(row.replace(/^~/, ''));
      if (!text) continue;
      const last = parts.at(-1);
      if (/^\(.*\)$/.test(text)) parts.push({ text: [text], parenthetical: true });
      else if (last && !last.parenthetical) last.text.push(text);
      else parts.push({ text: [text] });
    }
    const lines = parts.map(
      (p): DialogueLine =>
        p.parenthetical
          ? { text: p.text.join(' '), parenthetical: true }
          : { text: p.text.join(' ') },
    );
    push({ kind: 'dialogue', ...splitCue(inline(cue)), lines });
  }

  // Action or dialogue before the first heading (a cold open, a script without headings) is
  // a scene of its own, without a heading, that the person can leave out.
  if (prelude.some((b) => b.kind === 'action' || b.kind === 'dialogue'))
    scenes.unshift({ heading: '', prelude: true, blocks: prelude, characters: [] });
  return finishScript('fountain', titlePage, scenes);
}

/** Groups lines between blank lines. A heading line also ends the paragraph above it. */
function* paragraphs(lines: string[]): Generator<string[]> {
  let current: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length) yield current;
      current = [];
      continue;
    }
    if (current.length && HEADING.test(trimmed) && trimmed === trimmed.toUpperCase()) {
      yield current;
      current = [];
    }
    current.push(line);
  }
  if (current.length) yield current;
}

/** A character cue: capitals (an extension in brackets may be lower case), not a transition. */
function isCue(line: string): boolean {
  if (line.length > 80) return false;
  const name = splitCue(line).character;
  return (
    name.length > 0 &&
    name.length <= 60 &&
    /\p{L}/u.test(name) &&
    name === name.toUpperCase() &&
    !/[:!?]$/.test(name) &&
    !TRANSITION.test(name)
  );
}

/** Emphasis and escapes removed: *italic*, **bold**, _underline_, \*. */
function inline(text: string): string {
  return clean(
    text
      .replace(/(\*{1,3})(?=\S)([^*\n]*?\S)\1/g, '$2')
      // Underline only between word boundaries: snake_case_names and URLs keep theirs.
      .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
      .replace(/\\([*_\\])/g, '$1')
      .replace(NOTE, ''),
  );
}

/** Replaces each `open … close` span by `replace(inner)`, scanning once. */
function between(
  text: string,
  open: string,
  close: string,
  replace: (inner: string) => string,
): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    const end = start < 0 ? -1 : text.indexOf(close, start + open.length);
    if (end < 0) {
      out.push(text.slice(from));
      return out.join('');
    }
    out.push(text.slice(from, start), replace(text.slice(start + open.length, end)));
    from = end + close.length;
  }
}
