import * as THREE from "three";
import { box, merge, rock, strut, type Layer } from "./geom";
import { snag } from "./beacons";

/**
 * Three finds, built again.
 *
 * Clyde: "improve the quality and look of what can be found. Big time."
 *
 * Looked at side by side, three of the eighteen kinds were visibly a first
 * draft. The shipwreck was nine grey boxes in a row. The standing stones were
 * planks. The hot spring was a turquoise disc whose terraces were 16 cm high
 * and mostly under the turf. Each kept its footprint, its collision and its
 * action, so nothing about how they play has moved — they are the same places,
 * made of something.
 */

/** Nudge every vertex by a hash of where it is, so shared corners stay shared. */
function knap(g: THREE.BufferGeometry, seed: number, amount: number): THREE.BufferGeometry {
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = (k: number) => {
      const s = Math.sin(Math.round(x * 20) * 12.9898 + Math.round(y * 20) * 78.233 + Math.round(z * 20) * 37.719 + seed * 4.1 + k) * 43758.5453;
      return (s - Math.floor(s) - 0.5) * 2;
    };
    p.setXYZ(i, x + h(1) * amount, y + h(2) * amount * 0.5, z + h(3) * amount);
  }
  g.computeVertexNormals();
  return g;
}

/** Triangles from a flat list of corner positions, with the attributes merge() expects. */
function mesh(v: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
  return g;
}

// --- the shipwreck -----------------------------------------------------------

const SHIP_L = 30;
const SHIP_DECK = 3.5;

/** Half-breadth and sheer of the hull at a station, 0 at the stern, 1 at the stem. */
function station(t: number): { z: number; b: number; sheer: number; keel: number } {
  const z = (t - 0.5) * SHIP_L;
  // Full aft, fine forward: a working boat, not a canoe.
  const b = 3.7 * Math.min(1, 0.72 + t * 1.4) * Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 2.2)), 0.6);
  const sheer = SHIP_DECK + 0.5 * Math.pow(Math.abs(t - 0.42) * 2, 2) + (t > 0.8 ? (t - 0.8) * 5 : 0);
  const keel = t > 0.86 ? (t - 0.86) * 12 : 0;
  return { z, b, sheer, keel };
}

/**
 * Plating between two heights of the section, from station t0 to t1.
 *
 * The section is keel → chine → sheer: a hard-chine hull, which is both how
 * small steel boats are actually built and the shape flat shading is kindest
 * to.
 */
function plating(t0: number, t1: number, n: number, part: "bottom" | "side" | "deck"): number[] {
  const v: number[] = [];
  const pts = (t: number) => {
    const s = station(t);
    return {
      keel: [0, s.keel, s.z],
      chineL: [-s.b * 0.78, s.keel + 1.15, s.z], chineR: [s.b * 0.78, s.keel + 1.15, s.z],
      sheerL: [-s.b, s.sheer, s.z], sheerR: [s.b, s.sheer, s.z],
    };
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < n; i++) {
    const a = pts(t0 + ((t1 - t0) * i) / n);
    const b = pts(t0 + ((t1 - t0) * (i + 1)) / n);
    if (part === "bottom") {
      quad(a.keel, a.chineL, b.chineL, b.keel);
      quad(a.keel, b.keel, b.chineR, a.chineR);
    } else if (part === "side") {
      quad(a.chineL, a.sheerL, b.sheerL, b.chineL);
      quad(a.chineR, b.chineR, b.sheerR, a.sheerR);
    } else {
      quad(a.sheerL, a.sheerR, b.sheerR, b.sheerL);
    }
  }
  return v;
}

/** A bulkhead closing the hull at a station: the transom, or a torn-open end. */
function bulkhead(t: number): number[] {
  const s = station(t);
  const k = [0, s.keel, s.z], cl = [-s.b * 0.78, s.keel + 1.15, s.z], cr = [s.b * 0.78, s.keel + 1.15, s.z];
  const sl = [-s.b, s.sheer, s.z], sr = [s.b, s.sheer, s.z];
  return [...k, ...cl, ...cr, ...cl, ...sl, ...sr, ...cl, ...sr, ...cr, ...k, ...cr, ...cl, ...cl, ...sr, ...sl, ...cl, ...cr, ...sr];
}

