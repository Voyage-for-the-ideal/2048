/**
 * Reference engine on a plain 4×4 number grid (actual tile values, 0 = empty).
 * Used only for property testing against the optimized bitboard engine.
 * Deliberately simple and obviously-correct.
 */

export type RefBoard = number[][];

export const UP = 0, DOWN = 1, LEFT = 2, RIGHT = 3;

export function refNewBoard(): RefBoard {
  return [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
}

function slideLine(line: number[]): { out: number[]; score: number; moved: boolean } {
  const seq = line.filter((v) => v !== 0);
  const out = [0, 0, 0, 0];
  let k = 0;
  let score = 0;
  let i = 0;
  while (i < seq.length) {
    if (i + 1 < seq.length && seq[i] === seq[i + 1]) {
      out[k++] = seq[i] * 2;
      score += seq[i] * 2;
      i += 2;
    } else {
      out[k++] = seq[i];
      i += 1;
    }
  }
  return { out, score, moved: out.some((v, idx) => v !== line[idx]) };
}

export function refMove(b: RefBoard, dir: number): { board: RefBoard; score: number; moved: boolean } {
  const out = refNewBoard();
  let score = 0;
  let moved = false;
  const take = (r: number, c: number): number => {
    if (dir === LEFT) return b[r][c];
    if (dir === RIGHT) return b[r][3 - c];
    if (dir === UP) return b[c][r];
    return b[3 - c][r]; // DOWN
  };
  const put = (r: number, c: number, v: number): void => {
    if (dir === LEFT) out[r][c] = v;
    else if (dir === RIGHT) out[r][3 - c] = v;
    else if (dir === UP) out[c][r] = v;
    else out[3 - c][r] = v;
  };
  for (let i = 0; i < 4; i++) {
    const line = [take(i, 0), take(i, 1), take(i, 2), take(i, 3)];
    const res = slideLine(line);
    for (let c = 0; c < 4; c++) put(i, c, res.out[c]);
    score += res.score;
    moved = moved || res.moved;
  }
  return { board: out, score, moved };
}

export function refEmptyCount(b: RefBoard): number {
  let n = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (b[r][c] === 0) n++;
  return n;
}

export function refAddRandomTile(b: RefBoard, rng: () => number): void {
  const empties: Array<[number, number]> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (b[r][c] === 0) empties.push([r, c]);
  if (empties.length === 0) return;
  const [r, c] = empties[Math.floor(rng() * empties.length)];
  b[r][c] = rng() < 0.9 ? 2 : 4;
}

export function refIsGameOver(b: RefBoard): boolean {
  for (let d = 0; d < 4; d++) if (refMove(b, d).moved) return false;
  return true;
}
