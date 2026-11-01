// SPDX-License-Identifier: MPL-2.0

import type { SVGProps } from 'react';
import { type ContentKind, kindStyle } from './kind-color.ts';

/** Line icons from the design reference: 24 grid, 1.6 stroke, round caps. */
const paths = {
  comment: <path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5" />,
  bell: <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4M12 2v2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  check: <path d="M5 12l4 4L19 6" />,
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
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
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
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
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
  stickyNote: <path d="M4 3h16v12l-6 6H4zM14 21v-6h6M8 8h8M8 12h5" />,
  splitPanel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M10 4v16" />
    </>
  ),
  page: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  tiles: (
    <>
      <rect x="3" y="3" width="8" height="10" rx="1.5" />
      <rect x="13" y="3" width="8" height="6" rx="1.5" />
      <rect x="13" y="11" width="8" height="10" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
    </>
  ),
  caretDown: <path d="M8 10h8l-4 5z" fill="currentColor" stroke="none" />,
  toolColumn: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M5 7h14M8 11h8M8 15h8M8 19h5" />
    </>
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
  distributeVertical: <path d="M4 4h16M4 20h16M8 9h8v6H8z" />,
  arrange: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  mosaic: (
    <>
      <rect x="3" y="4" width="8" height="7" rx="1" />
      <rect x="13" y="4" width="8" height="4" rx="1" />
      <rect x="13" y="10" width="8" height="10" rx="1" />
      <rect x="3" y="13" width="8" height="7" rx="1" />
    </>
  ),
  rows: (
    <>
      <rect x="3" y="4" width="11" height="7" rx="1" />
      <rect x="16" y="4" width="5" height="7" rx="1" />
      <rect x="3" y="13" width="6" height="7" rx="1" />
      <rect x="11" y="13" width="10" height="7" rx="1" />
    </>
  ),
  magnet: <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" />,
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
  pen: <path d="M4 20l1-5L16 4l4 4L9 19zM13.5 6.5l4 4" />,
  arrow: <path d="M5 19L19 5M10 5h9v9" />,
  tag: (
    <>
      <path d="M3 12V4h8l9 9-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.2" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M7 5h3v14H7zM14 5h3v14h-3z" />,
  volume: <path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" />,
  mic: (
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  ),
  repeat: <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" />,
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h6M15 15h2M7 11h2M11 11h6" />
    </>
  ),
  brush: <path d="M14 4l6 6-8 8-6-6zM6 12c-2 0-3 2-3 4 0 1-1 3-1 3s3 0 5-1c2-1 3-2 3-4" />,
  marker: <path d="M15 4l5 5-9 9H6v-5zM4 20h7" />,
  eraser: <path d="M9 20h11M4 15l9-11 7 6-8 10H8zM9 9l6 5" />,
  frame: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <path d="M3 10h18" />
    </>
  ),
  scene: <path d="M4 9h16v11H4zM4 9l2-5 3 4 3-4 3 4 3-4 2 5" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  line: <path d="M5 19L19 5" />,
  arrowBoth: <path d="M6 18L18 6M6 11v7h7M11 6h7v7" />,
  curve: <path d="M5 19C5 11 11 5 19 5" />,
  dashed: <path d="M4 12h3M10.5 12h3M17 12h3" />,
  pin: (
    <>
      <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  guides: <path d="M4 4h16v16H4zM9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />,
  onion: (
    <>
      <rect x="3" y="3" width="13" height="13" rx="1.5" strokeDasharray="2 2" />
      <rect x="8" y="8" width="13" height="13" rx="1.5" />
    </>
  ),
  table: <path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />,
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  crop: <path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />,
  rotateLeft: <path d="M4 9V4m0 5h5M4.5 9A8 8 0 1 1 6 17.5" />,
  rotateRight: <path d="M20 9V4m0 5h-5m4.5 0A8 8 0 1 0 18 17.5" />,
  // Set icons of a set plan (#335), on the 24 grid of the rest.
  planCamera: (
    <>
      <rect x="3" y="8" width="12" height="9" rx="1.5" />
      <path d="M15 11l5-3v9l-5-3" />
    </>
  ),
  iconLibrary: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <path d="M16.5 13v7M13 16.5h7" />
    </>
  ),
  grid: <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1.1" />
  ),
  blocking: (
    <>
      <path d="M5 18c3-7 7-10 14-11" />
      <path d="M15 4l4 3-3 4" />
      <circle cx="5" cy="18" r="1.5" />
    </>
  ),
  ruler: <path d="M3 15L15 3l6 6L9 21zM7 11l2 2M10 8l2 2M13 5l2 2" />,
  groupItems: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.5" />
      <rect x="7" y="7" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;
export const ICON_NAMES = Object.keys(paths) as IconName[];

export function Icon({
  name,
  size,
  contentKind,
  style,
  ...props
}: { name: IconName; size?: number; contentKind?: ContentKind } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={`ink-icon${contentKind ? ' ink-icon--kind' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{
        ...(size ? { width: size, height: size } : {}),
        ...(contentKind ? { ...kindStyle(contentKind), color: 'var(--kind-fg)' } : {}),
        ...style,
      }}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
