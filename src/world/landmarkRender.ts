import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { blobTexture } from "./shadows";
import { LANDMARK_CELL, landmarksNear, type Landmark, type LandmarkKind } from "./landmarks";
import { ACCRETION_KINDS, accretionsAt, type AccretionKind } from "./accretions";

/**
 * Draws landmarks.
 *
 * Unlike the scatter, these must NOT fade with distance — being visible from
 * kilometres away is the entire point. They're sized to stay legible through
 * the aerial haze at three to six kilometres, which is roughly three to five
 * minutes of driving: one decision, one journey, one arrival.
 *
 * Each kind is built as a handful of MATERIAL LAYERS rather than one lump of
 * geometry. A single flat colour per landmark is what made them read as
 * placeholder — timber, metal, glass and rock all shaded identically. The
 * layers of a kind share one set of instance matrices, so the cost is a few
 * more draw calls across a few dozen objects, and they look like things
 * somebody built rather than grey blocks on a hill.
 */

/** Keep this many cells of landmarks loaded — about 15 km of horizon. */
const RANGE_CELLS = 7;
const BUDGET = 40;
const STEAM_PER_SPRING = 7;
const STEAM_BUDGET = 180;

interface Layer {
  geo: THREE.BufferGeometry;
  colour: number;
  /** Emissive things — a warning lamp shouldn't take shading. */
  unlit?: boolean;
  /**
   * Which variants include this layer. Absent means all of them.
   *
   * Instances whose variant omits a layer get a zero-scale matrix in it, which
   * costs an index and draws nothing — so one mesh per layer still covers
   * every structural build of a kind.
   */
  on?: number[];
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(flat, false);
  if (!m) throw new Error("landmark geometry merge failed");
  return m;
}

/** A strut between two points, for bracing, stairs and guy wires. */
function strut(
  from: [number, number, number],
  to: [number, number, number],
  r: number,
  sides = 4
): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), sides);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/**
 * Fire lookout: braced timber frame, a stair flight, a glazed cabin, tin roof.
 * The cross-bracing is also what makes its footprint collision read as fair.
 */
