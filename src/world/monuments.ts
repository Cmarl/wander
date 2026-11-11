import { heightAt, slopeAt, slotRandom } from "./field";
import type { Deck } from "./decks";

/**
 * Monuments — the things you set out for.
 *
 * Clyde: "we will want more spectacular things to find still. Almost like
 * breath of the wild levels of amazing. abandoned castle, single skyscraper
 * you can walk up a winding staircase to the top, etc. real cool big finds
 * that make the game rewarding."
 *
 * A landmark is something you come across. A monument is something you saw an
 * hour ago from a hill and decided to go to, and everything about this file
 * follows from that one difference:
 *
 *   - they are an order of magnitude bigger, because below about a hundred
 *     metres nothing is visible far enough away to be a plan
 *   - they are drawn through thinner haze than the country round them (see
 *     monumentRender), so one hangs on the horizon the way a far mountain does
 *   - they are on their own coarse grid, so there is usually exactly one
 *     somewhere out there and rarely two
 *   - and you can go UP them, on stairs that are real surfaces you walk on,
 *     because the reward for reaching a tower is the country seen from its roof
 *
 * Like everything else in this world they are a pure function of the cell.
 * Nothing is stored, and every player has the same tower in the same place.
 *
 * ONE TABLE BUILDS BOTH. Each kind is described as a list of pads — rectangles
 * with a surface — and that list is what the renderer turns into slabs and
 * stair treads AND what decides where your feet are. The floor you see and
 * the floor you stand on cannot drift apart, because there is only one of it.
 */

export const MONUMENT_CELL = 30000;
/** Most cells have one. Empty quarters are allowed to exist. */
const OCCUPANCY = 0.78;

export type MonumentKind = "tower" | "castle" | "lighthouse" | "windfarm" | "colossus";

export const MONUMENT_NOUN: Record<MonumentKind, string> = {
  tower: "Tower",
  castle: "Castle",
  lighthouse: "Lighthouse",
  windfarm: "Wind Farm",
  colossus: "Colossus",
};

const NAMES: Record<MonumentKind, string[]> = {
  tower: ["The Unfinished Tower", "The Last Storey", "Forty Floors", "The Stopped Tower", "Babel Street", "The Tall Mistake"],
  castle: ["Castle Tern", "Greywatch", "Holt Castle", "The Old Keep", "Crowmoor", "Castle Farrow"],
  lighthouse: ["Farewell Light", "Gull Point Light", "The Last Lamp", "Sorrow Light", "Longshore Light", "Keeper's Rest"],
  windfarm: ["The Slow Giants", "The Turning Field", "Whitearm Farm", "The Quiet Mills", "Hundred Arms"],
  colossus: ["The Sleeper", "The Buried King", "The One Who Waits", "Old Shoulders", "The Wader"],
};

export interface Monument {
  id: string;
  kind: MonumentKind;
  name: string;
  x: number;
  z: number;
  /** The level its floor is built at: the HIGHEST ground under it. */
  y: number;
  rot: number;
  gx: number;
  gz: number;
}

/** A surface, in the monument's own frame, metres above its base. */
export interface MPad {
  lx: number;
  lz: number;
  halfW: number;
  halfL: number;
  top: number;
  slopeX?: number;
  slopeZ?: number;
  /** What the renderer makes of it. Absent means it is drawn some other way. */
  draw?: "slab" | "stair" | "earth" | "stone" | "plank";
  /** Thickness to draw, for slabs. */
  thick?: number;
}

/** A solid column, optionally only solid between two heights. */
export interface MSolid {
  dx: number;
  dz: number;
  r: number;
  bottom?: number;
  top?: number;
}

/** Somewhere worth having climbed to. */
export interface Summit {
  lx: number;
  lz: number;
  /** Feet must be at least this high above the base. */
  top: number;
  r: number;
}

// --- shared builders ---------------------------------------------------------

