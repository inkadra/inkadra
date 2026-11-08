import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewritePage } from './wiki-sync.mjs';

const REPO = 'https://github.com/inkadra/inkadra';

test('links to listed pages become wiki pages, the rest point at the repository', () => {
  const from = 'docs/self-hosting/README.md';
  const page = [
    '[Storage](storage.md#data-on-different-disks)',
    '[Tour](../guide.md) [here](#install) [Docker](https://docs.docker.com/)',
    '[Decision](../decisions/0053-maps.md) [proxies](../../deploy/proxy)',
    '<img src="../screenshots/guide/a-light.png" srcset="../screenshots/guide/a-dark.png">',
  ].join('\n');
  assert.equal(
    rewritePage(page, from),
    [
      '[Storage](Storage#data-on-different-disks)',
      '[Tour](Tour) [here](#install) [Docker](https://docs.docker.com/)',
      `[Decision](${REPO}/blob/main/docs/decisions/0053-maps.md) [proxies](${REPO}/blob/main/deploy/proxy)`,
      '<img src="https://raw.githubusercontent.com/inkadra/inkadra/main/docs/screenshots/guide/a-light.png" srcset="https://raw.githubusercontent.com/inkadra/inkadra/main/docs/screenshots/guide/a-dark.png">',
    ].join('\n'),
  );
});

test('a link to a folder opens its README page', () => {
  assert.equal(rewritePage('[Self-hosting](self-hosting)', 'docs/guide.md'), '[Self-hosting](Self-hosting)');
});