/** One frame of the hull: the rib you see when the plating has gone. */
function frame(t: number): THREE.BufferGeometry[] {
  const s = station(t);
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    out.push(strut([0, s.keel, s.z], [sx * s.b * 0.78, s.keel + 1.15, s.z], 0.14, 5));
    out.push(strut([sx * s.b * 0.78, s.keel + 1.15, s.z], [sx * s.b, s.sheer + 0.2, s.z], 0.13, 5));
  }
  return out;
}

/**
 * A steel coaster, driven ashore and left.
 *
 * Three states of the same ship rather than three ships: whole and listing;
 * broken in two with her frames showing through the gap; and nothing but the
 * keel, the frames and the stem standing out of the sand.
 */
export function shipwreck(): Layer[] {
  const lean = (g: THREE.BufferGeometry) => {
    g.rotateZ(0.2);
    g.rotateX(-0.05);
    g.translate(0, -0.5, 0);
    return g;
  };
  // Whole.
  const bottomAll = mesh(plating(0, 1, 16, "bottom"));
  const sideAll = mesh([...plating(0, 1, 16, "side"), ...bulkhead(0)]);
  const deckAll = mesh(plating(0, 1, 16, "deck"));
  // Broken: the middle sixth of her is gone.
  const gap0 = 0.44, gap1 = 0.6;
  const bottomTwo = mesh([...plating(0, gap0, 8, "bottom"), ...plating(gap1, 1, 7, "bottom")]);
  const sideTwo = mesh([...plating(0, gap0, 8, "side"), ...plating(gap1, 1, 7, "side"), ...bulkhead(0), ...bulkhead(gap0), ...bulkhead(gap1)]);
  const deckTwo = mesh([...plating(0, gap0, 8, "deck"), ...plating(gap1, 1, 7, "deck")]);

  // Frames: a few through the break, and all of them for the skeleton.
  const gapFrames: THREE.BufferGeometry[] = [];
  for (const t of [0.47, 0.51, 0.55, 0.58]) gapFrames.push(...frame(t));
  gapFrames.push(at(box(0.5, 0.5, SHIP_L * (gap1 - gap0) + 1), 0, 0.2, (((gap0 + gap1) / 2) - 0.5) * SHIP_L));
  const bones: THREE.BufferGeometry[] = [];
  for (let i = 1; i < 16; i++) bones.push(...frame(i / 17));
  bones.push(at(box(0.55, 0.6, SHIP_L * 0.9), 0, 0.2, -1));
  const stem = station(0.97);
  bones.push(strut([0, 0, SHIP_L * 0.36], [0, stem.sheer + 1.2, stem.z + 0.8], 0.24, 5));
  bones.push(strut([0, 0, -SHIP_L * 0.46], [0, SHIP_DECK + 0.6, -SHIP_L * 0.5], 0.22, 5));

  // What stands on the deck, aft: wheelhouse, funnel, and the derrick forward.
  const house: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const rust: THREE.BufferGeometry[] = [];
  house.push(at(box(4.6, 2.5, 5.2), 0, SHIP_DECK + 1.25, -8.6));
  house.push(at(box(3.6, 2.2, 3.4), 0, SHIP_DECK + 3.6, -8.2));
  house.push(at(box(4.2, 0.18, 4.0), 0, SHIP_DECK + 4.8, -8.2));
  // Wheelhouse windows, most of them out.
  for (const x of [-1.2, 0, 1.2]) dark.push(at(box(0.85, 0.8, 0.12), x, SHIP_DECK + 3.9, -6.46));
  for (const z of [-9, -7.6]) for (const sx of [-1, 1]) dark.push(at(box(0.12, 0.8, 0.9), sx * 1.82, SHIP_DECK + 3.9, z));
  for (const z of [-10.2, -8.6, -7]) for (const sx of [-1, 1]) dark.push(at(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 8).rotateZ(Math.PI / 2), sx * 2.32, SHIP_DECK + 1.5, z));
  const funnel = new THREE.CylinderGeometry(0.75, 0.9, 3.4, 9);
  funnel.rotateX(-0.14);
  rust.push(at(funnel, 0, SHIP_DECK + 5.6, -10.6));
  dark.push(at(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 9).rotateX(-0.14), 0, SHIP_DECK + 7.1, -10.85));
  // Hatch coamings on the well deck, one with its cover slid off.
  rust.push(at(box(3.6, 0.5, 4.4), 0, SHIP_DECK + 0.25, 2.4));
  dark.push(at(box(3.0, 0.1, 3.8), 0, SHIP_DECK + 0.52, 2.4));
  rust.push(at(box(3.2, 0.14, 2.2), 1.5, SHIP_DECK + 0.6, -2.2).rotateY(0.3));
  // The derrick: a mast forward, a boom dropped across the hatch, the stays.
  rust.push(at(new THREE.CylinderGeometry(0.2, 0.3, 11, 7), 0, SHIP_DECK + 5.5, 6.2));
  rust.push(strut([0, SHIP_DECK + 2.2, 6.0], [1.2, SHIP_DECK + 1.2, -3.4], 0.16, 6));
  rust.push(strut([0, SHIP_DECK + 10.6, 6.2], [0, SHIP_DECK + 5.4, -6.6], 0.04));
  rust.push(strut([0, SHIP_DECK + 10.6, 6.2], [0, station(0.96).sheer, 12.6], 0.04));
  rust.push(at(box(2.6, 0.12, 0.12), 0, SHIP_DECK + 8.8, 6.2));
  // Bulwark rail along the sheer, and an anchor still in its hawse.
  for (const sx of [-1, 1]) {
    for (let i = 2; i < 15; i++) {
      const a = station(i / 16), b = station((i + 1) / 16);
      rust.push(strut([sx * a.b, a.sheer + 0.75, a.z], [sx * b.b, b.sheer + 0.75, b.z], 0.05));
      rust.push(strut([sx * a.b, a.sheer, a.z], [sx * a.b, a.sheer + 0.75, a.z], 0.045));
    }
  }
  dark.push(at(box(0.5, 1.0, 0.4), 1.5, 3.2, 12.2));

  return [
    // 0 whole · 1 broken in two · 2 only her bones
    { geo: lean(sideAll), colour: 0x4f6470, on: [0] },
    { geo: lean(bottomAll), colour: 0x7c3f2c, on: [0] },
    { geo: lean(deckAll), colour: 0x8a7d66, on: [0] },
    { geo: lean(sideTwo), colour: 0x566a72, on: [1] },
    { geo: lean(bottomTwo), colour: 0x7c3f2c, on: [1] },
    { geo: lean(deckTwo), colour: 0x86795f, on: [1] },
    { geo: lean(merge(gapFrames)), colour: 0x6a4a36, on: [1] },
    { geo: lean(merge(bones)), colour: 0x6f5540, on: [2] },
    { geo: lean(merge(house)), colour: 0xd8d2c2, on: [0, 1] },
    { geo: lean(merge(rust)), colour: 0x8f5a3a, on: [0, 1] },
    { geo: lean(merge(dark)), colour: 0x24272b, on: [0, 1] },
  ];
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
  g.translate(x, y, z);
  return g;
};

