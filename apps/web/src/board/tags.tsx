import { MAX_TAGS } from '@inkadra/doc-schema';
import type { TagCount } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';

/** Tags already used in each project, for suggestions; refreshed when a picker opens. */
const known = new Map<string, TagCount[]>();

export function useProjectTags(projectId: string): TagCount[] {
  const [tags, setTags] = useState(() => known.get(projectId) ?? []);
  useEffect(() => {
    let alive = true;
    api
      .get<{ items: TagCount[] }>(`/projects/${projectId}/tags`)
      .then((r) => {
        known.set(projectId, r.items);
        if (alive) setTags(r.items);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);
  return tags;
}

/** Tags are compared without case, so they are stored trimmed and in lower case. */
export function normaliseTag(text: string): string {
  return text.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
}

export function TagList({ tags }: { tags: readonly string[] | undefined }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="tag-list">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
        </span>
      ))}
    </span>
  );
}

export function TagEditor({
  tags,
  onChange,
  readOnly,
  projectId,
}: {
  tags: readonly string[];
  onChange: (tags: string[] | undefined) => void;
  readOnly: boolean;
  projectId: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState('');
  const used = useProjectTags(projectId);
  const full = tags.length >= MAX_TAGS;
  const add = (text: string) => {
    const tag = normaliseTag(text);
    setDraft('');
    if (!tag || tags.includes(tag) || full) return;
    onChange([...tags, tag]);
  };
  const remove = (tag: string) => {
    const next = tags.filter((x) => x !== tag);
    onChange(next.length > 0 ? next : undefined);
  };
  const q = normaliseTag(draft);
  const suggestions = used
    .filter((u) => !tags.includes(u.tag) && (!q || u.tag.includes(q)))
    .slice(0, 8);
  return (
    <div className="tag-editor">
      <span className="tag-list">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            {!readOnly && (
              <button
                type="button"
                className="tag-chip__remove"
                aria-label={t('tags.remove', { tag })}
                onClick={() => remove(tag)}
              >
                <Icon name="close" size={10} />
              </button>
            )}
          </span>
        ))}
      </span>
      {!readOnly && (
        <>
          <input
            id={id}
            className="ink-input"
            value={draft}
            disabled={full}
            placeholder={full ? t('tags.max', { count: MAX_TAGS }) : t('tags.placeholder')}
            aria-label={t('tags.add')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
                remove(tags.at(-1) as string);
              }
            }}
            onBlur={() => draft && add(draft)}
          />
          {suggestions.length > 0 && (
            <div className="tag-suggest">
              <span className="tag-suggest__title">{t('tags.suggested')}</span>
              {suggestions.map((s) => (
                <button
                  key={s.tag}
                  type="button"
                  className="tag-chip tag-chip--button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(s.tag)}
                >
                  {s.tag}
                  <span className="tag-chip__count">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Tags of the selected cards: those on every card are shown; edits apply to all of them. */
export function TagPopover({
  x,
  y,
  elements,
  projectId,
  onChange,
  onClose,
}: {
  x: number;
  y: number;
  elements: ReadonlyArray<{ id: string; tags?: string[] | undefined }>;
  projectId: string;
  onChange: (changes: Array<{ id: string; tags: string[] | undefined }>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const common = (elements[0]?.tags ?? []).filter((tag) =>
    elements.every((e) => e.tags?.includes(tag)),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="palette__backdrop tag-popover__backdrop" data-chrome onPointerDown={onClose}>
      <div
        className="tag-popover"
        role="dialog"
        aria-label={t('tags.title')}
        style={{ left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <TagEditor
          tags={common}
          readOnly={false}
          projectId={projectId}
          onChange={(next) => {
            const after = new Set(next ?? []);
            const added = [...after].filter((tag) => !common.includes(tag));
            const removed = common.filter((tag) => !after.has(tag));
            onChange(
              elements.map((e) => {
                const tags = [
                  ...new Set([...(e.tags ?? []).filter((x) => !removed.includes(x)), ...added]),
                ].slice(0, MAX_TAGS);
                return { id: e.id, tags: tags.length > 0 ? tags : undefined };
              }),
            );
          }}
        />
        <div className="tag-popover__actions">
          <button type="button" className="ink-btn ink-btn--primary" onClick={onClose}>
            {t('tags.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
