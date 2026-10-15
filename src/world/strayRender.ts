import * as THREE from "three";
import { makeFor, type VehicleClass } from "../game/vehicles";
import { STRAY_CELL, straysNear, type Stray } from "./strays";

/**
 * Draws the vehicles left in the world.
 *
 * A pool of three bodies, repositioned on a cell crossing. A body is only
 * rebuilt when its slot's CLASS changes, so crossing a cell usually costs
 * nothing — these are ordinary meshes rather than instanced geometry, because
 * three of something is not a crowd.
 */

const RANGE_CELLS = 2;
const POOL = 3;

export class StrayField {
  readonly group = new THREE.Group();
  loaded: Stray[] = [];
  /**
   * One stray hidden because the player has taken it over.
   *
   * The world is a pure function so the machine is still out there; what has
   * changed is that the player's own vehicle is now standing in exactly that
   * spot, and drawing both would be two aeroplanes in one place.
   */
  taken: string | null = null;
  private slots: { cls: VehicleClass | null; root: THREE.Group | null; anim: ((d: number, s: number, t: number) => void) | null }[] =
    Array.from({ length: POOL }, () => ({ cls: null, root: null, anim: null }));
  private cellX = NaN;
  private cellZ = NaN;

  update(px: number, pz: number, retake = false) {
    const cx = Math.round(px / STRAY_CELL);
    const cz = Math.round(pz / STRAY_CELL);
    if (!retake && cx === this.cellX && cz === this.cellZ) return;
    this.cellX = cx;
    this.cellZ = cz;

    // Nearest first, so the pool always holds the ones you can actually see.
    this.loaded = straysNear(px, pz, RANGE_CELLS).sort(
      (a, b) => (a.x - px) ** 2 + (a.z - pz) ** 2 - ((b.x - px) ** 2 + (b.z - pz) ** 2)
    );

    for (let i = 0; i < POOL; i++) {
      const slot = this.slots[i];
      const s = this.loaded[i];
      if (!s || s.id === this.taken) {
        if (slot.root) slot.root.visible = false;
        continue;
      }
      if (slot.cls !== s.cls) {
        if (slot.root) this.group.remove(slot.root);
        const v = makeFor(s.cls, s.paint);
        slot.cls = s.cls;
        slot.root = v.root;
        slot.anim = v.animate;
        v.setLights(false);
        this.group.add(v.root);
      }
      const root = slot.root!;
      root.visible = true;
      root.position.set(s.x, s.y, s.z);
      root.rotation.set(0, s.rot, 0);
      // Standing still, with the wheels straight. Called once rather than per
      // frame — nothing here is going anywhere.
      slot.anim?.(0, 0, 0);
    }
  }

  /** The nearest one within range, for claiming. */
  nearest(x: number, z: number, range: number): Stray | null {
    let best: Stray | null = null;
    let bestD = range * range;
    for (const s of this.loaded) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}
