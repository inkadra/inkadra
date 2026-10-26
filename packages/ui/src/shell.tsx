// SPDX-License-Identifier: MPL-2.0
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';

/** Desktop layout from the design reference: rail 52, sidebar 210, header 48, rounded main panel. */
export function AppShell({
  rail,
  sidebar,
  header,
  children,
  canvas,
}: {
  rail: ReactNode;
  sidebar?: ReactNode;
  header: ReactNode;
  children: ReactNode;
  canvas?: boolean;
}) {
  return (
    <div className={sidebar ? 'ink-shell' : 'ink-shell ink-shell--no-sidebar'}>
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
  leading,
  label,
  count,
  active,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon?: IconName;
  leading?: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
}) {
  const content = (
    <>
      {icon ? <Icon name={icon} /> : leading}
      <span className="ink-nav__name">{label}</span>
      {count !== undefined && <span className="ink-nav__count">{count}</span>}
    </>
  );
  return props.href ? (
    <a className="ink-nav" aria-current={active ? 'page' : undefined} {...props}>
      {content}
    </a>
  ) : (
    <button
      className="ink-nav"
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
