/**
 * Playing the game, as far as a machine can.
 *
 * Read-only: this measures, it changes nothing. The point is to answer
 * questions about how the game FEELS with numbers rather than with opinions —
 * how long until you find something, how far apart places are, whether the
 * speeds are distinct, what a session actually looks like.
 */
const canvasStub = () => ({
  width: 0, height: 0,
  getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {}, fill() {}, clearRect() {}, beginPath() {}, arc() {},
    set fillStyle(_v: unknown) {}, get fillStyle() { return ""; },
  }),
});
(globalThis as any).document = { createElement: () => canvasStub() };
(globalThis as any).localStorage = {
  _d: new Map<string, string>(),
  getItem(k: string) { return this._d.get(k) ?? null; },
  setItem(k: string, v: string) { this._d.set(k, v); },
  removeItem(k: string) { this._d.delete(k); },
};

import * as THREE from "three";
import { Player } from "../../src/game/player";
import { heightAt, SEA_LEVEL } from "../../src/world/field";
import { landmarksNear, LANDMARK_CELL, LANDMARK_NAMES, type LandmarkKind } from "../../src/world/landmarks";
import { SPECS, type VehicleClass } from "../../src/game/vehicles";
import { regionAt } from "../../src/world/regions";

const DT = 1 / 60;
const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };

// --- 1. what is out there, and how far apart -------------------------------
say("## WHAT THE WORLD CONTAINS");
const counts = new Map<string, number>();
let cells = 0, occupied = 0;
const spots: { x: number; z: number; kind: string }[] = [];
const SPAN = 60;   // cells each way from origin
for (let gx = -SPAN; gx <= SPAN; gx++) {
  for (let gz = -SPAN; gz <= SPAN; gz++) {
    cells++;
    for (const lm of landmarksNear(gx * LANDMARK_CELL, gz * LANDMARK_CELL, 0)) {
      occupied++;
      counts.set(lm.kind, (counts.get(lm.kind) ?? 0) + 1);
      if (spots.length < 60000) spots.push({ x: lm.x, z: lm.z, kind: lm.kind });
    }
  }
}
say(`${cells} cells scanned (${((SPAN * 2 + 1) * LANDMARK_CELL / 1000).toFixed(0)} km square), ${occupied} landmarks — ${(occupied / cells * 100).toFixed(0)}% occupancy`);
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, n] of sorted) {
  say(`  ${(LANDMARK_NAMES[k as LandmarkKind] ?? k).padEnd(18)} ${String(n).padStart(6)}  ${(n / occupied * 100).toFixed(1).padStart(5)}%  one every ${(Math.sqrt((cells * LANDMARK_CELL ** 2) / n) / 1000).toFixed(1)} km`);
}

// Nearest-neighbour distance: what "empty country between landmarks" measures.
const sample = spots.filter((_, i) => i % 37 === 0).slice(0, 400);
const nn: number[] = [];
for (const a of sample) {
  let best = Infinity;
  for (const b of spots) {
    if (b === a) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < best) best = d;
  }
  nn.push(best);
}
nn.sort((a, b) => a - b);
say(`\nnearest other landmark: median ${(nn[nn.length >> 1] / 1000).toFixed(2)} km, ` +
    `closest 10% under ${(nn[(nn.length * 0.1) | 0] / 1000).toFixed(2)} km, ` +
    `loneliest 10% over ${(nn[(nn.length * 0.9) | 0] / 1000).toFixed(2)} km`);

// --- 2. how long until you find something ----------------------------------
say("\n## THE FIRST FEW MINUTES");
const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 1e5);
const ctrl = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: true, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});

/** Walk/drive in a straight line and note when a landmark comes within range. */
function journey(seedX: number, seedZ: number, mode: "foot" | "truck", secs: number) {
  const p = new Player(camera, new THREE.Vector2(seedX, seedZ));
  const c = ctrl();
  if (mode === "truck") {
    p.adopt("truck", 0xd8c04a, p.position.x + 2, p.position.z + 1, 0);
    c.interact = true; p.update(DT, c); c.interact = false;
    c.cruise = true;
  }
  c.move.y = 1;
  const seen = new Set<string>();
  const firsts: number[] = [];
  let water = 0, stuck = 0, lastX = p.position.x, lastZ = p.position.z;
  for (let i = 0; i < secs * 60; i++) {
    p.update(DT, c);
    const px = p.mode === "drive" ? p.vehicle.root.position.x : p.position.x;
    const pz = p.mode === "drive" ? p.vehicle.root.position.z : p.position.z;
    if (i % 12 === 0) {
      for (const lm of landmarksNear(px, pz, 1)) {
        if (Math.hypot(lm.x - px, lm.z - pz) < 55 && !seen.has(lm.id)) {
          seen.add(lm.id); firsts.push(i / 60);
        }
      }
      if (heightAt(px, pz) < SEA_LEVEL) water++;
      if (Math.hypot(px - lastX, pz - lastZ) < 0.6) stuck++;
      lastX = px; lastZ = pz;
    }
  }
  return { km: p.distanceTravelled / 1000, found: seen.size, firsts, water, stuck, samples: (secs * 60) / 12 };
}

for (const [label, sx, sz] of [["meadow", 1200, 800], ["highland", -4200, 9100], ["coast", -37000, -28000]] as [string, number, number][]) {
  for (const mode of ["foot", "truck"] as const) {
    const j = journey(sx, sz, mode, 300);
    say(`${label.padEnd(9)} ${mode.padEnd(6)} 5 min: ${j.km.toFixed(2)} km, ${j.found} places found` +
        (j.firsts.length ? `, first at ${j.firsts[0].toFixed(0)}s` : ", NOTHING FOUND") +
        `, ${(j.water / j.samples * 100).toFixed(0)}% over water, ${(j.stuck / j.samples * 100).toFixed(0)}% barely moving`);
  }
}

// --- 3. do the machines feel different -------------------------------------
say("\n## THE MACHINES");
for (const cls of Object.keys(SPECS) as VehicleClass[]) {
  const s = SPECS[cls];
  const p = new Player(camera, new THREE.Vector2(1200, 800));
  const c = ctrl();
  p.adopt(cls, 0xd8c04a, p.position.x + 2, p.position.z + 1, 0);
  c.interact = true; p.update(DT, c); c.interact = false;
  if (p.mode !== "drive") { say(`  ${cls.padEnd(8)} could not board`); continue; }
  c.move.y = 1; c.cruise = true;
  let t0 = -1;
  for (let i = 0; i < 60 * 40; i++) {
    p.update(DT, c);
    if (t0 < 0 && Math.abs(p.speed) >= s.top * 0.9) t0 = i / 60;
  }
  say(`  ${cls.padEnd(8)} top ${(s.top * 3.6).toFixed(0).padStart(3)} km/h, reached 90% in ` +
      `${t0 < 0 ? "never" : t0.toFixed(1) + "s"}, settled at ${(Math.abs(p.speed) * 3.6).toFixed(0)} km/h`);
}

// --- 4. where regions change -----------------------------------------------
say("\n## REGIONS");
const names = new Map<string, number>();
for (let i = 0; i < 4000; i++) {
  const x = (i % 80) * 3000 - 120000;
  const z = ((i / 80) | 0) * 3000 - 75000;
  const n = regionAt(x, z).name;
  names.set(n, (names.get(n) ?? 0) + 1);
}
const top = [...names.entries()].sort((a, b) => b[1] - a[1]);
say(`${names.size} distinct region names across 4000 samples; commonest "${top[0][0]}" is ${(top[0][1] / 40).toFixed(1)}% of the map`);

const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/audit/play.md", out.join("\n"));
