// SPDX-License-Identifier: MPL-2.0
import {
  createContext,
  type KeyboardEvent,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Icon } from './icons.tsx';
import { anchorLayer } from './layer.ts';
import {
  minuteOptions,
  parseTime,
  shownHour,
  stepTime,
  type TimeParts,
  timeParts,
  timeValue,
  typeDigit,
} from './time.ts';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The words of the time field and the clock it follows: the app provides them in its language,
 * with `hour12` from the person's time format (#302: Automatic is the interface language).
 */
export interface TimeFieldTexts {
  hours: string;
  minutes: string;
  period: string;
  choose: string;
  clear: string;
  now: string;
  required: string;
  hour12: boolean;
}
export const TimeFieldTextsContext = createContext<TimeFieldTexts>({
  hours: 'Hours',
  minutes: 'Minutes',
  period: 'AM/PM',
  choose: 'Choose a time',
  clear: 'Clear',
  now: 'Now',
  required: 'Enter a time',
  hour12: false,
});

type Segment = 'h' | 'm' | 'p';
/** Minutes between two entries of the list; any minute can still be typed. */
const STEP = 5;
const nowParts = (): TimeParts => {
  const now = new Date();
  return { h: now.getHours(), m: now.getMinutes() };
};

/**
 * A time of day in the date field's look (#772): hours and minutes typed in two segments (and
 * AM/PM in 12 h), or chosen from a small list of hours and minutes in steps of five, a short
 * sheet on phones. The value is always "HH:MM" in 24 h, or '' when empty; 12 or 24 h only
 * changes what is shown. `auto` is the time worked out when nobody sets one: it shows muted
 * with `autoLabel` until a time is typed, and clearing brings it back. `suffix` follows a set
 * time ("(+1)" after midnight). Every time of the interface uses this field (a test fails on
 * any native time input).
 */
