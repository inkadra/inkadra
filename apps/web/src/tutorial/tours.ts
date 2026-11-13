import { offered } from '@inkadra/shared';
import type { ContentKind, IconName, ToolKind } from '@inkadra/ui';
import { isMac } from '../board/shortcuts.ts';

/**
 * Every tutorial of Inkadra (#502, decision 0078), as data. A step points at the real interface
 * through `data-tour="<anchor>"` on the component: the engine puts its spotlight there and skips
 * a step whose anchor is not on screen. `anchor: null` is a card-only step, for what has no place
 * in the app (the clipper, the phone). Texts are `tutorial.tours.<id>.steps.<n>.title|text`.
 *
 * Changing the interface? Update the tour of that feature here (AGENTS.md): tours.test.ts fails
 * when an anchor no longer exists in apps/web/src or a text is missing.
 */

/** Mini scenes that loop above a step's text (media.tsx). */
export type MediaId =
  | 'types'
  | 'search'
  | 'drag'
  | 'toolbar'
  | 'morph'
  | 'team'
  | 'gear'
  | 'scenes'
  | 'meta'
  | 'draw'
  | 'pin'
  | 'bell'
  | 'play'
  | 'grid'
  | 'rows'
  | 'calendar'
  | 'plan'
  | 'sheet'
  | 'versions'
  | 'slides'
  | 'export'
  | 'clip'
  | 'phone'
  | 'tags'
  | 'backup'
  | 'users'
  | 'home'
  | 'pan'
  | 'extension'
  | 'columns'
  | 'tabbar'
  | 'capture';

export interface TourStep {
  /** `data-tour` value of the element the spotlight goes to; null for a card without one. */
  anchor: string | null;
  media: MediaId;
  /** Where the coach card sits on a wide screen; phones put it above or below. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Keys shown as a shortcut under the text. */
  keys?: string[];
}

export type TourGroup = 'start' | 'canvas' | 'production' | 'collaboration' | 'tools' | 'admin';

export interface Tour {
  id: string;
  group: TourGroup;
  icon: IconName;
  /** Canvas-kind or tool colour of its tile, as in the rest of the app. */
  kind?: ContentKind;
  tool?: ToolKind;
  /** Administrators only. */
  admin?: boolean;
  /** Only in the public demo (decision 0084). */
  demo?: boolean;
  /** The anchor whose first appearance offers the tour with a pill; null: Settings only. */
  offer: string | null;
  /** Where a replay from Settings opens it; without one it plays on the page underneath. */
  href?: string;
  steps: TourStep[];
}

export const WELCOME: Omit<Tour, 'group' | 'icon'> = {
  id: 'welcome',
  offer: null,
  steps: [
    { anchor: 'projects', media: 'types', side: 'right' },
    { anchor: 'search', media: 'search', side: 'right', keys: [isMac() ? '⌘' : 'Ctrl', 'K'] },
    { anchor: 'dock', media: 'drag', side: 'top' },
    { anchor: 'card', media: 'toolbar', side: 'right' },
    { anchor: 'views', media: 'morph', side: 'bottom' },
    { anchor: 'share', media: 'team', side: 'bottom' },
    { anchor: 'settings', media: 'gear', side: 'right' },
  ],
};

/** Guests of a shared link: no account, so their seen state stays in the browser. */
export const GUEST: Omit<Tour, 'group' | 'icon'> = {
  id: 'guest',
  offer: 'guest-canvas',
  steps: [
    { anchor: 'guest-canvas', media: 'pin', side: 'right' },
    { anchor: 'guest-panel', media: 'team', side: 'left' },
  ],
};

