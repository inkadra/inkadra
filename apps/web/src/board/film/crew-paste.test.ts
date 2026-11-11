import { describe, expect, it } from 'vitest';
import { parseCrewPaste } from './crew-paste.ts';

describe('crew paste', () => {
  it.each(['\t', ';', ' · ', '  '])('reads old sheet columns separated by %j', (separator) => {
    expect(
      parseCrewPaste(`CAMERA\nAnna Rossi${separator}1° AC${separator}+39 340 123 4567`)[0],
    ).toMatchObject({
      name: 'Anna Rossi',
      role: '1° AC',
      phone: '+39 340 123 4567',
      department: 'Camera',
      status: 'new',
    });
  });
  it('drops a separator left at the end of the line', () => {
    expect(parseCrewPaste('Paolo Riva · Fonico · ')[0]).toMatchObject({
      name: 'Paolo Riva',
      role: 'Fonico',
    });
  });
  it('finds phones in any column and preserves free roles', () => {
    expect(parseCrewPaste('+44 123 456 7890;Anna Rossi;Modella · linea donna')[0]).toMatchObject({
      name: 'Anna Rossi',
      phone: '+44 123 456 7890',
    });
  });
  it('shows Italian and English headers and agent lines as skipped', () => {
    expect(
      parseCrewPaste(
        'Nome\tRuolo\tTelefono\nName;Role;Phone\nPick-up/Call\tCall time\tPhone\nagent: Jane +44 123456789',
      ).map((r) => r.status),
    ).toEqual(['header', 'header', 'header', 'agent']);
  });
  it('recognizes duplicates in the project and within a paste', () => {
    expect(
      parseCrewPaste('Anna Rossi;AC\nANNA ROSSI;DIT\nLuca Verdi;Gaffer\nluca verdi;Gaffer', [
        ' anna rossi ',
      ]).map((r) => r.status),
    ).toEqual(['duplicate', 'duplicate', 'new', 'duplicate']);
  });
  it('supports CRLF, empty fields and department changes', () => {
    expect(
      parseCrewPaste('LUCI\r\nAnna\t\t+39 123456789\r\n\r\nCAMERA\r\nLuca;DIT').map(
        (r) => r.department,
      ),
    ).toEqual(['Luci', 'Camera']);
  });
  it('writes a shouted department as the project already spells it', () => {
    expect(
      parseCrewPaste('REGIA\nAnna;Aiuto regia', [], ['Regia & produzione', 'regia'])[0]?.department,
    ).toBe('regia');
  });
  it('keeps a list of names in capitals as people', () => {
    expect(
      parseCrewPaste('MARCO ROSSI\nGIULIA NERI\nLUCA VERDI').map((r) => [r.name, r.department]),
    ).toEqual([
      ['MARCO ROSSI', ''],
      ['GIULIA NERI', ''],
      ['LUCA VERDI', ''],
    ]);
  });
  it('reads a capital line as a department only above a row of people', () => {
    expect(
      parseCrewPaste('CAMERA\nMARCO ROSSI\nLUCI\nAnna\t+39 340 1234567').map((r) => [
        r.name,
        r.department,
      ]),
    ).toEqual([
      ['CAMERA', ''],
      ['MARCO ROSSI', ''],
      ['Anna', 'Luci'],
    ]);
  });
  it('takes a known department in any case, a new one in Title Case as a person', () => {
    expect(
      parseCrewPaste('Camera\nAnna\nRegia\nLuca', [], ['camera']).map((r) => [
        r.name,
        r.department,
      ]),
    ).toEqual([
      ['Anna', 'camera'],
      ['Regia', 'camera'],
      ['Luca', 'camera'],
    ]);
  });
  it('keeps a note after the phone out of it', () => {
    expect(parseCrewPaste('Anna\t+39 123 456789 (agent)')[0]).toMatchObject({
      name: 'Anna',
      phone: '+39 123 456789',
      role: '(agent)',
    });
    expect(parseCrewPaste('Anna;+39 (02) 1234567')[0]?.phone).toBe('+39 (02) 1234567');
  });
  it('skips a line with a phone and no name', () => {
    expect(parseCrewPaste('+39 340 1234567')[0]?.status).toBe('noName');
  });
});
