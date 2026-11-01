/* biome-ignore-all lint/a11y/useSemanticElements: An ARIA combobox: the input keeps focus and points at the active option. */
/* biome-ignore-all lint/a11y/useKeyWithClickEvents: The field handles the keys for every option. */
import type { Person } from '@inkadra/shared';
import { Avatar } from '@inkadra/ui';
import {
  type InputHTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { api } from '../lib/api.ts';
import './people-picker.css';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PeoplePickerProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'role'> {
  people?: Person[];
  value: string;
  onChange: (value: string) => void;
  /** Someone picked from the suggestions, with the mouse, a tap or Enter. */
  onPick: (person: Person) => void;
  /** People to leave out of the suggestions, such as those already on the list. */
  exclude?: (person: Person) => boolean;
  /** The latest suggestions, so a typed name can be matched to an account. */
  onResults?: (people: Person[]) => void;
  'aria-label': string;
  inputClassName?: string;
}

/**
 * A text field that suggests people already on the instance as you type a name or an address
 * (`GET /users/search`), in a themed list with ↑/↓, Enter and Escape. A full address that matches
 * nobody stays in the field for the caller to invite by email.
 */
export function PeoplePicker({
  people: supplied,
  value,
  onChange,
  onPick,
  exclude,
  onResults,
  className,
  inputClassName,
  onKeyDown,
  onBlur,
  ...props
}: PeoplePickerProps) {
  const listId = useId();
  const [found, setFound] = useState<Person[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (supplied) {
      setFound(supplied.filter(p => p.name.toLocaleLowerCase().includes(value.replace(/^@/, '').trim().toLocaleLowerCase())));
      setOpen(true);
      return;
    }
    const q = value.trim();
    // Results of the previous text must never be picked for the new one.
    setFound([]);
    setActive(0);
    if (q.length < 2 || EMAIL.test(q)) return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .get<{ items: Person[] }>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (!current) return;
          setFound(r.items);
          setOpen(true);
        })
        .catch(() => current && setFound([]));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [value, supplied]);
  const results = useRef(onResults);
  results.current = onResults;
  useEffect(() => {
    results.current?.(found);
  }, [found]);
  const people = exclude ? found.filter((p) => !exclude(p)) : found;
  const shown = open && people.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;
  const pick = (person: Person) => {
    setOpen(false);
    setFound([]);
    onPick(person);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (shown && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + people.length) % people.length);
    } else if (shown && event.key === 'Enter') {
      const person = people[Math.min(active, people.length - 1)];
      if (person) {
        event.preventDefault();
        pick(person);
      }
    } else if (shown && event.key === 'Escape') {
      // Closes the list, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (!shown && event.key === 'ArrowDown' && people.length) {
      event.preventDefault();
      setOpen(true);
    }
    onKeyDown?.(event);
  };
  return (
    <div className={`people-picker ${className ?? ''}`.trim()}>
      <input
        {...props}
        className={inputClassName}
        type="text"
        role="combobox"
        inputMode="email"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown ? optionId(Math.min(active, people.length - 1)) : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={keys}
        onBlur={(e) => {
          setOpen(false);
          onBlur?.(e);
        }}
      />
      <div className="people-picker__list" role="listbox" id={listId} hidden={!shown}>
        {shown &&
          people.map((person, i) => (
            <div
              key={person.id}
              id={optionId(i)}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className="people-picker__option"
              // Keeps the focus in the field, so the list does not close before the click.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(person)}
            >
              <Avatar name={person.name} image={person.image} size={24} />
              <span className="people-picker__who">
                <span className="people-picker__name">{person.name}</span>
                {person.email && <span className="people-picker__email">{person.email}</span>}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
