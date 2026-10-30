// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isVideoLink, youtubePlayerTime } from './youtube.ts';

describe('external video references', () => {
  it('recognises only supported video links', () => {
    expect(isVideoLink('https://vimeo.com/123456')).toBe(true);
    expect(isVideoLink('https://www.youtube.com/watch?v=abcdefghijk')).toBe(true);
    for (const url of [
      'https://vimeo.com.evil.test/123',
      'https://vimeo.com/channels/123',
      'javascript:alert(1)',
      'broken',
    ])
      expect(isVideoLink(url)).toBe(false);
  });
  it('accepts current time only from the active YouTube iframe and a bounded finite value', () => {
    const event = {
      origin: 'https://www.youtube-nocookie.com',
      source: window,
      data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 67.125 } }),
    };
    expect(youtubePlayerTime(event, window)).toBe(67.125);
    expect(youtubePlayerTime({ ...event, origin: 'https://evil.test' }, window)).toBeNull();
    expect(youtubePlayerTime({ ...event, source: null }, window)).toBeNull();
    expect(youtubePlayerTime(event, null)).toBeNull();
    for (const data of [
      'broken',
      null,
      { event: 'infoDelivery', info: { currentTime: -1 } },
      { event: 'infoDelivery', info: { currentTime: Infinity } },
    ])
      expect(youtubePlayerTime({ ...event, data }, window)).toBeNull();
  });
});