function lookout(): Layer[] {
  const timber: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const L = 3.2;
  const H = 16.4;
  const corners: [number, number][] = [[-L, -L], [L, -L], [L, L], [-L, L]];

  for (const [sx, sz] of corners) {
    const leg = new THREE.CylinderGeometry(0.4, 0.62, H, 6);
    leg.translate(0, H / 2, 0);
    leg.rotateZ(-Math.sign(sx) * 0.055);
    leg.rotateX(Math.sign(sz) * 0.055);
    leg.translate(sx, 0, sz);
    timber.push(leg);
  }
  // X-bracing round all four faces at two heights, plus horizontal ties.
  for (const [y0, y1] of [[1.2, 7.4], [7.4, 13.6]] as [number, number][]) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      timber.push(strut([a[0], y0, a[1]], [c[0], y1, c[1]], 0.1));
      timber.push(strut([a[0], y1, a[1]], [c[0], y0, c[1]], 0.1));
    }
  }
  for (const y of [7.4, 13.6]) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      timber.push(strut([a[0], y, a[1]], [c[0], y, c[1]], 0.09));
    }
  }

  const deck = box(9.6, 0.5, 9.6);
  deck.translate(0, 16.7, 0);
  timber.push(deck);
  const joist = box(9.6, 0.34, 0.34);
  joist.translate(0, 16.4, 0);
  timber.push(joist);

  // A stair flight up one side — the detail that says people go up there.
  for (let i = 0; i < 9; i++) {
    const step = box(1.5, 0.12, 0.5);
    step.translate(-5.3, 3 + i * 1.5, -4.6 + i * 0.5);
    timber.push(step);
  }
  metal.push(strut([-6.1, 2.8, -4.8], [-6.1, 16.6, -0.5], 0.06));
  metal.push(strut([-4.5, 2.8, -4.8], [-4.5, 16.6, -0.5], 0.06));

  const cabin = box(6.4, 2.1, 6.4);
  cabin.translate(0, 18.0, 0);
  timber.push(cabin);
  // A band of glass right round, which is what a lookout is for.
  for (const [ox, oz, w, d] of [
    [0, 3.24, 6.2, 0.1], [0, -3.24, 6.2, 0.1], [3.24, 0, 0.1, 6.2], [-3.24, 0, 0.1, 6.2],
  ] as [number, number, number, number][]) {
    const pane = box(w, 1.25, d);
    pane.translate(ox, 18.6, oz);
    glass.push(pane);
  }
  const eaves = box(7.6, 0.22, 7.6);
  eaves.translate(0, 19.2, 0);
  metal.push(eaves);
  const roof = new THREE.ConeGeometry(5.6, 1.9, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 20.2, 0);
  metal.push(roof);

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const post = box(0.12, 0.95, 0.12);
    post.translate(Math.cos(a) * 4.5, 17.4, Math.sin(a) * 4.5);
    metal.push(post);
  }
  for (const [ox, oz, w, d] of [
    [0, 4.6, 9.4, 0.14], [0, -4.6, 9.4, 0.14], [4.6, 0, 0.14, 9.4], [-4.6, 0, 0.14, 9.4],
  ] as [number, number, number, number][]) {
    const rail = box(w, 0.14, d);
    rail.translate(ox, 17.85, oz);
    metal.push(rail);
  }

  // Variant 2 is a collapse: the deck and everything above it on the ground.
  const fallen: THREE.BufferGeometry[] = [];
  const wreckDeck = box(9.6, 0.5, 9.6);
  wreckDeck.rotateZ(0.36);
  wreckDeck.rotateY(0.5);
  wreckDeck.translate(2.4, 1.1, -1.2);
  fallen.push(wreckDeck);
  for (let i = 0; i < 5; i++) {
    const beam = new THREE.CylinderGeometry(0.34, 0.46, 9 + i, 5);
    beam.rotateZ(Math.PI / 2 - 0.18 * i);
    beam.rotateY(i * 1.1);
    beam.translate(-1.4 + i * 1.1, 0.5, 1.8 - i * 0.9);
    fallen.push(beam);
  }

  return [
    // 0 intact · 1 burnt out · 2 collapsed
    { geo: merge(timber), colour: 0x8a6a4a, on: [0, 1] },
    { geo: merge(metal), colour: 0x767c82, on: [0] },
    { geo: merge(glass), colour: 0x9fc4d4, on: [0] },
    { geo: merge(fallen), colour: 0x6d5742, on: [2] },
  ];
}

/** Stone arch: eroded blocks with a darker stratum, and rubble at the feet. */
function arch(): Layer[] {
  const pale: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const R = 17;
  const N = 13;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI;
    // Uneven blocks read as weathered rock rather than masonry.
    const wob = 0.72 + Math.abs(Math.sin(i * 2.3)) * 0.6;
    const seg = box((Math.PI * R) / N + 1.9, 4.4 + wob * 1.7, 6.4 + wob * 2.2);
    seg.rotateZ(a + Math.PI / 2);
    seg.rotateY(Math.sin(i * 1.7) * 0.12);
    seg.translate(Math.cos(a) * R, Math.sin(a) * R, Math.sin(i * 3.1) * 0.5);
    (i % 4 === 1 ? dark : pale).push(seg);
  }
  for (const sx of [-1, 1]) {
    const foot = box(9.4, 5.2, 10.2);
    foot.translate(sx * R, 1.9, 0);
    pale.push(foot);
    const band = box(9.7, 1.1, 10.5);
    band.translate(sx * R, 3.5, 0);
    dark.push(band);
    for (let i = 0; i < 5; i++) {
      const r = new THREE.IcosahedronGeometry(0.8 + (i % 3) * 0.6, 0);
      r.scale(1, 0.7, 1);
      r.translate(sx * (R + (i - 2) * 2.6), 0.5, (i % 2 ? 1 : -1) * (5.4 + i * 0.7));
      pale.push(r);
    }
  }
  return [
    { geo: merge(pale), colour: 0xb09672 },
    { geo: merge(dark), colour: 0x8a7158 },
  ];
}

