// Mondrian layout of a block's transactions, as drawn by Bitmap renderers.
//
// Each transaction becomes a square sized by its total output value
// (size = ceil(log10(sats)) - 5, minimum 1), packed in transaction order.
// The packing is a TypeScript port of MondrianLayout from bitfeed
// (client/src/models/TxMondrianPoolScene.js):
//
//   Copyright (c) 2021 Mononaut
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

export type Square = { x: number; y: number; r: number };

type Slot = { x: number; y: number; r: number };
type Row = { y: number; slots: Slot[]; map: Map<number, Slot> };

export function txSize(sats: number): number {
  if (sats <= 100_000) return 1;
  return Math.max(1, Math.ceil(Math.log10(sats)) - 5);
}

class MondrianLayout {
  rows: Row[] = [];
  width: number;
  constructor(width: number) {
    this.width = width;
  }

  getRow(y: number): Row | undefined {
    return this.rows[y];
  }

  addRow(): Row {
    const row: Row = { y: this.rows.length, slots: [], map: new Map() };
    this.rows.push(row);
    return row;
  }

  addSlot(slot: Slot): Slot | undefined {
    if (slot.r <= 0) return undefined;
    const row = this.getRow(slot.y);
    if (!row) return undefined;
    const existing = row.map.get(slot.x);
    if (existing) {
      if (slot.r > existing.r) existing.r = slot.r;
      return existing;
    }
    const at = row.slots.findIndex((s) => s.x > slot.x);
    if (at < 0) row.slots.push(slot);
    else row.slots.splice(at, 0, slot);
    row.map.set(slot.x, slot);
    return slot;
  }

  removeSlot(slot: Slot) {
    const row = this.getRow(slot.y);
    if (!row) return;
    row.map.delete(slot.x);
    const i = row.slots.indexOf(slot);
    if (i >= 0) row.slots.splice(i, 1);
  }

  fillSlot(slot: Slot, size: number): Square {
    const right = slot.x + size;
    const top = slot.y + size;
    this.removeSlot(slot);

    for (let y = slot.y; y < top; y++) {
      const row = this.getRow(y);
      if (row) {
        const collisions: Slot[] = [];
        let maxExcess = 0;
        for (const s of row.slots) {
          if (!(s.x + s.r < slot.x || s.x >= right)) {
            collisions.push(s);
            maxExcess = Math.max(maxExcess, Math.max(0, s.x + s.r - (slot.x + slot.r)));
          }
        }
        if (right < this.width && !row.map.has(right)) {
          this.addSlot({ x: right, y, r: slot.r - size + maxExcess });
        }
        for (const c of collisions) {
          c.r = slot.x - c.x;
          if (c.r <= 0) this.removeSlot(c);
        }
      } else {
        this.addRow();
        if (slot.x > 0) this.addSlot({ x: 0, y, r: slot.x });
        if (right < this.width) this.addSlot({ x: right, y, r: this.width - right });
      }
    }

    for (let y = Math.max(0, slot.y - size); y < slot.y; y++) {
      const row = this.getRow(y);
      if (!row) continue;
      for (const s of [...row.slots]) {
        if (s.x < slot.x + size && s.x + s.r > slot.x && s.y + s.r >= slot.y) {
          const oldWidth = s.r;
          s.r = slot.y - s.y;
          if (s.r <= 0) this.removeSlot(s);
          const rem = { x: s.x + s.r, y: s.y, w: oldWidth - s.r, h: s.r };
          while (rem.w > 0 && rem.h > 0) {
            if (rem.w <= rem.h) {
              this.addSlot({ x: rem.x, y: rem.y, r: rem.w });
              rem.y += rem.w;
              rem.h -= rem.w;
            } else {
              this.addSlot({ x: rem.x, y: rem.y, r: rem.h });
              rem.x += rem.h;
              rem.w -= rem.h;
            }
          }
        }
      }
    }
    return { x: slot.x, y: slot.y, r: size };
  }

  place(size: number): Square {
    for (const row of this.rows) {
      for (const s of row.slots) {
        if (s.r >= size) return this.fillSlot(s, size);
      }
    }
    const row = this.addRow();
    const slot = this.addSlot({ x: 0, y: row.y, r: this.width })!;
    return this.fillSlot(slot, size);
  }
}

export type Layout = { squares: Square[]; width: number; height: number };

/** Squares for each transaction (index i is transaction i, i.e. parcel i). */
export function layout(txValues: number[]): Layout {
  const sizes = txValues.map((v) => txSize(Math.max(1, v)));
  const area = sizes.reduce((a, s) => a + s * s, 0);
  const grid = new MondrianLayout(Math.max(1, Math.ceil(Math.sqrt(area))));
  const squares = sizes.map((s) => grid.place(s));
  const width = Math.max(1, ...squares.map((q) => q.x + q.r));
  const height = Math.max(1, ...squares.map((q) => q.y + q.r));
  return { squares, width, height };
}
