import * as THREE from "three";
import { blobTexture } from "./shadows";
import { slotRandom } from "./field";
import { box, merge, strut, type Layer } from "./geom";
import { steadingLayers } from "./buildings";
import { LANDMARK_CELL, geyserLevel, landmarksNear, type Landmark, type LandmarkKind } from "./landmarks";
import { ACCRETION_KINDS, accretionsAt, type AccretionKind } from "./accretions";
import {
  adit,
  airfield,
  dock,
  bonefield,
  frozenLake as frozenlake,
  orchard,
  shipwreck,
  sinkhole,
  stones,
  windpump,
} from "./landmarkKinds";

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

/**
 * Where a windpump's fan sits relative to the tower base: at the top, a little
 * forward of centre, which is where the boom puts it.
 */
const SAIL_HUB = [0, 11.5, -0.8];

/**
 * How much of the world keeps its landmarks loaded.
 *
 * 15 km was plenty on the ground. From a helicopter at 200 m the horizon is
 * nearer 50 km, and the old range put a hard edge of bare terrain across the
 * view. Measured: widening to 24 km costs about a millisecond per rebuild, and
 * a rebuild happens once every 2.2 km of travel — so this is not worth making
 * conditional on altitude.
 *
 * The budget had to go up with it. Worst single-kind count across four sampled
 * locations is 42 at this range, against 20 at the old one.
 */
const RANGE_CELLS = 11;
const BUDGET = 72;
const STEAM_PER_SPRING = 7;
/**
 * Measured worst case across fifteen sampled load positions was 217 steam
 * instances, so 180 was quietly clipping — and it clipped in cell-scan order,
 * which meant a hot spring fifty metres away could lose its steam while one
 * three kilometres off kept its own. Plumes are now sorted near-to-far before
 * drawing, so whatever the budget drops is always the furthest away.
 *
 * Widening the landmark range for flight pushed the uncapped count past this
 * again, and that is fine precisely because of the sort: what gets dropped is
 * steam twenty kilometres off, which was never going to be visible.
 */
const STEAM_BUDGET = 260;

/**
 * A plume — rising, drifting, billboarded. Steam off a hot spring and smoke
 * off a chimney are the same effect with different numbers, so they share one
 * mesh and one draw call.
 *
 * Smoke is the whole point of Traces. Somebody's fire on the next ridge says
 * more about the world being lived in than any amount of furniture, and it
 * reads from kilometres away, which is where you actually are.
 */
interface Plume {
  x: number;
  y: number;
  z: number;
  /** Metres the column climbs before it fades out. */
  rise: number;
  /** Puff width at the bottom, and how fast it opens out. */
  spread: number;
  /** How much a puff opens out over that climb, which is what fades it. */
  drift: number;
  /**
   * Which mesh draws it. Steam and smoke need different colour AND different
   * opacity, and per-instance opacity isn't a thing an InstancedMesh has —
   * instanceColor multiplies diffuse, so fading a puff that way would make it
   * dark grey rather than thin. Two materials, two draw calls, correct result.
   */
  smoke: boolean;
  /**
   * A hot spring that erupts on the hour rather than steaming steadily.
   *
   * Out of season it is a quiet pool and you would never know. That is the
   * whole point of a conditional find — being in the right place is not the
   * same as having found it.
   */
  geyser?: boolean;
  /** Geysers only: how hard it is going right now, recomputed each frame. */
  level: number;
  /** The spring itself, so its own eruption hour can be looked up. */
  lm?: Landmark;
}


/**
 * Fire lookout: braced timber frame, a stair flight, a glazed cabin, tin roof.
 * The cross-bracing is also what makes its footprint collision read as fair.
 */
