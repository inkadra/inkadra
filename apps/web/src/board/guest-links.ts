import type {
  GuestRole,
  ProjectRole,
  ShareLink,
  ShareLinkPicks,
  ShareLinkStatus,
  UpdateShareLink,
} from '@inkadra/shared';

/** Share links for guests, as the team manages them (decision 0013). */

export const GUEST_ROLES: GuestRole[] = ['guest_view', 'guest_comment', 'guest_approve'];
export const EXPIRY_DAYS = [1, 7, 30, 90, 365] as const;
// The server asks for at least 10 characters for a new or changed link password (decision 0030).
export const MIN_PASSWORD = 10;

/** Statuses this build does not know count as not working. */
export function statusOf(link: Pick<ShareLink, 'status'>): ShareLinkStatus | 'unknown' {
  const s = link.status as string;
  return s === 'active' || s === 'expired' || s === 'revoked' || s === 'suspended' ? s : 'unknown';
}

/**
 * Only the creator of a link or an owner of the board change its scope (role, sub-boards,
 * downloads, proofing, password, expiry); other editors may relabel and revoke it.
 */
export function canChangeScope(
  link: Pick<ShareLink, 'createdBy'>,
  userId: string | undefined,
  myRole: ProjectRole,
): boolean {
  return myRole === 'owner' || (!!userId && link.createdBy?.id === userId);
}

export interface LinkDraft {
  role: GuestRole;
  label: string;
  includeSubBoards: boolean;
  allowDownload: boolean;
  proofing: boolean;
  /** `keep` the current password, `set` a new one, or `remove` it. */
  password: { mode: 'keep' | 'set' | 'remove'; value: string };
  /** `keep` the current expiry, `none` for no expiry, or a number of days from now. */
  expiry: 'keep' | 'none' | number;
}

export function draftOf(link: ShareLink): LinkDraft {
  return {
    role: GUEST_ROLES.includes(link.role) ? link.role : 'guest_view',
    label: link.label ?? '',
    includeSubBoards: link.includeSubBoards,
    allowDownload: link.allowDownload,
    proofing: link.proofing,
    password: { mode: 'keep', value: '' },
    expiry: 'keep',
  };
}

/** The changes a draft makes to a link; scope fields only when the person may change them. */
export function patchOf(
  link: ShareLink,
  draft: LinkDraft,
  scope: boolean,
  now = Date.now(),
): UpdateShareLink {
  const patch: UpdateShareLink = {};
  const label = draft.label.trim() || null;
  if (label !== link.label) patch.label = label;
  if (!scope) return patch;
  if (draft.role !== link.role) patch.role = draft.role;
  if (draft.includeSubBoards !== link.includeSubBoards)
    patch.includeSubBoards = draft.includeSubBoards;
  if (draft.allowDownload !== link.allowDownload) patch.allowDownload = draft.allowDownload;
  if (draft.proofing !== link.proofing) patch.proofing = draft.proofing;
  if (draft.password.mode === 'set') patch.password = draft.password.value;
  if (draft.password.mode === 'remove' && link.hasPassword) patch.password = null;
  if (draft.expiry === 'none' && link.expiresAt !== null) patch.expiresAt = null;
  if (typeof draft.expiry === 'number')
    patch.expiresAt = new Date(now + draft.expiry * 86_400_000).toISOString();
  return patch;
}

/** File names of the pictures at least one guest picked, once each, in the list's order. */
export function pickedFileNames(picks: ShareLinkPicks): string[] {
  const names = new Set<string>();
  for (const item of picks.items) if (item.picked > 0 && item.filename) names.add(item.filename);
  return [...names];
}

/** The names as a text file, one per line: a line break inside a name cannot add a line. */
export function namesText(names: readonly string[]): string {
  return names.map((n) => `${n.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}\r\n`).join('');
}

/** Picked cards whose file has no name (a file removed since, for example). */
export function pickedWithoutName(picks: ShareLinkPicks): number {
  return picks.items.filter((i) => i.picked > 0 && !i.filename).length;
}

/** A spreadsheet cell: quoted, and never read as a formula. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvHeadings {
  file: string;
  picked: string;
  rejected: string;
  stars: string;
  ratings: string;
  /** Guest column heading from their name, or for a guest without one. */
  guest: (name: string | null, index: number) => string;
  /** One guest's choice, as a cell. */
  choice: (pick: 'picked' | 'rejected' | null, stars: number | null) => string;
}

/** Proofing results as CSV: totals per picture, then each guest's choice. */
export function picksCsv(picks: ShareLinkPicks, h: CsvHeadings): string {
  const guests = picks.guests;
  const rows: Array<Array<string | number | null>> = [
    [h.file, h.picked, h.rejected, h.stars, h.ratings, ...guests.map((g, i) => h.guest(g.name, i))],
  ];
  for (const item of picks.items) {
    const by = new Map(item.byGuest.map((b) => [b.guestId, b]));
    rows.push([
      item.filename ?? '',
      item.picked,
      item.rejected,
      item.starsAverage === null ? null : Math.round(item.starsAverage * 10) / 10,
      item.starsCount,
      ...guests.map((g) => {
        const b = by.get(g.id);
        return b ? h.choice(b.pick, b.stars) : '';
      }),
    ]);
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
