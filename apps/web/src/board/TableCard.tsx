// SPDX-License-Identifier: AGPL-3.0-only
import {
  fillTable,
  insertTableColumn,
  insertTableRow,
  parseTsv,
  setTableCell,
  setTableColumnWidth,
} from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Button } from '@inkadra/ui';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useBoard } from './context.ts';
import { webUrl } from './links.ts';
import { LOCAL } from './store.ts';
import { linkLabel } from './table.ts';

type TableElement = Extract<Element, { type: 'table' }>;

/** Narrowest width a column without a set width keeps before the card scrolls sideways. */
const AUTO_MIN = 80;

/** Cell text with its web addresses as links that open in a new tab. */
function CellText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const at = m.index ?? 0;
    // A sentence's full stop or closing bracket is not part of the address.
    const raw = m[0].replace(/[.,;:!?)\]]+$/, '');
    const href = webUrl(raw);
    if (!href) continue;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a
        key={at}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        data-no-drag
        title={raw}
      >
        {linkLabel(href)} ↗
      </a>,
    );
    last = at + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * A table card (#317): plain-text cells with links detected, an optional header row tinted
 * from the card palette. Double click or Enter edits it cell by cell: arrows, Tab and Enter
 * move, pasting a spreadsheet range fills the table from the cell, and the right edge of a
 * column in the first row resizes it.
 */
export function TableCard({ element, editing }: { element: TableElement; editing: boolean }) {
  const { store, readOnly, setEditing, scale } = useBoard();
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [resizing, setResizing] = useState<{ id: string; width: number } | null>(null);
  const cells = useRef(new Map<string, HTMLInputElement>());
  /** The cell to focus once the table has the row or column it was waiting for. */
  const pending = useRef<{ r: number; c: number } | null>(null);
  const { columns, rows } = element;
  const header = element.header === true;

  /** Editing just started: the cell last pressed, or the first one, takes the focus. */
  const started = useRef(false);
  useEffect(() => {
    if (!editing) {
      if (started.current) pending.current = null;
      started.current = false;
      return;
    }
    const target = pending.current ?? (started.current ? null : { r: 0, c: 0 });
    started.current = true;
    if (!target) return;
    const input = cells.current.get(`${target.r}:${target.c}`);
    if (!input) return;
    pending.current = null;
    if (document.activeElement !== input) {
      input.focus();
      input.select();
    }
  });

  const width = (id: string, set?: number) => (resizing?.id === id ? resizing.width : set);
  const fixed = columns.reduce((sum, c) => sum + (width(c.id, c.width) ?? 0), 0);
  const minWidth =
    fixed + columns.filter((c) => width(c.id, c.width) === undefined).length * AUTO_MIN;

  const commit = (rowId: string, columnId: string) => {
    const key = `${rowId}:${columnId}`;
    const draft = drafts[key];
    if (draft === undefined) return;
    setTableCell(store.doc, element.id, rowId, columnId, draft, LOCAL);
    setDrafts(({ [key]: _, ...rest }) => rest);
  };

  /** Moves the focus to the cell at r, c, adding a row past the last one. */
  const go = (r: number, c: number) => {
    if (c >= columns.length) {
      r += 1;
      c = 0;
    } else if (c < 0) {
      r -= 1;
      c = columns.length - 1;
    }
    if (r < 0) return;
    if (r >= rows.length) {
      if (readOnly || insertTableRow(store.doc, element.id, undefined, LOCAL) === null) return;
    }
    pending.current = { r, c };
    const input = cells.current.get(`${r}:${c}`);
    if (input) {
      pending.current = null;
      input.focus();
      input.select();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    let move: [number, number] | null = null;
    if (e.key === 'Tab') move = [r, c + (e.shiftKey ? -1 : 1)];
    else if (e.key === 'Enter') move = [r + (e.shiftKey ? -1 : 1), c];
    else if (e.key === 'ArrowUp') move = [r - 1, c];
    else if (e.key === 'ArrowDown') move = [r + 1, c];
    else if (e.key === 'ArrowLeft' && atStart && c > 0) move = [r, c - 1];
    else if (e.key === 'ArrowRight' && atEnd && c < columns.length - 1) move = [r, c + 1];
    else if (e.key === 'Escape') {
      e.preventDefault();
      input.blur();
      setEditing(null);
      return;
    }
    if (!move) return;
    e.preventDefault();
    // Arrows stay inside the table; only Tab and Enter add a row past the last one.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (move[0] < 0 || move[0] >= rows.length))
      return;
    go(move[0], move[1]);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain');
    // One line without tabs is typed into the cell; a range fills the table from here.
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const row = rows[r];
    const col = columns[c];
    if (row && col) setDrafts(({ [`${row.id}:${col.id}`]: _, ...rest }) => rest);
    fillTable(store.doc, element.id, r, c, parseTsv(text), LOCAL);
  };

  const startResize = (e: PointerEvent<HTMLSpanElement>, id: string, from: number) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const next = (ev: globalThis.PointerEvent) =>
      Math.round(Math.min(1200, Math.max(40, from + (ev.clientX - x0) / scale)));
    const move = (ev: globalThis.PointerEvent) => setResizing({ id, width: next(ev) });
    const up = (ev: globalThis.PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setResizing(null);
      if (ev.type === 'pointerup') setTableColumnWidth(store.doc, element.id, id, next(ev), LOCAL);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  return (
    <div className="tcard" data-no-drag={editing ? '' : undefined}>
      <table
        className={[
          'tcard__grid',
          header && 'has-header',
          header && element.color && `tcard__grid--${element.color}`,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ minWidth }}
      >
        <colgroup>
          {columns.map((col) => (
            <col key={col.id} style={{ width: width(col.id, col.width) }} />
          ))}
        </colgroup>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id}>
              {columns.map((col, c) => {
                const Cell = header && r === 0 ? 'th' : 'td';
                const key = `${row.id}:${col.id}`;
                const value = row.cells[col.id] ?? '';
                return (
                  <Cell
                    key={col.id}
                    scope={Cell === 'th' ? 'col' : undefined}
                    data-table-cell={`${r}:${c}`}
                    // The canvas starts editing on the second press of a double click.
                    onPointerDown={
                      editing
                        ? undefined
                        : () => {
                            pending.current = { r, c };
                          }
                    }
                  >
                    {editing ? (
                      <input
                        ref={(el) => {
                          if (el) cells.current.set(`${r}:${c}`, el);
                          else cells.current.delete(`${r}:${c}`);
                        }}
                        className="tcard__input"
                        value={drafts[key] ?? value}
                        readOnly={readOnly}
                        maxLength={2000}
                        aria-label={t('board.table.cell', { row: r + 1, column: c + 1 })}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        onBlur={() => commit(row.id, col.id)}
                        onKeyDown={(e) => onKey(e, r, c)}
                        onPaste={(e) => onPaste(e, r, c)}
                      />
                    ) : (
                      <CellText text={value} />
                    )}
                    {editing && r === 0 && !readOnly && (
                      <span
                        className="tcard__resize"
                        // Pointer only: the cell menu and Tab reach everything else.
                        aria-hidden="true"
                        title={t('board.table.resize')}
                        onPointerDown={(e) =>
                          startResize(
                            e,
                            col.id,
                            width(col.id, col.width) ??
                              e.currentTarget.parentElement?.offsetWidth ??
                              120,
                          )
                        }
                        onDoubleClick={() =>
                          setTableColumnWidth(store.doc, element.id, col.id, undefined, LOCAL)
                        }
                      />
                    )}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && !readOnly && (
        <div className="tcard__add">
          <Button
            variant="ghost"
            icon="plus"
            onClick={() => {
              if (insertTableRow(store.doc, element.id, undefined, LOCAL) !== null)
                pending.current = { r: rows.length, c: 0 };
            }}
          >
            {t('board.table.addRow')}
          </Button>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() => {
              if (insertTableColumn(store.doc, element.id, undefined, LOCAL) !== null)
                pending.current = { r: 0, c: columns.length };
            }}
          >
            {t('board.table.addColumn')}
          </Button>
        </div>
      )}
    </div>
  );
}
