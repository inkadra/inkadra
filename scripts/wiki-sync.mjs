#!/usr/bin/env node
// Writes the user-facing pages of docs/ into a checkout of the GitHub wiki, so the wiki is the
// place to read the documentation while docs/ stays the place to write it, through pull requests.
// Usage: node scripts/wiki-sync.mjs <wiki checkout>. Run by .github/workflows/wiki.yml.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/inkadra/inkadra';
const RAW = 'https://raw.githubusercontent.com/inkadra/inkadra/main';

/** Sections of the sidebar and of Home: wiki page, source, label and what the page covers. */
export const SECTIONS = [
  ['Using Inkadra', [['Tour', 'docs/guide.md', 'Tour', 'The main tools, with pictures']]],
  [
    'Self-hosting',
    [
      [
        'Self-hosting',
        'docs/self-hosting/README.md',
        'Installing',
        'From an empty folder to your first sign-in',
      ],
      [
        'Configuration',
        'docs/self-hosting/configuration.md',
        'Configuration',
        'Every setting in `.env`',
      ],
      [
        'Sign-in',
        'docs/self-hosting/sign-in.md',
        'Sign-in',
        'Google, OIDC, email, invitations, two-factor',
      ],
      [
        'Reverse-proxy',
        'docs/self-hosting/reverse-proxy.md',
        'Reverse proxy',
        'Caddy, Traefik, Nginx, Nginx Proxy Manager, Pangolin',
      ],
      [
        'Storage',
        'docs/self-hosting/storage.md',
        'Storage',
        'Volumes, data on different disks, S3, bundled RustFS',
      ],
      [
        'Upgrades',
        'docs/self-hosting/upgrades.md',
        'Upgrades',
        'Versions, updating, verifying images',
      ],
      [
        'Troubleshooting',
        'docs/self-hosting/troubleshooting.md',
        'Troubleshooting',
        'What to check when something does not work',
      ],
      [
        'Office-previews',
        'docs/self-hosting/office.md',
        'Office previews',
        'The optional LibreOffice worker',
      ],
    ],
  ],
  [
    'Formats',
    [
      [
        'Project-archive',
        'docs/formats/project-archive.md',
        'Project archive',
        'What a project export holds',
      ],
      [
        'Instance-backup',
        'docs/formats/instance-backup.md',
        'Instance backup',
        'What a nightly backup holds',
      ],
    ],
  ],
  [
    'Clipper',
    [
      [
        'Clipper-privacy-policy',
        'docs/store/clipper-privacy-policy.md',
        'Privacy policy',
        'What the browser extension saves and sends',
      ],
    ],
  ],
];

const PAGES = new Map(SECTIONS.flatMap(([, pages]) => pages.map(([name, src]) => [src, name])));

const isExternal = (target) => /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target);

/** Rewrites one link of the page at `from`: other pages become wiki pages, the rest point at the repository. */
export function rewriteTarget(target, from, image) {
  if (!target || isExternal(target)) return target;
  const [file, anchor] = target.split(/(?=#)/);
  const resolved = path.posix
    .normalize(path.posix.join(path.posix.dirname(from), file))
    .replace(/\/$/, '');
  const page = PAGES.get(resolved) ?? PAGES.get(`${resolved}/README.md`);
  if (page) return page + (anchor ?? '');
  return `${image ? RAW : `${REPO}/blob/main`}/${resolved}${anchor ?? ''}`;
}

/** Rewrites the Markdown links and images and the HTML src, srcset and href of a page. */
export function rewritePage(text, from) {
  return text
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (_, bang, label, target, title) => {
      return `${bang}[${label}](${rewriteTarget(target, from, bang === '!')}${title})`;
    })
    .replace(/\b(src|srcset|href)="([^"]+)"/g, (_, attr, target) => {
      return `${attr}="${rewriteTarget(target, from, attr !== 'href')}"`;
    });
}

