/**
 * Board representation.
 *
 * A board is a Uint16Array(4): 4 rows, each row packs 4 cells in 4 bits each.
 *   cell value n = 0 for empty, n = log2(tile) for tile 2^n (n >= 1).
 *   In row r, cell c occupies bits (c*4)..(c*4+3), cell 0 is the leftmost.
 *
 * A single row (16 bits) is the unit of precomputed lookup tables.
 */

export const UP = 0;
export const DOWN = 1;
export const LEFT = 2;
export const RIGHT = 3;
export const DIRS = [UP, DOWN, LEFT, RIGHT] as const;

export type Board = Uint16Array; // length 4

export function newBoard(): Board {
  return new Uint16Array(4);
}

export function cloneBoard(b: Board): Board {
  return new Uint16Array(b);
}

/** Tile value stored in a cell: n=0 -> empty(0), n>=1 -> 2^n. */
export function cellValue(n: number): number {
  return n === 0 ? 0 : 1 << n;
}

export function getCell(b: Board, r: number, c: number): number {
  return (b[r] >>> (c * 4)) & 15;
}

export function setCell(b: Board, r: number, c: number, v: number): void {
  b[r] = (b[r] & ~(15 << (c * 4))) | (v << (c * 4));
}

export function getRow(b: Board, r: number): number {
  return b[r];
}

export function setRow(b: Board, r: number, row: number): void {
  b[r] = row;
}

/** Full board as a 64-bit key split into two uint32 numbers (Map-friendly). */
export function boardKey(b: Board): [number, number] {
  return [(b[0] << 16) | b[1], (b[2] << 16) | b[3]] as [number, number];
}

export function boardFromKey(lo: number, hi: number): Board {
  const b = newBoard();
  b[0] = lo >>> 16;
  b[1] = lo & 0xffff;
  b[2] = hi >>> 16;
  b[3] = hi & 0xffff;
  return b;
}

/** Compact 64-bit string key (for replay maps etc.; slower than boardKey). */
export function boardKeyString(b: Board): string {
  return String(b[0] * 0x100000000 + b[1]) + ":" + String(b[2] * 0x100000000 + b[3]);
}

export function maxTileLog(b: Board): number {
  let m = 0;
  for (let r = 0; r < 4; r++) {
    const row = b[r];
    m = Math.max(m, row & 15, (row >>> 4) & 15, (row >>> 8) & 15, (row >>> 12) & 15);
  }
  return m;
}

export function boardToString(b: Board): string {
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    const cells: number[] = [];
    for (let c = 0; c < 4; c++) cells.push(cellValue(getCell(b, r, c)));
    rows.push(cells.map((v) => String(v).padStart(6)).join(" "));
  }
  return rows.join("\n");
}
