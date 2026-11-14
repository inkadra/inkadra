import { AUDIT_GROUPS, type AuditEvent, type AuditEvents, type AuditGroup } from '@inkadra/shared';
import { Button, Select } from '@inkadra/ui';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { Card, Row } from './settings-ui.tsx';
import './backup-settings.css';

const GROUPS = Object.keys(AUDIT_GROUPS) as AuditGroup[];

/**
 * The audit log (#806): who changed roles, members, sharing, settings and tokens, what was
 * deleted or backed up, and which sign-ins failed. Read only, newest first, by group.
 */
export function AuditLog() {
  const { t } = useTranslation();
  const filterId = useId();
  const [group, setGroup] = useState<AuditGroup | ''>('');
  const [items, setItems] = useState<AuditEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [retention, setRetention] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const query = new URLSearchParams({ limit: '50' });
      if (group) query.set('group', group);
      if (cursor) query.set('cursor', cursor);
      try {
        const page = await api.get<AuditEvents>(`/instance/audit?${query}`);
        setItems((before) => (cursor ? [...(before ?? []), ...page.items] : page.items));
        setNext(page.nextCursor);
        setRetention(page.retentionDays);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [group],
  );
  useEffect(() => {
    setItems(null);
    void load(null);
  }, [load]);

  const time = (value: string) =>
    formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <Card tour="audit" anchor="audit.filter">
        <div className="settings-rows">
          <Row label={t('audit.filter')} htmlFor={filterId}>
            <Select
              id={filterId}
              className="ink-input"
              data-tour="audit-filter"
              value={group}
              onChange={(value) => setGroup(value as AuditGroup | '')}
            >
              <option value="">{t('audit.groups.all')}</option>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`audit.groups.${g}`)}
                </option>
              ))}
            </Select>
          </Row>
        </div>
      </Card>
      <Card anchor="audit.events" title={t('audit.events')}>
        {error && !items ? (
          <p role="alert" className="backup-settings__empty">
            {t('audit.loadError')}
          </p>
        ) : !items ? (
          <p role="status" className="backup-settings__empty">
            {t('admin.loading')}
          </p>
        ) : items.length === 0 ? (
          <p className="backup-settings__empty">{t('audit.none')}</p>
        ) : (
          <ul className="backup-list">
            {items.map((e) => (
              <li key={e.id} className="backup-list__item">
                <div className="backup-list__text">
                  <span className="backup-list__when">
                    {t('audit.line', {
                      who: e.actor?.name ?? t('audit.nobody'),
                      // Catalogue keys hold no dots: `member.updated` is `member_updated`.
                      what: t(`audit.actions.${e.action.replace('.', '_')}`),
                    })}
                  </span>
                  <span className="backup-list__meta">
                    {[time(e.at), detailText(e), e.ip].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {next && (
          <div className="settings-card__pad">
            <Button disabled={loading} onClick={() => void load(next)}>
              {t('audit.more')}
            </Button>
          </div>
        )}
      </Card>
      {retention !== null && (
        <p className="settings-footnote">{t('audit.retention', { count: retention })}</p>
      )}
    </>
  );
}

const SHOWN = ['name', 'label', 'email', 'role', 'kind', 'client', 'files'] as const;
const value = (v: unknown) => (v === null || v === undefined ? '–' : String(v));

/** What changed (`role: member → admin`), or the names the event keeps. */
export function detailText(e: AuditEvent): string {
  const parts: string[] = [];
  const { changes } = e.details as { changes?: Record<string, [unknown, unknown]> };
  for (const key of SHOWN) if (e.details[key] !== undefined) parts.push(value(e.details[key]));
  if (changes)
    for (const [key, [from, to]] of Object.entries(changes))
      parts.push(`${key}: ${value(from)} → ${value(to)}`);
  return parts.join(' · ');
}