// --- the standing stones -----------------------------------------------------

/**
 * One megalith: thick at the foot, leaning a little, no two faces parallel.
 *
 * The old ones were boxes, and a box says "plank" however big it is. A stone
 * somebody dragged here and stood on end is five rough faces that taper, with
 * a top nobody dressed.
 */
function megalith(h: number, w: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(w * 0.34, w * 0.56, h, 5, 2);
  g.scale(1, 1, 0.58);
  g.translate(0, h / 2, 0);
  // Slant the top, so the skyline is not a row of flat caps.
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h * 0.9) p.setY(i, p.getY(i) + p.getX(i) * 0.5 * Math.sin(seed * 3.3));
  }
  return knap(g.toNonIndexed(), seed, w * 0.07);
}

function lintel(len: number, seed: number): THREE.BufferGeometry {
  return knap(box(len, 0.85, 1.25).toNonIndexed(), seed, 0.09);
}

export function stones(): Layer[] {
  const ring: THREE.BufferGeometry[] = [];
  const avenue: THREE.BufferGeometry[] = [];
  const fallen: THREE.BufferGeometry[] = [];
  const turf: THREE.BufferGeometry[] = [];
  const R = 9.5;
  // Tall enough that a slope cannot bury the uphill half of the ring.
  const hOf = (i: number) => 5.4 + ((i * 5) % 4) * 0.6;

  // The ring. Nine uprights, where the collision has always said they are.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = megalith(hOf(i), 2.3 + (i % 3) * 0.3, i + 1);
    s.rotateY(-a + Math.PI / 2 + 0.12 * Math.sin(i * 2.7));
    s.rotateZ(Math.sin(i * 1.9) * 0.05);
    ring.push(at(s, Math.cos(a) * R, -0.3, Math.sin(a) * R));
  }
  // Lintels across five of the gaps: a ring that was once closed.
  for (const i of [0, 1, 2, 5, 6]) {
    const a0 = (i / 9) * Math.PI * 2, a1 = ((i + 1) / 9) * Math.PI * 2;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    const l = lintel(Math.hypot(x1 - x0, z1 - z0) + 1.1, i + 20);
    l.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    const y = Math.min(hOf(i), hOf((i + 1) % 9)) + 0.05;
    ring.push(at(l, (x0 + x1) / 2, y, (z0 + z1) / 2));
  }
  // The altar, lying flat in the middle, and two low stones either side.
  const altar = knap(box(3.8, 0.7, 1.7).toNonIndexed(), 31, 0.1);
  altar.rotateY(0.3);
  ring.push(at(altar, 0, 0.3, 0));
  const worn = new THREE.CircleGeometry(R - 1.8, 18);
  worn.rotateX(-Math.PI / 2);
  turf.push(at(worn, 0, 0.06, 0));

  // Variant 1: an avenue, two rows leading somewhere that is no longer there.
  for (let i = 0; i < 12; i++) {
    for (const sx of [-1, 1]) {
      const h = 3.2 + ((i * 3 + (sx > 0 ? 1 : 0)) % 4) * 0.8;
      const s = megalith(h, 2.0, i * 2 + (sx > 0 ? 40 : 60));
      s.rotateY(Math.PI / 2 + 0.2 * Math.sin(i * 1.3 + sx));
      avenue.push(at(s, sx * 3.6, -0.3, -15 + i * 2.8));
    }
  }
  const end = megalith(7.2, 3.4, 77);
  avenue.push(at(end, 0, -0.3, 19.5));
  const way = box(4.6, 0.1, 33);
  turf.push(at(way, 0, 0.05, 0.4));

  // Variant 2: the ring after a few thousand more years.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = megalith(hOf(i), 2.3, i + 90);
    if (i % 3 !== 0) {
      // Down, pointing outward, half sunk.
      s.rotateX(Math.PI / 2 - 0.08);
      s.rotateY(-a + Math.PI / 2 + i);
      fallen.push(at(s, Math.cos(a) * (R + 1.5), 0.25, Math.sin(a) * (R + 1.5)));
    } else {
      s.rotateY(-a + Math.PI / 2);
      s.rotateZ(0.22);
      fallen.push(at(s, Math.cos(a) * R, -0.3, Math.sin(a) * R));
    }
  }
  const broken = lintel(3.4, 55);
  broken.rotateZ(0.5);
  fallen.push(at(broken, 2.2, 0.6, -1.4));

  /**
   * The heel stone, set apart and far taller than the ring — which real
   * circles have, and which is the only part of one you can see from a
   * distance.
   */
  const heel = megalith(12.4, 3.6, 91);
  heel.rotateY(0.6);
  heel.rotateZ(0.07);
  at(heel, 17, -0.4, -4);

  return [
    { geo: heel, colour: 0x8d8b85 },
    // 0 ring · 1 avenue · 2 mostly fallen
    { geo: merge(ring), colour: 0x928f86, on: [0] },
    { geo: merge(avenue), colour: 0x928f86, on: [1] },
    { geo: merge(fallen), colour: 0x87847b, on: [2] },
    { geo: merge(turf), colour: 0x6f6a4c, on: [0, 1] },
  ];
}

