import type { ContentKind, IconName, ToolKind } from '@inkadra/ui';

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
    { anchor: 'search', media: 'search', side: 'right', keys: ['⌘', 'K'] },
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
      { anchor: 'dock-more', media: 'types', side: 'top' },
      { anchor: 'card', media: 'toolbar', side: 'right' },
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
      { anchor: 'schedule', media: 'calendar', side: 'bottom' },
      { anchor: 'schedule-days', media: 'calendar', side: 'top' },
      { anchor: 'schedule-callsheet', media: 'export', side: 'bottom' },
    ],
  },
  {
    id: 'setplan',
    group: 'production',
    icon: 'planCamera',
    tool: 'plan',
    offer: 'plan-tools',
    steps: [
      { anchor: 'plan-tools', media: 'plan', side: 'top' },
      { anchor: 'plan-icons', media: 'plan', side: 'top' },
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
      { anchor: 'share-link', media: 'team', side: 'top' },
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

/** The tours a person can see: the administration ones only for administrators. */
export function toursFor(admin: boolean): Tour[] {
  return TOURS.filter((tour) => admin || !tour.admin);
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
