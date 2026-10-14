import * as THREE from "three";

/**
 * Where you have recently been, as a short ring of world positions.
 *
 * Shared by the grass and the saplings so one pass of the truck bends both
 * with the same trail — if each kept its own buffer they would drift apart and
 * the wake would stop reading as a single thing moving through the world.
 *
 * Each point is (x, y, z, freshness). Freshness decays, which is what springs
 * everything back up.
 */
export const CRUSH_POINTS = 16;

export const crushPoints: THREE.Vector4[] = Array.from(
  { length: CRUSH_POINTS },
  () => new THREE.Vector4(0, 0, 0, 0)
);

let next = 0;
let timer = 0;

/** Lay down a point at the given spot and age the rest. */
export function updateCrush(dt: number, x: number, y: number, z: number, moving: boolean) {
  for (const p of crushPoints) p.w = Math.max(0, p.w - dt * 0.14);
  timer -= dt;
  if (!moving || timer > 0) return;
  timer = 0.07;
  const p = crushPoints[next];
  next = (next + 1) % crushPoints.length;
  p.set(x, y, z, 1);
}
