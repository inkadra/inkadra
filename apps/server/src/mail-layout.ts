/**
 * The one layout of every email: a complete HTML document built from tables and inline styles,
 * with a plain text part carrying the same content. Colours come from the tokens of packages/ui;
 * the light theme is inline and a prefers-color-scheme block switches the classes to the dark
 * one where the client supports it. No images and no external resources of any kind.
 * Every value is escaped here, so callers pass plain strings, never HTML.
 */
import { type ColorToken, dark, light } from '@inkadra/ui/tokens';
import type { Mail } from './mailer.ts';

const ROLES = {
  page: 'bg-rail',
  card: 'surface-1',
  soft: 'surface-2',
  border: 'border-default',
  text: 'text-primary',
  sec: 'text-secondary',
  accent: 'accent-button',
  onAccent: 'on-accent',
  link: 'accent-soft-fg',
  accentBg: 'accent-soft-bg',
  accentFg: 'accent-soft-fg',
  tile: 'logo-tile',
  tileInk: 'logo-ink',
  okBg: 'tag-green-bg',
  okFg: 'tag-green',
  warnBg: 'tag-orange-bg',
  warnFg: 'tag-orange',
  dangerBg: 'danger-bg',
  dangerFg: 'danger-fg',
} satisfies Record<string, ColorToken>;
type Role = keyof typeof ROLES | 'tileInk2';

