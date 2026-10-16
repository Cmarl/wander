import { slotRandom } from "../world/field";
import type { VehicleSpec } from "./vehicles";

/**
 * Parts you find, and what they do to a vehicle.
 *
 * Clyde asked for loot and upgrades. The brainstorm's anti-goals forbid XP,
 * numbers going up, and grind — and those two things reconcile for a reason
 * that is structural rather than a matter of restraint:
 *
 *   THE WORLD IS A PURE FUNCTION, SO A PART IS ONE OBJECT AT ONE COORDINATE.
 *
 * There is no spawner, no drop table and no respawn. You cannot farm a place
 * because a place has what it has, forever, for every player. That makes a
 * treadmill impossible to build here even if someone wanted one. What is left
 * is the thing Clyde actually asked for: going somewhere is worth something.
 *
 * Three rules hold the rest of it to the spine:
 *
 *   1. NOTHING IS GATED. The truck as it ships reaches everywhere worth
 *      reaching. A part changes how a vehicle FEELS, never where it can go.
 *   2. NOTHING IS MANAGED. A part you find is fitted. There is no inventory,
 *      no loadout, no choosing — which is the difference between a reward and
 *      a spreadsheet.
 *   3. NOTHING IS COUNTED. The journal records what you found. It never shows
 *      what you have not.
 */

export type PartKind = "suspension" | "turbo" | "intake" | "headers" | "exhaust" | "lamps";

export interface PartSpec {
  label: string;
  /** Said once, when you find it. Plain words, no statistics. */
  note: string;
  /** How many grades of it exist. One means it is simply had or not. */
  tiers: number;
}

export const PARTS: Record<PartKind, PartSpec> = {
  suspension: {
    label: "Suspension",
    note: "lands softer, turns harder, and jumps a good deal better",
    tiers: 3,
  },
  turbo: { label: "Turbo", note: "noticeably more top end", tiers: 1 },
  intake: { label: "Cold air intake", note: "picks up quicker off the mark", tiers: 1 },
  headers: { label: "Headers", note: "pulls harder through the middle", tiers: 1 },
  exhaust: { label: "Exhaust", note: "a little more speed, and it sounds like it", tiers: 1 },
  lamps: { label: "Driving lamps", note: "you can see what you are driving into", tiers: 2 },
};

export const PART_KINDS = Object.keys(PARTS) as PartKind[];

/**
 * What a fitted kit does, as multipliers on the vehicle's own numbers.
 *
 * Deliberately bounded and deliberately modest. A fully kitted truck should be
 * a better truck, not a different vehicle — the handling, the collision and
 * the overspeed ceiling are all tuned around the base numbers, and doubling
 * any of them would break the feel long before it broke the physics.
 */
export interface Tune {
  top: number;
  accel: number;
  jump: number;
  /** Multiplies the steering falloff. Below 1 means it keeps turning at speed. */
  falloff: number;
  /** Headlight reach, as a multiplier. */
  light: number;
}

export const STOCK: Tune = { top: 1, accel: 1, jump: 1, falloff: 1, light: 1 };

const CAP = { top: 1.22, accel: 1.34, jump: 1.75, falloff: 0.7, light: 2.2 };

const KEY = "wander.parts";

export class Kit {
  /** Part kind to the best tier of it you have found. */
  owned = new Map<PartKind, number>();

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw === "object") {
        for (const [k, t] of Object.entries(raw as Record<string, number>)) {
          // Filtered against what this build knows about, so a save from a
          // version with a part this one lacks cannot fit something undefined.
          if (PART_KINDS.includes(k as PartKind) && typeof t === "number") {
            this.owned.set(k as PartKind, Math.min(t, PARTS[k as PartKind].tiers));
          }
        }
      }
    } catch {
      // Nothing found yet, which is where everyone starts.
    }
  }

  /** True if this is better than what you already had. */
  fit(kind: PartKind, tier: number): boolean {
    if ((this.owned.get(kind) ?? 0) >= tier) return false;
    this.owned.set(kind, tier);
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(this.owned)));
    } catch {
      // Private browsing. You keep it for the session.
    }
    return true;
  }

  /**
   * The whole kit as one set of multipliers.
   *
   * Contributions add and the total is clamped, so finding every part is worth
   * having without being worth optimising. Nothing here rewards going back for
   * a second one.
   */
  get tune(): Tune {
    const t = { ...STOCK };
    const sus = this.owned.get("suspension") ?? 0;
    if (sus) {
      t.jump += sus * 0.25;
      t.falloff -= sus * 0.1;
    }
    if (this.owned.get("turbo")) {
      t.top += 0.1;
      t.accel += 0.12;
    }
    if (this.owned.get("intake")) t.accel += 0.1;
    if (this.owned.get("headers")) t.accel += 0.09;
    if (this.owned.get("exhaust")) {
      t.top += 0.07;
      t.accel += 0.05;
    }
    const lamps = this.owned.get("lamps") ?? 0;
    if (lamps) t.light += lamps * 0.6;

    t.top = Math.min(t.top, CAP.top);
    t.accel = Math.min(t.accel, CAP.accel);
    t.jump = Math.min(t.jump, CAP.jump);
    t.falloff = Math.max(t.falloff, CAP.falloff);
    t.light = Math.min(t.light, CAP.light);
    return t;
  }
}

/**
 * Apply a kit to a vehicle's numbers.
 *
 * Returns a new spec rather than mutating, because SPECS is shared and a
 * vehicle class is not a thing that should quietly change under everything
 * else that reads it.
 */
export function tuned(spec: VehicleSpec, t: Tune): VehicleSpec {
  return {
    ...spec,
    top: spec.top * t.top,
    accel: spec.accel * t.accel,
    jump: spec.jump * t.jump,
    turnFalloff: (spec.turnFalloff ?? 0.075) * t.falloff,
  };
}

export interface FoundPart {
  kind: PartKind;
  tier: number;
}

/**
 * Whether a place has something lying at it, and what.
 *
 * Hashed off the cell like everything else, so a part is at a coordinate
 * rather than in a drop table. Roughly one place in six has one — common
 * enough that exploring pays, rare enough that most arrivals are still about
 * the arrival.
 */
export function partAt(gx: number, gz: number, salt: number): FoundPart | null {
  if (slotRandom(gx, gz, salt) > 0.17) return null;
  const kind = PART_KINDS[Math.floor(slotRandom(gx, gz, salt + 1) * PART_KINDS.length) % PART_KINDS.length];
  const spec = PARTS[kind];
  // Higher grades are rarer, which is the only progression in here and it is
  // one you walk to rather than grind for.
  const roll = slotRandom(gx, gz, salt + 2);
  const tier = spec.tiers === 1 ? 1 : roll > 0.82 ? spec.tiers : roll > 0.5 ? 2 : 1;
  return { kind, tier };
}
