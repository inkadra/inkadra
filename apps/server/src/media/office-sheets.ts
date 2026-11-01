// SPDX-License-Identifier: AGPL-3.0-only
import { Parser } from 'htmlparser2';
import { readZip } from '../transfers/zip.ts';

export const SHEET_LIMITS = {
  rows: 500,
  columns: 20,
  cell: 2000,
  bytes: 16 * 1024 ** 2,
  sheets: 16,
};
export interface OfficeSheet {
  name: string;
  rows: string[][];
}
const fail = () => {
  throw new Error('Spreadsheet exceeds limits or is invalid');
};

/** Plain text only: neither spreadsheet formulas nor HTML are evaluated. */
export function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text) > SHEET_LIMITS.bytes) fail();
  text = text.replace(/^\uFEFF/, '');
  // Count separators outside quotes, so quoted commas do not hide semicolon CSV.
  let comma = 0,
    semi = 0,
    inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuote && text[i + 1] === '"') i++;
      else inQuote = !inQuote;
    }
    if (!inQuote) {
      if (c === '\r' || c === '\n') break;
      if (c === ',') comma++;
      if (c === ';') semi++;
    }
  }
  const delimiter = semi > comma ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const field = () => {
    if (row.length >= SHEET_LIMITS.columns) fail();
    row.push(cell);
    cell = '';
    closed = false;
  };
  const record = () => {
    field();
    if (rows.length >= SHEET_LIMITS.rows) fail();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === delimiter) field();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record();
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') fail();
      cell += c;
    }
    if (cell.length > SHEET_LIMITS.cell) fail();
  }
  if (quoted) fail();
  if (cell || row.length || closed) record();
  return rows;
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
        if (++count > 100_000 || stack.length > 32) fail();
        const node = { tag: tag.split(':').at(-1) ?? tag, attrs, text: '', children: [] };
        stack.at(-1)?.children.push(node);
        stack.push(node);
      },
      ontext(value) {
        const node = stack.at(-1);
        if (node) {
          node.text += value;
          if (node.text.length > 32_000) fail();
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
const checked = (s: string) => {
  if (s.length > SHEET_LIMITS.cell) fail();
  return s;
};

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
          checked(content(s)),
        )
      : [];
    if (strings.length > 10_000) fail();
    const sheets = nodes(workbook, 'sheet');
    if (!sheets.length || sheets.length > SHEET_LIMITS.sheets) fail();
    let cells = 0;
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
      for (const cell of nodes(doc, 'c')) {
        if (++cells > 10_000) fail();
        const ref = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.attrs.r ?? '');
        if (!ref) fail();
        const col = [...(ref?.[1] ?? '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
        const row = Number(ref?.[2]) - 1;
        if (row >= SHEET_LIMITS.rows || col >= SHEET_LIMITS.columns) fail();
        const value = nodes(cell, 'v')[0]?.text ?? '';
        // Cached values only; formulas and external links are never run.
        const str =
          cell.attrs.t === 's'
            ? strings[Number(value)]
            : cell.attrs.t === 'inlineStr'
              ? nodes(cell, 't').map(content).join('')
              : value;
        rows[row] ??= [];
        const targetRow = rows[row];
        if (targetRow) targetRow[col] = checked(str ?? '');
      }
      const width = Math.max(1, ...Array.from(rows, (r) => r?.length ?? 0));
      if (result.reduce((n, s) => n + s.rows.length * (s.rows[0]?.length ?? 0), 0) + rows.length * width > 10_000) fail();
      result.push({
        name: checked(sheet.attrs.name ?? ''),
        rows: Array.from({ length: rows.length }, (_, r) =>
          Array.from({ length: width }, (_, c) => rows[r]?.[c] ?? ''),
        ),
      });
    }
    return result;
  } finally {
    zip.close();
  }
}
