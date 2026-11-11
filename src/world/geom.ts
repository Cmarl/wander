import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Shared geometry helpers for landmark models.
 *
 * Extracted so the builders can live in more than one file — the noun list is
 * fourteen kinds now and one module holding every one of them was becoming the
 * largest file in the project for no structural reason.
 */

export interface Layer {
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
  /**
   * Spins about Y, for the only landmark that moves. Driven per frame rather
   * than baked into the instance matrix like everything else.
   */
  spin?: number;
  /**
   * How this layer meets the ground it stands on. See `fitGeometry`. Absent
   * means the kind's default, which is in world/landmarkFit.
   */
  fit?: Fit;
  /** False for things you walk on or through: water, ice, a pit, an interior. */
  solid?: boolean;
}

/**
 * How a piece of a landmark meets uneven ground.
 *
 * Clyde, of a stone arch with one foot in the air: "they don't give a fuck
 * about the terrain they sit on."
 *
 * Every landmark is ONE transform: a position, a turn and a size. Its model is
 * built on a flat plane, so on any slope the downhill side floated and the
 * uphill side was buried, and no amount of choosing a better base height can
 * fix that for a thing forty metres wide.
 *
 * So each vertex now carries an anchor — a point in the model's own plan —
 * and the vertex shader asks the terrain how high the ground really is under
 * that anchor and moves the vertex by the difference. What differs between
 * things is only what the anchor is:
 *
 *   rigid    no anchor. Sits level at the landmark's own height. Water, ice.
 *   scatter  every separate part anchors at its own middle and moves as a
 *            whole. Each standing stone, each tree in an orchard, each
 *            boulder stands on its own ground.
 *   block    the whole layer moves as one, from the middle of the layer.
 *   foot     each vertex anchors at itself, fading out with height. The
 *            bottom of a wall or a tower leg stretches down (or up) to meet
 *            the ground and the top stays where it was built.
 */
export type Fit = "rigid" | "scatter" | "block" | { foot: number };

/** A part bigger than this across is not a boulder; it gets a footing instead. */
const SCATTER_MAX = 9;

/**
 * Write the anchors for a geometry. Leaves alone anything that already has
 * them, so a builder that knows better — an arch, whose span has to hang
 * between two feet — can say so itself.
 */
export function fitGeometry(geo: THREE.BufferGeometry, fit: Fit): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const n = pos.count;
  const had = geo.getAttribute("aAnchor") as THREE.BufferAttribute | undefined;
  const a = had ? (had.array as Float32Array) : new Float32Array(n * 3);
  if (!had) for (let i = 0; i < n; i++) a[i * 3 + 2] = -1;
  // Only vertices nobody has spoken for. -1 is "undecided".
  const open = (i: number) => a[i * 3 + 2] < 0;
  const foot = (from: number, count: number, h: number) => {
    for (let i = from; i < from + count; i++) {
      if (!open(i)) continue;
      a[i * 3] = pos.getX(i);
      a[i * 3 + 1] = pos.getZ(i);
      a[i * 3 + 2] = Math.min(1, Math.max(0, 1 - pos.getY(i) / h));
    }
  };
  const whole = (from: number, count: number) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = from; i < from + count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (Math.hypot(x1 - x0, z1 - z0) > SCATTER_MAX && fit === "scatter") return foot(from, count, 2);
    for (let i = from; i < from + count; i++) {
      if (!open(i)) continue;
      a[i * 3] = (x0 + x1) / 2;
      a[i * 3 + 1] = (z0 + z1) / 2;
      a[i * 3 + 2] = 1;
    }
  };
  if (fit === "block") whole(0, n);
  else if (fit === "scatter") {
    const parts = (geo.userData.parts as [number, number][] | undefined) ?? [[0, n]];
    for (const [from, count] of parts) whole(from, count);
  } else if (fit !== "rigid") foot(0, n, fit.foot);
  // Whatever is still undecided stays level, which is what rigid means.
  for (let i = 0; i < n; i++) if (a[i * 3 + 2] < 0) a[i * 3 + 2] = 0;
  if (!had) {
    geo.setAttribute("aAnchor", new THREE.BufferAttribute(a, 3));
    geo.setAttribute("aAnchorB", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  } else {
    had.needsUpdate = true;
  }
  return geo;
}

