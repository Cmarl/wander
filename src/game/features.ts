import * as THREE from "three";
import { heightAt } from "../world/field";
import type { Landmark, LandmarkKind } from "../world/landmarks";

/**
 * What you actually DO at a place.
 *
 * Arriving somewhere was never the payoff — it was a label and a journal line.
 * Each kind of landmark now has one action of its own, with its own verb, so a
 * hot spring is something you get into rather than something you walk through.
 *
 * Every one of them is optional and self-selected: a prompt appears, you take
 * it or you don't, and nothing is withheld if you never do. The badge is a
 * memory of having done it, not a score — there is no total, nothing to
 * complete, and putting the phone down mid-soak costs you nothing.
 */

export interface ActionSpec {
  /** Imperative and lowercase — it goes straight into the prompt. */
  verb: string;
  /** Past tense, for the badge. */
  badge: string;
  /** How close you have to be for the prompt to appear. */
  range: number;
  /** Where the camera goes while you're there. */
  camera: "orbit" | "chase";
  /** Vertical offset applied to the character while held. */
  lift: number;
  /** How close in you stand, as a fraction of range. */
  inset: number;
  /** One-shot: fires and releases you immediately. */
  instant: boolean;
  /** A line shown while you're settled in. */
  note: string;
}

export const ACTIONS: Record<LandmarkKind, ActionSpec> = {
  spring: {
    verb: "soak", badge: "Soaked", range: 14, camera: "orbit",
    lift: -0.95, inset: 0.0, instant: false,
    note: "warm to the shoulders",
  },
  lookout: {
    verb: "climb", badge: "Climbed", range: 9, camera: "chase",
    lift: 17.2, inset: 0.0, instant: false,
    note: "the whole country, laid out",
  },
  lonetree: {
    verb: "sit a while", badge: "Sat a while", range: 8, camera: "orbit",
    lift: 0, inset: 0.42, instant: false,
    note: "nothing in particular to do",
  },
  mast: {
    verb: "tune in", badge: "Tuned in", range: 10, camera: "chase",
    lift: 0, inset: 0.5, instant: true,
    note: "",
  },
  wreck: {
    verb: "salvage", badge: "Salvaged", range: 6, camera: "chase",
    lift: 0, inset: 0.6, instant: true,
    note: "",
  },
  // The arch has no prompt. Driving through one IS the action, and asking
  // permission first would spoil the only landmark you meet at speed.
  arch: {
    verb: "", badge: "Passed under", range: 0, camera: "chase",
    lift: 0, inset: 0, instant: true,
    note: "",
  },
};

export class Features {
  /** The place you're currently settled into, if any. */
  held: { lm: Landmark; spec: ActionSpec } | null = null;
  private orbit = 0;
  private site = new THREE.Vector3();

  /** The nearest landmark offering a prompt, or null. */
  candidate(landmarks: Landmark[], x: number, z: number): Landmark | null {
    let best: Landmark | null = null;
    let bestD = Infinity;
    for (const lm of landmarks) {
      const spec = ACTIONS[lm.kind];
      if (!spec.verb) continue;
      const d = Math.hypot(lm.x - x, lm.z - z);
      if (d < spec.range * lm.scale && d < bestD) {
        bestD = d;
        best = lm;
      }
    }
    return best;
  }

  /**
   * Settle in. Returns the spec for a sustained action, or null for an instant
   * one — those fire through the caller and never take hold.
   */
  begin(lm: Landmark, from: THREE.Vector3): ActionSpec | null {
    const spec = ACTIONS[lm.kind];
    if (!spec.verb) return null;
    if (spec.instant) return null;

    // Stand where it makes sense for the place rather than where you happened
    // to be: in the pool, on the deck, against the trunk.
    const ax = lm.x - from.x;
    const az = lm.z - from.z;
    const d = Math.hypot(ax, az) || 1;
    const inset = spec.inset * spec.range * lm.scale;
    this.site.set(
      lm.x - (ax / d) * inset,
      heightAt(lm.x - (ax / d) * inset, lm.z - (az / d) * inset) + spec.lift,
      lm.z - (az / d) * inset
    );
    this.held = { lm, spec };
    this.orbit = Math.atan2(from.x - lm.x, from.z - lm.z);
    return spec;
  }

  release() {
    this.held = null;
  }

  update(dt: number) {
    if (this.held) this.orbit += dt * 0.07;
  }

  /** Where the character sits while settled. */
  holdPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.site);
  }

  /** Slow orbit of the place itself, for the sustained actions that want one. */
  cameraTarget(out: THREE.Vector3, look: THREE.Vector3) {
    const r = this.held?.lm.kind === "spring" ? 7.2 : 5.8;
    const x = this.site.x + Math.cos(this.orbit) * r;
    const z = this.site.z + Math.sin(this.orbit) * r;
    out.set(x, Math.max(this.site.y + 2.6, heightAt(x, z) + 2.0), z);
    look.set(this.site.x, this.site.y + 0.7, this.site.z);
  }
}