/** A docs page as a wiki page: the wiki shows the page name as its title, so the H1 goes. */
export function wikiPage(text, from) {
  return rewritePage(text.replace(/^# .*\n+/, ''), from);
}

const picture = (light, dark, alt, width) =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="${RAW}/${dark}"><img src="${RAW}/${light}" alt="${alt}"${width ? ` width="${width}"` : ''}></picture>`;

const LOGO = (width) =>
  picture('docs/assets/logo-light.svg', 'docs/assets/logo-dark.svg', 'Inkadra', width);
const SHOT = (name, alt) =>
  picture(
    `docs/screenshots/readme/${name}-light.png`,
    `docs/screenshots/readme/${name}-dark.png`,
    alt,
  );

function sidebar() {
  const sections = SECTIONS.map(
    ([title, pages]) =>
      `**${title}**\n\n${pages.map(([name, , label]) => `- [${label}](${name})`).join('\n')}`,
  );
  const more = `**More**\n\n- [Releases](${REPO}/releases)\n- [Discussions](${REPO}/discussions)\n- [Contributing](${REPO}/blob/main/CONTRIBUTING.md)`;
  return `${[`<p align="center"><a href="Home">${LOGO(140)}</a></p>`, ...sections, more].join('\n\n')}\n`;
}

function home() {
  const tables = SECTIONS.filter(([title]) => title !== 'Using Inkadra').map(
    ([title, pages]) =>
      `## ${title}\n\n| Page | What it covers |\n| --- | --- |\n${pages.map(([name, , label, about]) => `| [${label}](${name}) | ${about} |`).join('\n')}`,
  );
  return `<p align="center">${LOGO(240)}</p>

<p align="center"><strong>Self-hosted boards for film and photography. From idea to frame.</strong></p>

<p align="center">
  <a href="Tour">Tour</a> ·
  <a href="Self-hosting">Install</a> ·
  <a href="Upgrades">Upgrades</a> ·
  <a href="${REPO}/releases">Releases</a> ·
  <a href="${REPO}/discussions">Discussions</a>
</p>

<p align="center">${SHOT('board', 'A moodboard in Inkadra: notes, film stills, a column of references, a colour palette and a checklist on an infinite canvas')}</p>

Inkadra is a free, open source workspace for people who make films and photographs: moodboards, storyboards, shot lists, set plans and client review on an infinite canvas, on your own server. Try it on the [public demo](https://demo.inkadra.com), with no account.

## Start here

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="Tour">${SHOT('storyboard', 'A storyboard: scenes with their frames, shot sizes and status')}</a>
      <p><strong><a href="Tour">Tour</a></strong><br>Boards, storyboards, shot lists, set plans and client review: what each tool does and where to find it.</p>
    </td>
    <td width="50%" valign="top">
      <a href="Self-hosting">${SHOT('home', 'Home: the shooting day, the recent boards and activity')}</a>
      <p><strong><a href="Self-hosting">Install Inkadra</a></strong><br>From an empty folder to your first sign-in with Docker Compose, on a VPS, a home server or a NAS.</p>
    </td>
  </tr>
</table>

${tables.join('\n\n')}

## Help

- **Questions and ideas:** [Discussions](${REPO}/discussions)
- **Bugs:** [Issues](${REPO}/issues)
- **Security problems:** [Security policy](${REPO}/blob/main/SECURITY.md)
`;
}

const FOOTER = `<sub>This wiki is generated from <a href="${REPO}/tree/main/docs">docs/</a>: to change a page, open a pull request there. · <a href="${REPO}">Repository</a> · <a href="${REPO}/releases">Releases</a> · Licensed under AGPL-3.0 and MPL-2.0</sub>\n`;

export function writeWiki(root, out) {
  mkdirSync(out, { recursive: true });
  // The wiki holds only generated pages: the ones removed from the list go away.
  for (const file of readdirSync(out)) if (file.endsWith('.md')) rmSync(path.join(out, file));
  for (const [src, name] of PAGES) {
    const source = path.join(root, src);
    if (!existsSync(source))
      throw new Error(`${src} is listed in scripts/wiki-sync.mjs but does not exist`);
    writeFileSync(path.join(out, `${name}.md`), wikiPage(readFileSync(source, 'utf8'), src));
  }
  writeFileSync(path.join(out, 'Home.md'), home());
  writeFileSync(path.join(out, '_Sidebar.md'), sidebar());
  writeFileSync(path.join(out, '_Footer.md'), FOOTER);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node scripts/wiki-sync.mjs <wiki checkout>');
    process.exit(1);
  }
  writeWiki(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out);
}
