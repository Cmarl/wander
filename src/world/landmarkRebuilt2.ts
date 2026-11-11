import * as THREE from "three";
import { box, merge, rock, span, stand, strut, type Layer } from "./geom";
import { flagMast, poplar, snag } from "./beacons";
import { knap, mesh } from "./landmarkRebuilt";
import { STRIP_HALF_L, STRIP_TOP } from "./landmarks";

/**
 * The rest of them.
 *
 * Clyde, asked which of the twelve unrebuilt landmarks to do next: "you call
 * it, fix them all."
 *
 * Five are new from the ground up — the mast, the lone tree, the abandoned
 * truck, the sinkhole, the orchard, the frozen lake and the windpump — and
 * five keep the structure something else depends on (a deck you stand on, a
 * tunnel you walk into, a jetty, a runway, a room) and gain everything round
 * it that makes a structure into a place.
 *
 * Every layer here says how it meets the ground and whether it is solid,
 * rather than relying on the table in landmarkFit, because that table goes by
 * a layer's position in the list and these lists are new.
 */

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
  g.translate(x, y, z);
  return g;
};
/** Several pieces that are one object: they meet the ground together. */
const one = (parts: THREE.BufferGeometry[]) => {
  const g = merge(parts);
  g.userData.parts = [[0, g.getAttribute("position").count]];
  return g;
};
/** A tapering limb between two points. */
function limb(a: [number, number, number], b: [number, number, number], r0: number, r1: number, sides = 6): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}
const stone = (w: number, h: number, d: number, seed: number, amount = 0.3) =>
  knap(new THREE.BoxGeometry(w, h, d, 2, 2, 2).toNonIndexed(), seed, amount);
/** An up-facing fan from the origin through a loop of points. */
function fan(pts: [number, number][], y: number): THREE.BufferGeometry {
  const v: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    v.push(0, y, 0, q[0], y, q[1], p[0], y, p[1]);
  }
  return mesh(v);
}

// --- the radio mast ----------------------------------------------------------

/**
 * A lattice mast, painted the way they are painted.
 *
 * It was one four-sided spike with square collars on it. A mast is air: four
 * legs, a ladder of horizontals and a zigzag of bracing, in bands of white
 * and orange so aircraft can see it, with dishes and panel aerials hung off
 * it, a hut at the foot and guy wires out to anchors that each sit on their
 * own ground.
 */
export function mast(): Layer[] {
  const white: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const lamp: THREE.BufferGeometry[] = [];
  const H = 52, STEP = 4;
  const w = (y: number) => 2.4 - 1.9 * (y / H);
  const c4: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < H / STEP; i++) {
    const y0 = i * STEP, y1 = y0 + STEP, w0 = w(y0), w1 = w(y1);
    const into = Math.floor(i / 2) % 2 ? red : white;
    for (let k = 0; k < 4; k++) {
      const a = c4[k], b = c4[(k + 1) % 4];
      into.push(strut([a[0] * w0, y0, a[1] * w0], [a[0] * w1, y1, a[1] * w1], 0.11));
      into.push(strut([a[0] * w1, y1, a[1] * w1], [b[0] * w1, y1, b[1] * w1], 0.055));
      const flip = (i + k) % 2 === 0;
      into.push(strut(
        [(flip ? a : b)[0] * w0, y0, (flip ? a : b)[1] * w0],
        [(flip ? b : a)[0] * w1, y1, (flip ? b : a)[1] * w1], 0.045));
    }
  }
  // Two working platforms with rails, and the ladder between them.
  for (const y of [24, 40]) {
    const r = w(y) + 0.9;
    steel.push(at(box(r * 2, 0.1, r * 2), 0, y, 0));
    for (const [sx, sz] of c4) steel.push(at(box(0.06, 1.05, 0.06), sx * r, y + 0.55, sz * r));
    for (const s of [-1, 1]) {
      steel.push(at(box(r * 2, 0.05, 0.05), 0, y + 1.05, s * r));
      steel.push(at(box(0.05, 0.05, r * 2), s * r, y + 1.05, 0));
    }
  }
  for (const sx of [-0.2, 0.2]) steel.push(strut([sx, 0.3, w(0) * 0.55], [sx, 40, w(40) * 0.55], 0.03, 3));
  for (let y = 0.6; y < 40; y += 0.6) steel.push(at(box(0.4, 0.03, 0.03), 0, y, w(0) * 0.55 + (w(40) - w(0)) * 0.55 * (y / 40)));
  // Dishes: a drum, a rim and a feed, each looking its own way.
  for (const [y, r, a] of [[26.5, 1.5, 0.3], [31, 1.1, 2.6], [37, 0.9, 4.4]] as [number, number, number][]) {
    const drum = new THREE.CylinderGeometry(r, r * 0.72, 0.55, 12);
    drum.rotateZ(Math.PI / 2);
    const g = merge([drum, at(new THREE.ConeGeometry(0.16, 0.9, 5).rotateZ(-Math.PI / 2), 0.7, 0, 0)]);
    g.translate(w(y) + 0.75, y, 0);
    g.rotateY(a);
    steel.push(g);
    const back = at(box(0.5, 0.3, 0.3), w(y) + 0.3, y, 0);
    back.rotateY(a);
    dark.push(back);
  }
  // Panel aerials near the top, and whips above it.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const y = 44 + (i % 2) * 3;
    const pnl = at(box(0.16, 2.3, 0.42), w(y) + 0.5, y, 0);
    pnl.rotateY(a);
    white.push(pnl);
  }
  for (const [x, z, h] of [[0, 0, 7], [0.4, 0.3, 4.2], [-0.4, -0.2, 5.2]] as [number, number, number][]) {
    steel.push(at(new THREE.CylinderGeometry(0.03, 0.05, h, 4), x, H + h / 2, z));
  }
  lamp.push(at(new THREE.IcosahedronGeometry(0.6, 0), 0, H + 0.7, 0));
  for (const s of [-1, 1]) lamp.push(at(new THREE.IcosahedronGeometry(0.32, 0), s * (w(28) + 0.2), 28, s * (w(28) + 0.2)));

  // Guys: two levels to three anchors, each wire hung between the mast and
  // the ground its anchor is actually on.
  const guys: THREE.BufferGeometry[] = [];
  const blocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ax = Math.cos(a) * 15, az = Math.sin(a) * 15;
    for (const [y, f] of [[H * 0.58, 1], [H * 0.9, 0.72]] as [number, number][]) {
      const wire = strut([0, y, 0], [ax * f, 0.5, az * f], 0.05, 3);
      guys.push(span(wire, 0, 0, ax * f, az * f, (x, _y, z) => Math.hypot(x, z) / (15 * f)));
    }
    blocks.push(at(stone(1.5, 1.2, 1.5, i, 0.12), ax, 0.2, az));
    blocks.push(at(stone(1.2, 1.0, 1.2, i + 5, 0.12), ax * 0.72, 0.2, az * 0.72));
  }
  // The hut, its door, a vent, and the cable tray running to the mast.
  const hut = one([
    at(box(3.4, 2.5, 2.6), 5.2, 1.25, -4.4),
    at(box(3.8, 0.2, 3.0), 5.2, 2.6, -4.4),
    at(box(1.1, 0.9, 0.7), 7.3, 0.45, -4.4),
  ]);
  dark.push(at(box(0.9, 1.9, 0.1), 5.2, 0.95, -3.07));
  steel.push(strut([4, 2.2, -3.4], [1.6, 2.2, -1.2], 0.08, 4));

  return [
    { geo: merge(white), colour: 0xe2e4e6, fit: { foot: 9 }, solid: true },
    { geo: merge(red), colour: 0xcf4a2c, fit: { foot: 9 }, solid: true },
    { geo: merge(steel), colour: 0x7d848b, fit: "rigid", solid: false },
    { geo: merge(guys), colour: 0x5c6369, solid: false },
    { geo: merge(blocks), colour: 0x8d8a82, fit: "scatter", solid: true },
    { geo: hut, colour: 0xa8a294, fit: "scatter", solid: true },
    { geo: merge(dark), colour: 0x2e3236, fit: "rigid", solid: false },
    { geo: merge(lamp), colour: 0xff5a46, unlit: true },
  ];
}