/**
 * A stair wound round the outside of a square shaft.
 *
 * Four straight flights to a turn with a square landing on each corner. It is
 * the same construction for a lighthouse's iron stair and a keep's stone one;
 * only the numbers change.
 */
export function wrapStair(inner: number, lane: number, y0: number, rise: number, flights: number, draw: MPad["draw"] = "stair"): MPad[] {
  const pads: MPad[] = [];
  const c = inner + lane / 2;
  // The corner you start from, at the height you start at.
  pads.push({ lx: -c, lz: -c, halfW: lane / 2, halfL: lane / 2, top: y0, draw: "slab", thick: 0.25 });
  for (let i = 0; i < flights; i++) {
    const side = i % 4;
    const h0 = y0 + i * rise;
    const mid = h0 + rise / 2;
    const slope = rise / (inner * 2);
    // south face going +x, east face going +z, north going -x, west going -z
    if (side === 0) pads.push({ lx: 0, lz: -c, halfW: inner, halfL: lane / 2, top: mid, slopeX: slope, draw });
    if (side === 1) pads.push({ lx: c, lz: 0, halfW: lane / 2, halfL: inner, top: mid, slopeZ: slope, draw });
    if (side === 2) pads.push({ lx: 0, lz: c, halfW: inner, halfL: lane / 2, top: mid, slopeX: -slope, draw });
    if (side === 3) pads.push({ lx: -c, lz: 0, halfW: lane / 2, halfL: inner, top: mid, slopeZ: -slope, draw });
    const [ex, ez] = [[c, -c], [c, c], [-c, c], [-c, -c]][side];
    pads.push({ lx: ex, lz: ez, halfW: lane / 2, halfL: lane / 2, top: h0 + rise, draw: "slab", thick: 0.25 });
  }
  return pads;
}

/**
 * Earth banked up round a level platform.
 *
 * The platform is built at the highest ground under it, so the low side would
 * stand on a cliff of its own foundations. This slopes away from every edge,
 * and where the real ground is higher than the bank the ground simply wins —
 * the same trick the airstrip uses, and the reason there is no wall anywhere
 * that you have to find a way round.
 */
export function apron(half: number, fall: number, run: number): MPad[] {
  const s = fall / run;
  const m = half + run / 2;
  const mid = -fall / 2;
  return [
    { lx: m, lz: 0, halfW: run / 2, halfL: half, top: mid, slopeX: -s, draw: "earth" },
    { lx: -m, lz: 0, halfW: run / 2, halfL: half, top: mid, slopeX: s, draw: "earth" },
    { lx: 0, lz: m, halfW: half, halfL: run / 2, top: mid, slopeZ: -s, draw: "earth" },
    { lx: 0, lz: -m, halfW: half, halfL: run / 2, top: mid, slopeZ: s, draw: "earth" },
    // Corners fall away both ways at once.
    { lx: m, lz: m, halfW: run / 2, halfL: run / 2, top: -fall, slopeX: -s, slopeZ: -s, draw: "earth" },
    { lx: -m, lz: m, halfW: run / 2, halfL: run / 2, top: -fall, slopeX: s, slopeZ: -s, draw: "earth" },
    { lx: m, lz: -m, halfW: run / 2, halfL: run / 2, top: -fall, slopeX: -s, slopeZ: s, draw: "earth" },
    { lx: -m, lz: -m, halfW: run / 2, halfL: run / 2, top: -fall, slopeX: s, slopeZ: s, draw: "earth" },
  ];
}

/** The bank round each platform: how far it falls, over what distance. */
const TOWER_BANK = { half: 16, fall: 7, run: 12 };
const CASTLE_BANK = { half: 36, fall: 14, run: 22 };
const LIGHT_BANK = { half: 11, fall: 8, run: 13 };

// --- the tower ---------------------------------------------------------------

