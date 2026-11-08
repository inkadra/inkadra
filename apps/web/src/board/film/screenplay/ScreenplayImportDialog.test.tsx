// @vitest-environment happy-dom
import { addFrame, addScene, listElements, storyboardOf } from '@inkadra/canvas-core';
import { Dialog } from '@inkadra/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import fountain from './fixtures/last-train.fountain?raw';
import { ScreenplayImportDialog } from './ScreenplayImportDialog.tsx';

const translations = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values && 'count' in values ? `${key}:${values.count}` : key,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => translations,
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function pick(text: string, name = 'last-train.fountain') {
  const input = host.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  const file = new File([text], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label);

it('previews the script and imports the chosen scenes', async () => {
  const onImport = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <ScreenplayImportDialog targets={['append', 'new']} onImport={onImport} onClose={onClose} />,
    ),
  );
  expect(button('screenplay.submit')?.disabled).toBe(true);
  await pick(fountain);
  expect(document.body.textContent).toContain('LAST TRAIN');
  expect(document.body.textContent).toContain('Mara');
  const rows = [...document.querySelectorAll<HTMLInputElement>('.script-import__list input')];
  expect(rows).toHaveLength(5);
  await act(async () => rows[0]?.click());
  expect(document.querySelector('.script-import__summary')?.textContent).toBe('screenplay.summary');
  await act(async () => button('screenplay.submit')?.click());
  const [plan, target] = onImport.mock.calls[0] ?? [];
  expect(target).toBe('append');
  expect(plan.scenes).toHaveLength(4);
  expect(plan.frameCount).toBe(8);
  expect(onClose).toHaveBeenCalled();
});

it('says why a file cannot be read', async () => {
  await act(async () =>
    root.render(<ScreenplayImportDialog targets={['new']} onImport={vi.fn()} onClose={vi.fn()} />),
  );
  await pick('x', 'notes.docx');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    'screenplay.errors.unsupported',
  );
});

it('closes without closing the dialog it was opened from', async () => {
  const outer = vi.fn();
  const inner = vi.fn();
  await act(async () =>
    root.render(
      <Dialog open title="Setup" onClose={outer}>
        <ScreenplayImportDialog targets={['new']} onImport={vi.fn()} onClose={inner} />
      </Dialog>,
    ),
  );
  const dialogs = document.querySelectorAll('dialog');
  await act(async () => dialogs[1]?.dispatchEvent(new Event('close')));
  expect(inner).toHaveBeenCalled();
  expect(outer).not.toHaveBeenCalled();
  expect(dialogs[0]?.open).toBe(true);
  // The outer dialog still closes on its own events.
  await act(async () => dialogs[0]?.dispatchEvent(new Event('close')));
  expect(outer).toHaveBeenCalledTimes(1);
});

it('updates a storyboard from a revision of its script, preselected by the title', async () => {
  // The storyboard of an earlier draft: scene 1 as in the script, scene 9 no longer in it.
  const doc = new Y.Doc();
  const opts = { userId: null };
  const station = addScene(
    doc,
    {
      number: '1',
      title: 'Central Station',
      setting: 'ext',
      location: 'CENTRAL STATION',
      time: 'day',
    },
    opts,
  );
  addFrame(doc, station.id, null, {}, opts);
  const gone = addScene(doc, { number: '9', title: 'Harbour', location: 'HARBOUR' }, opts);
  const groups = storyboardOf(listElements(doc));
  const onImport = vi.fn();
  await act(async () =>
    root.render(
      <ScreenplayImportDialog
        targets={['append', 'revise', 'new']}
        storyboard={{ title: 'Last Train', groups }}
        onImport={onImport}
        onClose={vi.fn()}
      />,
    ),
  );
  await pick(fountain);
  const revise = document.querySelector<HTMLInputElement>('input[value="revise"]');
  expect(revise?.checked).toBe(true);
  expect(document.body.textContent).toContain('screenplay.revision.badges.omitted');
  expect(document.body.textContent).toContain('screenplay.revision.badges.changed');
  await act(async () => button('screenplay.revision.submit')?.click());
  const [plan, target, revision] = onImport.mock.calls[0] ?? [];
  expect(target).toBe('revise');
  expect(plan.scenes).toHaveLength(5);
  expect(revision.version).toBe('screenplay.revision.versionName');
  expect(revision.options).toEqual({ details: true, omit: true });
  const rows = revision.rows as Array<{ status: string; sceneId: string | null }>;
  expect(rows.find((r) => r.sceneId === station.id)?.status).toBe('changed');
  expect(rows.find((r) => r.sceneId === gone.id)?.status).toBe('omitted');
  expect(rows.filter((r) => r.status === 'new')).toHaveLength(4);
});
