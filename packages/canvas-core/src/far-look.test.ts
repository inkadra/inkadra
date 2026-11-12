// SPDX-License-Identifier: MPL-2.0
import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { FAR_ZOOM } from './card-size.ts';
import { FAR_BLOCK, farLook } from './far-look.ts';

const card = (type: string, patch: Record<string, unknown> = {}) =>
  ({ id: type, type, x: 0, y: 0, w: 240, z: 'a0', parent: null, ...patch }) as unknown as Element;
const far = { zoom: 0.2 };
const block = { look: 'block', color: FAR_BLOCK };
const youtube = 'https://www.youtube.com/watch?v=abc';
const playable = (url: string) => url === youtube;

describe('farLook', () => {
  it('draws every card as usual from FAR_ZOOM on, and arrows at every zoom', () => {
    expect(farLook(card('note'), { zoom: FAR_ZOOM })).toEqual({ look: 'normal' });
    expect(farLook(card('image'), { zoom: 1 })).toEqual({ look: 'normal' });
    expect(farLook(card('arrow'), far)).toEqual({ look: 'normal' });
    expect(farLook(card('note'), { zoom: FAR_ZOOM - 0.01 })).toEqual(block);
  });

  it('keeps only the picture of a card that has one, on its surface', () => {
    for (const type of ['image', 'frame', 'plan', 'character'])
      expect(farLook(card(type), far), type).toEqual({ look: 'picture', surface: true });
    expect(farLook(card('location', { assetId: 'a' }), far).look).toBe('picture');
    expect(farLook(card('map', { imageAssetId: 'a' }), far).look).toBe('picture');
    expect(farLook(card('file', { assetId: 'a' }), far).look).toBe('picture');
    expect(farLook(card('color', { hex: '#AABBCC' }), far)).toEqual({
      look: 'swatch',
      color: '#AABBCC',
      surface: true,
    });
  });

  it('fills a card with nothing to picture: a block, a tinted note its tint', () => {
    for (const type of ['note', 'todo', 'table', 'section', 'board', 'location', 'map'])
      expect(farLook(card(type), far), type).toEqual(block);
    expect(farLook(card('note', { color: 'blue' }), far)).toEqual({ look: 'tint', color: 'blue' });
  });

  it('pictures nothing with an asset the client cannot show yet', () => {
    const ctx = { ...far, shown: () => false };
    expect(farLook(card('file', { assetId: 'a' }), ctx)).toEqual(block);
    expect(farLook(card('map', { imageAssetId: 'a' }), ctx)).toEqual(block);
    expect(farLook(card('link', { url: 'https://a.b', imageAssetId: 'a' }), ctx)).toEqual(block);
    for (const type of ['image', 'frame', 'character'])
      expect(farLook(card(type, { assetId: 'a' }), ctx).look, type).toBe('picture');
    expect(farLook(card('location', { assetId: 'a' }), ctx).look).toBe('picture');
  });

  it('shows a link preview while the card shows it: image by showInfo, video by showPreview', () => {
    const ctx = { ...far, playable };
    const link = (patch: Record<string, unknown>) => farLook(card('link', patch), ctx).look;
    expect(link({ url: 'https://a.b' })).toBe('block');
    expect(link({ url: 'https://a.b', imageAssetId: 'a' })).toBe('picture');
    expect(link({ url: 'https://a.b', imageAssetId: 'a', showInfo: false })).toBe('block');
    expect(link({ url: 'https://a.b', imageAssetId: 'a', showPreview: false })).toBe('picture');
    expect(link({ url: youtube })).toBe('picture');
    expect(link({ url: youtube, showInfo: false })).toBe('picture');
    expect(link({ url: youtube, imageAssetId: 'a', showPreview: false })).toBe('block');
  });

  it('keeps a column or a scene as it is when a child has a picture, else a block', () => {
    const column = card('column', { title: '' });
    const note = card('note', { parent: 'column' });
    const image = card('image', { parent: 'column' });
    expect(farLook(column, { ...far, children: [note, image] })).toEqual({ look: 'surface' });
    expect(farLook(column, { ...far, children: [note] })).toEqual(block);
    expect(farLook(column, far)).toEqual(block);
    const collapsed = card('column', { collapsed: true });
    expect(farLook(collapsed, { ...far, children: [image] })).toEqual(block);
    const scene = card('scene', { number: '1', title: '' });
    const frame = card('frame', { parent: 'scene' });
    expect(farLook(scene, { ...far, children: [frame] })).toEqual({ look: 'surface' });
  });

  it('draws a child only by its picture, without its surface, and hides the rest', () => {
    const inside = (type: string, patch: Record<string, unknown> = {}) =>
      farLook(card(type, { parent: 'column', ...patch }), far);
    expect(inside('image')).toEqual({ look: 'picture', surface: false });
    expect(inside('color', { hex: '#000000' })).toEqual({
      look: 'swatch',
      color: '#000000',
      surface: false,
    });
    expect(inside('note', { color: 'green' })).toEqual({ look: 'hidden' });
    expect(inside('todo')).toEqual({ look: 'hidden' });
  });
});
