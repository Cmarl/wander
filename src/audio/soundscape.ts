import { AudioEngine } from "./engine";
import { Ambience, type AmbienceContext } from "./ambience";
import { Sfx, VehicleAudio } from "./sfx";
import { heightAt, slopeAt, temperatureAt, treeDensityAt, surfaceAt, type Surface } from "../world/field";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface SoundscapeState {
  x: number;
  z: number;
  onFoot: boolean;
  speed: number;
  grounded: boolean;
  night: number;
  vehicle: { speed: number; throttle: number; y: number; topSpeed: number } | null;
}

/**
 * Ties the audio graph to the world. Samples the terrain around the listener a
 * few times a second — the same functions the renderer uses — and turns that
 * into wind, shelter, water and insect levels.
 */
export class Soundscape {
  readonly engine = new AudioEngine();
  private ambience = new Ambience(this.engine);
  readonly sfx = new Sfx(this.engine);
  private vehicle = new VehicleAudio(this.engine, this.sfx);

  private sampleTimer = 0;
  private stepAccum = 0;
  private surface: Surface = "grass";
  private ctx: AmbienceContext = {
    exposure: 0.3,
    treeCover: 0.2,
    water: 0,
    warmth: 0.5,
    night: 0,
    inVehicle: false,
  };

  /** Browsers only allow audio to begin inside a user gesture. */
  attachUnlock() {
    const go = () => {
      if (this.engine.start()) {
        this.ambience.build();
        this.vehicle.build();
        removeEvents();
      }
    };
    const removeEvents = () => {
      for (const ev of ["pointerdown", "keydown", "touchstart"]) {
        removeEventListener(ev, go);
      }
    };
    for (const ev of ["pointerdown", "keydown", "touchstart"]) {
      addEventListener(ev, go, { passive: true });
    }
    document.addEventListener("visibilitychange", () => this.engine.setActive(!document.hidden));
  }

  get muted() {
    return this.engine.muted;
  }
  get volume() {
    return this.engine.volume;
  }
  setVolume(v: number) {
    this.engine.setVolume(v);
  }
  toggleMute() {
    this.engine.setMuted(!this.engine.muted);
    return this.engine.muted;
  }

  update(dt: number, s: SoundscapeState) {
    if (!this.engine.ready) return;

    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 0.25;
      this.sampleWorld(s.x, s.z);
    }
    this.ctx.night = s.night;
    this.ctx.inVehicle = !s.onFoot;
    this.ambience.update(dt, this.ctx);

    if (s.onFoot) {
      this.footsteps(dt, s);
    } else if (s.vehicle) {
      this.vehicle.update(dt, s.vehicle);
    }
  }

  /** Stride length grows with pace, so running isn't just a faster shuffle. */
  private footsteps(dt: number, s: SoundscapeState) {
    if (!s.grounded || s.speed < 0.3) {
      this.stepAccum = 1e3; // land the next step immediately on moving off
      return;
    }
    this.stepAccum += s.speed * dt;
    const stride = 1.5 + s.speed * 0.12;
    if (this.stepAccum >= stride) {
      this.stepAccum = 0;
      this.sfx.footstep(this.surface, s.speed);
    }
  }

  land() {
    if (this.engine.ready) this.sfx.landing(this.surface);
  }

  crash(force: number) {
    // Anything with trees around it probably was one.
    this.sfx.crash(force, this.ctx.treeCover > 0.12);
  }

  vehicleLand(force: number) {
    this.sfx.thump(force);
  }

  mount() {
    this.sfx.doorOpen();
    window.setTimeout(() => this.sfx.doorClose(), 420);
    window.setTimeout(() => this.vehicle.ignition(), 620);
  }

  dismount() {
    this.vehicle.shutdown();
    this.sfx.doorOpen();
    window.setTimeout(() => this.sfx.doorClose(), 480);
  }

  /**
   * One sample of the neighbourhood. Tree cover is averaged over a few points
   * so walking past a single trunk doesn't swing the rustle layer, and water is
   * measured by how much of two rings around you sits below sea level.
   */
  private sampleWorld(x: number, z: number) {
    const h = heightAt(x, z);
    const slope = slopeAt(x, z, 4);
    this.surface = surfaceAt(x, z);

    let cover = 0;
    for (const [dx, dz] of [[0, 0], [22, 9], [-18, 16], [7, -24], [-12, -11]]) {
      const px = x + dx;
      const pz = z + dz;
      const ph = heightAt(px, pz);
      cover += treeDensityAt(px, pz, ph, slopeAt(px, pz, 4));
    }
    cover /= 5;

    let wet = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      if (heightAt(x + c * 35, z + sn * 35) < 0) wet += 2;
      if (heightAt(x + c * 95, z + sn * 95) < 0) wet += 1;
    }
    const water = clamp01(wet / 14) * (h < 60 ? 1 : Math.max(0, 1 - (h - 60) / 120));

    this.ctx.treeCover = clamp01(cover * 1.6);
    this.ctx.water = water;
    this.ctx.warmth = clamp01(temperatureAt(x, z) - h / 9000);
    // Wind rises with altitude and with open, steep, unsheltered ground.
    this.ctx.exposure = clamp01(0.18 + (h / 2200) * 0.72 + slope * 0.25 - this.ctx.treeCover * 0.3);
  }
}
