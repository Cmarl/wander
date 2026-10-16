import { heightAt, slopeAt, moistureAt, temperatureAt, slotRandom, SEA_LEVEL } from "./field";
import { toWorld } from "./frame";

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
  | "frozenlake"
  | "dock"
  | "airfield"
  | "cave";

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
  dock: "Landing",
  airfield: "Airstrip",
  cave: "Cave",
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
  // The posts are solid; the deck above them is not, since you walk on it.
  dock: [
    { dx: -0.85, dz: -4, r: 0.5 },
    { dx: 0.85, dz: -4, r: 0.5 },
    { dx: -0.85, dz: -12, r: 0.5 },
    { dx: 0.85, dz: -12, r: 0.5 },
  ],
  /**
   * The hangar's walls, and nothing else.
   *
   * It was one 5.5 m disc sixteen metres down the RUNWAY — an invisible
   * bollard in the middle of the strip, with the hangar itself left as
   * scenery you walked through. Clyde asked to be able to walk around and in
   * these, so the three walls are solid and the open front is not: you drive
   * in, park, and walk out past the drums.
   */
  airfield: [
    // Back wall, across the top of the shed.
    ...Array.from({ length: 7 }, (_, i) => ({ dx: 25 + (i - 3) * 2.6, dz: -12.4, r: 1.35 })),
    // The two sides, stopping short of the opening.
    ...Array.from({ length: 5 }, (_, i) => ({ dx: 17.2, dz: -11 + i * 2.6, r: 1.35 })),
    ...Array.from({ length: 5 }, (_, i) => ({ dx: 32.8, dz: -11 + i * 2.6, r: 1.35 })),
    // The windsock mast, which is thin but you should not walk through it.
    { dx: 12, dz: 12, r: 0.5 },
  ],
  // The boulders round the mouth are solid; the opening between them is not.
  cave: [
    { dx: -4.6, dz: -1.5, r: 2.0 },
    { dx: 4.6, dz: -1.5, r: 2.0 },
    { dx: -3.2, dz: 2.4, r: 1.6 },
    { dx: 3.2, dz: 2.4, r: 1.6 },
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

/**
 * A landmark placed on its own merits, ignoring its neighbours.
 *
 * Kept separate so pairing has something to ask about a neighbouring cell
 * without that question asking its own questions.
 */
function baseInCell(gx: number, gz: number): Landmark | null {
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
    /**
     * Somewhere to tie a boat up — but only where a boat could actually float.
     *
     * "Shoreline" here means ground from 1 to 7 m above the water, and on a
     * gentle beach seven metres of elevation is a long way from the sea. A
     * landing placed up there had its jetty ending on dry sand, which is why
     * Clyde found one with no boat at it.
     *
     * The test is the one that matters: is there water deep enough to float a
     * boat within reach of the end of the jetty.
     */
    // The seaward test already implies you are near water, so an extra height
    // cut on top of it was doing nothing but starving the kind: both together
    // produced two landings in seventy-six thousand landmarks.
    if (seawardDepth(x, z) > 0.4) {
      options.push("dock");
      options.push("dock");
    }
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
  /**
   * A cave. Needs rock to be in, so it wants real slope — the same places
   * scree and crags come from. Nobody dug it, so unlike an adit it has no
   * business being on gentle farmland.
   */
  // 0.26 left almost no band at all: the shared check already rejects
  // anything above 0.3, so the window was four hundredths wide and caves came
  // out at one every 47 km. 0.17 still means hilly and nothing like farmland.
  if (slopeAt(x, z, 20) > 0.17 && y > 120 && y < 2600) options.push("cave");
  if (moist < 0.5 && y > 30 && y < 800) options.push("windpump");
  if (moist < 0.35 && y > 60 && y < 1400) options.push("sinkhole");
  // Somebody farmed here. Needs the good ground, same as the steadings.
  if (moist > 0.5 && y > 20 && y < 600 && temp > 0.35) options.push("orchard");
  if (temp < 0.3 && y > 20) options.push("frozenlake");
  // Tundra as well as shoreline, which the brief called for and the shoreline
  // path alone could not deliver — cold tidal ground is a thin slice of a
  // thin slice, and the kind was landing at 0.3% of places.
  if (temp < 0.26 && y > 20 && y < 1100) options.push("bonefield");
  /**
   * An airstrip needs flat ground for two hundred metres, which is a far
   * stricter test than anything else here and is what makes it rare on its
   * own — no extra gate required beyond a modest one.
   *
   * Clyde: "rare, but not overly rare."
   */
  /**
   * An airstrip needs flat ground along its WHOLE length.
   *
   * The old test sampled a 60 m box and allowed 7 m of drop across it — but
   * the strip is 220 m long, so most of it was never measured, and seven
   * metres is not flat by any reading. The result was a runway buried at one
   * end and in the air at the other: Clyde's "it's wonky".
   *
   * It now measures the actual strip, end to end, and asks for ground that
   * somebody could plausibly have graded.
   */
  // Measured: 2.4 m of drop over 224 m passes 0.4% of sites, which produced no
  // airstrips at all. 4.0 passes about 3% and is still ground somebody could
  // plausibly have graded — the slab is built to bridge exactly that much.
  if (y > 25 && y < 900 && stripDrop(x, z) < 4.0 && slotRandom(gx, gz, 1619) > 0.35)
    options.push("airfield");
  if (moist < 0.70 && y > 80 && y < 1500) options.push("lonetree");
  // Rarer than the rest, or every other cell would be a dead truck.
  if (slotRandom(gx, gz, 967) > 0.82) options.push("wreck");
  // Somebody chose to live here, so the ground has to be worth living on:
  // low, sheltered, with something growing. Gated to keep a lone building on a
  // far slope an event rather than scenery.
  // Somebody levelled a site before they built on it, so the ground has to be
  // flat enough to have been worth levelling — measured as the actual drop
  // across the footprint, not as a slope. A wide slope sample smooths over
  // precisely the local relief that buries one corner of a building, which is
  // why tightening it changed nothing.
  if (
    y > 20 &&
    y < 1100 &&
    moist > 0.3 &&
    footprintDrop(x, z, 7) < 2.6 &&
    slotRandom(gx, gz, 1013) > 0.72
  )
    options.push("steading");
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

  /**
   * A jetty has to point at the water.
   *
   * Every landmark gets a random rotation, which is right for a stone arch
   * and wrong for a landing: a dock facing inland puts its mooring on dry
   * ground, and the boat tied up there ends up sitting on a hillside. Clyde:
   * "found a boat landing, no boat."
   *
   * The deck runs out along -z in the model, so the dock is turned until -z
   * points downhill — which, on a shoreline, is out to sea.
   */
  let spin2 = spin * Math.PI * 2;
  if (kind === "dock") spin2 = seaward(x, z).angle;
  // A runway is sited by measuring one axis, so it has to lie along it.
  if (kind === "airfield") spin2 = 0;

  const noun = VARIANT_NAMES[kind]?.[variant] ?? LANDMARK_NAMES[kind];
  const name = `${lead} ${middle} ${noun}`;

  /**
   * Anything with a flat base sits on the LOWEST ground under it.
   *
   * These are placed at one height, so on a slope half the footprint floats
   * and the other half buries itself. Taking the lowest of the corners means
   * nothing ever hovers; the plinth under each building fills whatever gap
   * that leaves on the downhill side, and the ground hides the rest.
   *
   * Clyde: "all the landmarks are quite jank TBH. esp if not on flat ground".
   */
  let base = y;
  /**
   * A graded strip sits on the MEAN of its ground, not the lowest point.
   *
   * Everything else with a flat base takes the minimum so it never hovers,
   * and the plinth fills the gap. A runway is different: it is cut into the
   * high end and filled at the low one, which is how a real one is built and
   * the only way a 220 m slab can meet the ground at both ends.
   */
  if (kind === "airfield") {
    let sum = 0;
    for (let i = -5; i <= 5; i++) sum += heightAt(x, z + (i / 5) * STRIP_HALF_L);
    base = sum / 11;
  } else if (kindNeedsFlatGround(kind)) {
    const r = kind === "steading" ? 6 : 4;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]] as [number, number][]) {
      base = Math.min(base, heightAt(x + dx, z + dz));
    }
  }

  return {
    id: `${gx},${gz}`,
    name,
    kind,
    x,
    z,
    y: base,
    rot: spin2,
    // Was 0.85 to 1.25, which is barely a difference. Clyde asked for bigger
    // and for more variation between them; collision scales with this, so a
    // big one is big to drive into as well as to look at.
    /**
     * The airstrip is the one kind that does not vary in size.
     *
     * Everything about it is measured in absolute metres — the drop along its
     * axis, the clearing, the pads you stand on — and an 85% size range would
     * turn a 224 m strip into a 414 m one while all three of those kept
     * believing it was 224. A runway is also just not a thing that comes in
     * sizes: it is as long as it needs to be to get off the ground.
     */
    scale: kind === "airfield" ? 1 : 1.0 + size * 0.85,
    variant,
    wear,
    gx,
    gz,
  };
}

