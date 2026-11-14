// SPDX-License-Identifier: MPL-2.0
import {
  createContext,
  type InputHTMLAttributes,
  type KeyboardEvent,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  addMonths,
  calendarKey,
  clampDate,
  dayState,
  localDate,
  monthGrid,
  monthKey,
} from './date-grid.ts';
import { Icon } from './icons.tsx';
import { anchorLayer } from './layer.ts';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** The words of the calendar; the app provides them in its language. */
export interface DateFieldTexts {
  clear: string;
  today: string;
  previousMonth: string;
  nextMonth: string;
  previousYear: string;
  nextYear: string;
}
export const DateFieldTextsContext = createContext<DateFieldTexts>({
  clear: 'Clear',
  today: 'Today',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  previousYear: 'Previous year',
  nextYear: 'Next year',
});

type View = 'days' | 'months';
type Step = 'prev' | 'next' | 'view';
/** Which month (or year, in the month grid) a view shows: a new one animates in. */
const pageOf = (view: View, date: string) =>
  view === 'days' ? date.slice(0, 7) : date.slice(0, 4);
const format = (lang: string | undefined, date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/**
 * A date in the app's own field look: the label or the chosen date and a calendar icon. A click,
 * Enter or Space opens Inkadra's calendar (a sheet on phones); the native input stays underneath
 * for typing and for forms, and its own picker never opens. Every date of the interface uses this
 * field (a test fails on any other date input). `rangeStart` shows the span from that day to the
 * value, for the end of a pair; days before `min` or after `max` cannot be chosen.
 */
export function DateField({
  label,
  value,
  onChange,
  clearLabel,
  rangeStart,
  className,
  onClick,
  onKeyDown,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown as a × button while a date is set. */
  clearLabel?: string;
  /** The start of a range ending on this date, drawn as a band in the calendar. */
  rangeStart?: string;
}) {
  const texts = useContext(DateFieldTextsContext);
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const focusCursor = useRef(false);
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [view, setView] = useState<View>('days');
  const [cursor, setCursor] = useState('');
  const [step, setStep] = useState<Step | null>(null);
  const [leaving, setLeaving] = useState<{ view: View; cursor: string; step: Step } | null>(null);
  // Touch browsers open their own picker on a tap: there the calendar sheet is the only way in.
  const [coarse] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  );
  const [nativeDate] = useState(() => {
    const probe = document.createElement('input');
    probe.type = 'date';
    return probe.type === 'date';
  });
  const lang = document.documentElement.lang || undefined;
  const min = props.min === undefined ? undefined : String(props.min);
  const max = props.max === undefined ? undefined : String(props.max);
  const today = localDate(new Date());
  const canClear = !props.required;
  const mounted = phase !== 'closed';
  // The calendar is the only way in: the field takes no typing and opens no picker or keyboard.
  const pickerOnly = coarse || !nativeDate;

  const show = () => {
    if (props.disabled || props.readOnly) return;
    setCursor(clampDate(value || rangeStart || today, min, max));
    setView('days');
    setStep(null);
    setLeaving(null);
    focusCursor.current = true;
    setPhase('open');
  };
  const close = (focus = false) => {
    setPhase((p) => (p === 'open' ? 'closing' : p));
    if (focus) input.current?.focus({ preventScroll: true });
  };
  const choose = (date: string) => {
    if (dayState(date, { month: date, today, min, max }).disabled) return;
    onChange(date);
    close(true);
  };
  /** Moves the cursor; a new month, year or view slides or fades in over the one leaving. */
  const navigate = (next: string, nextView: View = view) => {
    if (pageOf(nextView, next) !== pageOf(view, cursor) || nextView !== view) {
      const s: Step = nextView !== view ? 'view' : next < cursor ? 'prev' : 'next';
      setLeaving({ view, cursor, step: s });
      setStep(s);
    }
    setCursor(next);
    setView(nextView);
  };

  useEffect(() => {
    if (phase !== 'closing') return;
    const timer = setTimeout(() => setPhase('closed'), 120);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), 180);
    return () => clearTimeout(timer);
  }, [leaving]);
  useEffect(() => {
    if (!mounted) return;
    const el = layer.current;
    const box = field.current;
    if (!el || !box) return;
    return anchorLayer(el, box, () => setPhase((p) => (p === 'open' ? 'closing' : p)));
  }, [mounted]);
  // A text trigger checks no range: the bounds of a date input give the browser's own words.
  useEffect(() => {
    const el = input.current;
    if (!el || !pickerOnly) return;
    const out = !!value && dayState(value, { month: value, today: '', min, max }).disabled;
    const probe = document.createElement('input');
    probe.type = 'date';
    probe.min = min ?? '';
    probe.max = max ?? '';
    probe.value = value;
    el.setCustomValidity(
      out
        ? probe.validationMessage ||
            [min, max].map((d) => (d ? format(lang, d, { dateStyle: 'medium' }) : '')).join(' – ')
        : '',
    );
  }, [pickerOnly, value, min, max, lang]);
  useEffect(() => {
    if (phase !== 'open' || !focusCursor.current) return;
    focusCursor.current = false;
    layer.current?.querySelector<HTMLElement>('.ink-date__body [tabindex="0"]')?.focus();
  });

  const gridKey = (event: KeyboardEvent) => {
    // A pointer can focus a day that cannot be chosen: the keys act on the focused day.
    const from = (event.target as HTMLElement).dataset.day ?? cursor;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(from);
      return;
    }
    const next = calendarKey(from, event.key);
    if (!next) return;
    event.preventDefault();
    focusCursor.current = true;
    navigate(next);
  };
  const monthGridKey = (event: KeyboardEvent) => {
    const next = monthKey(cursor, event.key);
    if (!next) return;
    event.preventDefault();
    focusCursor.current = true;
    navigate(next);
  };

  const body = (v: View, at: string, live: boolean) => {
    if (v === 'months') {
      const year = at.slice(0, 4);
      return (
        // biome-ignore lint/a11y/useSemanticElements: twelve buttons named by their year, not a form.
        <div
          className="ink-date__months"
          role="group"
          aria-label={year}
          onKeyDown={live ? monthGridKey : undefined}
        >
          {Array.from({ length: 12 }, (_, i) => {
            const month = `${year}-${String(i + 1).padStart(2, '0')}`;
            const current = month === at.slice(0, 7);
            return (
              <button
                key={month}
                type="button"
                tabIndex={live && current ? 0 : -1}
                aria-current={month === today.slice(0, 7) ? 'date' : undefined}
                aria-pressed={month === value.slice(0, 7)}
                className={cx(
                  'ink-date__day ink-date__month',
                  month === today.slice(0, 7) && 'is-today',
                  month === value.slice(0, 7) && 'is-selected',
                )}
                onClick={() => {
                  focusCursor.current = true;
                  navigate(addMonths(at, i + 1 - Number(at.slice(5, 7))), 'days');
                }}
              >
                {format(lang, `${month}-01`, { month: 'short' }).replace('.', '')}
              </button>
            );
          })}
        </div>
      );
    }
    const days = monthGrid(at);
    return (
      // biome-ignore lint/a11y/useSemanticElements: a calendar grid of day buttons, not a table of data.
      <div
        role="grid"
        aria-label={format(lang, at, { month: 'long', year: 'numeric' })}
        className="ink-date__grid"
        onKeyDown={live ? gridKey : undefined}
      >
        {/* biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: the header row of a grid of buttons. */}
        <div role="row" className="ink-date__row">
          {days.slice(0, 7).map((d) => (
            // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: a weekday heading; the days take focus.
            <span
              key={d}
              role="columnheader"
              aria-label={format(lang, d, { weekday: 'long' })}
              className="ink-date__wd"
            >
              {format(lang, d, { weekday: 'short' }).replace('.', '').slice(0, 2)}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: a week of the grid; its days take focus.
          <div key={week} role="row" className="ink-date__row">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const s = dayState(d, { month: at, today, value, rangeStart, min, max });
              return (
                // biome-ignore lint/a11y/useSemanticElements: the day is a button and a cell of the grid.
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-day={d}
                  tabIndex={live && d === at ? 0 : -1}
                  aria-label={format(lang, d, { dateStyle: 'full' })}
                  aria-selected={s.selected}
                  aria-disabled={s.disabled || undefined}
                  aria-current={s.today ? 'date' : undefined}
                  className={cx(
                    'ink-date__day',
                    s.outside && 'is-out',
                    s.today && 'is-today',
                    s.rangeStart && 'is-start',
                    s.inRange && 'is-in',
                    s.selected && 'is-selected',
                    s.rangeEnd && 'is-end',
                  )}
                  // The roving cursor follows a day focused by the pointer in this month.
                  onFocus={() =>
                    live && d !== cursor && d.slice(0, 7) === at.slice(0, 7) && setCursor(d)
                  }
                  onClick={() => choose(d)}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const shown = value
    ? format(lang, value, { day: 'numeric', month: 'short', year: 'numeric' })
    : label;
  const toggle = () => (phase === 'open' ? close() : show());
  return (
    <div ref={field} className={cx('ink-date', value && 'ink-date--set', className)}>
      <span className="ink-date__text" aria-hidden="true">
        {shown}
      </span>
      <input
        {...props}
        ref={input}
        // Firefox cannot focus a readonly date input; touch uses a text trigger without a keyboard.
        // It stays editable for the browser so that required and the bounds still block a form.
        type={coarse ? 'text' : 'date'}
        className="ink-date__input"
        aria-label={label}
        aria-haspopup="dialog"
        aria-controls={mounted ? `${id}-calendar` : undefined}
        // shortcut: engines without date inputs use the calendar; typing needs a text parser.
        inputMode={pickerOnly ? 'none' : props.inputMode}
        value={value}
        onChange={(e) => !pickerOnly && onChange(e.target.value)}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          e.preventDefault();
          toggle();
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Escape' && phase === 'open') {
            // Back on the field from the calendar: Escape closes it, not a dialog around it.
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
            e.preventDefault();
            show();
          }
        }}
      />
      {value && clearLabel ? (
        <button
          type="button"
          className="ink-date__clear"
          aria-label={clearLabel}
          disabled={props.disabled}
          onClick={() => onChange('')}
        >
          <Icon name="close" size={14} />
        </button>
      ) : (
        <span className="ink-date__icon" aria-hidden="true">
          <Icon name="calendar" size={16} />
        </span>
      )}
      {mounted && (
        // The layer lives in the top layer like the Select's: under the field on desktop, a
        // dimmed backdrop with a bottom sheet on phones.
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a tap on the backdrop is a pointer shortcut; Escape closes from the keyboard.
        <div
          ref={layer}
          popover="manual"
          className={cx('ink-date__layer', phase === 'closing' && 'is-closing')}
          onClick={(event) => {
            // Keeps a wrapping label from pressing the field again.
            event.preventDefault();
            event.stopPropagation();
            if (event.target === event.currentTarget) close(true);
          }}
        >
          <div
            id={`${id}-calendar`}
            role="dialog"
            aria-label={label}
            className="ink-date__panel"
            onPointerDown={(event) => {
              const button = (event.target as HTMLElement).closest('button');
              if (!button || button.disabled) return;
              // WebKit otherwise blurs to the surrounding dialog before the button's click.
              event.preventDefault();
              button.focus();
            }}
            onKeyDown={(event) => {
              // The calendar's keys stay here: a dialog or form around it must not act on them.
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
              }
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && !event.currentTarget.contains(next) && !field.current?.contains(next))
                close();
            }}
          >
            <div className="ink-date__sheet-head" aria-hidden="true">
              <span className="ink-date__handle" />
              <span className="ink-date__title">{label}</span>
            </div>
            <div className="ink-date__head">
              <button
                type="button"
                className="ink-date__heading"
                aria-live="polite"
                onClick={() => navigate(cursor, view === 'days' ? 'months' : 'days')}
              >
                {view === 'days'
                  ? format(lang, cursor, { month: 'long', year: 'numeric' })
                  : cursor.slice(0, 4)}
                <Icon name="chevronDown" size={14} />
              </button>
              <button
                type="button"
                className="ink-date__nav"
                aria-label={view === 'days' ? texts.previousMonth : texts.previousYear}
                onClick={() => navigate(addMonths(cursor, view === 'days' ? -1 : -12))}
              >
                <Icon name="chevronLeft" size={16} />
              </button>
              <button
                type="button"
                className="ink-date__nav"
                aria-label={view === 'days' ? texts.nextMonth : texts.nextYear}
                onClick={() => navigate(addMonths(cursor, view === 'days' ? 1 : 12))}
              >
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
            <div className="ink-date__stage">
              {leaving && (
                <div
                  className="ink-date__leaving"
                  data-step={leaving.step}
                  aria-hidden="true"
                  inert
                >
                  {body(leaving.view, leaving.cursor, false)}
                </div>
              )}
              <div
                key={`${view}-${pageOf(view, cursor)}`}
                className="ink-date__body"
                data-step={step ?? undefined}
              >
                {body(view, cursor, true)}
              </div>
            </div>
            <div className="ink-date__foot">
              {canClear && (
                <button
                  type="button"
                  className="ink-date__quiet"
                  onClick={() => {
                    onChange('');
                    close(true);
                  }}
                >
                  {texts.clear}
                </button>
              )}
              <button
                type="button"
                className="ink-date__quiet ink-date__today"
                disabled={dayState(today, { month: today, today, min, max }).disabled}
                onClick={() => choose(today)}
              >
                {texts.today}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
