import { describe, expect, it } from 'vitest';
import { isPdf, parsePdfInfo } from './pdf.ts';

describe('PDF', () => {
  it('finds the header, even after a few bytes of junk', () => {
    expect(isPdf(Buffer.from('%PDF-1.7\n%âãÏÓ'))).toBe(true);
    expect(isPdf(Buffer.from('\r\n\r\n%PDF-1.4'))).toBe(true);
    expect(isPdf(Buffer.from('%!PS-Adobe-3.0'))).toBe(false);
    expect(isPdf(Buffer.from('PK\u0003\u0004'))).toBe(false);
  });

  it('reads the page count and encryption of pdfinfo', () => {
    const text = [
      'Producer:        qpdf',
      'Encrypted:       no',
      'Page size:       595 x 842 pts (A4)',
      'Pages:           2',
    ].join('\n');
    expect(parsePdfInfo(text)).toEqual({ pageCount: 2, encrypted: false });
    expect(parsePdfInfo('Encrypted:       yes (print:yes copy:no)\nPages: 140')).toEqual({
      pageCount: 140,
      encrypted: true,
    });
    expect(parsePdfInfo('Pages:           0')).toEqual({ pageCount: null, encrypted: false });
    expect(parsePdfInfo('')).toEqual({ pageCount: null, encrypted: false });
  });
});
