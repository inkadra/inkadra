#!/usr/bin/env node
// Writes the user-facing pages of docs/ into a checkout of the GitHub wiki, so the wiki is the
// place to read the documentation while docs/ stays the place to write it, through pull requests.
// Usage: node scripts/wiki-sync.mjs <wiki checkout>. Run by .github/workflows/wiki.yml.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/inkadra/inkadra';
const RAW = 'https://raw.githubusercontent.com/inkadra/inkadra/main';

/** Sections of the sidebar: wiki page name and its source in the repository. */
export const SECTIONS = [
  ['Using Inkadra', [['Tour', 'docs/guide.md']]],
  [
    'Self-hosting',
    [
      ['Self-hosting', 'docs/self-hosting/README.md'],
      ['Configuration', 'docs/self-hosting/configuration.md'],
      ['Sign-in', 'docs/self-hosting/sign-in.md'],
      ['Reverse-proxy', 'docs/self-hosting/reverse-proxy.md'],
      ['Storage', 'docs/self-hosting/storage.md'],
      ['Upgrades', 'docs/self-hosting/upgrades.md'],
      ['Troubleshooting', 'docs/self-hosting/troubleshooting.md'],
      ['Office-previews', 'docs/self-hosting/office.md'],
    ],
  ],
  [
    'Formats',
    [
      ['Project-archive', 'docs/formats/project-archive.md'],
      ['Instance-backup', 'docs/formats/instance-backup.md'],
    ],
  ],
  ['Clipper', [['Clipper-privacy-policy', 'docs/store/clipper-privacy-policy.md']]],
];

const PAGES = new Map(SECTIONS.flatMap(([, pages]) => pages.map(([name, src]) => [src, name])));

const isExternal = (target) => /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target);

/** Rewrites one link of the page at `from`: other pages become wiki pages, the rest point at the repository. */
export function rewriteTarget(target, from, image) {
  if (!target || isExternal(target)) return target;
  const [file, anchor] = target.split(/(?=#)/);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), file)).replace(/\/$/, '');
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

function sidebar() {
  const sections = SECTIONS.map(
    ([title, pages]) => `**${title}**\n\n${pages.map(([name]) => `- [${name.replaceAll('-', ' ')}](${name})`).join('\n')}`,
  );
  const more = `**More**\n\n- [Releases](${REPO}/releases)\n- [Discussions](${REPO}/discussions)\n- [Contributing](${REPO}/blob/main/CONTRIBUTING.md)`;
  return `${['[Home](Home)', ...sections, more].join('\n\n')}\n`;
}

function home() {
  return `# Inkadra documentation

Inkadra is a free, open source visual workspace for people who make films and photographs:
moodboards, storyboards, shot lists and client review on an infinite canvas, running on your own
server. Start from the [Tour](Tour) to see the tools, or from [Self-hosting](Self-hosting) to
install it. The pages are listed in the sidebar.

Questions and ideas go to [Discussions](${REPO}/discussions), bugs to [Issues](${REPO}/issues).
`;
}

const FOOTER = `This wiki is generated from [docs/](${REPO}/tree/main/docs) in the repository: to change a page, open a pull request there.\n`;

export function writeWiki(root, out) {
  mkdirSync(out, { recursive: true });
  // The wiki holds only generated pages: the ones removed from the list go away.
  for (const file of readdirSync(out)) if (file.endsWith('.md')) rmSync(path.join(out, file));
  for (const [src, name] of PAGES) {
    const source = path.join(root, src);
    if (!existsSync(source)) throw new Error(`${src} is listed in scripts/wiki-sync.mjs but does not exist`);
    writeFileSync(path.join(out, `${name}.md`), rewritePage(readFileSync(source, 'utf8'), src));
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
