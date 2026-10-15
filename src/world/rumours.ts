import { heightAt, moistureAt, slopeAt, slotRandom } from "./field";
import { landmarksNear, type Landmark, type LandmarkKind } from "./landmarks";
import { regionAt } from "./regions";

/**
 * Rumours — a description and a direction, never a marker.
 *
 * A radio mast you tune into, or a noticeboard in a hamlet, tells you about
 * somewhere that genuinely exists at a real coordinate. It creates a reason to
 * go without a quest marker: you get words and a rough bearing, and then you
 * go and LOOK, which is the loop the binoculars and pins already serve.
 *
 * Nothing here points at anything. The journal records the words, and pinning
 * it is your decision — a marker you placed, which is the only kind this game
 * has.
 */

export interface Rumour {
  /** Stable, so hearing the same rumour twice doesn't duplicate it. */
  id: string;
  /** The whole thing, as one readable sentence. */
  text: string;
  /**
   * The short form, for a pin.
   *
   * Deliberately the description and not the place's real name. You were told
   * about it, so the compass should say "water that steams in the cold" until
   * you get there and the place introduces itself — and the full sentence
   * would not fit under a compass anyway.
   */
  short: string;
  name: string;
  x: number;
  z: number;
  region: string;
}

/**
 * How a kind looks to somebody describing it from memory.
 *
 * These double as pin labels, which is why none of them runs long: the label
 * sits on one unwrapped line under the compass with a range appended, and the
 * longest real landmark name it already has to fit is 35 characters. Anything
 * much past that overflows on a phone in portrait. There is a test for it.
 */
const LOOKS: Record<LandmarkKind, string[]> = {
  lookout: ["a tower on stilts", "a watchtower with its windows out", "somebody's lookout"],
  arch: ["a hole worn clean through the rock", "a stone arch, wide enough to drive", "a span of rock"],
  mast: ["a mast guyed down with wire", "an aerial on the skyline", "a relay nobody services"],
  spring: ["water that steams in the cold", "a hot pool", "a spring you can sit in"],
  lonetree: ["one tree on its own", "a tree the wind has bent double", "a single old tree"],
  wreck: ["a truck nobody came back for", "a rusted-out cab", "a wreck off the track"],
  steading: ["a roof with nobody under it", "somebody's place, left", "a building on a far slope"],
  shipwreck: ["a hull up on the sand", "a ship aground", "ribs of a boat in the shallows"],
  stones: ["pale stones stood on end", "stones somebody raised", "a ring of old stones"],
  adit: ["a hole timbered into the hillside", "an old working", "a mine mouth breathing cold air"],
  windpump: ["a fan that still turns", "a windpump over a tank", "something turning, miles off"],
  sinkhole: ["ground that has fallen in", "a hole with no bottom to it", "a pit in the rock"],
  bonefield: ["bones the size of a boat", "ribs standing out of the ground", "something enormous, long dead"],
  orchard: ["trees planted in rows", "an orchard gone wild", "fruit trees somebody set out"],
  frozenlake: ["ice flat as a table", "a lake frozen right over", "water gone hard"],
};

/**
 * Where it sits, read off the terrain rather than hashed.
 *
 * A hashed setting would sometimes say "out on the flat" about something on a
 * mountainside. Everything else in this world is derived from the world and is
 * therefore true, and a rumour that can be wrong about the ground is worth
 * less than one that cannot.
 */
function settingOf(x: number, z: number): string {
  const h = heightAt(x, z);
  if (h < 34) return "down near the water";
  if (h > 1700) return "above the treeline";
  if (slopeAt(x, z, 20) > 0.22) return "where the ground breaks up";

  // Ridge or hollow, by how the ground around it sits.
  let around = 0;
  for (const [dx, dz] of [[400, 0], [-400, 0], [0, 400], [0, -400]] as [number, number][]) {
    around += heightAt(x + dx, z + dz);
  }
  const rel = h - around / 4;
  if (rel > 45) return "up on a bald ridge";
  if (rel < -45) return "down in a hollow";

  const moist = moistureAt(x, z);
  if (moist > 0.66) return "in among the trees";
  if (moist < 0.3) return "where nothing else grows";
  return "out on the flat";
}

const BEARINGS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/**
 * Distance in the terms somebody would actually use.
 *
 * An hour of real time is a day in the game, so "a day" is a real unit here
 * rather than flavour — but nobody says "eleven kilometres", so neither does
 * a rumour.
 */
function howFar(m: number): string {
  if (m < 6000) return "not far";
  if (m < 12000) return "a morning's drive";
  if (m < 20000) return "most of a day";
  if (m < 32000) return "a day or so";
  return "a good two days";
}

/**
 * A rumour heard at a given spot.
 *
 * The target is found by picking a bearing and a distance from the hash and
 * then looking for a landmark NEAR that point, rather than scanning every cell
 * within forty kilometres — which would be about fifteen hundred cells of
 * terrain sampling for one line of text.
 *
 * Returns null when there is genuinely nothing out that way, which is honest:
 * an empty quarter should stay empty rather than inventing something.
 */
export function rumourAt(gx: number, gz: number, salt: number, fromX: number, fromZ: number): Rumour | null {
  const bearing = Math.floor(slotRandom(gx, gz, salt) * 8) % 8;
  const dist = 7000 + slotRandom(gx, gz, salt + 1) * 31000;
  // Screen bearings: north is -z, and east is +x.
  const a = (bearing / 8) * Math.PI * 2;
  const tx = fromX + Math.sin(a) * dist;
  const tz = fromZ - Math.cos(a) * dist;

  let best: Landmark | null = null;
  let bestD = Infinity;
  for (const lm of landmarksNear(tx, tz, 2)) {
    const d = Math.hypot(lm.x - tx, lm.z - tz);
    if (d < bestD) {
      bestD = d;
      best = lm;
    }
  }
  if (!best) return null;

  const looks = LOOKS[best.kind];
  const look = looks[Math.floor(slotRandom(gx, gz, salt + 2) * looks.length) % looks.length];
  const setting = settingOf(best.x, best.z);
  const region = regionAt(best.x, best.z).name;
  const away = Math.hypot(best.x - fromX, best.z - fromZ);

  // Half name the country it is in, half just the direction. Always one or the
  // other, never a coordinate — you are being told, not shown.
  const where =
    slotRandom(gx, gz, salt + 4) < 0.5
      ? `${BEARINGS[bearing]} of here, in ${region}`
      : `${howFar(away)} ${BEARINGS[bearing]} of here`;

  return {
    id: `rumour:${best.id}`,
    text: `${look} ${setting}, ${where}`,
    short: look,
    name: best.name,
    x: Math.round(best.x),
    z: Math.round(best.z),
    region,
  };
}
