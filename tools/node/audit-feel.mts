/**
 * The audit's second half: how the game FEELS, in numbers.
 *
 * The first probe found that five minutes of driving in a straight line
 * discovers nothing — which is not a bug, it is what one landmark per 16 km²
 * means. It does make everything depend on seeing things from far away, so
 * that is where this one starts. Read-only throughout.
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
import { heightAt, slopeAt, SEA_LEVEL } from "../../src/world/field";
import { landmarksNear, LANDMARK_CELL, LANDMARK_NAMES, type LandmarkKind } from "../../src/world/landmarks";

const DT = 1 / 60;
const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 1e5);
const ctrl = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: true, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});

// --- 1. can you SEE them? --------------------------------------------------
/**
 * A 1080p screen at 70 degrees is about 0.036 degrees per pixel. Something
 * has to clear a few pixels to register as a shape rather than as noise —
 * call it 4 px to be a thing you'd steer toward.
 */
say("## CAN YOU SEE THEM FROM ANYWHERE");
const DEG_PER_PX = 70 / 1080;
const HEIGHTS: Record<string, number> = {
  lookout: 26, mast: 34, arch: 22, windpump: 14, steading: 7, lonetree: 12,
  stones: 6, shipwreck: 9, wreck: 2.5, spring: 1.5, adit: 4, sinkhole: 2,
  bonefield: 4, orchard: 7, frozenlake: 1, dock: 3, airfield: 9, cave: 5,
};
const visibleTo = (h: number, px: number) => h / Math.tan((px * DEG_PER_PX) * Math.PI / 180);
const rows = Object.entries(HEIGHTS).sort((a, b) => b[1] - a[1]);
say(`a landmark needs ~4 px of height to read as a shape worth steering toward`);
for (const [kind, h] of rows) {
  const r4 = visibleTo(h, 4) / 1000;
  const r12 = visibleTo(h, 12) / 1000;
  say(`  ${(LANDMARK_NAMES[kind as LandmarkKind] ?? kind).padEnd(18)} ${String(h).padStart(4)} m tall  ` +
      `recognisable to ${r12.toFixed(1).padStart(4)} km, a dot to ${r4.toFixed(1).padStart(5)} km`);
}

// --- 2. steering toward something, which is how the game is meant to work --
say("\n## IF YOU STEER TOWARD WHAT YOU CAN SEE");
function seek(sx: number, sz: number, mode: "foot" | "truck", secs: number, sightKm: number) {
  const p = new Player(camera, new THREE.Vector2(sx, sz));
  const c = ctrl();
  if (mode === "truck") {
    p.adopt("truck", 0xd8c04a, p.position.x + 2, p.position.z + 1, 0);
    c.interact = true; p.update(DT, c); c.interact = false;
    c.cruise = true;
  }
  c.move.y = 1;
  const seen = new Set<string>();
  const times: number[] = [];
  for (let i = 0; i < secs * 60; i++) {
    const px = p.mode === "drive" ? p.vehicle.root.position.x : p.position.x;
    const pz = p.mode === "drive" ? p.vehicle.root.position.z : p.position.z;
    if (i % 30 === 0) {
      // Aim at the nearest unvisited landmark you could plausibly see.
      let best: { x: number; z: number; d: number; id: string } | null = null;
      for (const lm of landmarksNear(px, pz, 2)) {
        if (seen.has(lm.id)) continue;
        const d = Math.hypot(lm.x - px, lm.z - pz);
        const tall = (HEIGHTS[lm.kind] ?? 5);
        if (d > Math.min(sightKm * 1000, visibleTo(tall, 4))) continue;
        if (!best || d < best.d) best = { x: lm.x, z: lm.z, d, id: lm.id };
      }
      if (best) {
        const want = Math.atan2(best.x - px, best.z - pz);
        if (p.mode === "drive") {
          const err = Math.atan2(Math.sin(want - p.vehHeading), Math.cos(want - p.vehHeading));
          c.move.x = THREE.MathUtils.clamp(err * 1.4, -1, 1);
        } else {
          p.heading = want;
        }
        if (best.d < 55) { seen.add(best.id); times.push(i / 60); }
      } else {
        c.move.x = 0;
      }
    }
    p.update(DT, c);
  }
  return { km: p.distanceTravelled / 1000, found: seen.size, times };
}
for (const [label, sx, sz] of [["meadow", 1200, 800], ["highland", -4200, 9100], ["steppe", 22000, -14000]] as [string, number, number][]) {
  for (const mode of ["foot", "truck"] as const) {
    const r = seek(sx, sz, mode, 600, 25);
    say(`${label.padEnd(9)} ${mode.padEnd(6)} 10 min: ${r.km.toFixed(1).padStart(5)} km, ${r.found} found` +
        (r.times.length ? `, first at ${r.times[0].toFixed(0)}s, then every ${(r.times.length > 1 ? (r.times[r.times.length - 1] - r.times[0]) / (r.times.length - 1) : 0).toFixed(0)}s` : ""));
  }
}