/** Every landmark whose cell lies within `cells` of the given point. */
/**
 * Pairing — occasionally two landmarks relate.
 *
 * Brainstorm 3.4. Everything else here is placed in isolation, so the world is
 * a scatter of unrelated objects; a mast standing over a settlement, or a
 * wreck at the foot of an arch, turns two objects into a small story about how
 * they came to be near each other.
 *
 * Done by letting a cell SEE ITS NEIGHBOURS before deciding — which is the
 * only mechanism available when nothing is stored. A cell looks at the one
 * north and the one west of it, and if that neighbour is something worth
 * sitting beside, this cell sometimes becomes its companion and moves in
 * The host is resolved with baseInCell, which does NOT pair. That is what
 * stops this recursing: a companion's host is always an unpaired landmark, so
 * the lookup terminates immediately instead of walking north-west forever.
 * It also means you never get chains of three, which would stop reading as a
 * pair and start reading as a cluster.
 */
const COMPANIONS: Partial<Record<LandmarkKind, LandmarkKind[]>> = {
  // Somebody put a mast on the high ground above where they lived.
  steading: ["mast"],
  // A truck that did not make it to the obvious landmark.
  arch: ["wreck"],
  // People leave a lookout and a hut together.
  lookout: ["steading"],
  spring: ["steading"],
  windpump: ["steading"],
};

