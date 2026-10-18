/**
 * From where you are standing, can you see anything at all?
 *
 * This is the question the whole visibility change is about, and it is not
 * what the walking probe measures — that one is limited by how far a person
 * can walk in ten minutes, not by what they can see. Stand in a thousand
 * random places and count what is within its own visible range.
 */
const canvasStub = () => ({ width: 0, height: 0, getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fill() {},
  clearRect() {}, beginPath() {}, arc() {},
  set fillStyle(_v: unknown) {}, get fillStyle() { return ""; } }) });
(globalThis as any).document = { createElement: () => canvasStub() };

import * as THREE from "three";
import { landmarksNear, LANDMARK_NAMES, type LandmarkKind } from "../../src/world/landmarks";
import { BUILDERS } from "../../src/world/landmarkRender";
import { heightAt, SEA_LEVEL } from "../../src/world/field";

const DEG_PER_PX = 70 / 1080;
const range = (h: number) => h / Math.tan((4 * DEG_PER_PX) * Math.PI / 180);

const now: Record<string, number> = {};
for (const kind of Object.keys(LANDMARK_NAMES) as LandmarkKind[]) {
  const box = new THREE.Box3();
  for (const l of (BUILDERS as any)[kind]?.() ?? []) {
    if (!l.geo) continue;
    l.geo.computeBoundingBox();
    box.union(l.geo.boundingBox);
  }
  now[kind] = box.isEmpty() ? 1 : box.max.y;
}
/** What these were before anything was made taller, measured the same way. */
const before: Record<string, number> = {
  ...now,
  wreck: 2.1, dock: 2.2, spring: 2.9, frozenlake: 3.1, sinkhole: 3.6,
  adit: 3.8, bonefield: 4.5, orchard: 6.6, stones: 6.9, cave: 7.5, steading: 7.6,
};

/**
 * Per kind: from a random standpoint, how often is one of THESE in sight?
 *
 * The aggregate hides the thing that matters. Even before, you could see
 * about six landmarks from a typical spot — but they were the mast, the
 * lookout, the arch and the lone tree over and over. Clyde's complaints were
 * never "I can see nothing", they were "I still haven't located a
 * settlement" and the airstrip and the landing he was delighted to stumble
 * on. Those were the invisible ones, and only a per-kind count shows it.
 */
function perKind(h: Record<string, number>) {
  const hit: Record<string, number> = {};
  let n = 0;
  for (let i = 0; i < 1500; i++) {
    const x = ((i * 7919) % 180000) - 90000;
    const z = ((i * 104729) % 180000) - 90000;
    if (heightAt(x, z) < SEA_LEVEL) continue;
    n++;
    const got = new Set<string>();
    for (const lm of landmarksNear(x, z, 3)) {
      const d = Math.hypot(lm.x - x, lm.z - z);
      if (d <= range((h[lm.kind] ?? 1) * lm.scale)) got.add(lm.kind);
    }
    for (const k of got) hit[k] = (hit[k] ?? 0) + 1;
  }
  return { hit, n };
}

function survey(h: Record<string, number>) {
  let total = 0, blind = 0, n = 0;
  const kinds = new Set<string>();
  for (let i = 0; i < 1500; i++) {
    const x = ((i * 7919) % 180000) - 90000;
    const z = ((i * 104729) % 180000) - 90000;
    if (heightAt(x, z) < SEA_LEVEL) continue;   // standing in the sea
    n++;
    let seen = 0;
    for (const lm of landmarksNear(x, z, 3)) {
      const d = Math.hypot(lm.x - x, lm.z - z);
      // Scale matters: a landmark is drawn at 1.0-1.85 times its model.
      if (d <= range((h[lm.kind] ?? 1) * lm.scale)) { seen++; kinds.add(lm.kind); }
    }
    total += seen;
    if (seen === 0) blind++;
  }
  return { mean: total / n, blind: blind / n, n, kinds: kinds.size };
}

const a = survey(before);
const b = survey(now);
console.log(`standing in ${a.n} random places on land:\n`);
console.log(`                         before   after`);
console.log(`landmarks in sight        ${a.mean.toFixed(2).padStart(5)}   ${b.mean.toFixed(2).padStart(5)}`);
console.log(`places where you can see`);
console.log(`NOTHING at all          ${(a.blind * 100).toFixed(0).padStart(5)}%  ${(b.blind * 100).toFixed(0).padStart(5)}%`);
console.log(`kinds ever visible         ${String(a.kinds).padStart(4)}    ${String(b.kinds).padStart(4)}  of 18`);

const pa = perKind(before), pb = perKind(now);
console.log(`\nhow often one of each kind is in sight, from a standpoint picked at random:\n`);
const rows = Object.keys(LANDMARK_NAMES)
  .map((k) => ({ k, a: (pa.hit[k] ?? 0) / pa.n, b: (pb.hit[k] ?? 0) / pb.n }))
  .sort((x, y) => (y.b - y.a) - (x.b - x.a));
for (const r of rows) {
  const moved = r.b - r.a > 0.005;
  console.log(`  ${(LANDMARK_NAMES[r.k as LandmarkKind]).padEnd(18)} ` +
    `${(r.a * 100).toFixed(1).padStart(5)}%  ->  ${(r.b * 100).toFixed(1).padStart(5)}%` +
    (moved ? `   x${(r.b / Math.max(r.a, 0.0001)).toFixed(1)}` : ""));
}
