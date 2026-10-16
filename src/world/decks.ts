import { landmarksNear, STRIP_HALF_L, STRIP_HALF_W, STRIP_TOP, type Landmark } from "./landmarks";

/**
 * Ground that somebody built.
 *
 * Clyde: "I can drive and walk through the now level airfield. it should be a
 * thing I can jump, climb whatever up onto and walk around/in."
 *
 * He is right, and the reason it was a hologram is worth writing down: the
 * airstrip was MODELLED but never MEASURED. The terrain function decides where
 * your feet are, the terrain function knows nothing about a runway, and a
 * 224-metre slab of graded dirt is therefore scenery you pass through.
 *
 * A pad is a rectangle in a landmark's own frame with a surface you stand on.
 * The same table builds the geometry you see and answers the question of where
 * your feet are, so the thing you walk on and the thing you look at cannot
 * drift apart — which is the bug that keeps happening in this file's
 * neighbours and the only real defence against it.
 *
 * THERE IS NO WALL. Every raised pad is reached by an embankment that ramps
 * from the surrounding ground up to its surface, so you drive or run onto a
 * strip from any direction and there is no invisible edge to catch on. That is
 * also what a real graded strip looks like — the earth it stands on had to come
 * from somewhere and it was pushed to the sides.
 *
 * Which leaves the good part. The strip stands a little over two metres proud
 * of its own ground, so driving off the SIDE of one at speed drops the surface
 * out from under the truck faster than gravity, and the ledge physics that was
 * already there throws you off it. Nobody had to write that.
 */

export interface Pad {
  /** Centre, in the landmark's model space. */
  lx: number;
  lz: number;
  halfW: number;
  halfL: number;
  /** Surface height at the centre, above the landmark's base. */
  top: number;
  /** Rise of the surface across the rectangle, metres per metre. */
  slopeX?: number;
  slopeZ?: number;
}

/** How far down a pad is solid. Enough to reach the lowest ground it allows. */
export const PAD_THICK = 7;

/**
 * The airstrip, as one plateau with graded sides.
 *
 * Read it as earthworks. Two flat surfaces — the run and the apron the hangar
 * stands on — and an embankment on every exposed edge of them, each falling
 * 4.6 m, which is as far below the surface as the ground is ever allowed to be.
 * Where the real ground is higher than an embankment the ground simply wins and
 * the embankment disappears into the hillside, so a strip cut into a slope
 * needs no special case: it is built up on the low side and buried on the high
 * one, by itself.
 */
const FALL = 4.6;
/** Side embankments: 8 m of batter, about 30°. Drivable, and climbable on foot. */
const SIDE = 8;
const SIDE_SLOPE = FALL / SIDE;
/** The ends get a longer, gentler batter, because that is the way you arrive. */
const END = 10;
const END_SLOPE = FALL / END;
/** Where the hangar's apron sits, and how big it is. */
const APRON_X = 25;
const APRON_Z = -6;
const APRON_W = 12;
const APRON_L = 9;
/** Height of an embankment's centre: half its fall below the surface. */
const BATTER = STRIP_TOP - FALL / 2;

export const AIRFIELD_PADS: Pad[] = [
  // The run, and the apron, which abut along x = 13 at the same height.
  { lx: 0, lz: 0, halfW: STRIP_HALF_W, halfL: STRIP_HALF_L, top: STRIP_TOP },
  { lx: APRON_X, lz: APRON_Z, halfW: APRON_W, halfL: APRON_L, top: STRIP_TOP },
  // Down both long sides. The +x one is buried under the apron where they
  // overlap, which costs nothing: the higher surface wins.
  { lx: -(STRIP_HALF_W + SIDE / 2), lz: 0, halfW: SIDE / 2, halfL: STRIP_HALF_L, top: BATTER, slopeX: SIDE_SLOPE },
  { lx: STRIP_HALF_W + SIDE / 2, lz: 0, halfW: SIDE / 2, halfL: STRIP_HALF_L, top: BATTER, slopeX: -SIDE_SLOPE },
  // Off both thresholds.
  { lx: 0, lz: STRIP_HALF_L + END / 2, halfW: STRIP_HALF_W, halfL: END / 2, top: BATTER, slopeZ: -END_SLOPE },
  { lx: 0, lz: -(STRIP_HALF_L + END / 2), halfW: STRIP_HALF_W, halfL: END / 2, top: BATTER, slopeZ: END_SLOPE },
  // And round the three open sides of the apron.
  { lx: APRON_X + APRON_W + SIDE / 2, lz: APRON_Z, halfW: SIDE / 2, halfL: APRON_L, top: BATTER, slopeX: -SIDE_SLOPE },
  { lx: APRON_X, lz: APRON_Z + APRON_L + SIDE / 2, halfW: APRON_W, halfL: SIDE / 2, top: BATTER, slopeZ: -SIDE_SLOPE },
  { lx: APRON_X, lz: APRON_Z - APRON_L - SIDE / 2, halfW: APRON_W, halfL: SIDE / 2, top: BATTER, slopeZ: SIDE_SLOPE },
];

