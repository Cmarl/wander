/**
 * Can you actually get to the top?
 *
 * A staircase that looks right and cannot be climbed is the exact failure
 * this project keeps having: modelled, never measured. So the real Player —
 * the same class the game runs — is walked up every monument that has a way
 * up, by pushing the stick toward a list of waypoints and nothing else. No
 * teleporting and no setting of heights: if a flight does not meet its
 * landing, this stops there and says where.
 *
 * Then it walks off the roof, because the way down is a feature too.
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
import { Player } from "../../src/game/player";
import { heightAt } from "../../src/world/field";
import {
  CASTLE, LIGHT, LIGHT_TOP, TOWER, TOWER_ROOF, monumentDecks, monumentInCell, monumentSolids,
  monumentToWorld, onSummit, type Monument, type MonumentKind,
} from "../../src/world/monuments";

const DT = 1 / 60;
let bad = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label.padEnd(46)} ${detail}`);
};
const controls = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: true, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});

function find(kind: MonumentKind): Monument {
  for (let r = 0; r < 12; r++) for (let gx = -r; gx <= r; gx++) for (let gz = -r; gz <= r; gz++) {
    const m = monumentInCell(gx, gz);
    if (m && m.kind === kind) return m;
  }
  throw new Error(`no ${kind} within reach`);
}

/** Waypoints up each one, in its own frame. */
function route(kind: MonumentKind): [number, number][] {
  const pts: [number, number][] = [];
  if (kind === "tower") {
    pts.push([-24, -1.1], [-6, -1.1]);
    for (let f = 0; f < TOWER.floors; f++) pts.push([3.4, -1.1], [3.4, 1.1], [-3.6, 1.1], [-3.6, -1.1]);
    pts.push([-8, -6]);
  } else if (kind === "lighthouse") {
    const c = LIGHT.half + LIGHT.lane / 2;
    pts.push([-14, -14], [-c, -c]);
    for (let i = 0; i < LIGHT.flights; i++) pts.push([[c, -c], [c, c], [-c, c], [-c, -c]][i % 4] as [number, number]);
    pts.push([-c + 0.4, -c + 0.4]);
  } else {
    const c = CASTLE.keepHalf + CASTLE.keepLane / 2;
    const kz = CASTLE.keepZ;
    // In through the gate, round the west side of the keep, and up.
    pts.push([0, 70], [0, 24], [-15, 8], [-15, kz - c], [-c, kz - c]);
    pts.push([c, kz - c], [c, kz + c], [-c, kz + c], [-c, kz - c], [-5, kz - 5]);
  }
  return pts;
}

const TOPS: Record<string, number> = { tower: TOWER_ROOF, lighthouse: LIGHT_TOP, castle: CASTLE.keepTop };

for (const kind of ["tower", "lighthouse", "castle"] as MonumentKind[]) {
  const m = find(kind);
  const pts = route(kind).map(([lx, lz]) => monumentToWorld(m, lx, lz));
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 1e5);
  const p = new Player(camera, new THREE.Vector2(pts[0].x, pts[0].z));
  p.decks = monumentDecks(m);
  p.landmarkSolids = monumentSolids(m);
  const c = controls();
  for (let k = 0; k < 30; k++) p.update(DT, c);

  let at = 1, t = 0, stuckAt = "";
  let last = { x: p.position.x, z: p.position.z }, still = 0;
  for (; at < pts.length && t < 60 * 900; t++) {
    const w = pts[at];
    const dx = w.x - p.position.x, dz = w.z - p.position.z;
    if (Math.hypot(dx, dz) < 0.7) { at++; continue; }
    (p as any).camYaw = Math.atan2(-dx, -dz);
    c.move.y = 1;
    p.update(DT, c);
    if (t % 60 === 0) {
      const moved = Math.hypot(p.position.x - last.x, p.position.z - last.z);
      still = moved < 0.5 ? still + 1 : 0;
      last = { x: p.position.x, z: p.position.z };
      if (still > 4) { stuckAt = `waypoint ${at} of ${pts.length}, ${(p.position.y - m.y).toFixed(1)} m up`; break; }
    }
  }
  c.move.y = 0;
  for (let k = 0; k < 30; k++) p.update(DT, c);
  const up = p.position.y - m.y;
  console.log(`${kind}: ${m.name} — ${(t / 60).toFixed(0)} s of running, ${up.toFixed(1)} m above its base${stuckAt ? `, STUCK at ${stuckAt}` : ""}`);
  check(!stuckAt && at === pts.length, `${kind}: every waypoint reached`, stuckAt || `${pts.length} of ${pts.length}`);
  check(Math.abs(up - TOPS[kind]) < 0.6, `${kind}: standing on the top`, `${up.toFixed(2)} m, top is ${TOPS[kind].toFixed(2)}`);
  check(onSummit(m, p.position.x, p.position.y, p.position.z), `${kind}: and it counts as the summit`, "");
  check(p.skyState === 0, `${kind}: without ever having fallen`, `skyState ${p.skyState}`);

  // Now straight off the edge.
  let leapt = false;
  p.onSkydive = (w) => { if (w === "leap") leapt = true; };
  const off = monumentToWorld(m, 60, kind === "castle" ? CASTLE.keepZ : 3);
  let fell = 0;
  for (; fell < 60 * 60; fell++) {
    const dx = off.x - p.position.x, dz = off.z - p.position.z;
    if (Math.hypot(dx, dz) < 1 && p.skyState === 0 && (p as any).grounded) break;
    (p as any).camYaw = Math.atan2(-dx, -dz);
    c.move.y = 1;
    p.update(DT, c);
    if (leapt && p.skyState === 0 && (p as any).grounded) break;
  }
  c.move.y = 0;
  for (let k = 0; k < 60; k++) p.update(DT, c);
  const g = heightAt(p.position.x, p.position.z);
  // The keep's stair wraps it fourteen metres below the parapet, so stepping
  // off there is a drop onto the stair rather than a skydive. That is right.
  if (kind !== "castle") check(leapt, `${kind}: stepping off the top is a fall`, leapt ? "became a skydive" : "no leap");
  check(p.position.y - m.y < TOPS[kind] - 5 && p.skyState === 0, `${kind}: and you come down and land`,
    `${(p.position.y - g).toFixed(1)} m above the ground, ${(p.position.y - m.y).toFixed(1)} above base`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall assertions passed");
process.exit(bad ? 1 : 0);
