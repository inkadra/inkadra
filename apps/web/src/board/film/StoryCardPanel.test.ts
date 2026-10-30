import { describe, expect, it } from 'vitest';
import { mapSearchUrl, parseMapUrl, parseScenes } from './StoryCardPanel.tsx';

describe('story card fields', () => {
  it('reads scene numbers as written, once each', () => {
    expect(parseScenes('1, 3A; 12 3A')).toEqual(['1', '3A', '12']);
    expect(parseScenes('  ,  ')).toBeUndefined();
    expect(parseScenes('1234567890123')).toEqual(['123456789012']);
  });

  it('keeps only web addresses as map links', () => {
    expect(parseMapUrl(' https://www.openstreetmap.org/#map=18/45.48/9.20 ')).toBe(
      'https://www.openstreetmap.org/#map=18/45.48/9.20',
    );
    expect(parseMapUrl('javascript:alert(1)')).toBeNull();
    expect(parseMapUrl('Piazza Duca d’Aosta')).toBeNull();
  });

  it('looks addresses up on OpenStreetMap without embedding a map', () => {
    expect(mapSearchUrl('Piazza Duca d’Aosta 1, Milano')).toBe(
      'https://www.openstreetmap.org/search?query=Piazza%20Duca%20d%E2%80%99Aosta%201%2C%20Milano',
    );
  });
});
