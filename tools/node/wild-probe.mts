/**
 * The glider, the slide and the jump, measured.
 *
 * "More wild fun" is a feeling, and this cannot judge the feeling. What it can
 * do is check that each piece does what it claims: that the wing really
 * carries you a kilometre off a tower, that a dive really buys height back,
 * that a slide pays out, and that a jump is really longer than it was.
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
import { SPECS } from "../../src/game/vehicles";
import { TOWER_ROOF, monumentDecks, monumentInCell, monumentToWorld, type Monument } from "../../src/world/monuments";

const DT = 1 / 60;
let bad = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label.padEnd(48)} ${detail}`);
};
const controls = (): any => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, sprint: true, jump: false,
  jumpHeld: false, down: false, interact: false, glass: false, pin: false,
  camp: false, cruise: false, padHorn: false, padJournal: false, padCamp: false, isTouch: false,
});
const tap = (p: Player, c: any, key: string) => { c[key] = true; p.update(DT, c); c[key] = false; };

// --- the wing, off the top of a tower ---------------------------------------
let tower: Monument | null = null;
for (let r = 0; r < 12 && !tower; r++) for (let gx = -r; gx <= r && !tower; gx++) for (let gz = -r; gz <= r; gz++) {
  const m = monumentInCell(gx, gz);
  if (m && m.kind === "tower") { tower = m; break; }
}
if (!tower) throw new Error("no tower");
const fly = (stick: (t: number, p: Player) => { x: number; y: number }) => {
  const start = monumentToWorld(tower!, -6, -6);
  const p = new Player(new THREE.PerspectiveCamera(), new THREE.Vector2(start.x, start.z));
  p.decks = monumentDecks(tower!);
  p.position.y = tower!.y + TOWER_ROOF;
  const c = controls();
  for (let k = 0; k < 20; k++) p.update(DT, c);
  const from = p.position.clone();
  // Run west off the roof, then open the wing a moment into the fall.
  (p as any).camYaw = Math.atan2(-(monumentToWorld(tower!, -60, -6).x - p.position.x), -(monumentToWorld(tower!, -60, -6).z - p.position.z));
  c.move.y = 1;
  let t = 0;
  while (p.skyState === 0 && t < 600) { p.update(DT, c); t++; }
  for (let k = 0; k < 30; k++) p.update(DT, c);
  c.move.y = 0;
  tap(p, c, "jump");
  const opened = p.skyState === 3;
  let secs = 0, peak = p.position.y, low = p.position.y, regained = 0;
  while (p.skyState === 3 && secs < 600) {
    const s = stick(secs, p);
    c.move.x = s.x; c.move.y = s.y;
    p.update(DT, c);
    secs += DT;
    if (p.position.y < low) low = p.position.y;
    regained = Math.max(regained, p.position.y - low);
    peak = Math.max(peak, p.position.y);
  }
  return { opened, secs, dist: Math.hypot(p.position.x - from.x, p.position.z - from.z), regained, p, from };
};

const straight = fly(() => ({ x: 0, y: 0 }));
console.log(`wing, hands off, from ${TOWER_ROOF.toFixed(0)} m: ${straight.dist.toFixed(0)} m in ${straight.secs.toFixed(0)} s`);
check(straight.opened, "jump in the air opens the wing", `skyState 3: ${straight.opened}`);
check(straight.dist > 700, "a tower roof is most of a kilometre of flight", `${straight.dist.toFixed(0)} m`);
check(straight.p.skyState === 0 && (straight.p as any).grounded, "and it ends standing on the ground", `skyState ${straight.p.skyState}`);

// Dive for four seconds, then haul back: it must give height back.
const swoop = fly((t) => ({ x: 0, y: t < 4 ? 1 : t < 7.5 ? -1 : 0 }));
console.log(`dive then pull up: climbed ${swoop.regained.toFixed(1)} m out of the bottom of the dive`);
check(swoop.regained > 8, "speed from a dive buys height back", `${swoop.regained.toFixed(1)} m`);

// A turn held all the way round comes back to where it started pointing.
// A hard turn away from the tower must cost height, but not much of it.
const turned = fly((t) => ({ x: t > 1 && t < 2.2 ? -1 : 0, y: 0 }));
check(turned.secs > straight.secs * 0.8, "a hard turn does not drop you out of the sky", `${turned.secs.toFixed(0)} s aloft against ${straight.secs.toFixed(0)} flown straight`);

// --- the truck ---------------------------------------------------------------
// Somewhere flat and dry with room to run.
let fx = 0, fz = 0, found = false;
for (let x = -60000; x <= 60000 && !found; x += 1500) for (let z = -60000; z <= 60000; z += 1500) {
  let ok = heightAt(x, z) > 20;
  // Flat over a whole square, not along one line: a slide leaves the line.
  for (let dx = -300; dx <= 300 && ok; dx += 150) for (let d = -1050; d <= 700 && ok; d += 175) {
    // slopeAt is 1 - normal.y, which calls a one-in-four hill 0.03. Level
    // means level: within a few metres of the middle, everywhere. (Nothing in this
    // world is flatter than that over two kilometres, which is its own finding.)
    ok = Math.abs(heightAt(x + dx, z + d) - heightAt(x, z)) < 11;
  }
  if (ok) { fx = x; fz = z; found = true; break; }
}
check(found, "found flat ground to drive on", `${fx}, ${fz}`);
const drive = () => {
  const p = new Player(new THREE.PerspectiveCamera(), new THREE.Vector2(fx, fz - 1000));
  const c = controls();
  p.adopt("truck", 0x9a7f4e, p.position.x + 2, p.position.z + 1, 0);
  tap(p, c, "interact");
  return { p, c };
};
{
  const { p, c } = drive();
  c.move.y = 1;
  for (let k = 0; k < 60 * 9; k++) p.update(DT, c);
  const flat = Math.abs(p.vehicleState.speed);
  console.log(`truck flat out: ${(flat * 3.6).toFixed(0)} km/h (it was 173)`);
  check(flat > SPECS.truck.top * 0.93, "the truck reaches its new top speed", `${flat.toFixed(1)} of ${SPECS.truck.top} m/s`);

  // Stick hard over at speed: it must slide, hold most of its speed, and pay.
  c.move.x = 1;
  let slid = 0, boosted = 0;
  for (let k = 0; k < 60 * 2.2; k++) { p.update(DT, c); slid = Math.max(slid, p.drifting); }
  const inSlide = Math.abs(p.vehicleState.speed);
  c.move.x = 0;
  for (let k = 0; k < 60 * 1.2; k++) { p.update(DT, c); boosted = Math.max(boosted, p.boost); }
  let peak = 0;
  for (let k = 0; k < 60 * 2; k++) { p.update(DT, c); peak = Math.max(peak, Math.abs(p.vehicleState.speed)); }
  console.log(`a two second slide: held ${(inSlide * 3.6).toFixed(0)} km/h, then boosted to ${(peak * 3.6).toFixed(0)} km/h`);
  check(slid > 0.8, "full stick at speed is a slide", `drifting ${slid.toFixed(2)}`);
  check(inSlide > flat * 0.8, "which costs almost no speed", `${(inSlide / flat * 100).toFixed(0)}% kept`);
  check(boosted > 0.8, "and pays out a boost when it straightens", `${boosted.toFixed(1)} s`);
  check(peak > SPECS.truck.top * 1.12, "that takes you past top speed", `${(peak * 3.6).toFixed(0)} km/h`);
}
{
  const { p, c } = drive();
  c.move.y = 1;
  for (let k = 0; k < 60 * 9; k++) p.update(DT, c);
  let air = 0, turns = 0, height = 0;
  p.onStunt = (a, t) => { air = a; turns = t; };
  const y0 = p.vehicle.root.position.y;
  tap(p, c, "jump");
  c.move.x = 1;
  for (let k = 0; k < 60 * 6 && air === 0; k++) { p.update(DT, c); height = Math.max(height, p.vehicle.root.position.y - y0); }
  c.move.x = 0;
  const after = Math.abs(p.vehicleState.speed);
  console.log(`a jump at full speed: ${air.toFixed(2)} s in the air, ${height.toFixed(1)} m up, ${(turns * 360).toFixed(0)}° of spin, landed at ${(after * 3.6).toFixed(0)} km/h`);
  check(air > 1.5, "a jump at speed is real hang time", `${air.toFixed(2)} s (it was about 0.8)`);
  check(turns >= 1, "long enough to spin it right round", `${(turns * 360).toFixed(0)}°`);
  check(after > SPECS.truck.top * 0.85, "and landing does not cost the speed", `${(after * 3.6).toFixed(0)} km/h`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall assertions passed");
process.exit(bad ? 1 : 0);
