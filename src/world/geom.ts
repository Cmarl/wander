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
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Icosahedrons come back non-indexed and cylinders indexed; mergeGeometries
  // refuses a mixed list, so everything is flattened first.
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(flat, false);
  if (!m) throw new Error("landmark geometry merge failed");
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