/** Radio mast: lattice, guy wires to three anchors, dishes, a red lamp. */
function mast(): Layer[] {
  const steel: THREE.BufferGeometry[] = [];
  const warn: THREE.BufferGeometry[] = [];
  const lamp: THREE.BufferGeometry[] = [];
  const H = 52;

  const tower = new THREE.CylinderGeometry(0.5, 2.5, H, 4);
  tower.translate(0, H / 2, 0);
  steel.push(tower);
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const r = 2.5 - t * 2.0;
    const ring = box(r * 2.5, 0.26, r * 2.5);
    ring.translate(0, t * H, 0);
    // Aviation banding up the top third.
    (t > 0.62 && i % 2 ? warn : steel).push(ring);
  }
  // Guy wires to three anchors — the thing that makes a mast read as a mast.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ax = Math.cos(a) * 15;
    const az = Math.sin(a) * 15;
    steel.push(strut([0, H * 0.58, 0], [ax, 0.4, az], 0.075, 3));
    steel.push(strut([0, H * 0.92, 0], [ax * 0.72, 0.4, az * 0.72], 0.06, 3));
    const anchor = box(1.1, 0.7, 1.1);
    anchor.translate(ax, 0.3, az);
    steel.push(anchor);
  }
  for (const [y, r] of [[26, 1.5], [33, 1.1]] as [number, number][]) {
    const dish = new THREE.CylinderGeometry(r, r * 0.3, 0.4, 10);
    dish.rotateX(Math.PI / 2.2);
    dish.translate(r + 0.6, y, 0);
    steel.push(dish);
  }
  const bulb = new THREE.IcosahedronGeometry(0.62, 0);
  bulb.translate(0, H + 0.7, 0);
  lamp.push(bulb);

  return [
    { geo: merge(steel), colour: 0x9aa0a6 },
    { geo: merge(warn), colour: 0xc4553a },
    { geo: merge(lamp), colour: 0xff5a46, unlit: true },
  ];
}

/** Hot spring: stepped travertine terraces round a bright pool. */
function spring(): Layer[] {
  const stone: THREE.BufferGeometry[] = [];
  const rock: THREE.BufferGeometry[] = [];
  const water: THREE.BufferGeometry[] = [];

  // Concentric terraces, each stepping down toward the water.
  for (let i = 0; i < 4; i++) {
    const inner = 8.1 + i * 1.5;
    const ring = new THREE.RingGeometry(inner, inner + 1.5, 22);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.62 - i * 0.16, 0);
    stone.push(ring);
    const lip = new THREE.CylinderGeometry(inner + 1.5, inner + 1.5, 0.17, 22, 1, true);
    lip.translate(0, 0.55 - i * 0.16, 0);
    stone.push(lip);
  }
  const pool = new THREE.CircleGeometry(8.1, 24);
  pool.rotateX(-Math.PI / 2);
  pool.translate(0, 0.52, 0);
  water.push(pool);

  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + 0.3;
    const r = 1.6 + (i % 4) * 1.0;
    const b = new THREE.IcosahedronGeometry(r, 0);
    b.scale(1, 0.66, 1);
    b.translate(Math.cos(a) * 14.6, 0.3, Math.sin(a) * 14.6);
    rock.push(b);
  }

  return [
    { geo: merge(stone), colour: 0xcfc4a8 },
    { geo: merge(rock), colour: 0x8d8678 },
    { geo: merge(water), colour: 0x47c0b4 },
  ];
}

