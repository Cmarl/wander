import * as THREE from "three";
import { FORM_LAYERS } from "./buildings";
import { FORM_RADIUS, SETTLEMENT_CELL, settlementsNear, type Form, type Settlement } from "./settlements";

/**
 * Draws settlements.
 *
 * One instanced mesh per layer per form — fifteen draw calls for every hamlet
 * on screen, however many that is. Rebuilt only when you cross a cell, like
 * everything else.
 */

/** Two cells either way is about 48 km of horizon, well past visible range. */
const RANGE_CELLS = 2;
/** Worst observed is 2 settlements in range at 9 buildings; this is generous. */
const BUDGET = 48;

/** Nothing is new out here, same as the landmarks. */
const WEATHERED = new THREE.Color(0.7, 0.71, 0.65);

export class SettlementField {
  readonly group = new THREE.Group();
  private meshes = new Map<Form, THREE.InstancedMesh[]>();
  private cellX = NaN;
  private cellZ = NaN;
  /** In range, for arrival and the HUD. */
  loaded: Settlement[] = [];
  /** Collision circles, in world space. */
  solids: { x: number; z: number; radius: number }[] = [];

  constructor() {
    for (const form of Object.keys(FORM_LAYERS) as Form[]) {
      const meshes = FORM_LAYERS[form].map((layer) => {
        const mesh = new THREE.InstancedMesh(
          layer.geo,
          new THREE.MeshLambertMaterial({ color: layer.colour, flatShading: true }),
          BUDGET
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.group.add(mesh);
        return mesh;
      });
      this.meshes.set(form, meshes);
    }
  }

  update(px: number, pz: number) {
    const cx = Math.round(px / SETTLEMENT_CELL);
    const cz = Math.round(pz / SETTLEMENT_CELL);
    if (cx === this.cellX && cz === this.cellZ) return;
    this.cellX = cx;
    this.cellZ = cz;
    this.rebuild(px, pz);
  }

  private rebuild(px: number, pz: number) {
    this.loaded = settlementsNear(px, pz, RANGE_CELLS);
    this.solids.length = 0;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    const counts = new Map<Form, number>();

    for (const s of this.loaded) {
      for (const b of s.buildings) {
        const n = counts.get(b.form) ?? 0;
        if (n >= BUDGET) continue;
        pos.set(b.x, b.y, b.z);
        q.setFromAxisAngle(up, b.rot);
        scl.setScalar(b.scale);
        m.compose(pos, q, scl);
        tint.setRGB(1, 1, 1).lerp(WEATHERED, b.wear * 0.55);
        for (const mesh of this.meshes.get(b.form)!) {
          mesh.setMatrixAt(n, m);
          mesh.setColorAt(n, tint);
        }
        counts.set(b.form, n + 1);
        this.solids.push({ x: b.x, z: b.z, radius: FORM_RADIUS[b.form] * b.scale });
      }
    }

    for (const [form, meshes] of this.meshes) {
      const n = counts.get(form) ?? 0;
      for (const mesh of meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * The settlement you are in, if any.
   *
   * Generous beyond the furthest building, because "arriving at" a place
   * should fire as you come up the street rather than when you reach the last
   * roof in it.
   */
  nearest(x: number, z: number): { s: Settlement; d: number } | null {
    let best: Settlement | null = null;
    let bestD = Infinity;
    for (const s of this.loaded) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best && bestD < best.reach + 70 ? { s: best, d: bestD } : null;
  }
}
