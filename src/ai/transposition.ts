/**
 * Transposition table: two-level Map keyed by the 64-bit board key
 * (split into two uint32 numbers so plain JS numbers are exact).
 * Entries store {depth, type, value}; a hit is usable when the stored depth
 * is at least the requested depth and the node type matches.
 */
import type { Board } from "../game/board";

export const PLAYER_NODE = 0;
export const CHANCE_NODE = 1;

interface TTEntry {
  depth: number;
  type: number;
  value: number;
}

export class TranspositionTable {
  private map = new Map<number, Map<number, TTEntry>>();
  hits = 0;
  misses = 0;

  get(b: Board, depth: number, type: number): number | undefined {
    const lo = (b[0] << 16) | b[1];
    const hi = (b[2] << 16) | b[3];
    const inner = this.map.get(lo);
    if (inner === undefined) {
      this.misses++;
      return undefined;
    }
    const e = inner.get(hi);
    if (e === undefined || e.depth < depth || e.type !== type) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return e.value;
  }

  set(b: Board, depth: number, type: number, value: number): void {
    const lo = (b[0] << 16) | b[1];
    const hi = (b[2] << 16) | b[3];
    let inner = this.map.get(lo);
    if (inner === undefined) {
      inner = new Map();
      this.map.set(lo, inner);
    }
    const prev = inner.get(hi);
    // Keep the entry with the larger search depth (more informative).
    if (prev === undefined || depth >= prev.depth) {
      inner.set(hi, { depth, type, value });
    }
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    let n = 0;
    for (const inner of this.map.values()) n += inner.size;
    return n;
  }
}
