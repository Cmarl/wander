import * as THREE from "three";
import { box, merge, strut } from "./geom";

/**
 * Things tall enough to see.
 *
 * Clyde, asked whether to do this: "Yeah, make everything taller."
 *
 * The audit measured why. A landmark needs about four pixels of height to
 * register as a shape worth turning toward — at 1080p and a 70° field of view
 * that is a visible range of roughly 221 times its height. Landmarks sit a
 * median 1.93 km apart. So anything under about nine metres is invisible from
 * the place you are most likely to be standing, and ELEVEN OF EIGHTEEN KINDS
 * were under it: a boat landing topped out at 2.2 m, a mine adit at 3.8, a
 * hot spring at 2.9.
 *
 * The result was a world you could only find by walking over. Measured end to
 * end, a player steering at the nearest thing it could plausibly see found one
 * landmark in ten minutes.
 *
 * So every short kind gets something tall, and the rule is that the tall thing
 * has to BELONG. A mine gets its headframe. A landing gets the mast you tie
 * up to. A hot spring gets the dead tree its water killed. The point is not to
 * plant poles — it is that these places would really have had these things,
 * and the reason they were missing is that nobody had needed them to be
 * visible yet.
 *
 * Target: 12 m or more, which reads as a dot at 2.6 km and comfortably clears
 * the gap between landmarks. Scale takes most of them further.
 */

/** Visible range of something this tall, in metres. The whole justification. */
export const SIGHT_PER_METRE = 1 / Math.tan(((4 * 70) / 1080) * (Math.PI / 180));

/**
 * A mooring mast, the kind every small landing has — tall because it has to be
 * seen from the water, which is exactly the problem.
 */
export function flagMast(h = 13, colour = 0xb8452f): { timber: THREE.BufferGeometry; flag: THREE.BufferGeometry; colour: number } {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.1, 0.19, h, 7);
  pole.translate(0, h / 2, 0);
  parts.push(pole);
  // Three stays, which is what stops a mast this thin from being silly.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(strut([0, h * 0.62, 0], [Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6], 0.045));
  }
  // A crossarm near the top, so the silhouette is not a bare line.
  const arm = box(2.2, 0.12, 0.12);
  arm.translate(0, h * 0.84, 0);
  parts.push(arm);

  const flag = box(1.5, 0.9, 0.05);
  flag.translate(0.85, h * 0.92, 0);
  return { timber: merge(parts), flag, colour };
}

/**
 * A bleached dead tree. The thing that stands over a hot spring, a cave mouth
 * or a sinkhole, because something killed it there and nothing took it away.
 */
export function snag(h = 13, seed = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = (i: number) => {
    const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const trunk = new THREE.CylinderGeometry(0.22, 0.62, h, 7);
  trunk.translate(0, h / 2, 0);
  // A lean, so it never reads as a post.
  trunk.rotateZ((rand(1) - 0.5) * 0.22);
  parts.push(trunk);
  // Broken limbs, shorter as they go up.
  for (let i = 0; i < 5; i++) {
    const at = h * (0.45 + 0.1 * i);
    const a = rand(i * 3) * Math.PI * 2;
    const len = 3.4 * (1 - i * 0.14);
    parts.push(
      strut(
        [0, at, 0],
        [Math.cos(a) * len, at + len * (0.35 + rand(i * 5) * 0.5), Math.sin(a) * len],
        0.17 - i * 0.02
      )
    );
  }
  return merge(parts);
}

/**
 * A mine headframe — the winding tower over a shaft.
 *
 * The single best example of the principle: an adit with one of these is not
 * merely more visible, it is more legible. A dark hole in a hillside could be
 * anything. A headframe says MINE from three kilometres away.
 */
export function headframe(h = 16): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const foot = 3.1;
  // Four legs, battered inward, braced.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    parts.push(strut([sx * foot, 0, sz * foot], [sx * 0.9, h, sz * 0.9], 0.2));
  }
  for (const y of [h * 0.34, h * 0.64]) {
    const t = 1 - y / h;
    const r = 0.9 + (foot - 0.9) * t;
    for (const [ax, az, bx, bz] of [
      [-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1],
    ] as [number, number, number, number][]) {
      parts.push(strut([ax * r, y, az * r], [bx * r, y, bz * r], 0.1));
    }
  }
  // The sheave wheel at the top, and the back-leg that takes the haul.
  const wheel = new THREE.TorusGeometry(1.5, 0.22, 6, 14);
  wheel.rotateY(Math.PI / 2);
  wheel.translate(0, h + 0.6, 0);
  parts.push(wheel);
  const cap = box(2.6, 0.3, 2.6);
  cap.translate(0, h, 0);
  parts.push(cap);
  parts.push(strut([0, h, 0], [0, 1.2, -8.5], 0.16));
  return merge(parts);
}

/**
 * A timber water tower, which is what a steading or a hamlet has on it, and
 * the thing you actually see first when you come over a rise.
 */
export function waterTower(h = 14): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const foot = 2.3;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    parts.push(strut([sx * foot, 0, sz * foot], [sx * 1.5, h - 3.4, sz * 1.5], 0.17));
  }
  for (const y of [h * 0.3, h * 0.58]) {
    const t = 1 - y / (h - 3.4);
    const r = 1.5 + (foot - 1.5) * t;
    parts.push(strut([-r, y, -r], [r, y, r], 0.075));
    parts.push(strut([r, y, -r], [-r, y, r], 0.075));
  }
  const tank = new THREE.CylinderGeometry(2.5, 2.5, 3.4, 10);
  tank.translate(0, h - 1.7, 0);
  parts.push(tank);
  const lid = new THREE.ConeGeometry(2.7, 1.3, 10);
  lid.translate(0, h + 0.6, 0);
  parts.push(lid);
  return merge(parts);
}

/** A windbreak poplar. Orchards really are planted behind rows of these. */
export function poplar(h = 16, seed = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = Math.abs(Math.sin(seed * 91.3) * 1000) % 1;
  const trunk = new THREE.CylinderGeometry(0.16, 0.42, h, 6);
  trunk.translate(0, h / 2, 0);
  parts.push(trunk);
  // Tall and narrow, which is the whole silhouette of a poplar.
  const crown = new THREE.ConeGeometry(1.5 + rand * 0.3, h * 0.82, 7);
  crown.translate(0, h * 0.58, 0);
  parts.push(crown);
  return merge(parts);
}
