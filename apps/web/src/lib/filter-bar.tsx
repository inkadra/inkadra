// SPDX-License-Identifier: AGPL-3.0-only
import { anchorLayer, Button, Dialog, DialogActions, Icon, type IconName, Menu } from '@inkadra/ui';
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from './phone.ts';
import './filter-bar.css';

/**
 * The toolbar of a filtered list (Shot list, Projects, Schedule queue): one Filters button
 * holds the filter fields, one menu button holds the view's single choices (group, sort).
 */

/** Shows `layer` under `button` while `open`, and closes it on a press outside both. */
function useAnchoredLayer(
  open: boolean,
  layer: RefObject<HTMLDivElement | null>,
  button: RefObject<HTMLButtonElement | null>,
  close: () => void,
) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const el = layer.current;
    const anchor = button.current;
    if (!open || !el || !anchor) return;
    return anchorLayer(el, anchor, () => latest.current());
  }, [open, layer, button]);
}

/** A filter in the Filters panel: its name above the control; `set` when it filters. */
export function FilterField({
  label,
  set,
  children,
}: {
  label: string;
  set: boolean;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the Select passed as a child.
    <label className={set ? 'filter-bar__field is-set' : 'filter-bar__field'}>
      <span className="filter-bar__field-name">{label}</span>
      {children}
    </label>
  );
}

/**
 * The Filters button. `count` active filters turn it accent-soft with a badge; it opens the
 * fields in a popover (a bottom sheet on a phone, where the button is an icon) with Clear
 * filters and the shown count.
 */
export function FilterButton({
  count,
  summary,
  showLabel,
  onClear,
  className,
  children,
  ...rest
}: {
  count: number;
  /** "2 of 48 shots", under the fields. */
  summary?: string | undefined;
  /** The phone sheet's closing button, "Show 2 shots". */
  showLabel: string;
  onClear: () => void;
  className?: string | undefined;
  'data-tour'?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const close = (focus = false) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useAnchoredLayer(open && !phone, layer, button, () => setOpen(false));
  useEffect(() => {
    if (open && !phone)
      layer.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }, [open, phone]);
  const name = count ? t('filterBar.filtersActive', { count }) : t('filterBar.filters');
  const clear = (
    <Button
      variant="ghost"
      className="filter-bar__clear"
      disabled={!count}
      onClick={() => {
        // Clear filters turns disabled: the focus moves to the first field first, so it stays
        // in the panel (and Escape still closes it) instead of falling to the page.
        layer.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
        onClear();
      }}
    >
      {t('filterBar.clear')}
    </Button>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        className={[
          'ink-btn ink-btn--secondary filter-bar__button',
          count ? 'is-active' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name}
        data-ink-tooltip={phone ? name : undefined}
        data-tour={rest['data-tour']}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="filter" size={14} />
        <span className="filter-bar__button-label">{t('filterBar.filters')}</span>
        {count > 0 && (
          <span className="filter-bar__badge" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {open && phone && (
        <div className="phone-sheet">
          <Dialog open title={t('filterBar.filters')} onClose={() => close(true)}>
            <div className="filter-bar__fields filter-bar__fields--stacked">{children}</div>
            <DialogActions>
              {clear}
              <Button variant="primary" onClick={() => close(true)}>
                {showLabel}
              </Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
      {open && !phone && (
        <div
          ref={layer}
          popover="manual"
          className="filter-bar__layer"
          role="dialog"
          aria-label={t('filterBar.filters')}
          onBlur={(event) => {
            // Tab past the panel closes it, as it closes a menu; the focus goes on.
            const next = event.relatedTarget;
            if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }}
        >
          <div className="ink-popover filter-bar__panel">
            <h2 className="filter-bar__title">{t('filterBar.filters')}</h2>
            <div className="filter-bar__fields">{children}</div>
            <div className="filter-bar__foot">
              {clear}
              {summary && <span className="filter-bar__summary">{summary}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Under the bar while filters are on: their chips, Clear filters and the shown count. */
export function FilterChips({
  summary,
  onClear,
  className,
  children,
}: {
  summary?: string | undefined;
  onClear: () => void;
  className?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={['filter-bar__chips', className ?? ''].filter(Boolean).join(' ')}>
      {children}
      <button type="button" className="filter-bar__link" onClick={onClear}>
        {t('filterBar.clear')}
      </button>
      {summary && <span className="filter-bar__summary filter-bar__chips-count">{summary}</span>}
    </div>
  );
}

const CloseMenu = createContext<() => void>(() => {});

/**
 * A button that opens a menu under it: its items are `MenuChoices` groups or `MenuAction`s.
 * Choosing one closes the menu and gives the focus back to the button, as Escape does.
 */
export function MenuButton({
  label,
  name,
  icon,
  menuLabel,
  variant = 'secondary',
  disabled,
  className,
  children,
  ...rest
}: {
  /** What the button shows ("View: Scene · Storyboard order"). */
  label: ReactNode;
  /** Its accessible name, when the visible label is not enough. */
  name?: string | undefined;
  icon: IconName;
  menuLabel: string;
  variant?: 'secondary' | 'ghost';
  disabled?: boolean | undefined;
  className?: string | undefined;
  'data-tour'?: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useAnchoredLayer(open, layer, button, () => setOpen(false));
  // The current choice takes the focus, after the menu's first item did.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={[
          `ink-btn ink-btn--${variant} filter-bar__menu-button`,
          open ? 'is-open' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name}
        disabled={disabled}
        data-tour={rest['data-tour']}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} size={14} />
        <span className="filter-bar__menu-label">{label}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div ref={layer} popover="manual" className="filter-bar__layer filter-bar__layer--menu">
          <Menu
            ref={menu}
            className="filter-bar__menu"
            label={menuLabel}
            anchor={button}
            onClose={() => setOpen(false)}
          >
            <CloseMenu.Provider value={close}>{children}</CloseMenu.Provider>
          </Menu>
        </div>
      )}
    </>
  );
}

/** A single choice in a menu: its title and a `menuitemradio` per option. */
export function MenuChoices<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const close = useContext(CloseMenu);
  return (
    <fieldset className="filter-bar__group">
      <legend className="filter-bar__group-title">{title}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === value}
          className="ink-menu__item filter-bar__item"
          onClick={() => {
            onChange(option.value);
            close();
          }}
        >
          <Icon name="check" size={14} />
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/** An action in a menu, with a quiet hint after it ("CSV  spreadsheet"). */
export function MenuAction({
  icon,
  label,
  hint,
  disabled,
  onSelect,
}: {
  icon: IconName;
  label: string;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  onSelect: () => void;
}) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="ink-menu__item filter-bar__item filter-bar__item--action"
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <Icon name={icon} size={14} />
      {label}
      {hint && <small className="filter-bar__hint">{hint}</small>}
    </button>
  );
}
