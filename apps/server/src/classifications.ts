import {
  CATALOG_UUID,
  ClassificationCatalogs,
  type ClassificationOption,
  DEFAULT_CLASSIFICATIONS,
  SHOT_CATALOG_KEYS,
  type ShotCatalogKey,
} from '@inkadra/shared';
import { count, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { instanceSetting, project } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type CatalogKey = 'projectTypes' | 'tags' | ShotCatalogKey;
const CATALOG_KEYS: readonly CatalogKey[] = ['projectTypes', 'tags', ...SHOT_CATALOG_KEYS];
const textArray = (values: string[]) =>
  sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

export async function readClassifications(db: Pick<Database, 'select'>) {
  const [row] = await db
    .select()
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'classifications'));
  return ClassificationCatalogs.parse(row?.value ?? DEFAULT_CLASSIFICATIONS);
}

/** Never stored: `uses` is counted when read (decision 0126). */
function withoutUses(catalogs: ClassificationCatalogs): ClassificationCatalogs {
  const copy = { ...catalogs };
  for (const key of CATALOG_KEYS)
    copy[key] = catalogs[key].map(({ uses: _uses, ...option }) => option);
  return copy;
}

/** A value removed from a catalog, kept so its id is never reused and can come back. */
interface Deleted {
  key: CatalogKey;
  id: string;
  label: string;
  legacy?: string;
}
const DELETED = 'classifications_deleted';

async function readDeleted(db: Pick<Database, 'select'>): Promise<Deleted[]> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, DELETED));
  return ((row?.value as { values?: Deleted[] } | undefined)?.values ?? []).filter(
    (d) => CATALOG_KEYS.includes(d.key) && typeof d.id === 'string',
  );
}