/**
 * A skyscraper nobody finished, alone where there is no city.
 *
 * Bare frame: slabs, columns and a concrete core with the stair in it. No
 * walls — partly because an unfinished tower is the better story, and mostly
 * because it means every floor is somewhere you can walk to the edge of.
 *
 * Floor to floor is 4.2 m and the height comes OUT of that, not the other way
 * round. Two flights to a storey, 2.1 m each over a 5.6 m run: steeper than a
 * ramp, gentler than a ladder, about what a fire stair is.
 */
export const TOWER = {
  half: 13,
  floors: 40,
  storey: 4.2,
  /** The stair well: x from wellW to wellE, z within ±wellHalf. */
  wellW: -2.8,
  wellE: 4,
  wellHalf: 2.2,
  slab: 0.34,
  plinth: 0.4,
};
export const TOWER_ROOF = TOWER.plinth + TOWER.floors * TOWER.storey;

function towerPads(): MPad[] {
  const T = TOWER;
  const pads: MPad[] = [...apron(T.half + 3, TOWER_BANK.fall, TOWER_BANK.run)];
  // A paved margin round the foot of it.
  pads.push({ lx: 0, lz: 0, halfW: T.half + 3, halfL: T.half + 3, top: 0, draw: "stone", thick: 6 });
  const run = (2.8 + 2.8) / 2;
  const slope = T.storey / 2 / (run * 2);
  for (let f = 0; f <= T.floors; f++) {
    const h = T.plinth + f * T.storey;
    const roof = f === T.floors;
    // Four slabs round the well.
    const wW = (T.wellW + T.half) / 2;
    pads.push({ lx: -T.half + wW, lz: 0, halfW: wW, halfL: T.half, top: h, draw: "slab", thick: T.slab });
    const eW = (T.half - T.wellE) / 2;
    pads.push({ lx: T.wellE + eW, lz: 0, halfW: eW, halfL: T.half, top: h, draw: "slab", thick: T.slab });
    const midX = (T.wellW + T.wellE) / 2;
    const midW = (T.wellE - T.wellW) / 2;
    const nL = (T.half - T.wellHalf) / 2;
    pads.push({ lx: midX, lz: T.wellHalf + nL, halfW: midW, halfL: nL, top: h, draw: "slab", thick: T.slab });
    pads.push({ lx: midX, lz: -T.wellHalf - nL, halfW: midW, halfL: nL, top: h, draw: "slab", thick: T.slab });
    if (roof) break;
    // Up one flight, turn on the landing, up the other.
    pads.push({ lx: 0, lz: -T.wellHalf / 2, halfW: run, halfL: T.wellHalf / 2, top: h + T.storey / 4, slopeX: slope, draw: "stair" });
    pads.push({ lx: (2.8 + T.wellE) / 2, lz: 0, halfW: (T.wellE - 2.8) / 2, halfL: T.wellHalf, top: h + T.storey / 2, draw: "slab", thick: 0.22 });
    pads.push({ lx: 0, lz: T.wellHalf / 2, halfW: run, halfL: T.wellHalf / 2, top: h + (T.storey * 3) / 4, slopeX: -slope, draw: "stair" });
  }
  return pads;
}

function towerSolids(): MSolid[] {
  const T = TOWER;
  const out: MSolid[] = [];
  // Perimeter columns, every 6.5 m.
  for (let i = -2; i <= 2; i++) {
    for (const s of [-1, 1]) {
      out.push({ dx: i * 6.5, dz: s * T.half, r: 0.75 });
      if (Math.abs(i) < 2) out.push({ dx: s * T.half, dz: i * 6.5, r: 0.75 });
    }
  }
  // The core: walls north, south and east of the stair, open to the west.
  for (let x = T.wellW; x <= T.wellE + 0.6; x += 1.1) {
    out.push({ dx: x, dz: T.wellHalf + 0.55, r: 0.6 });
    out.push({ dx: x, dz: -T.wellHalf - 0.55, r: 0.6 });
  }
  for (let z = -T.wellHalf; z <= T.wellHalf; z += 1.1) out.push({ dx: T.wellE + 0.55, dz: z, r: 0.6 });
  return out;
}