// --- the lone tree -----------------------------------------------------------

/**
 * One very old tree.
 *
 * A cone for a trunk and five balls for a crown is a tree in a diagram. This
 * one has a trunk that bends, roots that grip, boughs that fork, and a crown
 * built of many masses in two greens so it has an inside. Three of them: in
 * full leaf with a swing hung from the low bough; bent hard over by a wind
 * that never stops; and dead, bleached, with its limbs on the ground.
 */
export function loneTree(): Layer[] {
  const path: [number, number, number][] = [];
  for (let i = 0; i <= 5; i++) path.push([Math.sin(i * 0.9) * 0.55, i * 2.5, Math.cos(i * 1.3) * 0.35 - 0.35]);
  const radius = (i: number) => 1.75 - i * 0.2;
  const trunk: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) trunk.push(knap(limb(path[i], path[i + 1], radius(i), radius(i + 1), 8).toNonIndexed(), i + 3, 0.1));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    trunk.push(limb([Math.cos(a) * 0.7, 1.6, Math.sin(a) * 0.7], [Math.cos(a) * (3 + (i % 3) * 0.6), -0.3, Math.sin(a) * (3 + (i % 3) * 0.6)], 0.5, 0.14, 5));
  }
  // A burl and a hollow, because nothing this old is smooth.
  trunk.push(at(knap(new THREE.IcosahedronGeometry(0.75, 0), 9, 0.12), 1.3, 4.2, 0.6));
  const top = path[5];
  const ends: { p: [number, number, number]; r: number }[] = [];
  const boughs: THREE.BufferGeometry[] = [];
  const BOUGHS: [number, number, number, number][] = [
    // from-height, bearing, reach, rise
    [8.2, 0.4, 7.4, 3.6], [9.4, 2.2, 6.6, 5.0], [10.6, 3.9, 6.9, 4.2],
    [11.6, 5.3, 5.4, 5.6], [12.5, 1.2, 3.6, 6.4], [7.2, 4.6, 5.6, 1.6],
  ];
  for (const [y, a, reach, rise] of BOUGHS) {
    const from: [number, number, number] = [Math.sin(y * 0.36) * 0.5, y, -0.3];
    const mid: [number, number, number] = [Math.cos(a) * reach * 0.55, y + rise * 0.45, Math.sin(a) * reach * 0.55];
    const end: [number, number, number] = [Math.cos(a + 0.25) * reach, y + rise, Math.sin(a + 0.25) * reach];
    boughs.push(limb(from, mid, 0.55, 0.36, 6), limb(mid, end, 0.36, 0.14, 5));
    const fork: [number, number, number] = [Math.cos(a - 0.7) * reach * 0.8, y + rise * 0.8, Math.sin(a - 0.7) * reach * 0.8];
    boughs.push(limb(mid, fork, 0.26, 0.1, 5));
    ends.push({ p: end, r: 3.3 }, { p: fork, r: 2.6 });
  }
  ends.push({ p: [top[0], top[1] + 3.6, top[2]], r: 4.4 }, { p: [top[0] + 1.5, top[1] + 0.8, top[2] - 1], r: 3.4 });
  const leafA: THREE.BufferGeometry[] = [];
  const leafB: THREE.BufferGeometry[] = [];
  ends.forEach((e, i) => {
    const g = knap(new THREE.IcosahedronGeometry(e.r, 0), i + 20, e.r * 0.09);
    g.scale(1.12, 0.72, 1.12);
    g.rotateY(i * 1.1);
    (i % 3 === 1 ? leafB : leafA).push(at(g, e.p[0], e.p[1] + 0.4, e.p[2]));
  });
  // The wind-bent one: everything above the first bough leans the same way.
  const lean = (g: THREE.BufferGeometry) => {
    const c = g.clone();
    const p = c.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > 5) {
        const k = y - 5;
        p.setX(i, p.getX(i) * 1.18 + k * 0.62);
        p.setY(i, 5 + k * 0.74);
      }
    }
    c.computeVertexNormals();
    return c;
  };
  const wood = merge([...trunk, ...boughs]);
  // The dead one keeps its bones and drops the rest.
  const litter: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.4 + 0.5, r = 4 + i * 1.3;
    const l = limb([0, 0, 0], [2.6 + (i % 3), 0.3, 0], 0.28, 0.1, 5);
    l.rotateY(a * 2);
    litter.push(at(l, Math.cos(a) * r, 0.25, Math.sin(a) * r));
  }
  // Somebody hung a swing here once. And left a bench, because you sit a while.
  const low = BOUGHS[5];
  const sx = Math.cos(low[1]) * low[2] * 0.42, sz = Math.sin(low[1]) * low[2] * 0.42, sy = low[0] + low[3] * 0.34;
  const swing = merge([
    strut([sx - 0.35, sy, sz], [sx - 0.35, 0.95, sz], 0.025, 3),
    strut([sx + 0.35, sy, sz], [sx + 0.35, 0.95, sz], 0.025, 3),
    at(box(0.9, 0.06, 0.28), sx, 0.92, sz),
  ]);
  const bench = one([
    at(box(2.1, 0.1, 0.5), 3.6, 0.55, 3.4),
    at(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6), 2.8, 0.25, 3.4),
    at(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6), 4.4, 0.25, 3.4),
  ]);
  return [
    { geo: wood, colour: 0x6b543c, on: [0], fit: { foot: 2.5 }, solid: true },
    { geo: merge(leafA), colour: 0x4a5b36, on: [0], fit: "rigid", solid: false },
    { geo: merge(leafB), colour: 0x5d6e3c, on: [0], fit: "rigid", solid: false },
    { geo: lean(wood), colour: 0x6b543c, on: [1], fit: { foot: 2.5 }, solid: true },
    { geo: lean(merge(leafA)), colour: 0x55633c, on: [1], fit: "rigid", solid: false },
    { geo: lean(merge(leafB)), colour: 0x66733f, on: [1], fit: "rigid", solid: false },
    { geo: wood.clone(), colour: 0xa49a86, on: [2], fit: { foot: 2.5 }, solid: true },
    { geo: merge(litter), colour: 0x9a907c, on: [2], fit: "scatter", solid: false },
    { geo: swing, colour: 0x5a4a38, on: [0], fit: "rigid", solid: false },
    { geo: bench, colour: 0x7a6248, on: [0, 1], fit: "scatter", solid: false },
  ];
}

// --- the abandoned truck -----------------------------------------------------

/**
 * A truck nobody came back for.
 *
 * Three ends for it: sat on its springs with the bonnet up and a tree coming
 * through the bed; rolled onto its side; and burnt out to the shell. And
 * what was in it, which is the part that makes it somebody's: crates, a
 * drum, a case that burst.
 */
