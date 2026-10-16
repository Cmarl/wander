import type { Landmark } from "./landmarks";

/**
 * A landmark's own coordinate frame.
 *
 * Every landmark is modelled around its own origin and then placed with one
 * instance transform. Anything that needs to know where a PART of a landmark
 * ended up — a solid wall, a cleared rectangle, a surface you stand on — has
 * to redo that transform by hand, and until now four files each did it
 * separately.
 *
 * Two of them had it backwards. `landmarkSolids` rotated by -rot, so for every
 * kind that is placed at an angle the solid cylinders sat mirrored across the
 * landmark: the dock's posts were on the wrong side of its own jetty. It went
 * unnoticed because the one thing anybody tested it against — the airstrip —
 * is pinned to bearing zero, where the bug cannot show.
 *
 * So: one place that knows the convention, derived once from what the renderer
 * actually does.
 *
 *   q.setFromAxisAngle(0,1,0, rot)  →  x' = x·cos + z·sin,  z' = -x·sin + z·cos
 *
 * and nothing else is allowed to write that down again.
 */

/** A point in the landmark's model space, to where it actually is in the world. */
export function toWorld(lm: Landmark, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(lm.rot);
  const s = Math.sin(lm.rot);
  return {
    x: lm.x + (lx * c + lz * s) * lm.scale,
    z: lm.z + (-lx * s + lz * c) * lm.scale,
  };
}

/**
 * A world point, into the landmark's model space.
 *
 * The inverse of `toWorld`, scale included — so the result compares directly
 * against the numbers in the model, not against scaled copies of them.
 */
export function toLocal(lm: Landmark, x: number, z: number): { lx: number; lz: number } {
  const c = Math.cos(lm.rot);
  const s = Math.sin(lm.rot);
  const dx = (x - lm.x) / lm.scale;
  const dz = (z - lm.z) / lm.scale;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