// --- the castle --------------------------------------------------------------

export const CASTLE = {
  /** Centreline of the curtain wall. */
  wall: 32,
  thick: 3.4,
  wallTop: 9,
  bastion: 6.5,
  gate: 3.4,
  keepHalf: 8,
  keepZ: -8,
  keepLane: 2.6,
  keepTop: 28,
  yard: 36,
};

function castlePads(): MPad[] {
  const C = CASTLE;
  const pads: MPad[] = [...apron(C.yard, CASTLE_BANK.fall, CASTLE_BANK.run)];
  pads.push({ lx: 0, lz: 0, halfW: C.yard, halfL: C.yard, top: 0, draw: "stone", thick: 14 });
  // The wall walk, all the way round and over the gate.
  const t = C.thick / 2;
  for (const s of [-1, 1]) {
    pads.push({ lx: 0, lz: s * C.wall, halfW: C.wall + t, halfL: t, top: C.wallTop });
    pads.push({ lx: s * C.wall, lz: 0, halfW: t, halfL: C.wall + t, top: C.wallTop });
    // Bastions on the corners, level with the walk so you can go round.
    for (const u of [-1, 1]) pads.push({ lx: s * C.wall, lz: u * C.wall, halfW: C.bastion, halfL: C.bastion, top: C.wallTop });
  }
  // Up to the wall from the yard, along the inside of the west wall.
  pads.push({ lx: -C.wall + t + 1.3, lz: 2, halfW: 1.3, halfL: 9, top: C.wallTop / 2, slopeZ: -C.wallTop / 18, draw: "stair" });
  // The keep: a stair wound round the outside to the roof.
  const stair = wrapStair(C.keepHalf, C.keepLane, 0, C.keepTop / 4, 4, "stair");
  for (const p of stair) pads.push({ ...p, lz: p.lz + C.keepZ });
  pads.push({ lx: 0, lz: C.keepZ, halfW: C.keepHalf, halfL: C.keepHalf, top: C.keepTop });
  return pads;
}

function castleSolids(): MSolid[] {
  const C = CASTLE;
  const out: MSolid[] = [];
  const r = 1.75;
  for (let a = -C.wall; a <= C.wall + 0.01; a += 2.6) {
    // Not across the gate, which is in the middle of the +z wall.
    if (Math.abs(a) > C.gate) out.push({ dx: a, dz: C.wall, r, top: C.wallTop });
    out.push({ dx: a, dz: -C.wall, r, top: C.wallTop });
    out.push({ dx: C.wall, dz: a, r, top: C.wallTop });
    out.push({ dx: -C.wall, dz: a, r, top: C.wallTop });
  }
  for (const s of [-1, 1]) for (const u of [-1, 1]) {
    out.push({ dx: s * C.wall, dz: u * C.wall, r: C.bastion - 0.4, top: C.wallTop });
    // The turret standing on each bastion.
    out.push({ dx: s * C.wall, dz: u * C.wall, r: 2.4, bottom: C.wallTop - 0.5 });
  }
  // The keep itself. Solid up to its roof and not above, so you can stand on it.
  out.push({ dx: 0, dz: C.keepZ, r: C.keepHalf - 0.5, top: C.keepTop });
  for (const s of [-1, 1]) for (const u of [-1, 1]) {
    out.push({ dx: s * 5.6, dz: C.keepZ + u * 5.6, r: 2.2, top: C.keepTop });
  }
  return out;
}

// --- the lighthouse ----------------------------------------------------------

export const LIGHT = {
  half: 4,
  lane: 2.2,
  rise: 2.5,
  flights: 16,
  gallery: 7.2,
  lamp: 5.2,
};
export const LIGHT_TOP = LIGHT.rise * LIGHT.flights;

