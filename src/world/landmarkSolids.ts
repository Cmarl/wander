import * as THREE from "three";
import type { Layer } from "./geom";
import { toWorld } from "./frame";
import { isSolid } from "./landmarkFit";
import { LANDMARK_SOLIDS, type Landmark, type LandmarkKind } from "./landmarks";

/**
 * What you bump into, worked out from what you can see.
 *
 * Clyde: "many of them you can just walk right through."
 *
 * Collision for landmarks was a hand-written list of circles per kind, and a
 * hand-written list goes stale the moment the model changes: the shipwreck
 * was rebuilt eight metres longer and kept three circles from the old one;
 * an orchard was solid on its outer rows only; a bone field had one circle
 * for twenty ribs; the dead tree over a spring had none.
 *
 * So the list is now derived. Every triangle of every solid layer is sampled,
 * and wherever there is geometry at body height — between knee and head — the
 * ground plan gets a mark. Marks are then covered with circles, big ones
 * where a whole block is full and small ones round the edges. The answer is
 * "what is actually there", per kind AND per variant, and it stays right when
 * the model changes because it is read off the model.
 *
 * Height matters: the span of an arch is twelve metres overhead and is not
 * in your way; the lintel of a stone ring is not either. Only what crosses
 * the band you occupy counts.
 */

/** The slice of height a person or a truck occupies, in model metres. */
const BAND_LO = 0.7;
const BAND_HI = 2.1;
const CELL = 0.8;

interface Circle { dx: number; dz: number; r: number }

/** Kinds whose decks and ramps are surfaces you stand on, kept by hand. */
const BY_HAND: LandmarkKind[] = ["airfield", "dock"];

const cache = new Map<string, Circle[]>();
let builders: Record<LandmarkKind, () => Layer[]> | null = null;
const layerCache = new Map<LandmarkKind, Layer[]>();

/** Given the builders once, at start-up, so this file does not import the renderer. */
export function useBuilders(b: Record<LandmarkKind, () => Layer[]>) {
  builders = b;
}

function circlesFor(kind: LandmarkKind, variant: number): Circle[] {
  const key = `${kind}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!builders || BY_HAND.includes(kind)) {
    cache.set(key, LANDMARK_SOLIDS[kind]);
    return LANDMARK_SOLIDS[kind];
  }
  let layers = layerCache.get(kind);
  if (!layers) layerCache.set(kind, (layers = builders[kind]()));

  const marks = new Set<string>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  layers.forEach((layer, index) => {
    if (layer.on && !layer.on.includes(variant)) return;
    if (!isSolid(kind, index, layer)) return;
    const pos = layer.geo.getAttribute("position");
    const idx = layer.geo.index;
    const tris = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      if (Math.max(a.y, b.y, c.y) < BAND_LO || Math.min(a.y, b.y, c.y) > BAND_HI) continue;
      // Sample the triangle finely enough that no cell it crosses is missed.
      const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (CELL * 0.5)));
      for (let u = 0; u <= n; u++) {
        for (let v = 0; v <= n - u; v++) {
          const wa = u / n, wb = v / n, wc = 1 - wa - wb;
          const y = a.y * wa + b.y * wb + c.y * wc;
          if (y < BAND_LO || y > BAND_HI) continue;
          const x = a.x * wa + b.x * wb + c.x * wc;
          const z = a.z * wa + b.z * wb + c.z * wc;
          marks.add(`${Math.round(x / CELL)},${Math.round(z / CELL)}`);
        }
      }
    }
  });

  // Cover the marks: whole 4x4 and 2x2 blocks first, then what is left over.
  const out: Circle[] = [];
  const has = (i: number, j: number) => marks.has(`${i},${j}`);
  const cells = [...marks].map((k) => k.split(",").map(Number) as [number, number]);
  for (const size of [4, 2]) {
    for (const [i, j] of cells) {
      if (i % size !== 0 || j % size !== 0) continue;
      let full = true;
      for (let di = 0; di < size && full; di++) for (let dj = 0; dj < size && full; dj++) full = has(i + di, j + dj);
      if (!full) continue;
      for (let di = 0; di < size; di++) for (let dj = 0; dj < size; dj++) marks.delete(`${i + di},${j + dj}`);
      const mid = (size - 1) / 2;
      out.push({ dx: (i + mid) * CELL, dz: (j + mid) * CELL, r: size * CELL * 0.6 });
    }
  }
  for (const k of marks) {
    const [i, j] = k.split(",").map(Number);
    out.push({ dx: i * CELL, dz: j * CELL, r: CELL * 0.62 });
  }
  cache.set(key, out);
  return out;
}

/**
 * Solid circles in world space, for collision.
 *
 * Remembered per landmark: this is asked every frame for everything nearby,
 * and a cave is five hundred circles that never move.
 */
const placed = new Map<string, { x: number; z: number; r: number }[]>();
export function solidsFor(lm: Landmark): { x: number; z: number; r: number }[] {
  const key = `${lm.kind}:${lm.id}`;
  let out = placed.get(key);
  if (!out) {
    out = circlesFor(lm.kind, lm.variant).map((o) => {
      const w = toWorld(lm, o.dx, o.dz);
      return { x: w.x, z: w.z, r: o.r * lm.scale };
    });
    if (placed.size > 60) placed.clear();
    placed.set(key, out);
  }
  return out;
}

/** For the probe: how many circles a kind and variant comes to. */
export const solidCount = (kind: LandmarkKind, variant: number) => circlesFor(kind, variant).length;
