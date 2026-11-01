// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeZip } from '../transfers/zip.ts';
import { parseCsv, readXlsx } from './office-sheets.ts';

async function workbook(sheet = '<row><c r="A1" t="inlineStr"><is><t>First</t></is></c></row>') {
  const dir = await mkdtemp(join(tmpdir(), 'office-sheet-'));
  const file = join(dir, 'book.xlsx');
  const zip = writeZip(file);
  await zip.addBuffer(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Budget" r:id="r1"/><sheet name="Second" r:id="r2"/></sheets></workbook>',
  );
  await zip.addBuffer(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
  );
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
    expect(parseCsv('\uFEFFName,Text\r\n"A,B","He said ""yes""\nagain"\r\n')).toEqual([
      ['Name', 'Text'],
      ['A,B', 'He said "yes"\nagain'],
    ]);
    expect(parseCsv('A;B\n1;2')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('keeps formulas and HTML inert text', () => {
    expect(parseCsv('=1+1,<script>alert(1)</script>')).toEqual([
      ['=1+1', '<script>alert(1)</script>'],
    ]);
  });
  it.each([
    '"unclosed',
    '"a"junk,b',
    'x'.repeat(2001),
    Array(502).fill('a').join('\n'),
    Array(22).fill('a').join(','),
  ])('rejects malformed or oversized input', (input) => expect(() => parseCsv(input)).toThrow());
});
describe('XLSX', () => {
  it('preserves workbook sheet order and cached values', async () => {
    expect(await readXlsx(await workbook())).toEqual([
      { name: 'Budget', rows: [['First']] },
      { name: 'Second', rows: [['42']] },
    ]);
  });
  it.each([
    '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><row/>',
    '<row><c r="A1000000"><v>1</v></c></row>',
    '<row><c r="ZZ1"><v>1</v></c></row>',
    `<row><c r="A1" t="inlineStr"><is><t>${'x'.repeat(2001)}</t></is></c></row>`,
  ])('rejects XXE, huge coordinates and cells', async (sheet) => {
    await expect(readXlsx(await workbook(sheet))).rejects.toThrow();
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
});
it('keeps sparse row and column coordinates', async () => {
  const sheets = await readXlsx(await workbook('<row><c r="B3"><v>7</v></c></row>'));
  expect(sheets[0]?.rows).toEqual([
    ['', ''],
    ['', ''],
    ['', '7'],
  ]);
});