/** One enormous old tree: leaning trunk, surface roots, a broad crown. */
function loneTree(): Layer[] {
  const bark: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];

  const trunk = new THREE.CylinderGeometry(0.8, 1.9, 11.5, 7);
  trunk.translate(0, 5.6, 0);
  trunk.rotateZ(0.07);
  bark.push(trunk);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    bark.push(
      strut([Math.cos(a) * 0.5, 0.9, Math.sin(a) * 0.5], [Math.cos(a) * 3.1, 0.05, Math.sin(a) * 3.1], 0.3, 5)
    );
  }
  for (const [a, len, y] of [[0.6, 4.2, 9.2], [2.6, 3.6, 10.1], [4.5, 3.9, 8.6]] as [number, number, number][]) {
    bark.push(strut([0, y, 0], [Math.cos(a) * len, y + 2.4, Math.sin(a) * len], 0.32, 5));
  }
  for (const [ox, oy, oz, r] of [
    [0, 14.2, 0, 6.0], [4.6, 12.2, 1.5, 4.0], [-3.9, 12.9, -2.4, 3.6],
    [1.6, 16.4, -2.8, 3.1], [-2.2, 15.4, 3.2, 2.9],
  ] as [number, number, number, number][]) {
    const crown = new THREE.IcosahedronGeometry(r, 0);
    crown.scale(1, 0.76, 1);
    crown.translate(ox, oy, oz);
    leaf.push(crown);
  }
  // Variant 1 leans everything one way, as if the wind never stops.
  const leaned = merge(leaf.map((g) => g.clone()));
  leaned.translate(0, -14, 0);
  leaned.scale(1.35, 0.72, 0.78);
  leaned.rotateZ(-0.34);
  leaned.translate(3.4, 13.4, 0);

  return [
    // 0 broad · 1 wind-sculpted · 2 dead and bleached
    { geo: merge(bark), colour: 0x6b543c, on: [0, 1] },
    { geo: merge(leaf), colour: 0x4a5b36, on: [0] },
    { geo: leaned, colour: 0x55633c, on: [1] },
    { geo: merge(bark.map((g) => g.clone())), colour: 0xa49a86, on: [2] },
  ];
}

/** A peer that didn't make it: rusted, leaning, one wheel off in the grass. */
function wreck(): Layer[] {
  const rust: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];

  const body = box(1.9, 0.62, 4.1);
  body.translate(0, 0.92, 0);
  rust.push(body);
  const cab = box(1.72, 0.72, 1.9);
  cab.translate(0, 1.56, -0.25);
  rust.push(cab);
  const pane = box(1.56, 0.46, 0.07);
  pane.rotateX(-0.22);
  pane.translate(0, 1.62, 0.66);
  glass.push(pane);
  const door = box(0.07, 0.66, 1.5);
  door.rotateY(-0.7);
  door.translate(-1.25, 1.2, -0.1);
  rust.push(door);
  const rack = box(1.74, 0.09, 1.9);
  rack.translate(0, 1.97, -0.3);
  dark.push(rack);
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [0.95, -1.35]] as [number, number][]) {
    const w = new THREE.CylinderGeometry(0.52, 0.52, 0.38, 9);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.56, z);
    dark.push(w);
  }
  const loose = new THREE.CylinderGeometry(0.52, 0.52, 0.38, 9);
  loose.rotateX(Math.PI / 2);
  loose.translate(-2.3, 0.2, -1.9);
  dark.push(loose);

  const out: Layer[] = [
    { geo: merge(rust), colour: 0x8a5a3e },
    { geo: merge(dark), colour: 0x3c3a36 },
    { geo: merge(glass), colour: 0x7f8f88 },
  ];
  for (const l of out) l.geo.rotateZ(0.16); // settled onto its springs
  return out;
}

/**
 * Weathering. Nothing out here is new, and a few things are wrecks.
 *
 * This is a per-instance multiplier on the layer colour, so it costs no extra
 * draw calls — the same lookout can be sun-bleached on one hill and charred on
 * the next without a second mesh.
 */
