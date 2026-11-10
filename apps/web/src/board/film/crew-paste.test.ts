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
      department: 'CAMERA',
      status: 'new',
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
    ).toEqual(['LUCI', 'CAMERA']);
  });
});