export function wreck(): Layer[] {
  const rust: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  // Chassis and bed.
  rust.push(at(box(1.5, 0.22, 4.5), 0, 0.72, 0));
  rust.push(at(box(1.95, 0.12, 2.1), 0, 0.98, -1.25));
  for (const s of [-1, 1]) {
    rust.push(at(box(0.07, 0.55, 2.1), s * 0.95, 1.3, -1.25));
    // Stake sides, two of the stakes gone.
    for (let k = 0; k < 4; k++) if (!(s > 0 && k === 2)) rust.push(at(box(0.07, 0.5, 0.07), s * 0.95, 1.8, -2.15 + k * 0.6));
  }
  rust.push(at(box(1.95, 0.55, 0.07), 0, 1.3, -2.3));
  // Cab: floor, back, roof on pillars, one door hanging open.
  rust.push(at(box(1.85, 0.75, 1.45), 0, 1.25, 0.6));
  rust.push(at(box(1.85, 0.75, 0.08), 0, 2.0, -0.1));
  rust.push(at(box(1.9, 0.09, 1.5), 0, 2.42, 0.6));
  for (const s of [-1, 1]) for (const z of [-0.1, 1.28]) rust.push(at(box(0.09, 0.8, 0.09), s * 0.88, 2.0, z));
  const door = at(box(0.07, 0.72, 1.2), 0, 0, 0.6);
  door.rotateY(-0.95);
  rust.push(at(door, -1.02, 1.3, 0.75));
  // Wings, radiator, and the bonnet propped as far open as it goes.
  rust.push(at(box(1.3, 0.55, 1.2), 0, 1.15, 1.85));
  for (const s of [-1, 1]) rust.push(at(box(0.4, 0.3, 1.35), s * 0.82, 1.0, 1.85));
  dark.push(at(box(1.1, 0.5, 0.08), 0, 1.15, 2.47));
  const bonnet = box(1.3, 0.06, 1.2);
  bonnet.rotateX(-0.95);
  rust.push(at(bonnet, 0, 1.85, 1.45));
  dark.push(at(box(0.9, 0.3, 0.8), 0, 1.3, 1.85));
  for (const s of [-1, 1]) dark.push(at(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8).rotateX(Math.PI / 2), s * 0.6, 1.2, 2.48));
  rust.push(at(box(1.95, 0.14, 0.12), 0, 0.72, 2.5));
  // Three wheels on, one off with the axle down on a rock.
  for (const [x, z] of [[-0.98, 1.75], [0.98, 1.75], [0.98, -1.3]] as [number, number][]) {
    dark.push(at(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 10).rotateZ(Math.PI / 2), x, 0.5, z));
    rust.push(at(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 6).rotateZ(Math.PI / 2), x, 0.5, z));
  }
  dark.push(at(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 8).rotateX(0.9), 0.25, 2.05, 0.95));
  dark.push(at(box(1.5, 0.5, 0.45), 0, 1.55, 0.25));
  glass.push(at(box(0.9, 0.5, 0.05).rotateX(-0.2), -0.42, 1.98, 1.3));
  const upright = (g: THREE.BufferGeometry) => { const c = g.clone(); c.rotateZ(0.1); c.rotateX(-0.03); return c; };
  const onSide = (g: THREE.BufferGeometry) => { const c = g.clone(); c.rotateZ(1.42); c.rotateY(0.3); c.translate(0.4, 0.55, 0); return c; };
  const R = one(rust), D = one(dark), G = one(glass);
  const shell = one([...rust.map((g) => g.clone()), ...dark.map((g) => g.clone())]);

  const cargo: THREE.BufferGeometry[] = [];
  const loose = at(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 10), -2.4, 0.17, -1.6);
  const prop = at(rock(0.5, 0.7, 4), -0.98, 0.3, -1.3);
  for (const [x, z, s, r] of [[2.2, -0.6, 0.6, 0.3], [2.7, 0.3, 0.5, 1.1], [1.9, 1.5, 0.45, 0.7], [-2.6, 1.4, 0.55, 0.2]] as [number, number, number, number][]) {
    cargo.push(at(box(s, s, s * 1.2).rotateY(r), x, s / 2, z));
  }
  cargo.push(at(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 9).rotateZ(Math.PI / 2).rotateY(0.6), 3.3, 0.3, -1.6));
  cargo.push(at(box(0.7, 0.2, 0.45).rotateY(0.4), -3.1, 0.1, 0.2), at(box(0.7, 0.05, 0.45).rotateY(0.9).rotateZ(0.5), -3.4, 0.2, 0.75));

  // What has grown since. A birch through the bed, and grass round the wheels.
  const green: THREE.BufferGeometry[] = [];
  const sap = one([
    limb([0.2, 0.9, -1.3], [0.5, 4.6, -1.5], 0.09, 0.04, 5),
    at(knap(new THREE.IcosahedronGeometry(1.0, 0), 3, 0.12).scale(1, 1.3, 1), 0.5, 4.6, -1.5),
    at(knap(new THREE.IcosahedronGeometry(0.7, 0), 4, 0.1), 0.1, 3.5, -1.0),
  ]);
  for (let i = 0; i < 12; i++) {
    const a = i * 0.9, r = 1.4 + (i % 4) * 0.5;
    green.push(at(new THREE.ConeGeometry(0.16, 0.7 + (i % 3) * 0.25, 4), Math.cos(a) * r, 0.3, Math.sin(a) * r * 1.6));
  }

  // The line it was following: one pole still up and leaning, one down, and
  // the wire between them on the ground.
  const pole = (lean: number) => merge([
    at(new THREE.CylinderGeometry(0.15, 0.25, 12.5, 6), 0, 6.25, 0).rotateZ(lean),
    at(box(3.0, 0.15, 0.15), 0, 11.2, 0).rotateZ(lean),
    ...[-1.2, 0, 1.2].map((dx) => at(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 5), dx, 11.5, 0).rotateZ(lean)),
  ]);
  const standing = stand(at(pole(0.14), 7.2, 0, -4.6), 7.2, -4.6);
  const down = at(pole(1.5), -9, 0.3, -7);
  const wire = span(strut([5.9, 10.8, -4.6], [-2, 0.4, -6], 0.03, 3), 7.2, -4.6, -2, -6, (x) => (7.2 - x) / 9.2);

  return [
    { geo: upright(R), colour: 0x8a5a3e, on: [0], fit: "scatter", solid: true },
    { geo: upright(D), colour: 0x34322f, on: [0], fit: "scatter", solid: true },
    { geo: upright(G), colour: 0x7f8f88, on: [0], fit: "scatter", solid: false },
    { geo: onSide(R), colour: 0x80563c, on: [1], fit: "scatter", solid: true },
    { geo: onSide(D), colour: 0x34322f, on: [1], fit: "scatter", solid: true },
    { geo: upright(shell), colour: 0x2b2622, on: [2], fit: "scatter", solid: true },
    { geo: merge([loose, prop, ...cargo]), colour: 0x7a6a50, on: [0, 1], fit: "scatter", solid: false },
    { geo: merge([sap, ...green]), colour: 0x5f7a44, fit: "scatter", solid: false },
    { geo: merge([standing, wire]), colour: 0x6b5b48, solid: true },
    { geo: down, colour: 0x6b5b48, fit: "scatter", solid: false },
  ];
}

// --- the windpump ------------------------------------------------------------

/**
 * A windpump over a stock tank.
 *
 * The wheel faces -z and is spun about its own axle by the renderer, which
 * places it at SAIL_HUB — so the hub height and offset here are not free.
 */
