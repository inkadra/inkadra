// SPDX-License-Identifier: AGPL-3.0-only
import { Parser } from 'htmlparser2';
import { ArchiveError, readZip } from '../transfers/zip.ts';

export const SHEET_LIMITS = {
  rows: 500,
  columns: 20,
  cell: 2000,
  bytes: 16 * 1024 ** 2,
  sheets: 16,
  /** Cells of a whole workbook, as the API contract allows. */
  cells: 10_000,
};
export interface OfficeSheet {
  name: string;
  rows: string[][];
  /** Rows, columns or text beyond the limits were left out (no rows at all: too big to read). */
  truncated?: boolean;
}
/** Structure that cannot be trusted: XXE, bad coordinates, broken XML. The file is not read. */
const fail = () => {
  throw new Error('Spreadsheet is invalid');
};
/** A workbook too big to read at all; the preview says so instead of showing nothing. */
export class SheetLimitError extends Error {}
const tooBig = () => {
  throw new SheetLimitError('Spreadsheet exceeds the preview limits');
};
/** Whether `err` means "over the limits" rather than "not a spreadsheet". */
export const overLimits = (err: unknown) =>
  err instanceof SheetLimitError || (err instanceof ArchiveError && err.reason === 'too_large');
/** The sheet shown for a file over the limits: no cells, flagged. */
export const oversizedSheet = (name: string): OfficeSheet => ({ name, rows: [], truncated: true });

/**
 * The text of a CSV file: UTF-8 (with or without BOM), UTF-16 with a BOM, else Windows-1252,
 * which is what Excel writes in Western locales. Never fails: bytes are replaced, not refused.
 */
export function decodeCsv(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

/**
 * Plain text only: neither spreadsheet formulas nor HTML are evaluated. Best effort on
 * sloppy files: a quote inside a field is a letter, spaces may precede an opening quote, text
 * after a closing quote is kept, an unclosed quote runs to the end. Whatever exceeds the
 * limits is dropped and flagged, never the whole file.
 */
export function parseCsv(text: string): { rows: string[][]; truncated: boolean } {
  if (Buffer.byteLength(text) > SHEET_LIMITS.bytes) tooBig();
  text = text.replace(/^\uFEFF/, '');
  // Count separators outside quotes in the first record, so quoted commas do not hide a
  // semicolon or tab CSV.
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"') {
      if (inQuote && text[i + 1] === '"') i++;
      else inQuote = !inQuote;
    } else if (!inQuote) {
      if (c === '\r' || c === '\n') break;
      if (c in counts) counts[c] = (counts[c] ?? 0) + 1;
    }
  }
  const delimiter =
    (['\t', ';'] as const).find((d) => (counts[d] ?? 0) > (counts[','] ?? 0)) ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let truncated = false;
  let quoted = false;
  let closed = false;
  let full = false;
  const field = () => {
    if (row.length < SHEET_LIMITS.columns) row.push(cell);
    else truncated = true;
    cell = '';
    closed = false;
  };
  const record = () => {
    field();
    if (rows.length < SHEET_LIMITS.rows) rows.push(row);
    else {
      truncated = true;
      full = true;
    }
    row = [];
  };
  for (let i = 0; i < text.length && !full; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (c === delimiter) field();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record();
    } else if (c === '"' && !closed && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else cell += c;
    if (cell.length > SHEET_LIMITS.cell) {
      cell = cell.slice(0, SHEET_LIMITS.cell);
      truncated = true;
    }
  }
  if (!full && (cell || row.length || closed || quoted)) record();
  return { rows, truncated };
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}
/** XML mode never resolves external entities; reject declarations as defence in depth. */
function xml(data: Buffer): XmlNode {
  const text = data.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail();
  const root: XmlNode = { tag: '', attrs: {}, text: '', children: [] },
    stack = [root];
  let count = 0;
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        if (++count > 100_000) tooBig();
        if (stack.length > 32) fail();
        const node = { tag: tag.split(':').at(-1) ?? tag, attrs, text: '', children: [] };
        stack.at(-1)?.children.push(node);
        stack.push(node);
      },
      ontext(value) {
        const node = stack.at(-1);
        if (node) {
          node.text += value;
          if (node.text.length > 32_000) tooBig();
        }
      },
      onclosetag() {
        stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.end(text);
  return root;
}
const nodes = (node: XmlNode, tag: string): XmlNode[] =>
  node.children.flatMap((c) => (c.tag === tag ? [c] : nodes(c, tag)));