/** `a` over `b` at `alpha`: the logo's second frame, which the app draws at 55% opacity. */
function over(a: string, b: string, alpha: number) {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(a, i) * alpha + ch(b, i) * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

const colour = (theme: Record<ColorToken, string>, role: Role) =>
  role === 'tileInk2'
    ? over(theme['logo-ink'], theme['logo-tile'], 0.55)
    : theme[ROLES[role]];

const ALL_ROLES = [...Object.keys(ROLES), 'tileInk2'] as Role[];
const DARK_CSS = ALL_ROLES.map((role) => {
  const c = colour(dark, role);
  return `.ink-fg-${role}{color:${c}!important}.ink-bg-${role}{background-color:${c}!important}.ink-bd-${role}{border-color:${c}!important}`;
}).join('');

const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Class and inline style for colour roles: light inline, dark through the classes. */
function paint(p: { fg?: Role; bg?: Role; bd?: Role }, style = '') {
  const classes: string[] = [];
  let colours = '';
  if (p.fg) {
    classes.push(`ink-fg-${p.fg}`);
    colours += `color:${colour(light, p.fg)};`;
  }
  if (p.bg) {
    classes.push(`ink-bg-${p.bg}`);
    colours += `background-color:${colour(light, p.bg)};`;
  }
  if (p.bd) {
    classes.push(`ink-bd-${p.bd}`);
    colours += `border-color:${colour(light, p.bd)};`;
  }
  return ` class="${classes.join(' ')}" style="${style}${colours}"`;
}

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

export type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
export interface Chip {
  label: string;
  tone: Tone;
}
export interface MailRow {
  who: string;
  what: string;
  chip?: Chip | null;
  quote?: string | null;
  when: string;
  link?: { label: string; url: string } | null;
}
export interface MailContent {
  to: string;
  subject: string;
  /** Language of the texts, for the document. */
  lang: string;
  instanceName: string;
  /** Inbox preview text, hidden in the body. */
  preheader: string;
  badge?: Chip;
  title: string;
  intro?: string;
  banners?: string[];
  facts?: Array<[string, string]>;
  row?: MailRow;
  groups?: Array<{ title: string; rows: MailRow[] }>;
  list?: string[];
  action: { label: string; url: string };
  /** The line above the copyable address of the action, for links that must work anyway. */
  fallback?: string;
  /** Muted line after the button; `strong` is a part of `text` set in bold. */
  note?: { text: string; strong?: string };
  footer: { text: string; link?: { label: string; url: string }; after?: string };
}

const TONES: Record<Tone, [Role, Role]> = {
  ok: ['okBg', 'okFg'],
  warn: ['warnBg', 'warnFg'],
  danger: ['dangerBg', 'dangerFg'],
  accent: ['accentBg', 'accentFg'],
  neutral: ['soft', 'sec'],
};

const chip = ({ label, tone }: Chip) =>
  `<span${paint(
    { bg: TONES[tone][0], fg: TONES[tone][1] },
    `display:inline-block;padding:2px 8px;border-radius:999px;font:500 12px/18px ${FONT};white-space:nowrap;`,
  )}>${esc(label)}</span>`;

const link = (url: string, label: string) =>
  `<a href="${esc(url)}"${paint({ fg: 'link' }, 'text-decoration:underline;')}>${esc(label)}</a>`;

const logo = () =>
  `<table ${TABLE} style="border-collapse:separate"><tr>` +
  `<td${paint({ bg: 'tile' }, 'border-radius:8px;width:30px;height:30px;text-align:center;vertical-align:middle;padding:0;')}>` +
  `<table ${TABLE} align="center" style="margin:0 auto"><tr>` +
  `<td${paint({ bg: 'tileInk' }, 'width:8px;height:10px;border-radius:2px;font-size:0;line-height:0;')}>&nbsp;</td>` +
  '<td style="width:2px;font-size:0;line-height:0">&nbsp;</td>' +
  `<td${paint({ bg: 'tileInk2' }, 'width:8px;height:10px;border-radius:2px;font-size:0;line-height:0;')}>&nbsp;</td>` +
  '</tr></table></td>' +
  `<td${paint({ fg: 'text' }, `padding-left:10px;font:600 17px/1 ${FONT};letter-spacing:-0.3px;`)}>Inkadra</td>` +
  '</tr></table>';

const title = (s: string) =>
  `<h1${paint({ fg: 'text' }, `margin:0;font:600 20px/27px ${FONT};letter-spacing:-0.2px;overflow-wrap:anywhere;`)}>${esc(s)}</h1>`;

const para = (html: string, muted = true) =>
  `<p${paint({ fg: muted ? 'sec' : 'text' }, `margin:10px 0 0;font:400 14px/22px ${FONT};overflow-wrap:anywhere;`)}>${html}</p>`;

const spacer = '<div style="height:10px;font-size:0;line-height:0">&nbsp;</div>';

const button = (label: string, url: string) =>
  `<table ${TABLE} style="margin:22px 0 0;border-collapse:separate"><tr>` +
  `<td${paint({ bg: 'accent' }, 'border-radius:8px;')}><a href="${esc(url)}"${paint(
    { fg: 'onAccent' },
    `display:inline-block;padding:11px 20px;font:600 14px/20px ${FONT};text-decoration:none;`,
  )}>${esc(label)}</a></td></tr></table>`;

const facts = (rows: Array<[string, string]>) =>
  `<table ${TABLE} width="100%"${paint({ bg: 'soft' }, 'margin:18px 0 0;border-radius:12px;border-collapse:separate;')}>` +
  rows
    .map(([k, v], i) => {
      const pad = `padding-top:${i ? 0 : 12}px;padding-bottom:${i === rows.length - 1 ? 12 : 10}px;`;
      return (
        `<tr><td${paint({ fg: 'sec' }, `${pad}padding-left:14px;padding-right:8px;font:400 13px/18px ${FONT};white-space:nowrap;vertical-align:top;width:1%;`)}>${esc(k)}</td>` +
        `<td${paint({ fg: 'text' }, `${pad}padding-left:8px;padding-right:14px;font:500 13px/18px ${FONT};overflow-wrap:anywhere;word-break:break-word;`)}>${esc(v)}</td></tr>`
      );
    })
    .join('') +
  '</table>';

const banner = (s: string) =>
  `<table ${TABLE} width="100%"${paint({ bg: 'warnBg' }, 'margin:16px 0 0;border-radius:12px;border-collapse:separate;')}><tr>` +
  `<td${paint({ fg: 'warnFg' }, `padding:10px 14px;font:500 13px/19px ${FONT};overflow-wrap:anywhere;`)}>${esc(s)}</td></tr></table>`;

/** Initials of the first two words, letters and digits only. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const row = (r: MailRow) =>
  `<table ${TABLE} width="100%" style="margin:0"><tr>` +
  `<td style="width:30px;vertical-align:top;padding:0 10px 0 0"><div${paint(
    { bg: 'soft', fg: 'sec' },
    `width:30px;height:30px;border-radius:999px;font:600 11px/30px ${FONT};text-align:center;`,
  )}>${esc(initials(r.who))}</div></td>` +
  `<td${paint({ fg: 'text' }, `vertical-align:top;font:400 14px/20px ${FONT};overflow-wrap:anywhere;word-break:break-word;`)}>` +
  `<strong style="font-weight:600">${esc(r.who)}</strong> ${esc(r.chip ? `${r.what}:` : r.what)}${r.chip ? ` ${chip(r.chip)}` : ''}` +
  (r.quote
    ? `<div${paint({ bg: 'soft', fg: 'text' }, 'margin:6px 0 0;padding:8px 12px;border-radius:8px;font-size:13px;line-height:19px;')}>${esc(r.quote)}</div>`
    : '') +
  `<div${paint({ fg: 'sec' }, 'margin-top:4px;font-size:12px;line-height:18px;')}>${esc(r.when)}${r.link ? ` · ${link(r.link.url, r.link.label)}` : ''}</div>` +
  '</td></tr></table>';

const group = (heading: string, rows: MailRow[], first: boolean) =>
  `<div${paint({ fg: 'sec', bd: 'border' }, `margin:${first ? 18 : 20}px 0 0;font:600 12px/18px ${FONT};padding-bottom:8px;border-bottom:1px solid;overflow-wrap:anywhere;`)}>${esc(heading)}</div>` +
  rows.map((r) => `<div style="padding:12px 0 0">${row(r)}</div>`).join('');

const list = (items: string[]) =>
  items
    .map(
      (item, i) =>
        `<table ${TABLE} width="100%" style="margin:${i ? 12 : 18}px 0 0"><tr>` +
        `<td${paint({ fg: 'sec' }, `width:20px;vertical-align:top;font:600 13px/20px ${FONT};`)}>${i + 1}</td>` +
        `<td${paint({ fg: 'text' }, `font:400 14px/20px ${FONT};overflow-wrap:anywhere;`)}>${esc(item)}</td></tr></table>`,
    )
    .join('');

function note({ text, strong }: { text: string; strong?: string }) {
  const at = strong ? text.indexOf(strong) : -1;
  const html =
    strong && at >= 0
      ? `${esc(text.slice(0, at))}<strong${paint({ fg: 'text' }, 'font-weight:600;')}>${esc(strong)}</strong>${esc(text.slice(at + strong.length))}`
      : esc(text);
  return para(`<span style="font-size:13px">${html}</span>`);
}

const fallback = (lead: string, url: string) =>
  `<p${paint({ fg: 'sec' }, `margin:14px 0 0;font:400 12px/18px ${FONT};overflow-wrap:anywhere;word-break:break-all;`)}>${esc(lead)}<br>${link(url, url)}</p>`;

function html(c: MailContent) {
  const body = [
    c.badge ? chip(c.badge) + spacer : '',
    title(c.title),
    c.intro ? para(esc(c.intro)) : '',
    ...(c.banners ?? []).map(banner),
    c.facts?.length ? facts(c.facts) : '',
    c.row ? `<div style="margin:16px 0 0">${row(c.row)}</div>` : '',
    ...(c.groups ?? []).map((g, i) => group(g.title, g.rows, i === 0)),
    c.list?.length ? list(c.list) : '',
    button(c.action.label, c.action.url),
    c.note ? note(c.note) : '',
    c.fallback ? fallback(c.fallback, c.action.url) : '',
  ].join('');
  const { footer } = c;
  const foot =
    esc(footer.text) +
    (footer.link ? ` ${link(footer.link.url, footer.link.label)}` : '') +
    esc(footer.after ?? '');
  const instance =
    c.instanceName !== 'Inkadra'
      ? `<td align="right"${paint({ fg: 'sec' }, `padding:0 4px 14px 12px;font:400 12px/18px ${FONT};overflow-wrap:anywhere;`)}>${esc(c.instanceName)}</td>`
      : '';
  return [
    `<!doctype html><html lang="${esc(c.lang)}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>${esc(c.subject)}</title>`,
    `<style>:root{color-scheme:light dark}@media (prefers-color-scheme:dark){${DARK_CSS}}</style>`,
    `</head><body${paint({ bg: 'page' }, 'margin:0;padding:0;')}>`,
    `<div${paint({ fg: 'page', bg: 'page' }, 'display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;')}>${esc(c.preheader)}</div>`,
    `<table ${TABLE} width="100%"${paint({ bg: 'page' }, '')}><tr><td style="padding:20px 12px">`,
    `<table ${TABLE} align="center" width="100%" style="max-width:560px;margin:0 auto;border-collapse:separate"><tr><td>`,
    `<table ${TABLE} width="100%" style="border-collapse:separate"><tr><td style="padding:0 4px 14px">${logo()}</td>${instance}</tr></table>`,
    `<table ${TABLE} width="100%"${paint({ bg: 'card', bd: 'border' }, 'border:1px solid;border-radius:16px;border-collapse:separate;')}><tr><td style="padding:24px 22px">${body}</td></tr></table>`,
    `<div${paint({ fg: 'sec' }, `padding:14px 4px 0;font:400 12px/18px ${FONT};overflow-wrap:anywhere;`)}>${foot}</div>`,
    '</td></tr></table>',
    '</td></tr></table></body></html>',
  ].join('');
}

function textRow(r: MailRow, bullet = '') {
  const pad = ' '.repeat(bullet.length);
  return [
    `${bullet}${r.who} ${r.chip ? `${r.what}: ${r.chip.label}` : r.what}`,
    ...(r.quote ? [`${pad}“${r.quote}”`] : []),
    `${pad}${r.when}${r.link ? ` · ${r.link.url}` : ''}`,
  ];
}

function text(c: MailContent) {
  const blocks: string[][] = [
    [c.instanceName],
    [...(c.badge ? [c.badge.label] : []), c.title, ...(c.intro ? [c.intro] : [])],
  ];
  if (c.banners?.length) blocks.push(c.banners);
  if (c.facts?.length) blocks.push(c.facts.map(([k, v]) => `${k}: ${v}`));
  if (c.row) blocks.push(textRow(c.row));
  for (const g of c.groups ?? []) blocks.push([g.title, ...g.rows.flatMap((r) => textRow(r, '- '))]);
  if (c.list?.length) blocks.push(c.list.map((item, i) => `${i + 1}. ${item}`));
  blocks.push([`${c.action.label}: ${c.action.url}`, ...(c.note ? [c.note.text] : [])]);
  const { footer } = c;
  blocks.push([
    footer.link ? `${footer.text} ${footer.link.label}: ${footer.link.url}` : footer.text,
  ]);
  return blocks.map((b) => b.join('\n')).join('\n\n');
}

export function renderMail(c: MailContent): Mail {
  return { to: c.to, subject: c.subject, text: text(c), html: html(c) };
}