function lookout(): Layer[] {
  const timber: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];

  /**
   * Proportions, measured against a person.
   *
   * Clyde: "the ladder on the side looks to be for giants.. it should now be a
   * small person size ladder but way longer."
   *
   * He was exactly right, and it was not only the ladder. The old flight had
   * NINE steps at 1.5 m of rise each — a step taller than the 1.55 m character
   * climbing it — and the legs were 0.8 to 1.24 m thick, which is a tree, not
   * a post. Everything here is now sized off a human and the landmark scale
   * does the "bigger", which is the only way bigger stays correct.
   */
  const EYE = 1.55; // the character, for reference
  const L = 2.4; // half the leg spread
  const H = 16.4; // deck height
  const corners: [number, number][] = [[-L, -L], [L, -L], [L, L], [-L, L]];

  for (const [sx, sz] of corners) {
    // 0.36 m at the top to 0.56 at the foot. Heavy timber, not a trunk.
    const leg = new THREE.CylinderGeometry(0.18, 0.28, H, 6);
    leg.translate(0, H / 2, 0);
    leg.rotateZ(-Math.sign(sx) * 0.055);
    leg.rotateX(Math.sign(sz) * 0.055);
    leg.translate(sx, 0, sz);
    timber.push(leg);
  }
  // X-bracing round all four faces at three heights, plus horizontal ties.
  for (const [y0, y1] of [[1.1, 6.2], [6.2, 11.3], [11.3, 16.0]] as [number, number][]) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      timber.push(strut([a[0], y0, a[1]], [c[0], y1, c[1]], 0.07));
      timber.push(strut([a[0], y1, a[1]], [c[0], y0, c[1]], 0.07));
    }
  }
  for (const y of [6.2, 11.3, 16.0]) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      timber.push(strut([a[0], y, a[1]], [c[0], y, c[1]], 0.065));
    }
  }

  const deck = box(5.8, 0.26, 5.8);
  deck.translate(0, H + 0.13, 0);
  timber.push(deck);
  for (const sz of [-1, 1]) {
    const joist = box(5.8, 0.22, 0.22);
    joist.translate(0, H - 0.1, sz * 1.6);
    timber.push(joist);
  }

  /**
   * The ladder. Rungs a third of a metre apart, shoulder width, running the
   * whole way up — about fifty-six of them. Long because the tower is tall,
   * which is what Clyde asked for and what a ladder actually is.
   */
  const RUNG = 0.29;
  const LADDER_W = 0.46;
  const lz = -L - 0.42;
  for (const sx of [-1, 1]) {
    const rail = box(0.07, H + 0.5, 0.07);
    rail.translate((sx * LADDER_W) / 2, (H + 0.5) / 2, lz);
    timber.push(rail);
  }
  for (let y = 0.45; y < H + 0.2; y += RUNG) {
    const rung = box(LADDER_W, 0.045, 0.06);
    rung.translate(0, y, lz);
    metal.push(rung);
  }

  const cabin = box(4.2, 2.3, 4.2);
  cabin.translate(0, H + 1.4, 0);
  timber.push(cabin);
  // A band of glass right round, which is what a lookout is for. Sill at
  // 0.95 above the deck, head height above that — a window a person uses.
  for (const [ox, oz, w, d] of [
    [0, 2.13, 4.0, 0.08], [0, -2.13, 4.0, 0.08], [2.13, 0, 0.08, 4.0], [-2.13, 0, 0.08, 4.0],
  ] as [number, number, number, number][]) {
    const pane = box(w, 1.1, d);
    pane.translate(ox, H + 1.6, oz);
    glass.push(pane);
  }
  const eaves = box(5.0, 0.16, 5.0);
  eaves.translate(0, H + 2.6, 0);
  metal.push(eaves);
  const roof = new THREE.ConeGeometry(3.6, 1.3, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, H + 3.3, 0);
  metal.push(roof);

  // Railing: posts at waist height, which is 1.0 m, not 0.95 of a giant.
  const RAIL_H = 1.02;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const post = box(0.07, RAIL_H, 0.07);
    post.translate(Math.cos(a) * 2.75, H + 0.26 + RAIL_H / 2, Math.sin(a) * 2.75);
    metal.push(post);
  }
  for (const [ox, oz, w, d] of [
    [0, 2.85, 5.7, 0.08], [0, -2.85, 5.7, 0.08], [2.85, 0, 0.08, 5.7], [-2.85, 0, 0.08, 5.7],
  ] as [number, number, number, number][]) {
    for (const y of [H + 0.26 + RAIL_H, H + 0.26 + RAIL_H * 0.55]) {
      const rail = box(w, 0.07, d);
      rail.translate(ox, y, oz);
      metal.push(rail);
    }
  }
  void EYE;

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

function washingLine(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const frame: THREE.BufferGeometry[] = [];
  for (const sx of [-1.9, 1.9]) {
    const post = new THREE.CylinderGeometry(0.08, 0.1, 1.9, 5);
    post.translate(sx, 0.95, 0);
    frame.push(post);
  }
  const cord = box(3.8, 0.035, 0.035);
  cord.translate(0, 1.82, 0);
  frame.push(cord);

  // Cloth, hung at different lengths. Nobody pegs out a tidy row.
  const cloth: THREE.BufferGeometry[] = [];
  for (const [ox, w, h] of [[-1.1, 0.72, 0.9], [0.1, 0.56, 0.66], [1.15, 0.8, 1.05]] as [number, number, number][]) {
    const c = box(w, h, 0.03);
    c.translate(ox, 1.8 - h / 2, 0);
    cloth.push(c);
  }
  return [merge(frame), merge(cloth)];
}