// --- the hot spring ----------------------------------------------------------

/**
 * How high the pool stands above the landmark's base.
 *
 * Shared with game/features: the soak has to put you IN the water, and the
 * water is no longer at ground level.
 */
export const SPRING_POOL = 1.35;

/**
 * A hot spring, as a mound the water built.
 *
 * Mineral water lays down stone wherever it runs, so a real spring sits on a
 * dome of its own making with the pool on top and terraces stepping down the
 * outside. That is also what makes it survive uneven ground: the old one was a
 * flat disc at ground level, and on any slope half of it was under the turf.
 *
 * And it is the one place in the world with real colour in it. The water is
 * deepest blue over the vent, and the rings going out — turquoise, yellow,
 * orange, rust — are different things living at different temperatures.
 */
export function spring(): Layer[] {
  const white: THREE.BufferGeometry[] = [];
  const cream: THREE.BufferGeometry[] = [];
  const rocks: THREE.BufferGeometry[] = [];
  const disc = (r: number, y: number, seg = 26) => {
    const c = new THREE.CircleGeometry(r, seg);
    c.rotateX(-Math.PI / 2);
    return at(c, 0, y, 0);
  };
  const ringAt = (r0: number, r1: number, y: number) => {
    const g = new THREE.RingGeometry(r0, r1, 26);
    g.rotateX(-Math.PI / 2);
    return at(g, 0, y, 0);
  };

  // The mound: five terraces, each a drum a little wider and lower than the last.
  const TOP = SPRING_POOL;
  for (let i = 0; i < 5; i++) {
    const r = 9.2 + i * 1.7;
    const top = TOP - 0.06 - i * 0.42;
    const drum = new THREE.CylinderGeometry(r, r + 0.5, 3.4, 26, 1, false);
    at(drum, 0, top - 1.7, 0);
    (i % 2 ? cream : white).push(knap(drum.toNonIndexed(), i + 3, 0.16));
  }
  // The rim of the pool itself, standing a hand above the water.
  const rim = new THREE.TorusGeometry(8.6, 0.42, 5, 26);
  rim.rotateX(Math.PI / 2);
  white.push(at(rim, 0, TOP + 0.1, 0));

  // Water, in the colours of what lives in it.
  const deep = disc(3.4, TOP + 0.03);
  const blue = ringAt(3.4, 6.2, TOP + 0.03);
  const yellow = ringAt(6.2, 7.5, TOP + 0.03);
  const orange = ringAt(7.5, 8.5, TOP + 0.03);
  // Runoff staining the terraces below, two streaks of it.
  const stains: THREE.BufferGeometry[] = [];
  for (const a of [0.7, 3.5]) {
    for (let i = 1; i < 5; i++) {
      const r0 = 9.2 + (i - 1) * 1.7 + 0.5, r1 = 9.2 + i * 1.7;
      const g = new THREE.RingGeometry(r0, r1, 6, 1, a, 0.5);
      g.rotateX(-Math.PI / 2);
      stains.push(at(g, 0, TOP - 0.03 - i * 0.42, 0));
    }
  }

  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const b = rock(1.2 + (i % 4) * 0.7, 0.66, i);
    rocks.push(at(b, Math.cos(a) * 17.6, 0.1, Math.sin(a) * 17.6));
  }

  /**
   * Dead trees standing in the mineral crust. Hot springs kill what grows in
   * them and the bleached trunks stand for decades, which is why they are
   * what you see first.
   */
  const dead = snag(13, 11);
  at(dead, -10.6, TOP - 1.2, 4.2);
  const dead2 = snag(8, 5);
  at(dead2, 11.8, TOP - 1.9, -5.4);

  return [
    { geo: merge([dead, dead2]), colour: 0xb0a694 },
    { geo: merge(white), colour: 0xe4dccb },
    { geo: merge(cream), colour: 0xcdbf9f },
    { geo: merge(rocks), colour: 0x8d8678 },
    { geo: deep, colour: 0x1f5fa8 },
    { geo: blue, colour: 0x3fc4c0 },
    { geo: yellow, colour: 0xe2c24a },
    { geo: orange, colour: 0xd9742c },
    { geo: merge(stains), colour: 0xc9762f },
  ];
}