const WEATHERED = new THREE.Color(0.7, 0.71, 0.65);

function instanceTint(lm: Landmark, out: THREE.Color): void {
  out.setRGB(1, 1, 1).lerp(WEATHERED, lm.wear * 0.6);
  // A burnt-out lookout is charcoal, not merely faded; a collapsed one is
  // weathered timber that has been lying in the grass for years.
  if (lm.kind === "lookout" && lm.variant === 1) out.multiplyScalar(0.3);
  if (lm.kind === "lookout" && lm.variant === 2) out.multiplyScalar(0.78);
  // A dead tree has no business being green-tinged.
  if (lm.kind === "lonetree" && lm.variant === 2) out.lerp(WEATHERED, 0.5);
}


// --- accretions --------------------------------------------------------------

/**
 * The small-object kit. One merged geometry and one colour each, so the whole
 * lot costs seven draw calls however many places are loaded.
 */
function woodpile(): THREE.BufferGeometry {
  const logs: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 3; row++) {
    const n = 3 - Math.floor(row / 2);
    for (let i = 0; i < n; i++) {
      const log = new THREE.CylinderGeometry(0.21, 0.23, 2.6 + (i % 2) * 0.4, 6);
      log.rotateZ(Math.PI / 2);
      log.translate((i - (n - 1) / 2) * 0.47, 0.22 + row * 0.42, 0);
      logs.push(log);
    }
  }
  // A couple of uprights to stop the stack rolling, as anyone stacking would.
  for (const sx of [-1.45, 1.45]) {
    const post = new THREE.CylinderGeometry(0.1, 0.12, 1.7, 5);
    post.translate(sx, 0.85, 0);
    logs.push(post);
  }
  return merge(logs);
}

function firepit(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const stone = new THREE.IcosahedronGeometry(0.26 + (i % 3) * 0.07, 0);
    stone.scale(1, 0.75, 1);
    stone.translate(Math.cos(a) * 1.05, 0.14, Math.sin(a) * 1.05);
    parts.push(stone);
  }
  // Spent wood, crossed in the middle. Lighting one comes with Shelter & Stay.
  for (let i = 0; i < 3; i++) {
    const stick = new THREE.CylinderGeometry(0.07, 0.08, 1.5, 4);
    stick.rotateZ(Math.PI / 2 - 0.1);
    stick.rotateY((i / 3) * Math.PI);
    stick.translate(0, 0.1, 0);
    parts.push(stick);
  }
  return merge(parts);
}

function cairn(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  for (let i = 0; i < 6; i++) {
    const r = 0.52 - i * 0.065;
    const stone = new THREE.IcosahedronGeometry(r, 0);
    stone.scale(1, 0.56, 0.9);
    stone.rotateY(i * 1.3);
    stone.translate(Math.sin(i * 2.1) * 0.07, y + r * 0.56, Math.cos(i * 1.7) * 0.07);
    parts.push(stone);
    y += r * 1.02;
  }
  return merge(parts);
}

function signpostParts(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const post = new THREE.CylinderGeometry(0.11, 0.13, 2.5, 6);
  post.translate(0, 1.25, 0);
  const boards: THREE.BufferGeometry[] = [];
  const top = box(1.7, 0.3, 0.07);
  top.translate(0.72, 2.18, 0);
  boards.push(top);
  const low = box(1.4, 0.26, 0.07);
  low.rotateY(Math.PI * 0.62);
  low.translate(-0.45, 1.72, 0.38);
  boards.push(low);
  return [post, merge(boards)];
}

function drums(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [ox, oz] of [[0, 0], [0.72, 0.18], [0.34, -0.66]] as [number, number][]) {
    const d = new THREE.CylinderGeometry(0.33, 0.33, 0.92, 9);
    d.translate(ox, 0.46, oz);
    parts.push(d);
  }
  // One on its side, because nobody stacks three drums neatly and leaves.
  const fallen = new THREE.CylinderGeometry(0.33, 0.33, 0.92, 9);
  fallen.rotateZ(Math.PI / 2);
  fallen.translate(-0.74, 0.33, 0.5);
  parts.push(fallen);
  return merge(parts);
}

