import type { StorageLimits, StorageUsage, UpdateStorageLimits } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { Icon, Segmented, Select } from '@inkadra/ui';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { formatStorage } from './StorageCharts.tsx';
import { SpaceMeter, spaceTone } from './StorageSpace.tsx';
import { trackSave } from './settings-save.ts';
import { Badge, Card, Row } from './settings-ui.tsx';

/** Sizes are powers of 1000, as formatStorage shows them. */
const UNITS = [
  ['MB', 1e6],
  ['GB', 1e9],
  ['TB', 1e12],
] as const;
type Unit = (typeof UNITS)[number][0];
const WARN_OPTIONS = [50, 60, 70, 75, 80, 85, 90, 95];

/** The largest unit the size is at least one of, and the number in it. */
export function splitSize(bytes: number): { amount: string; unit: Unit } {
  const [unit, size] = [...UNITS].reverse().find(([, s]) => bytes >= s) ?? UNITS[0];
  return { amount: String(Math.round((bytes / size) * 100) / 100), unit };
}

export function joinSize(amount: string, unit: Unit): number | null {
  const n = Number(amount.replace(',', '.'));
  const size = UNITS.find(([u]) => u === unit)?.[1] ?? 1e9;
  return Number.isFinite(n) && n > 0 ? Math.round(n * size) : null;
}

