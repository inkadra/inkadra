import { HEADING, MAX_SCRIPT_BYTES, ScriptError } from './script.ts';

/** A run of text with its position on the page, as pdf.js reports it (origin bottom left). */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  height: number;
}

export interface PdfPage {
  width: number;
  items: PdfItem[];
}

interface Line {
  x: number;
  y: number;
  height: number;
  text: string;
}

/** Page numbers as exporters print them: `2.`, `- 2 -`, `12`. */
const PAGE_NUMBER = /^(?:[-–—]\s*)?\d{1,4}\.?(?:\s*[-–—])?$/;
/** Footers some exporters print on every page, and page-break markers: MORE, CONTINUED. */
const RUNNING =
  /^(?:created (?:using|with|in|by) \S.*|(?:final draft|writerduet|celtx|highland|scrivener|trelby|arc studio|movie magic screenwriter)(?: [\d.]+)?|page \d+(?: of \d+)?|\(?(?:more|continued|cont['’]d)\)?:?(?:\s*\(\d+\))?)$/i;
/** A line that credits the writers on a title page ("Written by", "Scritto da"). */
const CREDIT =
  /^(?:(?:written|story|screenplay|teleplay|created|adapted|a film|scritto|sceneggiatura|soggetto|regia)\b.*\bby|by|di|scritto da|sceneggiatura di)$/i;
const DRAFT = /^(.*\b(?:draft|revision|bozza|stesura)\b.*?)\s*:\s*(.+)$/i;
const CONTACT = /@|\bwww\.|\btel\b|\+?\d[\d\s().-]{7,}/i;
const TITLE_META =
  /\b(?:draft|revision|bozza|stesura|copyright|contact|tel)\b|©|@|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/i;
const TRANSITION_WORD = /\b(?:TO|FADE|DISSOLVE|CUT|SMASH|STACCO|DISSOLVENZA)\b/;
const TERMINAL = /[.!?…:"”»)]$/;

/** `1 EXT. HOUSE - NIGHT` (the number in the margin) → `EXT. HOUSE - NIGHT #1#`. */
function numbered(text: string): string {
  const m = /^(\d+[A-Z]?)\s+(.+)$/.exec(text);
  if (!m?.[2] || !HEADING.test(m[2])) return text;
  const number = m[1] as string;
  // Shooting scripts repeat the number in the right margin: HOUSE - NIGHT 1.
  const body = m[2].endsWith(` ${number}`) ? m[2].slice(0, -number.length - 1).trimEnd() : m[2];
  return `${body} #${number}#`;
}

const isHeading = (text: string) => HEADING.test(numbered(text.trim()).replace(/#[^#\s]+#$/, ''));

/** Items grouped into lines, top to bottom (exporters often write the footer first). */
function linesOf(items: PdfItem[]): Line[] {
  const sorted = items
    .filter((i) => i.str.trim() && !(i.str.includes('___') && /^[\s_]+$/.test(i.str)))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  let row: PdfItem[] = [];
  const flush = () => {
    const first = row[0];
    if (!first) return;
    lines.push({
      x: first.x,
      y: first.y,
      height: Math.abs(first.height) || 12,
      text: row
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    });
    row = [];
  };
  for (const item of sorted) {
    if (row[0] && Math.abs(row[0].y - item.y) >= 2) flush();
    row.push(item);
  }
  flush();
  return lines;
}

const normal = (text: string) => text.replace(/\d+/g, '#').toLowerCase();

/**
 * Running headers and footers are not part of the script: page numbers in a margin, footers
 * some exporters stamp on every page ("Created using Celtx"), MORE / CONTINUED markers and any
 * other line set apart at the top or bottom of at least half of the pages.
 */
function stripRunning(pages: Line[][]): Line[][] {
  const gapTo = (page: Line[], i: number, step: 1 | -1) => {
    const near = page[i + step];
    const line = page[i];
    return near && line ? Math.abs(near.y - line.y) / line.height : Infinity;
  };
  const edges = pages.map((page) => [0, 1, 2, -1, -2, -3].flatMap((k) => (page.at(k) ? [k] : [])));
  const seen = new Map<string, number>();
  pages.forEach((page, p) => {
    const keys = new Set<string>();
    for (const k of edges[p] ?? []) {
      const i = k < 0 ? page.length + k : k;
      const line = page[i];
      if (line && line.text.length <= 60 && gapTo(page, i, k < 0 ? -1 : 1) >= 1.5)
        keys.add(normal(line.text));
    }
    for (const key of keys) seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  const withText = pages.filter((p) => p.length).length;
  const repeated = (text: string) =>
    (seen.get(normal(text)) ?? 0) >= Math.max(2, Math.ceil(withText / 2));
  return pages.map((page) => {
    let lo = 0;
    let hi = page.length - 1;
    const drops = (i: number, step: 1 | -1) => {
      const text = page[i]?.text ?? '';
      return (
        RUNNING.test(text) ||
        (gapTo(page, i, step) >= 1.5 && (PAGE_NUMBER.test(text) || repeated(text)))
      );
    };
    while (lo < Math.min(3, page.length) && lo <= hi && drops(lo, 1)) lo++;
    while (hi >= lo && page.length - 1 - hi < 3 && drops(hi, -1)) hi--;
    return page.slice(lo, hi + 1);
  });
}

/** The title page as Fountain title keys, or null when the first page is not one. */
function titlePageOf(first: Line[] | undefined, later: Line[][]): string | null {
  if (!first?.length || first.length > 20) return null;
  const texts = first.map((l) => l.text);
  const credit = texts.findIndex((t) => CREDIT.test(t));
  const hasMeta = texts.some((t) => TITLE_META.test(t));
  if (credit < 0 && !hasMeta) return null;
  if (texts.some(isHeading) || !later.some((page) => page.some((l) => isHeading(l.text))))
    return null;
  const metaAt = texts.findIndex((t, i) => i > credit && TITLE_META.test(t));
  const end = metaAt < 0 ? texts.length : metaAt;
  const titleEnd = credit >= 0 ? credit : end;
  const out: string[] = [];
  const title = texts.slice(0, titleEnd);
  if (title.length) out.push(`Title: ${title[0]}`, ...title.slice(1).map((t) => `    ${t}`));
  if (credit >= 0) out.push(`Credit: ${texts[credit]}`);
  const authors = texts.slice(credit + 1, end);
  if (credit >= 0 && authors.length) out.push(`Author: ${authors.join(', ')}`);
  const notes: string[] = [];
  for (const t of texts.slice(end)) {
    const draft = DRAFT.exec(t);
    if (draft) out.push(`Revision: ${draft[1]}`, `Draft date: ${draft[2]}`);
    else if (CONTACT.test(t)) out.push(`Contact: ${t}`);
    else notes.push(t);
  }
  if (notes.length) out.push(`Notes: ${notes.join(' ')}`);
  return out.length ? out.join('\n') : null;
}

/**
 * Text layer of a screenplay PDF → Fountain text. Keeps indentation (cues, dialogue,
 * parentheticals), scene numbers in the margin and paragraph gaps; takes the title page into
 * Fountain title keys; drops page numbers, footers and page-break markers; and joins an
 * action or dialogue paragraph that a page break split.
 */
export function pdfPagesToFountain(source: PdfPage[]): string {
  const pages = stripRunning(source.map((p) => linesOf(p.items)));
  const title = titlePageOf(pages[0], pages.slice(1));
  const body = title ? pages.slice(1) : pages;
  const widths = source.slice(title ? 1 : 0).map((p) => p.width);
  const all = body.flat();
  const margin = all.reduce((m, l) => Math.min(m, l.x), Infinity);
  const bottom = all.reduce((m, l) => Math.min(m, l.y), Infinity);

  const rows: string[] = title ? [title, ''] : [];
  let size = 0;
  let previous: Line | undefined;
  // The last row is an action paragraph line that the next wrapped line can be added to.
  let open = false;
  body.forEach((page, p) => {
    page.forEach((line, i) => {
      const lead = i === 0 ? previous : page[i - 1];
      const same =
        !!lead &&
        (i === 0
          ? continuesAcrossPages(lead, line, margin, bottom)
          : lead.y - line.y <= line.height * 1.5);
      if (lead && !same) rows.push('');
      // A transition is set at the right edge (CUT TO); Fountain wants a leading >.
      const right =
        line.x > (widths[p] ?? 612) * 0.6 &&
        line.text.length <= 30 &&
        TRANSITION_WORD.test(line.text) &&
        !/\p{Ll}/u.test(line.text);
      const plain = numbered(line.text);
      const flush = !right && line.x < margin + 3;
      const last = rows.at(-1)?.trim() ?? '';
      // A parenthetical that wraps stays one line: "(a Daniele senza neanche\nguardarlo)".
      const wraps = same && Math.abs((lead?.x ?? 0) - line.x) < 3 && /^\([^)]*$/.test(last);
      if ((same && flush && open) || wraps) {
        // Lines of one action paragraph are the page's wrapping, not line breaks.
        rows[rows.length - 1] += ` ${plain}`;
      } else {
        const indent = right || flush ? '' : ' '.repeat(Math.min(80, Math.round(line.x / 6)));
        rows.push(`${indent}${right ? `> ${plain}` : plain}`);
        open = flush && !isHeading(line.text) && /\p{Ll}/u.test(plain);
      }
      size += plain.length + 1;
      if (size > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
      previous = line;
    });
  });
  return `${rows.join('\n')}\n`;
}

/**
 * The last line of a page and the first of the next belong to one paragraph when the first
 * sits at the bottom margin and the second carries on at the same indent (a sentence cut in
 * two), or when a cue was left alone at the bottom of the page.
 */
function continuesAcrossPages(prev: Line, next: Line, margin: number, bottom: number): boolean {
  if (prev.y > bottom + prev.height * 1.5 || isHeading(next.text)) return false;
  if (Math.abs(prev.x - next.x) < 3) {
    const flush = next.x < margin + 3;
    return !flush || !TERMINAL.test(prev.text) || /^\p{Ll}/u.test(next.text);
  }
  return !/\p{Ll}/u.test(prev.text) && prev.text.length <= 40 && prev.x > next.x + 20;
}
