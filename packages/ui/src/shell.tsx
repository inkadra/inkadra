// SPDX-License-Identifier: MPL-2.0
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import type { ContentKind } from './kind-color.ts';

/**
 * Desktop layout: one navigation column (240, or 56 with icons only when collapsed), header 48,
 * rounded main panel. `rail` is kept for callers that still pass a separate icon rail.
 */
export function AppShell({
  rail,
  sidebar,
  header,
  children,
  canvas,
  collapsed,
}: {
  rail?: ReactNode;
  sidebar?: ReactNode;
  header: ReactNode;
  children: ReactNode;
  canvas?: boolean;
  collapsed?: boolean;
}) {
  const className = [
    'ink-shell',
    rail ? 'ink-shell--rail' : '',
    sidebar ? '' : 'ink-shell--no-sidebar',
    collapsed ? 'ink-shell--collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      {rail}
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
      title={label}
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

export function Sidebar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="ink-sidebar" aria-label={label}>
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
      <span className="ink-nav__name">{label}</span>
      {count !== undefined && <span className="ink-nav__count">{count}</span>}
      {badge ? (
        <span className="ink-nav__badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </>
  );
  // With the column collapsed only the icon shows, so the name moves to the tooltip.
  const title = props.title ?? label;
  return props.href ? (
    <a className="ink-nav" aria-current={active ? 'page' : undefined} title={title} {...props}>
      {content}
    </a>
  ) : (
    <button
      className="ink-nav"
      title={title}
      aria-pressed={active}
      {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
      type="button"
    >
      {content}
    </button>
  );
}

export function Header({ children }: { children: ReactNode }) {
  return <header className="ink-header">{children}</header>;
}
