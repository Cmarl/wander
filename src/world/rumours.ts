import { heightAt, moistureAt, slopeAt, slotRandom } from "./field";
import { landmarksNear, type Landmark, type LandmarkKind } from "./landmarks";
import { regionAt } from "./regions";
import { monumentsNear, type Monument, type MonumentKind } from "./monuments";
import { straysNear, type Stray } from "./strays";
import { SPECS } from "../game/vehicles";

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
  dock: ["a jetty out over the water", "somebody's landing", "a boat tied up"],
  airfield: ["a strip cut into the grass", "a shed and a windsock", "somewhere aeroplanes land"],
  cave: ["a hole in the hillside", "a mouth in the rock", "a cave nobody dug"],
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
  if (m < 1500) return "close by,";
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
  return describe(best, fromX, fromZ, gx, gz, salt);
}

/**
 * A rumour about one particular landmark, as told from one particular spot.
 *
 * Split out of rumourAt so that anything which already knows WHICH place it
 * wants to talk about — the view from the top of a tower, say — tells it in
 * the same words a radio would.
 */
export function describe(lm: Landmark, fromX: number, fromZ: number, gx = lm.gx, gz = lm.gz, salt = 1601): Rumour {
  const looks = LOOKS[lm.kind];
  const look = looks[Math.floor(slotRandom(gx, gz, salt + 2) * looks.length) % looks.length];
  const setting = settingOf(lm.x, lm.z);
  const region = regionAt(lm.x, lm.z).name;
  const away = Math.hypot(lm.x - fromX, lm.z - fromZ);
  const bearing = bearingOf(lm.x - fromX, lm.z - fromZ);

  // Half name the country it is in, half just the direction. Always one or the
  // other, never a coordinate — you are being told, not shown.
  const where =
    slotRandom(gx, gz, salt + 4) < 0.5
      ? `${BEARINGS[bearing]} of here, in ${region}`
      : `${howFar(away)} ${BEARINGS[bearing]} of here`;

  return {
    id: `rumour:${lm.id}`,
    text: `${look} ${setting}, ${where}`,
    short: look,
    name: lm.name,
    x: Math.round(lm.x),
    z: Math.round(lm.z),
    region,
  };
}

/** Which of the eight compass points a displacement lies along. North is -z. */
function bearingOf(dx: number, dz: number): number {
  return Math.round(((Math.atan2(dx, -dz) * 4) / Math.PI + 8)) % 8;
}

/**
 * How the big things get talked about.
 *
 * Vaguer than a landmark's, on purpose. Nobody who has seen a forty-storey
 * tower standing in empty country describes it accurately; they say there is
 * something out there that should not be.
 */
const MONUMENT_LOOKS: Record<MonumentKind, string[]> = {
  tower: ["a tower with no city round it", "something far too tall, standing alone", "forty floors and nobody in them"],
  castle: ["walls on a hill, and a keep", "a castle nobody holds", "battlements against the sky"],
  lighthouse: ["a light that turns after dark", "a striped tower above the sea", "a lamp still sweeping the coast"],
  windfarm: ["white arms turning, a dozen of them", "a field of slow giants", "blades as long as a street"],
  colossus: ["a stone giant up to its chest in the ground", "a fist raised over the hills", "somebody enormous, buried standing"],
};

export function describeMonument(m: Monument, fromX: number, fromZ: number): Rumour {
  const looks = MONUMENT_LOOKS[m.kind];
  const look = looks[Math.floor(slotRandom(m.gx, m.gz, 2081) * looks.length) % looks.length];
  const away = Math.hypot(m.x - fromX, m.z - fromZ);
  const bearing = bearingOf(m.x - fromX, m.z - fromZ);
  const region = regionAt(m.x, m.z).name;
  return {
    id: `rumour:${m.id}`,
    text: `${look}, ${howFar(away)} ${BEARINGS[bearing]} of here`,
    short: look,
    name: m.name,
    x: Math.round(m.x),
    z: Math.round(m.z),
    region,
  };
}

/**
 * The nearest monument that passes a test — in practice, "one you have not
 * been to and have not already been told about".
 */
export function monumentRumour(fromX: number, fromZ: number, want: (m: Monument) => boolean): Rumour | null {
  let best: Monument | null = null;
  let bestD = Infinity;
  for (const m of monumentsNear(fromX, fromZ, 2)) {
    const d = Math.hypot(m.x - fromX, m.z - fromZ);
    if (d < bestD && d > 600 && want(m)) {
      bestD = d;
      best = m;
    }
  }
  return best ? describeMonument(best, fromX, fromZ) : null;
}

/**
 * What you can make out from somewhere high: the nearest places you have not
 * been, nearest first.
 */
export function survey(fromX: number, fromZ: number, want: (id: string) => boolean, count = 3): Rumour[] {
  const near = landmarksNear(fromX, fromZ, 4)
    .filter((lm) => want(lm.id))
    .map((lm) => ({ lm, d: Math.hypot(lm.x - fromX, lm.z - fromZ) }))
    .filter((e) => e.d > 200)
    .sort((a, b) => a.d - b.d)
    .slice(0, count);
  return near.map((e) => describe(e.lm, fromX, fromZ));
}

/**
 * A machine somebody left, as the radio would mention it.
 *
 * Named for what it is. A rumour about a place can afford to be coy; one
 * about a motorcycle is only worth hearing if it says motorcycle.
 */
export function describeStray(st: Stray, fromX: number, fromZ: number): Rumour {
  const label = SPECS[st.cls].label.toLowerCase();
  const away = Math.hypot(st.x - fromX, st.z - fromZ);
  const bearing = bearingOf(st.x - fromX, st.z - fromZ);
  const look = `a ${label} somebody left`;
  return {
    id: `rumour:${st.id}`,
    text: `${look} ${settingOf(st.x, st.z)}, ${howFar(away)} ${BEARINGS[bearing]} of here`,
    short: look,
    name: st.name,
    x: Math.round(st.x),
    z: Math.round(st.z),
    region: regionAt(st.x, st.z).name,
  };
}

/** The nearest left machine that passes a test — "of a kind you do not have". */
export function strayRumour(fromX: number, fromZ: number, want: (st: Stray) => boolean): Rumour | null {
  let best: Stray | null = null;
  let bestD = Infinity;
  for (const st of straysNear(fromX, fromZ, 5)) {
    const d = Math.hypot(st.x - fromX, st.z - fromZ);
    if (d < bestD && d > 150 && want(st)) {
      bestD = d;
      best = st;
    }
  }
  return best ? describeStray(best, fromX, fromZ) : null;
}

/** The nearest airstrip, described, or null if there is none for a long way. */
export function airstripRumour(fromX: number, fromZ: number): Rumour | null {
  let best: Landmark | null = null;
  let bestD = Infinity;
  for (const lm of landmarksNear(fromX, fromZ, 11)) {
    if (lm.kind !== "airfield") continue;
    const d = Math.hypot(lm.x - fromX, lm.z - fromZ);
    if (d < bestD) {
      bestD = d;
      best = lm;
    }
  }
  return best ? describe(best, fromX, fromZ) : null;
}