function kennel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = box(1.15, 0.85, 1.45);
  body.translate(0, 0.42, 0);
  parts.push(body);
  const roof = new THREE.CylinderGeometry(0.78, 0.78, 1.5, 3);
  roof.rotateZ(Math.PI / 2);
  roof.rotateY(Math.PI / 2);
  roof.translate(0, 0.98, 0);
  parts.push(roof);
  return merge(parts);
}

interface AccretionModel {
  geo: THREE.BufferGeometry;
  colour: number;
}

const ACCRETION_MODELS: Record<AccretionKind, AccretionModel[]> = {
  woodpile: [{ geo: woodpile(), colour: 0x7d6245 }],
  firepit: [{ geo: firepit(), colour: 0x6e6a63 }],
  cairn: [{ geo: cairn(), colour: 0x8d8a80 }],
  signpost: [
    { geo: signpostParts()[0], colour: 0x7a6248 },
    { geo: signpostParts()[1], colour: 0xb9ae95 },
  ],
  drums: [{ geo: drums(), colour: 0x6f7a6a }],
  kennel: [{ geo: kennel(), colour: 0x80664b }],
};

/** 40 landmarks times six optional objects, with room to spare. */
const ACCRETION_BUDGET = 150;


/**
 * Steadings: one building somebody put up and then left.
 *
 * The three variants are genuinely different buildings rather than three
 * conditions of one — a cabin, a barn and a line shack — so each gets its own
 * walls and roof. That is more layers than any other kind, which is the cost
 * of buildings being the headline: a flat-coloured box is exactly what made
 * landmarks read as placeholder before.
 */
function steading(): Layer[] {
  /** Walls, a door hole and a pitched roof — the shape all three share. */
  const shell = (w: number, d: number, h: number, pitch: number, door: number) => {
    const walls: THREE.BufferGeometry[] = [];
    const t = 0.22;
    for (const [ox, oz, ww, dd] of [
      [0, -d / 2, w, t],
      [-w / 2, 0, t, d],
      [w / 2, 0, t, d],
    ] as [number, number, number, number][]) {
      const wall = box(ww, h, dd);
      wall.translate(ox, h / 2, oz);
      walls.push(wall);
    }
    // The front wall is two posts and a lintel, which leaves the doorway.
    const side = (w - door) / 2;
    for (const sx of [-1, 1]) {
      const pier = box(side, h, t);
      pier.translate(sx * (door + side) / 2, h / 2, d / 2);
      walls.push(pier);
    }
    const lintel = box(door, h * 0.26, t);
    lintel.translate(0, h - h * 0.13, d / 2);
    walls.push(lintel);

    const roof = new THREE.CylinderGeometry(pitch, pitch, d + 0.9, 3, 1);
    roof.rotateZ(Math.PI / 2);
    roof.rotateY(Math.PI / 2);
    roof.scale(1, 1, (w + 0.8) / (pitch * Math.sqrt(3)));
    roof.translate(0, h + pitch * 0.42, 0);
    return { walls: merge(walls), roof };
  };

  const cabin = shell(6.6, 5.2, 3.0, 2.0, 1.3);
  const barn = shell(10.4, 7.2, 4.8, 2.9, 3.0);
  const shack = shell(4.2, 3.8, 2.5, 1.3, 1.1);

  // A stone chimney is what makes a cabin a home rather than a shed, and it is
  // where the smoke goes once Traces lands.
  const stack: THREE.BufferGeometry[] = [];
  const flue = box(1.0, 4.4, 1.0);
  flue.translate(-3.5, 2.2, -1.1);
  stack.push(flue);
  const cap = box(1.3, 0.3, 1.3);
  cap.translate(-3.5, 4.5, -1.1);
  stack.push(cap);

  // The shack gets a tin stovepipe instead — the same idea, cheaper to build.
  const pipe = new THREE.CylinderGeometry(0.16, 0.18, 2.0, 6);
  pipe.translate(-1.5, 3.3, -0.9);

  const panes: THREE.BufferGeometry[] = [];
  for (const [ox, oz] of [[-2.1, 2.62], [2.1, 2.62], [3.33, -1.1]] as [number, number][]) {
    const pane = box(Math.abs(oz) > 2 ? 1.1 : 0.08, 0.85, Math.abs(oz) > 2 ? 0.08 : 1.1);
    pane.translate(ox, 1.85, oz);
    panes.push(pane);
  }
  const shackPane = box(0.8, 0.62, 0.08);
  shackPane.translate(1.2, 1.5, 1.95);

  return [
    // 0 cabin · 1 barn · 2 line shack
    { geo: cabin.walls, colour: 0x8a7050, on: [0] },
    { geo: cabin.roof, colour: 0x5a4a3e, on: [0] },
    { geo: merge(stack), colour: 0x8a8880, on: [0] },
    { geo: merge(panes), colour: 0x9fc4d4, on: [0] },
    { geo: barn.walls, colour: 0x7a4f42, on: [1] },
    { geo: barn.roof, colour: 0x6b7076, on: [1] },
    { geo: shack.walls, colour: 0x938068, on: [2] },
    { geo: shack.roof, colour: 0x6f6257, on: [2] },
    { geo: pipe, colour: 0x767c82, on: [2] },
    { geo: shackPane, colour: 0x9fc4d4, on: [2] },
  ];
}

