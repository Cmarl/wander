import { landmarksNear, STRIP_HALF_L, STRIP_HALF_W, type Landmark } from "./landmarks";
import { FOOTPRINT, MONUMENT_CELL, monumentInCell } from "./monuments";

/**
 * Ground that somebody cleared.
 *
 * Clyde: "we should make sure these things adjust to the terrain and also
 * remove trees and rocks if they land inside it. should look intentional, not
 * plopped in."
 *
 * He is right that this is the difference between a built thing and a decal.
 * A runway with a pine growing out of it is not a runway, and the tree is not
 * the odd part — a world that grew a tree where somebody graded two hundred
 * metres of dirt is the odd part.
 *
 * A clearing is an oriented rectangle. The scatter tests it on the CPU and the
 * grass tests it in the vertex shader, from the same numbers, so what you walk
 * on and what you see agree.
 */

export interface Clearing {
  x: number;
  z: number;
  /** Rotation of the rectangle, radians. */
  rot: number;
  halfW: number;
  halfL: number;
}

/** How many the grass shader can be told about at once. */
export const MAX_CLEARINGS = 3;

/** Clearings belonging to a landmark, if it has any. */
function clearingsFor(lm: Landmark): Clearing[] {
  if (lm.kind === "airfield") {
    return [
      // The strip itself, plus the apron the hangar stands on.
      { x: lm.x, z: lm.z, rot: lm.rot, halfW: STRIP_HALF_W + 6, halfL: STRIP_HALF_L, },
      { x: lm.x + 26 * lm.scale, z: lm.z - 6 * lm.scale, rot: lm.rot, halfW: 13, halfL: 11 },
    ];
  }
  if (lm.kind === "dock") {
    // The landing's approach, so you are not pushing through scrub to reach it.
    return [{ x: lm.x, z: lm.z, rot: lm.rot, halfW: 5, halfL: 8 }];
  }
  // Nothing grows in scalding mineral water, or in the middle of a ring
  // people have been walking round for four thousand years.
  if (lm.kind === "spring") return [{ x: lm.x, z: lm.z, rot: 0, halfW: 15 * lm.scale, halfL: 15 * lm.scale }];
  if (lm.kind === "stones" && lm.variant !== 1) return [{ x: lm.x, z: lm.z, rot: 0, halfW: 11 * lm.scale, halfL: 11 * lm.scale }];
  return [];
}

/**
 * The clearings near a point, nearest first.
 *
 * Capped, because the grass shader has a fixed number of slots and the honest
 * thing is to give it the ones that matter rather than silently drop whichever
 * happened to be last in the list.
 */
export function clearingsNear(x: number, z: number, cells = 2): Clearing[] {
  const out: Clearing[] = [];
  for (const lm of landmarksNear(x, z, cells)) out.push(...clearingsFor(lm));
  // A castle with a pine growing through the keep is the same mistake as a
  // runway with one. Monuments are sparse and their cell lookup is cached, so
  // asking costs a map read.
  const m = monumentInCell(Math.round(x / MONUMENT_CELL), Math.round(z / MONUMENT_CELL));
  if (m && FOOTPRINT[m.kind] > 0 && Math.abs(m.x - x) < 400 && Math.abs(m.z - z) < 400) {
    out.push({ x: m.x, z: m.z, rot: m.rot, halfW: FOOTPRINT[m.kind], halfL: FOOTPRINT[m.kind] });
  }
  out.sort(
    (a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2)
  );
  return out.slice(0, MAX_CLEARINGS);
}

/** Whether a point is inside a cleared rectangle. */
export function inClearing(px: number, pz: number, c: Clearing): boolean {
  const dx = px - c.x;
  const dz = pz - c.z;
  const co = Math.cos(c.rot);
  const si = Math.sin(c.rot);
  // Into the rectangle's own frame. Same transform the renderer uses to place
  // the geometry, with the sign flipped because this goes the other way.
  const lx = dx * co - dz * si;
  const lz = dx * si + dz * co;
  return Math.abs(lx) < c.halfW && Math.abs(lz) < c.halfL;
}

export function inAnyClearing(px: number, pz: number, list: Clearing[]): boolean {
  for (const c of list) if (inClearing(px, pz, c)) return true;
  return false;
}