export function windpump(): Layer[] {
  const tower: THREE.BufferGeometry[] = [];
  const blades: THREE.BufferGeometry[] = [];
  const H = 11.5;
  const c4: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const half = (y: number) => 2.0 - 1.56 * (y / H);
  for (const [sx, sz] of c4) tower.push(strut([sx * half(0), 0, sz * half(0)], [sx * half(H), H, sz * half(H)], 0.1, 4));
  for (let i = 0; i < 4; i++) {
    const y0 = i * 2.75, y1 = y0 + 2.75;
    for (let k = 0; k < 4; k++) {
      const a = c4[k], b = c4[(k + 1) % 4];
      tower.push(strut([a[0] * half(y1), y1, a[1] * half(y1)], [b[0] * half(y1), y1, b[1] * half(y1)], 0.055));
      tower.push(strut([a[0] * half(y0), y0, a[1] * half(y0)], [b[0] * half(y1), y1, b[1] * half(y1)], 0.04));
      tower.push(strut([b[0] * half(y0), y0, b[1] * half(y0)], [a[0] * half(y1), y1, a[1] * half(y1)], 0.04));
    }
  }
  // Platform under the head, the ladder to it, and the rod that does the work.
  tower.push(at(box(1.9, 0.07, 1.9), 0, H - 1.5, 0));
  for (const sx of [-0.18, 0.18]) tower.push(strut([sx, 0.2, half(0)], [sx, H - 1.5, half(H - 1.5)], 0.03, 3));
  for (let y = 0.5; y < H - 1.5; y += 0.45) tower.push(at(box(0.36, 0.03, 0.03), 0, y, half(y)));
  tower.push(at(new THREE.CylinderGeometry(0.04, 0.04, H, 4), 0, H / 2, 0));
  // Gearbox, boom and a proper tail: a tapered fin, not a plank.
  tower.push(at(box(0.5, 0.6, 1.1), 0, H + 0.1, -0.2));
  tower.push(at(box(0.1, 0.1, 3.6), 0, H + 0.2, 2.0));
  tower.push(mesh([
    0.03, H + 0.2, 2.6, 0.03, H + 1.25, 4.6, 0.03, H - 0.85, 4.6,
    -0.03, H + 0.2, 2.6, -0.03, H - 0.85, 4.6, -0.03, H + 1.25, 4.6,
  ]));
  // The pump at the foot, and the pipe over to the tank.
  tower.push(at(box(0.5, 0.9, 0.5), 0, 0.45, 0), strut([0.2, 0.75, 0.1], [3.5, 1.05, 1.2], 0.07, 5));

  // The wheel: eighteen dished vanes between two rings, on spokes.
  blades.push(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 8).rotateX(Math.PI / 2));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const vane = mesh([
      -0.16, 1.15, 0, 0.16, 1.15, 0, 0.42, 3.2, 0.1, -0.16, 1.15, 0, 0.42, 3.2, 0.1, -0.42, 3.2, -0.1,
      0.16, 1.15, 0, -0.16, 1.15, 0, 0.42, 3.2, 0.1, 0.42, 3.2, 0.1, -0.16, 1.15, 0, -0.42, 3.2, -0.1,
    ]);
    vane.rotateZ(a);
    blades.push(vane);
    if (i % 3 === 0) blades.push(strut([0, 0, 0], [Math.sin(a) * -3.2, Math.cos(a) * 3.2, 0], 0.035, 3));
  }
  blades.push(new THREE.TorusGeometry(3.22, 0.06, 4, 24), new THREE.TorusGeometry(1.2, 0.05, 4, 16));

  // The tank: steel ring, water to the brim, a float, and a trough it feeds.
  const tx = 5.5, tz = 1.5;
  const tank = one([
    at(new THREE.CylinderGeometry(2.25, 2.25, 1.35, 16), tx, 0.5, tz),
    at(new THREE.TorusGeometry(2.25, 0.07, 4, 16).rotateX(Math.PI / 2), tx, 1.19, tz),
    ...[0, 1, 2, 3, 4, 5].map((i) => at(box(0.07, 1.35, 0.07), tx + Math.cos(i * 1.05) * 2.3, 0.5, tz + Math.sin(i * 1.05) * 2.3)),
    at(box(2.6, 0.5, 0.7), tx + 0.4, 0.25, tz + 3.5),
  ]);
  const water = stand(merge([
    at(new THREE.CircleGeometry(2.15, 16).rotateX(-Math.PI / 2), tx, 1.2, tz),
    at(box(2.4, 0.04, 0.5), tx + 0.4, 0.49, tz + 3.5),
  ]), tx, tz + 1.4);
  // What is left of the fence that kept stock off it.
  const fence: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 4) continue;
    const a = (i / 9) * Math.PI * 2;
    const x = tx + Math.cos(a) * 5.4, z = tz + 1 + Math.sin(a) * 5.4;
    const a2 = ((i + 1) / 9) * Math.PI * 2;
    const x2 = tx + Math.cos(a2) * 5.4, z2 = tz + 1 + Math.sin(a2) * 5.4;
    fence.push(one([
      at(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 5).rotateZ((i % 3 - 1) * 0.12), x, 0.7, z),
      ...(i % 4 === 2 ? [] : [strut([x, 1.2, z], [x2, 1.15, z2], 0.035, 3), strut([x, 0.7, z], [x2, 0.68, z2], 0.035, 3)]),
    ]));
  }
  return [
    { geo: merge(tower), colour: 0x767c82, fit: { foot: 6 }, solid: true },
    { geo: merge(blades), colour: 0xa3a9af, spin: 1, fit: "rigid", solid: false },
    { geo: tank, colour: 0x6c7a62, fit: "scatter", solid: true },
    { geo: water, colour: 0x4f8fa3, solid: false },
    { geo: merge(fence), colour: 0x7b6950, fit: "scatter", solid: false },
  ];
}

// --- the sinkhole ------------------------------------------------------------

/**
 * A hole with no bottom to it.
 *
 * The ground in this world cannot actually be cut — it is one function — so
 * a pit is a picture of a pit, and the old picture was a black disc with
 * boulders round it. This one has what makes a hole read as deep: a broken
 * collar of slabs tipping inward that you cannot step past, ledges below
 * them going down, and the dark draped over the real ground in three steps,
 * so the eye has a wall to follow into it. Somebody left a rope.
 */
export function sinkhole(): Layer[] {
  const R = 13;
  const collar: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const tall = i % 5 === 2;
    // Long side along the rim, tipped a little into the hole. They were
    // turned end-on and twice this size, and buried the pit they were round.
    const slab = stone(3.7 + (i % 3) * 0.5, tall ? 3.6 : 2.0 + (i % 4) * 0.3, 1.9, i + 1, 0.35);
    slab.rotateX(-0.28 - (i % 3) * 0.08);
    slab.rotateY(-a + Math.PI / 2);
    collar.push(at(slab, Math.cos(a) * (R + 0.9), tall ? 1.0 : 0.45, Math.sin(a) * (R + 0.9)));
  }
  const ledges: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r = R - 2.6 - (i % 3) * 1.5;
    const l = stone(3.6, 1.0, 2.2, i + 40, 0.3);
    l.rotateZ(0.5);
    l.rotateY(-a + Math.PI);
    ledges.push(at(l, Math.cos(a) * r, 0.35, Math.sin(a) * r));
  }
  const ring = (r0: number, r1: number, y: number) => {
    const g = r0 === 0 ? new THREE.CircleGeometry(r1, 28) : new THREE.RingGeometry(r0, r1, 28, 3);
    g.rotateX(-Math.PI / 2);
    return at(g.toNonIndexed(), 0, y, 0);
  };
  const rope = merge([
    at(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 5).rotateZ(0.2), R + 4.4, 0.6, 3),
    strut([R + 4.3, 1.1, 3], [R - 0.5, 2.6, 2.4], 0.03, 3),
    strut([R - 0.5, 2.6, 2.4], [R - 3.6, 0.5, 2], 0.03, 3),
    at(new THREE.TorusGeometry(0.3, 0.06, 4, 8).rotateX(Math.PI / 2), R + 5.2, 0.1, 3.8),
  ]);
  const sign = one([
    at(new THREE.CylinderGeometry(0.06, 0.07, 1.8, 5), -R - 5, 0.9, -2),
    at(box(1.2, 0.7, 0.06).rotateY(1.2), -R - 5, 1.55, -2),
  ]);
  const dead = snag(13, 7);
  dead.translate(0, 0, -17);
  return [
    { geo: dead, colour: 0xa49a87, fit: "block", solid: true },
    { geo: merge(collar), colour: 0x9b9384, fit: "scatter", solid: true },
    { geo: merge(ledges), colour: 0x5d584f, fit: "scatter", solid: true },
    // Draped: every vertex on the real ground, so no slope pokes through.
    { geo: ring(8.6, R + 0.4, 0.3), colour: 0x38342e, fit: { foot: 1000 }, solid: false },
    { geo: ring(5, 8.6, 0.42), colour: 0x191817, fit: { foot: 1000 }, solid: false },
    { geo: ring(0, 5, 0.5), colour: 0x050506, fit: { foot: 1000 }, solid: true },
    { geo: merge([rope, sign]), colour: 0x8a7a5e, fit: "scatter", solid: false },
  ];
}