/**
 * How often an eligible cell actually pairs up.
 *
 * At 0.34 this put a quarter of all landmarks into a pair, which is not
 * "occasionally" — it reads as the world being built in twos. 0.16 lands
 * nearer one in ten, which is often enough to notice and rare enough to be
 * worth noticing.
 */
const PAIR_CHANCE = 0.16;
/** How close a companion sits to the thing it belongs to. */
const PAIR_RANGE = 90;

function pairedWith(gx: number, gz: number): { host: Landmark; kind: LandmarkKind } | null {
  for (const [dx, dz, salt] of [[-1, 0, 1531], [0, -1, 1543]] as [number, number, number][]) {
    if (slotRandom(gx, gz, salt) > PAIR_CHANCE) continue;
    const host = baseInCell(gx + dx, gz + dz);
    if (!host) continue;
    const options = COMPANIONS[host.kind];
    if (!options) continue;
    const kind = options[Math.floor(slotRandom(gx, gz, salt + 2) * options.length) % options.length];
    if (!LANDMARK_NAMES[kind]) continue;
    return { host, kind };
  }
  return null;
}

/**
 * What is in this cell, pairing included.
 *
 * A companion wins over whatever the cell would otherwise have held: it only
 * happens a third of the time on an eligible neighbour, and a mast that stands
 * over a steading is worth more than another unrelated lone tree.
 */
/**
 * How much the ground rises and falls across a footprint, corner to corner.
 *
 * The honest measure for "can a flat-based thing sit here". slopeAt is a
 * gradient over a radius and happily reports a gentle slope for ground that
 * has two metres of lump in the middle of it.
 */
/** Kinds with a flat base, which cannot stand on lumpy ground. */
const FLAT_BASED: LandmarkKind[] = ["steading", "windpump", "lookout", "adit", "mast", "airfield"];
const kindNeedsFlatGround = (k: LandmarkKind) => FLAT_BASED.includes(k);

/**
 * The deepest water within a jetty's reach, and which way it lies.
 *
 * Returns depth below sea level at the best bearing; zero or less means there
 * is nowhere to put a boat.
 */
