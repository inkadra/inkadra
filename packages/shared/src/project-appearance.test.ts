import { describe, expect, it } from 'vitest';
import { defaultProjectIcon, ProjectIcon, UpdateProject } from './projects.ts';

describe('project appearance contract', () => {
  it.each(['🎬', '👩🏽‍💻', '🇮🇹', '1️⃣', '❤️'])('accepts one emoji grapheme: %s', (emoji) => {
    expect(ProjectIcon.safeParse({ shape: 'diamond', color: 'blue', emoji }).success).toBe(true);
  });
  it.each(['', 'abc', '🎬🎨', '<svg>', 'a'.repeat(33)])('rejects invalid emoji: %s', (emoji) => {
    expect(ProjectIcon.safeParse({ shape: 'diamond', color: 'blue', emoji }).success).toBe(false);
  });
  it('keeps existing icons compatible and permits clearing emoji', () => {
    expect(UpdateProject.safeParse({ icon: { shape: 'square', color: 'neutral' } }).success).toBe(
      true,
    );
    expect(
      UpdateProject.safeParse({ icon: { shape: 'square', color: 'green', emoji: null } }).success,
    ).toBe(true);
    expect(UpdateProject.safeParse({ icon: { shape: 'invalid', color: 'green' } }).success).toBe(
      false,
    );
  });
  it('generates stable distinctive defaults with the migration seed formula', () => {
    const icons = Array.from({ length: 16 }, (_, n) => {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
      const icon = defaultProjectIcon(id);
      expect(icon.shape).toBe(['diamond', 'triangle', 'square', 'circle'][n % 4]);
      expect(icon.color).toBe(['blue', 'orange', 'purple', 'green'][Math.floor(n / 4) % 4]);
      expect(icon.emoji).toBeNull();
      return `${icon.shape}/${icon.color}`;
    });
    expect(new Set(icons).size).toBe(16);
  });
});
