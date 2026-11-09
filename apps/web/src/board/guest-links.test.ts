import type { ShareLink, ShareLinkPicks } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  canChangeScope,
  createOf,
  csvCell,
  draftOf,
  linkSummary,
  namesText,
  newDraft,
  patchOf,
  pickedFileNames,
  pickedWithoutName,
  picksCsv,
  statusOf,
} from './guest-links.ts';

const link: ShareLink = {
  id: 'l1',
  projectId: 'p',
  boardId: 'b',
  boardTitle: 'Board',
  includeSubBoards: true,
  role: 'guest_comment',
  label: 'Cliente',
  hasPassword: true,
  allowDownload: false,
  proofing: true,
  url: 'https://x/s/token',
  status: 'active',
  createdBy: { id: 'u1', name: 'Giulia', image: null },
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-11-01T00:00:00.000Z',
  revokedAt: null,
  guestCount: 2,
  viewCount: 5,
  lastUsedAt: null,
} as ShareLink;

describe('guest links', () => {
  it('treats an unknown status as not working', () => {
    expect(statusOf(link)).toBe('active');
    expect(statusOf({ status: 'paused' as never })).toBe('unknown');
  });

  it('lets only the creator or an owner change the scope', () => {
    expect(canChangeScope(link, 'u1', 'editor')).toBe(true);
    expect(canChangeScope(link, 'u2', 'editor')).toBe(false);
    expect(canChangeScope(link, 'u2', 'owner')).toBe(true);
    expect(canChangeScope({ createdBy: null }, 'u2', 'editor')).toBe(false);
  });

  it('sends only what changed', () => {
    expect(patchOf(link, draftOf(link), true)).toEqual({});
    const draft = { ...draftOf(link), label: '  ', role: 'guest_approve' as const };
    expect(patchOf(link, draft, true)).toEqual({ label: null, role: 'guest_approve' });
    // Without scope rights only the label goes out.
    expect(patchOf(link, draft, false)).toEqual({ label: null });
  });

  it('sets, removes and keeps password and expiry', () => {
    const now = Date.parse('2026-10-24T00:00:00.000Z');
    const d = draftOf(link);
    expect(patchOf(link, { ...d, password: { mode: 'set', value: 'secret1' } }, true)).toEqual({
      password: 'secret1',
    });
    expect(patchOf(link, { ...d, password: { mode: 'remove', value: '' } }, true)).toEqual({
      password: null,
    });
    expect(patchOf(link, { ...d, expiry: 'none' }, true)).toEqual({ expiresAt: null });
    expect(patchOf(link, { ...d, expiry: 7 }, true, now)).toEqual({
      expiresAt: '2026-10-31T00:00:00.000Z',
    });
  });
});

const picks: ShareLinkPicks = {
  guests: [
    { id: 'g1', name: 'Ada', createdAt: '', lastSeenAt: '' },
    { id: 'g2', name: null, createdAt: '', lastSeenAt: '' },
  ],
  items: [
    {
      boardId: 'b',
      elementId: 'e1',
      assetId: 'a1',
      filename: 'DSC_001.jpg',
      picked: 2,
      rejected: 0,
      starsAverage: 4.5,
      starsCount: 2,
      byGuest: [
        { guestId: 'g1', pick: 'picked', stars: 5 },
        { guestId: 'g2', pick: 'picked', stars: 4 },
      ],
    },
    {
      boardId: 'b',
      elementId: 'e2',
      assetId: 'a2',
      filename: '=cmd|calc.jpg',
      picked: 0,
      rejected: 1,
      starsAverage: null,
      starsCount: 0,
      byGuest: [{ guestId: 'g1', pick: 'rejected', stars: null }],
    },
    {
      boardId: 'b',
      elementId: 'e3',
      assetId: null,
      filename: null,
      picked: 1,
      rejected: 0,
      starsAverage: null,
      starsCount: 0,
      byGuest: [{ guestId: 'g2', pick: 'picked', stars: null }],
    },
  ],
};

