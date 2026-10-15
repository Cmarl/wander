import { heightAt, reliefAt, densityAt, slotRandom } from "./field";

/**
 * Regions.
 *
 * The terrain already varies continuously — relief and density are smooth
 * fields, so country shades from flats into mountains without a seam. What was
 * missing was *identity*: travelling felt like the same generator rolling
 * different dice rather than like going somewhere.
 *
 * A region is therefore just a name and a character pinned to the nearest of a
 * jittered 48 km grid of centres, classified by sampling the same fields at
 * that centre. Borders are irregular because the centres are jittered, and
 * nothing about the terrain changes at them.
 */

export const REGION_CELL = 48000;

export type RegionKind = "flats" | "heights" | "coast" | "wild" | "basin";

export interface Region {
  id: string;
  name: string;
  kind: RegionKind;
  /** Centre, so things can be placed relative to the region itself. */
  x: number;
  z: number;
  relief: number;
  density: number;
}

const ADJECTIVES = [
  "Long", "Low", "High", "Broken", "Still", "Pale", "Ashen", "Green", "Cold",
  "Far", "Wide", "Quiet", "Salt", "Iron", "Amber", "Hollow", "Grey", "Old",
];

const NOUNS: Record<RegionKind, string[]> = {
  flats: ["Flats", "Levels", "Lowlands", "Meadows", "Vale"],
  heights: ["Heights", "Peaks", "Spine", "Crags", "Reach"],
  coast: ["Coast", "Shore", "Strand", "Sound", "Narrows"],
  wild: ["Wilds", "Barrens", "Waste", "Expanse", "Moor"],
  basin: ["Basin", "Hollow", "Bowl", "Weald"],
};

/** What kind of country the centre of a region is. */
function classify(x: number, z: number): { kind: RegionKind; relief: number; density: number } {
  const relief = reliefAt(x, z);
  const density = densityAt(x, z);
  const h = heightAt(x, z);
  let kind: RegionKind;
  // Coast means a shoreline, not deep water. Without the lower bound every
  // centre that happened to land in open sea was named for a coast, which
  // made more than half the world "coast".
  if (h < 34 && h > -140) kind = "coast";
  else if (relief > 0.62) kind = "heights";
  else if (relief < 0.34) kind = "flats";
  else if (density < 0.34) kind = "wild";
  else kind = "basin";
  return { kind, relief, density };
}

const cache = new Map<string, Region>();

function regionOfCell(gx: number, gz: number): Region {
  const id = `${gx},${gz}`;
  const hit = cache.get(id);
  if (hit) return hit;

  // Jitter the centre so region borders aren't a visible lattice.
  const x = (gx + (slotRandom(gx, gz, 1451) - 0.5) * 0.62) * REGION_CELL;
  const z = (gz + (slotRandom(gx, gz, 1453) - 0.5) * 0.62) * REGION_CELL;
  const { kind, relief, density } = classify(x, z);

  const nouns = NOUNS[kind];
  const adj = ADJECTIVES[Math.floor(slotRandom(gx, gz, 1459) * ADJECTIVES.length) % ADJECTIVES.length];
  const noun = nouns[Math.floor(slotRandom(gx, gz, 1471) * nouns.length) % nouns.length];

  const region: Region = { id, name: `The ${adj} ${noun}`, kind, x, z, relief, density };
  // Bounded: a session visits a handful of regions, not thousands.
  if (cache.size > 256) cache.clear();
  cache.set(id, region);
  return region;
}

/** Whichever region centre is nearest. Irregular borders, no seams. */
export function regionAt(x: number, z: number): Region {
  const gx = Math.round(x / REGION_CELL);
  const gz = Math.round(z / REGION_CELL);
  let best = regionOfCell(gx, gz);
  let bestD = Infinity;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const r = regionOfCell(gx + i, gz + j);
      const d = (r.x - x) ** 2 + (r.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
  }
  return best;
}