function lighthousePads(): MPad[] {
  const L = LIGHT;
  const pads: MPad[] = [...apron(11, LIGHT_BANK.fall, LIGHT_BANK.run)];
  pads.push({ lx: 0, lz: 0, halfW: 11, halfL: 11, top: 0, draw: "stone", thick: 8 });
  pads.push(...wrapStair(L.half, L.lane, 0, L.rise, L.flights, "stair"));
  // The gallery: a deck right round the lamp room.
  pads.push({ lx: 0, lz: 0, halfW: L.gallery, halfL: L.gallery, top: LIGHT_TOP, draw: "slab", thick: 0.3 });
  return pads;
}

function lighthouseSolids(): MSolid[] {
  const L = LIGHT;
  const out: MSolid[] = [{ dx: 0, dz: 0, r: L.half - 0.45, top: LIGHT_TOP }];
  for (const s of [-1, 1]) for (const u of [-1, 1]) out.push({ dx: s * 2.9, dz: u * 2.9, r: 1.05, top: LIGHT_TOP });
  // The lamp room, which you walk round rather than through.
  out.push({ dx: 0, dz: 0, r: 2.7, bottom: LIGHT_TOP - 0.5 });
  return out;
}

// --- wind farm and colossus --------------------------------------------------

export const TURBINE = { hub: 92, blade: 46, count: 12 };

/** Where each turbine stands, in world space, each on its own ground. */
export function turbinesOf(m: Monument): { x: number; z: number; y: number; phase: number; rate: number }[] {
  const out: { x: number; z: number; y: number; phase: number; rate: number }[] = [];
  for (let i = 0; i < TURBINE.count; i++) {
    const col = (i % 4) - 1.5;
    const row = Math.floor(i / 4) - 1;
    const x = m.x + col * 250 + (slotRandom(m.gx * 31 + i, m.gz, 2203) - 0.5) * 120;
    const z = m.z + row * 290 + (slotRandom(m.gx * 31 + i, m.gz, 2207) - 0.5) * 120;
    const y = heightAt(x, z);
    if (y < 4 || slopeAt(x, z, 10) > 0.4) continue;
    out.push({
      x, z, y,
      phase: slotRandom(m.gx * 31 + i, m.gz, 2213) * Math.PI * 2,
      rate: 0.55 + slotRandom(m.gx * 31 + i, m.gz, 2221) * 0.3,
    });
  }
  return out;
}

export const COLOSSUS = { height: 64 };

function colossusSolids(): MSolid[] {
  return [
    { dx: 0, dz: 0, r: 9.5 },
    { dx: -9, dz: 0, r: 4.5 },
    { dx: 9, dz: 0, r: 4.5 },
    // The fallen hand, which you can climb onto but not walk through the wrist of.
    { dx: 30, dz: 24, r: 3.2, top: 3.2 },
  ];
}

function colossusPads(): MPad[] {
  // The open hand lying in the grass: a palm you can stand in.
  return [
    { lx: 30, lz: 14, halfW: 5, halfL: 5.5, top: 3.4 },
    // Up the fingers, which lie on the ground like a ramp.
    { lx: 30, lz: 4.5, halfW: 4.6, halfL: 4, top: 1.7, slopeZ: 3.4 / 8 },
  ];
}

// --- the tables --------------------------------------------------------------

const PADS: Record<MonumentKind, MPad[]> = {
  tower: towerPads(),
  castle: castlePads(),
  lighthouse: lighthousePads(),
  windfarm: [],
  colossus: colossusPads(),
};

const SOLIDS: Record<MonumentKind, MSolid[]> = {
  tower: towerSolids(),
  castle: castleSolids(),
  lighthouse: lighthouseSolids(),
  windfarm: [],
  colossus: colossusSolids(),
};

