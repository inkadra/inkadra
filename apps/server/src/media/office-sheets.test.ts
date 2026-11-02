// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeZip } from '../transfers/zip.ts';
import { decodeCsv, overLimits, parseCsv, readXlsx, SheetLimitError } from './office-sheets.ts';

const STYLES = `<styleSheet>
  <numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
  <cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="9"/><xf numFmtId="165"/></cellXfs>
</styleSheet>`;

async function workbook(
  sheet = '<row><c r="A1" t="inlineStr"><is><t>First</t></is></c></row>',
  { styles = '', first = '' } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'office-sheet-'));
  const file = join(dir, 'book.xlsx');
  const zip = writeZip(file);
  await zip.addBuffer(
    'xl/workbook.xml',
    `<workbook><workbookPr/><sheets><sheet name="Budget" r:id="r1"${first}/><sheet name="Second" r:id="r2"/></sheets></workbook>`,
  );
  await zip.addBuffer(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
  );
  if (styles) await zip.addBuffer('xl/styles.xml', styles);
  await zip.addBuffer(
    'xl/worksheets/sheet1.xml',
    `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
  );
  await zip.addBuffer(
    'xl/worksheets/sheet2.xml',
    '<worksheet><sheetData><row><c r="A1"><v>42</v></c></row></sheetData></worksheet>',
  );
  await zip.close();
  return file;
}

describe('CSV', () => {
  it('reads BOM, CRLF, quoted delimiters, escaped quotes and multiline cells', () => {
    expect(parseCsv('﻿Name,Text\r\n"A,B","He said ""yes""\nagain"\r\n').rows).toEqual([
      ['Name', 'Text'],
      ['A,B', 'He said "yes"\nagain'],
    ]);
    expect(parseCsv('A;B\n1;2').rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(parseCsv('A\tB\n1\t2').rows[1]).toEqual(['1', '2']);
    expect(parseCsv('a,b,').rows).toEqual([['a', 'b', '']]);
    expect(parseCsv('').rows).toEqual([]);
  });
  it('keeps formulas and HTML inert text', () => {
    expect(parseCsv('=1+1,<script>alert(1)</script>').rows).toEqual([
      ['=1+1', '<script>alert(1)</script>'],
    ]);
  });
  it('is tolerant of stray quotes, leading spaces and unclosed quotes', () => {
    expect(parseCsv('a, "b, c" ,d').rows).toEqual([['a', 'b, c ', 'd']]);
    expect(parseCsv('5" pipe,x').rows).toEqual([['5" pipe', 'x']]);
    expect(parseCsv('"a"junk,b').rows).toEqual([['ajunk', 'b']]);
    expect(parseCsv('ok,1\n"unclosed,2\nlost').rows).toEqual([['ok', '1'], ['unclosed,2\nlost']]);
  });
  it('reads Excel files from Western locales: Windows-1252 bytes and semicolons', () => {
    const bytes = Buffer.from('Città;Qtà\nPerù;3\n', 'latin1');
    expect(decodeCsv(bytes)).toBe('Città;Qtà\nPerù;3\n');
    expect(parseCsv(decodeCsv(bytes)).rows).toEqual([
      ['Città', 'Qtà'],
      ['Perù', '3'],
    ]);
    expect(decodeCsv(Buffer.from('€;è\n'))).toBe('€;è\n');
    expect(decodeCsv(Buffer.from('\uFEFFa\tb', 'utf16le'))).toBe('a\tb');
  });
  it('drops what is over the limits and says so, instead of rejecting the file', () => {
    const rows = parseCsv(Array(502).fill('a').join('\n'));
    expect(rows.rows).toHaveLength(500);
    expect(rows.truncated).toBe(true);
    expect(parseCsv(Array(22).fill('a').join(',')).rows[0]).toHaveLength(20);
    const cell = parseCsv('x'.repeat(2001));
    expect(cell.rows[0]?.[0]).toHaveLength(2000);
    expect(cell.truncated).toBe(true);
    expect(parseCsv('a,b').truncated).toBe(false);
  });
});
describe('XLSX', () => {
  it('preserves workbook sheet order and cached values', async () => {
    expect(await readXlsx(await workbook())).toEqual([
      { name: 'Budget', rows: [['First']] },
      { name: 'Second', rows: [['42']] },
    ]);
  });
  it('shows dates, percentages and numbers the way the sheet does', async () => {
    const sheets = await readXlsx(
      await workbook(
        '<row><c r="A1" s="1"><v>45963</v></c><c r="B1" s="2"><v>45963.5</v></c>' +
          '<c r="C1" s="3"><v>0.25</v></c><c r="D1" s="4"><v>0.123</v></c>' +
          '<c r="E1"><v>1080.5000000000002</v></c><c r="F1"><v>12345678901234567890</v></c>' +
          '<c r="G1" t="b"><v>1</v></c><c r="H1" t="str"><v>0.1+0.2</v></c><c r="I1"><v>45963</v></c></row>',
        { styles: STYLES },
      ),
    );
    expect(sheets[0]?.rows[0]).toEqual([
      '2025-11-02',
      '2025-11-02', // dd/mm/yyyy has no time of day
      '25%',
      '12.3%',
      '1080.5',
      '12345678901234567890',
      'TRUE',
      '0.1+0.2',
      '45963', // no style: it is just a number
    ]);
  });
  it('shows a time of day, and 1904 workbooks count from 1904', async () => {
    const styles =
      '<styleSheet><numFmts count="1"><numFmt numFmtId="166" formatCode="yyyy-mm-dd hh:mm"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="166"/></cellXfs></styleSheet>';
    const rows = (
      await readXlsx(await workbook('<row><c r="A1" s="1"><v>45963.5625</v></c></row>', { styles }))
    )[0]?.rows;
    expect(rows).toEqual([['2025-11-02 13:30']]);
  });
  it('leaves hidden sheets out: the first sheet is the first visible one', async () => {
    const sheets = await readXlsx(await workbook(undefined, { first: ' state="veryHidden"' }));
    expect(sheets.map((s) => s.name)).toEqual(['Second']);
  });
  it.each([
    '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><row/>',
    '<row><c r="1A"><v>1</v></c></row>',
  ])('rejects XXE and malformed coordinates', async (sheet) => {
    await expect(readXlsx(await workbook(sheet))).rejects.toThrow();
  });
  it('flags cells beyond the table limits instead of failing or storing them', async () => {
    const sheets = await readXlsx(
      await workbook(
        '<row><c r="A1"><v>1</v></c><c r="A1000000"><v>2</v></c><c r="ZZ1"><v>3</v></c><c r="U2"><v>4</v></c></row>',
      ),
    );
    expect(sheets[0]).toEqual({ name: 'Budget', rows: [['1']], truncated: true });
    const long = await readXlsx(
      await workbook(`<row><c r="A1" t="inlineStr"><is><t>${'x'.repeat(2001)}</t></is></c></row>`),
    );
    expect(long[0]?.rows[0]?.[0]).toHaveLength(2000);
  });
  it('rejects zip bombs before inflating', async () => {
    const path = await workbook();
    const data = await readFile(path);
    const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    data.writeUInt32LE(2 * 1024 ** 2, central + 24);
    data.writeUInt32LE(1, central + 20);
    await writeFile(path, data);
    await expect(readXlsx(path)).rejects.toThrow();
  });
  it('tells "over the limits" from "not a spreadsheet"', () => {
    expect(overLimits(new Error('not a zip'))).toBe(false);
    expect(overLimits(new SheetLimitError('big'))).toBe(true);
  });
});
it('keeps sparse row and column coordinates', async () => {
  const sheets = await readXlsx(await workbook('<row><c r="B3"><v>7</v></c></row>'));
  expect(sheets[0]?.rows).toEqual([
    ['', ''],
    ['', ''],
    ['', '7'],
  ]);
});
