/**
 * Where the monuments are, and how far apart.
 *
 * The whole case for monuments is that there is usually one somewhere on the
 * horizon. That is a claim about spacing, so it is measured.
 */
import { monumentInCell, MONUMENT_CELL, nearestMonument } from "../../src/world/monuments";

const kinds = new Map<string, number>();
let cells = 0, filled = 0;
const list: any[] = [];
const t0 = performance.now();
for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
  cells++;
  const m = monumentInCell(gx, gz);
  if (!m) continue;
  filled++;
  kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  list.push(m);
}
console.log(`${filled}/${cells} cells of ${MONUMENT_CELL / 1000} km hold one  (${((performance.now() - t0) / cells).toFixed(1)} ms a cell)`);
console.log([...kinds].map(([k, n]) => `${k} ${n}`).join("  ·  "));

const ds: number[] = [];
for (let i = 0; i < 4000; i++) {
  const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 150000;
  const z = (Math.sin(i * 78.233) * 43758.5453 % 1) * 150000;
  const n = nearestMonument(x, z, 2);
  if (n) ds.push(n.d);
}
ds.sort((a, b) => a - b);
const q = (p: number) => (ds[Math.floor(ds.length * p)] / 1000).toFixed(1);
console.log(`nearest monument from a random spot: median ${q(0.5)} km, quarter within ${q(0.25)} km, nine in ten within ${q(0.9)} km`);
const near0 = list.map((m) => ({ ...m, d: Math.hypot(m.x, m.z) })).sort((a, b) => a.d - b.d).slice(0, 8);
for (const m of near0) console.log(`  ${m.kind.padEnd(10)} ${m.name.padEnd(22)} ${m.x.toFixed(0)}, ${m.z.toFixed(0)}  y ${m.y.toFixed(0)}  ${(m.d / 1000).toFixed(1)} km from origin`);
