import * as THREE from "three";

/** 1 real hour = 1 full game day. */
export const DAY_LENGTH_SECONDS = 3600;
const TAU = Math.PI * 2;
const AXIAL_TILT = 0.42; // keeps the sun off the exact zenith

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const ZEN_NIGHT = new THREE.Color(0.01, 0.017, 0.04);
const ZEN_DUSK = new THREE.Color(0.085, 0.125, 0.255);
const ZEN_DAY = new THREE.Color(0.225, 0.42, 0.72);
const HOR_NIGHT = new THREE.Color(0.028, 0.042, 0.078);
const HOR_DUSK = new THREE.Color(0.62, 0.3, 0.205);
const HOR_DAY = new THREE.Color(0.735, 0.805, 0.88);

/**
 * Drives every light, shader uniform and HUD readout from a single scalar:
 * the time of day. Everything else is derived, so day/night stays coherent
 * across terrain, water, sky and the instanced props at once.
 */
/**
 * Today's weather, seeded from the real calendar date.
 *
 * Everyone sees the same sky today and a different one tomorrow, and no amount
 * of play can hurry it. A reason to come back that costs nothing, can't be
 * grinded, and is genuinely shared — "did you see it today" works because it
 * is literally the same sky.
 */
function todaySeed(d = new Date()): { cloud: number; haze: number; sunset: number; aurora: boolean; name: string } {
  const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = Math.imul(key, 2654435761) >>> 0;
  const next = () => {
    h = (h ^ (h >>> 15)) >>> 0;
    h = Math.imul(h, 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return (h >>> 8) / 16777216;
  };
  const cloud = 0.26 + next() * 0.46;
  const haze = 0.78 + next() * 0.55;
  const vivid = next();
  const sunset = vivid > 0.8 ? 1.5 + vivid : 1;
  // Some nights the sky is up to something, in the cold north. Roughly one
  // night in nine, from the same date seed everybody shares — so "did you see
  // it last night" works the same way a vivid sunset already does.
  const aurora = next() > 0.89;
  const name = aurora
    ? "a night for the lights"
    : sunset > 1
      ? "a vivid sky"
      : cloud > 0.6
        ? "an overcast day"
        : haze > 1.15
          ? "a hazy day"
          : "a clear day";
  return { cloud, haze, sunset, aurora, name };
}

export class Environment {
  /** Seconds since world start, scaled. */
  elapsed = 0;
  /** 0..1 across one game day. 0 = midnight. */
  timeOfDay = 0.28;

  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  readonly sunColor = new THREE.Color();
  readonly skyAmbient = new THREE.Color();
  readonly groundAmbient = new THREE.Color();
  readonly horizonColor = new THREE.Color();
  fogDensity = 0.000085;
  cloudCover = 0.5;
  /** Extra warmth in the horizon glow on vivid days. */
  sunsetBoost = 1;
  readonly today = todaySeed();

  readonly sunLight = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemiLight = new THREE.HemisphereLight(0xffffff, 0x444433, 1);

  private tmp = new THREE.Color();

  constructor() {
    this.sunLight.castShadow = false;
    this.recompute();
  }

  advance(dt: number) {
    this.elapsed += dt;
    this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH_SECONDS) % 1;
    this.recompute();
  }

  /** Hours:minutes in game time. */
  clockString(): string {
    const totalMin = Math.floor(this.timeOfDay * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  private recompute() {
    const a = (this.timeOfDay - 0.25) * TAU;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(AXIAL_TILT), Math.sin(a) * Math.sin(AXIAL_TILT));
    this.sunDir.normalize();

    // Moon trails the sun's antipode, offset so they don't share an arc.
    this.moonDir.copy(this.sunDir).negate().applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.5).normalize();

    const e = this.sunDir.y;
    const dusk = smoothstep(-0.28, 0.02, e);
    const day = smoothstep(0.0, 0.3, e);

    const zen = this.tmp.copy(ZEN_NIGHT).lerp(ZEN_DUSK, dusk).lerp(ZEN_DAY, day).clone();
    const hor = this.horizonColor.copy(HOR_NIGHT).lerp(HOR_DUSK, dusk).lerp(HOR_DAY, day);

    // Sun: warm and weak near the horizon, neutral and strong overhead.
    const strength = smoothstep(-0.08, 0.22, e);
    const warmth = smoothstep(0.02, 0.32, e);
    this.sunColor
      .setRGB(1.0, 0.45, 0.2)
      .lerp(new THREE.Color(1.0, 0.97, 0.92), warmth)
      .multiplyScalar(strength * 1.0);

    // Ambient is a *fraction* of the sky, not a multiple. Sun + ambient has to
    // land near 1.0 or ACES saturates and every biome collapses to the same
    // washed-out colour.
    const night = smoothstep(0.08, -0.2, e);
    this.skyAmbient
      .copy(zen)
      .multiplyScalar(0.40)
      .addScalar(0.02)
      // Moonlight: a dim blue floor so night stays navigable, never pitch black.
      .add(new THREE.Color(0.03, 0.038, 0.07).multiplyScalar(night));
    this.groundAmbient.copy(hor).multiplyScalar(0.1).addScalar(0.008);

    this.sunLight.position.copy(this.sunDir).multiplyScalar(1000);
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = 1;
    this.hemiLight.color.copy(this.skyAmbient);
    this.hemiLight.groundColor.copy(this.groundAmbient);
    // Props get a little extra sky fill — without it, anything facing away from
            // the sun reads as a black silhouette against bright ground.
    this.hemiLight.intensity = 1.7;

    // Weather drifts over hours, around whatever today happens to be.
    this.cloudCover = this.today.cloud + 0.11 * Math.sin(this.elapsed / 900) + 0.06 * Math.sin(this.elapsed / 311);
    this.fogDensity = 0.000085 * this.today.haze;
    // Vivid days only pay off near the horizon, at the ends of the day.
    this.sunsetBoost = 1 + (this.today.sunset - 1) * (1 - Math.min(Math.abs(e) / 0.3, 1));
  }
}
