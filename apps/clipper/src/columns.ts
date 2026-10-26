// SPDX-License-Identifier: MPL-2.0
import type { BoardColumn } from '@inkadra/shared';

/** Reset on every selection; late answers must never supply another board's columns. */
export class ColumnPicker {
  items: BoardColumn[] = [];
  loading = false;
  private run = 0;

  constructor(
    private readonly changed: (state: ColumnPicker) => void,
    private readonly load: (boardId: string) => Promise<BoardColumn[]>,
  ) {}

  async select(boardId: string): Promise<void> {
    const run = ++this.run;
    this.items = [];
    this.loading = true;
    this.changed(this);
    try {
      const items = await this.load(boardId);
      if (run === this.run) this.items = items;
    } catch (err) {
      if (run === this.run) throw err;
    } finally {
      if (run === this.run) {
        this.loading = false;
        this.changed(this);
      }
    }
  }
}