/** Embers in a pit somebody used a few hours ago. */
function embers(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const e = new THREE.IcosahedronGeometry(0.17, 0);
    e.scale(1, 0.4, 1);
    e.translate(Math.cos(a) * 0.3, 0.07, Math.sin(a) * 0.3);
    parts.push(e);
  }
  return merge(parts);
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
  /** Emissive, for embers — they shouldn't take shading. */
  unlit?: boolean;
  /** Only drawn on instances whose fire is still warm. */
  litOnly?: boolean;
}

const ACCRETION_MODELS: Record<AccretionKind, AccretionModel[]> = {
  woodpile: [{ geo: woodpile(), colour: 0x7d6245 }],
  firepit: [
    { geo: firepit(), colour: 0x6e6a63 },
    { geo: embers(), colour: 0xff6a2a, unlit: true, litOnly: true },
  ],
  cairn: [{ geo: cairn(), colour: 0x8d8a80 }],
  signpost: [
    { geo: signpostParts()[0], colour: 0x7a6248 },
    { geo: signpostParts()[1], colour: 0xb9ae95 },
  ],
  drums: [{ geo: drums(), colour: 0x6f7a6a }],
  kennel: [{ geo: kennel(), colour: 0x80664b }],
  line: [
    { geo: washingLine()[0], colour: 0x7a6248 },
    { geo: washingLine()[1], colour: 0xd8d2c4 },
  ],
};

/** Scaled with the landmark range above; worst observed is about 110. */
const ACCRETION_BUDGET = 220;


const BUILDERS: Record<LandmarkKind, () => Layer[]> = {
  lookout,
  arch,
  mast,
  spring,
  lonetree: loneTree,
  wreck,
  steading: steadingLayers,
  shipwreck,
  stones,
  adit,
  windpump,
  sinkhole,
  bonefield,
  orchard,
  frozenlake,
  dock,
  airfield,
};

export class LandmarkField {
  readonly group = new THREE.Group();
  /** Every layer of every kind, all driven by one set of instance matrices. */
  private meshes = new Map<LandmarkKind, THREE.InstancedMesh[]>();
  /** Parallel to meshes — which variants each layer belongs to. */
  private layers = new Map<LandmarkKind, Layer[]>();
  private accretions = new Map<AccretionKind, THREE.InstancedMesh[]>();
  /**
   * Layers that turn. Their instance matrix is recomposed every frame from a
   * stored base transform, which is why they can't just ride along with the
   * static ones.
   */
  private spinners: {
    mesh: THREE.InstancedMesh;
    index: number;
    base: THREE.Matrix4;
    /** Radians per second. Varied per instance so a plain of them never syncs. */
    rate: number;
    phase: number;
  }[] = [];
  /** Signposts in range, for the walk-up read. */
  signs: { x: number; z: number; text: string }[] = [];
  private steam: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private plumes: Plume[] = [];
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
          m.unlit
            ? new THREE.MeshBasicMaterial({ color: m.colour })
            : new THREE.MeshLambertMaterial({ color: m.colour, flatShading: true }),
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

