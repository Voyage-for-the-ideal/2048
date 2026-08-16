import { newBoard, setCell, getCell, cellValue } from "../src/game/board";
import { addRandomTile } from "../src/game/engine";
import * as ref from "../src/game/reference";
import { mulberry32 } from "../src/game/rng";

const rng = mulberry32(999);
for (let i = 0; i < 2000; i++) {
  const b = newBoard();
  const nTiles = Math.floor(rng() * 9);
  for (let t = 0; t < nTiles; t++) {
    const r = Math.floor(rng() * 4), c = Math.floor(rng() * 4);
    setCell(b, r, c, 1 + Math.floor(rng() * 11));
  }
  const rb = ref.refNewBoard();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) rb[r][c] = cellValue(getCell(b, r, c));
  const seed = rng() * 0xffffffff;
  const s1 = mulberry32(seed);
  const s2 = mulberry32(seed);
  const before = JSON.stringify(rb);
  addRandomTile(b, s1);
  ref.refAddRandomTile(rb, s2);
  const after = JSON.stringify(rb);
  if (JSON.stringify(rb) !== JSON.stringify((() => { const o = ref.refNewBoard(); for (let r=0;r<4;r++) for (let c=0;c<4;c++) o[r][c]=cellValue(getCell(b,r,c)); return o; })())) {
    console.log("MISMATCH at i=", i);
    console.log("before:", before);
    console.log("fast  :", JSON.stringify((() => { const o = ref.refNewBoard(); for (let r=0;r<4;r++) for (let c=0;c<4;c++) o[r][c]=cellValue(getCell(b,r,c)); return o; })()));
    console.log("ref   :", after);
    console.log("seed  :", seed);
    break;
  }
}