// --- 3. walking on a hill --------------------------------------------------
say("\n## MOVING OVER GROUND");
const bands: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 0.1, label: "flat" }, { lo: 0.1, hi: 0.25, label: "gentle" },
  { lo: 0.25, hi: 0.45, label: "a climb" }, { lo: 0.45, hi: 0.7, label: "steep" },
  { lo: 0.7, hi: 9, label: "a wall" },
];
for (const b of bands) {
  // Find somewhere with that gradient and walk straight at it.
  let found: { x: number; z: number } | null = null;
  for (let i = 0; i < 90000 && !found; i++) {
    const x = (i * 127) % 60000 - 30000, z = ((i * 311) % 60000) - 30000;
    const s = slopeAt(x, z, 4);
    if (s >= b.lo && s < b.hi && heightAt(x, z) > 20) found = { x, z };
  }
  if (!found) { say(`  ${b.label.padEnd(9)} no ground found`); continue; }
  const p = new Player(camera, new THREE.Vector2(found.x, found.z));
  const c = ctrl(); c.move.y = 1;
  const y0 = p.position.y;
  for (let i = 0; i < 60 * 12; i++) p.update(DT, c);
  say(`  ${b.label.padEnd(9)} gradient ${b.lo.toFixed(2)}-${b.hi === 9 ? "max" : b.hi.toFixed(2)}: ` +
      `${(p.distanceTravelled / 12 * 3.6).toFixed(1).padStart(5)} km/h over 12 s, ` +
      `climbed ${(p.position.y - y0).toFixed(0)} m`);
}

// --- 4. water: can you get out? --------------------------------------------
say("\n## WATER");
let coast: { x: number; z: number } | null = null;
for (let sx = -40000; sx <= 40000 && !coast; sx += 1700) {
  for (let sz = -40000; sz <= 40000; sz += 1700) {
    if (heightAt(sx, sz) > -4) continue;
    let x = sx;
    for (let s = 0; s < 90; s++) {
      x += 60;
      if (heightAt(x, sz) > 1) { coast = { x: x - 140, z: sz }; break; }
    }
    if (coast) break;
  }
}
if (coast) {
  say(`swimming at ${coast.x.toFixed(0)}, ${coast.z.toFixed(0)} (bed ${heightAt(coast.x, coast.z).toFixed(1)} m)`);
  const p = new Player(camera, new THREE.Vector2(coast.x, coast.z));
  const c = ctrl();
  for (let i = 0; i < 60; i++) p.update(DT, c);
  say(`  afloat: swimming=${p.swimming} wading=${p.wading}`);
  // Head for the shore.
  p.heading = Math.PI / 2;
  c.move.y = 1;
  let outAt = -1;
  for (let i = 0; i < 60 * 90; i++) {
    p.update(DT, c);
    if (outAt < 0 && !p.swimming && !p.wading && heightAt(p.position.x, p.position.z) > 1) outAt = i / 60;
  }
  say(`  reached dry land after ${outAt < 0 ? "NEVER (90 s)" : outAt.toFixed(0) + " s"}, ` +
      `swim speed ${(p.distanceTravelled / 90 * 3.6).toFixed(1)} km/h`);
}

const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/audit/feel.md", out.join("\n"));