export const TOURS: Tour[] = [
  {
    id: 'home',
    group: 'start',
    icon: 'home',
    offer: 'home-recent',
    href: '/',
    steps: [
      { anchor: 'home-recent', media: 'home', side: 'bottom' },
      { anchor: 'home-activity', media: 'bell', side: 'top' },
      { anchor: 'home-new', media: 'drag', side: 'bottom' },
    ],
  },
  {
    id: 'inbox',
    group: 'start',
    icon: 'inbox',
    offer: 'inbox',
    steps: [
      { anchor: 'inbox', media: 'bell', side: 'right' },
      { anchor: 'inbox-filters', media: 'tags', side: 'bottom' },
      { anchor: null, media: 'gear' },
    ],
  },
  {
    id: 'board',
    group: 'canvas',
    icon: 'board',
    offer: 'dock',
    steps: [
      { anchor: 'dock', media: 'drag', side: 'top' },
      // More holds the other tools; Canvas only the boards to create (decision 0121).
      { anchor: 'dock-tools', media: 'toolbar', side: 'top' },
      { anchor: 'dock-more', media: 'types', side: 'top' },
      { anchor: 'card', media: 'toolbar', side: 'right' },
      // The views of a board are turned on from its ⋯ menu (decision 0121).
      { anchor: 'board-menu', media: 'morph', side: 'bottom' },
    ],
  },
  {
    id: 'moodboard',
    group: 'canvas',
    icon: 'image',
    kind: 'moodboard',
    offer: 'moodboard',
    steps: [
      { anchor: 'moodboard', media: 'grid', side: 'bottom' },
      { anchor: 'moodboard-filter', media: 'tags', side: 'bottom' },
      { anchor: 'moodboard-palette', media: 'grid', side: 'left' },
    ],
  },
  {
    id: 'video',
    group: 'canvas',
    icon: 'film',
    tool: 'image',
    offer: 'video',
    steps: [
      { anchor: 'video', media: 'play', side: 'right' },
      { anchor: null, media: 'play' },
      { anchor: null, media: 'clip' },
      { anchor: null, media: 'play' },
    ],
  },
  {
    id: 'storyboard',
    group: 'production',
    icon: 'storyboard',
    kind: 'storyboard',
    offer: 'storyboard-scene',
    steps: [
      { anchor: 'storyboard-scene', media: 'scenes', side: 'bottom' },
      { anchor: 'storyboard-frame', media: 'meta', side: 'right' },
      { anchor: 'storyboard-draw', media: 'draw', side: 'right' },
      // A new draft of the script updates the scenes, never the frames (decision 0084).
      { anchor: 'storyboard-import', media: 'scenes', side: 'bottom' },
    ],
  },
  {
    id: 'draw',
    group: 'production',
    icon: 'pen',
    kind: 'storyboard',
    offer: 'draw-tools',
    steps: [
      { anchor: 'draw-tools', media: 'draw', side: 'right' },
      { anchor: 'draw-nav', media: 'scenes', side: 'bottom', keys: ['←', '→'] },
      { anchor: null, media: 'pan' },
    ],
  },
  {
    id: 'shotlist',
    group: 'production',
    icon: 'shotlist',
    kind: 'shotlist',
    offer: 'shotlist',
    steps: [
      { anchor: 'shotlist', media: 'rows', side: 'bottom' },
      { anchor: 'shotlist-layouts', media: 'morph', side: 'bottom' },
      { anchor: 'shotlist-bar', media: 'export', side: 'bottom' },
    ],
  },
  {
    id: 'schedule',
    group: 'production',
    icon: 'calendar',
    kind: 'schedule',
    offer: 'schedule',
    steps: [
      // The Production board's calendar, for every storyboard of the project (decision 0123).
      { anchor: 'schedule-queue', media: 'drag', side: 'right' },
      // The Storyboard filter, the dots and whole scenes; only on the Production board.
      { anchor: 'schedule-storyboards', media: 'tags', side: 'right' },
      // Includes drag-created dates: the whole gesture is one undo step. Phase 2 (0089): a
      // block drawn on empty time, its type from a menu.
      { anchor: 'schedule-days', media: 'calendar', side: 'left', keys: ['Alt', 'N', '1–5'] },
      // Phase 3: a whole day dragged by its heading; a taken date swaps the two days.
      { anchor: 'schedule-day-head', media: 'calendar', side: 'bottom', keys: ['Alt', '←', '→'] },
      {
        anchor: 'schedule-save',
        media: 'versions',
        side: 'bottom',
        keys: [isMac() ? '⌘' : 'Ctrl', 'Z'],
      },
      // Per-person calls of the day (0092): only the exceptions to the day's call.
      { anchor: 'schedule-calls', media: 'users', side: 'left' },
      // The sheet derives key times, locations and row pictures from the board (0090), and
      // prints the called crew with phones (0092).
      { anchor: 'schedule-callsheet', media: 'export', side: 'bottom' },
    ],
  },
  {
    id: 'troupe',
    group: 'production',
    icon: 'people',
    offer: 'troupe',
    steps: [
      { anchor: 'troupe', media: 'users', side: 'bottom' },
      { anchor: 'troupe-person', media: 'team', side: 'left' },
      { anchor: 'troupe-paste', media: 'rows', side: 'left' },
      // Where the roster is used: the day's calls and the call sheet (0092).
      { anchor: null, media: 'calendar' },
    ],
  },
  {
    id: 'setplan',
    group: 'production',
    icon: 'planCamera',
    tool: 'plan',
    offer: 'plan-tools',
    steps: [
      // The editor of decision 0104: tools, library, right panel, setups.
      { anchor: 'plan-tools', media: 'plan', side: 'top' },
      { anchor: 'plan-library', media: 'drag', side: 'right' },
      { anchor: 'plan-properties', media: 'plan', side: 'left' },
      { anchor: 'plan-setups', media: 'plan', side: 'bottom' },
      // The walls and openings tools and the background picture (decision 0110).
      { anchor: 'plan-walls', media: 'plan', side: 'top', keys: ['W', 'D'] },
      { anchor: 'plan-background', media: 'plan', side: 'bottom' },
      // Moving round the plan, by pointer and by keys, as on the board (decision 0118).
      { anchor: null, media: 'plan', keys: ['Space', '0', '+', '−'] },
    ],
  },
  {
    // Links of the plan to the cards of the project (decision 0104): offered with the scene chip.
    id: 'setplanLinks',
    group: 'production',
    icon: 'link',
    tool: 'plan',
    offer: 'plan-scene-chip',
    steps: [
      { anchor: 'plan-scene-chip', media: 'scenes', side: 'bottom' },
      { anchor: 'plan-properties', media: 'plan', side: 'left' },
      { anchor: 'plan-sun', media: 'plan', side: 'left' },
      { anchor: null, media: 'rows' },
    ],
  },
  {
    // Outputs of the plan (decision 0111): the export dialog, the sheet, the read-only view.
    id: 'setplanOutputs',
    group: 'production',
    icon: 'download',
    tool: 'plan',
    offer: 'plan-export-button',
    steps: [
      { anchor: 'plan-export-button', media: 'export', side: 'bottom' },
      { anchor: 'plan-export', media: 'export', side: 'left' },
      { anchor: null, media: 'plan' },
    ],
  },
  {
    id: 'characters',
    group: 'production',
    icon: 'user',
    offer: 'story-panel',
    steps: [
      { anchor: 'story-panel', media: 'sheet', side: 'left' },
      { anchor: null, media: 'scenes' },
      { anchor: null, media: 'sheet' },
    ],
  },
  {
    id: 'review',
    group: 'collaboration',
    icon: 'people',
    kind: 'review',
    // The stage, not the list of frames: a phone shows no list.
    offer: 'review-stage',
    steps: [
      { anchor: 'review-frames', media: 'rows', side: 'right' },
      { anchor: 'review-stage', media: 'pin', side: 'left' },
      { anchor: 'review-decision', media: 'team', side: 'top' },
    ],
  },
  {
    id: 'comments',
    group: 'collaboration',
    icon: 'comment',
    offer: 'comments-panel',
    steps: [
      { anchor: 'comments-panel', media: 'team', side: 'left' },
      { anchor: 'comments-on-board', media: 'pin', side: 'left' },
      { anchor: 'comments-composer', media: 'team', side: 'left' },
    ],
  },
  {
    id: 'sharing',
    group: 'collaboration',
    icon: 'people',
    offer: 'share-tabs',
    steps: [
      { anchor: 'share-tabs', media: 'users', side: 'bottom' },
      { anchor: 'share-invite', media: 'users', side: 'bottom' },
      { anchor: 'share-roles', media: 'users', side: 'bottom' },
      { anchor: 'share-link', media: 'team', side: 'top' },
      // On the guest tab: skipped while the people tab is open.
      { anchor: 'share-guest-form', media: 'team', side: 'top' },
    ],
  },
  {
    id: 'versions',
    group: 'collaboration',
    icon: 'clock',
    offer: 'versions',
    steps: [
      { anchor: 'versions-tabs', media: 'versions', side: 'bottom' },
      { anchor: 'versions-list', media: 'versions', side: 'top' },
      { anchor: null, media: 'versions' },
    ],
  },
  {
    id: 'present',
    group: 'collaboration',
    icon: 'play',
    offer: 'present',
    steps: [
      { anchor: 'present', media: 'slides', side: 'bottom' },
      { anchor: 'present-header', media: 'slides', side: 'bottom' },
      { anchor: null, media: 'slides', keys: ['←', '→'] },
    ],
  },
  {
    id: 'export',
    group: 'tools',
    icon: 'download',
    offer: 'export',
    steps: [
      { anchor: 'export-controls', media: 'export', side: 'right' },
      { anchor: 'export-preview', media: 'export', side: 'left' },
      { anchor: 'export-departments', media: 'export', side: 'right' },
      { anchor: 'export-heading', media: 'slides', side: 'right' },
      { anchor: null, media: 'clip' },
    ],
  },
  {
    id: 'clipper',
    group: 'tools',
    icon: 'link',
    offer: null,
    steps: [
      { anchor: null, media: 'clip' },
      { anchor: null, media: 'extension' },
      { anchor: null, media: 'columns' },
    ],
  },
  {
    id: 'phone',
    group: 'tools',
    icon: 'tiles',
    offer: null,
    steps: [
      { anchor: null, media: 'phone' },
      { anchor: null, media: 'tabbar' },
      { anchor: null, media: 'capture' },
    ],
  },
  {
    // Settings → Modules (decision 0121).
    id: 'modules',
    group: 'tools',
    icon: 'layers',
    offer: 'modules',
    href: '/settings?section=modules',
    steps: [
      { anchor: 'modules', media: 'gear', side: 'top' },
      { anchor: null, media: 'types' },
    ],
  },
  {
    // The search in the settings sidebar, and on the phone's settings home (#700).
    id: 'settingsSearch',
    group: 'tools',
    icon: 'search',
    offer: 'settings-search',
    // The settings home: on a phone the search is there, not on a page.
    href: '/settings',
    steps: [
      { anchor: 'settings-search', media: 'search', side: 'right' },
      { anchor: 'settings-search', media: 'search', side: 'right', keys: ['↑', '↓', '↵', 'Esc'] },
    ],
  },
  {
    id: 'classifications',
    group: 'admin',
    icon: 'tag',
    admin: true,
    offer: 'classifications',
    href: '/settings?section=classifications',
    steps: [
      { anchor: 'classifications', media: 'tags', side: 'top' },
      { anchor: null, media: 'tags' },
      { anchor: null, media: 'tags' },
    ],
  },
  {
    id: 'backups',
    group: 'admin',
    icon: 'archive',
    admin: true,
    offer: 'backups',
    href: '/settings?section=backups',
    steps: [
      { anchor: 'backups', media: 'backup', side: 'bottom' },
      { anchor: 'backups-history', media: 'backup', side: 'top' },
      { anchor: 'backups-now', media: 'backup', side: 'bottom' },
    ],
  },
  {
    id: 'server',
    group: 'admin',
    icon: 'tiles',
    admin: true,
    offer: 'server',
    href: '/settings?section=server',
    steps: [
      { anchor: 'server', media: 'gear', side: 'bottom' },
      { anchor: 'server-view', media: 'gear', side: 'bottom' },
      { anchor: 'server-health', media: 'gear', side: 'top' },
      { anchor: 'server-problems', media: 'bell', side: 'top' },
      { anchor: 'server-alerts', media: 'bell', side: 'top' },
    ],
  },
  {
    id: 'updates',
    group: 'admin',
    icon: 'upload',
    admin: true,
    offer: 'updates',
    href: '/settings?section=updates',
    steps: [
      { anchor: 'updates', media: 'versions', side: 'bottom' },
      { anchor: 'updates-alerts', media: 'bell', side: 'top' },
      { anchor: 'updates-history', media: 'versions', side: 'top' },
    ],
  },
  {
    id: 'demo',
    group: 'start',
    icon: 'clock',
    demo: true,
    offer: 'demo-pill',
    steps: [
      { anchor: 'demo-pill', media: 'home', side: 'bottom' },
      { anchor: null, media: 'export' },
      { anchor: null, media: 'gear' },
    ],
  },
  {
    id: 'storage',
    group: 'admin',
    icon: 'disk',
    admin: true,
    offer: 'storage-limits',
    href: '/settings?section=workspace',
    steps: [
      { anchor: 'storage-used', media: 'gear', side: 'bottom' },
      { anchor: 'storage-limits', media: 'gear', side: 'top' },
      { anchor: null, media: 'users' },
    ],
  },
  {
    id: 'videoCopies',
    group: 'admin',
    icon: 'play',
    admin: true,
    offer: 'video-presets',
    href: '/settings?section=video',
    steps: [
      { anchor: 'video-encoder', media: 'gear', side: 'bottom' },
      { anchor: 'video-presets', media: 'play', side: 'top' },
      { anchor: 'video-existing', media: 'gear', side: 'top' },
    ],
  },
  {
    id: 'users',
    group: 'admin',
    icon: 'user',
    admin: true,
    offer: 'users',
    href: '/settings/team',
    steps: [
      { anchor: 'users', media: 'users', side: 'top' },
      { anchor: 'users-invite', media: 'users', side: 'bottom' },
      { anchor: null, media: 'gear' },
    ],
  },
];

export const GROUPS: TourGroup[] = [
  'start',
  'canvas',
  'production',
  'collaboration',
  'tools',
  'admin',
];

/**
 * The tours a person can see: administration ones for administrators, the demo's in the demo,
 * and not those of a module they turned off (`off`, decision 0121).
 */
export function toursFor(admin: boolean, demo = false, off: readonly string[] = []): Tour[] {
  return TOURS.filter(
    (tour) => (admin || !tour.admin) && (demo || !tour.demo) && offered(off, 'tours', tour.id),
  );
}

/** The translation keys of a tour's step. */
export function stepKeys(tourId: string, index: number) {
  const base = `tutorial.tours.${tourId}.steps.${index}`;
  return { title: `${base}.title`, text: `${base}.text` };
}

/** Every tour, the welcome and the guest one included, by id. */
export function findTour(id: string): Omit<Tour, 'group' | 'icon'> | undefined {
  return id === WELCOME.id ? WELCOME : id === GUEST.id ? GUEST : TOURS.find((t) => t.id === id);
}
