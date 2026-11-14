import { describe, expect, it } from 'vitest';
import { detailText } from './AuditLog.tsx';

const event = (details: Record<string, unknown>) => ({
  id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
  at: '2026-11-14T10:00:00.000Z',
  action: 'member.updated' as const,
  actor: null,
  targetType: null,
  targetId: null,
  projectId: null,
  ip: null,
  details,
});

describe('detailText (#806)', () => {
  it('shows the names an event keeps, then what changed', () => {
    expect(detailText(event({ name: 'Ada', changes: { role: ['member', 'admin'] } }))).toBe(
      'Ada · role: member → admin',
    );
    expect(detailText(event({ changes: { storageLimit: [null, 1024] } }))).toBe(
      'storageLimit: – → 1024',
    );
    expect(detailText(event({ userId: 'x' }))).toBe('');
  });
});
