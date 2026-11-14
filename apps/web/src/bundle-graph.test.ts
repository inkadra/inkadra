import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Size guard for the code split (#774, #827): walks the static imports the bundler follows
// and fails when a route that should stay light reaches the board editor or the PDF engine.
// shortcut: a regex reads the imports, not a parser; enough for this codebase's import style.

const src = dirname(fileURLToPath(import.meta.url));
const packages = resolve(src, '../../../packages');
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
// `import type` and `export type` vanish at build time; dynamic `import()` starts a new chunk.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveImport(from: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@inkadra/')) {
    const [, name, ...rest] = spec.split('/');
    const pkg = JSON.parse(readFileSync(join(packages, name ?? '', 'package.json'), 'utf8'));
    const target = pkg.exports?.[rest.length ? `./${rest.join('/')}` : '.'];
    if (typeof target !== 'string') return undefined;
    base = join(packages, name ?? '', target);
  } else return undefined;
  return EXTENSIONS.map((ext) => base + ext).find((path) => /\.tsx?$/.test(path) && existsSync(path));
}

/** Files and npm packages statically reachable from `entry`. */
function staticGraph(entry: string) {
  const files = new Set<string>();
  const npm = new Set<string>();
  const todo = [resolve(src, entry)];
  for (let file = todo.pop(); file; file = todo.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const [, spec = ''] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const target = resolveImport(file, spec);
      if (target) todo.push(target);
      else if (!spec.startsWith('.') && !spec.startsWith('@inkadra/'))
        npm.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);
    }
  }
  return { files: new Set([...files].map((f) => relative(src, f).replaceAll('\\', '/'))), npm };
}

const EDITOR_PACKAGES = ['@tiptap/core', '@tiptap/react', '@hocuspocus/provider', 'tus-js-client'];

describe('code split', () => {
  it('keeps the board editor out of Login, Home and Settings', () => {
    const { files, npm } = staticGraph('main.tsx');
    for (const name of [...EDITOR_PACKAGES, 'pdf-lib']) expect(npm).not.toContain(name);
    for (const file of ['board/cards.tsx', 'board/chrome.tsx', 'board/note.tsx', 'board/store.ts'])
      expect(files).not.toContain(file);
  });

  it('keeps the PDF engine and the film views out of the first board paint', () => {
    const { files, npm } = staticGraph('board/BoardPage.tsx');
    expect(npm).not.toContain('pdf-lib');
    for (const view of [
      'board/film/ScheduleView.tsx',
      'board/film/ShotList.tsx',
      'board/film/StoryboardView.tsx',
      'board/film/TroupeView.tsx',
      'board/film/MoodboardView.tsx',
      'board/film/ClientReviewView.tsx',
      'board/plan/ScenePlan.tsx',
      'board/export/ExportDialog.tsx',
    ])
      expect(files).not.toContain(view);
  });

  it('sees through the import styles it relies on', () => {
    // A guard that finds nothing proves nothing: the board page does reach the editor.
    const { files, npm } = staticGraph('board/BoardPage.tsx');
    expect(npm).toContain('react');
    expect(files).toContain('board/BoardPage.tsx');
    expect(staticGraph('board/note.tsx').npm).toContain('@tiptap/react');
  });
});
