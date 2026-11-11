// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { Button } from './components.tsx';

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
