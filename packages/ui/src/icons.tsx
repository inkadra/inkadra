// SPDX-License-Identifier: MPL-2.0
import type { SVGProps } from 'react';

/** Line icons from the design reference: 24 grid, 1.6 stroke, round caps. */
const paths = {
  home: <path d="M4 11l8-7 8 7v9H4z" />,
  board: <path d="M4 4h16v16H4zM9 4v16M15 9h5" />,
  storyboard: (
    <>
      <rect x="2" y="7" width="9" height="6" rx="1" />
      <rect x="13" y="7" width="9" height="6" rx="1" />
      <path d="M2 17h20" />
    </>
  ),
  shotlist: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="9" r="3.5" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 2.8 3 6" />
    </>
  ),
  inbox: <path d="M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </>
  ),
  assigned: <path d="M4 7l2 2 3-3M12 8h8M4 16l2 2 3-3M12 17h8" />,
  unsorted: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16" />
    </>
  ),
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  archive: <path d="M4 7h16M6 7v12h12V7M9 4h6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevronDown: <path d="M7 10l5 5 5-5" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </>
  ),
  pointer: <path d="M5 3l14 7-6 2-3 6z" />,
  hand: (
    <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L4 13a1.5 1.5 0 0 1 2.5-1.5L8 13" />
  ),
  note: <path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" />,
  link: (
    <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />
  ),
  todo: <path d="M4 7l2 2 3-3M12 8h8M4 16l2 2 3-3M12 17h8" />,
  column: <rect x="7" y="3" width="10" height="18" rx="2" />,
  color: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M4 12h8" />
    </>
  ),
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  chevronRight: <path d="M10 7l5 5-5 5" />,
  alignLeft: <path d="M4 3v18M8 7h10M8 13h6" />,
  alignCenter: <path d="M12 3v18M6 7h12M8 13h8" />,
  alignRight: <path d="M20 3v18M6 7h10M10 13h6" />,
  alignTop: <path d="M3 4h18M7 8v10M13 8v6" />,
  alignMiddle: <path d="M3 12h18M7 6v12M13 8v8" />,
  alignBottom: <path d="M3 20h18M7 6v10M13 10v6" />,
  distribute: <path d="M4 4v16M20 4v16M9 8h6v8H9z" />,
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M10 5h8M6 19h8M14 5l-4 14" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />,
  heading: <path d="M6 5v14M18 5v14M6 12h12" />,
  front: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V4h12" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;
export const ICON_NAMES = Object.keys(paths) as IconName[];

export function Icon({
  name,
  size,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="ink-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={size ? { width: size, height: size } : undefined}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
