// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import en from '../i18n/en.json';
import itTexts from '../i18n/it.json';
import { relativeTaskDay, TodoAssignment } from './TodoAssignment.tsx';

const state = vi.hoisted(() => ({ language: 'it' as 'it' | 'en' }));
vi.mock('./context.ts', async (original) => ({
  ...(await original<object>()),
  useBoard: () => ({ readOnly: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: state.language },
    t: (key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part],
          state.language === 'it' ? itTexts : en,
        ),
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  state.language = 'it';
});
const item = {
  id: 'todo-item',
  text: 'Permit',
  done: false,
  assigneeId: 'person',
  dueDate: '2026-11-01',
};
function render(name: string, image: string | null = null, date = item.dueDate) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1, 23, 59));
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <TodoAssignment
      elementId="todo-card"
      item={{ ...item, dueDate: date }}
      editing={false}
      open={false}
      onClose={() => {}}
      people={[{ id: 'person', name, image, email: null }]}
      failed={false}
    />,
  );
  return host;
}
it('uses neutral initials only, with the full name in the tooltip and accessible label', () => {
  const host = render('Giulia Bianchi', 'https://example.com/avatar.png');
  const assignee = host.querySelector('.todo-assignment__person')!;
  expect(assignee.textContent).toBe('GB');
  expect(assignee.getAttribute('title')).toBe('Giulia Bianchi');
  expect(assignee.getAttribute('aria-label')).toBe('Giulia Bianchi');
  expect(assignee.querySelector('img')).toBeNull();
  expect(assignee.className).not.toMatch(/danger|warning/);
  expect(host.querySelector('.todo-assignment__date')?.className).toContain('warning');
});
it('uses initials from a full name and falls back to a short handle without avatar data', () => {
  expect(render('Giulia Bianchi').querySelector('.todo-assignment__person')?.textContent).toBe(
    'GB',
  );
  const assignee = render('Leo').querySelector('.todo-assignment__person')!;
  expect(assignee.textContent).toBe('@Leo');
  expect(assignee.querySelector('.ink-avatar')).toBeNull();
});
it('localises near dates and keeps older overdue dates short and dangerous', () => {
  for (const language of ['it', 'en'] as const) {
    state.language = language;
    for (const [date, word] of [
      ['2026-10-31', language === 'it' ? 'ieri' : 'yesterday'],
      ['2026-11-01', language === 'it' ? 'oggi' : 'today'],
      ['2026-11-02', language === 'it' ? 'domani' : 'tomorrow'],
    ]) {
      expect(
        render('Giulia Bianchi', null, date).querySelector('.todo-assignment__date')?.textContent,
      ).toBe(word);
    }
  }
  state.language = 'it';
  const host = render('Giulia Bianchi', null, '2026-10-29');
  expect(host.querySelector('.todo-assignment__date')?.textContent).toBe('29 ott');
  expect(host.querySelector('.todo-assignment__date')?.className).toContain('danger');
  expect(host.querySelector('.todo-assignment__person')?.className).not.toMatch(/danger|warning/);
});
it('finds local calendar neighbours across DST, month and year boundaries', () => {
  expect(relativeTaskDay('2026-10-31', new Date(2026, 10, 1, 23, 59))).toBe('yesterday');
  expect(relativeTaskDay('2027-01-01', new Date(2026, 11, 31, 23, 59))).toBe('tomorrow');
  expect(relativeTaskDay('2026-10-29', new Date(2026, 10, 1))).toBeNull();
});
