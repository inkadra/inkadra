// @vitest-environment happy-dom
import { DEFAULT_CLASSIFICATIONS } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { setClassifications } from '../lib/classifications.ts';
import { TagEditor, TagList, TagPopover } from './tags.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async (path: string) => (path.includes('/tags') ? { items: [] } : catalog)) },
}));
const catalog = {
  ...DEFAULT_CLASSIFICATIONS,
  tags: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Evening',
      legacy: 'night',
      archived: false,
    },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Retired', legacy: 'old', archived: true },
  ],
};
const host = document.createElement('div');
const root = createRoot(host);
afterEach(async () => {
  await act(async () => root.render(null));
  setClassifications(DEFAULT_CLASSIFICATIONS);
});
it('renders renamed and retired legacy tags without mutating documents', async () => {
  setClassifications(catalog);
  await act(async () => root.render(<TagList tags={['Night', 'old', 'unmanaged']} />));
  expect(host.textContent).toBe('EveningRetiredunmanaged');
});
it('offers active options, stores IDs and prevents duplicate legacy selections', async () => {
  const change = vi.fn();
  setClassifications(catalog);
  await act(async () =>
    root.render(<TagEditor tags={[]} onChange={change} readOnly={false} projectId="p" />),
  );
  const suggestions = host.querySelector('.tag-suggest');
  expect(suggestions?.textContent).toContain('Evening');
  expect(suggestions?.textContent).not.toContain('Retired');
  await act(async () => suggestions?.querySelector<HTMLButtonElement>('button')?.click());
  expect(change).toHaveBeenCalledWith([catalog.tags[0]!.id]);
  await act(async () =>
    root.render(<TagEditor tags={['night']} onChange={change} readOnly={false} projectId="p" />),
  );
  expect(host.querySelector('.tag-suggest')).toBeNull();
  expect(host.querySelector('.tag-chip')?.textContent).toContain('Evening');
});

it('removes a shared managed tag from mixed legacy and UUID selections', async () => {
  const change = vi.fn();
  setClassifications(catalog);
  await act(async () =>
    root.render(
      <TagPopover
        x={0}
        y={0}
        projectId="p"
        elements={[
          { id: 'a', tags: ['night'] },
          { id: 'b', tags: [catalog.tags[0]!.id] },
        ]}
        onChange={change}
        onClose={() => {}}
      />,
    ),
  );
  expect(host.querySelector('.tag-chip')?.textContent).toContain('Evening');
  await act(async () => host.querySelector<HTMLButtonElement>('.tag-chip__remove')?.click());
  expect(change).toHaveBeenCalledWith([
    { id: 'a', tags: undefined },
    { id: 'b', tags: undefined },
  ]);
});
it('does not duplicate a legacy tag when adding its managed ID to multiple cards', async () => {
  const change = vi.fn();
  setClassifications(catalog);
  await act(async () =>
    root.render(
      <TagPopover
        x={0}
        y={0}
        projectId="p"
        elements={[
          { id: 'a', tags: ['night', 'unmanaged'] },
          { id: 'b', tags: [] },
        ]}
        onChange={change}
        onClose={() => {}}
      />,
    ),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('.tag-suggest button')?.click());
  expect(change).toHaveBeenCalledWith([
    { id: 'a', tags: [catalog.tags[0]!.id, 'unmanaged'] },
    { id: 'b', tags: [catalog.tags[0]!.id] },
  ]);
});
