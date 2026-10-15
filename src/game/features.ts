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
  camera: "orbit" | "chase" | "inside";
  /** Vertical offset applied to the character while held. */
  lift: number;
  /** How close in you stand, as a fraction of range. */
  inset: number;
  /** One-shot: fires and releases you immediately. */
  instant: boolean;
  /** A line shown while you're settled in. */
  note: string;
  /**
   * Half-width of a deck you can walk around on, in local metres.
   *
   * Present only on places with a floor up in the air. Everything else holds
   * you exactly where it put you.
   */
  deck?: number;
}

export const ACTIONS: Record<LandmarkKind, ActionSpec> = {
  spring: {
    verb: "soak", badge: "Soaked", range: 14, camera: "orbit",
    lift: -0.95, inset: 0.0, instant: false,
    note: "warm to the shoulders",
  },
  lookout: {
    // The deck is a 9.6 m square slab centred at 16.7 with 0.5 of thickness,
    // so its top is 16.95 — that is where your feet go, times the scale.
    verb: "climb", badge: "Climbed", range: 9, camera: "chase",
    lift: 16.95, inset: 0.0, instant: false,
    deck: 4.3,
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
  // The real interior — a fire you light, food you make — is Shelter & Stay.
  // Until then stepping in out of the weather is worth having on its own, and
  // it is the one action that is purely about stopping.
  steading: {
    verb: "step inside", badge: "Sheltered", range: 9, camera: "inside",
    lift: 0, inset: 0.55, instant: false,
    note: "out of the weather",
  },
  shipwreck: {
    verb: "climb aboard", badge: "Boarded", range: 13, camera: "orbit",
    lift: 3.4, inset: 0.2, instant: false,
    note: "aground a long time",
  },
  stones: {
    verb: "walk the ring", badge: "Walked the ring", range: 13, camera: "orbit",
    lift: 0, inset: 0.1, instant: false,
    note: "older than anything else out here",
  },
  adit: {
    verb: "go in", badge: "Went in", range: 8, camera: "inside",
    lift: 0, inset: 0.92, instant: false,
    note: "cold air coming out of the dark",
  },
  windpump: {
    verb: "work the pump", badge: "Worked the pump", range: 9, camera: "chase",
    lift: 0, inset: 0.5, instant: true,
    note: "",
  },
  sinkhole: {
    verb: "look down", badge: "Looked down", range: 17, camera: "orbit",
    lift: 0, inset: 0.78, instant: false,
    note: "no sign of the bottom",
  },
  bonefield: {
    verb: "walk the ribs", badge: "Walked the ribs", range: 14, camera: "orbit",
    lift: 0, inset: 0.2, instant: false,
    note: "whatever this was, it was enormous",
  },
  orchard: {
    verb: "pick something", badge: "Picked something", range: 16, camera: "chase",
    lift: 0, inset: 0.3, instant: true,
    note: "",
  },
  frozenlake: {
    verb: "walk out on it", badge: "Walked out on it", range: 30, camera: "orbit",
    lift: 0, inset: 0.45, instant: false,
    note: "it holds, and it creaks",
  },
  // The arch has no prompt. Driving through one IS the action, and asking
  // permission first would spoil the only landmark you meet at speed.
  arch: {
    verb: "", badge: "Passed under", range: 0, camera: "chase",
    lift: 0, inset: 0, instant: true,
    note: "",
  },
};

/**
 * Where you stand inside each build, and where its hearth is.
 *
 * Local to the building, before its rotation and scale, indexed by the
 * steading variant — cabin, barn, line shack. A barn has no stove, so its fire
 * goes on the floor where anyone sheltering in a barn would build one.
 */
interface Interior {
  eye: [number, number, number];
  look: [number, number, number];
  hearth: [number, number, number];
}

/** The three steading builds, indexed by variant. */
const STEADING_INTERIORS: Interior[] = [
  // cabin
  { eye: [1.7, 1.6, 1.5], look: [-1.8, 0.95, -0.9], hearth: [-2.4, 0.95, -1.1] },
  // barn
  { eye: [2.9, 1.8, 2.5], look: [-2.2, 1.0, -1.6], hearth: [1.8, 0.1, -0.4] },
  // line shack
  { eye: [0.9, 1.5, 1.1], look: [-1.1, 0.9, -0.7], hearth: [-1.3, 0.95, -0.9] },
];

/**
 * Interiors for kinds that are not buildings.
 *
 * Clyde walked into a mine and nothing happened. The one-room system built for
 * steadings was never steading-shaped — it is a camera position, a look point
 * and somewhere a light belongs — so a tunnel is the same idea pointed down a
 * hole instead of across a room.
 */
const KIND_INTERIORS: Partial<Record<LandmarkKind, Interior>> = {
  // Standing inside the portal looking down the drift, with the lamp on the
  // timber beside you.
  adit: { eye: [0, 1.6, -3.4], look: [0, 1.3, -15], hearth: [1.2, 1.5, -4.2] },
};

function interiorOf(lm: Landmark): Interior {
  return KIND_INTERIORS[lm.kind] ?? STEADING_INTERIORS[lm.variant] ?? STEADING_INTERIORS[0];
}

export class Features {
  /** The place you're currently settled into, if any. */
  held: { lm: Landmark; spec: ActionSpec } | null = null;
  private orbit = 0;
  private pitch = 0;
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
      // Lift scales with the landmark. It was a fixed number of metres against
      // geometry that scales, so a big tower put you well below its own deck.
      heightAt(lm.x - (ax / d) * inset, lm.z - (az / d) * inset) + spec.lift * lm.scale,
      lm.z - (az / d) * inset
    );
    this.held = { lm, spec };
    this.orbit = spec.camera === "inside" ? 0 : Math.atan2(from.x - lm.x, from.z - lm.z);
    this.pitch = 0;
    return spec;
  }

  release() {
    this.held = null;
  }

  update(dt: number) {
    // Indoors the view is yours to pan; everywhere else it drifts on its own.
    if (this.held && this.held.spec.camera !== "inside") this.orbit += dt * 0.07;
  }

  /** True while settled somewhere with a roof. */
  get indoors(): boolean {
    return this.held?.spec.camera === "inside";
  }

  /** Pan the room, the same gesture as looking around a camp. */
  look(dx: number, dy: number) {
    if (!this.indoors) return;
    this.orbit -= dx * 2.2;
    this.pitch = Math.min(0.5, Math.max(-0.55, this.pitch - dy * 2.4));
  }

  /** Local-to-world, for anything positioned inside a building. */
  private place(local: [number, number, number], out: THREE.Vector3): THREE.Vector3 {
    const lm = this.held!.lm;
    const c = Math.cos(lm.rot);
    const sn = Math.sin(lm.rot);
    const [lx, ly, lz] = local;
    return out.set(
      lm.x + (lx * c + lz * sn) * lm.scale,
      lm.y + ly * lm.scale,
      lm.z + (-lx * sn + lz * c) * lm.scale
    );
  }

  /** Where this building's fire belongs, in world space. */
  hearth(out: THREE.Vector3): THREE.Vector3 {
    return this.place(interiorOf(this.held!.lm).hearth, out);
  }

  /** Where the character sits while settled. */
  holdPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.site);
  }

  /**
   * Inside the room.
   *
   * The camera stands in the room and turns on the spot rather than orbiting
   * the building, because orbiting would spend most of its time outside the
   * walls looking at the back of them. There is no transition and no loading:
   * the room is simply there, and the camera moves into it.
   */
  interiorTarget(out: THREE.Vector3, look: THREE.Vector3) {
    const spec = interiorOf(this.held!.lm);
    this.place(spec.eye, out);
    this.place(spec.look, look);
    // Panning swings the look point around the eye, so you turn your head.
    const dx = look.x - out.x;
    const dz = look.z - out.z;
    const r = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx) + this.orbit;
    look.set(out.x + Math.cos(a) * r, look.y + this.pitch * r, out.z + Math.sin(a) * r);
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