const BUILDERS: Record<LandmarkKind, () => Layer[]> = {
  lookout,
  arch,
  mast,
  spring,
  lonetree: loneTree,
  wreck,
  steading,
};

export class LandmarkField {
  readonly group = new THREE.Group();
  /** Every layer of every kind, all driven by one set of instance matrices. */
  private meshes = new Map<LandmarkKind, THREE.InstancedMesh[]>();
  /** Parallel to meshes — which variants each layer belongs to. */
  private layers = new Map<LandmarkKind, Layer[]>();
  private accretions = new Map<AccretionKind, THREE.InstancedMesh[]>();
  /** Signposts in range, for the walk-up read. */
  signs: { x: number; z: number; text: string }[] = [];
  private steam: THREE.InstancedMesh;
  private steamAnchors: { x: number; y: number; z: number }[] = [];
  private cellX = NaN;
  private cellZ = NaN;
  /** Everything currently loaded, for collision and discovery. */
  loaded: Landmark[] = [];

  constructor() {
    for (const kind of Object.keys(BUILDERS) as LandmarkKind[]) {
      const built = BUILDERS[kind]();
      this.layers.set(kind, built);
      const meshes = built.map((layer) => {
        const mat = layer.unlit
          ? new THREE.MeshBasicMaterial({ color: layer.colour })
          : new THREE.MeshLambertMaterial({ color: layer.colour, flatShading: true });
        const mesh = new THREE.InstancedMesh(layer.geo, mat, BUDGET);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.group.add(mesh);
        return mesh;
      });
      this.meshes.set(kind, meshes);
    }

    for (const kind of ACCRETION_KINDS) {
      const meshes = ACCRETION_MODELS[kind].map((m) => {
        const mesh = new THREE.InstancedMesh(
          m.geo,
          new THREE.MeshLambertMaterial({ color: m.colour, flatShading: true }),
          ACCRETION_BUDGET
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.group.add(mesh);
        return mesh;
      });
      this.accretions.set(kind, meshes);
    }

    this.steam = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        color: 0xffffff,
      }),
      STEAM_BUDGET
    );
    this.steam.frustumCulled = false;
    this.steam.count = 0;
    this.steam.renderOrder = 8;
    this.group.add(this.steam);
  }

  update(px: number, pz: number, time: number, camera: THREE.Camera) {
    const cx = Math.round(px / LANDMARK_CELL);
    const cz = Math.round(pz / LANDMARK_CELL);
    if (cx !== this.cellX || cz !== this.cellZ) {
      this.cellX = cx;
      this.cellZ = cz;
      this.rebuild(px, pz);
    }
    this.animateSteam(time, camera);
  }

  private rebuild(px: number, pz: number) {
    this.loaded = landmarksNear(px, pz, RANGE_CELLS);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const tint = new THREE.Color();
    const counts = new Map<LandmarkKind, number>();
    this.steamAnchors.length = 0;

    for (const lm of this.loaded) {
      const n = counts.get(lm.kind) ?? 0;
      if (n >= BUDGET) continue;
      pos.set(lm.x, lm.y, lm.z);
      q.setFromAxisAngle(up, lm.rot);
      scl.setScalar(lm.scale);
      m.compose(pos, q, scl);
      // Every layer of this kind shares the one instance transform — except
      // layers this variant doesn't include, which collapse to nothing.
      const layers = this.layers.get(lm.kind)!;
      const meshes = this.meshes.get(lm.kind)!;
      instanceTint(lm, tint);
      for (let i = 0; i < meshes.length; i++) {
        const on = layers[i].on;
        meshes[i].setMatrixAt(n, on && !on.includes(lm.variant) ? hidden : m);
        meshes[i].setColorAt(n, tint);
      }
      counts.set(lm.kind, n + 1);

      if (lm.kind === "spring") this.steamAnchors.push({ x: lm.x, y: lm.y + 1, z: lm.z });
    }

    // The small stuff. Placed after the structures so a signpost sitting on a
    // slope reads against ground it was actually measured on.
    this.signs.length = 0;
    const acc = new Map<AccretionKind, number>();
    for (const lm of this.loaded) {
      for (const a of accretionsAt(lm)) {
        const k = acc.get(a.kind) ?? 0;
        if (k >= ACCRETION_BUDGET) continue;
        pos.set(a.x, a.y, a.z);
        q.setFromAxisAngle(up, a.rot);
        scl.setScalar(a.scale);
        m.compose(pos, q, scl);
        for (const mesh of this.accretions.get(a.kind)!) mesh.setMatrixAt(k, m);
        acc.set(a.kind, k + 1);
        if (a.text) this.signs.push({ x: a.x, z: a.z, text: a.text });
      }
    }
    for (const [kind, meshes] of this.accretions) {
      const n = acc.get(kind) ?? 0;
      for (const mesh of meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    for (const [kind, meshes] of this.meshes) {
      const n = counts.get(kind) ?? 0;
      for (const mesh of meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Puffs rise, spread and fade on a loop, billboarded at the camera. */
  private animateSteam(time: number, camera: THREE.Camera) {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    camera.getWorldQuaternion(q);

    let n = 0;
    for (let a = 0; a < this.steamAnchors.length && n < STEAM_BUDGET; a++) {
      const anchor = this.steamAnchors[a];
      for (let i = 0; i < STEAM_PER_SPRING && n < STEAM_BUDGET; i++) {
        const phase = (((time * 0.11 + i / STEAM_PER_SPRING + a * 0.37) % 1) + 1) % 1;
        const rise = phase * 30;
        const spread = 2.2 + phase * 13;
        const wobble = Math.sin(time * 0.5 + i * 2.1 + a) * phase * 5;
        pos.set(anchor.x + wobble, anchor.y + rise, anchor.z + Math.cos(time * 0.4 + i) * phase * 4);
        scl.setScalar(spread);
        m.compose(pos, q, scl);
        this.steam.setMatrixAt(n++, m);
      }
    }
    this.steam.count = n;
    this.steam.instanceMatrix.needsUpdate = true;
  }
}
