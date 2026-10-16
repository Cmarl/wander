/**
 * Leaping out of an aeroplane, and getting it back.
 *
 * Clyde: "plane vanishes after jumping out", "summon failing. I think it is
 * stuck in the sky somewhere", "I refreshed and got it, so def a state thing",
 * "also has the same persistent engine sound like the truck had".
 *
 * Runs the real Player under node — it is all arithmetic, no DOM — so there is
 * no browser to hang and no renderer to wait for.
 */
/**
 * The only DOM this needs.
 *
 * Player builds its drop shadows from a canvas gradient at construction time.
 * Nothing here looks at a single pixel of it, so a stub is honest rather than
 * a cheat — and it is the difference between this probe running in a second
 * under node and needing a browser that can hang.
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

const DT = 1 / 60;
let bad = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label.padEnd(46)} ${detail}`);
};
const controls = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: false, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});

const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 1e5);
// A spawn on gentle ground. (5400, -2200) is 1783 m up a mountainside, and
// the plane parked two metres away sat far enough below the player in Y that
// it was out of reach — the probe failed to board and then passed every later
// assertion trivially, which is the worst way for a test to be wrong.
const p = new Player(camera, new THREE.Vector2(1200, 800));
const c = controls();
let stopped = 0;
p.onDismount = () => stopped++;

p.adopt("plane", 0x9a7f4e, p.position.x + 2, p.position.z + 1, 0);
c.interact = true; p.update(DT, c); c.interact = false;
check(p.mode === "drive", "in the aeroplane", `mode ${p.mode}`);

// Climb with the control HELD — that is the state that used to leak.
c.jumpHeld = true; c.move.y = 1; c.cruise = true;
let i = 0;
for (; i < 60 * 240; i++) {
  p.update(DT, c);
  const v = p.vehicle.root.position;
  if (v.y - heightAt(v.x, v.z) > 500) break;
}
const alt = p.vehicle.root.position.y;
console.log(`climbed to ${(alt - heightAt(p.vehicle.root.position.x, p.vehicle.root.position.z)).toFixed(0)} m in ${(i / 60).toFixed(1)} s`);

// Step out, thumb still on the climb control.
c.interact = true; p.update(DT, c); c.interact = false;
check(p.skyState === 1, "stepped out while holding climb", `skyState ${p.skyState}`);
check(stopped === 1, "the engine was told to stop", `${stopped} shutdowns`);

for (let k = 0; k < 60 * 20; k++) p.update(DT, c);
const now = p.vehicle.root.position;
const ground = heightAt(now.x, now.z);
console.log(`aeroplane was at ${alt.toFixed(0)} m; twenty seconds later ${now.y.toFixed(0)} m, ground ${ground.toFixed(0)} m`);
check(now.y < alt - 100, "it does not fly off into the sky", `${(now.y - alt).toFixed(0)} m change`);
check(Math.abs(now.y - ground) < 3, "it is sitting on the ground", `${(now.y - ground).toFixed(2)} m off it`);

// Down, then call it back.
let drop = 0;
while (p.skyState > 0 && drop < 60 * 600) { p.update(DT, c); drop++; }
check(p.skyState === 0, "landed on foot", `after ${(drop / 60).toFixed(0)} s`);
c.jumpHeld = false; c.move.y = 0; c.cruise = false;
for (let k = 0; k < 60; k++) p.update(DT, c);
check(p.canSummon, "far enough away to call it", `${p.position.distanceTo(p.vehPos).toFixed(0)} m away`);
(p as any).summon();
for (let k = 0; k < 60 * 6; k++) p.update(DT, c);
const near = p.position.distanceTo(p.vehPos);
const settled = p.vehicle.root.position.y - heightAt(p.vehicle.root.position.x, p.vehicle.root.position.z);
console.log(`summoned: ${near.toFixed(1)} m away, ${settled.toFixed(2)} m off the ground`);
check(near < 40, "the plane it brought STAYS where it was put", `${near.toFixed(1)} m away`);
check(settled < 3, "and settles instead of climbing away", `${settled.toFixed(2)} m up`);

console.log(bad ? `\n${bad} FAILED` : "\nall assertions passed");
process.exit(bad ? 1 : 0);
