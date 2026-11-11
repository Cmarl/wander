/**
 * Can you actually see one from where you are standing?
 *
 * Being tall and being drawn through thin haze are both necessary and neither
 * is sufficient: a tower in a valley is behind a hill. So this walks a sight
 * line from eye height at random spots to the top of the nearest monument and
 * asks whether the ground gets in the way.
 */
import { heightAt } from "../../src/world/field";
import { nearestMonument, TOWER_ROOF, CASTLE, LIGHT_TOP, TURBINE, COLOSSUS } from "../../src/world/monuments";

const TOP: Record<string, number> = {
  tower: TOWER_ROOF + 36, castle: CASTLE.keepTop + 14, lighthouse: LIGHT_TOP + 7,
  windfarm: TURBINE.hub + TURBINE.blade, colossus: COLOSSUS.height,
};
const bands = [[0, 5], [5, 10], [10, 16], [16, 24], [24, 36]];
const seen = bands.map(() => 0), all = bands.map(() => 0);
let n = 0;
for (let i = 0; n < 1500 && i < 20000; i++) {
  const x = (((Math.sin(i * 12.9898) * 43758.5453) % 1) * 2) * 140000;
  const z = (((Math.sin(i * 78.233) * 43758.5453) % 1) * 2) * 140000;
  const g = heightAt(x, z);
  if (g < 2) continue;
  const near = nearestMonument(x, z, 2);
  if (!near) continue;
  n++;
  const { m, d } = near;
  const b = bands.findIndex(([a, c]) => d / 1000 >= a && d / 1000 < c);
  if (b < 0) continue;
  all[b]++;
  const eye = g + 2.4;
  // The upper third of it showing is enough to be a shape on the horizon.
  const tip = m.y + TOP[m.kind] * 0.8;
  let clear = true;
  const steps = Math.ceil(d / 120);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (heightAt(x + (m.x - x) * t, z + (m.z - z) * t) > eye + (tip - eye) * t) { clear = false; break; }
  }
  if (clear) seen[b]++;
}
console.log(`from ${n} random places on land, is the nearest monument in line of sight?`);
bands.forEach(([a, c], i) => console.log(`  ${String(a).padStart(2)}–${String(c).padEnd(2)} km away: ${all[i] ? ((seen[i] / all[i]) * 100).toFixed(0).padStart(3) : "  -"}%   (${all[i]} places)`));
const S = seen.reduce((a, b) => a + b, 0), A = all.reduce((a, b) => a + b, 0);
console.log(`  overall: ${((S / A) * 100).toFixed(0)}% of the time there is a monument you could see from where you stand`);