export function seaward(x: number, z: number): { depth: number; angle: number } {
  let depth = -Infinity;
  let angle = 0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    /**
     * Only the TIP needs water under it.
     *
     * This used to require depth at 10, 15 and 60 m and take the worst, which
     * meant the jetty had to be over water along its whole length. A jetty
     * stands on posts and crosses the beach on the way out — that is what a
     * jetty is for. Demanding water ten metres from shore produced two
     * landings in seventy-six thousand landmarks.
     */
    const tip = SEA_LEVEL - heightAt(x - Math.sin(a) * DOCK_REACH, z - Math.cos(a) * DOCK_REACH);
    if (tip > depth) {
      depth = tip;
      angle = a;
    }
  }
  return { depth, angle };
}

/**
 * How far the jetty runs, and therefore how far out the mooring is.
 *
 * Measured rather than chosen: this coastline is very gentle. From ground
 * one to two metres above the waterline, a 17 m jetty reaches water deep
 * enough to float a boat at 0% of sites, 30 m at 5%, 50 m at 19%, and 80 m at
 * 44%. A short jetty on this terrain simply ends on wet sand, which is
 * exactly what Clyde walked out onto.
 *
 * 60 m, which clears about a third of candidate sites — enough that landings
 * exist, few enough that one is worth finding.
 */
export const DOCK_REACH = 60;

const seawardDepth = (x: number, z: number) => seaward(x, z).depth;

/** Half-length and half-width of the graded strip, matching the geometry. */
export const STRIP_HALF_L = 112;
export const STRIP_HALF_W = 13;
/**
 * How high the graded surface stands above the strip's base.
 *
 * Shared with the geometry and with world/decks, because the number that
 * decides where your feet are and the number that decides where the dirt is
 * drawn have to be the same number or you fall through a runway.
 */
export const STRIP_TOP = 2.2;

/**
 * Drop along the length of a runway, sampled where the runway actually is.
 *
 * Airstrips are placed with no rotation applied to this test because the
 * geometry runs along -z and the landmark's spin is overridden to zero for
 * them — a strip that can point anywhere cannot be sited by measuring one
 * bearing.
 */
export function stripDrop(x: number, z: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = -5; i <= 5; i++) {
    const h = heightAt(x, z + (i / 5) * STRIP_HALF_L);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

function footprintDrop(x: number, z: number, r: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]] as [number, number][]) {
    const h = heightAt(x + dx, z + dz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

export function landmarkInCell(gx: number, gz: number): Landmark | null {
  const pair = pairedWith(gx, gz);
  if (pair) {
    const a = slotRandom(gx, gz, 1549) * Math.PI * 2;
    const r = 34 + slotRandom(gx, gz, 1553) * PAIR_RANGE;
    const x = pair.host.x + Math.cos(a) * r;
    const z = pair.host.z + Math.sin(a) * r;
    const y = heightAt(x, z);
    /**
     * Still has to be somewhere it could stand, and a companion is placed
     * beside its host rather than by the suitability rules — so it has to be
     * checked here too.
     *
     * This was the leak behind buildings on impossible ground: a steading
     * paired to a lookout or a spring skipped the flatness test completely and
     * landed wherever the ring put it, up to fourteen metres of drop across
     * its own footprint.
     */
    const needsFlat = kindNeedsFlatGround(pair.kind);
    if (y >= 6 && slopeAt(x, z, 14) <= 0.3 && (!needsFlat || footprintDrop(x, z, 7) < 2.6)) {
      return build(
        gx,
        gz,
        x,
        z,
        y,
        slotRandom(gx, gz, 1559),
        slotRandom(gx, gz, 1567),
        pair.kind,
        temperatureAt(x, z) - y / 9000,
        moistureAt(x, z)
      );
    }
  }
  return baseInCell(gx, gz);
}

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
  // Via world/frame, which is the only place that knows which way a landmark
  // turns. This function used to rotate the opposite way to the renderer, so
  // on any kind placed at an angle the solids sat mirrored across it — the
  // dock's own posts were on the wrong side of its jetty.
  return LANDMARK_SOLIDS[lm.kind].map((o) => {
    const w = toWorld(lm, o.dx, o.dz);
    return { x: w.x, z: w.z, r: o.r * lm.scale };
  });
}