    const puffs = (colour: number, opacity: number) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: blobTexture(),
          transparent: true,
          opacity,
          depthWrite: false,
          color: colour,
        }),
        STEAM_BUDGET
      );
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 8;
      this.group.add(mesh);
      return mesh;
    };
    this.steam = puffs(0xffffff, 0.42);
    // Woodsmoke: grey, thinner, and it climbs twice as far as steam.
    this.smoke = puffs(0xb9b3ab, 0.26);
  }

  /**
   * How hard the geysers are going, 0..1.
   *
   * Set from the frame loop, which is the only thing that knows what the clock
   * says. Each geyser erupts on one hour of the day that it owns — see
   * geyserLevel in world/landmarks.
   */
  timeOfDay = 0;

  update(px: number, pz: number, time: number, camera: THREE.Camera) {
    const cx = Math.round(px / LANDMARK_CELL);
    const cz = Math.round(pz / LANDMARK_CELL);
    if (cx !== this.cellX || cz !== this.cellZ) {
      this.cellX = cx;
      this.cellZ = cz;
      this.rebuild(px, pz);
    }
    this.animateSteam(time, camera);
    this.animateSpinners(time);
  }

  /**
   * The windpump's sails.
   *
   * Hub offset and rotation are applied AFTER the landmark's own transform, so
   * the fan turns on its own axis at the top of its own tower however the
   * tower is rotated or scaled on the hill.
   */
  private animateSpinners(time: number) {
    if (!this.spinners.length) return;
    const local = new THREE.Matrix4();
    const out = new THREE.Matrix4();
    const touched = new Set<THREE.InstancedMesh>();
    for (const sp of this.spinners) {
      local.makeRotationY(sp.phase + time * sp.rate);
      local.setPosition(0, SAIL_HUB[1], SAIL_HUB[2]);
      out.multiplyMatrices(sp.base, local);
      sp.mesh.setMatrixAt(sp.index, out);
      touched.add(sp.mesh);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
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
    this.plumes.length = 0;
    this.spinners.length = 0;

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
        const layer = layers[i];
        const off = layer.on && !layer.on.includes(lm.variant);
        meshes[i].setMatrixAt(n, off ? hidden : m);
        meshes[i].setColorAt(n, tint);
        if (layer.spin && !off) {
          this.spinners.push({
            mesh: meshes[i],
            index: n,
            base: m.clone(),
            // A sail turns slowly and no two turn alike. Sign varies too, so
            // half of them run anticlockwise.
            rate: (0.5 + slotRandom(lm.gx, lm.gz, 1037) * 0.9) * (lm.wear > 0.5 ? 1 : -1),
            phase: slotRandom(lm.gx, lm.gz, 1041) * Math.PI * 2,
          });
        }
      }
      counts.set(lm.kind, n + 1);

      if (lm.kind === "spring") {
        // About one in five is a geyser, and a geyser is only a geyser on the
        // hour — see geyserOn(). The rest of the time it is an ordinary pool
        // and you would never know, which is the point of a conditional find:
        // you can be in exactly the right place and still not have found it.
        const geyser = slotRandom(lm.gx, lm.gz, 1511) > 0.8;
        this.plumes.push({
          x: lm.x, y: lm.y + 1, z: lm.z,
          rise: 30, spread: 2.2, drift: 13, smoke: false,
          geyser, level: 0, lm,
        });
      }
      // Somebody is home. Only a cabin has a chimney, and only some cabins are
      // occupied — smoke from every one of them would read as a theme park.
      if (lm.kind === "steading" && lm.variant === 0 && slotRandom(lm.gx, lm.gz, 1031) > 0.55) {
        this.plumes.push({
          x: lm.x - 3.5 * lm.scale, y: lm.y + 4.8 * lm.scale, z: lm.z - 1.1 * lm.scale,
          rise: 64, spread: 1.1, drift: 26, smoke: true, level: 0,
        });
      }
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
        const models = ACCRETION_MODELS[a.kind];
        const meshes = this.accretions.get(a.kind)!;
        for (let j = 0; j < meshes.length; j++) {
          meshes[j].setMatrixAt(k, models[j].litOnly && !a.lit ? hidden : m);
        }
        acc.set(a.kind, k + 1);
        if (a.text) this.signs.push({ x: a.x, z: a.z, text: a.text });
        // A thread of smoke off a warm pit, which is what you actually see
        // from a distance — the embers themselves are a few pixels.
        if (a.lit) {
          this.plumes.push({
            x: a.x, y: a.y + 0.5, z: a.z,
            rise: 26, spread: 0.7, drift: 11, smoke: true, level: 0,
          });
        }
      }
    }
    for (const [kind, meshes] of this.accretions) {
      const n = acc.get(kind) ?? 0;
      for (const mesh of meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    const pdx = px;
    const pdz = pz;
    this.plumes.sort(
      (a, b) =>
        (a.x - pdx) ** 2 + (a.z - pdz) ** 2 - ((b.x - pdx) ** 2 + (b.z - pdz) ** 2)
    );

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
    let k = 0;
    for (let a = 0; a < this.plumes.length; a++) {
      const p = this.plumes[a];
      if (p.geyser && p.lm) p.level = geyserLevel(p.lm, this.timeOfDay);
      const into = p.smoke ? this.smoke : this.steam;
      if ((p.smoke ? k : n) >= STEAM_BUDGET) continue;
      for (let i = 0; i < STEAM_PER_SPRING; i++) {
        if ((p.smoke ? k : n) >= STEAM_BUDGET) break;
        // A geyser out of season is a quiet pool; in season it throws a
        // column several times the height of ordinary steam.
        const force = p.geyser ? p.level : 1;
        if (p.geyser && force < 0.02) break;
        const phase = (((time * (p.geyser ? 0.3 : 0.11) + i / STEAM_PER_SPRING + a * 0.37) % 1) + 1) % 1;
        const wobble = Math.sin(time * 0.5 + i * 2.1 + a) * phase * 5;
        pos.set(
          p.x + wobble * (p.geyser ? 0.3 : 1),
          p.y + phase * p.rise * (p.geyser ? 1 + force * 3.4 : 1),
          p.z + Math.cos(time * 0.4 + i) * phase * 4
        );
        // Spread opens out as it climbs, which spreads the same alpha over a
        // much bigger area — that is what reads as dissipating.
        scl.setScalar(p.spread + phase * p.drift);
        m.compose(pos, q, scl);
        into.setMatrixAt(p.smoke ? k++ : n++, m);
      }
    }
    this.smoke.count = k;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.steam.count = n;
    this.steam.instanceMatrix.needsUpdate = true;
  }
}
