// @vitest-environment happy-dom
import {
  Checkbox,
  ChoiceTile,
  IconButton,
  RadioGroup,
  Segmented,
  Switch,
  TooltipProvider,
} from '@inkadra/ui';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  HTMLElement.prototype.showPopover = vi.fn();
  HTMLElement.prototype.hidePopover = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Choices() {
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(true);
  const [size, setSize] = useState<'a4' | 'letter'>('a4');
  const [mode, setMode] = useState<'list' | 'grid'>('list');
  return (
    <form>
      <label>
        <Checkbox name="agree" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Agree
      </label>
      <label>
        <Checkbox indeterminate readOnly checked={false} />
        Some
      </label>
      <label>
        <Switch name="nightly" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Nightly
      </label>
      <RadioGroup
        label="Paper"
        name="paper"
        value={size}
        onChange={setSize}
        options={[
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Letter', description: 'US' },
        ]}
      />
      <Segmented
        label="View"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'list', label: 'List' },
          { value: 'grid', label: 'Grid' },
        ]}
      />
    </form>
  );
}

it('keeps native semantics, labels and form values for checkbox, switch and radios', async () => {
  await act(async () => root.render(<Choices />));
  const form = host.querySelector('form') as HTMLFormElement;
  const agree = host.querySelector<HTMLInputElement>('input[name="agree"]');
  expect(agree?.type).toBe('checkbox');
  await act(async () => agree?.closest('label')?.click());
  expect(agree?.checked).toBe(true);
  expect(new FormData(form).get('agree')).toBe('on');

  const some = host.querySelectorAll<HTMLInputElement>('.ink-checkbox input')[1];
  expect(some?.indeterminate).toBe(true);

  const nightly = host.querySelector<HTMLInputElement>('input[name="nightly"]');
  expect(nightly?.getAttribute('role')).toBe('switch');
  await act(async () => nightly?.click());
  expect(nightly?.checked).toBe(false);

  const paper = host.querySelectorAll('fieldset')[0] as HTMLFieldSetElement;
  expect(paper.querySelector('legend')?.textContent).toBe('Paper');
  expect(paper.textContent).toContain('US');
  await act(async () => paper.querySelector<HTMLInputElement>('input[value="letter"]')?.click());
  expect(new FormData(form).get('paper')).toBe('letter');

  const view = host.querySelectorAll('fieldset')[1] as HTMLFieldSetElement;
  expect(view.classList).toContain('ink-segmented');
  expect(view.querySelector('legend')?.className).toBe('ink-sr-only');
  const grid = view.querySelector<HTMLInputElement>('input[value="grid"]');
  await act(async () => grid?.click());
  expect(grid?.checked).toBe(true);
  expect(view.querySelector<HTMLInputElement>('input[value="list"]')?.checked).toBe(false);
});

it('shows the tooltip after the hover delay, at once on keyboard focus, and hides on scroll', async () => {
  vi.useFakeTimers();
  await act(async () =>
    root.render(
      <TooltipProvider>
        <IconButton icon="plus" label="Add frame" />
        <button type="button" data-ink-tooltip="Needs an email first">
          Reset
        </button>
      </TooltipProvider>,
    ),
  );
  const chip = document.getElementById('ink-tooltip-layer') as HTMLElement;
  const add = host.querySelector<HTMLButtonElement>('[aria-label="Add frame"]') as HTMLElement;
  expect(add.hasAttribute('title')).toBe(false);
  expect(chip.getAttribute('role')).toBe('tooltip');
  expect(chip.hidden).toBe(true);

  add.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  await act(async () => vi.advanceTimersByTime(399));
  expect(chip.hidden).toBe(true);
  await act(async () => vi.advanceTimersByTime(1));
  expect(chip.hidden).toBe(false);
  expect(chip.textContent).toBe('Add frame');
  // The name already says it: no description that repeats it.
  expect(add.hasAttribute('aria-describedby')).toBe(false);

  document.dispatchEvent(new Event('scroll'));
  expect(chip.hidden).toBe(true);

  const reset = host.querySelectorAll('button')[1] as HTMLButtonElement;
  vi.spyOn(reset, 'matches').mockImplementation((selector) => selector === ':focus-visible');
  reset.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(chip.hidden).toBe(false);
  expect(chip.textContent).toBe('Needs an email first');
  expect(reset.getAttribute('aria-describedby')).toBe('ink-tooltip-layer');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(chip.hidden).toBe(true);
  expect(reset.hasAttribute('aria-describedby')).toBe(false);
});

it('lets a touch tap through and shows the tooltip only on a long press', async () => {
  vi.useFakeTimers();
  const onClick = vi.fn();
  await act(async () =>
    root.render(
      <TooltipProvider>
        <IconButton icon="plus" label="Add frame" onClick={onClick} />
      </TooltipProvider>,
    ),
  );
  const chip = document.getElementById('ink-tooltip-layer') as HTMLElement;
  const add = host.querySelector('button') as HTMLButtonElement;
  const touch = (type: string) =>
    add.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch' }));
  touch('pointerdown');
  touch('pointerup');
  add.click();
  await act(async () => vi.advanceTimersByTime(600));
  expect(onClick).toHaveBeenCalledOnce();
  expect(chip.hidden).toBe(true);

  touch('pointerdown');
  await act(async () => vi.advanceTimersByTime(500));
  expect(chip.hidden).toBe(false);
  await act(async () => vi.advanceTimersByTime(2500));
  expect(chip.hidden).toBe(true);
});

function Tiles() {
  const [kind, setKind] = useState('short');
  return (
    <fieldset>
      <legend>Type</legend>
      {['short', 'spot'].map((value) => (
        <ChoiceTile
          key={value}
          name="kind"
          value={value}
          checked={kind === value}
          onChange={() => setKind(value)}
        >
          {value}
        </ChoiceTile>
      ))}
    </fieldset>
  );
}

it('draws choice tiles as one native radio group without a visible circle', async () => {
  await act(async () => root.render(<Tiles />));
  const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="kind"]');
  expect(radios).toHaveLength(2);
  expect(host.querySelector('.ink-choice__box')).toBeNull();
  await act(async () => (host.querySelectorAll('label')[1] as HTMLLabelElement).click());
  expect(radios[1]?.checked).toBe(true);
  expect(radios[0]?.checked).toBe(false);
});