/**
 * Hang a part between two anchors: `t` 0 at the first, 1 at the second.
 *
 * For anything that spans — a lintel across two stones, the span of an arch —
 * where each end has to follow its own foot and the middle has to stay a
 * straight line between them rather than following the bumps underneath.
 */
export function span(
  geo: THREE.BufferGeometry,
  ax: number, az: number, bx: number, bz: number,
  t: (x: number, y: number, z: number) => number
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  const a = new Float32Array(pos.count * 3);
  const b = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    a[i * 3] = ax; a[i * 3 + 1] = az; a[i * 3 + 2] = 1;
    b[i * 3] = bx; b[i * 3 + 1] = bz;
    b[i * 3 + 2] = Math.min(1, Math.max(0, t(pos.getX(i), pos.getY(i), pos.getZ(i))));
  }
  g.setAttribute("aAnchor", new THREE.BufferAttribute(a, 3));
  g.setAttribute("aAnchorB", new THREE.BufferAttribute(b, 3));
  return g;
}

/** Stand a part on the ground at one point, moving as a whole. */
export function stand(geo: THREE.BufferGeometry, ax: number, az: number): THREE.BufferGeometry {
  return span(geo, ax, az, 0, 0, () => 0);
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  /**
   * An empty list is legitimate and must not throw.
   *
   * A barn has no stove, so its interior's "dark" parts list is empty, and
   * mergeGeometries dereferences the first element without checking — which
   * took the whole game down at module load, because the building kit is built
   * at module scope. Six deploys shipped on top of it.
   *
   * Zero vertices draws nothing, which is exactly what no parts should mean.
   */
  if (!parts.length) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    return empty;
  }
  // Icosahedrons come back non-indexed and cylinders indexed; mergeGeometries
  // refuses a mixed list, so everything is flattened first.
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  /**
   * Anchors are all-or-nothing across a merge, because mergeGeometries
   * refuses a list whose members disagree about which attributes exist. A
   * part that set its own keeps them; one that did not gets zeros, meaning
   * "decide for me later" — and since fitGeometry only fills in a geometry
   * with NO anchors, a mixed layer marks the undecided ones with weight -1.
   */
  const anchored = flat.some((g) => g.getAttribute("aAnchor"));
  if (anchored) {
    for (const g of flat) {
      if (g.getAttribute("aAnchor")) continue;
      const n = g.getAttribute("position").count;
      const undecided = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) undecided[i * 3 + 2] = -1;
      g.setAttribute("aAnchor", new THREE.BufferAttribute(undecided, 3));
      g.setAttribute("aAnchorB", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    }
  }
  const m = mergeGeometries(flat, false);
  if (!m) throw new Error("landmark geometry merge failed");
  // Remember where each part begins, so a later pass can treat a layer as the
  // separate stones and posts it was built from. Nested merges flatten.
  const ranges: [number, number][] = [];
  let at = 0;
  for (const g of flat) {
    const n = g.getAttribute("position").count;
    const inner = g.userData.parts as [number, number][] | undefined;
    if (inner) for (const [from, count] of inner) ranges.push([at + from, count]);
    else ranges.push([at, n]);
    at += n;
  }
  m.userData.parts = ranges;
  return m;
}

/** A strut between two points, for bracing, stairs and guy wires. */
export function strut(
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

/** A rough boulder — the workhorse for anything stone. */
export function rock(r: number, squash = 0.7, seed = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1, squash, 0.9 + (seed % 3) * 0.07);
  g.rotateY(seed * 1.31);
  g.rotateZ(seed * 0.37);
  return g;
}
