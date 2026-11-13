// @vitest-environment happy-dom
import {
  Checkbox,
  ChoiceTile,
  DateField,
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

it('forwards date bounds and keyboard handlers to the underlying date input', async () => {
  const onKeyDown = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  await act(async () =>
    root.render(
      <DateField
        label="Access until"
        value="2026-11-10"
        min="2026-11-01"
        max="2027-11-01"
        onChange={() => {}}
        onKeyDown={onKeyDown}
      />,
    ),
  );
  const input = host.querySelector<HTMLInputElement>('input[type="date"]');
  expect(input?.min).toBe('2026-11-01');
  expect(input?.max).toBe('2027-11-01');
  expect(input?.getAttribute('aria-label')).toBe('Access until');
  await act(async () =>
    input?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  );
  expect(onKeyDown).toHaveBeenCalledOnce();
});

it('opens Inkadra’s calendar instead of the native picker, and chooses with the keys', async () => {
  const showPicker = vi.fn();
  HTMLInputElement.prototype.showPicker = showPicker;
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <DateField
        label="End of shoot"
        value="2026-11-20"
        rangeStart="2026-11-16"
        min="2026-11-16"
        onChange={onChange}
      />,
    ),
  );
  const input = host.querySelector<HTMLInputElement>('input[type="date"]') as HTMLInputElement;
  await act(async () => input.click());
  expect(showPicker).not.toHaveBeenCalled();
  const grid = host.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
  const day = (date: string) =>
    host.querySelector<HTMLElement>(`.ink-date__body [data-day="${date}"]`);
  expect(day('2026-11-20')?.className).toContain('is-end');
  expect(day('2026-11-16')?.className).toContain('is-start');
  expect(day('2026-11-18')?.className).toContain('is-in');
  expect(day('2026-11-15')?.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(day('2026-11-20'));
  await act(async () =>
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(document.activeElement).toBe(day('2026-11-21'));
  // A disabled day cannot be chosen.
  await act(async () => day('2026-11-15')?.click());
  expect(onChange).not.toHaveBeenCalled();
  await act(async () =>
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  );
  expect(onChange).toHaveBeenCalledWith('2026-11-21');
  expect(document.activeElement).toBe(input);
});

it('closes the calendar with Escape and gives the focus back to the field', async () => {
  await act(async () =>
    root.render(<DateField label="Due" value="" required onChange={() => {}} />),
  );
  const input = host.querySelector<HTMLInputElement>('input[type="date"]') as HTMLInputElement;
  await act(async () => input.click());
  // A required date has nothing to clear.
  expect(host.querySelector('.ink-date__foot')?.textContent).toBe('Today');
  await act(async () =>
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(input);
  expect(host.querySelector('.ink-date__layer')?.classList.contains('is-closing')).toBe(true);
});

it('keeps the touch calendar trigger focusable without a native picker or keyboard', async () => {
  const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  try {
    await act(async () =>
      root.render(<DateField label="Due" value="2026-11-20" onChange={() => {}} />),
    );
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.readOnly).toBe(true);
    await act(async () => input.click());
    expect(host.querySelector('.ink-date__panel')).not.toBeNull();
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(input);
  } finally {
    media.mockRestore();
  }
});

it('keeps pointer focus inside the calendar before activating its controls', async () => {
  await act(async () =>
    root.render(<DateField label="Due" value="2026-11-20" onChange={() => {}} />),
  );
  await act(async () => host.querySelector<HTMLInputElement>('input')?.click());
  const next = host.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!;
  const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => next.dispatchEvent(press));
  expect(press.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(next);
  await act(async () => next.click());
  expect(host.querySelector('.ink-date__heading')?.textContent).toMatch(/December|dicembre/i);
  expect(host.querySelector('.ink-date__panel')).not.toBeNull();
});
