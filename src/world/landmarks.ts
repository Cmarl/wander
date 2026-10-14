import { heightAt, slopeAt, moistureAt, temperatureAt, slotRandom } from "./field";

/**
 * Landmarks — the reason to steer somewhere.
 *
 * Placed by hashing a coarse grid, exactly like the props, so a hundred of them
 * cost the same as one: no storage, no streaming, and identical coordinates for
 * every player. Each has a silhouette meant to be legible through the haze from
 * several kilometres out, so a shape on the horizon becomes a question.
 *
 * Suitability is checked against the terrain, which means regions grow their
 * own character for free — arches in dry country, masts on high ground, springs
 * in the temperate lowlands. Cells whose ground suits nothing stay empty, and
 * empty country between landmarks is the product, not dead air.
 */

/** ~2.2 km grid at 54% occupancy, measured at ~2.2 km mean spacing. */
export const LANDMARK_CELL = 2200;
const OCCUPANCY = 0.54;

export type LandmarkKind = "lookout" | "arch" | "mast" | "spring" | "lonetree" | "wreck";

export const LANDMARK_NAMES: Record<LandmarkKind, string> = {
  lookout: "Fire Lookout",
  arch: "Stone Arch",
  mast: "Radio Mast",
  spring: "Hot Spring",
  lonetree: "The Lone Tree",
  wreck: "Abandoned Truck",
};

/** Local-space collision circles, so you can drive *through* an arch. */
export const LANDMARK_SOLIDS: Record<LandmarkKind, { dx: number; dz: number; r: number }[]> = {
  lookout: [
    { dx: -3.2, dz: -3.2, r: 1.1 },
    { dx: 3.2, dz: -3.2, r: 1.1 },
    { dx: -3.2, dz: 3.2, r: 1.1 },
    { dx: 3.2, dz: 3.2, r: 1.1 },
  ],
  arch: [
    { dx: -16, dz: 0, r: 3.4 },
    { dx: 16, dz: 0, r: 3.4 },
  ],
  mast: [
    { dx: -1.8, dz: -1.8, r: 0.9 },
    { dx: 1.8, dz: -1.8, r: 0.9 },
    { dx: -1.8, dz: 1.8, r: 0.9 },
    { dx: 1.8, dz: 1.8, r: 0.9 },
  ],
  spring: [], // a pool is a puddle, not a wall
  lonetree: [{ dx: 0, dz: 0, r: 1.9 }],
  wreck: [{ dx: 0, dz: 0, r: 2.4 }],
};

export interface Landmark {
  /** Stable across sessions and players — it's just the cell. */
  id: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
}

export function landmarkInCell(gx: number, gz: number): Landmark | null {
  if (slotRandom(gx, gz, 907) > OCCUPANCY) return null;

  const jx = slotRandom(gx, gz, 911);
  const jz = slotRandom(gx, gz, 919);
  const pick = slotRandom(gx, gz, 929);
  const spin = slotRandom(gx, gz, 941);
  const size = slotRandom(gx, gz, 953);

  // Keep it off the cell edges so neighbours never crowd each other.
  const x = (gx + (jx - 0.5) * 0.7) * LANDMARK_CELL;
  const z = (gz + (jz - 0.5) * 0.7) * LANDMARK_CELL;
  const y = heightAt(x, z);
  if (y < 6) return null; // not in the sea

  // Wide sample: these are big structures and need ground to stand on.
  if (slopeAt(x, z, 14) > 0.3) return null;

  const moist = moistureAt(x, z);
  const temp = temperatureAt(x, z) - y / 9000;

  const options: LandmarkKind[] = [];
  if (y > 150 && y < 1700) options.push("lookout");
  if (moist < 0.52 && y > 40 && y < 1300) options.push("arch");
  if (y > 420) options.push("mast");
  if (y > 15 && y < 700 && temp > 0.38) options.push("spring");
  if (moist < 0.70 && y > 80 && y < 1500) options.push("lonetree");
  // Rarer than the rest, or every other cell would be a dead truck.
  if (slotRandom(gx, gz, 967) > 0.82) options.push("wreck");
  if (!options.length) return null;

  const kind = options[Math.min(options.length - 1, Math.floor(pick * options.length))];
  return {
    id: `${gx},${gz}`,
    kind,
    x,
    z,
    y,
    rot: spin * Math.PI * 2,
    scale: 0.85 + size * 0.4,
  };
}

/** Every landmark whose cell lies within `cells` of the given point. */
export function landmarksNear(x: number, z: number, cells: number): Landmark[] {
  const cx = Math.round(x / LANDMARK_CELL);
  const cz = Math.round(z / LANDMARK_CELL);
  const out: Landmark[] = [];
  for (let j = -cells; j <= cells; j++) {
    for (let i = -cells; i <= cells; i++) {
      const lm = landmarkInCell(cx + i, cz + j);
      if (lm) out.push(lm);
    }
  }
  return out;
}

/** Solid circles in world space, for collision. */
export function landmarkSolids(lm: Landmark): { x: number; z: number; r: number }[] {
  const c = Math.cos(lm.rot);
  const s = Math.sin(lm.rot);
  return LANDMARK_SOLIDS[lm.kind].map((o) => ({
    x: lm.x + (o.dx * c - o.dz * s) * lm.scale,
    z: lm.z + (o.dx * s + o.dz * c) * lm.scale,
    r: o.r * lm.scale,
  }));
}
