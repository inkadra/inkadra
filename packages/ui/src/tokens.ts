// SPDX-License-Identifier: MPL-2.0
/**
 * Design tokens, from the "Fondamenta" page of the design reference.
 * styles.css exposes them as CSS custom properties (--ink-*); keep both in sync.
 * Colour rule: near-monochrome. Blue only for selection, focus and the primary action.
 */

export const dark = {
  'bg-rail': '#0E0E10',
  'bg-app': '#141416',
  'bg-panel': '#121214',
  'bg-canvas': '#161616',
  'surface-1': '#1C1C1F',
  'surface-2': '#26262A',
  'surface-3': '#2A2A2E',
  'surface-float': '#1F1F23',
  'border-subtle': '#1C1C1F',
  'border-muted': '#232327',
  'border-default': '#2A2A2E',
  'border-strong': '#34343A',
  'canvas-dot': '#2E2E2E',
  'text-primary': '#EDEDED',
  'text-secondary': '#9A9A9A',
  'text-muted': '#808086',
  'text-icon': '#C8C8CC',
  'text-nav': '#A8A8AE',
  'accent-primary': '#3B7CF6',
  'accent-button': '#2563EB',
  'accent-button-hover': '#4E8AF8',
  'accent-button-active': '#2F6AE0',
  'on-accent': '#FFFFFF',
  'accent-soft-bg': '#1E2A44',
  'accent-soft-fg': '#9DB8F2',
  'status-ok': '#46A758',
  'status-warn': '#F2B08A',
  'status-danger': '#E5484D',
  'danger-bg': '#2A1A1B',
  'danger-border': '#3A2326',
  'danger-fg': '#F2A9AC',
  'tag-blue': '#9DB8F2',
  'tag-orange': '#F2B08A',
  'tag-purple': '#C3B2F2',
  'tag-green': '#9FE0B4',
  'logo-tile': '#EDEDED',
  'logo-ink': '#0E0E10',
  'tag-blue-bg': '#1E2A44',
  'tag-orange-bg': '#35271F',
  'tag-purple-bg': '#2D2540',
  'tag-green-bg': '#20362A',
} as const;

export type ColorToken = keyof typeof dark;

export const light: Record<ColorToken, string> = {
  'bg-rail': '#EFEFEC',
  'bg-app': '#EFEFEC',
  'bg-panel': '#FAFAF8',
  'bg-canvas': '#FAFAF8',
  'surface-1': '#FFFFFF',
  'surface-2': '#F6F6F4',
  'surface-3': '#E4E4E0',
  'surface-float': '#FFFFFF',
  'border-subtle': '#FFFFFF',
  'border-muted': '#E8E8E4',
  'border-default': '#E4E4E0',
  'border-strong': '#D9D9D5',
  'canvas-dot': '#DCDCD8',
  'text-primary': '#161616',
  'text-secondary': '#5E5E5A',
  'text-muted': '#8A8A86',
  'text-icon': '#383836',
  'text-nav': '#4A4A47',
  'accent-primary': '#3B7CF6',
  'accent-button': '#2563EB',
  'accent-button-hover': '#3B7CF6',
  'accent-button-active': '#1D4FC4',
  'on-accent': '#FFFFFF',
  'accent-soft-bg': '#E6EDFB',
  'accent-soft-fg': '#2F5AAE',
  'status-ok': '#23743F',
  'status-warn': '#A5521F',
  'status-danger': '#C8343A',
  'danger-bg': '#FBEAEA',
  'danger-border': '#F2CFD0',
  'danger-fg': '#A1262B',
  'tag-blue': '#2F5AAE',
  'tag-orange': '#A5521F',
  'tag-purple': '#5B3FB0',
  'tag-green': '#23743F',
  'logo-tile': '#161616',
  'logo-ink': '#FAFAF8',
  'tag-blue-bg': '#E6EDFB',
  'tag-orange-bg': '#FAEDE4',
  'tag-purple-bg': '#EFEAF9',
  'tag-green-bg': '#E7F3EB',
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } as const;
export const radius = { handle: 2, key: 4, menu: 6, control: 8, card: 10, panel: 12 } as const;
export const layout = { rail: 52, sidebar: 210, header: 48, inspector: 300, grid: 22 } as const;
export const motion = {
  hover: '120ms',
  menu: '180ms',
  panel: '240ms',
  ease: 'cubic-bezier(.2,.8,.2,1)',
} as const;

/** Text styles: [size px, weight, use]. */
export const type = {
  pageTitle: [28, 600],
  sectionTitle: [18, 600],
  noteBody: [15, 400],
  ui: [13, 400],
  control: [12, 500],
  meta: [11, 400],
  label: [11, 600],
  tag: [10, 500],
} as const;
