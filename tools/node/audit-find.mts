/**
 * Settlements and rumours — the two things Clyde asked about by name.
 *
 * "I still haven't located a settlement, is there a way or trick?" and
 * "I located something in the menu 'heard about today' (COOL) that I can pin
 * - I LOVE THAT, it drives discovery". Read-only.
 */
import { settlementsNear, SETTLEMENT_CELL } from "../../src/world/settlements";
import { rumourAt } from "../../src/world/rumours";
import { landmarksNear, LANDMARK_CELL } from "../../src/world/landmarks";

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };

say("## SETTLEMENTS");
let n = 0, cells = 0;
const places: { x: number; z: number; size: number }[] = [];
const SPAN = 40;
for (let gx = -SPAN; gx <= SPAN; gx++) {
  for (let gz = -SPAN; gz <= SPAN; gz++) {
    cells++;
    for (const s of settlementsNear(gx * SETTLEMENT_CELL, gz * SETTLEMENT_CELL, 0)) {
      n++; places.push({ x: s.x, z: s.z, size: (s as any).buildings?.length ?? (s as any).count ?? 0 });
    }
  }
}
const side = (SPAN * 2 + 1) * SETTLEMENT_CELL / 1000;
say(`${n} settlements in a ${side.toFixed(0)} km square (${cells} cells) — one every ${(side / Math.sqrt(Math.max(n, 1))).toFixed(1)} km`);
if (places.length) {
  const sizes = places.map((p) => p.size).sort((a, b) => a - b);
  say(`buildings each: smallest ${sizes[0]}, median ${sizes[sizes.length >> 1]}, largest ${sizes[sizes.length - 1]}`);
  // Nearest landmark to a settlement: is there anything tall beside it to
  // make it findable?
  let withTall = 0;
  for (const p of places.slice(0, 120)) {
    const near = landmarksNear(p.x, p.z, 1).filter((l) =>
      Math.hypot(l.x - p.x, l.z - p.z) < 1200 && ["mast", "lookout", "arch", "windpump"].includes(l.kind));
    if (near.length) withTall++;
  }
  say(`${withTall} of 120 sampled settlements have something tall within 1.2 km to spot them by (${(withTall / 1.2).toFixed(0)}%)`);
}

say("\n## RUMOURS — the 'heard about today' he loved");
/**
 * Where a rumour can come from at all: a radio mast you tune, or a hamlet's
 * noticeboard. Both have to be FOUND first, which is the thing to measure.
 */
let masts = 0, lmCells = 0;
for (let gx = -SPAN; gx <= SPAN; gx++) {
  for (let gz = -SPAN; gz <= SPAN; gz++) {
    lmCells++;
    for (const lm of landmarksNear(gx * LANDMARK_CELL, gz * LANDMARK_CELL, 0)) {
      if (lm.kind === "mast") masts++;
    }
  }
}
const lmSide = (SPAN * 2 + 1) * LANDMARK_CELL / 1000;
say(`radio masts: ${masts} in a ${lmSide.toFixed(0)} km square — one every ${(lmSide / Math.sqrt(Math.max(masts, 1))).toFixed(1)} km`);
say(`settlements: one every ${(side / Math.sqrt(Math.max(n, 1))).toFixed(1)} km`);
say(`so a rumour needs one of ${masts + n} places in ${(lmSide * lmSide).toFixed(0)} km-squared of world`);

const sample = rumourAt(3, 5, 101, 1200, 800);
if (sample) {
  say(`example: "${(sample as any).text}" — ${(Math.hypot((sample as any).x - 1200, (sample as any).z - 800) / 1000).toFixed(1)} km away`);
}
let reach = 0, tries = 0;
for (let i = 0; i < 300; i++) {
  const r = rumourAt(i, i * 7, 101, 1200, 800);
  tries++;
  if (r) reach += Math.hypot((r as any).x - 1200, (r as any).z - 800);
}
say(`a rumour points somewhere ${(reach / tries / 1000).toFixed(1)} km away on average`);

const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/audit/find.md", out.join("\n"));
