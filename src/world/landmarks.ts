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
  | "steading"
  | "shipwreck"
  | "stones"
  | "adit"
  | "windpump"
  | "sinkhole"
  | "bonefield"
  | "orchard"
  | "frozenlake";

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
  shipwreck: "Wreck",
  stones: "Standing Stones",
  adit: "Mine Adit",
  windpump: "Windpump",
  sinkhole: "Sinkhole",
  bonefield: "Bone Field",
  orchard: "Orchard",
  frozenlake: "Frozen Lake",
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
  stones: ["Stone Ring", "Stone Avenue", "Fallen Stones"],
  shipwreck: ["Shipwreck", "Broken Hull", "Ship's Bones"],
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
  // A hull along its spine, like the truck but very much larger.
  shipwreck: [
    { dx: 0, dz: -7, r: 3.0 },
    { dx: 0, dz: 0, r: 3.4 },
    { dx: 0, dz: 7, r: 3.0 },
  ],
  // Individual stones, so you drive BETWEEN them — a ring you can enter is
  // worth far more than a solid disc you bounce off.
  stones: Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return { dx: Math.cos(a) * 9.5, dz: Math.sin(a) * 9.5, r: 1.2 };
  }),
  adit: [
    { dx: -1.6, dz: 0, r: 1.0 },
    { dx: 1.6, dz: 0, r: 1.0 },
  ],
  windpump: [
    { dx: 0, dz: 0, r: 2.0 },
    { dx: 5.5, dz: 1.5, r: 2.4 },
  ],
  // The rim is solid; the hole is not, because the only interesting thing you
  // can do with a sinkhole is get too close to it.
  sinkhole: Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return { dx: Math.cos(a) * 13, dz: Math.sin(a) * 13, r: 2.2 };
  }),
  // Ribs are bone, not wall. Driving through a skeleton is the better feeling.
  bonefield: [{ dx: 0, dz: 11.5, r: 2.4 }],
  // Trunks only, on the outer rows — an orchard you can drive down is the
  // whole appeal of rows.
  orchard: Array.from({ length: 12 }, (_, i) => {
    const col = i % 6;
    const row = i < 6 ? -2 : 2;
    return { dx: (col - 2.5) * 6.2, dz: row * 6.6, r: 0.6 };
  }),
  // Deliberately passable. Walking out onto it is the point.
  frozenlake: [],
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
  // Below this the ground is tidal or submerged. Two kinds belong down there
  // and nothing else does — shorelines previously had to borrow the inland kit.
  const shore = y >= 1 && y < 7;
  if (y < 1) return null;

  // Wide sample: these are big structures and need ground to stand on.
  if (slopeAt(x, z, 14) > 0.3) return null;

  const moist = moistureAt(x, z);
  const temp = temperatureAt(x, z) - y / 9000;

  const options: LandmarkKind[] = [];
  if (shore) {
    options.push("shipwreck");
    if (temp < 0.45) options.push("bonefield");
    // Nothing inland is eligible on tidal ground, so this returns early.
    const kindShore = options[Math.min(options.length - 1, Math.floor(pick * options.length))];
    return build(gx, gz, x, z, y, spin, size, kindShore, temp, moist);
  }
  if (y > 150 && y < 1700) options.push("lookout");
  if (moist < 0.52 && y > 40 && y < 1300) options.push("arch");
  if (y > 420) options.push("mast");
  if (y > 15 && y < 700 && temp > 0.38) options.push("spring");
  // Human but ancient, which is a different register from "somebody built
  // this" — open grazing country, where real ones are.
  if (moist > 0.3 && moist < 0.72 && y > 40 && y < 900) options.push("stones");
  // A hole you can stand in, up where the rock is.
  if (y > 500 && y < 2200) options.push("adit");
  if (moist < 0.5 && y > 30 && y < 800) options.push("windpump");
  if (moist < 0.35 && y > 60 && y < 1400) options.push("sinkhole");
  // Somebody farmed here. Needs the good ground, same as the steadings.
  if (moist > 0.5 && y > 20 && y < 600 && temp > 0.35) options.push("orchard");
  if (temp < 0.3 && y > 20) options.push("frozenlake");
  // Tundra as well as shoreline, which the brief called for and the shoreline
  // path alone could not deliver — cold tidal ground is a thin slice of a
  // thin slice, and the kind was landing at 0.3% of places.
  if (temp < 0.26 && y > 20 && y < 1100) options.push("bonefield");
  if (moist < 0.70 && y > 80 && y < 1500) options.push("lonetree");
  // Rarer than the rest, or every other cell would be a dead truck.
  if (slotRandom(gx, gz, 967) > 0.82) options.push("wreck");
  // Somebody chose to live here, so the ground has to be worth living on:
  // low, sheltered, with something growing. Gated to keep a lone building on a
  // far slope an event rather than scenery.
  if (y > 20 && y < 1100 && moist > 0.3 && slotRandom(gx, gz, 1013) > 0.72) options.push("steading");
  if (!options.length) return null;

  const kind = options[Math.min(options.length - 1, Math.floor(pick * options.length))];
  return build(gx, gz, x, z, y, spin, size, kind, temp, moist);
}

/**
 * Name it, pick its build, and hand back the landmark.
 *
 * Shared because shoreline kinds are chosen on a separate early path — tidal
 * ground has its own eligible set and nothing inland qualifies there.
 */
function build(
  gx: number,
  gz: number,
  x: number,
  z: number,
  y: number,
  spin: number,
  size: number,
  kind: LandmarkKind,
  temp: number,
  moist: number
): Landmark {
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
/**
 * How hard a geyser is going, 0..1, for a given time of day.
 *
 * About one hot spring in five is a geyser, and each one erupts on ONE hour of
 * the day that it owns — not every hour. A game hour is only two and a half
 * real minutes, so blowing on all of them put a geyser in eruption a quarter
 * of the time, which is not a condition, it is a schedule. Once a day means
 * once a real hour, for about forty seconds.
 *
 * Returns 0 for springs that are not geysers at all, so callers can use this
 * as the whole test.
 */
export function geyserLevel(lm: Landmark, timeOfDay: number): number {
  if (lm.kind !== "spring") return 0;
  if (slotRandom(lm.gx, lm.gz, 1511) <= 0.8) return 0;
  const its = Math.floor(slotRandom(lm.gx, lm.gz, 1523) * 24) % 24;
  const hour = timeOfDay * 24;
  // Shortest distance round the clock, so an eruption at midnight works.
  const d = Math.abs(((hour - its + 36) % 24) - 12);
  const from = 12 - d;
  // About forty real seconds either side, as a fraction of one game hour.
  return 1 - Math.min(1, from / 0.28);
}

export function landmarkSolids(lm: Landmark): { x: number; z: number; r: number }[] {
  const c = Math.cos(lm.rot);
  const s = Math.sin(lm.rot);
  return LANDMARK_SOLIDS[lm.kind].map((o) => ({
    x: lm.x + (o.dx * c - o.dz * s) * lm.scale,
    z: lm.z + (o.dx * s + o.dz * c) * lm.scale,
    r: o.r * lm.scale,
  }));
}
