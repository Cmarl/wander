import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { blobTexture } from "./shadows";
import { LANDMARK_CELL, landmarksNear, type Landmark, type LandmarkKind } from "./landmarks";

/**
 * Draws landmarks.
 *
 * Unlike the scatter, these must NOT fade with distance — being visible from
 * kilometres away is the entire point. They're sized to stay legible through
 * the aerial haze at three to six kilometres, which is roughly three to five
 * minutes of driving: one decision, one journey, one arrival.
 */

/** Keep this many cells of landmarks loaded — about 15 km of horizon. */
const RANGE_CELLS = 7;
const BUDGET = 40;
const STEAM_PER_SPRING = 7;
const STEAM_BUDGET = 180;

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(flat, false);
  if (!m) throw new Error("landmark geometry merge failed");
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Four splayed legs, a platform, a cabin and a pyramid roof. ~21 m. */
function lookout(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    const leg = new THREE.CylinderGeometry(0.42, 0.62, 16.4, 5);
    leg.translate(0, 8.2, 0);
    leg.rotateZ(-sx * 0.055);
    leg.rotateX(sz * 0.055);
    leg.translate(sx * 3.2, 0, sz * 3.2);
    parts.push(leg);
  }
  for (const y of [5.5, 11]) {
    const brace = box(7.4, 0.3, 0.3);
    brace.translate(0, y, 0);
    parts.push(brace);
    const brace2 = box(0.3, 0.3, 7.4);
    brace2.translate(0, y, 0);
    parts.push(brace2);
  }
  const deck = box(9.4, 0.6, 9.4);
  deck.translate(0, 16.6, 0);
  parts.push(deck);
  const cabin = box(6.4, 3.6, 6.4);
  cabin.translate(0, 18.7, 0);
  parts.push(cabin);
  const roof = new THREE.ConeGeometry(5.6, 2.4, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 21.7, 0);
  parts.push(roof);
  for (const [ox, oz, w, d] of [[0, 4.6, 9.4, 0.2], [0, -4.6, 9.4, 0.2], [4.6, 0, 0.2, 9.4], [-4.6, 0, 0.2, 9.4]]) {
    const rail = box(w, 0.9, d);
    rail.translate(ox, 17.4, oz);
    parts.push(rail);
  }
  return merge(parts);
}

/** A semicircle of blocks, wide enough to drive through. ~34 m span. */
function arch(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const R = 17;
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI;
    const seg = box((Math.PI * R) / N + 1.6, 5.2, 7.4);
    seg.rotateZ(a + Math.PI / 2);
    seg.translate(Math.cos(a) * R, Math.sin(a) * R, 0);
    parts.push(seg);
  }
  // Thicken the feet so it reads as rock rather than masonry.
  for (const sx of [-1, 1]) {
    const foot = box(8.4, 4.4, 9.2);
    foot.translate(sx * R, 1.6, 0);
    parts.push(foot);
  }
  return merge(parts);
}

/** A tapered lattice column. Tall and thin — the most legible shape at range. */
function mast(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tower = new THREE.CylinderGeometry(0.55, 2.7, 52, 4);
  tower.translate(0, 26, 0);
  parts.push(tower);
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    const r = 2.7 - t * 2.15;
    const ring = box(r * 2.6, 0.34, r * 2.6);
    ring.translate(0, t * 52, 0);
    parts.push(ring);
  }
  return merge(parts);
}

/** Pool, mineral rim, a scatter of rocks. The steam is a separate layer. */
function spring(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.RingGeometry(7.6, 11.4, 18);
  rim.rotateX(-Math.PI / 2);
  rim.translate(0, 0.3, 0);
  parts.push(rim);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = 2.2 + (i % 4) * 1.1;
    const rock = new THREE.IcosahedronGeometry(r, 0);
    rock.scale(1, 0.7, 1);
    rock.translate(Math.cos(a) * 10.4, 0.2, Math.sin(a) * 10.4);
    parts.push(rock);
  }
  return merge(parts);
}

