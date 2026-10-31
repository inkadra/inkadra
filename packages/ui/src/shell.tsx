// SPDX-License-Identifier: MPL-2.0
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import type { ContentKind } from './kind-color.ts';

/**
 * Desktop and tablet layout (#333): the page fills the window and the chrome floats over it.
 * The navigation is a floating panel at the left (collapsed, only `launcher` stays: a small
 * button that brings it back; `peek` shows it over the page for a moment), the header is two
 * floating panels at the top, and a board (`canvas`) runs edge to edge under all of them.
 * Other pages sit in a rounded surface beside the navigation. Phones keep their own layout.
 * `rail` is kept for callers that still pass a separate icon rail.
 */
export function AppShell({
  rail,
  launcher,
  sidebar,
  header,
  children,
  canvas,
  collapsed,
  peek,
}: {
  rail?: ReactNode;
  launcher?: ReactNode;
  sidebar?: ReactNode;
  header: ReactNode;
  children: ReactNode;
  canvas?: boolean;
  collapsed?: boolean;
  peek?: boolean;
}) {
  const className = [
    'ink-shell',
    rail ? 'ink-shell--rail' : '',
    sidebar ? '' : 'ink-shell--no-sidebar',
    collapsed ? 'ink-shell--collapsed' : '',
    collapsed && peek ? 'ink-shell--peek' : '',
    canvas ? 'ink-shell--canvas' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      {rail}
      {launcher}
      {sidebar}
      {header}
      <main className={canvas ? 'ink-main ink-main--canvas' : 'ink-main'}>{children}</main>
    </div>
  );
}

export function Rail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav className="ink-rail" aria-label={label}>
      {children}
    </nav>
  );
}

export function RailButton({
  icon,
  label,
  active,
  badge,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  active?: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className="ink-rail__btn"
      aria-label={badge ? `${label}, ${badge}` : label}
      data-ink-tooltip={label}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      <Icon name={icon} />
      {badge ? (
        <span className="ink-rail__badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export const RailSeparator = () => <span className="ink-rail__sep" aria-hidden="true" />;
export const RailSpacer = () => <span className="ink-rail__spacer" />;

export function Sidebar({
  label,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { label: string; children: ReactNode }) {
  return (
    <aside className="ink-sidebar" aria-label={label} {...props}>
      {children}
    </aside>
  );
}

export function SidebarSection({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="ink-sidebar__section">
      <span className="ink-label">{title}</span>
      {action}
    </div>
  );
}

export function NavItem({
  icon,
  contentKind,
  leading,
  label,
  count,
  badge,
  active,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon?: IconName;
  contentKind?: ContentKind;
  leading?: ReactNode;
  label: string;
  count?: number;
  /** A highlighted number, such as unread notifications; hidden at zero. */
  badge?: number;
  active?: boolean;
}) {
  const content = (
    <>
      {icon ? <Icon name={icon} contentKind={contentKind} /> : leading}
      <span className="ink-nav__name" data-ink-tooltip-label>
        {label}
      </span>
      {count !== undefined && <span className="ink-nav__count">{count}</span>}
      {badge ? (
        <span className="ink-nav__badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </>
  );
  // With the column collapsed only the icon shows, so the name moves to the tooltip; a fully
  // visible name needs none.
  const { title = label, ...rest } = props;
  return rest.href ? (
    <a
      className="ink-nav"
      aria-current={active ? 'page' : undefined}
      data-ink-tooltip={title}
      {...rest}
    >
      {content}
    </a>
  ) : (
    <button
      className="ink-nav"
      data-ink-tooltip={title}
      aria-pressed={active}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      type="button"
    >
      {content}
    </button>
  );
}

export function Header({ children }: { children: ReactNode }) {
  return <header className="ink-header">{children}</header>;
}
