import { heightAt, slotRandom } from "./field";
import { landmarksNear, type Landmark, type LandmarkKind } from "./landmarks";
import { regionAt } from "./regions";

/**
 * Accretions — the small stuff that gathers around a place.
 *
 * A woodpile, a cold firepit, a cairn, a signpost, fuel drums, a dog kennel.
 * Each is hashed present or absent independently, so six optional objects is
 * sixty-four combinations from one small kit. It is the cheapest content
 * multiplier available and the one that most makes a place read as USED rather
 * than placed: the same lookout with somebody's woodpile beside it is a
 * different arrival from the same lookout on bare grass.
 *
 * None of them collide. They are ankle-to-waist height and the alternative is
 * a truck stopping dead on a log pile, which is the opposite of relaxing — the
 * same call already made for small trees.
 */

export type AccretionKind =
  | "woodpile"
  | "firepit"
  | "cairn"
  | "signpost"
  | "drums"
  | "kennel"
  | "line";

export const ACCRETION_KINDS: AccretionKind[] = [
  "woodpile",
  "firepit",
  "cairn",
  "signpost",
  "drums",
  "kennel",
  "line",
];

/**
 * Not everything belongs everywhere. Fuel drums at a radio mast say somebody
 * services it; fuel drums at a stone arch say nothing. A cairn is what people
 * leave at natural places, a kennel is what they leave where they lived.
 */
const ELIGIBLE: Record<LandmarkKind, AccretionKind[]> = {
  lookout: ["woodpile", "firepit", "signpost", "drums", "kennel"],
  mast: ["drums", "firepit", "signpost", "cairn"],
  wreck: ["drums", "firepit", "cairn", "woodpile"],
  arch: ["cairn", "firepit", "signpost"],
  spring: ["cairn", "firepit", "woodpile", "signpost"],
  lonetree: ["cairn", "firepit", "woodpile", "kennel"],
  // A place somebody lived gets the most of everything.
  steading: ["woodpile", "firepit", "signpost", "drums", "kennel", "line"],
  shipwreck: ["firepit", "cairn", "drums"],
  // People leave stones at stones.
  stones: ["cairn", "firepit", "signpost"],
  adit: ["drums", "woodpile", "firepit", "signpost"],
  windpump: ["drums", "signpost", "firepit"],
  sinkhole: ["cairn", "signpost"],
  bonefield: ["cairn", "firepit"],
  orchard: ["woodpile", "firepit", "kennel", "line"],
  frozenlake: ["firepit", "cairn", "signpost"],
};

/** Roughly how often an eligible accretion actually shows up. */
const CHANCE = 0.46;

export interface Accretion {
  kind: AccretionKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** Signposts only — what it says when you walk up to it. */
  text?: string;
  /**
   * Firepits only — somebody used this recently and it is still warm.
   *
   * This is the cheapest trace of a person there is. A cold ring of stones is
   * archaeology; embers and a thread of smoke mean you are a few hours behind
   * someone, which is the whole feeling Traces is for without a single NPC.
   */
  lit?: boolean;
}

/**
 * What a signpost says.
 *
 * Clyde asked for readable signs — "highest peak 7600'". Half of them name a
 * neighbouring landmark and its range, which makes a sign an actual reason to
 * turn; the other half call out the high ground nearby, found by sampling the
 * terrain function outward in a ring. Both are derived from the world, so a
 * sign is never wrong and never needs storing.
 */
function signText(lm: Landmark, pick: number): string {
  const named = () => {
    // The nearest OTHER landmark. Pointing at the thing you're standing next
    // to would be a sign that says "here".
    let best: Landmark | null = null;
    let bestD = Infinity;
    for (const other of landmarksNear(lm.x, lm.z, 2)) {
      if (other.id === lm.id) continue;
      const d = Math.hypot(other.x - lm.x, other.z - lm.z);
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    return best ? `${best.name} · ${(bestD / 1000).toFixed(1)} km` : null;
  };

  if (pick < 0.5) {
    const n = named();
    if (n) return n;
  }

  // High ground, sampled in rings out to six kilometres.
  let peakH = -Infinity;
  let peakD = 0;
  for (let ring = 1; ring <= 4; ring++) {
    const r = ring * 1500;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + ring;
      const h = heightAt(lm.x + Math.cos(a) * r, lm.z + Math.sin(a) * r);
      if (h > peakH) {
        peakH = h;
        peakD = r;
      }
    }
  }
  // Only worth a sign if it is actually up. A board reading "high ground ·
  // 301 m" while you stand at 340 m is worse than no board.
  if (peakH > lm.y + 120) {
    return `high ground · ${Math.round(peakH).toLocaleString()} m · ${(peakD / 1000).toFixed(1)} km`;
  }
  return named() ?? regionAt(lm.x, lm.z).name;
}

/**
 * Everything gathered around one landmark.
 *
 * Placed on a ring clear of the structure's own footprint, so a woodpile never
 * ends up inside a lookout's legs, and sat on the terrain rather than on the
 * landmark's own ground height — on a slope those differ by metres.
 */
/**
 * Whether a place has a given accretion, without building any of them.
 *
 * accretionsAt does real work — a signpost's text costs forty-eight terrain
 * samples and a landmark scan — so asking it a yes/no question every frame is
 * not free. This is the same gate hash and nothing else.
 */
export function hasAccretion(lm: Landmark, kind: AccretionKind): boolean {
  const i = ELIGIBLE[lm.kind].indexOf(kind);
  if (i < 0) return false;
  return slotRandom(lm.gx, lm.gz, 1300 + i * 17) <= CHANCE;
}

export function accretionsAt(lm: Landmark): Accretion[] {
  const out: Accretion[] = [];
  const eligible = ELIGIBLE[lm.kind];

  for (let i = 0; i < eligible.length; i++) {
    const kind = eligible[i];
    // A separate salt per slot, so adding a kind to one landmark's list never
    // shuffles what the others already had.
    const salt = 1300 + i * 17;
    if (slotRandom(lm.gx, lm.gz, salt) > CHANCE) continue;

    const a = slotRandom(lm.gx, lm.gz, salt + 1) * Math.PI * 2;
    const r = 9 + slotRandom(lm.gx, lm.gz, salt + 2) * 8;
    const x = lm.x + Math.cos(a) * r;
    const z = lm.z + Math.sin(a) * r;
    out.push({
      kind,
      x,
      y: heightAt(x, z),
      z,
      rot: slotRandom(lm.gx, lm.gz, salt + 3) * Math.PI * 2,
      scale: 0.85 + slotRandom(lm.gx, lm.gz, salt + 4) * 0.35,
      text: kind === "signpost" ? signText(lm, slotRandom(lm.gx, lm.gz, salt + 5)) : undefined,
      lit: kind === "firepit" && slotRandom(lm.gx, lm.gz, salt + 6) > 0.72,
    });
  }

  return out;
}
