/** How many landmarks there are, of what, and how steep the ground under them is. */
import { landmarkInCell, LANDMARK_CELL } from "../../src/world/landmarks";
import { heightAt } from "../../src/world/field";
const kinds = new Map<string, { n: number; drop: number; worst: number }>();
let cells = 0, filled = 0;
for (let gx = -40; gx <= 40; gx++) for (let gz = -40; gz <= 40; gz++) {
  cells++;
  const lm = landmarkInCell(gx, gz);
  if (!lm) continue;
  filled++;
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[-12, 0], [12, 0], [0, -12], [0, 12]]) { const h = heightAt(lm.x + dx, lm.z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const k = kinds.get(lm.kind) ?? { n: 0, drop: 0, worst: 0 };
  k.n++; k.drop += hi - lo; k.worst = Math.max(k.worst, hi - lo);
  kinds.set(lm.kind, k);
}
console.log(`${filled} landmarks in ${cells} cells of ${LANDMARK_CELL / 1000} km (${((filled / cells) * 100).toFixed(0)}%)`);
console.log("kind         count   ground falls across 24 m: typical / worst");
for (const [k, v] of [...kinds].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${k.padEnd(12)} ${String(v.n).padStart(5)}   ${(v.drop / v.n).toFixed(1).padStart(5)} m / ${v.worst.toFixed(1).padStart(5)} m`);
}
