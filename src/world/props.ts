import { heightAt, slopeAt, treeDensityAt, slotRandom, moistureAt, temperatureAt } from "./field";
import { clearingsNear, inAnyClearing } from "./clearings";

/**
 * Single source of truth for where every tree, shrub and rock in the world
 * stands.
 *
 * Both the renderer and the collision system call this. If they each had their
 * own copy of the placement rules they would drift, and you would get invisible
 * walls and trees you can drive through — so neither owns it.
 *
 * Placement is a pure function of the cell coordinates. Nothing is stored.
 */

export const CELL = 40;
const SLOTS = 3;
/**
 * How far something gives when you drive past, 0..1.
 *
 * Continuous in size rather than gated, so there is no boundary to notice: a
 * whip-thin sapling folds right over, a full-grown pine barely leans. Gating it
 * made half the forest rigid and half rubbery, with a visible line between.
 */
const whippiness = (sx: number) => Math.min(1, Math.max(0.3, 1.25 - sx * 0.5));

export type PropKind = "pine" | "broadleaf" | "dead" | "shrub" | "rock";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  /** Final render scales. Collision radius is derived from sx, so the thing
   *  you hit is exactly the size of the thing you see. */
  sx: number;
  sy: number;
  rot: number;
  /** 0..1 seeds for per-instance colour and shape variation. */
  tint: number;
  shade: number;
  /** Collision radius in metres. 0 means you pass straight through it. */
  radius: number;
  /** How far it leans out of your way, 0..1. 0 is rigid. */
  bend?: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Append every prop belonging to one cell of the world grid. */
export function propsInCell(gx: number, gz: number, out: Prop[]): void {
  for (let s = 0; s < SLOTS; s++) {
    const salt = s * 101;
    const r0 = slotRandom(gx, gz, 17 + salt);
    const r1 = slotRandom(gx, gz, 53 + salt);
    const r2 = slotRandom(gx, gz, 89 + salt);
    const r3 = slotRandom(gx, gz, 131 + salt);
    const r4 = slotRandom(gx, gz, 181 + salt);

    const x = (gx + r0 - 0.5) * CELL;
    const z = (gz + r1 - 0.5) * CELL;
    const y = heightAt(x, z);
    if (y < 1) continue;
    /**
     * Nothing grows where somebody cleared the ground.
     *
     * A runway with a pine growing out of it is not a runway. The tree is not
     * the odd part — a world that grew one where somebody graded two hundred
     * metres of dirt is the odd part.
     */
    if (inAnyClearing(x, z, clearingsNear(x, z, 1))) continue;

    const slope = slopeAt(x, z, 4);
    const moist = moistureAt(x, z);
    const temp = temperatureAt(x, z) - y / 9000;
    const trees = treeDensityAt(x, z, y, slope);

    if (r2 < trees) {
      // Standing timber. Species follows climate, with a few dead ones.
      let kind: PropKind;
      if (r4 > 0.93) kind = "dead";
      else if (moist > 0.56 && temp > 0.5 && r3 > 0.45) kind = "broadleaf";
      else kind = "pine";

      const scale = 0.68 + r3 * 0.95;
      const sx = scale * (0.82 + r1 * 0.3);
      // No tree stops you. Every one of them bends out of the way instead, a
      // big one stiffly and a sapling right over. Driving through open country
      // should never end against a trunk.
      out.push({
        kind,
        x,
        z,
        y: y - 0.3,
        sx,
        sy: scale * (0.85 + r3 * 0.55),
        rot: r0 * Math.PI * 2,
        tint: r1,
        shade: r3,
        radius: 0,
        bend: whippiness(sx),
      });
      continue;
    }

    // Scrub fills the gaps between trees — dry, open, low ground.
    const scrub = clamp01(0.42 - trees) * clamp01(1.25 - slope * 1.5) * clamp01(0.3 + moist);
    if (r2 < trees + scrub * 0.55) {
      const scale = 0.5 + r3 * r3 * 1.5;
      out.push({
        kind: "shrub",
        x,
        z,
        y: y - 0.12,
        sx: scale * (0.82 + r0 * 0.3),
        sy: scale * (0.85 + r4 * 0.55),
        rot: r1 * Math.PI * 2,
        tint: r0,
        shade: r4,
        radius: 0, // you brush through scrub, you don't crash into it
        bend: 1,
      });
      continue;
    }

    // Rock: everywhere a little, scree slopes and high ground a lot.
    const rockChance = 0.012 + slope * 0.11 + Math.max(0, (y - 1400) / 1400) * 0.1;
    if (r2 > 1 - rockChance) {
      const scale = 0.5 + r3 * r3 * 4.5;
      const sx = scale * (0.82 + r3 * 0.3);
      out.push({
        kind: "rock",
        x,
        z,
        y: y - scale * 0.22,
        sx,
        sy: scale * (0.85 + r0 * 0.55),
        rot: r1 * Math.PI * 2,
        tint: r3,
        shade: r0,
        // Small stones are kerbs, not walls — you bump over them.
        radius: sx > 1.0 ? sx * 0.85 : 0,
      });
    }
  }
}

/**
 * Solid props near a point, for collision.
 *
 * Re-derives from the hash rather than querying the renderer, and caches the
 * 3x3 cell neighbourhood so it only recomputes when you cross a cell boundary.
 */
export class PropQuery {
  private cx = NaN;
  private cz = NaN;
  private cache: Prop[] = [];

  solidNear(x: number, z: number): Prop[] {
    const gx = Math.round(x / CELL);
    const gz = Math.round(z / CELL);
    if (gx !== this.cx || gz !== this.cz) {
      this.cx = gx;
      this.cz = gz;
      this.cache.length = 0;
      const all: Prop[] = [];
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) propsInCell(gx + i, gz + j, all);
      }
      for (const p of all) if (p.radius > 0) this.cache.push(p);
    }
    return this.cache;
  }
}