/** The pool surface, kept separate so it can be its own colour. */
function springPool(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(8.0, 20);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.4, 0);
  return g;
}

/** One enormous old tree on bare ground. ~19 m. */
function loneTree(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.85, 1.7, 11, 6);
  trunk.translate(0, 5.5, 0);
  parts.push(trunk);
  for (const [ox, oy, oz, r] of [[0, 13.5, 0, 6.2], [4.2, 11.4, 1.4, 4], [-3.6, 12, -2.2, 3.6]]) {
    const crown = new THREE.IcosahedronGeometry(r, 0);
    crown.scale(1, 0.78, 1);
    crown.translate(ox, oy, oz);
    parts.push(crown);
  }
  return merge(parts);
}

/** A peer that didn't make it. Close-range discovery, not a distance shape. */
function wreck(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = box(1.9, 0.62, 4.1);
  body.translate(0, 0.92, 0);
  parts.push(body);
  const cab = box(1.72, 0.72, 1.9);
  cab.translate(0, 1.56, -0.25);
  parts.push(cab);
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35]] as [number, number][]) {
    const w = new THREE.CylinderGeometry(0.52, 0.52, 0.38, 8);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.56, z);
    parts.push(w);
  }
  const g = merge(parts);
  g.rotateZ(0.14); // settled on its springs
  return g;
}

const BUILDERS: Record<LandmarkKind, () => THREE.BufferGeometry> = {
  lookout,
  arch,
  mast,
  spring,
  lonetree: loneTree,
  wreck,
};

const TINT: Record<LandmarkKind, number> = {
  lookout: 0x8a6a4e,
  arch: 0xb09672,
  mast: 0x9aa0a6,
  spring: 0xc9bfa8,
  lonetree: 0x4a5b36,
  wreck: 0x6e6256,
};

export class LandmarkField {
  readonly group = new THREE.Group();
  private meshes = new Map<LandmarkKind, THREE.InstancedMesh>();
  private pool: THREE.InstancedMesh;
  private steam: THREE.InstancedMesh;
  private steamAnchors: { x: number; y: number; z: number }[] = [];
  private cellX = NaN;
  private cellZ = NaN;
  /** Everything currently loaded, for collision and discovery. */
  loaded: Landmark[] = [];

  constructor() {
    for (const kind of Object.keys(BUILDERS) as LandmarkKind[]) {
      const mat = new THREE.MeshLambertMaterial({ color: TINT[kind], flatShading: true });
      const mesh = new THREE.InstancedMesh(BUILDERS[kind](), mat, BUDGET);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }

    this.pool = new THREE.InstancedMesh(
      springPool(),
      new THREE.MeshLambertMaterial({ color: 0x4fb7ad, flatShading: true }),
      BUDGET
    );
    this.pool.frustumCulled = false;
    this.pool.count = 0;
    this.group.add(this.pool);

    const puff = new THREE.PlaneGeometry(1, 1);
    this.steam = new THREE.InstancedMesh(
      puff,
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
    const counts = new Map<LandmarkKind, number>();
    let poolN = 0;
    this.steamAnchors.length = 0;

    for (const lm of this.loaded) {
      const mesh = this.meshes.get(lm.kind)!;
      const n = counts.get(lm.kind) ?? 0;
      if (n >= BUDGET) continue;
      pos.set(lm.x, lm.y, lm.z);
      q.setFromAxisAngle(up, lm.rot);
      scl.setScalar(lm.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(n, m);
      counts.set(lm.kind, n + 1);

      if (lm.kind === "spring" && poolN < BUDGET) {
        this.pool.setMatrixAt(poolN++, m);
        this.steamAnchors.push({ x: lm.x, y: lm.y + 1, z: lm.z });
      }
    }

    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.pool.count = poolN;
    this.pool.instanceMatrix.needsUpdate = true;
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
        const phase = ((time * 0.11 + i / STEAM_PER_SPRING + a * 0.37) % 1 + 1) % 1;
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
