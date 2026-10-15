import * as THREE from "three";
import { heightAt } from "../world/field";
import { DAY_LENGTH_SECONDS, type Environment } from "./environment";

/**
 * Camp — stopping on purpose.
 *
 * Sessions need an ending that feels like a choice rather than a quit, and the
 * whole fantasy here is overlanding, which is mostly about where you stop. So
 * this is the most on-theme thing the game can offer: put the truck somewhere
 * worth waking up in, light a fire, and either sit with it or sleep the clock
 * round and drive on in different light.
 *
 * Nothing is gated behind it and nothing is lost by skipping it.
 */

const DAWN = 0.25;
const DUSK = 0.78;
/** Real seconds a full rest takes, however far the clock has to travel. */
const REST_SECONDS = 7;

export type RestTarget = "dawn" | "dusk" | null;

export class Camp {
  readonly group = new THREE.Group();
  active = false;
  /** Lit inside a building rather than out in the open. */
  indoors = false;
  /** Where the fire is, once lit. */
  readonly site = new THREE.Vector3();
  /** Name of the landmark we pitched next to, if any. */
  nearby: string | null = null;

  private flames: THREE.Mesh[] = [];
  private light: THREE.PointLight;
  private restTarget: RestTarget = null;
  /** Fixed when the rest starts. Recomputing it each frame would make the
   *  approach exponential — it would crawl toward the target and never land. */
  private restRate = 0;
  private orbit = 0;
  private emberTimer = 0;
  /** Camera height above the fire. The look input raises and lowers it. */
  private elevation = 4.4;
  /** Seconds since the player last panned, so the drift doesn't fight them. */
  private lookIdle = 99;

  constructor() {
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6b6962, flatShading: true });
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3627, flatShading: true });

    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + (i % 3) * 0.06, 0), stoneMat);
      s.position.set(Math.cos(a) * 0.82, 0.1, Math.sin(a) * 0.82);
      this.group.add(s);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 1.15, 5), logMat);
      log.rotation.set(Math.PI / 2 - 0.42, a, 0);
      log.position.set(Math.cos(a) * 0.2, 0.26, Math.sin(a) * 0.2);
      this.group.add(log);
    }

    // Flames are unlit cones — a fire should emit light, not receive it.
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0xffb347 : i === 1 ? 0xff8324 : 0xffe08a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.34 - i * 0.07, 1.05 - i * 0.22, 5), mat);
      f.position.y = 0.54 - i * 0.09;
      this.flames.push(f);
      this.group.add(f);
    }

    this.light = new THREE.PointLight(0xffa64d, 0, 26, 2);
    this.light.position.y = 0.7;
    this.group.add(this.light);

    this.group.visible = false;
  }

  /**
   * Pitch at the given spot.
   *
   * A hearth indoors is the same object: a ring of stones, flames and a point
   * light. Only smaller, and sat on a floor whose height the caller knows
   * rather than on the terrain.
   */
  pitch(x: number, z: number, nearby: string | null, opts?: { y?: number; indoors?: boolean }) {
    this.indoors = !!opts?.indoors;
    this.group.scale.setScalar(this.indoors ? 0.7 : 1);
    this.site.set(x, opts?.y ?? heightAt(x, z), z);
    this.group.position.copy(this.site);
    this.group.visible = true;
    this.active = true;
    this.nearby = nearby;
    this.orbit = 0;
    this.elevation = 4.4;
    this.lookIdle = 99;
    this.restTarget = null;
  }

  /**
   * Pan around the fire.
   *
   * While camped the look input drives this instead of the player's own yaw,
   * which the camp camera overrides anyway — so nothing is taken away, and
   * sitting at a fire becomes something you look around from rather than
   * something you walk about in.
   */
  look(dx: number, dy: number) {
    if (!this.active) return;
    this.orbit -= dx * 2.4;
    this.elevation = Math.min(9.5, Math.max(1.5, this.elevation - dy * 9));
    this.lookIdle = 0;
  }

  /** Camera yaw, so movement can be made relative to what you're looking at. */
  get viewYaw(): number {
    // Camera sits at site + (cos o, _, sin o)·r looking inward, so its view
    // direction is -(cos o, 0, sin o). Matching that to the engine's
    // (-sin yaw, 0, -cos yaw) gives yaw = pi/2 - o.
    return Math.PI / 2 - this.orbit;
  }

  strike() {
    this.active = false;
    this.indoors = false;
    this.restTarget = null;
    this.group.visible = false;
  }

  rest(target: Exclude<RestTarget, null>, from: number) {
    if (!this.active) return;
    this.restTarget = target;
    const to = target === "dawn" ? DAWN : DUSK;
    const distance = (((to - from) % 1) + 1) % 1;
    this.restRate = Math.max(distance, 0.02) / REST_SECONDS;
  }

  get resting() {
    return this.restTarget !== null;
  }

  /**
   * Returns a 0..1 fire level for the audio mix, and runs the time-lapse.
   * Resting always takes the same real duration no matter how far the clock
   * has to travel, so sleeping the night through never feels like waiting.
   */
  update(dt: number, env: Environment, emit: (x: number, y: number, z: number) => void): number {
    if (!this.active) return 0;

    // Drift slowly, but only once the player has stopped panning.
    this.lookIdle += dt;
    if (this.lookIdle > 5) this.orbit += dt * 0.085;

    // Flicker: three cones breathing out of phase reads as fire surprisingly well.
    const t = env.elapsed;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const n = 0.78 + Math.sin(t * (9 + i * 3.3) + i) * 0.14 + Math.sin(t * (21 + i * 5)) * 0.08;
      f.scale.set(n, n * (1.05 + Math.sin(t * 7 + i * 2) * 0.16), n);
      f.rotation.y = t * (0.7 + i * 0.3);
    }
    this.light.intensity = 9 + Math.sin(t * 11) * 1.6 + Math.sin(t * 23) * 0.8;

    this.emberTimer -= dt;
    if (this.emberTimer <= 0) {
      this.emberTimer = 0.09 + Math.random() * 0.13;
      emit(this.site.x + (Math.random() - 0.5) * 0.3, this.site.y + 0.8, this.site.z + (Math.random() - 0.5) * 0.3);
    }

    if (this.restTarget) {
      const target = this.restTarget === "dawn" ? DAWN : DUSK;
      const remain = (((target - env.timeOfDay) % 1) + 1) % 1;
      // Constant rate, so the rest lands in REST_SECONDS however far the
      // clock has to travel. Overshoot is snapped rather than eased.
      if (remain <= this.restRate * dt || remain < 0.003) {
        env.timeOfDay = target;
        this.restTarget = null;
      } else {
        env.advance(dt * this.restRate * DAY_LENGTH_SECONDS);
      }
    }

    return 1;
  }

  /**
   * Where the camera should sit while camped: a slow, high orbit of the fire.
   *
   * Deliberately looking down from above head height. A low orbit at eye level
   * swings straight through whatever you parked next to, and you nearly always
   * camp beside the truck.
   */
  cameraTarget(out: THREE.Vector3, look: THREE.Vector3) {
    const r = 6.4;
    const x = this.site.x + Math.cos(this.orbit) * r;
    const z = this.site.z + Math.sin(this.orbit) * r;
    // Never let the orbit dip into a slope behind the fire.
    const y = Math.max(this.site.y + this.elevation, heightAt(x, z) + 1.6);
    out.set(x, y, z);
    look.set(this.site.x, this.site.y + 0.55, this.site.z);
  }
}