// --- the orchard -------------------------------------------------------------

/**
 * An orchard somebody planted and somebody stopped tending.
 *
 * Thirty trees in rows, but real ones: a short trunk that forks low, the way
 * a fruit tree is pruned to, a crown in three masses, and fruit on it. A few
 * are stumps and a couple are dead where they stand. A drystone wall goes
 * round three sides, with a gateway, a picking ladder left in a tree and
 * crates nobody collected. Every tree, and every length of wall, stands on
 * its own ground.
 */
export function orchard(): Layer[] {
  const bark: THREE.BufferGeometry[] = [];
  const dead: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];
  const leaf2: THREE.BufferGeometry[] = [];
  const fruit: THREE.BufferGeometry[] = [];
  const wall: THREE.BufferGeometry[] = [];
  const kit: THREE.BufferGeometry[] = [];
  let n = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++, n++) {
      const x = (col - 2.5) * 6.2 + Math.sin(row * 7.1 + col * 3.3) * 0.9;
      const z = (row - 2) * 6.6 + Math.cos(row * 4.7 + col * 5.9) * 0.9;
      if (n % 11 === 6) {
        bark.push(stand(at(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 7), x, 0.25, z), x, z));
        continue;
      }
      const h = 1.5 + (n % 4) * 0.22;
      const wood: THREE.BufferGeometry[] = [limb([x, -0.2, z], [x + 0.1, h, z], 0.36, 0.25, 6)];
      const tips: [number, number, number][] = [];
      for (let k = 0; k < 3; k++) {
        const a = n * 1.7 + (k / 3) * Math.PI * 2;
        const tip: [number, number, number] = [x + Math.cos(a) * 1.7, h + 1.7 + (k % 2) * 0.4, z + Math.sin(a) * 1.7];
        wood.push(limb([x + 0.1, h, z], tip, 0.2, 0.08, 5));
        tips.push(tip);
      }
      if (n % 13 === 4) {
        // Dead on its feet: more twigs, no leaves.
        for (const t of tips) wood.push(limb(t, [t[0] + (t[0] - x) * 0.5, t[1] + 0.9, t[2] + (t[2] - z) * 0.5], 0.07, 0.02, 4));
        dead.push(stand(merge(wood), x, z));
        continue;
      }
      bark.push(stand(merge(wood), x, z));
      const crown: THREE.BufferGeometry[] = [];
      tips.forEach((t, k) => {
        const g = knap(new THREE.IcosahedronGeometry(1.45 + ((n + k) % 3) * 0.16, 0), n * 3 + k, 0.16);
        g.scale(1, 0.78, 1);
        g.rotateY(n + k);
        crown.push(at(g, t[0], t[1] + 0.2, t[2]));
      });
      (n % 3 === 0 ? leaf2 : leaf).push(stand(merge(crown), x, z));
      const apples: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 7; k++) {
        const a = n * 2.3 + k * 0.9, e = 0.2 + (k % 3) * 0.5;
        apples.push(at(new THREE.IcosahedronGeometry(0.15, 0), x + Math.cos(a) * 2.5 * Math.cos(e), h + 1.6 + Math.sin(e) * 1.3 - 0.5, z + Math.sin(a) * 2.5 * Math.cos(e)));
      }
      // Windfalls under about half of them.
      if (n % 2) for (let k = 0; k < 4; k++) apples.push(at(new THREE.IcosahedronGeometry(0.14, 0), x + Math.cos(k * 1.9 + n) * 1.6, 0.12, z + Math.sin(k * 1.9 + n) * 1.6));
      fruit.push(stand(merge(apples), x, z));
    }
  }
  // The wall: west, north and east, with a gateway in the east side.
  const course = (x0: number, z0: number, x1: number, z1: number, gapAt = -1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), count = Math.round(len / 1.9);
    for (let i = 0; i < count; i++) {
      if (i === gapAt || i === gapAt + 1) continue;
      const t = (i + 0.5) / count;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      // Tumbled in places: a wall nobody mends loses its top first.
      const low = (i * 7) % 9 === 4;
      const piece: THREE.BufferGeometry[] = [stone(2.0, low ? 0.55 : 1.05, 0.8, i + x0, 0.14)];
      piece[0].translate(0, low ? 0.2 : 0.45, 0);
      if (!low) piece.push(at(stone(1.9, 0.26, 0.6, i + 90, 0.1), 0, 1.08, 0));
      const g = merge(piece);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      wall.push(stand(at(g, x, 0, z), x, z));
      if (low) wall.push(stand(at(rock(0.35, 0.7, i), x + 0.9, 0.2, z + 0.8), x, z));
    }
  };
  course(-19, 16.5, -19, -17);
  course(-19, -17, 19, -17);
  course(19, -17, 19, 16.5, 8);
  // Gateposts, and the gate hanging off one hinge.
  for (const z of [-2.2, 1.2]) wall.push(stand(at(stone(0.8, 1.9, 0.8, z + 50, 0.1), 19, 0.9, z), 19, z));
  const gate = merge([at(box(0.08, 1.1, 2.6), 0, 0, 1.3), at(box(0.08, 0.08, 2.9).rotateX(0.38), 0, 0, 1.3), ...[-0.45, 0, 0.45].map((y) => at(box(0.06, 0.08, 2.6), 0, y, 1.3))]);
  gate.rotateY(-0.7);
  kit.push(stand(at(gate, 19.2, 0.75, -1.8), 19, -1.8));
  // A picking ladder left in a tree, and crates.
  const lx = (1 - 2.5) * 6.2, lz = 0;
  kit.push(stand(merge([
    strut([lx + 1.5, 0, lz + 1.9], [lx + 0.7, 3.4, lz + 0.8], 0.04, 4),
    strut([lx + 2.0, 0, lz + 1.5], [lx + 1.2, 3.4, lz + 0.4], 0.04, 4),
    ...[0.5, 1.1, 1.7, 2.3, 2.9].map((y) => strut([lx + 1.5 - y * 0.235, y, lz + 1.9 - y * 0.32], [lx + 2.0 - y * 0.235, y, lz + 1.5 - y * 0.32], 0.03, 3)),
  ]), lx + 1.6, lz + 1.6));
  for (const [x, z, r] of [[14, 12, 0.2], [14.7, 12.6, 0.9], [14.2, 12.2, 0.5], [-3, 13.5, 1.3]] as [number, number, number][]) {
    kit.push(stand(at(box(0.6, 0.38, 0.45).rotateY(r), x, r === 0.5 ? 0.57 : 0.19, z), x, z));
  }
  const windbreak: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 6.4;
    windbreak.push(stand(at(poplar(15 + (i % 3), i), x, 0, -14.2), x, -14.2));
  }
  return [
    { geo: merge(windbreak), colour: 0x3f5a38, solid: true },
    { geo: merge(bark), colour: 0x6b543c, solid: true },
    { geo: merge(dead), colour: 0x9a907c, solid: true },
    { geo: merge(leaf), colour: 0x56703a, solid: false },
    { geo: merge(leaf2), colour: 0x6a7f3c, solid: false },
    { geo: merge(fruit), colour: 0xc8452c, solid: false },
    { geo: merge(wall), colour: 0x8e8b82, solid: true },
    { geo: merge(kit), colour: 0x8a6e4e, solid: false },
  ];
}

// --- the frozen lake ---------------------------------------------------------