const content = (node: XmlNode): string => node.text + node.children.map(content).join('');
/** Text shown in a cell: at most SHEET_LIMITS.cell characters. */
const clip = (s: string) => s.slice(0, SHEET_LIMITS.cell);

/** The number formats that matter for display: dates, times and percentages. */
const BUILTIN_DATES = [14, 15, 16, 17, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58];
const BUILTIN_TIMES = [18, 19, 20, 21, 32, 33, 34, 35, 45, 46, 47];
type Format = { date: boolean; time: boolean; percent: number | null } | null;
function formatOf(id: number, code: string | undefined): Format {
  if (code === undefined) {
    if (id === 9 || id === 10) return { date: false, time: false, percent: id === 9 ? 0 : 2 };
    if (id === 22) return { date: true, time: true, percent: null };
    if (BUILTIN_DATES.includes(id)) return { date: true, time: false, percent: null };
    return BUILTIN_TIMES.includes(id) ? { date: false, time: true, percent: null } : null;
  }
  // Quoted text, [colours], [$-locale] and escaped characters are not format letters.
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, '');
  if (bare.includes('%'))
    return { date: false, time: false, percent: /\.(0+)/.exec(bare)?.[1]?.length ?? 0 };
  const time = /[hs]/i.test(bare);
  const date = /[yd]/i.test(bare) || (/m/i.test(bare) && !time);
  return date || time ? { date, time, percent: null } : null;
}

/** A serial date as `2025-11-03`, `14:30` or both; null when it is no date. */
function serialDate(value: number, format: NonNullable<Format>, epoch1904: boolean) {
  if (!Number.isFinite(value) || value < 0 || value > 2_958_465) return null;
  const days = Math.floor(value);
  const seconds = Math.round((value - days) * 86_400);
  // Excel's 1900 system counts a 29 February 1900 that never existed.
  const start = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
  const day = new Date(start + days * 86_400_000).toISOString().slice(0, 10);
  const clock = new Date(seconds * 1000).toISOString().slice(11, seconds % 60 ? 19 : 16);
  if (format.date && format.time) return `${day} ${clock}`;
  return format.date ? day : clock;
}

/** A cached value as the sheet shows it, not as the file stores it: no serials, no float noise. */
function display(value: string, format: Format, epoch1904: boolean): string {
  const number = Number(value);
  // Whole numbers (ids, phone numbers) are kept to the last digit.
  if (value.trim() === '' || !Number.isFinite(number) || (!format && /^-?\d+$/.test(value)))
    return value;
  if (format?.percent != null) return `${(number * 100).toFixed(format.percent)}%`;
  if (format) return serialDate(number, format, epoch1904) ?? value;
  // 1080.5000000000002 is what a double makes of 1080.5; 15 digits is what spreadsheets show.
  return String(Number.parseFloat(number.toPrecision(15)));
}

/** `numFmtId` of every cell style (`s` of a cell is an index into this), with its format code. */
function cellFormats(styles: XmlNode | null): Format[] {
  if (!styles) return [];
  const codes = new Map(
    nodes(styles, 'numFmt').map((n) => [Number(n.attrs.numFmtId), n.attrs.formatCode ?? '']),
  );
  const xfs = nodes(nodes(styles, 'cellXfs')[0] ?? styles, 'xf');
  return xfs.slice(0, 64_000).map((xf) => {
    const id = Number(xf.attrs.numFmtId);
    return formatOf(id, codes.get(id));
  });
}