/** The place on each one that is the point of climbing it. */
export const SUMMITS: Partial<Record<MonumentKind, Summit>> = {
  tower: { lx: 0, lz: 0, top: TOWER_ROOF - 0.5, r: 20 },
  castle: { lx: 0, lz: CASTLE.keepZ, top: CASTLE.keepTop - 0.5, r: 12 },
  lighthouse: { lx: 0, lz: 0, top: LIGHT_TOP - 0.5, r: 11 },
};

/** How much ground each one clears of trees and grass, as a half-width. */
export const FOOTPRINT: Record<MonumentKind, number> = {
  tower: 26,
  castle: 54,
  lighthouse: 22,
  windfarm: 0,
  colossus: 22,
};

/** How close you have to come for it to count as found. */
export const FOUND_RANGE: Record<MonumentKind, number> = {
  tower: 70,
  castle: 95,
  lighthouse: 60,
  windfarm: 420,
  colossus: 80,
};

export const padsOf = (kind: MonumentKind): MPad[] => PADS[kind];

// --- placement ---------------------------------------------------------------

function drop(x: number, z: number, r: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const h = heightAt(x + i * r, z + j * r);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return { lo, hi };
}

/**
 * Whether the bank reaches the ground all the way round.
 *
 * The platform is level and the bank falls a fixed distance from its edge. If
 * the real ground at the foot of the bank is lower still, the bank ends in a
 * step you cannot climb — and you walk in underneath the courtyard instead of
 * onto it. The climb probe found exactly that on a hilltop castle.
 */
function footed(x: number, z: number, base: number, bank: { half: number; fall: number; run: number }): boolean {
  const r = bank.half + bank.run;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    // Round the square the bank actually ends on, not a circle inside it.
    const k = r / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    if (heightAt(x + Math.cos(a) * k, z + Math.sin(a) * k) < base - bank.fall + 0.5) return false;
  }
  return true;
}

/** Whether a kind could stand here, and at what level if so. */
function siteFor(kind: MonumentKind, x: number, z: number): number | null {
  const y = heightAt(x, z);
  if (y < 4) return null;
  if (kind === "tower") {
    if (y < 12) return null;
    const d = drop(x, z, 16);
    return d.hi - d.lo < 4 && footed(x, z, d.hi + 0.2, TOWER_BANK) ? d.hi + 0.2 : null;
  }
  if (kind === "castle") {
    if (y < 30) return null;
    const d = drop(x, z, 36);
    if (d.hi - d.lo > 10) return null;
    // On a rise. A castle in a hollow is a farm with ideas.
    let ring = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring += heightAt(x + Math.cos(a) * 520, z + Math.sin(a) * 520);
    }
    return y - ring / 8 > 9 && footed(x, z, d.hi + 0.2, CASTLE_BANK) ? d.hi + 0.2 : null;
  }
  if (kind === "lighthouse") {
    if (y > 80) return null;
    const d = drop(x, z, 11);
    if (d.hi - d.lo > 5 || !footed(x, z, d.hi + 0.2, LIGHT_BANK)) return null;
    // There has to be sea for it to be a light FOR.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (heightAt(x + Math.cos(a) * 230, z + Math.sin(a) * 230) < -1.5) return d.hi + 0.2;
    }
    return null;
  }
  if (kind === "windfarm") {
    return y > 15 ? y : null;
  }
  // colossus
  if (y < 10) return null;
  const d = drop(x, z, 24);
  return d.hi - d.lo < 9 ? d.lo : null;
}

/**
 * Walk from a point to the nearest shoreline along one bearing.
 *
 * A lighthouse needs a coast, and a coast is a line: throwing darts at a
 * thirty-kilometre cell almost never lands on one. So start anywhere, march
 * until the ground crosses sea level, and stand just inland of the crossing.
 */
