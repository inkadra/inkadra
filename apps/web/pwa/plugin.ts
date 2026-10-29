import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dark } from '@inkadra/ui/tokens';
import { build, type Plugin } from 'vite';
import { isPrecached, OFFLINE_PAGE } from '../src/pwa/routing.ts';
import { iconPng } from './icons.ts';
import { ICONS, offlinePage, offlineScript, themeColor, webManifest } from './pages.ts';

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(file(path), 'utf8'));

/**
 * Makes the production build installable: manifest, icons, offline page and /sw.js with the
 * list of this build's files. Nothing changes in development, where no worker is registered.
 */
export function pwa(): Plugin {
  return {
    name: 'inkadra-pwa',
    apply: 'build',

    transformIndexHtml() {
      // At the end of <head>, so that <meta charset> stays first.
      const injectTo = 'head' as const;
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `/${ICONS.apple}` }, injectTo },
        ...(['dark', 'light'] as const).map((scheme) => ({
          tag: 'meta',
          attrs: {
            name: 'theme-color',
            content: themeColor[scheme],
            media: `(prefers-color-scheme: ${scheme})`,
          },
          injectTo,
        })),
      ];
    },

    generateBundle() {
      const it = json('../src/i18n/it.json');
      const en = json('../src/i18n/en.json');
      const colours = { tile: dark['logo-tile'], ink: dark['logo-ink'] };
      const emit = (fileName: string, source: string | Uint8Array) =>
        this.emitFile({ type: 'asset', fileName, source });

      emit('manifest.webmanifest', `${JSON.stringify(webManifest(it), null, 2)}\n`);
      emit('offline.js', offlineScript);
      emit(OFFLINE_PAGE.slice(1), offlinePage({ it, en }));
      emit(ICONS.any192, iconPng({ size: 192, ...colours }));
      emit(ICONS.any512, iconPng({ size: 512, ...colours }));
      // Maskable icons are cropped to a circle as small as 80% of the side.
      emit(ICONS.maskable, iconPng({ size: 512, ...colours, fullBleed: true, scale: 0.8 }));
      emit(ICONS.apple, iconPng({ size: 180, ...colours, fullBleed: true, scale: 0.9 }));
    },

    async writeBundle(output, bundle) {
      const names = Object.keys(bundle).filter(isPrecached).sort();
      const precache = [OFFLINE_PAGE, ...names.map((name) => `/${name}`)];
      // Fingerprinted names change with their content; the offline page has to be hashed.
      const offline = bundle[OFFLINE_PAGE.slice(1)];
      const version = createHash('sha256')
        .update(precache.join('\n'))
        .update(offlineScript)
        .update(offline?.type === 'asset' ? offline.source : '')
        .digest('hex')
        .slice(0, 16);

      // The worker is its own small bundle: one classic script, no imports, at the site root.
      await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __PRECACHE__: JSON.stringify(precache),
          __CACHE_VERSION__: JSON.stringify(version),
        },
        build: {
          outDir: output.dir,
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          lib: {
            entry: file('../src/pwa/sw.ts'),
            formats: ['iife'],
            name: 'inkadraServiceWorker',
            fileName: () => 'sw.js',
          },
        },
      });
    },
  };
}
