// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { Button, Input, TextArea } from './components.tsx';

it('disables a busy button and marks it aria-busy', () => {
  expect(Button({ busy: true, children: 'Go' }).props).toMatchObject({
    disabled: true,
    'aria-busy': true,
  });
  expect(Button({ children: 'Go' }).props).toMatchObject({
    disabled: undefined,
    'aria-busy': undefined,
  });
  expect(Button({ disabled: true, busy: false, children: 'Go' }).props.disabled).toBe(true);
});

it('draws a link as a button, with the same look and no button-only attributes', () => {
  const link = Button({
    href: '/a.pdf',
    download: 'a.pdf',
    variant: 'primary',
    size: 'lg',
    icon: 'download',
    children: 'Download',
  });
  expect(link.type).toBe('a');
  expect(link.props).toMatchObject({
    href: '/a.pdf',
    download: 'a.pdf',
    className: 'ink-btn ink-btn--primary ink-btn--lg',
  });
  expect(link.props).not.toHaveProperty('type');
  expect(link.props).not.toHaveProperty('variant');
  expect(Button({ children: 'Go' }).type).toBe('button');
});

it('gives text inputs the field look, keeping their own class and ref', () => {
  const ref = { current: null };
  const input = Input({ className: 'wide', ref, placeholder: 'Name' });
  expect(input.type).toBe('input');
  expect(input.props).toMatchObject({ className: 'ink-input wide', placeholder: 'Name', ref });
  expect(TextArea({ rows: 3 }).props).toMatchObject({ className: 'ink-input', rows: 3 });
});