function coastFrom(x: number, z: number, a: number): { x: number; z: number } | null {
  const dx = Math.cos(a) * 160;
  const dz = Math.sin(a) * 160;
  let wet = heightAt(x, z) < 0;
  for (let i = 0; i < 70; i++) {
    x += dx;
    z += dz;
    const nowWet = heightAt(x, z) < 0;
    if (nowWet === wet) continue;
    // Crossed. Back up onto the land side until there is ground to build on.
    const sx = nowWet ? -dx : dx;
    const sz = nowWet ? -dz : dz;
    for (let k = 0; k < 14; k++) {
      if (heightAt(x, z) > 6) return { x, z };
      x += sx * 0.2;
      z += sz * 0.2;
    }
    return null;
  }
  return null;
}

/**
 * What a cell would rather have, weighted — and then what it will settle for.
 *
 * The wind farm is last in the fallback because it can stand almost anywhere,
 * and anything that can stand anywhere ends up everywhere: left in the
 * rotation it was half of all monuments.
 */
const WEIGHTS: [MonumentKind, number][] = [
  ["tower", 0.26], ["castle", 0.26], ["lighthouse", 0.18], ["colossus", 0.17], ["windfarm", 0.13],
];
const FALLBACK: MonumentKind[] = ["castle", "tower", "colossus", "lighthouse", "windfarm"];
const cache = new Map<string, Monument | null>();

/** How far a point stands above the country round it, near and far. */
function prominence(x: number, z: number, y: number): number {
  let sum = 0;
  let worst = -Infinity;
  for (const r of [1500, 4000, 8000]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r;
      const h = Math.max(0, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
      sum += h;
      if (h > worst) worst = h;
    }
  }
  // Mostly the average, but a single wall of mountain next door counts too.
  return y - (sum / 24) * 0.7 - worst * 0.3;
}

