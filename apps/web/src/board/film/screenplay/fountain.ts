import {
  clean,
  type DialogueLine,
  finishScript,
  HEADING,
  parseHeading,
  type Script,
  type ScriptBlock,
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

/**
 * Reads a Fountain screenplay (fountain.io), also plain-text scripts that follow the usual
 * layout. Lenient where real files are: headings without a blank line after them, indented
 * lines, Windows line endings, stray emphasis marks.
 */
export function parseFountain(source: string): Script {
  const notes: string[] = [];
  const normalised = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
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
    for (; end < lines.length; end++) {
      const line = lines[end] ?? '';
      if (!line.trim()) break;
      const field = /^([^\s:][^:]*):\s*(.*)$/.exec(line);
      if (field && !/^\s/.test(line)) {
        key = (field[1] ?? '').trim().toLowerCase();
        titlePage[key] = inline(field[2] ?? '');
      } else if (key) {
        const value = inline(line);
        titlePage[key] = titlePage[key] ? `${titlePage[key]}\n${value}` : value;
      }
    }
    lines = lines.slice(end);
  }

  const scenes: ScriptScene[] = [];
  const prelude: ScriptBlock[] = [];
  let section: string | undefined;
  let scene: ScriptScene | null = null;
  const push = (block: ScriptBlock) => (scene ? scene.blocks : prelude).push(block);
  const startScene = (heading: string) => {
    // Synopses written just before a heading describe the scene it opens.
    const previous = scene ? scene.blocks : prelude;
    const moved: ScriptBlock[] = [];
    while (previous.at(-1)?.kind === 'synopsis' && (!scene || previous.length > 1))
      moved.unshift(previous.pop() as ScriptBlock);
    scene = { ...parseHeading(heading), blocks: moved, characters: [] };
    if (section) scene.section = section;
    scenes.push(scene);
  };

  for (const paragraph of paragraphs(lines)) {
    const found: string[] = [];
    const rows = paragraph
      .map((l) =>
        l.replace(new RegExp(`${NOTE_MARK}(\\d+)${NOTE_MARK}`, 'g'), (_, i: string) => {
          found.push(notes[Number(i)] ?? '');
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
      action(rows.map((r) => r.replace(/^>\s*|\s*<$/g, '')));
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
    const lines: DialogueLine[] = [];
    for (const row of rows) {
      const text = inline(row.replace(/^~/, ''));
      if (!text) continue;
      const last = lines.at(-1);
      if (/^\(.*\)$/.test(text)) lines.push({ text, parenthetical: true });
      else if (last && !last.parenthetical) last.text = `${last.text} ${text}`;
      else lines.push({ text });
    }
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
    name === name.toLocaleUpperCase() &&
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
      .replace(new RegExp(`${NOTE_MARK}\\d+${NOTE_MARK}`, 'g'), ''),
  );
}

/** Replaces each `open … close` span by `replace(inner)`, scanning once. */
function between(
  text: string,
  open: string,
  close: string,
  replace: (inner: string) => string,
): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    const end = start < 0 ? -1 : text.indexOf(close, start + open.length);
    if (end < 0) return out + text.slice(from);
    out += text.slice(from, start) + replace(text.slice(start + open.length, end));
    from = end + close.length;
  }
}