export function TimeField({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  clearLabel,
  auto,
  autoLabel,
  suffix,
  className,
}: {
  /** On the hours segment, for a `<label htmlFor>`. */
  id?: string;
  /** The field's accessible name, and the title of the phone sheet. */
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Shown as a × button while a time is set. */
  clearLabel?: string;
  auto?: string | null;
  autoLabel?: string;
  suffix?: string;
  className?: string;
}) {
  const texts = useContext(TimeFieldTextsContext);
  const hour12 = texts.hour12;
  const own = useId();
  const base = id ?? own;
  const field = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [parts, setParts] = useState<TimeParts>(() => timeParts(value));
  const emitted = useRef(value ?? '');
  const buffer = useRef('');
  const [invalid, setInvalid] = useState(false);
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const focusList = useRef(false);
  // Touch: a tap opens the list as a sheet, with no keyboard over it.
  const [coarse] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  );
  const mounted = phase !== 'closed';

  // A new value from outside replaces what is shown; the field's own changes come back as is.
  useEffect(() => {
    if ((value ?? '') === emitted.current) return;
    emitted.current = value ?? '';
    setParts(timeParts(value));
    setInvalid(false);
  }, [value]);

  const autoParts = timeParts(auto);
  const empty = parts.h === null && parts.m === null;
  const autoShown = empty && autoParts.h !== null;
  const shown = autoShown ? autoParts : parts;
  const segments: Segment[] = hour12 ? ['h', 'm', 'p'] : ['h', 'm'];
  const canClear = !required && !disabled && !!clearLabel && !empty;

  /**
   * Shows `next` and saves it once it is a whole time, or empty. A segment still waiting for
   * its second digit (`save` false) only shows it: no half-typed minute is saved on the way.
   */
  const commit = (next: TimeParts, save = true) => {
    setParts(next);
    setInvalid(false);
    if (!save) return;
    if (next.h !== null && next.m === null) return;
    if (next.h === null && next.m !== null) return;
    const v = timeValue(next);
    if (v === emitted.current) return;
    emitted.current = v;
    onChange(v);
  };
  const segment = (k: Segment) =>
    field.current?.querySelector<HTMLInputElement>(`[data-seg="${k}"]`) ?? null;
  const focusSegment = (k: Segment | undefined) => {
    buffer.current = '';
    if (k) segment(k)?.focus();
  };

  const show = () => {
    if (disabled) return;
    focusList.current = true;
    setPhase('open');
  };
  const close = (focus = false) => {
    setPhase((p) => (p === 'open' ? 'closing' : p));
    if (focus && !coarse) segment('h')?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (phase !== 'closing') return;
    const timer = setTimeout(() => setPhase('closed'), 120);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (!mounted) return;
    const el = layer.current;
    const box = field.current;
    if (!el || !box) return;
    return anchorLayer(el, box, () => setPhase((p) => (p === 'open' ? 'closing' : p)));
  }, [mounted]);
  // Each column scrolls its choice to the middle when the list opens, and the hours take the
  // focus. After the layer is shown (the effect above): a hidden popover has nothing to scroll.
  useEffect(() => {
    if (phase !== 'open' || !focusList.current) return;
    focusList.current = false;
    for (const list of layer.current?.querySelectorAll<HTMLElement>('.ink-time__list') ?? []) {
      const at = list.querySelector<HTMLElement>('[tabindex="0"]');
      if (at) list.scrollTop = at.offsetTop - list.clientHeight / 2 + at.offsetHeight / 2;
    }
    layer.current
      ?.querySelector<HTMLElement>('.ink-time__list [tabindex="0"]')
      ?.focus({ preventScroll: true });
  });

  /** Leaving the field: an hour alone gets :00, a missing required time is pointed out. */
  const leave = () => {
    buffer.current = '';
    if (parts.h !== null && parts.m === null) commit({ h: parts.h, m: 0 });
    else if (parts.h === null && parts.m !== null) setInvalid(true);
    // Saves a digit typed last, which waited for a second one.
    else if (parts.h !== null) commit(parts);
    else if (required && !autoShown) setInvalid(true);
  };

  const segmentKey = (event: KeyboardEvent<HTMLInputElement>, k: Segment) => {
    const at = segments.indexOf(k);
    const key = event.key;
    if ((event.altKey && key === 'ArrowDown') || key === 'Enter') {
      event.preventDefault();
      show();
      return;
    }
    if (key === 'Escape' && phase === 'open') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'ArrowRight' || key === ':' || key === '.') {
      event.preventDefault();
      focusSegment(segments[at + 1]);
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      focusSegment(segments[at - 1]);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      buffer.current = '';
      const sign = key === 'ArrowUp' ? 1 : -1;
      const from = autoParts.h === null ? nowParts() : autoParts;
      const start = empty ? from : parts;
      commit(stepTime(start, k, sign * (k === 'm' && event.shiftKey ? 15 : 1), from));
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault();
      buffer.current = '';
      if (k !== 'p' && parts[k] !== null) commit({ ...parts, [k]: null });
      else if (key === 'Backspace') focusSegment(segments[at - 1]);
      return;
    }
    if (hour12 && /^[ap]$/i.test(key)) {
      event.preventDefault();
      const h = parts.h ?? shown.h ?? 9;
      commit({ h: (h % 12) + (key.toLowerCase() === 'p' ? 12 : 0), m: parts.m ?? shown.m });
      return;
    }
    if (/^\d$/.test(key) && k !== 'p') {
      event.preventDefault();
      const pm = (parts.h ?? shown.h ?? 0) >= 12;
      const typed = typeDigit(k, buffer.current, Number(key), { hour12, pm });
      buffer.current = typed.buffer;
      commit({ ...parts, [k]: typed.value }, typed.done);
      if (typed.done) focusSegment(segments[at + 1]);
      return;
    }
    // Nothing else is typed into a segment.
    if (key.length === 1) event.preventDefault();
  };

  const pick = (col: Segment, v: number) => {
    const h = parts.h ?? shown.h ?? 8;
    if (col === 'h') {
      commit({ h: hour12 ? (v % 12) + (h >= 12 ? 12 : 0) : v, m: parts.m });
      return;
    }
    if (col === 'p') {
      commit({ h: (h % 12) + (v ? 12 : 0), m: parts.m ?? shown.m });
      return;
    }
    commit({ h, m: v });
    close(true);
  };
  const listKey = (event: KeyboardEvent<HTMLElement>) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    const list = option?.parentElement;
    if (!option || !list) return;
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    const i = options.indexOf(option);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = options[Math.min(i + 1, options.length - 1)];
    else if (event.key === 'ArrowUp') next = options[Math.max(i - 1, 0)];
    else if (event.key === 'Home') next = options[0];
    else if (event.key === 'End') next = options.at(-1);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const lists = [...(layer.current?.querySelectorAll<HTMLElement>('.ink-time__list') ?? [])];
      const c = lists.indexOf(list);
      const to = lists[(c + (event.key === 'ArrowRight' ? 1 : lists.length - 1)) % lists.length];
      next = to?.querySelector<HTMLElement>('[tabindex="0"]') ?? undefined;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      option.click();
      return;
    }
    if (!next) return;
    event.preventDefault();
    if (next.parentElement === list) {
      for (const o of options) o.tabIndex = -1;
      next.tabIndex = 0;
    }
    next.focus();
    next.scrollIntoView?.({ block: 'nearest' });
  };

  const hours = hour12 ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [...Array(24).keys()];
  const minutes = minuteOptions(STEP, parts.m);
  // The roving stop of a column: its choice, or where a choice would most likely be.
  const column = (
    col: Segment,
    head: string,
    name: string,
    items: number[],
    text: (v: number) => string,
    chosen: number | null,
    start: number,
  ) => (
    <div className="ink-time__col">
      <span className="ink-time__colhead" aria-hidden="true">
        {head}
      </span>
      <div className="ink-time__list" role="listbox" aria-label={name}>
        {items.map((v) => (
          <button
            key={v}
            type="button"
            role="option"
            className="ink-time__opt"
            aria-selected={chosen === v}
            tabIndex={(chosen ?? start) === v ? 0 : -1}
            onClick={() => pick(col, v)}
          >
            {text(v)}
          </button>
        ))}
      </div>
    </div>
  );
  const h12 = parts.h === null ? null : shownHour(parts.h, true);
  const startHour = shown.h ?? 8;

  const display = (k: Segment) => {
    if (k === 'p') return (shown.h ?? 0) >= 12 ? 'PM' : 'AM';
    const v = shown[k];
    if (v === null) return '––';
    return k === 'h' && hour12 ? String(shownHour(v, true)) : pad(v);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens for the focus leaving the field and its list, which only checks the value.
    <div
      className={cx('ink-time-field', className)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        if (phase === 'open' && !next) return;
        leave();
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useSemanticElements: the segments take the keys and a click on the box focuses one; a fieldset cannot sit in the labels that hold the field. */}
      <div
        ref={field}
        role="group"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${base}-error` : undefined}
        className={cx(
          'ink-date ink-time',
          !empty && 'ink-date--set',
          autoShown && 'is-auto',
          invalid && 'is-invalid',
          disabled && 'is-disabled',
        )}
        onClick={(event) => {
          if (disabled) return;
          const target = event.target as HTMLElement;
          if (target.closest('button')) return;
          if (coarse) {
            phase === 'open' ? close() : show();
            return;
          }
          if (!target.closest('.ink-time__seg')) segment(parts.h === null ? 'h' : 'm')?.focus();
        }}
      >
        <span className="ink-time__segs">
          {segments.map((k, i) => (
            <span key={k} className="ink-time__part">
              {i === 1 && (
                <span className="ink-time__sep" aria-hidden="true">
                  :
                </span>
              )}
              <input
                id={k === 'h' ? base : undefined}
                data-seg={k}
                className={cx(
                  'ink-time__seg',
                  k === 'p' && 'ink-time__seg--period',
                  (k === 'p' ? shown.h : shown[k]) === null && 'is-empty',
                )}
                role="spinbutton"
                aria-label={k === 'h' ? texts.hours : k === 'm' ? texts.minutes : texts.period}
                aria-valuemin={k === 'h' ? (hour12 ? 1 : 0) : 0}
                aria-valuemax={k === 'h' ? (hour12 ? 12 : 23) : k === 'm' ? 59 : 1}
                aria-valuenow={
                  k === 'p'
                    ? parts.h === null
                      ? undefined
                      : Number(parts.h >= 12)
                    : k === 'h'
                      ? ((hour12 ? h12 : parts.h) ?? undefined)
                      : (parts.m ?? undefined)
                }
                aria-valuetext={k === 'p' && parts.h !== null ? display('p') : undefined}
                value={display(k)}
                size={2}
                autoComplete="off"
                spellCheck={false}
                inputMode={coarse ? 'none' : 'numeric'}
                readOnly={coarse}
                disabled={disabled}
                onKeyDown={(event) => segmentKey(event, k)}
                onPaste={(event) => {
                  event.preventDefault();
                  const time = parseTime(event.clipboardData.getData('text'));
                  if (time) commit(time);
                }}
                // A keyboard that sends no keys (some phones): its digits still type.
                onChange={(event) => {
                  const digit = event.target.value.replace(/\D/g, '').slice(-1);
                  if (!digit || k === 'p') return;
                  const typed = typeDigit(k, buffer.current, Number(digit), {
                    hour12,
                    pm: (parts.h ?? 0) >= 12,
                  });
                  buffer.current = typed.buffer;
                  commit({ ...parts, [k]: typed.value }, typed.done);
                  if (typed.done) focusSegment(segments[i + 1]);
                }}
                onPointerDown={() => {
                  buffer.current = '';
                }}
                onFocus={(event) => event.currentTarget.select()}
              />
            </span>
          ))}
        </span>
        {autoShown && autoLabel && <span className="ink-time__auto">{autoLabel}</span>}
        {suffix && !empty && <span className="ink-time__next">{suffix}</span>}
        {canClear && (
          <button
            type="button"
            className="ink-date__clear"
            aria-label={clearLabel}
            onClick={() => {
              buffer.current = '';
              commit({ h: null, m: null });
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        <button
          type="button"
          className="ink-time__btn"
          aria-label={texts.choose}
          aria-haspopup="dialog"
          aria-expanded={phase === 'open'}
          aria-controls={mounted ? `${base}-list` : undefined}
          // The field opens the list with Enter or Alt+↓: the clock is not a second tab stop.
          tabIndex={-1}
          disabled={disabled}
          onClick={() => (phase === 'open' ? close(true) : show())}
        >
          <Icon name="clock" size={16} />
        </button>
        {mounted && (
          // The date calendar's layer: under the field on desktop, a short sheet on phones.
          // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a tap on the backdrop is a pointer shortcut; Escape closes from the keyboard.
          <div
            ref={layer}
            popover="manual"
            className={cx('ink-date__layer ink-time__layer', phase === 'closing' && 'is-closing')}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.target === event.currentTarget) close(true);
            }}
          >
            <div
              id={`${base}-list`}
              role="dialog"
              aria-label={label}
              className="ink-date__panel ink-time__panel"
              onPointerDown={(event) => {
                const button = (event.target as HTMLElement).closest('button');
                if (!button || button.disabled) return;
                // WebKit otherwise blurs to the surrounding dialog before the button's click.
                event.preventDefault();
                button.focus({ preventScroll: true });
              }}
              onKeyDown={(event) => {
                // The list's keys stay here: a dialog or form around it must not act on them.
                event.stopPropagation();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close(true);
                  return;
                }
                listKey(event);
              }}
            >
              <div className="ink-date__sheet-head" aria-hidden="true">
                <span className="ink-date__handle" />
                <span className="ink-date__title">{label}</span>
              </div>
              <div className="ink-time__cols">
                {column(
                  'h',
                  'h',
                  texts.hours,
                  hours,
                  (v) => (hour12 ? String(v) : pad(v)),
                  hour12 ? h12 : parts.h,
                  hour12 ? shownHour(startHour, true) : startHour,
                )}
                {column(
                  'm',
                  'min',
                  texts.minutes,
                  minutes,
                  pad,
                  parts.m,
                  shown.m === null ? 0 : (Math.round(shown.m / STEP) * STEP) % 60,
                )}
                {hour12 &&
                  column(
                    'p',
                    '',
                    texts.period,
                    [0, 1],
                    (v) => (v ? 'PM' : 'AM'),
                    parts.h === null ? null : Number(parts.h >= 12),
                    Number(startHour >= 12),
                  )}
              </div>
              <div className="ink-date__foot">
                {!required && (
                  <button
                    type="button"
                    className="ink-date__quiet"
                    onClick={() => {
                      commit({ h: null, m: null });
                      close(true);
                    }}
                  >
                    {texts.clear}
                  </button>
                )}
                <button
                  type="button"
                  className="ink-date__quiet ink-date__today"
                  onClick={() => {
                    commit(nowParts());
                    close(true);
                  }}
                >
                  {texts.now}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {invalid && (
        <p id={`${base}-error`} className="ink-field__error">
          {texts.required}
        </p>
      )}
    </div>
  );
}
