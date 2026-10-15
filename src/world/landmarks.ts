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

export type LandmarkKind =
  | "lookout"
  | "arch"
  | "mast"
  | "spring"
  | "lonetree"
  | "wreck"
  | "steading";

/**
 * Naming.
 *
 * Every instance gets its own name so finding a second hot spring is finding a
 * different place, not the same label again. Built as
 * [bearing or flavour] + [the country it stands in] + [what it is], all drawn
 * from the same cell hash the landmark itself came from — so the name is
 * stable for every player forever, and nothing has to be stored.
 *
 * The word lists are authored rather than generated. Random syllables read as
 * garbage; a small hand-picked table reads as a map.
 */
const BEARINGS = [
  "Northern", "Northeastern", "Eastern", "Southeastern",
  "Southern", "Southwestern", "Western", "Northwestern",
];

const FLAVOURS = [
  "Hidden", "Upper", "Lower", "Lonely", "Quiet", "Old", "High", "Far",
  "Silver", "Amber", "Still", "Windward", "Sunken", "Pale", "Long", "Crooked",
  "Bright", "Shaded", "Weathered", "Narrow", "Broad", "Cold", "Glad", "Wander",
  "Tern", "Hollowed", "Frostbit", "Sunlit", "Grey", "Gilded",
];

/**
 * Local landforms. The terrain word alone is nearly constant inside a region —
 * everything near a forest is "Forest" — so names collided badly. Mixing in a
 * landform widens the space about tenfold without reading as noise.
 */
const LANDFORMS = [
  "Hollow", "Ridge", "Bend", "Basin", "Gap", "Flats", "Rise", "Draw", "Bluff", "Vale",
];

function terrainWord(y: number, slope: number, temp: number, moist: number): string {
  if (y < 6) return "Shore";
  if (slope > 0.5) return "Scree";
  if (temp < 0.3) return "Tundra";
  if (y > 1500) return "Highland";
  if (moist > 0.66) return "Forest";
  if (moist > 0.46) return "Meadow";
  return "Steppe";
}

export const LANDMARK_NAMES: Record<LandmarkKind, string> = {
  lookout: "Fire Lookout",
  arch: "Stone Arch",
  mast: "Radio Mast",
  spring: "Hot Spring",
  lonetree: "Lone Tree",
  wreck: "Abandoned Truck",
  steading: "Steading",
};

/**
 * Where a kind's variants deserve their own noun.
 *
 * A steading is a cabin, a barn or a line shack depending on which one got
 * built — calling all three "Steading" would waste the only kind whose
 * variants are different BUILDINGS rather than different conditions.
 */
export const VARIANT_NAMES: Partial<Record<LandmarkKind, string[]>> = {
  steading: ["Cabin", "Barn", "Line Shack"],
};

/** Local-space collision circles, so you can drive *through* an arch. */
export const LANDMARK_SOLIDS: Record<LandmarkKind, { dx: number; dz: number; r: number }[]> = {
  // Legs alone left an 11 m gap straight through the middle of the tower. The
  // footprint circle is what actually makes it solid; the legs keep the corners
  // honest. Cross-bracing on the model makes this read as right rather than
  // arbitrary.
  lookout: [
    { dx: 0, dz: 0, r: 4.4 },
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
    { dx: 0, dz: 0, r: 2.3 },
    { dx: -1.8, dz: -1.8, r: 0.9 },
    { dx: 1.8, dz: -1.8, r: 0.9 },
    { dx: -1.8, dz: 1.8, r: 0.9 },
    { dx: 1.8, dz: 1.8, r: 0.9 },
  ],
  // Deliberately passable. It is a pool set into the ground, not a structure,
  // and the whole point of it is to get in — walling it off would be worse
  // than driving through it.
  spring: [],
  lonetree: [{ dx: 0, dz: 0, r: 1.9 }],
  wreck: [{ dx: 0, dz: 0, r: 2.4 }],
  // Covers the largest variant, the barn, so collision never depends on which
  // building got built — the same per-kind simplification as the lookout.
  steading: [
    { dx: 0, dz: 0, r: 3.6 },
    { dx: -3.4, dz: 0, r: 2.1 },
    { dx: 3.4, dz: 0, r: 2.1 },
  ],
};

export interface Landmark {
  /** Stable across sessions and players — it's just the cell. */
  id: string;
  /** This instance's own name, e.g. "Western Forest Hot Spring". */
  name: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
  /** Which structural build this one is. Meaning is per-kind. */
  variant: number;
  /** 0 pristine, 1 long abandoned. Drives colour and what still stands. */
  wear: number;
  /** Its cell, so anything hanging off it can hash from the same seed. */
  gx: number;
  gz: number;
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
  // Somebody chose to live here, so the ground has to be worth living on:
  // low, sheltered, with something growing. Gated to keep a lone building on a
  // far slope an event rather than scenery.
  if (y > 20 && y < 1100 && moist > 0.3 && slotRandom(gx, gz, 1013) > 0.72) options.push("steading");
  if (!options.length) return null;

  const kind = options[Math.min(options.length - 1, Math.floor(pick * options.length))];

  // Roughly half the places are named for where they lie, the rest for how
  // they look. A map that was all compass points would read as a spreadsheet.
  const wordPick = slotRandom(gx, gz, 971);
  const octant = Math.round((((Math.atan2(x, -z) * 4) / Math.PI + 8) % 8)) % 8;
  const lead =
    wordPick < 0.22
      ? BEARINGS[octant]
      : FLAVOURS[Math.min(FLAVOURS.length - 1, Math.floor(slotRandom(gx, gz, 977) * FLAVOURS.length))];
  const middlePick = slotRandom(gx, gz, 983);
  const middle =
    middlePick < 0.55
      ? terrainWord(y, slopeAt(x, z, 14), temp, moist)
      : LANDFORMS[Math.min(LANDFORMS.length - 1, Math.floor(slotRandom(gx, gz, 991) * LANDFORMS.length))];
  // Variant and wear are independent hashes, so the same kind is rarely the
  // same object twice: a burnt lookout, a weathered one, a pristine one.
  const variant = Math.floor(slotRandom(gx, gz, 997) * 3) % 3;
  const wear = slotRandom(gx, gz, 1009);

  const noun = VARIANT_NAMES[kind]?.[variant] ?? LANDMARK_NAMES[kind];
  const name = `${lead} ${middle} ${noun}`;

  return {
    id: `${gx},${gz}`,
    name,
    kind,
    x,
    z,
    y,
    rot: spin * Math.PI * 2,
    scale: 0.85 + size * 0.4,
    variant,
    wear,
    gx,
    gz,
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