export function monumentInCell(gx: number, gz: number): Monument | null {
  const key = `${gx},${gz}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let made: Monument | null = null;
  if (slotRandom(gx, gz, 2011) <= OCCUPANCY) {
    let pick = slotRandom(gx, gz, 2017);
    let first: MonumentKind = "tower";
    for (const [k, w] of WEIGHTS) {
      if (pick < w) { first = k; break; }
      pick -= w;
    }
    const order = [first, ...FALLBACK.filter((k) => k !== first)];
    for (const kind of order) {
      /**
       * The most prominent place that will take it, not the first.
       *
       * Measured: sited on the first ground that passed, the nearest monument
       * was in line of sight from only one random spot in five — a tower in a
       * valley is behind a hill however tall it is. Somebody choosing where
       * to build a castle, a lighthouse or a statue picks the place it can be
       * seen from, so the cell does the same: every candidate is scored by how
       * far it stands above the country round it, and the best one wins.
       */
      let best: { x: number; z: number; y: number; score: number } | null = null;
      for (let t = 0; t < 36; t++) {
        let x = (gx + (slotRandom(gx + t * 7, gz, 2027) - 0.5) * 0.8) * MONUMENT_CELL;
        let z = (gz + (slotRandom(gx, gz + t * 7, 2029) - 0.5) * 0.8) * MONUMENT_CELL;
        if (kind === "lighthouse") {
          const c = coastFrom(x, z, slotRandom(gx + t, gz - t, 2063) * Math.PI * 2);
          if (!c) continue;
          x = c.x;
          z = c.z;
        }
        const y = siteFor(kind, x, z);
        if (y === null) continue;
        if (kind === "windfarm") {
          const probe = { id: key, kind, name: "", x, z, y, rot: 0, gx, gz } as Monument;
          if (turbinesOf(probe).length < 8) continue;
        }
        const score = prominence(x, z, y);
        if (!best || score > best.score) best = { x, z, y, score };
      }
      if (!best) continue;
      const names = NAMES[kind];
      made = {
        id: `m:${key}`,
        kind,
        name: names[Math.floor(slotRandom(gx, gz, 2039) * names.length) % names.length],
        x: best.x,
        z: best.z,
        y: best.y,
        rot: kind === "windfarm" ? 0 : slotRandom(gx, gz, 2053) * Math.PI * 2,
        gx,
        gz,
      };
      break;
    }
  }
  cache.set(key, made);
  return made;
}

export function monumentsNear(x: number, z: number, cells = 1): Monument[] {
  const cx = Math.round(x / MONUMENT_CELL);
  const cz = Math.round(z / MONUMENT_CELL);
  const out: Monument[] = [];
  for (let j = -cells; j <= cells; j++) {
    for (let i = -cells; i <= cells; i++) {
      const m = monumentInCell(cx + i, cz + j);
      if (m) out.push(m);
    }
  }
  return out;
}

/** The nearest monument to a point, however far, within the surrounding cells. */
export function nearestMonument(x: number, z: number, cells = 2): { m: Monument; d: number } | null {
  let best: { m: Monument; d: number } | null = null;
  for (const m of monumentsNear(x, z, cells)) {
    const d = Math.hypot(m.x - x, m.z - z);
    if (!best || d < best.d) best = { m, d };
  }
  return best;
}

// --- where your feet are -----------------------------------------------------

/** A monument's own frame to the world. Same convention as world/frame. */
export function monumentToWorld(m: Monument, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(m.rot);
  const s = Math.sin(m.rot);
  return { x: m.x + lx * c + lz * s, z: m.z - lx * s + lz * c };
}

export function monumentToLocal(m: Monument, x: number, z: number): { lx: number; lz: number } {
  const c = Math.cos(m.rot);
  const s = Math.sin(m.rot);
  const dx = x - m.x;
  const dz = z - m.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

/**
 * How far up a surface you can step without jumping.
 *
 * This is what makes a building with more than one floor possible at all. The
 * airstrip only ever asked "what is the highest thing here" — fine for one
 * slab on the ground, and in a forty-storey tower it would put you on the roof
 * the moment you walked in the door.
 */
export const STEP_UP = 0.75;

const deckCache = new Map<string, Deck[]>();
export function monumentDecks(m: Monument): Deck[] {
  let d = deckCache.get(m.id);
  if (d) return d;
  d = PADS[m.kind].map((p) => {
    const w = monumentToWorld(m, p.lx, p.lz);
    return {
      x: w.x,
      z: w.z,
      rot: m.rot,
      scale: 1,
      halfW: p.halfW,
      halfL: p.halfL,
      top: m.y + p.top,
      slopeX: p.slopeX ?? 0,
      slopeZ: p.slopeZ ?? 0,
      step: STEP_UP,
    };
  });
  deckCache.set(m.id, d);
  return d;
}

export interface WorldSolid { x: number; z: number; radius: number; bottom?: number; top?: number }

const solidCache = new Map<string, WorldSolid[]>();
export function monumentSolids(m: Monument): WorldSolid[] {
  let s = solidCache.get(m.id);
  if (s) return s;
  if (m.kind === "windfarm") {
    s = turbinesOf(m).map((t) => ({ x: t.x, z: t.z, radius: 2.7 }));
  } else {
    s = SOLIDS[m.kind].map((o) => {
      const w = monumentToWorld(m, o.dx, o.dz);
      return {
        x: w.x,
        z: w.z,
        radius: o.r,
        bottom: o.bottom === undefined ? undefined : m.y + o.bottom,
        top: o.top === undefined ? undefined : m.y + o.top,
      };
    });
  }
  solidCache.set(m.id, s);
  return s;
}

/** True when these feet are standing on the monument's summit. */
export function onSummit(m: Monument, x: number, y: number, z: number): boolean {
  const s = SUMMITS[m.kind];
  if (!s) return false;
  if (y < m.y + s.top) return false;
  const l = monumentToLocal(m, x, z);
  return Math.hypot(l.lx - s.lx, l.lz - s.lz) < s.r;
}