describe('proofing export', () => {
  it('lists the picked file names once', () => {
    expect(pickedFileNames(picks)).toEqual(['DSC_001.jpg']);
    expect(pickedWithoutName(picks)).toBe(1);
  });

  it('keeps each name on one line of the text file', () => {
    expect(namesText(['a.jpg', 'b\r\nc.jpg', 'd\ne\u2028f.jpg'])).toBe(
      'a.jpg\r\nb c.jpg\r\nd e f.jpg\r\n',
    );
  });

  it('writes CSV cells that are never formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    // Spreadsheets skip leading spaces; a pipe starts a DDE command.
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell('|calc')).toBe("'|calc");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(null)).toBe('');
  });

  it('writes totals and each guest’s choice', () => {
    const csv = picksCsv(picks, {
      file: 'File',
      picked: 'Picked',
      rejected: 'Rejected',
      stars: 'Stars',
      ratings: 'Ratings',
      guest: (name, i) => name ?? `Guest ${i + 1}`,
      choice: (pick, stars) => [pick, stars].filter(Boolean).join(' '),
    });
    expect(csv.split('\r\n')).toEqual([
      'File,Picked,Rejected,Stars,Ratings,Ada,Guest 2',
      'DSC_001.jpg,2,0,4.5,2,picked 5,picked 4',
      "'=cmd|calc.jpg,0,1,,0,rejected,",
      ',1,0,,0,,picked',
      '',
    ]);
  });
});

describe('the sentence under the link form', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    key === 'share.link.days'
      ? `${values?.count} giorni`
      : key === 'guestLinks.summary.expiresIn'
        ? `Scade tra <b>${values?.when}</b>`
        : key === 'guestLinks.summary.noDownload'
          ? ', <b>niente download</b>'
          : `[${key.replace('guestLinks.summary.', '')}]`;
  const text = (parts: { text: string; strong?: boolean }[]) =>
    parts.map((p) => (p.strong ? `*${p.text}*` : p.text)).join('');
  const date = (iso: string) => iso.slice(0, 10);

  it('names the label as subject and lists what the link allows', () => {
    const draft = {
      ...newDraft(),
      label: ' Il cliente ',
      role: 'guest_approve' as const,
      proofing: true,
      password: { mode: 'set' as const, value: 'x' },
      expiry: 7,
    };
    expect(text(linkSummary(t, draft, { subBoards: 2, date }))).toBe(
      '*Il cliente* [role.guest_approve][pick], *niente download*. [subBoards] Scade tra *7 giorni*, [withPassword].',
    );
  });

  it('uses a neutral subject, and leaves out the boards line without sub-boards', () => {
    const draft = { ...newDraft(), allowDownload: true };
    expect(text(linkSummary(t, draft, { subBoards: 0, date }))).toBe(
      '*[someone]* [role.guest_view][download]. [noExpiry].',
    );
    expect(
      text(linkSummary(t, { ...draft, includeSubBoards: false }, { subBoards: 1, date })),
    ).toContain('[onlyHere]');
  });

  it('keeps the expiry and the password of the link being changed', () => {
    const draft = draftOf(link);
    expect(text(linkSummary(t, draft, { subBoards: 0, link, date }))).toBe(
      '*Cliente* [role.guest_comment][pick], *niente download*. [expiresOn], [withPassword].',
    );
    const removed = {
      ...draft,
      password: { mode: 'remove' as const, value: '' },
      expiry: 'none' as const,
    };
    expect(text(linkSummary(t, removed, { subBoards: 0, link, date }))).toBe(
      '*Cliente* [role.guest_comment][pick], *niente download*. [noExpiry].',
    );
  });

  it('creates a link from a new draft with only the fields set', () => {
    expect(createOf({ ...newDraft(), label: '  ' })).toEqual({
      role: 'guest_view',
      includeSubBoards: true,
      allowDownload: false,
      proofing: false,
    });
    expect(
      createOf({
        ...newDraft(),
        label: 'Cliente',
        password: { mode: 'set', value: 'p' },
        expiry: 30,
      }),
    ).toMatchObject({ label: 'Cliente', password: 'p', expiresInDays: 30 });
  });
});