/**
 * A lake gone hard.
 *
 * It was a grey-blue disc with planks laid across it. Ice is not uniform:
 * snow lies on it toward the shore, it is clear and dark in the middle where
 * it is thick, there are patches where it is thin, cracks run out from where
 * it took the strain, and where two sheets met it stands up in a ridge. And
 * somebody fishes here — a hut on runners, a hole with a line in it, a sled.
 */
export function frozenLake(): Layer[] {
  const R = 34;
  const shore: [number, number][] = [];
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const r = R * (1 + 0.07 * Math.sin(a * 3 + 0.5) + 0.045 * Math.sin(a * 5 + 1.7));
    shore.push([Math.cos(a) * r, Math.sin(a) * r * 0.74]);
  }
  const scaled = (k: number) => shore.map(([x, z]) => [x * k, z * k] as [number, number]);
  // The sheet has an edge that goes down, so the rim is never a floating card.
  const skirt: number[] = [];
  for (let i = 0; i < shore.length; i++) {
    const p = shore[i], q = shore[(i + 1) % shore.length];
    skirt.push(p[0], 0.2, p[1], q[0], 0.2, q[1], q[0], -1.4, q[1], p[0], 0.2, p[1], q[0], -1.4, q[1], p[0], -1.4, p[1]);
  }
  const snowy = merge([fan(shore, 0.2), mesh(skirt)]);
  const clear = fan(scaled(0.74), 0.23);
  const thin: THREE.BufferGeometry[] = [];
  for (const [x, z, r] of [[9, -6, 5], [-13, 4, 4], [3, 10, 3.2]] as [number, number, number][]) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      pts.push([Math.cos(a) * r * (1 + 0.25 * Math.sin(i * 2.3)), Math.sin(a) * r * 0.7 * (1 + 0.2 * Math.cos(i * 1.7))]);
    }
    thin.push(at(fan(pts, 0.25), x, 0, z));
  }
  // Cracks: a main line with branches, drawn as hairlines on the surface.
  const cracks: THREE.BufferGeometry[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number, wdt = 0.14) => {
    const g = box(Math.hypot(x1 - x0, z1 - z0), 0.02, wdt);
    g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    cracks.push(at(g, (x0 + x1) / 2, 0.265, (z0 + z1) / 2));
  };
  let cx = -22, cz = -6;
  for (let i = 0; i < 9; i++) {
    const nx = cx + 5.2, nz = cz + Math.sin(i * 1.9) * 3.4 + 1;
    line(cx, cz, nx, nz, 0.2);
    if (i % 2) line(nx, nz, nx + 2.5 + i * 0.4, nz + (i % 4 === 1 ? -6 : 5.5), 0.11);
    cx = nx;
    cz = nz;
  }
  // The pressure ridge: plates on edge, along a line across the north end.
  const ridge: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const g = stone(1.5 + (i % 3) * 0.4, 0.26, 1.0 + (i % 2) * 0.35, i + 3, 0.1);
    g.rotateZ(0.5 + (i % 4) * 0.28 * (i % 2 ? 1 : -1));
    g.rotateY(0.4 + i * 0.5);
    ridge.push(at(g, -14 + i * 1.6, 0.5, -13 + Math.sin(i * 0.8) * 1.3));
  }
  // The hut, on runners, with its stovepipe; the sled; the hole.
  const hx = -6, hz = 7;
  const hut = merge([
    at(box(2.6, 2.2, 2.4), hx, 1.5, hz), at(box(0.18, 0.2, 3.0), hx - 1.0, 0.33, hz), at(box(0.18, 0.2, 3.0), hx + 1.0, 0.33, hz),
    at(box(1.8, 0.14, 0.5), hx + 3.4, 0.38, hz + 2.2), at(box(0.07, 0.1, 1.9).rotateY(1.57), hx + 3.4, 0.3, hz + 2.0),
  ]);
  const hutDark = merge([
    at(box(3.0, 0.14, 2.8).rotateZ(0.14), hx, 2.72, hz), at(box(0.8, 1.6, 0.06), hx, 1.25, hz + 1.22),
    at(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 6), hx + 0.8, 3.2, hz - 0.6),
    at(new THREE.CircleGeometry(0.55, 10).rotateX(-Math.PI / 2), hx + 3.2, 0.27, hz - 1.4),
    at(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 3).rotateZ(0.6), hx + 3.5, 0.6, hz - 1.4),
  ]);
  const snow: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 30; i++) {
    const p = shore[i];
    const g = knap(new THREE.IcosahedronGeometry(1.7 + (i % 4) * 0.45, 0), i, 0.2);
    g.scale(1.6, 0.32, 1.0);
    g.rotateY(Math.atan2(-p[1], p[0]) + Math.PI / 2);
    snow.push(at(g, p[0] * 1.03, 0.15, p[1] * 1.03));
  }
  snow.push(at(box(2.7, 0.16, 2.5).rotateZ(0.14), hx, 2.84, hz));
  // Reeds frozen in at the south shore, and the marker poles.
  const reeds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) reeds.push(at(new THREE.CylinderGeometry(0.02, 0.035, 1.2 + (i % 4) * 0.3, 3).rotateZ((i % 5 - 2) * 0.09), 8 + (i % 9) * 1.1, 0.75, 21.5 + ((i * 7) % 5) * 0.5));
  const poles: THREE.BufferGeometry[] = [];
  const pennants: THREE.BufferGeometry[] = [];
  for (const [x, z, h] of [[hx - 4, hz - 3, 11], [15, -4, 12]] as [number, number, number][]) {
    const m = flagMast(h, 0xd8532f);
    poles.push(at(m.timber, x, 0.2, z));
    pennants.push(at(m.flag, x, 0.2, z));
  }
  return [
    { geo: merge(poles), colour: 0x6f6a60, fit: "rigid", solid: true },
    { geo: merge(pennants), colour: 0xd8532f, fit: "rigid", solid: false },
    { geo: snowy, colour: 0xdfe9ee, fit: "rigid", solid: false },
    { geo: clear, colour: 0x9fc3d3, fit: "rigid", solid: false },
    { geo: merge(thin), colour: 0x6b9bb3, fit: "rigid", solid: false },
    { geo: merge(cracks), colour: 0x3f6a82, fit: "rigid", solid: false },
    { geo: merge(ridge), colour: 0xcfe2ea, fit: "rigid", solid: true },
    { geo: hut, colour: 0x8c4a34, fit: "rigid", solid: true },
    { geo: hutDark, colour: 0x2b2d30, fit: "rigid", solid: false },
    { geo: merge(snow), colour: 0xeef2f4, fit: "scatter", solid: false },
    { geo: merge(reeds), colour: 0x8a7a4e, fit: "rigid", solid: false },
  ];
}

// --- what goes round the ones that keep their structure ---------------------