/** Bounded unzip, names looked up only, no extraction or relationship fetching. */
export async function readXlsx(file: string): Promise<OfficeSheet[]> {
  const zip = await readZip(file, {
    entries: 2000,
    totalBytes: SHEET_LIMITS.bytes,
    compressionRatio: 100,
  });
  try {
    const workbook = xml(await zip.buffer('xl/workbook.xml', 256 * 1024));
    const relationships = nodes(
      xml(await zip.buffer('xl/_rels/workbook.xml.rels', 256 * 1024)),
      'Relationship',
    );
    const strings = zip.has('xl/sharedStrings.xml')
      ? nodes(xml(await zip.buffer('xl/sharedStrings.xml', 4 * 1024 ** 2)), 'si').map((s) =>
          clip(content(s)),
        )
      : [];
    if (strings.length > 10_000) tooBig();
    const formats = cellFormats(
      zip.has('xl/styles.xml') ? xml(await zip.buffer('xl/styles.xml', 2 * 1024 ** 2)) : null,
    );
    const epoch1904 = /^(1|true)$/i.test(nodes(workbook, 'workbookPr')[0]?.attrs.date1904 ?? '');
    // Hidden sheets are not shown, and are never "the first sheet".
    const sheets = nodes(workbook, 'sheet').filter(
      (s) => s.attrs.state !== 'hidden' && s.attrs.state !== 'veryHidden',
    );
    if (!sheets.length) fail();
    if (sheets.length > SHEET_LIMITS.sheets) tooBig();
    let budget = SHEET_LIMITS.cells;
    const result: OfficeSheet[] = [];
    for (const sheet of sheets) {
      const rel = relationships.find((r) => r.attrs.Id === sheet.attrs['r:id']);
      if (!rel || rel.attrs.TargetMode === 'External') fail();
      const target = rel?.attrs.Target ?? '';
      if (!/^\/?(?:xl\/)?worksheets\/[a-zA-Z0-9_.-]+\.xml$/.test(target)) fail();
      const path = target.startsWith('/')
        ? target.slice(1)
        : target.startsWith('xl/')
          ? target
          : `xl/${target}`;
      const doc = xml(await zip.buffer(path, 4 * 1024 ** 2));
      const rows: string[][] = [];
      let truncated = false;
      let width = 1;
      for (const cell of nodes(doc, 'c')) {
        const ref = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.attrs.r ?? '');
        if (!ref) fail();
        const col = [...(ref?.[1] ?? '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
        const row = Number(ref?.[2]) - 1;
        // Beyond the table limits: counted as left out, never stored.
        if (row >= SHEET_LIMITS.rows || col >= SHEET_LIMITS.columns) {
          truncated = true;
          continue;
        }
        const value = nodes(cell, 'v')[0]?.text ?? '';
        // Cached values only; formulas and external links are never run.
        const text =
          cell.attrs.t === 's'
            ? strings[Number(value)]
            : cell.attrs.t === 'inlineStr'
              ? nodes(cell, 't').map(content).join('')
              : cell.attrs.t === 'b'
                ? value === '1'
                  ? 'TRUE'
                  : 'FALSE'
                : cell.attrs.t && cell.attrs.t !== 'n'
                  ? value
                  : display(value, formats[Number(cell.attrs.s)] ?? null, epoch1904);
        rows[row] ??= [];
        const targetRow = rows[row];
        if (targetRow) targetRow[col] = clip(text ?? '');
        width = Math.max(width, col + 1);
      }
      // The workbook as a whole holds SHEET_LIMITS.cells cells: later rows are left out.
      let height = rows.length;
      if (height * width > budget) {
        height = Math.floor(budget / width);
        truncated = true;
      }
      budget -= height * width;
      result.push({
        name: clip(sheet.attrs.name ?? ''),
        rows: Array.from({ length: height }, (_, r) =>
          Array.from({ length: width }, (_, c) => rows[r]?.[c] ?? ''),
        ),
        ...(truncated ? { truncated } : {}),
      });
    }
    return result;
  } finally {
    zip.close();
  }
}