async function writeSetting(tx: Tx | Database, key: string, value: Record<string, unknown>) {
  await tx
    .insert(instanceSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
}

/**
 * Orders a removal against the writes that add uses (decision 0126). A removal holds it
 * exclusively while it counts; a write that may add a use holds it shared from before it reads the
 * removed values until its commit. Taken before the administration lock (10892), never after.
 */
export async function lockUses(tx: Tx | Database, mode: 'shared' | 'exclusive') {
  await tx.execute(
    mode === 'shared'
      ? sql`select pg_advisory_xact_lock_shared(hashtext('classification-uses'))`
      : sql`select pg_advisory_xact_lock(hashtext('classification-uses'))`,
  );
}

/**
 * Uses by catalog and id: projects of a type, elements with a tag (its id or original text),
 * frames whose shot fields hold a storyboard value. From the project table and the search index
 * (decision 0012), never from documents. Storyboard defaults are not counted: their codes are
 * also words people type.
 */
export async function countUses(
  db: Pick<Database, 'select' | 'execute'>,
  catalogs: Pick<ClassificationCatalogs, CatalogKey>,
) {
  const uses = new Map<string, number>();
  const types = catalogs.projectTypes.map((o) => o.id);
  if (types.length) {
    const rows = await db
      .select({ id: project.type, n: count() })
      .from(project)
      .where(inArray(project.type, types))
      .groupBy(project.type);
    for (const id of types) uses.set(`projectTypes:${id}`, 0);
    for (const r of rows) if (r.id) uses.set(`projectTypes:${r.id}`, r.n);
  }
  const tags = catalogs.tags;
  if (tags.length) {
    const ids = tags.map((o) => o.id.toLowerCase());
    const legacies = tags.map((o) => o.legacy ?? o.id.toLowerCase());
    const rows = await db.execute<{ id: string; n: number }>(sql`
      select o.id, count(i.element_id)::int as n
      from unnest(${textArray(ids)}, ${textArray(legacies)}) as o(id, legacy)
      left join board_element_index i on i.tags && array[o.id, o.legacy]
      group by o.id`);
    for (const r of rows) uses.set(`tags:${r.id}`, r.n);
    for (const o of tags) uses.set(`tags:${o.id}`, uses.get(`tags:${o.id.toLowerCase()}`) ?? 0);
  }
  for (const key of SHOT_CATALOG_KEYS) {
    const ids = catalogs[key].map((o) => o.id).filter((id) => CATALOG_UUID.test(id));
    if (!ids.length) continue;
    // A frame's text holds its shot fields as stored; a UUID is never typed by chance.
    const rows = await db.execute<{ id: string; n: number }>(sql`
      select o.id, count(i.element_id)::int as n
      from unnest(${textArray(ids)}) as o(id)
      left join board_element_index i
        on i.type = 'frame' and i.text like '%' || o.id || '%'
      group by o.id`);
    for (const r of rows) uses.set(`${key}:${r.id}`, r.n);
  }
  return uses;
}

/** The catalogs with `uses` on every value that can be counted, for administrators. */
export async function withUses(
  db: Pick<Database, 'select' | 'execute'>,
  catalogs: ClassificationCatalogs,
) {
  const uses = await countUses(db, catalogs);
  const copy = { ...catalogs };
  for (const key of CATALOG_KEYS)
    copy[key] = catalogs[key].map((o) => {
      const n = uses.get(`${key}:${o.id}`);
      return n === undefined ? o : { ...o, uses: n };
    });
  return copy;
}

/**
 * Saves `next` (already checked by `validateCatalogUpdate`), the caller holding `lockUses`
 * exclusively and then the administration lock. A removed value must be used nowhere at this
 * moment; it is remembered so its id is never taken again and a late use brings it back.
 */
export async function saveCatalogs(
  tx: Tx,
  current: ClassificationCatalogs,
  next: ClassificationCatalogs,
) {
  const removed = CATALOG_KEYS.flatMap((key) =>
    current[key]
      .filter((o) => !next[key].some((n) => n.id === o.id))
      .map((option) => ({ key, option })),
  );
  if (removed.length) {
    const byKey = Object.fromEntries(
      CATALOG_KEYS.map((key) => [key, removed.filter((r) => r.key === key).map((r) => r.option)]),
    ) as Record<CatalogKey, ClassificationOption[]>;
    const uses = await countUses(tx, byKey);
    const used = removed
      .map(({ key, option }) => ({
        catalog: key,
        id: option.id,
        uses: uses.get(`${key}:${option.id}`),
      }))
      .filter((r) => r.uses !== 0);
    if (used.length)
      throw new HttpError('conflict', 'These values are in use: archive them instead.', {
        reason: 'classification_in_use',
        values: used.map((r) => ({ ...r, uses: r.uses ?? null })),
      });
    const deleted = await readDeleted(tx);
    for (const { key, option } of removed)
      deleted.push({
        key,
        id: option.id,
        label: option.label,
        ...(option.legacy ? { legacy: option.legacy } : {}),
      });
    await writeSetting(tx, DELETED, { values: deleted });
  }
  const value = withoutUses(next);
  await writeSetting(tx, 'classifications', value);
  return value;
}

/**
 * A use of a removed value that reaches the server late (an edit not stored yet, an undo, an
 * offline copy, a restored version, an archive) brings the value back, archived, under its own
 * id: no board ever holds an id that no catalog knows (decision 0126).
 */
export async function reviveUsed(
  tx: Tx | Database,
  used: { projectTypes?: Iterable<string>; tags?: Iterable<string>; text?: Iterable<string> },
) {
  await lockUses(tx, 'shared');
  const deleted = await readDeleted(tx);
  if (!deleted.length) return false;
  const types = new Set(used.projectTypes);
  const tags = new Set([...(used.tags ?? [])].map((t) => t.toLowerCase()));
  const text = [...(used.text ?? [])].join(' ');
  const hit = (d: Deleted) =>
    d.key === 'projectTypes'
      ? types.has(d.id)
      : d.key === 'tags'
        ? tags.has(d.id.toLowerCase())
        : text.includes(d.id);
  if (!deleted.some(hit)) return false;
  await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
  const again = await readDeleted(tx);
  const back = again.filter(hit);
  if (!back.length) return false;
  const catalogs = await readClassifications(tx);
  for (const d of back) {
    const options = catalogs[d.key];
    const taken = new Set(
      options.flatMap((o) => [o.id.toLowerCase(), o.label.toLowerCase(), o.legacy ?? '']),
    );
    // Another value may have taken its name since: it comes back under a numbered one.
    let label = d.label;
    for (let n = 2; taken.has(label.toLowerCase()); n++)
      label = `${d.label.slice(0, 40 - ` (${n})`.length)} (${n})`;
    const legacy = d.legacy && !taken.has(d.legacy) ? d.legacy : undefined;
    options.push({ id: d.id, label, archived: true, ...(legacy ? { legacy } : {}) });
  }
  await writeSetting(tx, 'classifications', {
    ...catalogs,
    revision: catalogs.revision + 1,
  });
  await writeSetting(tx, DELETED, { values: again.filter((d) => !hit(d)) });
  return true;
}

/**
 * Updates may rename/reorder/archive, never change legacy bindings, and remove only values added on
 * this instance (UUID ids); whether those are used is checked by `saveCatalogs`. A removed id is
 * never taken again (decision 0126).
 */
export function validateCatalogUpdate(
  current: ClassificationCatalogs,
  next: ClassificationCatalogs,
  deletedIds: ReadonlySet<string> = new Set(),
) {
  if (current.revision !== next.revision)
    throw new HttpError('conflict', 'Configuration changed. Reload and try again.');
  for (const key of ['projectTypes', 'tags', ...SHOT_CATALOG_KEYS] as const) {
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const option of next[key]) {
      const label = option.label.toLowerCase();
      if (ids.has(option.id) || labels.has(label))
        throw new HttpError('bad_request', 'Option IDs and names must be unique.');
      ids.add(option.id);
      labels.add(label);
      const previous = current[key].find((o) => o.id === option.id);
      if (previous && previous.legacy !== option.legacy)
        throw new HttpError('bad_request', 'Legacy bindings are immutable.');
      if (!previous) {
        if (!CATALOG_UUID.test(option.id))
          throw new HttpError('bad_request', 'New options require UUID identifiers.');
        if (deletedIds.has(option.id))
          throw new HttpError('bad_request', 'This identifier belonged to a deleted value.');
        option.legacy =
          key === 'tags'
            ? option.label.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ')
            : undefined;
      }
    }
    if (current[key].some((o) => !ids.has(o.id) && !CATALOG_UUID.test(o.id)))
      throw new HttpError('bad_request', 'Archive options instead of removing them.');
    for (const option of next[key]) {
      if (
        next[key].some(
          (other) =>
            other.id !== option.id &&
            (other.id.toLowerCase() === option.label.toLowerCase() ||
              other.legacy === option.label.toLowerCase()),
        )
      )
        throw new HttpError('bad_request', 'Names cannot reuse another option’s original binding.');
    }
    const bindings = new Set<string>();
    for (const option of next[key]) {
      for (const value of [option.id, option.legacy].filter((v): v is string => !!v)) {
        if (bindings.has(value))
          throw new HttpError('bad_request', 'Option bindings must be unique.');
        bindings.add(value);
      }
    }
  }
  return { ...next, revision: next.revision + 1 };
}

export async function deletedIds(db: Pick<Database, 'select'>) {
  return new Set((await readDeleted(db)).map((d) => d.id));
}

export function validateProjectType(
  options: ClassificationOption[],
  value: string | null | undefined,
  previous?: string | null,
) {
  if (value == null || value === previous) return;
  if (!options.some((o) => o.id === value && !o.archived))
    throw new HttpError('bad_request', 'Choose an active project type.');
}