/** The fire lookout: footings, a hoist, shutters, a stovepipe and a flag. */
export function lookoutExtras(): Layer[] {
  const H = 16.4;
  const feet: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) feet.push(at(stone(1.1, 1.3, 1.1, sx + sz * 3 + 5, 0.1), sx * 3.3, 0.1, sz * 3.3));
  const kit = merge([
    at(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6), 1.3, H + 3.9, -1.3),
    at(new THREE.ConeGeometry(0.2, 0.25, 6), 1.3, H + 5.1, -1.3),
    at(new THREE.CylinderGeometry(0.02, 0.02, 3, 3), 0, H + 5.4, 0),
    // The hoist: an arm off the deck, a line, and the bucket it brought water up in.
    strut([2.9, H + 2.4, 2.2], [4.6, H + 2.9, 2.2], 0.06, 4),
    strut([4.5, H + 2.85, 2.2], [4.5, 1.5, 2.2], 0.015, 3),
    at(new THREE.CylinderGeometry(0.22, 0.17, 0.36, 7), 4.5, 1.3, 2.2),
    // Brackets under the catwalk.
    ...[-1, 1].flatMap((s) => [strut([s * 2.4, H - 1.6, 2.4], [s * 2.85, H, 2.85], 0.05, 3), strut([s * 2.4, H - 1.6, -2.4], [s * 2.85, H, -2.85], 0.05, 3)]),
  ]);
  const shutters: THREE.BufferGeometry[] = [];
  for (const [ox, oz, ry] of [[0, 2.2, 0], [0, -2.2, Math.PI], [2.2, 0, Math.PI / 2], [-2.2, 0, -Math.PI / 2]] as [number, number, number][]) {
    const g = at(box(3.7, 0.06, 1.05), 0, 0, 0.5);
    g.rotateX(0.5);
    g.rotateY(ry);
    shutters.push(at(g, ox, H + 2.25, oz));
  }
  const flag = at(box(1.1, 0.7, 0.04), 0.6, H + 6.4, 0);
  // At the foot: the sign, and the woodshed for the stove up top.
  const yard = merge([
    one([at(new THREE.CylinderGeometry(0.07, 0.08, 2, 5), -5.5, 1, 4.5), at(box(1.5, 0.8, 0.07).rotateY(0.5), -5.5, 1.7, 4.5)]),
    one([at(box(2.2, 1.5, 1.3), 6, 0.75, -3.5), at(box(2.6, 0.1, 1.7).rotateZ(0.16), 6, 1.62, -3.5)]),
  ]);
  return [
    { geo: merge(feet), colour: 0x8d8a82, on: [0, 1], fit: "scatter", solid: true },
    { geo: kit, colour: 0x4a4f55, on: [0], fit: "rigid", solid: false },
    { geo: merge(shutters), colour: 0x6f7f56, on: [0], fit: "rigid", solid: false },
    { geo: flag, colour: 0xc4452f, on: [0], fit: "rigid", solid: false },
    { geo: yard, colour: 0x7b6950, fit: "scatter", solid: true },
  ];
}

/**
 * The mine: the ground it is cut into, a real spoil heap, a tipple and a shed.
 *
 * The drift runs twenty metres back from the portal, and on anything gentler
 * than a cliff its black walls stood out of the hill behind the timbers. The
 * cutting here is two flanks and a cap with nothing across the passage — a
 * block's end face would be a wall you could see from inside.
 */
export function aditExtras(): Layer[] {
  const cut: THREE.BufferGeometry[] = [];
  const put = (wd: number, h: number, d: number, x: number, y: number, z: number, seed: number, lean = 0) => {
    const g = stone(wd, h, d, seed, 0.4);
    g.rotateZ(lean);
    cut.push(at(g, x, y, z));
  };
  for (let i = 0; i < 4; i++) {
    const z = -3.6 - i * 5.6, drop = i * 0.8;
    for (const sx of [-1, 1]) put(5.4 - i * 0.4, 7.5 - drop, 6.2, sx * (5.3 - i * 0.15), 1.6 - drop * 0.4, z, i * 2 + (sx > 0 ? 1 : 0), sx * -0.08);
    put(11.5 - i * 0.7, 3.2, 6.2, Math.sin(i * 2.1) * 0.7, 5.3 - drop, z, 20 + i, 0.04 * (i % 2 ? 1 : -1));
  }
  put(13, 7, 4.5, 0, 0.8, -26.5, 30);
  put(6, 4, 3.6, -7.5, 0.6, -0.8, 31, 0.2);
  put(5.5, 3.6, 3.4, 7.6, 0.4, -1, 32, -0.22);
  // The spoil heap: a real mound, tipped from the end of the track.
  const heap = knap(new THREE.ConeGeometry(6.2, 3.4, 9, 2).toNonIndexed(), 5, 0.5);
  heap.scale(1.25, 1, 0.9);
  const spoil = merge([stand(at(heap, -8.5, 1.2, 9.5), -8.5, 9.5), ...[0, 1, 2, 3, 4, 5, 6].map((i) => at(rock(0.5 + (i % 3) * 0.3, 0.6, i + 9), -8.5 + Math.cos(i * 1.3) * 7, 0.2, 9.5 + Math.sin(i * 1.3) * 6))]);
  // The tipple at the end of the rails, and the shed.
  const timber = merge([
    one([
      ...[-1, 1].flatMap((s) => [strut([s * 1.2, 0, 11.5], [s * 0.7, 3.2, 12.2], 0.12, 4), strut([s * 1.2, 0, 13.6], [s * 0.7, 3.2, 12.9], 0.12, 4)]),
      at(box(1.9, 0.14, 2.2), 0, 3.2, 12.5),
      at(box(1.3, 0.1, 3.4).rotateX(0.6), -2.4, 2.1, 12.5).rotateY(0),
    ]),
    one([at(box(3.2, 2.3, 2.6), 8.2, 1.15, 6.5), at(box(0.9, 1.8, 0.08), 7.6, 0.9, 7.84)]),
  ]);
  const roof = one([at(box(3.7, 0.12, 3.1).rotateZ(-0.2), 8.2, 2.55, 6.5)]);
  return [
    { geo: merge(cut), colour: 0x76716a, fit: "rigid", solid: true },
    { geo: spoil, colour: 0x7e7a70, fit: "scatter", solid: true },
    { geo: timber, colour: 0x6f5a42, fit: "scatter", solid: true },
    { geo: roof, colour: 0x5a4f48, fit: "scatter", solid: false },
  ];
}

/** The landing: a net shed, a boat hauled out, drying racks and a light at the end. */
export function dockExtras(): Layer[] {
  const shed = one([at(box(3.2, 2.3, 2.8), 6.4, 1.15, 3.6), at(box(0.9, 1.8, 0.08), 6.4, 0.9, 2.18), at(box(3.7, 0.12, 3.3).rotateX(0.16), 6.4, 2.5, 3.6)]);
  const hull = new THREE.IcosahedronGeometry(1, 1);
  hull.scale(0.85, 0.55, 2.3);
  hull.rotateY(0.5);
  const boat = one([at(hull, -6.5, 0.05, 5.5), at(box(0.1, 0.14, 4.4).rotateY(0.5), -6.5, 0.62, 5.5)]);
  const rack = one([
    ...[-1.6, 1.6].map((dx) => at(new THREE.CylinderGeometry(0.06, 0.07, 2.2, 5), -3.5 + dx, 1.1, 9)),
    at(box(3.2, 0.06, 0.06), -3.5, 2.15, 9),
  ]);
  const net = one([at(box(3.0, 1.5, 0.04).rotateX(0.12), -3.5, 1.35, 9.1)]);
  const kit = merge([
    ...[[4.2, 6.3, 0], [4.8, 6.9, 0.7], [3.4, 1.2, 0.3]].map(([x, z, r]) => one([at(box(0.6, 0.5, 0.6).rotateY(r), x, 0.25, z)])),
    one([at(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 9), 5.4, 0.42, 6.0)]),
  ]);
  // On the jetty itself: a post and lamp at the end, a ladder down, a ring.
  const end = merge([
    at(new THREE.CylinderGeometry(0.06, 0.07, 3, 5), -0.85, 2.7, -59),
    at(box(0.5, 0.06, 0.06), -0.6, 4.15, -59),
    at(new THREE.TorusGeometry(0.26, 0.07, 5, 10), 0.98, 1.9, -30),
    ...[-0.22, 0.22].map((dx) => at(box(0.05, 2.2, 0.05), dx, 0.2, -60.05)),
    ...[0, 1, 2, 3, 4].map((i) => at(box(0.44, 0.04, 0.05), 0, 1.1 - i * 0.4, -60.05)),
  ]);
  const lamp = at(new THREE.IcosahedronGeometry(0.16, 0), -0.38, 4.0, -59);
  return [
    { geo: shed, colour: 0x7d6a52, fit: "scatter", solid: true },
    { geo: boat, colour: 0x5f7f8f, fit: "scatter", solid: true },
    { geo: rack, colour: 0x6b5b48, fit: "scatter", solid: false },
    { geo: net, colour: 0x4f7a72, fit: "scatter", solid: false },
    { geo: kit, colour: 0x8a6e4e, fit: "scatter", solid: false },
    { geo: end, colour: 0x4a4f55, fit: "rigid", solid: false },
    { geo: lamp, colour: 0xffe2a0, unlit: true },
  ];
}