/** A size typed as a number and a unit, saved when the field is left or Enter is pressed. */
export function SizeInput({
  value,
  label,
  readOnly,
  onCommit,
}: {
  value: number;
  label: string;
  readOnly?: boolean;
  onCommit?: (bytes: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => splitSize(value));
  useEffect(() => setDraft(splitSize(value)), [value]);
  const commit = (next: { amount: string; unit: Unit }) => {
    const bytes = joinSize(next.amount, next.unit);
    if (bytes === null) setDraft(splitSize(value));
    else if (bytes !== value) onCommit?.(bytes);
  };
  return (
    <>
      <input
        className="ink-input"
        inputMode="decimal"
        aria-label={label}
        value={draft.amount}
        readOnly={readOnly}
        aria-invalid={joinSize(draft.amount, draft.unit) === null || undefined}
        onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
        }}
      />
      <Select
        className="ink-input space-limit__unit"
        aria-label={t('storageLimits.unit', { label })}
        value={draft.unit}
        disabled={readOnly}
        onChange={(unit) => {
          const next = { ...draft, unit: unit as Unit };
          setDraft(next);
          commit(next);
        }}
      >
        {UNITS.map(([u]) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </Select>
    </>
  );
}

export function useStorageLimits() {
  const [limits, setLimits] = useState<StorageLimits | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<StorageLimits>('/instance/storage-limits')
      .then((data) => alive && setLimits(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  const save = useCallback(async (patch: UpdateStorageLimits) => {
    try {
      setLimits(await trackSave(api.patch<StorageLimits>('/instance/storage-limits', patch)));
    } catch {
      setError(true);
    }
  }, []);
  return { limits, error, save };
}

/** "Basta per circa 7 mesi": what is left at the pace of the last 30 days. */
function lasts(left: number, perMonth: number, t: TFunction) {
  if (perMonth <= 0) return null;
  const months = left / perMonth;
  return months >= 1
    ? t('storageLimits.lastsMonths', { count: Math.round(months) })
    : t('storageLimits.lastsWeeks', { count: Math.max(1, Math.round(months * (30 / 7))) });
}

/** Settings → Storage, above the charts of today: the space used, then the limits. */
export function StorageLimitsCards({ usage }: { usage: StorageUsage | null }) {
  const { t, i18n } = useTranslation();
  const { limits, error, save } = useStorageLimits();
  const totalId = useId();
  const perUserId = useId();
  const warnId = useId();
  if (error) return <p role="alert">{t('auth.errors.generic')}</p>;
  if (!limits) return null;
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const originals = usage?.originalBytes ?? limits.usedBytes;
  const derived = usage?.derivedBytes ?? 0;
  const used = usage ? originals + derived : limits.usedBytes;
  const tone = spaceTone(used, limits.total, limits.warnPercent);
  const left =
    limits.total !== null ? Math.max(0, limits.total - used) : (limits.disk?.free ?? null);
  const verdict =
    tone === 'danger' ? null : left === null ? null : lasts(left, limits.growthPerMonth, t);
  const locked = limits.locked.total || limits.locked.perUser;
  const warnLocked = locked;
  const limitRow = (
    key: 'total' | 'perUser',
    id: string,
    value: number | null,
    lockedHere: boolean,
  ) => {
    const label = t(`storageLimits.${key}`);
    if (lockedHere)
      return value === null ? (
        <span className="settings-value">{t('storageLimits.none')}</span>
      ) : (
        <SizeInput value={value} label={label} readOnly />
      );
    return (
      <>
        <Segmented
          label={label}
          name={id}
          value={value === null ? 'none' : 'limit'}
          options={[
            { value: 'none', label: t('storageLimits.none') },
            { value: 'limit', label: t('storageLimits.limit') },
          ]}
          onChange={(choice) =>
            void save({
              [key]: choice === 'none' ? null : (value ?? (key === 'total' ? 500e9 : 5e9)),
            })
          }
        />
        {value !== null && (
          <SizeInput
            value={value}
            label={label}
            onCommit={(bytes) => void save({ [key]: bytes })}
          />
        )}
      </>
    );
  };
  return (
    <>
      <Card
        title={t('storageLimits.usedTitle')}
        tour="storage-used"
        className="space-card"
        action={
          tone === 'danger' ? (
            <Badge tone="danger">{t('storageSpace.full')}</Badge>
          ) : verdict ? (
            <Badge tone={tone === 'warn' ? 'warn' : 'ok'}>{verdict}</Badge>
          ) : null
        }
      >
        <p className="space-card__big">
          {size(used)}{' '}
          <small>
            {[
              limits.total !== null && t('storageLimits.ofLimit', { limit: size(limits.total) }),
              limits.disk && t('storageLimits.disk', { size: size(limits.disk.total) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </p>
        {limits.total !== null && (
          <SpaceMeter
            originals={originals}
            derived={derived}
            limit={limits.total}
            tone={tone}
            label={t('storageLimits.usedTitle')}
          />
        )}
        <p className="space-card__meta">
          {t('storageLimits.usedDetail', { originals: size(originals), derived: size(derived) })}
        </p>
      </Card>
      <Card
        title={t('storageLimits.title')}
        tour="storage-limits"
        action={
          locked && (
            <span className="space-chip">
              <Icon name="lock" size={12} />
              {t('storageLimits.locked')}
            </span>
          )
        }
      >
        {locked && (
          <p className="space-banner space-banner--info">
            <Icon name="lock" size={14} />
            <span>
              {t('storageLimits.lockedHelp')} (<code>STORAGE_LIMIT</code>,{' '}
              <code>STORAGE_LIMIT_PER_USER</code>)
            </span>
          </p>
        )}
        <div className="settings-rows">
          <Row label={t('storageLimits.total')} help={t('storageLimits.totalHelp')}>
            <span className="space-limit">
              {limitRow('total', totalId, limits.total, limits.locked.total)}
            </span>
          </Row>
          <Row label={t('storageLimits.perUser')} help={t('storageLimits.perUserHelp')}>
            <span className="space-limit">
              {limitRow('perUser', perUserId, limits.perUser, limits.locked.perUser)}
            </span>
          </Row>
          <Row
            label={t('storageLimits.largestFile')}
            help={
              <>
                {t('storageLimits.fromServer')} <code>UPLOAD_MAX_SIZE</code>
              </>
            }
          >
            <span className="settings-value">
              {limits.uploadMaxSize > 0
                ? formatStorage(limits.uploadMaxSize, i18n.language)
                : t('storageLimits.none')}
            </span>
          </Row>
          <Row label={t('storageLimits.warn')} help={t('storageLimits.warnHelp')} htmlFor={warnId}>
            <Select
              id={warnId}
              className="ink-input space-limit__unit"
              value={String(limits.warnPercent)}
              disabled={warnLocked}
              onChange={(v) => void save({ warnPercent: Number(v) })}
            >
              {WARN_OPTIONS.map((p) => (
                <option key={p} value={String(p)}>
                  {p}%
                </option>
              ))}
            </Select>
          </Row>
        </div>
      </Card>
    </>
  );
}