/**
 * The jetty.
 *
 * Same complaint, smaller thing: Clyde has been walking through the planks and
 * swimming beside a dock he should be standing on. The deck is 1.9 m of timber
 * at walking height, and now you walk out along it — which is also what stops
 * the water test from deciding you are swimming while you are on a boardwalk.
 *
 * No embankment, and no edge either. Walking off a jetty into the water is not
 * a bug.
 */
export const DOCK_PADS: Pad[] = [{ lx: 0, lz: -30, halfW: 0.95, halfL: 30, top: 1.24 }];

function padsFor(kind: Landmark["kind"]): Pad[] {
  if (kind === "airfield") return AIRFIELD_PADS;
  if (kind === "dock") return DOCK_PADS;
  return [];
}

/** A pad placed in the world, ready to be asked about repeatedly. */
export interface Deck {
  x: number;
  z: number;
  rot: number;
  scale: number;
  halfW: number;
  halfL: number;
  /** Absolute world height of the surface at (x, z). */
  top: number;
  slopeX: number;
  slopeZ: number;
}

/** Every deck belonging to a landmark, in world space. */
export function decksOf(lm: Landmark): Deck[] {
  const pads = padsFor(lm.kind);
  if (!pads.length) return [];
  const c = Math.cos(lm.rot);
  const s = Math.sin(lm.rot);
  return pads.map((p) => ({
    x: lm.x + (p.lx * c + p.lz * s) * lm.scale,
    z: lm.z + (-p.lx * s + p.lz * c) * lm.scale,
    rot: lm.rot,
    scale: lm.scale,
    halfW: p.halfW * lm.scale,
    halfL: p.halfL * lm.scale,
    top: lm.y + p.top * lm.scale,
    // A gradient is a ratio, so it does not scale. The run it covers does.
    slopeX: p.slopeX ?? 0,
    slopeZ: p.slopeZ ?? 0,
  }));
}

export function decksNear(x: number, z: number, cells = 1): Deck[] {
  const out: Deck[] = [];
  for (const lm of landmarksNear(x, z, cells)) out.push(...decksOf(lm));
  return out;
}

/**
 * How high the built surfaces are at a point, or -Infinity where there are none.
 *
 * Caller takes the greater of this and the terrain, which is what makes a cut
 * and a fill the same piece of code.
 */
export function deckTop(px: number, pz: number, decks: Deck[]): number {
  let top = -Infinity;
  for (const d of decks) {
    const dx = (px - d.x) / d.scale;
    const dz = (pz - d.z) / d.scale;
    const c = Math.cos(d.rot);
    const s = Math.sin(d.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) * d.scale > d.halfW || Math.abs(lz) * d.scale > d.halfL) continue;
    const h = d.top + (d.slopeX * lx + d.slopeZ * lz) * d.scale;
    if (h > top) top = h;
  }
  return top;
}

/**
 * The terrain, or what has been built on top of it.
 *
 * Not called surfaceAt: audio/soundscape already has one of those and it
 * answers a completely different question — what you are standing ON, grass
 * or rock or sand, rather than how high it is.
 */
export function standingOn(px: number, pz: number, ground: number, decks: Deck[]): number {
  if (!decks.length) return ground;
  const built = deckTop(px, pz, decks);
  return built > ground ? built : ground;
}