/** The airstrip: edge lights, a radio shack and a fuel bowser on the apron. */
export function airfieldExtras(): Layer[] {
  const T = STRIP_TOP;
  const lights: THREE.BufferGeometry[] = [];
  const posts: THREE.BufferGeometry[] = [];
  for (let z = -STRIP_HALF_L + 8; z <= STRIP_HALF_L - 8; z += 16) {
    for (const s of [-1, 1]) {
      posts.push(at(box(0.08, 0.3, 0.08), s * 12.3, T + 0.15, z));
      lights.push(at(box(0.2, 0.14, 0.2), s * 12.3, T + 0.37, z));
    }
  }
  const ends: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) for (let i = -3; i <= 3; i++) ends.push(at(box(0.22, 0.14, 0.22), i * 3.2, T + 0.2, s * (STRIP_HALF_L - 1.5)));
  const shack = merge([at(box(2.8, 2.6, 2.8), 35, T + 1.3, -11.5), at(box(3.3, 0.14, 3.3), 35, T + 2.68, -11.5), at(box(0.9, 0.5, 0.9), 35.6, T + 3.0, -12)]);
  const dark = merge([
    at(box(0.06, 0.8, 1.8), 33.58, T + 1.7, -11.5), at(box(1.8, 0.8, 0.06), 35, T + 1.7, -10.08), at(box(0.8, 1.8, 0.06), 35.8, T + 0.9, -12.92),
    at(new THREE.CylinderGeometry(0.025, 0.04, 5, 3), 34.2, T + 5.2, -12.4),
    strut([34.2, T + 6.5, -12.4], [36.2, T + 2.8, -10.4], 0.012, 3),
  ]);
  const bowser = merge([
    at(new THREE.CylinderGeometry(0.75, 0.75, 2.6, 10).rotateX(Math.PI / 2), 35.5, T + 1.25, 0.2),
    ...[-0.9, 0.9].map((dz) => at(box(1.3, 0.5, 0.12), 35.5, T + 0.3, 0.2 + dz)),
    at(box(0.3, 0.9, 0.3), 34.5, T + 0.45, 1.0),
  ]);
  return [
    { geo: merge(posts), colour: 0x4a4f55, fit: "rigid", solid: false },
    { geo: merge(lights), colour: 0xffe9b0, unlit: true },
    { geo: merge(ends), colour: 0xff5a46, unlit: true },
    { geo: shack, colour: 0xb8b2a2, fit: "rigid", solid: true },
    { geo: dark, colour: 0x2b3036, fit: "rigid", solid: false },
    { geo: bowser, colour: 0xb89a3a, fit: "rigid", solid: true },
  ];
}

/**
 * The steading: a yard. A fence with a gap where the gate was, a well, a
 * chopping block by the woodpile, a patch somebody dug and a scarecrow
 * still standing in it. The building is what was already there; this is what
 * says somebody lived in it.
 */
export function steadingExtras(): Layer[] {
  const fence: THREE.BufferGeometry[] = [];
  const run = (x0: number, z0: number, x1: number, z1: number, skip: number[] = []) => {
    const count = Math.round(Math.hypot(x1 - x0, z1 - z0) / 2.6);
    for (let i = 0; i < count; i++) {
      if (skip.includes(i)) continue;
      const a = [x0 + ((x1 - x0) * i) / count, z0 + ((z1 - z0) * i) / count];
      const b = [x0 + ((x1 - x0) * (i + 1)) / count, z0 + ((z1 - z0) * (i + 1)) / count];
      const broken = (i * 5 + Math.round(x0)) % 7 === 3;
      fence.push(one([
        at(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 5).rotateZ(broken ? 0.3 : 0.03), a[0], 0.6, a[1]),
        strut([a[0], 1.05, a[1]], [b[0], broken ? 0.2 : 1.05, b[1]], 0.035, 3),
        ...(broken ? [] : [strut([a[0], 0.6, a[1]], [b[0], 0.6, b[1]], 0.035, 3)]),
      ]));
    }
  };
  run(-13, -11.5, 14, -11.5);
  run(14, -11.5, 14, 11);
  run(14, 11, -13, 11, [4, 5]);
  run(-13, 11, -13, -11.5, [3]);
  const well = one([
    at(new THREE.CylinderGeometry(1.0, 1.1, 0.95, 10), -9, 0.4, 6.5),
    ...[-0.9, 0.9].map((dx) => at(box(0.12, 2.2, 0.12), -9 + dx, 1.5, 6.5)),
    at(box(2.3, 0.1, 1.3).rotateX(0.3), -9, 2.6, 6.2), at(box(2.3, 0.1, 1.3).rotateX(-0.3), -9, 2.6, 6.8),
    at(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6).rotateZ(Math.PI / 2), -9, 2.1, 6.5),
    at(new THREE.CylinderGeometry(0.16, 0.13, 0.28, 7), -9, 1.15, 6.5),
  ]);
  const wellDark = stand(at(new THREE.CircleGeometry(0.85, 10).rotateX(-Math.PI / 2), -9, 0.89, 6.5), -9, 6.5);
  const yard = merge([
    one([at(new THREE.CylinderGeometry(0.4, 0.45, 0.6, 8), 9.5, 0.3, 6), at(box(0.06, 0.7, 0.06).rotateZ(0.7), 9.7, 0.85, 6), at(box(0.3, 0.2, 0.05), 9.45, 0.72, 6)]),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => one([at(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 6).rotateX(Math.PI / 2), 11 + (i % 4) * 0.28 - (i > 3 ? 0.14 : 0), 0.13 + (i > 3 ? 0.25 : 0), 6.3)])),
  ]);
  // The patch: four rows, something still coming up in two of them.
  const soil: THREE.BufferGeometry[] = [];
  const crop: THREE.BufferGeometry[] = [];
  for (let r = 0; r < 4; r++) {
    const z = -8.6 + r * 1.2;
    soil.push(at(new THREE.BoxGeometry(5.4, 0.22, 0.7, 6, 1, 1).toNonIndexed(), -8.5, 0.1, z));
    if (r % 2 === 0) for (let k = 0; k < 7; k++) crop.push(stand(at(new THREE.ConeGeometry(0.2, 0.5, 4), -10.9 + k * 0.8, 0.45, z), -10.9 + k * 0.8, z));
  }
  const crow = one([
    at(box(0.08, 2.1, 0.08), -5.4, 1.05, -7), at(box(1.5, 0.07, 0.07), -5.4, 1.6, -7),
    at(box(0.5, 0.75, 0.2), -5.4, 1.45, -7), at(new THREE.IcosahedronGeometry(0.2, 0), -5.4, 2.05, -7),
    at(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 8), -5.4, 2.22, -7), at(new THREE.CylinderGeometry(0.17, 0.19, 0.22, 8), -5.4, 2.34, -7),
  ]);
  return [
    { geo: merge(fence), colour: 0x7b6950, fit: "scatter", solid: false },
    { geo: well, colour: 0x8e8b82, fit: "scatter", solid: true },
    { geo: wellDark, colour: 0x0c0d10, solid: false },
    { geo: yard, colour: 0x7a6248, fit: "scatter", solid: false },
    { geo: merge(soil), colour: 0x4f4034, fit: { foot: 1000 }, solid: false },
    { geo: merge(crop), colour: 0x5f8040, solid: false },
    { geo: crow, colour: 0x8a6e4e, fit: "scatter", solid: false },
  ];
}
