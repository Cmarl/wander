/**
 * Can you walk through it?
 *
 * Clyde: "many of them you can just walk right through."
 *
 * Collision is now read off each landmark's own geometry (world/
 * landmarkSolids), so the claim to test is simple and the same for every
 * kind: pick the solid thing nearest the middle of a real landmark, run the
 * real Player straight at it, and they must not end up inside it. And the
 * other half — the things you are MEANT to pass through still let you.
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

import * as THREE from "three";
const { Player } = await import("../../src/game/player");
const { landmarkInCell, LANDMARK_SOLIDS } = await import("../../src/world/landmarks");
const { BUILDERS } = await import("../../src/world/landmarkRender");
const { useBuilders, solidsFor, solidCount } = await import("../../src/world/landmarkSolids");
const { toWorld } = await import("../../src/world/frame");
const { decksOf } = await import("../../src/world/decks");
useBuilders(BUILDERS);

const DT = 1 / 60;
let bad = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label.padEnd(52)} ${detail}`);
};
const controls = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: true, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});

const found = new Map<string, any>();
for (let r = 0; r < 60 && found.size < 40; r++) for (let gx = -r; gx <= r; gx++) for (let gz = -r; gz <= r; gz++) {
  if (Math.max(Math.abs(gx), Math.abs(gz)) !== r) continue;
  const lm = landmarkInCell(gx, gz);
  if (lm && !found.has(lm.kind)) found.set(lm.kind, lm);
}

console.log("kind         circles: by hand before -> read from the model now");
for (const kind of Object.keys(BUILDERS) as any[]) {
  console.log(`  ${kind.padEnd(11)} ${String(LANDMARK_SOLIDS[kind as keyof typeof LANDMARK_SOLIDS].length).padStart(3)} -> ${[0, 1, 2].map((v) => String(solidCount(kind, v)).padStart(3)).join(" /")}`);
}

/** Run at a point from `from` metres away along a bearing; return how close you got. */
function runAt(lm: any, tx: number, tz: number, bearing: number, from: number): number {
  const sx = tx + Math.cos(bearing) * from, sz = tz + Math.sin(bearing) * from;
  const p = new Player(new THREE.PerspectiveCamera(), new THREE.Vector2(sx, sz));
  p.landmarkSolids = solidsFor(lm).map((c: any) => ({ x: c.x, z: c.z, radius: c.r }));
  p.decks = decksOf(lm);
  const c = controls();
  let closest = Infinity;
  for (let k = 0; k < 60 * 14; k++) {
    const dx = tx - p.position.x, dz = tz - p.position.z;
    closest = Math.min(closest, Math.hypot(dx, dz));
    (p as any).camYaw = Math.atan2(-dx, -dz);
    c.move.y = 1;
    p.update(DT, c);
  }
  return closest;
}

for (const kind of ["stones", "orchard", "shipwreck", "bonefield", "lonetree", "windpump", "lookout", "steading", "mast", "wreck", "cave", "arch", "sinkhole", "adit"]) {
  const lm = found.get(kind);
  if (!lm) { console.log(`  (no ${kind} within reach)`); continue; }
  const solids = solidsFor(lm);
  // The biggest solid piece: the one it would be most absurd to walk through.
  const s = solids.reduce((a: any, b: any) => (b.r > a.r ? b : a), solids[0]);
  let worst = Infinity;
  for (const bearing of [0, 2.1, 4.2]) worst = Math.min(worst, runAt(lm, s.x, s.z, bearing, s.r + 14));
  check(worst > s.r * 0.75, `${kind}: you cannot walk through it`, `got within ${worst.toFixed(2)} m of the middle of a ${s.r.toFixed(1)} m solid (${solids.length} in all)`);
}

// And what you are supposed to pass through, or onto.
{
  const lm = found.get("arch");
  if (lm && lm.variant !== 2) {
    const mid = toWorld(lm, 0, 0);
    const got = runAt(lm, mid.x, mid.z, lm.rot + Math.PI / 2, 30);
    check(got < 1.5, "arch: you still go straight under the span", `${got.toFixed(2)} m from dead centre`);
  }
  const sp = found.get("spring");
  if (sp) {
    const got = runAt(sp, sp.x, sp.z, 0.7, 32 * sp.scale);
    check(got < 1.5, "spring: you can walk up the mound and into the pool", `${got.toFixed(2)} m from the middle`);
  }
}

console.log(bad ? `\n${bad} FAILED` : "\nall assertions passed");
process.exit(bad ? 1 : 0);
