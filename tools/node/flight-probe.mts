/**
 * Flying over mountains, and what happens when you do not.
 *
 * Clyde: "climbing in a plane is particularly bad esp when you can't even make
 * it over a mountain." And: "if you hit something fast your vehicle should
 * probably explode - then the character can come rolling out of it, standing
 * up unscathed. then of course the user can just request another vehicle."
 *
 * Both are claims about the real Player, so the real Player flies at a real
 * mountain from the valley floor, and then is flown into the ground on purpose.
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
import type { VehicleClass } from "../../src/game/vehicles";

const DT = 1 / 60;
let bad = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label.padEnd(50)} ${detail}`);
};
const controls = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: true, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});
const tap = (p: Player, c: any, key: string) => { c[key] = true; p.update(DT, c); c[key] = false; };
const board = (cls: VehicleClass, x: number, z: number) => {
  const p = new Player(new THREE.PerspectiveCamera(), new THREE.Vector2(x, z));
  const c = controls();
  // Heading 0 is +z, which is the way every run here goes.
  p.adopt(cls, 0x9a7f4e, p.position.x + 2, p.position.z + 1, 0);
  tap(p, c, "interact");
  return { p, c };
};

// The steepest big climb to be found: low ground, and a wall of it to the north.
let best = { x: 0, z: 0, rise: 0, crest: 0 };
for (let x = -60000; x <= 60000; x += 2000) for (let z = -60000; z <= 60000; z += 2000) {
  const h0 = heightAt(x, z);
  if (h0 < 10 || h0 > 500) continue;
  let top = h0, at = 0;
  for (let d = 500; d <= 9000; d += 250) { const h = heightAt(x, z + d); if (h > top) { top = h; at = d; } }
  if (top - h0 > best.rise) best = { x, z, rise: top - h0, crest: at };
}
console.log(`the mountain: ${best.rise.toFixed(0)} m of rise in ${(best.crest / 1000).toFixed(1)} km, from ${best.x}, ${best.z} — an average ${(Math.atan(best.rise / best.crest) * 180 / Math.PI).toFixed(0)}° slope`);

for (const cls of ["plane", "chopper"] as VehicleClass[]) {
  const { p, c } = board(cls, best.x, best.z);
  check(p.mode === "drive", `${cls}: aboard`, p.mode);
  c.move.y = 1; c.jumpHeld = true;
  let t = 0, low = Infinity, wrecked = false;
  const goal = best.z + best.crest + 1500;
  for (; t < 60 * 400 && p.vehicle.root.position.z < goal; t++) {
    p.update(DT, c);
    if (p.wrecked) { wrecked = true; break; }
    const v = p.vehicle.root.position;
    if (t > 240) low = Math.min(low, v.y - heightAt(v.x, v.z));
  }
  const v = p.vehicle.root.position;
  console.log(`${cls}: held the climb for ${(t / 60).toFixed(0)} s, got ${((v.z - best.z) / 1000).toFixed(1)} km, lowest ${low.toFixed(0)} m above the ground`);
  check(!wrecked, `${cls}: does not fly into the mountain`, wrecked ? `wrecked at ${((v.z - best.z) / 1000).toFixed(1)} km` : "clear");
  check(v.z >= goal, `${cls}: and gets over the top`, `${((v.z - best.z) / 1000).toFixed(1)} of ${((goal - best.z) / 1000).toFixed(1)} km`);
}

// Dry, roughly level country for everything that follows.
let fx = 0, fz = 0, found = false;
for (let x = -60000; x <= 60000 && !found; x += 1500) for (let z = -60000; z <= 60000; z += 1500) {
  let ok = heightAt(x, z) > 20;
  for (let dx = -300; dx <= 300 && ok; dx += 150) for (let d = -1050; d <= 700 && ok; d += 175) {
    ok = Math.abs(heightAt(x + dx, z + d) - heightAt(x, z)) < 11;
  }
  if (ok) { fx = x; fz = z; found = true; break; }
}
// Hands off, low, over the same country: it should ride the hills, not hit them.
{
  const { p, c } = board("plane", fx, fz - 1000);
  c.move.y = 1; c.jumpHeld = true;
  for (let k = 0; k < 60 * 6; k++) p.update(DT, c);
  c.jumpHeld = false;
  let wrecked = false, landings = 0, was = true;
  for (let k = 0; k < 60 * 240 && !wrecked; k++) {
    p.update(DT, c);
    wrecked = p.wrecked;
    const v = p.vehicle.root.position;
    const up = v.y - heightAt(v.x, v.z) > 1.5;
    if (!up && was) landings++;
    was = up;
  }
  console.log(`plane, hands off the climb for four minutes over hills: ${wrecked ? "WRECKED" : "intact"}, touched down ${landings} time${landings === 1 ? "" : "s"}`);
  check(!wrecked, "letting go never flies you into a hillside", wrecked ? "wrecked" : "intact");
}

// Now on purpose.
{
  const { p, c } = board("plane", fx, fz - 1000);
  c.move.y = 1; c.jumpHeld = true;
  for (let k = 0; k < 60 * 14; k++) p.update(DT, c);
  c.jumpHeld = false; c.down = true;
  let at: THREE.Vector3 | null = null;
  p.onWreck = (x, y, z) => { at = new THREE.Vector3(x, y, z); };
  for (let k = 0; k < 60 * 40 && !p.wrecked; k++) p.update(DT, c);
  c.down = false; c.move.y = 0;
  check(p.wrecked && at !== null, "diving an aeroplane into the ground destroys it", `wrecked ${p.wrecked}`);
  check(p.mode === "foot", "and you are out of it", p.mode);
  check(p.tumble > 0.8, "rolling", `${p.tumble.toFixed(2)} s of tumble to go`);
  const start = p.position.clone();
  for (let k = 0; k < 60 * 2; k++) p.update(DT, c);
  const rolled = p.position.distanceTo(start);
  const g = heightAt(p.position.x, p.position.z);
  check(p.tumble <= 0 && Math.abs(p.position.y - g) < 0.5, "then standing, on the ground", `${rolled.toFixed(1)} m from where you came out, ${(p.position.y - g).toFixed(2)} m off the ground`);
  check(rolled > 2 && rolled < 30, "having rolled clear, not been thrown a field away", `${rolled.toFixed(1)} m`);
  check(!p.nearVehicle && p.vehicleProximity === Infinity, "the wreck is not something you can get back into", "");
  check(p.canSummon, "but another can be called from right there", `canSummon ${p.canSummon}`);
  tap(p, c, "interact");
  for (let k = 0; k < 60 * 4; k++) p.update(DT, c);
  check(!p.wrecked, "and it is a new one", `wrecked ${p.wrecked}`);
  check(p.nearVehicle, "standing next to you", `${p.position.distanceTo(p.vehicle.root.position).toFixed(1)} m away`);
  tap(p, c, "interact");
  check(p.mode === "drive", "that you can get straight into", p.mode);
}

// Step out of it in flight: the wing must open, over land and over water, and
// the aeroplane must go on and come down somewhere by itself.
let sea = { x: 0, z: 0 };
search: for (let x = -60000; x <= 60000; x += 3000) for (let z = -60000; z <= 60000; z += 3000) {
  let wet = true;
  for (let d = -3000; d <= 9000 && wet; d += 1000) wet = heightAt(x, z + d) < -8;
  if (wet) { sea = { x, z }; break search; }
}
for (const [label, x, z] of [["over land", fx, fz - 1000], ["over the sea", sea.x, sea.z]] as [string, number, number][]) {
  const p = new Player(new THREE.PerspectiveCamera(), new THREE.Vector2(fx, fz - 1000));
  const c = controls();
  p.adopt("plane", 0x9a7f4e, p.position.x + 2, p.position.z + 1, 0);
  tap(p, c, "interact");
  c.move.y = 1; c.jumpHeld = true;
  for (let k = 0; k < 60 * 12; k++) p.update(DT, c);
  // Carry the whole flight to where the test wants it, at the height it has.
  const lift = p.vehicle.root.position.y - Math.max(heightAt(p.vehicle.root.position.x, p.vehicle.root.position.z), 0);
  (p as any).vehPos.set(x, Math.max(heightAt(x, z), 0) + lift, z);
  p.update(DT, c);
  c.jumpHeld = false; c.move.y = 0;
  const left = p.vehicle.root.position.clone();
  tap(p, c, "interact");
  check(p.skyState === 1, `${label}: stepped out, falling`, `skyState ${p.skyState}`);
  for (let k = 0; k < 40; k++) p.update(DT, c);
  // Pressed the way a controller reports it: true on every frame it is down.
  // A press held for an EVEN number of frames is the case that used to end
  // with the wing folded again.
  c.jump = true; c.jumpHeld = true;
  for (let k = 0; k < 6; k++) p.update(DT, c);
  c.jump = false; c.jumpHeld = false;
  p.update(DT, c);
  check(p.skyState === 3, `${label}: a held press opens the wing and leaves it open`, `skyState ${p.skyState}, swimming ${p.swimming}`);
  let secs = 0;
  while ((p.coasting || p.skyState !== 0) && secs < 400) { p.update(DT, c); secs += DT; }
  const went = p.vehicle.root.position.distanceTo(left);
  console.log(`${label}: left the aeroplane ${lift.toFixed(0)} m up; it went on ${(went / 1000).toFixed(1)} km and ${p.wrecked ? "crashed" : "came down and stopped"}`);
  check(went > 300, `${label}: the aeroplane flies on without you`, `${went.toFixed(0)} m`);
  check(!p.coasting, `${label}: and ends up somewhere`, p.wrecked ? "wrecked" : "at rest");
}

// And on wheels: fast into something solid, and slowly into the same thing.
for (const [label, secs, expect] of [["flat out", 9, true], ["at a crawl", 0.45, false]] as [string, number, boolean][]) {
  const { p, c } = board("truck", fx, fz - 1000);
  c.move.y = 1;
  for (let k = 0; k < 60 * secs; k++) p.update(DT, c);
  const v = p.vehicle.root.position;
  const speed = Math.abs(p.vehicleState.speed);
  // A wall directly in the way, a second and a half ahead.
  const ahead = Math.max(12, speed * 1.5);
  p.landmarkSolids = [{ x: v.x, z: v.z + ahead, radius: 3 }];
  if (!expect) c.move.y = 0.2;
  for (let k = 0; k < 60 * 6 && !p.wrecked; k++) p.update(DT, c);
  console.log(`truck into a wall ${label}, at ${(speed * 3.6).toFixed(0)} km/h: ${p.wrecked ? "destroyed" : "still a truck"}`);
  check(p.wrecked === expect, expect ? "a truck at speed into a wall is destroyed" : "a bump at walking pace is only a bump", `wrecked ${p.wrecked}`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall assertions passed");
process.exit(bad ? 1 : 0);
